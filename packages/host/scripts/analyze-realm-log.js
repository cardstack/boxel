#!/usr/bin/env node
const fs = require('fs');

if (process.argv.length < 3) {
  console.error('Usage: analyze-realm-log <path-to-server.log>');
  process.exit(1);
}

const logPath = process.argv[2];

if (!fs.existsSync(logPath)) {
  console.error(`Realm log not found at ${logPath}`);
  process.exit(0);
}

let raw;
try {
  raw = fs.readFileSync(logPath, 'utf8');
} catch (error) {
  console.error(`Failed to read ${logPath}:`, error instanceof Error ? error.message : error);
  process.exit(0);
}

if (!raw.trim()) {
  console.error('Realm log is empty.');
  process.exit(0);
}

const lines = raw.split(/\r?\n/);

const realmStats = new Map();

function getRealmRecord(realmURL) {
  let record = realmStats.get(realmURL);
  if (!record) {
    record = {
      starts: 0,
      completions: 0,
      updaterCompletions: 0,
      jobIds: new Set(),
      lastStartLine: undefined,
      lastCompletionLine: undefined,
    };
    realmStats.set(realmURL, record);
  }
  return record;
}

function trimTrailingPunctuation(value) {
  return value.replace(/[;:,]+$/u, '');
}

function safeParseJSON(candidate) {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

const contexts = [];
const seenContexts = new Set();

function recordContext(label, lineNumber, before = 3, after = 5) {
  const key = `${label}:${lineNumber}`;
  if (seenContexts.has(key)) {
    return;
  }
  seenContexts.add(key);
  const start = Math.max(0, lineNumber - 1 - before);
  const end = Math.min(lines.length, lineNumber - 1 + after + 1);
  contexts.push({
    label,
    lineNumber,
    snippet: lines.slice(start, end).join('\n'),
  });
}

const interestingPatterns = [
  {
    label: 'Realm indexer error',
    regex: /Error running from-scratch-index/i,
    before: 3,
    after: 6,
  },
  {
    label: 'Realm worker error',
    regex: /Error raised during indexing has likely stopped the indexer/i,
    before: 3,
    after: 6,
  },
  {
    label: 'Register runner rethrow',
    regex: /Rethrowing error from inside registerRunner/i,
    before: 2,
    after: 6,
  },
  {
    label: 'Indexing timeout mention',
    regex: /timeout/i,
    before: 2,
    after: 4,
    filter(line) {
      const lowered = line.toLowerCase();
      return (
        lowered.includes('index') ||
        lowered.includes('from-scratch') ||
        lowered.includes('wait-on') ||
        lowered.includes('realm')
      );
    },
  },
  {
    label: 'Database locked',
    regex: /SQLITE_BUSY|database is locked/i,
    before: 3,
    after: 6,
  },
  {
    label: 'Network refusal',
    regex: /ECONNREFUSED|ECONNRESET|EHOSTUNREACH/i,
    before: 2,
    after: 4,
  },
];

const pendingJobs = new Map();

for (let index = 0; index < lines.length; index++) {
  const line = lines[index];
  const lineNumber = index + 1;

  for (const pattern of interestingPatterns) {
    if (!pattern.regex.test(line)) {
      continue;
    }
    if (pattern.filter && !pattern.filter(line)) {
      continue;
    }
    recordContext(pattern.label, lineNumber, pattern.before, pattern.after);
  }

  const startMatch = line.match(/\[job: ([^\]]+)\].*starting from-scratch indexing for job: (\{.*\})$/);
  if (startMatch) {
    const jobId = startMatch[1];
    const payload = safeParseJSON(startMatch[2]);
    if (payload && typeof payload.realmURL === 'string') {
      const realmURL = trimTrailingPunctuation(payload.realmURL);
      const record = getRealmRecord(realmURL);
      record.starts++;
      record.jobIds.add(jobId);
      record.lastStartLine = lineNumber;
      pendingJobs.set(jobId, realmURL);
    }
    continue;
  }

  const completionMatch = line.match(/\[job: ([^\]]+)\].*completed from-scratch indexing for realm\s+([^\s]+).*$/);
  if (completionMatch) {
    const jobId = completionMatch[1];
    const realmURL = trimTrailingPunctuation(completionMatch[2]);
    const record = getRealmRecord(realmURL);
    record.completions++;
    record.lastCompletionLine = lineNumber;
    pendingJobs.delete(jobId);
    continue;
  }

  const updaterCompletionMatch = line.match(/Realm\s+(https?:\/\/[^\s]+)\s+has completed indexing/i);
  if (updaterCompletionMatch) {
    const realmURL = trimTrailingPunctuation(updaterCompletionMatch[1]);
    const record = getRealmRecord(realmURL);
    record.updaterCompletions++;
    if (!record.lastCompletionLine) {
      record.lastCompletionLine = lineNumber;
    }
    continue;
  }
}

const unresolved = [];
for (const [jobId, realmURL] of pendingJobs.entries()) {
  const record = getRealmRecord(realmURL);
  unresolved.push({ jobId, realmURL, lineNumber: record.lastStartLine });
}

if (realmStats.size === 0) {
  console.log('No from-scratch indexing attempts were logged.');
} else {
  console.log('Realm indexing summary:');
  for (const [realmURL, record] of realmStats.entries()) {
    console.log(
      `  • ${realmURL} — starts: ${record.starts}, worker completions: ${record.completions}, realm-index-updater completions: ${record.updaterCompletions}`,
    );
    if (record.lastStartLine) {
      console.log(`      last start logged at line ${record.lastStartLine}`);
    }
    if (record.lastCompletionLine) {
      console.log(`      last completion logged at line ${record.lastCompletionLine}`);
    }
    if (record.starts > Math.max(record.completions, record.updaterCompletions)) {
      console.log(
        '      ⚠️  Latest attempt did not record a completion — check for errors below or in queued job logs.',
      );
    }
  }
}

if (unresolved.length) {
  console.log('\nIndexing jobs without a completion entry:');
  for (const job of unresolved) {
    console.log(
      `  • job ${job.jobId} for ${job.realmURL} (last seen at line ${job.lineNumber ?? 'unknown'})`,
    );
  }
}

if (contexts.length) {
  console.log('\nRelevant log excerpts:');
  for (const context of contexts) {
    console.log(`\n─ ${context.label} (around line ${context.lineNumber})`);
    console.log(context.snippet);
  }
} else {
  console.log('\nNo obvious indexing error patterns were detected in the realm log.');
}

