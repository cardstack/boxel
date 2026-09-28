// Runs the real `ember-cli-deploy-s3` plugin against the real `config/deploy.js`
// with the S3 client stubbed out, so what these tests read is the plugin's own
// file matching and the exact `Cache-Control` each file would be uploaded with —
// not a second implementation of either.
//
// Run with: pnpm --dir packages/host test:deploy-cache-control

import { strict as assert } from 'assert';
import { createRequire } from 'module';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { isAbsolute, join, relative } from 'path';
import { test, type TestContext } from 'node:test';

import {
  contentVersion,
  versionStableShellReferences,
} from '../lib/build/version-stable-shell-references.mjs';

const require = createRequire(import.meta.url);
const hostDir = join(import.meta.dirname, '..');
const deployConfig = require(join(hostDir, 'config', 'deploy.js'));
const s3Plugin = require('ember-cli-deploy-s3');

// The deploy workflow supplies these; the plugin refuses to configure without
// them, and nothing here reaches a bucket.
process.env.AWS_S3_BUCKET ??= 'cardstack-boxel-host-test';
process.env.AWS_REGION ??= 'us-east-1';

// Paths the dist the deploy uploads contains — every stable-named one it has,
// plus a sample of the content-addressed ones. `assets/` is the only place the
// build writes content-addressed filenames; every other path keeps its name
// across builds, which is what makes an immutable directive on one of them a
// promise the filename cannot keep.
//
// The buckets are never pruned, so a path being served by a deployed
// environment says only that some past build emitted it. This list tracks a
// build's own output; the dist check at the bottom is what holds it to that.
const DIST_FILES = [
  'index.html',
  'robots.txt',
  'auth-service-worker.js',
  'test-realm-sw.js',
  'boxel-favicon.png',
  'boxel-webclip.png',
  'default-realm-icon.png',
  'boxel-ui-checksum.txt',
  '@embroider/virtual/vendor.js',
  '@embroider/virtual/vendor.css',
  '@embroider/virtual/app.css',
  'test-modules/good.js',
  'test-modules/bad.js',
  'assets/main-DMcx_nWD.js',
  'assets/main-BlRjxoZ5.css',
  'assets/editor.main-CQnjGZh9.js',
  'assets/ai-assist-icon-animated-C8cXGt-5.webp',
];

// The shell is what pins a browser to a build, so it is named separately from
// the rest: every other stable-named file is covered by the partition assertion.
const SHELL = 'index.html';

interface Upload {
  filePaths: string[];
  cacheControl: string;
  expires?: Date;
  prefix: string;
}

// Drives the configured plugin instances through `configure` + `upload` with the
// upload client replaced, and reports what each pass would have sent to S3.
function uploadsFor(
  deployTarget: string,
  distFiles: string[] = DIST_FILES,
): Promise<Record<string, Upload>> {
  let config = deployConfig(deployTarget);
  // Aliasing the plugin runs one instance per alias, each reading the ENV key
  // of the same name.
  let aliases: string[] = config.pipeline.alias.s3.as;
  let uploads: Record<string, Upload> = {};

  let context = {
    ui: { write() {}, writeLine() {}, verbose: false },
    project: {},
    config,
    distDir: join(hostDir, 'dist'),
    distFiles,
  };

  return Promise.all(
    aliases.map(async (alias) => {
      let plugin = s3Plugin.createDeployPlugin({ name: alias });
      plugin.beforeHook(context);
      // The stub stands in for the AWS client, so `upload` resolves without
      // reaching the network while still running the plugin's own filtering.
      plugin.pluginConfig.uploadClient = {
        upload(options: Upload) {
          uploads[alias] = options;
          return Promise.resolve(options.filePaths);
        },
      };
      plugin.configure(context);
      await plugin.upload();
    }),
  ).then(() => uploads);
}

function immutable(upload: Upload) {
  return /\bimmutable\b/.test(upload.cacheControl);
}

for (let deployTarget of ['staging', 'production']) {
  test(`${deployTarget}: the two upload passes partition the dist`, async () => {
    let uploads = await uploadsFor(deployTarget);
    let uploaded = Object.values(uploads).flatMap((upload) => upload.filePaths);

    // A file matched by neither pass is silently missing from the deploy; a file
    // matched by both is uploaded twice, and which directive survives is a race.
    assert.deepEqual(
      [...uploaded].sort(),
      [...DIST_FILES].sort(),
      'every file is uploaded exactly once',
    );
  });

  test(`${deployTarget}: only content-addressed files are immutable`, async () => {
    let uploads = await uploadsFor(deployTarget);

    for (let [alias, upload] of Object.entries(uploads)) {
      for (let filePath of upload.filePaths) {
        assert.equal(
          immutable(upload),
          filePath.startsWith('assets/'),
          `${filePath} (uploaded by ${alias} as \`${upload.cacheControl}\`)`,
        );
      }
    }
  });

  test(`${deployTarget}: the app shell revalidates`, async () => {
    let uploads = await uploadsFor(deployTarget);
    let shell = Object.values(uploads).find((upload) =>
      upload.filePaths.includes(SHELL),
    );

    assert.ok(shell, `${SHELL} is uploaded`);
    // Without this the browser never asks again, so it keeps loading the bundle
    // named by whichever copy of the shell it cached.
    assert.match(shell.cacheControl, /\bno-cache\b/);
    assert.match(shell.cacheControl, /\bmust-revalidate\b/);
    assert.ok(
      shell.expires && shell.expires.getTime() <= 0,
      'the legacy Expires header is in the past too',
    );
  });
}

for (let deployTarget of ['s3-preview-staging', 's3-preview-production']) {
  test(`${deployTarget}: nothing is immutable and everything is prefixed`, async () => {
    process.env.PR_BRANCH_NAME = 'some-branch';
    let uploads = await uploadsFor(deployTarget);

    assert.ok(Object.keys(uploads).length > 0, 'at least one pass runs');
    for (let [alias, upload] of Object.entries(uploads)) {
      assert.equal(immutable(upload), false, `${alias} revalidates`);
      assert.equal(upload.prefix, 'some-branch', `${alias} is prefixed`);
    }
  });
}

// A stable-named file's cache entry is keyed by its URL, so a browser that
// stored one under a directive that never revalidates keeps running those bytes
// until the shell names the file by a URL it has not cached. These drive the
// shell rewrite the build runs, with the dist it reads from held in memory.
function distOf(files: Record<string, string>) {
  return (relativePath: string) =>
    relativePath in files ? Buffer.from(files[relativePath]) : undefined;
}

function shellNaming(...references: string[]) {
  return `<html><head>${references.join('')}</head><body></body></html>`;
}

function versionOf(html: string, path: string) {
  let reference = new RegExp(`(?:src|href)="/${path}\\?v=([^"&]+)"`).exec(html);
  return reference?.[1];
}

test('the shell names each stable-named file by a digest of its bytes', () => {
  let html = versionStableShellReferences(
    shellNaming(
      '<link rel="stylesheet" href="/@embroider/virtual/app.css" />',
      '<script src="/@embroider/virtual/vendor.js"></script>',
      '<link href="/boxel-favicon.png" rel="icon" />',
    ),
    distOf({
      '@embroider/virtual/app.css': ':root { --z: 1; }',
      '@embroider/virtual/vendor.js': 'window.EmberENV = {};',
      'boxel-favicon.png': 'png bytes',
    }),
  );

  for (let path of [
    '@embroider/virtual/app.css',
    '@embroider/virtual/vendor.js',
    'boxel-favicon.png',
  ]) {
    assert.ok(versionOf(html, path), `${path} carries a version: ${html}`);
  }
});

test("a stable-named file's URL changes exactly when its bytes do", () => {
  let shell = shellNaming(
    '<link rel="stylesheet" href="/@embroider/virtual/app.css" />',
    '<script src="/@embroider/virtual/vendor.js"></script>',
  );
  let before = versionStableShellReferences(
    shell,
    distOf({
      '@embroider/virtual/app.css': ':root { --z: 1; }',
      '@embroider/virtual/vendor.js': 'window.EmberENV = {};',
    }),
  );
  let after = versionStableShellReferences(
    shell,
    distOf({
      '@embroider/virtual/app.css': ':root { --z: 2; }',
      '@embroider/virtual/vendor.js': 'window.EmberENV = {};',
    }),
  );

  assert.notEqual(
    versionOf(after, '@embroider/virtual/app.css'),
    versionOf(before, '@embroider/virtual/app.css'),
    'a changed file is requested under a URL no cache holds yet',
  );
  assert.equal(
    versionOf(after, '@embroider/virtual/vendor.js'),
    versionOf(before, '@embroider/virtual/vendor.js'),
    'an unchanged file keeps its URL, and the copy cached for it',
  );
});

test('references the rewrite has no business versioning are left as written', () => {
  let untouched = [
    // Content-addressed already; its name changes when its bytes do.
    '<script type="module" src="/assets/main-DMcx_nWD.js"></script>',
    // Not the dist's.
    '<script src="//cdn.example.com/lib.js"></script>',
    '<link rel="stylesheet" href="https://fonts.example.com/font.css" />',
    // Already carries a query its author chose.
    '<link rel="stylesheet" href="/@embroider/virtual/app.css?theme=dark" />',
    // Names a path the build did not write.
    '<link href="/not-in-the-dist.png" rel="icon" />',
  ];
  let shell = shellNaming(...untouched);

  assert.equal(
    versionStableShellReferences(
      shell,
      distOf({
        'assets/main-DMcx_nWD.js': 'bundle',
        '@embroider/virtual/app.css': ':root {}',
      }),
    ),
    shell,
  );
});

// Everything above runs a hand-maintained list through the passes, so it can
// only confirm that list against itself. The tests below run a real dist
// instead: the first is the only check that can see a path the patterns miss,
// and the only one that notices the list drifting from what the build emits.
// HOST_DIST_DIR names the dist; the deploy's own output is checked in the build
// workflow, which is the dist that decides whether a deploy is correct.
function builtDist(t: TestContext): string | undefined {
  let named = process.env.HOST_DIST_DIR;
  let dir = (
    named
      ? [isAbsolute(named) ? named : join(hostDir, named)]
      : [join(hostDir, 'dist'), join(hostDir, 'tmp', 'deploy-dist')]
  ).find((candidate) => existsSync(join(candidate, SHELL)));

  if (!dir) {
    // Naming a dist is how a caller says "check this one" — a name that points
    // at nothing is a broken caller, not an absent dist, and skipping there
    // would turn a workflow step into a no-op that still reports green.
    assert.ok(!named, `HOST_DIST_DIR=${named} has no ${SHELL} in it`);
    // Otherwise skip loudly, so a suite that checked nothing never reads as a
    // suite that checked this and was satisfied.
    t.skip('no built dist on disk; set HOST_DIST_DIR to check one');
  }
  return dir;
}

test('a real dist partitions across the two passes', async (t) => {
  let dir = builtDist(t);
  if (!dir) {
    return;
  }

  let built = walk(dir).map((file) => relative(dir, file));

  for (let expected of DIST_FILES) {
    assert.ok(
      built.includes(expected) ||
        // Content-addressed names change every build, so match the shape.
        (expected.startsWith('assets/') &&
          built.some((file) => file.startsWith('assets/'))),
      `the build writes ${expected}`,
    );
  }

  let stableNamedUnderAssets = built.filter(
    (file) =>
      file.startsWith('assets/') && !/-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(file),
  );
  assert.deepEqual(
    stableNamedUnderAssets,
    [],
    'everything under assets/ is content-addressed',
  );

  // The build lists dot-prefixed paths, but the upload plugin filters both
  // passes with `dot: false`, so such a path is uploaded by neither and would
  // be missing from the deploy without failing it. No build emits one; saying
  // so here keeps the partition below an unconditional claim.
  let dotPrefixed = built.filter((file) =>
    file.split('/').some((segment) => segment.startsWith('.')),
  );
  assert.deepEqual(dotPrefixed, [], 'no dot-prefixed paths in the dist');

  let uploads = await uploadsFor('production', built);
  let uploaded = Object.values(uploads).flatMap((upload) => upload.filePaths);
  assert.deepEqual(
    [...uploaded].sort(),
    [...built].sort(),
    'every file the build wrote is uploaded exactly once',
  );

  for (let [alias, upload] of Object.entries(uploads)) {
    for (let filePath of upload.filePaths) {
      assert.equal(
        immutable(upload),
        filePath.startsWith('assets/'),
        `${filePath} (uploaded by ${alias} as \`${upload.cacheControl}\`)`,
      );
    }
  }
});

// The rewrite above is only worth anything if the build runs it, and runs it
// after every file the shell names is on disk. This reads the shell the build
// wrote and holds each stable-named reference in it to the bytes beside it.
// References are found here with a broader pattern than the rewrite's own, so
// a spelling the rewrite does not recognise fails rather than going unchecked.
test("a real dist's shell names each stable-named file by its content", (t) => {
  let dir = builtDist(t);
  if (!dir) {
    return;
  }

  let html = readFileSync(join(dir, SHELL), 'utf8');
  let stableNamed = [
    ...html.matchAll(/\b(?:src|href)=["']?(\/(?!\/)[^"'\s>]+)/g),
  ]
    .map(([, url]) => new URL(url, 'https://dist.invalid'))
    .filter((url) => !url.pathname.startsWith('/assets/'));

  let paths = stableNamed.map((url) => url.pathname.slice(1));
  for (let expected of [
    '@embroider/virtual/vendor.js',
    '@embroider/virtual/app.css',
  ]) {
    assert.ok(paths.includes(expected), `the shell names ${expected}`);
  }

  for (let url of stableNamed) {
    let path = url.pathname.slice(1);
    assert.equal(
      url.searchParams.get('v'),
      contentVersion(readFileSync(join(dir, path))),
      `${path} is named by a digest of the bytes the build wrote there`,
    );
  }
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    let path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
