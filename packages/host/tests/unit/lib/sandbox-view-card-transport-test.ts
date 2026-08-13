import { module, test } from 'qunit';

import {
  SandboxViewCardClient,
  SandboxViewCardServer,
  type SandboxViewCardOptions,
} from '@cardstack/host/lib/sandbox-view-card-transport';

module('Unit | Sandbox view-card transport', function () {
  test('a nested-card open crosses as bounded semantic metadata and resolves after the Host handles it', async function (assert) {
    let channel = new MessageChannel();
    let received:
      | {
          cardId: string;
          format: string;
          options?: SandboxViewCardOptions;
        }
      | undefined;
    let server = new SandboxViewCardServer(
      channel.port1,
      (cardId, format, options) => {
        received = { cardId, format, options };
      },
    );
    let client = new SandboxViewCardClient(channel.port2);

    try {
      await client.viewCard('https://realm.example/Recipe/banana', 'fitted', {
        fieldType: 'linksToMany',
        fieldName: 'recipes',
      });
      assert.deepEqual(received, {
        cardId: 'https://realm.example/Recipe/banana',
        format: 'fitted',
        options: { fieldType: 'linksToMany', fieldName: 'recipes' },
      });
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('a Host navigation failure is projected back to the child', async function (assert) {
    let channel = new MessageChannel();
    let server = new SandboxViewCardServer(channel.port1, () => {
      throw new Error('card is not readable');
    });
    let client = new SandboxViewCardClient(channel.port2);

    try {
      await assert.rejects(
        client.viewCard('https://realm.example/Card/private', 'isolated'),
        /card is not readable/,
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
