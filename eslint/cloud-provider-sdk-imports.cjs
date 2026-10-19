'use strict';

// Keeps cloud provider SDKs inside the modules that adapt them (ADR 003
// §1.2). Runtime code reaches a proprietary cloud service only through an
// interface named for the capability Boxel needs, so the import of a
// provider's SDK belongs only in that interface's adapter, or in a module
// that speaks the S3 API (ADR 003 §1.3).
//
// Adding a module to CLOUD_PROVIDER_ADAPTER_MODULES moves the boundary, so it
// is a reviewed change, not a way to silence the rule.

const CLOUD_PROVIDER_SDK_IMPORTS = {
  patterns: [
    {
      group: ['@aws-sdk/*', 'aws-sdk', '@google-cloud/*', '@azure/*'],
      message:
        'Import a cloud provider SDK only in an adapter module (ADR 003 §1.2). Put the call behind an interface named for the capability, or add an adapter module to CLOUD_PROVIDER_ADAPTER_MODULES in eslint/cloud-provider-sdk-imports.cjs.',
    },
  ],
};

// The runtime packages ADR 003 governs, relative to the repository root.
const RUNTIME_PACKAGE_FILES = [
  'packages/realm-server/**/*',
  'packages/runtime-common/**/*',
  'packages/postgres/**/*',
  'packages/billing/**/*',
  'packages/bot-runner/**/*',
];

const CLOUD_PROVIDER_ADAPTER_MODULES = [
  'packages/realm-server/lib/s3-client.ts',
  'packages/realm-server/lib/secrets-at-rest/providers.ts',
  'packages/realm-server/media-cache/s3-adapter.ts',
  'packages/realm-server/prerender/artifact-sink.ts',
];

module.exports = {
  CLOUD_PROVIDER_SDK_IMPORTS,
  RUNTIME_PACKAGE_FILES,
  CLOUD_PROVIDER_ADAPTER_MODULES,
};
