import { module, test } from 'qunit';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import { basename } from 'path';
import Koa from 'koa';
import Router from '@koa/router';
import type { RealmHttpServer as Server } from '../server.ts';
import http, { createServer } from 'http';
import { buildPrerenderManagerApp } from '../prerender/manager-app.ts';
import {
  PRERENDER_HOST_SHELL_HASH_HEADER,
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from '../prerender/prerender-constants.ts';
import { toAffinityKey } from '../prerender/affinity.ts';
import { Deferred } from '@cardstack/runtime-common';
import { testCreatePrerenderAuth } from './helpers/index.ts';

module(basename(import.meta.filename), function () {
  module('Prerender manager', function (hooks) {
    let previousMultiplex: string | undefined;
    let previousHeartbeatTimeout: string | undefined;
    let previousDiscoveryWait: string | undefined;
    let previousDiscoveryPoll: string | undefined;
    let mockPrerenderA: ReturnType<typeof makeMockPrerender> | undefined;
    let mockPrerenderB: ReturnType<typeof makeMockPrerender> | undefined;
    let serverUrlA: string | undefined;
    let serverUrlB: string | undefined;
    hooks.beforeEach(function () {
      previousMultiplex = process.env.PRERENDER_MULTIPLEX;
      previousHeartbeatTimeout = process.env.PRERENDER_HEARTBEAT_TIMEOUT_MS;
      previousDiscoveryWait = process.env.PRERENDER_SERVER_DISCOVERY_WAIT_MS;
      previousDiscoveryPoll = process.env.PRERENDER_SERVER_DISCOVERY_POLL_MS;
      // create two mock prerender servers available for tests
      mockPrerenderA = makeMockPrerender();
      mockPrerenderB = makeMockPrerender();
      serverUrlA = `http://127.0.0.1:${(mockPrerenderA.server.address() as any).port}`;
      serverUrlB = `http://127.0.0.1:${(mockPrerenderB.server.address() as any).port}`;
    });
    hooks.afterEach(async function () {
      if (previousMultiplex === undefined) {
        delete process.env.PRERENDER_MULTIPLEX;
      } else {
        process.env.PRERENDER_MULTIPLEX = previousMultiplex;
      }
      if (previousHeartbeatTimeout === undefined) {
        delete process.env.PRERENDER_HEARTBEAT_TIMEOUT_MS;
      } else {
        process.env.PRERENDER_HEARTBEAT_TIMEOUT_MS = previousHeartbeatTimeout;
      }
      if (previousDiscoveryWait === undefined) {
        delete process.env.PRERENDER_SERVER_DISCOVERY_WAIT_MS;
      } else {
        process.env.PRERENDER_SERVER_DISCOVERY_WAIT_MS = previousDiscoveryWait;
      }
      if (previousDiscoveryPoll === undefined) {
        delete process.env.PRERENDER_SERVER_DISCOVERY_POLL_MS;
      } else {
        process.env.PRERENDER_SERVER_DISCOVERY_POLL_MS = previousDiscoveryPoll;
      }
      // ensure mock servers are stopped
      if (mockPrerenderA) {
        await mockPrerenderA.stop();
        mockPrerenderA = undefined;
      }
      if (mockPrerenderB) {
        await mockPrerenderB.stop();
        mockPrerenderB = undefined;
      }
      serverUrlA = undefined;
      serverUrlB = undefined;
    });
    test('health', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let headResponse = await request.head('/');
      assert.strictEqual(headResponse.status, 200, 'HEAD / 200');
      let getResponse = await request.get('/');
      assert.strictEqual(getResponse.status, 200, 'GET / 200');
      assert.strictEqual(
        getResponse.headers['content-type'],
        'application/vnd.api+json',
        'JSON-API content type',
      );
      assert.strictEqual(
        getResponse.body.data.type,
        'prerender-manager-health',
        'response type',
      );
      assert.strictEqual(getResponse.body.data.id, 'health', 'response id');
      assert.false(getResponse.body.data.attributes.ready, 'ready attribute');
      assert.ok(Array.isArray(getResponse.body.included), 'included is array');
      assert.strictEqual(
        getResponse.body.included.length,
        0,
        'no servers registered',
      );
    });

    test('reports the host shell token and echoes it on heartbeats', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let headerKey = PRERENDER_HOST_SHELL_HASH_HEADER.toLowerCase();
      let heartbeat = () =>
        request.post('/prerender-servers').send({
          data: {
            type: 'prerender-server',
            attributes: { capacity: 2, url: serverUrlA },
          },
        });

      // No token reported yet → heartbeat carries no host-shell header.
      let first = await heartbeat();
      assert.strictEqual(first.status, 204, 'heartbeat accepted');
      assert.strictEqual(
        first.headers[headerKey],
        undefined,
        'no host-shell header before any report',
      );

      // Realm server reports a token.
      let reportA = await request
        .post('/host-shell')
        .send({ data: { attributes: { hash: 'aaa111' } } });
      assert.strictEqual(reportA.status, 204, 'host-shell report accepted');

      // Now heartbeats echo it.
      let second = await heartbeat();
      assert.strictEqual(
        second.headers[headerKey],
        'aaa111',
        'heartbeat echoes the reported host-shell token',
      );

      // A changed token is echoed; a repeat of the same token is a no-op.
      await request
        .post('/host-shell')
        .send({ data: { attributes: { hash: 'bbb222' } } });
      let third = await heartbeat();
      assert.strictEqual(
        third.headers[headerKey],
        'bbb222',
        'heartbeat echoes the updated host-shell token',
      );

      // A missing hash is rejected.
      let bad = await request
        .post('/host-shell')
        .send({ data: { attributes: {} } });
      assert.strictEqual(bad.status, 400, 'host-shell report requires a hash');
    });

    test('health includes active servers with affinities and last used times', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      // Register two servers
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      // Make a prerender request to assign a realm to a server
      let realm = 'https://realm.example/R';
      let body = makeBody(realm, `${realm}/1`);
      let proxyResponse = await request.post('/prerender-visit').send(body);
      assert.strictEqual(proxyResponse.status, 201, 'proxy request successful');
      let assignedServer = proxyResponse.headers['x-boxel-prerender-target'];

      // Get healthcheck
      let healthResponse = await request.get('/');
      assert.strictEqual(healthResponse.status, 200, 'health 200');
      assert.strictEqual(
        healthResponse.headers['content-type'],
        'application/vnd.api+json',
        'JSON-API content type',
      );

      let { data, included } = healthResponse.body;
      assert.strictEqual(data.type, 'prerender-manager-health', 'health type');
      assert.true(data.attributes.ready, 'ready');

      // Verify included servers
      assert.ok(Array.isArray(included), 'included is array');
      assert.strictEqual(included.length, 2, 'two servers in included');

      // Find the server that was assigned the realm
      let assignedServerData = included.find(
        (s: any) => s.id === assignedServer,
      );
      assert.ok(assignedServerData, 'assigned server in included');
      assert.strictEqual(
        assignedServerData.type,
        'prerender-server',
        'server type',
      );
      assert.strictEqual(
        assignedServerData.attributes.url,
        assignedServer,
        'server url',
      );
      assert.strictEqual(
        assignedServerData.attributes.capacity,
        2,
        'server capacity',
      );
      assert.ok(
        assignedServerData.attributes.registeredAt,
        'has registeredAt timestamp',
      );
      assert.ok(
        assignedServerData.attributes.lastSeenAt,
        'has lastSeenAt timestamp',
      );

      // Verify affinities array
      assert.ok(
        Array.isArray(assignedServerData.attributes.affinities),
        'affinities is array',
      );
      assert.strictEqual(
        assignedServerData.attributes.affinities.length,
        1,
        'one affinity active',
      );
      assert.strictEqual(
        assignedServerData.attributes.affinities[0].affinityType,
        'realm',
        'affinity type is realm',
      );
      assert.strictEqual(
        assignedServerData.attributes.affinities[0].affinityValue,
        realm,
        'affinity value is realm URL',
      );
      assert.strictEqual(
        assignedServerData.attributes.affinities[0].key,
        realmAffinityKey(realm),
        'affinity key matches encoded key',
      );
      assert.ok(
        assignedServerData.attributes.affinities[0].lastUsed,
        'has affinity lastUsed timestamp',
      );
      assert.strictEqual(
        assignedServerData.attributes.status,
        'active',
        'status reflects heartbeat',
      );
      assert.ok(
        Array.isArray(assignedServerData.attributes.warmedAffinities),
        'warmed affinities included',
      );

      // Verify the other server has no affinities
      let otherServerUrl =
        assignedServer === serverUrlA ? serverUrlB : serverUrlA;
      let otherServerData = included.find((s: any) => s.id === otherServerUrl);
      assert.ok(otherServerData, 'other server in included');
      assert.strictEqual(
        otherServerData.attributes.affinities.length,
        0,
        'other server has no affinities',
      );
    });

    test('proxies card prerender requests', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });

      let realm = 'https://realm.example/C';
      let cardURL = `${realm}/1`;

      let proxyResponse = await request
        .post('/prerender-visit')
        .send(makeBody(realm, cardURL));

      assert.strictEqual(proxyResponse.status, 201, 'proxy request successful');
      assert.strictEqual(
        proxyResponse.headers['x-boxel-prerender-target'],
        serverUrlA,
        'card request routed to registered prerender server',
      );

      assert.strictEqual(
        proxyResponse.body?.data?.type,
        'prerender-visit-result',
        'card result type returned',
      );
      assert.true(
        proxyResponse.body?.data?.attributes?.card?.ok,
        'card proxy payload echoed',
      );
    });

    test('proxies module prerender requests', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      // Register a single server
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });

      let realm = 'https://realm.example/M';
      let moduleURL = `${realm}/module.gts`;

      let proxyResponse = await request
        .post('/prerender-module')
        .send(makeModuleBody(realm, moduleURL));

      assert.strictEqual(proxyResponse.status, 201, 'proxy request successful');
      assert.strictEqual(
        proxyResponse.headers['x-boxel-prerender-target'],
        serverUrlA,
        'module request routed to registered prerender server',
      );

      assert.strictEqual(
        proxyResponse.body?.data?.type,
        'prerender-module-result',
        'module result type returned',
      );
      assert.strictEqual(
        proxyResponse.body?.data?.attributes?.id,
        moduleURL,
        'module result id echoed',
      );
    });

    test('proxies run-command requests', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      // Register a single server
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });

      let realm = 'https://realm.example/CMD';
      let command = `${realm}/commands/say-hello/SayHelloCommand`;

      let proxyResponse = await request
        .post('/run-command')
        .send(makeCommandBody(realm, command));

      assert.strictEqual(proxyResponse.status, 201, 'proxy request successful');
      assert.strictEqual(
        proxyResponse.headers['x-boxel-prerender-target'],
        serverUrlA,
        'command request routed to registered prerender server',
      );
      assert.strictEqual(
        proxyResponse.body?.data?.type,
        'command-result',
        'command result type returned',
      );
      assert.strictEqual(
        proxyResponse.body?.data?.id,
        command,
        'command result id echoed',
      );
    });

    test('heartbeat records affinityVacancy per-affinity {idle, tabCount}', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      let warmKey = realmAffinityKey('https://realm.example/A');
      let busyKey = realmAffinityKey('https://realm.example/B');

      let registration = await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlA,
            status: 'active',
            warmedAffinities: [warmKey, busyKey],
            affinityVacancy: {
              [warmKey]: { idle: true, tabCount: 1 },
              [busyKey]: { idle: false, tabCount: 2 },
            },
          },
        },
      });
      assert.strictEqual(registration.status, 204, 'heartbeat accepted');

      let health = await request.get('/');
      let server = (health.body.included as any[]).find(
        (s) => s.id === serverUrlA,
      );
      assert.ok(server, 'server present in health included');
      assert.deepEqual(
        server.attributes.affinityVacancy,
        {
          [warmKey]: { idle: true, tabCount: 1 },
          [busyKey]: { idle: false, tabCount: 2 },
        },
        'affinityVacancy snapshot round-trips through the heartbeat',
      );

      // Subsequent heartbeat with updated vacancy overwrites the snapshot.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlA,
            status: 'active',
            warmedAffinities: [warmKey, busyKey],
            affinityVacancy: {
              [warmKey]: { idle: true, tabCount: 1 },
              [busyKey]: { idle: true, tabCount: 2 },
            },
          },
        },
      });
      let health2 = await request.get('/');
      let server2 = (health2.body.included as any[]).find(
        (s) => s.id === serverUrlA,
      );
      assert.deepEqual(
        server2.attributes.affinityVacancy[busyKey],
        { idle: true, tabCount: 2 },
        'busy affinity flips to idle on the next heartbeat',
      );
    });

    test('heartbeat without affinityVacancy is accepted (legacy server during rollout)', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      let registration = await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            status: 'active',
            warmedAffinities: [realmAffinityKey('https://realm.example/A')],
            // affinityVacancy intentionally omitted — predates CS-10758
          },
        },
      });
      assert.strictEqual(registration.status, 204, 'legacy heartbeat accepted');

      let health = await request.get('/');
      let server = (health.body.included as any[]).find(
        (s) => s.id === serverUrlA,
      );
      assert.deepEqual(
        server.attributes.affinityVacancy,
        {},
        'missing affinityVacancy normalized to empty object, not null',
      );
    });

    test('heartbeat drops malformed affinityVacancy entries', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      let goodKey = realmAffinityKey('https://realm.example/A');

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            status: 'active',
            warmedAffinities: [goodKey],
            affinityVacancy: {
              [goodKey]: { idle: true, tabCount: 1 },
              badShape1: { idle: 'yes', tabCount: 1 }, // wrong idle type
              badShape2: { idle: true }, // missing tabCount
              badShape3: null, // not an object
              badTabCountNaN: { idle: true, tabCount: NaN },
              badTabCountInf: { idle: true, tabCount: Infinity },
              badTabCountNegative: { idle: true, tabCount: -1 },
              badTabCountFractional: { idle: true, tabCount: 1.5 },
            },
          },
        },
      });

      let health = await request.get('/');
      let server = (health.body.included as any[]).find(
        (s) => s.id === serverUrlA,
      );
      assert.deepEqual(
        server.attributes.affinityVacancy,
        { [goodKey]: { idle: true, tabCount: 1 } },
        'only well-formed entries are recorded (tabCount must be a finite non-negative integer)',
      );
    });

    test('heartbeat affinityVacancy rejects prototype-pollution keys', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      let goodKey = realmAffinityKey('https://realm.example/A');

      // Build the payload via JSON.parse so `__proto__` is encoded as a
      // literal property key in the wire payload rather than being treated
      // as the object-literal prototype-setter shortcut (which would leave
      // it out of Object.keys entirely).
      let maliciousPayload = JSON.parse(
        JSON.stringify({
          [goodKey]: { idle: true, tabCount: 1 },
        }).replace(
          '}',
          `,"__proto__":{"idle":true,"tabCount":999},"constructor":{"idle":true,"tabCount":999},"prototype":{"idle":true,"tabCount":999}}`,
        ),
      );

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            status: 'active',
            warmedAffinities: [goodKey],
            affinityVacancy: maliciousPayload,
          },
        },
      });

      // Object.prototype itself must not have been polluted.
      assert.strictEqual(
        ({} as any).tabCount,
        undefined,
        'Object.prototype.tabCount unchanged — __proto__ payload ignored',
      );

      let health = await request.get('/');
      let server = (health.body.included as any[]).find(
        (s) => s.id === serverUrlA,
      );
      assert.deepEqual(
        Object.keys(server.attributes.affinityVacancy),
        [goodKey],
        'only the legitimate key is recorded; prototype-pollution keys are dropped',
      );
    });

    test('heartbeat without affinityVacancy clears previously-reported snapshot (rollback safe)', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      let key = realmAffinityKey('https://realm.example/A');

      // First heartbeat: reports vacancy.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            status: 'active',
            warmedAffinities: [key],
            affinityVacancy: { [key]: { idle: true, tabCount: 1 } },
          },
        },
      });

      let health1 = await request.get('/');
      let server1 = (health1.body.included as any[]).find(
        (s) => s.id === serverUrlA,
      );
      assert.deepEqual(
        server1.attributes.affinityVacancy,
        { [key]: { idle: true, tabCount: 1 } },
        'vacancy recorded on the first heartbeat',
      );

      // Simulate a rollback: same server, next heartbeat omits
      // affinityVacancy. Stale data must not persist.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            status: 'active',
            warmedAffinities: [key],
            // affinityVacancy intentionally omitted
          },
        },
      });

      let health2 = await request.get('/');
      let server2 = (health2.body.included as any[]).find(
        (s) => s.id === serverUrlA,
      );
      assert.deepEqual(
        server2.attributes.affinityVacancy,
        {},
        'vacancy snapshot is cleared when a subsequent heartbeat omits the field',
      );
    });

    test('heartbeat: url required; heartbeat updates warmed affinities and status', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      let registrationResponse = await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            status: 'active',
            warmedAffinities: [
              realmAffinityKey('https://realm.example/warmed'),
            ],
          },
        },
      });
      assert.strictEqual(registrationResponse.status, 204, '204 No Content');
      assert.strictEqual(
        registrationResponse.headers['x-prerender-server-id'],
        serverUrlA,
        'id header',
      );

      let missingInferenceResponse = await request
        .post('/prerender-servers')
        .send({});
      assert.strictEqual(
        missingInferenceResponse.status,
        400,
        'missing url rejected',
      );
    });

    test('proxy: sticky routing with multiplex=1', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '1';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      // register both
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      // sticky to first chosen server for realm R when multiplex=1
      let body = makeBody(
        'https://realm.example/R',
        'https://realm.example/R/1',
      );
      let firstProxyResponse = await request
        .post('/prerender-visit')
        .send(body);
      assert.strictEqual(firstProxyResponse.status, 201, 'proxy 201');
      let firstTarget = firstProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(
        [serverUrlA, serverUrlB].includes(firstTarget),
        'target is one of servers',
      );
      let secondProxyResponse = await request
        .post('/prerender-visit')
        .send(body);
      assert.strictEqual(secondProxyResponse.status, 201, 'proxy 201 again');
      assert.strictEqual(
        secondProxyResponse.headers['x-boxel-prerender-target'],
        firstTarget,
        'sticky with multiplex=1',
      );
    });

    test('proxy: repeated requests stick to the same server (no round-robin) when multiplex>1', async function (assert) {
      // CS-10758: vacancy-first routing replaces the old LRU rotation. Two
      // sequential requests for the same affinity should stay on the same
      // server as long as that server remains the best candidate — stickiness
      // comes from soft tie-break within a priority bucket, not from an
      // explicit round-robin.
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      // register both
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      let body = makeBody(
        'https://realm.example/R',
        'https://realm.example/R/1',
      );
      let firstProxyResponse = await request
        .post('/prerender-visit')
        .send(body);
      let firstTarget = firstProxyResponse.headers['x-boxel-prerender-target'];
      let secondProxyResponse = await request
        .post('/prerender-visit')
        .send(body);
      let secondTarget =
        secondProxyResponse.headers['x-boxel-prerender-target'];
      assert.notStrictEqual(firstTarget, undefined, 'first target exists');
      assert.notStrictEqual(secondTarget, undefined, 'second target exists');
      assert.strictEqual(
        secondTarget,
        firstTarget,
        'subsequent requests stick to the chosen server rather than rotating',
      );

      // capacity: distribute different realms across servers first
      let realm2RequestBody = makeBody(
        'https://realm.example/R2',
        'https://realm.example/R2/1',
      );
      let realm2ProxyResponse = await request
        .post('/prerender-visit')
        .send(realm2RequestBody);
      let realm2Target =
        realm2ProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(
        [serverUrlA, serverUrlB].includes(realm2Target),
        'second affinity assigned to one server',
      );

      // now pressure: third realm
      let realm3RequestBody = makeBody(
        'https://realm.example/R3',
        'https://realm.example/R3/1',
      );
      let realm3ProxyResponse = await request
        .post('/prerender-visit')
        .send(realm3RequestBody);
      let realm3Target =
        realm3ProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(
        [serverUrlA, serverUrlB].includes(realm3Target),
        'pressure assigns to one server',
      );
    });

    test('affinity disposal removes server from affinity mapping', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      let realm = 'https://realm.example/R';
      let body = makeBody(realm, `${realm}/1`);
      let affinityKey = realmAffinityKey(realm);
      let firstProxyResponse = await request
        .post('/prerender-visit')
        .send(body);
      assert.strictEqual(firstProxyResponse.status, 201, 'initial proxy ok');
      let firstTarget = firstProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(firstTarget, 'proxy response includes target header');

      let missingUrlDisposalResponse = await request.delete(
        `/prerender-servers/affinities/${encodeURIComponent(affinityKey)}`,
      );
      assert.strictEqual(
        missingUrlDisposalResponse.status,
        400,
        'affinity disposal requires url query param',
      );

      // simulate prerender server notifying disposal
      let disposalResponse = await request
        .delete(
          `/prerender-servers/affinities/${encodeURIComponent(affinityKey)}`,
        )
        .query({ url: firstTarget as string });
      assert.strictEqual(disposalResponse.status, 204, 'affinity disposal 204');

      // next request should succeed; mapping for that realm should no longer be required
      let secondProxyResponse = await request
        .post('/prerender-visit')
        .send(body);
      assert.strictEqual(
        secondProxyResponse.status,
        201,
        'proxy ok after disposal',
      );
      // should target one of the registered servers
      assert.ok(
        [serverUrlA, serverUrlB].includes(
          secondProxyResponse.headers['x-boxel-prerender-target'],
        ),
      );
    });

    test('affinity disposal selects least recently used idle server when multiplex=1', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '1';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlB },
        },
      });

      let realm = 'https://realm.example/R';
      let body = makeBody(realm, `${realm}/1`);
      let affinityKey = realmAffinityKey(realm);
      let firstProxyResponse = await request
        .post('/prerender-visit')
        .send(body);
      assert.strictEqual(firstProxyResponse.status, 201, 'initial proxy ok');
      let firstTarget = firstProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(firstTarget, 'proxy response includes target header');

      let disposalResponse = await request
        .delete(
          `/prerender-servers/affinities/${encodeURIComponent(affinityKey)}`,
        )
        .query({ url: firstTarget as string });
      assert.strictEqual(disposalResponse.status, 204, 'affinity disposal 204');

      let otherTarget = firstTarget === serverUrlA ? serverUrlB : serverUrlA;
      let secondProxyResponse = await request
        .post('/prerender-visit')
        .send(body);
      assert.strictEqual(
        secondProxyResponse.status,
        201,
        'proxy ok after disposal',
      );
      assert.strictEqual(
        secondProxyResponse.headers['x-boxel-prerender-target'],
        otherTarget,
        'chooses least recently used idle server',
      );
    });

    test('unregister removes server from routing', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      // unregister server A
      let missingUrlUnregisterResponse =
        await request.delete('/prerender-servers');
      assert.strictEqual(
        missingUrlUnregisterResponse.status,
        400,
        'unregister requires url query param',
      );
      let unregisterResponse = await request
        .delete('/prerender-servers')
        .query({ url: serverUrlA as string });
      assert.strictEqual(unregisterResponse.status, 204, 'unregister 204');

      // new affinity should not target A anymore
      let realm2RequestBody = makeBody(
        'https://realm.example/R2',
        'https://realm.example/R2/1',
      );
      let proxyResponse = await request
        .post('/prerender-visit')
        .send(realm2RequestBody);
      assert.strictEqual(proxyResponse.status, 201, 'proxy ok');
      assert.notStrictEqual(
        proxyResponse.headers['x-boxel-prerender-target'],
        serverUrlA,
        'does not target unregistered',
      );
    });

    test('unreachable server is removed by health sweep', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app, sweepServers } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      // Verify both can be targets
      let body = makeBody(
        'https://realm.example/R',
        'https://realm.example/R/1',
      );
      let firstProxyResponse = await request
        .post('/prerender-visit')
        .send(body);
      assert.strictEqual(firstProxyResponse.status, 201, 'initial proxy ok');

      // Stop server A to make it unreachable
      await mockPrerenderA!.stop();

      // Run health sweep to evict unreachable
      await sweepServers();

      // New realm must not target serverUrlA anymore
      let realm2RequestBody = makeBody(
        'https://realm.example/R2',
        'https://realm.example/R2/1',
      );
      let proxyResponse = await request
        .post('/prerender-visit')
        .send(realm2RequestBody);
      assert.strictEqual(proxyResponse.status, 201, 'proxy ok');
      assert.notStrictEqual(
        proxyResponse.headers['x-boxel-prerender-target'],
        serverUrlA,
        'does not target unreachable after sweep',
      );
    });

    test('stale heartbeat removes server from routing', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      process.env.PRERENDER_HEARTBEAT_TIMEOUT_MS = '1';
      let { app, sweepServers, registry } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      // age server A heartbeat
      let infoA = registry.servers.get(serverUrlA as string);
      assert.ok(infoA, 'server A registered');
      if (infoA) {
        infoA.lastSeenAt = Date.now() - 10_000;
      }

      await sweepServers();

      let realm2RequestBody = makeBody(
        'https://realm.example/R2',
        'https://realm.example/R2/1',
      );
      let proxyResponse = await request
        .post('/prerender-visit')
        .send(realm2RequestBody);
      assert.strictEqual(proxyResponse.status, 201, 'proxy ok');
      assert.notStrictEqual(
        proxyResponse.headers['x-boxel-prerender-target'],
        serverUrlA,
        'stale server not targeted after sweep',
      );
    });

    test('manager retries another server when one is draining', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      mockPrerenderA?.setResponder(async (ctxt) => {
        ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
        ctxt.set(
          PRERENDER_SERVER_STATUS_HEADER,
          PRERENDER_SERVER_STATUS_DRAINING,
        );
        ctxt.body = 'draining';
      });

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      let body = makeBody(
        'https://realm.example/retry',
        'https://realm.example/retry/1',
      );
      let response = await request.post('/prerender-visit').send(body);
      assert.strictEqual(response.status, 201, 'proxy succeeds');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlB,
        'draining server skipped in favor of healthy one',
      );
    });

    test('manager prefers warmed affinity when available', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/warmed';

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            warmedAffinities: [realmAffinityKey(realm)],
            affinityVacancy: {
              [realmAffinityKey(realm)]: { idle: true, tabCount: 1 },
            },
          },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      let response = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));

      assert.strictEqual(response.status, 201, 'proxy ok');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlA,
        'manager prefers warm+idle server for realm (warm+idle beats cold+idle)',
      );
    });

    test('does not treat warmed user affinity as warmed realm affinity for the same value', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let sharedValue = 'https://affinity.example/shared';

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            warmedAffinities: [userAffinityKey(sharedValue)],
            affinityVacancy: {
              [userAffinityKey(sharedValue)]: { idle: true, tabCount: 1 },
            },
          },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlB,
            warmedAffinities: [realmAffinityKey(sharedValue)],
            affinityVacancy: {
              [realmAffinityKey(sharedValue)]: { idle: true, tabCount: 1 },
            },
          },
        },
      });

      let response = await request
        .post('/prerender-visit')
        .send(makeBody(sharedValue, `${sharedValue}/1`));

      assert.strictEqual(response.status, 201, 'proxy ok');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlB,
        'realm request prefers realm-warmed server, not user-warmed server',
      );
    });

    test('run-command prefers user-warmed server', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      let realm = 'https://realm.example/commands/';
      let runAs = '@alice:localhost';
      let command = `${realm}commands/say-hello/SayHelloCommand`;

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            warmedAffinities: [realmAffinityKey(realm)],
            affinityVacancy: {
              [realmAffinityKey(realm)]: { idle: true, tabCount: 1 },
            },
          },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlB,
            warmedAffinities: [userAffinityKey(runAs)],
            affinityVacancy: {
              [userAffinityKey(runAs)]: { idle: true, tabCount: 1 },
            },
          },
        },
      });

      let response = await request
        .post('/run-command')
        .send(makeCommandBody(realm, command, runAs));

      assert.strictEqual(response.status, 201, 'command proxy ok');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlB,
        'command request prefers user-warmed server',
      );
    });

    // ---- CS-10758 warm-vacancy-first routing ----

    test('warm+idle beats cold+idle across servers', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/vacancy-warm-beats-cold';

      // Server A: cold for this affinity, has capacity.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      // Server B: warm + idle for this affinity.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlB,
            affinityVacancy: {
              [realmAffinityKey(realm)]: { idle: true, tabCount: 1 },
            },
          },
        },
      });

      let response = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));
      assert.strictEqual(response.status, 201, 'proxy ok');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlB,
        'warm+idle B wins over cold+idle A',
      );
    });

    test('cold+idle beats warm+busy', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/vacancy-cold-beats-busy';

      // Server A: fresh, cold for this affinity, has capacity.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      // Server B: warm for this affinity but every tab is busy.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlB,
            affinityVacancy: {
              [realmAffinityKey(realm)]: { idle: false, tabCount: 1 },
            },
          },
        },
      });

      let response = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));
      assert.strictEqual(response.status, 201, 'proxy ok');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlA,
        'cold+idle A wins over warm+busy B — don’t queue behind a busy warm tab when an idle cold one is available',
      );
    });

    test('warm+busy with spare capacity does not collapse into cold+idle', async function (assert) {
      // Regression guard: in scoreCandidate the warm+busy branch must be
      // evaluated before the hasCapacity(info) branch. A server whose tab
      // for the requested affinity is busy but which still has overall
      // capacity for other affinities otherwise registers as bucket 1
      // (cold+idle), which would break the cold+idle > warm+busy invariant
      // — we'd pick the warm+busy tab and queue behind it even though
      // another server was genuinely cold+idle.
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/warm-busy-spare-capacity';

      // Server A: warm for realm but the tab is busy. Capacity=4 with only
      // the realm affinity claimed, so hasCapacity(info) is true — this is
      // the bucket-ordering trap.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlA,
            affinityVacancy: {
              [realmAffinityKey(realm)]: { idle: false, tabCount: 1 },
            },
          },
        },
      });
      // Server B: plain cold+idle.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 4, url: serverUrlB },
        },
      });

      let response = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));
      assert.strictEqual(response.status, 201, 'proxy ok');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlB,
        'cold+idle B wins over warm+busy-with-capacity A (bucket classification order)',
      );
    });

    test('warm+idle elsewhere beats warm+busy on an already-assigned server', async function (assert) {
      // CS-10758: stickiness is soft. At multiplex=1 a previously-assigned
      // server that is warm+busy should still lose to a warm+idle server
      // somewhere else, because warm+idle beats warm+busy across the fleet.
      process.env.PRERENDER_MULTIPLEX = '1';
      let { app, registry, chooseServerForAffinity } =
        buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/stickiness-soft';
      let affinityKey = realmAffinityKey(realm);

      // Server A: warm + busy for realm (tab rendering something else).
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            affinityVacancy: {
              [affinityKey]: { idle: false, tabCount: 1 },
            },
          },
        },
      });
      // Server B: warm + idle for realm.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlB,
            affinityVacancy: {
              [affinityKey]: { idle: true, tabCount: 1 },
            },
          },
        },
      });
      // Seed A as the previously-assigned server for realm to simulate a
      // prior successful route before the tab went busy.
      registry.affinities.set(affinityKey, [serverUrlA!]);

      let target = chooseServerForAffinity('realm', realm);
      assert.strictEqual(
        target,
        serverUrlB,
        'warm+idle B wins over assigned-but-busy A (stickiness is soft)',
      );
    });

    test('warm+busy is chosen only when no idle tab exists anywhere', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/vacancy-warm-busy-last-resort';
      let otherRealm = 'https://realm.example/vacancy-other-realm';

      // Server A: saturated — warm+busy for another realm, at capacity.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 1,
            url: serverUrlA,
            warmedAffinities: [realmAffinityKey(otherRealm)],
            affinityVacancy: {
              [realmAffinityKey(otherRealm)]: { idle: false, tabCount: 1 },
            },
          },
        },
      });
      // Pin the other-realm affinity on A so A is at capacity.
      await request.post('/prerender-visit').send(makeBody(otherRealm, '1'));

      // Server B: warm + busy for the *requested* realm, at capacity.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 1,
            url: serverUrlB,
            warmedAffinities: [realmAffinityKey(realm)],
            affinityVacancy: {
              [realmAffinityKey(realm)]: { idle: false, tabCount: 1 },
            },
          },
        },
      });
      // Pin the target realm on B so B is also at capacity.
      await request.post('/prerender-visit').send(makeBody(realm, '1'));

      // Next visit for realm: no idle tab exists anywhere. B is warm+busy for
      // realm, A is cold+busy (warm for other realm). B should win.
      let response = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/2`));
      assert.strictEqual(response.status, 201, 'proxy ok');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlB,
        'warm+busy B beats cold+busy A when nothing idle exists',
      );
    });

    // ---- priority-aware routing within a vacancy bucket ----

    test('within warm+busy bucket: high-priority request prefers server with low-priority pending', async function (assert) {
      // Two warm+busy servers compete for a priority-10 request. Server
      // A's queue is all priority-0 work, server B's queue includes a
      // priority-10 entry. The priority-10 incoming request would jump
      // to the head on A (its priority strictly beats A's pending work)
      // but would queue behind on B. The router prefers A.
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app, chooseServerForAffinity } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/priority-bucket-tiebreak';
      let affinityKey = realmAffinityKey(realm);

      // Server A: warm + busy, queue is all priority-0.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlA,
            affinityVacancy: {
              [affinityKey]: {
                idle: false,
                tabCount: 1,
                maxPendingPriority: 0,
              },
            },
          },
        },
      });
      // Server B: warm + busy, queue already has priority-10 work.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlB,
            affinityVacancy: {
              [affinityKey]: {
                idle: false,
                tabCount: 1,
                maxPendingPriority: 10,
              },
            },
          },
        },
      });

      let target = chooseServerForAffinity('realm', realm, { priority: 10 });
      assert.strictEqual(
        target,
        serverUrlA,
        'priority-10 request prefers warm+busy A (queue has no >=10 work) over warm+busy B (queue has priority-10 work)',
      );
    });

    test('priority preference does not override bucket: cold+idle still beats warm+busy with priority-10', async function (assert) {
      // Soft tie-break: priority preference must not promote a cold+idle
      // candidate above a warm+busy one. Warmth is the primary signal —
      // the cold-tab penalty would re-emerge if priority routing
      // overrode warmth. Verify by giving the warm+busy server a queue
      // full of priority-10 work and routing a priority-10 request: the
      // warm+busy server should still win on bucket alone.
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app, chooseServerForAffinity } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/priority-doesnt-override-warmth';
      let affinityKey = realmAffinityKey(realm);

      // Server A: cold+idle.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 4, url: serverUrlA },
        },
      });
      // Server B: warm+busy, queue full of priority-10 work.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlB,
            affinityVacancy: {
              [affinityKey]: {
                idle: false,
                tabCount: 1,
                maxPendingPriority: 10,
              },
            },
          },
        },
      });

      let target = chooseServerForAffinity('realm', realm, { priority: 10 });
      assert.strictEqual(
        target,
        serverUrlA,
        'cold+idle A wins over warm+busy B per the warmth bucket order — priority preference is a within-bucket tie-break only, never overrides the cold+idle > warm+busy invariant',
      );
    });

    test('legacy server (no maxPendingPriority) is not demoted by priority preference', async function (assert) {
      // During a rolling deploy a legacy prerender server's heartbeat
      // omits maxPendingPriority. scoreCandidate must treat absent =
      // preferred (priorityPref = 0) so the legacy server isn't pushed
      // behind a fully-reporting peer that happens to have any pending
      // queue. Verify by giving both servers warm+busy state, only the
      // upgraded one reporting priority data, and routing a priority-10
      // request — the legacy server keeps its warmth advantage.
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app, chooseServerForAffinity } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/priority-legacy-server';
      let affinityKey = realmAffinityKey(realm);

      // Server A: legacy heartbeat — no maxPendingPriority. busy, but the
      // priority bar is unknown, so router treats it as preferred.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlA,
            affinityVacancy: {
              [affinityKey]: { idle: false, tabCount: 1 },
            },
          },
        },
      });
      // Server B: upgraded, reports a priority-10 ceiling. Same warmth
      // bucket otherwise.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlB,
            affinityVacancy: {
              [affinityKey]: {
                idle: false,
                tabCount: 1,
                maxPendingPriority: 10,
              },
            },
          },
        },
      });

      let target = chooseServerForAffinity('realm', realm, { priority: 10 });
      assert.strictEqual(
        target,
        serverUrlA,
        'legacy server A (no priority data → priorityPref=0) ties B on warmth and beats it on priorityPref',
      );
    });

    test('priority from request body is threaded through to scoreCandidate', async function (assert) {
      // Integration check: when the request body includes
      // `attributes.priority`, the proxy parses it and passes it into
      // chooseServerForAffinity. Confirm by setting up two warm+busy
      // candidates differing only in maxPendingPriority and verifying
      // the priority-10 body is routed to the lower-pending server.
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/priority-from-request-body';
      let affinityKey = realmAffinityKey(realm);

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlA,
            affinityVacancy: {
              [affinityKey]: {
                idle: false,
                tabCount: 1,
                maxPendingPriority: 0,
              },
            },
          },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlB,
            affinityVacancy: {
              [affinityKey]: {
                idle: false,
                tabCount: 1,
                maxPendingPriority: 10,
              },
            },
          },
        },
      });

      let body = makeBody(realm, `${realm}/1`);
      (body.data.attributes as any).priority = 10;
      let response = await request.post('/prerender-visit').send(body);
      assert.strictEqual(response.status, 201, 'proxy ok');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlA,
        'priority-10 in request body routes to the warm+busy server with the lower priority ceiling',
      );
    });

    test('tie-break among warm+idle: fewer active affinities wins', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app, registry } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/tie-load';
      let affinityKey = realmAffinityKey(realm);

      // Both servers warm + idle for realm.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlA,
            affinityVacancy: {
              [affinityKey]: { idle: true, tabCount: 1 },
            },
          },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 4,
            url: serverUrlB,
            affinityVacancy: {
              [affinityKey]: { idle: true, tabCount: 1 },
            },
          },
        },
      });

      // Simulate A already hosting a couple of other affinities (heavier
      // load) — B has none.
      let aInfo = registry.servers.get(serverUrlA!)!;
      aInfo.activeAffinities.add('realm:https://example/other1');
      aInfo.activeAffinities.add('realm:https://example/other2');

      let response = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));
      assert.strictEqual(response.status, 201, 'proxy ok');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlB,
        'tie among warm+idle broken by fewer active affinities',
      );
    });

    test('replacement after affinity disposal routes to a remaining warm+idle server', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/replacement-warm';
      let affinityKey = realmAffinityKey(realm);

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            affinityVacancy: {
              [affinityKey]: { idle: true, tabCount: 1 },
            },
          },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlB,
            affinityVacancy: {
              [affinityKey]: { idle: true, tabCount: 1 },
            },
          },
        },
      });

      // First visit lands on one of the two (either is warm+idle).
      let first = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));
      let chosen = first.headers['x-boxel-prerender-target'];
      assert.ok([serverUrlA, serverUrlB].includes(chosen), 'first routed');

      // Dispose the affinity from the chosen server (simulate server-side
      // eviction — the server would on its next heartbeat drop the affinity
      // from affinityVacancy).
      await request.delete(
        `/prerender-servers/affinities/${encodeURIComponent(affinityKey)}?url=${encodeURIComponent(chosen)}`,
      );
      let otherUrl = chosen === serverUrlA ? serverUrlB : serverUrlA;
      // Remove the evicted server's warm vacancy via a new heartbeat (the
      // server would publish this after eviction completes).
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: chosen,
            affinityVacancy: {},
          },
        },
      });

      let second = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/2`));
      assert.strictEqual(
        second.headers['x-boxel-prerender-target'],
        otherUrl,
        'post-eviction replacement routes to the other warm+idle server',
      );
    });

    test('replacement falls back to cold+idle when no warm tab remains', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/replacement-cold';
      let affinityKey = realmAffinityKey(realm);

      // Server A starts warm+idle; server B is only cold+idle.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            affinityVacancy: {
              [affinityKey]: { idle: true, tabCount: 1 },
            },
          },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      let first = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));
      assert.strictEqual(
        first.headers['x-boxel-prerender-target'],
        serverUrlA,
        'first routed to warm A',
      );

      // A evicts the affinity and reports no vacancy for it.
      await request.delete(
        `/prerender-servers/affinities/${encodeURIComponent(affinityKey)}?url=${encodeURIComponent(serverUrlA!)}`,
      );
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            affinityVacancy: {},
          },
        },
      });

      let second = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/2`));
      assert.ok(
        [serverUrlA, serverUrlB].includes(
          second.headers['x-boxel-prerender-target'],
        ),
        'falls back to a cold+idle server',
      );
    });

    test('legacy server without affinityVacancy is treated as cold and loses to a warm+idle server', async function (assert) {
      // During a rolling deploy, older servers send no `affinityVacancy`
      // field. Their affinities register as cold, so they lose to any
      // server publishing warm+idle vacancy — safe: first visit re-warms.
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/legacy-rollout';

      // Legacy server A: reports warmedAffinities but no affinityVacancy.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            warmedAffinities: [realmAffinityKey(realm)],
          },
        },
      });
      // Modern server B: reports affinityVacancy warm+idle.
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlB,
            affinityVacancy: {
              [realmAffinityKey(realm)]: { idle: true, tabCount: 1 },
            },
          },
        },
      });

      let response = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlB,
        'routing trusts affinityVacancy over legacy warmedAffinities',
      );
    });

    test('pressure mode skips unusable LRU server and falls back to healthy', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app, registry, chooseServerForAffinity } =
        buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      // seed LRU realm with both servers so pressure mode has multiple candidates
      let lruRealm = 'https://realm.example/lru';
      let lruAffinityKey = realmAffinityKey(lruRealm);
      registry.affinities.set(lruAffinityKey, [
        serverUrlA as string,
        serverUrlB as string,
      ]);
      registry.lastAccessByAffinity.set(lruAffinityKey, Date.now() - 1000);
      registry.servers.get(serverUrlA!)!.activeAffinities.add(lruAffinityKey);
      registry.servers.get(serverUrlB!)!.activeAffinities.add(lruAffinityKey);

      // make A unusable
      let infoA = registry.servers.get(serverUrlA!);
      if (infoA) {
        infoA.status = 'draining';
      }

      // simulate full capacity to bypass earlier capacity selection
      registry.servers.get(serverUrlA!)!.activeAffinities.add('fillA');
      registry.servers.get(serverUrlB!)!.activeAffinities.add('fillB');

      // choose for new affinity should drop A and pick B from LRU set
      let realm = 'https://realm.example/new';
      let target = chooseServerForAffinity('realm', realm);
      assert.strictEqual(
        target,
        serverUrlB,
        'selects healthy server after dropping unusable LRU entry',
      );
      assert.false(
        registry.servers.get(serverUrlA!)?.activeAffinities.has(lruAffinityKey),
        'unusable server activeAffinities cleaned up',
      );
      let lruMapping = registry.affinities.get(lruAffinityKey) || [];
      assert.false(
        lruMapping.includes(serverUrlA as string),
        'LRU mapping drops unusable',
      );
      if (lruMapping.length === 0) {
        assert.deepEqual(
          lruMapping,
          [],
          'LRU mapping can be empty after pruning',
        );
      } else {
        assert.deepEqual(
          lruMapping,
          [serverUrlB],
          'LRU mapping pruned to healthy server',
        );
      }
    });

    test('cleanup keeps activeAffinities in sync so capacity is restored after draining', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '1';
      let { app, registry } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlA },
        },
      });

      // initial assignment
      let realm1 = 'https://realm.example/one';
      let res1 = await request
        .post('/prerender-visit')
        .send(makeBody(realm1, `${realm1}/1`));
      assert.strictEqual(res1.status, 201, 'first prerender ok');
      assert.strictEqual(
        registry.servers.get(serverUrlA!)?.activeAffinities.size,
        1,
        'activeAffinities tracked',
      );

      // mark draining and trigger cleanup via a new request (will 503)
      let info = registry.servers.get(serverUrlA!);
      assert.ok(info, 'server info present');
      if (info) {
        info.status = 'draining';
      }
      let realm2 = 'https://realm.example/two';
      let res2 = await request
        .post('/prerender-visit')
        .send(makeBody(realm2, `${realm2}/1`));
      assert.strictEqual(res2.status, 503, 'no servers while draining');
      assert.strictEqual(
        registry.servers.get(serverUrlA!)?.activeAffinities.size,
        0,
        'activeAffinities cleared when assignments dropped',
      );

      // back to active; capacity should allow new assignment
      if (info) {
        info.status = 'active';
        info.lastSeenAt = Date.now();
      }
      let realm3 = 'https://realm.example/three';
      let res3 = await request
        .post('/prerender-visit')
        .send(makeBody(realm3, `${realm3}/1`));
      assert.strictEqual(res3.status, 201, 'prerender ok after recovery');
      assert.true(
        registry.servers
          .get(serverUrlA!)
          ?.activeAffinities.has(realmAffinityKey(realm3)) as boolean,
        'affinity assigned after capacity restored',
      );
    });

    test('pressure mode assignment updates activeAffinities for capacity accounting', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '1';
      let { app, registry, chooseServerForAffinity } =
        buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });

      let lruRealm = 'https://realm.example/lru';
      let lruAffinityKey = realmAffinityKey(lruRealm);
      let first = chooseServerForAffinity('realm', lruRealm);
      assert.strictEqual(first, serverUrlA, 'initial affinity assigned');
      registry.lastAccessByAffinity.set(lruAffinityKey, Date.now() - 1000);

      let newRealm = 'https://realm.example/new-capacity';
      let target = chooseServerForAffinity('realm', newRealm, {
        exclude: [serverUrlA as string],
      });
      assert.strictEqual(
        target,
        serverUrlA,
        'pressure mode selects server even when excluded',
      );
      assert.true(
        registry.servers
          .get(serverUrlA!)
          ?.activeAffinities.has(realmAffinityKey(newRealm)) as boolean,
        'activeAffinities updated for new affinity',
      );
    });

    test('returns draining response if all targets are draining', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      // Both responders return draining
      mockPrerenderA?.setResponder(async (ctxt) => {
        ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
        ctxt.set(
          PRERENDER_SERVER_STATUS_HEADER,
          PRERENDER_SERVER_STATUS_DRAINING,
        );
      });
      mockPrerenderB?.setResponder(async (ctxt) => {
        ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
        ctxt.set(
          PRERENDER_SERVER_STATUS_HEADER,
          PRERENDER_SERVER_STATUS_DRAINING,
        );
      });

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      let realm = 'https://realm.example/draining';
      let res = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));

      assert.strictEqual(
        res.status,
        PRERENDER_SERVER_DRAINING_STATUS_CODE,
        'returns draining when all servers draining',
      );
      assert.strictEqual(
        res.headers[PRERENDER_SERVER_STATUS_HEADER.toLowerCase()],
        PRERENDER_SERVER_STATUS_DRAINING,
        'sets draining header',
      );
      assert.strictEqual(
        res.body?.errors?.[0]?.message,
        'All prerender servers draining',
        'helpful message',
      );
    });

    test('returns draining immediately when manager is draining (no proxy)', async function (assert) {
      let draining = true;
      let { app } = buildPrerenderManagerApp({ isDraining: () => draining });
      let request: SuperTest<Test> = supertest(app.callback());

      let res = await request
        .post('/prerender-visit')
        .send(
          makeBody(
            'https://realm.example/drain-manager',
            'https://realm.example/drain-manager/1',
          ),
        );
      assert.strictEqual(
        res.status,
        PRERENDER_SERVER_DRAINING_STATUS_CODE,
        '410 when manager draining',
      );
      assert.strictEqual(
        res.headers[PRERENDER_SERVER_STATUS_HEADER.toLowerCase()],
        PRERENDER_SERVER_STATUS_DRAINING,
        'draining header set',
      );
      assert.strictEqual(
        res.body?.errors?.[0]?.message,
        'Prerender manager draining',
        'draining message returned',
      );
    });

    test('returns draining when manager starts draining during an in-flight proxy', async function (assert) {
      let draining = false;
      let { app } = buildPrerenderManagerApp({ isDraining: () => draining });
      let request: SuperTest<Test> = supertest(app.callback());
      let blocker = new Deferred<void>();
      let hits = 0;
      mockPrerenderA?.setResponder(async (ctxt) => {
        hits++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        ctxt.status = 201;
        ctxt.set('Content-Type', 'application/vnd.api+json');
        ctxt.body = JSON.stringify({ data: { attributes: { ok: true } } });
        blocker.fulfill();
      });

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlA },
        },
      });

      let resPromise = request
        .post('/prerender-visit')
        .send(
          makeBody(
            'https://realm.example/drain-midflight',
            'https://realm.example/drain-midflight/1',
          ),
        );

      // start draining shortly after proxying begins
      await new Promise((resolve) => setTimeout(resolve, 10));
      draining = true;

      let res = await resPromise;
      assert.strictEqual(
        res.status,
        PRERENDER_SERVER_DRAINING_STATUS_CODE,
        'returns draining status when shutdown begins mid-flight',
      );
      assert.strictEqual(
        res.headers[PRERENDER_SERVER_STATUS_HEADER.toLowerCase()],
        PRERENDER_SERVER_STATUS_DRAINING,
        'sets draining header',
      );
      assert.ok(hits >= 0, 'request handled');
    });

    test('recovers when a prerender server disappears without draining', async function (assert) {
      let { app, registry } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlA },
        },
      });

      // stop the server before proxying so fetch will fail
      await mockPrerenderA?.stop();

      let res = await request
        .post('/prerender-visit')
        .send(
          makeBody(
            'https://realm.example/lost-server',
            'https://realm.example/lost-server/1',
          ),
        );

      assert.strictEqual(res.status, 503, 'returns 503 on upstream failure');
      assert.strictEqual(
        res.body?.errors?.[0]?.message,
        'No servers',
        'reports no servers',
      );
      assert.strictEqual(
        registry.servers.size,
        0,
        'failed server pruned from registry',
      );
    });

    test('retries another server when the first returns 500', async function (assert) {
      let { app, registry } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlB },
        },
      });

      mockPrerenderA?.setResponder((ctxt) => {
        ctxt.status = 500;
        ctxt.body = JSON.stringify({
          errors: [{ status: 500, message: 'Protocol error (Target closed)' }],
        });
      });
      mockPrerenderB?.setResponder((ctxt) => {
        ctxt.status = 201;
        ctxt.set('Content-Type', 'application/vnd.api+json');
        ctxt.body = JSON.stringify({ data: { attributes: { ok: true } } });
      });

      let res = await request
        .post('/prerender-visit')
        .send(
          makeBody(
            'https://realm.example/server-error',
            'https://realm.example/server-error/1',
          ),
        );

      assert.strictEqual(res.status, 201, 'falls back to second server');
      assert.strictEqual(
        res.headers['x-boxel-prerender-target'],
        serverUrlB,
        'routed to healthy server',
      );
      assert.false(
        registry.servers.has(serverUrlA!),
        'unhealthy server pruned from registry',
      );
    });

    test('maintenance reset clears realm assignments', async function (assert) {
      let { app, registry } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlA },
        },
      });
      let realm = 'https://realm.example/reset';
      let affinityKey = realmAffinityKey(realm);
      await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));
      assert.true(
        registry.servers
          .get(serverUrlA!)
          ?.activeAffinities.has(affinityKey) as boolean,
        'affinity assigned before reset',
      );

      let resetRes = await request.post('/prerender-maintenance/reset');
      assert.strictEqual(resetRes.status, 204, 'reset endpoint 204');

      assert.false(
        registry.servers
          .get(serverUrlA!)
          ?.activeAffinities.has(affinityKey) as boolean,
        'activeAffinities cleared after reset',
      );
      assert.false(
        registry.affinities.has(affinityKey),
        'affinity mapping cleared',
      );
    });

    test('pressure mode evicts LRU realm when all servers at capacity', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '1';
      let { app, registry } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlA },
        },
      });

      let realm1 = 'https://realm.example/experiments/';
      let realm2 = 'https://realm.example/new';

      let res1 = await request
        .post('/prerender-visit')
        .send(makeBody(realm1, `${realm1}1`));
      assert.strictEqual(res1.status, 201, 'first affinity assigned');

      let res2 = await request
        .post('/prerender-visit')
        .send(makeBody(realm2, `${realm2}/1`));
      assert.strictEqual(
        res2.status,
        201,
        'second realm succeeds via eviction',
      );

      assert.false(
        registry.affinities.has(realmAffinityKey(realm1)),
        'evicted affinity mapping removed after steal',
      );
      assert.true(
        registry.servers
          .get(serverUrlA!)
          ?.activeAffinities.has(realmAffinityKey(realm2)) as boolean,
        'new affinity assigned to server after eviction',
      );
    });

    test('heartbeat clears stale active affinities when warmedAffinities are empty', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '1';
      let { app, registry, chooseServerForAffinity } =
        buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlA },
        },
      });

      let staleRealm = 'https://realm.example/stale';
      let staleAffinityKey = realmAffinityKey(staleRealm);
      registry.servers.get(serverUrlA!)?.activeAffinities.add(staleAffinityKey);
      registry.affinities.set(staleAffinityKey, [serverUrlA as string]);

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 1,
            url: serverUrlA,
            warmedAffinities: [],
          },
        },
      });

      assert.strictEqual(
        registry.servers.get(serverUrlA!)?.activeAffinities.size,
        0,
        'activeAffinities cleared on heartbeat',
      );
      assert.false(
        registry.affinities.has(staleAffinityKey),
        'affinity mapping removed',
      );

      let newRealm = 'https://realm.example/newafterclear';
      let target = chooseServerForAffinity('realm', newRealm);
      assert.strictEqual(target, serverUrlA, 'server reused after clear');
    });

    test('returns 503 when no prerender servers are registered', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let res = await request
        .post('/prerender-visit')
        .send(
          makeBody(
            'https://realm.example/none',
            'https://realm.example/none/1',
          ),
        );
      assert.strictEqual(res.status, 503, '503 when no servers available');
      assert.strictEqual(
        res.body?.errors?.[0]?.message,
        'No servers',
        'response includes helpful message',
      );
    });

    test('waits for discovery when registry empty before returning 503', async function (assert) {
      process.env.PRERENDER_SERVER_DISCOVERY_WAIT_MS = '500';
      process.env.PRERENDER_SERVER_DISCOVERY_POLL_MS = '25';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      // schedule heartbeat registration shortly after request starts
      let registration = new Promise<void>((resolve) => {
        setTimeout(() => {
          request
            .post('/prerender-servers')
            .send({
              data: {
                type: 'prerender-server',
                attributes: { capacity: 2, url: serverUrlA },
              },
            })
            .then(() => resolve())
            .catch(() => resolve());
        }, 100);
      });

      let res = await request
        .post('/prerender-visit')
        .send(
          makeBody(
            'https://realm.example/discovery',
            'https://realm.example/discovery/1',
          ),
        );
      await registration;

      assert.strictEqual(
        res.status,
        201,
        'request succeeds after discovery wait',
      );
      assert.strictEqual(
        res.headers['x-boxel-prerender-target'],
        serverUrlA,
        'request routed to newly registered server',
      );
    });

    // ---- CS-10758 step 3: /release-batch broadcast ----

    test('release-batch broadcasts to every server assigned to the affinity', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app, registry } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/release-broadcast';

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      // Pin the affinity to both servers directly. Issuing two prerender-visits
      // wouldn't work here: under vacancy-first routing (CS-10758 step 2), the
      // second visit prefers the already-assigned server on an assignedPref
      // tie-break and both requests stick to A. What we're exercising is the
      // broadcast fanout once an affinity has been assigned to multiple
      // servers, not the routing that got it there.
      let affinityKey = realmAffinityKey(realm);
      registry.affinities.set(affinityKey, [serverUrlA!, serverUrlB!]);
      registry.servers.get(serverUrlA!)!.activeAffinities.add(affinityKey);
      registry.servers.get(serverUrlB!)!.activeAffinities.add(affinityKey);

      let res = await request.post('/release-batch').send({
        data: {
          type: 'release-batch-request',
          attributes: {
            batchId: 'job-42-abcd',
            affinityType: 'realm',
            affinityValue: realm,
          },
        },
      });
      assert.strictEqual(res.status, 204, 'broadcast returned 204');
      let aCalls = mockPrerenderA?.releaseBatchCalls ?? [];
      let bCalls = mockPrerenderB?.releaseBatchCalls ?? [];
      assert.deepEqual(
        aCalls,
        [
          {
            batchId: 'job-42-abcd',
            affinityType: 'realm',
            affinityValue: realm,
          },
        ],
        'server A received the release-batch',
      );
      assert.deepEqual(
        bCalls,
        [
          {
            batchId: 'job-42-abcd',
            affinityType: 'realm',
            affinityValue: realm,
          },
        ],
        'server B received the release-batch',
      );
    });

    test('release-batch skips servers not assigned to the affinity', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '1';
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let realm = 'https://realm.example/release-scoped';

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlB },
        },
      });

      // multiplex=1 so only one server gets the affinity
      let firstVisit = await request
        .post('/prerender-visit')
        .send(makeBody(realm, `${realm}/1`));
      let assignedServer = firstVisit.headers['x-boxel-prerender-target'];
      let otherServer = assignedServer === serverUrlA ? serverUrlB : serverUrlA;

      let res = await request.post('/release-batch').send({
        data: {
          type: 'release-batch-request',
          attributes: {
            batchId: 'job-42-abcd',
            affinityType: 'realm',
            affinityValue: realm,
          },
        },
      });
      assert.strictEqual(res.status, 204);

      let assignedCalls =
        assignedServer === serverUrlA
          ? (mockPrerenderA?.releaseBatchCalls ?? [])
          : (mockPrerenderB?.releaseBatchCalls ?? []);
      let otherCalls =
        otherServer === serverUrlA
          ? (mockPrerenderA?.releaseBatchCalls ?? [])
          : (mockPrerenderB?.releaseBatchCalls ?? []);
      assert.strictEqual(
        assignedCalls.length,
        1,
        'assigned server received the release-batch',
      );
      assert.strictEqual(
        otherCalls.length,
        0,
        'unassigned server did NOT receive the release-batch',
      );
    });

    test('release-batch rejects invalid request attributes', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      let missingBatchId = await request.post('/release-batch').send({
        data: {
          type: 'release-batch-request',
          attributes: {
            affinityType: 'realm',
            affinityValue: 'https://realm.example/',
          },
        },
      });
      assert.strictEqual(
        missingBatchId.status,
        400,
        'missing batchId is rejected',
      );

      let badType = await request.post('/release-batch').send({
        data: {
          type: 'release-batch-request',
          attributes: {
            batchId: 'job-1-abcd',
            affinityType: 'bogus',
            affinityValue: 'https://realm.example/',
          },
        },
      });
      assert.strictEqual(
        badType.status,
        400,
        'unknown affinityType is rejected',
      );
    });

    test('returns draining immediately when manager is draining', async function (assert) {
      let draining = true;
      let { app } = buildPrerenderManagerApp({
        isDraining: () => draining,
      });
      let request: SuperTest<Test> = supertest(app.callback());

      let hits = 0;
      mockPrerenderA?.setResponder((ctxt) => {
        hits++;
        ctxt.status = 201;
        ctxt.set('Content-Type', 'application/vnd.api+json');
        ctxt.body = JSON.stringify({ data: { attributes: { ok: true } } });
      });

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });

      let res = await request
        .post('/prerender-visit')
        .send(
          makeBody(
            'https://realm.example/draining',
            'https://realm.example/draining/1',
          ),
        );

      assert.strictEqual(
        res.status,
        PRERENDER_SERVER_DRAINING_STATUS_CODE,
        'returns draining status',
      );
      assert.strictEqual(
        res.headers[PRERENDER_SERVER_STATUS_HEADER.toLowerCase()],
        PRERENDER_SERVER_STATUS_DRAINING,
        'sets draining header',
      );
      assert.strictEqual(hits, 0, 'does not proxy to prerender server');
    });

    module('client-abort propagation (CS-10873)', function () {
      // The manager's `proxyStart`/ctxt.req close hook aborts the
      // upstream fetch when the client disconnects mid-flight.
      // Exercise it by spinning up a real HTTP listener (supertest's
      // in-memory transport can't simulate a socket close cleanly)
      // and tearing down the client request while the mock prerender
      // is deliberately hung.
      test('client closing the socket aborts the upstream fetch', async function (assert) {
        let { app } = buildPrerenderManagerApp();
        let managerServer = createServer(app.callback());
        await new Promise<void>((resolve) =>
          managerServer.listen(0, () => resolve()),
        );
        let managerPort = (managerServer.address() as any).port;
        try {
          let realm = 'https://realm.example/abort-test';
          let cardURL = `${realm}/1`;

          // Tell the mock to hang on the request and report back
          // whether its inbound TCP socket closes (which is what we
          // get from undici when it cancels the fetch). We watch the
          // socket rather than `ctxt.req` because Node 17+ auto-
          // destroys IncomingMessage after the body is consumed —
          // `ctxt.req.close` fires during normal flow and wouldn't
          // distinguish "manager aborted us" from "body read done".
          let upstreamHit = new Deferred<void>();
          let upstreamSocketClosed = new Deferred<void>();
          mockPrerenderA!.setResponder(async (ctxt) => {
            upstreamHit.fulfill();
            ctxt.req.socket?.on('close', () => upstreamSocketClosed.fulfill());
            // Never respond — wait forever. The outer test cleanup
            // will tear down the server and flush this handler.
            await new Promise(() => {});
          });

          // Register the mock.
          await new Promise<void>((resolve, reject) => {
            let req = http.request(
              {
                hostname: '127.0.0.1',
                port: managerPort,
                path: '/prerender-servers',
                method: 'POST',
                headers: { 'Content-Type': 'application/vnd.api+json' },
              },
              (res) => {
                res.resume();
                res.on('end', () => resolve());
              },
            );
            req.on('error', reject);
            req.write(
              JSON.stringify({
                data: {
                  type: 'prerender-server',
                  attributes: { capacity: 2, url: serverUrlA },
                },
              }),
            );
            req.end();
          });

          // Fire the prerender-visit request via a raw http client
          // so we can destroy the socket mid-flight (which is what a
          // real worker-gave-up scenario looks like).
          let clientReq = http.request({
            hostname: '127.0.0.1',
            port: managerPort,
            path: '/prerender-visit',
            method: 'POST',
            headers: { 'Content-Type': 'application/vnd.api+json' },
          });
          clientReq.on('error', () => {
            // expected on destroy
          });
          clientReq.write(JSON.stringify(makeBody(realm, cardURL)));
          clientReq.end();

          // Wait until the mock has the request in hand, then kill
          // the client side.
          await upstreamHit.promise;
          clientReq.destroy();

          // Manager should have propagated the abort to the upstream.
          // We wait (bounded) for the mock's inbound socket to close.
          let closedInTime = await Promise.race([
            upstreamSocketClosed.promise.then(() => true),
            new Promise<boolean>((resolve) =>
              setTimeout(() => resolve(false), 2000),
            ),
          ]);
          assert.true(
            closedInTime,
            'manager aborted upstream fetch after client disconnect',
          );
        } finally {
          await new Promise<void>((resolve) =>
            managerServer.close(() => resolve()),
          );
        }
      });

      test('aborting before discovery completes does not route to any server', async function (assert) {
        // When the registry is empty and discoveryWaitMs is high,
        // the manager polls waiting for a server to register. A
        // client abort during that wait must exit the poll loop
        // without later falling through to a proxy attempt.
        process.env.PRERENDER_SERVER_DISCOVERY_WAIT_MS = '5000';
        process.env.PRERENDER_SERVER_DISCOVERY_POLL_MS = '25';
        let { app } = buildPrerenderManagerApp();
        let managerServer = createServer(app.callback());
        await new Promise<void>((resolve) =>
          managerServer.listen(0, () => resolve()),
        );
        let managerPort = (managerServer.address() as any).port;
        try {
          let proxiedHits = 0;
          mockPrerenderA!.setResponder((ctxt) => {
            proxiedHits++;
            ctxt.status = 201;
            ctxt.body = '{}';
          });

          let realm = 'https://realm.example/no-servers';
          let clientReq = http.request({
            hostname: '127.0.0.1',
            port: managerPort,
            path: '/prerender-visit',
            method: 'POST',
            headers: { 'Content-Type': 'application/vnd.api+json' },
          });
          clientReq.on('error', () => {});
          clientReq.write(JSON.stringify(makeBody(realm, `${realm}/1`)));
          clientReq.end();

          // Give the manager a tick to start the discovery wait,
          // then kill the client before registering any server.
          await new Promise((r) => setTimeout(r, 100));
          clientReq.destroy();

          // Register a server *after* the abort. If the manager were
          // to continue the poll loop past the disconnect, it would
          // proxy to this server once it appears.
          await new Promise<void>((resolve, reject) => {
            let req = http.request(
              {
                hostname: '127.0.0.1',
                port: managerPort,
                path: '/prerender-servers',
                method: 'POST',
                headers: { 'Content-Type': 'application/vnd.api+json' },
              },
              (res) => {
                res.resume();
                res.on('end', () => resolve());
              },
            );
            req.on('error', reject);
            req.write(
              JSON.stringify({
                data: {
                  type: 'prerender-server',
                  attributes: { capacity: 2, url: serverUrlA },
                },
              }),
            );
            req.end();
          });

          // Wait long enough that a not-cancelled poll would have
          // picked up the new server and proxied.
          await new Promise((r) => setTimeout(r, 300));

          assert.strictEqual(
            proxiedHits,
            0,
            'no upstream proxy after client abort during discovery wait',
          );
        } finally {
          await new Promise<void>((resolve) =>
            managerServer.close(() => resolve()),
          );
        }
      });
    });
  });
});

function makeMockPrerender(): {
  app: Koa;
  router: Router;
  server: Server;
  stop: () => Promise<void>;
  setResponder: (
    responder: (
      ctxt: Koa.Context,
      body: any,
      type: 'visit' | 'module' | 'command',
    ) => Promise<void> | void,
  ) => void;
  releaseBatchCalls: Array<Record<string, unknown>>;
} {
  let app = new Koa();
  let router = new Router();
  router.get('/', (ctxt) => {
    ctxt.status = 200;
    ctxt.body = 'OK';
  });
  let responder: (
    ctxt: Koa.Context,
    body: any,
    type: 'visit' | 'module' | 'command',
  ) => Promise<void> | void = defaultResponder;
  async function readBody(ctxt: Koa.Context) {
    return await new Promise<string>((resolve) => {
      let buf: Buffer[] = [];
      ctxt.req.on('data', (c) => buf.push(c));
      ctxt.req.on('end', () => resolve(Buffer.concat(buf).toString('utf8')));
    });
  }
  function defaultResponder(
    ctxt: Koa.Context,
    body: any,
    type: 'visit' | 'module' | 'command',
  ) {
    ctxt.status = 201;
    ctxt.set('Content-Type', 'application/vnd.api+json');
    if (type === 'visit') {
      ctxt.body = JSON.stringify({
        data: {
          type: 'prerender-visit-result',
          id: body?.data?.attributes?.url || 'x',
          attributes: { card: { ok: true } },
        },
        meta: {
          timing: { launchMs: 0, renderMs: 0, totalMs: 0 },
          pool: {
            pageId: 'p',
            affinityType: body?.data?.attributes?.affinityType ?? 'realm',
            affinityValue: body?.data?.attributes?.affinityValue ?? 'unknown',
            reused: false,
            evicted: false,
          },
        },
      });
    } else if (type === 'module') {
      ctxt.body = JSON.stringify({
        data: {
          type: 'prerender-module-result',
          id: body?.data?.attributes?.url || 'x',
          attributes: {
            id: body?.data?.attributes?.url || 'x',
            status: 'ready',
            isShimmed: false,
            nonce: '1',
            lastModified: 0,
            createdAt: 0,
            deps: [],
            definitions: {},
          },
        },
        meta: {
          timing: { launchMs: 0, renderMs: 0, totalMs: 0 },
          pool: {
            pageId: 'p',
            affinityType: body?.data?.attributes?.affinityType ?? 'realm',
            affinityValue: body?.data?.attributes?.affinityValue ?? 'unknown',
            reused: false,
            evicted: false,
          },
        },
      });
    } else {
      ctxt.body = JSON.stringify({
        data: {
          type: 'command-result',
          id: body?.data?.attributes?.command || 'command',
          attributes: {
            status: 'ready',
            cardResultString: null,
          },
        },
        meta: {
          timing: { launchMs: 0, renderMs: 0, totalMs: 0 },
          pool: {
            pageId: 'p',
            affinityType: body?.data?.attributes?.affinityType ?? 'realm',
            affinityValue: body?.data?.attributes?.affinityValue ?? 'unknown',
            reused: false,
            evicted: false,
          },
        },
      });
    }
  }
  router.post('/prerender-visit', async (ctxt) => {
    let raw = await readBody(ctxt);
    let body = raw ? JSON.parse(raw) : {};
    await responder(ctxt, body, 'visit');
  });
  router.post('/prerender-module', async (ctxt) => {
    let raw = await readBody(ctxt);
    let body = raw ? JSON.parse(raw) : {};
    await responder(ctxt, body, 'module');
  });
  router.post('/run-command', async (ctxt) => {
    let raw = await readBody(ctxt);
    let body = raw ? JSON.parse(raw) : {};
    await responder(ctxt, body, 'command');
  });
  // Capture release-batch calls so tests can assert the manager
  // broadcast reached this server (CS-10758 step 3).
  let releaseBatchCalls: Array<Record<string, unknown>> = [];
  router.post('/release-batch', async (ctxt) => {
    let raw = await readBody(ctxt);
    let body = raw ? JSON.parse(raw) : {};
    releaseBatchCalls.push(body?.data?.attributes ?? {});
    ctxt.status = 204;
  });
  (app as any).releaseBatchCalls = releaseBatchCalls;
  app.use(router.routes());
  let server = createServer(app.callback()).listen(0);
  let stopped = false;
  return {
    app,
    router,
    server,
    stop: () =>
      new Promise((resolve) => {
        if (stopped) return resolve();
        stopped = true;
        server.close(() => resolve());
      }),
    setResponder: (r) => {
      responder = r;
    },
    releaseBatchCalls,
  };
}

function makeBody(realm: string, url: string) {
  let auth = makeAuth(realm);
  return {
    data: {
      type: 'prerender-visit-request',
      attributes: {
        affinityType: 'realm',
        affinityValue: realm,
        url,
        auth,
        realm,
        renderOptions: { cardRender: true },
      },
    },
  };
}

function realmAffinityKey(realm: string) {
  return toAffinityKey({ affinityType: 'realm', affinityValue: realm });
}

function userAffinityKey(userId: string) {
  return toAffinityKey({ affinityType: 'user', affinityValue: userId });
}

function makeModuleBody(realm: string, url: string) {
  let auth = makeAuth(realm);
  return {
    data: {
      type: 'prerender-module-request',
      attributes: {
        affinityType: 'realm',
        affinityValue: realm,
        url,
        auth,
        realm,
      },
    },
  };
}

function makeCommandBody(
  realm: string,
  command: string,
  runAs = '@user:localhost',
) {
  let auth = makeAuth(realm);
  return {
    data: {
      type: 'command-request',
      attributes: {
        affinityType: 'user',
        affinityValue: runAs,
        realm,
        auth,
        command,
      },
    },
  };
}

function makeAuth(realm: string) {
  return testCreatePrerenderAuth('@user:localhost', {
    [realm]: ['read', 'write', 'realm-owner'],
  });
}
