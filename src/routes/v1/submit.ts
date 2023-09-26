import { t } from "elysia";
import { App } from "../../index.js";
import bot from "../../lib/bot.js";
import { isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { trim } from "../../lib/utils.js";
import { validateInvite } from "../../lib/validators.js";

export default (app: App) =>
    app.group("", (app) =>
        app.post(
            "/apply",
            async ({
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

                const code = await validateInvite(invite);

                if (!["private", "public", "no"].includes(nsfw)) abort("Invalid NSFW selection.");

                if (role !== "owner") {
                    const req = await bot(`!GET /tag/${ownerid}`);
                    if (!req.ok) abort("Invalid owner ID.");
                }

                await bot(`POST /apply`, { code, mascot, role, roleother, ownerid, nsfw, ...others, user: user!.id });
            },
            {
                beforeHandle: [isSignedIn],
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
                    mascot: t.String({ description: "Your server's mascot character." }),
                    role: t.String({ description: "Your role in the server (owner, admin, mod, or other)." }),
                    roleother: t.Optional(t.String({ description: "Your role in the server, if other was specified for role." })),
                    ownerid: t.Optional(schemas.snowflake("The Discord ID of the server's owner, if it is not you.")),
                    invite: t.String({ description: "An invite link or code to your server." }),
                    nsfw: t.String({ description: "Your server's NSFW status (private = role-locked NSFW, public = non-locked NSFW, no = fully SFW)." }),
                    experience: t.String({
                        maxLength: 1024,
                        description: "Your prior experience running a Discord server or similar community in a position of management.",
                        error: "The experience field cannot exceed 1024 characters.",
                    }),

                    shortgoals: t.String({
                        minLength: 1,
                        maxLength: 1024,
                        description: "Your short-term goals or ideas for your server.",
                        error: "The short goals field is required and cannot exceed 1024 characters.",
                    }),
                    longgoals: t.String({
                        minLength: 1,
                        maxLength: 1024,
                        description: "Your long-term goals or ideas for your server.",
                        error: "The long goals field is required and cannot exceed 1024 characters.",
                    }),
                    history: t.String({
                        minLength: 1,
                        maxLength: 1024,
                        description: "A rough outline of your server's history (former identities, your inspiration to start the server, etc.).",
                        error: "The history field is required and cannot exceed 1024 characters.",
                    }),
                    additional: t.String({
                        maxLength: 1024,
                        description: "Any additional questions or comments you'd like to add.",
                        error: "The additional comments field cannot exceed 1024 characters.",
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
        ),
    );
