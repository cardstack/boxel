#!/usr/bin/env node
// Guard: sourcing mise-tasks/lib/env-vars.sh runs `mkcert` only when it has to.
//
// The file is re-sourced on every shell prompt, because mise reads the
// environment back through it and `.mise.toml` pre-exports it. A subprocess
// in it is a subprocess per prompt per shell, and on a machine with many
// worktrees and shells open that is enough to fill the process table, after
// which nothing on the machine can fork. Nothing else notices: no test or
// build fails, and the machine that adds the subprocess is rarely the one
// that runs out.
//
// The check puts a stub `mkcert` first on PATH that records each call, sources
// the file with the dev cert present (so both of its `mkcert` call sites are
// reachable), and asserts:
//
//   - NODE_EXTRA_CA_CERTS already set: no call, and the value is kept.
//   - NODE_EXTRA_CA_CERTS unset: exactly one call, and the variable comes back
//     pointing at the stub's rootCA.pem. Without this half, a block that
//     stopped working would pass the first.
//
// Each case runs under every one of sh, bash and dash that is installed,
// since mise sources the file with whatever shell it has.
//
//   node scripts/check-env-vars-forks.mts

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const SYSTEM_PATH = '/usr/bin:/bin';
const PRESET_CA = '/preset/by/the/developer.pem';

let work = mkdtempSync(join(tmpdir(), 'check-env-vars-forks-'));
let problems: string[] = [];

try {
  let stubBin = join(work, 'bin');
  let caRoot = join(work, 'caroot');
  let certDir = join(work, 'dev-certs');
  let calls = join(work, 'mkcert-calls');
  for (let dir of [stubBin, caRoot, certDir]) {
    mkdirSync(dir);
  }
  writeFileSync(join(caRoot, 'rootCA.pem'), '');
  writeFileSync(join(certDir, 'localhost.pem'), '');
  writeFileSync(join(certDir, 'localhost-key.pem'), '');
  let stub = join(stubBin, 'mkcert');
  writeFileSync(stub, `#!/bin/sh\necho "$*" >> '${calls}'\necho '${caRoot}'\n`);
  chmodSync(stub, 0o755);

  let shells = ['sh', 'bash', 'dash'].filter((shell) => {
    try {
      execFileSync('sh', ['-c', `command -v ${shell}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });

  let cases = [
    { name: 'NODE_EXTRA_CA_CERTS set', preset: PRESET_CA, expectedCalls: 0 },
    {
      name: 'NODE_EXTRA_CA_CERTS unset',
      preset: undefined,
      expectedCalls: 1,
    },
  ];

  for (let shell of shells) {
    for (let { name, preset, expectedCalls } of cases) {
      writeFileSync(calls, '');
      let env: Record<string, string> = {
        HOME: work,
        PATH: `${stubBin}:${SYSTEM_PATH}`,
        BOXEL_DEV_CERT_DIR: certDir,
      };
      if (preset) {
        env.NODE_EXTRA_CA_CERTS = preset;
      }
      let result: string;
      try {
        result = execFileSync(
          shell,
          [
            '-c',
            '. ./mise-tasks/lib/env-vars.sh && printf %s "${NODE_EXTRA_CA_CERTS:-}"',
          ],
          { cwd: repoRoot, env, encoding: 'utf8' },
        );
      } catch (error) {
        problems.push(
          `${shell}, ${name}: sourcing env-vars.sh failed: ${(error as Error).message}`,
        );
        continue;
      }
      let callCount = readFileSync(calls, 'utf8')
        .split('\n')
        .filter(Boolean).length;
      let expectedValue = preset ?? join(caRoot, 'rootCA.pem');
      if (callCount !== expectedCalls) {
        problems.push(
          `${shell}, ${name}: mkcert ran ${callCount} time(s), expected ${expectedCalls}.`,
        );
      }
      if (result !== expectedValue) {
        problems.push(
          `${shell}, ${name}: NODE_EXTRA_CA_CERTS is ${JSON.stringify(result)}, expected ${JSON.stringify(expectedValue)}.`,
        );
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (problems.length > 0) {
  process.stderr.write(
    [
      'check-env-vars-forks: mise-tasks/lib/env-vars.sh runs on every shell prompt,',
      'so it must ask mkcert for its CA root only when NODE_EXTRA_CA_CERTS is unset, and then once.',
      ...problems.map((problem) => `  ${problem}`),
      'Test NODE_EXTRA_CA_CERTS before calling _boxel_mkcert_caroot, at every call site.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
