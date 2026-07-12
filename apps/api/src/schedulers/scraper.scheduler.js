import cron from 'node-cron';

import { SCRAPER_CRON_ENABLED, SCRAPER_CRON_EXPRESSION } from '../config/env.js';
import { enqueueScrapeJob } from '../queues/scraper.queue.js';
import { getKnownScrapeTargets } from '../services/scraper.service.js';

let scraperCronTask;
let schedulerState = {
  enabled: SCRAPER_CRON_ENABLED,
  expression: SCRAPER_CRON_EXPRESSION,
  status: SCRAPER_CRON_ENABLED ? 'not-started' : 'disabled',
  lastRunAt: null,
  lastEnqueuedCount: 0,
  lastError: null,
};

async function enqueueKnownTargets() {
  schedulerState.lastRunAt = new Date().toISOString();
  schedulerState.lastError = null;

  const targets = await getKnownScrapeTargets();

  if (targets.length === 0) {
    schedulerState.lastEnqueuedCount = 0;
    console.log('[scraper-scheduler] no known targets; skipping');
    return;
  }

  let enqueuedCount = 0;

  for (const target of targets) {
    await enqueueScrapeJob(target);
    enqueuedCount += 1;
  }

  schedulerState.lastEnqueuedCount = enqueuedCount;
  console.log(`[scraper-scheduler] enqueued ${enqueuedCount} known stored target(s)`);
}

export function startScraperScheduler() {
  if (!SCRAPER_CRON_ENABLED) {
    schedulerState.status = 'disabled';
    console.log(`[scraper-scheduler] disabled (SCRAPER_CRON_ENABLED=false, expression=${SCRAPER_CRON_EXPRESSION})`);
    return undefined;
  }

  if (scraperCronTask) {
    return scraperCronTask;
  }

  if (!cron.validate(SCRAPER_CRON_EXPRESSION)) {
    throw new Error(`Invalid SCRAPER_CRON_EXPRESSION: ${SCRAPER_CRON_EXPRESSION}`);
  }

  scraperCronTask = cron.createTask(SCRAPER_CRON_EXPRESSION, () => {
    enqueueKnownTargets().catch((error) => {
      schedulerState.lastError = error.message;
      console.error(`[scraper-scheduler] scheduled enqueue failed: ${error.message}`);
    });
  });
  scraperCronTask.start();
  schedulerState.status = scraperCronTask.getStatus();
  console.log(`[scraper-scheduler] enabled expression=${SCRAPER_CRON_EXPRESSION}`);

  return scraperCronTask;
}

export function getScraperSchedulerStatus() {
  return {
    ...schedulerState,
    status: scraperCronTask ? scraperCronTask.getStatus() : schedulerState.status,
  };
}

export function stopScraperScheduler() {
  if (!scraperCronTask) {
    return;
  }

  scraperCronTask.stop();
  scraperCronTask.destroy();
  scraperCronTask = undefined;
  schedulerState.status = SCRAPER_CRON_ENABLED ? 'destroyed' : 'disabled';
}
