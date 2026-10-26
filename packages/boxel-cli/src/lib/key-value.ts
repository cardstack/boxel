import { readFile } from 'fs/promises';
import { promptPassword } from './prompt.ts';

// Reading a key's value for a command that stores one. A value is typed at a
// masked prompt or read from stdin or a file, never taken as an argument, so
// it stays out of shell history and the process list.

function stripOneTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, '');
}

export interface KeyValueSource {
  stdin?: boolean;
  keyFile?: string;
}

export interface KeyValueIO {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WritableStream;
  // What the masked prompt reveals after Enter (see `promptPassword`).
  revealLast?: number;
  revealNoneAtOrBelow?: number;
}

/**
 * Refuses a source `readKeyValue` can't read from: both flags, or neither
 * without a terminal. A command checks this before anything that would make
 * the person wait, such as signing in.
 */
export function checkKeyValueSource(
  source: KeyValueSource,
  input: { isTTY?: boolean } = process.stdin,
): void {
  if (source.stdin && source.keyFile) {
    throw new Error('Pass --stdin or --key-file, not both');
  }
  if (!source.stdin && !source.keyFile && !input.isTTY) {
    throw new Error(
      'Cannot prompt for the key value: stdin is not a terminal. Pass --stdin or --key-file',
    );
  }
}

/**
 * The key value, from exactly one source: `--key-file`, `--stdin`, or, when
 * stdin is a terminal, a masked prompt. One trailing newline is dropped from
 * a file or stdin. Without a terminal and without either flag it refuses,
 * rather than hang waiting for keystrokes.
 */
export async function readKeyValue(
  source: KeyValueSource,
  io: KeyValueIO = {},
): Promise<string> {
  let input = io.input ?? process.stdin;
  checkKeyValueSource(source, input);
  let value: string;
  if (source.keyFile) {
    value = stripOneTrailingNewline(await readFile(source.keyFile, 'utf8'));
  } else if (source.stdin) {
    let chunks: Buffer[] = [];
    for await (let chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    value = stripOneTrailingNewline(Buffer.concat(chunks).toString('utf8'));
  } else {
    value = await promptPassword('Key value: ', {
      revealLast: io.revealLast ?? 4,
      revealNoneAtOrBelow: io.revealNoneAtOrBelow,
      input,
      output: io.output,
    });
  }
  if (!value) {
    throw new Error('The key value is empty');
  }
  return value;
}
