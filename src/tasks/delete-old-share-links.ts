import cycle from "../lib/cycle.js";
import db from "../lib/db.js";

cycle(async () => {
    await db.share_links.deleteMany({ time: { $lt: Date.now() - 7 * 24 * 60 * 60 * 1000 } });
}, 100000);
