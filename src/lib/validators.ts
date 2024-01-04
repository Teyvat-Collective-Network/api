import bot from "./bot.js";
import codes from "./codes.js";
import data from "./data.js";
import { APIError } from "./errors.js";
import logger from "./logger.js";
import { Poll } from "./types.js";

type Invite = { code: string; guild: { id: string; name: string }; vanity: boolean; target: boolean };

export async function validateInvite<T extends boolean>(token: string, raw: string, guild?: string, full?: T): Promise<T extends true ? Invite : string> {
    logger.info({ raw, guild }, "09984fcd-0da3-4c7a-99df-dd60da2d5f86 Validating invite");

    const req = await bot(token, `!GET /invites/${encodeURIComponent(raw)}`);
    if (!req.ok) throw new APIError(400, codes.INVALID_INVITE, "That invite does not exist.");

    const invite: Invite = await req.json();
    if (guild && invite.guild.id !== guild) throw new APIError(400, codes.INVALID_INVITE, "The invite does not point to the correct guild.");
    if (invite.vanity) throw new APIError(400, codes.INVALID_INVITE, "Vanity invites are not allowed.");
    if (invite.target) throw new APIError(400, codes.INVALID_INVITE, "Invites must point to the guild directly and not to an activity.");

    return (full ? invite : invite.code) as any;
}

export async function validatePoll(poll: Poll) {
    logger.info(poll, "f1656cdf-86e2-4e34-b1c0-e36ef2e020e8 Validating poll");

    if (poll.dm && poll.duration < 24)
        throw new APIError(400, codes.INVALID_BODY, "DM reminders can only be enabled if more than 24 hours are left on the poll.");

    if (poll.mode === "selection") {
        if (poll.min > poll.max) throw new APIError(400, codes.INVALID_BODY, "Minimum options must be no greater than maximum options.");
        if (poll.max > poll.options.length) throw new APIError(400, codes.INVALID_BODY, "Maximum options must be no greater than the number of options.");
    } else if (poll.mode === "election") {
        const council = new Set((await data.getGuilds()).flatMap((x) => [x.owner, x.advisor]).filter((x) => x));
        if (poll.candidates.some((x) => !council.has(x))) throw new APIError(400, codes.INVALID_BODY, "Only council members may become observers.");
    }
}
