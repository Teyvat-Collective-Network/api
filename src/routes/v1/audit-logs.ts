import { t } from "elysia";
import { App } from "../../lib/app.js";
import { AuditLogAction } from "../../lib/audit.js";
import { hasScope, isCouncil, isObserver, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { AuditLogEntry } from "../../lib/types.js";
import { trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/audit-logs", (app) =>
        app
            .get(
                "/",
                async ({ query: { before, limit, membership }, user }) => {
                    before ??= Date.now();
                    limit ??= 50;

                    const entries = (await db.audit_logs
                        .find({
                            time: { $lt: before },
                            ...(user!.observer && membership !== "true"
                                ? {}
                                : {
                                      action: {
                                          $in: [
                                              AuditLogAction.GUILDS_CREATE,
                                              AuditLogAction.GUILDS_EDIT,
                                              AuditLogAction.GUILDS_DELETE,
                                              AuditLogAction.USERS_PROMOTE,
                                              AuditLogAction.USERS_DEMOTE,
                                              AuditLogAction.USERS_TERM_REFRESH,
                                          ],
                                      },
                                  }),
                        })
                        .sort({ time: -1 })
                        .limit(limit)
                        .toArray()) as unknown[] as AuditLogEntry[];

                    entries.forEach((x) => (x.hidden ??= false));
                    return entries.map((x) => ({ ...x, token: undefined }));
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("audit-logs/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Fetch audit log entries.",
                        description: trim(`
                            \`\`\`
                            Scope: audit-logs/read
                            \`\`\`

                            Fetch audit log entries. Council-only. The tokens that triggered the actions are not returned; if you need to identify the token
                            that was used for an operation, consult with a developer / administrator. Non-observers only receive certain events.
                        `),
                    },
                    query: t.Object({
                        before: t.Optional(t.Numeric({ minimum: 0, description: "Return entries strictly before this timestamp." })),
                        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 50, description: "The number of entries to return." })),
                        membership: t.Optional(t.String({ description: "If true, restricts responses to those for the membership changes page." })),
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
            )
            .patch(
                "/:uuid",
                async ({ body: { hidden }, params: { uuid } }) => {
                    if (hidden === undefined) return;

                    const doc = await db.audit_logs.findOneAndUpdate({ uuid }, { $set: { hidden } });
                    if (!doc) throw new APIError(404, codes.MISSING_AUDIT_LOG_ENTRY, `No audit log entry exists with ID ${uuid}.`);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("audit-logs/write")],
                    body: t.Object({
                        hidden: t.Optional(t.Boolean({ description: "If true, do not show this entry to council members on the membership changes page." })),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Edit an audit log entry.",
                        description: trim(`
                            \`\`\`
                            Scope: audit-logs/write
                            \`\`\`

                            Edit an audit log entry. Note that hiding an entry only instructs the membership changes page to not display it, but the entry
                            itself will exist in the audit logs and be returned even to council members.
                        `),
                    },
                    params: t.Object({
                        uuid: t.Numeric({ minimum: 1, description: "The audit log entry UUID." }),
                    }),
                },
            ),
    );
