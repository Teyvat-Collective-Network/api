import bot from "./bot.js";
import codes from "./codes.js";
import { APIError } from "./errors.js";

type Invite = { code: string; guild: { id: string; name: string }; vanity: boolean; target: boolean };

export async function validateInvite<T extends boolean>(token: string, raw: string, guild?: string, full?: T): Promise<T extends true ? Invite : string> {
    const req = await bot(token, `!GET /invites/${encodeURIComponent(raw)}`);
    if (!req.ok) throw new APIError(400, codes.INVALID_INVITE, "That invite does not exist.");

    const invite: Invite = await req.json();
    if (guild && invite.guild.id !== guild) throw new APIError(400, codes.INVALID_INVITE, "The invite does not point to the correct guild.");
    if (invite.vanity) throw new APIError(400, codes.INVALID_INVITE, "Vanity invites are not allowed.");
    if (invite.target) throw new APIError(400, codes.INVALID_INVITE, "Invites must point to the guild directly and not to an activity.");

    return (full ? invite : invite.code) as any;
}
