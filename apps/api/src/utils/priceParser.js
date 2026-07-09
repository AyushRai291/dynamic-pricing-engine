import * as cheerio from 'cheerio';

function parsePriceValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return null;
  }

  const currencyMatch = normalized.match(/(?:\u20b9|Rs\.?|INR)\s*([0-9][0-9,\s]*(?:\.\d{1,2})?)/i);
  const genericMatch = normalized.match(/([0-9][0-9,\s]*(?:\.\d{1,2})?)/);
  const match = currencyMatch || genericMatch;

  if (!match) {
    return null;
  }

  const amount = Number(match[1].replace(/[,\s]/g, ''));

  if (!Number.isFinite(amount)) {
    return null;
  }

  return Number(amount.toFixed(2));
}

export function parsePriceFromHtml(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  const $ = cheerio.load(html);
  const selectorValues = [
    $('[data-price]').first().attr('data-price'),
    $('.price').first().text(),
    $('.product-price').first().text(),
    $('#price').first().text(),
    $('meta[property="product:price:amount"]').first().attr('content'),
  ];

  for (const value of selectorValues) {
    const price = parsePriceValue(value);

    if (price !== null) {
      return price;
    }
  }

  return parsePriceValue($.root().text());
}
