// Extras bundle. Engineering (BIN2HEX, COMPLEX, IM*, ERF, BITAND, …) and
// financial (NPV, IRR, PMT, FV, PV, XIRR, …) co-occur in spreadsheet-style
// business workloads, so they ship as one lazy chunk. esbuild's
// code-splitter names the chunk `formula-extras-*` from this file.
//
// See bundles/formula-stats.ts for the rationale on not importing from
// `../index.js` — same shared-chunk-bloat reason.

import type { BuiltinLibrary } from '../../../jqtools/evaluate/filters/registry.ts';
import { formulaEngineeringLibrary } from '../formula-engineering.ts';
import { formulaFinancialLibrary } from '../formula-financial.ts';

export const formulaExtrasBundle: Record<string, BuiltinLibrary> = {
  'formula-engineering': formulaEngineeringLibrary,
  'formula-financial': formulaFinancialLibrary,
};
