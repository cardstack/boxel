import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  CompiledRealmPolicy,
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  isOperationFailure,
  runOperation,
  type CapabilityAnswer,
  type PolicyExplanation,
} from '@cardstack/runtime-common/card-operations';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A grant whose `paths` limit it to some realm paths (ADR 038). The Education
// realm holds `Post` cards in and around `blog/`, and its policy card lives in
// an Org realm. A teacher holds no permission on the Education realm, so the
// realm ACL declines every request they make, and a reader may read it but
// not write it, so their writes reach the policy too.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';
// Reads both realms, so they may ask the policy card what it decides.
const IT_ADMIN = '@it-admin:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const POST = { module: `${EDUCATION}post`, name: 'Post' };
const FILE_DEF = { module: rri('@cardstack/base/card-api'), name: 'FileDef' };
const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };

const POST_MODULE = `
  import { contains, field, linksToMany, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Post extends CardDef {
    @field title = contains(StringField);
    @field related = linksToMany(() => Post);
  }
`;

type Grant = { operation: string; where?: unknown; paths?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// `read`, `update` and `create` on posts under `blog/`, and a search that
// finds posts under `blog/` and `with space/`. Files under `notes/` can be
// downloaded.
const RULES: Rule[] = [
  {
    targetType: POST,
    grants: [
      { operation: 'read', paths: ['blog/'] },
      { operation: 'update', paths: ['blog/'] },
      { operation: 'create', paths: ['blog/'] },
      { operation: 'query', paths: ['blog/', 'with%20space/'] },
    ],
  },
  {
    targetType: FILE_DEF,
    grants: [{ operation: 'readSource', paths: ['notes/'] }],
  },
];

function policyCard(rules: Rule[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function post(title: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title },
      meta: { adoptsFrom: { module: rri(POST.module), name: 'Post' } },
    },
  });
}

function postDocument(title: string, lid?: string) {
  return {
    type: 'card',
    ...(lid ? { lid } : {}),
    attributes: { title },
    meta: { adoptsFrom: { module: rri(POST.module), name: 'Post' } },
  };
}

function invoke(name: string, rest: { href?: string; data?: unknown } = {}) {
  return { op: 'invoke', 'boxel:name': name, ...rest };
}

const IN_BLOG = `${EDUCATION}blog/Post/1`;
const IN_BLOG_OLD = `${EDUCATION}blog-old/Post/2`;
const BLOG_JSON = `${EDUCATION}blog`;
const IN_DRAFTS = `${EDUCATION}drafts/Post/3`;
const WITH_SPACE = `${EDUCATION}with%20space/Post/5`;
const NOTE_FILE = `${EDUCATION}notes/readme.txt`;
const OTHER_FILE = `${EDUCATION}misc/other.txt`;

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;

  setupCatalogTestSubset(hooks);

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(EDUCATION),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Education',
              policy: POLICY_CARD,
            }),
            '.gitignore': 'ignored/\n',
            'post.gts': POST_MODULE,
            'blog/Post/1.json': post('In the blog'),
            'blog-old/Post/2.json': post('In the old blog'),
            'blog.json': post('Beside the blog'),
            'drafts/Post/3.json': post('A draft'),
            'ignored/Post/4.json': post('Ignored'),
            'with space/Post/5.json': post('In a directory with a space'),
            'notes/readme.txt': 'Read me',
            'misc/other.txt': 'Something else',
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
            [READER]: ['read'],
            [IT_ADMIN]: ['read'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/education.json': policyCard(RULES),
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
            [IT_ADMIN]: ['read'],
          },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  async function stop() {
    for (let realm of [education, org]) {
      realm.__testOnlyClearCaches();
      realm.unsubscribe();
    }
    await closeServer(server);
    resetCatalogRealms();
  }

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      await start(args);
      return stop;
    },
  });

  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: stop,
  });

  function bearer(
    realm: Realm,
    user: string,
    permissions: Parameters<typeof createJWT>[2] = [],
  ) {
    return `Bearer ${createJWT(realm, user, permissions)}`;
  }

  const AUTH = {
    admin: () => bearer(education, ADMIN, ['read', 'write', 'realm-owner']),
    reader: () => bearer(education, READER, ['read']),
    teacher: () => bearer(education, TEACHER),
    itAdmin: () => bearer(org, IT_ADMIN, ['read']),
  };

  function path(url: string) {
    return new URL(url).pathname;
  }

  async function usePolicy(rules: Rule[]) {
    await org.write('policies/education.json', policyCard(rules));
    await org.indexing();
  }

  // The realm reads its ignore rules when it indexes from scratch, which a
  // realm booted from the template database hasn't done.
  async function readIgnoreFiles() {
    await education.fullIndex();
  }

  function getCard(url: string, auth: string) {
    return request
      .get(path(url))
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth);
  }

  function patchCard(url: string, auth: string, title: string) {
    return request
      .patch(path(url))
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth)
      .send(JSON.stringify({ data: postDocument(title) }));
  }

  function postCard(directory: string, auth: string, title: string) {
    return request
      .post(`${path(EDUCATION)}${directory}`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth)
      .send(JSON.stringify({ data: postDocument(title) }));
  }

  function operations(auth: string, ...entries: unknown[]) {
    return request
      .post(`${path(EDUCATION)}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(JSON.stringify({ 'boxel:operations': entries }));
  }

  function update(href: string, title: string) {
    return invoke('update', { href, data: postDocument(title) });
  }

  function errorCode(response: Response) {
    return (response.body as { errors?: { code?: string }[] }).errors?.[0]
      ?.code;
  }

  // The gate's refusal to a caller who may read the realm.
  function assertNotPermitted(
    assert: Assert,
    response: Response,
    label: string,
  ) {
    assert.strictEqual(response.status, 403, `${label}: status`);
    assert.strictEqual(
      errorCode(response),
      'operation-not-permitted',
      `${label}: the gate's refusal`,
    );
  }

  async function titleOf(url: string) {
    let response = await getCard(url, AUTH.admin());
    return (response.body as { data: { attributes: { title: string } } }).data
      .attributes.title;
  }

  function readSource(url: string) {
    return runOperation(education.operationCore, {
      target: { kind: 'instance' as const, url },
      name: 'readSource',
      actor: TEACHER,
      clientRequestId: 'paths-test',
      coarseDeclined: true,
    });
  }

  async function served(url: string): Promise<boolean> {
    try {
      await readSource(url);
      return true;
    } catch (e: unknown) {
      if (isOperationFailure(e)) {
        return false;
      }
      throw e;
    }
  }

  async function searchIds(auth: string, payload: object): Promise<string[]> {
    let response = await request
      .post(`${path(EDUCATION)}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Authorization', auth)
      .send(payload);
    if (response.status !== 200) {
      throw new Error(`search answered ${response.status}: ${response.text}`);
    }
    return (response.body as { data: { id: string }[] }).data
      .map(({ id }) => id)
      .sort();
  }

  async function explanation(
    question: Record<string, unknown>,
  ): Promise<PolicyExplanation> {
    let response = await request
      .post(`${path(ORG)}_operations`)
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', AUTH.itAdmin())
      .send(
        JSON.stringify({
          'boxel:operations': [
            invoke('explain', { href: POLICY_CARD, data: question }),
          ],
        }),
      );
    if (response.status !== 200) {
      throw new Error(`explain answered ${response.status}: ${response.text}`);
    }
    return (response.body as { 'atomic:results': PolicyExplanation[] })[
      'atomic:results'
    ][0];
  }

  async function compiled(): Promise<CompiledRealmPolicy> {
    let policy = await education.getCompiledPolicy();
    if (!policy) {
      throw new Error('the Education realm names no policy');
    }
    return policy;
  }

  module('updates', function () {
    test('an update is admitted inside the grant’s paths and refused outside them', async function (assert) {
      let inside = await patchCard(IN_BLOG, AUTH.reader(), 'Edited');
      assert.strictEqual(inside.status, 200, 'under blog/');
      assert.strictEqual(await titleOf(IN_BLOG), 'Edited');

      assertNotPermitted(
        assert,
        await patchCard(IN_DRAFTS, AUTH.reader(), 'Edited'),
        'under drafts/',
      );
      assert.strictEqual(await titleOf(IN_DRAFTS), 'A draft');
    });

    test('`blog/` admits neither `blog-old/` nor `blog.json`', async function (assert) {
      assertNotPermitted(
        assert,
        await patchCard(IN_BLOG_OLD, AUTH.reader(), 'Edited'),
        'blog-old/',
      );
      assertNotPermitted(
        assert,
        await patchCard(BLOG_JSON, AUTH.reader(), 'Edited'),
        'blog.json',
      );
      assert.strictEqual(await titleOf(IN_BLOG_OLD), 'In the old blog');
      assert.strictEqual(await titleOf(BLOG_JSON), 'Beside the blog');
    });

    test('a write outside every grant’s paths is refused before anything about the target is read', async function (assert) {
      let before = education.__testOnlyPolicyTargetReads();
      let response = await patchCard(IN_DRAFTS, AUTH.teacher(), 'Edited');
      assert.strictEqual(
        response.status,
        404,
        'refused as a card that is not there, to a caller who may not read the realm',
      );
      assert.strictEqual(
        education.__testOnlyPolicyTargetReads(),
        before,
        'no index row and no stored bytes were read',
      );

      let inside = await patchCard(IN_BLOG, AUTH.teacher(), 'Edited');
      assert.strictEqual(inside.status, 200, 'the same write under blog/');
      assert.true(
        education.__testOnlyPolicyTargetReads() > before,
        'which reads the card it writes',
      );
    });

    test('a batch with one entry outside the grant’s paths writes nothing', async function (assert) {
      let response = await operations(
        AUTH.reader(),
        update(IN_BLOG, 'Edited in a batch'),
        update(IN_DRAFTS, 'Edited in a batch'),
      );
      assertNotPermitted(assert, response, 'the batch');
      assert.strictEqual(await titleOf(IN_BLOG), 'In the blog');
      assert.strictEqual(await titleOf(IN_DRAFTS), 'A draft');
    });
  });

  module('creates', function () {
    test('a create is judged where its card will be stored', async function (assert) {
      let inside = await postCard('blog/', AUTH.reader(), 'New post');
      assert.strictEqual(inside.status, 201, 'a POST to blog/');
      let id = (inside.body as { data: { id: string } }).data.id;
      assert.true(
        id.startsWith(`${EDUCATION}blog/Post/`),
        `stored under blog/: ${id}`,
      );

      assertNotPermitted(
        assert,
        await postCard('drafts/', AUTH.reader(), 'New draft'),
        'a POST to drafts/',
      );
      assertNotPermitted(
        assert,
        await postCard('', AUTH.reader(), 'New post at the root'),
        'a POST to the root, which stores the card at Post/',
      );
    });

    test('a create that names its id is matched on the file it will be stored at', async function (assert) {
      await usePolicy([
        {
          targetType: POST,
          grants: [{ operation: 'create', paths: ['Post/welcome.json'] }],
        },
      ]);
      let admitted = await operations(
        AUTH.reader(),
        invoke('create', { data: postDocument('Welcome', 'welcome') }),
      );
      assert.strictEqual(admitted.status, 200, `the file the grant names`);

      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          invoke('create', { data: postDocument('Other', 'other') }),
        ),
        'another file beside it',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          invoke('create', { data: postDocument('No id') }),
        ),
        'a card whose id the realm picks, which a one-file grant never admits',
      );
    });

    test('a caller who may not read the realm creates at the root, and a grant covering it admits them', async function (assert) {
      let refused = await operations(
        AUTH.teacher(),
        invoke('create', { data: postDocument('From outside') }),
      );
      assert.strictEqual(
        refused.status,
        404,
        'the root is outside blog/, and the refusal says nothing is there',
      );

      await usePolicy([
        {
          targetType: POST,
          grants: [{ operation: 'create', paths: ['Post/'] }],
        },
      ]);
      let admitted = await operations(
        AUTH.teacher(),
        invoke('create', { data: postDocument('From outside') }),
      );
      assert.strictEqual(admitted.status, 200, 'a grant on Post/ admits it');
    });
  });

  module('files and paths out of reach', function () {
    test('a file is matched by its own path', async function (assert) {
      let before = education.__testOnlyPolicyTargetReads();
      assert.false(await served(OTHER_FILE), 'a file outside notes/');
      assert.strictEqual(
        education.__testOnlyPolicyTargetReads(),
        before,
        'refused without reading its bytes',
      );
      assert.true(await served(NOTE_FILE), 'a file under notes/');
    });

    test('a grant on `/` reaches neither the realm’s config card nor a path the realm ignores', async function (assert) {
      await usePolicy([
        {
          targetType: CARD_DEF,
          grants: [
            { operation: 'read', paths: ['/'] },
            { operation: 'create', paths: ['/'] },
          ],
        },
        {
          targetType: FILE_DEF,
          grants: [{ operation: 'readSource', paths: ['/'] }],
        },
      ]);
      await readIgnoreFiles();

      assert.strictEqual(
        (await getCard(IN_DRAFTS, AUTH.teacher())).status,
        200,
        'the grant reaches a card anywhere else',
      );
      assert.strictEqual(
        (await getCard(`${EDUCATION}realm`, AUTH.teacher())).status,
        404,
        'not the config card',
      );
      assert.false(
        await served(`${EDUCATION}realm.json`),
        'nor the config card’s stored bytes',
      );
      assert.false(
        await served(`${EDUCATION}ignored/Post/4.json`),
        'nor the bytes at an ignored path',
      );
      assertNotPermitted(
        assert,
        await postCard('ignored/', AUTH.reader(), 'Into an ignored directory'),
        'nor a create into an ignored directory',
      );
    });
  });

  module('search', function () {
    test('a path-scoped query grant finds only the cards under its paths', async function (assert) {
      let found = await searchIds(AUTH.teacher(), {
        filter: { 'item.on': POST },
      });
      assert.deepEqual(found, [IN_BLOG, WITH_SPACE].sort());

      let all = await searchIds(AUTH.reader(), { filter: { 'item.on': POST } });
      assert.true(
        [IN_BLOG, IN_BLOG_OLD, BLOG_JSON, IN_DRAFTS, WITH_SPACE].every((id) =>
          all.includes(id),
        ),
        'a caller the realm lets read finds every post, unscoped',
      );
    });

    test('explain’s answer for a search shows the path condition, and runs to the same cards', async function (assert) {
      let filter = { 'item.on': POST };
      let explained = await explanation({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'query',
        search: { filter },
      });
      assert.strictEqual(explained.reason, 'granted');
      assert.deepEqual(explained.rules[0].grants[0].paths, [
        'blog/',
        'with%20space/',
      ]);
      assert.true(
        JSON.stringify(explained.search?.fragment).includes(
          JSON.stringify({ paths: ['blog/', 'with%20space/'] }),
        ),
        `the fragment carries the paths: ${JSON.stringify(explained.search?.fragment)}`,
      );
      assert.deepEqual(
        await searchIds(AUTH.reader(), {
          filter: { every: [filter, explained.search?.fragment] },
        }),
        await searchIds(AUTH.teacher(), { filter }),
        'the explained fragment runs to exactly the teacher’s results',
      );
    });

    test('a search may name paths itself', async function (assert) {
      assert.deepEqual(
        await searchIds(AUTH.reader(), {
          filter: { every: [{ 'item.on': POST }, { paths: ['blog/'] }] },
        }),
        [IN_BLOG],
        'blog/ and nothing beside it',
      );
      assert.deepEqual(
        await searchIds(AUTH.reader(), {
          filter: {
            every: [{ 'item.on': POST }, { paths: ['blog.json'] }],
          },
        }),
        [BLOG_JSON],
        'one file',
      );
      let response = await request
        .post(`${path(EDUCATION)}_search`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', AUTH.reader())
        .send({ filter: { paths: ['../secret/'] } });
      assert.strictEqual(
        response.status,
        400,
        'a prefix the specifier refuses',
      );
    });
  });

  module('explain', function () {
    test('a grant whose paths miss the target is reported with its paths', async function (assert) {
      let explained = await explanation({
        actor: TEACHER,
        target: IN_DRAFTS,
        operation: 'update',
      });
      assert.strictEqual(explained.decision, 'denied');
      assert.strictEqual(explained.reason, 'outside-paths');
      let grants = explained.rules.flatMap((rule) => rule.grants);
      assert.deepEqual(
        grants.map(({ path, paths, outcome }) => ({ path, paths, outcome })),
        [
          {
            path: 'rules[0].grants[1]',
            paths: ['blog/'],
            outcome: 'outside-paths',
          },
        ],
      );

      let inside = await explanation({
        actor: TEACHER,
        target: IN_BLOG,
        operation: 'update',
      });
      assert.strictEqual(inside.decision, 'allowed');
      assert.strictEqual(inside.reason, 'granted');
    });
  });

  module('compile', function () {
    test('an invalid prefix leaves the whole grant out, with an issue for each bad prefix', async function (assert) {
      await usePolicy([
        {
          targetType: POST,
          grants: [
            { operation: 'read', paths: ['blog/', '../secret/', 'a*'] },
            { operation: 'update', paths: ['blog/'] },
          ],
        },
      ]);
      let policy = await compiled();
      assert.deepEqual(
        policy.rules[0].grants.map(({ operation }) => operation),
        ['update'],
        'the read grant is left out, not narrowed to blog/',
      );
      assert.deepEqual(
        policy.issues
          .filter(({ code }) => code === 'invalid-paths')
          .map(({ path, severity }) => ({ path, severity })),
        [
          { path: 'rules[0].grants[0].paths[1]', severity: 'inactive' },
          { path: 'rules[0].grants[0].paths[2]', severity: 'inactive' },
        ],
      );
      assert.strictEqual(
        (await getCard(IN_BLOG, AUTH.teacher())).status,
        404,
        'the grant admits nothing, even under blog/',
      );
    });

    test('a path-scoped read on a type that links to itself records that its links reach past its paths', async function (assert) {
      // The grants whose links reach posts through `related`.
      let reachIssues = (policy: CompiledRealmPolicy) =>
        policy.issues
          .filter(
            ({ code, message }) =>
              code === 'grant-reaches-ungranted-type' &&
              /linked through `related`/.test(message),
          )
          .map(({ path }) => path);

      await usePolicy([
        { targetType: POST, grants: [{ operation: 'read', paths: ['blog/'] }] },
      ]);
      assert.deepEqual(reachIssues(await compiled()), ['rules[0].grants[0]']);

      await usePolicy([{ targetType: POST, grants: [{ operation: 'read' }] }]);
      assert.deepEqual(
        reachIssues(await compiled()),
        [],
        'a read with no path limit covers its own type',
      );
    });
  });

  module('capabilities', function () {
    test('_capabilities answers for a card inside and outside a grant’s paths as the operation is decided', async function (assert) {
      let pairs = [
        { target: IN_BLOG, operation: 'read' },
        { target: IN_DRAFTS, operation: 'read' },
        { target: IN_BLOG_OLD, operation: 'read' },
      ];
      let response = await request
        .post(`${path(EDUCATION)}_capabilities`)
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', AUTH.teacher())
        .send({ checks: pairs });
      assert.strictEqual(response.status, 200);
      let answers = (response.body as { checks: CapabilityAnswer[] }).checks;
      assert.deepEqual(
        answers.map(({ allowed }) => allowed),
        [true, false, false],
      );
      for (let [index, { target }] of pairs.entries()) {
        let read = await getCard(target, AUTH.teacher());
        assert.strictEqual(
          read.status === 200,
          answers[index].allowed,
          `${target}: the read agrees with the check`,
        );
      }
    });
  });
});
