// Spot-check that the expressions used in the ported hospital example
// actually evaluate end-to-end through BXL. Picks a representative sample
// from each hospital .gts file.
import { evaluateBxl } from '../../src/index.js';

const cases: Array<[string, unknown, unknown, string]> = [
  [
    'ROUND(.bpSystolic / .bpDiastolic; 2)',
    { bpSystolic: 120, bpDiastolic: 80 },
    1.5,
    'hospital-fields bpRatio',
  ],
  [
    '.bpSystolic > 130 or .bpDiastolic > 80',
    { bpSystolic: 135, bpDiastolic: 85 },
    true,
    'hospital-fields hypertensionFlag',
  ],
  [
    'if .bpSystolic >= 180 or .bpDiastolic >= 120 then "crisis" elif .bpSystolic >= 140 or .bpDiastolic >= 90 then "stage2" elif .bpSystolic >= 130 or .bpDiastolic >= 80 then "stage1" else "normal" end',
    { bpSystolic: 145, bpDiastolic: 95 },
    'stage2',
    'hospital-fields acuityLabel',
  ],
  [
    'TEXTJOIN(", "; true; [.city, .state])',
    { city: 'Oakland', state: 'CA' },
    'Oakland, CA',
    'hospital-fields locationLabel',
  ],
  [
    '"\\(.bpSystolic)/\\(.bpDiastolic)"',
    { bpSystolic: 120, bpDiastolic: 80 },
    '120/80',
    'hospital-fields bloodPressureLabel',
  ],
];

let fail = 0;
for (const [expr, input, expected, label] of cases) {
  try {
    const r = evaluateBxl(expr, input);
    const pass = JSON.stringify(r.value) === JSON.stringify(expected);
    console.log(
      `${pass ? 'OK  ' : 'FAIL'} ${label.padEnd(40)} → ${JSON.stringify(r.value)} ${pass ? '' : `(expected ${JSON.stringify(expected)})`}`,
    );
    if (!pass) fail++;
  } catch (e) {
    console.log(`FAIL ${label.padEnd(40)} threw: ${(e as Error).message}`);
    console.log(`     expr: ${expr}`);
    fail++;
  }
}
console.log(`\n${cases.length - fail}/${cases.length} hospital spot-checks passed`);
process.exit(fail);
