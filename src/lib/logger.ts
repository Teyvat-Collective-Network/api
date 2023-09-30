import pino from "pino";

export default pino({ name: "API", level: Bun.env.LOG_LEVEL || (Bun.env.PRODUCTION ? "info" : "trace") });
