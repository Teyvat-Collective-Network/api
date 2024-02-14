import { t } from "elysia";
import { App } from "../../lib/app.js";
import { hasScope, isCouncil, isSignedIn, ratelimitApply, ratelimitCheck } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import { trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/short-links", (app) =>
        app
            .get(
                "/",
                async ({ user }) => {
                    return (await db.short_links.find({ user: user!.id }).toArray()).map((x: any) => [x.id, x.url]);
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("short-links/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get all URLs owned by you.",
                        description: trim(`
                            \`\`\`
                            Scope: short-links/read
                            \`\`\`

                            Get all URLs owned by you.
                        `),
                    },
                    response: t.Array(t.Tuple([t.String({ description: "the short code" }), t.String({ description: "the full URL" })])),
                },
            )
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
            .get(
                "/:id/owns",
                async ({ params: { id }, user }) => {
                    return (await db.short_links.countDocuments({ id, user: user!.id })) > 0;
                },
                {
                    beforeHandle: [isSignedIn, isCouncil],
                    detail: {
                        tags: ["V1"],
                        summary: "Determine if you own an ID.",
                        description: trim(`
                            Determine if you own an ID.
                        `),
                    },
                    params: t.Object({
                        id: t.String({ description: "The ID of the short link." }),
                    }),
                    response: t.Boolean({ description: "True if you own the ID, and false if it does not exist or is owned by someone else." }),
                },
            )
            .delete(
                "/:id",
                async ({ params: { id }, user }) => {
                    const doc = await db.short_links.findOneAndDelete({ id, ...(user!.observer ? {} : { user: user!.id }) });
                    if (!doc) throw new APIError(404, codes.MISSING_SHORT_LINK, `No short link exists with ID ${id}, or it does not belong to you.`);
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("short-links/delete")],
                    detail: {
                        tags: ["V1"],
                        summary: "Delete one of your URLs.",
                        description: trim(`
                            \`\`\`
                            Scope: short-links/delete
                            \`\`\`

                            Delete one of your URLs. Observers may delete any URL.
                        `),
                    },
                    params: t.Object({
                        id: t.String({ description: "The ID of the short link." }),
                    }),
                },
            )
            .post(
                "/",
                async ({ body, query: { id: input }, user }) => {
                    if (input) {
                        const doc = await db.short_links.findOneAndUpdate({ id: input, user: user!.id }, { $set: { url: body } });
                        if (doc) return { id: input };
                    }

                    if (input) {
                        const doc = await db.short_links.findOneAndUpdate({ id: input }, { $setOnInsert: { url: body, user: user!.id } }, { upsert: true });
                        if (doc) throw new APIError(409, codes.DUPLICATE, `That ID is already in use.`);

                        return { id: input };
                    }

                    const doc = await db.short_links.findOneAndUpdate({ url: body, user: user!.id }, { $set: { url: body } });
                    if (doc) return { id: doc.id };

                    while (true) {
                        const id = new Array(8)
                            .fill(0)
                            .map(() => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)])
                            .join("");

                        const doc = await db.short_links.findOneAndUpdate({ id }, { $setOnInsert: { url: body, user: user!.id } }, { upsert: true });
                        if (!doc) return { id };
                    }
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("short-links/write"), ratelimitCheck("short-link/create", 10000, 2)],
                    afterHandle: [ratelimitApply("short-link/create")],
                    body: t.String(),
                    detail: {
                        tags: ["V1"],
                        summary: "Post a URL and get a short link ID.",
                        description: trim(`
                            \`\`\`
                            Scope: short-links/write
                            \`\`\`
                            
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
