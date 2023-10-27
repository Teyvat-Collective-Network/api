import { t } from "elysia";
import { App } from "../../lib/app.js";
import { hasScope, isObserver, isOwner, isSignedIn } from "../../lib/checkers.js";
import db from "../../lib/db.js";
import schemas from "../../lib/schemas.js";
import { Autosync } from "../../lib/types.js";
import { trim } from "../../lib/utils.js";

import { readFileSync } from "fs";
import bot from "../../lib/bot.js";

const defaultTemplate = readFileSync("./defaultAutosyncTemplate.toml", "utf-8");

export default (app: App) =>
    app.group("/autosync", (app) =>
        app
            .get(
                "/",
                async () => {
                    return ((await db.autosync.find().toArray()) as unknown[] as Autosync[]).map((doc) => ({
                        guild: doc.guild,
                        template: doc.template ?? defaultTemplate,
                        channel: doc.channel ?? null,
                        webhook: doc.webhook ?? null,
                        message: doc.message ?? null,
                        repost: doc.repost ?? false,
                    }));
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("autosync/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get all autosync configurations.",
                        description: trim(`
                            \`\`\`
                            Scope: autosync/read
                            \`\`\`

                            Get all autosyunc configurations. Observer-only.
                        `),
                    },
                    response: t.Array(schemas.autosync),
                },
            )
            .get(
                "/:guild",
                async ({ params: { guild } }) => {
                    const doc = (await db.autosync.findOne({ guild })) as unknown as Autosync;

                    return {
                        guild,
                        template: doc?.template ?? defaultTemplate,
                        channel: doc?.channel ?? null,
                        webhook: doc?.webhook ?? null,
                        message: doc?.message ?? null,
                        repost: doc?.repost ?? false,
                    };
                },
                {
                    beforeHandle: [
                        isSignedIn,
                        ({ internal, params: { guild }, user }) => isOwner(guild, user!, internal, { allowHqAndHub: true, allowAdvisor: true }),
                        hasScope("autosync/read"),
                    ],
                    detail: {
                        tags: ["V1"],
                        summary: "Get a server's autosync configuration.",
                        description: trim(`
                            \`\`\`
                            Scope: autosync/read
                            \`\`\`

                            Get a server's autosync configuration. Observer-only.
                        `),
                    },
                    response: schemas.autosync,
                },
            )
            .patch(
                "/:guild",
                async ({ bearer, body, params: { guild } }) => {
                    await db.autosync.updateOne({ guild }, { $set: body }, { upsert: true });
                    if (Object.keys(body).every((x) => x === "message")) return;

                    bot(bearer!, `POST /autosync/${guild}`);
                },
                {
                    beforeHandle: [
                        isSignedIn,
                        ({ internal, params: { guild }, user }) => isOwner(guild, user!, internal, { allowHqAndHub: true, allowAdvisor: true }),
                        hasScope("autosync/write"),
                    ],
                    body: t.Object(
                        Object.fromEntries(
                            Object.entries(schemas.autosync.properties)
                                .filter(([key]) => key !== "guild")
                                .map(([key, value]) => [key, t.Optional(value)]),
                        ),
                    ),
                    detail: {
                        tags: ["V1"],
                        summary: "Update a server's autosync configuration.",
                        description: trim(`
                            \`\`\`
                            Scope: autosync/write
                            \`\`\`

                            Update a server' autosync configuration. Observer-only.
                        `),
                    },
                },
            ),
    );
