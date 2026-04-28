import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://elontrader:elontrader123@localhost:5432/elontrader";

let pool: Pool;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
  }
  return pool;
}

export async function query(text: string, params?: unknown[]) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
