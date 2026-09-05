import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

export type SurveyDatabase = BetterSQLite3Database<typeof schema>;

export type AppDatabase = {
  db: SurveyDatabase;
  sqlite: Database.Database;
  close: () => void;
};

export type OpenAppDatabaseOptions = {
  filename: string;
  migrationsFolder: string;
};

export const openAppDatabase = ({
  filename,
  migrationsFolder,
}: OpenAppDatabaseOptions): AppDatabase => {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
};
