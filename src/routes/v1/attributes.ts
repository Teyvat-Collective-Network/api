import { t } from "elysia";
import { App } from "../../lib/app.js";
import audit, { AuditLogAction, headers } from "../../lib/audit.js";
import { hasScope, isObserver, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import data from "../../lib/data.js";
import db, { withSession } from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { Attribute } from "../../lib/types.js";
import { changes, nonempty, trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/attributes", (app) =>
        app
            .get(
                "/",
                async () => {
                    const obj: Record<string, Record<string, Attribute>> = {};

                    for (const attribute of await data.getAttributes()) {
                        (obj[attribute.type] ??= {})[attribute.id] = attribute;
                    }

                    return obj;
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get all character attributes.",
                        description: trim(`
                            Get all character attributes. Returns an object where the keys are types and the values are objects. Each sub-object's keys are IDs and
                            the values are the full attributes.
                        `),
                    },
                },
            )
            .get(
                "/:type/:id",
                async ({ params: { type, id } }) => {
                    return await data.getAttribute(type, id);
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get a character attribute.",
                        description: trim(`
                            Get a character attribute by type and ID.
                        `),
                    },
                    response: schemas.attribute,
                },
            )
            .post(
                "/:type/:id",
                async ({ body, params: { type, id }, reason, user }) => {
                    if ((await db.attributes.countDocuments({ type, id })) > 0)
                        throw new APIError(409, codes.DUPLICATE, `An attribute already exists with type ${type} and ID ${id}.`);

                    const data = { type, id, name: body.name, emoji: body.emoji };
                    await db.attributes.insertOne(data);
                    audit(user, AuditLogAction.ATTRIBUTES_CREATE, data, reason);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("attributes/write")],
                    body: t.Object({
                        name: schemas.attribute.properties.name,
                        emoji: schemas.attribute.properties.name,
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Create a character attribute.",
                        description: trim(`
                            \`\`\`
                            Scope: attributes/write
                            \`\`\`

                            Create an attribute. Observer-only.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({
                        type: schemas.attribute.properties.type,
                        id: schemas.attribute.properties.id,
                    }),
                },
            )
            .patch(
                "/:type/:id",
                async ({ body, params: { type, id }, reason, user }) => {
                    const doc = await data.getAttribute(type, id);
                    const newId = body.id && body.id !== id ? body.id : null;

                    if (newId && (await db.attributes.countDocuments({ type, id: newId })) > 0)
                        throw new APIError(409, codes.DUPLICATE, `An attribute already exists with type ${type} and ID ${newId}.`);

                    const $set: any = {};

                    if (newId) $set.id = newId;
                    if (body.name && body.name !== doc.name) $set.name = body.name;
                    if (body.emoji && body.emoji !== doc.emoji) $set.emoji = body.emoji;

                    nonempty($set);

                    await withSession(async () => {
                        await db.attributes.updateOne({ type, id }, { $set });

                        if (newId) {
                            await db.audit_logs.updateMany(
                                { action: { $in: [AuditLogAction.ATTRIBUTES_CREATE, AuditLogAction.ATTRIBUTES_EDIT] }, "data.type": type, "data.id": id },
                                { $set: { "data.id": newId } },
                            );

                            await db.audit_logs.updateMany(
                                { action: { $in: [AuditLogAction.CHARACTERS_CREATE, AuditLogAction.CHARACTERS_DELETE] }, [`data.attributes.${type}`]: id },
                                { $set: { [`data.attributes.${type}`]: newId } },
                            );

                            for (const x of [0, 1])
                                await db.audit_logs.updateMany(
                                    { action: AuditLogAction.CHARACTERS_EDIT, [`data.changes.attributes/${type}.${x}`]: id },
                                    { $set: { [`data.changes.attributes/${type}.${x}`]: newId } },
                                );

                            await db.characters.updateMany({ [`attributes.${type}`]: id }, { $set: { [`attributes.${type}`]: newId } });
                        }
                    });

                    audit(user, AuditLogAction.ATTRIBUTES_EDIT, { type, id: newId ?? id, changes: changes(doc, body) }, reason);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("attributes/write")],
                    body: t.Object({
                        id: t.Optional(schemas.attribute.properties.id),
                        name: t.Optional(schemas.attribute.properties.name),
                        emoji: t.Optional(schemas.attribute.properties.emoji),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Update a character attribute.",
                        description: trim(`
                            \`\`\`
                            Schema: attributes/write
                            \`\`\`

                            Update a character attribute. Observer-only. Changing the ID is only allowed if the new ID does not conflict with an existing
                            attribute of the same type. Editing the type is not supported. All references to the attribute will also be updated.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({
                        type: schemas.attribute.properties.type,
                        id: schemas.attribute.properties.id,
                    }),
                },
            )
            .delete(
                "/:type/:id",
                async ({ params: { type, id }, reason, user }) => {
                    const doc = await data.getAttribute(type, id);

                    await withSession(async () => {
                        await db.attributes.deleteOne({ type, id });
                        await db.characters.updateMany({ [`attributes.${type}`]: id }, { $unset: { [`attributes.${type}`]: 0 } });
                    });

                    audit(user, AuditLogAction.ATTRIBUTES_DELETE, doc, reason);
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("attributes/delete")],
                    detail: {
                        tags: ["V1"],
                        summary: "Delete a character attribute.",
                        description: trim(`
                            \`\`\`
                            Scope: attributes/delete
                            \`\`\`

                            Delete a character attribute. Observer-only. All references to the attribute will also be removed.
                        `),
                    },
                    headers: headers(),
                    params: t.Object({
                        type: schemas.attribute.properties.type,
                        id: schemas.attribute.properties.id,
                    }),
                },
            ),
    );
