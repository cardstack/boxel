import { statusField } from './status-field';

/**
 * The record's own existence lifecycle — distinct from any domain status. A
 * quest can be mid-flight and archived; an invoice can be paid and archived.
 * Domain process goes in a `statusField` the consumer configures; this field
 * answers only "is this record part of the working set?". Archived is a soft
 * delete: kept, queryable, hidden from working views, always reversible.
 */
export const RecordStatusField = statusField({
  displayName: 'Record Status',
  options: [
    {
      value: 'Draft',
      hue: 'slate',
      meaning: 'Being set up — not yet part of the working set.',
    },
    {
      value: 'Active',
      hue: 'teal',
      meaning: 'In use — working views include it.',
    },
    {
      value: 'Archived',
      hue: 'slate',
      terminal: true,
      holds: true,
      meaning: 'Kept for reference, hidden from working views. Not deleted.',
    },
  ],
  transitions: {
    Draft: ['Active', 'Archived'],
    Active: ['Archived'],
    Archived: ['Active'],
  },
});

export default RecordStatusField;
