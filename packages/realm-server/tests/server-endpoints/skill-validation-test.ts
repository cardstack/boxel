import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import {
  rri,
  type LooseSingleCardDocument,
  type ModulePrerenderArgs,
  type Prerenderer,
} from '@cardstack/runtime-common';
import {
  getTestPrerenderer,
  realmServerSecretSeed,
  setupPermissionedRealmCached,
  testRealmURL,
} from '../helpers/index.ts';
import { monitoringAuthToken } from '../../utils/monitoring.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

const TOOL_MODULE_SOURCE = `
  export default class TestTool {}
  export class NamedTestTool {}
`;

// A skill expressed as a markdown file: `boxel.kind: skill` frontmatter with
// tool refs on `boxel.tools` — the markdown counterpart of `Skill.commands`.
function skillMarkdown(tools: { module: string; name: string }[]): string {
  return [
    '---',
    'boxel:',
    '  kind: skill',
    ...(tools.length ? ['  tools:'] : []),
    ...tools.flatMap(({ module, name }) => [
      '    - codeRef:',
      `        module: '${module}'`,
      `        name: ${name}`,
      '      requiresApproval: false',
    ]),
    '---',
    '# Test markdown skill',
  ].join('\n');
}

function skillDoc(
  tools: { module: string; name: string }[],
): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: {
        instructions: 'test skill',
        // The Skill card's tool refs live on its pre-rename `commands` field.
        commands: tools.map((codeRef) => ({
          codeRef,
          requiresApproval: false,
        })),
      },
      meta: {
        adoptsFrom: {
          module: rri('https://cardstack.com/base/skill'),
          name: 'Skill',
        },
      },
    },
  };
}

// A prerenderer that counts `prerenderModule` calls and delegates everything
// else (realm indexing during setup needs a real `prerenderVisit`, so a pure
// stub won't do). The count lets a test observe when the validation endpoint
// actually reruns the sweep versus serving its cached result.
interface CountingPrerenderer {
  prerenderer: Prerenderer;
  setDelegate: (delegate: Prerenderer) => void;
  moduleCalls: () => number;
}
function makeCountingPrerenderer(): CountingPrerenderer {
  let delegate: Prerenderer | undefined;
  let moduleCalls = 0;
  let prerenderer = new Proxy({} as Prerenderer, {
    get(_target, prop, receiver) {
      if (prop === 'prerenderModule') {
        return (args: ModulePrerenderArgs) => {
          moduleCalls++;
          return delegate!.prerenderModule(args);
        };
      }
      let value = Reflect.get(delegate!, prop, receiver);
      return typeof value === 'function' ? value.bind(delegate!) : value;
    },
  });
  return {
    prerenderer,
    setDelegate: (d) => {
      delegate = d;
    },
    moduleCalls: () => moduleCalls,
  };
}

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('Realm Server Endpoints (not specific to one realm)', function () {
    module('_skill-validation with broken skills', function (hooks) {
      let request: SuperTest<Test>;

      setupPermissionedRealmCached(hooks, {
        fileSystem: {
          'test-tool.gts': TOOL_MODULE_SOURCE,
          'valid-skill.json': skillDoc([
            { module: `${testRealmURL.href}test-tool`, name: 'default' },
            {
              module: `${testRealmURL.href}test-tool`,
              name: 'NamedTestTool',
            },
          ]),
          'missing-module-skill.json': skillDoc([
            {
              module: `${testRealmURL.href}nonexistent-tool`,
              name: 'default',
            },
          ]),
          'missing-export-skill.json': skillDoc([
            {
              module: `${testRealmURL.href}test-tool`,
              name: 'NoSuchExport',
            },
          ]),
          'broken-tool-skill.md': skillMarkdown([
            {
              module: `${testRealmURL.href}nonexistent-tool`,
              name: 'default',
            },
          ]),
        },
        permissions: {
          '*': ['read', 'write'],
        },
        onRealmSetup(args) {
          request = args.request;
        },
      });

      test('requires the monitoring auth token', async function (assert) {
        let response = await request.get(
          `/_skill-validation?realm=${encodeURIComponent(testRealmURL.href)}`,
        );
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
        response = await request
          .get(
            `/_skill-validation?realm=${encodeURIComponent(testRealmURL.href)}`,
          )
          .set('Authorization', `Bearer no-good`);
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('requires a realm query param naming a realm on this server', async function (assert) {
        let token = await monitoringAuthToken(realmServerSecretSeed);
        let response = await request
          .get('/_skill-validation')
          .set('Authorization', `Bearer ${token}`);
        assert.strictEqual(response.status, 400, 'HTTP 400 status');

        response = await request
          .get(
            `/_skill-validation?realm=${encodeURIComponent(
              'http://example.com/nowhere/',
            )}`,
          )
          .set('Authorization', `Bearer ${token}`);
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
      });

      test('reports each tool codeRef that fails to resolve', async function (assert) {
        let response = await request
          .get(
            `/_skill-validation?realm=${encodeURIComponent(testRealmURL.href)}`,
          )
          .set(
            'Authorization',
            `Bearer ${await monitoringAuthToken(realmServerSecretSeed)}`,
          );
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let { attributes } = response.body.data;
        assert.strictEqual(attributes.status, 'fail', 'overall status fails');
        assert.strictEqual(attributes.skillsChecked, 4, 'all skills checked');
        assert.strictEqual(attributes.toolsChecked, 5, 'all tools checked');

        let failures: {
          skill: string;
          module: string;
          name: string;
          error: string;
        }[] = attributes.failures;
        assert.strictEqual(failures.length, 3, 'three failing tools');

        let missingModule = failures.find(
          (f) => f.skill === `${testRealmURL.href}missing-module-skill`,
        );
        assert.ok(missingModule, 'missing module failure reported');
        assert.strictEqual(
          missingModule!.module,
          `${testRealmURL.href}nonexistent-tool`,
          'failing module path is surfaced',
        );

        let missingExport = failures.find(
          (f) => f.skill === `${testRealmURL.href}missing-export-skill`,
        );
        assert.ok(missingExport, 'missing export failure reported');
        assert.strictEqual(missingExport!.name, 'NoSuchExport');
        assert.ok(
          missingExport!.error.includes('has no export'),
          `error explains the missing export: ${missingExport!.error}`,
        );

        let brokenMarkdownTool = failures.find(
          (f) => f.skill === `${testRealmURL.href}broken-tool-skill.md`,
        );
        assert.ok(brokenMarkdownTool, 'markdown skill failure reported');
        assert.strictEqual(
          brokenMarkdownTool!.module,
          `${testRealmURL.href}nonexistent-tool`,
          'failing markdown tool module is surfaced',
        );

        assert.notOk(
          failures.some((f) => f.skill === `${testRealmURL.href}valid-skill`),
          'valid skill has no failures',
        );
      });
    });

    module('_skill-validation with only healthy skills', function (hooks) {
      let request: SuperTest<Test>;

      setupPermissionedRealmCached(hooks, {
        fileSystem: {
          'test-tool.gts': TOOL_MODULE_SOURCE,
          'valid-skill.json': skillDoc([
            { module: `${testRealmURL.href}test-tool`, name: 'default' },
          ]),
          'no-tools-skill.json': skillDoc([]),
          'valid-skill.md': skillMarkdown([
            {
              module: `${testRealmURL.href}test-tool`,
              name: 'NamedTestTool',
            },
          ]),
        },
        // Owner-only (no `*` read): the tool module can't be fetched
        // anonymously, so this passes only when the endpoint mints prerender
        // auth for the realm owner's full Matrix user id — permission rows
        // are keyed by full user id, and a bare username matches none.
        permissions: {
          '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
        },
        onRealmSetup(args) {
          request = args.request;
        },
      });

      test('passes when every tool codeRef resolves in a private realm', async function (assert) {
        let response = await request
          .get(
            `/_skill-validation?realm=${encodeURIComponent(testRealmURL.href)}`,
          )
          .set(
            'Authorization',
            `Bearer ${await monitoringAuthToken(realmServerSecretSeed)}`,
          );
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let { attributes } = response.body.data;
        assert.strictEqual(attributes.status, 'pass', 'overall status passes');
        assert.strictEqual(attributes.skillsChecked, 3, 'all skills checked');
        assert.strictEqual(attributes.toolsChecked, 2, 'tools checked');
        assert.deepEqual(attributes.failures, [], 'no failures');
      });
    });

    module('_skill-validation result caching', function (hooks) {
      let request: SuperTest<Test>;
      let counting = makeCountingPrerenderer();

      // Registered before setupPermissionedRealmCached so it runs first: the
      // delegate is in place before the template build and server boot route
      // their prerender work through the counting proxy.
      hooks.before(async function () {
        counting.setDelegate(await getTestPrerenderer());
      });

      setupPermissionedRealmCached(hooks, {
        fileSystem: {
          'test-tool.gts': TOOL_MODULE_SOURCE,
          'valid-skill.json': skillDoc([
            { module: `${testRealmURL.href}test-tool`, name: 'default' },
          ]),
        },
        permissions: {
          '*': ['read', 'write'],
        },
        prerenderer: counting.prerenderer,
        onRealmSetup(args) {
          request = args.request;
        },
      });

      test('serves a cached result and only reruns the sweep on refresh=true', async function (assert) {
        let token = await monitoringAuthToken(realmServerSecretSeed);
        let poll = (query = '') =>
          request
            .get(
              `/_skill-validation?realm=${encodeURIComponent(
                testRealmURL.href,
              )}${query}`,
            )
            .set('Authorization', `Bearer ${token}`);

        // Nothing is cached after boot, so the first poll computes on the
        // request path — one prerenderModule per unique tool module (one here).
        let beforeCold = counting.moduleCalls();
        let first = await poll();
        assert.strictEqual(first.status, 200, 'first poll succeeds');
        assert.strictEqual(
          first.body.data.attributes.status,
          'pass',
          'first poll passes',
        );
        assert.ok(
          counting.moduleCalls() > beforeCold,
          'the cold poll runs the sweep',
        );

        // A second poll well inside the refresh interval serves the cached
        // result without touching the prerenderer.
        let afterCold = counting.moduleCalls();
        let second = await poll();
        assert.strictEqual(second.status, 200, 'second poll succeeds');
        assert.strictEqual(
          second.body.data.attributes.status,
          'pass',
          'second poll passes',
        );
        assert.strictEqual(
          counting.moduleCalls(),
          afterCold,
          'the warm poll serves the cache without rerunning the sweep',
        );

        // refresh=true forces a synchronous recompute regardless of cache age.
        let refreshed = await poll('&refresh=true');
        assert.strictEqual(refreshed.status, 200, 'refresh poll succeeds');
        assert.ok(
          counting.moduleCalls() > afterCold,
          'refresh=true reruns the sweep',
        );
      });
    });
  });
});
