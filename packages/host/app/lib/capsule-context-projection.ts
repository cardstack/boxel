import type { CardContext } from '@cardstack/base/card-api';

/**
 * The narrow presentation-capability projection handed to a Capsule render
 * as `@context` (RP-11.5), factored out of the renderer so the entitlement
 * boundary it draws is directly testable (RP-21.1/RP-21.2).
 *
 * Exactly two keys may cross, both presentation surfaces:
 * `cardComponentModifier` (operator mode's ElementTracker — how
 * overlays/adorn discover rendered cards) and `searchResultsComponent`
 * (RP-21.2's one deliberate display-only asymmetry: query influence whose
 * CONTENT authored SES code cannot read back and cannot exfiltrate).
 * Never the live Host CardContext: no store, loader, service, or
 * data-bearing authority rides along — the Capsule's `@consume` facade
 * re-plucks exactly these keys (capsule-module-evaluator.ts), so nothing
 * else could ride even if a caller handed this function a fatter context.
 */
export function projectCapsuleContext(
  context: CardContext | undefined,
): unknown {
  if (!context) {
    return undefined;
  }
  return Object.freeze({
    ...(context.cardComponentModifier
      ? { cardComponentModifier: context.cardComponentModifier }
      : {}),
    ...(context.searchResultsComponent
      ? { searchResultsComponent: context.searchResultsComponent }
      : {}),
  });
}
