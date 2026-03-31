import { z } from "zod";

const snowflake = z
  .string()
  .regex(/^\d{17,20}$/, "must be a Discord snowflake");

export const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: snowflake,
  CLICKHOUSE_HOST: z.string().min(1),
  CLICKHOUSE_PORT: z.coerce.number().int().positive().default(8443),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string(),
  CLICKHOUSE_DATABASE: z.string().min(1).default("sparkzanalytics"),
  CLICKHOUSE_SECURE: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CH_BATCH_MS: z.coerce.number().int().positive().default(2000),
  CH_BATCH_MAX_ROWS: z.coerce.number().int().positive().default(500),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables for bot");
  }
  return parsed.data;
}
