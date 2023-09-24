import codes from "./codes.js";

export class APIError extends Error {
    constructor(public status: number, public errorCode: codes, public message: string) {
        super(message);
    }
}
