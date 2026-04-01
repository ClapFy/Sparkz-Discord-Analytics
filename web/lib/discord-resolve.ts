/**
 * Resolve Discord snowflakes to display labels via REST (server-side only).
 * Uses the same bot token as ingestion; optional — tables fall back to raw IDs if unset.
 */

const API = "https://discord.com/api/v10";

function botToken(): string | undefined {
  const t = process.env.DISCORD_BOT_TOKEN?.trim();
  return t || undefined;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bot ${token}` };
}

function formatUser(u: { username: string; global_name?: string | null }): string {
  const g = u.global_name?.trim();
  if (g) return `${g} (@${u.username})`;
  return `@${u.username}`;
}

function formatMember(m: {
  nick?: string | null;
  user: { username: string; global_name?: string | null };
}): string {
  const nick = m.nick?.trim();
  if (nick) return `${nick} (@${m.user.username})`;
  return formatUser(m.user);
}

async function fetchGuildMemberLabel(
  guildId: string,
  userId: string,
  token: string
): Promise<string> {
  let res = await fetch(`${API}/guilds/${guildId}/members/${userId}`, {
    headers: authHeaders(token),
  });
  if (res.ok) {
    const m = (await res.json()) as { nick?: string | null; user: { username: string; global_name?: string | null } };
    if (m.user?.username) return formatMember(m);
  }
  res = await fetch(`${API}/users/${userId}`, { headers: authHeaders(token) });
  if (res.ok) {
    const u = (await res.json()) as { username: string; global_name?: string | null };
    if (u.username) return formatUser(u);
  }
  return userId;
}

async function fetchChannelLabel(channelId: string, token: string): Promise<string> {
  const res = await fetch(`${API}/channels/${channelId}`, { headers: authHeaders(token) });
  if (!res.ok) return channelId;
  const c = (await res.json()) as { name?: string; type?: number };
  if (typeof c.name === "string" && c.name.length > 0) return `#${c.name}`;
  return channelId;
}

async function mapUniqueIds(
  ids: string[],
  concurrency: number,
  resolveOne: (id: string) => Promise<string>
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, string>();
  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    const labels = await Promise.all(chunk.map((id) => resolveOne(id)));
    chunk.forEach((id, j) => map.set(id, labels[j]!));
  }
  return map;
}

/** Table rows: at, channel_id, author_id, event → at, channel, author, event */
export async function enrichMessageEventTableRows(
  rows: Record<string, string>[],
  guildId: string
): Promise<Record<string, string>[]> {
  const token = botToken();
  if (!token || rows.length === 0) return rows;

  const authorIds = rows.map((r) => r.author_id).filter(Boolean);
  const channelIds = rows.map((r) => r.channel_id).filter(Boolean);

  const [authors, channels] = await Promise.all([
    mapUniqueIds(authorIds, 5, (id) => fetchGuildMemberLabel(guildId, id, token)),
    mapUniqueIds(channelIds, 5, (id) => fetchChannelLabel(id, token)),
  ]);

  return rows.map((r) => ({
    at: r.at,
    channel: channels.get(r.channel_id) ?? r.channel_id,
    author: authors.get(r.author_id) ?? r.author_id,
    event: r.event,
  }));
}

/** Table rows: at, user_id, event → at, user, event */
export async function enrichMemberEventTableRows(
  rows: Record<string, string>[],
  guildId: string
): Promise<Record<string, string>[]> {
  const token = botToken();
  if (!token || rows.length === 0) return rows;

  const userIds = rows.map((r) => r.user_id).filter(Boolean);
  const users = await mapUniqueIds(userIds, 5, (id) => fetchGuildMemberLabel(guildId, id, token));

  return rows.map((r) => ({
    at: r.at,
    user: users.get(r.user_id) ?? r.user_id,
    event: r.event,
  }));
}
