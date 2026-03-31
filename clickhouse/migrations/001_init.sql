CREATE DATABASE IF NOT EXISTS sparkzanalytics;

CREATE TABLE IF NOT EXISTS sparkzanalytics.messages (
  message_id UInt64,
  guild_id UInt64,
  channel_id UInt64,
  author_id UInt64,
  created_at DateTime64(3),
  edited_at Nullable(DateTime64(3)),
  deleted_at Nullable(DateTime64(3)),
  attachment_count UInt16,
  embed_count UInt16,
  sticker_count UInt16,
  reference_message_id Nullable(UInt64),
  thread_id Nullable(UInt64),
  flags UInt32,
  type UInt8,
  inserted_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (guild_id, message_id);

CREATE TABLE IF NOT EXISTS sparkzanalytics.message_events (
  guild_id UInt64,
  channel_id UInt64,
  author_id UInt64,
  message_id UInt64,
  event LowCardinality(String),
  at DateTime64(3)
) ENGINE = MergeTree
ORDER BY (guild_id, toStartOfHour(at), at, message_id);

CREATE TABLE IF NOT EXISTS sparkzanalytics.member_events (
  guild_id UInt64,
  user_id UInt64,
  event LowCardinality(String),
  at DateTime64(3)
) ENGINE = MergeTree
ORDER BY (guild_id, toStartOfHour(at), at, user_id);

CREATE TABLE IF NOT EXISTS sparkzanalytics.members (
  user_id UInt64,
  guild_id UInt64,
  joined_at Nullable(DateTime64(3)),
  premium_since Nullable(DateTime64(3)),
  role_ids Array(UInt64),
  inserted_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (guild_id, user_id);

CREATE TABLE IF NOT EXISTS sparkzanalytics.voice_sessions (
  guild_id UInt64,
  user_id UInt64,
  channel_id UInt64,
  started_at DateTime64(3),
  ended_at DateTime64(3),
  duration_seconds UInt32
) ENGINE = MergeTree
ORDER BY (guild_id, started_at, user_id);

CREATE TABLE IF NOT EXISTS sparkzanalytics.reactions (
  guild_id UInt64,
  channel_id UInt64,
  message_id UInt64,
  user_id UInt64,
  emoji String,
  added UInt8,
  at DateTime64(3)
) ENGINE = MergeTree
ORDER BY (guild_id, toStartOfHour(at), message_id, user_id, emoji);

CREATE TABLE IF NOT EXISTS sparkzanalytics.channels (
  channel_id UInt64,
  guild_id UInt64,
  type UInt8,
  parent_id Nullable(UInt64),
  position Int32,
  deleted_at Nullable(DateTime64(3)),
  inserted_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (guild_id, channel_id);

CREATE TABLE IF NOT EXISTS sparkzanalytics.guild_snapshots (
  guild_id UInt64,
  member_count UInt32,
  approximate_presence_count Nullable(UInt32),
  at DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree
ORDER BY (guild_id, at);

CREATE TABLE IF NOT EXISTS sparkzanalytics.dashboard_layouts (
  username String,
  layout_json String,
  updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree
ORDER BY (username, updated_at);
