import { bearer } from "@elysiajs/bearer";
import cors from "@elysiajs/cors";
import jwt from "@elysiajs/jwt";
import swagger from "@elysiajs/swagger";
import { Elysia } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import codes from "./codes.js";
import data from "./data.js";
import db from "./db.js";
import { APIError } from "./errors.js";
import logger from "./logger.js";
import { stripMongoIds } from "./utils.js";

export const app = new Elysia()
    .use(cors())
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
            exclude: ["/", "/docs", "/docs/json"],
            path: "/docs",
        }),
    )
    .use(bearer())
    .use(jwt({ secret: Bun.env.JWT_SECRET! }))
    .use(
        rateLimit({
            duration: 1000,
            max: 50,
            responseMessage: JSON.stringify({
                code: codes.RATELIMIT,
                message: `50/s ratelimit reached; please back off.`,
            }),
            generator: ({ headers }) => headers.get("Authorization") ?? JSON.stringify([...headers.entries()]),
        }),
    )
    .derive(async ({ bearer, jwt }) => {
        if (!bearer) return {};

        const payload = (await jwt.verify(bearer)) as false | { created: number; expires: number; id: string; internal?: boolean; scopes: string[] };
        if (!payload) return {};
        if (!payload.created) return {};
        if (payload.expires && payload.expires < Date.now()) return {};

        const entry = await db.invalidations.findOne({ id: payload.id });
        if (entry && payload.created <= entry.time) return {};

        return { user: { ...payload, ...(await data.getUser(payload.id)) }, internal: !!payload.internal };
    })
    .derive(() => ({ log: logger }))
    .onBeforeHandle(({ internal, log, path, request, user }) =>
        log.info({ location: "dd024f32-1c79-47bb-a7ca-e9858f247c80" }, `${request.method} ${path} [${user?.id ?? "anon"}]${internal ? " [internal]" : ""}`),
    )
    .onAfterHandle(({ response }) => stripMongoIds(response))
    .error({ API_ERROR: APIError })
    .onError(({ code, error, path, request, set }) => {
        if (code !== "NOT_FOUND") logger.error({ location: "cf70b286-db7a-4d59-b34c-b56d90608b6d", error }, `Error in ${request.method} ${path}`);

        switch (code) {
            case "API_ERROR":
                set.status = error.status;
                return { code: error.errorCode, message: error.message };
            case "INTERNAL_SERVER_ERROR":
            case "UNKNOWN":
                set.status = 500;
                return { code: codes.INTERNAL_SERVER_ERROR, message: `Internal server error: ${error.message}` };
            case "NOT_FOUND":
                logger.error({ location: "1edeba58-7b33-4faf-9565-a3e50a92c3af" }, `[404] ${request.method} ${path}`);
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
