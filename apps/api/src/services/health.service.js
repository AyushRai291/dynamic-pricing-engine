import { query } from '../config/db.js';

const READINESS_TIMEOUT_MS = 3000;

export async function checkDatabaseReadiness({
  queryFn = query,
  timeoutMs = READINESS_TIMEOUT_MS,
} = {}) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('Database readiness check timed out')),
      timeoutMs
    );
  });

  try {
    await Promise.race([queryFn('SELECT 1 AS ready'), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}
