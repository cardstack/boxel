import { module, test } from 'qunit';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import { basename } from 'path';
import Koa from 'koa';
import Router from '@koa/router';
import type { Server } from 'http';
import { createServer } from 'http';
import { buildPrerenderManagerApp } from '../prerender/manager-app';

module(basename(__filename), function () {
  module('Prerender manager', function (hooks) {
    let previousMultiplex: string | undefined;
    let mockPrerenderA: ReturnType<typeof makeMockPrerender> | undefined;
    let mockPrerenderB: ReturnType<typeof makeMockPrerender> | undefined;
    let serverUrlA: string | undefined;
    let serverUrlB: string | undefined;
    hooks.beforeEach(function () {
      previousMultiplex = process.env.PRERENDER_MULTIPLEX;
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
      assert.true(getResponse.body.data.attributes.ready, 'ready attribute');
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
      let proxyResponse = await request.post('/prerender').send(body);
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

    test('registration: explicit url passes and returns 204', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());
      // use mockPrerenderA to satisfy ping
      let registrationResponse = await request.post('/prerender-servers').send({
        data: {
          type: 'prerender-server',
          attributes: { capacity: 2, url: serverUrlA },
        },
      });
      assert.strictEqual(registrationResponse.status, 204, '204 No Content');
      assert.strictEqual(
        registrationResponse.headers['x-prerender-server-id'],
        serverUrlA,
        'id header',
      );
    });

    test('registration: unreachable url rejected; missing url fails', async function (assert) {
      let { app } = buildPrerenderManagerApp();
      let request: SuperTest<Test> = supertest(app.callback());

      // unreachable
      let unreachable = `http://127.0.0.1:59999`;
      let unreachableRegistrationResponse = await request
        .post('/prerender-servers')
        .send({
          data: {
            type: 'prerender-server',
            attributes: { url: unreachable },
          },
        });
      assert.strictEqual(
        unreachableRegistrationResponse.status,
        400,
        'unreachable rejected',
      );

      // missing header & body cannot infer
      let missingInferenceResponse = await request
        .post('/prerender-servers')
        .send({});
      assert.strictEqual(
        missingInferenceResponse.status,
        400,
        'cannot infer URL rejected',
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
      let firstProxyResponse = await request.post('/prerender').send(body);
      assert.strictEqual(firstProxyResponse.status, 201, 'proxy 201');
      let firstTarget = firstProxyResponse.headers['x-boxel-prerender-target'];
      assert.ok(
        [serverUrlA, serverUrlB].includes(firstTarget),
        'target is one of servers',
      );
      let secondProxyResponse = await request.post('/prerender').send(body);
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
      let firstProxyResponse = await request.post('/prerender').send(body);
      let firstTarget = firstProxyResponse.headers['x-boxel-prerender-target'];
      let secondProxyResponse = await request.post('/prerender').send(body);
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
        .post('/prerender')
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
        .post('/prerender')
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
      let firstProxyResponse = await request.post('/prerender').send(body);
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
      let secondProxyResponse = await request.post('/prerender').send(body);
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
        .post('/prerender')
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
      let firstProxyResponse = await request.post('/prerender').send(body);
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
        .post('/prerender')
        .send(realm2RequestBody);
      assert.strictEqual(proxyResponse.status, 201, 'proxy ok');
      assert.notStrictEqual(
        proxyResponse.headers['x-boxel-prerender-target'],
        serverUrlA,
        'does not target unreachable after sweep',
      );
    });
  });
});

function makeMockPrerender(): {
  app: Koa;
  router: Router;
  server: Server;
  stop: () => Promise<void>;
} {
  let app = new Koa();
  let router = new Router();
  router.get('/', (ctxt) => {
    ctxt.status = 200;
    ctxt.body = 'OK';
  });
  router.post('/prerender', async (ctxt) => {
    let raw = await new Promise<string>((resolve) => {
      let buf: Buffer[] = [];
      ctxt.req.on('data', (c) => buf.push(c));
      ctxt.req.on('end', () => resolve(Buffer.concat(buf).toString('utf8')));
    });
    let body = raw ? JSON.parse(raw) : {};
    ctxt.status = 201;
    ctxt.set('Content-Type', 'application/vnd.api+json');
    // echo back a minimal valid response
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
