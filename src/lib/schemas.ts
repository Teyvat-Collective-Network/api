import { t } from "elysia";

function requireIf(required: boolean, item: any) {
    return required ? item : t.Optional(item);
}

const snowflake = (description?: string) =>
    t.String({
        pattern: "^[1-9][0-9]{16,19}$",
        default: "1012321234321232101",
        description,
        error: `Invalid ID: must be a valid Discord snowflake (17-20 digit number).${description ? ` (description: "${description}")` : ""}`,
    });

const id = (description?: string) =>
    t.String({
        pattern: "^[a-z-]{1,32}$",
        default: "id",
        description,
        error: `Invalid ID: must be 1-32 lowercase letters or dashes.${description ? ` (description: "${description}")` : ""}`,
    });

const reason = t.String({ minLength: 1, maxLength: 256, description: "The reason for this action.", error: "Audit log reason must be 1-256 characters." });

export const fields = {
    docId: t.String({
        minLength: 24,
        maxLength: 32,
        pattern: "^[A-Za-z0-9]+$",
        description: "The unique ID of this document.",
        default: "MKlOWWndmmrMBgOwUjmRv271",
    }),
};

export const tcnDocEmbedData = {
    embedTitle: t.String({
        minLength: 1,
        maxLength: 256,
        description: "The title of the embed when the link to this document is posted in Discord.",
        error: "Embed title must be 1-256 characters.",
    }),
    embedBody: t.String({
        minLength: 1,
        maxLength: 4096,
        description: "The body of the embed when the link to this document is posted in Discord.",
        error: "Embed body must be 1-4096 characters.",
    }),
    embedColor: t.Integer({
        minimum: 0,
        maximum: 0xffffff,
        description: "The color of the embed when the link to this document is posted in Discord.",
        error: "Embed color must be 0x000000-0xFFFFFF,",
    }),
    embedImage: t.String({
        minLength: 0,
        maxLength: 1024,
        description: "The image shown in the embed when the link to this document is posted in Discord, if any.",
        error: "Embed image link must be 0-1024 characters.",
    }),
    embedThumbnail: t.Boolean({ description: "Whether the embed image should appear as a thumbnail instead of a full-size image." }),
};

const objects = {
    banshareSettings: {
        channel: t.Nullable(snowflake("The ID of the channel to which to send banshares, or null to not send banshares.")),
        blockdms: t.Boolean({ description: "If true, do not send DM scam banshares to this server." }),
        nobutton: t.Boolean({ description: "If true, do not show the ban button on non-autobanned banshares." }),
        daedalus: t.Boolean({ description: "If true, append banshares to Daedalus user history." }),
        autoban: t.Integer({
            minimum: 0,
            maximum: 0b11111111,
            description:
                "Which banshares to automatically execute as an 8-bit bitfield. Bit 1 for P0 banshares against non-members, bit 2 for P1 against non-members, etc., bit 5 for P0 against members, etc., bit 8 for DM against members.",
            error: "Bitfield must be 8 bits long (0x00 to 0xFF).",
        }),
    },
    tcnDoc: {
        deleted: t.Boolean({ description: "Whether this document is deleted." }),
        official: t.Boolean({ description: "Whether this document is marked as officially endorsed." }),
        anon: t.Boolean({ description: "If true, the document will hide the author's name." }),
        allowCouncil: t.Boolean({ description: "If true, council members are allowed to view this document." }),
        allowEveryone: t.Boolean({ description: "If true, this document is fully public." }),
        allowLoggedIn: t.Boolean({ description: "If true, allow all users who are logged in to view this document." }),
        allowlist: t.Array(snowflake(), { description: "An array of users (IDs) who are allowed to view this document." }),
        title: t.String({ minLength: 1, maxLength: 256, description: "The title of this document.", error: "Title must be 1-256 characters." }),
        body: t.String({ minLength: 1, maxLength: 16384, description: "The main content of this document.", error: "Body must be 1-16384 characters." }),
        ...tcnDocEmbedData,
    },
};

const pollData = (response: boolean) =>
    t.Intersect([
        t.Object({
            ...(response
                ? {
                      id: t.Integer({ minimum: 1, description: "The ID of the poll" }),
                      message: snowflake("The ID of the message of the poll (may be out of date)."),
                      close: t.Integer({ description: "The millisecond timestamp of when the poll is scheduled to close." }),
                      closed: t.Boolean({
                          description:
                              "If true, this poll has been closed. This may be false even if the close field is in the past, indicating the poll still needs to be processed.",
                      }),
                  }
                : {}),
            duration: t.Number({ minimum: 0, description: "The duration of the poll in hours at its last edit (the close field contains its real end time)." }),
            dm: t.Boolean({ description: "Whether or not to trigger a DM reminder 24 hours before the poll closes." }),
            live: t.Boolean({ description: "Whether or not to display votes in real-time." }),
            restricted: t.Boolean({ description: "If true, only designated voters can vote." }),
            quorum: t.Integer({ minimum: 0, maximum: 100, description: "The required voter turnout." }),
        }),
        t.Union([
            t.Object({
                mode: t.Enum({ mode: "proposal" }),
                question: t.String({ minLength: 1, maxLength: 256, description: "The question to display." }),
            }),
            t.Object({
                mode: t.Enum({ mode: "induction" }),
                preinduct: t.Boolean({ description: "If true, the mascot is not yet official." }),
                server: t.String({ minLength: 1, maxLength: 64, description: "The display name of the server." }),
            }),
            t.Object({
                mode: t.Enum({ mode: "election" }),
                wave: t.Integer({ minimum: 1, description: "The wave of the election." }),
                seats: t.Integer({ minimum: 1, description: "The number of seats open for this election." }),
                candidates: t.Array(snowflake(), { minItems: 1, maxItems: 20, description: "The array of candidates' user IDs." }),
            }),
            t.Object({
                mode: t.Enum({ mode: "selection" }),
                question: t.String({ minLength: 1, maxLength: 256, description: "The question to display." }),
                min: t.Integer({ minimum: 0, description: "The minimum number of options a voter must select." }),
                max: t.Integer({ minimum: 1, description: "The maximum number of options a voter may select." }),
                options: t.Array(t.String({ minLength: 1, maxLength: 100 }), {
                    minItems: 2,
                    maxItems: 10,
                    description: "The options available for selection.",
                }),
            }),
        ]),
    ]);

const voteData = (response: boolean) =>
    t.Object({
        ...(response
            ? {
                  poll: t.Integer({ minimum: 1, description: "The ID of the poll." }),
                  user: snowflake("The ID of the user to whom this ballot belongs."),
                  mode: t.String({ description: "The mode of the poll" }),
              }
            : {}),
        abstain: requireIf(response, t.Boolean({ description: "If true, this is an abstain ballot and other values should be ignored." })),
        yes: requireIf(response, t.Boolean({ description: "For proposal votes, whether the vote is yes or not." })),
        verdict: requireIf(response, t.String({ description: "For induction votes, the verdict for which the user has voted." })),
        candidates: requireIf(
            response,
            t.Object({}, { additionalProperties: t.Integer(), description: "For elections, a map of candidate user IDs to ranks" }),
        ),
        selected: requireIf(response, t.Array(t.String(), { description: "For selection votes, the list of options the user has selected." })),
    });

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
        observerSince: t.Integer({ description: "The millisecond timestamp at which this user's current term began. Undefined behavior for non-observers." }),
    }),
    guild: t.Object({
        id: snowflake("The guild's Discord ID."),
        name: t.String({ minLength: 1, maxLength: 64, description: "The TCN name of the guild.", error: "Guild name must be 1-64 characters." }),
        mascot: id("The guild's mascot character ID."),
        invite: t.String({ description: "An invite code pointing to the guild." }),
        owner: snowflake("The Discord ID of the guild's owner."),
        advisor: t.Nullable(snowflake("The Discord ID of the guild's council advisor.")),
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
        name: t.String({ minLength: 1, maxLength: 64, description: "The character's full name.", error: "Character name must be 1-64 characters." }),
        short: t.Optional(
            t.Nullable(
                t.String({
                    minLength: 1,
                    maxLength: 64,
                    description: "The character's short name (if different from their full name).",
                    error: "Character short name must be 1-64 characters.",
                }),
            ),
        ),
        attributes: t.Object({}, { additionalProperties: t.String(), description: "An object containing the character's additional attributes." }),
    }),
    attribute: t.Object({
        type: id("The attribute's type (used as the key in the character attributes object)"),
        id: id("The attribute's ID."),
        name: t.String({ minLength: 1, maxLength: 64, description: "The name of the attribute.", error: "Attribute name must be 1-64 characters." }),
        emoji: t.String({
            minLength: 1,
            maxLength: 64,
            description: "The emoji associated with the attribute.",
            error: "Attribute emoji must be 1-64 characters.",
        }),
    }),
    event: t.Object({
        id: t.Integer({ description: "The ID of the event." }),
        owner: snowflake("The Discord ID of the owner (author) of this event."),
        start: t.Integer({ description: "The millisecond timestamp of the event's start." }),
        end: t.Integer({ description: "The millisecond timestamp of the event's end." }),
        title: t.String({ minLength: 1, maxLength: 256, description: "The event's title.", error: "Event title must be 1-256 characters." }),
        body: t.String({ minLength: 1, maxLength: 4096, description: "The event's body (supports markdown).", error: "Event body must be 1-4096 characters." }),
        invites: t.Array(t.String({ minLength: 1, maxLength: 32, error: "Invites must be 1-32 characters." }), {
            maxItems: 16,
            description: "An array of invite codes to display for this event.",
            error: "Invite array must contain 0-16 items.",
        }),
    }),
    banshareCreate: t.Object({
        ids: t.String({
            description: "A space-separated list of IDs. If absolutely needed, a URL (or other string) is acceptable, but `skipChecks` must be enabled.",
        }),
        reason: t.String({
            minLength: 1,
            maxLength: 498,
            description: "The reason for the banshare, which is also put in autoban audit log reasons.",
            error: "Reason must be 1-498 characters.",
        }),
        evidence: t.String({
            minLength: 1,
            maxLength: 1000,
            description: "Evidence for the banshare, which should be enough for an uninvolved staff member to determine the banshare as valid.",
            error: "Evidence must be 1-1000 characters.",
        }),
        server: snowflake("The ID of the guild from which the banshare is being submitted."),
        severity: t.String({ description: "P0, P1, P2, or DM." }),
        urgent: t.Boolean({ description: "If true, the alert will ping all observers to review the banshare urgently." }),
        skipValidation: t.Boolean({ description: "Skip checking that the IDs point to valid users." }),
        skipChecks: t.Boolean({ description: "Skip checking the format of the ID input entirely (also prevents autoban from working)." }),
    }),
    banshareResponse: t.Object({
        message: snowflake("The ID of the message of the banshare in HQ."),
        status: t.String({ description: "The status of the banshare (pending, rejected, published, rescinded)." }),
        urgent: t.Boolean({ description: "If true, the alert pinged all observers to review the banshare urgently and will remind observers more often." }),
        ids: t.String({
            description: "The ID field of the banshare embed. This is most likely a space-separated list of IDs, but this should not be assumed.",
        }),
        idList: t.Array(snowflake(), { description: "An array of parsed user IDs. These may not necessarily be valid. This may be empty." }),
        reason: t.String({ minLength: 1, maxLength: 498, description: "The reason for the banshare, which is also put in autoban audit log reasons." }),
        evidence: t.String({ minLength: 1, maxLength: 1000, description: "Evidence for the banshare." }),
        server: snowflake("The ID of the guild from which the banshare was submitted."),
        severity: t.String({ description: "P0, P1, P2, or DM." }),
        author: snowflake("The ID of the user who submitted the banshare."),
        created: t.Integer({ description: "The millisecond timestamp of when the banshare was created." }),
        reminded: t.Integer({
            description: "The millisecond timestamp of when a reminder was last triggered for the banshare, which starts at the creation date.",
        }),
        publisher: t.Optional(snowflake("The ID of the user who published the banshare, if it is or was published.")),
        rejecter: t.Optional(snowflake("The ID of the user who rejected the banshare, if it is rejected.")),
        rescinder: t.Optional(snowflake("The ID of the user who rescinded the banshare, if it is rescinded.")),
        explanation: t.Optional(t.String({ description: "The explanation for this banshare's rescinding, if it is rescinded." })),
    }),
    banshareSettings: t.Object(objects.banshareSettings),
    banshareSettingsResponse: t.Object({
        ...objects.banshareSettings,
        guild: snowflake("The ID of the guild."),
        logs: t.Array(snowflake(), { description: "An array of logging channel IDs." }),
    }),
    tcnDoc: t.Object(objects.tcnDoc),
    tcnDocResponse: t.Object({
        id: fields.docId,
        author: snowflake("The ID of the author of this document."),
        ...objects.tcnDoc,
    }),
    reason: (required: boolean = false) => (required ? reason : t.Optional(reason)),
    auditLogEntry: t.Object({
        hidden: t.Boolean({
            description: "If true, hide the entry in the membership changes page. This is client-side and entries are still returned, just not shown.",
        }),
        uuid: t.Integer({ description: "A unique auto-incrementing ID for audit log entries." }),
        time: t.Integer({ description: "The timestamp at which the action occurred." }),
        user: snowflake("The ID of the user who took the action."),
        action: t.String({ description: "The unique code for the action type." }),
        data: t.Any({ description: "Context for the action." }),
        reason: t.Nullable(t.String({ description: "The provided reason for the action." })),
    }),
    observationRecord: t.Object({
        uuid: t.Integer({ description: "A unique auto-incrementing ID for observation records." }),
        id: snowflake("The ID of the guild."),
        hidden: t.Boolean({ description: "If true, hide the entry." }),
        name: t.Nullable(t.String({ minLength: 0, maxLength: 64, description: "Override the name of the guild (makes non-members appear properly)." })),
        observer: t.Nullable(snowflake("The ID of the assigned observer.")),
        start: t.Nullable(t.Integer({ description: "The millisecond timestamp of when observation starts/started." })),
        end: t.Nullable(t.Integer({ description: "The millisecond timestamp of when observation ends/ended (if different from 28 days after the start)." })),
        status: t.String({ description: "The current status of the server." }),
        notes: t.String({ maxLength: 1024, description: "Any notes regarding the server / that specific observation." }),
    }),
    poll: pollData(false),
    pollResponse: pollData(true),
    pollVote: voteData(false),
    pollVoteResponse: voteData(true),
    rolesync: t.Object({
        roleToStaff: t.Array(snowflake(), { description: "The array of Discord roles whose members will be made staff." }),
        staffToRole: t.Array(snowflake(), { description: "The array of Discord roles which staff will be given." }),
        roleToApi: t.Object(
            {},
            {
                additionalProperties: t.Array(id()),
                description: "A map from Discord roles to the array of API roles which members with that Discord role will be given.",
            },
        ),
        apiToRole: t.Array(
            t.Object({
                type: t.String({ description: "`position` for observer/owner/advisor/voter/council/staff, `role` for other roles." }),
                value: id("For positions, `observer` or `owner`, etc. For roles, the role."),
                guild: t.Nullable(snowflake("The ID of the guild in which to look for this condition.")),
                roles: t.Array(snowflake(), { description: "The array of roles to assign for this condition." }),
            }),
        ),
    }),
    autosync: t.Object({
        guild: snowflake("The ID of the guild."),
        template: t.String({ description: "The template in TCN/TDE format." }),
        channel: t.Nullable(snowflake("The ID of the channel to automatically sync.")),
        webhook: t.Nullable(t.String({ description: "A webhook URL to use instead of the channel ID." })),
        message: t.Nullable(snowflake("The ID of the message of the current live post.")),
        repost: t.Boolean({ description: "If true, the previous message will be deleted and a new one posted each time instead of editing the existing one." }),
    }),
    secretSantaUser: t.Object({
        user: t.String(),
        status: t.String(),
        agreed: t.Boolean(),
        partner: t.Optional(t.String()),
        time: t.Optional(t.Number()),
        info: t.Optional(t.String()),
        proof: t.Optional(t.String()),
    }),
};
