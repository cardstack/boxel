import * as readline from 'readline';
import { Writable } from 'stream';

export function prompt(question: string): Promise<string> {
  const wasFlowing = process.stdin.readableFlowing;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      // Creating the interface resumes stdin, and closing it doesn't undo that —
      // a resumed stdin keeps the event loop alive, so a command whose last act
      // is a prompt would sit there having already finished its work. The
      // no-echo prompt below takes the same care.
      if (!wasFlowing) {
        process.stdin.pause();
      }
      resolve(answer.trim());
    });
  });
}

/**
 * Read a secret from stdin without echoing it to the TTY. Keystrokes are
 * masked with `*` and Ctrl+C exits. Intended for seeds, passwords, and other
 * sensitive CLI input that must not appear in shell history or `ps aux`.
 */
export function promptPassword(question: string): Promise<string> {
  const mutableOutput = new Writable({
    write: (_chunk, _encoding, callback) => callback(),
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableOutput,
    terminal: true,
  });

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
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
          .split('[200~')
          .join('')
          .split('[201~')
          .join('');
        for (const c of raw) {
          if (c === '\n' || c === '\r') {
            cleanup();
            process.stdout.write('\n');
            resolve(password);
            return;
          } else if (c === '\u0003') {
            // Ctrl+C
            cleanup();
            process.exit();
          } else if (c === '\u007F' || c === '\b') {
            // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
          } else if (c >= ' ') {
            // Printable character; suppress other control bytes entirely.
            password += c;
            process.stdout.write('*');
          }
        }
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    let password = '';
    try {
      process.stdout.write(question);
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
