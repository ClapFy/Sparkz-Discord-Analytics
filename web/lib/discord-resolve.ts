/**
 * Resolve Discord snowflakes to display labels via REST (server-side only).
 * Uses DISCORD_BOT_TOKEN; falls back to raw IDs if unset or on API errors.
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

/** Discord ChannelType — match labels to how clients usually show channels */
function labelForChannelType(type: number, name: string): string {
  switch (type) {
    case 2: // GUILD_VOICE
    case 13: // GUILD_STAGE
      return `🔊 ${name}`;
    case 4: // GUILD_CATEGORY
      return `📁 ${name}`;
    default:
      return `#${name}`;
  }
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
  if (typeof c.name === "string" && c.name.length > 0 && typeof c.type === "number") {
    return labelForChannelType(c.type, c.name);
  }
  if (typeof c.name === "string" && c.name.length > 0) return `#${c.name}`;
  return channelId;
}

/** All guild channels (threads not listed — filled via fetchChannelLabel). */
async function fetchGuildChannelLabelMap(guildId: string, token: string): Promise<Map<string, string>> {
  const res = await fetch(`${API}/guilds/${guildId}/channels`, { headers: authHeaders(token) });
  const map = new Map<string, string>();
  if (!res.ok) return map;
  const list = (await res.json()) as Array<{ id: string; name: string; type: number }>;
  for (const ch of list) {
    if (ch?.id && typeof ch.name === "string" && ch.name.length > 0 && typeof ch.type === "number") {
      map.set(String(ch.id), labelForChannelType(ch.type, ch.name));
    }
  }
  return map;
}

async function fetchGuildRoleLabelMap(guildId: string, token: string): Promise<Map<string, string>> {
  const res = await fetch(`${API}/guilds/${guildId}/roles`, { headers: authHeaders(token) });
  const map = new Map<string, string>();
  if (!res.ok) return map;
  const list = (await res.json()) as Array<{ id: string; name: string }>;
  for (const r of list) {
    if (r?.id && typeof r.name === "string") map.set(String(r.id), r.name);
  }
  return map;
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

async function mergeChannelLabels(
  guildId: string,
  token: string,
  neededIds: string[]
): Promise<Map<string, string>> {
  const guildMap = await fetchGuildChannelLabelMap(guildId, token);
  const unique = [...new Set(neededIds.map((id) => String(id)).filter(Boolean))];
  const out = new Map<string, string>();
  for (const id of unique) {
    const hit = guildMap.get(id);
    if (hit) out.set(id, hit);
  }
  const missing = unique.filter((id) => !out.has(id));
  if (missing.length > 0) {
    const extra = await mapUniqueIds(missing, 5, (id) => fetchChannelLabel(id, token));
    for (const [id, label] of extra) out.set(id, label);
  }
  return out;
}

/** Table rows: at, channel_id, author_id, event → at, channel, author, event */
export async function enrichMessageEventTableRows(
  rows: Record<string, string>[],
  guildId: string
): Promise<Record<string, string>[]> {
  const token = botToken();
  if (!token || rows.length === 0) return rows;

  const authorIds = rows.map((r) => String(r.author_id ?? "")).filter(Boolean);
  const channelIds = rows.map((r) => String(r.channel_id ?? "")).filter(Boolean);

  const [authors, channels] = await Promise.all([
    mapUniqueIds(authorIds, 5, (id) => fetchGuildMemberLabel(guildId, id, token)),
    mergeChannelLabels(guildId, token, channelIds),
  ]);

  return rows.map((r) => {
    const cid = String(r.channel_id ?? "");
    const aid = String(r.author_id ?? "");
    return {
      at: r.at,
      channel: channels.get(cid) ?? cid,
      author: authors.get(aid) ?? aid,
      event: r.event,
    };
  });
}

/** Table rows: at, user_id, event → at, user, event */
export async function enrichMemberEventTableRows(
  rows: Record<string, string>[],
  guildId: string
): Promise<Record<string, string>[]> {
  const token = botToken();
  if (!token || rows.length === 0) return rows;

  const userIds = rows.map((r) => String(r.user_id ?? "")).filter(Boolean);
  const users = await mapUniqueIds(userIds, 5, (id) => fetchGuildMemberLabel(guildId, id, token));

  return rows.map((r) => {
    const uid = String(r.user_id ?? "");
    return {
      at: r.at,
      user: users.get(uid) ?? uid,
      event: r.event,
    };
  });
}

/** Bar widgets: replace raw snowflake `k` with label (channel / user / role name). */
export async function enrichBarRowsByKeyKind(
  rows: { k?: string; c?: string }[],
  guildId: string,
  kind: "channel" | "user" | "role"
): Promise<{ k?: string; c?: string }[]> {
  const token = botToken();
  if (!token || rows.length === 0) return rows;

  const keys = rows.map((r) => String(r.k ?? "")).filter(Boolean);
  let labelMap: Map<string, string>;

  if (kind === "channel") {
    labelMap = await mergeChannelLabels(guildId, token, keys);
  } else if (kind === "user") {
    labelMap = await mapUniqueIds(keys, 5, (id) => fetchGuildMemberLabel(guildId, id, token));
  } else {
    const roles = await fetchGuildRoleLabelMap(guildId, token);
    labelMap = new Map();
    for (const id of keys) labelMap.set(id, roles.get(id) ?? id);
  }

  return rows.map((r) => {
    const k = String(r.k ?? "");
    return { ...r, k: labelMap.get(k) ?? k };
  });
}

/** Top reacted table: message_id, channel_id, reaction_count → message_id, channel, reaction_count */
export async function enrichTopReactedTableRows(
  rows: Record<string, string>[],
  guildId: string
): Promise<Record<string, string>[]> {
  const token = botToken();
  if (!token || rows.length === 0) return rows;

  const channelIds = rows.map((r) => String(r.channel_id ?? "")).filter(Boolean);
  const channels = await mergeChannelLabels(guildId, token, channelIds);

  return rows.map((r) => {
    const cid = String(r.channel_id ?? "");
    return {
      message_id: r.message_id,
      channel: channels.get(cid) ?? cid,
      reaction_count: r.reaction_count,
    };
  });
}
