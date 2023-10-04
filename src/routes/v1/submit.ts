import { t } from "elysia";
import { App } from "../../lib/app.js";
import bot from "../../lib/bot.js";
import { hasScope, isSignedIn, ratelimitApply, ratelimitCheck } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { trim } from "../../lib/utils.js";
import { validateInvite } from "../../lib/validators.js";
import db from "../../lib/db.js";
import audit, { AuditLogAction } from "../../lib/audit.js";

export default (app: App) =>
    app.group("", (app) =>
        app
            .post(
                "/apply",
                async ({
                    bearer,
                    body: {
                        observerchannelconsent,
                        observerauditconsent,
                        partnerlistconsent,
                        eventsconsent,
                        mascot,
                        role,
                        roleother,
                        ownerid,
                        invite,
                        nsfw,
                        ...others
                    },
                    user,
                }) => {
                    function abort(error: string) {
                        throw new APIError(400, codes.INVALID_BODY, error);
                    }

                    if (!observerchannelconsent) abort("Missing consent: observer channel view access.");
                    if (!observerauditconsent) abort("Missing consent: observer audit log access.");
                    if (!partnerlistconsent) abort("Missing consent: partner list.");
                    if (!eventsconsent) abort("Missing consent: network events.");
                    if (!mascot) abort("Missing mascot.");
                    if (!["owner", "admin", "mod", "other"].includes(role)) abort("Invalid role selection.");
                    if (role === "other" && !roleother) abort("You must specify a role if you selected other as your role.");
                    if (role !== "owner" && !ownerid) abort("You must specify the server owner if you are not the owner.");

                    const code = await validateInvite(bearer!, invite);

                    if (!["private", "public", "no"].includes(nsfw)) abort("Invalid NSFW selection.");

                    if (role !== "owner") {
                        const req = await bot(bearer!, `!GET /users/${ownerid}/tag`);
                        if (!req.ok) abort("Invalid owner ID.");
                    }

                    const data = { code, mascot, role, roleother, ownerid, nsfw, ...others, user: user!.id };

                    await db.applications.insertOne(data);
                    await bot(bearer!, `POST /apply`, data);
                    audit(user, AuditLogAction.APPLY, data);
                },
                {
                    beforeHandle: [isSignedIn, hasScope("apply"), ratelimitCheck("apply", 300000, 1)],
                    afterHandle: [ratelimitApply("apply")],
                    body: t.Object({
                        observerchannelconsent: t.Boolean({
                            description:
                                "This must be true, indicating consent to give your server's observer view access to all channels for the observation period.",
                        }),
                        observerauditconsent: t.Boolean({
                            description:
                                "This must be true, indicating consent to give your server's observer access to the audit logs for the observation period.",
                        }),
                        partnerlistconsent: t.Boolean({
                            description: "This must be true, indicating agreement to display the TCN partner list publicly and keep it up-to-date.",
                        }),
                        eventsconsent: t.Boolean({
                            description:
                                "This must be true, indicating agreement to follow the network events channel publicly to cross-promote TCN server events and post crucial TCN announcements.",
                        }),
                        mascot: t.String({
                            minLength: 1,
                            maxLength: 64,
                            description: "Your server's mascot character.",
                            error: "Mascot character must be 1-64 characters.",
                        }),
                        role: t.String({ description: "Your role in the server (owner, admin, mod, or other)." }),
                        roleother: t.Optional(
                            t.String({
                                maxLength: 32,
                                description: "Your role in the server, if other was specified for role.",
                                error: "Role (when other is specified) must be 1-32 characters.",
                            }),
                        ),
                        ownerid: t.Optional(schemas.snowflake("The Discord ID of the server's owner, if it is not you.")),
                        invite: t.String({
                            minLength: 1,
                            maxLength: 64,
                            description: "An invite link or code to your server.",
                            error: "Invite must be 1-64 characters.",
                        }),
                        nsfw: t.String({ description: "Your server's NSFW status (private = role-locked NSFW, public = non-locked NSFW, no = fully SFW)." }),
                        experience: t.String({
                            maxLength: 1024,
                            description: "Your prior experience running a Discord server or similar community in a position of management.",
                            error: "Experience must be 0-1024 characters.",
                        }),

                        shortgoals: t.String({
                            minLength: 1,
                            maxLength: 1024,
                            description: "Your short-term goals or ideas for your server.",
                            error: "Short goals must be 1-1024 characters.",
                        }),
                        longgoals: t.String({
                            minLength: 1,
                            maxLength: 1024,
                            description: "Your long-term goals or ideas for your server.",
                            error: "Long goals must be 1-1024 characters.",
                        }),
                        history: t.String({
                            minLength: 1,
                            maxLength: 1024,
                            description: "A rough outline of your server's history (former identities, your inspiration to start the server, etc.).",
                            error: "History must be 1-1024 characters.",
                        }),
                        additional: t.String({
                            maxLength: 1024,
                            description: "Any additional questions or comments you'd like to add.",
                            error: "Additional comments must be 0-1024 characters.",
                        }),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Submit an application to the TCN.",
                        description: trim(`
                            \`\`\`
                            Scope: apply
                            \`\`\`

                            Apply to the TCN.
                        `),
                    },
                },
            )
            .use((app) => app),
    );
