import { App } from "../index.js";
import attributes from "./v1/attributes.js";
import auth from "./v1/auth.js";
import characters from "./v1/characters.js";
import events from "./v1/events.js";
import guilds from "./v1/guilds.js";
import root from "./v1/root.js";
import users from "./v1/users.js";

export default (app: App) => app.group("/v1", (app) => app.use(root).use(auth).use(users).use(guilds).use(attributes).use(characters).use(events));
