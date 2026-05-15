import { Pool, PoolClient, QueryResult } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const logger = {
  info: (...a: unknown[]) => console.log('[INFO]', ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
  warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T extends Record<string, any> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    logger.info('Executed query', { duration, rows: res.rowCount });
    return res;
  } catch (err) {
    logger.error('Database query error', { text, err });
    throw err;
  }
}

export async function getClient(): Promise<PoolClient> {
  const client = await pool.connect();
  return client;
}

export default pool;
