import app from './app.js';
import { PORT } from './config/env.js';
import { pool } from './config/db.js';
import { checkScraperQueueAvailability, closeScraperQueue } from './queues/scraper.queue.js';
import { startScraperScheduler, stopScraperScheduler } from './schedulers/scraper.scheduler.js';
import { closeScraperWorker, startScraperWorker } from './workers/scraper.worker.js';

let isShuttingDown = false;

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

startScraperWorker();
startScraperScheduler();

const queueAvailabilityCheck = checkScraperQueueAvailability()
  .then(() => {
    console.log('Scraper queue connected to Redis');
  })
  .catch((error) => {
    console.error(`Scraper queue unavailable at startup: ${error.message}`);
  });

const server = app.listen(PORT, () => {
  console.log(`Dynamic Pricing API running on port ${PORT}`);
});

export async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}; shutting down Dynamic Pricing API`);

  try {
    stopScraperScheduler();
    await closeHttpServer(server);
    await queueAvailabilityCheck;
    await closeScraperWorker();
    await closeScraperQueue();
    await pool.end();
    console.log('Shutdown complete: HTTP server, scraper worker, queue/Redis, scheduler, and PostgreSQL pool closed');
  } catch (error) {
    process.exitCode = 1;
    console.error(`Shutdown completed with errors: ${error.message}`);
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
