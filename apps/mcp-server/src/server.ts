import express, { type Request, type Response } from "express";
import dotenv from "dotenv";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createTopicNewsRepository } from "@lc/persistence";
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

const topicNewsRepo = createTopicNewsRepository(
  process.env.NEWS_DB_PATH || path.resolve(__dirname, "../data/topic-news.sqlite")
);

interface SearchResult {
  title?: string;
  url?: string;
  date?: string;
  snippet?: string;
}

interface CachedSearchResult {
  query: string;
  answerText: string;
  sources: SearchResult[];
  createdAt: number;
}

const searchCache = new Map<string, CachedSearchResult>();
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_CACHE_MAX_ITEMS = 200;

function cleanupSearchCache(now = Date.now()): void {
  for (const [id, value] of searchCache.entries()) {
    if (now - value.createdAt > SEARCH_CACHE_TTL_MS) {
      searchCache.delete(id);
    }
  }
  if (searchCache.size <= SEARCH_CACHE_MAX_ITEMS) return;
  const entries = [...searchCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  for (const [id] of entries.slice(0, searchCache.size - SEARCH_CACHE_MAX_ITEMS)) {
    searchCache.delete(id);
  }
}

function sourceFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function toSummary(source: SearchResult, fallback: string): string {
  const raw = source.snippet?.trim() || fallback.trim() || "No summary available.";
  return raw.slice(0, 1500);
}

function saveNewsRows(topic: string, answerText: string, sources: SearchResult[]): number[] {
  const rowsToSave: Array<{
    topic: string;
    source: string;
    title: string;
    url: string;
    summary: string;
  }> = [];
  for (const source of sources.slice(0, 5)) {
    const title = source.title?.trim() || "Untitled";
    const url = source.url?.trim();
    if (!url) continue;
    const host = sourceFromUrl(url);
    const summary = toSummary(source, answerText);
    rowsToSave.push({ topic, source: host, title, url, summary });
  }
  return topicNewsRepo.saveMany(rowsToSave);
}

function renderSources(sources: SearchResult[]): string {
  return sources
    .slice(0, 5)
    .map((s, i) => {
      const title = s.title ?? "source";
      const url = s.url ?? "";
      const date = s.date ?? "";
      return `${i + 1}. ${title}${date ? ` (${date})` : ""}${url ? `\n   ${url}` : ""}`;
    })
    .join("\n");
}

function renderDbRows(
  rows: Array<{
    id: number;
    topic: string;
    source: string;
    title: string;
    url: string;
    summary: string;
    created_at: string;
  }>
): string {
  return rows
    .map(
      (row, idx) =>
        `${idx + 1}. [${row.id}] ${row.title}\n   topic: ${row.topic}\n   source: ${row.source}\n   url: ${row.url}\n   created_at: ${row.created_at}\n   summary: ${row.summary}`
    )
    .join("\n\n");
}

async function fetchLatestWebData(query: string): Promise<{
  answerText: string;
  sources: SearchResult[];
}> {
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
        {
          role: "system",
          content:
            "Answer with the most recent web information for the user query, then list up to 5 source links.",
        },
        { role: "user", content: query },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Perplexity request failed with status ${resp.status}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    search_results?: SearchResult[];
  };

  return {
    answerText: data.choices?.[0]?.message?.content ?? "No answer text returned.",
    sources: Array.isArray(data.search_results) ? data.search_results : [],
  };
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
      "search_web",
      {
        title: "Search latest web data",
        description:
          "Use this for any query that needs fresh internet data. This tool does not write to SQL.",
        inputSchema: z.object({
          query: z.string().describe("Any question/topic needing latest internet data"),
        }),
      },
      async ({ query }) => {
        const { answerText, sources } = await fetchLatestWebData(query);
        const topSources = renderSources(sources);
        const resultId = randomUUID();
        searchCache.set(resultId, {
          query,
          answerText,
          sources,
          createdAt: Date.now(),
        });
        cleanupSearchCache();

        const parts = [`result_id: ${resultId}`, answerText];
        if (topSources) {
          parts.push(`Sources:\n${topSources}`);
        }
        parts.push(
          "Not saved to SQL. If the user wants this stored, call save_to_db with this result_id."
        );

        return { content: [{ type: "text", text: parts.join("\n\n") }] };
      }
    );

    server.registerTool(
      "save_to_db",
      {
        title: "Save previously searched result to SQLite",
        description:
          "Saves a prior search_web result to topic_news by result_id. Use only after user asks to save.",
        inputSchema: z.object({
          result_id: z.string().describe("result_id returned by search_web"),
          topic: z
            .string()
            .optional()
            .describe("Optional SQL topic label. Defaults to original query."),
        }),
      },
      async ({ result_id, topic }) => {
        cleanupSearchCache();
        const cached = searchCache.get(result_id);
        if (!cached) {
          return {
            content: [
              {
                type: "text",
                text: `No cached search found for result_id '${result_id}'. Run search_web again.`,
              },
            ],
          };
        }

        const sqlTopic = topic?.trim() || cached.query;
        const insertedIds = saveNewsRows(sqlTopic, cached.answerText, cached.sources);
        const savedRows = insertedIds
          .map((id) => topicNewsRepo.getById(id))
          .filter((row): row is NonNullable<typeof row> => row !== null);
        const savedRowsText =
          savedRows.length > 0 ? `\n\nSaved rows:\n${renderDbRows(savedRows)}` : "";

        return {
          content: [
            {
              type: "text",
              text: `Saved ${insertedIds.length} row(s) to SQLite table 'topic_news' at ${topicNewsRepo.dbPath}.\nids: ${insertedIds.join(", ") || "(none)"}${savedRowsText}`,
            },
          ],
        };
      }
    );

    server.registerTool(
      "get_from_db",
      {
        title: "Get previously saved topic rows from SQLite",
        description: "Reads rows from the topic_news table by topic.",
        inputSchema: z.object({
          topic: z.string().describe("Topic value stored in the table"),
          limit: z.number().int().min(1).max(50).optional().default(10),
        }),
      },
      async ({ topic, limit }) => {
        const rows = topicNewsRepo.listByTopic(topic, limit);

        if (rows.length === 0) {
          return {
            content: [{ type: "text", text: `No saved rows found for topic '${topic}'.` }],
          };
        }

        const text = renderDbRows(rows);

        return { content: [{ type: "text", text }] };
      }
    );

    server.registerTool(
      "get_all_from_db",
      {
        title: "Get all saved rows from SQLite",
        description: "Reads all rows from topic_news in descending created_at order.",
        inputSchema: z.object({
          limit: z.number().int().min(1).max(500).optional().default(100),
        }),
      },
      async ({ limit }) => {
        const rows = topicNewsRepo.listAll(limit);
        if (rows.length === 0) {
          return {
            content: [{ type: "text", text: "No saved rows found in topic_news." }],
          };
        }
        return { content: [{ type: "text", text: renderDbRows(rows) }] };
      }
    );

    server.registerTool(
      "get_by_id",
      {
        title: "Get one saved row by id",
        description: "Fetches exactly one row from topic_news by primary key id.",
        inputSchema: z.object({
          id: z.number().int().positive(),
        }),
      },
      async ({ id }) => {
        const row = topicNewsRepo.getById(id);
        if (!row) {
          return {
            content: [{ type: "text", text: `No row found with id=${id}.` }],
          };
        }
        return { content: [{ type: "text", text: renderDbRows([row]) }] };
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
