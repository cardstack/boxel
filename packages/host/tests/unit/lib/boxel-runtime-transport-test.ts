import { module, test } from 'qunit';

import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  type BoxelDescription,
  type BoxelInstanceHandle,
  type BoxelRenderRecord,
  type BoxelTypeHandle,
  type CodeRef,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type RealmResourceIdentifier,
  type RuntimeHandle,
} from '@cardstack/runtime-common';

import type { BoxelRuntime } from '@cardstack/host/lib/boxel-runtime';
import SandboxBoxelRuntimeClient from '@cardstack/host/lib/sandbox-boxel-runtime-client';
import SandboxBoxelRuntimeServer from '@cardstack/host/lib/sandbox-boxel-runtime-server';
import {
  SandboxRenderClient,
  SandboxRenderServer,
} from '@cardstack/host/lib/sandbox-render-transport';

const typeHandle = 'test-type:1' as BoxelTypeHandle;
const instanceHandle = 'test-instance:1' as BoxelInstanceHandle;
const ref: CodeRef = {
  module: 'https://example.test/person' as RealmResourceIdentifier,
  name: 'Person',
};

class TestRuntime implements BoxelRuntime {
  readonly mode = 'sandbox' as const;
  disposed: RuntimeHandle[] = [];

  async loadBoxel() {
    return typeHandle;
  }
  async createFromSerialized() {
    return instanceHandle;
  }
  async describeBoxel(): Promise<BoxelDescription> {
    return {
      protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
      requiredFeatures: [],
      ref,
      boxelKind: 'card',
      ancestors: [],
      fields: [],
      formats: [],
      presentation: {
        displayName: 'Person',
        headerColor: null,
        prefersWideFormat: false,
      },
      executionHints: { prefersFullSandbox: false },
    };
  }
  async getFields() {
    return [];
  }
  async getField() {
    return undefined;
  }
  async buildRenderRecord(): Promise<BoxelRenderRecord> {
    return {
      protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
      boxel: await this.describeBoxel(),
      instance: {
        id: 'https://example.test/Person/1',
        model: {},
        fields: [],
      },
      presentation: {
        title: 'Ada',
        summary: null,
        thumbnailURL: null,
        theme: null,
      },
    };
  }
  async serializeCard(): Promise<LooseSingleCardDocument> {
    return {
      data: {
        type: 'card',
        id: 'https://example.test/Person/1',
        attributes: {},
        meta: { adoptsFrom: ref },
      },
    };
  }
  async serializeCardPatch() {
    return { attributes: { name: 'Ada' } };
  }
  async dispose(handle: RuntimeHandle) {
    this.disposed.push(handle);
  }
}

module('Unit | Boxel runtime transport', function () {
  test('a private MessageChannel carries only cloneable Boxel semantics', async function (assert) {
    let channel = new MessageChannel();
    let runtime = new TestRuntime();
    let server = new SandboxBoxelRuntimeServer(channel.port2, runtime);
    let client = new SandboxBoxelRuntimeClient(channel.port1);

    try {
      assert.strictEqual(await client.loadBoxel(ref), typeHandle);
      assert.strictEqual(
        (await client.describeBoxel(typeHandle)).presentation.displayName,
        'Person',
      );
      assert.strictEqual(
        (await client.buildRenderRecord(instanceHandle)).presentation.title,
        'Ada',
      );
      assert.deepEqual(await client.serializeCardPatch(instanceHandle, {}), {
        attributes: { name: 'Ada' },
      });
      await client.dispose(instanceHandle);
      assert.deepEqual(runtime.disposed, [instanceHandle]);
    } finally {
      client.destroy();
      server.destroy();
    }
  });

  test('serialized creation does not transfer a live instance', async function (assert) {
    let channel = new MessageChannel();
    let runtime = new TestRuntime();
    let server = new SandboxBoxelRuntimeServer(channel.port2, runtime);
    let client = new SandboxBoxelRuntimeClient(channel.port1);
    let resource = {
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: ref },
    } as LooseCardResource;
    let document = { data: resource } as LooseSingleCardDocument;
    try {
      assert.strictEqual(
        await client.createFromSerialized(
          resource,
          document,
          undefined,
          'host-display',
        ),
        instanceHandle,
      );
    } finally {
      client.destroy();
      server.destroy();
    }
  });

  test('the client fails closed when its private peer speaks an incompatible protocol', async function (assert) {
    let channel = new MessageChannel();
    let client = new SandboxBoxelRuntimeClient(channel.port1);
    channel.port2.addEventListener('message', (event) => {
      let request = event.data as { requestId?: unknown };
      channel.port2.postMessage({
        kind: 'boxel-runtime-response',
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION + 1,
        requestId: request.requestId,
        ok: true,
        value: typeHandle,
      });
    });
    channel.port2.start();

    try {
      await assert.rejects(
        client.loadBoxel(ref),
        /Unsupported Boxel execution transport version/,
      );
      await assert.rejects(
        client.loadBoxel(ref),
        /Sandbox runtime client is closed/,
      );
    } finally {
      client.destroy();
      channel.port2.close();
    }
  });

  test('the server ignores malformed envelopes without invoking runtime authority', async function (assert) {
    let channel = new MessageChannel();
    let runtime = new TestRuntime();
    let server = new SandboxBoxelRuntimeServer(channel.port2, runtime);
    let received = false;
    channel.port1.addEventListener('message', () => (received = true));
    channel.port1.start();

    try {
      channel.port1.postMessage({
        kind: 'boxel-runtime-request',
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
        requestId: '',
        operation: 'hostEscape',
        args: [],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.false(received, 'no response or authority is produced');
      assert.deepEqual(runtime.disposed, [], 'the runtime was not invoked');
    } finally {
      server.destroy();
      channel.port1.close();
    }
  });

  test('Sandbox render effects stay child-owned and preserve message order', async function (assert) {
    let channel = new MessageChannel();
    let rendered: string[] = [];
    let server = new SandboxRenderServer(channel.port2, {
      async render(card, format) {
        if (format === 'isolated') {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        rendered.push(`${card}:${format}`);
      },
      clear() {
        rendered.push('clear');
      },
    });
    let client = new SandboxRenderClient(channel.port1);

    try {
      let first = client.render(instanceHandle, 'isolated');
      let second = client.render(instanceHandle, 'embedded');
      await Promise.all([first, second]);
      await client.clear();
      assert.deepEqual(rendered, [
        `${instanceHandle}:isolated`,
        `${instanceHandle}:embedded`,
        'clear',
      ]);
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('Sandbox render errors are projected without exposing child objects', async function (assert) {
    let channel = new MessageChannel();
    let server = new SandboxRenderServer(channel.port2, {
      render() {
        let error = new Error('renderer rejected the format');
        Object.assign(error, { secret: globalThis });
        throw error;
      },
      clear() {},
    });
    let client = new SandboxRenderClient(channel.port1);

    try {
      await assert.rejects(
        client.render(instanceHandle, 'isolated'),
        /renderer rejected the format/,
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
