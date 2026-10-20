import type {
  BoxelContext,
  MatrixEvent as DiscreteMatrixEvent,
} from '@cardstack/base/matrix-event';

// The context each human message in the room carries, oldest first. Messages
// the bot sent carry no user context and are skipped.
export function* humanMessageContexts(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): Generator<BoxelContext> {
  for (let event of history) {
    if (event.sender === aiBotUserId) {
      continue;
    }
    let data = (event.content as { data?: unknown })?.data;
    if (typeof data === 'string') {
      // Raw room events carry `data` as serialized JSON.
      try {
        data = JSON.parse(data);
      } catch {
        data = undefined;
      }
    }
    let context =
      data && typeof data === 'object'
        ? (data as { context?: BoxelContext }).context
        : undefined;
    if (context) {
      yield context;
    }
  }
}

// The realm prefixes the host reports (`@cardstack/base/`), each mapped to the
// URL its realm is served from. A later message's mapping of a prefix replaces
// an earlier one's.
export function realmPrefixesFromHistory(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): Map<string, string> {
  let prefixes = new Map<string, string>();
  for (let context of humanMessageContexts(history, aiBotUserId)) {
    for (let [prefix, url] of Object.entries(context.realmPrefixes ?? {})) {
      if (typeof url === 'string') {
        prefixes.set(prefix, url);
      }
    }
  }
  return prefixes;
}

// The URL a prefix-form identifier (`@cardstack/base/card-api.gts`) is served
// at. Any other reference is returned unchanged.
export function resolveRealmPrefix(
  reference: string,
  prefixes: Map<string, string>,
): string {
  let match: string | undefined;
  for (let prefix of prefixes.keys()) {
    if (
      reference.startsWith(prefix) &&
      (match === undefined || prefix.length > match.length)
    ) {
      match = prefix;
    }
  }
  return match === undefined
    ? reference
    : `${prefixes.get(match)}${reference.slice(match.length)}`;
}
