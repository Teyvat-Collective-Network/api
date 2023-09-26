import { t } from "elysia";

const snowflake = (description: string) => t.String({ pattern: "^\\d{17,20}$", default: "1234567890987654321", description });
const id = (description: string) => t.String({ pattern: "^[a-z-]{1,32}$", default: "id", description });

export default {
    snowflake,
    id,
    user: t.Object({
        id: snowflake("The user's Discord ID."),
        guilds: t.Object(
            {},
            {
                additionalProperties: t.Object(
                    {
                        owner: t.Boolean({ description: "Whether or not the user is the owner of this guild." }),
                        advisor: t.Boolean({ description: "Whether or not the user is the council advisor for this guild." }),
                        voter: t.Boolean({ description: "Whether or not the user is the designated voter for this guild." }),
                        council: t.Boolean({ description: "Whether or not the user is a TCN council member on behalf of ths guild (owner or advisor)." }),
                        staff: t.Boolean({ description: "Whether or not the user is a staff member in this guild." }),
                        roles: t.Array(id("A role which the user has in this guild."), {
                            description: "Guild-specific roles that the user has in this guild.",
                        }),
                    },
                    { description: "An object representing guilds with which the user is associated where the keys are guild IDs." },
                ),
            },
        ),
        roles: t.Array(id("A role which the user has globally."), { description: "Roles which the user has globally." }),
        observer: t.Boolean({ description: "Whether or not the user is a TCN observer." }),
        owner: t.Boolean({ description: "Whether or not the user is the owner of a TCN guild." }),
        advisor: t.Boolean({ description: "Whether or not the user is the council advisor for a TCN guild." }),
        voter: t.Boolean({ description: "Whether or not the user is the designated voter for a TCN guild." }),
        council: t.Boolean({ description: "Whether or not the user is a TCN council member." }),
        staff: t.Boolean({ description: "Whether or not the user is a staff member in a TCN guild." }),
    }),
    guild: t.Object({
        id: snowflake("The guild's Discord ID."),
        name: t.String({ minLength: 1, maxLength: 64, description: "The TCN name of the guild." }),
        mascot: id("The guild's mascot character ID."),
        invite: t.String({ description: "An invite code pointing to the guild." }),
        owner: snowflake("The Discord ID of the guild's owner."),
        advisor: t.Optional(t.Nullable(snowflake("The Discord ID of the guild's council advisor."))),
        voter: snowflake("The Discord ID of the guild's designated voter."),
        delegated: t.Boolean({ description: "Whether or not the guild's designated voter is currently delegated to its council advisor." }),
        users: t.Object(
            {},
            {
                additionalProperties: t.Object({
                    staff: t.Boolean({ description: "Whether or not this user is a staff member of the guild." }),
                    roles: t.Array(id("A role which this user has in the guild."), { description: "Guild-specific roles that this user has in the guild." }),
                }),
                description: "An object representing users associated with this guild where the keys are user IDs.",
            },
        ),
    }),
    character: t.Object({
        id: id("The character's ID."),
        name: t.String({ minLength: 1, maxLength: 64, description: "The character's full name." }),
        short: t.Optional(
            t.Nullable(t.String({ minLength: 1, maxLength: 64, description: "The character's short name (if different from their full name)." })),
        ),
        attributes: t.Object({}, { additionalProperties: t.String(), description: "An object containing the character's additional attributes." }),
    }),
    attribute: t.Object({
        type: id("The attribute's type (used as the key in the character attributes object)"),
        id: id("The attribute's ID."),
        name: t.String({ minLength: 1, maxLength: 64, description: "The name of the attribute." }),
        emoji: t.String({ minLength: 1, maxLength: 64, description: "The emoji associated with the attribute." }),
    }),
    event: t.Object({
        id: t.Integer({ description: "The ID of the event." }),
        owner: snowflake("The Discord ID of the owner (author) of this event."),
        start: t.Integer({ description: "The millisecond timestamp of the event's start." }),
        end: t.Integer({ description: "The millisecond timestamp of the event's end." }),
        title: t.String({ minLength: 1, maxLength: 256, description: "The event's title." }),
        body: t.String({ minLength: 1, maxLength: 4096, description: "The event's body (supports markdown)." }),
        invites: t.Array(t.String({ minLength: 1, maxLength: 32 }), { maxItems: 16, description: "An array of invite codes to display for this event." }),
    }),
};
