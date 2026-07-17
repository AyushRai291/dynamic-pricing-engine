import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { SCRAPER_ALLOW_PRIVATE_URLS } from '../config/env.js';

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isBlockedIpv4(hostname) {
  const octets = hostname.split('.').map(Number);
  const [first, second, third] = octets;

  return first === 0
    || first === 10
    || (first === 100 && second >= 64 && second <= 127)
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function parseIpv6Bytes(hostname) {
  const halves = hostname.split('::');

  if (halves.length > 2) {
    return null;
  }

  const parseHalf = (half) => (half ? half.split(':').map((part) => Number.parseInt(part, 16)) : []);
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] || '');
  const missing = 8 - left.length - right.length;

  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    return null;
  }

  const groups = halves.length === 2
    ? [...left, ...Array(missing).fill(0), ...right]
    : left;

  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group))) {
    return null;
  }

  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function isBlockedIpv6(hostname) {
  const bytes = parseIpv6Bytes(hostname);

  if (!bytes) {
    return true;
  }

  const isUnspecified = bytes.every((byte) => byte === 0);
  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const isUniqueLocal = (bytes[0] & 0xfe) === 0xfc;
  const isLinkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
  const isSiteLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0;
  const isMulticast = bytes[0] === 0xff;
  const isGlobalUnicast = (bytes[0] & 0xe0) === 0x20;
  const isDocumentation = bytes[0] === 0x20 && bytes[1] === 0x01
    && bytes[2] === 0x0d && bytes[3] === 0xb8;
  const isTeredo = bytes[0] === 0x20 && bytes[1] === 0x01
    && bytes[2] === 0x00 && bytes[3] === 0x00;
  const isIpv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0)
    && bytes[10] === 0xff
    && bytes[11] === 0xff;
  const isIpv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  const embeddedIpv4 = bytes.slice(12).join('.');

  return isUnspecified
    || isLoopback
    || isUniqueLocal
    || isLinkLocal
    || isSiteLocal
    || isMulticast
    || !isGlobalUnicast
    || isDocumentation
    || isTeredo
    || ((isIpv4Mapped || isIpv4Compatible) && isBlockedIpv4(embeddedIpv4));
}

export function isPublicScraperAddress(address) {
  const normalized = typeof address === 'string'
    ? address.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    : '';
  const version = isIP(normalized);

  if (version === 4) return !isBlockedIpv4(normalized);
  if (version === 6) return !isBlockedIpv6(normalized);
  return false;
}

export function isBlockedScraperHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }

  const ipVersion = isIP(normalized);

  if (ipVersion === 4) {
    return isBlockedIpv4(normalized);
  }

  if (ipVersion === 6) {
    return isBlockedIpv6(normalized);
  }

  return false;
}

export function validateCompetitorUrl(
  value,
  {
    allowPrivateUrls = SCRAPER_ALLOW_PRIVATE_URLS,
    allowInvalidForMockHtml = false,
  } = {}
) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError('competitorUrl is required');
  }

  const trimmed = value.trim();
  let parsed;

  try {
    parsed = new URL(trimmed);
  } catch {
    if (allowInvalidForMockHtml) {
      return trimmed;
    }

    throw createError('competitorUrl must be a valid HTTP or HTTPS URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createError('competitorUrl must be an HTTP or HTTPS URL');
  }

  if (parsed.username || parsed.password) {
    throw createError('competitorUrl must not include credentials');
  }

  if (!allowPrivateUrls && isBlockedScraperHostname(parsed.hostname)) {
    throw createError('competitorUrl host is not allowed');
  }

  return trimmed;
}

export async function validateLiveCompetitorUrl(
  value,
  {
    allowPrivateUrls = SCRAPER_ALLOW_PRIVATE_URLS,
    lookupFn = lookup,
  } = {}
) {
  const validated = validateCompetitorUrl(value, { allowPrivateUrls });

  if (allowPrivateUrls) {
    return validated;
  }

  const hostname = new URL(validated).hostname.replace(/^\[|\]$/g, '');
  let addresses;

  try {
    addresses = await lookupFn(hostname, { all: true, verbatim: true });
  } catch {
    throw createError('competitorUrl host could not be resolved');
  }

  const normalizedAddresses = Array.isArray(addresses) ? addresses : [addresses];
  if (
    normalizedAddresses.length === 0
    || normalizedAddresses.some((entry) => !isPublicScraperAddress(
      typeof entry === 'string' ? entry : entry?.address
    ))
  ) {
    throw createError('competitorUrl host resolved to a non-public address');
  }

  return validated;
}
