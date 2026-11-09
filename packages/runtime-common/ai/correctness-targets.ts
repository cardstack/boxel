// A target of a correctness check: a card, or a file. A `.json` file is
// checked as the card instance it holds, so it counts as a card.
export function isCardCheckTarget(target: {
  type?: unknown;
  ref?: unknown;
}): boolean {
  return (
    target.type === 'card' ||
    (typeof target.ref === 'string' && target.ref.endsWith('.json'))
  );
}

// "3 cards", "1 file", "3 cards and 1 file", for the targets of a check.
export function describeCheckTargetCount(
  targets: { type?: unknown; ref?: unknown }[],
): string {
  let cards = targets.filter(isCardCheckTarget).length;
  let files = targets.length - cards;
  return [
    cards ? `${cards} ${cards === 1 ? 'card' : 'cards'}` : undefined,
    files ? `${files} ${files === 1 ? 'file' : 'files'}` : undefined,
  ]
    .filter(Boolean)
    .join(' and ');
}
