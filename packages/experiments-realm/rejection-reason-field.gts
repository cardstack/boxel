import { StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';

// Colocated so the reject-candidate flow (command + dialog) shares one
// definition of "what a rejection reason is" instead of the dialog and the
// command drifting apart on allowed values.
export const REJECTION_REASONS = [
  'not-a-fit',
  'experience-gap',
  'compensation-mismatch',
  'withdrew',
  'position-cancelled',
  'culture-fit',
  'other',
];

export const REJECTION_REASON_LABELS: Record<string, string> = {
  'not-a-fit': 'Not a fit',
  'experience-gap': 'Experience gap',
  'compensation-mismatch': 'Compensation mismatch',
  withdrew: 'Candidate withdrew',
  'position-cancelled': 'Position cancelled',
  'culture-fit': 'Culture fit',
  other: 'Other',
};

// Options array is exported so RejectCandidateDialog can render the same
// choices the field itself validates against, without hand-copying the list.
export const REJECTION_REASON_OPTIONS = REJECTION_REASONS.map((value) => ({
  value,
  label: REJECTION_REASON_LABELS[value],
}));

export const RejectionReasonField = enumField(StringField, {
  options: REJECTION_REASON_OPTIONS,
  displayName: 'Rejection Reason',
});
