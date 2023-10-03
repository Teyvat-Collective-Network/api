import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { headers, requiredError } from "../../lib/audit.js";
import { checkPermissions, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import data from "../../lib/data.js";
import db, { autoinc } from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { trim } from "../../lib/utils.js";

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
                    audit(user, "events/create", { id, ...body });
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
                    const entry = await data.getEvent(id);

                    if (!user!.observer && entry.owner !== user!.id)
                        throw new APIError(403, codes.FORBIDDEN, `Only observers and the event owner may edit an event.`);

                    await db.events.updateOne({ id }, { $set: body });
                    audit(user, "events/edit", { id, ...body });
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
                    const entry = await data.getEvent(id);

                    if (!user!.observer && entry.owner !== user!.id)
                        throw new APIError(403, codes.FORBIDDEN, `Only observers and the event owner may delete an event.`);

                    if (entry.owner !== user!.id && !reason) throw new APIError(400, codes.INVALID_BODY, requiredError);

                    await db.events.deleteOne({ id });
                    audit(user, `events/delete/${entry.owner === user!.id ? "self" : "other"}`, { id }, reason);
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
