import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  reloadProfile,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// A realm's `skills/<name>/SKILL.md` files are the user-authored skills of the
// Boxel workspace. `boxel realm pull` exposes them to Claude Code by mirroring
// them into the surrounding checkout's `.claude/skills/<realm>-<name>/`, so a
// skill written in the workspace is available in the next agentic session
// without a second command. The pull goes through the binary; the mirror is
// inspected on disk.

const SKILL_BODY = `---
name: trip-planner
description: Plans multi-stop trips. Use when the user asks for an itinerary.
boxel:
  kind: skill
---

Ask for dates and budget first.
`;

let home: string;
let cleanupProfile: () => void;
let realmUrl: string;
let localDirs: string[] = [];

function makeLocalDir(): string {
  // realpath so macOS's /var → /private/var symlink doesn't make the expected
  // and actual link targets differ as strings.
  let dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-pull-skills-')),
  );
  localDirs.push(dir);
  return dir;
}

function mirrorDir(localDir: string): string {
  return path.join(localDir, '.claude', 'skills');
}

beforeAll(async () => {
  await startTestRealmServer({
    fileSystem: {
      'hello.gts': 'export const hello = "world";\n',
      'skills/trip-planner/SKILL.md': SKILL_BODY,
      'skills/trip-planner/references/checklist.md': '- passports\n',
      // A loose file under skills/ is shared reference material, not a skill.
      'skills/glossary.md': '# Glossary\n',
    },
  });

  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;

  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  for (let dir of localDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm pull → .claude/skills (integration)', () => {
  it("mirrors the realm's skills into the checkout's .claude/skills", async () => {
    let localDir = makeLocalDir();

    let res = await runBoxel(['realm', 'pull', realmUrl, localDir], { home });
    expect(res.ok, res.stderr).toBe(true);

    // The realm URL's last segment (`test`) prefixes the mirrored directory,
    // so two realms with same-named skills stay distinguishable.
    let entry = path.join(mirrorDir(localDir), 'test-trip-planner');
    expect(fs.lstatSync(entry).isDirectory()).toBe(true);

    // SKILL.md and its references are copied byte-for-byte.
    expect(fs.readFileSync(path.join(entry, 'SKILL.md'), 'utf8')).toBe(
      SKILL_BODY,
    );
    expect(
      fs.readFileSync(path.join(entry, 'references', 'checklist.md'), 'utf8'),
    ).toBe('- passports\n');

    expect(fs.readdirSync(mirrorDir(localDir)).sort()).toEqual([
      '.boxel-skills-sync.json',
      'test-trip-planner',
    ]);
  });

  it('leaves .claude alone under --no-claude-skills', async () => {
    let localDir = makeLocalDir();

    let res = await runBoxel(
      ['realm', 'pull', realmUrl, localDir, '--no-claude-skills'],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);

    expect(fs.existsSync(path.join(localDir, 'skills', 'trip-planner'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(localDir, '.claude'))).toBe(false);
  });

  it('does not push the mirror back to the realm', async () => {
    let localDir = makeLocalDir();

    let pull = await runBoxel(['realm', 'pull', realmUrl, localDir], { home });
    expect(pull.ok, pull.stderr).toBe(true);
    expect(fs.existsSync(path.join(localDir, '.claude'))).toBe(true);

    let push = await runBoxel(['realm', 'push', localDir, realmUrl], { home });
    expect(push.ok, push.stderr).toBe(true);
    expect(push.stdout).not.toContain('.claude');

    // The realm must not gain a `.claude` tree — the mirror is local harness
    // wiring, and pushing it would put the same skills back into the realm one
    // directory deeper on the next round trip.
    let listing = await reloadProfile(home).authedRealmFetch(realmUrl, {
      headers: { Accept: 'application/vnd.api+json' },
    });
    expect(listing.ok).toBe(true);
    let body = (await listing.json()) as {
      data?: { relationships?: Record<string, unknown> };
    };
    expect(Object.keys(body.data?.relationships ?? {})).not.toContain(
      '.claude',
    );
  });
});
