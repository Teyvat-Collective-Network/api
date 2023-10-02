import { App } from "../lib/app.js";
import attributes from "./v1/attributes.js";
import auth from "./v1/auth.js";
import banshares from "./v1/banshares.js";
import characters from "./v1/characters.js";
import docs from "./v1/docs.js";
import events from "./v1/events.js";
import guilds from "./v1/guilds.js";
import root from "./v1/root.js";
import submit from "./v1/submit.js";
import users from "./v1/users.js";

export default (app: App) =>
    app.group("/v1", (app) => app.use(root).use(auth).use(users).use(guilds).use(attributes).use(characters).use(events).use(submit).use(banshares).use(docs));
