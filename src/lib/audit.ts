import { t } from "elysia";
import db, { autoinc } from "./db.js";
import logger from "./logger.js";
import { User } from "./types.js";
import { stripMongoIds } from "./utils.js";

export enum AuditLogAction {
    APPLY = "apply",
    ATTRIBUTES_CREATE = "attributes/create",
    ATTRIBUTES_DELETE = "attributes/delete",
    ATTRIBUTES_EDIT = "attributes/edit",
    AUTH_INVALIDATE_OTHER = "auth/invalidate/other",
    AUTH_INVALIDATE_SELF = "auth/invalidate/self",
    AUTH_KEY = "auth/key",
    BANSHARES_CREATE = "banshares/create",
    BANSHARES_CROSSPOST = "banshares/crosspost",
    BANSHARES_DELETE = "banshares/delete",
    BANSHARES_EXECUTE = "banshares/execute",
    BANSHARES_LOGS_ADD = "banshares/logs/add",
    BANSHARES_LOGS_REMOVE = "banshares/logs/remove",
    BANSHARES_PUBLISH = "banshares/publish",
    BANSHARES_REJECT = "banshares/reject",
    BANSHARES_REPORT = "banshares/report",
    BANSHARES_RESCIND = "banshares/rescind",
    BANSHARES_SETTINGS = "banshares/settings",
    BANSHARES_SEVERITY = "banshares/severity",
    CHARACTERS_CREATE = "characters/create",
    CHARACTERS_DELETE = "characters/delete",
    CHARACTERS_EDIT = "characters/edit",
    DOCS_CREATE = "docs/create",
    DOCS_DELETE = "docs/delete",
    DOCS_EDIT = "docs/edit",
    DOCS_OFFICIAL_ADD = "docs/official/add",
    DOCS_OFFICIAL_REMOVE = "docs/official/remove",
    EVENTS_CREATE = "events/create",
    EVENTS_DELETE_OTHER = "events/delete/other",
    EVENTS_DELETE_SELF = "events/delete/self",
    EVENTS_EDIT = "events/edit",
    GLOBAL_FILTER_DELETE = "global/filter/delete",
    GUILDS_CREATE = "guilds/create",
    GUILDS_DELETE = "guilds/delete",
    GUILDS_EDIT = "guilds/edit",
    OBSERVATION_RECORD_EDIT = "observation-records/edit",
    POLLS_CREATE = "polls/create",
    POLLS_DELETE = "polls/delete",
    POLLS_EDIT = "polls/edit",
    ROLESYNC_EDIT = "rolesync/edit",
    USERS_DEMOTE = "users/demote",
    USERS_PROMOTE = "users/promote",
    USERS_ROLES_ADD = "users/roles/add",
    USERS_ROLES_REMOVE = "users/roles/remove",
    USERS_ROLES_SET = "users/roles/set",
    USERS_STAFF_ADD = "users/staff/add",
    USERS_STAFF_REMOVE = "users/staff/remove",
    USERS_TERM_REFRESH = "users/term/refresh",
}

export default async function (user: (User & { token: string }) | undefined, action: AuditLogAction, data?: any, reason?: string | null) {
    const uuid = await autoinc("audit-logs");
    const entry = { uuid, time: Date.now(), user: user!.id, token: user!.token, action, data: stripMongoIds(data), reason: reason || null };
    await db.audit_logs.insertOne(entry);
    logger.info(entry, "audit log entry created");
}

export const requiredError = "Audit log reason is required and must be 1-256 characters.";

const string = (required: boolean) =>
    t.String({
        minLength: required ? 1 : 0,
        maxLength: 256,
        description: "The reason to put in the audit log entry for this action.",
        error: `Audit log reason${required ? " is required and" : ""} must be ${required ? 1 : 0}-256 characters.`,
    });

export const headers = (required = false) =>
    t.Object({
        "x-audit-log-reason": required ? string(required) : t.Optional(string(required)),
    });
