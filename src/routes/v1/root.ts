import { t } from "elysia";
import { App } from "../../index.js";
import db from "../../lib/db.js";
import { trim } from "../../lib/utils.js";

const startup = Date.now();

export default (app: App) =>
    app.group("", (app) =>
        app.get(
            "/stats",
            async () => {
                return {
                    startup,
                    uptime: Date.now() - startup,
                    users: await db.users.countDocuments(),
                    guilds: await db.guilds.countDocuments(),
                };
            },
            {
                detail: {
                    tags: ["V1"],
                    security: [],
                    summary: "Get basic information about the TCN.",
                    description: trim(`
                        Get the startup timestamp, uptime, and number of users and guilds in the API. This endpoint is particularly useful for testing purposes.
                    `),
                },
                response: t.Object({
                    startup: t.Integer({ minimum: 0, description: "The millisecond timestamp of when the server was last started." }),
                    uptime: t.Integer({ minimum: 0, description: "The number of milliseconds for which the server has been online." }),
                    users: t.Integer({ minimum: 0, description: "The number of TCN users registered in the API." }),
                    guilds: t.Integer({ minimum: 0, description: "The number of TCN guilds registered in the API." }),
                }),
            },
        ),
    );
