import type { BxlBoxelSourceDefinition } from '@cardstack/bxl/mutation';

import type { DefinitionKind } from '../definitions.ts';

// `BxlBoxelSourceDefinition` is a loaderless mirror of `Definition`, and it is
// kept in step by hand: no call site hands a `Definition` to the mutation
// planner, so nothing would notice the two drifting apart until the first one
// tried. This record is what notices. `Record<DefinitionKind, …>` fails to
// compile when the definition cache learns a family the mirror has no legal
// value for, which is the direction that strands a caller.
//
// It lives here rather than in `definitions.ts` because reaching for a bxl type
// pulls bxl's sources into the typecheck program of whatever imports it, and
// lowering is the one entry that already pays that. Nothing imports this file:
// the package's own typecheck covers every file under it, which is exactly the
// reach this guard wants.
export const bxlMirroredDefinitionKinds = {
  'card-def': 'card-def',
  'field-def': 'field-def',
  'file-def': 'file-def',
} satisfies Record<
  DefinitionKind,
  NonNullable<BxlBoxelSourceDefinition['type']>
>;
