import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { AuditLogAction, headers } from "../../lib/audit.js";
import { hasScope, isObserver, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import db, { autoinc } from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/global", (app) =>
        app
            .get(
                "/filter",
                async () => {
                    return (
                        (await db.global_filter.find().toArray()) as unknown[] as {
                            id: number;
                            match: string;
                            user: string;
                            created: number;
                            lastUpdated: number;
                        }[]
                    ).sort((x, y) => x.match.localeCompare(y.match));
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("global/filter/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get the global chat filter.",
                        description: trim(`
                            \`\`\`
                            Scope: global/filter/read
                            \`\`\`

                            Get the global chat filter. Observer-only.
                        `),
                    },
                    response: t.Array(
                        t.Object({
                            id: t.Integer(),
                            match: t.String(),
                            user: schemas.snowflake(),
                            created: t.Number(),
                            lastUpdated: t.Number(),
                        }),
                    ),
                },
            )
            .post(
                "/filter",
                async ({ body, user }) => {
                    const id = await autoinc("global/filter");
                    await db.global_filter.insertOne({ id, match: body, user: user!.id, created: Date.now(), lastUpdated: Date.now() });
                    return { id };
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("global/filter/write")],
                    body: t.String(),
                    detail: {
                        tags: ["V1"],
                        summary: "Add a global chat filter entry.",
                        description: trim(`
                            \`\`\`
                            Scope: global/filter/write
                            \`\`\`

                            Add a global chat filter entry. Observer-only.
                        `),
                    },
                    response: t.Object({
                        id: t.Integer(),
                    }),
                },
            )
            .patch(
                "/filter/:id",
                async ({ params: { id }, body, user }) => {
                    const doc = await db.global_filter.findOneAndUpdate({ id }, { $set: { match: body, user: user!.id, lastUpdated: Date.now() } });
                    if (!doc) throw new APIError(404, codes.MISSING_GLOBAL_FILTER_ENTRY, `No global filter entry exists with ID ${id}.`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("global/filter/write")],
                    body: t.String(),
                    detail: {
                        tags: ["V1"],
                        summary: "Edit a global chat filter entry.",
                        description: trim(`
                            \`\`\`
                            Scope: global/filter/write
                            \`\`\`

                            Edit a global chat filter entry. Observer-only.
                        `),
                    },
                    params: t.Object({
                        id: t.Numeric(),
                    }),
                },
            )
            .delete(
                "/filter/:id",
                async ({ params: { id }, reason, user }) => {
                    const doc = await db.global_filter.findOneAndDelete({ id });
                    if (!doc) throw new APIError(404, codes.MISSING_GLOBAL_FILTER_ENTRY, `No global filter entry exists with ID ${id}.`);

                    audit(user!, AuditLogAction.GLOBAL_FILTER_DELETE, { id, match: doc.match }, reason);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("global/filter/write")],
                    detail: {
                        tags: ["V1"],
                        summary: "Delete a global chat filter entry.F",
                        description: trim(`
                            \`\`\`
                            Scope: global/filter/write
                            \`\`\`

                            Delete a global chat filter entry. Observer-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({
                        id: t.Numeric(),
                    }),
                },
            ),
    );
