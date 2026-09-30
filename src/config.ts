import { z } from "zod";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const OpenAIConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).max(100),
    timeoutMs: z.number().int().positive().max(180_000),
    maxOutputTokens: z.number().int().positive(),
  })
  .readonly();

export type OpenAIConfig = z.infer<typeof OpenAIConfigSchema>;
export type AppConfig = Readonly<{ openai: OpenAIConfig }>;
export type Environment = Readonly<Record<string, string | undefined>>;

/** Read local defaults without changing the process environment. */
export function readEnvironment(
  filePath = ".env",
  environment: Environment = process.env,
): Environment {
  let local: Environment = {};
  try {
    local = parseEnv(readFileSync(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Do not include file contents or raw parser errors in diagnostics.
      throw new Error("Unable to load the .env configuration file.");
    }
  }

  const merged = { ...local };
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined) merged[name] = value;
  }
  return Object.freeze(merged);
}

/** The only environment boundary. Components receive the resulting settings. */
export function loadConfig(
  environment: Environment = readEnvironment(),
): AppConfig {
  const parsed = OpenAIConfigSchema.safeParse({
    apiKey: environment.OPENAI_API_KEY?.trim() || undefined,
    model: environment.OPENAI_MODEL ?? "gpt-4.1-mini",
    timeoutMs:
      environment.OPENAI_TIMEOUT_MS === undefined
        ? 60_000
        : Number(environment.OPENAI_TIMEOUT_MS),
    maxOutputTokens: 400,
  });

  if (!parsed.success) {
    // Never attach validation input or environment values to an exception.
    throw new Error(
      "Invalid OpenAI configuration. Check OPENAI_MODEL and OPENAI_TIMEOUT_MS.",
    );
  }

  return Object.freeze({ openai: parsed.data });
}
