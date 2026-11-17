// Runs the history reader's git commands. Every command waits for a permit
// from one semaphore, so a realm-server task runs at most a fixed number of
// git processes for history however many reads arrive, and each process is
// killed when it outlives its timeout.
//
// The commands run with no system or global git config and no `GIT_*`
// variables from the environment, and treat every path as literal, so the
// output the reader parses is git's own format whatever the host has set,
// and a realm path holding `*` or `?` matches only itself.

import { spawn } from 'node:child_process';
import { GIT_MAX_BUFFER_BYTES } from './repo-format.ts';
import { Semaphore } from './semaphore.ts';

export const DEFAULT_MAX_GIT_PROCESSES = 8;
export const DEFAULT_GIT_TIMEOUT_MS = 30_000;

const MAX_STDERR_BYTES = 64 * 1024;

export class GitTimeoutError extends Error {
  constructor(args: string[], timeoutMs: number) {
    super(`git ${args.join(' ')} was killed after ${timeoutMs}ms`);
    this.name = 'GitTimeoutError';
  }
}

export class GitCommandError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(args: string[], exitCode: number | null, stderr: string) {
    super(
      `git ${args.join(' ')} exited with ${exitCode}: ${stderr.trim() || '(no output)'}`,
    );
    this.name = 'GitCommandError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface GitProcessesOptions {
  // The git executable; `git` on the PATH by default.
  gitBinary?: string;
  maxProcesses?: number;
  timeoutMs?: number;
}

export interface GitRunOptions {
  // Written to the command's standard input, which is then closed.
  input?: string;
  // Exit codes that mean an answer rather than a failure, such as 1 from
  // `merge-base --is-ancestor`. 0 always does.
  okExitCodes?: number[];
}

export interface GitResult {
  stdout: Buffer;
  exitCode: number;
}

export class GitProcesses {
  #gitBinary: string;
  #timeoutMs: number;
  #permits: Semaphore;
  #env: NodeJS.ProcessEnv;

  constructor({
    gitBinary = 'git',
    maxProcesses = DEFAULT_MAX_GIT_PROCESSES,
    timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
  }: GitProcessesOptions = {}) {
    this.#gitBinary = gitBinary;
    this.#timeoutMs = timeoutMs;
    this.#permits = new Semaphore(maxProcesses);
    this.#env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.startsWith('GIT_'),
        ),
      ),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    };
  }

  // Runs the command to completion and returns its standard output whole.
  async run(
    gitDir: string,
    args: string[],
    options: GitRunOptions = {},
  ): Promise<GitResult> {
    let chunks: Buffer[] = [];
    let length = 0;
    let exitCode = await this.#spawn(gitDir, args, options, (chunk) => {
      length += chunk.byteLength;
      if (length > GIT_MAX_BUFFER_BYTES) {
        throw new Error(
          `git ${args.join(' ')} wrote more than ${GIT_MAX_BUFFER_BYTES} bytes`,
        );
      }
      chunks.push(chunk);
      return false;
    });
    return { stdout: Buffer.concat(chunks), exitCode };
  }

  // Runs the command and hands each chunk of its standard output to
  // `onData`, which returns true once it has read all it needs; the process
  // is then killed, and the command counts as having succeeded.
  async stream(
    gitDir: string,
    args: string[],
    onData: (chunk: Buffer) => boolean,
    options: GitRunOptions = {},
  ): Promise<void> {
    await this.#spawn(gitDir, args, options, onData);
  }

  async #spawn(
    gitDir: string,
    args: string[],
    { input, okExitCodes = [] }: GitRunOptions,
    onData: (chunk: Buffer) => boolean,
  ): Promise<number> {
    let release = await this.#permits.acquire();
    try {
      return await new Promise<number>((resolve, reject) => {
        let child = spawn(
          this.#gitBinary,
          [`--git-dir=${gitDir}`, '--literal-pathspecs', ...args],
          {
            env: this.#env,
            stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
          },
        );
        let stderr = '';
        let stopped = false;
        let failure: Error | undefined;
        let stop = (error?: Error) => {
          if (stopped) {
            return;
          }
          stopped = true;
          failure = error;
          child.kill('SIGKILL');
        };
        let timer = setTimeout(
          () => stop(new GitTimeoutError(args, this.#timeoutMs)),
          this.#timeoutMs,
        );
        child.stdout!.on('data', (chunk: Buffer) => {
          if (stopped) {
            return;
          }
          try {
            if (onData(chunk)) {
              stop();
            }
          } catch (error: any) {
            stop(error);
          }
        });
        child.stderr!.on('data', (chunk: Buffer) => {
          if (stderr.length < MAX_STDERR_BYTES) {
            stderr += chunk.toString('utf8');
          }
        });
        if (child.stdin) {
          // A process stopped early closes its input before reading it all.
          child.stdin.on('error', () => {});
          child.stdin.end(input);
        }
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        // `close` fires once the process has exited and its output has been
        // read, so a killed process is gone by the time the call settles.
        child.on('close', (code) => {
          clearTimeout(timer);
          if (failure) {
            reject(failure);
          } else if (stopped) {
            resolve(0);
          } else if (
            code === 0 ||
            (code !== null && okExitCodes.includes(code))
          ) {
            resolve(code);
          } else {
            reject(new GitCommandError(args, code, stderr));
          }
        });
      });
    } finally {
      release();
    }
  }
}
