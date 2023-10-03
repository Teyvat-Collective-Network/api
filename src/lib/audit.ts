import { t } from "elysia";
import db from "./db.js";
import { User } from "./types.js";
import { stripMongoIds } from "./utils.js";

export default async function (user: (User & { token: string }) | undefined, action: string, data?: any, reason?: string | null) {
    await db.audit_logs.insertOne({ time: Date.now(), user: user!.id, token: user!.token, action, data: stripMongoIds(data), reason: reason || null });
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
