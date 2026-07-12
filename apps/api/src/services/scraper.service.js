import crypto from 'node:crypto';

import puppeteer from 'puppeteer';

import { query } from '../config/db.js';
import { parsePriceFromHtml } from '../utils/priceParser.js';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getProductExists(productId) {
  const result = await query('SELECT id FROM products WHERE id = $1', [productId]);

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

export async function assertProductExists(productId) {
  const productExists = await getProductExists(productId);

  if (!productExists) {
    throw createError('Product not found', 404);
  }
}

export async function scrapeAndStoreCompetitorData({ productId, competitorName, competitorUrl, mockHtml }) {
  await assertProductExists(productId);

  const html = mockHtml || await fetchHtmlWithPuppeteer(competitorUrl);
  const price = parsePriceFromHtml(html);

  if (price === null) {
    throw createError('Price could not be parsed from HTML', 400);
  }

  const rawHtmlHash = crypto.createHash('md5').update(html).digest('hex');
  const result = await query(
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

export async function getKnownScrapeTargets() {
  const result = await query(
    `SELECT DISTINCT ON (cd.product_id, cd.competitor_name)
       cd.product_id AS "productId",
       cd.competitor_name AS "competitorName",
       cd.competitor_url AS "competitorUrl"
     FROM competitor_data cd
     JOIN products p ON p.id = cd.product_id
     WHERE p.is_active = TRUE
       AND cd.competitor_url IS NOT NULL
       AND btrim(cd.competitor_url) <> ''
       AND cd.competitor_url ~* '^https?://'
     ORDER BY cd.product_id, cd.competitor_name, cd.scraped_at DESC
     LIMIT 100`
  );

  return result.rows;
}
