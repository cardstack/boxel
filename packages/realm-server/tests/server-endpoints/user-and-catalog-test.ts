import { module, test } from 'qunit';
import { basename } from 'path';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import { realmSecretSeed, testRealmInfo } from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { setupServerEndpointsTest, testRealm2URL } from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module(
    'Realm Server Endpoints (not specific to one realm)',
    function (hooks) {
      let context = setupServerEndpointsTest(hooks);
      let originalLowCreditThreshold: string | undefined;

      hooks.beforeEach(function () {
        originalLowCreditThreshold = process.env.LOW_CREDIT_THRESHOLD;
        process.env.LOW_CREDIT_THRESHOLD = '2000';
      });

      hooks.afterEach(function () {
        if (originalLowCreditThreshold == null) {
          delete process.env.LOW_CREDIT_THRESHOLD;
        } else {
          process.env.LOW_CREDIT_THRESHOLD = originalLowCreditThreshold;
        }
      });

      test('can create a user', async function (assert) {
        let ownerUserId = '@mango:localhost';
        let response = await context.request2
          .post('/_user')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send({
            data: {
              type: 'user',
              attributes: {
                registrationToken: 'reg_token_123',
              },
            },
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(response.text, 'ok', 'response body is correct');

        let user = await getUserByMatrixUserId(context.dbAdapter, ownerUserId);
        if (!user) {
          throw new Error('user does not exist in db');
        }
        assert.strictEqual(
          user.matrixUserId,
          ownerUserId,
          'matrix user ID is correct',
        );
        assert.strictEqual(
          user.matrixRegistrationToken,
          'reg_token_123',
          'registration token is correct',
        );
      });

      test('can not create a user without a jwt', async function (assert) {
        let response = await context.request2.post('/_user').send({});
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('can fetch catalog realms', async function (assert) {
        let response = await context.request2
          .get('/_catalog-realms')
          .set('Accept', 'application/json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(response.body, {
          data: [
            {
              type: 'catalog-realm',
              id: `${testRealm2URL}`,
              attributes: {
                ...testRealmInfo,
              },
            },
          ],
        });
      });

      test(`returns 200 with empty data if failed to fetch catalog realm's info`, async function (assert) {
        let failedRealmInfoMock = async (req: Request) => {
          if (req.url.includes('_info')) {
            return new Response('Failed to fetch realm info', {
              status: 500,
              statusText: 'Internal Server Error',
            });
          }
          return null;
        };
        context.virtualNetwork.mount(failedRealmInfoMock, { prepend: true });
        let response = await context.request2
          .get('/_catalog-realms')
          .set('Accept', 'application/json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(response.body, {
          data: [],
        });
      });
    },
  );
});
