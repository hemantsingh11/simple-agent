
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";


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
  const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 }).bindTools(
    tools
  );

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  };

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("model", callModel)
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "model")
    .addConditionalEdges("model", toolsCondition)
    .addEdge("tools", "model")
    .compile();

  const result = await graph.invoke({
    messages: [
      new HumanMessage("what is hapening with nvidia openai and ai bubble."),
    ],
  });

  // If the agent used tools, LangChain usually returns a full trace.
  // For interview-friendly output: print tool usage lines plus final assistant text.

  const anyResult = result as any;
  const messages = Array.isArray(anyResult?.messages) ? anyResult.messages : [];

  for (const m of messages) {
    const toolCalls = isAIMessage(m)
      ? m.tool_calls ?? m.additional_kwargs?.tool_calls ?? []
      : [];

    for (const tc of toolCalls) {
      let name: string | undefined;
      if (tc && typeof tc === "object") {
        if ("name" in tc && typeof tc.name === "string") {
          name = tc.name;
        } else if (
          "function" in tc &&
          tc.function &&
          typeof tc.function === "object" &&
          "name" in tc.function &&
          typeof tc.function.name === "string"
        ) {
          name = tc.function.name;
        }
      }
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
