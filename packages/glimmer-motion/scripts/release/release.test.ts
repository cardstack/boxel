// The release decisions behind the lockstep npm publish of glimmer-motion and
// @cardstack/choreo: which merges publish, what version they publish as, which
// prerelease counter is free, and how the changelogs close out.
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
  diffTouchesCatalogEntries,
  lockstepVersion,
  nextManualUnstableVersion,
  PACKAGES,
  resolveStableBase,
  touchesPublishedSurface,
  unstableCounters,
} from './compute-release.ts';
import {
  promoteAll,
  promoteUnreleased,
  releasedNotes,
  releasedNotesAll,
} from './promote-changelog.ts';
import { assertPublishableVersion } from './set-version.ts';

const BOTH = ['glimmer-motion', '@cardstack/choreo'];

describe('prefix → bump level', () => {
  test('each prefix maps to its level', () => {
    strictEqual(classifyBumpFromTitle('feat: add a gesture', ''), 'minor');
    strictEqual(classifyBumpFromTitle('fix: settle a layout', ''), 'patch');
    strictEqual(classifyBumpFromTitle('perf: skip a measure', ''), 'patch');
    strictEqual(classifyBumpFromTitle('refactor: split a node', ''), 'patch');
    strictEqual(classifyBumpFromTitle('chore: tidy', ''), 'none');
    strictEqual(classifyBumpFromTitle('docs: describe a step', ''), 'none');
    strictEqual(classifyBumpFromTitle('test: cover a crossing', ''), 'none');
    strictEqual(classifyBumpFromTitle('ci: publish to npm', ''), 'none');
  });

  test('a scope does not change the level', () => {
    strictEqual(
      classifyBumpFromTitle('fix(choreo): hold a leaver', ''),
      'patch',
    );
  });

  test('either way of declaring a breaking change is a major', () => {
    strictEqual(classifyBumpFromTitle('feat!: rename motion()', ''), 'major');
    strictEqual(classifyBumpFromTitle('fix(film)!: drop a slot', ''), 'major');
    strictEqual(
      classifyBumpFromTitle('fix: drop a slot', 'BREAKING CHANGE: a slot'),
      'major',
    );
    // The footer only counts at the start of a line.
    strictEqual(
      classifyBumpFromTitle('fix: a fix', 'Not a BREAKING CHANGE: discussed'),
      'patch',
    );
  });

  test('no prefix, or one that is not ours, publishes nothing', () => {
    strictEqual(classifyBumpFromTitle('Add a gesture', ''), 'none');
    strictEqual(classifyBumpFromTitle('wip: still working', ''), 'none');
    strictEqual(classifyBumpFromTitle('FEAT: shouting', ''), 'none');
  });
});

describe('changed files → does either artifact move', () => {
  const cases: [string, boolean][] = [
    ['packages/glimmer-motion/src/index.ts', true],
    ['packages/glimmer-motion/src/reorder/group.gts', true],
    ['packages/glimmer-motion/package.json', true],
    ['packages/glimmer-motion/README.md', true],
    ['packages/glimmer-motion/LICENSE', true],
    ['packages/glimmer-motion/CHANGELOG.md', true],
    ['packages/glimmer-motion/VENDORED.md', true],
    ['packages/glimmer-motion/addon-main.cjs', true],
    ['packages/glimmer-motion/rollup.config.mjs', true],
    ['packages/glimmer-motion/babel.publish.config.json', true],
    ['packages/glimmer-motion/tsconfig.json', true],
    ['packages/glimmer-motion/tsconfig.declarations.json', true],
    ['packages/glimmer-motion/scripts/fix-declarations.mjs', true],
    ['packages/glimmer-motion/scripts/source-resolution.mjs', true],
    ['packages/choreo/src/index.ts', true],
    ['packages/choreo/src/film/player.gts', true],
    ['packages/choreo/package.json', true],
    ['packages/choreo/README.md', true],
    ['packages/choreo/CHANGELOG.md', true],
    ['packages/choreo/babel.config.json', true],
    ['packages/choreo/rollup.config.mjs', true],
    ['packages/choreo/scripts/fix-declarations.mjs', true],
    // Real work that ships nothing.
    ['packages/glimmer-motion/tests/integration/motion/drag-test.gts', false],
    ['packages/glimmer-motion/babel.config.mjs', false],
    ['packages/glimmer-motion/vite.config.mjs', false],
    ['packages/glimmer-motion/testem.cjs', false],
    ['packages/glimmer-motion/eslint.config.mjs', false],
    ['packages/glimmer-motion/scripts/check-exports.mjs', false],
    ['packages/glimmer-motion/scripts/release/compute-release.ts', false],
    ['packages/glimmer-motion/unpublished-development-types/index.d.ts', false],
    ['packages/choreo/tests/integration/choreo/gates-test.gts', false],
    ['packages/choreo/eslint.config.mjs', false],
    // A file whose name only starts like a published one is not that file.
    ['packages/glimmer-motion/package.json.bak', false],
    ['packages/glimmer-motion/srcs/index.ts', false],
    // Neighbouring packages are not these packages.
    ['packages/choreo-player/src/index.ts', false],
    ['packages/choreo-gallery/src/index.ts', false],
    ['packages/choreo-test-app/app/app.ts', false],
    ['packages/host/app/lib/externals.ts', false],
  ];
  for (const [file, expected] of cases) {
    test(`${file} → ${expected ? 'publishes' : 'does not publish'}`, () => {
      strictEqual(touchesPublishedSurface([file]), expected);
    });
  }

  test('one shipping file among many that do not is still a release', () => {
    strictEqual(
      touchesPublishedSurface([
        'packages/glimmer-motion/tests/index.html',
        'packages/choreo/src/steps.gts',
      ]),
      true,
    );
  });

  test('the packages publish glimmer-motion first', () => {
    deepStrictEqual(
      PACKAGES.map((pkg) => pkg.name),
      BOTH,
    );
  });
});

describe('the one version both packages carry', () => {
  test('agreeing manifests give their version', () => {
    strictEqual(
      lockstepVersion({
        'glimmer-motion': '0.2.0-unstable.1',
        '@cardstack/choreo': '0.2.0-unstable.1',
      }),
      '0.2.0-unstable.1',
    );
  });

  test('disagreeing manifests stop the release', () => {
    throws(
      () =>
        lockstepVersion({
          'glimmer-motion': '0.2.0',
          '@cardstack/choreo': '0.1.0',
        }),
      /glimmer-motion@0\.2\.0, @cardstack\/choreo@0\.1\.0/,
    );
  });
});

describe('computing the release', () => {
  const stableBase = '0.5.1';
  const glimmerMotionOnly = ['packages/glimmer-motion/src/node.ts'];
  const choreoOnly = ['packages/choreo/src/choreo.gts'];
  const notShipping = ['packages/choreo/tests/integration/choreo/run-test.gts'];

  function release(
    prTitle: string,
    changedFiles: string[],
    currentVersion: string,
    prereleaseCounter = 0,
    lastStableBase = stableBase,
    catalogAffectsDependencies = false,
  ) {
    return computeRelease({
      catalogAffectsDependencies,
      changedFiles,
      currentVersion,
      lastStableBase,
      prBody: '',
      prereleaseCounter,
      prTitle,
    });
  }

  test('a fix to glimmer-motion alone releases both packages', () => {
    deepStrictEqual(release('fix: a fix', glimmerMotionOnly, '0.5.1'), {
      bootstrapStableTag: null,
      bump: 'patch',
      nextVersion: '0.5.2-unstable.0',
      packages: BOTH,
      prereleaseCounter: 0,
    });
  });

  test('a feature in choreo alone releases both packages', () => {
    deepStrictEqual(release('feat: a feature', choreoOnly, '0.5.1'), {
      bootstrapStableTag: null,
      bump: 'minor',
      nextVersion: '0.6.0-unstable.0',
      packages: BOTH,
      prereleaseCounter: 0,
    });
  });

  test('a breaking change is a major', () => {
    strictEqual(
      release('feat!: drop a step', choreoOnly, '0.5.1').nextVersion,
      '1.0.0-unstable.0',
    );
  });

  test('a release from the unpublished 0.0.0 manifests', () => {
    strictEqual(
      release('feat: first', glimmerMotionOnly, '0.0.0', 0, '0.0.0')
        .nextVersion,
      '0.1.0-unstable.0',
    );
  });

  test('a bumpable prefix that ships nothing publishes nothing', () => {
    deepStrictEqual(release('feat: a test helper', notShipping, '0.5.1'), {
      bootstrapStableTag: null,
      bump: 'none',
      nextVersion: null,
      packages: [],
      prereleaseCounter: 0,
    });
  });

  test('a shipping change that does not ask for a release publishes nothing', () => {
    strictEqual(
      release('chore: reword', glimmerMotionOnly, '0.5.1').nextVersion,
      null,
    );
  });

  test('on a prerelease, a same-or-smaller bump moves only the counter', () => {
    strictEqual(
      release('fix: another', choreoOnly, '0.5.2-unstable.0', 1).nextVersion,
      '0.5.2-unstable.1',
    );
    strictEqual(
      release('fix: a third', choreoOnly, '0.6.0-unstable.4', 5).nextVersion,
      '0.6.0-unstable.5',
    );
  });

  test('a larger bump escalates the base from the last stable release', () => {
    strictEqual(
      release('feat: a feature', choreoOnly, '0.5.2-unstable.2', 3).nextVersion,
      '0.6.0-unstable.3',
    );
    strictEqual(
      release('fix: a fix', choreoOnly, '1.0.0-unstable.7', 8, '0.9.3')
        .nextVersion,
      '1.0.0-unstable.8',
    );
  });

  test('a catalog entry either package depends on is published surface', () => {
    strictEqual(
      release('fix: pick up framer-motion', [], '0.5.1', 0, stableBase, true)
        .nextVersion,
      '0.5.2-unstable.0',
    );
    strictEqual(
      release('chore: bump the catalog', [], '0.5.1', 0, stableBase, true)
        .nextVersion,
      null,
    );
  });

  test('an unparseable version fails loudly', () => {
    throws(
      () => release('feat: x', choreoOnly, 'not-a-version'),
      /Invalid semver/,
    );
  });
});

describe('catalog diffs', () => {
  const diff = (lines: string[]) =>
    ['--- a/pnpm-workspace.yaml', '+++ b/pnpm-workspace.yaml', ...lines].join(
      '\n',
    );
  const deps = ['decorator-transforms', 'framer-motion'];

  test('an added or removed entry for a dependency counts', () => {
    strictEqual(
      diffTouchesCatalogEntries(
        diff(['-  framer-motion: 13.4.6', '+  framer-motion: 13.5.0']),
        deps,
      ),
      true,
    );
    strictEqual(
      diffTouchesCatalogEntries(
        diff(['-  "decorator-transforms": ^2.0.0']),
        deps,
      ),
      true,
    );
  });

  test('other entries, file headers and substrings do not', () => {
    strictEqual(
      diffTouchesCatalogEntries(diff(['+  motion: 13.5.0']), deps),
      false,
    );
    strictEqual(diffTouchesCatalogEntries(diff([]), deps), false);
    strictEqual(
      diffTouchesCatalogEntries(diff(['+  framer-motion-extra: 1.0.0']), deps),
      false,
    );
    strictEqual(
      diffTouchesCatalogEntries(diff(['+  framer-motion: 1.0.0']), []),
      false,
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
  test('the highest stable lockstep tag wins', () => {
    deepStrictEqual(
      resolveStableBase(
        [
          'glimmer-motion-choreo-v0.9.0',
          'glimmer-motion-choreo-v0.10.0',
          'glimmer-motion-choreo-v0.11.0-unstable.0',
        ],
        '0.11.0-unstable.1',
      ),
      { base: '0.10.0', tagged: true },
    );
  });

  test("other packages' tags are not ours", () => {
    deepStrictEqual(
      resolveStableBase(
        ['bxl-v2.0.0', 'choreo-player-v3.0.0', 'glimmer-motion-choreo-v0.5.1'],
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
  test('mid-series, the counter advances past what either package has', () => {
    // choreo holds a counter glimmer-motion doesn't: it is still taken.
    strictEqual(
      nextManualUnstableVersion('0.6.0-unstable.3', [
        '0.6.0-unstable.3',
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
    // choreo's 0.0.0 placeholder counts as released for both.
    strictEqual(
      nextManualUnstableVersion('0.0.0', ['0.0.0']),
      '0.0.1-unstable.0',
    );
  });
});

describe('versions the packages publish', () => {
  test('stable and unstable prereleases pass', () => {
    assertPublishableVersion('0.6.0');
    assertPublishableVersion('0.6.0-unstable.3');
  });

  test('anything else stops the release', () => {
    throws(() => assertPublishableVersion('v0.6.0'), /not a version/);
    throws(() => assertPublishableVersion('0.6.0-beta.1'), /not a version/);
  });
});

describe('closing out the changelogs on a stable cut', () => {
  const written = [
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
  ].join('\n');
  const empty = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [0.5.1] — 2026-08-02',
    '',
    '- An older thing.',
    '',
  ].join('\n');

  test('a written section moves under the version heading', () => {
    const promoted = promoteUnreleased(written, '0.6.0', '2026-08-18', 'n/a');
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

  test('an empty section in one package records the lockstep', () => {
    const { changelogs, notes } = promoteAll(
      [
        { changelog: written, name: 'glimmer-motion' },
        { changelog: empty, name: '@cardstack/choreo' },
      ],
      '0.6.0',
      '2026-08-18',
    );
    const lockstepNote =
      'No changes of its own; released at this version in lockstep with `glimmer-motion`.';
    strictEqual(
      changelogs[1],
      [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '## [0.6.0] — 2026-08-18',
        '',
        lockstepNote,
        '',
        '## [0.5.1] — 2026-08-02',
        '',
        '- An older thing.',
        '',
      ].join('\n'),
    );
    strictEqual(
      notes,
      `## glimmer-motion\n\n### Fixed\n\n- A thing.\n\n## @cardstack/choreo\n\n${lockstepNote}`,
    );
  });

  test('the section runs to the end of a file with no release yet', () => {
    strictEqual(
      promoteUnreleased(
        '# Changelog\n\n## [Unreleased]\n\n- The first thing.\n',
        '0.1.0',
        '2026-08-18',
        'n/a',
      ).notes,
      '- The first thing.',
    );
  });

  test('every section empty stops the release', () => {
    throws(
      () =>
        promoteAll(
          [
            { changelog: empty, name: 'glimmer-motion' },
            { changelog: empty, name: '@cardstack/choreo' },
          ],
          '0.6.0',
          '2026-08-18',
        ),
      /section is empty/,
    );
  });

  test('a changelog with no [Unreleased] heading stops the release', () => {
    throws(
      () =>
        promoteAll(
          [
            { changelog: written, name: 'glimmer-motion' },
            { changelog: '# Changelog\n', name: '@cardstack/choreo' },
          ],
          '0.6.0',
          '2026-08-18',
        ),
      /no "## \[Unreleased\]" heading/,
    );
  });
});

describe('reading back the notes a version records', () => {
  const recorded = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '- Not yet.',
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
  ].join('\n');

  test("a version's section, bounded by the next heading", () => {
    strictEqual(releasedNotes(recorded, '0.6.0'), '### Fixed\n\n- A thing.');
    strictEqual(releasedNotes(recorded, '0.5.1'), '- An older thing.');
  });

  test('a version is not a prefix of a longer one', () => {
    throws(() => releasedNotes(recorded, '0.6'), /records no "## \[0\.6\]"/);
  });

  test('both packages combine as the close-out writes them', () => {
    const { changelogs, notes } = promoteAll(
      [
        {
          changelog: '# Changelog\n\n## [Unreleased]\n\n- A thing.\n',
          name: 'glimmer-motion',
        },
        {
          changelog: '# Changelog\n\n## [Unreleased]\n',
          name: '@cardstack/choreo',
        },
      ],
      '0.6.0',
      '2026-08-18',
    );
    strictEqual(
      releasedNotesAll(
        [
          { changelog: changelogs[0], name: 'glimmer-motion' },
          { changelog: changelogs[1], name: '@cardstack/choreo' },
        ],
        '0.6.0',
      ),
      notes,
    );
  });
});
