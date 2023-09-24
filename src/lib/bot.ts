import codes from "./codes.js";
import { APIError } from "./errors.js";

export default async function (route: string, body?: any) {
    let request = false;

    if (route.startsWith("!")) {
        request = true;
        route = route.slice(1);
    }

    const [method, path] = route.split(" ");

    let req: Response;

    try {
        req = await fetch(`${Bun.env.DISCORD_INTERFACE}${path}`, { method, body: JSON.stringify(body) });
    } catch {
        throw new APIError(503, codes.BOT_OFFLINE, "The Discord bot is offline.");
    }

    if (request) return req;

    if (!req.ok)
        throw new APIError(500, codes.INTERNAL_SERVER_ERROR, `An unexpected error occurred in an internal Discord bot API request (${method} ${path}).`);

    return await req.json();
}
