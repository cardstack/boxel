import { describe, it, expect } from 'vitest';
import {
  composeChangelogFragment,
  composeReleaseBody,
  type Inputs,
} from '../../scripts/generate-release-notes';

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
