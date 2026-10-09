import { z } from "zod";

export const envSchema = z.object({
  INTEGRATIONS_MODE: z.enum(["mock", "live"]).default("mock"),
  VAANI_MODE: z.enum(["mock", "live"]).optional(),
  GEMINI_MODE: z.enum(["mock", "live"]).optional(),
  CALCOM_MODE: z.enum(["mock", "live"]).optional(),
  TELEGRAM_MODE: z.enum(["mock", "live"]).optional(),
  HUBSPOT_MODE: z.enum(["mock", "live"]).optional(),
  RESEND_MODE: z.enum(["mock", "live"]).optional(),

  DATABASE_URL: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),

  VAANI_API_KEY: z.string().optional(),
  VAANI_AGENT_ID: z.string().optional(),
  VAANI_WEBHOOK_SECRET: z.string().optional(),

  CALCOM_API_KEY: z.string().optional(),
  CALCOM_EVENT_TYPE_ID: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  HUBSPOT_PIPELINE_ID: z.string().optional(),
  HUBSPOT_STAGE_BOOKED: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  ENABLE_RESEND_FALLBACK: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  DASHBOARD_PASSWORD: z.string().default("changeme"),

  VOICE_COST_INR_PER_MIN: z.coerce.number().default(0),
  GEMINI_COST_INR_PER_1K_TOKENS: z.coerce.number().default(0),
  OTHER_FIXED_COST_INR_PER_MONTH: z.coerce.number().default(0),

  STUDIO_HOURS_START: z.string().default("10:00"),
  STUDIO_HOURS_END: z.string().default("19:00"),
  FRONT_DESK_RING_SECONDS: z.coerce.number().default(15),
  ESCALATION_MINUTES_NEAR: z.coerce.number().default(15),
  ESCALATION_MINUTES_FAR: z.coerce.number().default(60),
  TIMEZONE: z.string().default("Asia/Kolkata"),

  PROJECT_AVG_VALUE_INR_LOW: z.coerce.number().default(800000),
  PROJECT_AVG_VALUE_INR_HIGH: z.coerce.number().default(1400000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Blank-but-present vars (e.g. "VAANI_MODE=" in .env.local) should behave
  // like unset ones, not fail enum/number validation.
  const cleaned = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== "")
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration. See logs above.");
  }
  return parsed.data;
}

export const env = loadEnv();

export function integrationMode(service: "VAANI" | "GEMINI" | "CALCOM" | "TELEGRAM" | "HUBSPOT" | "RESEND"): "mock" | "live" {
  const key = `${service}_MODE` as const;
  const override = (env as unknown as Record<string, string | undefined>)[key];
  return (override as "mock" | "live" | undefined) ?? env.INTEGRATIONS_MODE;
}
