import { jq, fx } from '../../src/index.js';
import type { BxlTaggedSource } from '../../src/index.js';

export interface HospitalExpression {
  name: string;
  /**
   * Source as the realm's .gts file would write it. Plain string for
   * readable BXL, or one of the tagged-template forms.
   */
  source: string | BxlTaggedSource;
  /**
   * Expected single-output value when evaluated against patient.json
   * (with the hospital schema in scope).
   */
  expected: unknown;
  /** One-line note about which BXL feature this exercises. */
  illustrates: string;
}

export const hospitalExpressions: HospitalExpression[] = [
  // --- plain-string readable BXL --------------------------------
  {
    name: 'severityLabel',
    source: 'Severity',
    expected: 'Moderate',
    illustrates: 'PascalCase fallback (no schema needed)',
  },
  {
    name: 'isHighSeverity',
    source: 'Severity == "High" or Severity == "Critical"',
    expected: false,
    illustrates: 'PascalCase fallback + Excel == operator',
  },
  {
    name: 'admissionState',
    source:
      'if .dischargeDate then "discharged" elif .admissionDate then "admitted" else "pending" end',
    expected: 'discharged',
    illustrates: 'jq if/elif/else/end inside a plain string',
  },

  // --- fx`…` — Excel-style ---------------------------------------
  {
    name: 'fullNameWithId',
    source: fx`PatientId & " — " & FirstName & " " & LastName`,
    expected: 'PT-1001 — Margaret Okonkwo',
    illustrates: 'Excel & string-concat operator',
  },
  {
    name: 'totalCharges',
    source: fx`Billing.RoomCharge + Billing.Procedures + Billing.Pharmacy`,
    expected: 10810,
    illustrates: 'nested PascalCase path resolution',
  },
  {
    name: 'bpRatio',
    source: fx`ROUND(Vitals.BpSystolic / Vitals.BpDiastolic, 2)`,
    expected: 1.57,
    illustrates: 'Excel ROUND function with PascalCase path',
  },

  // --- jq`…` — plain jq with backslash interpolation -------------
  {
    name: 'bloodPressureLabel',
    source: jq`"\(.vitals.bpSystolic)/\(.vitals.bpDiastolic)"`,
    expected: '138/88',
    illustrates: 'jq \\(...) interpolation surviving JS escape gotcha',
  },
  {
    name: 'medicationNames',
    source: jq`[.medications[].name]`,
    expected: ['Metoprolol', 'Warfarin'],
    illustrates: 'jq array iteration, no readable-syntax compile step',
  },
];
