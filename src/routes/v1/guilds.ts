import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { AuditLogAction, headers } from "../../lib/audit.js";
import { hasScope, isObserver, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import data from "../../lib/data.js";
import db, { withSession } from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
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

                    const code = await validateInvite(bearer!, body.invite, id);

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

                    if (body.invite) $set.invite = await validateInvite(bearer!, body.invite, id);
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

                    if (body.invite || body.name !== doc.name)
                        await db.audit_logs.updateOne(
                            { actions: { $in: [AuditLogAction.GUILDS_CREATE, AuditLogAction.GUILDS_EDIT] }, "data.id": id },
                            { $set: { "data.invite": body.invite, "data.name": body.name !== doc.name ? body.name : undefined } },
                        );

                    audit(user, AuditLogAction.GUILDS_EDIT, { id, name: body.name ?? doc.name, changes: changes(doc, body) }, reason);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("guilds/write")],
                    body: t.Object({
                        name: t.Optional(schemas.guild.properties.name),
                        mascot: t.Optional(schemas.guild.properties.mascot),
                        invite: t.Optional(schemas.guild.properties.invite),
                        owner: t.Optional(schemas.guild.properties.owner),
                        advisor: schemas.guild.properties.advisor,
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
                async ({ params: { id }, reason, user }) => {
                    const guild = await data.getGuild(id);

                    await withSession(async () => {
                        await db.guilds.deleteOne({ id });
                        await db.banshare_settings.deleteOne({ guild: id });
                    });

                    audit(user, AuditLogAction.GUILDS_DELETE, guild, reason);
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
            ),
    );
