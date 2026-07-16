import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  getScheduledScrapeJobId,
  runScraperSchedulerOnce,
} = await import('../src/schedulers/scraper.scheduler.js');

const TARGET_1 = {
  targetId: '11111111-1111-4111-8111-111111111111',
  productId: '22222222-2222-4222-8222-222222222222',
  competitorName: 'Store One',
  competitorUrl: 'https://one.example/p',
};
const TARGET_2 = {
  targetId: '33333333-3333-4333-8333-333333333333',
  productId: TARGET_1.productId,
  competitorName: 'Store Two',
  competitorUrl: 'https://two.example/p',
};
const NOW = new Date('2026-07-17T08:30:00.000Z');
const silentLogger = { log() {}, error() {} };

test('no-target scheduler run skips cleanly with honest zero counts', async () => {
  let enqueueCalled = false;
  const result = await runScraperSchedulerOnce({
    getTargetsFn: async () => [],
    enqueueFn: async () => {
      enqueueCalled = true;
    },
    now: NOW,
    logger: silentLogger,
  });

  assert.deepEqual(result, { scheduled: 0, enqueued: 0, skipped: 0 });
  assert.equal(enqueueCalled, false);
});

test('one enqueue failure does not prevent remaining targets', async () => {
  const calls = [];
  const errors = [];
  const result = await runScraperSchedulerOnce({
    getTargetsFn: async () => [TARGET_1, TARGET_2],
    enqueueFn: async (payload, options) => {
      calls.push({ payload, options });
      if (payload.competitorName === 'Store One') {
        throw new Error('queue failure');
      }

      return { id: options.jobId, duplicate: false };
    },
    now: NOW,
    logger: { log() {}, error(message) { errors.push(message); } },
  });

  assert.deepEqual(result, { scheduled: 2, enqueued: 1, skipped: 1 });
  assert.equal(calls.length, 2);
  assert.equal(errors.length, 1);
  assert.deepEqual(calls[1].payload, {
    productId: TARGET_2.productId,
    competitorName: TARGET_2.competitorName,
    competitorUrl: TARGET_2.competitorUrl,
  });
  assert.equal(calls[1].options.skipIfExists, true);
});

test('scheduled job IDs use deterministic four-hour buckets and skip duplicates', async () => {
  const seen = new Set();
  const ids = [];
  const enqueueFn = async (payload, options) => {
    ids.push(options.jobId);
    const duplicate = seen.has(options.jobId);
    seen.add(options.jobId);
    return { id: options.jobId, duplicate };
  };
  const run = () => runScraperSchedulerOnce({
    getTargetsFn: async () => [TARGET_1],
    enqueueFn,
    now: NOW,
    logger: silentLogger,
  });

  assert.deepEqual(await run(), { scheduled: 1, enqueued: 1, skipped: 0 });
  assert.deepEqual(await run(), { scheduled: 1, enqueued: 0, skipped: 1 });
  assert.equal(ids[0], ids[1]);
  assert.equal(ids[0], getScheduledScrapeJobId(TARGET_1.targetId, NOW));
  assert.match(ids[0], /^scheduled-[0-9a-f-]+-\d+$/);
  assert.equal(
    getScheduledScrapeJobId(TARGET_1.targetId, new Date('2026-07-17T11:59:59.000Z')),
    ids[0]
  );
  assert.notEqual(
    getScheduledScrapeJobId(TARGET_1.targetId, new Date('2026-07-17T12:00:00.000Z')),
    ids[0]
  );
});

test('unsafe stored target is skipped without blocking a safe target', async () => {
  const queuedNames = [];
  const result = await runScraperSchedulerOnce({
    getTargetsFn: async () => [
      { ...TARGET_1, competitorUrl: 'http://127.0.0.1/product' },
      TARGET_2,
    ],
    enqueueFn: async (payload) => {
      queuedNames.push(payload.competitorName);
      return { id: 'job', duplicate: false };
    },
    now: NOW,
    logger: silentLogger,
  });

  assert.deepEqual(result, { scheduled: 2, enqueued: 1, skipped: 1 });
  assert.deepEqual(queuedNames, ['Store Two']);
});
