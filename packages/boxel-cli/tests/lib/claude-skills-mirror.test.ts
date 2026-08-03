import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadMirrorManifest,
  mirrorDirName,
  mirrorRealmSkills,
  realmSlugFromUrl,
  resolveMirrorRoot,
} from '../../src/lib/claude-skills-mirror.js';

const REALM_URL = 'https://app.boxel.ai/alice/experiments/';
const OTHER_REALM_URL = 'https://app.boxel.ai/bob/notes/';

let workspace: string;
let checkout: string;

/** Workspace root holding a `.claude/` dir, with the realm checkout below it. */
function makeWorkspace(): { workspace: string; checkout: string } {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-skills-mirror-')),
  );
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  const dir = path.join(root, 'realms', 'app.boxel.ai', 'alice', 'experiments');
  fs.mkdirSync(dir, { recursive: true });
  return { workspace: root, checkout: dir };
}

function writeSkill(dir: string, name: string, body = 'Do the thing.'): void {
  const skillDir = path.join(dir, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Use when testing.\nboxel:\n  kind: skill\n---\n\n${body}\n`,
  );
}

function mirrorPath(root: string, ...rest: string[]): string {
  return path.join(root, '.claude', 'skills', ...rest);
}

beforeEach(() => {
  const made = makeWorkspace();
  workspace = made.workspace;
  checkout = made.checkout;
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('realmSlugFromUrl', () => {
  it('takes the realm segment of an owner-scoped URL', () => {
    expect(realmSlugFromUrl('https://app.boxel.ai/alice/experiments/')).toBe(
      'experiments',
    );
  });

  it('takes the only segment of a server-scoped realm URL', () => {
    expect(realmSlugFromUrl('https://app.boxel.ai/skills/')).toBe('skills');
  });

  it('reduces a segment to a safe path component', () => {
    expect(realmSlugFromUrl('https://app.boxel.ai/a/My%20Realm!/')).toBe(
      'my-realm',
    );
  });

  it('returns null when there is no usable segment', () => {
    expect(realmSlugFromUrl('https://app.boxel.ai/')).toBeNull();
    expect(realmSlugFromUrl('not a url')).toBeNull();
  });
});

describe('resolveMirrorRoot', () => {
  it('prefers an ancestor that already has a .claude directory', async () => {
    await expect(resolveMirrorRoot(checkout)).resolves.toBe(workspace);
  });

  it('falls back to the enclosing git checkout', async () => {
    fs.rmSync(path.join(workspace, '.claude'), { recursive: true });
    const gitRoot = path.join(workspace, 'realms');
    fs.mkdirSync(path.join(gitRoot, '.git'), { recursive: true });
    await expect(resolveMirrorRoot(checkout)).resolves.toBe(gitRoot);
  });

  it('falls back to the realm directory itself', async () => {
    fs.rmSync(path.join(workspace, '.claude'), { recursive: true });
    await expect(resolveMirrorRoot(checkout)).resolves.toBe(checkout);
  });

  it('never walks up into the home directory', async () => {
    // A checkout directly under $HOME must not resolve to ~/.claude, which is
    // Claude Code's personal scope shared by every unrelated project.
    const home = fs.realpathSync(os.homedir());
    const dir = fs.mkdtempSync(path.join(home, '.boxel-mirror-root-test-'));
    try {
      await expect(resolveMirrorRoot(dir)).resolves.toBe(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mirrorRealmSkills', () => {
  it('symlinks each realm skill into .claude/skills/<realm>-<name>', async () => {
    writeSkill(checkout, 'trip-planner');
    writeSkill(checkout, 'invoice-review');

    const result = await mirrorRealmSkills({
      realmUrl: REALM_URL,
      localDir: checkout,
    });

    expect(result?.root).toBe(workspace);
    expect(result?.linked).toEqual([
      'experiments-invoice-review',
      'experiments-trip-planner',
    ]);
    expect(result?.copied).toEqual([]);

    const link = mirrorPath(workspace, 'experiments-trip-planner');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(link)).toBe(
      path.join(checkout, 'skills', 'trip-planner'),
    );
    // Claude Code reads SKILL.md through the link; the realm's file is served
    // byte-for-byte, `boxel:` frontmatter and all.
    expect(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8')).toBe(
      fs.readFileSync(
        path.join(checkout, 'skills', 'trip-planner', 'SKILL.md'),
        'utf8',
      ),
    );
  });

  it('links relative to the mirror so the tree can be relocated', async () => {
    writeSkill(checkout, 'trip-planner');
    await mirrorRealmSkills({ realmUrl: REALM_URL, localDir: checkout });

    const target = fs.readlinkSync(
      mirrorPath(workspace, 'experiments-trip-planner'),
    );
    expect(path.isAbsolute(target)).toBe(false);

    const moved = `${workspace}-moved`;
    fs.renameSync(workspace, moved);
    try {
      expect(
        fs.existsSync(
          path.join(mirrorPath(moved, 'experiments-trip-planner'), 'SKILL.md'),
        ),
      ).toBe(true);
    } finally {
      fs.renameSync(moved, workspace);
    }
  });

  it('is idempotent across runs', async () => {
    writeSkill(checkout, 'trip-planner');
    await mirrorRealmSkills({ realmUrl: REALM_URL, localDir: checkout });
    const second = await mirrorRealmSkills({
      realmUrl: REALM_URL,
      localDir: checkout,
    });

    expect(second?.linked).toEqual(['experiments-trip-planner']);
    expect(second?.removed).toEqual([]);
    expect(second?.skipped).toEqual([]);
    expect(fs.readdirSync(mirrorPath(workspace)).sort()).toEqual([
      '.boxel-skills-sync.json',
      'experiments-trip-planner',
    ]);
  });

  it('sweeps an entry whose realm-side skill is gone', async () => {
    writeSkill(checkout, 'trip-planner');
    writeSkill(checkout, 'retired');
    await mirrorRealmSkills({ realmUrl: REALM_URL, localDir: checkout });

    fs.rmSync(path.join(checkout, 'skills', 'retired'), { recursive: true });
    const result = await mirrorRealmSkills({
      realmUrl: REALM_URL,
      localDir: checkout,
    });

    expect(result?.removed).toEqual(['experiments-retired']);
    expect(fs.existsSync(mirrorPath(workspace, 'experiments-retired'))).toBe(
      false,
    );
    expect(
      fs.existsSync(mirrorPath(workspace, 'experiments-trip-planner')),
    ).toBe(true);
  });

  it('unlinks a swept entry without deleting through it', async () => {
    writeSkill(checkout, 'trip-planner');
    await mirrorRealmSkills({ realmUrl: REALM_URL, localDir: checkout });

    // Realm-side skill still present, but renamed on the realm side would make
    // the old mirror entry stale. Simulate by mirroring a realm with no skills
    // after the manifest recorded one.
    const skillsDir = path.join(checkout, 'skills');
    fs.renameSync(
      path.join(skillsDir, 'trip-planner'),
      path.join(skillsDir, 'trip-planner-v2'),
    );
    await mirrorRealmSkills({ realmUrl: REALM_URL, localDir: checkout });

    // The realm's file survived the sweep of the symlink that pointed at it.
    expect(
      fs.existsSync(path.join(skillsDir, 'trip-planner-v2', 'SKILL.md')),
    ).toBe(true);
    expect(
      fs.existsSync(mirrorPath(workspace, 'experiments-trip-planner')),
    ).toBe(false);
    expect(
      fs.existsSync(mirrorPath(workspace, 'experiments-trip-planner-v2')),
    ).toBe(true);
  });

  it('leaves a hand-authored .claude/skills entry alone', async () => {
    writeSkill(checkout, 'trip-planner');
    const occupied = mirrorPath(workspace, 'experiments-trip-planner');
    fs.mkdirSync(occupied, { recursive: true });
    fs.writeFileSync(path.join(occupied, 'SKILL.md'), 'hand-authored\n');

    const result = await mirrorRealmSkills({
      realmUrl: REALM_URL,
      localDir: checkout,
    });

    expect(result?.linked).toEqual([]);
    expect(result?.skipped).toEqual([
      {
        name: 'experiments-trip-planner',
        reason:
          'a directory of that name already exists and was not written by boxel',
      },
    ]);
    expect(fs.readFileSync(path.join(occupied, 'SKILL.md'), 'utf8')).toBe(
      'hand-authored\n',
    );
  });

  it('does not take over an entry another realm owns', async () => {
    writeSkill(checkout, 'trip-planner');
    await mirrorRealmSkills({ realmUrl: REALM_URL, localDir: checkout });

    // A second realm whose slug collides (both end in `experiments`).
    const other = path.join(workspace, 'realms', 'other', 'experiments');
    fs.mkdirSync(other, { recursive: true });
    writeSkill(other, 'trip-planner', 'A different trip planner.');

    const result = await mirrorRealmSkills({
      realmUrl: 'https://app.boxel.ai/bob/experiments/',
      localDir: other,
    });

    expect(result?.linked).toEqual([]);
    expect(result?.skipped).toEqual([
      {
        name: 'experiments-trip-planner',
        reason: `already mirrored from ${REALM_URL}`,
      },
    ]);
    expect(
      fs.realpathSync(mirrorPath(workspace, 'experiments-trip-planner')),
    ).toBe(path.join(checkout, 'skills', 'trip-planner'));
  });

  it('tracks realms independently in the manifest', async () => {
    writeSkill(checkout, 'trip-planner');
    await mirrorRealmSkills({ realmUrl: REALM_URL, localDir: checkout });

    const other = path.join(
      workspace,
      'realms',
      'app.boxel.ai',
      'bob',
      'notes',
    );
    fs.mkdirSync(other, { recursive: true });
    writeSkill(other, 'summarize');
    await mirrorRealmSkills({ realmUrl: OTHER_REALM_URL, localDir: other });

    const manifest = await loadMirrorManifest(mirrorPath(workspace));
    expect(Object.keys(manifest.realms).sort()).toEqual([
      REALM_URL,
      OTHER_REALM_URL,
    ]);
    expect(manifest.realms[OTHER_REALM_URL].entries).toEqual({
      'notes-summarize': { skill: 'summarize', kind: 'symlink' },
    });
    // Relative so the manifest survives the workspace being mounted elsewhere.
    expect(manifest.realms[REALM_URL].localDir).toBe(
      'realms/app.boxel.ai/alice/experiments',
    );

    // Mirroring one realm again must not sweep the other realm's entries.
    await mirrorRealmSkills({ realmUrl: REALM_URL, localDir: checkout });
    expect(fs.existsSync(mirrorPath(workspace, 'notes-summarize'))).toBe(true);
  });

  it('ignores directories without a SKILL.md and loose reference files', async () => {
    writeSkill(checkout, 'trip-planner');
    fs.mkdirSync(path.join(checkout, 'skills', 'references'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(checkout, 'skills', 'references', 'notes.md'),
      'shared notes\n',
    );
    fs.writeFileSync(
      path.join(checkout, 'skills', 'glossary.md'),
      '# Glossary\n',
    );

    const result = await mirrorRealmSkills({
      realmUrl: REALM_URL,
      localDir: checkout,
    });

    expect(result?.linked).toEqual(['experiments-trip-planner']);
  });

  it('does nothing when the realm has no skills', async () => {
    const result = await mirrorRealmSkills({
      realmUrl: REALM_URL,
      localDir: checkout,
    });

    expect(result).toBeNull();
    expect(fs.readdirSync(path.join(workspace, '.claude'))).toEqual([]);
  });

  it('reports without writing under dryRun', async () => {
    writeSkill(checkout, 'trip-planner');

    const result = await mirrorRealmSkills({
      realmUrl: REALM_URL,
      localDir: checkout,
      dryRun: true,
    });

    expect(result?.linked).toEqual(['experiments-trip-planner']);
    expect(fs.readdirSync(path.join(workspace, '.claude'))).toEqual([]);
  });
});

describe('mirrorDirName', () => {
  it('joins the realm slug and the skill name', () => {
    expect(mirrorDirName('experiments', 'trip-planner')).toBe(
      'experiments-trip-planner',
    );
  });
});
