import { join } from 'path';
import { writeFileSync } from 'fs-extra';
import { describe, expect } from 'vitest';
import type {
  LooseSingleCardDocument,
  Relationship,
  ResourceID,
} from '@cardstack/runtime-common';
import { baseRealm } from '@cardstack/runtime-common';
import {
  cardInfo,
  createExperimentalPermissionedRealmTest,
  testRealmInfo,
  type ExperimentalPermissionedRealmFixture,
} from '../helpers';

function buildPngChunk(type: string, data: Uint8Array): Uint8Array {
  let chunk = new Uint8Array(4 + 4 + data.length + 4);
  let view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  let crc = 0xffffffff;
  let crcData = chunk.slice(4, 8 + data.length);
  for (let i = 0; i < crcData.length; i++) {
    crc ^= crcData[i]!;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

function makeMinimalPng(): Uint8Array {
  let signature = [137, 80, 78, 71, 13, 10, 26, 10];
  let ihdrData = new Uint8Array(13);
  let ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, 1);
  ihdrView.setUint32(4, 1);
  ihdrData[8] = 8;
  ihdrData[9] = 2;

  let ihdrChunk = buildPngChunk('IHDR', ihdrData);
  let idatData = new Uint8Array([
    0x08, 0xd7, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x01, 0x00, 0x01,
  ]);
  let idatChunk = buildPngChunk('IDAT', idatData);
  let iendChunk = buildPngChunk('IEND', new Uint8Array(0));
  let totalLength =
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  let png = new Uint8Array(totalLength);
  let offset = 0;
  png.set(signature, offset);
  offset += signature.length;
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  png.set(iendChunk, offset);
  return png;
}

type ExperimentalRealmTest = {
  concurrent: (
    name: string,
    fn: (context: {
      realm: ExperimentalPermissionedRealmFixture;
    }) => Promise<void>,
  ) => void;
};

const test = createExperimentalPermissionedRealmTest({
  realmURL: new URL('http://test-realm/test/'),
  serverURL: new URL('http://127.0.0.1:0/test/'),
  permissions: {
    '*': ['read'],
    '@node-test_realm:localhost': ['read', 'realm-owner'],
  },
}) as ExperimentalRealmTest;

describe('card-endpoints-test.ts', function () {
  describe('Realm-specific Endpoints | card URLs', function () {
    describe('card GET request', function () {
      describe('public readable realm', function () {
        test.concurrent('serves the request', async ({ realm }) => {
          let response = await realm.request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          expect(response.status).toBe(200);
          let json = response.body;
          expect(json.data.meta.lastModified).toBeTruthy();
          delete json.data.meta.lastModified;
          delete json.data.meta.resourceCreatedAt;
          expect(response.get('X-boxel-realm-url')).toBe(realm.testRealmHref);
          expect(response.get('X-boxel-realm-public-readable')).toBe('true');
          expect(json).toEqual({
            data: {
              id: `${realm.testRealmHref}person-1`,
              type: 'card',
              attributes: {
                cardTitle: 'Mango',
                cardInfo,
                firstName: 'Mango',
                cardDescription: null,
                cardThumbnailURL: null,
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
                  module: './person',
                  name: 'Person',
                },
                realmInfo: testRealmInfo,
                realmURL: realm.testRealmHref,
              },
              links: {
                self: `${realm.testRealmHref}person-1`,
              },
            },
          });
        });

        test.concurrent(
          'serves a card error request without last known good state',
          async ({ realm }) => {
            let response = await realm.request
              .get('/missing-link')
              .set('Accept', 'application/vnd.card+json');

            expect(response.status).toBe(500);
            let json = response.body;
            expect(response.get('X-boxel-realm-url')).toBe(realm.testRealmHref);
            expect(response.get('X-boxel-realm-public-readable')).toBe('true');
            let errorBody = json.errors[0];
            expect(
              errorBody.meta.stack.includes('at Realm.getSourceOrRedirect'),
            ).toBe(true);
            delete errorBody.meta.stack;
            expect(errorBody.id).toBe(`${realm.testRealmHref}missing-link`);
            expect(errorBody.status).toBe(404);
            expect(errorBody.title).toBe('Link Not Found');
            expect(errorBody.message).toBe(
              `missing file ${realm.testRealmHref}does-not-exist.json`,
            );
            expect(errorBody.realm).toBe(realm.testRealmHref);
            expect(errorBody.meta.lastKnownGoodHtml).toBe(null);
            expect(errorBody.meta.cardTitle).toBe(null);
            expect(Array.isArray(errorBody.meta.scopedCssUrls)).toBe(true);
            if (errorBody.meta.scopedCssUrls.length > 0) {
              expect(
                errorBody.meta.scopedCssUrls.every((scopedCssUrl: string) =>
                  scopedCssUrl.endsWith('.glimmer-scoped.css'),
                ),
              ).toBe(true);
            } else {
              expect(errorBody.meta.scopedCssUrls).toEqual([]);
            }
          },
        );

        test.concurrent(
          'includes FileDef resources for file links in included payload',
          async ({ realm }) => {
            let pngBytes = makeMinimalPng();
            writeFileSync(join(realm.testRealmPath, 'hero.png'), pngBytes);
            writeFileSync(join(realm.testRealmPath, 'first.png'), pngBytes);
            writeFileSync(join(realm.testRealmPath, 'second.png'), pngBytes);

            await realm.testRealm.writeMany(
              new Map<string, string>([
                [
                  'gallery.gts',
                  `
                import { CardDef, field, linksTo, linksToMany } from "https://cardstack.com/base/card-api";
                import { FileDef } from "https://cardstack.com/base/file-api";

                export class Gallery extends CardDef {
                  @field hero = linksTo(FileDef);
                  @field attachments = linksToMany(FileDef);
                }
              `,
                ],
                [
                  'gallery.json',
                  JSON.stringify({
                    data: {
                      attributes: {},
                      relationships: {
                        hero: {
                          links: {
                            self: './hero.png',
                          },
                        },
                        'attachments.0': {
                          links: {
                            self: './first.png',
                          },
                        },
                        'attachments.1': {
                          links: {
                            self: './second.png',
                          },
                        },
                      },
                      meta: {
                        adoptsFrom: {
                          module: './gallery.gts',
                          name: 'Gallery',
                        },
                      },
                    },
                  }),
                ],
              ]),
            );
            await realm.testRealm.writeMany(
              new Map<string, Uint8Array>([
                ['hero.png', pngBytes],
                ['first.png', pngBytes],
                ['second.png', pngBytes],
              ]),
            );

            let response = await realm.request
              .get('/gallery')
              .set('Accept', 'application/vnd.card+json');

            expect(response.status).toBe(200);
            let doc = response.body as LooseSingleCardDocument;
            expect(Array.isArray(doc.included)).toBe(true);
            let included = doc.included ?? [];
            let hero = included.find(
              (resource) => resource.id === `${realm.testRealmHref}hero.png`,
            );
            let first = included.find(
              (resource) => resource.id === `${realm.testRealmHref}first.png`,
            );
            let second = included.find(
              (resource) => resource.id === `${realm.testRealmHref}second.png`,
            );

            expect(hero).toBeTruthy();
            expect(first).toBeTruthy();
            expect(second).toBeTruthy();
            expect(hero?.type).toBe('file-meta');
            expect(hero?.attributes?.name).toBe('hero.png');
            expect(hero?.attributes?.contentType).toBe('image/png');
            expect(hero?.meta?.adoptsFrom).toEqual({
              module: `${baseRealm.url}png-image-def`,
              name: 'PngDef',
            });
            expect(
              (doc.data.relationships?.hero as Relationship)?.data,
            ).toEqual({
              type: 'file-meta',
              id: `${realm.testRealmHref}hero.png`,
            });
            expect(
              (doc.data.relationships?.['attachments.0'] as Relationship)?.data,
            ).toEqual({
              type: 'file-meta',
              id: `${realm.testRealmHref}first.png`,
            });
            expect(
              (doc.data.relationships?.['attachments.1'] as Relationship)?.data,
            ).toEqual({
              type: 'file-meta',
              id: `${realm.testRealmHref}second.png`,
            });
          },
        );

        test.concurrent(
          'linksTo relationship for CardDef uses card type not file-meta',
          async ({ realm }) => {
            await realm.testRealm.writeMany(
              new Map<string, string>([
                [
                  'tag.gts',
                  `
                import { CardDef, field, contains } from "https://cardstack.com/base/card-api";
                import StringField from "https://cardstack.com/base/string";

                export class Tag extends CardDef {
                  @field label = contains(StringField);
                  @field cardTitle = contains(StringField, {
                    computeVia: function (this: Tag) {
                      return this.label;
                    },
                  });
                }
              `,
                ],
                [
                  'article.gts',
                  `
                import { CardDef, field, contains, linksTo } from "https://cardstack.com/base/card-api";
                import StringField from "https://cardstack.com/base/string";
                import { Tag } from "./tag";

                export class Article extends CardDef {
                  @field title = contains(StringField);
                  @field tag = linksTo(Tag);
                  @field cardTitle = contains(StringField, {
                    computeVia: function (this: Article) {
                      return this.title;
                    },
                  });
                }
              `,
                ],
                [
                  'Tag/programming.json',
                  JSON.stringify({
                    data: {
                      attributes: {
                        label: 'Programming',
                      },
                      meta: {
                        adoptsFrom: {
                          module: '../tag.gts',
                          name: 'Tag',
                        },
                      },
                    },
                  }),
                ],
                [
                  'Article/hello-world.json',
                  JSON.stringify({
                    data: {
                      attributes: {
                        title: 'Hello World',
                      },
                      relationships: {
                        tag: {
                          links: {
                            self: '../Tag/programming',
                          },
                        },
                      },
                      meta: {
                        adoptsFrom: {
                          module: '../article.gts',
                          name: 'Article',
                        },
                      },
                    },
                  }),
                ],
              ]),
            );
            await realm.testRealm.flushUpdateEvents();

            let response = await realm.request
              .get('/Article/hello-world')
              .set('Accept', 'application/vnd.card+json');
            expect(response.status).toBe(200);
            let doc = response.body as LooseSingleCardDocument;
            let tagRelationship = doc.data.relationships?.tag as Relationship;
            expect(tagRelationship).toBeTruthy();
            expect(tagRelationship.data).toEqual({
              type: 'card',
              id: `${realm.testRealmHref}Tag/programming`,
            });

            let articleAlias = `${realm.testRealmHref}Article/hello-world`;
            let tagAlias = `${realm.testRealmHref}Tag/programming`;
            await realm.dbAdapter.execute(`UPDATE boxel_index
             SET pristine_doc = pristine_doc #- '{relationships,tag,data}'
             WHERE file_alias = '${articleAlias}'
             AND type = 'instance'`);
            await realm.dbAdapter.execute(`UPDATE boxel_index
             SET is_deleted = TRUE
             WHERE file_alias = '${tagAlias}'
             AND type = 'instance'`);

            let response2 = await realm.request
              .get('/Article/hello-world')
              .set('Accept', 'application/vnd.card+json');
            expect(response2.status).toBe(200);
            let doc2 = response2.body as LooseSingleCardDocument;
            let tagRelationship2 = doc2.data.relationships?.tag as Relationship;
            expect(tagRelationship2).toBeTruthy();
            expect((tagRelationship2.data as ResourceID)?.type).toBe('card');
          },
        );

        test.concurrent(
          'card-level query-backed relationships resolve via search at read time',
          async ({ realm }) => {
            await realm.testRealm.writeMany(
              new Map<string, string>([
                [
                  'query-person-finder.gts',
                  `
                import { CardDef, field, contains, linksTo, linksToMany } from "https://cardstack.com/base/card-api";
                import StringField from "https://cardstack.com/base/string";
                import { Person } from "./person";

                export class QueryPersonFinder extends CardDef {
                  @field cardTitle = contains(StringField);
                  @field favorite = linksTo(Person, {
                    query: {
                      filter: {
                        eq: { firstName: '$this.cardTitle' },
                      },
                    },
                  });
                  @field matches = linksToMany(Person, {
                    query: {
                      filter: {
                        eq: { firstName: '$this.cardTitle' },
                      },
                    },
                  });
                }
              `,
                ],
                [
                  'query-person-finder.json',
                  JSON.stringify({
                    data: {
                      attributes: {
                        cardTitle: 'Mango',
                      },
                      meta: {
                        adoptsFrom: {
                          module: './query-person-finder.gts',
                          name: 'QueryPersonFinder',
                        },
                      },
                    },
                  }),
                ],
              ]),
            );

            let response = await realm.request
              .get('/query-person-finder')
              .set('Accept', 'application/vnd.card+json');
            expect(response.status).toBe(200);
            let doc = response.body;
            let favorite = doc.data.relationships.favorite;
            expect(favorite.data).toEqual({
              type: 'card',
              id: `${realm.testRealmHref}person-1`,
            });
            expect(favorite.links.self).toBe('./person-1');
            let matchesRelationship = doc.data.relationships['matches.0'];
            expect(matchesRelationship).toBeTruthy();
            expect(matchesRelationship.data).toEqual({
              type: 'card',
              id: `${realm.testRealmHref}person-1`,
            });
            expect(Array.isArray(doc.included)).toBe(true);
            expect(
              doc.included.some(
                (resource: { id: string }) =>
                  resource.id === `${realm.testRealmHref}person-1`,
              ),
            ).toBe(true);
          },
        );

        test.concurrent(
          'field-level query-backed relationships resolve at read time (nested contains)',
          async ({ realm }) => {
            await realm.testRealm.writeMany(
              new Map<string, string>([
                [
                  'query-person-finder-nested.gts',
                  `
                import { CardDef, FieldDef, field, contains, linksTo, linksToMany } from "https://cardstack.com/base/card-api";
                import StringField from "https://cardstack.com/base/string";
                import { Person } from "./person";

                export class QueryLinksField extends FieldDef {
                  @field cardTitle = contains(StringField);
                  @field favorite = linksTo(Person, {
                    query: {
                      filter: {
                        eq: { firstName: '$this.cardTitle' },
                      },
                    },
                  });
                  @field matches = linksToMany(Person, {
                    query: {
                      filter: {
                        eq: { firstName: '$this.cardTitle' },
                      },
                    },
                  });
                }

                export class WrapperField extends FieldDef {
                  @field queries = contains(QueryLinksField);
                }

                export class OuterQueryCard extends CardDef {
                  @field info = contains(WrapperField);
                }

                export class DeepWrapperField extends FieldDef {
                  @field inner = contains(WrapperField);
                }

                export class DeepOuterQueryCard extends CardDef {
                  @field details = contains(DeepWrapperField);
                }
              `,
                ],
                [
                  'query-person-finder-nested.json',
                  JSON.stringify({
                    data: {
                      attributes: {
                        info: {
                          queries: {
                            cardTitle: 'Mango',
                          },
                        },
                      },
                      meta: {
                        adoptsFrom: {
                          module: './query-person-finder-nested.gts',
                          name: 'OuterQueryCard',
                        },
                      },
                    },
                  }),
                ],
                [
                  'query-person-finder-deep.json',
                  JSON.stringify({
                    data: {
                      attributes: {
                        details: {
                          inner: {
                            queries: {
                              cardTitle: 'Mango',
                            },
                          },
                        },
                      },
                      meta: {
                        adoptsFrom: {
                          module: './query-person-finder-nested.gts',
                          name: 'DeepOuterQueryCard',
                        },
                      },
                    },
                  }),
                ],
              ]),
            );

            let response = await realm.request
              .get('/query-person-finder-nested')
              .set('Accept', 'application/vnd.card+json');
            expect(response.status).toBe(200);
            let doc = response.body;
            expect(
              doc.data.relationships['info.queries.favorite']?.data,
            ).toEqual({
              type: 'card',
              id: `${realm.testRealmHref}person-1`,
            });
            expect(
              doc.data.relationships['info.queries.favorite']?.links?.self,
            ).toBe('./person-1');
            expect(
              doc.data.relationships['info.queries.matches.0']?.data,
            ).toEqual({
              type: 'card',
              id: `${realm.testRealmHref}person-1`,
            });

            let deepResponse = await realm.request
              .get('/query-person-finder-deep')
              .set('Accept', 'application/vnd.card+json');
            expect(deepResponse.status).toBe(200);
            let deepDoc = deepResponse.body;
            expect(
              deepDoc.data.relationships['details.inner.queries.favorite']
                ?.data,
            ).toEqual({
              type: 'card',
              id: `${realm.testRealmHref}person-1`,
            });
            expect(
              deepDoc.data.relationships['details.inner.queries.matches.0']
                ?.data,
            ).toEqual({
              type: 'card',
              id: `${realm.testRealmHref}person-1`,
            });
          },
        );
      });
    });
  });
});
