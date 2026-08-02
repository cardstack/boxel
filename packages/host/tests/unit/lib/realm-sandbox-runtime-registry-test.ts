import { module, test } from 'qunit';

import type RealmCompartmentModuleRuntime from '@cardstack/host/lib/realm-compartment-module-runtime';
import RealmSandboxRuntimeRegistry from '@cardstack/host/lib/realm-sandbox-runtime-registry';

class FakeRuntime {
  destroyed = false;

  destroy() {
    this.destroyed = true;
  }
}

module('Unit | realm sandbox runtime registry', function () {
  test('shares one runtime per principal and never evicts an active consumer', function (assert) {
    let created = new Map<string, FakeRuntime>();
    let evicted: string[] = [];
    let registry = new RealmSandboxRuntimeRegistry(
      (principal) => {
        let runtime = new FakeRuntime();
        created.set(principal, runtime);
        return runtime as unknown as RealmCompartmentModuleRuntime;
      },
      (principal) => evicted.push(principal),
    );

    let first = registry.runtimeFor('https://first.example/');
    let firstAgain = registry.runtimeFor('https://first.example/');
    registry.runtimeFor('https://second.example/');
    let release = registry.retain('https://first.example/');

    assert.strictEqual(firstAgain, first, 'one principal shares one runtime');
    registry.evictIdle();
    assert.false(
      created.get('https://first.example/')!.destroyed,
      'the retained runtime stays warm',
    );
    assert.true(
      created.get('https://second.example/')!.destroyed,
      'an idle runtime is destroyed',
    );
    assert.deepEqual(evicted, ['https://second.example/']);

    release();
    release();
    registry.evictIdle();
    assert.true(
      created.get('https://first.example/')!.destroyed,
      'the runtime is destroyed after its idempotent release',
    );
    assert.deepEqual(evicted, [
      'https://second.example/',
      'https://first.example/',
    ]);
  });
});
