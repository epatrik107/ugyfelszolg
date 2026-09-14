// Restore drill: loads a `wrangler d1 export` dump into an empty SQLite database
// with foreign keys enabled and checks it against row counts read from the live
// database just before the export. Prints table names and counts only.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const CRITICAL_TABLES = ["orders", "invoices", "order_status_log", "payment_refunds", "payment_disputes", "processed_stripe_events", "email_outbox"];

export function verifyBackupSql(sql, expectedMinimumCounts) {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON");
    database.exec(sql);
    const problems = [];
    const counts = {};
    for (const table of CRITICAL_TABLES) {
      const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!exists) {
        problems.push(`Missing table ${table}.`);
        continue;
      }
      const { n } = database.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get();
      counts[table] = Number(n);
      // Rows can be written between counting and exporting, never removed.
      if (counts[table] < Number(expectedMinimumCounts[table] ?? 0)) {
        problems.push(`${table}: backup has ${counts[table]} rows, live database had ${expectedMinimumCounts[table]}.`);
      }
    }
    const violations = database.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) problems.push(`${violations.length} foreign key violation(s) after restore.`);
    return { counts, problems };
  } finally {
    database.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, countsFile] = process.argv.slice(2);
  const expected = JSON.parse(readFileSync(countsFile, "utf8"));
  const { counts, problems } = verifyBackupSql(readFileSync(file, "utf8"), expected);
  console.log(`Restored row counts: ${JSON.stringify(counts)}`);
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}
