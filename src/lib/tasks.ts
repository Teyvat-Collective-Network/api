import { readdir } from "node:fs/promises";

for (const name of await readdir("./src/tasks")) await import(`../tasks/${name}`);
