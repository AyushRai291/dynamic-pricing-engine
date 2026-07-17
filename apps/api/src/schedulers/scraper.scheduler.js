import cron from 'node-cron';

import { SCRAPER_CRON_ENABLED, SCRAPER_CRON_EXPRESSION } from '../config/env.js';
import { enqueueScrapeJob } from '../queues/scraper.queue.js';
import { getActiveConfiguredScrapeTargets } from '../services/scraper.service.js';
import { validateCompetitorUrl } from '../utils/competitorUrl.js';

const SCHEDULE_BUCKET_MS = 4 * 60 * 60 * 1000;

let scraperCronTask;
let schedulerState = {
  enabled: SCRAPER_CRON_ENABLED,
  expression: SCRAPER_CRON_EXPRESSION,
  status: SCRAPER_CRON_ENABLED ? 'not-started' : 'disabled',
  lastRunAt: null,
  lastScheduledCount: 0,
  lastEnqueuedCount: 0,
  lastSkippedCount: 0,
  lastError: null,
};

export function getScheduledScrapeJobId(targetId, now = new Date()) {
  const bucket = Math.floor(now.getTime() / SCHEDULE_BUCKET_MS);

  return `scheduled-${targetId}-${bucket}`;
}

export async function runScraperSchedulerOnce({
  getTargetsFn = getActiveConfiguredScrapeTargets,
  enqueueFn = enqueueScrapeJob,
  now = new Date(),
  logger = console,
} = {}) {
  schedulerState.lastRunAt = now.toISOString();
  schedulerState.lastScheduledCount = 0;
  schedulerState.lastEnqueuedCount = 0;
  schedulerState.lastSkippedCount = 0;
  schedulerState.lastError = null;

  const targets = await getTargetsFn();
  schedulerState.lastScheduledCount = targets.length;

  if (targets.length === 0) {
    schedulerState.lastEnqueuedCount = 0;
    schedulerState.lastSkippedCount = 0;
    logger.log('[scraper-scheduler] scheduled=0 enqueued=0 skipped=0; no active configured targets');
    return { scheduled: 0, enqueued: 0, skipped: 0 };
  }

  let enqueuedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const target of targets) {
    try {
      validateCompetitorUrl(target.competitorUrl);
      const job = await enqueueFn(
        {
          targetId: target.targetId,
          productId: target.productId,
          competitorName: target.competitorName,
          competitorUrl: target.competitorUrl,
        },
        {
          jobId: getScheduledScrapeJobId(target.targetId, now),
          skipIfExists: true,
        }
      );

      if (job.duplicate) {
        skippedCount += 1;
      } else {
        enqueuedCount += 1;
      }
    } catch (error) {
      skippedCount += 1;
      failedCount += 1;
      logger.error(`[scraper-scheduler] target=${target.targetId} skipped: ${error.message}`);
    }
  }

  schedulerState.lastEnqueuedCount = enqueuedCount;
  schedulerState.lastSkippedCount = skippedCount;
  schedulerState.lastError = failedCount > 0
    ? `${failedCount} target(s) failed to enqueue`
    : null;
  logger.log(
    `[scraper-scheduler] scheduled=${targets.length} enqueued=${enqueuedCount} skipped=${skippedCount}`
  );

  return { scheduled: targets.length, enqueued: enqueuedCount, skipped: skippedCount };
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
    runScraperSchedulerOnce().catch((error) => {
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
