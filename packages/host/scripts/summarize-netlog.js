'use strict';

/**
 * Summarize Chrome netlog to surface cache hits/misses/writes by host and list
 * which URLs were written to cache. This uses a streaming parser to avoid
 * loading very large netlogs into memory.
 *
 * Usage: node packages/host/scripts/summarize-netlog.js /path/to/netlog.json
 */

const fs = require('fs');
const path = require('path');

const MAX_URL_SAMPLES = 200;
const PROGRESS_BYTES_INTERVAL = 25 * 1024 * 1024; // 25MB
const PROGRESS_EVENTS_INTERVAL = 100_000;
const STALL_TIMEOUT_MS =
  parseInt(process.env.NETLOG_STALL_TIMEOUT_MS || '', 10) || 60_000; // bail if no progress for 60s
const MAX_DURATION_MS =
  parseInt(process.env.NETLOG_MAX_DURATION_MS || '', 10) || 5 * 60_000; // hard cap 5 minutes

async function main() {
  let netlogPath = process.argv[2];
  if (!netlogPath) {
    console.log('No netlog path provided; skipping cache summary.');
    return;
  }

  if (!fs.existsSync(netlogPath)) {
    console.log(`Netlog not found at ${netlogPath}; skipping cache summary.`);
    return;
  }

  let statsObj = fs.statSync(netlogPath);
  console.log(
    `Parsing netlog at ${netlogPath} (size=${statsObj.size} bytes ~ ${(statsObj.size / (1024 * 1024)).toFixed(1)} MB)`,
  );

  let stats = new Map(); // host -> {hits, misses, writes, reads, others, urls:Set}
  let urlBySource = new Map();
  let totals = { events: 0, parsed: 0, errors: 0 };
  let maxEvents = parseInt(process.env.NETLOG_MAX_EVENTS || '', 10);
  if (!Number.isFinite(maxEvents) || maxEvents <= 0) {
    maxEvents = null;
  }
  let maxBytes = parseInt(process.env.NETLOG_MAX_BYTES || '', 10);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    maxBytes = null;
  }

  try {
    let streamResult = await streamEvents(
      netlogPath,
      (ev) => {
        totals.events++;
        if (!ev || typeof ev !== 'object') {
          return;
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
          return;
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
            if (bucket.urls.size < MAX_URL_SAMPLES) {
              bucket.urls.add(url);
            }
            break;
          case 'read':
            bucket.reads++;
            break;
          default:
            bucket.others++;
            break;
        }
        totals.parsed++;
      },
      { maxEvents, maxBytes },
    );
    totals.events = streamResult.eventCount;
    console.log(
      `Netlog parsed: events=${totals.events} parsed=${totals.parsed} bytesRead=${streamResult.bytesRead} (~${(
        streamResult.bytesRead /
        (1024 * 1024)
      ).toFixed(1)} MB) duration=${streamResult.durationMs}ms truncated=${streamResult.truncated} reason=${streamResult.stopReason}`,
    );
  } catch (e) {
    console.log(`Failed to parse netlog at ${netlogPath}: ${e.message}`);
    return;
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

  summaryLines.push('');
  summaryLines.push(
    `Processed events: ${totals.parsed}/${totals.events} (errors=${totals.errors})`,
  );

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

function streamEvents(
  filePath,
  onEvent,
  { maxEvents = null, maxBytes = null } = {},
) {
  let stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let buffer = '';
  let inEvents = false;
  let depth = 0;
  let inString = false;
  let escape = false;
  let startIndex = null;
  let eventCount = 0;
  let bytesRead = 0;
  let nextByteProgress = PROGRESS_BYTES_INTERVAL;
  let nextEventProgress = PROGRESS_EVENTS_INTERVAL;
  let start = Date.now();
  let truncated = false;
  let lastProgressAt = Date.now();
  let stopReason = 'completed';

  return new Promise((resolve, reject) => {
    let finished = false;
    let finish = (err) => {
      if (finished) return;
      finished = true;
      clearInterval(stallTimer);
      clearTimeout(maxDurationTimer);
      if (err) {
        reject(err);
      } else {
        resolve({
          eventCount,
          bytesRead,
          durationMs: Date.now() - start,
          truncated,
          stopReason,
        });
      }
    };

    let stallTimer = setInterval(() => {
      if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
        truncated = true;
        stopReason = `stall>${STALL_TIMEOUT_MS}ms`;
        console.log(
          `[netlog] stall detected (no progress for ${STALL_TIMEOUT_MS}ms), stopping early`,
        );
        finish();
        stream.destroy();
      }
    }, Math.max(5_000, STALL_TIMEOUT_MS / 2));

    let maxDurationTimer = setTimeout(() => {
      truncated = true;
      stopReason = `duration>${MAX_DURATION_MS}ms`;
      console.log(
        `[netlog] max duration ${MAX_DURATION_MS}ms exceeded, stopping early`,
      );
      finish();
      stream.destroy();
    }, MAX_DURATION_MS);

    stream.on('data', (chunk) => {
      buffer += chunk;
      bytesRead += chunk.length;
      lastProgressAt = Date.now();

      if (bytesRead >= nextByteProgress) {
        console.log(
          `[netlog] read ${(bytesRead / (1024 * 1024)).toFixed(
            1,
          )} MB so far (events=${eventCount})`,
        );
        nextByteProgress += PROGRESS_BYTES_INTERVAL;
      }
      if (maxBytes && bytesRead >= maxBytes) {
        truncated = true;
        stopReason = `maxBytes=${maxBytes}`;
        console.log(
          `[netlog] reached maxBytes=${maxBytes} bytes, stopping early`,
        );
        finish();
        stream.destroy();
        return;
      }

      if (!inEvents) {
        let idx = buffer.indexOf('"events"');
        if (idx !== -1) {
          let bracketIdx = buffer.indexOf('[', idx);
          if (bracketIdx !== -1) {
            inEvents = true;
            buffer = buffer.slice(bracketIdx + 1);
          } else {
            // wait for next chunk
            buffer = buffer.slice(Math.max(0, idx - 10));
            return;
          }
        } else {
          // keep last few chars in case "events" spans chunks
          buffer = buffer.slice(-10);
          return;
        }
      }

      let i = 0;
      while (i < buffer.length) {
        let ch = buffer[i];
        if (startIndex === null) {
          if (ch === '{') {
            startIndex = i;
            depth = 1;
            inString = false;
            escape = false;
          }
          i++;
          continue;
        }

        // Inside an object
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"' && !escape) {
          inString = !inString;
        } else if (!inString) {
          if (ch === '{') {
            depth++;
          } else if (ch === '}') {
            depth--;
          if (depth === 0) {
            let objText = buffer.slice(startIndex, i + 1);
            try {
              onEvent(JSON.parse(objText));
              eventCount++;
              lastProgressAt = Date.now();
            } catch (_e) {
              // ignore individual parse errors
            }
            if (eventCount >= nextEventProgress) {
              console.log(
                `[netlog] processed ${eventCount} events (bytesRead=${(bytesRead / (1024 * 1024)).toFixed(1)} MB)`,
              );
              nextEventProgress += PROGRESS_EVENTS_INTERVAL;
            }
            if (maxEvents && eventCount >= maxEvents) {
              console.log(
                `[netlog] reached maxEvents=${maxEvents}, stopping early`,
              );
              stopReason = `maxEvents=${maxEvents}`;
              finish();
              stream.destroy();
              return;
            }
            startIndex = null;
            // drop processed chunk
            buffer = buffer.slice(i + 1);
            i = 0;
            continue;
            }
          }
        }
        i++;
      }

      // Trim buffer to avoid unbounded growth; keep partial object if present.
      if (startIndex !== null && startIndex > 0) {
        buffer = buffer.slice(startIndex);
        startIndex = 0;
      } else if (startIndex === null) {
        buffer = '';
      }
    });

    stream.on('end', () => {
      if (!inEvents) {
        console.log(
          '[netlog] Warning: did not find "events" array in netlog file.',
        );
      }
      stopReason = 'eof';
      finish();
    });
    stream.on('error', (err) => finish(err));
  });
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
