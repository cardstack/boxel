import { describe, expect } from 'vitest';
import {
  createExperimentalPermissionedRealmTest,
  createJWT,
  type ExperimentalPermissionedRealmFixture,
} from '../helpers';

type ExperimentalRealmTest = {
  concurrent: (
    name: string,
    fn: (context: {
      realm: ExperimentalPermissionedRealmFixture;
    }) => Promise<void>,
  ) => void;
};

const publicRealmURL = new URL('http://test-realm/test/');
const permissionedRealmURL = new URL('http://test-realm-auth/test/');

const publicTest = createExperimentalPermissionedRealmTest({
  realmURL: publicRealmURL,
  serverURL: new URL('http://127.0.0.1:0/test/'),
  permissions: {
    '*': ['read'],
  },
}) as ExperimentalRealmTest;

const permissionedTest = createExperimentalPermissionedRealmTest({
  realmURL: permissionedRealmURL,
  serverURL: new URL('http://127.0.0.1:0/test/'),
  permissions: {
    john: ['read'],
    '@node-test_realm:localhost': ['read', 'realm-owner'],
  },
}) as ExperimentalRealmTest;

describe('card-dependencies-endpoint-test.ts', function () {
  describe('Realm-specific Endpoints | card dependencies requests', function () {
    describe('card dependencies GET request', function () {
      describe('public readable realm', function () {
        publicTest.concurrent('serves the request', async ({ realm }) => {
          let response = await realm.request
            .get(`/_card-dependencies?url=${realm.testRealm.url}person`)
            .set('Accept', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createJWT(realm.testRealm, 'john', ['read'])}`,
            );

          expect(response.status).toBe(200);
          expect(response.get('X-boxel-realm-url')).toBe(realm.testRealmHref);
          expect(response.get('X-boxel-realm-public-readable')).toBe('true');

          let result: string[] = JSON.parse(response.text.trim());
          expect(result.includes('https://cardstack.com/base/card-api')).toBe(
            true,
          );
          expect(result.includes(`${realm.testRealmHref}person`)).toBe(false);
        });

        publicTest.concurrent(
          'serves the request with a .json extension',
          async ({ realm }) => {
            let response = await realm.request
              .get(`/_card-dependencies?url=${realm.testRealm.url}person.json`)
              .set('Accept', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'john', ['read'])}`,
              );

            let result: string[] = JSON.parse(response.text.trim());
            expect(result.includes('https://cardstack.com/base/card-api')).toBe(
              true,
            );
            expect(result.includes(`${realm.testRealmHref}person`)).toBe(false);
          },
        );

        publicTest.concurrent(
          'gives 404 for a non-existent card',
          async ({ realm }) => {
            let response = await realm.request
              .get(
                `/_card-dependencies?url=${realm.testRealm.url}non-existent-card`,
              )
              .set('Accept', 'application/json');

            expect(response.status).toBe(404);
          },
        );
      });

      describe('permissioned realm', function () {
        permissionedTest.concurrent(
          '401 with invalid JWT',
          async ({ realm }) => {
            let response = await realm.request
              .get(`/_card-dependencies?url=${realm.testRealm.url}person`)
              .set('Accept', 'application/json')
              .set('Authorization', 'Bearer invalid-token');

            expect(response.status).toBe(401);
          },
        );

        permissionedTest.concurrent('401 without a JWT', async ({ realm }) => {
          let response = await realm.request
            .get(`/_card-dependencies?url=${realm.testRealm.url}person`)
            .set('Accept', 'application/json');

          expect(response.status).toBe(401);
        });

        permissionedTest.concurrent(
          '403 without permission',
          async ({ realm }) => {
            let response = await realm.request
              .get(`/_card-dependencies?url=${realm.testRealm.url}person`)
              .set('Accept', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'not-john')}`,
              );

            expect(response.status).toBe(403);
          },
        );

        permissionedTest.concurrent(
          '200 with permission',
          async ({ realm }) => {
            let response = await realm.request
              .get(`/_card-dependencies?url=${realm.testRealm.url}person`)
              .set('Accept', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'john', ['read'])}`,
              );

            expect(response.status).toBe(200);
          },
        );
      });
    });
  });
});
