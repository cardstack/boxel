import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import {
  prompt,
  PromptInputClosedError,
  resolveRealmSecretSeed,
} from '../../src/lib/prompt.ts';

describe('prompt', () => {
  it('resolves with the trimmed answer', async () => {
    let input = new PassThrough();
    let answer = prompt('Name: ', { input, output: new PassThrough() });
    input.end('  example answer  \n');
    await expect(answer).resolves.toBe('example answer');
  });

  it('rejects when the input ends before an answer arrives', async () => {
    let input = new PassThrough();
    let answer = prompt('Save this profile? [Y/n]: ', {
      input,
      output: new PassThrough(),
    });
    input.end();
    await expect(answer).rejects.toBeInstanceOf(PromptInputClosedError);
    await expect(answer).rejects.toThrow(
      /No answer to "Save this profile\? \[Y\/n\]:"\. Input ended before one was given\. Run the command in a terminal/,
    );
  });

  it('does not tell someone at a terminal to run it in one', async () => {
    let input = Object.assign(new PassThrough(), { isTTY: true });
    let answer = prompt('Name: ', { input, output: new PassThrough() });
    input.end();
    let error = await answer.catch((e: Error) => e);
    expect(error).toBeInstanceOf(PromptInputClosedError);
    expect((error as Error).message).toBe('No answer to "Name:".');
  });
});

describe('resolveRealmSecretSeed', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BOXEL_REALM_SECRET_SEED;
    delete process.env.BOXEL_REALM_SECRET_SEED;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BOXEL_REALM_SECRET_SEED;
    } else {
      process.env.BOXEL_REALM_SECRET_SEED = originalEnv;
    }
  });

  it('returns undefined when the flag is absent and no env var is set', async () => {
    await expect(resolveRealmSecretSeed(false)).resolves.toBeUndefined();
  });

  it('returns the env var silently, even when the flag is absent', async () => {
    process.env.BOXEL_REALM_SECRET_SEED = 'env-seed';
    await expect(resolveRealmSecretSeed(false)).resolves.toBe('env-seed');
  });

  it('prefers the env var over prompting when both would apply', async () => {
    // If the env var is present, we must NOT prompt the TTY — this test
    // would hang on stdin if the implementation reached promptPassword.
    process.env.BOXEL_REALM_SECRET_SEED = 'env-seed';
    await expect(resolveRealmSecretSeed(true)).resolves.toBe('env-seed');
  });

  it('throws when the flag is requested and there is no terminal to prompt on', async () => {
    // In the vitest runner stdin is never a TTY, so the seed would come from
    // the controlling terminal; a process without one (CI) fails fast.
    expect(process.stdin.isTTY).toBeFalsy();
    await expect(
      resolveRealmSecretSeed(true, { openTerminal: () => undefined }),
    ).rejects.toThrow(/there is no terminal to prompt on/);
  });

  it('prompts on the controlling terminal when stdin carries other input', async () => {
    expect(process.stdin.isTTY).toBeFalsy();
    let input = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: () => input,
    }) as unknown as NodeJS.ReadStream & PassThrough;
    let output = new PassThrough();
    let closed = false;
    let seed = resolveRealmSecretSeed(true, {
      openTerminal: () => ({
        input,
        output,
        close: () => {
          closed = true;
        },
      }),
    });
    input.write('terminal-seed\n');
    await expect(seed).resolves.toBe('terminal-seed');
    expect(String(output.read())).toContain('Realm secret seed: ');
    expect(closed).toBe(true);
  });
});
