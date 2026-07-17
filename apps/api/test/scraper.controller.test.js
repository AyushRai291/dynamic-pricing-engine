import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createListScrapeJobsHandler,
  createRetryScrapeJobHandler,
  createTriggerScrapeHandler,
  parseScrapeJobsQuery,
  parseTriggerScrapeBody,
  validateScraperUuid,
} = await import('../src/controllers/scraper.controller.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

function invokeHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
      },
    };

    handler(req, res, (error) => (error ? reject(error) : resolve()));
  });
}

test('targetId trigger enqueues only the stored target identity', async () => {
  let enqueuedPayload;
  const handler = createTriggerScrapeHandler({
    getActiveTargetFn: async (targetId) => {
      assert.equal(targetId, TARGET_ID);
      return {
        id: targetId,
        productId: PRODUCT_ID,
        competitorName: 'Stored Store',
        competitorUrl: 'https://stored.example/product',
      };
    },
    enqueueFn: async (payload) => {
      enqueuedPayload = payload;
      return { id: 'job-1', name: 'scrape-competitor', state: 'waiting' };
    },
  });
  const response = await invokeHandler(handler, {
    body: { targetId: TARGET_ID },
  });

  assert.deepEqual(enqueuedPayload, { targetId: TARGET_ID });
  assert.equal(response.statusCode, 202);
  assert.equal(response.body.message, 'Scrape queued');
});

test('public trigger body accepts exactly targetId and rejects legacy or unknown fields', async () => {
  assert.equal(parseTriggerScrapeBody({ targetId: TARGET_ID }), TARGET_ID);
  const invalidBodies = [
    {},
    null,
    [],
    { targetId: 'bad' },
    { productId: PRODUCT_ID },
    { targetId: TARGET_ID, productId: PRODUCT_ID },
    { targetId: TARGET_ID, competitorName: 'Client Store' },
    { targetId: TARGET_ID, competitorUrl: 'https://client.example' },
    { targetId: TARGET_ID, mockHtml: '<div>1</div>' },
    { targetId: TARGET_ID, unknown: true },
  ];

  for (const body of invalidBodies) {
    assert.throws(() => parseTriggerScrapeBody(body), (error) => error.statusCode === 400);
  }
});

test('recent job listing validates filters and pagination before calling the queue', async () => {
  assert.deepEqual(parseScrapeJobsQuery({ state: 'failed', page: '2', limit: '100' }), {
    state: 'failed',
    page: 2,
    limit: 100,
  });
  assert.throws(() => parseScrapeJobsQuery({ state: 'paused' }), /Invalid scraper job state/);
  assert.throws(() => parseScrapeJobsQuery({ limit: '101' }), /between 1 and 100/);

  let receivedQuery;
  const result = { items: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } };
  const response = await invokeHandler(createListScrapeJobsHandler({
    listFn: async (query) => {
      receivedQuery = query;
      return result;
    },
  }), { query: {} });

  assert.deepEqual(receivedQuery, { state: undefined, page: 1, limit: 25 });
  assert.deepEqual(response, { statusCode: 200, body: result });
});

test('failed retry resolves stored target id and submits only current trusted target values', async () => {
  let retryCall;
  const response = await invokeHandler(createRetryScrapeJobHandler({
    getTargetIdFn: async (jobId) => {
      assert.equal(jobId, 'job-9');
      return TARGET_ID;
    },
    getActiveTargetFn: async (targetId) => ({
      id: targetId,
      productId: PRODUCT_ID,
      competitorName: 'Current Store',
      competitorUrl: 'https://current.example/product',
    }),
    retryFn: async (jobId, payload) => {
      retryCall = { jobId, payload };
      return { jobId, state: 'waiting' };
    },
  }), { params: { jobId: 'job-9' } });

  assert.deepEqual(retryCall, {
    jobId: 'job-9',
    payload: {
      targetId: TARGET_ID,
    },
  });
  assert.equal(response.statusCode, 202);
});

test('inactive target cannot be triggered', async () => {
  let enqueueCalled = false;
  const inactiveError = new Error('Active competitor target not found');
  inactiveError.statusCode = 404;
  const handler = createTriggerScrapeHandler({
    getActiveTargetFn: async () => {
      throw inactiveError;
    },
    enqueueFn: async () => {
      enqueueCalled = true;
    },
  });

  await assert.rejects(
    invokeHandler(handler, { body: { targetId: TARGET_ID } }),
    (error) => error === inactiveError
  );
  assert.equal(enqueueCalled, false);
});

test('scraper UUID validation rejects malformed product and target IDs', () => {
  assert.equal(validateScraperUuid(PRODUCT_ID, 'productId'), PRODUCT_ID);
  assert.throws(
    () => validateScraperUuid('bad', 'productId'),
    (error) => error.statusCode === 400 && error.message === 'Invalid productId'
  );
  assert.throws(
    () => validateScraperUuid('bad', 'targetId'),
    (error) => error.statusCode === 400 && error.message === 'Invalid targetId'
  );
});
