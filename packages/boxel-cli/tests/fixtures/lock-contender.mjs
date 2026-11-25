// One process contending for the lock in file-lock.test.ts. It waits until
// `startAt` so every contender reaches the lock at once, holds it for a
// moment, and records any other holder it sees while it holds it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const [, , fileLockModule, lockPath, dir, startAt] = process.argv;
const { withFileLock } = await import(fileLockModule);

while (Date.now() < Number(startAt)) {
  // Spin rather than sleep, to arrive within a millisecond of the others.
}

await withFileLock(
  lockPath,
  async () => {
    let mine = path.join(dir, `holding.${process.pid}`);
    fs.writeFileSync(mine, '');
    await sleep(50);
    let others = fs
      .readdirSync(dir)
      .filter(
        (f) => f.startsWith('holding.') && f !== `holding.${process.pid}`,
      );
    if (others.length > 0) {
      fs.writeFileSync(path.join(dir, `overlap.${process.pid}`), others.join());
    }
    fs.rmSync(mine);
  },
  { pollMs: 5 },
);
