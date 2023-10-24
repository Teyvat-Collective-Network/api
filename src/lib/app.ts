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
import { stripMongoIds, trim } from "./utils.js";
import { broadcast } from "./websockets.js";

export const app = new Elysia()
    .use(cors())
    .use(
        swagger({
            documentation: {
                info: {
                    title: "Teyvat Collective Network Public API",
                    description: trim(`
                        ### TCN API

                        Welcome to the Teyvat Collective Network public API! This API is used for all database manipulation by all processes and is the single
                        source of truth for all database CRUD operations. For any issues, questions, or comments, please contact the developer using the links
                        below.

                        Some actions support (or require) audit log reasons. Set the \`X-Audit-Log-Reason\` header for these routes. Check the headers section
                        for a route to determine if it supports this header.
                    `),
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

        return { user: { ...payload, ...(await data.getUser(payload.id, !!payload.internal)), token: bearer }, internal: !!payload.internal };
    })
    .derive(async ({ headers }) => {
        const reason = headers["x-audit-log-reason"]?.trim() || null;
        if (reason?.length === 0 || (reason && reason.length > 256)) throw new APIError(400, codes.INVALID_BODY, "Audit log reason must be 1-256 characters");
        return { reason };
    })
    .onBeforeHandle(({ bearer, body, internal, path, request, user }) => {
        const token = bearer?.split(".")[1];

        logger.info(
            { location: "dd024f32-1c79-47bb-a7ca-e9858f247c80", token },
            `${request.method} ${path} [${user?.id ?? "anon"}]${internal ? " [internal]" : ""}`,
        );

        broadcast("api", ["request", request.method, path, body, user?.id, internal, token]);
    })
    .onAfterHandle(({ response }) => stripMongoIds(response))
    .error({ API_ERROR: APIError })
    .onError(({ code, error, path, request, set }) => {
        if (code !== "NOT_FOUND") logger.error(error, `cf70b286-db7a-4d59-b34c-b56d90608b6d Error in ${request.method} ${path}`);

        switch (code) {
            case "API_ERROR":
                set.status = error.status;
                return { code: error.errorCode, message: error.message };
            case "INTERNAL_SERVER_ERROR":
            case "UNKNOWN":
                set.status = 500;
                return { code: codes.INTERNAL_SERVER_ERROR, message: `Internal server error: ${error.message}` };
            case "NOT_FOUND":
                logger.error(`1edeba58-7b33-4faf-9565-a3e50a92c3af [404] ${request.method} ${path}`);
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
