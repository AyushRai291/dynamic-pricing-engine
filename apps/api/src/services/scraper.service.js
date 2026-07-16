import crypto from 'node:crypto';

import puppeteer from 'puppeteer';

import { query } from '../config/db.js';
import { parsePriceFromHtml } from '../utils/priceParser.js';
import { validateCompetitorUrl } from '../utils/competitorUrl.js';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getProductExists(productId, queryFn) {
  const result = await queryFn('SELECT id FROM products WHERE id = $1', [productId]);

  return result.rowCount > 0;
}

async function fetchHtmlWithPuppeteer(url) {
  const browser = await puppeteer.launch({ headless: true });
  let scrapeError;

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const html = await page.content();
    return html;
  } catch (error) {
    scrapeError = error;
    throw error;
  } finally {
    try {
      await browser.close();
    } catch (cleanupError) {
      if (!scrapeError) {
        throw cleanupError;
      }

      console.error(`[scraper] browser cleanup failed after scrape error: ${cleanupError.message}`);
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
  { productId, competitorName, competitorUrl, mockHtml },
  { queryFn = query, fetchHtmlFn = fetchHtmlWithPuppeteer } = {}
) {
  await assertProductExists(productId, { queryFn });

  if (!mockHtml) {
    validateCompetitorUrl(competitorUrl);
  }

  const html = mockHtml || await fetchHtmlFn(competitorUrl);
  const price = parsePriceFromHtml(html);

  if (price === null) {
    throw createError('Price could not be parsed from HTML', 400);
  }

  const rawHtmlHash = crypto.createHash('md5').update(html).digest('hex');
  const result = await queryFn(
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

  return result.rows[0];
}

export const triggerScrape = scrapeAndStoreCompetitorData;

export async function getActiveConfiguredScrapeTargets({ queryFn = query } = {}) {
  const result = await queryFn(
    `SELECT
       ct.id AS "targetId",
       ct.product_id AS "productId",
       ct.competitor_name AS "competitorName",
       ct.competitor_url AS "competitorUrl"
     FROM competitor_targets ct
     JOIN products p ON p.id = ct.product_id
     WHERE ct.is_active = TRUE
       AND p.is_active = TRUE
     ORDER BY ct.product_id, ct.id`
  );

  return result.rows;
}
