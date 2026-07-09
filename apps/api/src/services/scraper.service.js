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

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    return page.content();
  } finally {
    await browser.close();
  }
}

export function getScraperStatus() {
  return {
    status: 'ok',
    mode: 'manual',
    queueEnabled: false,
    cronEnabled: false,
  };
}

export async function triggerScrape({ productId, competitorName, competitorUrl, mockHtml }) {
  const productExists = await getProductExists(productId);

  if (!productExists) {
    throw createError('Product not found', 404);
  }

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
