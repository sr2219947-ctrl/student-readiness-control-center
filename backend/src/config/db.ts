import { Pool } from 'pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set — check your .env file');
}

export const pool = new Pool({ connectionString });

// Fail fast and loud at startup if the DB is unreachable, instead of
// discovering it on the first real request.
pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
  process.exit(1);
});