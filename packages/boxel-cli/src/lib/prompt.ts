import * as readline from 'readline';
import { Writable } from 'stream';

// A question whose input ended before it was answered. The CLI's entry point
// prints its message without a stack, since it describes how the command was
// run rather than a fault in it.
export class PromptInputClosedError extends Error {
  constructor(question: string, fromTerminal: boolean) {
    super(
      `No answer to "${question.trim()}".` +
        (fromTerminal
          ? ''
          : ' Input ended before one was given. Run the command in a terminal, ' +
            'or pass what it asks for as flags or environment variables.'),
    );
    this.name = 'PromptInputClosedError';
  }
}

export interface PromptOptions {
  /** @internal The streams to read from and write to; tests pass their own. */
  input?: NodeJS.ReadableStream & {
    readableFlowing?: boolean | null;
    isTTY?: boolean;
  };
  output?: NodeJS.WritableStream;
}

export function prompt(
  question: string,
  options: PromptOptions = {},
): Promise<string> {
  const input = options.input ?? process.stdin;
  const wasFlowing = input.readableFlowing;
  const rl = readline.createInterface({
    input,
    output: options.output ?? process.stdout,
  });

  return new Promise((resolve, reject) => {
    // Input that ends before an answer arrives (stdin from /dev/null, or a pipe
    // that runs dry) closes the interface without ever calling the question's
    // callback. Left alone, the command's promise never settles and the process
    // exits as if it had finished, having done nothing it was asked to.
    let answered = false;
    rl.once('close', () => {
      if (!answered) {
        reject(new PromptInputClosedError(question, Boolean(input.isTTY)));
      }
    });
    // Ctrl+C stops the command, as it does at the no-echo prompt below. Without
    // a listener here readline would close the interface instead, which reads
    // as a question left unanswered.
    rl.on('SIGINT', () => {
      answered = true;
      rl.close();
      process.exit(130);
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      // Creating the interface resumes stdin, and closing it doesn't undo that —
      // a resumed stdin keeps the event loop alive, so a command whose last act
      // is a prompt would sit there having already finished its work. The
      // no-echo prompt below takes the same care.
      if (!wasFlowing) {
        input.pause();
      }
      resolve(answer.trim());
    });
  });
}

export interface PromptPasswordOptions {
  /**
   * After Enter, show this many of the value's last characters, so the
   * operator can tell the value they pasted is the one they meant. Never more
   * than a quarter of the value is shown.
   */
  revealLast?: number;
  /** @internal The streams to read from and write to; tests pass their own. */
  input?: NodeJS.ReadStream;
  output?: NodeJS.WritableStream;
}

/**
 * The trailing characters of `value` that `revealLast` may show: at most
 * `revealLast`, and at most a quarter of the value.
 */
export function revealedSuffix(value: string, revealLast: number): string {
  let count = Math.min(revealLast, Math.floor(value.length / 4));
  return count > 0 ? value.slice(-count) : '';
}

/**
 * Read a secret from stdin without echoing it to the TTY. Every character
 * echoes as `*` and Ctrl+C exits. Intended for seeds, passwords, keys and other
 * sensitive CLI input that must not appear in shell history or `ps aux`.
 */
export function promptPassword(
  question: string,
  options: PromptPasswordOptions = {},
): Promise<string> {
  const stdin = options.input ?? process.stdin;
  const stdout = options.output ?? process.stdout;
  const mutableOutput = new Writable({
    write: (_chunk, _encoding, callback) => callback(),
  });
  const rl = readline.createInterface({
    input: stdin,
    output: mutableOutput,
    terminal: true,
  });

  return new Promise((resolve, reject) => {
    const wasFlowing = stdin.readableFlowing;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
      rl.close();
      if (!wasFlowing) {
        stdin.pause();
      }
    };

    const onData = (chunk: Buffer) => {
      try {
        // Pastes arrive as a single data event containing many characters.
        // Strip bracketed-paste markers if the terminal sent them, then walk
        // the chunk one code point at a time so newlines, backspace, and
        // Ctrl+C inside a paste still work.
        const raw = chunk
          .toString()
          .split('\u001b[200~')
          .join('')
          .split('\u001b[201~')
          .join('');
        for (const c of raw) {
          if (c === '\n' || c === '\r') {
            cleanup();
            stdout.write('\n');
            const suffix = options.revealLast
              ? revealedSuffix(password, options.revealLast)
              : '';
            if (suffix) {
              stdout.write(
                `  (${[...password].length} characters, ending in ${suffix})\n`,
              );
            }
            resolve(password);
            return;
          } else if (c === '\u0003') {
            // Ctrl+C
            cleanup();
            process.exit();
          } else if (c === '\u007F' || c === '\b') {
            // Backspace
            if (password.length > 0) {
              password = [...password].slice(0, -1).join('');
              stdout.write('\b \b');
            }
          } else if (c >= ' ') {
            // Printable character; suppress other control bytes entirely.
            password += c;
            stdout.write('*');
          }
        }
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    let password = '';
    try {
      stdout.write(question);
      stdin.on('data', onData);
      stdin.resume();
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

/**
 * Resolve a realm secret seed for administrative CLI operations.
 *
 * Precedence:
 *   1. `BOXEL_REALM_SECRET_SEED` env var — used silently if set.
 *   2. If `flagPresent` is true, prompt the user (no echo).
 *   3. Otherwise return undefined — caller falls back to profile auth.
 *
 * Throws when `--realm-secret-seed` is requested but stdin is not a TTY
 * (e.g. CI, piped shells) — otherwise `promptPassword` would hang
 * indefinitely waiting for keypress input it can never receive.
 */
export async function resolveRealmSecretSeed(
  flagPresent: boolean,
): Promise<string | undefined> {
  const fromEnv = process.env.BOXEL_REALM_SECRET_SEED;
  if (fromEnv) {
    return fromEnv;
  }
  if (!flagPresent) {
    return undefined;
  }
  if (!process.stdin.isTTY) {
    throw new Error(
      'Cannot prompt for realm secret seed: stdin is not a TTY. ' +
        'Set BOXEL_REALM_SECRET_SEED in the environment instead.',
    );
  }
  return promptPassword('Realm secret seed: ');
}
