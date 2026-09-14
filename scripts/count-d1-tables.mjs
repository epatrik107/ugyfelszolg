// Writes live row counts of the critical tables for the backup restore drill.
import { writeFileSync } from "node:fs";
import { d1Client } from "./lib/d1-rest.mjs";
import { CRITICAL_TABLES } from "./verify-d1-backup.mjs";

const query = d1Client();
const counts = {};
for (const table of CRITICAL_TABLES) {
  const [row] = await query(`SELECT COUNT(*) AS n FROM "${table}"`);
  counts[table] = Number(row.n);
}
writeFileSync(process.argv[2], JSON.stringify(counts));
console.log(`Live row counts: ${JSON.stringify(counts)}`);
