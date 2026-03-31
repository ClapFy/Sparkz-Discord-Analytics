import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { getWebEnv } from "./env";

let client: ClickHouseClient | null = null;

export function getClickHouse(): ClickHouseClient {
  if (client) return client;
  const env = getWebEnv();
  client = createClient({
    url: `${env.CLICKHOUSE_SECURE ? "https" : "http"}://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT}`,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DATABASE,
  });
  return client;
}
