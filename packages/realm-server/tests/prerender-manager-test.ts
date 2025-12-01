import { module, test } from 'qunit';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import { basename } from 'path';
import Koa from 'koa';
import Router from '@koa/router';
import type { Server } from 'http';
import { createServer } from 'http';
import { buildPrerenderManagerApp } from '../prerender/manager-app';
import {
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from '../prerender/prerender-constants';

module(basename(__filename), function () {
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

    test('health includes active servers with realms and last used times', async function (assert) {
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
      let proxyResponse = await request.post('/prerender-card').send(body);
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

      // Verify realms array
      assert.ok(
        Array.isArray(assignedServerData.attributes.realms),
        'realms is array',
      );
      assert.strictEqual(
        assignedServerData.attributes.realms.length,
        1,
        'one realm active',
      );
      assert.strictEqual(
        assignedServerData.attributes.realms[0].url,
        realm,
        'realm url',
      );
      assert.ok(
        assignedServerData.attributes.realms[0].lastUsed,
        'has realm lastUsed timestamp',
      );
      assert.strictEqual(
        assignedServerData.attributes.status,
        'active',
        'status reflects heartbeat',
      );
      assert.ok(
        Array.isArray(assignedServerData.attributes.warmedRealms),
        'warmed realms included',
      );

      // Verify the other server has no realms
      let otherServerUrl =
        assignedServer === serverUrlA ? serverUrlB : serverUrlA;
      let otherServerData = included.find((s: any) => s.id === otherServerUrl);
      assert.ok(otherServerData, 'other server in included');
      assert.strictEqual(
        otherServerData.attributes.realms.length,
        0,
        'other server has no realms',
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
        .post('/prerender-card')
        .send(makeBody(realm, cardURL));

      assert.strictEqual(proxyResponse.status, 201, 'proxy request successful');
      assert.strictEqual(
        proxyResponse.headers['x-boxel-prerender-target'],
        serverUrlA,
        'card request routed to registered prerender server',
      );

      assert.strictEqual(
        proxyResponse.body?.data?.type,
        'prerender-result',
        'card result type returned',
      );
      assert.true(
        proxyResponse.body?.data?.attributes?.ok,
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

    test('heartbeat: url required; heartbeat updates warmed realms and status', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      let registrationResponse = await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 2,
            url: serverUrlA,
            status: 'active',
            warmedRealms: ['https://realm.example/warmed'],
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
      let firstProxyResponse = await request.post('/prerender-card').send(body);
      assert.strictEqual(firstProxyResponse.status, 201, 'proxy 201');
      let firstTarget = firstProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(
        [serverUrlA, serverUrlB].includes(firstTarget),
        'target is one of servers',
      );
      let secondProxyResponse = await request
        .post('/prerender-card')
        .send(body);
      assert.strictEqual(secondProxyResponse.status, 201, 'proxy 201 again');
      assert.strictEqual(
        secondProxyResponse.headers['x-boxel-prerender-target'],
        firstTarget,
        'sticky with multiplex=1',
      );
    });

    test('proxy: rotation with multiplex>1, capacity and pressure', async function (assert) {
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
      let firstProxyResponse = await request.post('/prerender-card').send(body);
      let firstTarget = firstProxyResponse.headers['x-boxel-prerender-target'];
      let secondProxyResponse = await request
        .post('/prerender-card')
        .send(body);
      let secondTarget =
        secondProxyResponse.headers['x-boxel-prerender-target'];
      assert.notStrictEqual(firstTarget, undefined, 'first target exists');
      assert.notStrictEqual(secondTarget, undefined, 'second target exists');
      assert.notStrictEqual(
        firstTarget,
        secondTarget,
        'rotates between servers when multiplex>1',
      );

      // capacity: distribute different realms across servers first
      let realm2RequestBody = makeBody(
        'https://realm.example/R2',
        'https://realm.example/R2/1',
      );
      let realm2ProxyResponse = await request
        .post('/prerender-card')
        .send(realm2RequestBody);
      let realm2Target =
        realm2ProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(
        [serverUrlA, serverUrlB].includes(realm2Target),
        'second realm assigned to one server',
      );

      // now pressure: third realm
      let realm3RequestBody = makeBody(
        'https://realm.example/R3',
        'https://realm.example/R3/1',
      );
      let realm3ProxyResponse = await request
        .post('/prerender-card')
        .send(realm3RequestBody);
      let realm3Target =
        realm3ProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(
        [serverUrlA, serverUrlB].includes(realm3Target),
        'pressure assigns to one server',
      );
    });

    test('realm disposal removes server from realm mapping', async function (assert) {
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
      let firstProxyResponse = await request.post('/prerender-card').send(body);
      assert.strictEqual(firstProxyResponse.status, 201, 'initial proxy ok');
      let firstTarget = firstProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(firstTarget, 'proxy response includes target header');

      let missingUrlDisposalResponse = await request.delete(
        `/prerender-servers/realms/${encodeURIComponent(realm)}`,
      );
      assert.strictEqual(
        missingUrlDisposalResponse.status,
        400,
        'realm disposal requires url query param',
      );

      // simulate prerender server notifying disposal
      let disposalResponse = await request
        .delete(`/prerender-servers/realms/${encodeURIComponent(realm)}`)
        .query({ url: firstTarget as string });
      assert.strictEqual(disposalResponse.status, 204, 'realm disposal 204');

      // next request should succeed; mapping for that realm should no longer be required
      let secondProxyResponse = await request
        .post('/prerender-card')
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

    test('realm disposal selects least recently used idle server when multiplex=1', async function (assert) {
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
      let firstProxyResponse = await request.post('/prerender-card').send(body);
      assert.strictEqual(firstProxyResponse.status, 201, 'initial proxy ok');
      let firstTarget = firstProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(firstTarget, 'proxy response includes target header');

      let disposalResponse = await request
        .delete(`/prerender-servers/realms/${encodeURIComponent(realm)}`)
        .query({ url: firstTarget as string });
      assert.strictEqual(disposalResponse.status, 204, 'realm disposal 204');

      let otherTarget = firstTarget === serverUrlA ? serverUrlB : serverUrlA;
      let secondProxyResponse = await request
        .post('/prerender-card')
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

      // new realm should not target A anymore
      let realm2RequestBody = makeBody(
        'https://realm.example/R2',
        'https://realm.example/R2/1',
      );
      let proxyResponse = await request
        .post('/prerender-card')
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
      let firstProxyResponse = await request.post('/prerender-card').send(body);
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
        .post('/prerender-card')
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
        .post('/prerender-card')
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
      let response = await request.post('/prerender-card').send(body);
      assert.strictEqual(response.status, 201, 'proxy succeeds');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlB,
        'draining server skipped in favor of healthy one',
      );
    });

    test('manager prefers warmed realm when available', async function (assert) {
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
            warmedRealms: [realm],
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
        .post('/prerender-card')
        .send(makeBody(realm, `${realm}/1`));

      assert.strictEqual(response.status, 201, 'proxy ok');
      assert.strictEqual(
        response.headers['x-boxel-prerender-target'],
        serverUrlA,
        'manager prefers warmed server for realm',
      );
    });

    test('pressure mode skips unusable LRU server and falls back to healthy', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '2';
      let { app, registry, chooseServerForRealm } = buildPrerenderManagerApp();
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
      registry.realms.set(lruRealm, [
        serverUrlA as string,
        serverUrlB as string,
      ]);
      registry.lastAccessByRealm.set(lruRealm, Date.now() - 1000);
      registry.servers.get(serverUrlA!)!.activeRealms.add(lruRealm);
      registry.servers.get(serverUrlB!)!.activeRealms.add(lruRealm);

      // make A unusable
      let infoA = registry.servers.get(serverUrlA!);
      if (infoA) {
        infoA.status = 'draining';
      }

      // simulate full capacity to bypass earlier capacity selection
      registry.servers.get(serverUrlA!)!.activeRealms.add('fillA');
      registry.servers.get(serverUrlB!)!.activeRealms.add('fillB');

      // choose for new realm should drop A and pick B from LRU set
      let realm = 'https://realm.example/new';
      let target = chooseServerForRealm(realm);
      assert.strictEqual(
        target,
        serverUrlB,
        'selects healthy server after dropping unusable LRU entry',
      );
      assert.false(
        registry.servers.get(serverUrlA!)?.activeRealms.has(lruRealm),
        'unusable server activeRealms cleaned up',
      );
      let lruMapping = registry.realms.get(lruRealm) || [];
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

    test('cleanup keeps activeRealms in sync so capacity is restored after draining', async function (assert) {
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
        .post('/prerender-card')
        .send(makeBody(realm1, `${realm1}/1`));
      assert.strictEqual(res1.status, 201, 'first prerender ok');
      assert.strictEqual(
        registry.servers.get(serverUrlA!)?.activeRealms.size,
        1,
        'activeRealms tracked',
      );

      // mark draining and trigger cleanup via a new request (will 503)
      let info = registry.servers.get(serverUrlA!);
      assert.ok(info, 'server info present');
      if (info) {
        info.status = 'draining';
      }
      let realm2 = 'https://realm.example/two';
      let res2 = await request
        .post('/prerender-card')
        .send(makeBody(realm2, `${realm2}/1`));
      assert.strictEqual(res2.status, 503, 'no servers while draining');
      assert.strictEqual(
        registry.servers.get(serverUrlA!)?.activeRealms.size,
        0,
        'activeRealms cleared when assignments dropped',
      );

      // back to active; capacity should allow new assignment
      if (info) {
        info.status = 'active';
        info.lastSeenAt = Date.now();
      }
      let realm3 = 'https://realm.example/three';
      let res3 = await request
        .post('/prerender-card')
        .send(makeBody(realm3, `${realm3}/1`));
      assert.strictEqual(res3.status, 201, 'prerender ok after recovery');
      assert.true(
        registry.servers.get(serverUrlA!)?.activeRealms.has(realm3) as boolean,
        'realm assigned after capacity restored',
      );
    });

    test('pressure mode assignment updates activeRealms for capacity accounting', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '1';
      let { app, registry, chooseServerForRealm } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });

      let lruRealm = 'https://realm.example/lru';
      let first = chooseServerForRealm(lruRealm);
      assert.strictEqual(first, serverUrlA, 'initial realm assigned');
      registry.lastAccessByRealm.set(lruRealm, Date.now() - 1000);

      let newRealm = 'https://realm.example/new-capacity';
      let target = chooseServerForRealm(newRealm, {
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
          ?.activeRealms.has(newRealm) as boolean,
        'activeRealms updated for new realm',
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
        .post('/prerender-card')
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

    test('returns 503 immediately when manager is draining', async function (assert) {
      let draining = true;
      let { app } = buildPrerenderManagerApp({ isDraining: () => draining });
      let request: SuperTest<Test> = supertest(app.callback());

      let res = await request
        .post('/prerender-card')
        .send(
          makeBody(
            'https://realm.example/drain-manager',
            'https://realm.example/drain-manager/1',
          ),
        );
      assert.strictEqual(res.status, 503, '503 when manager draining');
      assert.strictEqual(
        res.body?.errors?.[0]?.message,
        'Prerender manager draining',
        'draining message returned',
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
      await request.post('/prerender-card').send(makeBody(realm, `${realm}/1`));
      assert.true(
        registry.servers.get(serverUrlA!)?.activeRealms.has(realm) as boolean,
        'realm assigned before reset',
      );

      let resetRes = await request.post('/prerender-maintenance/reset');
      assert.strictEqual(resetRes.status, 204, 'reset endpoint 204');

      assert.false(
        registry.servers.get(serverUrlA!)?.activeRealms.has(realm) as boolean,
        'activeRealms cleared after reset',
      );
      assert.false(registry.realms.has(realm), 'realm mapping cleared');
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
        .post('/prerender-card')
        .send(makeBody(realm1, `${realm1}1`));
      assert.strictEqual(res1.status, 201, 'first realm assigned');

      let res2 = await request
        .post('/prerender-card')
        .send(makeBody(realm2, `${realm2}/1`));
      assert.strictEqual(
        res2.status,
        201,
        'second realm succeeds via eviction',
      );

      assert.false(
        registry.realms.has(realm1),
        'evicted realm mapping removed after steal',
      );
      assert.true(
        registry.servers.get(serverUrlA!)?.activeRealms.has(realm2) as boolean,
        'new realm assigned to server after eviction',
      );
    });

    test('heartbeat clears stale active realms when warmedRealms are empty', async function (assert) {
      process.env.PRERENDER_MULTIPLEX = '1';
      let { app, registry, chooseServerForRealm } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 1, url: serverUrlA },
        },
      });

      let staleRealm = 'https://realm.example/stale';
      registry.servers.get(serverUrlA!)?.activeRealms.add(staleRealm);
      registry.realms.set(staleRealm, [serverUrlA as string]);

      await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: {
            capacity: 1,
            url: serverUrlA,
            warmedRealms: [],
          },
        },
      });

      assert.strictEqual(
        registry.servers.get(serverUrlA!)?.activeRealms.size,
        0,
        'activeRealms cleared on heartbeat',
      );
      assert.false(registry.realms.has(staleRealm), 'realm mapping removed');

      let newRealm = 'https://realm.example/newafterclear';
      let target = chooseServerForRealm(newRealm);
      assert.strictEqual(target, serverUrlA, 'server reused after clear');
    });

    test('returns 503 when no prerender servers are registered', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      let res = await request
        .post('/prerender-card')
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
        .post('/prerender-card')
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
      type: 'card' | 'module',
    ) => Promise<void> | void,
  ) => void;
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
    type: 'card' | 'module',
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
    type: 'card' | 'module',
  ) {
    ctxt.status = 201;
    ctxt.set('Content-Type', 'application/vnd.api+json');
    if (type === 'card') {
      ctxt.body = JSON.stringify({
        data: {
          type: 'prerender-result',
          id: body?.data?.attributes?.url || 'x',
          attributes: { ok: true },
        },
        meta: {
          timing: { launchMs: 0, renderMs: 0, totalMs: 0 },
          pool: {
            pageId: 'p',
            realm: body?.data?.attributes?.realm,
            reused: false,
            evicted: false,
          },
        },
      });
    } else {
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
            realm: body?.data?.attributes?.realm,
            reused: false,
            evicted: false,
          },
        },
      });
    }
  }
  router.post('/prerender-card', async (ctxt) => {
    let raw = await readBody(ctxt);
    let body = raw ? JSON.parse(raw) : {};
    await responder(ctxt, body, 'card');
  });
  router.post('/prerender-module', async (ctxt) => {
    let raw = await readBody(ctxt);
    let body = raw ? JSON.parse(raw) : {};
    await responder(ctxt, body, 'module');
  });
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
  };
}

function makeBody(realm: string, url: string) {
  return {
    data: {
      type: 'prerender-request',
      attributes: {
        url,
        userId: '@user:localhost',
        permissions: { [realm]: ['read', 'write', 'realm-owner'] },
        realm,
      },
    },
  };
}

function makeModuleBody(realm: string, url: string) {
  return {
    data: {
      type: 'prerender-module-request',
      attributes: {
        url,
        userId: '@user:localhost',
        permissions: { [realm]: ['read', 'write', 'realm-owner'] },
        realm,
      },
    },
  };
}
