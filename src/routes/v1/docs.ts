import { t } from "elysia";
import crypto from "node:crypto";
import { App } from "../../lib/app.js";
import { hasScope, isCouncil, isObserver, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas, { fields, tcnDocEmbedData } from "../../lib/schemas.js";
import { TCNDoc, TCNDocEmbedData } from "../../lib/types.js";
import { trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/docs", (app) =>
        app
            .get(
                "/",
                async ({ query: { all }, user }) => {
                    if (all === "true" && !user!.observer) throw new APIError(403, codes.FORBIDDEN, "Only observers may fetch all documents.");
                    return (await db.docs.find(all === "true" ? {} : { author: user!.id }).toArray()) as unknown[] as TCNDoc[];
                },
                {
                    beforeHandle: [isSignedIn, hasScope("docs/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get all of your documents.",
                        description: trim(`
                            \`\`\`
                            Scope: docs/read
                            \`\`\`

                            Return an array containing all of your documents. For observers, set \`?all=true\` to return all documents.
                        `),
                    },
                    query: t.Object({
                        all: t.Optional(t.String({ description: "If true, return all documents (observer-only)." })),
                    }),
                    response: t.Array(schemas.tcnDocResponse),
                },
            )
            .get(
                "/:id",
                async ({ params: { id }, user }) => {
                    const doc = (await db.docs.findOne({ id })) as unknown as TCNDoc;

                    if (!doc || (doc.deleted && !(user?.observer || doc.author === user?.id)))
                        throw new APIError(404, codes.MISSING_DOCUMENT, `No document exists with ID ${id}, or it was deleted.`);

                    if (
                        doc.allowEveryone ||
                        user?.observer ||
                        user?.id === doc.author ||
                        (user?.council && doc.allowCouncil) ||
                        (user && (doc.allowLoggedIn || doc.allowlist.includes(user.id)))
                    ) {
                        if (doc.anon && !user?.observer && user?.id !== doc.author) doc.author = "1012321234321232101";
                        return doc;
                    }

                    return Object.fromEntries(Object.entries(doc).filter(([x]) => x.startsWith("embed"))) as TCNDocEmbedData;
                },
                {
                    detail: {
                        tags: ["V1"],
                        summary: "Get a document.",
                        description: trim(`
                            \`\`\`
                            Scope: docs/read
                            \`\`\`

                            Return a document. Requires view permissions on the document otherwise 403 will be returned, or 401 if the user is not signed in.
                            Authentication is optional if the document is public. The \`author\` field will be scrambled if \`anon\` is true unless the author
                            or an observer is viewing the document. Returns 404 if the document is deleted unless the author or an observer is requesting.

                            If 403 is removed, the response will contain the embed display data.
                        `),
                    },
                    params: t.Object({
                        id: fields.docId,
                    }),
                    response: t.Union([schemas.tcnDocResponse, t.Object(tcnDocEmbedData)]),
                },
            )
            .post(
                "/",
                async ({ body, user }) => {
                    while (true) {
                        const id = new Array(24)
                            .fill(0)
                            .map(() => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[crypto.randomInt(62)])
                            .join("");

                        const document: TCNDoc = { ...body, id, deleted: false, author: user!.id };
                        const doc = await db.docs.findOneAndUpdate({ id }, { $setOnInsert: document }, { upsert: true });

                        if (!doc) return { id };
                    }
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("docs/write")],
                    body: schemas.tcnDoc,
                    detail: {
                        tags: ["V1"],
                        summary: "Create a document.",
                        description: trim(`
                            \`\`\`
                            Scope: docs/write
                            \`\`\`

                            Create a document. Council-only. Returns the ID of the new document.
                        `),
                    },
                    response: t.Object({
                        id: fields.docId,
                    }),
                },
            )
            .patch(
                "/:id",
                async ({ body, params: { id }, user }) => {
                    const doc = (await db.docs.findOne({ id })) as unknown as TCNDoc;

                    if (!doc || doc.author !== user!.id)
                        throw new APIError(404, codes.MISSING_DOCUMENT, `No document exists with ID ${id}, or you are not its author.`);

                    if (!user!.observer) body.official = false;

                    await db.docs.updateOne({ id }, { $set: body });
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("docs/write")],
                    body: t.Object(Object.fromEntries(Object.entries(schemas.tcnDoc.properties).map(([x, y]) => [x, t.Optional(y)]))),
                    detail: {
                        tags: ["V1"],
                        summary: "Edit a document.",
                        description: trim(`
                            \`\`\`
                            Scopes: docs/write
                            \`\`\`

                            Edit a document. Owner-only. If you are not an observer, \`official\` will be set to \`false\` even if it is currently \`true\`.
                            Returns a 404 if the document exists or if you are not the owner; there is no distinction.
                        `),
                    },
                    params: t.Object({
                        id: fields.docId,
                    }),
                },
            )
            .delete(
                "/:id",
                async ({ params: { id } }) => {
                    const doc = await db.docs.findOneAndUpdate({ id }, { $set: { deleted: true } });
                    if (!doc) throw new APIError(404, codes.MISSING_DOCUMENT, `No document exists with ID ${id}.`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("docs/delete")],
                    detail: {
                        tags: ["V1"],
                        summary: "Delete a document. This route exists for observers to delete others' documents.",
                        description: trim(`
                            \`\`\`
                            Scopes: docs/delete
                            \`\`\`

                            Delete a document. Observer-only. To delete your own document, use \`PATCH /docs/:id\` with \`{ "deleted": true }\`.
                        `),
                    },
                    params: t.Object({
                        id: fields.docId,
                    }),
                },
            )
            .patch(
                "/:id/official",
                async ({ body: { official }, params: { id } }) => {
                    const doc = await db.docs.findOneAndUpdate({ id }, { $set: { official } });
                    if (!doc) throw new APIError(404, codes.MISSING_DOCUMENT, `No document exists with ID ${id}.`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("docs/official")],
                    body: t.Object({
                        official: t.Boolean({ description: "Whether to mark the document as official." }),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Set a document's official designation.",
                        description: trim(`
                            \`\`\`
                            Scopes: docs/official
                            \`\`\`

                            Set a document's official designation. Observer-only.
                        `),
                    },
                    params: t.Object({
                        id: fields.docId,
                    }),
                },
            ),
    );
