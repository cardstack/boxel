import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { hostname } from 'os';
import { execFileSync } from 'child_process';
import type Koa from 'koa';
import { instanceIdHeader } from '../middleware/index.ts';
import {
  getInstanceId,
  getPublicInstanceId,
  INSTANCE_ID_HEADER,
} from '../lib/instance-id.ts';

// The id is fixed once per process, so each case reads it in a fresh one.
function instanceIdOfFreshProcess(settings: NodeJS.ProcessEnv = {}): string {
  let env = { ...process.env };
  delete env.BOXEL_INSTANCE_ID;
  delete env.BOXEL_INHERITED_INSTANCE_ID;
  let modulePath = join(import.meta.dirname, '..', 'lib', 'instance-id.ts');
  return execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { getInstanceId } from ${JSON.stringify(modulePath)};
       process.stdout.write(getInstanceId());`,
    ],
    { env: { ...env, ...settings }, encoding: 'utf8' },
  );
}

module(basename(import.meta.filename), function () {
  test('is the hostname plus a per-boot suffix by default', function (assert) {
    let first = instanceIdOfFreshProcess();
    let second = instanceIdOfFreshProcess();
    assert.ok(
      first.startsWith(`${hostname()}-`),
      `${first} begins with the hostname`,
    );
    assert.ok(/-[0-9a-f]{8}$/.test(first), `${first} ends with the suffix`);
    assert.notStrictEqual(first, second, 'each boot gets its own id');
  });

  test('BOXEL_INSTANCE_ID replaces the hostname, not the per-boot suffix', function (assert) {
    let first = instanceIdOfFreshProcess({ BOXEL_INSTANCE_ID: 'replica-7' });
    let second = instanceIdOfFreshProcess({ BOXEL_INSTANCE_ID: 'replica-7' });
    assert.ok(/^replica-7-[0-9a-f]{8}$/.test(first), `${first} is suffixed`);
    assert.notStrictEqual(
      first,
      second,
      'replicas that share the setting still get their own ids',
    );
  });

  test("a worker takes its manager's id as it is", function (assert) {
    assert.strictEqual(
      instanceIdOfFreshProcess({
        BOXEL_INSTANCE_ID: 'replica-7',
        BOXEL_INHERITED_INSTANCE_ID: 'replica-7-9f3c2a1b',
      }),
      'replica-7-9f3c2a1b',
    );
  });

  test('every response names the instance that sent it, by digest', async function (assert) {
    let headers: Record<string, string> = {};
    let ctxt = {
      set(name: string, value: string) {
        headers[name] = value;
      },
    } as unknown as Koa.Context;
    await instanceIdHeader(ctxt, async () => {});
    assert.deepEqual(headers, { [INSTANCE_ID_HEADER]: getPublicInstanceId() });
    assert.ok(/^[0-9a-f]{12}$/.test(headers[INSTANCE_ID_HEADER]));
    assert.false(
      headers[INSTANCE_ID_HEADER].includes(hostname()),
      'the hostname stays private',
    );
    assert.notStrictEqual(headers[INSTANCE_ID_HEADER], getInstanceId());
  });
});
