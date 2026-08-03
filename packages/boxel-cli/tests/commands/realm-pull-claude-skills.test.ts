import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pull } from '../../src/commands/realm/pull.js';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.js';

// A realm's `skills/<name>/SKILL.md` files are the workspace's user-authored
// skills. Pulling the realm exposes them to Claude Code by mirroring them into
// the surrounding checkout's `.claude/skills/<realm>-<name>/`. The realm is a
// fake authenticator here — these cases are about what `pull` writes into
// `.claude/`, not about the realm-server wire format (covered by
// tests/integration/realm-pull*.test.ts).

const ROOT = 'https://realms.example.test/alice/experiments/';

const SKILL_MD = `---
name: trip-planner
description: Plans multi-stop trips. Use when the user asks for an itinerary.
boxel:
  kind: skill
---

Ask for dates and budget first.
`;

const BASE_FILES: Record<string, string> = {
  'hello.gts': 'export const hello = "world";\n',
  'skills/trip-planner/SKILL.md': SKILL_MD,
  'skills/trip-planner/references/checklist.md': '- passports\n',
  // A loose file under skills/ is shared reference material, not a skill.
  'skills/glossary.md': '# Glossary\n',
};

/**
 * Serves `files` as a realm: `_mtimes`, per-directory listings in the
 * `relationships` shape `getRemoteFileList` reads, and file bodies.
 */
function makeFakeAuthenticator(
  files: Record<string, string>,
): RealmAuthenticator {
  const mtimes = Object.fromEntries(
    Object.keys(files).map((p, i) => [`${ROOT}${p}`, 1000 + i]),
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
      if (!url.startsWith(ROOT))
        return new Response('not found', { status: 404 });
      const rel = url.slice(ROOT.length);

      if (rel === '' || rel.endsWith('/')) {
        const relationships: Record<string, { meta: { kind: string } }> = {};
        for (const filePath of Object.keys(files)) {
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

      if (files[rel] !== undefined) {
        return new Response(files[rel], { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  } as RealmAuthenticator;
}

let localDir: string;

function mirrorDir(): string {
  return path.join(localDir, '.claude', 'skills');
}

async function runPull(
  files: Record<string, string> = BASE_FILES,
  options: { claudeSkills?: boolean } = {},
): Promise<void> {
  const result = await pull(ROOT, localDir, {
    authenticator: makeFakeAuthenticator(files),
    ...options,
  });
  expect(result.error).toBeUndefined();
}

beforeEach(() => {
  localDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-pull-skills-')),
  );
});

afterEach(() => {
  fs.rmSync(localDir, { recursive: true, force: true });
  delete process.env.BOXEL_NO_CLAUDE_SKILLS;
});

describe('realm pull → .claude/skills', () => {
  it('mirrors each realm skill, prefixed by the realm segment', async () => {
    await runPull();

    const entry = path.join(mirrorDir(), 'experiments-trip-planner');
    expect(fs.lstatSync(entry).isDirectory()).toBe(true);
    // The skill and its references are copied byte-for-byte, `boxel:`
    // frontmatter and all.
    expect(fs.readFileSync(path.join(entry, 'SKILL.md'), 'utf8')).toBe(
      SKILL_MD,
    );
    expect(
      fs.readFileSync(path.join(entry, 'references', 'checklist.md'), 'utf8'),
    ).toBe('- passports\n');

    expect(fs.readdirSync(mirrorDir()).sort()).toEqual([
      '.boxel-skills-sync.json',
      'experiments-trip-planner',
    ]);
  });

  it('is idempotent across pulls', async () => {
    await runPull();
    await runPull();

    expect(fs.readdirSync(mirrorDir()).sort()).toEqual([
      '.boxel-skills-sync.json',
      'experiments-trip-planner',
    ]);
  });

  it('sweeps a skill that was removed from the realm', async () => {
    await runPull();
    expect(
      fs.existsSync(path.join(mirrorDir(), 'experiments-trip-planner')),
    ).toBe(true);

    // The realm no longer has the skill. Its local copy stays (pull without
    // --delete keeps local files), but the mirror entry goes.
    const withoutSkill = { ...BASE_FILES };
    delete withoutSkill['skills/trip-planner/SKILL.md'];
    delete withoutSkill['skills/trip-planner/references/checklist.md'];
    fs.rmSync(path.join(localDir, 'skills', 'trip-planner'), {
      recursive: true,
    });
    await runPull(withoutSkill);

    expect(
      fs.existsSync(path.join(mirrorDir(), 'experiments-trip-planner')),
    ).toBe(false);
  });

  it('writes no mirror for a realm with no skills', async () => {
    await runPull({ 'hello.gts': BASE_FILES['hello.gts'] });

    expect(fs.existsSync(path.join(localDir, '.claude'))).toBe(false);
  });

  it('skips the mirror when claudeSkills is false', async () => {
    await runPull(BASE_FILES, { claudeSkills: false });

    expect(fs.existsSync(path.join(localDir, 'skills', 'trip-planner'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(localDir, '.claude'))).toBe(false);
  });

  it('skips the mirror when BOXEL_NO_CLAUDE_SKILLS is set', async () => {
    process.env.BOXEL_NO_CLAUDE_SKILLS = '1';
    await runPull();

    expect(fs.existsSync(path.join(localDir, '.claude'))).toBe(false);
  });
});
