import QUnit from 'qunit';
const { module, test } = QUnit;
import { readFileSync } from 'fs';
import { basename, join } from 'path';

// A deploy's start script rsyncs some realms' content straight onto their
// disks, then `scripts/scan-deployed-realms.sh` appends a scan event for each
// of them, authored by the realm's bot, so realm history attributes the
// rsync's changes to the deploy. That script keeps its own list of the
// rsynced realms and their bots, and nothing at run time checks it against
// the start scripts: a realm missing from it records its deploy changes
// unattributed, and a wrong bot records them under someone else. These tests
// hold the list to the start scripts.
const SCRIPTS_DIR = join(import.meta.dirname, '..', 'scripts');
const START_SCRIPTS = ['start-staging.sh', 'start-production.sh'];

const PACKAGE_SCRIPTS: Record<string, string> = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
).scripts;

function read(script: string): string {
  return readFileSync(join(SCRIPTS_DIR, script), 'utf8');
}

// The directories a start script's setup steps rsync into: the destination
// of each `rsync` in each `setup:*-in-deployment` step it runs.
function rsyncedDirectories(startScript: string): string[] {
  let directories = new Set<string>();
  for (let [, step] of read(startScript).matchAll(
    /^pnpm (setup:[\w-]+-in-deployment)$/gm,
  )) {
    let command = PACKAGE_SCRIPTS[step];
    if (!command) {
      throw new Error(`${startScript} runs ${step}, which package.json lacks`);
    }
    for (let part of command.split('&&')) {
      let words = part.trim().split(/\s+/);
      if (words[0] === 'rsync') {
        directories.add(words[words.length - 1].replace(/\/+$/, ''));
      }
    }
  }
  return [...directories].sort();
}

// Each realm the start script mounts: its `--path` and the `--username`
// that follows it.
function mountedBots(startScript: string): Map<string, string> {
  return new Map(
    [
      ...read(startScript).matchAll(
        /--path='([^']+)'\s*\\\s*--username='([^']+)'/g,
      ),
    ].map(([, path, username]) => [path, username]),
  );
}

// The `--realm='<directory>:<bot>'` pairs the scan step passes to scan.ts.
function scannedBots(): Map<string, string> {
  return new Map(
    [...read('scan-deployed-realms.sh').matchAll(/--realm='([^']+)'/g)].map(
      ([, value]) => {
        let separator = value.lastIndexOf(':');
        return [value.slice(0, separator), value.slice(separator + 1)];
      },
    ),
  );
}

module(basename(import.meta.filename), function () {
  for (let startScript of START_SCRIPTS) {
    test(`${startScript}: every realm its setup steps rsync is scanned, and nothing else`, function (assert) {
      let rsynced = rsyncedDirectories(startScript);
      assert.ok(rsynced.length > 0, 'the start script rsyncs some realms');
      assert.deepEqual(
        [...scannedBots().keys()].sort(),
        rsynced,
        'scan-deployed-realms.sh scans exactly the directories the setup steps rsync',
      );
    });

    test(`${startScript}: each scanned realm is scanned by the bot it is mounted with`, function (assert) {
      let mounted = mountedBots(startScript);
      for (let [directory, bot] of scannedBots()) {
        assert.strictEqual(
          bot,
          mounted.get(directory),
          `${directory} is mounted with --username='${mounted.get(directory)}'`,
        );
      }
    });

    test(`${startScript}: the scan step runs after the last setup step`, function (assert) {
      let lines = read(startScript).split('\n');
      let lastSetup = Math.max(
        ...lines.flatMap((line, index) =>
          /^pnpm setup:[\w-]+-in-deployment$/.test(line) ? [index] : [],
        ),
      );
      let scan = lines.findIndex((line) =>
        /^sh .*scan-deployed-realms\.sh\b/.test(line),
      );
      assert.ok(
        scan > lastSetup,
        `the scan step (line ${scan + 1}) follows the last setup step (line ${lastSetup + 1})`,
      );
    });
  }
});
