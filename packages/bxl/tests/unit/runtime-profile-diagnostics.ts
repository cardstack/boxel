import { ok, strictEqual, throws } from 'node:assert';
import {
  bxl,
  evaluateBxl,
  prepareBxlSafe,
} from '../../src/index.js';
import { evaluateBxlBare } from '../../src/runtime-bare.js';

const preparedDef = prepareBxlSafe('def twice(x): x * 2; twice(3)');
ok(preparedDef.ok, 'the unrestricted prepare/evaluate surface accepts jq def');
if (preparedDef.ok) {
  strictEqual(preparedDef.value.evaluate({}).value, 6);
}

throws(
  () => bxl('def twice(x): x * 2; twice(3)'),
  /derive-def-banned:.*does not allow user-defined helpers/,
  'computeVia rejects def with an explicit derive-profile capability diagnostic',
);

throws(
  () => evaluateBxlBare('AND([true, true])', {}),
  /runtime-bare contains jq core only; AND\/1 is a spreadsheet formula.*@cardstack\/bxl\/runtime/,
  'runtime-bare points formula callers to the full runtime',
);

strictEqual(
  evaluateBxl('DAYS(DATE(2026, 4, 30), DATE(2026, 4, 22))', {}).value,
  8,
  'DATE and DAYS are supported despite the stale dialect inventory',
);

console.log('BXL runtime profile diagnostics: all checks passed');
