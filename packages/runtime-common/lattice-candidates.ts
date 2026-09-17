import { param, type Expression } from './expression.ts';

// Only an explicitly isolated secondary batch uses the candidate table.
// The primary path keeps its existing table and predicates.
export function latticeWorkingTable(batchId?: string): string {
  return batchId ? 'lattice_index_candidates' : 'boxel_index_working';
}

export function latticeWorkingScope(batchId?: string, alias = ''): Expression {
  return batchId
    ? [`AND ${alias ? `${alias}.` : ''}batch_id =`, param(batchId)]
    : [];
}
