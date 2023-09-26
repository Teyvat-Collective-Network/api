import codes from "./codes.js";
import data from "./data.js";
import { APIError } from "./errors.js";
import { User } from "./types.js";

export function isSignedIn({ user }: any) {
    if (!user) throw new APIError(401, codes.UNAUTHORIZED, "You must be signed in to access this route.");
}

export function isObserver({ user }: any) {
    if (!user.observer) throw new APIError(403, codes.FORBIDDEN, "You must be an observer to access this route.");
}

export async function guildExists(id: string) {
    await data.getGuild(id);
}

export async function isOwner(id: string, user: User) {
    const guild = await data.getGuild(id);
    if (user.observer) return;
    if (guild.owner !== user.id) throw new APIError(403, codes.FORBIDDEN, "You must be the owner of this guild to access this route.");
}

export function hasScope(scope: string) {
    return function ({ user }: any) {
        if (user.scopes.includes("all")) return;

        let current = scope;

        while (true) {
            if (user.scopes.includes(current)) return;
            if (!current.includes("/")) throw new APIError(403, codes.MISSING_SCOPE, `API key is missing the ${scope} scope.`);
            current = current.replace(/\/[^/]*$/, "");
        }
    };
}

export function checkPermissions(
    check: ((user: User) => boolean) | ((user: User) => Promise<boolean>),
    error: string | ((user: User) => string) | ((user: User) => Promise<string>) = "Permission denied.",
) {
    return async function ({ user }: any) {
        if (!(await check(user))) throw new APIError(403, codes.FORBIDDEN, typeof error === "string" ? error : await error(user));
    };
}
