import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { AuditLogAction, headers } from "../../lib/audit.js";
import bot from "../../lib/bot.js";
import { hasScope, isCouncil, isObserver, isSignedIn, ratelimitApply, ratelimitCheck } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import data from "../../lib/data.js";
import db, { autoinc } from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import logger from "../../lib/logger.js";
import { extractForBot } from "../../lib/polls.js";
import schemas from "../../lib/schemas.js";
import { PollResponse, PollResults, PollVote } from "../../lib/types.js";
import { changes, trim } from "../../lib/utils.js";
import { validatePoll } from "../../lib/validators.js";

export default (app: App) =>
    app.group("/polls", (app) =>
        app
            .get(
                "/",
                async () => {
                    return (await db.polls.find().toArray()) as unknown[] as PollResponse[];
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("polls/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get all polls.",
                        description: trim(`
                            \`\`\`
                            Scope: polls/read
                            \`\`\`

                            Get all polls. Council-only.
                        `),
                    },
                    response: t.Array(schemas.pollResponse),
                },
            )
            .get(
                "/:id",
                async ({ params: { id } }) => {
                    const poll = (await db.polls.findOne({ id })) as unknown as PollResponse;
                    if (!poll) throw new APIError(404, codes.MISSING_POLL, `No poll exists with ID ${id}.`);

                    return poll;
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("polls/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get a poll.",
                        description: trim(`
                            \`\`\`
                            Scope: polls/read
                            \`\`\`

                            Get a poll. Council-only.
                        `),
                    },
                    params: t.Object({
                        id: t.Numeric({ description: "The ID of the poll." }),
                    }),
                    response: schemas.pollResponse,
                },
            )
            .post(
                "/",
                async ({ bearer, body, reason, user }) => {
                    await validatePoll(body);

                    const id = await autoinc("polls");
                    const data = { ...body, id, close: Math.floor(Date.now() + body.duration * 60 * 60 * 1000), closed: body.duration === 0 };

                    const { message } = await bot(bearer!, "PUT /poll", extractForBot(data));

                    await db.polls.insertOne({ ...data, id, message } satisfies PollResponse);

                    audit(user, AuditLogAction.POLLS_CREATE, body, reason);

                    return { id };
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("polls/write"), ratelimitCheck("polls/write", 20000, 4)],
                    afterHandle: [ratelimitApply("polls/write")],
                    body: schemas.poll,
                    detail: {
                        tags: ["V1"],
                        summary: "Create a poll.",
                        description: trim(`
                            \`\`\`
                            Scope: polls/write
                            \`\`\`

                            Create a poll. Observer-only.
                        `),
                    },
                    headers: headers(),
                    response: t.Object({
                        id: t.Integer({ minimum: 1, description: "The ID of the created poll." }),
                    }),
                },
            )
            .put(
                "/:id",
                async ({ bearer, body, params: { id }, reason, user }) => {
                    const doc = (await db.polls.findOne({ id })) as unknown as PollResponse;
                    if (!doc) throw new APIError(404, codes.MISSING_POLL, `No poll exists with ID ${id}.`);
                    if (body.mode !== doc.mode)
                        throw new APIError(400, codes.INVALID_BODY, `Poll modes cannot be changed (attempted to change from ${doc.mode} to ${body.mode}).`);

                    await validatePoll(body);

                    const data = {
                        ...body,
                        close: body.duration === 0 ? Math.min(Date.now(), doc.close) : Math.floor(Date.now() + body.duration * 60 * 60 * 1000),
                        closed: doc.closed && body.duration === 0,
                    };

                    const { message } = await bot(bearer!, "PUT /poll", { message: doc.message, ...extractForBot(data) });
                    data.message = message;

                    await db.polls.replaceOne({ id }, data);

                    audit(user, AuditLogAction.POLLS_EDIT, { id, changes: changes(doc, data) }, reason);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("polls/write"), ratelimitCheck("polls/write", 20000, 4)],
                    afterHandle: [ratelimitApply("polls/write")],
                    body: schemas.poll,
                    detail: {
                        tags: ["V1"],
                        summary: "Update a poll.",
                        description: trim(`
                            \`\`\`
                            Scope: polls/write
                            \`\`\`

                            Update a poll. Observer-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({
                        id: t.Numeric({ minimum: 1, description: "The ID of the poll to edit." }),
                    }),
                },
            )
            .delete(
                "/:id",
                async ({ bearer, params: { id }, reason, user }) => {
                    const doc = await db.polls.findOneAndDelete({ id });
                    if (!doc) throw new APIError(404, codes.MISSING_POLL, `No poll exists with ID ${id}.`);

                    await bot(bearer!, `DELETE /poll/${doc.message}`).catch((error) => logger.error(error, "75ac4742-ce5b-48d8-b7cd-abac402362ff"));

                    audit(user, AuditLogAction.POLLS_DELETE, doc, reason);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("polls/delete"), ratelimitCheck("polls/write", 20000, 4)],
                    afterHandle: [ratelimitApply("polls/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Delete a poll.",
                        description: trim(`
                            \`\`\`
                            Scope: polls/delete
                            \`\`\`

                            Delete a poll. Observer-only.
                        `),
                    },
                    headers: headers(true),
                    params: t.Object({
                        id: t.Numeric({ minimum: 1, description: "The ID of the poll to edit." }),
                    }),
                },
            )
            .get(
                "/:id/vote",
                async ({ params: { id }, user }) => {
                    const poll = await db.polls.findOne({ id });
                    if (!poll) throw new APIError(404, codes.MISSING_POLL, `No poll exists with ID ${id}.`);

                    const data = (await db.votes.findOne({ poll: id, user: user!.id })) as unknown as PollVote;
                    if (!data) throw new APIError(404, codes.MISSING_VOTE, "You have not voted on this poll.");

                    data.mode = poll.mode;
                    data.yes ??= false;
                    data.verdict ??= "reject";
                    data.candidates ??= {};
                    data.selected ??= [];

                    return data;
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("polls/vote")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get your vote.",
                        description: trim(`
                            \`\`\`
                            Scope: polls/vote
                            \`\`\`

                            Get your vote. Council-only if unrestricted and voter-only otherwise.
                        `),
                    },
                    params: t.Object({
                        id: t.Numeric({ description: "The ID of the poll." }),
                    }),
                    response: schemas.pollVoteResponse,
                },
            )
            .put(
                "/:id/vote",
                async ({ bearer, body, params: { id }, user }) => {
                    const poll = (await db.polls.findOne({ id })) as unknown as PollResponse;
                    if (!poll) throw new APIError(404, codes.MISSING_POLL, `No poll exists with ID ${id}.`);
                    if (poll.restricted && !user!.voter) throw new APIError(403, codes.FORBIDDEN, "This poll is restricted to designated voters.");

                    if (!body.abstain)
                        if (poll.mode === "proposal") {
                            if (body.yes === undefined) throw new APIError(400, codes.INVALID_BODY, "This is an proposal vote and requires the `yes` field.");
                        } else if (poll.mode === "induction") {
                            if (body.verdict === undefined)
                                throw new APIError(400, codes.INVALID_BODY, "This is an induction vote and requires the `verdict` field.");
                            if (!["induct", "preinduct", "reject", "extend"].includes(body.verdict))
                                throw new APIError(400, codes.INVALID_BODY, `Invalid induction verdict ${body.verdict}.`);
                        } else if (poll.mode === "election") {
                            if (body.candidates === undefined)
                                throw new APIError(400, codes.INVALID_BODY, "This is an election vote and requires the `candidates` field.");

                            const invalid = Object.keys(body.candidates).filter((x) => !poll.candidates.includes(x));
                            if (invalid.length > 0) throw new APIError(400, codes.INVALID_BODY, `Invalid candidate(s) ranked: ${invalid.join(", ")}`);

                            if (user!.id in body.candidates) throw new APIError(400, codes.INVALID_BODY, `Do not rank yourself in elections.`);
                            body.candidates[user!.id] = 0;

                            const missing = poll.candidates.filter((x) => !(x in body.candidates));
                            if (missing.length > 0) throw new APIError(400, codes.INVALID_BODY, `Missing candidate(s) from rankings: ${missing.join(", ")}.`);

                            if (Object.values(body.candidates as Record<string, number>).some((x) => x < -1))
                                throw new APIError(
                                    400,
                                    codes.INVALID_BODY,
                                    "Rankings must be -1 for counter-voting, 0 for abstaining, or 1 and above to rank candidates.",
                                );

                            const values = Object.values(body.candidates as Record<string, number>)
                                .filter((x) => x > 0)
                                .sort();

                            if (new Set(values).size < values.length)
                                throw new APIError(400, codes.INVALID_BODY, "You submitted the same ranking for multiple candidates.");
                            if (values.length > 0 && (values[0] !== 1 || values.at(-1) !== values.length))
                                throw new APIError(400, codes.INVALID_BODY, "Rankings must start from 1 and go up by one at a time.");
                        } else if (poll.mode === "selection") {
                            if (body.selected === undefined)
                                throw new APIError(400, codes.INVALID_BODY, "This in a selection vote and requires the `selected` field.");
                            if (body.selected.some((x: string) => !poll.options.includes(x)))
                                throw new APIError(400, codes.INVALID_BODY, "At least one invalid option was included in the `selected` field.");
                            if (body.selected.length < poll.min || body.selected.length > poll.max)
                                throw new APIError(
                                    400,
                                    codes.INVALID_BODY,
                                    `You must select ${poll.min === poll.max ? `${poll.max}` : `between ${poll.min} and ${poll.max}`} option${
                                        poll.max === 1 ? "" : "s"
                                    }`,
                                );
                        }

                    await db.votes.updateOne({ poll: id, user: user!.id }, { $set: body }, { upsert: true });

                    try {
                        const { message } = await bot(bearer!, "PUT /poll", { message: poll.message, ...extractForBot(poll) });
                        if (message !== poll.message) await db.polls.updateOne({ message: poll.message }, { $set: { message } });
                    } catch (error) {
                        logger.error(error, "e07cc7d7-4215-4c1a-885a-ae4122763f96");
                    }
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("polls/vote"), ratelimitCheck("polls/vote", 20000, 4)],
                    afterHandle: [ratelimitApply("polls/vote")],
                    body: schemas.pollVote,
                    detail: {
                        tags: ["V1"],
                        summary: "Vote on a poll.",
                        description: trim(`
                            \`\`\`
                            Scope: polls/vote
                            \`\`\`

                            Vote on a poll. Council-only if unrestricted and voter-only otherwise.
                        `),
                    },
                    params: t.Object({
                        id: t.Numeric({ description: "The ID of the poll." }),
                    }),
                },
            )
            .get(
                "/:id/results",
                async ({ params: { id } }) => {
                    const poll = (await db.polls.findOne({ id })) as unknown as PollResponse;
                    if (!poll) throw new APIError(404, codes.MISSING_POLL, `No poll exists with ID ${id}.`);

                    const ballots = (await db.votes.find({ poll: id }).toArray()) as unknown[] as PollVote[];
                    const votes = ballots.filter((x) => !x.abstain);
                    const voters = new Set((await data.getGuilds()).flatMap((g) => (poll.restricted ? [g.owner] : [g.owner, g.advisor])).filter((x) => x));

                    const turnout = (ballots.length * 100) / voters.size;

                    const response: PollResults = {
                        mode: poll.mode,
                        abstains: ballots.length - votes.length,
                        votes: votes.length,
                        ballots: ballots.length,
                        turnout,
                        yes: 0,
                        no: 0,
                        induct: 0,
                        preinduct: 0,
                        reject: 0,
                        extend: 0,
                        winners: [],
                        tied: [],
                        scores: {},
                    };

                    if (poll.live || (poll.closed && turnout >= poll.quorum))
                        if (poll.mode === "proposal") {
                            for (const vote of votes)
                                if (vote.yes) response.yes++;
                                else response.no++;
                        } else if (poll.mode === "induction") {
                            for (const vote of votes) if (["induct", "preinduct", "reject", "extend"].includes(vote.verdict)) (response as any)[vote.verdict]++;
                        } else if (poll.mode === "election") {
                            const balance = Object.fromEntries(poll.candidates.map((x) => [x, 0]));
                            const scores = Object.fromEntries(poll.candidates.map((x) => [x, 0]));

                            for (const vote of votes)
                                for (const [user, rank] of Object.entries(vote.candidates))
                                    if (rank === -1) balance[user]--;
                                    else if (rank > 0) {
                                        balance[user]++;
                                        scores[user] += poll.seats < poll.candidates.length ? poll.candidates.length - rank : 1;
                                    }

                            const eligible = poll.candidates.filter((x) => balance[x] >= 0).sort((x, y) => scores[y] - scores[x]);
                            eligible.sort((x, y) => scores[y] - scores[x]);

                            let elected: string[];
                            let tied: string[] = [];

                            if (eligible.length > poll.seats && scores[eligible[poll.seats - 1]] === scores[eligible[poll.seats]]) {
                                elected = eligible.filter((x) => scores[x] > scores[eligible[poll.seats]]);
                                tied = eligible.filter((x) => scores[x] === scores[eligible[poll.seats]]);
                            } else elected = eligible.slice(0, poll.seats);

                            response.winners = elected.sort();
                            response.tied = tied.sort();
                        } else if (poll.mode === "selection") {
                            response.scores = Object.fromEntries(poll.options.map((x) => [x, 0]));
                            for (const vote of votes) for (const item of vote.selected) response.scores[item]++;
                        }

                    return response;
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("polls/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get the results of a poll.",
                        description: trim(`
                            \`\`\`
                            Scope: polls/read
                            \`\`\`

                            Get the results of a poll. Council-only. The poll must either be \`live\` or closed, otherwise only the number of abstain ballots,
                            the total ballot count, and the turnout will be returned and all other values will be their defaults.
                        `),
                    },
                    params: t.Object({
                        id: t.Numeric({ description: "The ID of the poll." }),
                    }),
                    response: t.Object({
                        mode: t.String({ description: "The mode of the poll." }),
                        abstains: t.Integer({ minimum: 0, description: "The number of abstain ballots." }),
                        votes: t.Integer({ minimum: 0, description: "The number of non-empty ballots." }),
                        ballots: t.Integer({ minimum: 0, description: "The number of ballots, including abstain ballots, that have been submitted." }),
                        turnout: t.Number({ minimum: 0, maximum: 100, description: "The turnout as a percentage." }),
                        yes: t.Integer({ minimum: 0, description: "For proposal votes, the number of yes votes. Otherwise, 0." }),
                        no: t.Integer({ minimum: 0, description: "For proposal votes, the number of no votes. Otherwise, 0." }),
                        induct: t.Integer({ minimum: 0, description: "For induction votes, the number of induct verdicts. Otherwise, 0." }),
                        preinduct: t.Integer({
                            minimum: 0,
                            description:
                                "For preinduction votes, the number of preinduct verdicts. Othrewise, 0. Any preinduct verdicts where preinduction is disabled are automatically coerced into regular induct verdicts.",
                        }),
                        reject: t.Integer({ minimum: 0, description: "For induction votes, the number of reject verdicts. Otherwise, 0." }),
                        extend: t.Integer({ minimum: 0, description: "For induction votes, the number of extend verdicts. Otherwise, 0." }),
                        winners: t.Array(schemas.snowflake(), {
                            description: "An array of winners, in no particular order, for election votes. Otherwise, the empty array.",
                        }),
                        tied: t.Array(schemas.snowflake(), {
                            description: "An array of candidates who are tied for the remaining seats for election votes. Otherwise, the empty array.",
                        }),
                        scores: t.Object(
                            {},
                            {
                                additionalProperties: t.Integer({ minimum: 0 }),
                                description: "A map from choices to number of votes in support for selection votes. Otherwise, the empty object.",
                            },
                        ),
                    }),
                },
            )
            .get(
                "/records",
                async () => {
                    const polls = (await db.polls.find({ closed: true }).toArray()) as unknown[] as PollResponse[];
                    const pollIds = polls.map(({ id }) => id);

                    return {
                        polls,
                        votes: (await db.vote_records.find({ id: { $in: pollIds } }).toArray()) as unknown[] as { id: number; user: string; voted: boolean }[],
                        ids: (await data.getGuilds()).flatMap((guild) => [guild.owner, guild.advisor!].filter((x) => x)),
                    };
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("polls/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get the voting records.",
                        description: trim(`
                            \`\`\`
                            Scope: polls/read
                            \`\`\`

                            Get the voting records (activity check for voter turnout). Observer-only.
                        `),
                    },
                    response: t.Object({
                        polls: t.Array(schemas.pollResponse),
                        votes: t.Array(t.Object({ id: t.Integer(), user: schemas.snowflake(), voted: t.Boolean() })),
                        ids: t.Array(schemas.snowflake()),
                    }),
                },
            ),
    );
