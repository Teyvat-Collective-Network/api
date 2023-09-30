import internal from "./internal.js";

export default async function () {
    return await (await internal.handle(new Request("http://localhost/login/1234567890987654321"))).text();
}
