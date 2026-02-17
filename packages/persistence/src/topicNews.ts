import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface TopicNewsRow {
  id: number;
  topic: string;
  source: string;
  title: string;
  url: string;
  summary: string;
  created_at: string;
}

export interface TopicNewsInsert {
  topic: string;
  source: string;
  title: string;
  url: string;
  summary: string;
}

export interface TopicNewsRepository {
  dbPath: string;
  saveMany: (rows: TopicNewsInsert[]) => number[];
  listByTopic: (topic: string, limit?: number) => TopicNewsRow[];
  listAll: (limit?: number) => TopicNewsRow[];
  getById: (id: number) => TopicNewsRow | null;
}

const TABLE_NAME = "topic_news";

function defaultTopicNewsDbPath(): string {
  return path.resolve(process.cwd(), "apps/mcp-server/data/topic-news.sqlite");
}

export function createTopicNewsRepository(dbPath?: string): TopicNewsRepository {
  const resolvedDbPath = dbPath || process.env.NEWS_DB_PATH || defaultTopicNewsDbPath();
  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

  const db = new DatabaseSync(resolvedDbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const insert = db.prepare(
    `INSERT INTO ${TABLE_NAME} (topic, source, title, url, summary, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  );
  const selectByTopic = db.prepare(
    `SELECT id, topic, source, title, url, summary, created_at
     FROM ${TABLE_NAME}
     WHERE topic = ?
     ORDER BY created_at DESC
     LIMIT ?`
  );
  const selectAll = db.prepare(
    `SELECT id, topic, source, title, url, summary, created_at
     FROM ${TABLE_NAME}
     ORDER BY created_at DESC
     LIMIT ?`
  );
  const selectById = db.prepare(
    `SELECT id, topic, source, title, url, summary, created_at
     FROM ${TABLE_NAME}
     WHERE id = ?
     LIMIT 1`
  );

  return {
    dbPath: resolvedDbPath,
    saveMany(rows) {
      const insertedIds: number[] = [];
      for (const row of rows) {
        const result = insert.run(row.topic, row.source, row.title, row.url, row.summary) as {
          lastInsertRowid?: number | bigint;
        };
        if (typeof result.lastInsertRowid === "bigint") {
          insertedIds.push(Number(result.lastInsertRowid));
        } else if (typeof result.lastInsertRowid === "number") {
          insertedIds.push(result.lastInsertRowid);
        }
      }
      return insertedIds;
    },
    listByTopic(topic, limit = 10) {
      return selectByTopic.all(topic, limit) as unknown as TopicNewsRow[];
    },
    listAll(limit = 100) {
      return selectAll.all(limit) as unknown as TopicNewsRow[];
    },
    getById(id) {
      const row = selectById.get(id);
      return (row as TopicNewsRow | undefined) ?? null;
    },
  };
}
