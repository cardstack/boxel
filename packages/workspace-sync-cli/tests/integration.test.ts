#!/usr/bin/env tsx
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { realmPassword } from '../../matrix/helpers/realm-credentials.js';
import { startTestRealmServer, TestRealmServer } from './start-test-realm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

class TestRunner {
  private context: TestContext;
  private testsPassed = 0;
  private testsFailed = 0;

  constructor() {
    this.context = {
      tempDir: '',
      localDir: '',
      realmDir: '',
    };
  }

  async setup() {
    console.log('🔧 Setting up test environment...\n');

    // Create temp directories
    this.context.tempDir = await fs.mkdtemp(
      path.join(tmpdir(), 'workspace-sync-test-'),
    );
    this.context.localDir = path.join(this.context.tempDir, 'local');
    this.context.realmDir = path.join(this.context.tempDir, 'realm');

    await fs.mkdir(this.context.localDir, { recursive: true });
    await fs.mkdir(this.context.realmDir, { recursive: true });

    // Create initial realm content
    await this.createRealmContent();

    // Start realm server
    await this.startRealmServer();
  }

  async createRealmContent() {
    // Create some test files in the realm directory
    await fs.writeFile(
      path.join(this.context.realmDir, 'card1.json'),
      JSON.stringify({ title: 'Test Card 1', type: 'card' }, null, 2),
    );

    await fs.mkdir(path.join(this.context.realmDir, 'nested'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(this.context.realmDir, 'nested', 'card2.json'),
      JSON.stringify({ title: 'Test Card 2', type: 'card' }, null, 2),
    );

    await fs.writeFile(
      path.join(this.context.realmDir, 'module.gts'),
      `import { Component } from '@glimmer/component';
export default class TestComponent extends Component {
  message = 'Hello from test';
}`,
    );

    // Create a file that should be ignored
    await fs.writeFile(
      path.join(this.context.realmDir, '.hidden'),
      'This should be ignored',
    );
  }

  async startRealmServer() {
    console.log('🚀 Starting realm server...');

    try {
      this.context.realmServer = await startTestRealmServer(
        this.context.realmDir,
        path.join(this.context.tempDir, 'realms'),
      );
      console.log('✅ Realm server is ready!\n');
    } catch (error) {
      console.error('❌ Failed to start realm server:', error);
      throw error;
    }
  }

  async runCommand(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const testPassword = await realmPassword(TEST_USERNAME, REALM_SECRET_SEED);
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          MATRIX_URL,
          MATRIX_USERNAME: TEST_USERNAME,
          MATRIX_PASSWORD: testPassword,
        },
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

  async test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      this.testsPassed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.error(`   ${error}`);
      this.testsFailed++;
    }
  }

  async runTests() {
    console.log('🧪 Running integration tests...\n');

    const pushCmd = path.join(__dirname, '..', 'dist', 'push.js');
    const pullCmd = path.join(__dirname, '..', 'dist', 'pull.js');

    // Test 1: Pull from realm to local
    await this.test('Pull files from realm to local directory', async () => {
      const result = await this.runCommand(
        'node',
        [
          pullCmd,
          `http://localhost:${REALM_PORT}/test/`,
          this.context.localDir,
        ],
        process.cwd(),
      );

      if (result.code !== 0) {
        throw new Error(`Pull command failed: ${result.stderr}`);
      }

      // Verify files were pulled
      const card1 = await fs.readFile(
        path.join(this.context.localDir, 'card1.json'),
        'utf-8',
      );
      const parsed = JSON.parse(card1);
      if (parsed.title !== 'Test Card 1') {
        throw new Error('card1.json content mismatch');
      }

      const card2Exists = await fs
        .access(path.join(this.context.localDir, 'nested', 'card2.json'))
        .then(() => true)
        .catch(() => false);
      if (!card2Exists) {
        throw new Error('nested/card2.json was not pulled');
      }

      const hiddenExists = await fs
        .access(path.join(this.context.localDir, '.hidden'))
        .then(() => true)
        .catch(() => false);
      if (hiddenExists) {
        throw new Error('.hidden file should not have been pulled');
      }
    });

    // Test 2: Modify local files and push back
    await this.test('Push modified files from local to realm', async () => {
      // Modify existing file
      await fs.writeFile(
        path.join(this.context.localDir, 'card1.json'),
        JSON.stringify(
          { title: 'Modified Card 1', type: 'card', modified: true },
          null,
          2,
        ),
      );

      // Add new file
      await fs.writeFile(
        path.join(this.context.localDir, 'new-card.json'),
        JSON.stringify({ title: 'New Card', type: 'card' }, null, 2),
      );

      const result = await this.runCommand(
        'node',
        [
          pushCmd,
          this.context.localDir,
          `http://localhost:${REALM_PORT}/test/`,
        ],
        process.cwd(),
      );

      if (result.code !== 0) {
        throw new Error(`Push command failed: ${result.stderr}`);
      }

      // Pull again to verify changes
      const verifyDir = path.join(this.context.tempDir, 'verify');
      await fs.mkdir(verifyDir, { recursive: true });

      const pullResult = await this.runCommand(
        'node',
        [pullCmd, `http://localhost:${REALM_PORT}/test/`, verifyDir],
        process.cwd(),
      );

      if (pullResult.code !== 0) {
        throw new Error(`Verification pull failed: ${pullResult.stderr}`);
      }

      const modifiedCard = await fs.readFile(
        path.join(verifyDir, 'card1.json'),
        'utf-8',
      );
      const parsed = JSON.parse(modifiedCard);
      if (!parsed.modified) {
        throw new Error('card1.json was not properly updated');
      }

      const newCardExists = await fs
        .access(path.join(verifyDir, 'new-card.json'))
        .then(() => true)
        .catch(() => false);
      if (!newCardExists) {
        throw new Error('new-card.json was not pushed');
      }
    });

    // Test 3: Test --delete option
    await this.test(
      'Pull with --delete removes extra local files',
      async () => {
        // Add an extra file locally
        await fs.writeFile(
          path.join(this.context.localDir, 'should-be-deleted.json'),
          JSON.stringify({ delete: 'me' }),
        );

        const result = await this.runCommand(
          'node',
          [
            pullCmd,
            `http://localhost:${REALM_PORT}/test/`,
            this.context.localDir,
            '--delete',
          ],
          process.cwd(),
        );

        if (result.code !== 0) {
          throw new Error(`Pull with --delete failed: ${result.stderr}`);
        }

        const deletedExists = await fs
          .access(path.join(this.context.localDir, 'should-be-deleted.json'))
          .then(() => true)
          .catch(() => false);
        if (deletedExists) {
          throw new Error('Extra file was not deleted with --delete option');
        }
      },
    );

    // Test 4: Test --dry-run option
    await this.test('Push with --dry-run does not modify realm', async () => {
      // Create a file that would be pushed
      await fs.writeFile(
        path.join(this.context.localDir, 'dry-run-test.json'),
        JSON.stringify({ title: 'Should not be pushed' }),
      );

      const result = await this.runCommand(
        'node',
        [
          pushCmd,
          this.context.localDir,
          `http://localhost:${REALM_PORT}/test/`,
          '--dry-run',
        ],
        process.cwd(),
      );

      if (result.code !== 0) {
        throw new Error(`Push --dry-run failed: ${result.stderr}`);
      }

      // Verify the file was not actually pushed
      const checkDir = path.join(this.context.tempDir, 'dry-run-check');
      await fs.mkdir(checkDir, { recursive: true });

      await this.runCommand(
        'node',
        [pullCmd, `http://localhost:${REALM_PORT}/test/`, checkDir],
        process.cwd(),
      );

      const dryRunExists = await fs
        .access(path.join(checkDir, 'dry-run-test.json'))
        .then(() => true)
        .catch(() => false);
      if (dryRunExists) {
        throw new Error('--dry-run should not have pushed the file');
      }
    });

    // Test 5: Test .boxelignore
    await this.test('Respects .boxelignore patterns', async () => {
      // Create .boxelignore
      await fs.writeFile(
        path.join(this.context.localDir, '.boxelignore'),
        '*.ignore\nignore-dir/\n',
      );

      // Create files that should be ignored
      await fs.writeFile(
        path.join(this.context.localDir, 'test.ignore'),
        'Should be ignored',
      );

      await fs.mkdir(path.join(this.context.localDir, 'ignore-dir'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(this.context.localDir, 'ignore-dir', 'ignored.json'),
        JSON.stringify({ ignored: true }),
      );

      const result = await this.runCommand(
        'node',
        [
          pushCmd,
          this.context.localDir,
          `http://localhost:${REALM_PORT}/test/`,
        ],
        process.cwd(),
      );

      if (result.code !== 0) {
        throw new Error(`Push with .boxelignore failed: ${result.stderr}`);
      }

      // Verify ignored files were not pushed
      const checkDir = path.join(this.context.tempDir, 'ignore-check');
      await fs.mkdir(checkDir, { recursive: true });

      await this.runCommand(
        'node',
        [pullCmd, `http://localhost:${REALM_PORT}/test/`, checkDir],
        process.cwd(),
      );

      const ignoredFileExists = await fs
        .access(path.join(checkDir, 'test.ignore'))
        .then(() => true)
        .catch(() => false);
      if (ignoredFileExists) {
        throw new Error('.boxelignore pattern *.ignore was not respected');
      }

      const ignoredDirExists = await fs
        .access(path.join(checkDir, 'ignore-dir'))
        .then(() => true)
        .catch(() => false);
      if (ignoredDirExists) {
        throw new Error('.boxelignore pattern ignore-dir/ was not respected');
      }
    });
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up...');

    if (this.context.realmServer) {
      await this.context.realmServer.stop();
    }

    await fs.rm(this.context.tempDir, { recursive: true, force: true });
  }

  printSummary() {
    console.log('\n📊 Test Summary:');
    console.log(`   ✅ Passed: ${this.testsPassed}`);
    console.log(`   ❌ Failed: ${this.testsFailed}`);
    console.log(`   📋 Total: ${this.testsPassed + this.testsFailed}`);

    if (this.testsFailed > 0) {
      console.log('\n❌ Some tests failed!');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
    }
  }

  async run() {
    try {
      await this.setup();
      await this.runTests();
    } catch (error) {
      console.error('\n💥 Test runner error:', error);
      process.exit(1);
    } finally {
      await this.cleanup();
      this.printSummary();
    }
  }
}

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

// Main execution
async function main() {
  console.log('🧪 Workspace Sync CLI Integration Tests\n');

  await checkDependencies();

  const runner = new TestRunner();
  await runner.run();
}

main().catch((error) => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
