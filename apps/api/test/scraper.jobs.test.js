import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  getFailedScrapeJobTargetId,
  listRecentScrapeJobs,
  retryFailedScrapeJob,
} = await import('../src/queues/scraper.queue.js');

const TARGET_ID = '22222222-2222-4222-8222-222222222222';

function fakeJob(overrides = {}) {
  return {
    id: 'job-1',
    data: {
      targetId: TARGET_ID,
      productId: '11111111-1111-4111-8111-111111111111',
      competitorName: 'Tracked Store',
      internal: { html: '<secret>' },
    },
    attemptsMade: 3,
    opts: { attempts: 3 },
    timestamp: Date.parse('2026-07-17T01:00:00.000Z'),
    processedOn: Date.parse('2026-07-17T01:01:00.000Z'),
    finishedOn: Date.parse('2026-07-17T01:02:00.000Z'),
    progress: { arbitrary: 'payload' },
    failedReason: 'Request to https://secret.example failed\nError stack token=private',
    getState: async () => 'failed',
    ...overrides,
  };
}

test('recent jobs return paginated safe operational fields only', async () => {
  const job = fakeJob();
  const result = await listRecentScrapeJobs(
    { state: 'failed', page: 1, limit: 25 },
    { queueFn: () => ({
      getJobs: async (states, start, end) => {
        assert.deepEqual(states, ['failed']);
        assert.deepEqual([start, end], [0, 24]);
        return [job];
      },
      getJobCounts: async () => ({ failed: 1 }),
    }) }
  );

  assert.equal(result.pagination.total, 1);
  assert.deepEqual(result.items[0], {
    jobId: 'job-1',
    state: 'failed',
    targetId: TARGET_ID,
    productId: '11111111-1111-4111-8111-111111111111',
    productName: null,
    competitorName: 'Tracked Store',
    attemptsMade: 3,
    maxAttempts: 3,
    queuedAt: '2026-07-17T01:00:00.000Z',
    processedOn: '2026-07-17T01:01:00.000Z',
    finishedOn: '2026-07-17T01:02:00.000Z',
    progress: null,
    failureReason: 'Scrape job failed',
  });
  assert.equal(JSON.stringify(result).includes('html'), false);
  assert.equal(JSON.stringify(result).includes('stack'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('retry accepts failed configured jobs, replaces payload, and rejects other states', async () => {
  let updatedPayload;
  let retriedState;
  const job = fakeJob({
    getState: async () => 'failed',
    updateData: async (payload) => { updatedPayload = payload; },
    retry: async (state) => { retriedState = state; },
  });
  const queueFn = () => ({ getJob: async () => job });
  const trustedPayload = {
    targetId: TARGET_ID,
  };

  assert.equal(await getFailedScrapeJobTargetId('job-1', { queueFn }), TARGET_ID);
  await retryFailedScrapeJob('job-1', trustedPayload, { queueFn });
  assert.deepEqual(updatedPayload, trustedPayload);
  assert.equal(retriedState, 'failed');

  await assert.rejects(
    getFailedScrapeJobTargetId('job-2', {
      queueFn: () => ({ getJob: async () => fakeJob({ getState: async () => 'active' }) }),
    }),
    (error) => error.statusCode === 409
  );
});
