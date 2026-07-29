/**
 * The factory lifecycle phases, in execution order. A run works phases
 * front to back and stops after the `--to-phase` target: everything in a
 * later phase stays on the board as a visible decision point for the
 * operator instead of executing unattended.
 *
 * - `design` — the meta/foundational turns: bootstrap, port analysis,
 *   and the design-foundation issue. Always eligible; they are what the
 *   later phases consume.
 * - `implementation` — feature issues, their defect fixes, and any other
 *   issue type not claimed by another phase. The default target.
 * - `hardening` — QUnit test passes over the shipped cards. Hardening
 *   issues are synthesized by the loop (one per done implementation
 *   issue) when the run targets this phase or later.
 * - `polishing` — the bootstrap's self-generated pass-2 `enhancement`
 *   scope. Its own text says operators may cancel it wholesale, so it
 *   never runs unless explicitly targeted.
 */
export type FactoryPhase =
  | 'design'
  | 'implementation'
  | 'hardening'
  | 'polishing';

export const FACTORY_PHASES: readonly FactoryPhase[] = [
  'design',
  'implementation',
  'hardening',
  'polishing',
];

export function phaseRank(phase: FactoryPhase): number {
  return FACTORY_PHASES.indexOf(phase);
}

/**
 * Parse a `--to-phase` value. Returns undefined for undefined input (let
 * the default apply); throws on an unknown phase name.
 */
export function parseFactoryPhase(raw: unknown): FactoryPhase | undefined {
  if (raw === undefined) return undefined;
  if (
    typeof raw === 'string' &&
    (FACTORY_PHASES as readonly string[]).includes(raw)
  ) {
    return raw as FactoryPhase;
  }
  throw new Error(
    `Invalid phase: "${String(raw)}". Valid phases: ${FACTORY_PHASES.join(', ')}.`,
  );
}

/**
 * Which phase an issue belongs to, derived from its `issueType`. Types
 * are open-ended strings (agents invent synonyms), so anything not
 * explicitly claimed by design/hardening/polishing is implementation
 * work — including the defect/bug-fix family.
 */
export function issuePhase(issue: { issueType?: string }): FactoryPhase {
  switch (issue.issueType) {
    case 'bootstrap':
    case 'analysis':
    case 'design':
      return 'design';
    case 'hardening':
      return 'hardening';
    case 'enhancement':
      return 'polishing';
    default:
      return 'implementation';
  }
}
