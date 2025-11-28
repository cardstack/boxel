'use strict';

/**
 * Summarize Chrome netlog to surface cache hits/misses/writes by host and list
 * which URLs were written to cache. This is a lightweight parser and will
 * gracefully handle missing files or unexpected shapes.
 *
 * Usage: node packages/host/scripts/summarize-netlog.js /path/to/netlog.json
 */

const fs = require('fs');
const path = require('path');

function main() {
  let netlogPath = process.argv[2];
  if (!netlogPath) {
    console.log('No netlog path provided; skipping cache summary.');
    return;
  }

  if (!fs.existsSync(netlogPath)) {
    console.log(`Netlog not found at ${netlogPath}; skipping cache summary.`);
    return;
  }

  let raw = fs.readFileSync(netlogPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.log(`Failed to parse netlog JSON at ${netlogPath}: ${e.message}`);
    return;
  }

  let events = Array.isArray(parsed.events) ? parsed.events : [];
  let stats = new Map(); // host -> {hits, misses, writes, reads, others, urls:Set}
  let urlBySource = new Map();

  for (let ev of events) {
    if (!ev || typeof ev !== 'object') {
      continue;
    }
    let sourceId = ev.source?.id;
    let url = extractUrl(ev);
    if (!url && sourceId != null) {
      url = urlBySource.get(sourceId);
    }
    if (url && sourceId != null && !urlBySource.has(sourceId)) {
      urlBySource.set(sourceId, url);
    }

    let host = safeHost(url);
    if (!host) {
      continue;
    }

    let bucket = getOrCreateHost(stats, host);
    let classification = classifyEvent(ev.type);
    switch (classification) {
      case 'hit':
        bucket.hits++;
        break;
      case 'miss':
        bucket.misses++;
        break;
      case 'write':
        bucket.writes++;
        bucket.urls.add(url);
        break;
      case 'read':
        bucket.reads++;
        break;
      default:
        bucket.others++;
        break;
    }
  }

  if (!stats.size) {
    console.log('No cache-related events found in netlog.');
    return;
  }

  let summaryLines = [];
  summaryLines.push('Cache summary by host (hits/misses/writes/reads/others):');
  for (let [host, bucket] of [...stats.entries()].sort(sortHosts)) {
    summaryLines.push(
      `${host}: hits=${bucket.hits} misses=${bucket.misses} writes=${bucket.writes} reads=${bucket.reads} other=${bucket.others}`,
    );
  }

  let cachedUrls = [];
  for (let [host, bucket] of stats) {
    for (let url of bucket.urls) {
      cachedUrls.push({ host, url });
    }
  }
  cachedUrls = cachedUrls.slice(0, 50); // trim to avoid flooding logs

  summaryLines.push('');
  summaryLines.push(
    `Cached URL samples (up to ${cachedUrls.length} entries from cache writes):`,
  );
  for (let entry of cachedUrls) {
    summaryLines.push(`- ${entry.host} :: ${entry.url}`);
  }

  let summaryText = summaryLines.join('\n');
  console.log(summaryText);

  // If running in GitHub Actions, append to step summary for quick viewing.
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n\n### Chrome cache summary\n\n\`\`\`\n${summaryText}\n\`\`\`\n`,
    );
  }
}

function extractUrl(ev) {
  return (
    ev.params?.url ||
    ev.params?.original_url ||
    ev.params?.key ||
    ev.params?.policy_key ||
    null
  );
}

function safeHost(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  try {
    return new URL(url).host || null;
  } catch (_e) {
    return null;
  }
}

function classifyEvent(type) {
  if (!type || typeof type !== 'string') {
    return 'other';
  }
  let upper = type.toUpperCase();
  if (upper.includes('HIT')) {
    return 'hit';
  }
  if (upper.includes('MISS')) {
    return 'miss';
  }
  if (upper.includes('WRITE')) {
    return 'write';
  }
  if (upper.includes('READ')) {
    return 'read';
  }
  return 'other';
}

function getOrCreateHost(map, host) {
  if (!map.has(host)) {
    map.set(host, {
      hits: 0,
      misses: 0,
      writes: 0,
      reads: 0,
      others: 0,
      urls: new Set(),
    });
  }
  return map.get(host);
}

function sortHosts([hostA, a], [hostB, b]) {
  let scoreA = a.hits + a.writes + a.reads + a.misses + a.others;
  let scoreB = b.hits + b.writes + b.reads + b.misses + b.others;
  return scoreB - scoreA || hostA.localeCompare(hostB);
}

main();
