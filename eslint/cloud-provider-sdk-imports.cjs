'use strict';

// Keeps cloud provider SDKs inside the modules that adapt them (ADR 003
// §1.2). Runtime code reaches a proprietary cloud service only through an
// interface named for the capability Boxel needs, so loading a provider's SDK
// belongs only in that interface's adapter, or in a module that speaks the S3
// API (ADR 003 §1.3). `@cardstack/boxel/no-cloud-provider-sdk` reports every
// way of loading one: static import, re-export, dynamic `import()`, and
// `require()`.
//
// Adding a module to CLOUD_PROVIDER_ADAPTER_MODULES moves the boundary, so it
// is a reviewed change, not a way to silence the rule.

const CLOUD_PROVIDER_SDK_RULE = [
  'error',
  { patterns: ['@aws-sdk/*', 'aws-sdk', '@google-cloud/*', '@azure/*'] },
];

// The runtime packages ADR 003 governs that lint through an eslintrc config,
// relative to the repository root. `host` and `ai-bot` are `root: true` and
// `boxel-ui` uses a flat config, so each of those declares the rule itself.
const RUNTIME_PACKAGE_FILES = [
  'packages/realm-server/**/*',
  'packages/runtime-common/**/*',
  'packages/postgres/**/*',
  'packages/billing/**/*',
  'packages/bot-runner/**/*',
  'packages/base/**/*',
  'packages/bxl/**/*',
];

const CLOUD_PROVIDER_ADAPTER_MODULES = [
  'packages/realm-server/lib/s3-client.ts',
  'packages/realm-server/lib/secrets-at-rest/providers.ts',
  'packages/realm-server/media-cache/s3-adapter.ts',
  'packages/realm-server/prerender/artifact-sink.ts',
];

module.exports = {
  CLOUD_PROVIDER_SDK_RULE,
  RUNTIME_PACKAGE_FILES,
  CLOUD_PROVIDER_ADAPTER_MODULES,
};
