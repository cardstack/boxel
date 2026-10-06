// Pretui — demo-json: the sample document the JsonEditor usage page renders.
/** The awkward document. Every oddity here is load-bearing for a demo. */
export const SAMPLE = [
  '{',
  '  "order": "SO-4471",',
  '  "customer": { "name": "Ada Lovelace", "email": "ada@example.com", "vip": true },',
  '  "ledgerId": 9007199254740993,',
  '  "note": "",',
  '  "cancelledAt": null,',
  '  "lines": [',
  '    { "sku": "TEA-001", "qty": 2, "unit": 12.5 },',
  '    { "sku": "TEA-014", "qty": 1, "unit": 31 },',
  '    { "sku": "POT-002", "qty": 1, "unit": 48.75 }',
  '  ],',
  '  "meta": { "channel": { "source": { "campaign": "spring", "medium": "email" } } }',
  '}',
].join('\n');
