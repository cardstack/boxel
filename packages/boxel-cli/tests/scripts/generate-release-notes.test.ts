import { describe, it, expect } from 'vitest';
import {
  buildFilteredNotes,
  composeChangelogFragment,
  composeReleaseBody,
  type Deps,
  type Inputs,
} from '../../scripts/generate-release-notes.ts';

function baseInputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    prevTag: 'boxel-cli-v0.1.5-unstable.6',
    newTag: 'boxel-cli-v0.1.5-unstable.7',
    nextNpm: '0.1.5-unstable.7',
    nextPlugin: '0.1.5',
    npmDistTag: 'unstable',
    repo: 'cardstack/boxel',
    maxBytes: 60000,
    releaseBodyFile: '/tmp/body.md',
    changelogFragmentFile: '/tmp/frag.md',
    ...overrides,
  };
}

const SAMPLE_AUTO_NOTES = `## What's Changed
* feat: add export by @alice in #123
* fix: handle empty config by @bob in #124

**Full Changelog**: https://github.com/cardstack/boxel/compare/boxel-cli-v0.1.5-unstable.6...boxel-cli-v0.1.5-unstable.7`;

describe('composeReleaseBody', () => {
  it('includes both npm and plugin sub-sections when both bumped', () => {
    const body = composeReleaseBody(baseInputs(), SAMPLE_AUTO_NOTES);
    expect(body).toContain(
      '## @cardstack/boxel-cli v0.1.5-unstable.7 (npm `unstable`)',
    );
    expect(body).toContain(
      'https://www.npmjs.com/package/@cardstack/boxel-cli/v/0.1.5-unstable.7',
    );
    expect(body).toContain('## boxel-cli plugin v0.1.5');
    expect(body).toContain('## Changes');
    expect(body).toContain('feat: add export');
  });

  it('omits the plugin section when plugin did not bump', () => {
    const body = composeReleaseBody(
      baseInputs({ nextPlugin: '' }),
      SAMPLE_AUTO_NOTES,
    );
    expect(body).toContain('## @cardstack/boxel-cli v0.1.5-unstable.7');
    expect(body).not.toContain('## boxel-cli plugin');
    expect(body).toContain('## Changes');
  });

  it('omits the npm section when only the plugin bumped', () => {
    const body = composeReleaseBody(
      baseInputs({ nextNpm: '', npmDistTag: '' }),
      SAMPLE_AUTO_NOTES,
    );
    expect(body).not.toContain('@cardstack/boxel-cli v');
    expect(body).toContain('## boxel-cli plugin v0.1.5');
  });

  it('shows the stable npm dist-tag label on stable releases', () => {
    const body = composeReleaseBody(
      baseInputs({ nextNpm: '0.1.5', npmDistTag: 'latest', nextPlugin: '' }),
      SAMPLE_AUTO_NOTES,
    );
    expect(body).toContain('## @cardstack/boxel-cli v0.1.5 (npm `latest`)');
  });

  it('emits a placeholder Changes section when auto-notes are empty', () => {
    const body = composeReleaseBody(baseInputs({ nextPlugin: '' }), '');
    expect(body).toContain('## Changes');
    expect(body).toContain('_No PR-derived notes available');
    expect(body).toContain('boxel-cli-v0.1.5-unstable.7');
  });

  it('truncates oversize bodies and appends a Full diff footer', () => {
    const big = 'x'.repeat(5000);
    const body = composeReleaseBody(
      baseInputs({ maxBytes: 1000, nextPlugin: '' }),
      big,
    );
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(1000);
    expect(body).toContain(
      'Full diff: https://github.com/cardstack/boxel/compare/boxel-cli-v0.1.5-unstable.6...boxel-cli-v0.1.5-unstable.7',
    );
  });

  it('leaves bodies under MAX_BYTES untouched', () => {
    const body = composeReleaseBody(
      baseInputs({ nextPlugin: '' }),
      SAMPLE_AUTO_NOTES,
    );
    expect(body).not.toContain('truncated. Full diff');
  });
});

describe('composeChangelogFragment', () => {
  it('prefixes the body with a dated header naming both surface versions', () => {
    const body = composeReleaseBody(baseInputs(), SAMPLE_AUTO_NOTES);
    const fragment = composeChangelogFragment(baseInputs(), body);
    expect(fragment).toMatch(
      /^## \d{4}-\d{2}-\d{2} — npm v0\.1\.5-unstable\.7 \/ plugin v0\.1\.5/,
    );
    expect(fragment).toContain(
      'Release: https://github.com/cardstack/boxel/releases/tag/boxel-cli-v0.1.5-unstable.7',
    );
    expect(fragment).toContain('## Changes');
  });

  it('names only the surfaces that bumped', () => {
    const inputs = baseInputs({ nextPlugin: '' });
    const fragment = composeChangelogFragment(
      inputs,
      composeReleaseBody(inputs, SAMPLE_AUTO_NOTES),
    );
    expect(fragment).toMatch(/— npm v0\.1\.5-unstable\.7$/m);
    expect(fragment).not.toContain('plugin v');
  });
});

function makeDeps(log: string, prByCommit: Record<string, string>): Deps {
  return {
    gitLogBoxelCli: () => log,
    ghPrForCommit: (_repo, sha) => prByCommit[sha] ?? '',
  };
}

const PR_4751 = JSON.stringify({
  number: 4751,
  title: 'boxel-cli: add `boxel realm milestone` command',
  html_url: 'https://github.com/cardstack/boxel/pull/4751',
  user: { login: 'FadhlanR' },
});

const PR_4785 = JSON.stringify({
  number: 4785,
  title:
    'fix(boxel-cli): release semaphore before recursing in getRemoteFileList',
  html_url: 'https://github.com/cardstack/boxel/pull/4785',
  user: { login: 'richardhjtan' },
});

describe('buildFilteredNotes', () => {
  it('formats one bullet per PR with author and URL, plus a Full Changelog footer', () => {
    const log = [
      'aaaaaaa1\tFadhlanR\tboxel-cli: add `boxel realm milestone` command',
      'bbbbbbb2\trichardhjtan\tfix(boxel-cli): release semaphore before recursing in getRemoteFileList',
    ].join('\n');
    const deps = makeDeps(log, {
      aaaaaaa1: PR_4751,
      bbbbbbb2: PR_4785,
    });
    const out = buildFilteredNotes(baseInputs(), deps);
    expect(out).toContain(
      '* boxel-cli: add `boxel realm milestone` command by @FadhlanR in https://github.com/cardstack/boxel/pull/4751',
    );
    expect(out).toContain(
      '* fix(boxel-cli): release semaphore before recursing in getRemoteFileList by @richardhjtan in https://github.com/cardstack/boxel/pull/4785',
    );
    expect(out).toMatch(
      /\n\n\*\*Full Changelog\*\*: https:\/\/github\.com\/cardstack\/boxel\/compare\/boxel-cli-v0\.1\.5-unstable\.6\.\.\.boxel-cli-v0\.1\.5-unstable\.7$/,
    );
  });

  it('filters out github-actions[bot] release commits', () => {
    const log = [
      'cccccc01\tFadhlanR\tfeat(boxel-cli): real change',
      'dddddd02\tgithub-actions[bot]\tchore(release): boxel-cli npm=0.2.0-unstable.295 [skip ci]',
    ].join('\n');
    const deps = makeDeps(log, {
      cccccc01: PR_4751,
      // dddddd02 has no entry — bot rows should never reach ghPrForCommit
      // but include a sentinel to prove the filter runs first.
      dddddd02: JSON.stringify({
        number: 9999,
        title: 'should not appear',
        html_url: 'x',
        user: { login: 'x' },
      }),
    });
    const out = buildFilteredNotes(baseInputs(), deps);
    expect(out).toContain('@FadhlanR');
    expect(out).not.toContain('chore(release)');
    expect(out).not.toContain('should not appear');
    expect(out).not.toContain('9999');
  });

  it('dedupes by PR number when the same PR shows up twice', () => {
    const log = [
      'eeeeee01\tFadhlanR\tfirst commit on PR 4751',
      'eeeeee02\tFadhlanR\tsecond commit on PR 4751',
    ].join('\n');
    const deps = makeDeps(log, {
      eeeeee01: PR_4751,
      eeeeee02: PR_4751,
    });
    const out = buildFilteredNotes(baseInputs(), deps);
    const occurrences = out.match(/pull\/4751/g)?.length ?? 0;
    expect(occurrences).toBe(1);
  });

  it('falls back to commit subject when a commit has no associated PR', () => {
    const log = ['ffffff01\tFadhlanR\tdirect push to main, no PR'].join('\n');
    const deps = makeDeps(log, { ffffff01: '' });
    const out = buildFilteredNotes(baseInputs(), deps);
    expect(out).toContain('* direct push to main, no PR (ffffff0)');
  });

  it('returns empty string when no boxel-cli commits remain after filtering', () => {
    const log = [
      'gggggg01\tgithub-actions[bot]\tchore(release): bump only',
    ].join('\n');
    const deps = makeDeps(log, {});
    expect(buildFilteredNotes(baseInputs(), deps)).toBe('');
  });

  it('returns empty string when git log produces no output', () => {
    expect(buildFilteredNotes(baseInputs(), makeDeps('', {}))).toBe('');
  });
});
