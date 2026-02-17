import fs from "node:fs/promises";
import path from "node:path";
export type { TopicNewsInsert, TopicNewsRepository, TopicNewsRow } from "./topicNews.js";
export { createTopicNewsRepository } from "./topicNews.js";

export type CheckpointerBackend = "sqlite" | "memory";

export interface CheckpointerOptions {
  backend?: CheckpointerBackend;
  sqlitePath: string;
}

type MaybeSetup = {
  setup?: () => Promise<void> | void;
};

type SqliteSaverModule = {
  SqliteSaver: {
    fromConnString: (connString: string) => MaybeSetup;
  };
};

type MemorySaverModule = {
  MemorySaver: new () => MaybeSetup;
};

function toSqliteConnString(dbPath: string): string {
  return path.resolve(dbPath);
}

async function loadSqliteSaverModule(): Promise<SqliteSaverModule> {
  const dynamicImport = new Function("m", "return import(m)") as (
    moduleName: string
  ) => Promise<unknown>;
  return (await dynamicImport(
    "@langchain/langgraph-checkpoint-sqlite"
  )) as SqliteSaverModule;
}

async function loadMemorySaverModule(): Promise<MemorySaverModule> {
  const dynamicImport = new Function("m", "return import(m)") as (
    moduleName: string
  ) => Promise<unknown>;
  return (await dynamicImport("@langchain/langgraph")) as MemorySaverModule;
}

export async function createCheckpointer(options: CheckpointerOptions) {
  const backend = options.backend ?? "sqlite";

  if (backend === "memory") {
    const module = await loadMemorySaverModule();
    return new module.MemorySaver();
  }

  await fs.mkdir(path.dirname(options.sqlitePath), { recursive: true });
  const module = await loadSqliteSaverModule();
  const checkpointer = module.SqliteSaver.fromConnString(
    toSqliteConnString(options.sqlitePath)
  );

  if (typeof checkpointer.setup === "function") {
    await checkpointer.setup();
  }

  return checkpointer;
}
