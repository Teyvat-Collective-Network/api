import { t } from "elysia";
import { App } from "../../lib/app.js";
import codes from "../../lib/codes.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import { trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/short-links", (app) =>
        app
            .get(
                "/:id",
                async ({ params: { id } }) => {
                    const doc = await db.short_links.findOne({ id });
                    if (!doc) throw new APIError(404, codes.MISSING_SHORT_LINK, `No short link exists with ID ${id}.`);

                    return doc.url;
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get the underlying URL for a short link.",
                        description: trim(`
                            Get the underlying URL for a short link.
                        `),
                    },
                    params: t.Object({
                        id: t.String({ description: "The ID of the short link." }),
                    }),
                    response: t.String({ description: "The URL." }),
                },
            )
            .post(
                "/",
                async ({ body, query: { id: input } }) => {
                    if (input) {
                        const doc = await db.short_links.findOneAndUpdate({ id: input }, { $setOnInsert: { url: body } }, { upsert: true });
                        if (doc) throw new APIError(409, codes.DUPLICATE, `That ID is already in use.`);

                        return { id: input };
                    }

                    const doc = await db.short_links.findOneAndUpdate({ url: body }, { $set: { url: body } });
                    if (doc) return { id: doc.id };

                    while (true) {
                        const id = new Array(8)
                            .fill(0)
                            .map(() => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)])
                            .join("");

                        const doc = await db.short_links.findOneAndUpdate({ id }, { $setOnInsert: { url: body } }, { upsert: true });
                        if (!doc) return { id };
                    }
                },
                {
                    body: t.String(),
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Post a URL and get a short link ID.",
                        description: trim(`
                            Post a URL and get a short link ID.
                        `),
                    },
                    query: t.Object({
                        id: t.Optional(t.String({ description: "If true, attempt to save with a custom ID." })),
                    }),
                    response: t.Object({
                        id: t.String({ description: "The ID of the created share link." }),
                    }),
                },
            ),
    );
