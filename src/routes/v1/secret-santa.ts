import { t } from "elysia";
import { App } from "../../lib/app.js";
import bot from "../../lib/bot.js";
import { isObserver, isSecretSantaAdmin, isSignedIn } from "../../lib/checkers.js";
import codes from "../../lib/codes.js";
import db from "../../lib/db.js";
import { APIError } from "../../lib/errors.js";
import schemas from "../../lib/schemas.js";
import { SecretSantaUser, User } from "../../lib/types.js";

async function getStatus(user: User | undefined) {
    const entry = (await db.secret_santa.findOne({ user: user!.id })) as unknown as SecretSantaUser;
    return entry?.status ?? "none";
}

export default (app: App) =>
    app.group("/secret-santa", (app) =>
        app
            .get(
                "/is-admin",
                async ({ user }) => {
                    if (!user) return false;
                    if (user.observer) return true;
                    return (await db.secret_santa_reviewers.countDocuments({ user: user.id })) > 0;
                },
                {
                    response: t.Boolean(),
                },
            )
            .get(
                "/all",
                async () => {
                    const users = (await db.secret_santa.find().toArray()) as unknown as SecretSantaUser[];
                    return users.map((user) => ({ status: "none", ...user, agreed: true }));
                },
                {
                    beforeHandle: [isSignedIn, isSecretSantaAdmin],
                    response: t.Array(schemas.secretSantaUser),
                },
            )
            .get(
                "/data",
                async ({ user }) => {
                    const entry = (await db.secret_santa.findOne({ user: user!.id })) as SecretSantaUser | null;
                    return { status: "none", agreed: !!entry, ...(entry ?? {}), user: user!.id };
                },
                {
                    beforeHandle: [isSignedIn],
                    response: schemas.secretSantaUser,
                },
            )
            .get(
                "/partner-data",
                async ({ user }) => {
                    const entry = (await db.secret_santa.findOne({ user: user!.id })) as SecretSantaUser | null;

                    if (entry?.status !== "locked-sender" || !entry.partner) throw new APIError(400, codes.INVALID_STATE, "You are not locked in.");

                    const doc = (await db.secret_santa.findOne({ user: entry.partner })) as SecretSantaUser | null;
                    if (!doc) throw new APIError(400, codes.INVALID_STATE, "Could not find your receiver. Please contact support.");

                    return { info: doc.info ?? "" };
                },
                {
                    beforeHandle: [isSignedIn],
                    response: t.Object({
                        info: t.String(),
                    }),
                },
            )
            .post(
                "/save-data",
                async ({ body: { info }, user }) => {
                    if ((await getStatus(user)) !== "none") return;

                    await db.secret_santa.updateOne({ user: user!.id }, { $set: { info } }, { upsert: true });
                },
                {
                    beforeHandle: [isSignedIn],
                    body: t.Object({
                        info: t.String(),
                    }),
                },
            )
            .post(
                "/lock-in",
                async ({ body: { info }, user }) => {
                    const status = await getStatus(user);
                    if (status !== "none") return new Response(null, { status: 201 });

                    await db.secret_santa.updateOne({ user: user!.id }, { $set: { info } }, { upsert: true });

                    const entry = await db.secret_santa.findOneAndUpdate(
                        { status: "pool-free" },
                        { $set: { status: "pool-locked", partner: user!.id } },
                        { sort: { time: 1 } },
                    );

                    if (!entry) return new Response(null, { status: 201 });

                    await db.secret_santa.updateOne(
                        { user: user!.id },
                        { $set: { status: "locked-sender", partner: entry.user, time: Date.now() + 30 * 60 * 1000 } },
                        { upsert: true },
                    );

                    await db.secret_santa_timers.updateOne(
                        { user: user!.id },
                        { $set: { time: Date.now() + 30 * 60 * 1000, action: "lock" } },
                        { upsert: true },
                    );
                },
                {
                    beforeHandle: [isSignedIn],
                    body: t.Object({
                        info: t.String(),
                    }),
                },
            )
            .post(
                "/prove",
                async ({ body: { proof }, user }) => {
                    const doc = (await db.secret_santa.findOne({ user: user!.id })) as unknown as SecretSantaUser | null;

                    if (!["locked-sender", "locked-out"].includes(doc?.status ?? "none") || !doc?.partner)
                        throw new APIError(400, codes.INVALID_STATE, "You are not locked in or out and do not have a recipient assigned.");

                    const partner = (await db.secret_santa.findOne({ user: doc.partner })) as unknown as SecretSantaUser | null;
                    if (!partner) throw new APIError(400, codes.INVALID_STATE, "Your assigned partner does not exist. Please contact support.");

                    if (!["pool-free", "pool-locked"].includes(partner.status ?? "none") || partner.partner !== user!.id)
                        throw new APIError(
                            400,
                            codes.INVALID_STATE,
                            "Your partner is no longer locked to you. You are unable to join the pool. Please contact support to discuss this issue.",
                        );

                    await db.secret_santa.updateOne({ user: doc.partner }, { $set: { status: "limbo" } });
                    await db.secret_santa.updateOne({ user: user!.id }, { $set: { status: "awaiting-approval", proof } });

                    bot(null, "POST /secret-santa-alert", { target: doc.partner });
                },
                {
                    beforeHandle: [isSignedIn],
                    body: t.Object({
                        proof: t.String(),
                    }),
                },
            )
            .post(
                "/bail",
                async ({ user }) => {
                    const doc = (await db.secret_santa.findOne({ user: user!.id })) as unknown as SecretSantaUser | null;

                    if (doc?.status !== "locked-sender")
                        throw new APIError(
                            400,
                            codes.INVALID_STATE,
                            "You are not currently locked in. If your time window already expired, you do not need to do anything.",
                        );

                    await db.secret_santa.updateOne({ user: user!.id }, { $set: { status: "locked-out" } });
                    if (doc.partner) await db.secret_santa.updateOne({ user: doc.partner }, { $set: { status: "pool-free" } });
                    await db.secret_santa_timers.deleteOne({ user: user!.id });
                },
                {
                    beforeHandle: [isSignedIn],
                },
            )
            .post(
                "/block-approval",
                async ({ user }) => {
                    const doc = (await db.secret_santa.findOne({ user: user!.id })) as unknown as SecretSantaUser | null;

                    if (doc?.status !== "limbo")
                        throw new APIError(
                            400,
                            codes.INVALID_STATE,
                            "Your gift-giver is no longer awaiting approval. The proof may have been rejected or approved; please check the form for the updated information.",
                        );

                    if (!doc.partner) throw new APIError(400, codes.INVALID_STATE, "Could not find your gift-giver. Please contact support.");

                    await db.secret_santa.updateOne({ user: doc.partner }, { $set: { locked: true } });
                },
                { beforeHandle: [isSignedIn] },
            )
            .post(
                "/admin/add-to-pool/:id",
                async ({ params: { id } }) => {
                    const doc = (await db.secret_santa.findOne({ user: id })) as unknown as SecretSantaUser;
                    if ((doc?.status ?? "none") !== "none") throw new APIError(400, codes.INVALID_STATE, "user is not in the none state");

                    await db.secret_santa.updateOne({ user: id }, { $set: { status: "pool-free" } });
                },
                {
                    beforeHandle: [isSignedIn, isSecretSantaAdmin],
                    params: t.Object({
                        id: schemas.snowflake(),
                    }),
                },
            )
            .post(
                "/admin/unbind/:id",
                async ({ params: { id } }) => {
                    const doc = (await db.secret_santa.findOne({ user: id })) as unknown as SecretSantaUser | null;

                    if (!["locked-sender", "locked-out"].includes(doc?.status ?? "none"))
                        throw new APIError(400, codes.INVALID_STATE, "user is not in a locked state");

                    await db.secret_santa.updateOne({ user: id }, { $set: { status: "none" } });
                    if (doc?.partner) await db.secret_santa.updateOne({ user: doc.partner, partner: id }, { $set: { status: "pool-free" } });
                },
                {
                    beforeHandle: [isSignedIn, isSecretSantaAdmin],
                    params: t.Object({
                        id: schemas.snowflake(),
                    }),
                },
            )
            .post(
                "/admin/unlock/:id",
                async ({ params: { id } }) => {
                    const doc = (await db.secret_santa.findOne({ user: id })) as unknown as SecretSantaUser | null;

                    if (doc?.status !== "awaiting-approval") throw new APIError(400, codes.INVALID_STATE, "user is not awaiting approval");
                    if (!doc.locked) throw new APIError(400, codes.INVALID_STATE, "Approval is not blocked.");

                    await db.secret_santa.updateOne({ user: id }, { $set: { locked: false } });
                },
                {
                    beforeHandle: [isSignedIn, isSecretSantaAdmin],
                    params: t.Object({
                        id: schemas.snowflake(),
                    }),
                },
            )
            .post(
                "/admin/approve/:id",
                async ({ params: { id }, user }) => {
                    const doc = (await db.secret_santa.findOne({ user: id })) as unknown as SecretSantaUser | null;

                    if (doc?.status !== "awaiting-approval") throw new APIError(400, codes.INVALID_STATE, "user is not awaiting approval");
                    if (doc.locked) throw new APIError(400, codes.INVALID_STATE, "Approval has been blocked by the recipient.");

                    await db.secret_santa.updateOne({ user: id }, { $set: { status: "pool-free" }, $unset: { partner: 1 } });
                    if (doc?.partner) await db.secret_santa.updateOne({ user: doc.partner, partner: id }, { $set: { status: "done" } });

                    bot(null, `POST /log`, { message: `<@${user!.id}> approved <@${id}>'s proof of a gift given to <@${doc?.partner}>.` });
                },
                {
                    beforeHandle: [isSignedIn, isSecretSantaAdmin],
                    params: t.Object({
                        id: schemas.snowflake(),
                    }),
                },
            )
            .post(
                "/admin/deny/:id",
                async ({ params: { id } }) => {
                    const doc = (await db.secret_santa.findOne({ user: id })) as unknown as SecretSantaUser | null;

                    if (doc?.status !== "awaiting-approval") throw new APIError(400, codes.INVALID_STATE, "user is not awaiting approval");

                    await db.secret_santa.updateOne({ user: id }, { $set: { status: "banned" }, $unset: { partner: 1 } });

                    if (doc?.partner)
                        await db.secret_santa.updateOne({ user: doc.partner, partner: id }, { $set: { status: "pool-free" }, $unset: { partner: 1 } });
                },
                {
                    beforeHandle: [isSignedIn, isSecretSantaAdmin],
                    params: t.Object({
                        id: schemas.snowflake(),
                    }),
                },
            )
            .post(
                "/admin/complete/:id",
                async ({ params: { id } }) => {
                    const doc = (await db.secret_santa.findOne({ user: id })) as unknown as SecretSantaUser | null;
                    if (doc?.status !== "pool-free") throw new APIError(400, codes.INVALID_STATE, "user is not in the unlocked pool");
                    await db.secret_santa.updateOne({ user: id }, { $set: { status: "done" }, $unset: { partner: 1 } });
                },
                {
                    beforeHandle: [isSignedIn, isSecretSantaAdmin],
                    params: t.Object({
                        id: schemas.snowflake(),
                    }),
                },
            )
            .post(
                "/admin/retroreject/:id",
                async ({ params: { id } }) => {
                    const doc = (await db.secret_santa.findOne({ user: id })) as unknown as SecretSantaUser | null;

                    if (doc?.status !== "pool-free") throw new APIError(400, codes.INVALID_STATE, "user is not in the free pool");

                    await db.secret_santa.updateOne({ user: id }, { $set: { status: "banned" }, $unset: { partner: 1 } });
                },
                {
                    beforeHandle: [isSignedIn, isSecretSantaAdmin],
                    params: t.Object({
                        id: schemas.snowflake(),
                    }),
                },
            )
            .post(
                "/admin/return/:id",
                async ({ params: { id } }) => {
                    const doc = (await db.secret_santa.findOne({ user: id })) as unknown as SecretSantaUser | null;
                    if (doc?.status !== "done") throw new APIError(400, codes.INVALID_STATE, "user is not in the completed pool");
                    await db.secret_santa.updateOne({ user: id }, { $set: { status: "pool-free" }, $unset: { partner: 1 } });
                },
                {
                    beforeHandle: [isSignedIn, isSecretSantaAdmin],
                    params: t.Object({
                        id: schemas.snowflake(),
                    }),
                },
            )
            .post(
                "/admin/unban/:id",
                async ({ params: { id } }) => {
                    const doc = (await db.secret_santa.findOne({ user: id })) as unknown as SecretSantaUser | null;
                    if (doc?.status !== "banned") throw new APIError(400, codes.INVALID_STATE, "user is not unbanned");
                    await db.secret_santa.updateOne({ user: id }, { $set: { status: "none" }, $unset: { partner: 1 } });
                },
                {
                    beforeHandle: [isSignedIn, isSecretSantaAdmin],
                    params: t.Object({
                        id: schemas.snowflake(),
                    }),
                },
            )
            .get(
                "/admin/admins",
                async () => {
                    return ((await db.secret_santa_reviewers.find().toArray()) as unknown as { user: string }[]).map((x) => x.user);
                },
                {
                    beforeHandle: [isSignedIn, isObserver],
                    response: t.Array(schemas.snowflake()),
                },
            )
            .put(
                "/admin/admins/:id",
                async ({ params: { id } }) => {
                    await db.secret_santa_reviewers.updateOne({ user: id }, { $set: { user: id } }, { upsert: true });
                },
                {
                    beforeHandle: [isSignedIn, isObserver],
                    params: t.Object({ id: schemas.snowflake() }),
                },
            )
            .delete(
                "/admin/admins/:id",
                async ({ params: { id } }) => {
                    await db.secret_santa_reviewers.deleteOne({ user: id });
                },
                {
                    beforeHandle: [isSignedIn, isObserver],
                    params: t.Object({ id: schemas.snowflake() }),
                },
            ),
    );
