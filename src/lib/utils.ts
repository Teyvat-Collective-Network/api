import codes from "./codes.js";
import { APIError } from "./errors.js";

export function stripMongoIds(obj: any) {
    if (Array.isArray(obj)) obj.forEach(stripMongoIds);
    if (typeof obj === "object" && obj) {
        if ("_id" in obj) delete obj._id;
        Object.values(obj).forEach(stripMongoIds);
    }

    return obj;
}

export function trim(string: string) {
    return string
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .join("\n");
}

export function nonempty(record: any) {
    if (Object.keys(record).length === 0) throw new APIError(400, codes.NOT_MODIFIED, "No changes were made.");
}

export function changes(before: Record<string, any>, after: Record<string, any>): Record<string, [any, any]> {
    const output: Record<string, [any, any]> = {};

    for (const key of Object.keys(before)) if (after[key] !== undefined && after[key] !== before[key]) output[key] = [before[key], after[key]];
    for (const key of Object.keys(after)) if (!(key in before)) output[key] = [null, after[key]];

    return output;
}
