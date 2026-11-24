// Reusing a staged row's search keys (add-search-keys-reuse): the staging
// trigger on `boxel_index_pending` reuses the live row's `search_keys` when
// the live row's `search_keys_fp` is the staged doc's fingerprint, and
// projects the doc (`search_keys_of`) otherwise. The fingerprint is the md5 of
// the projection's version (`search_keys_version()`) and the exact staged
// doc, so a reuse never answers differently from a projection, and a
// migration that changes the projection (and so its version) projects every
// doc again. Promotion writes the fingerprint; these are its expressions.

// The fingerprint of the doc at `docExpr`, as the staging trigger computes it.
export function searchKeysFpOf(docExpr: string): string {
  return `search_keys_fp_of(${docExpr})`;
}

// The promotion's SELECT expression for `boxel_index.search_keys_fp`. SQLite
// has no projection functions and no staging trigger: it stores none.
export function searchKeysFpColumn(pg: boolean, docExpr: string): string {
  return pg
    ? `${searchKeysFpOf(docExpr)} AS search_keys_fp`
    : 'NULL AS search_keys_fp';
}
