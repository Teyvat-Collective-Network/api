import bot from "../lib/bot.js";
import cycle from "../lib/cycle.js";
import db from "../lib/db.js";

cycle(async () => {
    const now = Date.now();

    const urgentThreshold = now - 2 * 60 * 60 * 1000;
    const nonUrgentThreshold = now - 6 * 60 * 60 * 1000;

    const docs = await db.banshares.updateMany(
        {
            status: "pending",
            $or: [
                { urgent: true, reminded: { $lt: urgentThreshold } },
                { urgent: false, reminded: { $lt: nonUrgentThreshold } },
            ],
        },
        { $set: { reminded: now } },
    );

    if (docs.modifiedCount > 0) await bot(null, `POST /banshares/remind`);
}, 10 * 60 * 1000);
