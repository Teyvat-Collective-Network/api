import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { AuditLogAction, headers } from "../../lib/audit.js";
import bot from "../../lib/bot.js";
import { hasScope, isObserver, isOwner, isSignedIn, ratelimitApply, ratelimitCheck } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import data from "../../lib/data.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import rolesync from "../../lib/rolesync.js";
import schemas from "../../lib/schemas.js";
import { Rolesync } from "../../lib/types.js";
import { changes, trim } from "../../lib/utils.js";
import { validateInvite } from "../../lib/validators.js";
export default (app: App) =>
    app.group("/guilds", (app) =>
        app
            .get(
                "/",
                async () => {
                    return await data.getGuilds();
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get all TCN guilds.",
                        description: trim(`
                            Return an array containing all TCN guilds.
                        `),
                    },
                    response: t.Array(schemas.guild),
                },
            )
            .get(
                "/:id",
                async ({ params: { id } }) => {
                    return await data.getGuild(id);
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get a TCN guild.",
                        description: trim(`
                            Get a TCN guild.
                        `),
                    },
                    params: t.Object({ id: schemas.snowflake("The guild's Discord ID.") }),
                    response: schemas.guild,
                },
            )
            .post(
                "/:id",
                async ({ bearer, body, params: { id }, reason, user }) => {
                    if ((await db.guilds.countDocuments({ id })) > 0) throw new APIError(409, codes.DUPLICATE, `A guild already exists with ID ${id}.`);

                    if (body.delegated && !body.advisor)
                        throw new APIError(400, codes.INVALID_BODY, "Delegation cannot be enabled if the guild has no advisor.");

                    await data.getCharacter(body.mascot);

                    const code = await validateInvite<false>(bearer!, body.invite, id);

                    const createData = {
                        id,
                        name: body.name,
                        mascot: body.mascot,
                        invite: code,
                        owner: body.owner,
                        advisor: body.advisor || null,
                        voter: body.delegated ? body.owner : body.advisor,
                        delegated: body.delegated,
                    };

                    await db.guilds.insertOne(createData);

                    audit(user, AuditLogAction.GUILDS_CREATE, createData, reason);
                    rolesync();
                    bot(bearer!, `POST /autosync`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("guilds/write")],
                    body: t.Object({
                        name: schemas.guild.properties.name,
                        mascot: schemas.guild.properties.mascot,
                        invite: schemas.guild.properties.invite,
                        owner: schemas.guild.properties.owner,
                        advisor: schemas.guild.properties.advisor,
                        delegated: schemas.guild.properties.delegated,
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Create a TCN guild.",
                        description: trim(`
                            \`\`\`
                            Scope: guilds/write
                            \`\`\`

                            Create a TCN guild (add a guild into the TCN). Observer-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({ id: schemas.snowflake("The guild's Discord ID.") }),
                },
            )
            .patch(
                "/:id",
                async ({ bearer, body, params: { id }, reason, user }) => {
                    const doc = await data.getGuild(id);

                    const $set: any = {};
                    const $unset: any = {};

                    if (body.name) $set.name = body.name;

                    if (body.mascot) {
                        await data.getCharacter(body.mascot);
                        $set.mascot = body.mascot;
                    }

                    if (body.invite) $set.invite = await validateInvite<false>(bearer!, body.invite, id);
                    if (body.owner) $set.owner = body.owner;

                    if (body.advisor !== undefined)
                        if (body.advisor === null)
                            if (body.delegated ?? doc.delegated)
                                throw new APIError(400, codes.INVALID_BODY, "The advisor cannot be removed while delegation is enabled.");
                            else $unset.advisor = 0;
                        else $set.advisor = body.advisor;

                    if (body.delegated !== undefined)
                        if (body.delegated && ((!doc.advisor && !body.advisor) || body.advisor === null))
                            throw new APIError(400, codes.INVALID_BODY, "Delegation cannot be enabled if the guild has no advisor.");
                        else $set.delegated = body.delegated;

                    await db.guilds.updateOne({ id }, { $set, $unset });

                    if (body.invite || (body.name && body.name !== doc.name))
                        await db.audit_logs.updateMany(
                            { action: { $in: [AuditLogAction.GUILDS_CREATE, AuditLogAction.GUILDS_EDIT] }, "data.id": id },
                            { $set: { "data.invite": body.invite, "data.name": body.name && body.name !== doc.name ? body.name : undefined } },
                        );

                    const changelist = changes(doc, body);
                    if (changelist.delegated)
                        changelist.voter = [
                            changelist.delegated[0] ? doc.advisor : doc.owner,
                            changelist.delegated[1] ? body.advisor ?? doc.advisor : body.owner ?? doc.owner,
                        ];

                    audit(user, AuditLogAction.GUILDS_EDIT, { id, name: body.name ?? doc.name, changes: changelist }, reason);
                    if ("owner" in $set || "advisor" in $set || "advisor" in $unset || "delegated" in $set) rolesync();
                    bot(bearer!, `POST /autosync`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("guilds/write")],
                    body: t.Object({
                        name: t.Optional(schemas.guild.properties.name),
                        mascot: t.Optional(schemas.guild.properties.mascot),
                        invite: t.Optional(schemas.guild.properties.invite),
                        owner: t.Optional(schemas.guild.properties.owner),
                        advisor: t.Optional(schemas.guild.properties.advisor),
                        delegated: t.Optional(schemas.guild.properties.delegated),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Update a TCN guild.",
                        description: trim(`
                            \`\`\`
                            Scope: guilds/write
                            \`\`\`

                            Update a TCN guild. Observer-only. Note that setting \`advisor\` to \`undefined\` will not update the advisor, and setting it to
                            \`null\` will remove the guild's advisor.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({ id: schemas.snowflake("The guild's Discord ID.") }),
                },
            )
            .delete(
                "/:id",
                async ({ bearer, params: { id }, reason, user }) => {
                    const guild = await data.getGuild(id);

                    await db.guilds.deleteOne({ id });
                    await db.autosync.deleteMany({ guild: id });

                    audit(user, AuditLogAction.GUILDS_DELETE, guild, reason);
                    rolesync();
                    bot(bearer!, `POST /autosync`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("guilds/delete")],
                    detail: {
                        tags: ["V1"],
                        summary: "Delete a TCN guild.",
                        description: trim(`
                            \`\`\`
                            Scope: guilds/delete
                            \`\`\`

                            Delete a TCN guild (remove a guild from the TCN). Observer-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({ id: schemas.snowflake("The guild's Discord ID.") }),
                },
            )
            .get(
                "/all-rolesync",
                async () => {
                    return (await db.rolesync.find().toArray()) as unknown[] as Rolesync[];
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("rolesync/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get all rolesync configurations.",
                        description: trim(`
                            \`\`\`
                            Scope: rolesync/read
                            \`\`\`

                            Get all rolesync configurations. Observer-only.
                        `),
                    },
                    response: t.Array(schemas.rolesync),
                },
            )
            .get(
                "/:id/rolesync",
                async ({ params: { id } }) => {
                    const doc = (await db.rolesync.findOne({ guild: id })) as unknown as Rolesync;
                    if (doc && "guild" in doc) delete doc.guild;

                    return doc ?? { roleToStaff: [], staffToRole: [], roleToApi: {}, apiToRole: [] };
                },
                {
                    beforeHandle: [isSignedIn, ({ params: { id }, user }) => isOwner(id, user!, undefined, true), hasScope("rolesync/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get the rolesync configuration for a guild.",
                        description: trim(`
                            \`\`\`
                            Scope: rolesync/read
                            \`\`\`

                            Get the rolesync configuration for a guild. Owner-only.
                        `),
                    },
                    params: t.Object({
                        id: schemas.snowflake("The ID of the guild."),
                    }),
                    response: schemas.rolesync,
                },
            )
            .put(
                "/:id/rolesync",
                async ({ bearer, body, params: { id }, user }) => {
                    if (id !== Bun.env.HQ && id !== Bun.env.HUB) await data.getGuild(id);
                    else if (body.roleToStaff.length + body.staffToRole.length > 0)
                        throw new APIError(400, codes.INVALID_BODY, "For HQ/Hub, the role-to-staff and staff-to-role synchronizations are not allowed.");
                    else if (body.apiToRole.some((x) => x.type !== "position" && x.type !== "role"))
                        throw new APIError(400, codes.INVALID_BODY, "API-to-role condition type must be position or role.");
                    else if (
                        body.apiToRole.some((x) => x.type === "position" && !["observer", "owner", "advisor", "voter", "council", "staff"].includes(x.value))
                    )
                        throw new APIError(
                            400,
                            codes.INVALID_BODY,
                            "Position API-to-role condition values must be observer, owner, advisor, voter, council, or staff.",
                        );

                    const apiConditionKeys = body.apiToRole.map((x) => `${x.type}/${x.value}/${x.guild}`);

                    if (apiConditionKeys.length > new Set(apiConditionKeys).size)
                        throw new APIError(400, codes.INVALID_BODY, "One or more API conditions are duplicate.");

                    const roles: Record<string, { manageable: boolean }> = await bot(bearer!, `GET /guilds/${id}/roles`);
                    const ids = [
                        ...new Set([
                            ...body.roleToStaff,
                            ...body.staffToRole,
                            ...Object.keys(body.roleToApi),
                            ...Object.values((body as Rolesync).apiToRole).flatMap((x) => x.roles),
                        ]),
                    ];

                    const invalid = ids.filter((x) => !roles[x]);

                    if (invalid.length > 0)
                        throw new APIError(
                            400,
                            codes.INVALID_BODY,
                            `The following role ID${invalid.length === 1 ? " is" : "s are"} invalid for this guild: ${invalid.join(", ")}`,
                        );

                    const unmanageable = [...new Set([...body.staffToRole, ...Object.values((body as Rolesync).apiToRole).flatMap((x) => x.roles)])].filter(
                        (x) => !roles[x].manageable,
                    );

                    if (unmanageable.length > 0)
                        throw new APIError(
                            400,
                            codes.INVALID_BODY,
                            `The following role ID${
                                unmanageable.length === 1 ? " is" : "s are"
                            } valid in this guild but cannot be managed and therefore cannot be staff-to-role or api-to-role entries: ${unmanageable.join(
                                ", ",
                            )}`,
                        );

                    body.roleToStaff = [...new Set(body.roleToStaff)].sort();
                    body.staffToRole = [...new Set(body.staffToRole)].sort();

                    body.roleToApi = Object.fromEntries(
                        Object.entries((body as Rolesync).roleToApi)
                            .sort(([x], [y]) => x.localeCompare(y))
                            .map(([x, y]) => [x, [...new Set(y)].sort()]),
                    );

                    body.apiToRole = body.apiToRole
                        .map(({ roles, ...rest }) => ({ roles: roles.sort(), ...rest }))
                        .sort((x, y) => x.type.localeCompare(y.type) || x.value.localeCompare(y.value) || (x.guild ?? "").localeCompare(y.guild ?? ""));

                    const doc = await db.rolesync.findOneAndReplace({ guild: id }, { guild: id, ...body }, { upsert: true });

                    if (
                        doc &&
                        (["roleToStaff", "staffToRole", "roleToApi", "apiToRole"] as const).every((x) => JSON.stringify(doc[x]) === JSON.stringify(body[x]))
                    )
                        throw new APIError(400, codes.NOT_MODIFIED, "No changes were made.");

                    rolesync({ guild: id });

                    if (!user!.guilds[id]?.owner)
                        audit(user, AuditLogAction.ROLESYNC_EDIT, {
                            id,
                            before: doc ?? { roleToStaff: [], staffToRole: [], roleToApi: {}, apiToRole: [] },
                            after: body,
                        });
                },
                {
                    beforeHandle: [
                        isSignedIn,
                        ({ params: { id }, user }) => isOwner(id, user!, undefined, true),
                        hasScope("rolesync/write"),
                        ratelimitCheck("rolesync/write", 30000, 3),
                    ],
                    afterHandle: [ratelimitApply("rolesync/write")],
                    body: schemas.rolesync,
                    detail: {
                        tags: ["V1"],
                        summary: "Set the rolesync configuration for a guild.",
                        description: trim(`
                            \`\`\`
                            Scope: rolesync/write
                            \`\`\`

                            Set the rolesync configuration for a guild. Owner-only. HQ and Hub are supported and observer-only.
                        `),
                    },
                    params: t.Object({
                        id: schemas.snowflake("The ID of the guild."),
                    }),
                },
            ),
    );
