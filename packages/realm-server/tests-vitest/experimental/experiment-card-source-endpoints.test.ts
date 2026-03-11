import { existsSync, readFileSync } from 'fs-extra';
import isEqual from 'lodash/isEqual';
import { join } from 'path';
import { describe, expect } from 'vitest';
import {
  type LooseSingleCardDocument,
  RealmPaths,
  param,
  query,
} from '@cardstack/runtime-common';
import { cardSrc } from '@cardstack/runtime-common/etc/test-fixtures';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type { MatrixEvent } from 'https://cardstack.com/base/matrix-event';
import {
  cardInfo,
  createExperimentalPermissionedRealmTest,
  createJWT,
  createMatrixRoomSession,
  type ExperimentalPermissionedRealmFixture,
} from '../helpers';
import { expectIncrementalIndexEvent } from '../helpers/indexing';

type ExperimentalRealmTest = {
  concurrent: (
    name: string,
    fn: (context: {
      realm: ExperimentalPermissionedRealmFixture;
    }) => Promise<void>,
  ) => void;
};

type MinimalAssert = {
  true(value: unknown, message?: string): void;
  strictEqual(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
};

const sourceAccept = 'application/vnd.card+source';
const jsonAccept = 'application/vnd.card+json';

function createRealmTest(
  options: Parameters<typeof createExperimentalPermissionedRealmTest>[0],
): ExperimentalRealmTest {
  return createExperimentalPermissionedRealmTest(
    options,
  ) as ExperimentalRealmTest;
}

function vitestAssert(): MinimalAssert {
  return {
    true(value) {
      expect(Boolean(value)).toBe(true);
    },
    strictEqual(actual, expected) {
      expect(actual).toBe(expected);
    },
    deepEqual(actual, expected) {
      expect(actual).toEqual(expected);
    },
  };
}

function expectRealmHeaders(
  realm: ExperimentalPermissionedRealmFixture,
  response: { get(name: string): string | undefined },
  publicReadable: boolean,
) {
  expect(response.get('X-boxel-realm-url')).toBe(realm.testRealmHref);
  expect(response.get('X-boxel-realm-public-readable')).toBe(
    String(publicReadable),
  );
}

function matchRealmEvent(events: MatrixEvent[], event: any) {
  return events.find(
    (message) =>
      message.type === event.type && isEqual(event.content, message.content),
  );
}

const publicReadableTest = createRealmTest({
  realmURL: new URL('http://test-realm-source-read/test/'),
  serverURL: new URL('http://127.0.0.1:0/test/'),
  permissions: {
    '*': ['read'],
    '@node-test_realm:localhost': ['read', 'realm-owner'],
  },
});

const permissionedReadableTest = createRealmTest({
  realmURL: new URL('http://test-realm-source-read-auth/test/'),
  serverURL: new URL('http://127.0.0.1:0/test/'),
  permissions: {
    john: ['read'],
    '@node-test_realm:localhost': ['read', 'realm-owner'],
  },
});

const publicWritableTest = createRealmTest({
  realmURL: new URL('http://test-realm-source-write/test/'),
  serverURL: new URL('http://127.0.0.1:0/test/'),
  permissions: {
    '*': ['read', 'write'],
    '@node-test_realm:localhost': ['read', 'realm-owner'],
  },
}) as ExperimentalRealmTest;

const publicWritableLimitedTest = createRealmTest({
  realmURL: new URL('http://test-realm-source-write-limit/test/'),
  serverURL: new URL('http://127.0.0.1:0/test/'),
  permissions: {
    '*': ['read', 'write'],
    '@node-test_realm:localhost': ['read', 'realm-owner'],
  },
  fileSizeLimitBytes: 512,
}) as ExperimentalRealmTest;

const permissionedWritableTest = createRealmTest({
  realmURL: new URL('http://test-realm-source-write-auth/test/'),
  serverURL: new URL('http://127.0.0.1:0/test/'),
  permissions: {
    john: ['read', 'write'],
    '@node-test_realm:localhost': ['read', 'realm-owner'],
  },
}) as ExperimentalRealmTest;

describe('card-source-endpoints-test.ts', function () {
  describe('Realm-specific Endpoints | card source requests', function () {
    describe('card source GET request', function () {
      describe('public readable realm', function () {
        publicReadableTest.concurrent(
          'serves the request',
          async ({ realm }) => {
            let response = await realm.request
              .get('/person.gts')
              .set('Accept', sourceAccept);

            expect(response.status).toBe(200);
            expectRealmHeaders(realm, response, true);
            expect(response.text.trim()).toBe(cardSrc);
            expect(response.headers['last-modified']).toBeTruthy();
          },
        );

        publicReadableTest.concurrent(
          'caches responses and invalidates on write',
          async ({ realm }) => {
            let cacheTestPath = 'cache-test.gts';
            let initialContent = '// initial cache test content';
            await realm.testRealm.write(cacheTestPath, initialContent);

            let firstResponse = await realm.request
              .get(`/${cacheTestPath}`)
              .set('Accept', sourceAccept);
            expect(firstResponse.status).toBe(200);
            expect(firstResponse.text).toBe(initialContent);

            let cachedResponse = await realm.request
              .get(`/${cacheTestPath}`)
              .set('Accept', sourceAccept);
            expect(cachedResponse.status).toBe(200);
            expect(cachedResponse.headers['x-boxel-cache']).toBe('hit');
            expect(cachedResponse.text).toBe(initialContent);

            let updatedContent = `${initialContent}\n// updated by test`;
            await realm.testRealm.write(cacheTestPath, updatedContent);

            let afterWriteResponse = await realm.request
              .get(`/${cacheTestPath}`)
              .set('Accept', sourceAccept);
            expect(afterWriteResponse.status).toBe(200);
            expect(afterWriteResponse.text).toBe(updatedContent);

            let repopulatedResponse = await realm.request
              .get(`/${cacheTestPath}`)
              .set('Accept', sourceAccept);
            expect(repopulatedResponse.status).toBe(200);
            expect(repopulatedResponse.headers['x-boxel-cache']).toBe('hit');
            expect(repopulatedResponse.text).toBe(updatedContent);
          },
        );

        publicReadableTest.concurrent(
          'supports noCache query param to bypass cache',
          async ({ realm }) => {
            let cacheTestPath = 'cache-test-nocache.gts';
            let initialContent = '// initial cache test content';
            await realm.testRealm.write(cacheTestPath, initialContent);

            await realm.request
              .get(`/${cacheTestPath}`)
              .set('Accept', sourceAccept);

            let updatedContent = `${initialContent}\n// updated by test`;
            await realm.testRealm.write(cacheTestPath, updatedContent);

            let noCacheResponse = await realm.request
              .get(`/${cacheTestPath}?noCache=true`)
              .set('Accept', sourceAccept);
            expect(noCacheResponse.status).toBe(200);
            expect(noCacheResponse.headers['x-boxel-cache']).toBe('miss');
            expect(noCacheResponse.text).toBe(updatedContent);

            let cachedResponse = await realm.request
              .get(`/${cacheTestPath}`)
              .set('Accept', sourceAccept);
            expect(cachedResponse.headers['x-boxel-cache']).toBe('miss');
            expect(cachedResponse.text).toBe(updatedContent);
          },
        );

        publicReadableTest.concurrent(
          'serves a card-source GET request that results in redirect',
          async ({ realm }) => {
            let response = await realm.request
              .get('/person')
              .set('Accept', sourceAccept);

            expect(response.status).toBe(302);
            expectRealmHeaders(realm, response, true);
            expect(response.headers['location']).toBe(
              new URL('person.gts', realm.realmURL).pathname,
            );
          },
        );

        publicReadableTest.concurrent(
          'serves a card instance GET request with card-source accept header that results in redirect',
          async ({ realm }) => {
            let response = await realm.request
              .get('/person-1')
              .set('Accept', sourceAccept);

            expect(response.status).toBe(302);
            expectRealmHeaders(realm, response, true);
            expect(response.headers['location']).toBe(
              new URL('person-1.json', realm.realmURL).pathname,
            );
          },
        );

        publicReadableTest.concurrent(
          'serves source of a card module that is in error state',
          async ({ realm }) => {
            let response = await realm.request
              .get('/person-with-error.gts')
              .set('Accept', sourceAccept);

            expect(response.headers['content-type']).toBe(
              'text/plain; charset=utf-8',
            );
            expect(
              readFileSync(join(realm.testRealmPath, 'person-with-error.gts'), {
                encoding: 'utf8',
              }),
            ).toBe(response.text);
            expect(response.status).toBe(200);
          },
        );

        publicReadableTest.concurrent(
          'serves a card instance GET request with a .json extension and json accept header that results in redirect',
          async ({ realm }) => {
            let response = await realm.request
              .get('/person.json')
              .set('Accept', jsonAccept);

            expect(response.status).toBe(302);
            expectRealmHeaders(realm, response, true);
            expect(response.headers['location']).toBe(
              new URL('person', realm.realmURL).pathname,
            );
          },
        );

        publicReadableTest.concurrent(
          'serves a module GET request',
          async ({ realm }) => {
            let response = await realm.request.get('/person');

            expect(response.status).toBe(200);
            expectRealmHeaders(realm, response, true);
            expect(response.text.trim()).toContain('class Person');
            expect(response.text).toContain('setComponentTemplate');
          },
        );
      });

      describe('permissioned realm', function () {
        permissionedReadableTest.concurrent(
          '401 with invalid JWT',
          async ({ realm }) => {
            let response = await realm.request
              .get('/person.gts')
              .set('Accept', sourceAccept)
              .set('Authorization', 'Bearer invalid-token');

            expect(response.status).toBe(401);
          },
        );

        permissionedReadableTest.concurrent(
          '401 without a JWT',
          async ({ realm }) => {
            let response = await realm.request
              .get('/person.gts')
              .set('Accept', sourceAccept);

            expect(response.status).toBe(401);
          },
        );

        permissionedReadableTest.concurrent(
          '403 without permission',
          async ({ realm }) => {
            let response = await realm.request
              .get('/person.gts')
              .set('Accept', sourceAccept)
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'not-john')}`,
              );

            expect(response.status).toBe(403);
          },
        );

        permissionedReadableTest.concurrent(
          '200 with permission',
          async ({ realm }) => {
            let response = await realm.request
              .get('/person.gts')
              .set('Accept', sourceAccept)
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'john', ['read'])}`,
              );

            expect(response.status).toBe(200);
          },
        );
      });
    });

    describe('card source HEAD request', function () {
      describe('public readable realm', function () {
        publicReadableTest.concurrent(
          'serves the request',
          async ({ realm }) => {
            let response = await realm.request
              .head('/person.gts')
              .set('Accept', sourceAccept);

            expect(response.status).toBe(200);
            expectRealmHeaders(realm, response, true);
            expect(response.text).toBeFalsy();
          },
        );

        publicReadableTest.concurrent(
          'serves a card-source HEAD request that results in redirect',
          async ({ realm }) => {
            let response = await realm.request
              .head('/person')
              .set('Accept', sourceAccept);

            expect(response.status).toBe(302);
            expectRealmHeaders(realm, response, true);
            expect(response.headers['location']).toBe(
              new URL('person.gts', realm.realmURL).pathname,
            );
          },
        );

        publicReadableTest.concurrent(
          'serves a card-source HEAD request for a regular file without redirect',
          async ({ realm }) => {
            await realm.testRealm.write('notes.md', '# Notes\n');
            let response = await realm.request
              .head('/notes.md')
              .set('Accept', sourceAccept);

            expect(response.status).toBe(200);
            expectRealmHeaders(realm, response, true);
            expect(response.headers['location']).toBeFalsy();
          },
        );
      });
    });

    describe('card-source DELETE request', function () {
      describe('public writable realm', function () {
        publicWritableTest.concurrent(
          'serves the request',
          async ({ realm }) => {
            let response = await realm.request
              .delete('/unused-card.gts')
              .set('Accept', sourceAccept);

            expect(response.status).toBe(204);
            expectRealmHeaders(realm, response, true);
            expect(
              existsSync(join(realm.testRealmPath, 'unused-card.gts')),
            ).toBe(false);
          },
        );

        publicWritableTest.concurrent(
          'broadcasts realm events',
          async ({ realm }) => {
            let { getMessagesSince } = await createMatrixRoomSession(realm);
            let realmEventTimestampStart = Date.now();

            await realm.request
              .delete('/unused-card.gts')
              .set('Accept', sourceAccept);

            await expectIncrementalIndexEvent(
              `${realm.realmURL.href}unused-card.gts`,
              realmEventTimestampStart,
              {
                assert: vitestAssert() as never,
                getMessagesSince,
                realm: realm.testRealmHref,
              },
            );
          },
        );

        publicWritableTest.concurrent(
          'serves a card-source DELETE request for a card instance',
          async ({ realm }) => {
            let response = await realm.request
              .delete('/person-1')
              .set('Accept', sourceAccept);

            expect(response.status).toBe(204);
            expectRealmHeaders(realm, response, true);
            let localPath = new RealmPaths(realm.realmURL).local(
              new URL('person-1', realm.realmURL),
            );
            expect(
              existsSync(join(realm.testRealmPath, `${localPath}.json`)),
            ).toBe(false);
          },
        );
      });

      describe('permissioned realm', function () {
        permissionedWritableTest.concurrent(
          '401 with invalid JWT',
          async ({ realm }) => {
            let response = await realm.request
              .delete('/unused-card.gts')
              .set('Accept', sourceAccept)
              .set('Authorization', 'Bearer invalid-token');

            expect(response.status).toBe(401);
          },
        );

        permissionedWritableTest.concurrent(
          '403 without permission',
          async ({ realm }) => {
            let response = await realm.request
              .delete('/unused-card.gts')
              .set('Accept', sourceAccept)
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'not-john')}`,
              );

            expect(response.status).toBe(403);
          },
        );

        permissionedWritableTest.concurrent(
          '204 with permission',
          async ({ realm }) => {
            let response = await realm.request
              .delete('/unused-card.gts')
              .set('Accept', sourceAccept)
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'john', ['read', 'write'])}`,
              );

            expect(response.status).toBe(204);
          },
        );
      });
    });

    describe('card-source POST request', function () {
      describe('public writable realm', function () {
        publicWritableTest.concurrent(
          'serves a card-source POST request',
          async ({ realm }) => {
            let response = await realm.request
              .post('/unused-card.gts')
              .set('Accept', sourceAccept)
              .send(`//TEST UPDATE\n${cardSrc}`);

            expect(response.status).toBe(204);
            expect(response.headers['x-created']).toBeTruthy();
            expectRealmHeaders(realm, response, true);
            let srcFile = join(realm.testRealmPath, 'unused-card.gts');
            expect(existsSync(srcFile)).toBe(true);
            expect(readFileSync(srcFile, { encoding: 'utf8' })).toBe(
              `//TEST UPDATE\n${cardSrc}`,
            );
          },
        );

        publicWritableTest.concurrent(
          'broadcasts realm events',
          async ({ realm }) => {
            let { getMessagesSince } = await createMatrixRoomSession(realm);
            let realmEventTimestampStart = Date.now();

            await realm.request
              .post('/unused-card.gts')
              .set('Accept', sourceAccept)
              .send(`//TEST UPDATE\n${cardSrc}`);

            await expectIncrementalIndexEvent(
              `${realm.realmURL.href}unused-card.gts`,
              realmEventTimestampStart,
              {
                assert: vitestAssert() as never,
                getMessagesSince,
                realm: realm.testRealmHref,
              },
            );
          },
        );

        publicWritableTest.concurrent(
          'serves a card-source POST request for a .txt file',
          async ({ realm }) => {
            let response = await realm.request
              .post('/hello-world.txt')
              .set('Accept', sourceAccept)
              .send('Hello World');
            expect(response.status).toBe(204);

            let fileResponse = await realm.request
              .get('/hello-world.txt')
              .set('Accept', sourceAccept);
            expect(fileResponse.headers['x-created']).toBeTruthy();
            let txtFile = join(realm.testRealmPath, 'hello-world.txt');
            expect(existsSync(txtFile)).toBe(true);
            expect(readFileSync(txtFile, { encoding: 'utf8' })).toBe(
              'Hello World',
            );
          },
        );

        publicWritableTest.concurrent(
          'removes file meta on delete',
          async ({ realm }) => {
            let reqPath = '/hello-world.txt';
            let dbPath = 'hello-world.txt';
            let post = await realm.request
              .post(reqPath)
              .set('Accept', sourceAccept)
              .send('hello-world');
            expect(post.status).toBe(204);
            expect(post.headers['x-created']).toBeTruthy();

            let rowsBefore = await query(realm.dbAdapter, [
              'SELECT created_at FROM realm_file_meta WHERE realm_url =',
              param(realm.testRealmHref),
              'AND file_path =',
              param(dbPath),
            ]);
            expect(rowsBefore.length).toBe(1);

            let del = await realm.request
              .delete(reqPath)
              .set('Accept', sourceAccept);
            expect(del.status).toBe(204);

            let rowsAfter = await query(realm.dbAdapter, [
              'SELECT 1 FROM realm_file_meta WHERE realm_url =',
              param(realm.testRealmHref),
              'AND file_path =',
              param(dbPath),
            ]);
            expect(rowsAfter.length).toBe(0);
          },
        );

        publicWritableTest.concurrent(
          'can serialize a card instance correctly after card definition is changed',
          async ({ realm }) => {
            let { getMessagesSince } = await createMatrixRoomSession(realm);
            let realmEventTimestampStart = Date.now();

            let createCardDef = await realm.request
              .post('/test-card.gts')
              .set('Accept', sourceAccept).send(`
import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class TestCard extends CardDef {
  @field field1 = contains(StringField);
  @field field2 = contains(StringField);
}
`);
            expect(createCardDef.status).toBe(204);

            let createCard = await realm.request
              .post('/')
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    field1: 'a',
                    field2: 'b',
                  },
                  meta: {
                    adoptsFrom: {
                      module: `${realm.realmURL.href}test-card`,
                      name: 'TestCard',
                    },
                  },
                },
              })
              .set('Accept', jsonAccept);
            expect(createCard.status).toBe(201);

            let id = createCard.body.data.id as string | undefined;
            expect(id).toBeTruthy();
            if (!id) {
              throw new Error('card id missing');
            }

            let updateCardDef = await realm.request
              .post('/test-card.gts')
              .set('Accept', sourceAccept).send(`
import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class TestCard extends CardDef {
  @field field1 = contains(StringField);
  @field field2a = contains(StringField);
}
`);
            expect(updateCardDef.status).toBe(204);

            let updatedGet = await realm.request
              .get(new URL(id).pathname)
              .set('Accept', jsonAccept);
            expect(updatedGet.status).toBe(200);
            expect(updatedGet.body.data.attributes).toEqual({
              field1: 'a',
              field2a: null,
              cardTitle: 'Untitled Card',
              cardDescription: null,
              cardThumbnailURL: null,
              cardInfo,
            });

            let patchResponse = await realm.request
              .patch(new URL(id).pathname)
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    field2a: 'c',
                  },
                  meta: {
                    adoptsFrom: {
                      module: `${realm.realmURL.href}test-card`,
                      name: 'TestCard',
                    },
                  },
                },
              })
              .set('Accept', jsonAccept);
            expect(patchResponse.status).toBe(200);
            expectRealmHeaders(realm, patchResponse, true);
            expect(patchResponse.body.data.attributes).toEqual({
              field1: 'a',
              field2a: 'c',
              cardTitle: 'Untitled Card',
              cardDescription: null,
              cardThumbnailURL: null,
              cardInfo,
            });

            let localPath = new RealmPaths(realm.realmURL).local(new URL(id));
            let jsonFile = join(realm.testRealmPath, `${localPath}.json`);
            let doc = JSON.parse(
              readFileSync(jsonFile, { encoding: 'utf8' }),
            ) as LooseSingleCardDocument;
            expect(doc).toEqual({
              data: {
                type: 'card',
                attributes: {
                  field1: 'a',
                  field2a: 'c',
                  cardInfo,
                },
                relationships: {
                  'cardInfo.theme': {
                    links: {
                      self: null,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: '../test-card',
                    name: 'TestCard',
                  },
                },
              },
            });

            let finalGet = await realm.request
              .get(new URL(id).pathname)
              .set('Accept', jsonAccept);
            expect(finalGet.status).toBe(200);
            expect(finalGet.body.data.attributes).toEqual({
              field1: 'a',
              field2a: 'c',
              cardTitle: 'Untitled Card',
              cardDescription: null,
              cardThumbnailURL: null,
              cardInfo,
            });

            let messages = await getMessagesSince(realmEventTimestampStart);
            let expected = [
              {
                type: APP_BOXEL_REALM_EVENT_TYPE,
                content: {
                  eventName: 'index',
                  indexType: 'incremental-index-initiation',
                  updatedFile: `${realm.realmURL.href}test-card.gts`,
                  realmURL: realm.realmURL.href,
                },
              },
              {
                type: APP_BOXEL_REALM_EVENT_TYPE,
                content: {
                  eventName: 'index',
                  indexType: 'incremental',
                  invalidations: [`${realm.realmURL.href}test-card.gts`],
                  clientRequestId: null,
                  realmURL: realm.realmURL.href,
                },
              },
              {
                type: APP_BOXEL_REALM_EVENT_TYPE,
                content: {
                  eventName: 'index',
                  indexType: 'incremental-index-initiation',
                  updatedFile: `${realm.realmURL.href}test-card.gts`,
                  realmURL: realm.realmURL.href,
                },
              },
              {
                type: APP_BOXEL_REALM_EVENT_TYPE,
                content: {
                  eventName: 'index',
                  indexType: 'incremental',
                  invalidations: [`${realm.realmURL.href}test-card.gts`, id],
                  clientRequestId: null,
                  realmURL: realm.realmURL.href,
                },
              },
              {
                type: APP_BOXEL_REALM_EVENT_TYPE,
                content: {
                  eventName: 'index',
                  indexType: 'incremental-index-initiation',
                  updatedFile: `${id}.json`,
                  realmURL: realm.realmURL.href,
                },
              },
              {
                type: APP_BOXEL_REALM_EVENT_TYPE,
                content: {
                  eventName: 'index',
                  indexType: 'incremental',
                  invalidations: [id],
                  clientRequestId: null,
                  realmURL: realm.realmURL.href,
                },
              },
            ];

            for (let expectedEvent of expected) {
              let actualEvent = matchRealmEvent(messages, expectedEvent);
              expect(actualEvent?.content).toEqual(expectedEvent.content);
            }
          },
        );
      });

      describe('public writable realm with size limit', function () {
        publicWritableLimitedTest.concurrent(
          'returns 413 when source payload exceeds size limit',
          async ({ realm }) => {
            let oversized = 'a'.repeat(2048);
            let response = await realm.request
              .post('/too-large.gts')
              .set('Accept', sourceAccept)
              .send(oversized);

            expect(response.status).toBe(413);
            expect(response.body.errors[0].title).toBe('Payload Too Large');
            expect(response.body.errors[0].status).toBe(413);
            expect(response.body.errors[0].message.includes('File size')).toBe(
              true,
            );
          },
        );
      });

      describe('permissioned realm', function () {
        permissionedWritableTest.concurrent(
          '401 with invalid JWT',
          async ({ realm }) => {
            let response = await realm.request
              .post('/unused-card.gts')
              .set('Accept', sourceAccept)
              .send(`//TEST UPDATE\n${cardSrc}`)
              .set('Authorization', 'Bearer invalid-token');

            expect(response.status).toBe(401);
          },
        );

        permissionedWritableTest.concurrent(
          '401 without a JWT',
          async ({ realm }) => {
            let response = await realm.request
              .post('/unused-card.gts')
              .set('Accept', sourceAccept)
              .send(`//TEST UPDATE\n${cardSrc}`);

            expect(response.status).toBe(401);
          },
        );

        permissionedWritableTest.concurrent(
          '403 without permission',
          async ({ realm }) => {
            let response = await realm.request
              .post('/unused-card.gts')
              .set('Accept', sourceAccept)
              .send(`//TEST UPDATE\n${cardSrc}`)
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'not-john')}`,
              );

            expect(response.status).toBe(403);
          },
        );

        permissionedWritableTest.concurrent(
          '204 with permission',
          async ({ realm }) => {
            let response = await realm.request
              .post('/unused-card.gts')
              .set('Accept', sourceAccept)
              .send(`//TEST UPDATE\n${cardSrc}`)
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'john', ['read', 'write'])}`,
              );

            expect(response.status).toBe(204);
          },
        );
      });
    });

    describe('binary file POST request', function () {
      describe('public writable realm', function () {
        publicWritableTest.concurrent(
          'serves a binary file POST request',
          async ({ realm }) => {
            let bytes = new Uint8Array([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe,
            ]);
            let response = await realm.request
              .post('/test-image.png')
              .set('Content-Type', 'application/octet-stream')
              .send(Buffer.from(bytes));

            expect(response.status).toBe(204);
            expect(response.headers['x-created']).toBeTruthy();
            let filePath = join(realm.testRealmPath, 'test-image.png');
            expect(existsSync(filePath)).toBe(true);
            expect(new Uint8Array(readFileSync(filePath))).toEqual(bytes);
          },
        );

        publicWritableTest.concurrent(
          'creates file metadata for binary upload',
          async ({ realm }) => {
            let bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
            await realm.request
              .post('/meta-test.bin')
              .set('Content-Type', 'application/octet-stream')
              .send(Buffer.from(bytes));

            let rows = await query(realm.dbAdapter, [
              'SELECT content_hash FROM realm_file_meta WHERE realm_url =',
              param(realm.testRealmHref),
              'AND file_path =',
              param('meta-test.bin'),
            ]);
            expect(rows.length).toBe(1);
            expect(rows[0].content_hash).toBeTruthy();
          },
        );

        publicWritableTest.concurrent(
          'overwrites existing binary file',
          async ({ realm }) => {
            let bytes1 = new Uint8Array([0x01, 0x02, 0x03]);
            let bytes2 = new Uint8Array([0x04, 0x05, 0x06]);
            let response1 = await realm.request
              .post('/overwrite-test.bin')
              .set('Content-Type', 'application/octet-stream')
              .send(Buffer.from(bytes1));
            expect(response1.status).toBe(204);

            let response2 = await realm.request
              .post('/overwrite-test.bin')
              .set('Content-Type', 'application/octet-stream')
              .send(Buffer.from(bytes2));
            expect(response2.status).toBe(204);

            let filePath = join(realm.testRealmPath, 'overwrite-test.bin');
            expect(new Uint8Array(readFileSync(filePath))).toEqual(bytes2);
          },
        );

        publicWritableTest.concurrent(
          'broadcasts realm events for binary upload',
          async ({ realm }) => {
            let { getMessagesSince } = await createMatrixRoomSession(realm);
            let realmEventTimestampStart = Date.now();

            await realm.request
              .post('/event-test.bin')
              .set('Content-Type', 'application/octet-stream')
              .send(Buffer.from(new Uint8Array([0xca, 0xfe])));

            await expectIncrementalIndexEvent(
              `${realm.realmURL.href}event-test.bin`,
              realmEventTimestampStart,
              {
                assert: vitestAssert() as never,
                getMessagesSince,
                realm: realm.testRealmHref,
              },
            );
          },
        );
      });

      describe('public writable realm with size limit for binary', function () {
        publicWritableLimitedTest.concurrent(
          'returns 413 when binary payload exceeds size limit',
          async ({ realm }) => {
            let oversized = new Uint8Array(2048).fill(0xff);
            let response = await realm.request
              .post('/too-large.bin')
              .set('Content-Type', 'application/octet-stream')
              .send(Buffer.from(oversized));

            expect(response.status).toBe(413);
            expect(response.body.errors[0].title).toBe('Payload Too Large');
          },
        );
      });

      describe('permissioned realm for binary', function () {
        permissionedWritableTest.concurrent(
          '401 without a JWT for binary upload',
          async ({ realm }) => {
            let response = await realm.request
              .post('/secret.bin')
              .set('Content-Type', 'application/octet-stream')
              .send(Buffer.from(new Uint8Array([0x01])));

            expect(response.status).toBe(401);
          },
        );

        permissionedWritableTest.concurrent(
          '403 without permission for binary upload',
          async ({ realm }) => {
            let response = await realm.request
              .post('/secret.bin')
              .set('Content-Type', 'application/octet-stream')
              .send(Buffer.from(new Uint8Array([0x01])))
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'not-john')}`,
              );

            expect(response.status).toBe(403);
          },
        );

        permissionedWritableTest.concurrent(
          '204 with permission for binary upload',
          async ({ realm }) => {
            let response = await realm.request
              .post('/secret.bin')
              .set('Content-Type', 'application/octet-stream')
              .send(Buffer.from(new Uint8Array([0x01])))
              .set(
                'Authorization',
                `Bearer ${createJWT(realm.testRealm, 'john', ['read', 'write'])}`,
              );

            expect(response.status).toBe(204);
          },
        );
      });
    });
  });
});
