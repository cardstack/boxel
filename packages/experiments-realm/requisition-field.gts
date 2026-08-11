import { StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';

import { stateColor, type StateColor } from './utils/index';

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

// Reuses the Ledger palette the rest of the tracker's status pills draw
// from: posted/filled resolve into the same green as active work, closed
// lands on the rust a rejected candidate uses, draft stays neutral.
export const REQUISITION_STATUS_COLORS: Record<string, StateColor> = {
  draft: stateColor('slate'),
  approved: stateColor('blue'),
  posted: stateColor('green'),
  filled: stateColor('green'),
  closed: stateColor('red'),
};

export const RequisitionStatusField = enumField(StringField, {
  options: REQUISITION_STATUS_OPTIONS,
  displayName: 'Requisition Status',
});
