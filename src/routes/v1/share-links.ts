import { t } from "elysia";
import { App } from "../../lib/app.js";
import codes from "../../lib/codes.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import { trim } from "../../lib/utils.js";
import words from "../../lib/words.js";

export default (app: App) =>
    app.group("/share-links", (app) =>
        app
            .get(
                "/:id",
                async ({ params: { id } }) => {
                    const doc = await db.share_links.findOneAndUpdate({ id }, { $set: { time: Date.now() } });
                    if (!doc) throw new APIError(404, codes.MISSING_SHARE_LINK, `No share link exists with ID ${id}.`);

                    return doc.content;
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get the data for a share link.",
                        description: trim(`
                            Get the data for a share link.
                        `),
                    },
                    params: t.Object({
                        id: t.String({ description: "The ID of the share link." }),
                    }),
                    response: t.String({ description: "The TOML data." }),
                },
            )
            .post(
                "/",
                async ({ body }) => {
                    const doc = await db.share_links.findOneAndUpdate({ content: body }, { $set: { time: Date.now() } });
                    if (doc) return { id: doc.id };

                    while (true) {
                        const id = new Array(4)
                            .fill(0)
                            .map(() => words[Math.floor(Math.random() * words.length)])
                            .join("-");

                        const doc = await db.share_links.findOneAndUpdate({ id }, { $setOnInsert: { content: body, time: Date.now() } }, { upsert: true });
                        if (!doc) return { id };
                    }
                },
                {
                    body: t.String(),
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Post data and get a share link ID.",
                        description: trim(`
                            Post data and get a share link ID.
                        `),
                    },
                    response: t.Object({
                        id: t.String({ description: "The ID of the created share link." }),
                    }),
                },
            ),
    );
