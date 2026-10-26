/* eslint-env browser */
// What the secure window's key pages ask of the realm server, all under the
// window's own session (`authorizedRequest`). Each change to a key takes a key
// write ticket the window mints for that change alone, just before making it,
// so a ticket never outlives the one request it is for.
//
// Nothing here takes anything from the page that opened the window: that page
// names what the window is for (a realm, a card, an operation) and the window
// asks the realm server what those are (`windowContext`).

import { authorizedRequest, mintKeyWriteTicket } from './session.js';

function resources(json) {
  return (json.data ?? []).map(({ id, attributes }) => ({ id, ...attributes }));
}

function resource(json) {
  return { id: json.data.id, ...json.data.attributes };
}

// The user's own keys' metadata, by name. No value is ever returned.
export async function listKeys(config) {
  return resources(
    await authorizedRequest(config, '_user-keys', { method: 'GET' }),
  );
}

export async function addKey(config, { name, value }) {
  let { ticket } = await mintKeyWriteTicket(config, { action: 'add' });
  return resource(
    await authorizedRequest(config, '_user-keys', {
      body: {
        data: { type: 'user-key', attributes: { name, kind: 'static', value } },
        meta: { ticket },
      },
    }),
  );
}

export async function replaceKey(config, { keyId, value }) {
  let { ticket } = await mintKeyWriteTicket(config, {
    action: 'replace',
    keyId,
  });
  return resource(
    await authorizedRequest(config, `_user-keys/${encodeURIComponent(keyId)}`, {
      method: 'PATCH',
      body: {
        data: { type: 'user-key', id: keyId, attributes: { value } },
        meta: { ticket },
      },
    }),
  );
}

export async function deleteKey(config, { keyId }) {
  let { ticket } = await mintKeyWriteTicket(config, {
    action: 'delete',
    keyId,
  });
  await authorizedRequest(config, `_user-keys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
    body: { meta: { ticket } },
  });
}

// The shares holding one of the user's keys: those deleting it suspends.
export async function sharesOfKey(config, keyId) {
  return resources(
    await authorizedRequest(
      config,
      `_key-shares?key=${encodeURIComponent(keyId)}`,
      { method: 'GET' },
    ),
  );
}

// A realm's shares, for one of its direct writers.
export async function realmShares(config, realm) {
  return resources(
    await authorizedRequest(
      config,
      `_key-shares?realm=${encodeURIComponent(realm)}`,
      { method: 'GET' },
    ),
  );
}

export async function shareKey(config, { keyId, realm, label }) {
  let { ticket } = await mintKeyWriteTicket(config, {
    action: 'share',
    keyId,
    realm,
  });
  return resource(
    await authorizedRequest(config, '_key-shares', {
      body: {
        data: { type: 'key-share', attributes: { realm, keyId, label } },
        meta: { ticket },
      },
    }),
  );
}

export async function swapKey(config, { keyId, shareId }) {
  let { ticket } = await mintKeyWriteTicket(config, {
    action: 'swap',
    keyId,
    shareId,
  });
  return resource(
    await authorizedRequest(
      config,
      `_key-shares/${encodeURIComponent(shareId)}/swap`,
      {
        body: {
          data: { type: 'key-share', attributes: { keyId } },
          meta: { ticket },
        },
      },
    ),
  );
}

// What the window was opened for, as the realm server describes it: the
// realm (its name, and whether the user is one of its direct writers), and
// for a target, the card definition and the operation, with where that
// operation sends a key. `request` is `{ realm?, target?, operation? }`.
export async function windowContext(config, request) {
  let json = await authorizedRequest(config, '_secure-window/context', {
    body: { data: { type: 'secure-window-context', attributes: request } },
  });
  return json.data.attributes;
}
