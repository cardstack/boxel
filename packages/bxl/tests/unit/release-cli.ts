// The release decisions behind the npm publish: which merges publish, what
// version they publish as, and which prerelease counter is free.
//
// These run on the pure functions in scripts/compute-release.ts, with no git,
// npm, or filesystem in the way. Getting them wrong is expensive in a way a
// failed build is not — a published version can be deprecated but never
// replaced, and a wrong one either skips a release consumers are waiting on or
// burns a version number on nothing.

import { deepStrictEqual, strictEqual, throws } from 'node:assert';

import {
  classifyBumpFromTitle,
  computeRelease,
  diffTouchesCatalogEntries,
  nextManualUnstableVersion,
  resolveStableBase,
  touchesPublishedSurface,
  unstableCounters,
  type BumpLevel,
} from '../../scripts/compute-release.ts';
import { promoteUnreleased } from '../../scripts/promote-changelog.ts';
import { withVersionDeclaration } from '../../scripts/set-version.ts';

let checks = 0;

function bumpFor(title: string, body = ''): BumpLevel {
  checks++;
  return classifyBumpFromTitle(title, body);
}

// --- prefix → bump level ---

strictEqual(bumpFor('feat: add ROUNDBANK'), 'minor');
strictEqual(bumpFor('fix: NORM.DIST rejects a zero deviation'), 'patch');
strictEqual(bumpFor('perf: memoize the compiled program'), 'patch');
strictEqual(bumpFor('refactor: split the registry'), 'patch');
strictEqual(bumpFor('chore: tidy the fixtures'), 'none');
strictEqual(bumpFor('docs: describe the derive profile'), 'none');
strictEqual(bumpFor('test: cover the mutation planner'), 'none');

// A scope is part of the convention and does not change the level.
strictEqual(bumpFor('fix(compiler): accept a trailing comma'), 'patch');

// Either way of declaring a breaking change is a major.
strictEqual(bumpFor('feat!: drop the legacy jq tag'), 'major');
strictEqual(bumpFor('fix(runtime)!: reject bare identifiers'), 'major');
strictEqual(
  bumpFor('fix: reject bare identifiers', 'BREAKING CHANGE: bare identifiers'),
  'major',
);
// The footer only counts at the start of a line, not quoted mid-sentence.
strictEqual(
  bumpFor('fix: a fix', 'Not a BREAKING CHANGE: just discussing one'),
  'patch',
);

// No prefix, or one that isn't ours, publishes nothing. Silence is the safe
// direction: a title that doesn't ask for a release doesn't get one.
strictEqual(bumpFor('Add ROUNDBANK'), 'none');
strictEqual(bumpFor('wip: still working'), 'none');
strictEqual(bumpFor('FEAT: shouting'), 'none');

// --- changed files → does the artifact move ---

const surfaceCases: [string, boolean][] = [
  ['packages/bxl/src/index.ts', true],
  ['packages/bxl/src/formulajs/statistical.ts', true],
  ['packages/bxl/docs/syntax-reference.md', true],
  ['packages/bxl/README.md', true],
  ['packages/bxl/NOTICE.md', true],
  ['packages/bxl/CHANGELOG.md', true],
  ['packages/bxl/LICENSE', true],
  ['packages/bxl/LICENSES/Apache-2.0.txt', true],
  ['packages/bxl/package.json', true],
  ['packages/bxl/tsconfig.json', true],
  ['packages/bxl/tsconfig.build.json', true],
  ['packages/bxl/scripts/build.ts', true],
  // Real work that ships nothing.
  ['packages/bxl/tests/unit/bxl-formula-cli.ts', false],
  ['packages/bxl/examples/authorization/run.ts', false],
  ['packages/bxl/eslint-rules/no-bare-identifier.js', false],
  ['packages/bxl/scripts/run-tests.mjs', false],
  ['packages/bxl/scripts/compute-release.ts', false],
  ['packages/bxl/.eslintignore', false],
  // Another package's src is not this one's.
  ['packages/host/src/index.ts', false],
  ['packages/boxel-cli/src/index.ts', false],
];
for (const [file, expected] of surfaceCases) {
  checks++;
  strictEqual(
    touchesPublishedSurface([file]),
    expected,
    `${file} → ${expected ? 'publishes' : 'does not publish'}`,
  );
}

// One shipping file among many that don't is still a release.
checks++;
strictEqual(
  touchesPublishedSurface([
    'packages/bxl/tests/unit/bxl-formula-cli.ts',
    'packages/bxl/src/formulajs/financial.ts',
  ]),
  true,
);

// --- the two together ---

const stableBase = '0.5.1';
const shipping = ['packages/bxl/src/index.ts'];
const notShipping = ['packages/bxl/tests/unit/bxl-formula-cli.ts'];

function release(
  prTitle: string,
  changedFiles: string[],
  currentVersion: string,
  prereleaseCounter = 0,
  lastStableBase = stableBase,
  catalogAffectsDependencies = false,
) {
  checks++;
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

// From a stable version, the first prerelease of the bumped base.
deepStrictEqual(release('feat: add ROUNDBANK', shipping, '0.5.1'), {
  bootstrapStableTag: null,
  bump: 'minor',
  nextVersion: '0.6.0-unstable.0',
  prereleaseCounter: 0,
});
deepStrictEqual(release('fix: correct NORM.DIST', shipping, '0.5.1'), {
  bootstrapStableTag: null,
  bump: 'patch',
  nextVersion: '0.5.2-unstable.0',
  prereleaseCounter: 0,
});
deepStrictEqual(release('feat!: drop the legacy tag', shipping, '0.5.1'), {
  bootstrapStableTag: null,
  bump: 'major',
  nextVersion: '1.0.0-unstable.0',
  prereleaseCounter: 0,
});

// A bumpable prefix that ships nothing, and a shipping change that doesn't ask
// for a release, both publish nothing.
deepStrictEqual(release('feat: add a test helper', notShipping, '0.5.1'), {
  bootstrapStableTag: null,
  bump: 'none',
  nextVersion: null,
  prereleaseCounter: 0,
});
deepStrictEqual(release('chore: reword a comment', shipping, '0.5.1'), {
  bootstrapStableTag: null,
  bump: 'none',
  nextVersion: null,
  prereleaseCounter: 0,
});

// Already on a prerelease: the base is the accumulation of everything since the
// last stable release, so a same-or-smaller bump holds it steady and only the
// counter moves.
deepStrictEqual(release('fix: another fix', shipping, '0.5.2-unstable.0', 1), {
  bootstrapStableTag: null,
  bump: 'patch',
  nextVersion: '0.5.2-unstable.1',
  prereleaseCounter: 1,
});
deepStrictEqual(release('fix: a third fix', shipping, '0.6.0-unstable.4', 5), {
  bootstrapStableTag: null,
  bump: 'patch',
  nextVersion: '0.6.0-unstable.5',
  prereleaseCounter: 5,
});

// A larger bump escalates the base, keeping the counter npm handed us.
deepStrictEqual(
  release('feat: add ROUNDBANK', shipping, '0.5.2-unstable.2', 3),
  {
    bootstrapStableTag: null,
    bump: 'minor',
    nextVersion: '0.6.0-unstable.3',
    prereleaseCounter: 3,
  },
);
deepStrictEqual(release('feat!: breaking', shipping, '0.6.0-unstable.1', 2), {
  bootstrapStableTag: null,
  bump: 'major',
  nextVersion: '1.0.0-unstable.2',
  prereleaseCounter: 2,
});

// The base is computed from the last stable release, not from the prerelease
// itself — otherwise every merge would ratchet the base forward again.
deepStrictEqual(
  release('fix: a fix', shipping, '1.0.0-unstable.7', 8, '0.9.3'),
  {
    bootstrapStableTag: null,
    bump: 'patch',
    nextVersion: '1.0.0-unstable.8',
    prereleaseCounter: 8,
  },
);

checks++;
throws(
  () => release('feat: add ROUNDBANK', shipping, 'not-a-version'),
  /Invalid semver/,
  'an unparseable current version fails loudly rather than guessing',
);

// --- the workspace catalog as published surface ---

// A catalog entry this package depends on resolves into the published manifest,
// so it releases even though no file under the package changed.
deepStrictEqual(
  release('fix: pick up the validator fix', [], '0.5.1', 0, stableBase, true),
  {
    bootstrapStableTag: null,
    bump: 'patch',
    nextVersion: '0.5.2-unstable.0',
    prereleaseCounter: 0,
  },
);
// Still gated by the prefix, like any other change.
deepStrictEqual(
  release('chore: bump the catalog', [], '0.5.1', 0, stableBase, true),
  {
    bootstrapStableTag: null,
    bump: 'none',
    nextVersion: null,
    prereleaseCounter: 0,
  },
);

const catalogDiff = (lines: string[]) =>
  ['--- a/pnpm-workspace.yaml', '+++ b/pnpm-workspace.yaml', ...lines].join(
    '\n',
  );
const bxlDeps = ['bessel', 'jstat', 'validator'];

checks++;
strictEqual(
  diffTouchesCatalogEntries(
    catalogDiff(['-  validator: ^13.15.35', '+  validator: ^13.16.0']),
    bxlDeps,
  ),
  true,
);
checks++;
strictEqual(
  diffTouchesCatalogEntries(
    catalogDiff(["-  'jstat': ^1.9.6", "+  'jstat': ^1.9.7"]),
    bxlDeps,
  ),
  true,
  'a quoted key is the same entry',
);
// Someone else's dependency moving changes nothing about what this package
// ships, and the catalog holds a few hundred of them.
checks++;
strictEqual(
  diffTouchesCatalogEntries(
    catalogDiff(['-  eslint: ^8.57.1', '+  eslint: ^9.0.0']),
    bxlDeps,
  ),
  false,
);
// The `---`/`+++` file headers name the file, not an entry.
checks++;
strictEqual(diffTouchesCatalogEntries(catalogDiff([]), bxlDeps), false);
// A name appearing as a substring of another entry is not that entry.
checks++;
strictEqual(
  diffTouchesCatalogEntries(
    catalogDiff(['+  validator-extra: ^1.0.0', '+  "@types/jstat": ^1.0.0']),
    bxlDeps,
  ),
  false,
);
checks++;
strictEqual(
  diffTouchesCatalogEntries(catalogDiff(['+  bessel: ^1.0.3']), []),
  false,
  'a package with no dependencies has no catalog entries to watch',
);

// --- prerelease counters already taken on npm ---

const published = [
  '0.5.0',
  '0.5.1',
  '0.5.2-unstable.0',
  '0.5.2-unstable.1',
  '0.5.2-unstable.3',
  '0.6.0-unstable.0',
  '0.3.20-unstable.4',
];

checks++;
deepStrictEqual(unstableCounters('0.5.2', published), [0, 1, 3]);
checks++;
deepStrictEqual(unstableCounters('0.6.0', published), [0]);
checks++;
deepStrictEqual(unstableCounters('9.9.9', published), []);

// A patch of 20 is not a patch of 2 — the comparison is on parsed components,
// not on the string.
checks++;
deepStrictEqual(unstableCounters('0.3.2', published), []);
checks++;
deepStrictEqual(unstableCounters('0.3.20', published), [4]);

// A registry that answers with something unexpected doesn't take the run down.
checks++;
deepStrictEqual(
  unstableCounters('0.5.2', [
    null,
    42,
    {},
    'not-a-version',
    '0.5.2-unstable.9',
  ]),
  [9],
);

// A stable release and a differently-tagged prerelease are not counters.
checks++;
deepStrictEqual(unstableCounters('0.5.1', ['0.5.1', '0.5.1-beta.0']), []);

// --- the stable release a prerelease series builds on ---

// Tagged releases are the record, and the highest stable one wins regardless of
// the order tags come back in.
checks++;
deepStrictEqual(
  resolveStableBase(
    ['bxl-v0.4.2', 'bxl-v0.5.1', 'bxl-v0.5.0', 'bxl-v0.6.0-unstable.3'],
    '0.6.0-unstable.4',
  ),
  { base: '0.5.1', tagged: true },
);
checks++;
deepStrictEqual(
  resolveStableBase(['bxl-v0.9.0', 'bxl-v0.10.0'], '0.10.1-unstable.0'),
  { base: '0.10.0', tagged: true },
  '0.10.0 is later than 0.9.0 — compared as versions, not as strings',
);
// Tags for other packages share the repo and must not be read as this one's.
checks++;
deepStrictEqual(
  resolveStableBase(['boxel-cli-v1.2.3', 'bxl-v0.5.1'], '0.5.2-unstable.0'),
  { base: '0.5.1', tagged: true },
);

// Before the first release there is no tag, and the manifest still holds the
// base — but nothing records it, so the workflow is asked to tag it.
checks++;
deepStrictEqual(resolveStableBase([], '0.5.1'), {
  base: '0.5.1',
  tagged: false,
});
// A prerelease tag is not a release, so it does not answer the question either.
checks++;
deepStrictEqual(resolveStableBase(['bxl-v0.6.0-unstable.0'], '0.5.1'), {
  base: '0.5.1',
  tagged: false,
});

// The state that has no answer: prereleases have moved the manifest off the base
// and no tag kept it. Guessing here would either ratchet the version on every
// merge or silently under-bump, so it stops instead.
checks++;
throws(
  () => resolveStableBase(['bxl-v0.6.0-unstable.0'], '0.6.0-unstable.0'),
  /stable base it builds on is\s+unknowable/,
);
checks++;
throws(() => resolveStableBase([], '0.6.0-unstable.1'), /unknowable/);

// --- the version a manual republish takes ---

// Mid-series: the base holds and the counter advances past what npm has.
checks++;
strictEqual(
  nextManualUnstableVersion('0.6.0-unstable.3', [
    '0.5.1',
    '0.6.0-unstable.0',
    '0.6.0-unstable.3',
  ]),
  '0.6.0-unstable.4',
);
// From a stable manifest that was never published, the base is free to use.
checks++;
strictEqual(nextManualUnstableVersion('0.5.1', []), '0.5.1-unstable.0');

// Directly after a promotion the manifest holds a released version. Publishing
// `0.6.0-unstable.4` then would order the `unstable` tag *below* `latest`, since
// a prerelease sorts before the release it names — so move to the next patch.
checks++;
strictEqual(
  nextManualUnstableVersion('0.6.0', [
    '0.6.0',
    '0.6.0-unstable.0',
    '0.6.0-unstable.3',
  ]),
  '0.6.1-unstable.0',
);
checks++;
strictEqual(
  nextManualUnstableVersion('0.6.0', ['0.6.0', '0.6.1-unstable.0']),
  '0.6.1-unstable.1',
  'and it keeps counting from whatever that next base already published',
);

// --- stamping the version into the entry module ---

const entry = [
  "export const NAME = 'bxl';",
  "export const VERSION = '0.5.1';",
  'export const OTHER = 1;',
].join('\n');

checks++;
strictEqual(
  withVersionDeclaration(entry, '0.6.0-unstable.3'),
  [
    "export const NAME = 'bxl';",
    "export const VERSION = '0.6.0-unstable.3';",
    'export const OTHER = 1;',
  ].join('\n'),
);

checks++;
throws(
  () => withVersionDeclaration('export const NAME = 1;', '0.6.0'),
  /found 0/,
  'a source without the declaration stops the release',
);
checks++;
throws(
  () => withVersionDeclaration(`${entry}\n${entry}`, '0.6.0'),
  /found 2/,
  'a duplicated declaration stops the release',
);
checks++;
throws(
  () => withVersionDeclaration(entry, 'v0.6.0'),
  /not a version this package publishes/,
);
checks++;
throws(
  () => withVersionDeclaration(entry, '0.6.0-beta.1'),
  /not a version this package publishes/,
  'only the unstable prerelease tag is ours to publish',
);

// --- closing out the changelog on a stable cut ---

const changelog = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '- A thing.',
  '',
  '## [0.5.1] — 2026-08-02',
  '',
  '- An older thing.',
  '',
].join('\n');

const promoted = promoteUnreleased(changelog, '0.6.0', '2026-08-18');
checks++;
strictEqual(
  promoted.changelog,
  [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [0.6.0] — 2026-08-18',
    '',
    '### Added',
    '',
    '- A thing.',
    '',
    '## [0.5.1] — 2026-08-02',
    '',
    '- An older thing.',
    '',
  ].join('\n'),
);
checks++;
strictEqual(promoted.notes, '### Added\n\n- A thing.');

// The section runs to the end of the file when no release has been recorded yet.
checks++;
strictEqual(
  promoteUnreleased(
    '# Changelog\n\n## [Unreleased]\n\n- The first thing.\n',
    '0.1.0',
    '2026-08-18',
  ).notes,
  '- The first thing.',
);

checks++;
throws(
  () =>
    promoteUnreleased(
      '# Changelog\n\n## [Unreleased]\n\n## [0.5.1] — 2026-08-02\n',
      '0.6.0',
      '2026-08-18',
    ),
  /section is empty/,
  'a release with nothing recorded stops rather than shipping a bare heading',
);
checks++;
throws(
  () => promoteUnreleased('# Changelog\n', '0.6.0', '2026-08-18'),
  /no "## \[Unreleased\]" heading/,
);

console.log(`release decisions: ${checks} checks passed`);
