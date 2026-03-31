import { createClient } from "@clickhouse/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Env } from "./env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function ddlStatements(database: string): string[] {
  const path = join(__dirname, "..", "..", "clickhouse", "migrations", "001_init.sql");
  let sql = readFileSync(path, "utf8");
  sql = sql.replace(/sparkzanalytics/g, database);
  sql = sql.replace(/CREATE DATABASE IF NOT EXISTS \w+;\s*\n?/gi, "");
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function ensureSchema(env: Env): Promise<void> {
  const client = createClient({
    url: `${env.CLICKHOUSE_SECURE ? "https" : "http"}://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT}`,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DATABASE,
  });
  try {
    await client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${env.CLICKHOUSE_DATABASE}`,
    });
    for (const stmt of ddlStatements(env.CLICKHOUSE_DATABASE)) {
      await client.command({ query: stmt });
    }
  } finally {
    await client.close();
  }
}
