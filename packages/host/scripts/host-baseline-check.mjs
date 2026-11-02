// Helpers that host-test-time.mjs and host-peak-heap.mjs share: reading the
// baseline file and the command line, the GitHub API, and publishing a check's
// result to the console, the job summary, the PR comment slot and
// GITHUB_OUTPUT.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

export function median(values) {
  let sorted = [...values].sort((a, b) => a - b);
  let mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// The value after `--<name>` in `args`, or undefined.
export function opt(args, name) {
  let i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

// The baseline file merged over `empty`, or `empty` when the file is missing
// or not JSON.
export function readBaseline(path, empty) {
  try {
    return { ...empty, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return empty;
  }
}

export function writeBaseline(path, baseline) {
  writeFileSync(path, JSON.stringify(baseline, null, 2) + '\n');
}

// GET from the current repository's REST API. Reads GITHUB_TOKEN and
// GITHUB_REPOSITORY.
export async function api(path) {
  let { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set.');
  }
  let response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/${path}`,
    {
      headers: {
        authorization: `Bearer ${GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// Maps `items` through `fn`, at most `limit` at a time, keeping their order.
export async function mapLimit(items, limit, fn) {
  let results = [];
  for (let i = 0; i < items.length; i += limit) {
    results.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return results;
}

// Sorts entries by their run's creation time and keeps the newest `keep`.
export const newest = (entries, keep) =>
  entries.sort((a, b) => a.at.localeCompare(b.at)).slice(-keep);

// Prints the report, adds it to the job summary, writes it to the `--slot`
// file when one is given, and sets `<output>=true|false` in GITHUB_OUTPUT.
export function publish(lines, { slot, output, value }) {
  let summary = lines.join('\n') + '\n';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  if (slot) writeFileSync(slot, summary);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${output}=${value}\n`);
  }
}
