import { execFileSync } from 'node:child_process';
import process from 'node:process';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { startManagedEnvironments } from '../src/managed-environments.ts';

test('requires a native capability, rejects web origins and invalid fork input', async () => {
  const root = await mkdtemp('/tmp/boxel-environments-test-');
  const controller = await startManagedEnvironments({
    directory: root,
    bundledDirectory: root,
    electronPath: process.execPath,
    port: 0,
    encryption: {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error('unexpected encryption');
      },
      decryptString: () => {
        throw new Error('unexpected decryption');
      },
    },
    host: {
      start: async () => {
        throw new Error('unexpected stack startup');
      },
    },
  });
  try {
    const endpoint = `${controller.url}/v1/environments`;
    assert.equal((await fetch(endpoint)).status, 401);
    const headers = {
      authorization: `Bearer ${await readFile(path.join(root, 'controller-token'), 'utf8')}`,
    };
    assert.equal(
      (
        await fetch(endpoint, {
          headers: {
            ...headers,
            origin: 'http://app.default.boxel.localhost:4242',
          },
        })
      ).status,
      403,
    );
    assert.deepEqual(await (await fetch(endpoint, { headers })).json(), []);
    for (const source of [
      { kind: 'checkout', path: '/tmp/example', ref: '--help' },
      { kind: 'official', password: 'unused' },
    ]) {
      assert.equal(
        (
          await fetch(endpoint, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Example', source }),
          })
        ).status,
        422,
      );
    }
    assert.deepEqual(await (await fetch(endpoint, { headers })).json(), []);
  } finally {
    await controller.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses a registry that redirects an environment into another directory', async () => {
  const root = await mkdtemp('/tmp/boxel-environments-test-');
  try {
    await writeFile(
      path.join(root, 'environments.json'),
      JSON.stringify([
        {
          id: 'bxenv_123456abcdef',
          name: 'Unsafe',
          branch: 'codex/unsafe',
          path: '/tmp/unowned',
          namespace: 'env-123456abcdef',
          gatewayPort: 24001,
          controlPort: 24002,
          modelsPort: 24003,
          url: 'http://app.env-123456abcdef.boxel.localhost:24001/',
          state: 'ready',
          error: null,
          createdAt: new Date().toISOString(),
          job: null,
          builtHash: null,
          testedHash: null,
          profileId: null,
        },
      ]),
    );
    await assert.rejects(
      startManagedEnvironments({ directory: root, port: 0 }),
      /Invalid managed environment registry/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects namespace and port collisions before starting services', async () => {
  const { startLocalBoxel } = await import('../src/index.ts');
  const root = await mkdtemp('/tmp/boxel-isolation-test-');
  const profileFile = path.join(root, 'profile.json');
  const valid = {
    name: 'env-123456abcdef',
    gatewayPort: 23451,
    controlPort: 23452,
    modelsPort: 23453,
  };
  try {
    for (const isolation of [
      { ...valid, controlPort: valid.gatewayPort },
      { ...valid, name: '../default' },
      { ...valid, modelsPort: 80 },
      { ...valid, unexpected: true },
    ]) {
      await writeFile(
        profileFile,
        JSON.stringify({
          schemaVersion: 1,
          dataDirectory: root,
          postgresBin: root,
          tuwunelBinary: path.join(root, 'matrix'),
          chromeBinary: path.join(root, 'chrome'),
          modelBaseURL: 'http://127.0.0.1:11434/v1',
          modelIds: ['example'],
          titleModel: 'example',
          isolation,
        }),
      );
      await assert.rejects(
        startLocalBoxel({ profileFile }),
        /Invalid native environment isolation/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reserves concurrent actions and releases the reservation after setup fails', async () => {
  const root = await realpath(await mkdtemp('/tmp/boxel-job-reservation-'));
  const id = 'bxenv_123456abcdef';
  const environment = {
    id,
    name: 'Concurrent jobs',
    branch: 'codex/concurrent-jobs',
    path: path.join(root, 'environments', id, 'source'),
    namespace: 'env-123456abcdef',
    gatewayPort: 24001,
    controlPort: 24002,
    modelsPort: 24003,
    url: 'http://app.env-123456abcdef.boxel.localhost:24001/',
    state: 'ready',
    error: null,
    createdAt: new Date().toISOString(),
    job: null,
    builtHash: null,
    testedHash: null,
    profileId: null,
  };
  await mkdir(environment.path, { recursive: true });
  await writeFile(
    path.join(environment.path, 'fixture.txt'),
    'job admission fixture',
  );
  for (const args of [
    ['init', '--quiet'],
    ['add', '.'],
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@boxel.local',
      'commit',
      '--no-gpg-sign',
      '-m',
      'fixture',
    ],
  ])
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: environment.path,
      stdio: 'ignore',
    });
  const executor = path.join(root, 'job-fixture.cjs');
  await writeFile(executor, 'setTimeout(() => process.exit(0), 10000);');
  await writeFile(
    path.join(root, 'environments', id, 'tools.json'),
    JSON.stringify({
      node: process.execPath,
      pnpm: executor,
      shim: path.dirname(process.execPath),
    }),
  );
  await writeFile(
    path.join(root, 'environments.json'),
    JSON.stringify([environment]),
  );
  const controller = await startManagedEnvironments({
    directory: root,
    bundledDirectory: root,
    electronPath: process.execPath,
    port: 0,
  });
  try {
    const headers = {
      authorization: `Bearer ${await readFile(path.join(root, 'controller-token'), 'utf8')}`,
      'content-type': 'application/json',
    };
    const responses = await Promise.all(
      Array.from({ length: 16 }, () =>
        fetch(`${controller.url}/v1/environments/${id}/action`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'test' }),
        }),
      ),
    );
    assert.equal(
      responses.filter((response) => response.status === 202).length,
      1,
    );
    assert.equal(
      responses.filter((response) => response.status === 422).length,
      15,
    );
    for (const response of responses) await response.json();
    const action = (value) =>
      fetch(`${controller.url}/v1/environments/${id}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: value }),
      });
    const stopped = await action('stop');
    assert.equal(stopped.status, 202);
    await stopped.json();
    let state;
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await fetch(`${controller.url}/v1/environments/${id}`, {
        headers,
      });
      state = await response.json();
      if (state.job.state !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(state.job.state, 'passed');
    const jobs = path.join(root, 'environments', id, 'jobs');
    await rm(jobs, { recursive: true });
    await writeFile(jobs, 'block asynchronous log setup');
    const failed = await action('test');
    assert.equal(failed.status, 422);
    assert.match((await failed.json()).error, /EEXIST|ENOTDIR/);
    await rm(jobs);
    const retried = await action('test');
    assert.equal(retried.status, 202);
    await retried.json();
  } finally {
    await controller.stop();
    await rm(root, { recursive: true, force: true });
  }
});
