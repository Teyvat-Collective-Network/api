import { App } from "../lib/app.js";
import attributes from "./v1/attributes.js";
import auditLogs from "./v1/audit-logs.js";
import auth from "./v1/auth.js";
import banshares from "./v1/banshares.js";
import characters from "./v1/characters.js";
import docs from "./v1/docs.js";
import electionHistory from "./v1/election-history.js";
import events from "./v1/events.js";
import global from "./v1/global.js";
import guilds from "./v1/guilds.js";
import observationRecords from "./v1/observation-records.js";
import polls from "./v1/polls.js";
import root from "./v1/root.js";
import submit from "./v1/submit.js";
import users from "./v1/users.js";

export default (app: App) =>
    app.group("/v1", (app) =>
        app
            .use(attributes)
            .use(auditLogs)
            .use(auth)
            .use(banshares)
            .use(characters)
            .use(docs)
            .use(electionHistory)
            .use(events)
            .use(global)
            .use(guilds)
            .use(observationRecords)
            .use(polls)
            .use(root)
            .use(submit)
            .use(users),
    );
