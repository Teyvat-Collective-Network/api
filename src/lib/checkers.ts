import codes from "./codes.js";
import data from "./data.js";
import db from "./db.js";
import { APIError } from "./errors.js";
import { DurationStyle, unparseDuration } from "./format.js";
import { User } from "./types.js";

setInterval(async () => {
    await db.ratelimit.deleteMany({ time: { $lte: Date.now() - 300000 } });
}, 10000);

export function ratelimitCheck(key: string, time: number, threshold: number) {
    const duration = unparseDuration(time, DurationStyle.Blank);

    return async function ({ user }: any) {
        if ((await db.ratelimit.countDocuments({ key, user: user.id, time: { $gt: Date.now() - time } })) >= threshold)
            throw new APIError(429, codes.RATELIMIT, `You have been ratelimited (max: ${threshold} request${threshold === 1 ? "" : "s"} per ${duration}).`);
    };
}

export function ratelimitApply(key: string) {
    return async function ({ response, user }: any) {
        if (response instanceof Response && !response.ok) return;
        await db.ratelimit.insertOne({ key, user: user.id, time: Date.now() });
    };
}

export function isSignedIn({ internal, user }: any) {
    if (!user)
        throw new APIError(
            401,
            codes.UNAUTHORIZED,
            internal
                ? "This request is not authenticated. This error should never occur; please contact a developer." // TODO: Automatically report
                : "You must be signed in to access this route.",
        );
}

export function isObserver({ internal, user }: any) {
    if (!user.observer)
        throw new APIError(403, codes.FORBIDDEN, internal ? "This operation is restricted to observers." : "You must be an observer to access this route.");
}

export function isCouncil({ internal, user }: any) {
    if (!user.council)
        throw new APIError(
            403,
            codes.FORBIDDEN,
            internal ? "This operation is restricted to council members." : "You must be a council member to access this route.",
        );
}

export async function guildExists(id: string) {
    await data.getGuild(id);
}

export async function isOwner(id: string, user: User, internal?: boolean) {
    const guild = await data.getGuild(id);
    if (user.observer) return;
    if (guild.owner !== user.id)
        throw new APIError(
            403,
            codes.FORBIDDEN,
            internal ? "This operation is restricted to the owner of this guild." : "You must be the owner of this guild to access this route.",
        );
}

export function hasScope(scope: string) {
    return function ({ internal, user }: any) {
        if (user.scopes.includes("all")) return;

        let current = scope;

        while (true) {
            if (user.scopes.includes(current)) return;
            if (!current.includes("/"))
                throw new APIError(
                    403,
                    codes.MISSING_SCOPE,
                    internal
                        ? "This request is missing the required scope. This error should never occur; please contact a developer." // TODO: Automatically report
                        : `API key is missing the ${scope} scope.`,
                );
            current = current.replace(/\/[^/]*$/, "");
        }
    };
}

export function checkPermissions(
    check: ((data: { internal?: boolean; user: User }) => boolean) | ((data: { internal?: boolean; user: User }) => Promise<boolean>),
    error:
        | string
        | ((data: { internal?: boolean; user: User }) => string)
        | ((data: { internal?: boolean; user: User }) => Promise<string>) = "Permission denied.",
) {
    return async function ({ internal, user }: any) {
        if (!(await check({ internal, user }))) throw new APIError(403, codes.FORBIDDEN, typeof error === "string" ? error : await error({ internal, user }));
    };
}
