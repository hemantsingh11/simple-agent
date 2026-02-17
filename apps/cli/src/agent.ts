import { HumanMessage } from "@langchain/core/messages";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { START, StateGraph } from "@langchain/langgraph";
import { createCheckpointer, type CheckpointerBackend } from "@lc/persistence";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createModelNode, createToolsNode, toolsCondition } from "./utils/nodes.js";
import { AgentState } from "./utils/state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in environment`);
  return value;
}

interface AgentOptions {
  backend?: CheckpointerBackend;
  sqlitePath?: string;
}

interface AgentRuntime {
  graph: any;
  client: MultiServerMCPClient;
}

const REQUIRED_DB_TOOLS = [
  "search_web",
  "save_to_db",
  "get_from_db",
  "get_all_from_db",
  "get_by_id",
] as const;

function parseArgs(argv: string[]) {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      values[key] = next;
      i += 1;
    } else {
      values[key] = "true";
    }
  }
  return values;
}

function defaultSqlitePath(): string {
  return path.resolve(__dirname, "../data/langgraph-checkpoints.sqlite");
}

function getSessionId(args: Record<string, string>): string {
  if (args.session) return args.session;
  return `session-${Date.now()}`;
}

async function createAgentRuntime(options: AgentOptions = {}): Promise<AgentRuntime> {
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
  const toolNames = new Set(
    tools
      .map((tool: any) => (typeof tool?.name === "string" ? tool.name : ""))
      .filter(Boolean)
  );
  const missingTools = REQUIRED_DB_TOOLS.filter((name) => !toolNames.has(name));
  if (missingTools.length > 0) {
    throw new Error(
      `Missing required MCP tools: ${missingTools.join(", ")}. Restart MCP server with: pnpm --filter @lc/mcp-server dev`
    );
  }

  const checkpointer = await createCheckpointer({
    backend: options.backend ?? "sqlite",
    sqlitePath: options.sqlitePath ?? defaultSqlitePath(),
  });

  const graph = new StateGraph(AgentState)
    .addNode("model", createModelNode(tools))
    .addNode("tools", createToolsNode(tools))
    .addEdge(START, "model")
    .addConditionalEdges("model", toolsCondition)
    .addEdge("tools", "model")
    .compile({ checkpointer: checkpointer as any });

  return { graph, client };
}

export async function agent(options: AgentOptions = {}) {
  const runtime = await createAgentRuntime(options);
  return runtime.graph;
}

function extractChunkText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  let text = "";
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if ("text" in block && typeof block.text === "string") {
      text += block.text;
    }
  }
  return text;
}

async function runTurn(graph: Awaited<ReturnType<typeof agent>>, sessionId: string, text: string) {
  const config = {
    configurable: { thread_id: sessionId },
    streamMode: "messages" as const,
  };
  const stream = await graph.stream({ messages: [new HumanMessage(text)] }, config);

  let streamed = "";
  for await (const chunk of stream as AsyncIterable<any>) {
    if (!Array.isArray(chunk)) continue;
    const [messageChunk, metadata] = chunk;
    if (metadata?.langgraph_node !== "model") continue;

    const tokenText = extractChunkText(messageChunk?.content);
    if (!tokenText) continue;

    process.stdout.write(tokenText);
    streamed += tokenText;
  }

  process.stdout.write(streamed ? "\n" : "(no assistant text returned)\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backend = (args.backend as CheckpointerBackend | undefined) ?? "sqlite";
  const sqlitePath = args.sqlite ?? defaultSqlitePath();
  const sessionId = getSessionId(args);

  const { graph, client } = await createAgentRuntime({ backend, sqlitePath });
  try {
    console.log(`session_id=${sessionId}`);
    if (backend === "sqlite") {
      console.log(`sqlite_path=${sqlitePath}`);
    }

    if (args.message) {
      await runTurn(graph, sessionId, args.message);
      return;
    }

    const rl = readline.createInterface({ input, output });
    try {
      while (true) {
        const line = (await rl.question("you> ")).trim();
        if (!line) continue;
        if (line === "/exit" || line === "/quit") break;
        await runTurn(graph, sessionId, line);
      }
    } finally {
      rl.close();
    }
  } finally {
    await client.close();
  }
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
