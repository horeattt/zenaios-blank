import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  exec(script: string): Promise<void>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function rowsOf(result: { rows?: Row[] } | Row[]): Row[] {
  if (Array.isArray(result)) return result;
  return result.rows ?? [];
}

export async function openPglite(dir: string): Promise<Db> {
  const pg = new PGlite(dir);
  const wrap = (client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Row[] }>; exec: (script: string) => Promise<unknown> }): Queryable => ({
    async query<T = Row>(text: string, params: unknown[] = []) {
      const result = await client.query(text, params);
      return rowsOf(result) as T[];
    },
    async exec(script: string) {
      await client.exec(script);
    }
  });
  return {
    ...wrap(pg),
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      return pg.transaction(async (tx) => fn(wrap(tx as unknown as typeof pg)));
    },
    async close() {
      await pg.close();
    }
  };
}

export function openPostgres(databaseUrl: string): Db {
  const sql = postgres(databaseUrl, { max: 10, onnotice: () => undefined });
  const wrap = (client: typeof sql): Queryable => ({
    async query<T = Row>(text: string, params: unknown[] = []) {
      const result = await client.unsafe(text, params as never[]);
      return result as unknown as T[];
    },
    async exec(script: string) {
      await client.unsafe(script);
    }
  });
  return {
    ...wrap(sql),
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      return sql.begin(async (tx) => fn(wrap(tx as unknown as typeof sql))) as Promise<T>;
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
