import db from "./db.js";

export default async function () {
    await db.users.updateOne({ id: Bun.env.ADMIN! }, { $set: { observer: true }, $setOnInsert: { observerSince: Date.now() } }, { upsert: true });
}
