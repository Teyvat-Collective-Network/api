export type UserGuild = {
    owner: boolean;
    advisor: boolean;
    voter: boolean;
    council: boolean;
    staff: boolean;
    roles: string[];
};

export type User = {
    id: string;
    guilds: Record<string, UserGuild>;
    roles: string[];
    observer: boolean;
    owner: boolean;
    advisor: boolean;
    voter: boolean;
    council: boolean;
    staff: boolean;
};

export type GuildUser = {
    staff: boolean;
    roles: string[];
};

export type Guild = {
    id: string;
    name: string;
    mascot: string;
    invite: string;
    owner: string;
    advisor?: string | null;
    voter: string;
    delegated: boolean;
    users: Record<string, GuildUser>;
};

export type Character = {
    id: string;
    name: string;
    short: string;
    attributes: Record<string, string>;
};

export type Attribute = {
    type: string;
    id: string;
    name: string;
    emoji: string;
};

export type CalendarEvent = {
    id: number;
    owner: string;
    start: number;
    end: number;
    title: string;
    body: string;
    invites: string[];
};
