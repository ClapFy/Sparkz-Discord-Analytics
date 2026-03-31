type Row = Record<string, unknown>;

/** ClickHouse JSONEachRow rejects ISO strings with `T`/`Z`; use space-separated UTC. */
export function toClickhouseDateTime64(d: Date): string {
  const s = d.toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 23)}`;
}

export function normalizeRowForJsonEachRow(row: Row): Row {
  const out: Row = {};
  for (const [key, val] of Object.entries(row)) {
    if (val instanceof Date) {
      out[key] = toClickhouseDateTime64(val);
    } else if (Array.isArray(val)) {
      out[key] = val.map((x) => (x instanceof Date ? toClickhouseDateTime64(x) : x));
    } else {
      out[key] = val;
    }
  }
  return out;
}
