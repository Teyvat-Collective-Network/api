import { t } from "elysia";
import { App } from "../../lib/app.js";
import { hasScope, isObserver, isSignedIn } from "../../lib/checkers.js";
import { trim } from "../../lib/utils.js";
import schemas from "../../lib/schemas.js";
import db from "../../lib/db.js";
import { AuditLogEntry } from "../../lib/types.js";
import { AuditLogAction } from "../../lib/audit.js";
import { APIError } from "../../lib/errors.js";
import codes from "../../lib/codes.js";

export default (app: App) =>
    app.group("/audit-logs", (app) =>
        app
            .get(
                "/",
                async ({ query: { before, limit } }) => {
                    before ??= Date.now();
                    limit ??= 50;

                    const entries = (await db.audit_logs
                        .find({ time: { $lt: before } })
                        .sort({ time: -1 })
                        .limit(limit)
                        .toArray()) as unknown[] as AuditLogEntry[];

                    return entries.map((x) => ({ ...x, token: undefined }));
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("audit-logs/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Fetch audit log entries.",
                        description: trim(`
                            \`\`\`
                            Scope: audit-logs/read
                            \`\`\`

                            Fetch audit log entries. Observer-only. The tokens that triggered the actions are not returned; if you need to identify the token
                            that was used for an operation, consult with a developer / administrator.
                        `),
                    },
                    query: t.Object({
                        before: t.Optional(t.Numeric({ minimum: 0, description: "Return entries strictly before this timestamp." })),
                        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 50, description: "The number of entries to return." })),
                    }),
                    response: t.Array(schemas.auditLogEntry),
                },
            )
            .get(
                "/:uuid",
                async ({ params: { uuid }, query: { action } }) => {
                    const doc = (await db.audit_logs.findOne({ uuid, ...(action ? { action } : {}) })) as unknown as AuditLogEntry;
                    if (!doc)
                        throw new APIError(
                            404,
                            codes.MISSING_AUDIT_LOG_ENTRY,
                            `No audit log entry exists with ID ${uuid}${action ? ` and action type ${action}` : ""}.`,
                        );

                    return { ...doc, token: undefined };
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("audit-logs/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get an audit log entry.",
                        description: trim(`
                            \`\`\`
                            Scope: audit-logs/read
                            \`\`\`

                            Fetch an audit log entry. Observer-only. Set the query parameter to return 404 if the wrong type is found.
                        `),
                    },
                    params: t.Object({
                        uuid: t.Numeric({ minimum: 1, description: "The audit log entry UUID." }),
                    }),
                    query: t.Object({
                        action: t.Optional(t.String({ description: "Require the entry to be of this action type." })),
                    }),
                },
            ),
    );
