import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
process.env.ML_REQUEST_TIMEOUT_MS = '20';

const { getMlHealth, requestPricingScore } = await import('../src/services/ml.service.js');

const validFeatures = {
  price_gap_ratio: 0,
  gross_margin_ratio: 0.4,
  markdown_headroom_ratio: 0.2,
  markup_headroom_ratio: 0.3,
  price_position_ratio: 0.4,
  inventory_count: 20,
  competitor_count: 0,
  available_competitor_count: 0,
  competitor_available_ratio: 0,
  competitor_price_spread_ratio: 0,
  has_competitor_data: 0,
};

const validScoreResponse = {
  price_score: 51.25,
  action: 'hold',
  model_version: 'bootstrap-xgb-v1',
  model_source: 'synthetic_rule_based',
  features: validFeatures,
};

test('ML health request returns validated health data', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).pathname, '/health');
    assert.equal(options.method, 'GET');
    return new Response(JSON.stringify({
      status: 'ok',
      service: 'dynamic-pricing-ml',
      version: '0.1.0',
    }));
  };

  const health = await getMlHealth({ fetchImpl });

  assert.deepEqual(health, {
    status: 'ok',
    service: 'dynamic-pricing-ml',
    version: '0.1.0',
  });
});

test('pricing score request sends JSON and validates the response', async () => {
  const payload = {
    current_price: 100,
    cost_price: 60,
    min_price: 80,
    max_price: 130,
    inventory_count: 20,
    competitors: [],
  };
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).pathname, '/predict');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), payload);
    return new Response(JSON.stringify(validScoreResponse));
  };

  const result = await requestPricingScore(payload, { fetchImpl });

  assert.deepEqual(result, validScoreResponse);
});

test('timeout and network unavailability become sanitized 503 errors', async (t) => {
  await t.test('timeout', async () => {
    const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new DOMException('timed out at C:\\private\\service', 'AbortError'));
      }, { once: true });
    });

    await assert.rejects(
      getMlHealth({ fetchImpl }),
      (error) => error.statusCode === 503 && error.message === 'ML service is unavailable'
    );
  });

  await t.test('network failure', async () => {
    const fetchImpl = async () => {
      throw new TypeError('connect ECONNREFUSED with secret token');
    };

    await assert.rejects(
      getMlHealth({ fetchImpl }),
      (error) => error.statusCode === 503 && error.message === 'ML service is unavailable'
    );
  });
});

test('bad upstream responses become sanitized 502 errors', async (t) => {
  const cases = [
    ['non-2xx', async () => new Response('C:\\private\\trace JWT=secret', { status: 500 })],
    ['invalid JSON', async () => new Response('not-json', { status: 200 })],
    ['invalid schema', async () => new Response(JSON.stringify({
      ...validScoreResponse,
      price_score: 'not-a-number',
    }))],
  ];

  for (const [name, fetchImpl] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        requestPricingScore({}, { fetchImpl }),
        (error) => {
          assert.equal(error.statusCode, 502);
          assert.equal(error.message, 'ML service returned an invalid response');
          assert.doesNotMatch(error.message, /private|secret|JWT|\\/i);
          return true;
        }
      );
    });
  }
});
