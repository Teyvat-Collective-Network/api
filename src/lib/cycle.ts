import logger from "./logger.js";

export default function (fn: (...args: any[]) => any, length: number) {
    async function withLog() {
        try {
            await fn();
        } catch (error) {
            logger.error(error, "a866a6ea-7cc0-4476-a6fc-62e835534b31");
        }
    }

    setTimeout(() => (withLog(), setInterval(withLog, length)), length - (Date.now() % length));
}
