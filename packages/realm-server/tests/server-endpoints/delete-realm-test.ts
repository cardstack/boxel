import { module, test } from 'qunit';
import { basename, join } from 'path';
import { existsSync } from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';

import {
  asExpressions,
  insert,
  insertPermissions,
  query,
} from '@cardstack/runtime-common';

import { insertUser, realmSecretSeed } from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { setupServerEndpointsTest } from './helpers';

module(`server-endpoints/${basename(__filename)}`, function (hooks) {
  let context = setupServerEndpointsTest(hooks);

  async function createRealmFor(ownerUserId: string) {
    let endpoint = `delete-me-${uuidv4()}`;
    let response = await context.request2
      .post('/_create-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            attributes: {
              name: 'Delete Me Realm',
              endpoint,
            },
          },
        }),
      );

    if (response.status !== 201) {
      throw new Error(
        `/_create-realm failed: ${JSON.stringify(response.body)}`,
      );
    }

    return response.body.data.id as string;
  }

  test('DELETE /_delete-realm removes a created realm, its published copies, and related domain claims', async function (assert) {
    let owner = `mango-${uuidv4()}`;
    let ownerUserId = `@${owner}:localhost`;
    let realmURL = await createRealmFor(ownerUserId);
    let realmPath = new URL(realmURL).pathname.split('/').filter(Boolean);
    let publishedRealmURL = `http://${owner}.localhost:4445/published-${uuidv4()}/`;

    let user = await insertUser(
      context.dbAdapter,
      ownerUserId,
      'cus_delete_realm',
      'mango@example.com',
    );

    let publishResponse = await context.request2
      .post('/_publish-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          sourceRealmURL: realmURL,
          publishedRealmURL,
        }),
      );

    assert.strictEqual(publishResponse.status, 201, 'published realm created');
    let publishedRealmId = publishResponse.body.data.id as string;

    let { valueExpressions, nameExpressions } = asExpressions({
      user_id: user.id,
      source_realm_url: realmURL,
      hostname: 'delete-me.boxel.site',
      claimed_at: Math.floor(Date.now() / 1000),
    });
    await query(
      context.dbAdapter,
      insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
    );

    let deleteResponse = await context.request2
      .delete('/_delete-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            id: realmURL,
          },
        }),
      );

    assert.strictEqual(deleteResponse.status, 204, 'realm deleted');
    assert.false(
      existsSync(
        join(context.dir.name, 'realm_server_2', realmPath[0]!, realmPath[1]!),
      ),
      'source realm directory was removed after realm deletion',
    );
    assert.false(
      existsSync(
        join(
          context.dir.name,
          'realm_server_2',
          '_published',
          publishedRealmId,
        ),
      ),
      'published realm directory was removed after realm deletion',
    );

    let remainingPermissions = await context.dbAdapter.execute(
      `SELECT * FROM realm_user_permissions WHERE realm_url = '${realmURL}'`,
    );
    assert.strictEqual(
      remainingPermissions.length,
      0,
      'source realm permissions are removed',
    );

    let remainingPublishedRows = await context.dbAdapter.execute(
      `SELECT * FROM published_realms WHERE source_realm_url = '${realmURL}'`,
    );
    assert.strictEqual(
      remainingPublishedRows.length,
      0,
      'published realm records are removed',
    );

    let claimedDomains = (await context.dbAdapter.execute(
      `SELECT removed_at FROM claimed_domains_for_sites WHERE source_realm_url = '${realmURL}'`,
    )) as { removed_at: number | null }[];
    assert.ok(
      claimedDomains.every((row) => row.removed_at != null),
      'claimed domains are soft deleted',
    );

    assert.notOk(
      context.testRealmServer2.testingOnlyRealms.find(
        (realm) => realm.url === realmURL,
      ),
      'source realm is unmounted',
    );
    assert.notOk(
      context.testRealmServer2.testingOnlyRealms.find(
        (realm) => realm.url === publishedRealmURL,
      ),
      'published realm is unmounted',
    );
  });

  test('DELETE /_delete-realm rejects deleting a realm outside the current user namespace', async function (assert) {
    let ownerUserId = `@mango-${uuidv4()}:localhost`;
    let foreignOwnerUserId = `@papaya-${uuidv4()}:localhost`;
    let foreignRealmURL = await createRealmFor(foreignOwnerUserId);
    await insertPermissions(context.dbAdapter, new URL(foreignRealmURL), {
      [foreignOwnerUserId]: ['read', 'write', 'realm-owner'],
      [ownerUserId]: ['read', 'write', 'realm-owner'],
    });

    let response = await context.request2
      .delete('/_delete-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            id: foreignRealmURL,
          },
        }),
      );

    assert.strictEqual(response.status, 403, 'deletion is forbidden');
    assert.ok(
      response.body.errors?.[0]?.includes(
        'You can only delete realms that you created',
      ),
      'returns a namespace ownership error',
    );
  });
});
