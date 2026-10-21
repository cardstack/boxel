import ENV from '@cardstack/host/config/environment';

type FeatureFlag = keyof NonNullable<typeof ENV.featureFlags>;

// Turns a build-time feature flag on for every test in the module. The test
// build starts with every flag off.
export function setupFeatureFlag(hooks: NestedHooks, flag: FeatureFlag) {
  let previous: boolean | undefined;
  hooks.beforeEach(function () {
    ENV.featureFlags ??= {};
    previous = ENV.featureFlags[flag];
    ENV.featureFlags[flag] = true;
  });
  hooks.afterEach(function () {
    ENV.featureFlags![flag] = previous;
  });
}
