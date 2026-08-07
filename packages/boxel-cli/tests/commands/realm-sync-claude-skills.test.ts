import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sync } from '../../src/commands/realm/sync.js';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.js';

// `boxel realm sync` reconciles `.claude/skills/` like `pull` does. The case
// worth pinning down is a sync that transfers nothing: the mirror is derived
// from the checkout rather than from this run's transfers, so it still has work
// to do when local and remote already agree — which is exactly the state of an
// existing checkout the first time it is synced by a version that mirrors.

const ROOT = 'https://realms.example.test/alice/experiments/';

const SKILL_MD = `---
name: trip-planner
description: Plans multi-stop trips. Use when the user asks for an itinerary.
---

Ask for dates and budget first.
`;

const FILES: Record<string, string> = {
  'hello.gts': 'export const hello = "world";\n',
  'skills/trip-planner/SKILL.md': SKILL_MD,
};

/** Serves `FILES` as a realm: `_mtimes`, directory listings, and file bodies. */
function makeFakeAuthenticator(): RealmAuthenticator {
  const mtimes = Object.fromEntries(
    Object.keys(FILES).map((p, i) => [`${ROOT}${p}`, 1000 + i]),
  );
  return {
    async authedRealmFetch(input: string | URL) {
      const url = String(input);
      if (url === `${ROOT}_mtimes`) {
        return new Response(
          JSON.stringify({ data: { attributes: { mtimes } } }),
          { status: 200 },
        );
      }
      if (!url.startsWith(ROOT)) {
        return new Response('not found', { status: 404 });
      }
      const rel = url.slice(ROOT.length);

      if (rel === '' || rel.endsWith('/')) {
        const relationships: Record<string, { meta: { kind: string } }> = {};
        for (const filePath of Object.keys(FILES)) {
          if (!filePath.startsWith(rel)) continue;
          const remainder = filePath.slice(rel.length);
          const slash = remainder.indexOf('/');
          if (slash === -1) {
            relationships[remainder] = { meta: { kind: 'file' } };
          } else {
            relationships[remainder.slice(0, slash)] = {
              meta: { kind: 'directory' },
            };
          }
        }
        return new Response(JSON.stringify({ data: { relationships } }), {
          status: 200,
        });
      }

      if (FILES[rel] !== undefined) {
        return new Response(FILES[rel], { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  } as RealmAuthenticator;
}

let localDir: string;

function mirrorEntry(): string {
  return path.join(
    localDir,
    '.claude',
    'skills',
    'experiments-trip-planner',
    'SKILL.md',
  );
}

async function runSync(): Promise<void> {
  const result = await sync(localDir, ROOT, {
    authenticator: makeFakeAuthenticator(),
    preferNewest: true,
  });
  expect(result.error).toBeUndefined();
}

beforeEach(() => {
  localDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-sync-skills-')),
  );
});

afterEach(() => {
  fs.rmSync(localDir, { recursive: true, force: true });
});

describe('realm sync → .claude/skills', () => {
  it('mirrors the skills it pulled', async () => {
    await runSync();

    expect(fs.readFileSync(mirrorEntry(), 'utf8')).toBe(SKILL_MD);
  });

  it('mirrors on a sync that transfers nothing', async () => {
    await runSync();

    // Everything now agrees, so the next sync reports "Everything is up to
    // date" and returns before any transfer runs. The mirror still has to be
    // reconciled on that path.
    fs.rmSync(path.join(localDir, '.claude'), { recursive: true });
    await runSync();

    expect(fs.readFileSync(mirrorEntry(), 'utf8')).toBe(SKILL_MD);
  });
});
