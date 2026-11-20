import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stands in for the seed prompt, so a test can tell whether a command asked
// for the seed before it refused.
const resolveRealmSecretSeed = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prompt.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/prompt.ts')>()),
  resolveRealmSecretSeed,
}));

import { buildBoxelProgram } from '../../src/build-program.js';

const SERVER = ['--realm-server', 'https://realms.example.test'];
const DESTINATION = ['--destination', 'https://vendor.example.test/'];

async function run(args: string[]): Promise<string> {
  let errors = '';
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    errors += parts.map(String).join(' ');
  });
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  await expect(
    buildBoxelProgram('0.0.0').parseAsync([
      'node',
      'boxel',
      'realm-server',
      ...args,
    ]),
  ).rejects.toThrow('exit 1');
  return errors;
}

describe('boxel realm-server changes refuse missing input before asking for the seed', () => {
  beforeEach(() => {
    // The vitest runner's stdin is never a terminal: the shape of a command
    // whose stdin is a pipe.
    expect(process.stdin.isTTY).toBeFalsy();
    resolveRealmSecretSeed.mockResolvedValue('a realm secret seed for tests');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resolveRealmSecretSeed.mockReset();
  });

  for (let [label, args] of [
    [
      'secrets set --stdin',
      ['secrets', 'set', ...SERVER, '--name', 'a-secret', '--stdin'],
    ],
    ['secrets delete', ['secrets', 'delete', ...SERVER, '--name', 'a-secret']],
    [
      'keys add --stdin',
      [
        'keys',
        'add',
        ...SERVER,
        ...DESTINATION,
        '--credit-strategy',
        'none',
        '--stdin',
      ],
    ],
    [
      'keys replace --stdin',
      ['keys', 'replace', ...SERVER, ...DESTINATION, '--stdin'],
    ],
    ['keys delete', ['keys', 'delete', ...SERVER, ...DESTINATION]],
    [
      'keys set-response-cap',
      ['keys', 'set-response-cap', ...SERVER, ...DESTINATION, '1024'],
    ],
  ] as const) {
    it(`${label} without --note`, async () => {
      let errors = await run([...args]);
      expect(errors).toContain('Pass --note');
      expect(resolveRealmSecretSeed).not.toHaveBeenCalled();
    });
  }

  it('secrets set without --stdin or --key-file, when stdin is not a terminal', async () => {
    let errors = await run([
      'secrets',
      'set',
      ...SERVER,
      '--name',
      'a-secret',
      '--note',
      'a note',
    ]);
    expect(errors).toContain(
      'Cannot prompt for the secret value: stdin is not a terminal',
    );
    expect(resolveRealmSecretSeed).not.toHaveBeenCalled();
  });

  it('keys delete --kind oauth-client without --yes, when stdin is not a terminal', async () => {
    let errors = await run([
      'keys',
      'delete',
      ...SERVER,
      '--kind',
      'oauth-client',
      '--name',
      'a-client',
      '--note',
      'a note',
    ]);
    expect(errors).toContain('Pass --yes to delete a platform client');
    expect(resolveRealmSecretSeed).not.toHaveBeenCalled();
  });

  it('keys replace with an empty --note', async () => {
    let errors = await run([
      'keys',
      'replace',
      ...SERVER,
      ...DESTINATION,
      '--stdin',
      '--note',
      ' ',
    ]);
    expect(errors).toContain('The operator note is empty');
    expect(resolveRealmSecretSeed).not.toHaveBeenCalled();
  });
});
