import crypto from 'node:crypto';

import puppeteer from 'puppeteer';

import { query } from '../config/db.js';
import {
  SCRAPER_DISABLE_CHROMIUM_SANDBOX,
  SCRAPER_MAX_HTML_BYTES,
  SCRAPER_MAX_REDIRECTS,
} from '../config/env.js';
import { getActiveCompetitorTarget } from './competitorTarget.service.js';
import { parsePriceFromHtml } from '../utils/priceParser.js';
import { validateLiveCompetitorUrl } from '../utils/competitorUrl.js';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getProductExists(productId, queryFn) {
  const result = await queryFn('SELECT id FROM products WHERE id = $1', [productId]);

  return result.rowCount > 0;
}

function assertHtmlSize(html, maximumBytes = SCRAPER_MAX_HTML_BYTES) {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > maximumBytes) {
    throw createError('Scraped HTML exceeds the configured size limit', 413);
  }
}

export async function fetchHtmlWithPuppeteer(
  url,
  {
    puppeteerImpl = puppeteer,
    validateLiveUrlFn = validateLiveCompetitorUrl,
    maximumHtmlBytes = SCRAPER_MAX_HTML_BYTES,
    maximumRedirects = SCRAPER_MAX_REDIRECTS,
  } = {}
) {
  let browser;
  let page;
  let primaryError;
  let navigationError;
  let topLevelNavigationCount = 0;

  try {
    await validateLiveUrlFn(url);
    browser = await puppeteerImpl.launch({
      headless: true,
      ...(SCRAPER_DISABLE_CHROMIUM_SANDBOX
        ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
        : {}),
    });
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      try {
          const resourceType = request.resourceType();
          if (['image', 'media', 'font'].includes(resourceType)) {
            if (!request.isInterceptResolutionHandled?.()) {
              await request.abort('blockedbyclient');
            }
            return;
          }

          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            topLevelNavigationCount += 1;
            if (topLevelNavigationCount > maximumRedirects + 1) {
              throw createError('Scrape exceeded the top-level redirect limit', 400);
            }

            // DNS is checked again for every top-level navigation. Chromium still performs its
            // own resolution, so this does not provide complete address pinning against DNS rebinding.
            await validateLiveUrlFn(request.url());
          }

          if (!request.isInterceptResolutionHandled?.()) {
            await request.continue();
          }
      } catch (error) {
        navigationError ||= error?.statusCode
          ? error
          : createError('Scrape navigation was blocked', 400);
        if (!request.isInterceptResolutionHandled?.()) {
          await request.abort('blockedbyclient').catch(() => {});
        }
      }
    });

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (navigationError) throw navigationError;
    const redirectCount = response?.request?.().redirectChain?.().length || 0;
    if (redirectCount > maximumRedirects) {
      throw createError('Scrape exceeded the top-level redirect limit', 400);
    }
    await validateLiveUrlFn(page.url());

    const html = await page.content();
    assertHtmlSize(html, maximumHtmlBytes);
    return html;
  } catch (error) {
    const sourceError = navigationError || error;
    primaryError = sourceError?.statusCode
      ? sourceError
      : createError('Scrape navigation failed', 502);
    throw primaryError;
  } finally {
    let cleanupFailed = false;

    if (page) {
      try {
        await page.close();
      } catch {
        cleanupFailed = true;
      }
    }

    try {
      if (browser) await browser.close();
    } catch {
      cleanupFailed = true;
    }

    if (cleanupFailed && !primaryError) {
      throw createError('Scraper browser cleanup failed', 503);
    }
  }
}

export async function assertProductExists(productId, { queryFn = query } = {}) {
  const productExists = await getProductExists(productId, queryFn);

  if (!productExists) {
    throw createError('Product not found', 404);
  }
}

export async function scrapeAndStoreCompetitorData(
  { targetId, productId, competitorName, competitorUrl, mockHtml },
  { queryFn = query, fetchHtmlFn = fetchHtmlWithPuppeteer } = {}
) {
  await assertProductExists(productId, { queryFn });

  const html = mockHtml || await fetchHtmlFn(competitorUrl);
  assertHtmlSize(html);
  const price = parsePriceFromHtml(html);

  if (price === null) {
    throw createError('Price could not be parsed from HTML', 400);
  }

  const rawHtmlHash = crypto.createHash('md5').update(html).digest('hex');
  let result;

  if (targetId) {
    result = await queryFn(
      `INSERT INTO competitor_data (
        product_id,
        competitor_name,
        competitor_url,
        price,
        scraped_at,
        is_available,
        raw_html_hash
      )
      SELECT
        ct.product_id,
        ct.competitor_name,
        ct.competitor_url,
        $5,
        NOW(),
        TRUE,
        $6
      FROM competitor_targets ct
      JOIN products p ON p.id = ct.product_id
      WHERE ct.id = $1
        AND ct.product_id = $2
        AND ct.competitor_name = $3
        AND ct.competitor_url = $4
        AND ct.is_active = TRUE
        AND p.is_active = TRUE
      RETURNING
        id,
        product_id,
        competitor_name,
        competitor_url,
        price,
        scraped_at,
        is_available,
        raw_html_hash,
        created_at`,
      [targetId, productId, competitorName, competitorUrl, price, rawHtmlHash]
    );

    if (!result.rows[0]) {
      throw createError('Active competitor target changed before storage', 409);
    }
  } else {
    result = await queryFn(
      `INSERT INTO competitor_data (
      product_id,
      competitor_name,
      competitor_url,
      price,
      scraped_at,
      is_available,
      raw_html_hash
    )
    VALUES ($1, $2, $3, $4, NOW(), TRUE, $5)
    RETURNING
      id,
      product_id,
      competitor_name,
      competitor_url,
      price,
      scraped_at,
      is_available,
      raw_html_hash,
      created_at`,
      [productId, competitorName, competitorUrl, price, rawHtmlHash]
    );
  }

  return result.rows[0];
}

export async function scrapeConfiguredTarget(
  targetId,
  {
    getActiveTargetFn = getActiveCompetitorTarget,
    queryFn = query,
    fetchHtmlFn = fetchHtmlWithPuppeteer,
  } = {}
) {
  const target = await getActiveTargetFn(targetId);

  return scrapeAndStoreCompetitorData(
    { targetId, ...target },
    { queryFn, fetchHtmlFn }
  );
}

export const triggerScrape = scrapeAndStoreCompetitorData;

export async function getActiveConfiguredScrapeTargets({ queryFn = query } = {}) {
  const result = await queryFn(
    `SELECT
       ct.id AS "targetId"
     FROM competitor_targets ct
     JOIN products p ON p.id = ct.product_id
     WHERE ct.is_active = TRUE
       AND p.is_active = TRUE
     ORDER BY ct.product_id, ct.id`
  );

  return result.rows;
}
