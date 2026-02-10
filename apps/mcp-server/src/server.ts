import express, { type Request, type Response } from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";


import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// Load repo root .env for the server process
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const app = express();
app.use(express.json());

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const server = new McpServer({
      name: "utility-server",
      version: "1.0.0",
    });

    server.registerTool(
      "get_time_utc",
      {
        title: "Get current UTC time",
        description: "Returns the current UTC date time as ISO string",
        inputSchema: {},
      },
      () => ({
        content: [{ type: "text", text: new Date().toISOString() }],
      })
    );

    server.registerTool(
  "get_stock_news",
  {
    title: "Get current stock market news",
    description: "Latest market news for a ticker or topic, with sources",
    inputSchema: z.object({
      query: z.string().describe("Example: AAPL, Nvidia, S&P 500"),
    }),
  },
  async ({ query }) => {
    const apiKey = requireEnv("PERPLEXITY_API_KEY");

    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        search_mode: "web",
        search_recency_filter: "day",
        temperature: 0.2,
        messages: [
          { role: "system", content: "Return 5 bullet headlines with sources." },
          { role: "user", content: `Latest stock market news about ${query}` },
        ],
      }),
    });

    const data: any = await resp.json();

    const answerText =
      data?.choices?.[0]?.message?.content ?? "No news text returned.";

    const sources = Array.isArray(data?.search_results) ? data.search_results : [];
    const topSources = sources
      .slice(0, 5)
      .map((s: any, i: number) => {
        const title = s?.title ?? "source";
        const url = s?.url ?? "";
        const date = s?.date ?? "";
        return `${i + 1}. ${title}${date ? ` (${date})` : ""}${url ? `\n   ${url}` : ""}`;
      })
      .join("\n");

    const combined = topSources ? `${answerText}\n\nSources:\n${topSources}` : answerText;

    return { content: [{ type: "text", text: combined }] };
  }
);


    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const PORT = process.env.MCP_PORT ? Number(process.env.MCP_PORT) : 3000;
app.listen(PORT, () => {
  console.log(`MCP HTTP server running at http://localhost:${PORT}/mcp`);
});
