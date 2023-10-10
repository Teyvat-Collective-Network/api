import { ServerWebSocket } from "bun";
import { app } from "./app.js";
import data from "./data.js";
import logger from "./logger.js";

const connections: Record<string, Set<ServerWebSocket<unknown>>> = {};

export async function broadcast(topic: string, ...messages: any[][]) {
    const texts = messages.map((message) => JSON.stringify([topic, ...message]));

    for (const [key, sockets] of Object.entries(connections)) {
        const user = await data.getUser(key);

        if (user.observer)
            for (const socket of sockets) {
                if (!socket.isSubscribed(topic)) continue;

                try {
                    for (const text of texts) socket.send(text);
                } catch (error) {
                    logger.error(error, "e52ee013-19a4-4762-8e7f-178f58b90f32");
                }
            }
        else {
            for (const socket of sockets) {
                try {
                    socket.send(JSON.stringify(["error", "You are no longer an observer and your access to the websocket has been terminated."]));
                    socket.close();
                } catch (error) {
                    logger.error(error, "54f039f0-f79c-4f67-9137-55e81d1b8065");
                }
            }

            delete connections[key];
        }
    }
}

Bun.serve({
    port: Bun.env.WS_PORT_V1 || 4002,
    fetch(req, server) {
        if (server.upgrade(req)) return undefined as any;
        return { error: "Failed to upgrade connection." };
    },
    websocket: {
        async message(ws, message) {
            const string = message.toString("utf-8").trim();
            const command = string.split(/\s/)[0];
            const text = string.slice(command.length).trim();

            if (command === "TOKEN")
                try {
                    const { id, scopes, created, expires }: { id: string; scopes: string[]; created: number; expires?: number } = await (
                        await app.handle(
                            new Request(`http://localhost:${Bun.env.PORT || 4000}/v1/auth/key-info`, { headers: { Authorization: `Bearer ${text}` } }),
                        )
                    ).json();

                    if (!created) throw "Invalid token.";
                    if (expires && expires <= Date.now()) throw "Your token has expired.";
                    if (!(await data.getUser(id)).observer) throw "You must be an observer to connect.";
                    if (!(scopes.includes("all") || scopes.includes("monitor"))) throw 'That token is missing the "monitor" scope.';

                    (connections[id] ??= new Set()).add(ws);
                    ws.send('["OK"]');
                } catch (error) {
                    ws.send(JSON.stringify(["error", typeof error === "string" ? error : "Authenticating the websocket connection failed."]));
                }
            else if (command === "SUBSCRIBE") ws.subscribe(text);
            else if (command === "UNSUBSCRIBE") ws.unsubscribe(text);
        },
        async close(ws) {
            for (const set of Object.values(connections)) set.delete(ws);
        },
    },
});
