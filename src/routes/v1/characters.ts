import { t } from "elysia";
import { App } from "../../index.js";
import { hasScope, isObserver, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import data from "../../lib/data.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { trim } from "../../lib/utils.js";

export default (app: App) =>
    app.group("/characters", (app) =>
        app
            .get(
                "/",
                async () => {
                    return await data.getCharacters();
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get all characters.",
                        description: trim(`
                            Return an array containing all characters.
                        `),
                    },
                    response: t.Array(schemas.character),
                },
            )
            .get(
                "/:id",
                async ({ params: { id } }) => {
                    return await data.getCharacter(id);
                },
                {
                    detail: {
                        tags: ["V1"],
                        security: [],
                        summary: "Get a character.",
                        description: trim(`
                            Get a character by ID.
                        `),
                    },
                    params: t.Object({ id: schemas.character.properties.id }),
                    response: schemas.character,
                },
            )
            .post(
                "/:id",
                async ({ body, params: { id } }) => {
                    if ((await db.characters.countDocuments({ id })) > 0) throw new APIError(409, codes.DUPLICATE, `A character already exists with ID ${id}.`);
                    if (body.attributes) for (const [type, id] of Object.entries(body.attributes as Record<string, string>)) await data.getAttribute(type, id);

                    await db.characters.insertOne({ id, name: body.name, short: body.short, attributes: body.attributes ?? {} });
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("characters/write")],
                    body: t.Object({
                        name: schemas.character.properties.name,
                        short: schemas.character.properties.short,
                        attributes: t.Optional(schemas.character.properties.attributes),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Create a character.",
                        description: trim(`
                            \`\`\`
                            Scope: characters/write
                            \`\`\`

                            Create a new character (insert a Genshin Impact character into the API). Observer-only.
                        `),
                    },
                    params: t.Object({ id: schemas.character.properties.id }),
                },
            )
            .patch(
                "/:id",
                async ({ body, params: { id } }) => {
                    await data.getCharacter(id);

                    if (body.id && (await db.characters.countDocuments({ id: body.id })) > 0)
                        throw new APIError(409, codes.DUPLICATE, `A character already exists with ID ${body.id}.`);

                    const $set: any = {};
                    const $unset: any = {};

                    if (body.id) $set.id = body.id;
                    if (body.name) $set.name = body.name;

                    if (body.short !== undefined)
                        if (body.short === null) $unset.short = 0;
                        else $set.short = body.short;

                    for (const [type, id] of Object.entries((body.attributes as Record<string, string>) ?? {}))
                        if (id === null) $unset[`attributes.${type}`] = 0;
                        else {
                            await data.getAttribute(type, id);
                            $set[`attributes.${type}`] = id;
                        }

                    await db.characters.updateOne({ id }, { $set, $unset });
                    await db.guilds.updateMany({ mascot: id }, { $set: { mascot: body.id } });
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("characters/write")],
                    body: t.Object({
                        id: t.Optional(schemas.character.properties.id),
                        name: t.Optional(schemas.character.properties.name),
                        short: t.Optional(t.Nullable(schemas.character.properties.short)),
                        attributes: t.Optional(
                            t.Object(
                                {},
                                {
                                    additionalProperties: t.Nullable(t.String()),
                                    description: "An object containing the character's additional attributes. Set a value to null to remove the attribute.",
                                },
                            ),
                        ),
                    }),
                    detail: {
                        tags: ["V1"],
                        summary: "Update a character.",
                        description: trim(`
                            \`\`\`
                            Scope: characters/write
                            \`\`\`

                            Update a character. Observer-only. Changing the ID is only allowed if another character does not already use that ID. All references
                            to the character will be updated. Set the short name to \`null\` to remove it.
                        `),
                    },
                    params: t.Object({ id: schemas.character.properties.id }),
                },
            )
            .delete(
                "/:id",
                async ({ params: { id } }) => {
                    const { name } = await data.getCharacter(id);

                    if ((await db.guilds.countDocuments({ mascot: id })) > 0)
                        throw new APIError(
                            400,
                            codes.INVALID_BODY,
                            `At least one guild still has ${name} as their mascot and therefore the character cannot be deleted.`,
                        );

                    await db.characters.deleteOne({ id });
                },
                {
                    beforeHandle: [isSignedIn, isObserver, hasScope("characters/delete")],
                    detail: {
                        tags: ["V1"],
                        summary: "Delete a character.",
                        description: trim(`
                            \`\`\`
                            Scope: characters/delete
                            \`\`\`

                            Delete a character. Observer-only. This is only allowed if no server has this character as their mascot.
                        `),
                    },
                    params: t.Object({ id: schemas.character.properties.id }),
                },
            ),
    );
