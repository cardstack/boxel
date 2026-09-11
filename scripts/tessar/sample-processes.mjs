import { appendFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { setTimeout } from 'node:timers/promises';

const { values } = parseArgs({
  options: {
    pid: { type: 'string' },
    output: { type: 'string' },
    'interval-ms': { type: 'string', default: '2000' },
  },
});
const root = Number(values.pid),
  interval = Number(values['interval-ms']);
if (!Number.isSafeInteger(root) || root < 1 || !values.output || interval < 500)
  throw new Error('--pid, --output and an interval >= 500 ms are required');
await writeFile(
  values.output,
  JSON.stringify({
    type: 'metadata',
    root,
    intervalMs: interval,
    note: 'Owned process subtree; RSS sums include shared pages. Docker container resources are separate. ps CPU is a smoothed per-process percentage.',
  }) + '\n',
  { flag: 'wx' },
);
while (true) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,comm='], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .map((line) => {
      const match = line
        .trim()
        .match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
      return (
        match && {
          pid: Number(match[1]),
          parent: Number(match[2]),
          cpuPercent: Number(match[3]),
          rssKiB: Number(match[4]),
          executable: match[5].split('/').at(-1),
        }
      );
    })
    .filter(Boolean);
  if (!rows.some((row) => row.pid === root)) break;
  const owned = new Set([root]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const row of rows)
      if (owned.has(row.parent) && !owned.has(row.pid)) {
        owned.add(row.pid);
        changed = true;
      }
  }
  const processes = rows.filter((row) => owned.has(row.pid));
  await appendFile(
    values.output,
    JSON.stringify({
      at: Date.now(),
      rssKiB: processes.reduce((sum, row) => sum + row.rssKiB, 0),
      cpuPercent: processes.reduce((sum, row) => sum + row.cpuPercent, 0),
      processes,
    }) + '\n',
  );
  await setTimeout(interval);
}
