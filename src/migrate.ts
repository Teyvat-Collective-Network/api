import { ChannelType, Client, Events } from "discord.js";
import { Collection, Db, Document } from "mongodb";
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
        get(_, property: string): Record<string, Collection<Document>> {
            cache[property] ??= client.db(property);

            return new Proxy(
                {},
                {
                    get(_, property: string): Collection<Document> {
                        return cache[property].collection(property);
                    },
                },
            );
        },
    },
) as Record<string, Record<string, Collection<Document>>>;

// attributes
logger.info("replicating attributes...");
for (const type of ["weapon", "element", "region"])
    for (const item of await src["TCN-site"][`${type}s`].find().toArray())
        await db.attributes.updateOne(
            { type, id: item.name },
            { $set: { name: `${item.name[0].toUpperCase()}${item.name.slice(1)}`, emoji: item.emoji } },
            { upsert: true },
        );

// audit_logs
logger.info("replicating audit_logs");
("nothing to import");

// autosync
logger.info("replicating autosync");
for (const entry of await src["TCN-manager"].partnerlists.find().toArray())
    if (entry.instances.length !== 1) throw `[autosync] entry for ${entry.guild} does not have one instance`;
    else
        await db.autosync.updateOne(
            { guild: entry.guild },
            {
                $set: {
                    ...(entry.template ? { template: entry.template } : {}),
                    ...Object.fromEntries(Object.entries(entry).filter(([x]) => ["channel", "webhook", "message", "repost"].includes(x))),
                },
            },
            { upsert: true },
        );

// banshare_settings
logger.info("replicating banshare_settings");
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

// banshares
logger.info("replicating banshares");
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
                author: entry.user ?? `1${"0".repeat(19)}`,
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

// characters
logger.info("replicating characters");
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

// counters
logger.info("replicating counters");
const entry = await src["TCN-site"].counters.findOne({ seq: "polls" });
if (entry) await db.counters.updateOne({ sequence: "polls" }, { $set: { value: entry.val } }, { upsert: true });

await db.counters.updateOne({ sequence: "global-channels" }, { $set: { value: 3 } }, { upsert: true });

// deleted_banshares
logger.info("replicating deleted_banshares");
("nothing to import");

// docs
logger.info("replicating docs");
for (const entry of await src["TCN-site"].docs.find().toArray())
    await db.docs.updateOne(
        { id: entry.id },
        {
            $set: {
                official: entry.official,
                deleted: entry.deleted,
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
                embedColor: entry.embed_color,
                embedImage: entry.embed_image ?? "",
                embedThumbnail: entry.thumbnail ?? false,
            },
        },
        { upsert: true },
    );

// election_history
// election_history_waves
logger.info("replicating election_history & election_history_waves");
await db.election_history.deleteMany();
await db.election_history_waves.deleteMany();

await Promise.all(
    (await src["TCN-site"].election_history.find().toArray()).reverse().map(async (x, i) => {
        const wave = i + 1;

        await db.election_history_waves.insertOne({ wave, seats: x.seats });
        for (const user of x.candidates) await db.election_history.insertOne({ wave, id: user.id, status: user.status, rerunning: user.rerunning ?? false });
    }),
);

// events
logger.info("replicating events");
("voluntarily not importing");

// global_channels
// global_connections
logger.info("replicating global_channels & global_connections");
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

// global_filter
logger.info("replicating global_filter");
for (const filename of ["offensive", "other", "sexual", "slurs"]) {
    const req = await fetch(`https://raw.githubusercontent.com/Teyvat-Collective-Network/relay-bot/main/filter/${filename}.txt`);
    const res = await req.text();

    const items = res
        .split(/\n+/)
        .map((x) => x.trim())
        .filter((x) => x)
        .map((x) => x.split(";")[0]);

    for (const item of items)
        if ((await db.global_filter.countDocuments({ match: item })) > 0)
            await db.global_filter.insertOne({
                id: await autoinc("global/filter"),
                match: item,
                user: "1".repeat(18),
                created: Date.now(),
                lastUpdated: Date.now(),
            });
}

// global_messages
logger.info("replicating global_messages");
const globalChannelToIDCache: Record<string, number> = {};

async function getGCID(message: { original: { channel: string }; mirrors: { channel: string }[] }) {
    const map: Record<number, number> = {};

    for (const channel of [message.original.channel, ...message.mirrors.map((x) => x.channel)]) {
        const id = (globalChannelToIDCache[channel] ??= (await db.global_connections.findOne({ channel }))?.id ?? 0);
        map[id] = (map[id] ?? 0) + 1;
    }

    return +(Object.entries(map).sort(([, x], [, y]) => y - x)[0]?.[0] ?? 0);
}

for (const entry of await src["TCN-relay"].messages.find().toArray()) {
    const id = await getGCID(entry as any);
    if (id === 0) continue;

    await db.global_messages.updateOne(
        { message: entry.original.message },
        {
            $set: {
                id,
                author: entry.author,
                channel: entry.original.channel,
                ...(entry.purged ? { deleted: true } : {}),
                instances: entry.mirrors.map((x: any) => ({ channel: x.channel, message: x.message })),
            },
        },
        { upsert: true },
    );
}

// global_users
logger.info("replicating global_users");
for (const entry of await src["TCN-relay"].users.find().toArray())
    await db.global_users.updateOne({ id: entry.user }, { $set: { nickname: entry.nickname ?? null } }, { upsert: true });

// guilds
logger.info("replicating guilds");
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

// invalidations
logger.info("replicating invalidations");
("nothing to import");

// observation_records
logger.info("replicating observation_records");
await db.counters.deleteOne({ sequence: "observation-records" });
await db.observation_records.deleteMany();

for (const entry of await db.observation_schedule.find().toArray())
    await db.observation_records.insertOne({
        uuid: await autoinc("observation-records"),
        id: entry.guild,
        hidden: false,
        name: null,
        observer: entry.observer ?? null,
        start: entry.start_year && entry.start_month && entry.start_date ? new Date(entry.start_year, entry.start_month - 1, entry.start_date).getTime() : null,
        end: entry.end_year && entry.end_month && entry.end_date ? new Date(entry.end_year, entry.end_month - 1, entry.end_date).getTime() : null,
        status: entry.result,
    });

// polls
logger.info("replicating polls");
for (const entry of await db.polls.find().toArray())
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
                wave: entry.mode === "election" ? entry.wave : null,
                seats: entry.mode === "election" ? entry.seats : null,
                candidates: entry.mode === "election" ? entry.candidates : null,
                min: entry.mode === "selection" ? entry.min : null,
                max: entry.mode === "selection" ? entry.max : null,
                options: entry.mode === "selection" ? entry.options : null,
            },
        },
        { upsert: true },
    );

// ratelimit
logger.info("replicating ratelimit");
("nothing to import");

// rolesync
logger.info("replicating rolesync");
for (const entry of await src["TCN-manager"].autoroles.find().toArray()) {
    await db.rolesync.updateOne({ guild: entry.guild }, { $setOnInsert: { roleToStaff: [], staffToRole: [], roleToApi: {}, apiToRole: [] } }, { upsert: true });

    if (entry.type === 0)
        await db.rolesync.updateOne(
            { guild: entry.guild, "apiToRole.guild": { $ne: entry.api } },
            { $push: { apiToRole: { type: "position", value: entry.meta?.councilOnly ? "council" : "staff", guild: entry.api, roles: [entry.discord] } } },
            { upsert: false },
        );
    else if (entry.type === 1)
        await db.rolesync.updateOne(
            { guild: entry.guild, "apiToRole.value": { $ne: entry.api } },
            { $push: { type: "role", value: entry.api, guild: undefined, roles: [entry.discord] } },
            { upsert: false },
        );
    else if (entry.type === 2) await db.rolesync.updateOne({ guild: entry.guild }, { $addToSet: { roleToStaff: entry.discord } }, { upsert: false });
    else if (entry.type === 3) "nothing to import";
}

// users
logger.info("replicating users");
for (const entry of await src["TCN-api"].users.find().toArray())
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

// vote_records
logger.info("replicating vote_records");
for (const entry of await src["TCN-site"].polls.find().toArray()) {
    await db.vote_records.deleteMany({ id: entry.id });
    const voters = new Set<string>((await src["TCN-site"].poll_votes.find({ poll: entry.id }).toArray()).map((x: any) => x.user));
    await db.vote_records.insertMany(entry.required.map((user: string) => ({ id: entry.id, user, voted: voters.has(user) })));
}

// votes
logger.info("replicating votes");
const pollCache: Record<number, any> = (await db.polls.find().toArray()).map((poll: any) => [poll.id, poll]);

for (const entry of await src["TCN-site"].poll_votes.find().toArray())
    if (pollCache[entry.id])
        await db.votes.updateOne(
            { poll: entry.id, user: entry.user },
            {
                $set: {
                    mode: pollCache[entry.id].mode,
                    abstain: entry.abstain ?? false,
                    yes: entry.yes ?? undefined,
                    verdict: entry.verdict ? { "induct-now": "induct", "induct-later": "preinduct" }[entry.verdict as string] ?? entry.verdict : undefined,
                    candidates:
                        pollCache[entry.id].mode === "election" && !entry.abstain
                            ? Object.fromEntries([
                                  ...pollCache[entry.id].candidates.map((x: string) => [x, 0]),
                                  ...(entry.countered ?? []).map((x: string) => [x, -1]),
                                  ...entry.rankings.map((x: string, i: number) => [x, i + 1]),
                              ])
                            : undefined,
                },
            },
            { upsert: true },
        );