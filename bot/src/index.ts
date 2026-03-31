import {
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { BatchedClickHouse } from "./clickhouse.js";
import { registerCollectors } from "./collectors.js";
import { loadEnv } from "./env.js";

const env = loadEnv();

const levels = ["debug", "info", "warn", "error"] as const;
const levelIdx = levels.indexOf(env.LOG_LEVEL);

function log(level: (typeof levels)[number], msg: string) {
  const i = levels.indexOf(level);
  if (i >= levelIdx) console.log(`[${level}] ${msg}`);
}

const ch = new BatchedClickHouse(env, (err) => {
  log("error", `ClickHouse: ${err instanceof Error ? err.message : String(err)}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

registerCollectors(client, env.DISCORD_GUILD_ID, ch, (level, msg) =>
  log(level as "debug" | "info" | "warn" | "error", msg)
);

async function shutdown() {
  log("info", "Shutting down");
  await ch.shutdown();
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

client.login(env.DISCORD_BOT_TOKEN).catch((e) => {
  console.error(e);
  process.exit(1);
});
