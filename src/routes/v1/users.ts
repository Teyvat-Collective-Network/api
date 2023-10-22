import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { AuditLogAction, headers } from "../../lib/audit.js";
import bot from "../../lib/bot.js";
import { hasScope, isObserver, isOwner, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import data from "../../lib/data.js";
import db, { withSession } from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import rolesync from "../../lib/rolesync.js";
import schemas from "../../lib/schemas.js";
import { trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/users", (app) =>
        app
            .get(
                "/",
                async ({ query: { observers, council, voters } }) => {
                    const filter: any = {};

                    if (observers === "true") filter.observer = true;

                    let users = await data.getUsers(filter);

                    if (observers === "true") users = users.filter((x) => x.observer);
                    if (council === "true") users = users.filter((x) => x.council);
                    if (voters === "true") users = users.filter((x) => x.voter);

                    return users;
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get all TCN users.",
                        description: trim(`
                            Return an array containing all TCN users. Note that a user may not be returned here even if it has been accessed before. Certain
                            operations create a user in the API, but fetching a user always succeeds (even if the user does not exist on Discord) and returns
                            an empty user (no roles and no guilds).
                        `),
                    },
                    query: t.Object({
                        observers: t.Optional(t.String({ description: "If true, only return observers." })),
                        council: t.Optional(t.String({ description: "If true, only return council members." })),
                        voters: t.Optional(t.String({ description: "If true, only return designated voters." })),
                    }),
                    response: t.Array(schemas.user),
                },
            )
            .get(
                "/me",
                async ({ bearer, user }) => {
                    return { tag: await bot(bearer!, `GET /users/${user!.id}/tag`), ...(await data.getUser(user!.id)) };
                },
                {
                    beforeHandle: [isSignedIn],
                    detail: {
                        tags: ["V1"],
                        summary: "Get the TCN user corresponding to the authenticated user.",
                        description: trim(`
                            Returns the currently authenticated user. Note that this will succeed even if the user is not in the API, in which case it won't be
                            returned by \`GET /v1/users\`.
                        `),
                    },
                    response: t.Object({
                        tag: t.String({ description: "Your Discord tag." }),
                        ...schemas.user.properties,
                    }),
                },
            )
            .get(
                "/:id",
                async ({ params: { id } }) => {
                    return await data.getUser(id);
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get a TCN user.",
                        description: trim(`
                            Get a TCN user. Note that this will succeed even if the user is not in the API, in which case it won't be returned by
                            \`GET /v1/users\`.
                        `),
                    },
                    params: t.Object({ id: schemas.snowflake("The user's Discord ID.") }),
                },
            )
            .patch(
                "/:id",
                async ({ body, params: { id }, reason, user }) => {
                    const $set: any = body;

                    if (body.observer === true) $set.observerSince = Date.now();
                    if (body.observer === false) $set.observerSince = 0;

                    await db.users.updateOne({ id }, { $set }, { upsert: true });
                    audit(user, body.observer ? AuditLogAction.USERS_PROMOTE : AuditLogAction.USERS_DEMOTE, { id }, reason);
                    rolesync();
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("users/write")],
                    body: t.Object({ observer: t.Boolean({ description: "Whether or not the user is an observer." }) }),
                    detail: {
                        tags: ["V1"],
                        summary: "Update a user.",
                        description: trim(`
                            \`\`\`
                            Scope: users/write
                            \`\`\`

                            Update a user, setting whether or not they are an observer. Observer-only.
                        `),
                    },
                    headers: headers(true),
                    params: t.Object({ id: schemas.snowflake("The user's Discord ID.") }),
                },
            )
            .post(
                "/:id/refresh",
                async ({ params: { id }, reason, user }) => {
                    const doc = await db.users.findOneAndUpdate({ id, observer: true }, { $set: { observerSince: Date.now() } });
                    if (!doc) throw new APIError(400, codes.INVALID_BODY, "That user is not an observer.");

                    audit(user, AuditLogAction.USERS_TERM_REFRESH, { id }, reason);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("users/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Refresh a user's observer term.",
                        description: trim(`
                            \`\`\`
                            Scope: users/write
                            \`\`\`

                            Refresh a user's observer term, setting their last term start time to the present moment. Observer-only.
                        `),
                    },
                    headers: headers(true),
                    params: t.Object({ id: schemas.snowflake("The user's Discord ID.") }),
                },
            )
            .put(
                "/:id/roles/:role",
                async ({ params: { id, role }, reason, user }) => {
                    await db.users.updateOne({ id }, { $addToSet: { roles: role } }, { upsert: true });
                    audit(user, AuditLogAction.USERS_ROLES_ADD, { id, role }, reason);
                    rolesync();
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("users/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Add a global role to a user.",
                        description: trim(`
                            \`\`\`
                            Scope: users/write
                            \`\`\`

                            Update a user, giving them a role globally. Observer-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({ id: schemas.snowflake("The user's Discord ID."), role: schemas.id("The role to assign.") }),
                },
            )
            .delete(
                "/:id/roles/:role",
                async ({ params: { id, role }, reason, user }) => {
                    await db.users.updateOne({ id }, { $pull: { roles: role } }, { upsert: true });
                    audit(user, AuditLogAction.USERS_ROLES_REMOVE, { id, role }, reason);
                    rolesync();
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("users/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Remove a global role from a user.",
                        description: trim(`
                            \`\`\`
                            Scope: users/write
                            \`\`\`

                            Update a user, removing a role from them globally. Observer-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({ id: schemas.snowflake("The user's Discord ID."), role: schemas.id("The role to remove.") }),
                },
            )
            .patch(
                "/:id/guild-roles/:guild",
                async ({ body: { add, remove }, params: { id, guild }, reason, user }) => {
                    await data.getGuild(guild);

                    await withSession(async () => {
                        if (add) await db.guilds.updateOne({ id: guild }, { $addToSet: { [`users.${id}.roles`]: { $each: add } } });
                        if (remove) await db.guilds.updateOne({ id: guild }, { $pull: { [`users.${id}.roles`]: { $in: remove } } });
                    });

                    audit(user, AuditLogAction.USERS_ROLES_SET, { id, guild, add, remove }, reason);
                    rolesync();
                },
                {
                    beforeHandle: [isSignedIn, ({ params: { guild }, user }) => isOwner(guild, user!), hasScope("users/write")],
                    body: t.Object({
                        add: t.Optional(t.Array(schemas.id(), { description: "An array of roles to add." })),
                        remove: t.Optional(t.Array(schemas.id(), { description: "An array of roles to remove." })),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Set a user's guild roles.",
                        description: trim(`
                            \`\`\`
                            Scope: users/write
                            \`\`\`

                            Update a user, setting multiple guild roles at once. Observer/owner-only.
                    `),
                    },
                    headers: headers(),
                    params: t.Object({
                        id: schemas.snowflake("The user's Discord ID."),
                        guild: schemas.snowflake("The guild's Discord ID."),
                    }),
                },
            )
            .put(
                "/:id/roles/:role/:guild",
                async ({ params: { id, role, guild }, reason, user }) => {
                    await data.getGuild(guild);
                    await db.guilds.updateOne({ id: guild }, { $addToSet: { [`users.${id}.roles`]: role } });
                    audit(user, AuditLogAction.USERS_ROLES_ADD, { id, role, guild }, reason);
                    rolesync();
                },
                {
                    beforeHandle: [isSignedIn, ({ params: { guild }, user }) => isOwner(guild, user!), hasScope("users/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Add a guild role to a user.",
                        description: trim(`
                            \`\`\`
                            Scope: users/write
                            \`\`\`

                            Update a user, giving them a role within a guild. Observer/owner-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({
                        id: schemas.snowflake("The user's Discord ID."),
                        role: schemas.id("The role to assign."),
                        guild: schemas.snowflake("The guild's Discord ID."),
                    }),
                },
            )
            .delete(
                "/:id/roles/:role/:guild",
                async ({ params: { id, role, guild }, reason, user }) => {
                    await data.getGuild(guild);
                    await db.guilds.updateOne({ id: guild }, { $pull: { [`users.${id}.roles`]: role } });
                    audit(user, AuditLogAction.USERS_ROLES_REMOVE, { id, role, guild }, reason);
                    rolesync();
                },
                {
                    beforeHandle: [isSignedIn, ({ params: { guild }, user }) => isOwner(guild, user!), hasScope("users/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Remove a guild role from a user.",
                        description: trim(`
                            \`\`\`
                            Scope: users/write
                            \`\`\`

                            Update a user, removing a role from them within a guild. Observer/owner-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({
                        id: schemas.snowflake("The user's Discord ID."),
                        role: schemas.id("The role to remove."),
                        guild: schemas.snowflake("The guild's Discord ID."),
                    }),
                },
            )
            .put(
                "/:id/staff/:guild",
                async ({ body: { staff }, params: { id, guild }, reason, user }) => {
                    await db.guilds.updateOne({ id: guild }, { $set: { [`users.${id}.staff`]: staff } });
                    audit(user, staff ? AuditLogAction.USERS_STAFF_ADD : AuditLogAction.USERS_STAFF_REMOVE, { id, guild }, reason);
                    rolesync();
                },
                {
                    beforeHandle: [isSignedIn, ({ params: { guild }, user }) => isOwner(guild, user!), hasScope("users/write")],
                    body: t.Object({ staff: t.Boolean({ description: "Whether or not the user is a staff member in this guild." }) }),
                    detail: {
                        tags: ["V1"],
                        summary: "Update a user's staff status in a guild.",
                        description: trim(`
                            \`\`\`
                            Scope: users/write
                            \`\`\`

                            Update a user, setting whether or not they are a staff member of a specified guild. Observer/owner-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({ id: schemas.snowflake("The user's Discord ID."), guild: schemas.snowflake("The guild's Discord ID.") }),
                },
            ),
    );
