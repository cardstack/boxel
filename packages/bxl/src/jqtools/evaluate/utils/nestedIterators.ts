export function* nestedIterators<Outer, Inner>(
  outer: IterableIterator<Outer>,
  inner: IterableIterator<Inner>
): IterableIterator<[Outer, IterableIterator<Inner>]> {
  let first = true;
  const memorizedInnerItems: Inner[] = [];
  for (const outerItem of outer) {
    const innerItems = first ? inner : memorizedInnerItems;
    yield [
      outerItem,
      (function* () {
        for (const innerItem of innerItems) {
          if (first) memorizedInnerItems.push(innerItem);
          yield innerItem;
        }
      })(),
    ];
    first = false;
  }
}

export function* combineIterators<Outer, Inner>(
  outer: IterableIterator<Outer>,
  inner: IterableIterator<Inner>
): IterableIterator<[Outer, Inner]> {
  for (const [outerItem, innerIterator] of nestedIterators(outer, inner)) {
    for (const innerItem of innerIterator) {
      yield [outerItem, innerItem];
    }
  }
}
