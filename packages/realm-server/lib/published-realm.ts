import { ensureTrailingSlash } from '@cardstack/runtime-common';

// A published realm and the realm it was published from.
export interface PublishedFrom {
  realmURL: string;
  sourceRealmURL: string;
}

// How a realm named by a registry row is mounted, as far as being published
// goes: the options the `Realm` takes, and what its `callApi` sender reads
// through. The server and the test reconciler both mount from this, so the two
// can't disagree about a published row.
//
// Mounting a published realm with `published` is what keeps its policy to the
// grants that send a key shared with its source, and so what keeps every write
// out of it: its `realm.json` names a full copy of the source's policy.
// `sourceRealmURL` and `publishedFrom` follow from the row's source, which a
// published row always names.
export function publishedMountOf(row: {
  url: string;
  kind: string;
  source_url: string | null;
}): {
  realm: { published?: true; sourceRealmURL?: string };
  publishedFrom?: PublishedFrom;
} {
  if (row.kind !== 'published') {
    return { realm: {} };
  }
  if (!row.source_url) {
    return { realm: { published: true } };
  }
  let publishedFrom = {
    realmURL: ensureTrailingSlash(row.url),
    sourceRealmURL: ensureTrailingSlash(row.source_url),
  };
  return {
    realm: { published: true, sourceRealmURL: publishedFrom.sourceRealmURL },
    publishedFrom,
  };
}
