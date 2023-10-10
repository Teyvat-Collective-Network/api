import { app } from "./lib/app.js";
import { connect } from "./lib/db.js";
import "./lib/internal.js";
import logger from "./lib/logger.js";
import setup from "./lib/setup.js";
import "./lib/tasks.js";
import "./lib/websockets.js";
import routes from "./routes/index.js";

process.on("uncaughtException", (error) => logger.error(error, "48542d76-39a7-4767-bed1-3131962031a0"));

await connect();

app.use(routes).listen(Bun.env.PORT || 4000);

logger.info({ location: "6b994c74-f8eb-4e7b-af73-c946198d555e" }, `TCN API is running at ${app.server?.hostname}:${app.server?.port}`);

await setup();
