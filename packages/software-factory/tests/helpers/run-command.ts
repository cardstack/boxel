import { spawn } from 'node:child_process';

export interface RunCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<RunCommandResult> {
  return await new Promise((resolvePromise, reject) => {
    let child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once('close', (status) => {
      if (!settled) {
        settled = true;
        resolvePromise({ status, stdout, stderr });
      }
    });

    if (options.timeoutMs) {
      setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGTERM');
          resolvePromise({
            status: null,
            stdout,
            stderr: `${stderr}\n[runCommand] killed after ${options.timeoutMs}ms timeout`,
          });
        }
      }, options.timeoutMs);
    }
  });
}
