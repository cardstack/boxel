import ENV from '@cardstack/host/config/environment';

type FeatureFlag = keyof NonNullable<typeof ENV.featureFlags>;
type Flags = Record<string, boolean | undefined>;

// Turns a build-time feature flag on for every test in the module. The test
// build starts with every flag off. Writes go through `Flags` so the helper
// still compiles when no flag is declared.
export function setupFeatureFlag(hooks: NestedHooks, flag: FeatureFlag) {
  let previous: boolean | undefined;
  hooks.beforeEach(function () {
    let flags = (ENV.featureFlags ??= {}) as Flags;
    previous = flags[flag];
    flags[flag] = true;
  });
  hooks.afterEach(function () {
    let flags = ENV.featureFlags as Flags;
    if (previous === undefined) {
      delete flags[flag];
    } else {
      flags[flag] = previous;
    }
  });
}
