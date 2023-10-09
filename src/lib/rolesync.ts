import bot from "./bot.js";
import db from "./db.js";

export default async function (data?: { guild?: string; user?: string }) {
    await bot(null, `POST /rolesync`, {
        user: data?.user,
        entries: data?.guild ? [await db.rolesync.findOne({ guild: data.guild })] : await db.rolesync.find().toArray(),
    });
}
