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
    observerSince: number;
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

export type Banshare = {
    message: string;
    status: string;
    urgent: boolean;
    ids: string;
    idList: string[];
    reason: string;
    evidence: string;
    server: string;
    severity: string;
    author: string;
    created: number;
    reminded: number;
    publisher?: string;
    rejecter?: string;
    rescinder?: string;
    explanation?: string;
};

export type BanshareSettings = {
    guild: string;
    channel: string | null;
    logs: string[];
    blockdms: boolean;
    nobutton: boolean;
    daedalus: boolean;
    autoban: number;
};

export type TCNDocEmbedData = {
    embedTitle: string;
    embedBody: string;
    embedColor: number;
    embedImage: string;
    embedThumbnail: boolean;
};

export type TCNDoc = {
    id: string;
    official: boolean;
    deleted: boolean;
    author: string;
    anon: boolean;
    allowCouncil: boolean;
    allowEveryone: boolean;
    allowLoggedIn: boolean;
    allowlist: string[];
    title: string;
    body: string;
} & TCNDocEmbedData;

export type AuditLogEntry = {
    hidden: boolean;
    uuid: number;
    time: number;
    user: string;
    token: string;
    action: string;
    data: any;
    reason: string | null;
};
