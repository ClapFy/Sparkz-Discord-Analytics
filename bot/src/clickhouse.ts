import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { Env } from "./env.js";

type TableRow = Record<string, unknown>;

export class BatchedClickHouse {
  private client: ClickHouseClient;
  private buffers = new Map<string, TableRow[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> = Promise.resolve();

  constructor(
    private env: Env,
    private onError: (err: unknown) => void
  ) {
    this.client = createClient({
      url: `${env.CLICKHOUSE_SECURE ? "https" : "http"}://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT}`,
      username: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD,
      database: env.CLICKHOUSE_DATABASE,
    });

    this.timer = setInterval(() => {
      void this.flushAll();
    }, env.CH_BATCH_MS);
  }

  queue(table: string, row: TableRow) {
    const full = `${this.env.CLICKHOUSE_DATABASE}.${table}`;
    const list = this.buffers.get(full) ?? [];
    list.push(row);
    this.buffers.set(full, list);
    if (list.length >= this.env.CH_BATCH_MAX_ROWS) {
      void this.flushTable(full, list.splice(0, list.length));
    }
  }

  private async flushTable(table: string, rows: TableRow[]) {
    if (rows.length === 0) return;
    try {
      await this.client.insert({
        table,
        values: rows,
        format: "JSONEachRow",
      });
    } catch (e) {
      this.onError(e);
    }
  }

  async flushAll(): Promise<void> {
    this.flushPromise = this.flushPromise.then(async () => {
      for (const [table, rows] of [...this.buffers.entries()]) {
        if (rows.length === 0) continue;
        const copy = rows.splice(0, rows.length);
        await this.flushTable(table, copy);
      }
    });
    return this.flushPromise;
  }

  async shutdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flushAll();
    await this.client.close();
  }
}
