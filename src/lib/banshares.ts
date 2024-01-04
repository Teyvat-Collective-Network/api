import bot from "./bot.js";
import { isObserver, isOwner } from "./checkers.js";
import codes from "./codes.js";
import db from "./db.js";
import { APIError } from "./errors.js";
import logger from "./logger.js";
import { BanshareSettings, User } from "./types.js";

export function formatBanshareSettings(entry: Partial<BanshareSettings>): BanshareSettings {
    return {
        guild: entry.guild!,
        channel: entry.channel ?? null,
        logs: entry.logs ?? [],
        blockdms: entry.blockdms ?? false,
        nobutton: entry.nobutton ?? false,
        daedalus: entry.daedalus ?? false,
        autoban: entry.autoban ?? 0,
    };
}

export async function checkOwnership({ internal, params: { guild }, user }: { internal?: boolean; params: { guild: string }; user?: User }) {
    logger.info({ internal, guild, user: user!.id }, "18b480bf-4ab3-4843-b0ab-b9f974375f4f Checking ownership");
    if (guild === Bun.env.HUB) isObserver({ internal, user });
    else if ((await db.guilds.countDocuments({ id: guild })) === 0)
        throw new APIError(404, codes.MISSING_GUILD, internal ? "This guild is not in the TCN." : `No guild exists with ID ${guild}.`);
    else await isOwner(guild, user!, internal);
}

export async function checkBansharePermissions({ internal, params: { guild }, user }: { internal?: boolean; params: { guild: string }; user?: User }) {
    logger.info({ internal, guild, user: user!.id }, "e375f1af-35b5-48a1-8f5d-30a23d58447c Checking banshare permissions");
    if (guild === Bun.env.HUB) isObserver({ internal, user });
    else if ((await db.guilds.countDocuments({ id: guild })) === 0)
        throw new APIError(404, codes.MISSING_GUILD, internal ? "This guild is not in the TCN." : `No guild exists with ID ${guild}.`);
    else if (!internal && !user!.observer) {
        const obj = user!.guilds[guild];
        if (!(obj?.owner || obj?.advisor || (obj?.staff && obj?.roles.includes("banshares"))))
            throw new APIError(
                403,
                codes.FORBIDDEN,
                "You must be the owner or advisor of this guild or be a staff member and have the banshares role to access this route.",
            );
    }
}

export async function checkChannel(token: string, internal: boolean | undefined, guild: string, channel: string | undefined | null) {
    if (!internal && channel) {
        const { error } = await bot(token, `GET /channels/${channel}/banshare-valid/${guild}`);
        if (error) throw new APIError(400, codes.INVALID_BODY, error);
    }
}
