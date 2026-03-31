import type {
  Channel,
  Client,
  GuildMember,
  Message,
  PartialGuildMember,
  PartialMessage,
  VoiceState,
} from "discord.js";
import type { BatchedClickHouse } from "./clickhouse.js";
import { toU64 } from "./ids.js";

function isTargetGuild(guildId: string | undefined, target: string): guildId is string {
  return guildId === target;
}

function rowMessage(m: Message, overrides: Partial<Record<string, unknown>> = {}) {
  const ref = m.reference?.messageId;
  const threadId = m.channel.isThread() ? m.channel.id : null;
  return {
    message_id: toU64(m.id),
    guild_id: toU64(m.guildId!),
    channel_id: toU64(m.channelId),
    author_id: toU64(m.author.id),
    created_at: m.createdAt,
    edited_at: m.editedAt ?? null,
    deleted_at: null as Date | null,
    attachment_count: m.attachments.size,
    embed_count: m.embeds.length,
    sticker_count: m.stickers.size,
    reference_message_id: ref ? toU64(ref) : null,
    thread_id: threadId ? toU64(threadId) : null,
    flags: Number(m.flags.bitfield),
    type: m.type,
    ...overrides,
  };
}

function rowMessageEvent(
  m: Message | PartialMessage,
  event: string,
  at: Date,
  guildId: string
) {
  return {
    guild_id: toU64(guildId),
    channel_id: toU64(m.channelId!),
    author_id: m.author?.id ? toU64(m.author.id) : "0",
    message_id: toU64(m.id!),
    event,
    at,
  };
}

function memberRow(member: GuildMember | PartialGuildMember) {
  const g = member.guild;
  const roles = "roles" in member && member.roles ? [...member.roles.cache.keys()].map(toU64) : [];
  return {
    user_id: toU64(member.id),
    guild_id: toU64(g.id),
    joined_at: "joinedAt" in member && member.joinedAt ? member.joinedAt : null,
    premium_since: member.premiumSince,
    role_ids: roles,
  };
}

function channelPosition(channel: Channel): number {
  if ("position" in channel && typeof channel.position === "number") return channel.position;
  if ("rawPosition" in channel && typeof channel.rawPosition === "number") return channel.rawPosition;
  return 0;
}

export function registerCollectors(
  client: Client,
  targetGuildId: string,
  ch: BatchedClickHouse,
  log: (level: string, msg: string) => void
) {
  const voiceStart = new Map<string, { channelId: string; startedAt: Date }>();

  function voiceKey(guildId: string, userId: string) {
    return `${guildId}:${userId}`;
  }

  function endVoiceSession(guildId: string, userId: string, channelId: string, endedAt: Date) {
    const k = voiceKey(guildId, userId);
    const s = voiceStart.get(k);
    if (!s || s.channelId !== channelId) return;
    voiceStart.delete(k);
    const duration = Math.max(0, Math.floor((endedAt.getTime() - s.startedAt.getTime()) / 1000));
    ch.queue("voice_sessions", {
      guild_id: toU64(guildId),
      user_id: toU64(userId),
      channel_id: toU64(channelId),
      started_at: s.startedAt,
      ended_at: endedAt,
      duration_seconds: duration,
    });
  }

  function startVoiceSession(guildId: string, userId: string, channelId: string, at: Date) {
    const k = voiceKey(guildId, userId);
    voiceStart.set(k, { channelId, startedAt: at });
  }

  function queueChannelUpsert(channel: Channel, click: BatchedClickHouse, deletedAt: Date | null) {
    if (channel.isDMBased()) return;
    const gid = channel.guildId;
    if (!isTargetGuild(gid, targetGuildId)) return;
    const parentId =
      "parentId" in channel && channel.parentId ? toU64(channel.parentId) : null;
    click.queue("channels", {
      channel_id: toU64(channel.id),
      guild_id: toU64(gid),
      type: channel.type,
      parent_id: parentId,
      position: channelPosition(channel),
      deleted_at: deletedAt,
    });
  }

  client.once("ready", async (c) => {
    log("info", `Ready as ${c.user.tag}`);
    for (const g of c.guilds.cache.values()) {
      if (g.id !== targetGuildId) {
        log("info", `Leaving non-target guild ${g.id}`);
        await g.leave().catch((e) => log("warn", String(e)));
      }
    }
    const g = c.guilds.cache.get(targetGuildId);
    if (g) {
      ch.queue("guild_snapshots", {
        guild_id: toU64(g.id),
        member_count: g.memberCount ?? 0,
        approximate_presence_count: null,
        at: new Date(),
      });
      for (const chn of g.channels.cache.values()) {
        queueChannelUpsert(chn, ch, null);
      }
    }
  });

  client.on("guildCreate", async (g) => {
    if (g.id !== targetGuildId) {
      log("info", `Leaving guild ${g.id} (not target)`);
      await g.leave().catch((e) => log("warn", String(e)));
    }
  });

  client.on("channelCreate", (channel) => {
    queueChannelUpsert(channel, ch, null);
  });

  client.on("channelUpdate", (_old, channel) => {
    queueChannelUpsert(channel, ch, null);
  });

  client.on("channelDelete", (channel) => {
    if (channel.isDMBased()) return;
    if (!isTargetGuild(channel.guildId ?? undefined, targetGuildId)) return;
    ch.queue("channels", {
      channel_id: toU64(channel.id),
      guild_id: toU64(channel.guildId!),
      type: channel.type,
      parent_id: "parentId" in channel && channel.parentId ? toU64(channel.parentId) : null,
      position: channelPosition(channel),
      deleted_at: new Date(),
    });
  });

  client.on("guildUpdate", (_o, g) => {
    if (g.id !== targetGuildId) return;
    ch.queue("guild_snapshots", {
      guild_id: toU64(g.id),
      member_count: g.memberCount ?? 0,
      approximate_presence_count: null,
      at: new Date(),
    });
  });

  client.on("messageCreate", (m: Message) => {
    if (!m.guildId || m.guildId !== targetGuildId) return;
    ch.queue("messages", rowMessage(m));
    ch.queue("message_events", rowMessageEvent(m, "create", m.createdAt, m.guildId));
  });

  client.on("messageUpdate", (_old, m: Message) => {
    if (!m.guildId || m.guildId !== targetGuildId) return;
    ch.queue("messages", rowMessage(m, { edited_at: m.editedAt ?? new Date() }));
    ch.queue("message_events", rowMessageEvent(m, "update", new Date(), m.guildId));
  });

  client.on("messageDelete", (m: Message | PartialMessage) => {
    const gid = m.guildId;
    if (!gid || gid !== targetGuildId) return;
    const at = new Date();
    if (m.partial) {
      ch.queue("message_events", {
        guild_id: toU64(gid),
        channel_id: toU64(m.channelId!),
        author_id: "0",
        message_id: toU64(m.id!),
        event: "delete",
        at,
      });
      return;
    }
    ch.queue("messages", rowMessage(m as Message, { deleted_at: at }));
    ch.queue("message_events", rowMessageEvent(m as Message, "delete", at, gid));
  });

  client.on("guildMemberAdd", (member) => {
    if (member.guild.id !== targetGuildId) return;
    ch.queue("member_events", {
      guild_id: toU64(member.guild.id),
      user_id: toU64(member.id),
      event: "join",
      at: new Date(),
    });
    ch.queue("members", memberRow(member));
  });

  client.on("guildMemberRemove", (member) => {
    if (member.guild.id !== targetGuildId) return;
    ch.queue("member_events", {
      guild_id: toU64(member.guild.id),
      user_id: toU64(member.id),
      event: "leave",
      at: new Date(),
    });
  });

  client.on("guildMemberUpdate", (_old, member) => {
    if (member.guild.id !== targetGuildId) return;
    ch.queue("member_events", {
      guild_id: toU64(member.guild.id),
      user_id: toU64(member.id),
      event: "update",
      at: new Date(),
    });
    ch.queue("members", memberRow(member));
  });

  client.on("messageReactionAdd", (reaction, user) => {
    if (user.bot) return;
    const msg = reaction.message;
    if (!msg.guildId || msg.guildId !== targetGuildId) return;
    const emoji = reaction.emoji.id
      ? `${reaction.emoji.name}:${reaction.emoji.id}`
      : reaction.emoji.name ?? "";
    ch.queue("reactions", {
      guild_id: toU64(msg.guildId),
      channel_id: toU64(msg.channelId),
      message_id: toU64(msg.id),
      user_id: toU64(user.id),
      emoji,
      added: 1,
      at: new Date(),
    });
  });

  client.on("messageReactionRemove", (reaction, user) => {
    if (user.bot) return;
    const msg = reaction.message;
    if (!msg.guildId || msg.guildId !== targetGuildId) return;
    const emoji = reaction.emoji.id
      ? `${reaction.emoji.name}:${reaction.emoji.id}`
      : reaction.emoji.name ?? "";
    ch.queue("reactions", {
      guild_id: toU64(msg.guildId),
      channel_id: toU64(msg.channelId),
      message_id: toU64(msg.id),
      user_id: toU64(user.id),
      emoji,
      added: 0,
      at: new Date(),
    });
  });

  client.on("voiceStateUpdate", (oldState: VoiceState, newState: VoiceState) => {
    const guildId = newState.guild.id;
    if (guildId !== targetGuildId) return;
    const userId = newState.id;
    const oldId = oldState.channelId;
    const newId = newState.channelId;
    if (oldId === newId) return;
    const now = new Date();
    if (oldId) endVoiceSession(guildId, userId, oldId, now);
    if (newId) startVoiceSession(guildId, userId, newId, now);
  });
}
