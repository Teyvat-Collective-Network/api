import { logger } from "@bogeychan/elysia-logger";
import { bearer } from "@elysiajs/bearer";
import jwt from "@elysiajs/jwt";
import { Elysia } from "elysia";
import PinoPretty from "pino-pretty";
import codes from "./lib/codes.js";
import data from "./lib/data.js";
import db, { connect } from "./lib/db.js";
import { APIError } from "./lib/errors.js";
import { stripMongoIds } from "./lib/utils.js";
import routes from "./routes/index.js";
import swagger from "@elysiajs/swagger";
import setup from "./lib/setup.js";

await connect();
const app = new Elysia()
    .use(
        swagger({
            documentation: {
                info: {
                    title: "Teyvat Collective Network Public API",
                    version: "1.0.0",
                    contact: {
                        email: "hyperneutrino15@gmail.com",
                        name: "hyper-neutrino",
                        url: "https://hyper-neutrino.xyz",
                    },
                },
                components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
                security: [{ bearerAuth: [] }],
            },
            exclude: ["/docs", "/docs/json"],
            path: "/docs",
        }),
    )
    .use(bearer())
    .use(
        logger({
            name: "API",
            level: Bun.env.LOG_LEVEL || (Bun.env.PRODUCTION ? "info" : "trace"),
            stream: PinoPretty({ colorize: true, ignore: "hostname,pid" }),
        }),
    )
    .use(jwt({ secret: Bun.env.JWT_SECRET! }))
    .derive(async ({ bearer, jwt }) => {
        if (!bearer) return {};

        const payload = (await jwt.verify(bearer)) as false | { created: number; expires: number; id: string; scopes: string[] };
        if (!payload) return {};
        if (!payload.created) return {};
        if (payload.expires && payload.expires < Date.now()) return {};

        const entry = await db.invalidations.findOne({ id: payload.id });
        if (entry && payload.created <= entry.time) return {};

        return { user: { ...payload, ...(await data.getUser(payload.id)) } };
    })
    .onBeforeHandle(({ log, path, request }) => log.info(`${request.method} ${path}`))
    .onAfterHandle(({ response }) => stripMongoIds(response))
    .error({ API_ERROR: APIError })
    .onError(({ code, error, log, set }) => {
        switch (code) {
            case "API_ERROR":
                set.status = error.status;
                return { code: error.errorCode, message: error.message };
            case "INTERNAL_SERVER_ERROR":
            case "UNKNOWN":
                log.error(error);
                set.status = 500;
                return { code: codes.INTERNAL_SERVER_ERROR, message: `Internal server error: ${error.message}` };
            case "NOT_FOUND":
                set.status = 404;
                return { code: codes.NOT_FOUND, message: "Route not found." };
            case "PARSE":
                set.status = 400;
                return { code: codes.INVALID_BODY, message: "Could not parse input body." };
            case "VALIDATION":
                set.status = 400;
                return { code: codes.INVALID_BODY, message: error.message };
        }
    });

export type App = typeof app;

app.use(routes).listen(Bun.env.PORT || 4000);

new Elysia()
    .use(jwt({ secret: Bun.env.JWT_SECRET! }))
    .get("/login/:id", async ({ jwt, params: { id } }) => {
        const now = Date.now();
        return await jwt.sign({ created: now, expires: now + 30 * 24 * 60 * 60 * 1000, id, scopes: ["all"] } as any);
    })
    .listen(Bun.env.INTERNAL_PORT || 4001);

console.log(`TCN API is running at ${app.server?.hostname}:${app.server?.port}`);

await setup();
