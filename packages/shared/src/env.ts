import type { Env } from "./types.js";

export function readEnv(): Env {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }
  return { OPENAI_API_KEY: key };
}
