// Runs the shell's telemetry through each test of a module, as the shell runs
// it, and checks after each test that no beacon carries any of the values the
// test reports as secret: what was typed, what the page sent the servers, what
// they answered. A page's own tests already drive it through its flows, so
// this puts every one of those flows under the rule that nothing sensitive
// leaves the page.
import { startTelemetry, stopTelemetry } from '../../src/shell/telemetry.ts';

// The strings in a value, at any depth, long enough that finding one in a
// beacon can't be chance (a short word could be part of a label), other than
// the names of resource types.
export function stringsIn(value: unknown, minLength = 6): string[] {
  if (typeof value === 'string') {
    return value.length >= minLength ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringsIn(item, minLength));
  }
  if (value && typeof value === 'object') {
    // A JSON:API `type` names the kind of resource, as an endpoint label may.
    return Object.entries(value).flatMap(([key, item]) =>
      key === 'type' ? [] : stringsIn(item, minLength),
    );
  }
  return [];
}

export function setupTelemetrySecretsCheck(
  hooks: NestedHooks,
  secrets: () => Iterable<string>,
) {
  let beacons: string[] = [];
  let sent = 0;

  // Registered after the module's own setup, so the page's markup names the
  // realm server by the time the instrument reads it.
  hooks.beforeEach(function () {
    beacons = [];
    startTelemetry({
      fetch: (async (_url: URL, init: { body?: unknown }) => {
        beacons.push(String(init.body));
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
    });
  });

  hooks.afterEach(function (assert) {
    stopTelemetry();
    sent += beacons.length;
    let body = beacons.join('\n');
    for (let secret of new Set(secrets())) {
      if (secret && body.includes(secret)) {
        assert.ok(
          false,
          `a telemetry beacon carries ${JSON.stringify(secret)}`,
        );
      }
    }
  });

  hooks.after(function (assert) {
    assert.ok(sent > 0, 'the pages beaconed while their tests ran');
  });
}
