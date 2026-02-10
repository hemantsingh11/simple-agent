import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import * as z from "zod";

// Load repo root .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

// Tool: get current date and time
const getTime = tool(
  () => new Date().toISOString(),
  {
    name: "get_time",
    description: "Get the current date and time in ISO format",
    schema: z.object({})
  }
);

// Model
const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0
});

// Agent
const agent = createAgent({
  model,
  tools: [getTime],
  systemPrompt:
    "When the user asks for the current date or time, you MUST call the get_time tool before answering."
});

// One-shot invoke
const result: any = await agent.invoke({
  messages: [
    { role: "user", content: "What is the current date and time?" }
  ]
});

// Extract messages
const messages = Array.isArray(result?.messages) ? result.messages : [];

// Print tool call
for (const msg of messages) {
  const toolCalls =
    msg?.tool_calls ??
    msg?.additional_kwargs?.tool_calls ??
    msg?.kwargs?.tool_calls ??
    [];

  for (const call of toolCalls) {
    const name =
      call?.name ??
      call?.function?.name ??
      "unknown_tool";

    console.log(`[tool call] ${name}`);
  }
}

// Print final assistant message
let assistantText = "";

for (let i = messages.length - 1; i >= 0; i--) {
  const content =
    messages[i]?.content ??
    messages[i]?.kwargs?.content;

  if (typeof content === "string" && content.trim()) {
    assistantText = content;
    break;
  }
}

console.log(assistantText);
