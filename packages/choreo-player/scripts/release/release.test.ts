// The release decisions behind the npm publish of @cardstack/choreo-player:
// which merges publish, what version they publish as, which prerelease counter
// is free, and how the changelog closes out.
//
// These run on the pure functions, with no git, npm, or filesystem in the way.
// Getting them wrong is expensive in a way a failed build is not — a published
// version can be deprecated but never replaced, and a wrong one either skips a
// release consumers are waiting on or burns a version number on nothing.
//
//   node --test scripts/release/release.test.ts

import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, test } from 'node:test';

import {
  classifyBumpFromTitle,
  computeRelease,
  nextManualUnstableVersion,
  resolveStableBase,
  touchesPublishedSurface,
  unstableCounters,
} from './compute-release.ts';
import { promoteUnreleased } from './promote-changelog.ts';
import { assertPublishableVersion } from './set-version.ts';

describe('prefix → bump level', () => {
  test('each prefix maps to its level', () => {
    strictEqual(classifyBumpFromTitle('feat: add a rate ramp', ''), 'minor');
    strictEqual(
      classifyBumpFromTitle('fix: settle before render', ''),
      'patch',
    );
    strictEqual(classifyBumpFromTitle('perf: skip a seek', ''), 'patch');
    strictEqual(
      classifyBumpFromTitle('refactor: split the clock', ''),
      'patch',
    );
    strictEqual(classifyBumpFromTitle('chore: tidy', ''), 'none');
    strictEqual(classifyBumpFromTitle('docs: describe prepare()', ''), 'none');
    strictEqual(classifyBumpFromTitle('test: cover a pause', ''), 'none');
    strictEqual(classifyBumpFromTitle('ci: publish to npm', ''), 'none');
  });

  test('a scope does not change the level', () => {
    strictEqual(
      classifyBumpFromTitle('fix(hyperframes): seek on bind', ''),
      'patch',
    );
  });

  test('either way of declaring a breaking change is a major', () => {
    strictEqual(classifyBumpFromTitle('feat!: rename runs()', ''), 'major');
    strictEqual(
      classifyBumpFromTitle('fix(hyperframes)!: drop a hook', ''),
      'major',
    );
    strictEqual(
      classifyBumpFromTitle('fix: drop a hook', 'BREAKING CHANGE: a hook'),
      'major',
    );
    // The footer only counts at the start of a line.
    strictEqual(
      classifyBumpFromTitle('fix: a fix', 'Not a BREAKING CHANGE: discussed'),
      'patch',
    );
  });

  test('no prefix, or one that is not ours, publishes nothing', () => {
    strictEqual(classifyBumpFromTitle('Add a rate ramp', ''), 'none');
    strictEqual(classifyBumpFromTitle('wip: still working', ''), 'none');
    strictEqual(classifyBumpFromTitle('FEAT: shouting', ''), 'none');
  });
});

describe('changed files → does the artifact move', () => {
  const cases: [string, boolean][] = [
    ['packages/choreo-player/src/index.ts', true],
    ['packages/choreo-player/src/hyperframes.ts', true],
    ['packages/choreo-player/package.json', true],
    ['packages/choreo-player/README.md', true],
    ['packages/choreo-player/CHANGELOG.md', true],
    ['packages/choreo-player/LICENSE', true],
    ['packages/choreo-player/tsconfig.json', true],
    // Real work that ships nothing.
    ['packages/choreo-player/test/player.test.mjs', false],
    ['packages/choreo-player/eslint.config.mjs', false],
    ['packages/choreo-player/scripts/release/compute-release.ts', false],
    // A file whose name only starts like a published one is not that file.
    ['packages/choreo-player/package.json.bak', false],
    ['packages/choreo-player/srcs/index.ts', false],
    // Neighbouring packages are not this package.
    ['packages/choreo/src/index.ts', false],
    ['packages/choreo-gallery/src/index.ts', false],
    ['packages/glimmer-motion/src/index.ts', false],
    ['pnpm-workspace.yaml', false],
  ];
  for (const [file, expected] of cases) {
    test(`${file} → ${expected ? 'publishes' : 'does not publish'}`, () => {
      strictEqual(touchesPublishedSurface([file]), expected);
    });
  }

  test('one shipping file among many that do not is still a release', () => {
    strictEqual(
      touchesPublishedSurface([
        'packages/choreo-player/test/player.test.mjs',
        'packages/choreo-player/src/index.ts',
      ]),
      true,
    );
  });
});

describe('computing the release', () => {
  const stableBase = '0.5.1';
  const shipping = ['packages/choreo-player/src/index.ts'];
  const notShipping = ['packages/choreo-player/test/player.test.mjs'];

  function release(
    prTitle: string,
    changedFiles: string[],
    currentVersion: string,
    prereleaseCounter = 0,
    lastStableBase = stableBase,
  ) {
    return computeRelease({
      changedFiles,
      currentVersion,
      lastStableBase,
      prBody: '',
      prereleaseCounter,
      prTitle,
    });
  }

  test('a fix publishes the next patch as a prerelease', () => {
    deepStrictEqual(release('fix: a fix', shipping, '0.5.1'), {
      bootstrapStableTag: null,
      bump: 'patch',
      nextVersion: '0.5.2-unstable.0',
      prereleaseCounter: 0,
    });
  });

  test('a feature publishes the next minor', () => {
    strictEqual(
      release('feat: a feature', shipping, '0.5.1').nextVersion,
      '0.6.0-unstable.0',
    );
  });

  test('a breaking change is a major', () => {
    strictEqual(
      release('feat!: drop a hook', shipping, '0.5.1').nextVersion,
      '1.0.0-unstable.0',
    );
  });

  test('the first releases build on the 0.0.0 placeholder', () => {
    strictEqual(
      release('feat: first', shipping, '0.0.0', 0, '0.0.0').nextVersion,
      '0.1.0-unstable.0',
    );
    strictEqual(
      release('fix: first', shipping, '0.0.0', 0, '0.0.0').nextVersion,
      '0.0.1-unstable.0',
    );
  });

  test('a bumpable prefix that ships nothing publishes nothing', () => {
    deepStrictEqual(release('feat: a test helper', notShipping, '0.5.1'), {
      bootstrapStableTag: null,
      bump: 'none',
      nextVersion: null,
      prereleaseCounter: 0,
    });
  });

  test('a shipping change that does not ask for a release publishes nothing', () => {
    strictEqual(release('chore: reword', shipping, '0.5.1').nextVersion, null);
  });

  test('on a prerelease, a same-or-smaller bump moves only the counter', () => {
    strictEqual(
      release('fix: another', shipping, '0.5.2-unstable.0', 1).nextVersion,
      '0.5.2-unstable.1',
    );
    strictEqual(
      release('fix: a third', shipping, '0.6.0-unstable.4', 5).nextVersion,
      '0.6.0-unstable.5',
    );
  });

  test('a larger bump escalates the base from the last stable release', () => {
    strictEqual(
      release('feat: a feature', shipping, '0.5.2-unstable.2', 3).nextVersion,
      '0.6.0-unstable.3',
    );
    strictEqual(
      release('fix: a fix', shipping, '1.0.0-unstable.7', 8, '0.9.3')
        .nextVersion,
      '1.0.0-unstable.8',
    );
  });

  test('an unparseable version fails loudly', () => {
    throws(
      () => release('feat: x', shipping, 'not-a-version'),
      /Invalid semver/,
    );
  });
});

describe('prerelease counters already taken on npm', () => {
  const published = [
    '0.0.0',
    '0.5.2-unstable.0',
    '0.5.2-unstable.1',
    '0.5.2-unstable.3',
    '0.3.20-unstable.4',
  ];

  test('counters for a base, compared as parsed components', () => {
    deepStrictEqual(unstableCounters('0.5.2', published), [0, 1, 3]);
    deepStrictEqual(unstableCounters('0.3.2', published), []);
    deepStrictEqual(unstableCounters('0.3.20', published), [4]);
  });

  test('junk from the registry is dropped', () => {
    deepStrictEqual(
      unstableCounters('0.5.2', [null, 42, {}, 'nope', '0.5.2-unstable.9']),
      [9],
    );
  });
});

describe('the stable release a prerelease series builds on', () => {
  test('the highest stable tag wins', () => {
    deepStrictEqual(
      resolveStableBase(
        [
          'choreo-player-v0.9.0',
          'choreo-player-v0.10.0',
          'choreo-player-v0.11.0-unstable.0',
        ],
        '0.11.0-unstable.1',
      ),
      { base: '0.10.0', tagged: true },
    );
  });

  test("other packages' tags are not ours", () => {
    deepStrictEqual(
      resolveStableBase(
        ['bxl-v2.0.0', 'glimmer-motion-choreo-v3.0.0', 'choreo-player-v0.5.1'],
        '0.5.2-unstable.0',
      ),
      { base: '0.5.1', tagged: true },
    );
  });

  test('before the first tag, the stable manifest is the base, untagged', () => {
    deepStrictEqual(resolveStableBase([], '0.0.0'), {
      base: '0.0.0',
      tagged: false,
    });
  });

  test('a prerelease manifest with no stable tag stops the release', () => {
    throws(() => resolveStableBase([], '0.1.0-unstable.0'), /unknowable/);
  });
});

describe('the version a manual republish takes', () => {
  test('mid-series, the counter advances past what npm has', () => {
    strictEqual(
      nextManualUnstableVersion('0.6.0-unstable.3', [
        '0.6.0-unstable.3',
        '0.6.0-unstable.4',
      ]),
      '0.6.0-unstable.5',
    );
  });

  test('a released manifest version moves to the next patch', () => {
    strictEqual(
      nextManualUnstableVersion('0.6.0', ['0.6.0', '0.6.0-unstable.3']),
      '0.6.1-unstable.0',
    );
    // The 0.0.0 placeholder on npm counts as released.
    strictEqual(
      nextManualUnstableVersion('0.0.0', ['0.0.0']),
      '0.0.1-unstable.0',
    );
  });
});

describe('versions the package publishes', () => {
  test('stable and unstable prereleases pass', () => {
    assertPublishableVersion('0.6.0');
    assertPublishableVersion('0.6.0-unstable.3');
  });

  test('anything else stops the release', () => {
    throws(() => assertPublishableVersion('v0.6.0'), /not a version/);
    throws(() => assertPublishableVersion('0.6.0-beta.1'), /not a version/);
  });
});

describe('closing out the changelog on a stable cut', () => {
  test('a written section moves under the version heading', () => {
    const promoted = promoteUnreleased(
      [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '### Fixed',
        '',
        '- A thing.',
        '',
        '## [0.5.1] — 2026-08-02',
        '',
        '- An older thing.',
        '',
      ].join('\n'),
      '0.6.0',
      '2026-08-18',
    );
    strictEqual(
      promoted.changelog,
      [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '## [0.6.0] — 2026-08-18',
        '',
        '### Fixed',
        '',
        '- A thing.',
        '',
        '## [0.5.1] — 2026-08-02',
        '',
        '- An older thing.',
        '',
      ].join('\n'),
    );
    strictEqual(promoted.notes, '### Fixed\n\n- A thing.');
  });

  test('the section runs to the end of a file with no release yet', () => {
    strictEqual(
      promoteUnreleased(
        '# Changelog\n\n## [Unreleased]\n\n- The first thing.\n',
        '0.1.0',
        '2026-08-18',
      ).notes,
      '- The first thing.',
    );
  });

  test('an empty section stops the release', () => {
    throws(
      () =>
        promoteUnreleased(
          '# Changelog\n\n## [Unreleased]\n\n## [0.5.1] — 2026-08-02\n\n- Old.\n',
          '0.6.0',
          '2026-08-18',
        ),
      /section is empty/,
    );
  });

  test('a changelog with no [Unreleased] heading stops the release', () => {
    throws(
      () => promoteUnreleased('# Changelog\n', '0.6.0', '2026-08-18'),
      /no "## \[Unreleased\]" heading/,
    );
  });
});
