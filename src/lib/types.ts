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

export type ObservationRecord = {
    uuid: number;
    id: string;
    hidden: boolean;
    name: string | null;
    observer: string | null;
    start: number | null;
    end: number | null;
    status: string;
    notes: string;
};

export type ElectionHistoryRecord = { id: string; status: string; rerunning: boolean };

export type Poll = {
    duration: number;
    dm: boolean;
    live: boolean;
    restricted: boolean;
    quorum: number;
} & (
    | { mode: "proposal"; question: string }
    | { mode: "induction"; preinduct: boolean; server: string }
    | { mode: "election"; wave: number; seats: number; candidates: string[] }
    | { mode: "selection"; question: string; min: number; max: number; options: string[] }
);

export type PollResponse = Poll & { id: number; message: string; close: number; closed: boolean };

export type PollVote = {
    poll: number;
    user: string;
    mode: string;
    abstain: boolean;
    yes: boolean;
    verdict: string;
    candidates: Record<string, number>;
    selected: string[];
};

export type PollResults = {
    mode: string;
    abstains: number;
    votes: number;
    ballots: number;
    turnout: number;
    yes: number;
    no: number;
    induct: number;
    preinduct: number;
    reject: number;
    extend: number;
    winners: string[];
    tied: string[];
    scores: Record<string, number>;
};

export type Rolesync = {
    roleToStaff: string[];
    staffToRole: string[];
    roleToApi: Record<string, string[]>;
    apiToRole: { type: "position" | "role"; value: string; guild?: string; roles: string[] }[];
};

export type Autosync = {
    guild: string;
    template: string;
    channel: string | null;
    webhook: string | null;
    message: string | null;
    repost: boolean;
};
