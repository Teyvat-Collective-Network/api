import { Collection, Db, Document } from "mongodb";
import db, { client } from "./lib/db.js";

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
for (const type of ["weapon", "element", "region"])
    for (const item of await src["TCN-site"][`${type}s`].find().toArray())
        await db.attributes.updateOne(
            { type, id: item.name },
            { $set: { name: `${item.name[0].toUpperCase()}${item.name.slice(1)}`, emoji: item.emoji } },
            { upsert: true },
        );

// audit_logs
("nothing to import");

// autosync
for (const entry of await src["TCN-manager"].partnerlists.find().toArray())
    if (entry.instances.length !== 1) throw `[autosync] entry for ${entry.guild} does not have one instance`;
    else
        await db.autosync.updateOne(
            { guild: entry.guild },
            {
                $set: {
                    template: entry.template || undefined,
                    ...Object.fromEntries(Object.entries(entry).filter(([x]) => ["channel", "webhook", "message", "repost"].includes(x))),
                },
            },
            { upsert: true },
        );

// banshare_settings
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
                publisher: undefined, // this is not tracked in the old version
                rejecter: undefined, // this is not tracked in the old version
                rescinder: undefined, // this is not tracked in the old version
                explanation: undefined, // this is not tracked in the old version
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

for (const entry of await src["TCN-banshare"].executed.find().toArray()) {
}

// characters

// counters

// deleted_banshares

// docs

// election_history

// election_history_waves

// events

// global_channels

// global_connections

// global_filter

// global_messages

// global_users

// guilds

// invalidations

// observation_records

// polls

// ratelimit

// rolesync
for (const entry of await src["TCN-manager"].autoroles.find({ type: 0 }).toArray()) {
    const tl = { type: "position", value: "staff", guild: entry.guild, roles: [entry.discord] };
}

// users

// vote_records

// votes
