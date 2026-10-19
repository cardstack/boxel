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
      /No answer to "Save this profile\? \[Y\/n\]:"/,
    );
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

  it('throws when the flag is requested but stdin is not a TTY', async () => {
    // In the vitest runner stdin is never a TTY, which is exactly the
    // non-interactive case (CI, piped shells) we want to fail fast on.
    expect(process.stdin.isTTY).toBeFalsy();
    await expect(resolveRealmSecretSeed(true)).rejects.toThrow(
      /stdin is not a TTY/,
    );
  });
});
