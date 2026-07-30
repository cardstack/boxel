/**
 * The one predicate for "this workspace path can never be a product card
 * instance" — control-plane tracker dirs, factory design scratch, and the
 * run log. Consumed by the run-log stream tracker, the ship-moment card
 * link extractor, and instance discovery; keep it here so a new
 * scaffolding directory is added in exactly one place. Matches both the
 * literal space and the %20-encoded form of "Knowledge Articles".
 */
const NON_PRODUCT_DIR_RE =
  /^(Issues|Projects|Boards|Knowledge(?: |%20)Articles|Spec|Validations|Runs|RunLogEntries|design|design-history|\.factory-scratch)(\/|$)/;

/** Whether a realm-relative path lives in a non-product (scaffolding) dir. */
export function isNonProductPath(relPath: string): boolean {
  return NON_PRODUCT_DIR_RE.test(relPath);
}
