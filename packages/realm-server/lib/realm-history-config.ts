import { DeckdHistoryBackend } from './deckd-client.ts';

// Which realms record their writes as revisions, read from the environment.
// Off unless both are set:
//
//   REALM_HISTORY_DECKD_URL  where deckd listens, e.g. http://127.0.0.1:8787
//   REALM_HISTORY_REALMS     a comma-separated list of realm URLs, or `*` for
//                            every source realm this process mounts
//
// A published realm never records: what it holds is a copy of its source
// realm, and its own history is kept by publishing, not by writes to it.
export interface RealmHistoryConfig {
  deckdURL: string;
  realms: '*' | Set<string>;
}

export function realmHistoryConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RealmHistoryConfig | undefined {
  let deckdURL = env.REALM_HISTORY_DECKD_URL?.trim();
  let realms = env.REALM_HISTORY_REALMS?.trim();
  if (!deckdURL || !realms) {
    return undefined;
  }
  return {
    deckdURL,
    realms:
      realms === '*'
        ? '*'
        : new Set(
            realms
              .split(',')
              .map((url) => url.trim())
              .filter(Boolean)
              .map((url) => (url.endsWith('/') ? url : `${url}/`)),
          ),
  };
}

export function historyBackendFor(
  config: RealmHistoryConfig | undefined,
  realm: { url: string; kind: string; diskPath: string },
): DeckdHistoryBackend | undefined {
  if (!config || realm.kind === 'published') {
    return undefined;
  }
  if (config.realms !== '*' && !config.realms.has(realm.url)) {
    return undefined;
  }
  return new DeckdHistoryBackend({
    deckdURL: config.deckdURL,
    realmDir: realm.diskPath,
  });
}
