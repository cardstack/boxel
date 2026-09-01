import { statusField, canTransition, nextStatuses } from './status-field';

// Pipeline Stage — extracted from `opportunity.gts`, where it lived as a
// private `StageField` (plain enumField, no transition graph). Sole
// consumers (`deal.gts`, `revenue-os.gts`, `board-demo.gts`) all imported it
// via `PIPELINE_STAGES`/`STAGE_COLORS` re-exported from `./opportunity` — see
// the re-export shim at the bottom of that file, kept so none of them need
// editing.
//
// UPGRADED to the realm's `statusField` utility (was plain `enumField`): the
// stage vocabulary and default probabilities are unchanged, but the graph
// below now says which moves are legal, matching the Order/Payment
// convention already established elsewhere on this realm. Absent edges carry
// meaning, same as those: nothing returns to an earlier stage (a deal that
// needs requalifying is a new deal, not a rewound one), and both closed
// states are terminal — a "reopened" deal is a new Opportunity record, not
// an edit to a closed one's history.

export const PIPELINE_STAGES = [
  'new lead',
  'contacted',
  'qualified',
  'discovery',
  'proposal',
  'negotiation',
  'closed won',
  'closed lost',
] as const;

export const STAGE_DEFAULT_PROBABILITY: Record<string, number> = {
  'new lead': 10,
  contacted: 20,
  qualified: 30,
  discovery: 50,
  proposal: 70,
  negotiation: 85,
  'closed won': 100,
  'closed lost': 0,
};

export const STAGE_COLORS: Record<string, string> = {
  'new lead': '#94a3b8',
  contacted: '#60a5fa',
  qualified: '#34d399',
  discovery: '#2dd4bf',
  proposal: '#fbbf24',
  negotiation: '#f59e0b',
  'closed won': '#16a34a',
  'closed lost': '#dc2626',
};

export function stageSlug(stage: string | undefined): string {
  return (stage ?? '').replace(/\s+/g, '-');
}

export const PipelineStageField = statusField({
  displayName: 'Pipeline Stage',
  options: [
    {
      value: 'new lead',
      hue: 'slate',
      meaning: 'Not yet contacted.',
    },
    {
      value: 'contacted',
      hue: 'blue',
      meaning: 'A rep has reached out; no qualification yet.',
    },
    {
      value: 'qualified',
      hue: 'teal',
      meaning: 'Confirmed budget, authority, need, and timeline.',
    },
    {
      value: 'discovery',
      hue: 'purple',
      meaning: 'Scoping the actual solution with the prospect.',
    },
    {
      value: 'proposal',
      hue: 'amber',
      meaning: 'A priced proposal or quote is with the prospect.',
    },
    {
      value: 'negotiation',
      hue: 'orange',
      meaning: 'Terms are being finalized before signature.',
    },
    {
      value: 'closed won',
      hue: 'green',
      terminal: true,
      holds: true,
      meaning: 'Deal signed. Nothing further happens on this record.',
    },
    {
      value: 'closed lost',
      hue: 'red',
      terminal: true,
      holds: true,
      meaning: 'Deal will not close. A revival is a new Opportunity.',
    },
  ],
  transitions: {
    'new lead': ['contacted', 'closed lost'],
    contacted: ['qualified', 'closed lost'],
    qualified: ['discovery', 'closed lost'],
    discovery: ['proposal', 'closed lost'],
    proposal: ['negotiation', 'closed lost'],
    negotiation: ['closed won', 'closed lost'],
  },
});

export { canTransition, nextStatuses };
