import { module, test } from 'qunit';

import {
  defaultLivenessForFormat,
  formats,
  type Format,
} from '@cardstack/runtime-common';

module('Unit | field-liveness | defaultLivenessForFormat', function () {
  test('fitted is prerendered + lazily hydrated on hover — the cheap fast path', function (assert) {
    assert.deepEqual(defaultLivenessForFormat('fitted'), {
      live: false,
      mode: 'hover',
    });
  });

  test('embedded is live — a full running instance, no gesture', function (assert) {
    assert.deepEqual(defaultLivenessForFormat('embedded'), { live: true });
  });

  test('every non-fitted format is live', function (assert) {
    for (let format of formats.filter((f) => f !== 'fitted')) {
      assert.deepEqual(
        defaultLivenessForFormat(format),
        { live: true },
        `${format} → live`,
      );
    }
  });

  test('only fitted is prerendered', function (assert) {
    let prerenderedFormats = (formats as Format[]).filter(
      (f) => !defaultLivenessForFormat(f).live,
    );
    assert.deepEqual(prerenderedFormats, ['fitted']);
  });
});
