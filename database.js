import {readFile} from 'node:fs/promises';

let pool, poolUrl, initializing;

export const dbEnabled = () => Boolean(process.env.DATABASE_URL);

async function connectionPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for PostgreSQL storage.');
  if (pool && poolUrl !== url) throw new Error('DATABASE_URL changed while the database pool is open.');
  if (!pool) {
    const {Pool} = await import('pg');
    if (!pool) {
      pool = new Pool({connectionString: url, max: 10, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000});
      poolUrl = url;
      pool.on('error', error => console.error('PostgreSQL background connection error:', error.code || 'connection error'));
    }
  }
  return pool;
}

export async function initializeDatabase() {
  if (!dbEnabled()) return false;
  if (!initializing) {
    initializing = (async () => {
      const connection = await (await connectionPool()).connect();
      try {
        await connection.query('BEGIN');
        await connection.query("SELECT pg_advisory_xact_lock(hashtext('cimahub-schema-v1'))");
        await connection.query(await readFile(new URL('./db/schema.sql', import.meta.url), 'utf8'));
        await connection.query('COMMIT');
        return true;
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    })().catch(error => { initializing = undefined; throw error; });
  }
  return initializing;
}

export async function query(sql, params = []) {
  await initializeDatabase();
  return (await connectionPool()).query(sql, params);
}

export async function transaction(work) {
  await initializeDatabase();
  const connection = await (await connectionPool()).connect();
  try {
    await connection.query('BEGIN');
    const result = await work(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

export async function closeDatabase() {
  await initializing?.catch(() => {});
  const previous = pool;
  pool = undefined;
  poolUrl = undefined;
  initializing = undefined;
  if (previous) await previous.end();
}
