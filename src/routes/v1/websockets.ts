import { App } from "../../lib/app.js";

export default (app: App) =>
    app.ws("/ws", {
        open(ws) {
            console.log("Opened websocket connection:", ws);
        },
    });
