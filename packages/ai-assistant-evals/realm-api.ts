// Just enough of the realm HTTP API for the eval runner: a per-realm session
// from a matrix access token, then reads and writes of cards and files. Talks
// to whatever realm server the URLs name; the dev stack's self-signed
// certificate is accepted for localhost.

import { matrixUrl } from './matrix-api.ts';
import { REALM_SERVER_URL } from './eval-config.ts';

// The dev stack serves the realm over a self-signed certificate, so node has
// to be told to accept it. The switch is process-wide, which is why it is
// gated on the two hosts this process actually talks to — the realm server and
// matrix — both being local. A run pointed at anything remote keeps
// verification on, and setting NODE_TLS_REJECT_UNAUTHORIZED yourself wins
// either way.
function isLocal(url: string) {
  try {
    let { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

if (
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined &&
  isLocal(REALM_SERVER_URL) &&
  isLocal(matrixUrl)
) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

export const MIME = {
  cardJson: 'application/vnd.card+json',
  cardSource: 'application/vnd.card+source',
  binary: 'application/octet-stream',
  json: 'application/json',
  jsonApi: 'application/vnd.api+json',
} as const;

export interface CardDocument {
  data: {
    id?: string;
    lid?: string;
    type: 'card';
    attributes?: Record<string, any>;
    relationships?: Record<
      string,
      { links?: { self?: string | null }; data?: unknown }
    >;
    meta: {
      adoptsFrom: { module: string; name: string };
      realmURL?: string;
      [key: string]: unknown;
    };
  };
  included?: unknown[];
}

export function ensureTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

// One matrix user talking to any number of realms. Realm sessions are minted
// on first use per realm with the realm's own `_session` endpoint, which is
// the path that honours a realm's `users` permission row (the realm server's
// `_realm-auth` only lists a user's own realms and the public ones).
export class RealmClient {
  #accessToken: string;
  #userId: string;
  #sessions = new Map<string, string>();

  constructor(accessToken: string, userId: string) {
    this.#accessToken = accessToken;
    this.#userId = userId;
  }

  async #openIdToken(): Promise<unknown> {
    let response = await fetch(
      `${matrixUrl}/_matrix/client/v3/user/${encodeURIComponent(this.#userId)}/openid/request_token`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#accessToken}`,
        },
        body: '{}',
      },
    );
    if (!response.ok) {
      throw new Error(
        `openid request_token failed for ${this.#userId}: ${response.status}`,
      );
    }
    return response.json();
  }

  // The realm server's own session, for server-level calls such as creating
  // a realm.
  async serverSession(realmServerUrl: string): Promise<string> {
    let response = await fetch(
      `${realmServerUrl.replace(/\/$/, '')}/_server-session`,
      {
        method: 'POST',
        headers: { accept: MIME.json, 'content-type': MIME.json },
        body: JSON.stringify(await this.#openIdToken()),
      },
    );
    if (!response.ok) {
      throw new Error(
        `could not open a server session on ${realmServerUrl}: ${response.status} ${await response.text()}`,
      );
    }
    let jwt = response.headers.get('authorization');
    if (!jwt) {
      throw new Error(
        `${realmServerUrl}/_server-session answered without a token`,
      );
    }
    return jwt;
  }

  // Creates a workspace for this user, the way the app's "new workspace"
  // dialog does, and answers its URL. An endpoint that already exists is
  // answered as well, so setup can run again.
  async createRealm(
    realmServerUrl: string,
    endpoint: string,
    name: string,
  ): Promise<{ url: string; created: boolean }> {
    let base = realmServerUrl.replace(/\/$/, '');
    let response = await fetch(`${base}/_create-realm`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
        authorization: await this.serverSession(realmServerUrl),
      },
      body: JSON.stringify({
        data: { type: 'realm', attributes: { endpoint, name } },
      }),
    });
    let text = await response.text();
    if (response.ok) {
      let json = JSON.parse(text) as { data?: { id?: string } };
      let url = json.data?.id;
      if (!url) {
        throw new Error(`_create-realm answered without a realm URL: ${text}`);
      }
      return { url: ensureTrailingSlash(url), created: true };
    }
    if (text.includes('already exists')) {
      let username = this.#userId.replace(/^@/, '').split(':')[0];
      return { url: `${base}/${username}/${endpoint}/`, created: false };
    }
    throw new Error(`_create-realm failed: ${response.status} ${text}`);
  }

  async session(realmUrl: string): Promise<string> {
    realmUrl = ensureTrailingSlash(realmUrl);
    let cached = this.#sessions.get(realmUrl);
    if (cached) {
      return cached;
    }
    let response = await fetch(`${realmUrl}_session`, {
      method: 'POST',
      headers: { accept: MIME.json, 'content-type': MIME.json },
      body: JSON.stringify(await this.#openIdToken()),
    });
    if (!response.ok) {
      throw new Error(
        `could not open a session on ${realmUrl}: ${response.status} ${await response.text()}`,
      );
    }
    let jwt = response.headers.get('authorization');
    if (!jwt) {
      throw new Error(`${realmUrl}_session answered without a token`);
    }
    this.#sessions.set(realmUrl, jwt);
    return jwt;
  }

  // The realm that serves a URL, from the realm-identity header every realm
  // answers a HEAD with. Needed because a card URL does not say where its
  // realm root is.
  async realmOf(url: string): Promise<string> {
    let response = await fetch(url, {
      method: 'HEAD',
      headers: { accept: MIME.json },
    });
    let realm = response.headers.get('x-boxel-realm-url');
    if (!realm) {
      throw new Error(
        `${url} did not identify its realm (status ${response.status})`,
      );
    }
    return ensureTrailingSlash(realm);
  }

  async #fetch(
    realmUrl: string,
    url: string,
    init: RequestInit & { headers: Record<string, string> },
  ) {
    let jwt = await this.session(realmUrl);
    let response = await fetch(url, {
      ...init,
      redirect: 'follow',
      headers: { ...init.headers, authorization: jwt },
    });
    if (response.status === 401) {
      // The session may have expired; mint one more and retry once.
      this.#sessions.delete(ensureTrailingSlash(realmUrl));
      jwt = await this.session(realmUrl);
      response = await fetch(url, {
        ...init,
        redirect: 'follow',
        headers: { ...init.headers, authorization: jwt },
      });
    }
    return response;
  }

  async getCard(realmUrl: string, cardUrl: string): Promise<CardDocument> {
    let response = await this.#fetch(realmUrl, cardUrl, {
      headers: { accept: MIME.cardJson },
    });
    if (!response.ok) {
      throw new Error(
        `GET ${cardUrl} failed: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as CardDocument;
  }

  async cardExists(realmUrl: string, cardUrl: string): Promise<boolean> {
    let response = await this.#fetch(realmUrl, cardUrl, {
      headers: { accept: MIME.cardJson },
    });
    return response.ok;
  }

  // Every file in the realm, as paths relative to its root. The realm answers a
  // directory URL with a JSON:API document whose relationships are its entries,
  // each marked `file` or `directory` in its meta.
  async listFiles(realmUrl: string): Promise<string[]> {
    realmUrl = ensureTrailingSlash(realmUrl);
    let walk = async (url: string): Promise<string[]> => {
      let response = await this.#fetch(realmUrl, url, {
        headers: { accept: MIME.jsonApi },
      });
      if (!response.ok) {
        throw new Error(
          `listing ${url} failed: ${response.status} ${await response.text()}`,
        );
      }
      let doc = (await response.json()) as {
        data?: {
          relationships?: Record<
            string,
            { links?: { related?: string }; meta?: { kind?: string } }
          >;
        };
      };
      let paths: string[] = [];
      for (let entry of Object.values(doc.data?.relationships ?? {})) {
        let related = entry.links?.related;
        if (!related) {
          continue;
        }
        if (entry.meta?.kind === 'directory') {
          paths.push(...(await walk(related)));
        } else {
          paths.push(related.slice(realmUrl.length));
        }
      }
      return paths;
    };
    return (await walk(realmUrl)).sort();
  }

  // A file's bytes. Modules can be asked for without their extension; the
  // realm redirects to the real file, and the final URL says which.
  async getSource(
    realmUrl: string,
    fileUrl: string,
  ): Promise<{ url: string; body: Uint8Array }> {
    let response = await this.#fetch(realmUrl, fileUrl, {
      headers: { accept: MIME.cardSource },
    });
    if (!response.ok) {
      throw new Error(
        `GET ${fileUrl} (source) failed: ${response.status} ${await response.text()}`,
      );
    }
    return {
      url: response.url || fileUrl,
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }

  async putSource(realmUrl: string, fileUrl: string, body: string) {
    let response = await this.#fetch(realmUrl, fileUrl, {
      method: 'POST',
      headers: { accept: MIME.cardSource },
      body,
    });
    if (!response.ok) {
      throw new Error(
        `write of ${fileUrl} failed: ${response.status} ${await response.text()}`,
      );
    }
  }

  async deleteFile(realmUrl: string, fileUrl: string) {
    let response = await this.#fetch(realmUrl, fileUrl, {
      method: 'DELETE',
      headers: { accept: MIME.cardSource },
    });
    // A file that is already gone is the state the caller wanted.
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `delete of ${fileUrl} failed: ${response.status} ${await response.text()}`,
      );
    }
  }

  async putBinary(realmUrl: string, fileUrl: string, body: Uint8Array) {
    let response = await this.#fetch(realmUrl, fileUrl, {
      method: 'POST',
      headers: { accept: MIME.binary, 'content-type': MIME.binary },
      body: new Blob([body as BlobPart]),
    });
    if (!response.ok) {
      throw new Error(
        `upload of ${fileUrl} failed: ${response.status} ${await response.text()}`,
      );
    }
  }

  // Creates a card under `directory` (the realm root or a folder in it); the
  // realm picks the file name and answers with the card, id included.
  async createCard(
    realmUrl: string,
    directory: string,
    doc: CardDocument,
  ): Promise<CardDocument> {
    let response = await this.#fetch(realmUrl, ensureTrailingSlash(directory), {
      method: 'POST',
      headers: { accept: MIME.cardJson, 'content-type': MIME.cardJson },
      body: JSON.stringify(doc),
    });
    if (!response.ok) {
      throw new Error(
        `create card in ${directory} failed: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as CardDocument;
  }

  async patchCard(
    realmUrl: string,
    cardUrl: string,
    doc: CardDocument,
  ): Promise<CardDocument> {
    let response = await this.#fetch(realmUrl, cardUrl, {
      method: 'PATCH',
      headers: { accept: MIME.cardJson, 'content-type': MIME.cardJson },
      body: JSON.stringify(doc),
    });
    if (!response.ok) {
      throw new Error(
        `patch of ${cardUrl} failed: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as CardDocument;
  }
}

// Poll until the realm serves a card, for writes that return before the
// index has caught up.
export async function waitForCard(
  client: RealmClient,
  realmUrl: string,
  cardUrl: string,
  timeoutMs = 90_000,
) {
  let deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await client.cardExists(realmUrl, cardUrl)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`${cardUrl} was not indexed within ${timeoutMs / 1000}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
