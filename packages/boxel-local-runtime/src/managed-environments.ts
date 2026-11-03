import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { spawn } from 'node:child_process';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  realpath,
  appendFile,
  lstat,
  readlink,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  EnvironmentSchema,
  EnvironmentCreateSchema,
  EnvironmentActionSchema,
} from './managed-contracts.ts';
import { managedToolchain } from './managed-toolchain.ts';
import { prepareBundledBoxelProfile } from './bundled-profile.ts';
import { createLocalSecretsStore } from '../../realm-server/lib/local-secrets.ts';
import { ensureLocalMatrixAccounts } from '../../realm-server/lib/local-matrix.ts';
import { passwordFromSeed } from '@cardstack/runtime-common/matrix-client';
import { ProfileManager } from '../../boxel-cli/src/lib/profile-manager.ts';
import type {
  ManagedEnvironmentsOptions,
  NativeManagedEnvironment,
  NativeRuntimeHandle,
  NativeEnvironmentJob,
} from './contracts.ts';

type Action = z.infer<typeof EnvironmentActionSchema>;
const SourceSchema = z
  .object({
    upstream: z.literal('https://github.com/cardstack/boxel.git'),
    baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
    patchSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceTree: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .passthrough();
function environmentVariables(
  extra: Record<string, string> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL'])
    if (process.env[name]) result[name] = process.env[name]!;
  return { ...result, ...extra };
}
async function availablePort(): Promise<number> {
  const server = createPortServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not allocate an environment port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
function terminate(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
      throw error;
  }
}
async function command(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    signal: AbortSignal;
    env?: Record<string, string>;
    input?: string;
    log?: (text: string) => Promise<void>;
  },
): Promise<string> {
  if (options.signal.aborted) throw new Error('Environment action cancelled');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? environmentVariables(),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let logging = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      if (child.pid) {
        terminate(child.pid, 'SIGTERM');
        timer = setTimeout(() => terminate(child.pid!, 'SIGKILL'), 5000);
      }
    };
    options.signal.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (bytes: Buffer) => {
      stdout += bytes.toString('utf8');
      if (Buffer.byteLength(stdout) > 8 * 1024 * 1024)
        stdout = stdout.slice(-8 * 1024 * 1024);
      if (options.log)
        logging = logging.then(() => options.log!(bytes.toString('utf8')));
    });
    child.stderr.on('data', (bytes: Buffer) => {
      if (options.log)
        logging = logging.then(() => options.log!(bytes.toString('utf8')));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
    child.once('error', () => {
      options.signal.removeEventListener('abort', cancel);
      if (timer) clearTimeout(timer);
      reject(new Error('Could not start an environment command'));
    });
    child.once('exit', (code) => {
      options.signal.removeEventListener('abort', cancel);
      if (timer) clearTimeout(timer);
      if (child.pid) terminate(child.pid, 'SIGKILL');
      void logging.then(
        () =>
          code === 0 && !options.signal.aborted
            ? resolve(stdout)
            : reject(
                new Error(
                  options.signal.aborted
                    ? 'Environment action cancelled'
                    : `Environment command failed (${code ?? 'signal'}). See its job log.`,
                ),
              ),
        reject,
      );
    });
  });
}
async function sourceHash(
  checkout: string,
  signal: AbortSignal,
): Promise<string> {
  const git = (args: string[]) =>
    command('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: checkout,
      signal,
    });
  const hash = createHash('sha256').update(await git(['rev-parse', 'HEAD']));
  const inventory = await git([
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  if (Buffer.byteLength(inventory) > 7 * 1024 * 1024)
    throw new Error('Source inventory exceeds its limit');
  for (const name of [...new Set(inventory.split('\0').filter(Boolean))]
    .filter((name) => !name.startsWith('.bb/'))
    .sort()) {
    const file = path.join(checkout, name);
    hash.update(name).update('\0');
    try {
      const info = await lstat(file);
      hash.update(String(info.mode & 0o111)).update('\0');
      if (info.isSymbolicLink()) hash.update(await readlink(file));
      else if (info.isFile()) {
        const { createReadStream } = await import('node:fs');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
      } else throw new Error('Unsupported source file');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        hash.update('deleted');
      else throw error;
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}
async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const pending = `${file}.${randomUUID()}`;
  try {
    await writeFile(pending, JSON.stringify(value, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(pending, file);
  } finally {
    await rm(pending, { force: true });
  }
}
export async function startManagedEnvironments(
  options: ManagedEnvironmentsOptions,
) {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const root = await realpath(options.directory);
  const records = new Map<string, NativeManagedEnvironment>();
  const jobs = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  const runtimes = new Map<string, NativeRuntimeHandle>();
  const tokenFile = path.join(root, 'controller-token');
  let token: string;
  try {
    await writeFile(tokenFile, randomBytes(32).toString('hex'), {
      mode: 0o600,
      flag: 'wx',
    });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
      throw error;
  }
  const tokenInfo = await lstat(tokenFile);
  if (
    !tokenInfo.isFile() ||
    (tokenInfo.mode & 0o077) !== 0 ||
    tokenInfo.size !== 64
  )
    throw new Error('Invalid private environment controller token');
  token = await readFile(tokenFile, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error('Invalid private environment controller token');
  const registry = path.join(root, 'environments.json');
  const owned = (environment: NativeManagedEnvironment) =>
    path.join(root, 'environments', environment.id);
  let saving = Promise.resolve();
  const save = () => {
    const snapshot = [...records.values()].map((item) =>
      EnvironmentSchema.parse(item),
    );
    saving = saving.catch(() => {}).then(() => atomicJson(registry, snapshot));
    return saving;
  };
  try {
    const loaded = z
      .array(EnvironmentSchema)
      .parse(JSON.parse(await readFile(registry, 'utf8')));
    for (const environment of loaded) {
      if (
        environment.path !== path.join(owned(environment), 'source') ||
        environment.namespace !== `env-${environment.id.slice(6)}` ||
        environment.url !==
          `http://app.${environment.namespace}.boxel.localhost:${environment.gatewayPort}/`
      )
        throw new Error('Invalid managed environment registry');
      if (environment.job?.state === 'running') {
        environment.job.state = 'failed';
        environment.job.phase = 'Interrupted; retry the action';
        environment.job.finishedAt = new Date().toISOString();
        environment.error = 'The previous action was interrupted';
      }
      if (environment.state === 'running') environment.state = 'ready';
      if (environment.state === 'preparing') {
        environment.state = 'error';
        environment.error =
          'Environment preparation was interrupted. Create a new fork; source files were retained.';
      }
      records.set(environment.id, environment);
    }
    await save();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  const logFile = (environment: NativeManagedEnvironment) =>
    path.join(owned(environment), 'jobs', `${environment.job!.id}.log`);
  const launch = async (
    environment: NativeManagedEnvironment,
    action: NativeEnvironmentJob['action'],
    work: (
      signal: AbortSignal,
      phase: (value: string) => Promise<void>,
      log: (value: string) => Promise<void>,
    ) => Promise<void>,
  ) => {
    if (jobs.has(environment.id))
      throw new Error('This environment already has an action running');
    const job: NativeEnvironmentJob = {
      id: randomUUID(),
      action,
      state: 'running',
      phase: 'Starting',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    environment.job = job;
    environment.error = null;
    const file = logFile(environment);
    const controller = new AbortController();
    const phase = async (value: string) => {
      job.phase = value;
      await save();
    };
    let loggedBytes = 0;
    const log = async (value: string) => {
      if (loggedBytes >= 16 * 1024 * 1024) return;
      loggedBytes += Buffer.byteLength(value);
      await appendFile(
        file,
        value
          .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
          .replace(
            /([?&](?:access_token|loginToken|key|token)=)[^&\s"']+/gi,
            '$1[redacted]',
          ),
        { mode: 0o600 },
      );
    };
    const preparation = Promise.resolve().then(async () => {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, '', { mode: 0o600 });
      await save();
    });
    const promise = preparation
      .then(() => work(controller.signal, phase, log))
      .then(() => {
        job.state = 'passed';
        job.phase = 'Complete';
        if (environment.state === 'preparing' || environment.state === 'error')
          environment.state = 'ready';
      })
      .catch((error: unknown) => {
        job.state = controller.signal.aborted ? 'cancelled' : 'failed';
        job.phase = 'Stopped';
        environment.error =
          error instanceof Error ? error.message : 'Environment action failed';
        if (!runtimes.has(environment.id)) environment.state = 'error';
      })
      .finally(async () => {
        job.finishedAt = new Date().toISOString();
        jobs.delete(environment.id);
        try {
          await save();
        } catch {
          job.state = 'failed';
          job.phase = 'Could not save action status';
          if (environment.job === job) {
            environment.error =
              'Could not save environment status; check available disk space and retry';
            environment.state = 'error';
          }
        }
      });
    jobs.set(environment.id, { controller, promise });
    try {
      await preparation;
    } catch (error) {
      await promise;
      throw error;
    }
    return structuredClone(environment);
  };
  async function prepareDependencies(
    environment: NativeManagedEnvironment,
    signal: AbortSignal,
    phase: (value: string) => Promise<void>,
    log: (value: string) => Promise<void>,
  ) {
    await lstat(
      path.join(environment.path, 'packages/boxel-local-runtime/package.json'),
    ).catch(() => {
      throw new Error(
        'This committed revision does not contain the native Boxel runtime. Choose an official Studio snapshot or a compatible fork.',
      );
    });
    await phase('Installing the pinned development toolchain');
    const tools = await managedToolchain(
      path.join(root, 'toolchains'),
      environment.path,
      signal,
    );
    const shim = path.join(
      root,
      'shims',
      path.basename(path.dirname(tools.node)) +
        '-' +
        path.basename(path.dirname(path.dirname(tools.pnpm))),
    );
    await mkdir(shim, { recursive: true, mode: 0o700 });
    const shimFile = path.join(shim, `pnpm.${randomUUID()}`);
    try {
      await writeFile(
        shimFile,
        '#!/usr/bin/env node\n' +
          'const {spawnSync}=require("node:child_process");\n' +
          `const result=spawnSync(process.execPath,[${JSON.stringify(tools.pnpm)},...process.argv.slice(2)],{stdio:"inherit"});\n` +
          'process.exit(result.status ?? 1);\n',
        { mode: 0o700, flag: 'wx' },
      );
      await rename(shimFile, path.join(shim, 'pnpm'));
    } finally {
      await rm(shimFile, { force: true });
    }
    await atomicJson(path.join(owned(environment), 'tools.json'), {
      ...tools,
      shim,
    });
    await phase('Installing fork dependencies');
    await command(
      tools.node,
      [
        tools.pnpm,
        'install',
        '--frozen-lockfile',
        '--ignore-scripts',
        '--store-dir',
        path.join(root, 'pnpm-store'),
      ],
      {
        cwd: environment.path,
        signal,
        env: environmentVariables({
          PATH: `${path.dirname(tools.node)}:${shim}:/usr/bin:/bin:/usr/sbin:/sbin`,
          CI: '1',
        }),
        log,
      },
    );
    environment.state = 'ready';
  }
  let preparing = Promise.resolve();
  async function create(input: unknown) {
    const request = EnvironmentCreateSchema.parse(input);
    if (
      request.source.kind === 'checkout' &&
      !path.isAbsolute(request.source.path)
    )
      throw new Error('Choose an absolute source checkout path');
    const id = `bxenv_${randomBytes(6).toString('hex')}`;
    const namespace = `env-${id.slice(6)}`;
    const ports = new Set<number>();
    while (ports.size < 3) ports.add(await availablePort());
    const [gatewayPort, controlPort, modelsPort] = [...ports];
    const environment: NativeManagedEnvironment = EnvironmentSchema.parse({
      id,
      name: request.name,
      branch: `codex/${
        request.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 36) || 'fork'
      }-${id.slice(6, 12)}`,
      path: path.join(root, 'environments', id, 'source'),
      namespace,
      gatewayPort,
      controlPort,
      modelsPort,
      url: `http://app.${namespace}.boxel.localhost:${gatewayPort}/`,
      state: 'preparing',
      error: null,
      createdAt: new Date().toISOString(),
      job: null,
      builtHash: null,
      testedHash: null,
      profileId: null,
    });
    records.set(id, environment);
    return launch(environment, 'prepare', async (signal, phase, log) => {
      const previous = preparing;
      let release!: () => void;
      preparing = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        await phase('Creating isolated source branch');
        const git = (
          args: string[],
          cwd = root,
          env?: Record<string, string>,
          input?: string,
        ) =>
          command('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
            cwd,
            signal,
            env,
            input,
            log,
          });
        const cache = path.join(root, 'repositories', environment.id);
        await mkdir(path.dirname(cache), { recursive: true, mode: 0o700 });
        let revision: string;
        if (request.source.kind === 'official') {
          const provenance = SourceSchema.parse(
            JSON.parse(
              await readFile(
                path.join(options.bundledDirectory, 'source/boxel-source.json'),
                'utf8',
              ),
            ),
          );
          const patch = await readFile(
            path.join(options.bundledDirectory, 'source/boxel-source.patch'),
          );
          if (
            createHash('sha256').update(patch).digest('hex') !==
            provenance.patchSha256
          )
            throw new Error('The official source patch failed verification');
          await git([
            'clone',
            '--bare',
            '--filter=blob:none',
            provenance.upstream,
            cache,
          ]);
          await git([
            '--git-dir',
            cache,
            'fetch',
            'origin',
            provenance.baseCommit,
          ]);
          const index = path.join(owned(environment), 'source-index');
          const env = environmentVariables({
            GIT_INDEX_FILE: index,
            GIT_AUTHOR_NAME: 'Boxel Studio',
            GIT_AUTHOR_EMAIL: 'studio@boxel.local',
            GIT_COMMITTER_NAME: 'Boxel Studio',
            GIT_COMMITTER_EMAIL: 'studio@boxel.local',
          });
          await git(
            ['--git-dir', cache, 'read-tree', provenance.baseCommit],
            root,
            env,
          );
          await git(
            [
              '--git-dir',
              cache,
              'apply',
              '--cached',
              '--whitespace=nowarn',
              path.join(options.bundledDirectory, 'source/boxel-source.patch'),
            ],
            root,
            env,
          );
          const tree = (
            await git(['--git-dir', cache, 'write-tree'], root, env)
          ).trim();
          if (tree !== provenance.sourceTree)
            throw new Error(
              'Official source reconstruction differs from the shipped source',
            );
          revision = (
            await git(
              [
                '--git-dir',
                cache,
                'commit-tree',
                tree,
                '-p',
                provenance.baseCommit,
              ],
              root,
              env,
              'Boxel Studio source snapshot\n',
            )
          ).trim();
          await rm(index, { force: true });
        } else {
          const source = await realpath(request.source.path);
          await git(['clone', '--bare', '--no-hardlinks', source, cache]);
          revision = (
            await git([
              '--git-dir',
              cache,
              'rev-parse',
              '--verify',
              `${request.source.ref}^{commit}`,
            ])
          ).trim();
        }
        await mkdir(owned(environment), { recursive: true, mode: 0o700 });
        await git([
          '--git-dir',
          cache,
          '-c',
          'branch.autoSetupMerge=false',
          'worktree',
          'add',
          '-b',
          environment.branch,
          environment.path,
          revision,
        ]);
      } finally {
        release();
      }
      await prepareDependencies(environment, signal, phase, log);
    });
  }
  async function act(id: string, input: unknown) {
    const action: Action = EnvironmentActionSchema.parse(input);
    const environment = records.get(id);
    if (!environment) throw new Error('Unknown managed environment');
    if (environment.state === 'preparing' && action !== 'stop')
      throw new Error('Wait for environment preparation');
    if (action === 'stop' && jobs.has(id)) {
      const running = jobs.get(id)!;
      running.controller.abort();
      await running.promise;
    }
    return launch(environment, action, async (signal, phase, log) => {
      if (action === 'stop') {
        await phase('Stopping only this environment');
        await runtimes.get(id)?.stop();
        runtimes.delete(id);
        environment.state = 'ready';
        return;
      }
      if (action === 'prepare') {
        environment.state = 'preparing';
        await prepareDependencies(environment, signal, phase, log);
        return;
      }
      const tools = z
        .object({ node: z.string(), pnpm: z.string(), shim: z.string() })
        .strict()
        .parse(
          JSON.parse(
            await readFile(path.join(owned(environment), 'tools.json'), 'utf8'),
          ),
        );
      const env = environmentVariables({
        PATH: `${path.dirname(tools.node)}:${tools.shim}:/usr/bin:/bin:/usr/sbin:/sbin`,
        CI: '1',
        BOXEL_NATIVE_INSTANCE: environment.namespace,
        BOXEL_NATIVE_GATEWAY_PORT: String(environment.gatewayPort),
        BOXEL_TEST_POSTGRES_BIN: path.join(
          options.bundledDirectory,
          'assets/postgres/bin',
        ),
      });
      const fingerprint = await sourceHash(environment.path, signal);
      const pnpm = (args: string[], extra: Record<string, string> = {}) =>
        command(tools.node, [tools.pnpm, ...args], {
          cwd: environment.path,
          signal,
          env: { ...env, ...extra },
          log,
        });
      if (action === 'test') {
        await phase('Testing against isolated native Postgres');
        await pnpm([
          'exec',
          'turbo',
          'run',
          'test:package',
          'lint:js',
          'lint:types',
          '--filter=@cardstack/boxel-local-runtime',
          '--output-logs=new-only',
        ]);
        if (fingerprint !== (await sourceHash(environment.path, signal)))
          throw new Error('Source changed during testing; run tests again');
        environment.testedHash = fingerprint;
        return;
      }
      if (action === 'build') {
        if (runtimes.has(id))
          throw new Error(
            'Stop this fork before rebuilding it. The main environment stays running.',
          );
        await phase('Building the fork for its own local URLs');
        await pnpm([
          'exec',
          'turbo',
          'run',
          'build:local',
          '--filter=@cardstack/boxel-local-runtime',
          '--output-logs=errors-only',
        ]);
        const output = path.join(
          owned(environment),
          'builds',
          environment.job!.id,
          'runtime',
        );
        await phase('Staging a self-contained runtime snapshot');
        await pnpm(
          [
            'exec',
            'turbo',
            'run',
            'package:runtime',
            '--filter=@cardstack/boxel-local-runtime',
            '--only',
            '--output-logs=errors-only',
          ],
          { BOXEL_RUNTIME_OUTPUT: output },
        );
        if (fingerprint !== (await sourceHash(environment.path, signal)))
          throw new Error('Source changed during building; build again');
        await atomicJson(path.join(owned(environment), 'build.json'), {
          sourceHash: fingerprint,
          directory: output,
        });
        environment.builtHash = fingerprint;
        return;
      }
      if (runtimes.has(id)) {
        environment.state = 'running';
        return;
      }
      if (
        environment.testedHash !== fingerprint ||
        environment.builtHash !== fingerprint
      )
        throw new Error(
          'Test and build the current source before running this fork',
        );
      const build = z
        .object({ sourceHash: z.string(), directory: z.string() })
        .strict()
        .parse(
          JSON.parse(
            await readFile(path.join(owned(environment), 'build.json'), 'utf8'),
          ),
        );
      if (
        build.sourceHash !== fingerprint ||
        !build.directory.startsWith(
          path.join(owned(environment), 'builds') + path.sep,
        )
      )
        throw new Error('Invalid runtime build');
      const dataRoot = path.join(owned(environment), 'data');
      const baseProfile = await prepareBundledBoxelProfile({
        assetDirectory: path.join(options.bundledDirectory, 'assets'),
        dataDirectory: dataRoot,
      });
      const profile: unknown = JSON.parse(await readFile(baseProfile, 'utf8'));
      if (
        !profile ||
        typeof profile !== 'object' ||
        !('dataDirectory' in profile) ||
        typeof profile.dataDirectory !== 'string'
      )
        throw new Error('Invalid isolated native profile');
      const stackDirectory = path.join(dataRoot, 'stack');
      await atomicJson(path.join(dataRoot, 'profile.json'), {
        ...profile,
        dataDirectory: stackDirectory,
        isolation: {
          name: environment.namespace,
          gatewayPort: environment.gatewayPort,
          controlPort: environment.controlPort,
          modelsPort: environment.modelsPort,
        },
      });
      await phase('Starting the isolated native stack');
      const implementation: typeof import('./index.ts') = await import(
        pathToFileURL(
          path.join(
            build.directory,
            'packages/boxel-local-runtime/dist/index.js',
          ),
        ).href
      );
      const handle = await implementation.startLocalBoxel({
        profileFile: path.join(dataRoot, 'profile.json'),
        electronPath: options.electronPath,
        encryption: options.encryption,
        host: options.host,
      });
      try {
        if (signal.aborted) throw new Error('Environment action cancelled');
        const manifest = z
          .object({
            gateway: z
              .object({
                routes: z.record(
                  z.string(),
                  z.object({ target: z.string() }).passthrough(),
                ),
              })
              .passthrough(),
          })
          .passthrough()
          .parse(
            JSON.parse(
              await readFile(
                path.join(stackDirectory, 'boxel-runtime.json'),
                'utf8',
              ),
            ),
          );
        const matrixURL =
          manifest.gateway.routes[
            `matrix.${environment.namespace}.boxel.localhost`
          ]!.target;
        const secrets = await createLocalSecretsStore(
          {
            BOXEL_LOCAL_SECRETS_PROVIDER: 'keychain',
            BOXEL_LOCAL_SECRETS_DIR: path.join(stackDirectory, 'secrets'),
          },
          options.encryption,
        ).loadOrCreate();
        await ensureLocalMatrixAccounts({
          matrixURL,
          serverName: `${environment.namespace}.boxel.localhost`,
          registrationSecret: secrets.matrixRegistrationSecret,
          realmSecretSeed: secrets.realmSecretSeed,
          systemUsernames: ['developer'],
          aiBotPassword: secrets.aiBotPassword,
        });
        const response = await fetch(
          new URL('_matrix/client/v3/login', matrixURL),
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'm.login.password',
              identifier: { type: 'm.id.user', user: 'developer' },
              password: await passwordFromSeed(
                'developer',
                secrets.realmSecretSeed,
              ),
              initial_device_display_name: `Boxel environment ${environment.name}`,
            }),
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          },
        );
        const auth = z
          .object({
            user_id: z.string(),
            access_token: z.string(),
            device_id: z.string(),
          })
          .passthrough()
          .parse(await response.json());
        const userId = `@developer:${environment.namespace}.boxel.localhost`;
        if (!response.ok || auth.user_id !== userId)
          throw new Error('Could not provision the fork account');
        await new ProfileManager().addProfileWithAuth(
          userId,
          {
            matrixUrl: `http://matrix.${environment.namespace}.boxel.localhost:${environment.gatewayPort}/`,
            userId,
            accessToken: auth.access_token,
            deviceId: auth.device_id,
          },
          environment.name,
          `http://realm.${environment.namespace}.boxel.localhost:${environment.gatewayPort}/`,
        );
        environment.profileId = userId;
        runtimes.set(id, handle);
        environment.state = 'running';
      } catch (error) {
        await handle.stop();
        throw error;
      }
    });
  }
  const server = createServer((request, response) => {
    void (async () => {
      const send = (status: number, value: unknown) => {
        response.writeHead(status, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        response.end(JSON.stringify(value));
      };
      if (
        request.headers.origin !== undefined ||
        !/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? '')
      )
        return send(403, { error: 'Native requests only' });
      if (request.method === 'GET' && request.url === '/health')
        return send(200, {
          service: 'boxel-managed-environments',
          schemaVersion: 1,
        });
      const expected = Buffer.from(`Bearer ${token}`);
      const provided = Buffer.from(request.headers.authorization ?? '');
      if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      )
        return send(401, { error: 'Native controller authorization required' });
      if (request.method === 'GET' && request.url === '/v1/environments')
        return send(200, [...records.values()]);
      if (
        request.method === 'POST' &&
        request.headers['content-type'] !== 'application/json'
      )
        return send(415, { error: 'JSON required' });
      const readBody = async () => {
        let body = '';
        for await (const bytes of request) {
          body += String(bytes);
          if (Buffer.byteLength(body) > 16384)
            throw new Error('Environment request is too large');
        }
        return JSON.parse(body);
      };
      if (request.method === 'POST' && request.url === '/v1/environments')
        return send(202, await create(await readBody()));
      const match =
        /^\/v1\/environments\/(bxenv_[a-f0-9]{12})(?:\/(action|log))?$/.exec(
          request.url ?? '',
        );
      const environment = match ? records.get(match[1]!) : undefined;
      if (!match || !environment)
        return send(404, { error: 'Environment not found' });
      if (request.method === 'GET' && !match[2]) return send(200, environment);
      if (request.method === 'GET' && match[2] === 'log') {
        const text = environment.job
          ? await readFile(logFile(environment), 'utf8')
          : '';
        return send(200, { text: text.slice(-64000) });
      }
      if (request.method === 'POST' && match[2] === 'action')
        return send(
          202,
          await act(
            environment.id,
            z
              .object({ action: EnvironmentActionSchema })
              .strict()
              .parse(await readBody()).action,
          ),
        );
      return send(405, { error: 'Unsupported environment action' });
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        response.writeHead(422, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        response.end(
          JSON.stringify({
            error:
              error instanceof z.ZodError
                ? 'Invalid environment request'
                : error instanceof Error
                  ? error.message
                  : 'Environment operation failed',
          }),
        );
      } else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4248, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Environment controller did not start');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async stop() {
      for (const { controller } of jobs.values()) controller.abort();
      await Promise.allSettled([...jobs.values()].map((job) => job.promise));
      await Promise.allSettled(
        [...runtimes.values()].map((runtime) => runtime.stop()),
      );
      runtimes.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
