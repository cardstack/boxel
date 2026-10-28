import type RealmServerService from '../services/realm-server';

// A realm's shares, read and changed through the realm server's shares API
// under the user's own realm-server session. A share holds no secret, only a
// reference to its owner's key, so nothing here sends or receives a value.
//
// Only the realm's direct writers see its shares; anyone else is refused with
// a 403. Suspending a share and withdrawing your own take no key write ticket:
// they only stop a key being used. Sharing, swapping and resuming, which put a
// key into use, take one, which the app page can't mint, so it opens the
// secure window for them instead.

export type KeyShareState = 'active' | 'suspended';

export type KeyShareSuspensionReason =
  | 'owner-lost-write'
  | 'suspended-by-writer'
  | 'key-deleted';

export type KeyBindingState = 'active' | 'needs-reapproval' | 'suspended';

// An operation a share is approved for in the realm: one binding. The realm
// server names the type's module and the card in RRI form.
export interface RealmKeyShareOperation {
  bindingId: string;
  type: { module: string; name: string };
  operation: string;
  instance: string | null;
  slot: string;
  state: KeyBindingState;
}

export interface RealmKeyShare {
  id: string;
  label: string;
  // Null once no permission row in the realm names the owner.
  owner: string | null;
  state: KeyShareState;
  suspensionReason: KeyShareSuspensionReason | null;
  suspendedBy: string | null;
  suspendedAt: string | null;
  operations: RealmKeyShareOperation[];
}

// The realm server refused a change or a listing, with its status and its own
// message.
export class KeyShareError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sharesURL(realmServer: RealmServerService, path = ''): string {
  return new URL(`_key-shares${path}`, realmServer.url).href;
}

async function refusal(response: Response): Promise<KeyShareError> {
  let detail: string | undefined;
  try {
    let body = await response.json();
    let [error] = body?.errors ?? [];
    detail =
      typeof error === 'string' ? error : (error?.detail ?? error?.title);
  } catch {
    // a body that isn't JSON leaves the status to speak for itself
  }
  return new KeyShareError(
    response.status,
    detail ?? `the realm server answered ${response.status}`,
  );
}

// The realm's shares, by label, or undefined when the user isn't one of its
// direct writers.
export async function listRealmKeyShares(
  realmServer: RealmServerService,
  realm: string,
): Promise<RealmKeyShare[] | undefined> {
  let url = new URL(sharesURL(realmServer));
  url.searchParams.set('realm', realm);
  let response = await realmServer.authedFetch(url.href, {
    headers: { Accept: 'application/vnd.api+json' },
  });
  if (response.status === 403) {
    return undefined;
  }
  if (!response.ok) {
    throw await refusal(response);
  }
  let { data } = (await response.json()) as {
    data: { id: string; attributes: Omit<RealmKeyShare, 'id'> }[];
  };
  return data.map(({ id, attributes }) => ({
    id,
    label: attributes.label,
    owner: attributes.owner ?? null,
    state: attributes.state,
    suspensionReason: attributes.suspensionReason ?? null,
    suspendedBy: attributes.suspendedBy ?? null,
    suspendedAt: attributes.suspendedAt ?? null,
    operations: attributes.operations ?? [],
  }));
}

export async function suspendKeyShare(
  realmServer: RealmServerService,
  shareId: string,
): Promise<void> {
  let response = await realmServer.authedFetch(
    sharesURL(realmServer, `/${encodeURIComponent(shareId)}/suspend`),
    {
      method: 'POST',
      headers: { Accept: 'application/vnd.api+json' },
    },
  );
  if (!response.ok) {
    throw await refusal(response);
  }
}

export async function unshareKey(
  realmServer: RealmServerService,
  shareId: string,
): Promise<void> {
  let response = await realmServer.authedFetch(
    sharesURL(realmServer, `/${encodeURIComponent(shareId)}`),
    {
      method: 'DELETE',
      headers: { Accept: 'application/vnd.api+json' },
    },
  );
  if (!response.ok) {
    throw await refusal(response);
  }
}
