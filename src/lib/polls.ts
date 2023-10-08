import { Poll } from "./types.js";

export function extractForBot(poll: Poll & { close: number; closed: boolean }) {
    return Object.fromEntries(
        [
            "id",
            "close",
            "closed",
            "live",
            "restricted",
            "quorum",
            "mode",
            "question",
            "preinduct",
            "server",
            "wave",
            "seats",
            "candidates",
            "min",
            "max",
            "options",
        ].map((x) => [x, (poll as any)[x]]),
    );
}
