import cycle from "../lib/cycle.js";
import db from "../lib/db.js";

cycle(async () => {
    const now = Date.now();

    let docs = (await db.secret_santa_timers.find({ time: { $lt: now }, action: "lock" }).toArray()) as unknown as { user: string }[];

    if (docs.length > 0) {
        const targets = await db.secret_santa.find({ user: { $in: docs.map((x) => x.user) }, status: "locked-sender" }).toArray();

        await db.secret_santa.updateMany({ _id: { $in: targets.map((x) => x._id) } }, { $set: { status: "locked-out" } });
        await db.secret_santa.updateMany({ user: { $in: targets.map((target) => target.partner) } }, { $set: { status: "pool-free" } });
        await db.secret_santa_timers.insertMany(docs.map((doc) => ({ user: doc.user, time: now + 24 * 60 * 60 * 1000, action: "unlock" })));
    }

    docs = (await db.secret_santa_timers.find({ time: { $lt: now }, action: "unlock" }).toArray()) as unknown as { user: string }[];

    if (docs.length > 0) {
        await db.secret_santa.updateMany({ user: { $in: docs.map((x) => x.user) }, status: "locked-out" }, { $set: { status: "none" } });
    }

    await db.secret_santa_timers.deleteMany({ time: { $lt: now } });
}, 10 * 1000);
