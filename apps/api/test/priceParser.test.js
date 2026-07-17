import assert from 'node:assert/strict';
import test from 'node:test';

const { parsePriceFromHtml } = await import('../src/utils/priceParser.js');

test('structured JSON-LD Product and Offer prices take precedence over visible text', () => {
  const html = `
    <script type="application/ld+json">
      {"@type":"Product","offers":{"@type":"Offer","price":"1299.50"}}
    </script>
    <div class="price">INR 9,999</div>`;

  assert.equal(parsePriceFromHtml(html), 1299.5);
});

test('structured metadata is checked before generic selectors', () => {
  assert.equal(parsePriceFromHtml(`
    <meta property="product:price:amount" content="2499.00">
    <div class="price">INR 4,999</div>`), 2499);
  assert.equal(parsePriceFromHtml(`
    <meta property="og:price:amount" content="3499">
    <div class="price">INR 4,999</div>`), 3499);
  assert.equal(parsePriceFromHtml(`
    <span itemprop="price" content="4599">INR 5,999</span>
    <div class="price">INR 6,999</div>`), 4599);
});

test('generic price selectors remain available as a fallback and non-positive values are rejected', () => {
  assert.equal(parsePriceFromHtml('<div class="product-price">INR 1,234.50</div>'), 1234.5);
  assert.equal(parsePriceFromHtml('<p>Current price INR 875</p>'), 875);
  assert.equal(parsePriceFromHtml('<meta itemprop="price" content="0">'), null);
  assert.equal(parsePriceFromHtml('<meta itemprop="price" content="-10">'), null);
});
