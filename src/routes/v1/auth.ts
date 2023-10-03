import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { headers } from "../../lib/audit.js";
import { hasScope, isObserver, isSignedIn } from "../../lib/checkers.js";
import db from "../../lib/db.js";
import schemas from "../../lib/schemas.js";
import { trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/auth", (app) =>
        app
            .get(
                "/key-info",
                async ({ user }) => {
                    return { id: user!.id, scopes: user!.scopes, created: user!.created, expires: user!.expires };
                },
                {
                    beforeHandle: [isSignedIn],
                    detail: {
                        tags: ["V1"],
                        summary: "Get information about the API token in use.",
                        description: trim(`
                            Get information about the current API token. The API token is to specified in the \`Authorization\` header as a bearer token (for
                            example, \`curl -H "Authorization: Bearer ..." ...\`).
                        `),
                    },
                    response: t.Object({
                        created: t.Integer({ description: "The millisecond timestamp of when the token was signed." }),
                        expires: t.Optional(t.Integer({ description: "The millisecond timestamp of when the token expires, if it does." })),
                        id: t.String({ ...schemas.snowflake, description: "The ID of the authenticated user." }),
                        scopes: t.Array(t.String(), { description: "The scopes available to this API token." }),
                    }),
                },
            )
            .get(
                "/token",
                async ({ bearer }) => {
                    return bearer!;
                },
                {
                    beforeHandle: [isSignedIn],
                    detail: {
                        tags: ["V1"],
                        summary: "Get the current API token.",
                        description: trim(`
                            Get the current API token. This endpoint returns a string. Tokens are JWTs which contain the creation and expiration (if
                            applicable) of the token, the associated user ID, and the available scopes.
                        `),
                    },
                    response: t.String(),
                },
            )
            .post(
                "/invalidate",
                async ({ user }) => {
                    await db.invalidations.updateOne({ id: user!.id }, { $set: { time: Date.now() } }, { upsert: true });
                    audit(user, "auth/invalidate/self", { id: user!.id });
                },
                {
                    beforeHandle: [isSignedIn, hasScope("auth/invalidate/self")],
                    detail: {
                        tags: ["V1"],
                        summary: "Invalidate all API tokens owned by this account.",
                        description: trim(`
                            \`\`\`
                            Scope: auth/invalidate/self
                            \`\`\`

                            Invalidate all API tokens owned by the currently authenticated user, immediately making all API tokens (including logins) invalid.
                            This is useful for if any of your API tokens gets compromised.
                        `),
                    },
                },
            )
            .post(
                "/invalidate/:id",
                async ({ params: { id }, reason, user }) => {
                    await db.invalidations.updateOne({ id }, { $set: { time: Date.now() } }, { upsert: true });
                    audit(user, "auth/invalidate/other", { id }, reason);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("auth/invalidate")],
                    detail: {
                        tags: ["V1"],
                        summary: "Invalidate all API tokens owned by a particular account.",
                        description: trim(`
                            \`\`\`
                            Scope: auth/invalidate
                            \`\`\`

                            Invalidate all API tokens owned by a particular user, immediately making all API tokens (including logins) invalid. Observer-only.
                            This is useful for if a user's API token gets compromised.
                        `),
                    },
                    headers: headers(true),
                    params: t.Object({ id: schemas.snowflake("The user's Discord ID.") }),
                },
            )
            .post(
                "/key",
                async ({ body, jwt, reason, user }) => {
                    for (const scope of body.scopes) hasScope(scope)({ user });

                    const created = Date.now();
                    const data: any = { created, id: user!.id, scopes: body.scopes };
                    if (body.maxage > 0) data.expires = created + body.maxage;

                    audit(user, "auth/key", data, reason);
                    return await jwt.sign(data);
                },
                {
                    beforeHandle: [isSignedIn, hasScope("auth/key")],
                    body: t.Object({
                        maxage: t.Integer({ minimum: 0, default: 24 * 60 * 60 * 1000, error: "API key max age must be non-negative." }),
                        scopes: t.Array(t.String(), { default: ["all"] }),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Create a new API token.",
                        description: trim(`
                            \`\`\`
                            Scope: auth/key
                            \`\`\`

                            Create a new API key with the specified maximum age (use \`0\` to make the token never expire) and scopes. Using the \`all\` scope
                            is only recommended for testing and will grant access to all scopes. Scopes are hierarchal, meaning a key with the \`a/b\` scope
                            will be able to use endpoints that require the \`a/b/c\` scope. A key can only be used to generate keys whose scopes are a subset
                            of its own.
                        `),
                    },
                    headers: headers(),
                },
            ),
    );
