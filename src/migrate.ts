import { ChannelType, Client, Events } from "discord.js";
import { Collection, Db, Document } from "mongodb";
import audit, { AuditLogAction } from "./lib/audit.js";
import db, { autoinc, client, connect } from "./lib/db.js";
import logger from "./lib/logger.js";

await connect();

const bot = new Client({ intents: 0 });
await bot.login(Bun.env.GLOBAL_TOKEN!);
await new Promise((r) => bot.on(Events.ClientReady, r));

const cache: Record<string, Db> = {};

const src = new Proxy(
    {},
    {
        get(_, db: string): Record<string, Collection<Document>> {
            cache[db] ??= client.db(db);

            return new Proxy(
                {},
                {
                    get(_, collection: string): Collection<Document> {
                        return cache[db].collection(collection);
                    },
                },
            );
        },
    },
) as Record<string, Record<string, Collection<Document>>>;

const toRun = Bun.env.RUN?.split(/\s+/);
const skip = Bun.env.SKIP?.split(/\s+/) ?? [];

async function run(key: string, fn: any, drop?: string[]) {
    if ((!toRun || toRun.includes(key)) && !skip.includes(key)) {
        logger.info(`replicating ${key}`);
        for (const name of drop ?? [key])
            await db[name]
                .drop()
                .then(() => logger.info(`dropped ${name}`))
                .catch(() => logger.info(`${name} already does not exist`));
        await fn();
    }
}

// attributes
await run("attributes", async () => {
    for (const type of ["weapon", "element", "region"])
        for (const item of await src["TCN-site"][`${type}s`].find().toArray())
            await db.attributes.updateOne(
                { type, id: item.name },
                { $set: { name: `${item.name[0].toUpperCase()}${item.name.slice(1)}`, emoji: item.emoji } },
                { upsert: true },
            );
});

// audit_logs
await run(
    "audit_logs_membership_changes",
    async () => {
        const mascotMap: Record<string, string> = {
            "786025543064748042": "ganyu",
            "778432104890892288": "childe",
            "853204818806046730": "ayaka",
            "776289823199461376": "ningguang",
            "801704307468533780": "wanderer",
            "782766417945559051": "rosaria",
            "805988900513251379": "albedo",
            "834836716882755584": "raiden",
            "808500851395395657": "eula",
            "764710866326650920": "diluc",
            "864186117438832691": "itto",
            "821629320656846869": "aloy",
            "775418768675307520": "razor",
            "842844545921581126": "kaeya",
            "787238069186330624": "beidou",
            "797088957849403392": "baizhu",
        };

        await db.counters.deleteOne({ sequence: "audit-logs" });

        const nameCache: Record<string, string> = {};

        for (const entry of await src["TCN-site"].membership_changes.find().toArray())
            if (entry.guild.match(/^[1-9][0-9]{16,19}$/)) {
                const name = (nameCache[entry.guild] ??=
                    (await src["TCN-api"].guilds.findOne({ id: entry.guild }))?.name ??
                    (await src["TCN-site"].guild_map.findOne({ id: entry.guild }))?.name ??
                    entry.guild);

                const data = (
                    entry.action === "add-advisor"
                        ? [AuditLogAction.GUILDS_EDIT, { id: entry.guild, name, changes: { advisor: [null, entry.primary] } }]
                        : entry.action === "transfer-ownership"
                        ? [AuditLogAction.GUILDS_EDIT, { id: entry.guild, name, changes: { owner: [entry.primary, entry.secondary] } }]
                        : entry.action === "switch-advisor"
                        ? [AuditLogAction.GUILDS_EDIT, { id: entry.guild, name, changes: { advisor: [entry.primary, entry.secondary] } }]
                        : entry.action === "term-end"
                        ? [AuditLogAction.USERS_DEMOTE, { id: entry.primary }]
                        : entry.action === "elected"
                        ? [AuditLogAction.USERS_PROMOTE, { id: entry.primary }]
                        : entry.action === "owner-abdicates-advisor" || entry.action === "advisor-leaves"
                        ? [
                              AuditLogAction.GUILDS_EDIT,
                              {
                                  id: entry.guild,
                                  name,
                                  changes: { advisor: [entry.action === "owner-abdicates-advisor" ? entry.secondary : entry.primary, null] },
                              },
                          ]
                        : entry.action === "owner-defers-vote"
                        ? [
                              AuditLogAction.GUILDS_EDIT,
                              { id: entry.guild, name, changes: { voter: [entry.primary, entry.secondary], delegated: [false, true] } },
                          ]
                        : entry.action === "observer-steps-down"
                        ? [AuditLogAction.USERS_DEMOTE, { id: entry.primary }]
                        : entry.action === "withdrawn" || entry.action === "leaves-by-default"
                        ? [
                              AuditLogAction.GUILDS_DELETE,
                              {
                                  id: entry.guild,
                                  name,
                                  mascot: mascotMap[entry.id as string] ?? "unknown",
                                  invite: "null",
                                  owner: entry.primary,
                                  advisor: entry.secondary || null,
                                  voter: entry.primary,
                                  delegated: false,
                              },
                          ]
                        : entry.action === "induct"
                        ? [
                              AuditLogAction.GUILDS_CREATE,
                              {
                                  id: entry.guild,
                                  name,
                                  mascot: (await src["TCN-api"].guilds.findOne({ id: entry.guild }))?.character ?? mascotMap[entry.id as string] ?? "unknown",
                                  invite: "null",
                                  owner: entry.primary,
                                  advisor: entry.secondary || null,
                                  voter: entry.primary,
                                  delegated: false,
                              },
                          ]
                        : entry.action === "swap-owner-and-advisor"
                        ? [
                              AuditLogAction.GUILDS_EDIT,
                              { id: entry.guild, name, changes: { owner: [entry.primary, entry.secondary], advisor: [entry.secondary, entry.primary] } },
                          ]
                        : entry.action === "re-elected"
                        ? [AuditLogAction.USERS_TERM_REFRESH, { id: entry.primary }]
                        : entry.action === "owner-reclaims-vote"
                        ? [
                              AuditLogAction.GUILDS_EDIT,
                              { id: entry.guild, name, changes: { voter: [entry.secondary, entry.primary], delegated: [true, false] } },
                          ]
                        : undefined
                ) as [AuditLogAction, any] | undefined;

                if (data)
                    await audit(
                        {
                            advisor: false,
                            council: false,
                            guilds: {},
                            id: "1".repeat(18),
                            observer: false,
                            observerSince: 0,
                            owner: false,
                            roles: [],
                            staff: false,
                            token: "N/A",
                            voter: false,
                        },
                        ...data,
                        [
                            entry.notes ||
                                {
                                    "term-end": "Regular end of term.",
                                    elected: "Elected.",
                                    "owner-abdicates-advisor": "Abdicated by server owner.",
                                    "advisor-leaves": "Voluntarily left the position.",
                                    "observer-steps-down": "Voluntarily stepped down.",
                                    withdrawn: "Voluntarily withdrawn.",
                                    "re-elected": "Re-elected.",
                                    "leaves-by-default": "Removed by default due to the owner's removal.",
                                }[entry.action as string],
                            "Auto-generated by backfill.",
                        ]
                            .filter((x) => x)
                            .join(" "),
                    );
            }
    },
    ["audit_logs"],
);

// autosync
await run("autosync", async () => {
    for (const entry of await src["TCN-manager"].partnerlists.find().toArray())
        if (entry.instances.length === 0) continue;
        else if (entry.instances.length > 1) throw `[autosync] entry for ${entry.guild} does not have one instance`;
        else
            await db.autosync.updateOne(
                { guild: entry.guild },
                { $set: Object.fromEntries(Object.entries(entry).filter(([x]) => ["channel", "webhook", "message", "repost"].includes(x))) },
                { upsert: true },
            );
    // we do not copy the template because it is in a different language
});

// banshare_settings
await run("banshare_settings", async () => {
    for (const entry of await src["TCN-banshare"].settings.find().toArray())
        await db.banshare_settings.updateOne(
            { guild: entry.guild },
            {
                $set: {
                    autoban:
                        ({ all: 0b11111111, med: 0b10111011, crit: 0b10011001 }[entry.autoban as string] ?? 0b10001000) &
                        (entry.autoban_dm_scams ? 0b11111111 : 0b01110111) &
                        ({ all: 0b11111111, med: 0b10111111, crit: 0b10011111, none: 0b10001111 }[entry.autoban_member as string] ?? 0b11111111),
                    nobutton: entry.no_button ?? false,
                    daedalus: entry.daedalus ?? false,
                    blockdms: entry.suppress_dm_scams ?? false,
                },
            },
            { upsert: true },
        );

    for (const entry of await src["TCN-banshare"].logging.find().toArray())
        await db.banshare_settings.updateOne({ guild: entry.guild }, { $addToSet: { logs: entry.channel } }, { upsert: true });

    for (const entry of await src["TCN-banshare"].channels.find().toArray())
        await db.banshare_settings.updateOne({ guild: entry.guild }, { $set: { channel: entry.channel } }, { upsert: true });
});

// banshares
await run("banshares", async () => {
    for (const entry of await src["TCN-banshare"].banshares.find().toArray())
        await db.banshares.updateOne(
            { message: entry.message },
            {
                $set: {
                    status: entry.rescinded ? "rescinded" : entry.published ? "published" : entry.rejected ? "rejected" : "pending",
                    urgent: entry.urgent ?? false,
                    ids: (entry.id_list ?? []).join(" ") || "(this banshare existed before the full ID list was stored in the DB)",
                    idList: entry.id_list ?? [],
                    reason: entry.reason,
                    evidence: entry.evidence ?? "(this banshare existed before the evidence was stored in the DB)",
                    server: entry.server,
                    severity: entry.severity.toUpperCase(),
                    author: entry.user ?? "1".repeat(18),
                    created: entry._id.getTimestamp().getTime(),
                    reminded: entry.reminded ?? entry._id.getTimestamp().getTime(),
                    // publisher: undefined, // this is not tracked in the old version
                    // rejecter: undefined, // this is not tracked in the old version
                    // rescinder: undefined, // this is not tracked in the old version
                    // explanation: undefined, // this is not tracked in the old version
                },
            },
            { upsert: true },
        );

    for (const entry of await src["TCN-banshare"].banshare_posts.find().toArray())
        await db.banshares.updateOne(
            { message: entry.banshare, "crossposts.guild": { $ne: entry.guild } },
            { $push: { crossposts: { guild: entry.guild, channel: entry.channel, message: entry.message } } },
            // if the banshare doesn't exist for some reason, we want to silently drop this record as it will break things otherwise, and also if the guild is
            // already present, we don't want to create a new entry
            { upsert: false },
        );

    ("don't replicate executed since that information isn't correctly tracked in the old version");
    ("don't replicate reports since that information is not tracked in the old version");
});

// characters
await run("characters", async () => {
    for (const entry of await src["TCN-site"].characters.find().toArray())
        await db.characters.updateOne(
            { id: entry.id },
            {
                $set: {
                    name: entry.name,
                    short: entry.name.toLowerCase().split(/\s+/).join("") === entry.id ? null : `${entry.id[0].toUpperCase()}${entry.id.slice(1)}`,
                    "attributes.element": entry.element,
                    "attributes.weapon": entry.weapon,
                    "attributes.region": entry.region,
                },
            },
            { upsert: true },
        );
});

// counters
await run("counters", async () => {
    const entry = await src["TCN-site"].counters.findOne({ seq: "polls" });
    if (entry) await db.counters.updateOne({ sequence: "polls" }, { $set: { value: entry.val } }, { upsert: true });
    await db.counters.updateOne({ sequence: "global-channels" }, { $set: { value: 3 } }, { upsert: true });
});

// deleted_banshares
("nothing to import");

// docs
await run("docs", async () => {
    for (const entry of await src["TCN-site"].docs.find().toArray())
        await db.docs.updateOne(
            { id: entry.id },
            {
                $set: {
                    official: entry.official ?? false,
                    deleted: entry.deleted ?? false,
                    author: entry.author,
                    anon: entry.anon,
                    allowCouncil: entry.allow_council,
                    allowEveryone: entry.allow_everyone,
                    allowLoggedIn: entry.allow_logged_in,
                    allowlist: entry.allowlist.split(/\s+/).filter((x: string) => x),
                    title: entry.name,
                    body: entry.content,
                    embedTitle: entry.embed_title,
                    embedBody: entry.embed_body,
                    embedColor: parseInt(entry.embed_color, 16),
                    embedImage: entry.embed_image ?? "",
                    embedThumbnail: entry.thumbnail ?? false,
                },
            },
            { upsert: true },
        );
});

// election_history
// election_history_waves
await run(
    "election_history",
    async () => {
        await db.election_history.deleteMany();
        await db.election_history_waves.deleteMany();

        await Promise.all(
            (await src["TCN-site"].election_history.find().toArray()).reverse().map(async (x, i) => {
                const wave = i + 1;

                await db.election_history_waves.insertOne({ wave, seats: x.seats });
                for (const user of x.candidates)
                    if (user.id.match(/^[1-9][0-9]{16,19}$/))
                        await db.election_history.insertOne({ wave, id: user.id, status: user.status, rerunning: user.rerunning ?? false });
            }),
        );
    },
    ["election_history", "election_history_waves"],
);

// events
("voluntarily not importing");

// global_channels
// global_connections
await run(
    "global_channels_and_connections",
    async () => {
        await Promise.all(
            [
                ["TCN", "TCN Public General"],
                ["lounge", "TCN Staff Lounge"],
                ["office", "TCN Staff Office"],
            ].map(async ([id, name], i) => {
                const entry = (await src["TCN-relay"].globals.findOne({ name: id }))!;

                await db.global_channels.updateOne(
                    { id: i + 1 },
                    {
                        $set: {
                            name,
                            public: true,
                            logs: entry.logs,
                            mods: id === "TCN" ? (await src["TCN-api"].users.find({ roles: "global-mod" }).toArray()).map((x: any) => x.id) : [],
                            bans: entry.bans,
                            panic: false,
                            ignoreFilter: id !== "TCN",
                        },
                    },
                    { upsert: true },
                );

                for (const ch of entry.subscriptions as string[]) {
                    try {
                        const channel = await bot.channels.fetch(ch);
                        if (channel?.type !== ChannelType.GuildText) throw 0;

                        await db.global_connections.updateOne(
                            { id: i + 1, guild: channel.guild.id },
                            { $set: { channel: ch, suspended: false, replyStyle: "text", showServers: true, showTag: false, bans: [] } },
                            { upsert: true },
                        );
                    } catch {
                        console.error(`Could not obtain global channel ${ch}, so dropping it from the list.`);
                    }
                }
            }),
        );
    },
    ["global_channels", "global_connections"],
);

// global_filter
await run("global_filter", async () => {
    for (const filename of ["offensive", "other", "sexual", "slurs"]) {
        const req = await fetch(`https://raw.githubusercontent.com/Teyvat-Collective-Network/relay-bot/main/filter/${filename}.txt`);
        const res = await req.text();

        const items = res
            .split(/\n+/)
            .map((x) => x.trim())
            .filter((x) => x)
            .map((x) => x.split(";")[0]);

        for (const item of items)
            if ((await db.global_filter.countDocuments({ match: item })) === 0)
                await db.global_filter.insertOne({
                    id: await autoinc("global/filter"),
                    match: item,
                    user: "1".repeat(18),
                    created: Date.now(),
                    lastUpdated: Date.now(),
                });
    }
});

// global_messages
await run("global_messages", async () => {
    const globalChannelToIDCache: Record<string, number> = {};

    async function getGCID(message: { original: { channel: string }; mirrors: { channel: string }[] }) {
        const map: Record<number, number> = {};

        for (const channel of [message.original.channel, ...message.mirrors.map((x) => x.channel)]) {
            const id = (globalChannelToIDCache[channel] ??= (await db.global_connections.findOne({ channel }))?.id ?? 0);
            map[id] = (map[id] ?? 0) + 1;
        }

        return +(Object.entries(map).sort(([, x], [, y]) => y - x)[0]?.[0] ?? 0);
    }

    const gmcount = await src["TCN-relay"].messages.countDocuments();
    let gmi = 0;

    const gmToInsert: any[] = [];

    for await (const entry of src["TCN-relay"].messages.find()) {
        gmi++;

        const id = await getGCID(entry as any);

        if (id === 0) continue;

        gmToInsert.push({
            message: entry.original.message,
            id,
            author: entry.author,
            channel: entry.original.channel,
            ...(entry.purged ? { deleted: true } : {}),
            instances: entry.mirrors.map((x: any) => ({ channel: x.channel, message: x.message })),
        });

        if (gmi % 50000 === 0) {
            logger.info(`${gmi} / ${gmcount}`);
            await db.global_messages.insertMany(gmToInsert);
            gmToInsert.splice(0, gmToInsert.length);
        }
    }

    if (gmToInsert.length > 0) await db.global_messages.insertMany(gmToInsert);
});

// global_users
await run("global_users", async () => {
    for (const entry of await src["TCN-relay"].users.find().toArray())
        await db.global_users.updateOne({ id: entry.user }, { $set: { nickname: entry.nickname ?? null } }, { upsert: true });
});

// guilds
await run("guilds", async () => {
    const councilCache = new Set<string>();

    for (const entry of await src["TCN-api"].guilds.find().toArray()) {
        councilCache.add(`${entry.id}/${entry.owner}`);
        if (entry.advisor) councilCache.add(`${entry.id}/${entry.advisor}`);

        await db.guilds.updateOne(
            { id: entry.id },
            {
                $set: {
                    name: entry.name,
                    mascot: entry.character,
                    invite: entry.invite,
                    owner: entry.owner,
                    advisor: entry.advisor ?? null,
                    voter: entry.voter === entry.advisor ? entry.voter : entry.owner,
                    delegated: entry.voter === entry.advisor,
                },
            },
            { upsert: true },
        );
    }

    for (const entry of await src["TCN-api"].users.find().toArray())
        if (entry.id)
            for (const id of entry.guilds)
                if (!councilCache.has(`${id}/${entry.id}`))
                    await db.guilds.updateOne({ id }, { $set: { [`users.${entry.id}`]: { staff: true, roles: ["banshares"] } } }, { upsert: false });
});

// invalidations
("nothing to import");

// observation_records
await run("observation_records", async () => {
    await db.counters.deleteOne({ sequence: "observation-records" });

    for (const entry of await src["TCN-site"].observation_schedule.find().toArray())
        await db.observation_records.insertOne({
            uuid: await autoinc("observation-records"),
            id: entry.guild,
            hidden: false,
            name: (await src["TCN-site"].guild_map.findOne({ id: entry.guild }))?.name ?? null,
            observer: entry.observer ?? null,
            start:
                entry.start_year && entry.start_month && entry.start_date
                    ? new Date(entry.start_year, entry.start_month - 1, entry.start_date).getTime()
                    : null,
            end: entry.end_year && entry.end_month && entry.end_date ? new Date(entry.end_year, entry.end_month - 1, entry.end_date).getTime() : null,
            status: entry.result,
            notes: entry.notes ?? "",
        });
});

// polls
await run("polls", async () => {
    for (const entry of await src["TCN-site"].polls.find().toArray())
        await db.polls.updateOne(
            { id: entry.id },
            {
                $set: {
                    message: entry.message,
                    close: entry.close.getTime(),
                    closed: entry.closed,
                    duration: entry.duration,
                    dm: entry.dm,
                    live: entry.live,
                    restricted: entry.restricted,
                    quorum: entry.quorum,
                    mode: entry.mode,
                    question: entry.mode === "proposal" || entry.mode === "selection" ? entry.question : null,
                    preinduct: entry.mode === "induction" ? entry.preinduct : null,
                    server: entry.mode === "induction" ? entry.server : null,
                    wave: entry.mode === "election" ? entry.wave ?? +entry.question.match(/\d+/)![0] : null,
                    seats: entry.mode === "election" ? entry.seats : null,
                    candidates: entry.mode === "election" ? entry.candidates : null,
                    min: entry.mode === "selection" ? entry.min : null,
                    max: entry.mode === "selection" ? entry.max : null,
                    options: entry.mode === "selection" ? entry.options : null,
                },
            },
            { upsert: true },
        );
});

// ratelimit
("nothing to import");

// rolesync
await run("rolesync", async () => {
    for (const entry of await src["TCN-manager"].autoroles.find().toArray()) {
        await db.rolesync.updateOne(
            { guild: entry.guild },
            { $setOnInsert: { roleToStaff: [], staffToRole: [], roleToApi: {}, apiToRole: [] } },
            { upsert: true },
        );

        if (entry.type === 0) {
            if ((await src["TCN-api"].guilds.countDocuments({ id: entry.api })) > 0)
                await db.rolesync.updateOne(
                    { guild: entry.guild, "apiToRole.guild": { $ne: entry.api } },
                    {
                        $push: {
                            apiToRole: { type: "position", value: entry.meta?.councilOnly ? "council" : "staff", guild: entry.api, roles: [entry.discord] },
                        },
                    },
                    { upsert: false },
                );
        } else if (entry.type === 1)
            await db.rolesync.updateOne(
                { guild: entry.guild, "apiToRole.value": { $ne: entry.api } },
                { $push: { apiToRole: { type: "role", value: entry.api, guild: undefined, roles: [entry.discord] } } },
                { upsert: false },
            );
        else if (entry.type === 2) await db.rolesync.updateOne({ guild: entry.guild }, { $addToSet: { roleToStaff: entry.discord } }, { upsert: false });
        else if (entry.type === 3) "nothing to import";
    }
});

// users
await run("users", async () => {
    for (const entry of await src["TCN-api"].users.find().toArray())
        if (entry.id)
            await db.users.updateOne(
                { id: entry.id },
                {
                    $set: {
                        observer: entry.roles.includes("observer"),
                        observerSince: entry.roles.includes("observer")
                            ? ((e: any) => (e ? new Date(e.year, e.month - 1, e.date, 12, 0, 0).getTime() : 0))(
                                  await src["TCN-site"].observer_terms.findOne({ user: entry.id }),
                              )
                            : 0,
                        roles: entry.roles.filter((x: string) => ["developer"].includes(x)),
                    },
                },
                { upsert: true },
            );
});

// vote_records
await run("vote_records", async () => {
    for (const entry of await src["TCN-site"].polls.find().toArray()) {
        await db.vote_records.deleteMany({ id: entry.id });
        const voters = new Set<string>((await src["TCN-site"].poll_votes.find({ poll: entry.id }).toArray()).map((x: any) => x.user));
        await db.vote_records.insertMany(entry.required.map((user: string) => ({ id: entry.id, user, voted: voters.has(user) })));
    }
});

// votes
await run("votes", async () => {
    const pollCache: Record<number, any> = Object.fromEntries((await src["TCN-site"].polls.find().toArray()).map((poll: any) => [poll.id, poll]));

    for (const entry of await src["TCN-site"].poll_votes.find().toArray())
        if (pollCache[entry.poll])
            await db.votes.updateOne(
                { poll: entry.poll, user: entry.user },
                {
                    $set: {
                        mode: pollCache[entry.poll].mode,
                        abstain: entry.abstain ?? false,
                        yes: entry.yes ?? undefined,
                        verdict: entry.verdict ? { "induct-now": "induct", "induct-later": "preinduct" }[entry.verdict as string] ?? entry.verdict : undefined,
                        candidates:
                            pollCache[entry.poll].mode === "election" && !entry.abstain
                                ? Object.fromEntries([
                                      ...pollCache[entry.poll].candidates.map((x: string) => [x, 0]),
                                      ...(entry.countered ?? []).map((x: string) => [x, -1]),
                                      ...entry.rankings.map((x: string, i: number) => [x, i + 1]),
                                  ])
                                : undefined,
                        selected: entry.selected ?? undefined,
                    },
                },
                { upsert: true },
            );
});

logger.info("DONE!");
process.exit(0);
