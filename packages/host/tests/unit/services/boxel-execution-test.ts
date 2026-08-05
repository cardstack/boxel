import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type BoxelExecutionService from '@cardstack/host/services/boxel-execution';

import type { BaseDef } from '@cardstack/base/card-api';

module('Unit | Service | boxel-execution', function (hooks) {
  setupTest(hooks);

  test('uses scoped server prerender as an inert execution placeholder', async function (assert) {
    let formats: string[] = [];
    let imported: string[] = [];

    class MockStore extends Service {
      async fetchCardEntry(_url: string, opts: { format?: string }) {
        formats.push(opts.format ?? '');
        let htmlId = `card#${opts.format}`;
        let hasRendering = opts.format === 'embedded';
        return {
          notModified: false as const,
          doc: {
            data: {
              type: 'entry',
              id: 'https://realm.example/Card/one',
              relationships: {
                html: { data: [{ type: 'html', id: htmlId }] },
              },
            },
            included: hasRendering
              ? [
                  {
                    type: 'html',
                    id: htmlId,
                    attributes: {
                      html: '<article>Prerendered card</article>',
                      cardType: 'Card',
                      format: 'embedded',
                    },
                    relationships: {
                      styles: { data: [{ type: 'css', id: 'style:one' }] },
                    },
                  },
                  {
                    type: 'css',
                    id: 'style:one',
                    attributes: {
                      href: 'data:text/javascript;base64,ZXhwb3J0IGRlZmF1bHQge307',
                    },
                  },
                ]
              : [],
          },
        };
      }
    }

    class MockLoaderService extends Service {
      loader = {
        import: async (identifier: string) => {
          imported.push(identifier);
          return {};
        },
      };
    }

    this.owner.register('service:store', MockStore);
    this.owner.register('service:loader-service', MockLoaderService);
    let service = this.owner.lookup(
      'service:boxel-execution',
    ) as BoxelExecutionService;
    let card = {
      id: 'https://realm.example/Card/one',
    } as unknown as BaseDef;

    let component = await service.prerenderedComponentFor(card, 'isolated');

    assert.ok(component, 'an inert HTML component is produced');
    assert.deepEqual(
      formats,
      ['embedded'],
      'isolated uses the indexed embedded prerender as its inert handoff',
    );
    assert.deepEqual(imported, [
      'data:text/javascript;base64,ZXhwb3J0IGRlZmF1bHQge307',
    ]);
  });
});
