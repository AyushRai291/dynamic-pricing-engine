import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const { SCRAPE_COMPETITOR_JOB_NAME } = await import('../src/queues/scraper.queue.js');
const { fetchHtmlWithPuppeteer } = await import('../src/services/scraper.service.js');
const { processScrapeJob } = await import('../src/workers/scraper.worker.js');

const execFileAsync = promisify(execFile);
const apiDirectory = fileURLToPath(new URL('../', import.meta.url));
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

function createRequest({ url, resourceType = 'document', navigation = true }, page) {
  let handled = false;
  return {
    url: () => url,
    resourceType: () => resourceType,
    isNavigationRequest: () => navigation,
    frame: () => page.mainFrame(),
    isInterceptResolutionHandled: () => handled,
    continue: async () => { handled = true; },
    abort: async () => { handled = true; },
    wasHandled: () => handled,
  };
}

function createPuppeteerMock({
  html = '<div class="price">INR 100</div>',
  finalUrl = 'https://shop.example/final',
  requestSpecs = [],
  redirectCount = 0,
  gotoError,
  pageCloseError,
  browserCloseError,
} = {}) {
  const state = { pageClosed: false, browserClosed: false, requests: [] };
  let requestHandler;
  const page = {
    setRequestInterception: async (value) => { assert.equal(value, true); },
    on: (event, handler) => { if (event === 'request') requestHandler = handler; },
    mainFrame: () => page,
    goto: async () => {
      for (const spec of requestSpecs) {
        const request = createRequest(spec, page);
        state.requests.push(request);
        await requestHandler(request);
      }
      if (gotoError) throw gotoError;
      return { request: () => ({ redirectChain: () => Array(redirectCount).fill({}) }) };
    },
    url: () => finalUrl,
    content: async () => html,
    close: async () => {
      state.pageClosed = true;
      if (pageCloseError) throw pageCloseError;
    },
  };
  const browser = {
    newPage: async () => page,
    close: async () => {
      state.browserClosed = true;
      if (browserCloseError) throw browserCloseError;
    },
  };

  return {
    puppeteerImpl: { launch: async () => browser },
    state,
  };
}

test('live scrape validates initial, redirect, and final URLs and blocks unnecessary resources', async () => {
  const validated = [];
  const mock = createPuppeteerMock({
    requestSpecs: [
      { url: 'https://shop.example/start' },
      { url: 'https://cdn.example/hero.jpg', resourceType: 'image', navigation: false },
      { url: 'https://shop.example/redirected' },
    ],
  });

  const html = await fetchHtmlWithPuppeteer('https://shop.example/start', {
    puppeteerImpl: mock.puppeteerImpl,
    validateLiveUrlFn: async (url) => { validated.push(url); },
  });

  assert.match(html, /INR 100/);
  assert.deepEqual(validated, [
    'https://shop.example/start',
    'https://shop.example/start',
    'https://shop.example/redirected',
    'https://shop.example/final',
  ]);
  assert.equal(mock.state.requests[1].wasHandled(), true);
  assert.equal(mock.state.pageClosed, true);
  assert.equal(mock.state.browserClosed, true);
});

test('unsafe redirect and excessive redirect count fail safely and close resources', async () => {
  const unsafeMock = createPuppeteerMock({
    requestSpecs: [{ url: 'http://127.0.0.1/private' }],
    pageCloseError: new Error('page path C:\\secret'),
    browserCloseError: new Error('browser socket internal'),
  });

  await assert.rejects(
    fetchHtmlWithPuppeteer('https://shop.example/start', {
      puppeteerImpl: unsafeMock.puppeteerImpl,
      validateLiveUrlFn: async (url) => {
        if (url.includes('127.0.0.1')) {
          const error = new Error('competitorUrl host is not allowed');
          error.statusCode = 400;
          throw error;
        }
      },
    }),
    (error) => error.message === 'competitorUrl host is not allowed'
  );
  assert.equal(unsafeMock.state.pageClosed, true);
  assert.equal(unsafeMock.state.browserClosed, true);

  const redirectsMock = createPuppeteerMock({ redirectCount: 3 });
  await assert.rejects(
    fetchHtmlWithPuppeteer('https://shop.example/start', {
      puppeteerImpl: redirectsMock.puppeteerImpl,
      validateLiveUrlFn: async () => {},
      maximumRedirects: 2,
    }),
    /top-level redirect limit/
  );
});

test('oversized HTML is rejected before it can be returned', async () => {
  const mock = createPuppeteerMock({ html: '<main>too large</main>' });

  await assert.rejects(
    fetchHtmlWithPuppeteer('https://shop.example/start', {
      puppeteerImpl: mock.puppeteerImpl,
      validateLiveUrlFn: async () => {},
      maximumHtmlBytes: 8,
    }),
    (error) => error.statusCode === 413
      && error.message === 'Scraped HTML exceeds the configured size limit'
  );
  assert.equal(mock.state.pageClosed, true);
  assert.equal(mock.state.browserClosed, true);
});

test('worker uses only trusted target identity and sanitizes scrape failures', async () => {
  let receivedTargetId;
  const result = await processScrapeJob({
    name: SCRAPE_COMPETITOR_JOB_NAME,
    data: {
      targetId: TARGET_ID,
      productId: 'untrusted',
      competitorUrl: 'http://127.0.0.1/private',
      mockHtml: '<secret>',
    },
  }, {
    scrapeConfiguredFn: async (targetId) => {
      receivedTargetId = targetId;
      return {
        id: '33333333-3333-4333-8333-333333333333',
        product_id: '11111111-1111-4111-8111-111111111111',
        competitor_name: 'Trusted Store',
        competitor_url: 'https://trusted.example/item',
        price: '99.50',
        scraped_at: '2026-07-17T00:00:00.000Z',
      };
    },
  });

  assert.equal(receivedTargetId, TARGET_ID);
  assert.equal(JSON.stringify(result).includes('untrusted'), false);
  assert.equal(JSON.stringify(result).includes('competitorUrl'), false);

  await assert.rejects(
    processScrapeJob({ name: SCRAPE_COMPETITOR_JOB_NAME, data: { targetId: TARGET_ID } }, {
      scrapeConfiguredFn: async () => {
        throw new Error('connect ECONNREFUSED /internal/path token=secret');
      },
    }),
    (error) => error.message === 'Scrape request failed'
  );
});

test('scraper resource limits reject invalid startup values', async (t) => {
  const cases = [
    [{ SCRAPER_MAX_HTML_BYTES: '0' }, /SCRAPER_MAX_HTML_BYTES must be an integer between 1 and 10000000/],
    [{ SCRAPER_MAX_HTML_BYTES: '10000001' }, /SCRAPER_MAX_HTML_BYTES must be an integer between 1 and 10000000/],
    [{ SCRAPER_MAX_REDIRECTS: '0' }, /SCRAPER_MAX_REDIRECTS must be an integer between 1 and 20/],
    [{ SCRAPER_MAX_REDIRECTS: '21' }, /SCRAPER_MAX_REDIRECTS must be an integer between 1 and 20/],
  ];

  for (const [overrides, pattern] of cases) {
    await t.test(JSON.stringify(overrides), async () => {
      await assert.rejects(
        execFileAsync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js');"], {
          cwd: apiDirectory,
          env: {
            ...process.env,
            JWT_ACCESS_SECRET: 'test-access-secret',
            JWT_REFRESH_SECRET: 'test-refresh-secret',
            ...overrides,
          },
        }),
        (error) => {
          assert.match(error.stderr, pattern);
          return true;
        }
      );
    });
  }
});

test('private URL override is disabled in production configuration', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--input-type=module', '-e', "const env = await import('./src/config/env.js'); console.log(env.SCRAPER_ALLOW_PRIVATE_URLS);"],
    {
      cwd: apiDirectory,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'test-access-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        SCRAPER_ALLOW_PRIVATE_URLS: 'true',
      },
    }
  );

  assert.equal(stdout.trim(), 'false');
});
