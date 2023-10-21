import codes from "./codes.js";
import db from "./db.js";
import { APIError } from "./errors.js";
import type { Attribute, CalendarEvent, Character, Guild, User, UserGuild } from "./types.js";

const baseUser = (id: string, observer?: boolean, roles?: string[], observerSince?: number): User => ({
    id,
    guilds: {},
    roles: roles ?? [],
    observer: observer ?? false,
    owner: false,
    advisor: false,
    voter: false,
    council: false,
    staff: false,
    observerSince: observerSince ?? 0,
});

const baseUserGuild = (): UserGuild => ({ owner: false, advisor: false, voter: false, council: false, staff: false, roles: [] });

function formatGuild(guild: Guild): Guild {
    guild.voter = guild.delegated ? guild.advisor || guild.owner : guild.owner;

    guild.users ??= {};
    guild.users[guild.owner] ??= { staff: true, roles: [] };
    if (guild.advisor) guild.users[guild.advisor] ??= { staff: true, roles: [] };
    else guild.advisor = null;

    for (const [id, user] of Object.entries(guild.users)) {
        user.staff ||= [guild.owner, guild.advisor].includes(id);
        user.roles ??= [];
    }

    return guild;
}

export default {
    async getUser(id: string, internal?: boolean): Promise<User> {
        if (id === "1".repeat(18) && internal)
            return { id, observer: true, owner: false, advisor: false, voter: false, council: true, guilds: {}, observerSince: 0, roles: [], staff: false };

        const entry = (await db.users.findOne({ id })) as unknown as User;

        const user = baseUser(id, entry?.observer ?? false, entry?.roles ?? [], entry?.observerSince);

        for (const guild of await this.getGuilds()) {
            const get = () => (user.guilds[guild.id] ??= baseUserGuild());
            let council = false;

            for (const key of ["owner", "advisor", "voter"] as const)
                if (guild[key] === id) {
                    const x = get();
                    x[key] = user[key] = true;
                    council = true;
                }

            if (council) {
                const x = get();
                x.council = user.council = x.staff = user.staff = true;
            }

            const u = guild.users[id];

            if (u?.staff) get().staff = user.staff = true;
            if (u?.roles?.length) get().roles = u.roles;
        }

        user.staff ||= user.council ||= user.observer;

        return user;
    },
    async getUsers(filter?: any): Promise<User[]> {
        const users: Record<string, User> = {};

        for (const entry of await db.users.find(filter).toArray()) users[entry.id] = baseUser(entry.id, entry.observer, entry.roles, entry.observerSince);

        for (const guild of await this.getGuilds()) {
            const gu = (id: string): [User, UserGuild] => [(users[id] ??= baseUser(id)), (users[id].guilds[guild.id] ??= baseUserGuild())];

            for (const key of ["owner", "advisor", "voter"] as const)
                if (guild[key]) {
                    const [x, y] = gu(guild[key]!);
                    x[key] = y[key] = x.council = y.council = x.staff = y.staff = true;
                }

            for (const [id, val] of Object.entries(guild.users)) {
                const [x, y] = gu(id);

                if (val.staff) x.staff = y.staff = true;
                if (val.roles.length > 0) y.roles = val.roles;
            }
        }

        const array = Object.values(users);
        for (const user of array) user.staff ||= user.council ||= user.observer;

        return array;
    },
    async getGuild(id: string): Promise<Guild> {
        const guild = (await db.guilds.findOne({ id })) as unknown as Guild;
        if (!guild) throw new APIError(404, codes.MISSING_GUILD, `No guild exists with ID ${id}.`);

        return formatGuild(guild);
    },
    async getGuilds(): Promise<Guild[]> {
        const guilds = (await db.guilds.find().toArray()) as unknown[] as Guild[];
        return guilds.map(formatGuild);
    },
    async getCharacter(id: string): Promise<Character> {
        const character = (await db.characters.findOne({ id })) as unknown as Character;
        if (!character) throw new APIError(404, codes.MISSING_CHARACTER, `No character exists with ID ${id}.`);

        character.attributes ??= {};
        return character;
    },
    async getCharacters(): Promise<Character[]> {
        const characters = (await db.characters.find().toArray()) as unknown[] as Character[];
        for (const character of characters) character.attributes ??= {};

        return characters;
    },
    async getAttribute(type: string, id: string): Promise<Attribute> {
        const attribute = (await db.attributes.findOne({ type, id })) as unknown as Attribute;
        if (!attribute) throw new APIError(404, codes.MISSING_ATTRIBUTE, `No attribute exists with type ${type} and ID ${id}.`);

        return attribute;
    },
    async getAttributes(): Promise<Attribute[]> {
        return (await db.attributes.find().toArray()) as unknown[] as Attribute[];
    },
    async getEvents(limit: boolean = true): Promise<CalendarEvent[]> {
        return (await db.events
            .find(limit ? { start: { $lte: Date.now() + 30 * 24 * 60 * 60 * 1000 }, end: { $gte: Date.now() - 3 * 24 * 60 * 60 * 1000 } } : {})
            .toArray()) as unknown[] as CalendarEvent[];
    },
    async getEvent(id: number): Promise<CalendarEvent> {
        const event = (await db.events.findOne({ id })) as unknown as CalendarEvent;
        if (!event) throw new APIError(404, codes.MISSING_EVENT, `No event exists with ID ${id}.`);

        return event;
    },
};
