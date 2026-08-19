// Smoke check that BXL_BUILD_INFO has the expected shape and that the
// feature list isn't accidentally empty.

import { ok, strictEqual } from 'node:assert';
import { BXL_BUILD_INFO, VERSION } from '../../src/index.ts';

strictEqual(BXL_BUILD_INFO.version, VERSION, 'version mirrors VERSION');

ok(Array.isArray(BXL_BUILD_INFO.features));
ok(BXL_BUILD_INFO.features.length > 0, 'features list is non-empty');

// Feature identifiers are compared and grepped for by consumers, so they must
// stay opaque tokens — spaces or shell-special characters would defeat that.
for (const feature of BXL_BUILD_INFO.features) {
  ok(
    /^[a-z0-9-]+$/.test(feature),
    `feature "${feature}" is greppable (lowercase, no spaces)`,
  );
}

// Behaviors that consumers depend on must be advertised.
const required = [
  'null-tolerance',
  'jq-fx-tags',
  'as-materialize',
  'pascalcase-fallback',
  'jq-keywords-guard',
  'authorization-kernel',
  'boxel-source-mutation-adapter',
  'boxel-source-structural-lowering',
  'computed-write-skip',
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
