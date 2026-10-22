// Which document `_federated-search` returns, and therefore which code path a
// run measures. This is the most consequential choice in a workload, and it is
// not the one about which types get queried.
//
// The endpoint serves two shapes from the same filter, selected by the
// `fields[entry]` sparse fieldset in the request body:
//
//   no fieldset          the selected prerendered renderings (`html` + `css`
//                        in `included`), falling back to `item` where none
//                        match. What a grid, a card list, or the search panel
//                        fetches, because those display prerendered HTML.
//
//   fields[entry]=item   the card serializations only (`card` in `included`),
//                        from which cards are instantiated live. What
//                        `store.search` sends, and therefore the path a
//                        query-backed field takes.
//
// They are not close in cost. Measured against a deployed realm at the same
// filter and page size, the renderings run four to six times the card data —
// 94 KB against 405 KB and 537 KB for two types. A run that sends no fieldset
// is measuring what a grid costs, whatever the workload's queries say.
//
// So every run states which path it modelled, and a workload can pin it.

export const FIELDSETS = ['entries', 'item', 'item-html'] as const;

export type FieldsetName = (typeof FIELDSETS)[number];

export const DEFAULT_FIELDSET: FieldsetName = 'entries';

export function isFieldsetName(value: unknown): value is FieldsetName {
  return (
    typeof value === 'string' &&
    (FIELDSETS as readonly string[]).includes(value)
  );
}

// The wire members this fieldset contributes to a query body. `entries` sends
// no `fields` member at all, which is what selects the default resolution
// policy — it is an absence, not a value.
export function fieldsetWireMembers(
  name: FieldsetName,
): Record<string, unknown> {
  switch (name) {
    case 'entries':
      return {};
    case 'item':
      return { fields: { entry: ['item'] } };
    case 'item-html':
      return { fields: { entry: ['item', 'html'] } };
  }
}

// One line naming the path and what real client behaviour it stands for, for
// the run header and the summary. A reader must never have to infer which of
// the two a number came from.
export function describeFieldset(name: FieldsetName): string {
  switch (name) {
    case 'entries':
      return (
        'entries path (no fieldset): prerendered renderings — what a grid, ' +
        'card list, or the search panel fetches'
      );
    case 'item':
      return (
        "item path (fields[entry]=['item']): card data only — what " +
        'store.search sends, so this is the query-backed-field path'
      );
    case 'item-html':
      return (
        "item+html path (fields[entry]=['item','html']): card data and " +
        'renderings together'
      );
  }
}

export function fieldsetOptionsHelp(): string {
  return FIELDSETS.join(' | ');
}
