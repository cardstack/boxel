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

/**
 * A workspace root with the realm checkout several levels below it, as
 * `boxel realm pull` lays realms out. The root carries its own `.claude/` to
 * pin down that the mirror goes into the realm's directory regardless.
 */
function makeWorkspace(): { workspace: string; checkout: string } {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-skills-mirror-')),
  );
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  const dir = path.join(root, 'realms', 'app.boxel.ai', 'alice', 'experiments');
  fs.mkdirSync(dir, { recursive: true });
  return { workspace: root, checkout: dir };
}

function skillBody(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Use when testing.\nboxel:\n  kind: skill\n---\n\n${body}\n`;
}

function writeSkill(dir: string, name: string, body = 'Do the thing.'): void {
  const skillDir = path.join(dir, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillBody(name, body));
}

function mirrorPath(root: string, ...rest: string[]): string {
  return path.join(root, '.claude', 'skills', ...rest);
}

function mirror(realmUrl = REALM_URL, localDir = checkout) {
  return mirrorRealmSkills({ realmUrl, localDir });
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
  it('is the realm directory itself', () => {
    expect(resolveMirrorRoot(checkout)).toBe(checkout);
  });

  it('does not adopt an ancestor .claude directory', () => {
    // `workspace` has a `.claude/`; the mirror still belongs to the realm.
    expect(resolveMirrorRoot(checkout)).not.toBe(workspace);
  });

  it('refuses the home directory', () => {
    // `~/.claude/skills` is Claude Code's personal scope, shared by every
    // unrelated project.
    expect(resolveMirrorRoot(os.homedir())).toBeNull();
  });
});

describe('mirrorRealmSkills', () => {
  it('copies each realm skill into .claude/skills/<realm>-<name>', async () => {
    writeSkill(checkout, 'trip-planner');
    writeSkill(checkout, 'invoice-review');
    fs.mkdirSync(path.join(checkout, 'skills', 'trip-planner', 'references'));
    fs.writeFileSync(
      path.join(checkout, 'skills', 'trip-planner', 'references', 'list.md'),
      '- passports\n',
    );

    const result = await mirror();

    expect(result?.root).toBe(checkout);
    expect(result?.created).toEqual([
      'experiments-invoice-review',
      'experiments-trip-planner',
    ]);

    const entry = mirrorPath(checkout, 'experiments-trip-planner');
    expect(fs.lstatSync(entry).isDirectory()).toBe(true);
    // The realm's file is copied byte-for-byte, `boxel:` frontmatter and all.
    expect(fs.readFileSync(path.join(entry, 'SKILL.md'), 'utf8')).toBe(
      skillBody('trip-planner', 'Do the thing.'),
    );
    expect(
      fs.readFileSync(path.join(entry, 'references', 'list.md'), 'utf8'),
    ).toBe('- passports\n');
  });

  it('reports no work when nothing changed', async () => {
    writeSkill(checkout, 'trip-planner');
    await mirror();
    const second = await mirror();

    expect(second?.created).toEqual([]);
    expect(second?.updated).toEqual([]);
    expect(second?.unchanged).toEqual(['experiments-trip-planner']);
    expect(second?.skipped).toEqual([]);
    expect(fs.readdirSync(mirrorPath(checkout)).sort()).toEqual([
      '.boxel-skills-sync.json',
      'experiments-trip-planner',
    ]);
  });

  it("refreshes the copy when the realm's skill changes", async () => {
    writeSkill(checkout, 'trip-planner');
    await mirror();

    writeSkill(checkout, 'trip-planner', 'Ask for dates first.');
    const result = await mirror();

    expect(result?.updated).toEqual(['experiments-trip-planner']);
    expect(
      fs.readFileSync(
        mirrorPath(checkout, 'experiments-trip-planner', 'SKILL.md'),
        'utf8',
      ),
    ).toBe(skillBody('trip-planner', 'Ask for dates first.'));
  });

  it('drops a file the realm removed from a skill', async () => {
    writeSkill(checkout, 'trip-planner');
    const retired = path.join(
      checkout,
      'skills',
      'trip-planner',
      'references',
      'retired.md',
    );
    fs.mkdirSync(path.dirname(retired), { recursive: true });
    fs.writeFileSync(retired, 'old\n');
    await mirror();
    expect(
      fs.existsSync(
        mirrorPath(
          checkout,
          'experiments-trip-planner',
          'references',
          'retired.md',
        ),
      ),
    ).toBe(true);

    fs.rmSync(retired);
    await mirror();

    expect(
      fs.existsSync(
        mirrorPath(
          checkout,
          'experiments-trip-planner',
          'references',
          'retired.md',
        ),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        mirrorPath(checkout, 'experiments-trip-planner', 'SKILL.md'),
      ),
    ).toBe(true);
  });

  it('will not overwrite a copy that was edited in place', async () => {
    writeSkill(checkout, 'trip-planner');
    await mirror();

    const mirrored = mirrorPath(
      checkout,
      'experiments-trip-planner',
      'SKILL.md',
    );
    fs.writeFileSync(mirrored, skillBody('trip-planner', 'Edited by hand.'));
    // The realm moved on too, so a blind refresh would discard the local edit.
    writeSkill(checkout, 'trip-planner', 'Changed in the realm.');

    const result = await mirror();

    expect(result?.updated).toEqual([]);
    expect(result?.skipped).toEqual([
      {
        name: 'experiments-trip-planner',
        reason:
          'edited in place — move the change to skills/trip-planner/ in the realm checkout',
      },
    ]);
    expect(fs.readFileSync(mirrored, 'utf8')).toBe(
      skillBody('trip-planner', 'Edited by hand.'),
    );
  });

  it('sweeps an entry whose realm-side skill is gone', async () => {
    writeSkill(checkout, 'trip-planner');
    writeSkill(checkout, 'retired');
    await mirror();

    fs.rmSync(path.join(checkout, 'skills', 'retired'), { recursive: true });
    const result = await mirror();

    expect(result?.removed).toEqual(['experiments-retired']);
    expect(fs.existsSync(mirrorPath(checkout, 'experiments-retired'))).toBe(
      false,
    );
    expect(
      fs.existsSync(mirrorPath(checkout, 'experiments-trip-planner')),
    ).toBe(true);
  });

  it('follows a realm-side rename', async () => {
    writeSkill(checkout, 'trip-planner');
    await mirror();

    const skillsDir = path.join(checkout, 'skills');
    fs.renameSync(
      path.join(skillsDir, 'trip-planner'),
      path.join(skillsDir, 'trip-planner-v2'),
    );
    await mirror();

    expect(
      fs.existsSync(mirrorPath(checkout, 'experiments-trip-planner')),
    ).toBe(false);
    expect(
      fs.existsSync(mirrorPath(checkout, 'experiments-trip-planner-v2')),
    ).toBe(true);
    // The sweep removed the copy, never the realm's own file.
    expect(
      fs.existsSync(path.join(skillsDir, 'trip-planner-v2', 'SKILL.md')),
    ).toBe(true);
  });

  it('keeps an edited copy the realm no longer has', async () => {
    writeSkill(checkout, 'retired');
    await mirror();

    const mirrored = mirrorPath(checkout, 'experiments-retired', 'SKILL.md');
    fs.writeFileSync(mirrored, skillBody('retired', 'Edited by hand.'));
    fs.rmSync(path.join(checkout, 'skills', 'retired'), { recursive: true });

    const result = await mirror();

    expect(result?.removed).toEqual([]);
    expect(result?.skipped).toEqual([
      {
        name: 'experiments-retired',
        reason:
          'edited in place and no longer in the realm — delete it once the change is saved elsewhere',
      },
    ]);
    expect(fs.readFileSync(mirrored, 'utf8')).toBe(
      skillBody('retired', 'Edited by hand.'),
    );
  });

  it('does not offer to sweep an edited copy under dryRun', async () => {
    writeSkill(checkout, 'retired');
    await mirror();

    const mirrored = mirrorPath(checkout, 'experiments-retired', 'SKILL.md');
    fs.writeFileSync(mirrored, skillBody('retired', 'Edited by hand.'));
    fs.rmSync(path.join(checkout, 'skills', 'retired'), { recursive: true });

    const result = await mirrorRealmSkills({
      realmUrl: REALM_URL,
      localDir: checkout,
      dryRun: true,
    });

    // A preview has to name what a real run would do, and a real run keeps
    // this copy.
    expect(result?.removed).toEqual([]);
    expect(result?.skipped).toEqual([
      {
        name: 'experiments-retired',
        reason:
          'edited in place and no longer in the realm — delete it once the change is saved elsewhere',
      },
    ]);
    expect(fs.existsSync(mirrored)).toBe(true);
  });

  it('leaves a hand-authored .claude/skills entry alone', async () => {
    writeSkill(checkout, 'trip-planner');
    const occupied = mirrorPath(checkout, 'experiments-trip-planner');
    fs.mkdirSync(occupied, { recursive: true });
    fs.writeFileSync(path.join(occupied, 'SKILL.md'), 'hand-authored\n');

    const result = await mirror();

    expect(result?.created).toEqual([]);
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

  // Two realms share a mirror only when both are pulled into the same local
  // directory — one realm pulled over another's checkout.
  it('does not take over an entry another realm owns', async () => {
    writeSkill(checkout, 'trip-planner');
    await mirror();

    // A second realm whose slug collides (both end in `experiments`).
    const result = await mirror(
      'https://app.boxel.ai/bob/experiments/',
      checkout,
    );

    expect(result?.created).toEqual([]);
    expect(result?.skipped).toEqual([
      {
        name: 'experiments-trip-planner',
        reason: `already mirrored from ${REALM_URL}`,
      },
    ]);
    expect(
      fs.readFileSync(
        mirrorPath(checkout, 'experiments-trip-planner', 'SKILL.md'),
        'utf8',
      ),
    ).toBe(skillBody('trip-planner', 'Do the thing.'));
  });

  it('tracks realms independently in the manifest', async () => {
    writeSkill(checkout, 'trip-planner');
    await mirror();
    await mirror(OTHER_REALM_URL, checkout);

    const manifest = await loadMirrorManifest(mirrorPath(checkout));
    expect(Object.keys(manifest.realms).sort()).toEqual([
      REALM_URL,
      OTHER_REALM_URL,
    ]);
    expect(
      Object.keys(
        manifest.realms[OTHER_REALM_URL].entries['notes-trip-planner'].files,
      ),
    ).toEqual(['SKILL.md']);

    // Mirroring one realm again must not sweep the other realm's entries.
    await mirror();
    expect(fs.existsSync(mirrorPath(checkout, 'notes-trip-planner'))).toBe(
      true,
    );
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

    const result = await mirror();

    expect(result?.created).toEqual(['experiments-trip-planner']);
  });

  it('does nothing when the realm has no skills', async () => {
    const result = await mirror();

    expect(result).toBeNull();
    expect(fs.existsSync(path.join(checkout, '.claude'))).toBe(false);
  });

  it('reports without writing under dryRun', async () => {
    writeSkill(checkout, 'trip-planner');

    const result = await mirrorRealmSkills({
      realmUrl: REALM_URL,
      localDir: checkout,
      dryRun: true,
    });

    expect(result?.created).toEqual(['experiments-trip-planner']);
    expect(fs.existsSync(path.join(checkout, '.claude'))).toBe(false);
  });
});

describe('mirrorDirName', () => {
  it('joins the realm slug and the skill name', () => {
    expect(mirrorDirName('experiments', 'trip-planner')).toBe(
      'experiments-trip-planner',
    );
  });
});
