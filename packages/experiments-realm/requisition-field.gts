import { StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';

// Requisition lifecycle: draft → approved → posted → filled → closed
// draft: not yet reviewed
// approved: ready to post
// posted: active job posting
// filled: position filled, stop recruiting
// closed: no longer needed
export const REQUISITION_STATUSES = [
  'draft',
  'approved',
  'posted',
  'filled',
  'closed',
];

export const REQUISITION_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  approved: 'Approved',
  posted: 'Posted',
  filled: 'Filled',
  closed: 'Closed',
};

export const REQUISITION_STATUS_OPTIONS = REQUISITION_STATUSES.map((value) => ({
  value,
  label: REQUISITION_STATUS_LABELS[value],
}));

export const RequisitionStatusField = enumField(StringField, {
  options: REQUISITION_STATUS_OPTIONS,
  displayName: 'Requisition Status',
});
