import { describe, it, expect } from 'vitest';
import {
  classifyBumpFromTitle,
  computeRelease,
  detectSurfaces,
  parseSemver,
  unstableCounters,
  type ComputeReleaseInput,
} from '../../scripts/compute-release';

function baseInput(
  overrides: Partial<ComputeReleaseInput> = {},
): ComputeReleaseInput {
  return {
    prTitle: 'fix: something',
    prBody: '',
    changedFiles: ['packages/boxel-cli/src/index.ts'],
    currentNpm: '0.1.5-unstable.0',
    currentPlugin: '0.1.4',
    prereleaseN: 1,
    lastStableNpmBase: '0.1.4',
    ...overrides,
  };
}

describe('classifyBumpFromTitle', () => {
  it('returns minor for feat:', () => {
    expect(classifyBumpFromTitle('feat: add export command', '')).toBe('minor');
  });

  it('returns patch for fix:', () => {
    expect(classifyBumpFromTitle('fix: handle empty config', '')).toBe('patch');
  });

  it('returns patch for perf: and refactor:', () => {
    expect(classifyBumpFromTitle('perf: speed up sync', '')).toBe('patch');
    expect(classifyBumpFromTitle('refactor: extract helper', '')).toBe('patch');
  });

  it('returns none for chore: / docs: / test: / build: / ci: / style:', () => {
    for (const prefix of ['chore', 'docs', 'test', 'build', 'ci', 'style']) {
      expect(classifyBumpFromTitle(`${prefix}: tidy`, '')).toBe('none');
    }
  });

  it('returns major when title ends with !:', () => {
    expect(classifyBumpFromTitle('feat!: rename command', '')).toBe('major');
    expect(classifyBumpFromTitle('fix!: change error shape', '')).toBe('major');
  });

  it('handles scoped prefixes like fix(skills):', () => {
    expect(classifyBumpFromTitle('fix(skills): bump version', '')).toBe(
      'patch',
    );
    expect(classifyBumpFromTitle('feat(cli): new flag', '')).toBe('minor');
    expect(classifyBumpFromTitle('feat(cli)!: breaking flag', '')).toBe(
      'major',
    );
  });

  it('returns major when body has BREAKING CHANGE: footer even if prefix is patch', () => {
    expect(
      classifyBumpFromTitle('fix: rename', 'BREAKING CHANGE: removed old API'),
    ).toBe('major');
  });

  it('returns none for non-conventional titles', () => {
    expect(classifyBumpFromTitle('update stuff', '')).toBe('none');
    expect(classifyBumpFromTitle('CS-11112: do thing', '')).toBe('none');
  });
});

describe('detectSurfaces', () => {
  it('npm-only when src/ changed', () => {
    const s = detectSurfaces(['packages/boxel-cli/src/profile.ts']);
    expect(s).toEqual({ npmTouched: true, pluginTouched: false });
  });

  it('npm-only when api.ts changed', () => {
    const s = detectSurfaces(['packages/boxel-cli/api.ts']);
    expect(s).toEqual({ npmTouched: true, pluginTouched: false });
  });

  it('npm-only when scripts/build.ts changed', () => {
    const s = detectSurfaces(['packages/boxel-cli/scripts/build.ts']);
    expect(s).toEqual({ npmTouched: true, pluginTouched: false });
  });

  it('plugin-only when plugin/ changed (e.g. README)', () => {
    const s = detectSurfaces(['packages/boxel-cli/plugin/README.md']);
    expect(s).toEqual({ npmTouched: false, pluginTouched: true });
  });

  it('plugin-only when plugin/skills/ regenerated', () => {
    const s = detectSurfaces([
      'packages/boxel-cli/plugin/skills/realm-sync/SKILL.md',
    ]);
    expect(s).toEqual({ npmTouched: false, pluginTouched: true });
  });

  it('plugin-only when scripts/build-plugin.ts or build-skills.ts changed', () => {
    expect(
      detectSurfaces(['packages/boxel-cli/scripts/build-plugin.ts']),
    ).toEqual({ npmTouched: false, pluginTouched: true });
    expect(
      detectSurfaces(['packages/boxel-cli/scripts/build-skills.ts']),
    ).toEqual({ npmTouched: false, pluginTouched: true });
  });

  it('both surfaces when a new command lands (src/ + regen)', () => {
    const s = detectSurfaces([
      'packages/boxel-cli/src/commands/export.ts',
      'packages/boxel-cli/plugin/skills/realm-sync/SKILL.md',
    ]);
    expect(s).toEqual({ npmTouched: true, pluginTouched: true });
  });

  it('npm touched when package.json changed', () => {
    const s = detectSurfaces(['packages/boxel-cli/package.json']);
    expect(s.npmTouched).toBe(true);
  });

  it('neither touched when only docs at repo root changed', () => {
    const s = detectSurfaces(['docs/cs-11112-plan.md', 'README.md']);
    expect(s).toEqual({ npmTouched: false, pluginTouched: false });
  });
});

describe('parseSemver', () => {
  it('parses stable versions', () => {
    expect(parseSemver('0.1.4')).toEqual({
      major: 0,
      minor: 1,
      patch: 4,
      prerelease: null,
    });
  });

  it('parses unstable prereleases', () => {
    expect(parseSemver('0.2.0-unstable.5')).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      prerelease: 'unstable.5',
    });
  });

  it('throws on invalid input', () => {
    expect(() => parseSemver('not-a-version')).toThrow();
  });
});

describe('unstableCounters', () => {
  it('returns max-candidate counters for the matching base', () => {
    const versions = [
      '0.3.2-unstable.0',
      '0.3.2-unstable.1',
      '0.3.2-unstable.5',
    ];
    expect(unstableCounters('0.3.2', versions)).toEqual([0, 1, 5]);
  });

  it('ignores other bases (and treats a different base as non-matching)', () => {
    const versions = [
      '0.3.1-unstable.9',
      '0.3.20-unstable.4', // must NOT match base 0.3.2
      '0.4.0-unstable.3',
      '0.3.2-unstable.2',
    ];
    expect(unstableCounters('0.3.2', versions)).toEqual([2]);
  });

  it('is empty when nothing matches or the list is empty', () => {
    expect(unstableCounters('0.3.2', ['0.3.1', '0.3.2'])).toEqual([]);
    expect(unstableCounters('0.3.2', [])).toEqual([]);
  });

  it('tolerates non-string npm output shapes without throwing', () => {
    // `npm view ... versions --json` is normally string | string[], but guard
    // against null / unexpected entries rather than crashing the publish run.
    const versions = [null, 42, { v: 'x' }, '0.3.2-unstable.7'];
    expect(unstableCounters('0.3.2', versions)).toEqual([7]);
  });
});

describe('computeRelease', () => {
  it('skips both surfaces when prefix is chore: even if surfaces touched', () => {
    const r = computeRelease(
      baseInput({
        prTitle: 'chore: bump deps',
        changedFiles: ['packages/boxel-cli/src/index.ts'],
      }),
    );
    expect(r.npmBump).toBe('none');
    expect(r.pluginBump).toBe('none');
    expect(r.nextNpm).toBeNull();
    expect(r.nextPlugin).toBeNull();
  });

  it('emits no bump when no surfaces touched even if prefix is feat:', () => {
    const r = computeRelease(
      baseInput({
        prTitle: 'feat: add nothing here',
        changedFiles: ['unrelated/file.md'],
      }),
    );
    expect(r.npmBump).toBe('none');
    expect(r.pluginBump).toBe('none');
  });

  it('first unstable on top of stable: fix: on src/ from 0.1.4 → 0.1.5-unstable.<n>', () => {
    const r = computeRelease(
      baseInput({
        prTitle: 'fix: handle empty config',
        changedFiles: ['packages/boxel-cli/src/profile.ts'],
        currentNpm: '0.1.4',
        currentPlugin: '0.1.4',
        prereleaseN: 1,
        lastStableNpmBase: '0.1.4',
      }),
    );
    expect(r.npmBump).toBe('patch');
    expect(r.nextNpm).toBe('0.1.5-unstable.1');
    expect(r.nextPlugin).toBeNull();
  });

  it('first unstable: feat: on src/ + regen from 0.1.4 → 0.2.0-unstable.<n>; plugin → 0.2.0', () => {
    const r = computeRelease(
      baseInput({
        prTitle: 'feat: add export command',
        changedFiles: [
          'packages/boxel-cli/src/commands/export.ts',
          'packages/boxel-cli/plugin/skills/realm-sync/SKILL.md',
        ],
        currentNpm: '0.1.4',
        currentPlugin: '0.1.4',
        prereleaseN: 1,
        lastStableNpmBase: '0.1.4',
      }),
    );
    expect(r.npmBump).toBe('minor');
    expect(r.nextNpm).toBe('0.2.0-unstable.1');
    expect(r.pluginBump).toBe('minor');
    expect(r.nextPlugin).toBe('0.2.0');
  });

  it('stays on minor base when current is already 0.2.0-unstable.X and incoming is patch', () => {
    const r = computeRelease(
      baseInput({
        prTitle: 'fix: small bug',
        changedFiles: ['packages/boxel-cli/src/foo.ts'],
        currentNpm: '0.2.0-unstable.3',
        currentPlugin: '0.2.0',
        prereleaseN: 4,
        lastStableNpmBase: '0.1.4',
      }),
    );
    // implied bump from 0.1.4 → 0.2.0 is minor; incoming patch < minor → stay.
    expect(r.nextNpm).toBe('0.2.0-unstable.4');
  });

  it('escalates base when current is 0.1.5-unstable.X (patch implied) and incoming is minor', () => {
    const r = computeRelease(
      baseInput({
        prTitle: 'feat: new thing',
        changedFiles: ['packages/boxel-cli/src/feature.ts'],
        currentNpm: '0.1.5-unstable.3',
        currentPlugin: '0.1.5',
        prereleaseN: 4,
        lastStableNpmBase: '0.1.4',
      }),
    );
    // implied patch (0.1.4 → 0.1.5) vs incoming minor → minor wins, base 0.2.0.
    expect(r.nextNpm).toBe('0.2.0-unstable.4');
  });

  it('escalates to major when breaking change lands on a minor prerelease base', () => {
    const r = computeRelease(
      baseInput({
        prTitle: 'feat!: rename profile command',
        changedFiles: ['packages/boxel-cli/src/profile.ts'],
        currentNpm: '0.2.0-unstable.3',
        currentPlugin: '0.2.0',
        prereleaseN: 4,
        lastStableNpmBase: '0.1.4',
      }),
    );
    expect(r.npmBump).toBe('major');
    expect(r.nextNpm).toBe('1.0.0-unstable.4');
  });

  it('plugin bumps cleanly without prerelease suffix', () => {
    const r = computeRelease(
      baseInput({
        prTitle: 'fix: clarify plugin readme',
        changedFiles: ['packages/boxel-cli/plugin/README.md'],
        currentNpm: '0.1.4',
        currentPlugin: '0.1.4',
        prereleaseN: 1,
        lastStableNpmBase: '0.1.4',
      }),
    );
    expect(r.npmBump).toBe('none');
    expect(r.pluginBump).toBe('patch');
    expect(r.nextPlugin).toBe('0.1.5');
    expect(r.nextNpm).toBeNull();
  });

  it('preserves prereleaseN passthrough on the output', () => {
    const r = computeRelease(baseInput({ prereleaseN: 42 }));
    expect(r.prereleaseN).toBe(42);
  });
});
