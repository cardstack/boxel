// Hospital fixtures shared across the Boxel-flavored BXL test suites.
//
// These mirror the hospital fixture cards (`HospitalPatient`,
// `HospitalStaff`, `HospitalIcuPatient`) but as
// plain JS data — no `@field`, no realm runtime, no Boxel imports.
// Every Boxel test imports from here so a regression that breaks a
// realm card gets caught upstream in BXL CI before the bundle ships.
//
// Adding a new fuzz pattern? Mirror it both in the realm
// (`Hospital/HospitalPatient/fuzz-*.json`) and as a fixture export
// here so the corresponding behavior gets a unit test.

export interface Vitals {
  bpSystolic: number | null;
  bpDiastolic: number | null;
  heartRate: number | null;
  tempC: number | null;
  weightKg: number | null;
}

export interface Billing {
  roomCharge: number | null;
  procedures: number | null;
  pharmacy: number | null;
}

export interface Medication {
  name: string | null;
  doseMg: number | string | null;
  frequency: string | null;
  startDate: string | null;
}

export interface Patient {
  patientId: string;
  firstName: string | null;
  lastName: string | null;
  dob: string | null;
  gender: string | null;
  bloodType: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  ward: string | null;
  diagnosis: string | null;
  severity: 'Low' | 'Moderate' | 'High' | 'Critical' | null;
  today: string;
  vitals: Vitals;
  billing: Billing;
  medications: Medication[] | null;
}

export interface IcuPatient extends Patient {
  icuAdmissionDate: string | null;
  ventilatorRequired: boolean;
  gcsScore: number | null;
}

export interface Staff {
  staffId: string;
  name: string;
  role: string;
  yearsExp: number | null;
  salary: number | null;
  department: string | null;
}

export const baselinePatient: Patient = {
  patientId: 'PT-1001',
  firstName: 'Margaret',
  lastName: 'Okonkwo',
  dob: '1962-03-14',
  gender: 'F',
  bloodType: 'A+',
  admissionDate: '2024-11-01',
  dischargeDate: '2024-11-08',
  ward: 'Cardiology',
  diagnosis: 'Atrial Fibrillation',
  severity: 'Moderate',
  today: '2024-11-15',
  vitals: {
    bpSystolic: 138,
    bpDiastolic: 88,
    heartRate: 94,
    tempC: 37.1,
    weightKg: 72.4,
  },
  billing: {
    roomCharge: 6300,
    procedures: 4200,
    pharmacy: 310,
  },
  medications: [
    { name: 'Metoprolol', doseMg: 50, frequency: 'twice daily', startDate: '2024-11-01' },
    { name: 'Warfarin', doseMg: 5, frequency: 'once daily', startDate: '2024-11-02' },
  ],
};

export const highSeverityPatient: Patient = {
  ...baselinePatient,
  patientId: 'PT-1002',
  firstName: 'Jonas',
  lastName: 'Albrecht',
  severity: 'High',
  ward: 'ICU',
  diagnosis: 'Severe pneumonia',
  vitals: {
    bpSystolic: 178,
    bpDiastolic: 105,
    heartRate: 122,
    tempC: 39.4,
    weightKg: 81,
  },
};

export const dischargedPatient: Patient = {
  ...baselinePatient,
  patientId: 'PT-1003',
  firstName: 'Priya',
  lastName: 'Ramaswamy',
  admissionDate: '2024-09-12',
  dischargeDate: '2024-09-19',
  severity: 'Low',
  diagnosis: 'Routine cataract surgery',
  ward: 'Outpatient',
};

export const fuzzEmptyVitals: Patient = {
  ...baselinePatient,
  patientId: 'PT-FUZZ-EMPTY-VITALS',
  vitals: {
    bpSystolic: null,
    bpDiastolic: null,
    heartRate: null,
    tempC: null,
    weightKg: null,
  },
};

export const fuzzBadTypes: Patient = {
  ...baselinePatient,
  patientId: 'PT-FUZZ-BAD-TYPES',
  // Intentional type holes to exercise null-tolerant arithmetic and
  // string coercion. The cast keeps TypeScript happy while letting the
  // runtime see the wrong shape — that's the whole point.
  vitals: {
    bpSystolic: 'high' as unknown as number,
    bpDiastolic: null,
    heartRate: 'fast' as unknown as number,
    tempC: '99.4' as unknown as number,
    weightKg: null,
  },
};

export const fuzzShellRecord: Partial<Patient> & { patientId: string; today: string } = {
  patientId: 'PT-FUZZ-SHELL',
  today: '2024-11-15',
};

export const fuzzExtremeNumbers: Patient = {
  ...baselinePatient,
  patientId: 'PT-FUZZ-EXTREME',
  vitals: {
    bpSystolic: -10,
    bpDiastolic: 0,
    heartRate: 9999,
    tempC: 0,
    weightKg: -5,
  },
  billing: {
    roomCharge: 0,
    procedures: 1_000_000,
    pharmacy: -250,
  },
};

export const fuzzUnicodeNames: Patient = {
  ...baselinePatient,
  patientId: 'PT-FUZZ-UNICODE',
  firstName: 'Søren',
  lastName: "O'Hara-Müller",
  diagnosis: '心室細動',
  ward: 'Wing-α',
};

export const icuWarner: IcuPatient = {
  patientId: 'PT-ICU-001',
  firstName: 'Warner',
  lastName: 'Cohen',
  dob: '1955-09-12',
  gender: 'M',
  bloodType: 'A+',
  admissionDate: '2024-11-10',
  dischargeDate: null,
  ward: 'ICU-3',
  diagnosis: 'Septic shock',
  severity: 'Critical',
  today: '2024-11-15',
  vitals: {
    bpSystolic: 92,
    bpDiastolic: 58,
    heartRate: 122,
    tempC: 38.9,
    weightKg: 81,
  },
  billing: {
    roomCharge: 4200,
    procedures: 12_500,
    pharmacy: 1850,
  },
  medications: [
    { name: 'Norepinephrine', doseMg: 0.1, frequency: 'continuous infusion', startDate: '2024-11-10' },
    { name: 'Vancomycin', doseMg: 1500, frequency: 'every 12 hours', startDate: '2024-11-10' },
  ],
  icuAdmissionDate: '2024-11-11',
  ventilatorRequired: true,
  gcsScore: 7,
};

export const baselineStaff: Staff = {
  staffId: 'ST-001',
  name: 'Dr. Aisha Tahir',
  role: 'Chief of Cardiology',
  yearsExp: 18,
  salary: 410_000,
  department: 'Cardiology',
};

export const operationsStaff: Staff = {
  staffId: 'ST-002',
  name: 'Mike Donovan',
  role: 'Facilities Coordinator',
  yearsExp: 7,
  salary: 78_000,
  department: 'Operations',
};

export const fuzzShellStaff: Partial<Staff> & { staffId: string } = {
  staffId: 'ST-FUZZ-SHELL',
};
