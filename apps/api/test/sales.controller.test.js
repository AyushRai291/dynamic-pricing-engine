import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createBulkProductSalesHandler,
  createGetProductSalesHandler,
  parseBulkSalesBody,
  parseSalesHistoryQuery,
  validateProductId,
} = await import('../src/controllers/sales.controller.js');
const { errorMiddleware } = await import('../src/middleware/error.middleware.js');
const { default: productRoutes } = await import('../src/routes/product.routes.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const TODAY = '2026-07-15';
const VALID_RECORD = {
  saleDate: '2026-07-14',
  unitsSold: 5,
  sellingPrice: 1200,
};

function assertBadRequest(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.equal(error.statusCode, 400);
    assert.match(error.message, pattern);
    return true;
  });
}

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

    handler(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ statusCode: res.statusCode });
    });
  });
}

test('bulk body validation accepts zero-sales days and strips client-controlled fields', () => {
  const records = parseBulkSalesBody({
    records: [{ ...VALID_RECORD, unitsSold: 0 }],
  }, { today: TODAY });

  assert.deepEqual(records, [{ ...VALID_RECORD, unitsSold: 0 }]);
  assert.equal(Object.hasOwn(records[0], 'source'), false);

  assertBadRequest(
    () => parseBulkSalesBody({ records: [{ ...VALID_RECORD, source: 'import' }] }, { today: TODAY }),
    /contain only/
  );
});

test('bulk body validation rejects malformed bodies and invalid record counts', () => {
  const malformedBodies = [null, {}, { records: 'bad' }, { records: [], extra: true }];

  for (const body of malformedBodies) {
    assertBadRequest(() => parseBulkSalesBody(body, { today: TODAY }), /records/);
  }

  assertBadRequest(
    () => parseBulkSalesBody({ records: [] }, { today: TODAY }),
    /between 1 and 366/
  );
  assertBadRequest(
    () => parseBulkSalesBody({ records: Array.from({ length: 367 }, () => VALID_RECORD) }, {
      today: TODAY,
    }),
    /between 1 and 366/
  );
});

test('bulk body validation rejects duplicate and invalid dates', () => {
  assertBadRequest(
    () => parseBulkSalesBody({ records: [VALID_RECORD, { ...VALID_RECORD }] }, { today: TODAY }),
    /Duplicate saleDate/
  );

  const invalidDates = ['2026/07/14', '2026-02-30', '0000-01-01', '2026-07-16'];

  for (const saleDate of invalidDates) {
    assertBadRequest(
      () => parseBulkSalesBody({ records: [{ ...VALID_RECORD, saleDate }] }, { today: TODAY }),
      /YYYY-MM-DD|valid date|future/
    );
  }
});

test('bulk body validation rejects invalid units and prices', () => {
  for (const unitsSold of [-1, 1.5, '5']) {
    assertBadRequest(
      () => parseBulkSalesBody({ records: [{ ...VALID_RECORD, unitsSold }] }, { today: TODAY }),
      /non-negative integer/
    );
  }

  for (const sellingPrice of [0, -1, Number.NaN, '1200']) {
    assertBadRequest(
      () => parseBulkSalesBody({ records: [{ ...VALID_RECORD, sellingPrice }] }, { today: TODAY }),
      /positive number/
    );
  }
});

test('history validation enforces UUID, date range, future-date, and limit rules', () => {
  assert.equal(validateProductId(PRODUCT_ID), PRODUCT_ID);
  assertBadRequest(() => validateProductId('not-a-uuid'), /Invalid product id/);

  assert.deepEqual(parseSalesHistoryQuery({}, { today: TODAY }), {
    from: undefined,
    to: undefined,
    limit: 90,
  });
  assert.deepEqual(parseSalesHistoryQuery({
    from: '2026-07-01',
    to: '2026-07-14',
    limit: '366',
  }, { today: TODAY }), {
    from: '2026-07-01',
    to: '2026-07-14',
    limit: 366,
  });

  assertBadRequest(
    () => parseSalesHistoryQuery({ from: '2026-07-14', to: '2026-07-13' }, { today: TODAY }),
    /from must be before/
  );
  assertBadRequest(
    () => parseSalesHistoryQuery({ to: '2026-07-16' }, { today: TODAY }),
    /future/
  );

  for (const limit of ['0', '367', '1.5', 'abc']) {
    assertBadRequest(
      () => parseSalesHistoryQuery({ limit }, { today: TODAY }),
      /limit must be an integer/
    );
  }
});

test('bulk and history handlers pass validated data to their services', async () => {
  let bulkCall;
  const bulkHandler = createBulkProductSalesHandler({
    bulkUpsertFn: async (productId, records) => {
      bulkCall = { productId, records };
      return { upsertedCount: records.length };
    },
  });
  const bulkResponse = await invokeHandler(bulkHandler, {
    params: { id: PRODUCT_ID },
    body: { records: [{ ...VALID_RECORD, saleDate: '2020-07-14' }] },
  });

  assert.deepEqual(bulkCall, {
    productId: PRODUCT_ID,
    records: [{ ...VALID_RECORD, saleDate: '2020-07-14' }],
  });
  assert.deepEqual(bulkResponse, { statusCode: 200, body: { upsertedCount: 1 } });

  let historyCall;
  const historyHandler = createGetProductSalesHandler({
    fetchHistoryFn: async (productId, filters) => {
      historyCall = { productId, filters };
      return { productId, items: [] };
    },
  });
  const historyResponse = await invokeHandler(historyHandler, {
    params: { id: PRODUCT_ID },
    query: { from: '2020-07-01', to: '2020-07-14', limit: '10' },
  });

  assert.deepEqual(historyCall, {
    productId: PRODUCT_ID,
    filters: { from: '2020-07-01', to: '2020-07-14', limit: 10 },
  });
  assert.deepEqual(historyResponse, {
    statusCode: 200,
    body: { productId: PRODUCT_ID, items: [] },
  });
});

test('sales endpoints require JWT authentication', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/products', productRoutes);
  app.use(errorMiddleware);

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const port = server.address().port;
  const responses = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/products/${PRODUCT_ID}/sales`),
    fetch(`http://127.0.0.1:${port}/api/products/${PRODUCT_ID}/sales/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ records: [VALID_RECORD] }),
    }),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: {
        message: 'Missing or invalid authorization token',
        statusCode: 401,
      },
    });
  }
});
