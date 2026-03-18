import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { getActiveProfile, parseArgs } from './lib/boxel.mjs';

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'z').toLowerCase();
}

function runCommand(command, args, options = {}) {
  let result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });

  if (result.status !== 0) {
    let details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${details}`);
  }

  return result.stdout;
}

function readWorkspaceUrl(realmPath) {
  let syncFile = path.join(realmPath, '.boxel-sync.json');
  if (!fs.existsSync(syncFile)) {
    throw new Error(`Expected synced realm at ${realmPath}; missing .boxel-sync.json`);
  }

  let { workspaceUrl } = JSON.parse(fs.readFileSync(syncFile, 'utf8'));
  if (!workspaceUrl) {
    throw new Error(`No workspaceUrl found in ${syncFile}`);
  }
  return ensureTrailingSlash(workspaceUrl);
}

function walkFiles(rootDir) {
  let results = [];

  function visit(currentDir) {
    for (let entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      let fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  if (fs.existsSync(rootDir)) {
    visit(rootDir);
  }

  return results;
}

function findSpecFiles(specRoot) {
  return walkFiles(specRoot)
    .filter((filePath) => filePath.endsWith('.spec.mjs'))
    .sort();
}

function copyTreeContents(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  let copied = [];
  for (let sourceFile of walkFiles(sourceDir)) {
    let relativePath = path.relative(sourceDir, sourceFile);
    let destinationFile = path.join(destinationDir, relativePath);
    fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
    fs.copyFileSync(sourceFile, destinationFile);
    copied.push(relativePath);
  }

  return copied.sort();
}

function summarizeFailures(report) {
  let failures = [];

  function visitSuite(suite, titlePath = []) {
    let nextTitlePath = suite.title ? [...titlePath, suite.title] : titlePath;
    for (let spec of suite.specs ?? []) {
      let specPath = spec.title ? [...nextTitlePath, spec.title] : nextTitlePath;
      for (let test of spec.tests ?? []) {
        let results = test.results ?? [];
        let failedResults = results.filter((result) => result.status !== 'passed' && result.status !== 'skipped');
        if (failedResults.length === 0) {
          continue;
        }
        let errorText = failedResults
          .flatMap((result) => result.errors ?? [])
          .map((error) => error.message ?? error.value ?? '')
          .filter(Boolean)
          .join('\n');
        failures.push({
          title: specPath.join(' > '),
          outcome: test.outcome ?? failedResults[0]?.status ?? 'failed',
          error: errorText || 'No error text captured',
        });
      }
    }
    for (let child of suite.suites ?? []) {
      visitSuite(child, nextTitlePath);
    }
  }

  for (let suite of report.suites ?? []) {
    visitSuite(suite);
  }

  return failures;
}

let args = parseArgs(process.argv.slice(2));
let sourceRealmPath = path.resolve(args['realm-path'] ?? args._[0] ?? 'realms/software-factory-demo');
let sourceRealmUrl = ensureTrailingSlash(args['realm-url'] ?? readWorkspaceUrl(sourceRealmPath));
let specRoot = path.resolve(sourceRealmPath, args['spec-dir'] ?? 'tests');
let fixturesRoot = path.resolve(sourceRealmPath, args['fixtures-dir'] ?? 'tests/fixtures');
let sourceRealmName = path.basename(sourceRealmPath);
let endpoint = args.endpoint ?? `${sourceRealmName}-test-${timestampSlug()}`;
let credentials = getActiveProfile();
let scratchRoot = path.resolve(
  args['scratch-root'] ??
    path.join('realms', new URL(credentials.realmServerUrl).hostname, credentials.username),
);
let scratchPath = path.join(scratchRoot, endpoint);

if (fs.existsSync(scratchPath)) {
  throw new Error(`Scratch realm path already exists: ${scratchPath}`);
}

let specFiles = findSpecFiles(specRoot);
if (specFiles.length === 0) {
  throw new Error(`No realm-hosted spec files were found under ${specRoot}`);
}

let scratchRealmUrl = ensureTrailingSlash(
  args['scratch-url'] ?? new URL(`${credentials.username}/${endpoint}/`, credentials.realmServerUrl).href,
);
let scratchName = args.name ?? `${sourceRealmName} Test ${new Date().toISOString()}`;

fs.mkdirSync(scratchRoot, { recursive: true });

runCommand('boxel', ['create', endpoint, scratchName]);
runCommand('boxel', ['pull', scratchRealmUrl, scratchPath]);

let copiedFixtures = copyTreeContents(fixturesRoot, scratchPath);
runCommand('boxel', ['sync', scratchPath, scratchRealmUrl, '--prefer-local']);

let reportFile = path.join(os.tmpdir(), `${endpoint}-playwright-report.json`);
let playwrightConfig = path.resolve(process.cwd(), 'playwright.realm.config.mjs');
let playwrightEnv = {
  BOXEL_SOURCE_REALM_PATH: sourceRealmPath,
  BOXEL_SOURCE_REALM_URL: sourceRealmUrl,
  BOXEL_TEST_REALM_PATH: scratchPath,
  BOXEL_TEST_REALM_URL: scratchRealmUrl,
  PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
};
let relativeSpecFiles = specFiles.map((filePath) => path.relative(sourceRealmPath, filePath));

let testRun = spawnSync(
  'npx',
  ['playwright', 'test', '--config', playwrightConfig, '--reporter=line,json', ...relativeSpecFiles],
  {
    cwd: sourceRealmPath,
    encoding: 'utf8',
    env: { ...process.env, ...playwrightEnv },
  },
);

let report = fs.existsSync(reportFile)
  ? JSON.parse(fs.readFileSync(reportFile, 'utf8'))
  : { stats: {}, suites: [] };
let failures = summarizeFailures(report);

let summary = {
  sourceRealmPath,
  sourceRealmUrl,
  scratchPath,
  scratchRealmUrl,
  specFiles: specFiles.map((filePath) => path.relative(process.cwd(), filePath)),
  copiedFixtures,
  expected: report.stats?.expected ?? 0,
  unexpected: report.stats?.unexpected ?? failures.length,
  skipped: report.stats?.skipped ?? 0,
  failures,
};

console.log(JSON.stringify(summary, null, 2));

if (testRun.status !== 0) {
  process.exit(testRun.status ?? 1);
}
