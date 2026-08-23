import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(packageDir, 'bin', 'boxel.js');

interface ReviewDocument {
  number: number;
  state: string;
  generation: number;
  source: { branch: string; checkpointHash: string };
  target: { branch: string; checkpointHash: string };
}

interface MergeResult {
  state: 'ready';
  review: ReviewDocument;
  mergeCheckpointHash: string;
  historyHead: string;
  indexGenerationHash: string;
  targetBranch: string;
}

interface TeammateResult {
  teammate: string;
  branch: string;
  review: number;
  sourceCheckpointHash: string;
  mergeCheckpointHash: string;
  mergeHistoryHead: string;
  nextCheckpointHash: string;
  nextLock: string;
}

let args = process.argv.slice(2);
if (args[0] === '--') args.shift();
let realmURL = new URL(args[0] ?? 'https://localhost:4201/pretui/');
let runID =
  process.env.PRETUI_REPLAY_ID ??
  new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, '')
    .slice(0, 14);
let sourceVersion = `1.1.0-replay.${runID.replaceAll(/[^0-9A-Za-z-]/g, '-')}`;
let auth = process.env.BOXEL_REALM_SECRET_SEED ? ['--realm-secret-seed'] : [];

async function runBoxel(
  args: string[],
  options: { echoOutput?: boolean } = {},
): Promise<string> {
  let printable = ['boxel', ...args].join(' ');
  console.error(`\n$ ${printable}`);
  let { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cli, ...args],
    {
      cwd: packageDir,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (stderr.trim()) console.error(stderr.trim());
  if (options.echoOutput !== false && stdout.trim()) {
    console.error(stdout.trim());
  }
  return stdout.trim();
}

async function runJSON<T>(args: string[]): Promise<T> {
  let output = await runBoxel(args, { echoOutput: false });
  let objectStart = output.indexOf('{');
  let arrayStart = output.indexOf('[');
  let start =
    objectStart === -1
      ? arrayStart
      : arrayStart === -1
        ? objectStart
        : Math.min(objectStart, arrayStart);
  if (start === -1) throw new Error('Boxel CLI did not return JSON');
  return JSON.parse(output.slice(start)) as T;
}

async function replacePatternStrict(
  file: string,
  pattern: RegExp,
  after: string,
): Promise<void> {
  let source = await readFile(file, 'utf8');
  let updated = source.replace(pattern, after);
  if (updated === source) {
    throw new Error(`${file} does not contain the expected source pattern`);
  }
  await writeFile(file, updated);
}

async function updateWorkspaceLock(
  checkout: string,
  teammate: string,
): Promise<string> {
  let version = '1.1.0-dev.1';
  let packageFile = join(checkout, 'workspaces', teammate, 'package.json');
  let importMapFile = join(checkout, 'workspaces', teammate, 'importmap.json');
  let packageJSON = JSON.parse(await readFile(packageFile, 'utf8'));
  let importMap = JSON.parse(await readFile(importMapFile, 'utf8'));
  packageJSON.dependencies['@cardstack/pretui'] = '^1.1.0-0';
  importMap.imports['@cardstack/pretui'] = `@cardstack/pretui@${version}/`;
  await writeFile(packageFile, `${JSON.stringify(packageJSON, null, 2)}\n`);
  await writeFile(importMapFile, `${JSON.stringify(importMap, null, 2)}\n`);
  return version;
}

async function assertWorkspaceLock(
  checkout: string,
  teammate: string,
  version: string,
): Promise<void> {
  let importMap = JSON.parse(
    await readFile(
      join(checkout, 'workspaces', teammate, 'importmap.json'),
      'utf8',
    ),
  );
  if (
    importMap.imports['@cardstack/pretui'] !== `@cardstack/pretui@${version}/`
  ) {
    throw new Error(`${teammate}'s exact import-map lock was not restored`);
  }
}

async function roundTripBranch(
  checkout: string,
  branch: string,
  teammate: string,
  version: string,
): Promise<void> {
  await runJSON([
    'realm',
    'branch',
    'switch',
    checkout,
    'main',
    '--json',
    ...auth,
  ]);
  await runJSON([
    'realm',
    'branch',
    'switch',
    checkout,
    branch,
    '--json',
    ...auth,
  ]);
  await assertWorkspaceLock(checkout, teammate, version);
}

async function createWorkspace(branch: string): Promise<string> {
  await runJSON([
    'realm',
    'branch',
    'create',
    realmURL.href,
    branch,
    '--from',
    'main',
    '--json',
    ...auth,
  ]);
  let checkout = await mkdtemp(join(tmpdir(), 'pretui-teammate-'));
  await runBoxel([
    'realm',
    'pull',
    realmURL.href,
    checkout,
    '--branch',
    branch,
    '--no-claude-skills',
    ...auth,
  ]);
  return checkout;
}

async function checkpoint(
  checkout: string,
  message: string,
): Promise<{ checkpointHash: string }> {
  return runJSON([
    'realm',
    'checkpoint',
    checkout,
    '--message',
    message,
    '--json',
    ...auth,
  ]);
}

async function reviewAndMerge(
  checkout: string,
  title: string,
  body: string,
): Promise<{ review: ReviewDocument; merge: MergeResult }> {
  let review = await runJSON<ReviewDocument>([
    'realm',
    'review',
    'open',
    checkout,
    '--target',
    'main',
    '--title',
    title,
    '--body',
    body,
    '--json',
    ...auth,
  ]);
  let observed = await runJSON<ReviewDocument>([
    'realm',
    'review',
    'show',
    realmURL.href,
    String(review.number),
    '--json',
    ...auth,
  ]);
  if (
    observed.generation !== review.generation ||
    observed.source.checkpointHash !== review.source.checkpointHash
  ) {
    throw new Error(`Review #${review.number} was not a fixed candidate`);
  }
  let merge = await runJSON<MergeResult>([
    'realm',
    'review',
    'merge',
    realmURL.href,
    String(review.number),
    '--message',
    `Merge Review #${review.number}: ${title}`,
    '--json',
    ...auth,
  ]);
  if (merge.review.state !== 'merged') {
    throw new Error(`Review #${review.number} did not merge`);
  }
  return { review, merge };
}

async function replayJo(): Promise<TeammateResult> {
  let teammate = 'jo';
  let branch = `replay/${runID}-compact-actions`;
  let checkout = await createWorkspace(branch);
  try {
    await replacePatternStrict(
      join(checkout, 'controls', 'button.gts'),
      /sourceVersion = '[^']+';/,
      `sourceVersion = '${sourceVersion}';`,
    );
    await replacePatternStrict(
      join(checkout, 'controls', 'button.gts'),
      /padding: [^;]+; border: [^;]+;/,
      'padding: .85rem 1.15rem; border: 2px solid #6c4cff;',
    );
    await replacePatternStrict(
      join(checkout, 'cards', 'design-review.gts'),
      /static sourceVersion = '[^']+';/,
      `static sourceVersion = '${sourceVersion}';`,
    );
    await runBoxel(['realm', 'push', checkout, realmURL.href, ...auth]);
    let candidate = await checkpoint(
      checkout,
      'Jo: compact action controls and their review card',
    );
    let { review, merge } = await reviewAndMerge(
      checkout,
      'Make compact actions unmistakably interactive',
      'Updates the shared Button contract and the Design Review card that consumes it.',
    );

    let nextLock = await updateWorkspaceLock(checkout, teammate);
    await runBoxel(['realm', 'sync', checkout, realmURL.href, ...auth]);
    let next = await checkpoint(
      checkout,
      'Jo: lock the workbench to the next PretUI development train',
    );
    await roundTripBranch(checkout, branch, teammate, nextLock);
    return {
      teammate,
      branch,
      review: review.number,
      sourceCheckpointHash: candidate.checkpointHash,
      mergeCheckpointHash: merge.mergeCheckpointHash,
      mergeHistoryHead: merge.historyHead,
      nextCheckpointHash: next.checkpointHash,
      nextLock,
    };
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
}

async function replayAna(): Promise<TeammateResult> {
  let teammate = 'ana';
  let branch = `replay/${runID}-status-fields`;
  let checkout = await createWorkspace(branch);
  try {
    await replacePatternStrict(
      join(checkout, 'controls', 'toggle.gts'),
      /sourceVersion = '[^']+';/,
      `sourceVersion = '${sourceVersion}';`,
    );
    await replacePatternStrict(
      join(checkout, 'controls', 'toggle.gts'),
      /border: [^;]+; border-radius: [^;]+; background: [^;]+;/,
      'border: 2px solid #087f5b; border-radius: 999px; background: #e8fff6;',
    );
    await replacePatternStrict(
      join(checkout, 'fields', 'status-field.gts'),
      /static sourceVersion = '[^']+';/,
      `static sourceVersion = '${sourceVersion}';`,
    );
    await replacePatternStrict(
      join(checkout, 'cards', 'customer-profile.gts'),
      /static sourceVersion = '[^']+';/,
      `static sourceVersion = '${sourceVersion}';`,
    );
    await runBoxel(['realm', 'sync', checkout, realmURL.href, ...auth]);
    let candidate = await checkpoint(
      checkout,
      'Ana: carry visible status through controls, fields, and cards',
    );
    let { review, merge } = await reviewAndMerge(
      checkout,
      'Carry status semantics through the card stack',
      'Updates Toggle, Status Field, and Customer Profile as one cross-layer change.',
    );

    let nextLock = await updateWorkspaceLock(checkout, teammate);
    await runBoxel(['realm', 'push', checkout, realmURL.href, ...auth]);
    let next = await checkpoint(
      checkout,
      'Ana: lock the field workbench to the next PretUI development train',
    );
    await roundTripBranch(checkout, branch, teammate, nextLock);
    return {
      teammate,
      branch,
      review: review.number,
      sourceCheckpointHash: candidate.checkpointHash,
      mergeCheckpointHash: merge.mergeCheckpointHash,
      mergeHistoryHead: merge.historyHead,
      nextCheckpointHash: next.checkpointHash,
      nextLock,
    };
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
}

let teammates = [await replayJo(), await replayAna()];
let reviews = await runJSON<{ reviews: ReviewDocument[] }>([
  'realm',
  'review',
  'list',
  realmURL.href,
  '--json',
  ...auth,
]);
for (let teammate of teammates) {
  let review = reviews.reviews.find(
    (candidate) => candidate.number === teammate.review,
  );
  if (review?.state !== 'merged') {
    throw new Error(`Review #${teammate.review} is not durably merged`);
  }
}

console.log(
  JSON.stringify(
    {
      schema: 'boxel-pretui-cli-collaboration-replay-v1',
      state: 'ready',
      realmURL: realmURL.href,
      runID,
      teammates,
    },
    null,
    2,
  ),
);
