import * as cheerio from 'cheerio';

function parsePriceValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return null;
  }

  const currencyMatch = normalized.match(/(?:\u20b9|Rs\.?|INR)\s*(-?[0-9][0-9,\s]*(?:\.\d{1,2})?)/i);
  const genericMatch = normalized.match(/(-?[0-9][0-9,\s]*(?:\.\d{1,2})?)/);
  const match = currencyMatch || genericMatch;

  if (!match) {
    return null;
  }

  const amount = Number(match[1].replace(/[,\s]/g, ''));

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Number(amount.toFixed(2));
}

function getJsonLdTypes(value) {
  const types = Array.isArray(value) ? value : [value];
  return types.filter((type) => typeof type === 'string').map((type) => type.toLowerCase());
}

function collectStructuredPriceCandidates(value, candidates) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectStructuredPriceCandidates(item, candidates));
    return;
  }

  if (!value || typeof value !== 'object') return;

  const types = getJsonLdTypes(value['@type']);
  if (types.includes('offer') || types.includes('aggregateoffer')) {
    candidates.push(value.price, value.lowPrice, value.highPrice);
  }
  if (types.includes('product')) {
    candidates.push(value.price);
  }

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      collectStructuredPriceCandidates(nested, candidates);
    }
  }
}

function getJsonLdPrices($) {
  const candidates = [];

  $('script[type="application/ld+json"]').each((index, element) => {
    const json = $(element).html();
    if (!json) return;

    try {
      collectStructuredPriceCandidates(JSON.parse(json), candidates);
    } catch {
      // Ignore malformed structured data and continue with other trusted extraction sources.
    }
  });

  return candidates;
}

export function parsePriceFromHtml(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  const $ = cheerio.load(html);
  const structuredValues = [
    ...getJsonLdPrices($),
    $('meta[property="product:price:amount"]').first().attr('content'),
    $('meta[property="og:price:amount"]').first().attr('content'),
    $('[itemprop="price"]').first().attr('content'),
    $('[itemprop="price"]').first().text(),
  ];

  for (const value of structuredValues) {
    const price = parsePriceValue(value);

    if (price !== null) return price;
  }

  const selectorValues = [
    $('[data-price]').first().attr('data-price'),
    $('.price').first().text(),
    $('.product-price').first().text(),
    $('#price').first().text(),
  ];

  for (const value of selectorValues) {
    const price = parsePriceValue(value);

    if (price !== null) {
      return price;
    }
  }

  return parsePriceValue($.root().text());
}
