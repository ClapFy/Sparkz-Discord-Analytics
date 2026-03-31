import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);

const envSchema = z
  .object({
    DISCORD_GUILD_ID: snowflake,
    CLICKHOUSE_HOST: z.string().min(1),
    CLICKHOUSE_PORT: z.coerce.number().int().positive().default(8443),
    CLICKHOUSE_USER: z.string().min(1),
    CLICKHOUSE_PASSWORD: z.string(),
    CLICKHOUSE_DATABASE: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_]+$/, "alphanumeric database name only")
      .default("sparkzanalytics"),
    CLICKHOUSE_SECURE: z
      .string()
      .optional()
      .transform((v) => v !== "false" && v !== "0"),
    ADMIN_USERNAME: z.string().min(1),
    ADMIN_PASSWORD: z.string().min(1),
    NEXTAUTH_SECRET: z.string().min(32).optional(),
    SESSION_SECRET: z.string().min(32).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.NEXTAUTH_SECRET && !data.SESSION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Set NEXTAUTH_SECRET or SESSION_SECRET (min 32 characters)",
        path: ["NEXTAUTH_SECRET"],
      });
    }
  });

export type WebEnv = z.infer<typeof envSchema>;

let cached: WebEnv | null = null;

export function getWebEnv(): WebEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid web environment variables");
  }
  cached = parsed.data;
  return parsed.data;
}

export function getGuildIdU64(): string {
  return getWebEnv().DISCORD_GUILD_ID;
}
