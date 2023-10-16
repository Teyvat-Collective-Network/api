import { ObjectId } from "mongodb";
import bot from "../lib/bot.js";
import db from "../lib/db.js";
import logger from "../lib/logger.js";
import { PollResponse } from "../lib/types.js";

async function run() {
    let dmed: ObjectId[] = [];
    let closed: ObjectId[] = [];

    try {
        const pendingDM = (await db.polls
            .find({ dm: true, closed: false, close: { $lte: Date.now() + 24 * 60 * 60 * 1000 } })
            .toArray()) as unknown[] as (PollResponse & { _id: ObjectId })[];

        dmed = pendingDM.map((x) => x._id);

        const pendingClose = (await db.polls.find({ closed: false, close: { $lte: Date.now() } }).toArray()) as unknown[] as (PollResponse & {
            _id: ObjectId;
        })[];

        closed = pendingClose.map((x) => x._id);

        for (const poll of pendingDM)
            try {
                const voted = new Set((await db.poll_votes.find({ poll: poll.id }).toArray()).map((x: any) => x.id));

                const waiting: string[] = (await db.guilds.find().toArray())
                    .flatMap((x: any) => (poll.restricted ? [x.delegated ? x.advisor : x.owner] : [x.owner, x.advisor]))
                    .filter((x) => !voted.has(x));

                await bot(null, `POST /poll-remind/${poll.id}`, { message: poll.message, waiting });
            } catch (error) {
                logger.error(error, "c9a03be1-0dd6-4583-89fd-1bcb0a18fba4");
            }

        for (const poll of pendingClose)
            try {
                await bot(null, `PUT /poll`, { ...poll, _id: undefined, closed: true });
                await bot(null, `POST /log`, { message: `Closed poll #${poll.id}.` });
            } catch (error) {
                logger.error(error, "bcb12bff-930c-4fd5-9206-10ea98e901df");
            }
    } catch (error) {
        logger.error(error, "98968038-04bb-4338-a853-6b90886dcbfc");
    } finally {
        await db.polls.updateMany({ _id: { $in: dmed } }, { $set: { dm: false } }).catch(() => {});
        await db.polls.updateMany({ _id: { $in: closed } }, { $set: { closed: true } }).catch(() => {});

        setTimeout(run, 10000);
    }
}

setTimeout(run, 2500);
