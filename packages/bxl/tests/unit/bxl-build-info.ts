// Smoke check that BXL_BUILD_INFO has the expected shape and the
// feature list isn't accidentally empty. The realm-bundle build
// script overrides `buildTime` to a real timestamp; the source
// default is the string 'dev', which is what we see when running
// from source (this test).

import { ok, strictEqual } from 'node:assert';
import { BXL_BUILD_INFO, VERSION } from '../../src/index.js';

strictEqual(BXL_BUILD_INFO.version, VERSION, 'version mirrors VERSION');
strictEqual(
  BXL_BUILD_INFO.buildTime,
  'dev',
  "source-loaded build info has buildTime='dev' — bundle script overrides at build time",
);

ok(Array.isArray(BXL_BUILD_INFO.features));
ok(BXL_BUILD_INFO.features.length > 0, 'features list is non-empty');

// Every feature must be the kind of opaque sentinel string operators
// can grep for in a served bundle. Spaces / shell-special characters
// would defeat the grep workflow.
for (const feature of BXL_BUILD_INFO.features) {
  ok(
    /^[a-z0-9-]+$/.test(feature),
    `feature "${feature}" is greppable (lowercase, no spaces)`,
  );
}

// The features the realm currently depends on must be present.
const required = [
  'null-tolerance',
  'jq-fx-tags',
  'as-materialize',
  'pascalcase-fallback',
  'jq-keywords-guard',
];
for (const r of required) {
  ok(
    (BXL_BUILD_INFO.features as readonly string[]).includes(r),
    `BXL_BUILD_INFO.features includes "${r}"`,
  );
}

console.log(
  `BXL_BUILD_INFO smoke: shape ✓, ${BXL_BUILD_INFO.features.length} feature(s)`,
);
