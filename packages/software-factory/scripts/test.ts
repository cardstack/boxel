import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const packageRoot = resolve(__dirname, '..');

type TestRunnerOptions = {
  nodeOnly: boolean;
  playwrightOnly: boolean;
  headed: boolean;
};

function parseArgs(argv: string[]): TestRunnerOptions {
  let options: TestRunnerOptions = {
    nodeOnly: false,
    playwrightOnly: false,
    headed: false,
  };

  for (let token of argv) {
    switch (token) {
      case '--node-only':
        options.nodeOnly = true;
        break;
      case '--playwright-only':
        options.playwrightOnly = true;
        break;
      case '--headed':
        options.headed = true;
        break;
      default:
        throw new Error(`Unknown test runner flag: ${token}`);
    }
  }

  if (options.nodeOnly && options.playwrightOnly) {
    throw new Error('Choose only one of --node-only or --playwright-only');
  }

  return options;
}

async function runCommand(command: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    let child = spawn(command, {
      cwd: packageRoot,
      shell: true,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited from signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
        return;
      }

      resolvePromise();
    });
  });
}

async function main(): Promise<void> {
  let options = parseArgs(process.argv.slice(2));
  let shouldRunNode = !options.playwrightOnly;
  let shouldRunPlaywright = !options.nodeOnly;

  if (shouldRunNode) {
    await runCommand(
      'NODE_NO_WARNINGS=1 qunit --require ts-node/register/transpile-only tests/index.ts',
    );
  }

  if (shouldRunPlaywright) {
    await runCommand(
      `pnpm exec playwright test${options.headed ? ' --headed' : ''}`,
    );
  }
}

main().catch((error: unknown) => {
  let message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
