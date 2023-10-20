import codes from "./codes.js";
import { APIError } from "./errors.js";
import logger from "./logger.js";
import { stripMongoIds } from "./utils.js";

export default async function (token: string | null, route: string, body?: any) {
    let request = false;

    if (route.startsWith("!")) {
        request = true;
        route = route.slice(1);
    }

    logger.info({ location: "1a959ee3-55c7-41e1-b0c7-6648e5191c9a", body }, `=> BOT: ${route}`);

    const [method, path] = route.split(" ");

    let req: Response;

    try {
        req = await fetch(`${Bun.env.BOT_API}${path}`, {
            method,
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
            body: body ? JSON.stringify(stripMongoIds(body)) : body,
        });
    } catch {
        throw new APIError(503, codes.BOT_OFFLINE, "The Discord bot is offline.");
    }

    if (request) return req;

    const text = await req.text();
    let res: any = null;

    try {
        res = JSON.parse(text);
    } catch {}

    if (!req.ok)
        throw new APIError(
            500,
            codes.INTERNAL_SERVER_ERROR,
            res?.message ?? `An unexpected error occurred in an internal Discord bot API request (${method} ${path}).`,
        );

    return res ?? text;
}
