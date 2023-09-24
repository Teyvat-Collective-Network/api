import { t } from "elysia";
import { App } from "../../index.js";
import data from "../../lib/data.js";
import schemas from "../../lib/schemas.js";
import { Attribute } from "../../lib/types.js";
import { trim } from "../../lib/utils.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import codes from "../../lib/codes.js";
import { hasScope, isObserver, isSignedIn } from "../../lib/checkers.js";

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
                async ({ body, params: { type, id } }) => {
                    if ((await db.attributes.countDocuments({ type, id })) > 0)
                        throw new APIError(409, codes.DUPLICATE, `An attribute already exists with type ${type} and ID ${id}.`);

                    await db.attributes.insertOne({ type, id, name: body.name, emoji: body.emoji });
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
                    params: t.Object({
                        type: schemas.attribute.properties.type,
                        id: schemas.attribute.properties.id,
                    }),
                },
            )
            .patch(
                "/:type/:id",
                async ({ body, params: { type, id } }) => {
                    await data.getAttribute(type, id);

                    if (body.id && (await db.attributes.countDocuments({ type, id: body.id })) > 0)
                        throw new APIError(409, codes.DUPLICATE, `An attribute already exists with type ${type} and ID ${body.id}.`);

                    const $set: any = {};

                    if (body.id) $set.id = body.id;
                    if (body.name) $set.name = body.name;
                    if (body.emoji) $set.emoji = body.emoji;

                    await db.attributes.updateOne({ type, id }, { $set });

                    if (body.id) await db.characters.updateMany({ [`attributes.${type}`]: id }, { $set: { [`attributes.${type}`]: body.id } });
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
                    params: t.Object({
                        type: schemas.attribute.properties.type,
                        id: schemas.attribute.properties.id,
                    }),
                },
            )
            .delete(
                "/:type/:id",
                async ({ params: { type, id } }) => {
                    await data.getAttribute(type, id);
                    await db.attributes.deleteOne({ type, id });
                    await db.characters.updateMany({ [`attributes.${type}`]: id }, { $unset: { [`attributes.${type}`]: 0 } });
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
                    params: t.Object({
                        type: schemas.attribute.properties.type,
                        id: schemas.attribute.properties.id,
                    }),
                },
            ),
    );
