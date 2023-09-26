import bot from "./bot.js";
import codes from "./codes.js";
import { APIError } from "./errors.js";

export async function validateInvite(raw: string, guild?: string): Promise<string> {
    const req = await bot(`!GET /invite/${encodeURIComponent(raw)}`);
    if (!req.ok) throw new APIError(400, codes.INVALID_INVITE, "That invite does not exist.");

    const invite: { code: string; guild: { id: string }; vanity: boolean; target: boolean } = await req.json();
    if (guild && invite.guild.id !== guild) throw new APIError(400, codes.INVALID_INVITE, "The invite does not point to the correct guild.");
    if (invite.vanity) throw new APIError(400, codes.INVALID_INVITE, "Vanity invites are not allowed.");
    if (invite.target) throw new APIError(400, codes.INVALID_INVITE, "Invites must point to the guild directly and not to an activity.");

    return invite.code;
}
