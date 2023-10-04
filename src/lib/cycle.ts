import logger from "./logger.js";

export default function (fn: (...args: any[]) => any, length: number) {
    async function withLog() {
        try {
            await fn();
        } catch (error) {
            logger.error(error, `[a5943913-2543-480e-ae82-f29571010c94] Error running cycle:`);
        }
    }

    setTimeout(() => (withLog(), setInterval(withLog, length)), length - (Date.now() % length));
}
