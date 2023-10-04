import db from "./db.js";

export default async function () {
    await db.invalidations.createIndex(["id"]);
    await db.users.createIndex(["id"]);
    await db.guilds.createIndex(["id"]);
    await db.characters.createIndex(["id"]);
    await db.attributes.createIndex(["type", "id"]);
    await db.events.createIndex(["id"]);
    await db.banshares.createIndex(["message"]);
    await db.banshare_settings.createIndex(["guild"]);

    await db.users.updateOne({ id: Bun.env.ADMIN! }, { $set: { observer: true }, $setOnInsert: { observerSince: Date.now() } }, { upsert: true });
}
