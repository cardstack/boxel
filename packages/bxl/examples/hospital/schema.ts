import type { ReadableSchema } from '../../src/index.js';

/**
 * Schema for the hospital fixture. Mirrors the field layout of the
 * HospitalPatient card. Labels match the
 * PascalCase identifiers used in computeVia expressions so the
 * readable-syntax compiler can resolve them without falling back to
 * the no-schema PascalCase rule.
 *
 * The schema is optional — every example also runs schema-less, in
 * which case the PascalCase fallback fills in the camelCase mapping.
 */
export const hospitalSchema: ReadableSchema = {
  fields: [
    { key: 'patientId', label: 'Patient ID' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'dob', label: 'DOB' },
    { key: 'gender', label: 'Gender' },
    { key: 'bloodType', label: 'Blood Type' },
    { key: 'admissionDate', label: 'Admission Date' },
    { key: 'dischargeDate', label: 'Discharge Date' },
    { key: 'ward', label: 'Ward' },
    { key: 'diagnosis', label: 'Diagnosis' },
    { key: 'severity', label: 'Severity' },
    { key: 'today', label: 'Today' },
    {
      key: 'vitals',
      label: 'Vitals',
      kind: 'object',
      fields: [
        { key: 'bpSystolic', label: 'BP Systolic' },
        { key: 'bpDiastolic', label: 'BP Diastolic' },
        { key: 'heartRate', label: 'Heart Rate' },
        { key: 'tempC', label: 'Temp C' },
        { key: 'weightKg', label: 'Weight Kg' },
      ],
    },
    {
      key: 'billing',
      label: 'Billing',
      kind: 'object',
      fields: [
        { key: 'roomCharge', label: 'Room Charge' },
        { key: 'procedures', label: 'Procedures' },
        { key: 'pharmacy', label: 'Pharmacy' },
      ],
    },
    {
      key: 'medications',
      label: 'Medication',
      kind: 'array',
      item: {
        fields: [
          { key: 'name', label: 'Name' },
          { key: 'doseMg', label: 'Dose Mg' },
          { key: 'frequency', label: 'Frequency' },
          { key: 'startDate', label: 'Start Date' },
        ],
      },
    },
  ],
};
