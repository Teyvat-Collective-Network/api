import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { AuditLogAction, headers } from "../../lib/audit.js";
import { checkBansharePermissions, checkChannel, checkOwnership, formatBanshareSettings } from "../../lib/banshares.js";
import bot from "../../lib/bot.js";
import { hasScope, isCouncil, isObserver, isSignedIn, ratelimitApply, ratelimitCheck } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import data from "../../lib/data.js";
import db, { withSession } from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { Banshare, BanshareSettings } from "../../lib/types.js";
import { changes, trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/banshares", (app) =>
        app
            .post(
                "/",
                async ({ bearer, body, user }) => {
                    const { ids, reason, evidence, server, severity, urgent, skipValidation, skipChecks } = body;

                    const guild = user!.guilds[server];

                    if (!guild || !(guild.owner || guild.advisor || (guild.staff && guild.roles.includes("banshares"))))
                        throw new APIError(403, codes.FORBIDDEN, "You do not have permissions to submit banshares from that server.");

                    if (!skipChecks && !ids.match(/^\s*([1-9][0-9]{16,19}\s+)*[1-9][0-9]{16,19}\s*$/))
                        throw new APIError(
                            400,
                            codes.INVALID_BODY,
                            "ID field must be a whitespace-separated list of user IDs (or submit without checks if needed).",
                        );

                    if (!["P0", "P1", "P2", "DM"].includes(severity)) throw new APIError(400, codes.INVALID_BODY, "Severity must be one of P0, P1, P2, or DM.");

                    let idList: string[] = [];
                    if (!skipChecks) idList = ids.trim().split(/\s+/);
                    if (idList.includes(user!.id)) throw new APIError(400, codes.INVALID_BODY, "You cannot banshare yourself.");

                    if (`${evidence} ${reason}`.match(/cdn\.discordapp\.com|media\.discordapp\.net/))
                        throw new APIError(400, codes.INVALID_BODY, "Discord media links are not allowed.");

                    const serverName = (await data.getGuild(server)).name;

                    const req = await bot(bearer!, `!POST /banshares`, {
                        author: user!.id,
                        ids,
                        idList,
                        reason,
                        evidence,
                        severity,
                        urgent,
                        skipValidation,
                        serverName,
                    });
                    const { message } = await req.json();

                    if (req.status === 400) throw new APIError(400, codes.INVALID_BODY, message);
                    if (req.status === 500) throw new APIError(500, codes.INTERNAL_SERVER_ERROR, "An unexpected error occurred.");

                    const now = Date.now();

                    const createData = {
                        message,
                        status: "pending",
                        urgent,
                        ids,
                        idList,
                        reason,
                        evidence,
                        server,
                        severity,
                        author: user!.id,
                        created: now,
                        reminded: now,
                    };

                    await db.banshares.insertOne(createData);

                    audit(user, AuditLogAction.BANSHARES_CREATE, createData, reason);

                    return { message };
                },
                {
                    beforeHandle: [isSignedIn, hasScope("banshares/create"), ratelimitCheck("post-banshare", 60000, 2)],
                    afterHandle: [ratelimitApply("post-banshare")],
                    body: schemas.banshareCreate,
                    detail: {
                        tags: ["V1"],
                        summary: "Create a banshare.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/create
                            \`\`\`

                            Create a banshare, which posts it to HQ for review. This can only be done by staff members with the \`banshares\` guild role or by
                            server owners and council advisors.
                        `),
                    },
                    response: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                    }),
                },
            )
            .get(
                "/:message",
                async ({ internal, params: { message }, user }) => {
                    const entry = (await db.banshares.findOne({ message })) as unknown as Banshare;

                    if (
                        !entry ||
                        (!internal &&
                            !user!.council &&
                            entry.author !== user!.id &&
                            !(
                                ["published", "rescinded"].includes(entry.status) &&
                                Object.values(user!.guilds).some((x) => x.staff && x.roles.includes("banshares"))
                            ))
                    )
                        throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    for (const key of ["crossposts", "executors", "reports"]) if (key in entry) delete (entry as any)[key];
                    if (!user!.observer) for (const key of ["publisher", "rejecter", "rescinder"] as const) entry[key] &&= `1${"0".repeat(19)}`;

                    return entry;
                },
                {
                    beforeHandle: [isSignedIn, hasScope("banshares/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get a banshare.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/read
                            \`\`\`

                            Get a banshare from its message ID. This can only be done by the author and council members if the banshare is pending or rejected
                            and additionally staff with the \`banshares\` role if the banshare is published or rescinded and will return a 404 if access is
                            denied. The publisher, rejecter, and rescinder IDs will be set to \`100...\` if this request is issued by a non-observer.
                        `),
                    },
                    params: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                    }),
                    response: schemas.banshareResponse,
                },
            )
            .get(
                "/:message/crossposts/:guild",
                async ({ params: { message, guild } }) => {
                    const entry = await db.banshares.findOne({ message });
                    if (!entry) throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    const item = entry?.crossposts?.find((post: any) => post.guild === guild);
                    if (!item) throw new APIError(404, codes.MISSING_CROSSPOST, "This banshare has not been crossposted to the guild.");

                    return { channel: item.channel, message: item.message };
                },
                {
                    beforeHandle: [isSignedIn, hasScope("banshares/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get the crosspost location for a banshare in a guild.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/read
                            \`\`\`

                            Get the crosspost message information for a banshare. This can only be done by 
                        `),
                    },
                    params: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                        guild: schemas.snowflake("The ID of the guild for which to fetch the crosspost."),
                    }),
                    response: t.Object({
                        channel: schemas.snowflake("The ID of the channel of the crosspost."),
                        message: schemas.snowflake("The ID of the crosspost message."),
                    }),
                },
            )
            .patch(
                "/:message/severity/:severity",
                async ({ bearer, params: { message, severity }, user }) => {
                    if (!["P0", "P1", "P2", "DM"].includes(severity)) throw new APIError(400, codes.INVALID_BODY, "Severity must be one of P0, P1, P2, or DM.");

                    if ((await db.banshares.countDocuments({ message })) === 0)
                        throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    const doc = await db.banshares.findOneAndUpdate({ message, status: "pending" }, { $set: { severity } });
                    if (!doc) throw new APIError(400, codes.INVALID_STATE, "That banshare is no longer pending.");
                    if (doc.severity === severity) throw new APIError(400, codes.NOT_MODIFIED, "No changes were made.");

                    try {
                        await bot(bearer!, `PATCH /banshares/${message}/severity/${severity}`);
                    } catch (error) {
                        await db.banshares.updateOne({ message }, { $set: { severity: doc.severity } });
                        throw error;
                    }

                    audit(user, AuditLogAction.BANSHARES_SEVERITY, { message, changes: { severity: [doc.severity, severity] } });
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("banshares/manage"), ratelimitCheck("edit-banshare", 3000, 2)],
                    afterHandle: [ratelimitApply("edit-banshare")],
                    detail: {
                        tags: ["V1"],
                        summary: "Change the severity of a banshare.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/manage
                            \`\`\`

                            Edit the severity of a banshare. The banshare must be pending.
                        `),
                    },
                    params: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                        severity: t.String({ description: "The new severity (P0, P1, P2, or DM)." }),
                    }),
                },
            )
            .post(
                "/:message/reject",
                async ({ bearer, params: { message }, user }) => {
                    if ((await db.banshares.countDocuments({ message })) === 0)
                        throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    const doc = await db.banshares.findOneAndUpdate({ message, status: "pending" }, { $set: { status: "rejected", rejecter: user!.id } });
                    if (!doc) throw new APIError(400, codes.INVALID_STATE, "That banshare is no longer pending.");

                    try {
                        await bot(bearer!, `POST /banshares/${message}/reject`);
                    } catch (error) {
                        await db.banshares.updateOne({ message }, { $set: { status: "pending" } });
                        throw error;
                    }

                    audit(user, AuditLogAction.BANSHARES_REJECT, { message });
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("banshares/manage"), ratelimitCheck("edit-banshare", 3000, 2)],
                    afterHandle: [ratelimitApply("edit-banshare")],
                    detail: {
                        tags: ["V1"],
                        summary: "Reject a banshare.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/manage
                            \`\`\`

                            Reject a banshare. The banshare must be pending.
                        `),
                    },
                    params: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                    }),
                },
            )
            .post(
                "/:message/publish",
                async ({ bearer, params: { message }, user }) => {
                    if ((await db.banshares.countDocuments({ message })) === 0)
                        throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    const doc = await db.banshares.findOneAndUpdate({ message, status: "pending" }, { $set: { status: "published", publisher: user!.id } });
                    if (!doc) throw new APIError(400, codes.INVALID_STATE, "That banshare is no longer pending.");

                    try {
                        await bot(bearer!, `POST /banshares/${message}/publish`);
                    } catch (error) {
                        await db.banshares.updateOne({ message }, { $set: { status: "pending" }, $unset: { publisher: 0 } });
                        throw error;
                    }

                    audit(user, AuditLogAction.BANSHARES_PUBLISH, { message });
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("banshares/manage"), ratelimitCheck("edit-banshare", 3000, 2)],
                    afterHandle: [ratelimitApply("edit-banshare")],
                    detail: {
                        tags: ["V1"],
                        summary: "Publish a banshare.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/manage
                            \`\`\`

                            Publish a banshare. The banshare must be pending. This will trigger all publish-based actions, including autobanning.
                        `),
                    },
                    params: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                    }),
                },
            )
            .post(
                "/:message/rescind",
                async ({ bearer, body: { explanation }, params: { message }, user }) => {
                    if ((await db.banshares.countDocuments({ message })) === 0)
                        throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    const doc = await db.banshares.findOneAndUpdate(
                        { message, status: "published" },
                        { $set: { status: "rescinded", rescinder: user!.id, explanation } },
                    );

                    if (!doc) throw new APIError(400, codes.INVALID_STATE, "That banshare has already been rescinded.");

                    try {
                        await bot(bearer!, `POST /banshares/${message}/rescind`);
                    } catch (error) {
                        await db.banshares.updateOne({ message }, { $set: { status: "published" }, $unset: { rescinder: 0, explanation: 0 } });
                        throw error;
                    }

                    audit(user, AuditLogAction.BANSHARES_RESCIND, { message }, explanation);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("banshares/manage"), ratelimitCheck("edit-banshare", 3000, 2)],
                    afterHandle: [ratelimitApply("edit-banshare")],
                    body: t.Object({
                        explanation: t.String({
                            minLength: 1,
                            maxLength: 1800,
                            description: "Why the banshare is being rescinded and any further explanation.",
                            error: "Banshare rescind explanation must be 1-1800 characters.",
                        }),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Rescind a banshare.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/manage
                            \`\`\`

                            Rescind a banshare. The banshare must be published.
                        `),
                    },
                    params: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                    }),
                },
            )
            .post(
                "/:message/execute/:guild",
                async ({ bearer, params: { message, guild }, query, user }) => {
                    if ((await db.banshares.countDocuments({ message })) === 0)
                        throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    const auto = query.auto === "true";

                    if (!auto && (await db.banshare_settings.countDocuments({ guild, nobutton: true })) > 0)
                        throw new APIError(400, codes.FEATURE_DISABLED, `This guild has disabled the ban button setting.`);

                    const doc = await db.banshares.findOneAndUpdate(
                        { message, status: "published", [`executors.${guild}`]: { $exists: false } },
                        { $set: { [`executors.${guild}`]: user!.id } },
                    );

                    if (!doc) throw new APIError(400, codes.INVALID_STATE, "That banshare is already executed or was rescinded.");

                    if (!auto)
                        try {
                            await bot(bearer!, `POST /banshares/${message}/execute/${guild}`);
                        } catch (error) {
                            await db.banshares.updateOne({ message }, { $unset: { [`executors.${guild}`]: 0 } });
                            throw error;
                        }

                    audit(user, AuditLogAction.BANSHARES_EXECUTE, { auto, message, guild });
                },
                {
                    beforeHandle: [isSignedIn, checkBansharePermissions, hasScope("banshares/execute"), ratelimitCheck("edit-banshare", 3000, 2)],
                    afterHandle: [ratelimitApply("edit-banshare")],
                    detail: {
                        tags: ["V1"],
                        summary: "Execute a banshare.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/execute
                            \`\`\`

                            Trigger execution of a banshare within a guild. This operation is only available to observers, the owner and council member of the
                            server, and staff members with the \`banshares\` role (if the operation is triggered from the bot, this is overridden as the bot
                            performs a Discord permission check). The banshare must not be rescinded. The server must have the ban button feature enabled.
                        `),
                    },
                    params: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                        guild: schemas.snowflake("The ID of the guild in which to execute the banshare."),
                    }),
                    query: t.Object({
                        auto: t.Optional(t.String({ description: "If true, marks the execution as an autoban action. Observer-only." })),
                    }),
                },
            )
            .get(
                "/settings/:guild",
                async ({ params: { guild } }) => {
                    const entry = ((await db.banshare_settings.findOne({ guild })) ?? { guild }) as unknown as Partial<BanshareSettings>;
                    return formatBanshareSettings(entry);
                },
                {
                    beforeHandle: [isSignedIn, checkBansharePermissions, hasScope("banshares/settings")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get the banshare settings in a guild.",
                        description: trim(`
                        \`\`\`
                        Scope: banshares/settings
                        \`\`\`

                        Get the banshare settings in a guild. Restricted to observers, the owner, the advisor, and staff with the \`banshares\` role.
                    `),
                    },
                    params: t.Object({
                        guild: schemas.snowflake("The ID of the guild for which to fetch settings."),
                    }),
                    response: schemas.banshareSettingsResponse,
                },
            )
            .patch(
                "/settings/:guild",
                async ({ bearer, body, internal, params: { guild }, user }) => {
                    await checkChannel(bearer!, internal, guild, body.channel as string);

                    let old: any;
                    let doc: Partial<BanshareSettings>;

                    await withSession(async () => {
                        old = await db.banshare_settings.findOneAndUpdate({ guild }, { $set: body }, { upsert: true });
                        doc = (await db.banshare_settings.findOne({ guild })) as unknown as Partial<BanshareSettings>;
                    }).catch(() => {
                        throw new APIError(500, codes.INTERNAL_SERVER_ERROR, "An error occurred saving your settings.");
                    });

                    audit(user, AuditLogAction.BANSHARES_SETTINGS, { guild, changes: changes(old, body) });
                    return formatBanshareSettings(doc!);
                },
                {
                    beforeHandle: [isSignedIn, checkOwnership, hasScope("banshares/settings")],
                    body: t.Object(Object.fromEntries(Object.entries(schemas.banshareSettings.properties).map(([x, y]) => [x, t.Optional(y)]))),
                    detail: {
                        tags: ["V1"],
                        summary: "Update settings for banshares in a guild.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/settings
                            \`\`\`

                            Update settings for banshares in a guild. Observer/owner-only. If specified, the channel will be checked to ensure it is of a valid
                            type and is in the target guild.
                        `),
                    },
                    params: t.Object({
                        guild: schemas.snowflake("The ID of the guild in which to apply this."),
                    }),
                    response: schemas.banshareSettingsResponse,
                },
            )
            .get(
                "/settings/logs/:guild",
                async ({ params: { guild } }) => {
                    const doc = await db.banshare_settings.findOne({ guild });
                    return doc?.logs ?? [];
                },
                {
                    beforeHandle: [isSignedIn, checkOwnership, hasScope("banshares/settings")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get all logging channels for banshares in a guild.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/settings
                            \`\`\`

                            Get all logging channels for banshares in a guild. Observer/owner-only.
                        `),
                    },
                    params: t.Object({
                        guild: schemas.snowflake("The ID of the guild for which to fetch logging channels."),
                    }),
                    response: t.Array(schemas.snowflake(), { description: "An array of channel IDs. These are not necessarily valid." }),
                },
            )
            .put(
                "/settings/logs/:guild/:channel",
                async ({ bearer, internal, params: { guild, channel }, user }) => {
                    await checkChannel(bearer!, internal, guild, channel);

                    const doc = (await db.banshare_settings.findOne({ guild })) as any;

                    if (doc?.logs?.includes(channel)) throw new APIError(409, codes.DUPLICATE, "That channel is already a log channel in this guild.");
                    if (doc?.logs && doc.logs.length >= 10) throw new APIError(409, codes.LIMIT_REACHED, "Each guild may only have 10 log channels.");

                    await db.banshare_settings.updateOne({ guild }, { $addToSet: { logs: channel } as any }, { upsert: true });
                    audit(user, AuditLogAction.BANSHARES_LOGS_ADD, { guild, channel });
                },
                {
                    beforeHandle: [isSignedIn, checkOwnership, hasScope("banshares/settings")],
                    detail: {
                        tags: ["V1"],
                        summary: "Add a logging channel for banshares in a guild.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/settings
                            \`\`\`

                            Add a logging channel for banshares in a guild. Observer/owner-only. The channel will be checked to ensure it is of a valid type and
                            is in the target guild.
                        `),
                    },
                    params: t.Object({
                        guild: schemas.snowflake("The ID of the guild in which to add the logging channel."),
                        channel: schemas.snowflake("The ID of the channel to add as a logging channel."),
                    }),
                },
            )
            .delete(
                "/settings/logs/:guild/:channel",
                async ({ params: { guild, channel }, user }) => {
                    const doc = (await db.banshare_settings.findOne({ guild })) as any;

                    if (!doc?.logs?.includes(channel)) throw new APIError(404, codes.NOT_FOUND, "That channel is not a log channel in this guild.");

                    await db.banshare_settings.updateOne({ guild }, { $pull: { logs: channel } as any });
                    audit(user, AuditLogAction.BANSHARES_LOGS_REMOVE, { guild, channel });
                },
                {
                    beforeHandle: [isSignedIn, checkOwnership, hasScope("banshares/settings")],
                    detail: {
                        tags: ["V1"],
                        summary: "Remove a logging channel for banshares from a guild.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/settings
                            \`\`\`

                            Remove a logging channel for banshares from a guild. Observer/owner-only.
                        `),
                    },
                    params: t.Object({
                        guild: schemas.snowflake("The ID of the guild in which to remove the logging channel."),
                        channel: schemas.snowflake("The ID of the channel to remove as a logging channel."),
                    }),
                },
            )
            .get(
                "/guilds",
                async () => {
                    return ((await db.banshare_settings.find().toArray()) as unknown[] as BanshareSettings[]).map((x) => formatBanshareSettings(x));
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("banshares/manage")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get all guilds' settings.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/manage
                            \`\`\`

                            Get all guilds' settings. Observer-only.
                        `),
                    },
                    response: t.Array(schemas.banshareSettingsResponse),
                },
            )
            .get(
                "/:message/crossposts",
                async ({ params: { message } }) => {
                    const entry = await db.banshares.findOne({ message });
                    if (!entry) throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    return entry.crossposts ?? [];
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("banshares/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get crossposts.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/read
                            \`\`\`

                            Return all crossposts for a given banshare.
                        `),
                    },
                    params: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                    }),
                    response: t.Array(
                        t.Object({
                            guild: schemas.snowflake("The ID of the guild of this crosspost."),
                            channel: schemas.snowflake("The ID of the channel containing this crosspost."),
                            message: schemas.snowflake("The ID of the crosspost message."),
                        }),
                    ),
                },
            )
            .put(
                "/:message/crossposts",
                async ({ body: { crossposts }, params: { message }, user }) => {
                    const doc = await db.banshares.findOneAndUpdate({ message }, { $push: { crossposts: { $each: crossposts } } as any });
                    if (!doc) throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    audit(user, AuditLogAction.BANSHARES_CROSSPOST, { message, crossposts });
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("banshares/manage")],
                    body: t.Object({
                        crossposts: t.Array(
                            t.Object({
                                guild: schemas.snowflake("The ID of a guild that received this banshare."),
                                channel: schemas.snowflake("The ID of the channel to which this banshare was sent."),
                                message: schemas.snowflake("The message ID of the crosspost."),
                            }),
                        ),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Register crossposts.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/manage
                            \`\`\`

                            Register crossposts from a banshare publication. Observer-only. This endpoint should, in most situations, only ever be triggered
                            via the bot.
                        `),
                    },
                    params: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                    }),
                },
            )
            .get(
                "/pending",
                async () => {
                    return (await db.banshares.find({ status: "pending" }).toArray()).map((x) => x.message);
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("banshares/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get a list of pending banshares (message IDs).",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/read
                            \`\`\`

                            Get the list of all pending banshares (returns their message IDs). Council-only.
                        `),
                    },
                    response: t.Array(schemas.snowflake(), { description: "An array of message IDs." }),
                },
            )
            .delete(
                "/:message",
                async ({ params: { message }, reason, user }) => {
                    const doc = await db.banshares.findOneAndDelete({ message });
                    if (!doc) throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    await db.deleted_banshares.insertOne(doc);
                    audit(user, AuditLogAction.BANSHARES_DELETE, doc, reason);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("banshares/manage")],
                    detail: {
                        tags: ["V1"],
                        summary: "Delete a banshare from the API.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/manage
                            \`\`\`

                            Delete a banshare from the API. Observer-only. This should **only be done** if the message itself was deleted first. Banshares
                            should not be deleted and should instead be rejected where possible.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({
                        message: schemas.snowflake("The ID of the message of the banshare."),
                    }),
                },
            )
            .post(
                "/report/:message",
                async ({ bearer, body: { reason }, internal, params: { message }, user }) => {
                    if (!internal && !user!.council && !Object.values(user!.guilds).some((x) => x.staff && x.roles.includes("banshares")))
                        throw new APIError(403, codes.FORBIDDEN, "You must be a council member or a staff with the banshares role to access this route.");

                    const doc = await db.banshares.findOneAndUpdate({ message }, { $push: { reports: { reporter: user!.id, reason } } as any });
                    if (!doc) throw new APIError(404, codes.MISSING_BANSHARE, `No banshare exists with message ID ${message}.`);

                    await bot(bearer!, `POST /banshares/${message}/report`, { user: user!.id, reason });
                    audit(user, AuditLogAction.BANSHARES_REPORT, { message }, reason);
                },
                {
                    beforeHandle: [isSignedIn, hasScope("banshares/report"), ratelimitCheck("report-banshare", 15000, 1)],
                    afterHandle: [ratelimitApply("report-banshare")],
                    body: t.Object({
                        reason: t.String({
                            minLength: 1,
                            maxLength: 1800,
                            description: "The reason for the report.",
                            error: "Banshare report reason must be 1-1800 characters.",
                        }),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Report a banshare.",
                        description: trim(`
                            \`\`\`
                            Scope: banshares/report
                            \`\`\`

                            Report a banshare. Restricted to council members and staff with the \`banshares\` role.
                        `),
                    },
                },
            ),
    );
