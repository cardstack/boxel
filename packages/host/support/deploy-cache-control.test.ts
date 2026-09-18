// Runs the real `ember-cli-deploy-s3` plugin against the real `config/deploy.js`
// with the S3 client stubbed out, so what these tests read is the plugin's own
// file matching and the exact `Cache-Control` each file would be uploaded with —
// not a second implementation of either.
//
// Run with: pnpm --dir packages/host test:deploy-cache-control

import { strict as assert } from 'assert';
import { createRequire } from 'module';
import { existsSync, readdirSync } from 'fs';
import { isAbsolute, join, relative } from 'path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const hostDir = join(import.meta.dirname, '..');
const deployConfig = require(join(hostDir, 'config', 'deploy.js'));
const s3Plugin = require('ember-cli-deploy-s3');

// The deploy workflow supplies these; the plugin refuses to configure without
// them, and nothing here reaches a bucket.
process.env.AWS_S3_BUCKET ??= 'cardstack-boxel-host-test';
process.env.AWS_REGION ??= 'us-east-1';

// Paths a deployed host build serves — every stable-named one it has, plus a
// sample of the content-addressed ones. `assets/` is the only place the build
// writes content-addressed filenames; every other path keeps its name across
// builds, which is what makes an immutable directive on one of them a promise
// the filename cannot keep.
const DIST_FILES = [
  'index.html',
  'robots.txt',
  'auth-service-worker.js',
  'test-realm-sw.js',
  'testem.js',
  'boxel-favicon.png',
  'boxel-webclip.png',
  'default-realm-icon.png',
  'boxel-ui-checksum.txt',
  '@embroider/virtual/vendor.js',
  '@embroider/virtual/app.css',
  'test-modules/good.js',
  'tests/index.html',
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
function uploadsFor(deployTarget: string): Promise<Record<string, Upload>> {
  let config = deployConfig(deployTarget);
  // A config that aliases the plugin runs one instance per alias, each reading
  // the ENV key of the same name; an unaliased one runs a single `s3` instance.
  // Both shapes are driven here so the assertions below are what decides.
  let aliases: string[] = config.pipeline.alias?.s3?.as ?? ['s3'];
  let uploads: Record<string, Upload> = {};

  let context = {
    ui: { write() {}, writeLine() {}, verbose: false },
    project: {},
    config,
    distDir: join(hostDir, 'dist'),
    distFiles: DIST_FILES,
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

// Everything above rests on DIST_FILES describing a real dist, and on `assets/`
// being where the build puts content-addressed names. A build that moved its
// hashed output elsewhere would leave those assertions passing over a fiction,
// so this checks the claim against a dist when one is on disk. HOST_DIST_DIR
// names it; the deploy pipeline's own output is checked in the build workflow.
test('the dist paths this suite reasons about are the ones the build writes', (t) => {
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
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    let path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
