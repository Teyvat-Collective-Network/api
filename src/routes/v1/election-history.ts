import { t } from "elysia";
import { App } from "../../lib/app.js";
import { hasScope, isCouncil, isObserver, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { ElectionHistoryRecord } from "../../lib/types.js";
import { trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/election-history", (app) =>
        app
            .get(
                "/",
                async () => {
                    const waves: Record<number, ElectionHistoryRecord[]> = {};

                    for (const entry of (await db.election_history.find().toArray()) as unknown[] as (ElectionHistoryRecord & { wave: number })[])
                        (waves[entry.wave] ??= []).push({ id: entry.id, status: entry.status, rerunning: entry.rerunning });

                    for (const entry of (await db.election_history_waves.find().toArray()) as unknown[] as { wave: number }[]) waves[entry.wave] ??= [];

                    return Object.keys(waves)
                        .sort((x, y) => +y - +x)
                        .map((x) => ({
                            wave: +x,
                            users: waves[+x].sort(
                                (x, y) => (x.rerunning ? 0 : 1) - (y.rerunning ? 0 : 1) || (x.id === y.id ? 0 : BigInt(x.id) > BigInt(y.id) ? -1 : 1),
                            ),
                        }));
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("records/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get the election history records.",
                        description: trim(`
                            \`\`\`
                            Scope: records/read
                            \`\`\`

                            Get the election history records. Council-only.
                        `),
                    },
                    response: t.Array(
                        t.Object({
                            wave: t.Integer({ description: "The election wave number." }),
                            users: t.Array(
                                t.Object({
                                    id: schemas.snowflake("The ID of the candidate."),
                                    status: t.String({ description: "The status of the candidate." }),
                                    rerunning: t.Boolean({ description: "Whether this candidate is rerunning in this election." }),
                                }),
                                { description: "Sorted in numerical order of ID with rerunning candidates first." },
                            ),
                        }),
                        { description: "Sorted in decreasing order of wave." },
                    ),
                },
            )
            .post(
                "/:wave",
                async ({ params: { wave } }) => {
                    const doc = await db.election_history_waves.findOneAndUpdate({ wave }, { $set: { wave } }, { upsert: true });
                    if (doc) throw new APIError(409, codes.DUPLICATE, `Wave ${wave} already exists.`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("records/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Create an election wave.",
                        description: trim(`
                            \`\`\`
                            Scope: records/write
                            \`\`\`

                            Create an empty election wave. Observer-only.
                        `),
                    },
                    params: t.Object({
                        wave: t.Numeric({ minimum: 1, description: "The election wave." }),
                    }),
                },
            )
            .post(
                "/:wave/:id",
                async ({ params: { wave, id } }) => {
                    if ((await db.election_history_waves.countDocuments({ wave })) === 0)
                        throw new APIError(404, codes.MISSING_ELECTION_WAVE, `No election exists with wave ${wave}.`);

                    const doc = await db.election_history.findOneAndUpdate(
                        { wave, id },
                        { $set: { id }, $setOnInsert: { status: "nominated", rerunning: false } },
                        { upsert: true },
                    );

                    if (doc) throw new APIError(409, codes.DUPLICATE, `User ${id} is already a nominee or candidate in the wave ${wave} election.`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("records/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Add a candidate to an election.",
                        description: trim(`
                            \`\`\`
                            Scope: records/write
                            \`\`\`

                            Add a candidate to an election. Observer-only. The user is created as "Nominated" and not rerunning.
                        `),
                    },
                    params: t.Object({
                        wave: t.Numeric({ minimum: 1, description: "The election wave." }),
                        id: schemas.snowflake("The ID of the user."),
                    }),
                },
            )
            .patch(
                "/:wave/:id",
                async ({ body, params: { wave, id } }) => {
                    if (body.status !== undefined && !["elected", "not_elected", "accepted", "declined", "nominated", "unknown"].includes(body.status))
                        throw new APIError(400, codes.INVALID_BODY, `Invalid nominee status ${body.status}.`);

                    const doc = await db.election_history.findOneAndUpdate({ wave, id }, { $set: body });

                    if (!doc)
                        if ((await db.election_history_waves.countDocuments({ wave })) === 0)
                            throw new APIError(404, codes.MISSING_ELECTION_WAVE, `No election exists with wave ${wave}.`);
                        else throw new APIError(404, codes.MISSING_ELECTION_USER, `User ${id} is not a nominee or candidate in the wave ${wave} election.`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("records/write")],
                    body: t.Object({
                        status: t.Optional(t.String({ description: "The status of the candidate." })),
                        rerunning: t.Optional(t.Boolean({ description: "Whether this candidate is rerunning in this election." })),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Update an election history entry.",
                        description: trim(`
                            \`\`\`
                            Scope: records/write
                            \`\`\`

                            Update an election history record. Observer-only. The entry must already exist.
                        `),
                    },
                    params: t.Object({
                        wave: t.Numeric({ minimum: 1, description: "The election wave." }),
                        id: schemas.snowflake("The ID of the user to edit."),
                    }),
                },
            )
            .delete(
                "/:wave",
                async ({ params: { wave } }) => {
                    const doc = await db.election_history_waves.findOneAndDelete({ wave });
                    if (!doc) throw new APIError(404, codes.MISSING_ELECTION_WAVE, `No election exits with wave ${wave}.`);

                    await db.election_history.deleteMany({ wave });
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("records/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Delete an election wave.",
                        description: trim(`
                            \`\`\`
                            Scope: records/write
                            \`\`\`

                            Delete an election wave. Observer-only.
                        `),
                    },
                    params: t.Object({
                        wave: t.Numeric({ minimum: 1, description: "The election wave." }),
                    }),
                },
            )
            .delete(
                "/:wave/:id",
                async ({ params: { wave, id } }) => {
                    const doc = await db.election_history.findOneAndDelete({ wave, id });

                    if (!doc)
                        if ((await db.election_history_waves.countDocuments({ wave })) === 0)
                            throw new APIError(404, codes.MISSING_ELECTION_WAVE, `No election exists with wave ${wave}.`);
                        else throw new APIError(404, codes.MISSING_ELECTION_USER, `User ${id} is not a nominee or candidate in the wave ${wave} election.`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("records/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Remove a user from an election.",
                        description: trim(`
                            \`\`\`
                            Scope: records/write
                            \`\`\`

                            Remove a user from an election. Observer-only. This should only really be used in cases of inserting the wrong user by mistake. If
                            a nominee rejects their nomination, set their status to declined.
                        `),
                    },
                    params: t.Object({
                        wave: t.Numeric({ minimum: 1, description: "The election wave." }),
                        id: schemas.snowflake("The ID of the user to remove."),
                    }),
                },
            ),
    );
