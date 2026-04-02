import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { getActiveProfile, parseArgs } from './lib/boxel';
import { ensureTrailingSlash } from './lib/realm-operations';

type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

type PlaywrightError = {
  message?: string;
  value?: string;
};

type PlaywrightResult = {
  status?: string;
  errors?: PlaywrightError[];
};

type PlaywrightTest = {
  outcome?: string;
  results?: PlaywrightResult[];
};

type PlaywrightSpec = {
  title?: string;
  tests?: PlaywrightTest[];
};

type PlaywrightSuite = {
  title?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
};

type PlaywrightReport = {
  stats?: {
    expected?: number;
    unexpected?: number;
    skipped?: number;
  };
  suites?: PlaywrightSuite[];
};

type FailureSummary = {
  title: string;
  outcome: string;
  error: string;
};

function timestampSlug(date: Date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'z')
    .toLowerCase();
}

function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): string {
  let spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  };
  let result = spawnSync(command, args, spawnOptions);

  if (result.status !== 0) {
    let details = [result.stdout, result.stderr]
      .filter((value): value is string => Boolean(value))
      .join('\n')
      .trim();
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${details}`);
  }

  return result.stdout;
}

function readWorkspaceUrl(realmPath: string): string {
  let syncFile = join(realmPath, '.boxel-sync.json');
  if (!existsSync(syncFile)) {
    throw new Error(
      `Expected synced realm at ${realmPath}; missing .boxel-sync.json`,
    );
  }

  let { workspaceUrl } = JSON.parse(readFileSync(syncFile, 'utf8')) as {
    workspaceUrl?: string;
  };
  if (!workspaceUrl) {
    throw new Error(`No workspaceUrl found in ${syncFile}`);
  }
  return ensureTrailingSlash(workspaceUrl);
}

function walkFiles(rootDir: string): string[] {
  let results: string[] = [];

  function visit(currentDir: string) {
    for (let entry of readdirSync(currentDir, { withFileTypes: true })) {
      let fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  if (existsSync(rootDir)) {
    visit(rootDir);
  }

  return results;
}

function findSpecFiles(specRoot: string): string[] {
  return walkFiles(specRoot)
    .filter((filePath) => filePath.endsWith('.spec.ts'))
    .sort();
}

function copyTreeContents(sourceDir: string, destinationDir: string): string[] {
  if (!existsSync(sourceDir)) {
    return [];
  }

  let copied: string[] = [];
  for (let sourceFile of walkFiles(sourceDir)) {
    let relativePath = relative(sourceDir, sourceFile);
    let destinationFile = join(destinationDir, relativePath);
    mkdirSync(dirname(destinationFile), { recursive: true });
    copyFileSync(sourceFile, destinationFile);
    copied.push(relativePath);
  }

  return copied.sort();
}

function summarizeFailures(report: PlaywrightReport): FailureSummary[] {
  let failures: FailureSummary[] = [];

  function visitSuite(suite: PlaywrightSuite, titlePath: string[] = []) {
    let nextTitlePath = suite.title ? [...titlePath, suite.title] : titlePath;
    for (let spec of suite.specs ?? []) {
      let specPath = spec.title
        ? [...nextTitlePath, spec.title]
        : nextTitlePath;
      for (let test of spec.tests ?? []) {
        let results = test.results ?? [];
        let failedResults = results.filter(
          (result) => result.status !== 'passed' && result.status !== 'skipped',
        );
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
let sourceRealmPath = resolve(
  typeof args['realm-path'] === 'string'
    ? args['realm-path']
    : (args._[0] ?? 'realms/software-factory-demo'),
);
let sourceRealmUrl = ensureTrailingSlash(
  typeof args['realm-url'] === 'string'
    ? args['realm-url']
    : readWorkspaceUrl(sourceRealmPath),
);
let specRoot = resolve(
  sourceRealmPath,
  typeof args['spec-dir'] === 'string' ? args['spec-dir'] : 'tests',
);
let fixturesRoot = resolve(
  sourceRealmPath,
  typeof args['fixtures-dir'] === 'string'
    ? args['fixtures-dir']
    : 'tests/fixtures',
);
let sourceRealmName = basename(sourceRealmPath);
let endpoint =
  typeof args.endpoint === 'string'
    ? args.endpoint
    : `${sourceRealmName}-test-${timestampSlug()}`;
let credentials = getActiveProfile();
let scratchRoot = resolve(
  typeof args['scratch-root'] === 'string'
    ? args['scratch-root']
    : join(
        'realms',
        new URL(credentials.realmServerUrl).hostname,
        credentials.username,
      ),
);
let scratchPath = join(scratchRoot, endpoint);

if (existsSync(scratchPath)) {
  throw new Error(`Scratch realm path already exists: ${scratchPath}`);
}

let specFiles = findSpecFiles(specRoot);
if (specFiles.length === 0) {
  throw new Error(`No realm-hosted spec files were found under ${specRoot}`);
}

let scratchRealmUrl = ensureTrailingSlash(
  typeof args['scratch-url'] === 'string'
    ? args['scratch-url']
    : new URL(
        `${credentials.username}/${endpoint}/`,
        credentials.realmServerUrl,
      ).href,
);
let scratchName =
  typeof args.name === 'string'
    ? args.name
    : `${sourceRealmName} Test ${new Date().toISOString()}`;

mkdirSync(scratchRoot, { recursive: true });

runCommand('boxel', ['create', endpoint, scratchName]);
runCommand('boxel', ['pull', scratchRealmUrl, scratchPath]);

let copiedFixtures = copyTreeContents(fixturesRoot, scratchPath);
runCommand('boxel', ['sync', scratchPath, scratchRealmUrl, '--prefer-local']);

let reportFile = join(tmpdir(), `${endpoint}-playwright-report.json`);
let playwrightConfig = resolve(process.cwd(), 'playwright.realm.config.ts');
let playwrightEnv: NodeJS.ProcessEnv = {
  BOXEL_SOURCE_REALM_PATH: sourceRealmPath,
  BOXEL_SOURCE_REALM_URL: sourceRealmUrl,
  BOXEL_TEST_REALM_PATH: scratchPath,
  BOXEL_TEST_REALM_URL: scratchRealmUrl,
  PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
};
let relativeSpecFiles = specFiles.map((filePath) =>
  relative(sourceRealmPath, filePath),
);

let testRun = spawnSync(
  'npx',
  [
    'playwright',
    'test',
    '--config',
    playwrightConfig,
    '--reporter=line,json',
    ...relativeSpecFiles,
  ],
  {
    cwd: sourceRealmPath,
    encoding: 'utf8',
    env: { ...process.env, ...playwrightEnv },
  },
);

let report: PlaywrightReport = existsSync(reportFile)
  ? (JSON.parse(readFileSync(reportFile, 'utf8')) as PlaywrightReport)
  : { stats: {}, suites: [] };
let failures = summarizeFailures(report);

let summary = {
  sourceRealmPath,
  sourceRealmUrl,
  scratchPath,
  scratchRealmUrl,
  specFiles: specFiles.map((filePath) => relative(process.cwd(), filePath)),
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
