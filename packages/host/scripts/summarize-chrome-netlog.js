#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
  console.error('Usage: summarize-chrome-netlog <path-to-netlog.json>');
  process.exit(1);
}

const filePath = process.argv[2];

function describeNetError(code) {
  const lookup = {
    [-2]: 'ERR_FAILED',
    [-3]: 'ERR_ABORTED',
    [-7]: 'ERR_TIMED_OUT',
    [-21]: 'ERR_NETWORK_CHANGED',
    [-100]: 'ERR_CONNECTION_CLOSED',
    [-102]: 'ERR_CONNECTION_REFUSED',
    [-103]: 'ERR_CONNECTION_ABORTED',
    [-105]: 'ERR_NAME_NOT_RESOLVED',
    [-106]: 'ERR_INTERNET_DISCONNECTED',
    [-109]: 'ERR_ADDRESS_UNREACHABLE',
    [-110]: 'ERR_CONNECTION_REFUSED',
    [-111]: 'ERR_TUNNEL_CONNECTION_FAILED',
    [-112]: 'ERR_NO_SSL_VERSIONS_ENABLED',
    [-113]: 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH',
    [-118]: 'ERR_CONNECTION_TIMED_OUT',
    [-119]: 'ERR_CONNECTION_CLOSED',
    [-120]: 'ERR_CONNECTION_RESET',
    [-130]: 'ERR_PROXY_CONNECTION_FAILED',
    [-131]: 'ERR_INTERNET_DISCONNECTED',
    [-137]: 'ERR_NAME_RESOLUTION_FAILED',
    [-138]: 'ERR_INTERNET_DISCONNECTED',
    [-139]: 'ERR_SSL_PROTOCOL_ERROR',
    [-147]: 'ERR_SOCKET_NOT_CONNECTED',
    [-148]: 'ERR_SSL_BAD_RECORD_MAC_ALERT',
    [-324]: 'ERR_EMPTY_RESPONSE',
    [-327]: 'ERR_RESPONSE_HEADERS_TOO_BIG',
    [-501]: 'ERR_INSECURE_RESPONSE',
  };
  return lookup[code] || `NET_ERROR_${code}`;
}

function normalizeUrl(candidate) {
  if (!candidate || typeof candidate !== 'string') {
    return undefined;
  }
  return candidate;
}

let parsed;
try {
  const raw = fs.readFileSync(filePath, 'utf8');
  parsed = JSON.parse(raw);
} catch (error) {
  console.error(`Failed to parse ${filePath}:`, error instanceof Error ? error.message : error);
  process.exit(1);
}

const events = Array.isArray(parsed.events) ? parsed.events : [];

const requests = new Map();

for (const event of events) {
  if (!event || typeof event !== 'object') continue;
  const source = event.source;
  if (!source || typeof source.id !== 'number') continue;

  let record = requests.get(source.id);
  if (!record) {
    record = {
      url: undefined,
      failures: [],
      sourceType: source.type,
    };
    requests.set(source.id, record);
  }

  const params = event.params ?? {};
  if (!record.url) {
    record.url =
      normalizeUrl(params.url) ||
      normalizeUrl(params.original_url) ||
      normalizeUrl(params.full_url) ||
      normalizeUrl(params.request_url) ||
      normalizeUrl(params.location); // fallbacks for different event types
  }

  if (
    typeof params.net_error === 'number' &&
    params.net_error !== 0 &&
    !Number.isNaN(params.net_error)
  ) {
    record.failures.push({
      kind: 'net',
      code: params.net_error,
      type: event.type,
      description:
        typeof params.error_description === 'string'
          ? params.error_description
          : typeof params.description === 'string'
            ? params.description
            : undefined,
    });
  }

  if (
    typeof params.status_code === 'number' &&
    params.status_code >= 400
  ) {
    record.failures.push({
      kind: 'http',
      status: params.status_code,
      type: event.type,
      description:
        typeof params.status_text === 'string'
          ? params.status_text
          : typeof params.headers === 'object'
            ? params.headers[':status-text']
            : undefined,
    });
  }
}

const failures = Array.from(requests.values()).filter((request) => {
  if (!request.failures.length) {
    return false;
  }
  // Only surface URL requests (we do not care about socket level objects with no URL)
  return request.url || request.sourceType === 'URL_REQUEST';
});

if (!failures.length) {
  console.log(`No network failures detected in ${path.basename(filePath)}.`);
  process.exit(0);
}

console.log(`Network failures detected in ${path.basename(filePath)}:`);
for (const failure of failures) {
  console.log(`  • ${(failure.url ?? '<unknown URL>')}`);
  for (const detail of failure.failures) {
    if (detail.kind === 'net') {
      const errorName = describeNetError(detail.code);
      const message = detail.description ? ` – ${detail.description}` : '';
      console.log(
        `      ${detail.type}: net::${errorName} (${detail.code})${message}`,
      );
    } else if (detail.kind === 'http') {
      const message = detail.description ? ` – ${detail.description}` : '';
      console.log(
        `      ${detail.type}: HTTP ${detail.status}${message}`,
      );
    }
  }
}
