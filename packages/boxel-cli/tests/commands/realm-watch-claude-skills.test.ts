import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RealmWatcher } from '../../src/commands/realm/watch/start.js';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.js';

// The watcher reconciles `.claude/skills/` too: once when it starts (so a realm
// already on disk exposes its skills right away) and after any flush that
// touched `skills/`. Only the startup pass is exercised here — a flush needs
// realm downloads, which tests/integration/realm-watch.test.ts covers.

const ROOT = 'https://realms.example.test/alice/experiments/';

function makeFakeAuthenticator(): RealmAuthenticator {
  return {
    async authedRealmFetch(input: string | URL) {
      if (String(input) === `${ROOT}_mtimes`) {
        return new Response(
          JSON.stringify({ data: { attributes: { mtimes: {} } } }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    },
  } as RealmAuthenticator;
}

let localDir: string;

function writeSkill(name: string): void {
  const skillDir = path.join(localDir, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Use when testing.\n---\n\nDo the thing.\n`,
  );
}

beforeEach(() => {
  localDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-watch-skills-')),
  );
});

afterEach(() => {
  fs.rmSync(localDir, { recursive: true, force: true });
});

describe('realm watch → .claude/skills', () => {
  it('mirrors the skills already on disk when the watcher starts', async () => {
    writeSkill('trip-planner');

    const watcher = new RealmWatcher(
      { realmUrl: ROOT, localDir },
      makeFakeAuthenticator(),
      { debounceMs: 0 },
    );
    await watcher.initialize();
    watcher.shutdown();

    const entry = path.join(
      localDir,
      '.claude',
      'skills',
      'experiments-trip-planner',
    );
    expect(fs.lstatSync(entry).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(entry, 'SKILL.md'), 'utf8')).toContain(
      'Do the thing.',
    );
  });

  it('writes nothing when claudeSkills is off', async () => {
    writeSkill('trip-planner');

    const watcher = new RealmWatcher(
      { realmUrl: ROOT, localDir },
      makeFakeAuthenticator(),
      { debounceMs: 0, claudeSkills: false },
    );
    await watcher.initialize();
    watcher.shutdown();

    expect(fs.existsSync(path.join(localDir, '.claude'))).toBe(false);
  });
});
