export function toU64(id: string | bigint): string {
  return typeof id === "bigint" ? id.toString() : id;
}
