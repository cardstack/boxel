import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { hostname } from 'os';
import { execFileSync } from 'child_process';
import type Koa from 'koa';
import { instanceIdHeader } from '../middleware/index.ts';
import { getInstanceId, INSTANCE_ID_HEADER } from '../lib/instance-id.ts';

// The id is fixed once per process, so each case reads it in a fresh one.
function instanceIdOfFreshProcess(env: NodeJS.ProcessEnv): string {
  let modulePath = join(import.meta.dirname, '..', 'lib', 'instance-id.ts');
  return execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { getInstanceId } from ${JSON.stringify(modulePath)};
       process.stdout.write(getInstanceId());`,
    ],
    { env, encoding: 'utf8' },
  );
}

module(basename(import.meta.filename), function () {
  test('is the hostname plus a per-boot suffix by default', function (assert) {
    let env = { ...process.env };
    delete env.BOXEL_INSTANCE_ID;
    let first = instanceIdOfFreshProcess(env);
    let second = instanceIdOfFreshProcess(env);
    assert.ok(
      first.startsWith(`${hostname()}-`),
      `${first} begins with the hostname`,
    );
    assert.ok(/-[0-9a-f]{8}$/.test(first), `${first} ends with the suffix`);
    assert.notStrictEqual(first, second, 'each boot gets its own id');
  });

  test('is BOXEL_INSTANCE_ID when the deployment sets it', function (assert) {
    assert.strictEqual(
      instanceIdOfFreshProcess({
        ...process.env,
        BOXEL_INSTANCE_ID: 'replica-7',
      }),
      'replica-7',
    );
  });

  test('every response names the instance that sent it', async function (assert) {
    let headers: Record<string, string> = {};
    let ctxt = {
      set(name: string, value: string) {
        headers[name] = value;
      },
    } as unknown as Koa.Context;
    await instanceIdHeader(ctxt, async () => {});
    assert.deepEqual(headers, { [INSTANCE_ID_HEADER]: getInstanceId() });
  });
});
