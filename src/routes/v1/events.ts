import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { AuditLogAction, headers, requiredError } from "../../lib/audit.js";
import { checkPermissions, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import data from "../../lib/data.js";
import db, { autoinc, withSession } from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { changes, trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/events", (app) =>
        app
            .get(
                "/",
                async () => {
                    return await data.getEvents(true);
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get all calendar events ending after 3 days ago and starting before 60 days from now.",
                        description: trim(`
                            Return an array containing calendar events.
                        `),
                    },
                },
            )
            .get(
                "/:id",
                async ({ params: { id } }) => {
                    return await data.getEvent(id);
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get a calendar event.",
                        description: trim(`
                            Return a single calendar event.
                        `),
                    },
                    params: t.Object({ id: t.Numeric({ description: "The ID of the event." }) }),
                },
            )
            .post(
                "/",
                async ({ body, user }) => {
                    const id = await autoinc("events");
                    await db.events.insertOne({ id, owner: user!.id, ...body });
                    audit(user, AuditLogAction.EVENTS_CREATE, { id, ...body });
                    return id;
                },
                {
                    beforeHandle: [isSignedIn, checkPermissions(({ user }) => user.council, "Only council members may create events on the calendar.")],
                    body: t.Object(Object.fromEntries(Object.entries(schemas.event.properties).filter(([x]) => x !== "id" && x !== "owner"))),
                    detail: {
                        tags: ["V1"],
                        summary: "Create a calendar event.",
                        description: trim(`
                            \`\`\`
                            Scope: events/write
                            \`\`\`
                            
                            Create a calendar event. Council-only. Returns the ID of the created event.
                        `),
                    },
                    response: t.Integer({ description: "The ID of the event." }),
                },
            )
            .patch(
                "/:id",
                async ({ body, params: { id }, user }) => {
                    const doc = await data.getEvent(id);

                    if (!user!.observer && doc.owner !== user!.id)
                        throw new APIError(403, codes.FORBIDDEN, `Only observers and the event owner may edit an event.`);

                    const $set: any = {};

                    for (const key of Object.keys(body))
                        if (key !== "invites" && body[key] !== undefined && body[key] !== (doc as any)[key]) $set[key] = body[key];

                    const inviteAdd: string[] = [];
                    const inviteRemove: string[] = [];

                    if (Array.isArray(body.invites)) {
                        for (const x of body.invites) if (!doc.invites.includes(x)) inviteAdd.push(x);
                        for (const x of doc.invites) if (!body.invites.includes(x)) inviteRemove.push(x);
                    }

                    if (inviteAdd.length + inviteRemove.length > 0) $set.invites = body.invites;

                    if (Object.keys($set).length === 0) return;

                    const changelist = changes(doc, body);
                    if (changelist.invites) delete changelist.invites;
                    if (inviteAdd.length > 0) changelist.inviteAdd = [, inviteAdd];
                    if (inviteRemove.length > 0) changelist.inviteRemove = [, inviteRemove];

                    await withSession(async () => {
                        await db.events.updateOne({ id }, { $set: body });

                        if (body.title !== doc.title)
                            await db.audit_logs.updateMany(
                                {
                                    actions: {
                                        $in: [
                                            AuditLogAction.EVENTS_CREATE,
                                            AuditLogAction.EVENTS_DELETE_OTHER,
                                            AuditLogAction.EVENTS_DELETE_SELF,
                                            AuditLogAction.EVENTS_EDIT,
                                        ],
                                    },
                                    "data.id": id,
                                },
                                { $set: { "data.title": body.title } },
                            );
                    });

                    audit(user, AuditLogAction.EVENTS_EDIT, { id, title: body.title ?? doc.title, changes: changelist });
                },
                {
                    beforeHandle: [isSignedIn],
                    body: t.Object(
                        Object.fromEntries(
                            Object.entries(schemas.event.properties)
                                .filter(([x]) => x !== "id" && x !== "owner")
                                .map(([x, y]) => [x, t.Optional(y)]),
                        ),
                    ),
                    detail: {
                        tags: ["V1"],
                        summary: "Edit a calendar event.",
                        description: trim(`
                            \`\`\`
                            Scope: events/write
                            \`\`\`

                            Edit a calendar event. Observer/owner-only.
                        `),
                    },
                    params: t.Object({ id: t.Numeric({ description: "The ID of the event." }) }),
                },
            )
            .delete(
                "/:id",
                async ({ params: { id }, reason, user }) => {
                    const doc = await data.getEvent(id);

                    if (!user!.observer && doc.owner !== user!.id)
                        throw new APIError(403, codes.FORBIDDEN, `Only observers and the event owner may delete an event.`);

                    if (doc.owner !== user!.id && !reason) throw new APIError(400, codes.INVALID_BODY, requiredError);

                    await db.events.deleteOne({ id });
                    audit(user, doc.owner === user!.id ? AuditLogAction.EVENTS_DELETE_SELF : AuditLogAction.EVENTS_DELETE_OTHER, doc, reason);
                },
                {
                    beforeHandle: [isSignedIn],
                    detail: {
                        tags: ["V1"],
                        summary: "Delete a calendar event.",
                        description: trim(`
                            \`\`\`
                            Scope: events/delete
                            \`\`\`

                            Delete a calendar event. Observer/owner-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({ id: t.Numeric({ description: "The ID of the event." }) }),
                },
            ),
    );
