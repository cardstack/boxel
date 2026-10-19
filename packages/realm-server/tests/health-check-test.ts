import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type Koa from 'koa';
import { healthCheck } from '../middleware/index.ts';

function probe(userAgent: string | undefined) {
  let ctxt = {
    req: { headers: userAgent ? { 'user-agent': userAgent } : {} },
    body: undefined as unknown,
  } as unknown as Koa.Context;
  let passedOn = false;
  healthCheck(ctxt, async () => {
    passedOn = true;
  });
  return { answered: ctxt.body, passedOn };
}

module(basename(import.meta.filename), function (hooks) {
  let original: string | undefined;
  hooks.beforeEach(function () {
    original = process.env.HEALTH_CHECK_USER_AGENTS;
  });
  hooks.afterEach(function () {
    if (original === undefined) {
      delete process.env.HEALTH_CHECK_USER_AGENTS;
    } else {
      process.env.HEALTH_CHECK_USER_AGENTS = original;
    }
  });

  test('answers a configured health checker from memory', function (assert) {
    process.env.HEALTH_CHECK_USER_AGENTS = 'ELB-HealthChecker, kube-probe/';
    assert.deepEqual(probe('ELB-HealthChecker/2.0'), {
      answered: 'OK',
      passedOn: false,
    });
    assert.deepEqual(probe('kube-probe/1.31'), {
      answered: 'OK',
      passedOn: false,
    });
  });

  test('passes any other request on', function (assert) {
    process.env.HEALTH_CHECK_USER_AGENTS = 'ELB-HealthChecker';
    assert.deepEqual(probe('Mozilla/5.0'), {
      answered: undefined,
      passedOn: true,
    });
    assert.deepEqual(probe(undefined), {
      answered: undefined,
      passedOn: true,
    });
  });

  test('with no health checker configured, recognizes none', function (assert) {
    delete process.env.HEALTH_CHECK_USER_AGENTS;
    assert.deepEqual(probe('ELB-HealthChecker/2.0'), {
      answered: undefined,
      passedOn: true,
    });
  });
});
