import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  isPublicScraperAddress,
  validateCompetitorUrl,
  validateLiveCompetitorUrl,
} = await import('../src/utils/competitorUrl.js');

test('competitor URL validation rejects unsafe syntax, protocols, credentials, and literal hosts', () => {
  const unsafeUrls = [
    'file:///etc/passwd',
    'ftp://example.com/item',
    'https://user:password@example.com/item',
    'http://localhost/item',
    'http://127.0.0.1/item',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1/item',
    'http://[::1]/item',
    'http://[fc00::1]/item',
  ];

  for (const url of unsafeUrls) {
    assert.throws(() => validateCompetitorUrl(url), /HTTP|credentials|host/);
  }

  assert.equal(validateCompetitorUrl('https://shop.example/item'), 'https://shop.example/item');
});

test('address classification accepts public addresses and blocks non-public classes', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPublicScraperAddress(address), true, address);
  }

  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1',
    '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1',
  ]) {
    assert.equal(isPublicScraperAddress(address), false, address);
  }
});

test('live validation checks every mocked DNS result and fails closed', async () => {
  const publicLookup = async (hostname, options) => {
    assert.equal(hostname, 'shop.example');
    assert.deepEqual(options, { all: true, verbatim: true });
    return [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ];
  };

  assert.equal(
    await validateLiveCompetitorUrl('https://shop.example/item', { lookupFn: publicLookup }),
    'https://shop.example/item'
  );

  await assert.rejects(
    validateLiveCompetitorUrl('https://shop.example/item', {
      lookupFn: async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }],
    }),
    /resolved to a non-public address/
  );
  await assert.rejects(
    validateLiveCompetitorUrl('https://shop.example/item', {
      lookupFn: async () => { throw new Error('getaddrinfo ENOTFOUND internal details'); },
    }),
    (error) => error.statusCode === 400 && error.message === 'competitorUrl host could not be resolved'
  );
});

test('private URL override bypasses DNS only when explicitly supplied', async () => {
  let lookupCalled = false;
  const url = await validateLiveCompetitorUrl('http://127.0.0.1/item', {
    allowPrivateUrls: true,
    lookupFn: async () => { lookupCalled = true; },
  });

  assert.equal(url, 'http://127.0.0.1/item');
  assert.equal(lookupCalled, false);
});
