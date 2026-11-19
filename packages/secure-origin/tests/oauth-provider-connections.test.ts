import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  connectionPath,
  readConnections,
} from '../src/security/oauth-provider-connections.ts';

const WORKSPACES = {
  id: 'https://realm-server.example.test/mcp',
  name: 'Boxel workspaces',
  scopes: [
    { name: 'boxel:read', label: 'Read' },
    { name: 'boxel:write', label: 'Change' },
  ],
};

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    app: { kind: 'metadata-document', shown: 'example.com', verified: true },
    resources: [WORKSPACES],
    connectedAt: '2026-11-01T10:00:00.000Z',
    lastUsedAt: '2026-11-02T10:00:00.000Z',
    endsAt: '2026-12-01T10:00:00.000Z',
    renewing: true,
    ...overrides,
  };
}

describe("the Connected apps page's reading of the connection list", () => {
  test('keeps only the fields the page shows, with scope labels', () => {
    let [read] = readConnections({
      connections: [
        connection({ extra: 'never shown', clientId: 'https://example.com/' }),
      ],
    });
    assert.deepEqual(read, {
      id: 'grant-1',
      app: { kind: 'metadata-document', shown: 'example.com', verified: true },
      resources: [
        {
          id: 'https://realm-server.example.test/mcp',
          name: 'Boxel workspaces',
          labels: ['Read', 'Change'],
        },
      ],
      connectedAt: '2026-11-01T10:00:00.000Z',
      lastUsedAt: '2026-11-02T10:00:00.000Z',
      endsAt: '2026-12-01T10:00:00.000Z',
      renewing: true,
    });
  });

  test('reads a self-registered app with the name it claimed, and a connection never used', () => {
    let [read] = readConnections({
      connections: [
        connection({
          app: {
            kind: 'dynamic',
            shown: 'an app on this computer',
            verified: false,
            claimedName: 'My agent',
          },
          lastUsedAt: null,
          renewing: false,
        }),
      ],
    });
    assert.deepEqual(read?.app, {
      kind: 'dynamic',
      shown: 'an app on this computer',
      verified: false,
      claimedName: 'My agent',
    });
    assert.equal(read?.lastUsedAt, null);
    assert.equal(read?.renewing, false);
  });

  test('keeps the mark on a phrase standing in for a name, and drops one it does not know', () => {
    let read = readConnections({
      connections: [
        connection({
          id: 'loopback',
          app: {
            kind: 'dynamic',
            shown: 'an app on this computer',
            verified: false,
            standIn: 'loopback',
          },
        }),
        connection({
          id: 'unknown',
          app: {
            kind: 'dynamic',
            shown: 'an unknown app',
            verified: false,
            standIn: 'unknown',
          },
        }),
        connection({
          id: 'odd',
          app: {
            kind: 'dynamic',
            shown: 'example.com',
            verified: false,
            standIn: 'elsewhere',
          },
        }),
      ],
    });
    assert.deepEqual(
      read.map((c) => c.app.standIn),
      ['loopback', 'unknown', undefined],
    );
    assert.ok(!('standIn' in read[2]!.app));
  });

  test("leaves out a connection it can't read, and keeps the rest", () => {
    let broken = [
      connection({ id: '' }),
      connection({ app: { kind: 'other', shown: 'x', verified: true } }),
      connection({ app: { kind: 'dynamic', verified: false } }),
      connection({ connectedAt: 'yesterday' }),
      connection({ endsAt: undefined }),
      connection({ lastUsedAt: 12 }),
      connection({ resources: [] }),
      connection({ resources: [{ id: 'r', name: 'R', scopes: [] }] }),
      'not a connection',
    ];
    let read = readConnections({
      connections: [...broken, connection({ id: 'grant-ok' })],
    });
    assert.deepEqual(
      read.map((c) => c.id),
      ['grant-ok'],
    );
  });

  test('refuses a body that is not a list of connections', () => {
    for (let body of [undefined, null, [], {}, { connections: 'none' }]) {
      assert.throws(
        () => readConnections(body),
        (e: { status?: number; message?: string }) =>
          e.status === 502 && e.message === 'Something went wrong. Try again.',
        JSON.stringify(body),
      );
    }
    assert.deepEqual(readConnections({ connections: [] }), []);
  });
});

describe('the address that ends a connection', () => {
  test('puts the ID in the path encoded, so it names no other route', () => {
    assert.equal(
      connectionPath('grant-1'),
      '_oauth-provider/connections/grant-1',
    );
    assert.equal(
      connectionPath('../_secure-session'),
      '_oauth-provider/connections/..%2F_secure-session',
    );
    assert.equal(
      new URL(
        connectionPath('../../_secure-session'),
        'https://realm-server.example.test/',
      ).pathname,
      '/_oauth-provider/connections/..%2F..%2F_secure-session',
    );
  });

  test('refuses an empty ID, and one that would be read as a step in the path', () => {
    for (let id of ['', '.', '..']) {
      assert.throws(() => connectionPath(id), JSON.stringify(id));
    }
  });
});
