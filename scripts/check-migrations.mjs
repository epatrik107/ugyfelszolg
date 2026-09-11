import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON");
const directory = new URL("../worker/migrations/", import.meta.url);
const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
for (const file of files) db.exec(readFileSync(new URL(file, directory), "utf8"));
const integrity = db.prepare("PRAGMA integrity_check").get();
if (integrity.integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) {
  throw new Error("Migration integrity/foreign key check failed.");
}
console.log(`${files.length} migrations passed with foreign keys enabled.`);
db.close();
