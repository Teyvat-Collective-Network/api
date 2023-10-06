import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { AuditLogAction, headers } from "../../lib/audit.js";
import { hasScope, isCouncil, isObserver, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { ObservationRecord } from "../../lib/types.js";
import { changes, nonempty, trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/observation-records", (app) =>
        app
            .get(
                "/",
                async () => {
                    return (await db.observation_records.find().toArray()) as unknown[] as ObservationRecord[];
                },
                {
                    beforeHandle: [isSignedIn, isCouncil, hasScope("records/read")],
                    detail: {
                        tags: ["V1"],
                        summary: "Get observation records.",
                        description: trim(`
                            \`\`\`
                            Scope: records/read
                            \`\`\`

                            Get observation records. Council-only.
                        `),
                    },
                    response: t.Array(schemas.observationRecord),
                },
            )
            .patch(
                "/:uuid",
                async ({ body, params: { uuid }, reason, user }) => {
                    if (body.notes) body.notes = body.notes.trim();

                    const doc = await db.observation_records.findOne({ uuid });
                    if (!doc) throw new APIError(404, codes.MISSING_OBSERVATION_RECORD, `No observation record exists with UUID ${uuid}.`);

                    const $set: any = {};
                    for (const [key, value] of Object.entries(body)) if (value !== undefined && doc[key] !== value) $set[key] = value;

                    nonempty($set);

                    if (
                        $set.status &&
                        ![
                            "pending",
                            "rejection_vote",
                            "retracted",
                            "declined",
                            "rejected",
                            "canceled",
                            "observing",
                            "observed",
                            "report_wip",
                            "vote_waiting",
                            "voting",
                            "inducted",
                            "preapproved",
                        ].includes($set.status)
                    )
                        throw new APIError(400, codes.INVALID_BODY, `Invalid status ${$set.status}.`);

                    await db.observation_records.findOneAndUpdate({ uuid }, { $set });

                    if ($set.name !== undefined) await db.audit_logs.updateMany({ id: doc.id }, { $set: { name: $set.name } });

                    audit(
                        user,
                        AuditLogAction.OBSERVATION_RECORD_EDIT,
                        { uuid, id: doc.id, name: body.name === null ? null : body.name ?? doc.name, changes: changes(doc, body) },
                        reason,
                    );
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("records/write")],
                    body: t.Object({
                        hidden: t.Optional(schemas.observationRecord.properties.hidden),
                        name: t.Optional(schemas.observationRecord.properties.name),
                        observer: t.Optional(schemas.observationRecord.properties.observer),
                        start: t.Optional(schemas.observationRecord.properties.start),
                        end: t.Optional(schemas.observationRecord.properties.end),
                        status: t.Optional(schemas.observationRecord.properties.status),
                        notes: t.Optional(schemas.observationRecord.properties.notes),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Update an observation record.",
                        description: trim(`
                            \`\`\`
                            Scope: records/write
                            \`\`\`

                            Update an observation record. Observer-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({
                        uuid: t.Numeric({ description: "A unique auto-incrementing ID for observation records." }),
                    }),
                },
            )
            .use((app) => app),
    );
