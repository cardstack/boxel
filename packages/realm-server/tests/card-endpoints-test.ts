import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import supertest from 'supertest';
import { join, basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import type { DirResult } from 'tmp';
import fsExtra from 'fs-extra';
const { existsSync, readFileSync, readJSONSync, statSync, writeFileSync } =
  fsExtra;
import type {
  Realm,
  Relationship,
  ResourceID,
} from '@cardstack/runtime-common';
import {
  CardDocumentCache,
  computeContentHash,
  isSingleCardDocument,
  ri,
  baseRRI,
  rri,
  SKIP_INDEX_WAIT_HEADER,
  INDEX_PENDING_HEADER,
  searchEntryWireQueryFromQuery,
  setWriteTimingSinkForTests,
  type LooseSingleCardDocument,
  type SingleCardDocument,
} from '@cardstack/runtime-common';
import { parse } from 'qs';
import {
  findRealmEvent,
  setupPermissionedRealmCached,
  setupPermissionedRealmsCached,
  setupMatrixRoom,
  closeServer,
  waitUntil,
  testRealmInfo,
  createJWT,
  testRealmServerMatrixUserId,
  cardInfo,
  type RealmRequest,
  withRealmPath,
} from './helpers/index.ts';
import {
  ABSENT_OR_NULL_CLIENT_REQUEST_ID,
  expectIncrementalIndexEvent,
  waitForIncrementalIndexEvent,
} from './helpers/indexing.ts';
import type { IncrementalIndexEventContent } from '@cardstack/base/matrix-event';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { PgAdapter } from '@cardstack/postgres';

function parseSearchQuery(searchURL: URL) {
  let queryParam = searchURL.searchParams.get('query');
  if (queryParam != null) {
    return parse(queryParam) as Record<string, any>;
  }
  return parse(searchURL.searchParams.toString()) as Record<string, any>;
}

// The `handler=` total a `realm:write-timing` line reports, in ms. The line
// also carries `status`, which sits ahead of it and is read separately — it is
// the answer the write gave, not a duration.
function handlerMs(line: string): number | undefined {
  let match = /\bhandler=(\d+)ms\b/.exec(line);
  return match ? Number(match[1]) : undefined;
}

// The stages a `realm:write-timing` line attributes the handler across, keyed
// by stage name. Read from after the `handler=` total so the total itself is
// not counted as one of them, and only as far as the first ` | `: a timeline
// can carry a busy-time section and a counter section after that, and both are
// `name=<int>` pairs that are not wall-clock. Collecting those would make the
// sum exceed the handler while nothing overlapped at all, which is the one
// thing that guard is supposed to mean.
function stageMs(line: string): Record<string, number> {
  let wallClock = line.split(' | ')[0];
  let tail = wallClock.slice(wallClock.search(/\bhandler=\d+ms\b/));
  let stages: Record<string, number> = {};
  for (let [, stage, ms] of tail.matchAll(/\b([a-zA-Z]+)=(\d+)(?!ms)\b/g)) {
    stages[stage] = Number(ms);
  }
  return stages;
}

// Create minimal valid PNG bytes for testing
function makeMinimalPng(): Uint8Array {
  let signature = [137, 80, 78, 71, 13, 10, 26, 10];
  let ihdrData = new Uint8Array(13);
  let ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, 1); // width
  ihdrView.setUint32(4, 1); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
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

module(basename(import.meta.filename), function () {
  module('Realm-specific Endpoints | card URLs', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealmHref = realmURL.href;
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: RealmRequest;
    let serverRequest: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      serverRequest = args.request;
      request = withRealmPath(args.request, realmURL);
      dir = args.dir;
      dbAdapter = args.dbAdapter;
    }

    function getRealmSetup() {
      return {
        testRealm,
        testRealmHttpServer,
        request,
        serverRequest,
        dir,
        dbAdapter,
      };
    }

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    module('card GET request', function (_hooks) {
      module('public readable realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'realistic',
          realmURL,
          permissions: {
            '*': ['read'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        // The version the read reports is the base a client's next write is
        // computed against, so it has to name the bytes this document was
        // assembled from. Asserted against the file rather than against another
        // response: comparing two responses would hold just as well if both
        // reported the same wrong value.
        test('a card+json GET reports the version of the stored bytes', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          assert.strictEqual(
            response.body.data.meta.version,
            computeContentHash(
              readFileSync(
                join(dir.name, 'realm_server_1', 'test', 'person-1.json'),
                'utf8',
              ),
            ),
            'the response reports the hash of the bytes on disk',
          );
        });

        // The decisive test for where the value comes from. `realm_file_meta`
        // holds a content hash only for paths written through the realm's own
        // write API; a fixture copied onto disk — like every seeded base,
        // catalog or skills realm in a deployment — has a row with a creation
        // time and nothing else, permanently. Serving the version from there
        // would report nothing for this card, so finding one here is what says
        // it was recorded by the pass that indexed the bytes.
        test('a card the realm never wrote through its write API still reports a version', async function (assert) {
          let [row] = (await dbAdapter.execute(
            `SELECT content_hash FROM realm_file_meta
             WHERE realm_url = $1 AND file_path = $2`,
            { bind: [realmURL.href, 'person-1.json'] },
          )) as { content_hash: string | null }[];
          // A row exists — indexing calls `ensureFileCreatedAt`, which inserts
          // one carrying `created_at` alone. Asserted separately from the hash
          // because coalescing the two would let "no row at all" satisfy the
          // check, and that distinction is what this control rests on: the
          // claim is that the realm recorded a creation time and no hash, not
          // that it recorded nothing.
          assert.ok(
            row,
            'indexing recorded a realm_file_meta row for the path',
          );
          assert.strictEqual(
            row.content_hash,
            null,
            'the fixture reached disk without the write path, so no hash was recorded for it',
          );

          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          assert.strictEqual(
            typeof response.body.data.meta.version,
            'string',
            'and the read reports a version regardless',
          );
        });

        // The value a row without a fingerprint reports, which is every row in a
        // realm until it is re-indexed. Absent rather than null, so a client
        // reads "no version" — the same silence it read before the column
        // existed, which it treats as "I cannot confirm this".
        test('a card whose row carries no version reports none', async function (assert) {
          await dbAdapter.execute(
            `UPDATE boxel_index SET source_content_hash = NULL
             WHERE realm_url = $1 AND url = $2 AND type = 'instance'`,
            { bind: [realmURL.href, `${testRealmHref}person-1.json`] },
          );

          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          // The positive control: an absence assertion alone would also hold
          // for a response carrying no `meta`, so establishing that this meta
          // is populated is what makes the absence a statement about `version`.
          assert.ok(
            response.body.data.meta.adoptsFrom,
            'the response carries a populated card meta',
          );
          assert.false(
            'version' in response.body.data.meta,
            `the key is omitted rather than null: ${JSON.stringify(
              response.body.data.meta,
            )}`,
          );
        });

        test('serves the request', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          let json = response.body;
          assert.ok(json.data.meta.lastModified, 'lastModified exists');
          assert.strictEqual(
            typeof json.data.meta.generation,
            'number',
            'card+json GET carries the index-data generation in meta',
          );
          assert.ok(
            json.data.meta.generation > 0,
            'the index-data generation is positive',
          );
          delete json.data.meta.lastModified;
          delete json.data.meta.resourceCreatedAt;
          delete json.data.meta.generation;
          delete json.data.meta.version;
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          assert.deepEqual(json, {
            data: {
              id: `${testRealmHref}person-1`,
              type: 'card',
              attributes: {
                cardTitle: 'Mango',
                cardInfo,
                firstName: 'Mango',
                cardDescription: null,
                cardThumbnailURL: null,
              },
              meta: {
                adoptsFrom: {
                  module: rri(`./person`),
                  name: 'Person',
                },
                realmInfo: testRealmInfo,
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}person-1`,
              },
            },
          });
        });

        test('serves a card with a broken linksTo target as a normal instance — the broken slot is surfaced via the relationship reference, not as a server error', async function (assert) {
          let response = await request
            .get('/missing-link')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let json = response.body;
          assert.strictEqual(
            json.data.id,
            `${testRealmHref}missing-link`,
            'response carries the requested card id',
          );
          assert.strictEqual(
            json.data.relationships?.friend?.links?.self,
            './does-not-exist',
            'broken friend relationship is preserved on the wire as a reference — the consumer renders the placeholder, the server does not error',
          );
        });

        test('includes FileDef resources for file links in included payload', async function (assert) {
          let { testRealm: realm, request, dir: testDir } = getRealmSetup();

          // Write image files directly to the filesystem so they are on disk
          // but NOT yet in the index. This exercises the render-store's
          // extractFileMetaDirectly path: when the card is prerendered, the
          // images haven't been indexed yet, so getFileMetaInstance must fetch
          // and extract attributes directly from the raw file bytes.
          let realmDir = join(testDir.name, 'realm_server_1', 'test');
          let pngBytes = makeMinimalPng();
          writeFileSync(join(realmDir, 'hero.png'), pngBytes);
          writeFileSync(join(realmDir, 'first.png'), pngBytes);
          writeFileSync(join(realmDir, 'second.png'), pngBytes);

          // Write module + card instance — card is indexed before images
          await realm.writeMany(
            new Map<string, string>([
              [
                'gallery.gts',
                `
                import { CardDef, field, linksTo, linksToMany } from "@cardstack/base/card-api";
                import { FileDef } from "@cardstack/base/file-api";

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
                        module: rri('./gallery.gts'),
                        name: 'Gallery',
                      },
                    },
                  },
                }),
              ],
            ]),
          );

          // Now index the image files so they appear in loadLinks results
          await realm.writeMany(
            new Map<string, Uint8Array>([
              ['hero.png', pngBytes],
              ['first.png', pngBytes],
              ['second.png', pngBytes],
            ]),
          );

          let response = await request
            .get('/gallery')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');

          let doc = response.body as LooseSingleCardDocument;
          assert.ok(Array.isArray(doc.included), 'included resources present');

          let included = doc.included ?? [];
          let hero = included.find(
            (resource) => resource.id === `${testRealmHref}hero.png`,
          );
          let first = included.find(
            (resource) => resource.id === `${testRealmHref}first.png`,
          );
          let second = included.find(
            (resource) => resource.id === `${testRealmHref}second.png`,
          );

          assert.ok(hero, 'includes hero FileDef resource');
          assert.ok(first, 'includes first attachment FileDef resource');
          assert.ok(second, 'includes second attachment FileDef resource');
          assert.strictEqual(
            hero?.type,
            'file-meta',
            'FileDef uses file-meta type',
          );
          assert.strictEqual(hero?.attributes?.name, 'hero.png');
          assert.strictEqual(hero?.attributes?.contentType, 'image/png');
          assert.deepEqual(hero?.meta?.adoptsFrom, {
            module: baseRRI('png-image-def'),
            name: 'PngDef',
          });

          assert.deepEqual(
            (doc.data.relationships?.hero as Relationship)?.data,
            {
              type: 'file-meta',
              id: `${testRealmHref}hero.png`,
            },
          );
          assert.deepEqual(
            (doc.data.relationships?.['attachments.0'] as Relationship)?.data,
            {
              type: 'file-meta',
              id: `${testRealmHref}first.png`,
            },
          );
          assert.deepEqual(
            (doc.data.relationships?.['attachments.1'] as Relationship)?.data,
            {
              type: 'file-meta',
              id: `${testRealmHref}second.png`,
            },
          );
        });
        test('linksTo relationship for CardDef uses card type not file-meta', async function (assert) {
          let { testRealm: realm, request, dbAdapter } = getRealmSetup();

          let writes = new Map<string, string>([
            [
              'tag.gts',
              `
                import { CardDef, field, contains } from "@cardstack/base/card-api";
                import StringField from "@cardstack/base/string";

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
                import { CardDef, field, contains, linksTo } from "@cardstack/base/card-api";
                import StringField from "@cardstack/base/string";
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
                      module: rri('../tag.gts'),
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
                      module: rri('../article.gts'),
                      name: 'Article',
                    },
                  },
                },
              }),
            ],
          ]);

          await realm.writeMany(writes);

          // Verify the relationship is correct with a fresh index
          let response = await request
            .get('/Article/hello-world')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          let doc = response.body as LooseSingleCardDocument;
          let tagRelationship = doc.data.relationships?.tag as Relationship;
          assert.ok(tagRelationship, 'tag relationship exists');
          assert.deepEqual(
            tagRelationship.data,
            {
              type: 'card',
              id: `${testRealmHref}Tag/programming`,
            },
            'linksTo relationship for a CardDef uses type "card" not "file-meta"',
          );

          // Now simulate a stale index where the pristine_doc relationship
          // lacks data.type (as it would be before commit 480362eb12 which
          // added data to NotLoadedValue serialization in LinksTo.serialize).
          // Also remove the linked card's instance entry so getInstance
          // returns nothing, forcing the getFile fallback path.
          let articleAlias = `${testRealmHref}Article/hello-world`;
          let tagAlias = `${testRealmHref}Tag/programming`;
          await dbAdapter.execute(
            `UPDATE boxel_index
             SET pristine_doc = pristine_doc #- '{relationships,tag,data}'
             WHERE file_alias = '${articleAlias}'
             AND type = 'instance'`,
          );
          await dbAdapter.execute(
            `UPDATE boxel_index
             SET is_deleted = TRUE
             WHERE file_alias = '${tagAlias}'
             AND type = 'instance'`,
          );

          let response2 = await request
            .get('/Article/hello-world')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response2.status,
            200,
            `HTTP 200 status after index modification: ${response2.text}`,
          );
          let doc2 = response2.body as LooseSingleCardDocument;
          let tagRelationship2 = doc2.data.relationships?.tag as Relationship;
          assert.ok(tagRelationship2, 'tag relationship still exists');
          assert.strictEqual(
            (tagRelationship2.data as ResourceID)?.type,
            'card',
            'linksTo relationship for a CardDef should use type "card" even when data.type is missing from stale index and the linked instance is unavailable',
          );
        });
        test('stale linksTo(FileDef subclass) relationship data.type of card is corrected to file-meta', async function (assert) {
          let { testRealm: realm, request, dbAdapter } = getRealmSetup();

          await realm.writeMany(
            new Map<string, string | Uint8Array>([
              [
                'skill-card.gts',
                `
                  import { CardDef, field, contains, linksTo } from "@cardstack/base/card-api";
                  import StringField from "@cardstack/base/string";
                  import { MarkdownDef } from "@cardstack/base/markdown-file-def";

                  export class SkillCard extends CardDef {
                    @field cardTitle = contains(StringField);
                    @field instructionsSource = linksTo(MarkdownDef);
                  }
                `,
              ],
              [
                'Skill/example.json',
                JSON.stringify({
                  data: {
                    attributes: {
                      cardTitle: 'Example Skill',
                    },
                    relationships: {
                      instructionsSource: {
                        links: {
                          self: '../instructions.md',
                        },
                      },
                    },
                    meta: {
                      adoptsFrom: {
                        module: rri('../skill-card.gts'),
                        name: 'SkillCard',
                      },
                    },
                  },
                }),
              ],
              ['instructions.md', '# Example Instructions'],
            ]),
          );

          let response = await request
            .get('/Skill/example')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );

          let doc = response.body as LooseSingleCardDocument;
          let relationship = doc.data.relationships
            ?.instructionsSource as Relationship;
          assert.deepEqual(relationship?.data, {
            type: 'file-meta',
            id: `${testRealmHref}instructions.md`,
          });

          let included = doc.included ?? [];
          let linkedFile = included.find(
            (resource) => resource.id === `${testRealmHref}instructions.md`,
          );
          assert.ok(linkedFile, 'includes linked markdown file');
          assert.strictEqual(linkedFile?.type, 'file-meta');

          let instanceAlias = `${testRealmHref}Skill/example`;
          let markdownFileURL = `${testRealmHref}instructions.md`;
          await dbAdapter.execute(
            `UPDATE boxel_index
             SET pristine_doc = jsonb_set(
               pristine_doc,
               '{relationships,instructionsSource,data}',
               '{"type":"card","id":"${markdownFileURL}"}'::jsonb,
               true
             )
             WHERE file_alias = '${instanceAlias}'
             AND type = 'instance'`,
          );

          let staleResponse = await request
            .get('/Skill/example')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(
            staleResponse.status,
            200,
            `HTTP 200 status after stale relationship type: ${staleResponse.text}`,
          );

          let staleDoc = staleResponse.body as LooseSingleCardDocument;
          let staleRelationship = staleDoc.data.relationships
            ?.instructionsSource as Relationship;
          assert.deepEqual(staleRelationship?.data, {
            type: 'file-meta',
            id: markdownFileURL,
          });
        });
        test('card-level query-backed relationships resolve via search at read time', async function (assert) {
          let { testRealm: realm, request } = getRealmSetup();

          let writes = new Map<string, string>([
            [
              'query-person-finder.gts',
              `
                import { CardDef, field, contains, linksTo, linksToMany } from "@cardstack/base/card-api";
                import StringField from "@cardstack/base/string";
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
                      module: rri('./query-person-finder.gts'),
                      name: 'QueryPersonFinder',
                    },
                  },
                },
              }),
            ],
          ]);

          await realm.writeMany(writes);

          let response = await request
            .get('/query-person-finder')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          let doc = response.body;
          let favorite = doc.data.relationships.favorite;
          assert.deepEqual(
            favorite.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'linksTo query resolves to the matching person',
          );
          assert.strictEqual(
            favorite.links.self,
            `./person-1`,
            'linksTo relationship self link set to resolved card',
          );

          let matchesRelationship = doc.data.relationships['matches.0'];
          assert.ok(matchesRelationship, 'linksToMany relationship populated');
          assert.deepEqual(
            matchesRelationship.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'linksToMany query returns matching person in first slot',
          );

          assert.ok(
            Array.isArray(doc.included),
            'included resources present for query results',
          );
          assert.ok(
            doc.included.some(
              (resource: any) => resource.id === `${testRealmHref}person-1`,
            ),
            'included contains resolved person card',
          );
        });

        test('field-level query-backed relationships resolve at read time (nested contains)', async function (assert) {
          let { testRealm: realm, request } = getRealmSetup();

          let writes = new Map<string, string>([
            [
              'query-person-finder-nested.gts',
              `
                import { CardDef, FieldDef, field, contains, linksTo, linksToMany } from "@cardstack/base/card-api";
                import StringField from "@cardstack/base/string";
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
                      module: rri('./query-person-finder-nested.gts'),
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
                      module: rri('./query-person-finder-nested.gts'),
                      name: 'DeepOuterQueryCard',
                    },
                  },
                },
              }),
            ],
          ]);

          await realm.writeMany(writes);

          let response = await request
            .get('/query-person-finder-nested')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            'HTTP 200 status for nested',
          );
          let doc = response.body;
          assert.deepEqual(
            doc.data.relationships['info.queries.favorite']?.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'nested linksTo query resolves to matching person',
          );
          assert.strictEqual(
            doc.data.relationships['info.queries.favorite']?.links?.self,
            `./person-1`,
            'nested linksTo relationship self link set',
          );
          assert.deepEqual(
            doc.data.relationships['info.queries.matches.0']?.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'nested linksToMany returns first match',
          );

          let deepResponse = await request
            .get('/query-person-finder-deep')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            deepResponse.status,
            200,
            'HTTP 200 status for deep nested',
          );
          let deepDoc = deepResponse.body;
          assert.deepEqual(
            deepDoc.data.relationships['details.inner.queries.favorite']?.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'deeply nested linksTo query resolves to matching person',
          );
          assert.deepEqual(
            deepDoc.data.relationships['details.inner.queries.matches.0']?.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'deeply nested linksToMany returns first match',
          );
        });

        test('returns an ETag and public cache-control on a 200 response', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let etag = response.get('etag') ?? '';
          assert.ok(etag, 'response carries an ETag');
          assert.true(
            /^"\d+(?:-[0-9a-f]+)?:card-srcver-lb\d+"$/.test(etag),
            `ETag matches "<indexed_at>(-<realmInfoHash>)?:card-srcver-lb<budget>" pattern (got ${etag})`,
          );
          assert.strictEqual(
            response.get('cache-control'),
            'public, max-age=0, must-revalidate',
            'world-readable realm advertises public cache-control',
          );
          // The X-Boxel-Etag-Suppressed signal only fires when the
          // foreign-deps guard rejects the ETag; a card with purely
          // local deps must NOT carry it, otherwise ops dashboards
          // can't tell normal from suppressed traffic.
          assert.notOk(
            response.get('X-Boxel-Etag-Suppressed'),
            'no suppression signal on a card with only local deps',
          );
        });

        test('returns 304 when If-None-Match matches the current ETag', async function (assert) {
          let firstResponse = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(firstResponse.status, 200, 'first GET succeeds');
          let etag = firstResponse.get('etag') ?? '';
          assert.ok(etag, 'first response carries an ETag');

          let secondResponse = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('If-None-Match', etag);

          assert.strictEqual(
            secondResponse.status,
            304,
            'matching If-None-Match short-circuits to 304',
          );
          assert.strictEqual(
            secondResponse.get('etag'),
            etag,
            '304 response echoes the ETag',
          );
          assert.strictEqual(
            secondResponse.get('cache-control'),
            'public, max-age=0, must-revalidate',
            '304 response keeps the cache-control directive',
          );
          // 304 must not have a body — `response.body` may be `{}` when
          // supertest can't decode an empty buffer, so check `response.text`.
          assert.notOk(secondResponse.text, '304 response has no body');
        });

        test('returns 200 when If-None-Match does not match', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('If-None-Match', '"stale-etag"');

          assert.strictEqual(
            response.status,
            200,
            'non-matching If-None-Match falls through to a fresh 200',
          );
          assert.ok(response.body.data, 'full body is returned');
          assert.ok(response.get('etag'), '200 response still carries an ETag');
        });

        test('a 200 answers as card+json and varies on what selects its representation', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('content-type'),
            'application/vnd.card+json',
            'the 200 is typed as card+json',
          );
          assert.strictEqual(
            response.get('vary'),
            'Accept, x-boxel-link-shape',
            'caches key on the negotiated type and on the link shape, which are the two request members that select which representation of this URL is returned',
          );
        });

        test('a 304 answers with no body and still varies on what selects its representation', async function (assert) {
          let firstResponse = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(firstResponse.status, 200, 'first GET succeeds');
          let etag = firstResponse.get('etag') ?? '';
          assert.ok(etag, 'first response carries an ETag');

          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('If-None-Match', etag);

          assert.strictEqual(response.status, 304, 'HTTP 304 status');
          // `response.body` can be `{}` when supertest cannot decode an empty
          // buffer, so the body check reads `response.text`.
          assert.notOk(response.text, 'the 304 carries no body');
          assert.strictEqual(
            response.get('vary'),
            'Accept, x-boxel-link-shape',
            'a 304 has to carry the same key as the 200 it revalidates, or a cache stores the response under a narrower one',
          );
        });

        test('an Accept the realm serves no route for falls through to the module/file fallback and 404s', async function (assert) {
          // Content negotiation has no 406 arm: an unmatched Accept leaves the
          // router with no route, and the request lands on the fallback that
          // serves modules and raw files. `person-1` names a card, and neither
          // that name nor any executable-extension form of it is a file on
          // disk, so the fallback reports it missing.
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/x-unknown');

          assert.strictEqual(
            response.status,
            404,
            `an unsupported Accept 404s rather than 406ing: ${response.text}`,
          );
        });

        // A write lands on the realm's file system before it is indexed, so
        // "no index row" and "no card" are different situations. Writing
        // straight to disk (rather than through `realm.write`) leaves a file
        // the index has never seen — the state a client reads during the
        // window between a write and the indexing pass that follows it, and
        // the state any replica that did not handle the write is in.
        module(
          'card source on disk that the index has never seen',
          function (hooks) {
            hooks.beforeEach(function () {
              let realmDir = join(dir.name, 'realm_server_1', 'test');
              writeFileSync(
                join(realmDir, 'unindexed-card.json'),
                JSON.stringify({
                  data: {
                    type: 'card',
                    attributes: { firstName: 'Pending' },
                    meta: {
                      adoptsFrom: { module: './person', name: 'Person' },
                    },
                  },
                }),
              );
              // A collection document is a card document but never gets an
              // instance row of its own, so no amount of waiting makes it
              // servable.
              writeFileSync(
                join(realmDir, 'unindexed-collection.json'),
                JSON.stringify({ data: [] }),
              );
            });

            test('a single-card source is served from its file, marked as awaiting its index row', async function (assert) {
              let response = await request
                .get('/unindexed-card')
                .set('Accept', 'application/vnd.card+json');

              assert.strictEqual(
                response.status,
                200,
                `HTTP 200 status: ${response.text}`,
              );
              assert.strictEqual(
                response.headers[INDEX_PENDING_HEADER],
                'true',
                'the answer says the index has not caught up with the card',
              );
              assert.strictEqual(
                response.body.data.id,
                `${testRealmHref}unindexed-card`,
                'the card is identified by its own URL',
              );
              assert.strictEqual(
                response.body.data.attributes?.firstName,
                'Pending',
                'the document is what the file holds',
              );
              assert.strictEqual(
                response.headers['cache-control'],
                'no-store',
                'a provisional answer is not kept by a cache',
              );
              assert.strictEqual(
                response.headers['etag'],
                undefined,
                'there is no index row to build a validator from',
              );
            });

            test('the conditional-GET path says the same thing', async function (assert) {
              let response = await request
                .get('/unindexed-card')
                .set('Accept', 'application/vnd.card+json')
                .set('If-None-Match', '"stale-etag"');

              assert.strictEqual(
                response.status,
                200,
                `HTTP 200 status: ${response.text}`,
              );
              assert.strictEqual(
                response.headers[INDEX_PENDING_HEADER],
                'true',
                'the answer says the index has not caught up with the card',
              );
              assert.strictEqual(
                response.body.data.attributes?.firstName,
                'Pending',
                'the document is what the file holds',
              );
            });

            test('a source the indexer would never give an instance row is a plain 404', async function (assert) {
              let response = await request
                .get('/unindexed-collection')
                .set('Accept', 'application/vnd.card+json');

              assert.strictEqual(
                response.status,
                404,
                `HTTP 404 status: ${response.text}`,
              );
              assert.strictEqual(
                response.body.errors?.[0]?.awaitingIndex,
                undefined,
                'nothing suggests a row is coming for it',
              );
            });
          },
        );

        test('a card with neither an index row nor a source file is a plain 404', async function (assert) {
          let response = await request
            .get('/nonexistent-card')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            404,
            `HTTP 404 status: ${response.text}`,
          );
          assert.strictEqual(
            response.body.errors?.[0]?.awaitingIndex,
            undefined,
            'nothing suggests the card is on its way',
          );
        });
      });

      module('published realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'realistic',
          realmURL,
          permissions: {
            '*': ['read'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
          published: true,
        });

        test('serves the request', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );

          let json = response.body;

          delete json.data.meta.lastModified;
          delete json.data.meta.resourceCreatedAt;
          delete json.data.meta.generation;
          delete json.data.meta.version;

          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );

          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );

          assert.ok(
            json.data.meta.realmInfo.lastPublishedAt,
            'lastPublishedAt is set for published realm',
          );
          json.data.meta.realmInfo.lastPublishedAt = null;

          assert.deepEqual(json, {
            data: {
              id: `${testRealmHref}person-1`,
              type: 'card',
              attributes: {
                cardTitle: 'Mango',
                firstName: 'Mango',
                cardDescription: null,
                cardThumbnailURL: null,
                cardInfo,
              },
              meta: {
                adoptsFrom: {
                  module: rri(`./person`),
                  name: 'Person',
                },
                realmInfo: testRealmInfo,
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}person-1`,
              },
            },
          });
        });
      });

      // using public writable realm to make it easy for test setup for the error tests
      module('public writable realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'realistic',
          realmURL,
          permissions: {
            '*': ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('patching a card to point at a missing linksTo target keeps the card itself indexable — GET returns the card as a normal instance with the broken reference preserved on the wire', async function (assert) {
          await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                relationships: {
                  friend: {
                    links: {
                      self: './does-not-exist',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./friend.gts'),
                    name: 'Friend',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          let response = await request
            .get('/hassan')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let json = response.body;
          assert.strictEqual(
            json.data.id,
            `${testRealmHref}hassan`,
            'response carries the requested card id',
          );
          assert.strictEqual(
            json.data.relationships?.friend?.links?.self,
            './does-not-exist',
            'broken friend relationship is preserved on the wire as a reference — the consumer renders the placeholder, the server does not error',
          );
        });

        test('GET on an existing-but-errored index entry mirrors the underlying error status onto the HTTP response, but never 404 (reserved for a missing row) and never a non-HTTP status', async function (assert) {
          let cardURL = `${testRealmHref}person-1`;
          let cases: { errorStatus: number; expectedHttp: number }[] = [
            // Real, card-level HTTP error statuses flow through unchanged.
            { errorStatus: 401, expectedHttp: 401 },
            { errorStatus: 403, expectedHttp: 403 },
            { errorStatus: 422, expectedHttp: 422 },
            { errorStatus: 500, expectedHttp: 500 },
            // An unregistered-but-in-range upstream status (e.g. a proxied
            // 520) is still mirrored and must not throw while building the
            // error response.
            { errorStatus: 520, expectedHttp: 520 },
            // An existing-but-errored card is never "not found": a
            // recorded 404 (e.g. the error's underlying cause was a
            // missing linked instance) falls back to 500 so that a 404
            // on a card GET stays an unambiguous "card no longer exists"
            // signal.
            { errorStatus: 404, expectedHttp: 500 },
            // Non-HTTP / out-of-range statuses also fall back to 500: a
            // fetch failure recorded as 0, and a non-error status that
            // should never reach the error-row branch.
            { errorStatus: 0, expectedHttp: 500 },
            { errorStatus: 200, expectedHttp: 500 },
          ];

          for (let { errorStatus, expectedHttp } of cases) {
            let errorDoc = {
              message: 'boom',
              status: errorStatus,
              title: 'Some Error',
              additionalErrors: null,
            };
            // The instance row is keyed by `url` with the `.json` suffix;
            // the bare card URL is the `file_alias`. Match either so the
            // error flag lands on the row the GET read resolves.
            for (let table of ['boxel_index', 'boxel_index_working']) {
              await dbAdapter.execute(
                `UPDATE ${table}
                 SET has_error = TRUE, error_doc = $1::jsonb
                 WHERE (url = $2 OR file_alias = $2) AND type = 'instance'`,
                {
                  bind: [JSON.stringify(errorDoc), cardURL],
                },
              );
            }

            let response = await request
              .get('/person-1')
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(
              response.status,
              expectedHttp,
              `errorDoc.status ${errorStatus} → HTTP ${expectedHttp}`,
            );
            // The JSON:API body always carries the real underlying
            // status regardless of the HTTP status chosen, so consumers
            // can still see the precise cause.
            assert.strictEqual(
              response.body.errors?.[0]?.status,
              errorStatus,
              `JSON:API body preserves the underlying status (${errorStatus})`,
            );
          }
        });

        test('an errored row that recorded no title reports none', async function (assert) {
          // The row's own account is what the body carries. A failure that was
          // not a card error records no title, and reporting one anyway would
          // put a value in the body that describes nothing on the row.
          let cardURL = `${testRealmHref}person-1`;
          let errorDoc = {
            message: 'boom',
            status: 500,
            additionalErrors: null,
          };
          for (let table of ['boxel_index', 'boxel_index_working']) {
            await dbAdapter.execute(
              `UPDATE ${table}
                 SET has_error = TRUE, error_doc = $1::jsonb
                 WHERE (url = $2 OR file_alias = $2) AND type = 'instance'`,
              { bind: [JSON.stringify(errorDoc), cardURL] },
            );
          }

          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 500, 'HTTP 500 status');
          assert.strictEqual(
            response.body.errors?.[0]?.title,
            undefined,
            'the body carries no title, because the row recorded none',
          );
          assert.strictEqual(
            response.body.errors?.[0]?.message,
            'boom',
            'and carries the message the row did record',
          );
        });
      });

      // Assembling a card+json body reads the index row and then expands the
      // card's whole link closure into `included[]`, so the same card asked
      // for repeatedly — by different readers, or by one tab re-reading after
      // each neighbouring write — pays for those bytes again every time. The
      // response cache collapses those reads onto one assembly and reports
      // which of miss / join / hit each request took.
      module('card+json response cache', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'realistic',
          realmURL,
          permissions: {
            '*': ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('a repeat read of an unchanged card is served from the cache', async function (assert) {
          let first = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          let second = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(first.status, 200, `HTTP 200: ${first.text}`);
          assert.strictEqual(second.status, 200, `HTTP 200: ${second.text}`);
          assert.strictEqual(
            first.get('x-boxel-card-cache'),
            'miss',
            'the first read assembles the document',
          );
          assert.strictEqual(
            second.get('x-boxel-card-cache'),
            'hit',
            'the second read is served without reassembling',
          );
          assert.deepEqual(
            second.body,
            first.body,
            'the cached read returns the same document',
          );
          assert.strictEqual(
            second.get('etag'),
            first.get('etag'),
            'and the same validator',
          );
        });

        // Freshness comes from the key, not from an eviction step: the write
        // re-indexes the card, which rotates the validator the cache keys on,
        // so the entry assembled before the write is simply unreachable.
        test('a write makes the next read reassemble, with nothing evicted', async function (assert) {
          let before = await request
            .get('/hassan')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(before.status, 200, `HTTP 200: ${before.text}`);
          let primed = await request
            .get('/hassan')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(
            primed.get('x-boxel-card-cache'),
            'hit',
            'the card is cached before the write',
          );

          let patch = await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Hassan Abdel-Rahman' },
                meta: {
                  adoptsFrom: { module: rri('./friend.gts'), name: 'Friend' },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(patch.status, 200, `HTTP 200: ${patch.text}`);

          let after = await request
            .get('/hassan')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            after.get('x-boxel-card-cache'),
            'miss',
            'the read after the write assembles a fresh document',
          );
          assert.notStrictEqual(
            after.get('etag'),
            before.get('etag'),
            'because the write rotated the validator the cache keys on',
          );
          assert.strictEqual(
            after.body.data.attributes.firstName,
            'Hassan Abdel-Rahman',
            'and the fresh document carries the written value',
          );
        });

        test('a conditional read of a cached card still answers 304', async function (assert) {
          let first = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          let etag = first.get('etag') ?? '';
          assert.ok(etag, 'the first read carries a validator');

          let conditional = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('If-None-Match', etag);

          assert.strictEqual(
            conditional.status,
            304,
            'the conditional read still short-circuits to 304',
          );
          assert.strictEqual(
            conditional.get('etag'),
            etag,
            'and echoes the validator',
          );
          assert.notOk(conditional.text, '304 response has no body');
        });
      });

      // A cache whose assembly of one card waits on the test, so a second
      // request for that card is guaranteed to arrive while the first is
      // still assembling rather than racing it. Lives in its own module
      // because the injected instance is shared by every test in the module
      // it is passed to, where the per-test default is a fresh cache.
      module('card+json response cache coalescing', function (hooks) {
        class HoldableCardDocumentCache extends CardDocumentCache {
          heldUrl: string | undefined;
          release: Promise<void> | undefined;
          onAssemblyStarted: (() => void) | undefined;
          override getOrPopulate(
            args: Parameters<CardDocumentCache['getOrPopulate']>[0],
          ) {
            let held = this.heldUrl && args.url.endsWith(this.heldUrl);
            let { release, onAssemblyStarted } = this;
            return super.getOrPopulate({
              ...args,
              populate: async () => {
                if (held) {
                  onAssemblyStarted?.();
                  await release;
                }
                return args.populate();
              },
            });
          }
        }
        let cache = new HoldableCardDocumentCache({
          telemetryIntervalMs: 0,
        });

        setupPermissionedRealmCached(hooks, {
          fixture: 'realistic',
          realmURL,
          permissions: {
            '*': ['read'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
          cardDocumentCache: cache,
        });

        test('a second read of a card still being assembled joins that assembly instead of starting its own', async function (assert) {
          let releaseAssembly!: () => void;
          cache.heldUrl = '/person-1';
          cache.release = new Promise<void>(
            (resolve) => (releaseAssembly = resolve),
          );
          let assemblyStarted = new Promise<void>(
            (resolve) => (cache.onAssemblyStarted = resolve),
          );

          // supertest sends lazily; `.then` starts each request now.
          let first = request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .then((response) => response);
          await assemblyStarted;
          let second = request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .then((response) => response);
          await waitUntil(async () => cache.stats.joins === 1, {
            timeout: 10_000,
            interval: 10,
            timeoutMessage: 'the second read to join the in-flight assembly',
          });

          releaseAssembly();
          let [a, b] = await Promise.all([first, second]);

          assert.strictEqual(a.status, 200, `HTTP 200: ${a.text}`);
          assert.strictEqual(b.status, 200, `HTTP 200: ${b.text}`);
          assert.strictEqual(
            a.get('x-boxel-card-cache'),
            'miss',
            'the first read assembles',
          );
          assert.strictEqual(
            b.get('x-boxel-card-cache'),
            'join',
            'the second read joins that assembly rather than running its own',
          );
          assert.strictEqual(
            b.text,
            a.text,
            'and both receive byte-identical documents',
          );

          let third = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(
            third.get('x-boxel-card-cache'),
            'hit',
            'a read after the assembly settles is served from the entry it left behind',
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            john: ['read'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json'); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
          assert.strictEqual(
            response.get('cache-control'),
            'private, max-age=0, must-revalidate',
            'auth-gated realm advertises private cache-control so a shared cache cannot serve one user the response of another',
          );
          assert.ok(
            response.get('etag'),
            'auth-gated response carries an ETag',
          );
        });

        test('200 when server user assumes user that has read permission', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('X-Boxel-Assume-User', 'john')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, testRealmServerMatrixUserId, ['assume-user'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });

        test('403 when server user assumes user that has no read permission', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('X-Boxel-Assume-User', 'not-john')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, testRealmServerMatrixUserId, ['assume-user'])}`,
            );

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });

        // Read permission is realm-scoped and checked before the handler
        // runs, so an unauthorized caller never reaches the response cache —
        // a warm entry assembled for a reader who had permission is not a way
        // around the gate.
        test('a cached body is not reachable by a caller without read permission', async function (assert) {
          let authorized = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            );
          assert.strictEqual(authorized.status, 200, 'the reader is served');
          assert.strictEqual(
            authorized.get('x-boxel-card-cache'),
            'miss',
            'and their read populated the cache',
          );

          let unauthorized = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);
          assert.strictEqual(
            unauthorized.status,
            403,
            'a caller without read permission is still refused',
          );
          assert.notOk(
            unauthorized.body?.data,
            'and receives no card document',
          );

          let anonymous = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(
            anonymous.status,
            401,
            'as is a caller with no credentials at all',
          );
          assert.notOk(anonymous.body?.data, 'who also receives no document');
        });
      });
    });

    module('card POST request', function (_hooks) {
      module('public writable realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'realistic',
          realmURL,
          permissions: {
            '*': ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

        // The create path reads the new card back through its own call, so the
        // shape it answers with is asserted separately from the patch path's.
        // The read of the card the create just made is the control: it is what
        // the create would have assembled had it asked.
        test('a create side-loads none of the new card’s links', async function (assert) {
          let write = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Mango' },
                relationships: {
                  friend: { links: { self: `${testRealmHref}hassan` } },
                },
                meta: {
                  adoptsFrom: {
                    module: rri(`${testRealmHref}friend.gts`),
                    name: 'Friend',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(write.status, 201, `HTTP 201: ${write.text}`);
          // The stored link survives; what a readback would have added on top
          // of it — the resolved target, and the target's own resource — does
          // not.
          assert.ok(
            write.body.data.relationships?.friend?.links?.self,
            'the create still names the card its link points at',
          );
          assert.notOk(
            write.body.included,
            'but carries no side-loaded resources',
          );

          let localPath = new URL(write.body.data.id).pathname.replace(
            new URL(testRealmHref).pathname,
            '',
          );
          let read = await request
            .get(`/${localPath}`)
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(read.status, 200, `HTTP 200: ${read.text}`);
          assert.ok(
            (read.body.included ?? []).some(
              (resource: any) => resource.id === `${testRealmHref}hassan`,
            ),
            'the read of the created card does side-load that link',
          );
        });

        test('serves the request', async function (assert) {
          let realmEventTimestampStart = Date.now();

          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: rri('@cardstack/base/card-api'),
                    name: 'CardDef',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          let incrementalEventContent = await expectIncrementalIndexEvent(
            testRealmHref,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
              clientRequestId: null,
              versions: 'written',
              timeout: 5000,
            },
          );
          let id = incrementalEventContent.invalidations[0].split('/').pop()!;

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          assert.ok(
            response.get('x-created'),
            'created header should be set for new card',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let json = response.body;

          assert.true(
            isSingleCardDocument(json),
            'response body is a card document',
          );

          assert.strictEqual(
            json.data.id,
            `${testRealmHref}CardDef/${id}`,
            'the id is correct',
          );
          assert.ok(json.data.meta.lastModified, 'lastModified is populated');
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'CardDef',
            `${id}.json`,
          );
          assert.ok(existsSync(cardFile), 'card json exists');
          let card = readJSONSync(cardFile);
          assert.deepEqual(
            card,
            {
              data: {
                attributes: {},
                type: 'card',
                meta: {
                  adoptsFrom: {
                    module: rri('@cardstack/base/card-api'),
                    name: 'CardDef',
                  },
                },
              },
            },
            'file contents are correct',
          );
        });

        test("the incremental index event echoes the write's X-Boxel-Client-Request-Id", async function (assert) {
          // The writing client recognizes its own event by this id and skips
          // reloading over its own fresher local edits, so the echo is part of
          // the wire contract, not a diagnostic.
          let realmEventTimestampStart = Date.now();

          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: rri('@cardstack/base/card-api'),
                    name: 'CardDef',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json')
            .set('X-Boxel-Client-Request-Id', 'post-client-request-id');

          assert.strictEqual(response.status, 201, 'HTTP 201 status');

          await expectIncrementalIndexEvent(
            testRealmHref,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
              clientRequestId: 'post-client-request-id',
              versions: 'written',
              timeout: 5000,
            },
          );
        });

        // The create side of the same three readings the patch path asserts.
        // Worth having separately because the create learns the card's URL from
        // the commit rather than from the request, so the key its event reports
        // a version under is one it derived and not one the caller named.
        test('a create reports the stored bytes’ version on its response and on the index event', async function (assert) {
          let realmEventTimestampStart = Date.now();

          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Mango' },
                meta: {
                  // Spelled absolutely, not as `./friend.gts`. A create's card
                  // lands under its type's directory, so a realm-relative
                  // module reference in the payload resolves against that
                  // directory rather than the realm root.
                  adoptsFrom: {
                    module: rri(`${testRealmHref}friend.gts`),
                    name: 'Friend',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            201,
            `HTTP 201 status: ${response.text}`,
          );

          let newURL = response.body.data.id as string;
          let localPath = newURL.slice(testRealmHref.length);
          let storedHash = computeContentHash(
            readFileSync(
              join(dir.name, 'realm_server_1', 'test', `${localPath}.json`),
              'utf8',
            ),
          );
          assert.strictEqual(
            response.body.data.meta.version,
            storedHash,
            'the create response reports the hash of the bytes it stored',
          );

          await expectIncrementalIndexEvent(
            testRealmHref,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
              clientRequestId: null,
              versions: { [newURL]: storedHash },
              type: 'Friend',
              timeout: 5000,
            },
          );
        });

        test('a 201 answers as card+json and varies on Accept', async function (assert) {
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: rri('@cardstack/base/card-api'),
                    name: 'CardDef',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          assert.strictEqual(
            response.get('content-type'),
            'application/vnd.card+json',
            'the 201 is typed as card+json',
          );
          assert.strictEqual(
            response.get('vary'),
            'Accept',
            'the response varies on Accept',
          );
        });

        test('the 201 reports the created card as the index holds it', async function (assert) {
          // A create answers from the card read back out of the index, never
          // from the serialization it just wrote: a computed field is derived
          // at index time and never stored, so a body carrying one is the
          // request having waited for the incremental index job its own write
          // queued.
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Van Gogh' },
                meta: {
                  adoptsFrom: {
                    // Absolute, because a created card is stored one directory
                    // down and a relative ref would be resolved from there.
                    module: rri(`${testRealmHref}person`),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            201,
            `HTTP 201 status: ${response.text}`,
          );
          assert.strictEqual(
            response.body.data.attributes?.cardTitle,
            'Van Gogh',
            'the 201 carries the computed field the stored file does not hold',
          );
        });

        test('Content-Type routes the request when Accept matches no route', async function (assert) {
          // The router's second chance: an unmatched Accept falls back to
          // Content-Type, which is what makes a body-bearing POST route on the
          // type of what it is sending rather than the type it wants back.
          let response = await request
            .post('/')
            .set('Accept', 'application/x-unknown')
            .set('Content-Type', 'application/vnd.card+json')
            .send(
              JSON.stringify({
                data: {
                  type: 'card',
                  attributes: {},
                  meta: {
                    adoptsFrom: {
                      module: rri('@cardstack/base/card-api'),
                      name: 'CardDef',
                    },
                  },
                },
              }),
            );

          assert.strictEqual(
            response.status,
            201,
            `the create route still runs: ${response.text}`,
          );
        });

        test('a local id written inside a relationship data array is refused', async function (assert) {
          // A collection's edges are stored one key per member —
          // `friends.0`, `friends.1` — and that is the only spelling whose
          // links survive serialization. A local id written inside the
          // `data` array has no key of its own to carry one, so the card
          // would be stored with the edge missing and the write would report
          // success.
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Hassan' },
                relationships: {
                  friends: { data: [{ type: 'card', lid: 'local-id-7' }] },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('https://localhost:4202/node-test/friend'),
                    name: 'Friend',
                  },
                },
              },
              included: [
                {
                  lid: 'local-id-7',
                  type: 'card',
                  attributes: { firstName: 'Boris' },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            400,
            `HTTP 400 status: ${response.text}`,
          );
        });

        test('a local id no resource in the payload creates is refused', async function (assert) {
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Hassan' },
                relationships: {
                  friend: { data: { type: 'card', lid: 'nobody-sent-this' } },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('https://localhost:4202/node-test/friend'),
                    name: 'Friend',
                  },
                },
              },
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            400,
            `a local id naming nothing is the payload's fault: ${response.text}`,
          );
        });

        test('a POST to an existing card URL is not a create route and 404s', async function (assert) {
          // Create matches the realm root and directory paths only, so a POST
          // aimed at a card 404s through the module/file fallback instead of
          // replacing the card.
          let response = await request
            .post('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Van Gogh' },
                meta: {
                  adoptsFrom: {
                    module: rri('./person'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            404,
            `POST to a card URL 404s: ${response.text}`,
          );
        });

        test('an echoed serve-time meta.screenshots never persists into the source file', async function (assert) {
          // The shape a card+json GET stamps — a client that GETs a doc and
          // POSTs it back to duplicate the card echoes this, and persisting
          // it would pin the copy's source file to the original instance's
          // captures.
          let echoedScreenshots = {
            card: {
              url: `${testRealmHref}_screenshot/some-card?name=card`,
              hash: 'abc123',
              contentType: 'image/png',
              width: 400,
              height: 300,
              deviceScaleFactor: 2,
            },
          };

          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: rri('@cardstack/base/card-api'),
                    name: 'CardDef',
                  },
                  screenshots: echoedScreenshots,
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          let id = response.body.data.id.split('/').pop()!;
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'CardDef',
            `${id}.json`,
          );
          assert.ok(existsSync(cardFile), 'card json exists');
          let card = readJSONSync(cardFile);
          assert.strictEqual(
            card.data.meta.screenshots,
            undefined,
            'the POSTed echo is stripped from the source file',
          );

          let patchResponse = await request
            .patch(`/CardDef/${id}`)
            .send({
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: rri('@cardstack/base/card-api'),
                    name: 'CardDef',
                  },
                  screenshots: echoedScreenshots,
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(patchResponse.status, 200, 'HTTP 200 status');
          card = readJSONSync(cardFile);
          assert.strictEqual(
            card.data.meta.screenshots,
            undefined,
            'the PATCHed echo is stripped from the source file',
          );
        });

        test('an explicitly-null relationship is preserved and an absent one omitted, in both the source and the served card+json', async function (assert) {
          let realmEventTimestampStart = Date.now();

          // `Friend.friend` (linksTo) and `Friend.friends` (linksToMany) are
          // both non-searchable. Author `friend` explicitly null and leave
          // `friends` absent. Serialization keys on whether the card actually
          // has the relationship — an authored empty (`{ self: null }`) vs a
          // never-set link — independent of searchability, so both the written
          // source and the served card+json keep `friend` as `{ self: null }`
          // and omit `friends`. (`friend` is even rendered in the isolated
          // template, yet a render doesn't author a link — reading it doesn't
          // mark it "used" — so it stays omitted unless actually set.)
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Hassan',
                },
                relationships: {
                  friend: {
                    links: {
                      self: null,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('https://localhost:4202/node-test/friend'),
                    name: 'Friend',
                  },
                },
              },
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          let incrementalEventContent = await expectIncrementalIndexEvent(
            testRealmHref,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
              clientRequestId: null,
              versions: 'written',
              type: 'Friend',
              timeout: 5000,
            },
          );
          let id = incrementalEventContent.invalidations[0].split('/').pop()!;

          assert.strictEqual(
            response.status,
            201,
            `HTTP 201 status: ${response.text}`,
          );

          // The written source persists the card's relationships as authored:
          // the explicitly-null `friend` survives as `{ self: null }` while the
          // never-authored `friends` is absent.
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'Friend',
            `${id}.json`,
          );
          assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
          let source = readJSONSync(cardFile) as LooseSingleCardDocument;
          assert.deepEqual(
            source.data.relationships,
            { friend: { links: { self: null } } },
            'source keeps the explicitly-null friend link and omits the absent friends link',
          );

          // The served card+json (the indexed pristine doc) keeps the same
          // distinction: `friend` was authored empty, so it round-trips as
          // `{ self: null }`; `friends` was never set, so it is omitted. This is
          // data fidelity, independent of searchability.
          let getResponse = await request
            .get(`/Friend/${id}`)
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(
            getResponse.status,
            200,
            `HTTP 200 status: ${getResponse.text}`,
          );
          let served = getResponse.body as SingleCardDocument;
          assert.deepEqual(
            served.data.relationships?.friend,
            { links: { self: null } },
            'served card+json preserves the explicitly-null friend link',
          );
          assert.strictEqual(
            served.data.relationships?.friends,
            undefined,
            'served card+json omits the absent friends link',
          );
        });

        test('an authored-empty linksToMany is preserved distinctly from a never-set one, in both the source and the served card+json', async function (assert) {
          let realmEventTimestampStart = Date.now();

          // Mirror of the `linksTo` case above for the plural link. Author
          // `friends` (linksToMany) explicitly empty and leave `friend`
          // (linksTo) absent. An empty plural link is authored — a relationship
          // the card has, spelled `{ self: null }` on the wire — vs. a never-set
          // one, which is omitted. This holds even though the plural getter
          // materializes a backing array on read: a mere render doesn't author a
          // link, so the never-set `friend` stays omitted while the authored
          // empty `friends` round-trips.
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Hassan',
                },
                relationships: {
                  friends: {
                    links: {
                      self: null,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('https://localhost:4202/node-test/friend'),
                    name: 'Friend',
                  },
                },
              },
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          let incrementalEventContent = await expectIncrementalIndexEvent(
            testRealmHref,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
              clientRequestId: null,
              versions: 'written',
              type: 'Friend',
              timeout: 5000,
            },
          );
          let id = incrementalEventContent.invalidations[0].split('/').pop()!;

          assert.strictEqual(
            response.status,
            201,
            `HTTP 201 status: ${response.text}`,
          );

          // The written source persists the card's relationships as authored:
          // the explicitly-empty `friends` survives as `{ self: null }` while the
          // never-authored `friend` is absent.
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'Friend',
            `${id}.json`,
          );
          assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
          let source = readJSONSync(cardFile) as LooseSingleCardDocument;
          assert.deepEqual(
            source.data.relationships,
            { friends: { links: { self: null } } },
            'source keeps the explicitly-empty friends link and omits the absent friend link',
          );

          // The served card+json (the indexed pristine doc) keeps the same
          // distinction: `friends` was authored empty, so it round-trips as
          // `{ self: null }`; `friend` was never set, so it is omitted.
          let getResponse = await request
            .get(`/Friend/${id}`)
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(
            getResponse.status,
            200,
            `HTTP 200 status: ${getResponse.text}`,
          );
          let served = getResponse.body as SingleCardDocument;
          assert.deepEqual(
            served.data.relationships?.friends,
            { links: { self: null } },
            'served card+json preserves the explicitly-empty friends link',
          );
          assert.strictEqual(
            served.data.relationships?.friend,
            undefined,
            'served card+json omits the absent friend link',
          );
        });

        test('creates card instances when it encounters "lid" in the request', async function (assert) {
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Hassan',
                },
                relationships: {
                  friend: {
                    data: {
                      lid: 'local-id-1',
                      type: 'card',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('https://localhost:4202/node-test/friend'),
                    name: 'Friend',
                  },
                },
              },
              included: [
                {
                  lid: 'local-id-1',
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  relationships: {
                    'friends.0': {
                      data: {
                        lid: 'local-id-2',
                        type: 'card',
                      },
                    },
                    'friends.1': {
                      data: {
                        lid: 'local-id-3',
                        type: 'card',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
                {
                  lid: 'local-id-2',
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
                {
                  lid: 'local-id-3',
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let json = response.body as SingleCardDocument;
          let id = json.data.id!.split('/').pop()!;
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `${id}.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Hassan',
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: './local-id-1',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-1.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  relationships: {
                    'friends.0': {
                      links: {
                        self: './local-id-2',
                      },
                    },
                    'friends.1': {
                      links: {
                        self: './local-id-3',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-2.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-3.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let response = await request
              .get(`/Friend/${id}`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}Friend/${id}`,
              type: 'card',
              attributes: {
                firstName: 'Hassan',
                cardTitle: 'Hassan',
                cardDescription: null,
                cardThumbnailURL: null,
                cardInfo,
              },
              relationships: {
                friend: {
                  links: {
                    self: './local-id-1',
                  },
                  data: {
                    type: 'card',
                    id: `${testRealmHref}Friend/local-id-1`,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'Friend',
                  module: rri('https://localhost:4202/node-test/friend'),
                },
                realmInfo: testRealmInfo,
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}Friend/${id}`,
              },
            });

            for (let resource of json.included!) {
              delete resource.meta.realmURL;
              delete resource.meta.realmInfo;
              delete resource.meta.lastModified;
              delete resource.meta.resourceCreatedAt;
              delete resource.links;
            }
            assert.deepEqual(
              json.included,
              [
                {
                  id: `${testRealmHref}Friend/local-id-1`,
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                    cardTitle: 'Jade',
                    cardDescription: null,
                    cardThumbnailURL: null,
                    cardInfo,
                  },
                  relationships: {
                    'friends.0': {
                      links: {
                        self: './local-id-2',
                      },
                      data: {
                        id: `${testRealmHref}Friend/local-id-2`,
                        type: 'card',
                      },
                    },
                    'friends.1': {
                      links: {
                        self: './local-id-3',
                      },
                      data: {
                        id: `${testRealmHref}Friend/local-id-3`,
                        type: 'card',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-2`,
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                    cardTitle: 'Germaine',
                    cardDescription: null,
                    cardThumbnailURL: null,
                    cardInfo,
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-3`,
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                    cardTitle: 'Boris',
                    cardDescription: null,
                    cardThumbnailURL: null,
                    cardInfo,
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
              ],
              'included is correct',
            );
          }
          {
            let response = await request
              .get(`/Friend/local-id-1`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}Friend/local-id-1`,
              type: 'card',
              attributes: {
                firstName: 'Jade',
                cardTitle: 'Jade',
                cardDescription: null,
                cardThumbnailURL: null,
                cardInfo,
              },
              relationships: {
                'friends.0': {
                  links: {
                    self: './local-id-2',
                  },
                  data: {
                    id: `${testRealmHref}Friend/local-id-2`,
                    type: 'card',
                  },
                },
                'friends.1': {
                  links: {
                    self: './local-id-3',
                  },
                  data: {
                    id: `${testRealmHref}Friend/local-id-3`,
                    type: 'card',
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'Friend',
                  module: rri('https://localhost:4202/node-test/friend'),
                },
                realmInfo: testRealmInfo,
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}Friend/local-id-1`,
              },
            });

            for (let resource of json.included!) {
              delete resource.meta.realmURL;
              delete resource.meta.realmInfo;
              delete resource.meta.lastModified;
              delete resource.meta.resourceCreatedAt;
              delete resource.links;
            }
            assert.deepEqual(
              json.included,
              [
                {
                  id: `${testRealmHref}Friend/local-id-2`,
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                    cardTitle: 'Germaine',
                    cardDescription: null,
                    cardThumbnailURL: null,
                    cardInfo,
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-3`,
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                    cardTitle: 'Boris',
                    cardDescription: null,
                    cardThumbnailURL: null,
                    cardInfo,
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
              ],
              'included is correct',
            );
          }
          {
            let response = await request
              .get(`/Friend/local-id-2`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json, {
              data: {
                id: `${testRealmHref}Friend/local-id-2`,
                type: 'card',
                attributes: {
                  firstName: 'Germaine',
                  cardTitle: 'Germaine',
                  cardDescription: null,
                  cardThumbnailURL: null,
                  cardInfo,
                },
                meta: {
                  adoptsFrom: {
                    name: 'Friend',
                    module: rri('https://localhost:4202/node-test/friend'),
                  },
                  realmInfo: testRealmInfo,
                  realmURL: testRealmHref,
                },
                links: {
                  self: `${testRealmHref}Friend/local-id-2`,
                },
              },
            });
          }
          {
            let response = await request
              .get(`/Friend/local-id-3`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json, {
              data: {
                id: `${testRealmHref}Friend/local-id-3`,
                type: 'card',
                attributes: {
                  firstName: 'Boris',
                  cardTitle: 'Boris',
                  cardDescription: null,
                  cardThumbnailURL: null,
                  cardInfo,
                },
                meta: {
                  adoptsFrom: {
                    name: 'Friend',
                    module: rri('https://localhost:4202/node-test/friend'),
                  },
                  realmInfo: testRealmInfo,
                  realmURL: testRealmHref,
                },
                links: {
                  self: `${testRealmHref}Friend/local-id-3`,
                },
              },
            });
          }
        });

        test('ignores "lid" for other realms', async function (assert) {
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Hassan',
                },
                relationships: {
                  friend: {
                    data: {
                      lid: 'local-id-3',
                      type: 'card',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('https://localhost:4202/node-test/friend'),
                    name: 'Friend',
                  },
                },
              },
              included: [
                {
                  lid: 'local-id-3',
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                    realmURL: ri(`http://some-other-realm/`),
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let json = response.body as SingleCardDocument;
          let id = json.data.id!.split('/').pop()!;
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `${id}.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Hassan',
                  },
                  relationships: {
                    // The written source records the explicitly-nulled cross-
                    // realm `friend` link — the write path persists the card's
                    // own relationships as authored, and an authored
                    // `{ self: null }` is preserved (the served card+json keeps
                    // it too; only never-authored links are omitted).
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-3.json`,
            );
            assert.false(
              existsSync(cardFile),
              `card json ${cardFile} does not exist`,
            );
          }
        });

        test('creates card instance when it encounters "lid" in the primary resource', async function (assert) {
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                lid: 'local-id-1',
                attributes: {
                  firstName: 'Hassan',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('https://localhost:4202/node-test/friend'),
                    name: 'Friend',
                  },
                  realmURL: ri(testRealmHref.replace(/\/$/, '')),
                },
              },
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          let json = response.body as SingleCardDocument;
          let id = json.data.id!.split('/').pop()!;
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'Friend',
            `${id}.json`,
          );
          assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
          let card = readJSONSync(cardFile);
          assert.deepEqual(
            card,
            {
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Hassan',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('https://localhost:4202/node-test/friend'),
                    name: 'Friend',
                  },
                },
              },
            } as LooseSingleCardDocument,
            `file contents ${cardFile} are correct`,
          );
          {
            let response = await request
              .get(`/Friend/${id}`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}Friend/${id}`,
              type: 'card',
              attributes: {
                firstName: 'Hassan',
                cardTitle: 'Hassan',
                cardDescription: null,
                cardThumbnailURL: null,
                cardInfo,
              },
              meta: {
                adoptsFrom: {
                  name: 'Friend',
                  module: rri('https://localhost:4202/node-test/friend'),
                },
                realmInfo: testRealmInfo,
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}Friend/${id}`,
              },
            });
          }
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            john: ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .post('/')
            .send({})
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .post('/')
            .send({})
            .set('Accept', 'application/vnd.card+json'); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 permissions have been updated', async function (assert) {
          let response = await request
            .post('/')
            .send({})
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            );

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .post('/')
            .send({})
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('201 with permission', async function (assert) {
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: rri('@cardstack/base/card-api'),
                    name: 'CardDef',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            );

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
        });
      });
    });

    module('card PATCH request', function (_hooks) {
      module('public writable realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'realistic',
          realmURL,
          permissions: {
            '*': ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

        // `hassan` links to `jade`, which links back — so a closure walk over
        // this card has something to find and does not terminate at one layer.
        // The read is the control: it is what the write would have assembled.
        test('a write side-loads none of the written card’s links', async function (assert) {
          let write = await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Hassan Abdel-Rahman' },
                meta: {
                  adoptsFrom: { module: rri('./friend.gts'), name: 'Friend' },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(write.status, 200, `HTTP 200: ${write.text}`);
          assert.strictEqual(
            write.body.data.attributes.firstName,
            'Hassan Abdel-Rahman',
            'the write answers with the value it stored',
          );
          assert.strictEqual(
            write.body.data.relationships?.friend?.links?.self,
            './jade',
            'and still names the card the stored link points at',
          );
          assert.notOk(
            write.body.included,
            'but carries no side-loaded resources',
          );

          let read = await request
            .get('/hassan')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(read.status, 200, `HTTP 200: ${read.text}`);
          assert.ok(
            (read.body.included ?? []).some(
              (resource: any) => resource.id === `${testRealmHref}jade`,
            ),
            'the read of the same card does side-load that link',
          );
        });

        // Each of these stages can be the whole of a slow write, and none is
        // distinguishable from outside the handler, so the line has to carry
        // every one of them for a write's duration to be attributable.
        test('a write reports where its time went', async function (assert) {
          let lines: string[] = [];
          setWriteTimingSinkForTests((line) => lines.push(line));
          try {
            let response = await request
              .patch('/hassan')
              .send({
                data: {
                  type: 'card',
                  // A value the fixture does not already hold: an unchanged
                  // patch short-circuits before the write, and the stages
                  // asserted below are the ones that short circuit skips.
                  attributes: { firstName: 'Hassan Timed' },
                  meta: {
                    adoptsFrom: { module: rri('./friend.gts'), name: 'Friend' },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json')
              .set('X-Boxel-Logging-Correlation-Id', 'write-timing-probe');

            assert.strictEqual(
              response.status,
              200,
              `HTTP 200: ${response.text}`,
            );
          } finally {
            setWriteTimingSinkForTests(undefined);
          }

          assert.strictEqual(lines.length, 1, 'the write emitted one line');
          let line = lines[0];
          assert.ok(
            line.startsWith('PATCH '),
            `line names the method: ${line}`,
          );
          assert.ok(
            line.includes('corr=write-timing-probe'),
            `line carries the caller's correlation id: ${line}`,
          );
          for (let stage of [
            'lock',
            'drain',
            'stage',
            'persist',
            'enqueue',
            'awaitIndex',
            'invalidate',
            'commit',
            'readback',
            'stringify',
          ]) {
            assert.ok(
              new RegExp(`\\b${stage}=\\d+`).test(line),
              `line attributes the ${stage} stage: ${line}`,
            );
          }
          assert.ok(
            / status=200 /.test(line),
            `line reports the answer the write gave: ${line}`,
          );
          let handler = handlerMs(line);
          assert.notStrictEqual(
            handler,
            undefined,
            `line reports the whole handler: ${line}`,
          );
          // The guard that keeps the stages a timeline rather than a set of
          // overlapping measurements. A stage that contained the ones inside
          // it would count their time twice and push the total past the
          // handler, and every share read off the line would be wrong by the
          // same factor.
          let stages = stageMs(line);
          let total = Object.values(stages).reduce((sum, ms) => sum + ms, 0);
          assert.ok(
            total <= handler!,
            `the stages sum to no more than the handler (${total} <= ${handler}): ${line}`,
          );
        });

        // The wait for a worker is the one stage this header removes, and a
        // caller reaching for it is asking to stop paying for it. A line that
        // reported the same stages either way could not show that it worked.
        test('a write that opts out of waiting for the index reports no wait', async function (assert) {
          let lines: string[] = [];
          setWriteTimingSinkForTests((line) => lines.push(line));
          try {
            let response = await request
              .patch('/hassan')
              .send({
                data: {
                  type: 'card',
                  attributes: { firstName: 'Hassan Deferred' },
                  meta: {
                    adoptsFrom: { module: rri('./friend.gts'), name: 'Friend' },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json')
              .set(SKIP_INDEX_WAIT_HEADER, 'true');

            assert.strictEqual(
              response.status,
              200,
              `HTTP 200: ${response.text}`,
            );
          } finally {
            setWriteTimingSinkForTests(undefined);
          }

          assert.strictEqual(lines.length, 1, 'the write emitted one line');
          let line = lines[0];
          let stages = stageMs(line);
          assert.ok(
            'persist' in stages,
            `the write still reports making the bytes durable: ${line}`,
          );
          assert.ok(
            'enqueue' in stages,
            `and still reports queueing its index job: ${line}`,
          );
          assert.notOk(
            'awaitIndex' in stages,
            `but reports no wait for a worker to run it: ${line}`,
          );
          // This write's answer is built from the document the commit stored
          // rather than read back out of the index, and building it reaches
          // for the realm's info. Without a stage over that, the work would
          // sit after the last stage the line reports, and the timeline would
          // end before the handler did.
          assert.ok(
            'stringify' in stages,
            `and still reports building its answer: ${line}`,
          );
          let handler = handlerMs(line);
          assert.notStrictEqual(
            handler,
            undefined,
            `line reports the whole handler: ${line}`,
          );
          let total = Object.values(stages).reduce((sum, ms) => sum + ms, 0);
          assert.ok(
            total <= handler!,
            `the stages sum to no more than the handler (${total} <= ${handler}): ${line}`,
          );
        });

        // What is stored for a relationship depends on whether the link can be
        // relativized against the writing realm. A scoped reference cannot be,
        // and must not be resolved either: resolving one stores whatever URL
        // the linked realm answers to in this environment, so a realm under
        // version control ends up carrying a dev or staging host.
        test('stores a scoped cross-realm link verbatim', async function (assert) {
          let scopedLink = '@cardstack/catalog/Pet/vangogh';

          let response = await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                relationships: {
                  friend: { links: { self: scopedLink } },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./friend.gts'),
                    name: 'Friend',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );

          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'hassan.json',
          );
          let stored = JSON.parse(readFileSync(cardFile, 'utf8'));
          assert.strictEqual(
            stored.data.relationships.friend.links.self,
            scopedLink,
            'the stored link is the scoped reference the client sent',
          );
        });

        test('still relativizes a same-realm link', async function (assert) {
          let response = await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                relationships: {
                  friend: { links: { self: `${testRealmHref}jade` } },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./friend.gts'),
                    name: 'Friend',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );

          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'hassan.json',
          );
          let stored = JSON.parse(readFileSync(cardFile, 'utf8'));
          assert.strictEqual(
            stored.data.relationships.friend.links.self,
            './jade',
            'an in-realm link is still stored relative',
          );
        });

        test('serves the request', async function (assert) {
          let entry = 'person-1.json';

          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Van Gogh',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.ok(
            response.get('x-created'),
            'created header should be set for updated card',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );

          let json = response.body;
          assert.ok(json.data.meta.lastModified, 'lastModified exists');

          assert.true(
            isSingleCardDocument(json),
            'response body is a card document',
          );

          assert.strictEqual(
            json.data.attributes?.firstName,
            'Van Gogh',
            'the field data is correct',
          );
          assert.ok(json.data.meta.lastModified, 'lastModified is populated');
          delete json.data.meta.lastModified;
          delete json.data.meta.resourceCreatedAt;
          delete json.data.meta.generation;
          delete json.data.meta.version;
          let cardFile = join(dir.name, 'realm_server_1', 'test', entry);
          assert.ok(existsSync(cardFile), 'card json exists');
          let card = readJSONSync(cardFile);
          // The stored file carries only the fields the file and the patch
          // actually specify — unset fields are not materialized into it.
          assert.deepEqual(
            card,
            {
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Van Gogh',
                },
                meta: {
                  adoptsFrom: {
                    module: rri(`./person`),
                    name: 'Person',
                  },
                },
              },
            },
            'file contents are correct',
          );

          response = await request
            .post('/_search')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(
              searchEntryWireQueryFromQuery(
                {
                  filter: {
                    on: {
                      module: rri(`${testRealmHref}person`),
                      name: 'Person',
                    },
                    eq: { firstName: 'Van Gogh' },
                  },
                },
                { fields: ['item'] },
              ),
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.body.data.length,
            1,
            'found one search result',
          );
        });

        test('PATCH preserves nested contains attribute values on disk', async function (assert) {
          // Regression test for the file-serializer's handling of dotted
          // attribute paths. Person.cardInfo is `contains(CardInfoField)`
          // and CardInfoField has its own immediate fields like
          // `summary` and `notes`. A PATCH that writes
          // `attributes.cardInfo.summary` must persist that value to
          // disk; an earlier shape relied on materialized
          // `definition.fields["cardInfo.summary"]` entries to find the
          // FieldDefinition, and the no-materialization shape requires
          // `processAttributes` to descend into the child definition
          // (CardInfoField) at recursion. Without that, the nested
          // attribute is silently dropped.
          let entry = 'person-1.json';

          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Mango',
                  cardInfo: {
                    name: 'Mango Card',
                    notes: 'a friendly dog',
                    summary: 'good boy',
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.deepEqual(
            response.body.data.attributes?.cardInfo,
            {
              name: 'Mango Card',
              notes: 'a friendly dog',
              summary: 'good boy',
              cardThumbnailURL: null,
            },
            'nested cardInfo values present in PATCH response',
          );

          let cardFile = join(dir.name, 'realm_server_1', 'test', entry);
          assert.ok(existsSync(cardFile), 'card json exists on disk');
          let card = readJSONSync(cardFile);
          // Only the values the patch specifies land on disk; unset nested
          // fields (cardThumbnailURL) are not materialized into the file.
          assert.deepEqual(
            card.data.attributes?.cardInfo,
            {
              name: 'Mango Card',
              notes: 'a friendly dog',
              summary: 'good boy',
            },
            'nested cardInfo values persisted to disk by file-serializer',
          );
        });

        test('no-op patch returns existing lastModified and does not rewrite file', async function (assert) {
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'person-1.json',
          );
          // A PATCH stores the file in canonical serialized form (e.g. the
          // adoptsFrom module ref is written without its executable
          // extension), so a first PATCH of a hand-authored fixture may
          // rewrite it once. Prime with one PATCH so the no-op assertions
          // below measure the steady state.
          await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                meta: {
                  adoptsFrom: {
                    module: rri('./person'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');
          let initialStat = statSync(cardFile);

          let initialResponse = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            initialResponse.status,
            200,
            'initial GET succeeds',
          );
          let initialLastModified = initialResponse.body.data.meta.lastModified;
          assert.ok(initialLastModified, 'initial lastModified exists');

          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                meta: {
                  adoptsFrom: {
                    module: rri('./person'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.body.data.meta.lastModified,
            initialLastModified,
            'lastModified remains unchanged after no-op patch',
          );
          assert.strictEqual(
            response.body.data.attributes?.firstName,
            'Mango',
            'card remains unchanged',
          );
          let afterStat = statSync(cardFile);
          assert.strictEqual(
            afterStat.mtimeMs,
            initialStat.mtimeMs,
            'card file not rewritten for no-op patch',
          );
        });

        test('PATCH response carries an ETag and writes invalidate the previous one', async function (assert) {
          // Capture the pre-patch ETag, mutate the card, and verify the PATCH
          // response advertises a different ETag for the new state.
          //
          // A write answers with the written card alone while a GET answers
          // with its link closure, so the two are different representations of
          // one card and take different validators. That is what the
          // `write-echo` variant records, and it is why the ETag a PATCH
          // returns does not short-circuit a later GET of the same URL: being
          // 304'd on it would hand the caller a body with no `included[]` as
          // though it were the GET representation.
          let initialResponse = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          let originalEtag = initialResponse.get('etag') ?? '';
          assert.ok(originalEtag, 'initial GET returns an ETag');

          let patchResponse = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Van Gogh' },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(patchResponse.status, 200, 'PATCH succeeds');
          let patchEtag = patchResponse.get('etag') ?? '';
          assert.ok(patchEtag, 'PATCH response carries an ETag');
          assert.true(
            /^"\d+(?:-[0-9a-f]+)?:card-srcver-write-echo"$/.test(patchEtag),
            `PATCH ETag names the write-echo shape (got ${patchEtag})`,
          );
          assert.notStrictEqual(
            patchEtag,
            originalEtag,
            'PATCH advances the ETag because indexed_at bumps on the rewrite',
          );

          // Sending the OLD etag against If-None-Match must NOT short-circuit
          // (otherwise we'd serve a stale 304 after a write).
          let staleResponse = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('If-None-Match', originalEtag);
          assert.strictEqual(
            staleResponse.status,
            200,
            'old ETag no longer matches → fresh 200',
          );
          assert.true(
            /^"\d+(?:-[0-9a-f]+)?:card-srcver-lb\d+"$/.test(
              staleResponse.get('etag') ?? '',
            ),
            `GET reports a validator for the read shape (got ${staleResponse.get('etag')})`,
          );
          assert.notStrictEqual(
            staleResponse.get('etag'),
            originalEtag,
            'and it advanced with the write',
          );

          // The PATCH's own validator describes the write echo, which carries
          // no `included[]`, so it must not satisfy a GET — a 304 here would
          // leave the caller holding the narrower body as the card's read
          // representation.
          let echoValidated = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('If-None-Match', patchEtag);
          assert.strictEqual(
            echoValidated.status,
            200,
            'the write echo’s ETag does not short-circuit a GET',
          );

          // The GET's own validator still does.
          let freshEtag = echoValidated.get('etag') ?? '';
          let cachedResponse = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('If-None-Match', freshEtag);
          assert.strictEqual(
            cachedResponse.status,
            304,
            'the ETag a GET returns lets a follow-up GET short-circuit',
          );
        });

        test('no-op PATCH response carries the write-echo validator over the unchanged state', async function (assert) {
          // Prime once so the stored file is in canonical serialized form;
          // the no-op assertions below measure the steady state (see the
          // no-op lastModified test).
          await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                meta: {
                  adoptsFrom: {
                    module: rri('./person'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');
          let initialResponse = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          let initialEtag = initialResponse.get('etag');
          assert.ok(initialEtag, 'initial GET returns an ETag');

          let patchResponse = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                meta: {
                  adoptsFrom: {
                    module: rri('./person'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(patchResponse.status, 200, 'no-op PATCH succeeds');
          // Nothing was rewritten, so `indexed_at` has not moved and the
          // validator is built over the same state the GET described. It is
          // still a different validator, because a no-op PATCH answers with
          // the write-echo shape like any other write — which is what keeps a
          // caller from treating the echo as the card's read representation.
          assert.strictEqual(
            patchResponse.get('etag'),
            (initialEtag ?? '').replace(
              /:card-srcver-lb\d+"$/,
              ':card-srcver-write-echo"',
            ),
            'no-op PATCH validates the unchanged state under the write-echo shape',
          );
          assert.notStrictEqual(
            patchResponse.get('etag'),
            initialEtag,
            'and so does not collide with the validator a GET returns',
          );
        });

        test('patches card when index entry is an error', async function (assert) {
          let cardURL = `${testRealmHref}person-1`;
          let errorDoc = {
            message: 'render failed',
            status: 500,
            additionalErrors: null,
          };

          for (let table of ['boxel_index', 'boxel_index_working']) {
            await dbAdapter.execute(
              `UPDATE ${table}
               SET has_error = TRUE, error_doc = $1::jsonb
               WHERE url = $2`,
              {
                bind: [JSON.stringify(errorDoc), cardURL],
              },
            );
          }

          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Recovered',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.body.data.attributes?.firstName,
            'Recovered',
            'patched response uses last known good doc',
          );

          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'person-1.json',
          );
          let card = readJSONSync(cardFile);
          assert.strictEqual(
            card.data.attributes?.firstName,
            'Recovered',
            'card file updated from error state',
          );
          assert.strictEqual(
            card.data.relationships?.['cardInfo.theme'],
            undefined,
            'the unset, non-searchable base-card link is not persisted (not in a searchable path and never set)',
          );
        });

        test('a patch that changes nothing rewrites a card the index has never seen', async function (assert) {
          // The short circuit that leaves an unchanged card alone needs the
          // index to hold a document for the card. A card written straight to
          // disk has no row at all, so there is nothing to answer from and the
          // patch rewrites it in canonical serialized form instead — which is
          // what gets it indexed. A client reaches this state by writing a
          // card's source and patching it before the write's indexing lands.
          let realmDir = join(dir.name, 'realm_server_1', 'test');
          let cardFile = join(realmDir, 'unindexed-patch-target.json');
          writeFileSync(
            cardFile,
            JSON.stringify({
              data: {
                type: 'card',
                attributes: { firstName: 'Pending' },
                meta: {
                  adoptsFrom: { module: './person.gts', name: 'Person' },
                },
              },
            }),
          );

          let response = await request
            .patch('/unindexed-patch-target')
            .send({
              data: {
                type: 'card',
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          assert.strictEqual(
            response.body.data.attributes?.firstName,
            'Pending',
            'the card is served back with what the file holds',
          );
          assert.strictEqual(
            readJSONSync(cardFile).data.meta.adoptsFrom.module,
            './person',
            'the card was rewritten in canonical form, which indexes it',
          );
        });

        test('patches card when index entry is an error without pristine doc', async function (assert) {
          let cardURL = `${testRealmHref}person-1`;
          let errorDoc = {
            message: 'render failed',
            status: 500,
            additionalErrors: null,
          };

          for (let table of ['boxel_index', 'boxel_index_working']) {
            await dbAdapter.execute(
              `UPDATE ${table}
               SET has_error = TRUE, error_doc = $1::jsonb, pristine_doc = NULL
               WHERE url = $2`,
              {
                bind: [JSON.stringify(errorDoc), cardURL],
              },
            );
          }

          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Fresh Start',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.body.data.attributes?.firstName,
            'Fresh Start',
            'patched response uses empty base when pristine doc missing',
          );

          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'person-1.json',
          );
          let card = readJSONSync(cardFile);
          assert.strictEqual(
            card.data.attributes?.firstName,
            'Fresh Start',
            'card file updated even without pristine doc',
          );
          assert.deepEqual(card.data.meta.adoptsFrom, {
            module: rri('./person'),
            name: 'Person',
          });
          assert.strictEqual(card.data.type, 'card');
        });

        test('creates card instances when it encounters "lid" in the request', async function (assert) {
          let response = await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Paper',
                },
                relationships: {
                  friend: {
                    data: {
                      lid: 'local-id-1',
                      type: 'card',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./friend'),
                    name: 'Friend',
                  },
                },
              },
              included: [
                {
                  lid: 'local-id-1',
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  relationships: {
                    'friends.0': {
                      data: {
                        lid: 'local-id-2',
                        type: 'card',
                      },
                    },
                    'friends.1': {
                      data: {
                        lid: 'local-id-3',
                        type: 'card',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./friend'),
                      name: 'Friend',
                    },
                  },
                },
                {
                  lid: 'local-id-2',
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./friend'),
                      name: 'Friend',
                    },
                  },
                },
                {
                  lid: 'local-id-3',
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./friend'),
                      name: 'Friend',
                    },
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );

          let json = response.body;
          assert.ok(json.data.meta.lastModified, 'lastModified exists');

          assert.true(
            isSingleCardDocument(json),
            'response body is a card document',
          );

          assert.strictEqual(
            json.data.attributes?.firstName,
            'Paper',
            'the field data is correct',
          );
          assert.ok(json.data.meta.lastModified, 'lastModified is populated');
          delete json.data.meta.lastModified;
          delete json.data.meta.resourceCreatedAt;
          delete json.data.meta.generation;
          delete json.data.meta.version;
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'hassan.json',
            );
            assert.ok(existsSync(cardFile), 'card json exists');
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Paper',
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: './Friend/local-id-1',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri(`./friend`),
                      name: 'Friend',
                    },
                  },
                },
              },
              'file contents are correct',
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-1.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  relationships: {
                    'friends.0': {
                      links: {
                        self: './local-id-2',
                      },
                    },
                    'friends.1': {
                      links: {
                        self: './local-id-3',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('../friend'),
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-2.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('../friend'),
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-3.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('../friend'),
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let response = await request
              .get(`/hassan`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}hassan`,
              type: 'card',
              attributes: {
                firstName: 'Paper',
                cardInfo,
                cardTitle: 'Paper',
                cardDescription: null,
                cardThumbnailURL: null,
              },
              relationships: {
                friend: {
                  links: {
                    self: './Friend/local-id-1',
                  },
                  data: {
                    type: 'card',
                    id: `${testRealmHref}Friend/local-id-1`,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'Friend',
                  module: rri('./friend'),
                },
                realmInfo: testRealmInfo,
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}hassan`,
              },
            });

            for (let resource of json.included!) {
              delete resource.meta.realmURL;
              delete resource.meta.realmInfo;
              delete resource.meta.lastModified;
              delete resource.meta.resourceCreatedAt;
              delete resource.links;
            }
            assert.deepEqual(
              json.included,
              [
                {
                  id: `${testRealmHref}Friend/local-id-1`,
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                    cardTitle: 'Jade',
                    cardInfo,
                    cardDescription: null,
                    cardThumbnailURL: null,
                  },
                  relationships: {
                    'friends.0': {
                      links: {
                        self: './local-id-2',
                      },
                      data: {
                        id: `${testRealmHref}Friend/local-id-2`,
                        type: 'card',
                      },
                    },
                    'friends.1': {
                      links: {
                        self: './local-id-3',
                      },
                      data: {
                        id: `${testRealmHref}Friend/local-id-3`,
                        type: 'card',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('../friend'),
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-2`,
                  type: 'card',
                  attributes: {
                    cardInfo,
                    firstName: 'Germaine',
                    cardTitle: 'Germaine',
                    cardDescription: null,
                    cardThumbnailURL: null,
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('../friend'),
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-3`,
                  type: 'card',
                  attributes: {
                    cardInfo,
                    firstName: 'Boris',
                    cardTitle: 'Boris',
                    cardDescription: null,
                    cardThumbnailURL: null,
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('../friend'),
                      name: 'Friend',
                    },
                  },
                },
              ],
              'included is correct',
            );
          }
          {
            let response = await request
              .get(`/Friend/local-id-1`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}Friend/local-id-1`,
              type: 'card',
              attributes: {
                firstName: 'Jade',
                cardTitle: 'Jade',
                cardDescription: null,
                cardThumbnailURL: null,
                cardInfo,
              },
              relationships: {
                'friends.0': {
                  links: {
                    self: './local-id-2',
                  },
                  data: {
                    id: `${testRealmHref}Friend/local-id-2`,
                    type: 'card',
                  },
                },
                'friends.1': {
                  links: {
                    self: './local-id-3',
                  },
                  data: {
                    id: `${testRealmHref}Friend/local-id-3`,
                    type: 'card',
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'Friend',
                  module: rri('../friend'),
                },
                realmInfo: testRealmInfo,
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}Friend/local-id-1`,
              },
            });

            for (let resource of json.included!) {
              delete resource.meta.realmURL;
              delete resource.meta.realmInfo;
              delete resource.meta.lastModified;
              delete resource.meta.resourceCreatedAt;
              delete resource.links;
            }
            assert.deepEqual(
              json.included,
              [
                {
                  id: `${testRealmHref}Friend/local-id-2`,
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                    cardTitle: 'Germaine',
                    cardDescription: null,
                    cardThumbnailURL: null,
                    cardInfo,
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('../friend'),
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-3`,
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                    cardTitle: 'Boris',
                    cardDescription: null,
                    cardThumbnailURL: null,
                    cardInfo,
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('../friend'),
                      name: 'Friend',
                    },
                  },
                },
              ],
              'included is correct',
            );
          }
          {
            let response = await request
              .get(`/Friend/local-id-2`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json, {
              data: {
                id: `${testRealmHref}Friend/local-id-2`,
                type: 'card',
                attributes: {
                  firstName: 'Germaine',
                  cardTitle: 'Germaine',
                  cardDescription: null,
                  cardThumbnailURL: null,
                  cardInfo,
                },
                meta: {
                  adoptsFrom: {
                    name: 'Friend',
                    module: rri('../friend'),
                  },
                  realmInfo: testRealmInfo,
                  realmURL: testRealmHref,
                },
                links: {
                  self: `${testRealmHref}Friend/local-id-2`,
                },
              },
            });
          }
          {
            let response = await request
              .get(`/Friend/local-id-3`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json, {
              data: {
                id: `${testRealmHref}Friend/local-id-3`,
                type: 'card',
                attributes: {
                  firstName: 'Boris',
                  cardTitle: 'Boris',
                  cardDescription: null,
                  cardThumbnailURL: null,
                  cardInfo,
                },
                meta: {
                  adoptsFrom: {
                    name: 'Friend',
                    module: rri('../friend'),
                  },
                  realmInfo: testRealmInfo,
                  realmURL: testRealmHref,
                },
                links: {
                  self: `${testRealmHref}Friend/local-id-3`,
                },
              },
            });
          }
        });

        test('creates card instances when it encounters "lid" in the request for requests that have linksTo relationships', async function (assert) {
          let response = await request
            .patch('/hassan-x')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Paper',
                },
                relationships: {
                  friend: {
                    data: {
                      lid: 'local-id-1',
                      type: 'card',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri(
                      'https://localhost:4202/node-test/friend-with-used-link',
                    ),
                    name: 'FriendWithUsedLink',
                  },
                },
              },
              included: [
                {
                  lid: 'local-id-1',
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri(
                        'https://localhost:4202/node-test/friend-with-used-link',
                      ),
                      name: 'FriendWithUsedLink',
                    },
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );

          let json = response.body;
          assert.ok(json.data.meta.lastModified, 'lastModified exists');

          assert.true(
            isSingleCardDocument(json),
            'response body is a card document',
          );

          assert.strictEqual(
            json.data.attributes?.firstName,
            'Paper',
            'the field data is correct',
          );
          assert.ok(json.data.meta.lastModified, 'lastModified is populated');
          delete json.data.meta.lastModified;
          delete json.data.meta.resourceCreatedAt;
          delete json.data.meta.generation;
          delete json.data.meta.version;
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'hassan-x.json',
            );
            assert.ok(existsSync(cardFile), 'card json exists');
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Paper',
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: './FriendWithUsedLink/local-id-1',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri(
                        'https://localhost:4202/node-test/friend-with-used-link',
                      ),
                      name: 'FriendWithUsedLink',
                    },
                  },
                },
              },
              'file contents are correct',
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'FriendWithUsedLink',
              `local-id-1.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri(
                        'https://localhost:4202/node-test/friend-with-used-link',
                      ),
                      name: 'FriendWithUsedLink',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let response = await request
              .get(`/hassan-x`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}hassan-x`,
              type: 'card',
              attributes: {
                firstName: 'Paper',
                cardTitle: 'Paper',
                cardDescription: null,
                cardThumbnailURL: null,
                cardInfo,
              },
              relationships: {
                friend: {
                  links: {
                    self: './FriendWithUsedLink/local-id-1',
                  },
                  data: {
                    type: 'card',
                    id: `${testRealmHref}FriendWithUsedLink/local-id-1`,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'FriendWithUsedLink',
                  module: rri(
                    'https://localhost:4202/node-test/friend-with-used-link',
                  ),
                },
                realmInfo: testRealmInfo,
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}hassan-x`,
              },
            });

            for (let resource of json.included!) {
              delete resource.meta.realmURL;
              delete resource.meta.realmInfo;
              delete resource.meta.lastModified;
              delete resource.meta.resourceCreatedAt;
              delete resource.links;
            }
            assert.deepEqual(
              json.included,
              [
                {
                  id: `${testRealmHref}FriendWithUsedLink/local-id-1`,
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                    cardTitle: 'Jade',
                    cardDescription: null,
                    cardThumbnailURL: null,
                    cardInfo,
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri(
                        'https://localhost:4202/node-test/friend-with-used-link',
                      ),
                      name: 'FriendWithUsedLink',
                    },
                  },
                },
              ],
              'included is correct',
            );
          }
          {
            let response = await request
              .get(`/FriendWithUsedLink/local-id-1`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            delete json.data.meta.generation;
            delete json.data.meta.version;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}FriendWithUsedLink/local-id-1`,
              type: 'card',
              attributes: {
                firstName: 'Jade',
                cardTitle: 'Jade',
                cardDescription: null,
                cardThumbnailURL: null,
                cardInfo,
              },
              meta: {
                adoptsFrom: {
                  name: 'FriendWithUsedLink',
                  module: rri(
                    'https://localhost:4202/node-test/friend-with-used-link',
                  ),
                },
                realmInfo: testRealmInfo,
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}FriendWithUsedLink/local-id-1`,
              },
            });
          }
        });

        test('ignores "lid" for other realms', async function (assert) {
          let response = await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Paper',
                },
                relationships: {
                  friend: {
                    data: {
                      lid: 'local-id-3',
                      type: 'card',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./friend.gts'),
                    name: 'Friend',
                  },
                },
              },
              included: [
                {
                  lid: 'local-id-3',
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://localhost:4202/node-test/friend'),
                      name: 'Friend',
                    },
                    realmURL: ri(`http://some-other-realm/`),
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'hassan.json',
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Paper',
                  },
                  relationships: {
                    friend: {
                      links: { self: './jade' },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./friend'),
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-3.json`,
            );
            assert.false(
              existsSync(cardFile),
              `card json ${cardFile} does not exist`,
            );
          }
        });

        test("the incremental index event echoes the write's X-Boxel-Client-Request-Id", async function (assert) {
          let realmEventTimestampStart = Date.now();

          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Van Gogh',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json')
            .set('X-Boxel-Client-Request-Id', 'patch-client-request-id');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');

          await expectIncrementalIndexEvent(
            `${testRealmHref}person-1.json`,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
              clientRequestId: 'patch-client-request-id',
              versions: 'written',
            },
          );
        });

        // Three readings of one fact, taken from three places that derive it
        // independently: the response's `meta.version`, the index event's
        // `versions` entry for the card, and a hash of the bytes now on disk.
        // Comparing the two reported values against the file rather than
        // against each other is what makes this catch a reporting path that
        // answers confidently with the wrong card's hash.
        // Run against `person-1`, which nothing links to, so the pass
        // invalidates exactly the card the request wrote. A card with a
        // dependent is the subject of the next test instead, because this
        // helper compares the whole invalidation list.
        test('a patch reports the stored bytes’ version on its response and on the index event', async function (assert) {
          let realmEventTimestampStart = Date.now();

          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Mango the Second' },
                meta: {
                  adoptsFrom: { module: rri('./person.gts'), name: 'Person' },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );

          let storedHash = computeContentHash(
            readFileSync(
              join(dir.name, 'realm_server_1', 'test', 'person-1.json'),
              'utf8',
            ),
          );
          assert.strictEqual(
            response.body.data.meta.version,
            storedHash,
            'the patch response reports the hash of the bytes it stored',
          );

          await expectIncrementalIndexEvent(
            `${testRealmHref}person-1.json`,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
              clientRequestId: null,
              versions: { [`${testRealmHref}person-1`]: storedHash },
            },
          );

          // The write channel and the read channel have to agree, or a client
          // cannot chain one onto the other: operation 1 takes its base from a
          // read and operation 2 from the version the write returned, and both
          // describe the same file. Read after the event above, so the index
          // pass the write waited on has landed and the row the GET assembles
          // from is the one this write produced.
          let read = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(read.status, 200, `HTTP 200 status: ${read.text}`);
          assert.strictEqual(
            read.body.data.meta.version,
            storedHash,
            'a read after the write reports the version the write stored',
          );
        });

        // `jade` links to `hassan`, so patching `hassan` re-indexes `jade` in
        // the same pass. The realm computed `jade`'s new state, so nobody holds
        // it and every client wants to re-read it — which is precisely the
        // difference `versions` exists to draw, and why it names the files the
        // request wrote rather than everything the pass touched.
        test('a dependent re-indexed by the same pass is invalidated without a version', async function (assert) {
          let realmEventTimestampStart = Date.now();

          let response = await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Hassan Renamed' },
                meta: {
                  adoptsFrom: { module: rri('./friend.gts'), name: 'Friend' },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );

          await waitForIncrementalIndexEvent(
            getMessagesSince,
            realmEventTimestampStart,
          );
          let messages = await getMessagesSince(realmEventTimestampStart);
          let content = findRealmEvent(messages, 'index', 'incremental')
            ?.content as IncrementalIndexEventContent;

          assert.true(
            content.invalidations.includes(`${testRealmHref}jade`),
            `the pass invalidated the dependent: ${JSON.stringify(
              content.invalidations,
            )}`,
          );
          assert.deepEqual(
            Object.keys(content.versions ?? {}),
            [`${testRealmHref}hassan`],
            'only the card the request wrote has a version',
          );
        });

        // A client is served `version` on every write, so the next write it
        // sends can carry it back. Two things must not happen when it does: the
        // key must not reach the stored file, and — because the merge is what
        // decides whether a patch changed anything — it must not turn a save
        // that changes nothing into a rewrite.
        //
        // Run against `person-2`, which nothing else in this file touches, so
        // its stored bytes are still the hand-authored fixture. That matters
        // for the test to be able to fail at all: the fixture spells its type
        // `./person.gts`, and a write that re-serializes the card stores the
        // trimmed `./person`. So the two arms of the merge's unchanged check
        // produce visibly different files here — the verbatim arm leaves the
        // fixture's bytes, the re-serializing arm canonicalizes them and moves
        // the modification time. Against a card some earlier write already
        // canonicalized, both arms produce identical bytes and the commit
        // leaves the file alone either way, which is green whether or not the
        // strip ran.
        test('a patch that echoes back the served version changes nothing', async function (assert) {
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'person-2.json',
          );
          let before = readFileSync(cardFile, 'utf8');
          let modifiedBefore = statSync(cardFile).mtimeMs;
          // Taken from a read rather than from a warm-up write, so this is the
          // value a client that has only looked at the card would echo, and no
          // write has run before the one under test. A GET is what makes the
          // round trip real: the strip has to hold for the value the server
          // actually serves, not only for one the test computed for itself.
          let read = await request
            .get('/person-2')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(read.status, 200, `HTTP 200 status: ${read.text}`);
          let version = read.body.data.meta.version;
          // Without this the echo below would carry `version: undefined`, which
          // serializes away — leaving a patch that strips nothing and a test
          // that passes for the wrong reason.
          assert.strictEqual(
            version,
            computeContentHash(before),
            'the read reports the version of the bytes on disk',
          );

          let response = await request
            .patch('/person-2')
            .send({
              data: {
                type: 'card',
                // Exactly what the fixture stores, so the merge is a semantic
                // no-op and the only thing that can move the comparison is the
                // echoed `version`.
                attributes: { firstName: 'Jackie' },
                meta: {
                  adoptsFrom: { module: rri('./person.gts'), name: 'Person' },
                  version,
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );

          assert.strictEqual(
            readFileSync(cardFile, 'utf8'),
            before,
            'the stored bytes are untouched, so no version was persisted into them',
          );
          assert.strictEqual(
            statSync(cardFile).mtimeMs,
            modifiedBefore,
            'the file was not rewritten, so the echoed version did not read as a change',
          );
          assert.strictEqual(
            response.body.data.meta.version,
            version,
            'the response reports the version the file still holds',
          );
        });

        test('a 200 answers as card+json and varies on Accept', async function (assert) {
          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Van Gogh',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('content-type'),
            'application/vnd.card+json',
            'the 200 is typed as card+json',
          );
          assert.strictEqual(
            response.get('vary'),
            'Accept',
            'the response varies on Accept',
          );
        });

        test('the 200 reports the patched card as the index holds it', async function (assert) {
          // The same settled-state contract the create answers on: the patched
          // card is read back out of the index, so its computed fields are
          // resolved over the values this request just wrote rather than over
          // whatever the index held before it.
          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: { firstName: 'Van Gogh' },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          assert.strictEqual(
            response.body.data.attributes?.cardTitle,
            'Van Gogh',
            'the 200 carries the computed field recomputed over the patch',
          );
        });

        test('a no-op patch answers as card+json too', async function (assert) {
          // A patch that changes nothing skips the file rewrite, and it still
          // answers on the same wire contract as one that writes.
          let patchBody = {
            data: {
              type: 'card',
              meta: {
                adoptsFrom: {
                  module: rri('./person'),
                  name: 'Person',
                },
              },
            },
          };
          // The first patch of a hand-authored fixture may rewrite it into
          // canonical serialized form; the second is the genuine no-op.
          await request
            .patch('/person-1')
            .send(patchBody)
            .set('Accept', 'application/vnd.card+json');

          let response = await request
            .patch('/person-1')
            .send(patchBody)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('content-type'),
            'application/vnd.card+json',
            'the no-op 200 is typed as card+json',
          );
          assert.strictEqual(
            response.get('vary'),
            'Accept',
            'the no-op response varies on Accept',
          );
        });

        test('a no-op patch that defers its indexing still answers from the index', async function (assert) {
          // Deferring indexing decides what happens after a write, and a
          // patch that changes nothing makes no write to defer. So this
          // request is answered the way every other unchanged patch is —
          // from the card as the index holds it, computed fields and all —
          // rather than from the bytes on disk, which carry neither.
          let patchBody = {
            data: {
              type: 'card',
              meta: {
                adoptsFrom: {
                  module: rri('./person'),
                  name: 'Person',
                },
              },
            },
          };
          // The first patch of a hand-authored fixture rewrites it into
          // canonical serialized form; the second is the genuine no-op.
          await request
            .patch('/person-1')
            .send(patchBody)
            .set('Accept', 'application/vnd.card+json');

          let response = await request
            .patch('/person-1')
            .send(patchBody)
            .set('Accept', 'application/vnd.card+json')
            .set(SKIP_INDEX_WAIT_HEADER, 'true');

          assert.strictEqual(
            response.status,
            200,
            `HTTP 200 status: ${response.text}`,
          );
          assert.strictEqual(
            response.body.data.attributes?.cardTitle,
            'Mango',
            'the computed field only the indexed document carries is present',
          );
          assert.ok(
            response.get('etag'),
            'the response carries the validator an indexed answer has',
          );
        });

        test('a PATCH of the .json form of a card URL does not patch the card', async function (assert) {
          // The patch route excludes the `.json` form, so the canonical
          // no-extension URL is the only one that patches a card. The request
          // lands on the module/file fallback instead, which finds the stored
          // instance file and serves it back verbatim.
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'person-1.json',
          );
          let before = readJSONSync(cardFile);

          let response = await request
            .patch('/person-1.json')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Van Gogh',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('content-type'),
            'application/json',
            'the fallback types the response as the stored file, not card+json',
          );
          assert.deepEqual(
            readJSONSync(cardFile),
            before,
            'the stored card is untouched',
          );

          let getResponse = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(
            getResponse.body.data.attributes?.firstName,
            'Mango',
            'the served card still carries its pre-request value',
          );
        });

        test('a read issued straight after a deferred write serves the written state', async function (assert) {
          // A read drains the requester's own in-flight incremental indexing
          // before consulting the index, so a client never has to poll for its
          // own write to become visible.
          //
          // Two things this has to set up, or it passes whether or not the
          // drain exists. The write must defer its indexing —
          // `X-Boxel-Skip-Index-Wait` returns once the bytes are durable,
          // where the default path waits for the index and leaves nothing in
          // flight to drain. And both requests must carry the same identity:
          // the gate waits on indexing *that requester initiated*, so an
          // anonymous read is excused from waiting and a different user's read
          // finds nothing of its own pending.
          let jwt = createJWT(testRealm, 'john', ['read', 'write']);
          let patchResponse = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Van Gogh',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${jwt}`)
            .set('X-Boxel-Skip-Index-Wait', 'true');
          assert.strictEqual(patchResponse.status, 200, 'the PATCH succeeds');

          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${jwt}`);

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.body.data.attributes?.firstName,
            'Van Gogh',
            'the read serves the state the write just produced',
          );
        });
        test('broadcasts realm events', async function (assert) {
          let realmEventTimestampStart = Date.now();

          await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Van Gogh',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          await expectIncrementalIndexEvent(
            `${testRealmHref}person-1.json`,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
              clientRequestId: null,
              versions: 'written',
            },
          );
        });
      });

      module('public writable realm with size limit', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            '*': ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          cardSizeLimitBytes: 512,
          onRealmSetup,
        });

        test('returns 413 when card payload exceeds size limit', async function (assert) {
          let oversized = 'a'.repeat(2048);
          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: oversized,
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 413, 'HTTP 413 status');
          assert.strictEqual(
            response.body.errors[0].title,
            'Payload Too Large',
            'error title is correct',
          );
          assert.strictEqual(
            response.body.errors[0].status,
            413,
            'error status is correct',
          );
          assert.ok(
            response.body.errors[0].message.includes('Card size'),
            'error message mentions card size',
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            john: ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .patch('/person-1')
            .send({})
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Van Gogh',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Van Gogh',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person.gts'),
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
        });
      });

      module(
        'compound fields backed by an unexported FieldDef',
        function (hooks) {
          setupPermissionedRealmCached(hooks, {
            realmURL,
            permissions: {
              '*': ['read', 'write'],
              '@node-test_realm:localhost': ['read', 'realm-owner'],
            },
            fileSystem: {
              'log.gts': `
              import {
                contains,
                containsMany,
                field,
                linksTo,
                linksToMany,
                CardDef,
                FieldDef,
              } from "@cardstack/base/card-api";
              import StringField from "@cardstack/base/string";
              import DatetimeField from "@cardstack/base/datetime";

              class Entry extends FieldDef {
                @field kind = contains(StringField);
                @field at = contains(DatetimeField);
                @field headline = contains(StringField);
                @field author = linksTo(() => Author);
                @field coauthors = linksToMany(() => Author);
              }

              export class Author extends CardDef {
                @field name = contains(StringField);
              }

              export class Log extends CardDef {
                @field logTitle = contains(StringField);
                @field entries = containsMany(Entry);
                @field latest = contains(Entry);
                @field owner = linksTo(() => Author);
              }
            `,
              'author-1.json': {
                data: {
                  attributes: {
                    name: 'Probe Author',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./log'),
                      name: 'Author',
                    },
                  },
                },
              },
              'log-1.json': {
                data: {
                  attributes: {
                    logTitle: 'Probe',
                    entries: [
                      {
                        kind: 'phase',
                        at: '2026-07-17T02:45:29.259Z',
                        headline: 'probe entry',
                      },
                    ],
                    latest: {
                      kind: 'wrap-up',
                      at: '2026-07-17T03:00:00.000Z',
                      headline: 'latest entry',
                    },
                  },
                  relationships: {
                    // `owner` resolves through the exported Log definition;
                    // `entries.0.author` paths through the unexported Entry.
                    // Having both ensures the serializer's relationship pass
                    // produces a non-empty result, so a dropped nested
                    // relationship can't hide behind the whole original
                    // relationships object being carried over unprocessed.
                    owner: {
                      links: {
                        self: './author-1',
                      },
                    },
                    'entries.0.author': {
                      links: {
                        self: './author-1',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./log'),
                      name: 'Log',
                    },
                  },
                },
              },
            },
            onRealmSetup,
          });

          test('PATCH preserves compound field values on disk', async function (assert) {
            let response = await request
              .patch('/log-1')
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    logTitle: 'Probe (edited)',
                    entries: [
                      {
                        kind: 'phase',
                        at: '2026-07-17T02:45:29.259Z',
                        headline: 'probe entry',
                      },
                    ],
                    latest: {
                      kind: 'wrap-up',
                      at: '2026-07-17T03:00:00.000Z',
                      headline: 'latest entry',
                    },
                  },
                  relationships: {
                    // JSON:API to-many `data: [...]` form nested under
                    // the unexported compound field; must survive as
                    // indexed `.N` link keys on disk.
                    'entries.0.coauthors': {
                      data: [{ id: './author-1', type: 'card' }],
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./log'),
                      name: 'Log',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');

            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'log-1.json',
            );
            assert.ok(existsSync(cardFile), 'card json exists on disk');
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card.data.attributes?.entries,
              [
                {
                  kind: 'phase',
                  at: '2026-07-17T02:45:29.259Z',
                  headline: 'probe entry',
                },
              ],
              'containsMany compound entries persisted to disk',
            );
            assert.deepEqual(
              card.data.attributes?.latest,
              {
                kind: 'wrap-up',
                at: '2026-07-17T03:00:00.000Z',
                headline: 'latest entry',
              },
              'contains compound value persisted to disk',
            );
            assert.deepEqual(
              card.data.relationships?.['entries.0.author'],
              {
                links: {
                  self: './author-1',
                },
              },
              'relationship nested in compound entry persisted to disk',
            );
            assert.deepEqual(
              card.data.relationships?.['entries.0.coauthors.0'],
              {
                links: {
                  self: './author-1',
                },
              },
              'to-many data form nested in compound entry persisted as indexed link keys',
            );
            assert.deepEqual(
              card.data.relationships?.owner,
              {
                links: {
                  self: './author-1',
                },
              },
              'relationship on the card itself persisted to disk',
            );
            assert.strictEqual(
              card.data.attributes?.logTitle,
              'Probe (edited)',
              'patched top-level attribute persisted to disk',
            );
          });

          test('PATCH merges against the stored file even when the index lags it', async function (assert) {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'log-1.json',
            );
            // Edit the stored file directly — no realm write, no file
            // watcher in this fixture — so the index still reflects the
            // original content. A PATCH of an unrelated field must keep
            // this edit: the merge base is the stored file, and using the
            // (lagging) index instead would silently revert it.
            let onDisk = readJSONSync(cardFile);
            onDisk.data.attributes.cardInfo = { notes: 'edited on disk' };
            writeFileSync(cardFile, JSON.stringify(onDisk, null, 2));

            let response = await request
              .patch('/log-1')
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    logTitle: 'Patched after disk edit',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./log'),
                      name: 'Log',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');

            let card = readJSONSync(cardFile);
            assert.strictEqual(
              card.data.attributes?.logTitle,
              'Patched after disk edit',
              'patched attribute persisted to disk',
            );
            assert.strictEqual(
              card.data.attributes?.cardInfo?.notes,
              'edited on disk',
              'file-only change survives a PATCH of an unrelated field',
            );
            assert.deepEqual(
              card.data.attributes?.entries,
              [
                {
                  kind: 'phase',
                  at: '2026-07-17T02:45:29.259Z',
                  headline: 'probe entry',
                },
              ],
              'compound entries survive a PATCH of an unrelated field',
            );
          });

          test('PATCH against a corrupt stored file fails without overwriting it', async function (assert) {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'log-1.json',
            );
            let corruptContent = 'not a card document {';
            writeFileSync(cardFile, corruptContent);

            let response = await request
              .patch('/log-1')
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    logTitle: 'Should not land',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./log'),
                      name: 'Log',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 500, 'HTTP 500 status');
            assert.strictEqual(
              readFileSync(cardFile, 'utf8'),
              corruptContent,
              'the stored file is left untouched',
            );
          });
        },
      );
    });

    module('card DELETE request', function (_hooks) {
      module('public writable realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            '*': ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

        test('serves the request', async function (assert) {
          let entry = 'person-1.json';

          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let cardFile = join(dir.name, entry);
          assert.false(existsSync(cardFile), 'card json does not exist');
        });

        test('broadcasts realm events', async function (assert) {
          let realmEventTimestampStart = Date.now();

          await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json');

          await expectIncrementalIndexEvent(
            `${testRealmHref}person-1.json`,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
              clientRequestId: ABSENT_OR_NULL_CLIENT_REQUEST_ID,
              versions: 'absent',
            },
          );
        });

        test('the incremental index event carries no client request id, even when the request sends one', async function (assert) {
          // Delete never reads `X-Boxel-Client-Request-Id`, so a client cannot
          // recognize its own delete event the way it recognizes its own
          // create or update.
          let realmEventTimestampStart = Date.now();

          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('X-Boxel-Client-Request-Id', 'delete-client-request-id');

          assert.strictEqual(response.status, 204, 'HTTP 204 status');

          await expectIncrementalIndexEvent(
            `${testRealmHref}person-1.json`,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
              clientRequestId: ABSENT_OR_NULL_CLIENT_REQUEST_ID,
              versions: 'absent',
            },
          );
        });

        test('a 204 answers with no content type and varies on Accept', async function (assert) {
          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
          assert.strictEqual(
            response.get('content-type'),
            undefined,
            'the 204 carries no content type',
          );
          assert.strictEqual(
            response.get('vary'),
            'Accept',
            'the response varies on Accept',
          );
        });

        test('serves a card DELETE request with .json extension in the url', async function (assert) {
          let entry = 'person-1.json';

          let response = await request
            .delete('/person-1.json')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let cardFile = join(dir.name, entry);
          assert.false(existsSync(cardFile), 'card json does not exist');
        });

        test('removes card JSON file meta when card is deleted', async function (assert) {
          // confirm meta.resourceCreatedAt exists prior to deletion
          let initial = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(initial.status, 200, 'precondition GET 200');
          let initialCreatedAt = initial.body?.data?.meta?.resourceCreatedAt;
          assert.ok(initialCreatedAt, 'resourceCreatedAt exists before delete');

          // delete the card
          let delResp = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(delResp.status, 204, 'delete succeeds with 204');

          // subsequent GET should not expose resourceCreatedAt (file meta removed)
          let after = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          // Depending on implementation could be 404 Not Found; just assert it's not 200
          assert.notStrictEqual(
            after.status,
            200,
            'GET after delete is not 200',
          );
          let afterCreatedAt = after.body?.data?.meta?.resourceCreatedAt;
          assert.strictEqual(
            afterCreatedAt,
            undefined,
            'resourceCreatedAt is absent after deletion',
          );
          assert.false(
            JSON.stringify(after.body).includes('resourceCreatedAt'),
            'No resourceCreatedAt key present anywhere in error payload',
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            john: ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .delete('/person-1')

            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('204 with permission', async function (assert) {
          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            );

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
        });
      });
    });

    // `HEAD` is how a client discovers which realm serves a URL. A discovery
    // probe reads `X-Boxel-Realm-Url` and `X-Boxel-Realm-Public-Readable` off
    // the response and looks at nothing else — not the body, not the status —
    // so what it rests on is that every response the realm builds carries
    // those headers, for any path and without the caller proving it may read
    // anything.
    module('card HEAD request', function (_hooks) {
      module('public readable realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            '*': ['read'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('a probe that sends no Accept names the realm whatever the path', async function (assert) {
          // What the realm-discovery callers send: no `Accept` of their own,
          // which matches no route, so the request lands on the module/file
          // fallback and the realm identity comes off whatever that answers.
          for (let path of [
            '/person-1',
            '/no-such-card',
            '/some/nested/path',
          ]) {
            let response = await request.head(path);

            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              `the response for ${path} names the realm serving the URL`,
            );
            assert.strictEqual(
              response.get('X-boxel-realm-public-readable'),
              'true',
              `the response for ${path} reports the realm as public readable`,
            );
          }
        });

        test('an Accept the realm has no read route for answers 200 whatever the path', async function (assert) {
          for (let path of [
            '/person-1',
            '/no-such-card',
            '/',
            '/some/nested/path',
          ]) {
            let response = await request
              .head(path)
              .set('Accept', 'application/vnd.api+json');

            assert.strictEqual(response.status, 200, `HTTP 200 for ${path}`);
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              `the response for ${path} names the realm serving the URL`,
            );
            assert.strictEqual(
              response.get('X-boxel-realm-public-readable'),
              'true',
              `the response for ${path} reports the realm as public readable`,
            );
          }
        });

        test('answers 200 with the realm-identity headers for a card that exists', async function (assert) {
          let response = await request
            .head('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'the response names the realm serving the URL',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'the response reports the realm as public readable',
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            john: ['read'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('answers 200 without a JWT, and reports the realm as not public readable', async function (assert) {
          let response = await request
            .head('/person-1')
            .set('Accept', 'application/vnd.card+json'); // no Authorization header

          assert.strictEqual(
            response.status,
            200,
            'discovery does not require authentication',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'the response names the realm serving the URL',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'the realm is not public readable',
          );
        });
      });
    });
    module('file URLs', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        fileSystem: {
          'greeting.txt': 'hello',
        },
        onRealmSetup,
      });

      test('GET on a file URL with a card+json Accept returns a file-meta JSON document', async function (assert) {
        let response = await request
          .get('/greeting.txt')
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(
          response.status,
          200,
          'GET serves a file-meta document instead of 415',
        );
        assert.true(
          (response.headers['content-type'] ?? '').startsWith(
            'application/vnd.card+json',
          ),
          'response is JSON, not raw file bytes',
        );
        let doc = JSON.parse(response.text);
        assert.strictEqual(
          doc?.data?.type,
          'file-meta',
          'data.type identifies the resource as file-meta',
        );
        assert.strictEqual(
          doc?.data?.attributes?.name,
          'greeting.txt',
          'attributes.name carries the file name',
        );
      });

      test('rejects write requests to file URLs', async function (assert) {
        let response;
        response = await request
          .patch('/greeting.txt')
          .send({
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: rri('@cardstack/base/card-api'),
                  name: 'CardDef',
                },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(
          response.status,
          415,
          'rejects PATCH to a file URL with 415 status',
        );

        response = await request
          .delete('/greeting.txt')
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(
          response.status,
          415,
          'rejects DELETE to a file URL with 415 status',
        );
      });
    });
  });

  module('cross-realm file links', function (hooks) {
    // A card instantiated from the catalog (e.g. a blackjack game) keeps a
    // linksTo(FileDef) reference to an image file that lives in the catalog
    // realm. When the card is served from a different realm, loadLinks resolves
    // that reference via the cross-realm fetch path. Regression for CS-11344:
    // that path used to assume every cross-realm link target was a card and
    // threw "instance ... is not a card document" on a file-meta target,
    // surfacing as an HTTP 500.
    const providerRealmURL = 'http://127.0.0.1:5531/test/';
    const consumerRealmURL = 'http://127.0.0.1:5532/test/';
    let consumerRequest: RealmRequest;

    setupPermissionedRealmsCached(hooks, {
      realms: [
        {
          realmURL: providerRealmURL,
          permissions: {
            '*': ['read', 'write', 'realm-owner'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          fileSystem: {
            'instructions.md': `---
boxel:
  kind: skill
---
# Cross-realm instructions`,
            'model.gts': `
              import { CardDef, field, contains } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";

              export class Model extends CardDef {
                @field cardTitle = contains(StringField);
              }
            `,
            'model-4.6.json': {
              data: {
                attributes: {
                  cardTitle: 'Model 4.6',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./model'),
                    name: 'Model',
                  },
                },
              },
            },
          },
        },
        {
          realmURL: consumerRealmURL,
          permissions: {
            '*': ['read', 'write', 'realm-owner'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          fileSystem: {
            'skill-card.gts': `
              import { CardDef, field, contains, linksTo } from "@cardstack/base/card-api";
              import StringField from "@cardstack/base/string";
              import { MarkdownDef } from "@cardstack/base/markdown-file-def";

              export class SkillCard extends CardDef {
                @field cardTitle = contains(StringField);
                @field instructionsSource = linksTo(MarkdownDef);
                @field model = linksTo(CardDef);
              }
            `,
            'skill-with-model.json': {
              data: {
                attributes: {
                  cardTitle: 'Skill with dotted model link',
                },
                relationships: {
                  model: {
                    links: {
                      self: `${providerRealmURL}model-4.6`,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./skill-card'),
                    name: 'SkillCard',
                  },
                },
              },
            },
            'skill.json': {
              data: {
                attributes: {
                  cardTitle: 'Cross-realm skill',
                },
                relationships: {
                  instructionsSource: {
                    links: {
                      self: `${providerRealmURL}instructions.md`,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./skill-card'),
                    name: 'SkillCard',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup({ realms }) {
        let latestRealms = realms.slice(-2);
        consumerRequest = withRealmPath(
          supertest(latestRealms[1].realmHttpServer),
          new URL(consumerRealmURL),
        );
      },
    });

    hooks.afterEach(() => {
      resetCatalogRealms();
    });

    test('serves a card linking to a file in another realm', async function (assert) {
      let response = await consumerRequest
        .get('/skill')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(
        response.status,
        200,
        `HTTP 200 status: ${response.text}`,
      );

      let doc = response.body as LooseSingleCardDocument;
      let relationship = doc.data.relationships
        ?.instructionsSource as Relationship;
      assert.deepEqual(
        relationship?.data,
        {
          type: 'file-meta',
          id: `${providerRealmURL}instructions.md`,
        },
        'cross-realm file relationship references the file-meta target',
      );

      let included = doc.included ?? [];
      let linkedFile = included.find(
        (resource) => resource.id === `${providerRealmURL}instructions.md`,
      );
      assert.ok(linkedFile, 'includes the cross-realm file-meta resource');
      assert.strictEqual(
        linkedFile?.type,
        'file-meta',
        'cross-realm linked resource is a file-meta resource',
      );
      assert.strictEqual(linkedFile?.attributes?.name, 'instructions.md');
      // Index-derived attributes must survive the cross-realm hop: a partial
      // file-meta here gets cached by the host, where a markdown skill
      // without `kind: 'skill'` silently stops counting as a skill.
      assert.strictEqual(
        linkedFile?.attributes?.kind,
        'skill',
        'cross-realm file-meta carries index-derived attributes',
      );
    });

    test('serves a card linking to a cross-realm card whose id contains a dot', async function (assert) {
      // Card ids may legitimately contain dots (e.g. a versioned
      // ModelConfiguration). The file-link detection keys on known FileDef
      // extensions, so ".6" must not classify this link as a file.
      let response = await consumerRequest
        .get('/skill-with-model')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(
        response.status,
        200,
        `HTTP 200 status: ${response.text}`,
      );

      let doc = response.body as LooseSingleCardDocument;
      let included = doc.included ?? [];
      let linkedCard = included.find(
        (resource) => resource.id === `${providerRealmURL}model-4.6`,
      );
      assert.ok(linkedCard, 'includes the cross-realm dotted-id card');
      assert.strictEqual(
        linkedCard?.attributes?.cardTitle,
        'Model 4.6',
        'the dotted-id link resolves as a card, not a file',
      );
    });
  });

  module('Query-backed relationships runtime resolver', function (hooks) {
    const providerRealmURL = 'http://127.0.0.1:5521/test/';
    const consumerRealmURL = 'http://127.0.0.1:5522/test/';
    const UNREACHABLE_REALM_URL = 'https://example.invalid/offline/';
    let consumerRequest: RealmRequest;
    let providerRequest: RealmRequest;

    setupPermissionedRealmsCached(hooks, {
      realms: [
        {
          realmURL: providerRealmURL,
          permissions: {
            '*': ['read', 'write', 'realm-owner'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          fileSystem: {
            'person.gts': `
              import { CardDef, field, contains } from "@cardstack/base/card-api";
              import StringField from "@cardstack/base/string";

              export class Person extends CardDef {
                @field name = contains(StringField);
              }
            `,
            'person-remote.json': {
              data: {
                attributes: {
                  name: 'Zed',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person'),
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
        {
          realmURL: consumerRealmURL,
          permissions: {
            '*': ['read', 'write', 'realm-owner'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          fileSystem: {
            'favorite-finder.gts': `
              import { CardDef, field, linksTo, linksToMany } from "@cardstack/base/card-api";
              import { Person } from "${providerRealmURL}person";

              export class FavoriteLookup extends CardDef {
                @field favorite = linksTo(Person, {
                  query: {
                    realm: '$REALM',
                    page: { size: 1 },
                  },
                });
                @field matches = linksToMany(Person, {
                  query: {
                    realm: '${providerRealmURL}',
                    sort: [
                      { by: 'name', direction: 'desc' },
                    ],
                    page: { size: 1 },
                  },
                });
                @field failingMatches = linksToMany(Person, {
                  query: {
                    realm: '${UNREACHABLE_REALM_URL}',
                    page: { size: 1 },
                  },
                });
                @field partiallyFailingMatches = linksToMany(Person, {
                  query: {
                    realms: ['${providerRealmURL}', '${UNREACHABLE_REALM_URL}'],
                  },
                });
              }
            `,
            'favorite.json': {
              data: {
                meta: {
                  adoptsFrom: {
                    module: rri('./favorite-finder'),
                    name: 'FavoriteLookup',
                  },
                },
              },
            },
            'local-person.json': {
              data: {
                attributes: {
                  name: 'Abe',
                },
                meta: {
                  adoptsFrom: {
                    module: rri(`${providerRealmURL}person`),
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup({ realms }) {
        let latestRealms = realms.slice(-2);
        providerRequest = withRealmPath(
          supertest(latestRealms[0].realmHttpServer),
          new URL(providerRealmURL),
        );
        consumerRequest = withRealmPath(
          supertest(latestRealms[1].realmHttpServer),
          new URL(consumerRealmURL),
        );
      },
    });

    hooks.afterEach(() => {
      resetCatalogRealms();
    });

    // A query-backed field finds its targets by running a query when the card
    // is read, and a write to a card that enters or leaves that query
    // deliberately leaves the owner's `deps` and `indexed_at` alone. The
    // response cache keys on a validator built from `indexed_at`, so such a
    // document must never be retained — otherwise the owner would keep
    // serving the pre-write answer until the entry aged out.
    test('a query-backed document is re-resolved on every read rather than served from the cache', async function (assert) {
      let first = await consumerRequest
        .get('/favorite')
        .set('Accept', 'application/vnd.card+json');
      let second = await consumerRequest
        .get('/favorite')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(first.status, 200, `HTTP 200: ${first.text}`);
      assert.strictEqual(second.status, 200, `HTTP 200: ${second.text}`);
      assert.strictEqual(
        second.get('x-boxel-card-cache'),
        'miss',
        'the repeat read runs the query again instead of reading a retained answer',
      );
      assert.strictEqual(
        second.body.data.relationships.matches?.data?.[0]?.id,
        `${providerRealmURL}person-remote`,
        'and resolves the current top match',
      );

      // `matches` sorts by name descending and takes one, so a new provider
      // card sorting after 'Zed' becomes the answer.
      let write = await providerRequest
        .post('/')
        .send({
          data: {
            type: 'card',
            attributes: { name: 'Zoe' },
            meta: {
              adoptsFrom: {
                module: rri(`${providerRealmURL}person`),
                name: 'Person',
              },
            },
          },
        })
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(write.status, 201, `HTTP 201: ${write.text}`);

      let afterWrite = await consumerRequest
        .get('/favorite')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(
        afterWrite.body.data.relationships.matches?.data?.[0]?.id,
        write.body.data.id,
        'the read after the write sees the new top match immediately, with no wait for an entry to expire',
      );
    });

    test('linksTo query resolves the first aggregated result and includes it', async function (assert) {
      let response = await consumerRequest
        .get('/favorite')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');

      let doc = response.body;
      let favoriteRelationship = doc.data.relationships.favorite;

      assert.deepEqual(
        favoriteRelationship?.data,
        { type: 'card', id: `${consumerRealmURL}local-person` },
        'linksTo picks the first (local realm) match',
      );
      let favoriteSearchLink = favoriteRelationship?.links?.search;
      assert.ok(
        favoriteSearchLink,
        'linksTo relationship exposes canonical search link',
      );
      let favoriteSearchURL = new URL(favoriteSearchLink);
      assert.strictEqual(
        favoriteSearchURL.href.split('?')[0],
        new URL('_search', consumerRealmURL).href,
        'favorite relationship search link targets consumer realm',
      );
      let favoriteQueryParams = parseSearchQuery(favoriteSearchURL);
      assert.deepEqual(
        favoriteQueryParams.page,
        { size: '1', number: '0' },
        'favorite relationship search link encodes pagination',
      );
      assert.strictEqual(
        favoriteQueryParams.filter?.type?.module,
        `${providerRealmURL}person`,
        'favorite relationship search link encodes implicit type filter module',
      );
      assert.strictEqual(
        favoriteQueryParams.filter?.type?.name,
        'Person',
        'favorite relationship search link encodes implicit type filter name',
      );
      assert.ok(
        Array.isArray(doc.included),
        '`included` array exists for linksTo query',
      );
      assert.ok(
        doc.included.some(
          (resource: any) => resource.id === `${consumerRealmURL}local-person`,
        ),
        '`included` contains the resolved favorite card',
      );
      assert.deepEqual(
        favoriteRelationship?.data,
        { type: 'card', id: `${consumerRealmURL}local-person` },
        'favorite relationship data references the resolved card',
      );
      assert.ok(
        doc.included.find(
          (resource: any) => resource.id === `${consumerRealmURL}local-person`,
        ),
        'local person is present in included array',
      );
    });

    // A write is answered from the written card alone. The read of the same
    // card in the same test is the control: it is what the card's query-backed
    // fields resolve to, and what the write would have assembled had it asked.
    test('a write does not resolve the written card’s query-backed fields', async function (assert) {
      let read = await consumerRequest
        .get('/favorite')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(read.status, 200, `HTTP 200: ${read.text}`);
      assert.ok(
        read.body.data.relationships?.favorite?.links?.search,
        'the read resolves the query-backed field',
      );
      assert.ok(
        (read.body.included ?? []).some(
          (resource: any) => resource.id === `${consumerRealmURL}local-person`,
        ),
        'and side-loads the card that field found',
      );

      let write = await consumerRequest
        .patch('/favorite')
        .send({
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'Renamed' } },
            meta: {
              adoptsFrom: {
                module: rri('./favorite-finder'),
                name: 'FavoriteLookup',
              },
            },
          },
        })
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(write.status, 200, `HTTP 200: ${write.text}`);
      assert.strictEqual(
        write.body.data.id,
        `${consumerRealmURL}favorite`,
        'the write answers about the card it wrote',
      );
      assert.strictEqual(
        write.body.data.attributes.cardInfo.name,
        'Renamed',
        'and answers with the value it just stored',
      );
      assert.notOk(
        write.body.data.relationships?.favorite?.links?.search,
        'but runs no query for the query-backed field',
      );
      assert.notOk(write.body.included, 'and side-loads nothing');
    });

    test('linksToMany query returns remote results and records errors for failing realm', async function (assert) {
      let response = await consumerRequest
        .get('/favorite')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');

      let doc = response.body;
      let relationships = doc.data.relationships as Record<string, any>;
      let remoteRelationship = relationships['matches.0'];
      let matchesRelationship = relationships.matches;

      assert.ok(remoteRelationship, 'remote match is present');
      assert.deepEqual(
        remoteRelationship?.data,
        { type: 'card', id: `${providerRealmURL}person-remote` },
        'remote realm result is returned',
      );

      assert.notOk(
        matchesRelationship?.meta?.errors,
        'successful remote query does not include errors metadata',
      );
      assert.strictEqual(
        matchesRelationship?.meta?.total,
        1,
        'a query whose every realm answered reports its match count',
      );
      assert.deepEqual(
        matchesRelationship?.data,
        [{ type: 'card', id: `${providerRealmURL}person-remote` }],
        'linksToMany base relationship provides data array for remote results',
      );
      let matchesSearchLink = matchesRelationship?.links?.search;
      assert.ok(
        matchesSearchLink,
        'linksToMany relationship exposes canonical search link',
      );
      let matchesSearchURL = new URL(matchesSearchLink);
      assert.ok(
        matchesSearchURL.searchParams.get('query'),
        'matches search link uses query param',
      );
      assert.strictEqual(
        matchesSearchURL.href.split('?')[0],
        new URL('_search', providerRealmURL).href,
        'matches relationship search link targets provider realm',
      );
      let matchesQueryParams = parseSearchQuery(matchesSearchURL);
      assert.deepEqual(
        matchesQueryParams.page,
        { size: '1', number: '0' },
        'matches relationship search link encodes pagination',
      );
      assert.strictEqual(
        matchesQueryParams.sort?.[0]?.by,
        'name',
        'matches relationship search link preserves sort by',
      );
      assert.strictEqual(
        matchesQueryParams.sort?.[0]?.direction,
        'desc',
        'matches relationship search link preserves sort direction',
      );
      assert.strictEqual(
        matchesQueryParams.sort?.[0]?.on?.module,
        `${providerRealmURL}person`,
        'matches relationship search link encodes sort module',
      );
      assert.strictEqual(
        matchesQueryParams.sort?.[0]?.on?.name,
        'Person',
        'matches relationship search link encodes sort card name',
      );

      let failingRelationship = relationships.failingMatches;
      assert.ok(
        failingRelationship?.meta?.errors,
        'failingMatches relationship meta includes errors array',
      );
      assert.ok(
        failingRelationship.meta.errors.some(
          (error: any) => error.realm === UNREACHABLE_REALM_URL,
        ),
        'meta includes unreachable realm entry for failing query',
      );
      assert.strictEqual(
        failingRelationship.meta.total,
        undefined,
        'a query whose realm failed reports no match count',
      );

      // One realm answered and one did not. The realm that failed reported no
      // count, and how many instances it holds is exactly what the failure
      // withheld — so the rows in hand look like the whole set and a rollup
      // over them would read as final. The count is withheld rather than
      // summed from the realms that happened to answer.
      let partialRelationship = relationships.partiallyFailingMatches;
      assert.deepEqual(
        partialRelationship?.data,
        [{ type: 'card', id: `${providerRealmURL}person-remote` }],
        'the reachable realm still contributes its results',
      );
      assert.ok(
        partialRelationship?.meta?.errors?.some(
          (error: any) => error.realm === UNREACHABLE_REALM_URL,
        ),
        'and the unreachable realm is recorded as an error',
      );
      assert.strictEqual(
        partialRelationship?.meta?.total,
        undefined,
        'no match count is claimed while one realm is unaccounted for',
      );
      let failingSearchLink = failingRelationship.links?.search;
      assert.ok(
        failingSearchLink,
        'failingMatches relationship exposes canonical search link despite error',
      );
      let failingSearchURL = new URL(failingSearchLink);
      assert.ok(
        failingSearchURL.searchParams.get('query'),
        'failingMatches search link uses query param',
      );
      assert.strictEqual(
        failingSearchURL.href.split('?')[0],
        new URL('_search', UNREACHABLE_REALM_URL).href,
        'failingMatches search link targets unreachable realm',
      );
      let failingQueryParams = parseSearchQuery(failingSearchURL);
      assert.deepEqual(
        failingQueryParams.page,
        { size: '1', number: '0' },
        'failingMatches search link encodes pagination',
      );
      assert.strictEqual(
        failingQueryParams.filter?.type?.module,
        `${providerRealmURL}person`,
        'failingMatches search link encodes implicit type filter module',
      );
      assert.strictEqual(
        failingQueryParams.filter?.type?.name,
        'Person',
        'failingMatches search link encodes implicit type filter name',
      );
      assert.deepEqual(
        failingRelationship.data,
        [],
        'failingMatches relationship provides empty data array when query fails',
      );

      assert.ok(Array.isArray(doc.included), '`included` array is present');
      let includedIds = (doc.included ?? []).map(
        (resource: any) => resource.id,
      );
      assert.ok(
        includedIds.includes(`${consumerRealmURL}local-person`),
        '`included` contains the local person result',
      );
      assert.ok(
        includedIds.includes(`${providerRealmURL}person-remote`),
        '`included` contains the remote person result',
      );
    });
  });
});
