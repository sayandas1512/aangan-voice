import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

function createDb() {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Set it in .env.local, or run in a path that doesn't touch the database."
    );
  }
  const sql = neon(env.DATABASE_URL);
  return drizzle(sql, { schema });
}

let _db: ReturnType<typeof createDb> | undefined;

export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}
