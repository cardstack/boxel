import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { module, test } from 'qunit';
import { realmPassword } from '../../matrix/helpers/realm-credentials';
import type { TestRealmServer } from './helpers/start-test-realm';
import { startTestRealmServer } from './helpers/start-test-realm';

const REALM_PORT = 4205; // Using isolated realm server port
const MATRIX_URL = 'http://localhost:8008';
const TEST_USERNAME = 'test_realm'; // Using test_realm username
const REALM_SECRET_SEED = "shhh! it's a secret";

interface TestContext {
  tempDir: string;
  localDir: string;
  realmDir: string;
  realmServer?: TestRealmServer;
}

// Global context for shared realm server
let sharedRealmServer: TestRealmServer;
let sharedRealmDir: string;
let sharedTempDir: string;

let context: TestContext;

// Check if required services are running
async function checkDependencies() {
  console.log('🔍 Checking dependencies...\n');

  // Check if Matrix is running
  try {
    const response = await fetch(MATRIX_URL);
    if (!response.ok) {
      throw new Error('Matrix server is not responding');
    }
    console.log('✅ Matrix server is running');
  } catch (error) {
    console.error('❌ Matrix server is not running at', MATRIX_URL);
    console.error('   Please start Matrix. You can use one of these methods:');
    console.error('   1. From the root directory: pnpm start:all');
    console.error('   2. Or just Matrix: cd matrix && docker-compose up');
    process.exit(1);
  }

  // Check if CLI is built
  const pushCmd = path.join(__dirname, '..', 'dist', 'push.js');
  try {
    await fs.access(pushCmd);
    console.log('✅ workspace-sync-cli is built');
  } catch (error) {
    console.error('❌ workspace-sync-cli is not built');
    console.error(
      '   Please build it using: cd workspace-sync-cli && pnpm build',
    );
    process.exit(1);
  }

  console.log('\n✅ All dependencies are ready\n');
}

async function createRealmContent(realmDir: string) {
  // Create some test files in the realm directory
  await fs.writeFile(
    path.join(realmDir, 'card1.json'),
    JSON.stringify({ title: 'Test Card 1', type: 'card' }, null, 2),
  );

  await fs.writeFile(
    path.join(realmDir, '.realm.json'),
    JSON.stringify({ name: 'Test Realm', version: '1.0.0' }, null, 2),
  );

  await fs.mkdir(path.join(realmDir, 'nested'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(realmDir, 'nested', 'card2.json'),
    JSON.stringify({ title: 'Test Card 2', type: 'card' }, null, 2),
  );

  await fs.writeFile(
    path.join(realmDir, 'module.gts'),
    `import { Component } from '@glimmer/component';
export default class TestComponent extends Component {
  message = 'Hello from test';
}`,
  );

  // Create a file that should be ignored
  await fs.writeFile(path.join(realmDir, '.hidden'), 'This should be ignored');
}

async function clearRealmContent(realmDir: string) {
  // Safely clear realm content without deleting the directory itself
  const items = await fs.readdir(realmDir);
  for (const item of items) {
    const itemPath = path.join(realmDir, item);
    const stat = await fs.stat(itemPath);
    if (stat.isDirectory()) {
      await fs.rm(itemPath, { recursive: true, force: true });
    } else {
      await fs.unlink(itemPath);
    }
  }
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  customEnv?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const testPassword = await realmPassword(TEST_USERNAME, REALM_SECRET_SEED);
  return new Promise((resolve) => {
    const defaultEnv = {
      ...process.env,
      MATRIX_URL,
      MATRIX_USERNAME: TEST_USERNAME,
      MATRIX_PASSWORD: testPassword,
    };

    // If custom env is provided, use it instead of defaults
    const env = customEnv ? { ...process.env, ...customEnv } : defaultEnv;

    const proc = spawn(command, args, {
      cwd,
      env,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code || 0 });
    });
  });
}

module('Workspace Sync CLI Integration Tests', function (hooks) {
  hooks.before(async function () {
    console.log('🧪 Workspace Sync CLI Integration Tests\n');
    await checkDependencies();

    // Create shared realm server once for all tests
    console.log('🚀 Starting shared realm server...');
    sharedTempDir = await fs.mkdtemp(
      path.join(tmpdir(), 'workspace-sync-shared-'),
    );
    sharedRealmDir = path.join(sharedTempDir, 'realm');

    await fs.mkdir(sharedRealmDir, { recursive: true });
    await createRealmContent(sharedRealmDir);

    try {
      sharedRealmServer = await startTestRealmServer(
        sharedRealmDir,
        path.join(sharedTempDir, 'realms'),
      );
      console.log('✅ Shared realm server is ready!\n');
    } catch (error) {
      console.error('❌ Failed to start shared realm server:', error);
      throw error;
    }
  });

  hooks.after(async function () {
    console.log('\n🧹 Cleaning up shared realm server...');

    if (sharedRealmServer) {
      await sharedRealmServer.stop();
    }

    if (sharedTempDir) {
      await fs.rm(sharedTempDir, { recursive: true, force: true });
    }
  });

  hooks.beforeEach(async function () {
    console.log('🔧 Setting up test environment...\n');

    // Create temp directories for this test
    context = {
      tempDir: await fs.mkdtemp(path.join(tmpdir(), 'workspace-sync-test-')),
      localDir: '',
      realmDir: sharedRealmDir, // Use shared realm directory
      realmServer: sharedRealmServer, // Use shared realm server
    };

    context.localDir = path.join(context.tempDir, 'local');
    await fs.mkdir(context.localDir, { recursive: true });

    // Reset realm content between tests (safely)
    await clearRealmContent(sharedRealmDir);
    await createRealmContent(sharedRealmDir);
  });

  hooks.afterEach(async function () {
    console.log('\n🧹 Cleaning up test environment...');

    // Only clean up test-specific temp directory
    if (context?.tempDir) {
      await fs.rm(context.tempDir, { recursive: true, force: true });
    }
  });

  test('Pull files from realm to local directory', async function (assert) {
    const pullCmd = path.join(__dirname, '..', 'dist', 'pull.js');

    const result = await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, context.localDir],
      process.cwd(),
    );

    assert.strictEqual(
      result.code,
      0,
      `Pull command should succeed: ${result.stderr}`,
    );

    // Verify files were pulled
    const card1 = await fs.readFile(
      path.join(context.localDir, 'card1.json'),
      'utf-8',
    );
    const parsed = JSON.parse(card1);
    assert.strictEqual(
      parsed.title,
      'Test Card 1',
      'card1.json content should match',
    );

    const card2Exists = await fs
      .access(path.join(context.localDir, 'nested', 'card2.json'))
      .then(() => true)
      .catch(() => false);
    assert.true(card2Exists, 'nested/card2.json should be pulled');

    const hiddenExists = await fs
      .access(path.join(context.localDir, '.hidden'))
      .then(() => true)
      .catch(() => false);
    assert.false(hiddenExists, '.hidden file should not have been pulled');
  });

  test('Push modified files from local to realm', async function (assert) {
    const pushCmd = path.join(__dirname, '..', 'dist', 'push.js');
    const pullCmd = path.join(__dirname, '..', 'dist', 'pull.js');

    // First pull to get initial files
    await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, context.localDir],
      process.cwd(),
    );

    // Modify existing file
    await fs.writeFile(
      path.join(context.localDir, 'card1.json'),
      JSON.stringify(
        { title: 'Modified Card 1', type: 'card', modified: true },
        null,
        2,
      ),
    );

    // Add new file
    await fs.writeFile(
      path.join(context.localDir, 'new-card.json'),
      JSON.stringify({ title: 'New Card', type: 'card' }, null, 2),
    );

    const result = await runCommand(
      'node',
      [pushCmd, context.localDir, `http://localhost:${REALM_PORT}/test/`],
      process.cwd(),
    );

    assert.strictEqual(
      result.code,
      0,
      `Push command should succeed: ${result.stderr}`,
    );

    // Pull again to verify changes
    const verifyDir = path.join(context.tempDir, 'verify');
    await fs.mkdir(verifyDir, { recursive: true });

    const pullResult = await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, verifyDir],
      process.cwd(),
    );

    assert.strictEqual(
      pullResult.code,
      0,
      `Verification pull should succeed: ${pullResult.stderr}`,
    );

    const modifiedCard = await fs.readFile(
      path.join(verifyDir, 'card1.json'),
      'utf-8',
    );
    const parsed = JSON.parse(modifiedCard);
    assert.true(parsed.modified, 'card1.json should be properly updated');

    const newCardExists = await fs
      .access(path.join(verifyDir, 'new-card.json'))
      .then(() => true)
      .catch(() => false);
    assert.true(newCardExists, 'new-card.json should be pushed');
  });

  test('Pull with --delete removes extra local files', async function (assert) {
    const pullCmd = path.join(__dirname, '..', 'dist', 'pull.js');

    // First pull to get initial files
    await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, context.localDir],
      process.cwd(),
    );

    // Add an extra file locally
    await fs.writeFile(
      path.join(context.localDir, 'should-be-deleted.json'),
      JSON.stringify({ delete: 'me' }),
    );

    const result = await runCommand(
      'node',
      [
        pullCmd,
        `http://localhost:${REALM_PORT}/test/`,
        context.localDir,
        '--delete',
      ],
      process.cwd(),
    );

    assert.strictEqual(
      result.code,
      0,
      `Pull with --delete should succeed: ${result.stderr}`,
    );

    const deletedExists = await fs
      .access(path.join(context.localDir, 'should-be-deleted.json'))
      .then(() => true)
      .catch(() => false);
    assert.false(
      deletedExists,
      'Extra file should be deleted with --delete option',
    );
  });

  test('Push with --dry-run does not modify realm', async function (assert) {
    const pushCmd = path.join(__dirname, '..', 'dist', 'push.js');
    const pullCmd = path.join(__dirname, '..', 'dist', 'pull.js');

    // First pull to get initial files
    await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, context.localDir],
      process.cwd(),
    );

    // Create a file that would be pushed
    await fs.writeFile(
      path.join(context.localDir, 'dry-run-test.json'),
      JSON.stringify({ title: 'Should not be pushed' }),
    );

    const result = await runCommand(
      'node',
      [
        pushCmd,
        context.localDir,
        `http://localhost:${REALM_PORT}/test/`,
        '--dry-run',
      ],
      process.cwd(),
    );

    assert.strictEqual(
      result.code,
      0,
      `Push --dry-run should succeed: ${result.stderr}`,
    );

    // Verify the file was not actually pushed
    const checkDir = path.join(context.tempDir, 'dry-run-check');
    await fs.mkdir(checkDir, { recursive: true });

    await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, checkDir],
      process.cwd(),
    );

    const dryRunExists = await fs
      .access(path.join(checkDir, 'dry-run-test.json'))
      .then(() => true)
      .catch(() => false);
    assert.false(dryRunExists, '--dry-run should not have pushed the file');
  });

  test('Syncs .realm.json files in both directions', async function (assert) {
    const pushCmd = path.join(__dirname, '..', 'dist', 'push.js');
    const pullCmd = path.join(__dirname, '..', 'dist', 'pull.js');

    // Test pulling .realm.json
    const pullResult = await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, context.localDir],
      process.cwd(),
    );

    assert.strictEqual(
      pullResult.code,
      0,
      `Pull .realm.json should succeed: ${pullResult.stderr}`,
    );

    // Verify .realm.json was pulled
    const realmJsonExists = await fs
      .access(path.join(context.localDir, '.realm.json'))
      .then(() => true)
      .catch(() => false);
    assert.true(realmJsonExists, '.realm.json should be pulled from realm');

    const realmJsonContent = await fs.readFile(
      path.join(context.localDir, '.realm.json'),
      'utf-8',
    );
    const realmConfig = JSON.parse(realmJsonContent);
    assert.strictEqual(
      realmConfig.name,
      'Test Realm',
      '.realm.json content should match after pull',
    );

    // Modify .realm.json locally and push it back
    await fs.writeFile(
      path.join(context.localDir, '.realm.json'),
      JSON.stringify(
        { name: 'Modified Test Realm', version: '1.1.0', modified: true },
        null,
        2,
      ),
    );

    const pushResult = await runCommand(
      'node',
      [pushCmd, context.localDir, `http://localhost:${REALM_PORT}/test/`],
      process.cwd(),
    );

    assert.strictEqual(
      pushResult.code,
      0,
      `Push .realm.json should succeed: ${pushResult.stderr}`,
    );

    // Verify the modification was pushed by pulling to a new directory
    const verifyDir = path.join(context.tempDir, 'realm-json-verify');
    await fs.mkdir(verifyDir, { recursive: true });

    const verifyPullResult = await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, verifyDir],
      process.cwd(),
    );

    assert.strictEqual(
      verifyPullResult.code,
      0,
      `Verification pull for .realm.json should succeed: ${verifyPullResult.stderr}`,
    );

    const verifyRealmJsonContent = await fs.readFile(
      path.join(verifyDir, '.realm.json'),
      'utf-8',
    );
    const verifyRealmConfig = JSON.parse(verifyRealmJsonContent);
    assert.true(
      verifyRealmConfig.modified,
      '.realm.json modifications should be properly pushed',
    );
    assert.strictEqual(
      verifyRealmConfig.version,
      '1.1.0',
      '.realm.json version should be updated',
    );
  });

  test('Generates password from REALM_SECRET_SEED when MATRIX_PASSWORD not provided', async function (assert) {
    const pullCmd = path.join(__dirname, '..', 'dist', 'pull.js');

    // Verify files are not there before pulling
    const card1ExistsBefore = await fs
      .access(path.join(context.localDir, 'card1.json'))
      .then(() => true)
      .catch(() => false);
    assert.false(
      card1ExistsBefore,
      'Authentication with generated password should work - card1.json should be pulled',
    );

    // Test using only REALM_SECRET_SEED instead of MATRIX_PASSWORD
    const pullResult = await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, context.localDir],
      process.cwd(),
      {
        // Remove MATRIX_PASSWORD and provide REALM_SECRET_SEED instead
        MATRIX_URL,
        MATRIX_USERNAME: TEST_USERNAME,
        REALM_SECRET_SEED,
        // Don't provide MATRIX_PASSWORD to test the fallback
      },
    );

    assert.strictEqual(
      pullResult.code,
      0,
      `Pull with realm secret should succeed: ${pullResult.stderr}`,
    );

    // Verify files were pulled successfully (basic smoke test)
    const card1ExistsAfter = await fs
      .access(path.join(context.localDir, 'card1.json'))
      .then(() => true)
      .catch(() => false);
    assert.true(
      card1ExistsAfter,
      'Authentication with generated password should work - card1.json should be pulled',
    );
  });

  test('Respects .boxelignore patterns', async function (assert) {
    const pushCmd = path.join(__dirname, '..', 'dist', 'push.js');
    const pullCmd = path.join(__dirname, '..', 'dist', 'pull.js');

    // First pull to get initial files
    await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, context.localDir],
      process.cwd(),
    );

    // Create .boxelignore
    await fs.writeFile(
      path.join(context.localDir, '.boxelignore'),
      '*.ignore\nignore-dir/\n',
    );

    // Create files that should be ignored
    await fs.writeFile(
      path.join(context.localDir, 'test.ignore'),
      'Should be ignored',
    );

    await fs.mkdir(path.join(context.localDir, 'ignore-dir'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(context.localDir, 'ignore-dir', 'ignored.json'),
      JSON.stringify({ ignored: true }),
    );

    const result = await runCommand(
      'node',
      [pushCmd, context.localDir, `http://localhost:${REALM_PORT}/test/`],
      process.cwd(),
    );

    assert.strictEqual(
      result.code,
      0,
      `Push with .boxelignore should succeed: ${result.stderr}`,
    );

    // Verify ignored files were not pushed
    const checkDir = path.join(context.tempDir, 'ignore-check');
    await fs.mkdir(checkDir, { recursive: true });

    await runCommand(
      'node',
      [pullCmd, `http://localhost:${REALM_PORT}/test/`, checkDir],
      process.cwd(),
    );

    const ignoredFileExists = await fs
      .access(path.join(checkDir, 'test.ignore'))
      .then(() => true)
      .catch(() => false);
    assert.false(
      ignoredFileExists,
      '.boxelignore pattern *.ignore should be respected',
    );

    const ignoredDirExists = await fs
      .access(path.join(checkDir, 'ignore-dir'))
      .then(() => true)
      .catch(() => false);
    assert.false(
      ignoredDirExists,
      '.boxelignore pattern ignore-dir/ should be respected',
    );
  });
});
