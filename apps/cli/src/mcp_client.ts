
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";


import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// load repo-root .env
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
});



function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in environment`);
  return v;
}

async function main() {
  requireEnv("OPENAI_API_KEY");

  const client = new MultiServerMCPClient({
  time: {
    transport: "http",
    url: "http://localhost:3000/mcp",
  },
  perplexity: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@perplexity-ai/mcp-server"],
    env: {
      PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY ?? "",
    },
  },
});


  const tools = await client.getTools();

  const agent = createAgent({
    model: new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 }),
    tools,
  });

  const result = await agent.invoke({
    messages: [
      { role: "user", content: "what is hapening with nvidia openai and ai bubble." },  // What is the current date time? Use tools if needed.
    ],
  });

  // If the agent used tools, LangChain usually returns a full trace.
  // For interview-friendly output: print tool usage lines plus final assistant text.

  const anyResult = result as any;
  const messages = Array.isArray(anyResult?.messages) ? anyResult.messages : [];

  for (const m of messages) {
    const toolCalls =
      m?.tool_calls ??
      m?.additional_kwargs?.tool_calls ??
      [];

    for (const tc of toolCalls) {
      const name = tc?.name ?? tc?.function?.name;
      if (name) console.log(`[tool call] ${name}`);
    }
  }

  // Print final assistant message
  const last = messages[messages.length - 1];
  const text = typeof last?.content === "string" ? last.content : "";

  if (text) console.log(text);
  else console.log("(no assistant text returned)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
