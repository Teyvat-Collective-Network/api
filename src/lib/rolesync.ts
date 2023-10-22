import bot from "./bot.js";

export default async function () {
    await bot(null, `POST /rolesync`);
}
