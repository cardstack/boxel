import type { Format } from '@cardstack/base/card-api';

// A prerendered island is executable Glimmer state, not merely cached HTML.
// Increment this whenever CardIsland's serialized program contract changes in
// a way that an older host cannot safely adopt.
export const CARD_ISLAND_PROTOCOL_VERSION = '1';

export type CardIslandCompatibilityFailure =
  | 'protocol-mismatch'
  | 'format-mismatch';

export function cardIslandCompatibilityFailure(
  island: HTMLElement,
  expectedFormat: Format,
): CardIslandCompatibilityFailure | undefined {
  if (island.dataset.boxelCardIslandProtocol !== CARD_ISLAND_PROTOCOL_VERSION) {
    return 'protocol-mismatch';
  }
  if (island.dataset.boxelCardFormat !== expectedFormat) {
    return 'format-mismatch';
  }
  return undefined;
}
