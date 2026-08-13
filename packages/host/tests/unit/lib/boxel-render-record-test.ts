import { module, test } from 'qunit';

import type { RealmResourceIdentifier } from '@cardstack/runtime-common';

import { buildBoxelRenderRecord } from '@cardstack/host/lib/boxel-render-record';

module('Unit | Boxel render record', function () {
  test('detaches runtime projections at the assembled output boundary', function (assert) {
    let modelExtensions = {
      computed: { label: 'original' },
    };
    let record = buildBoxelRenderRecord({
      boxel: {
        protocolVersion: 1,
        requiredFeatures: [],
        ref: {
          module: 'https://example.test/card' as RealmResourceIdentifier,
          name: 'Card',
        },
        boxelKind: 'card',
        ancestors: [],
        fields: [],
        formats: [],
        presentation: {
          displayName: 'Card',
          headerColor: null,
          prefersWideFormat: false,
        },
        executionHints: { prefersFullSandbox: false },
      },
      instanceId: 'https://example.test/Card/one',
      fields: [],
      presentation: {
        title: null,
        summary: null,
        thumbnailURL: null,
        theme: null,
        themeScope: null,
        themeCss: null,
        cssImports: null,
      },
      modelExtensions,
    });

    (record.instance.model.computed as { label: string }).label = 'mutated';
    assert.strictEqual(
      modelExtensions.computed.label,
      'original',
      'the assembler owns the sole projection clone and callers cannot mutate runtime state',
    );
  });
});
