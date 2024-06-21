import { module, test } from 'qunit';

import { Panellike, resizePanels } from '@cardstack/boxel-ui/components';

module('Unit | ResizablePanelGroup | resizePanels', function () {
  test('it preserves the existing ratio', async function (assert) {
    let panels: Panellike[] = [
      { lengthPx: 50, ratio: 0.5 },
      { lengthPx: 50, ratio: 0.5 },
    ];

    resizePanels(panels, 200);

    assert.strictEqual(panels[0].lengthPx, 100);
    assert.strictEqual(panels[1].lengthPx, 100);
  });

  test('it respects the miminum length', async function (assert) {
    let panels: Panellike[] = [
      { lengthPx: 50, ratio: 0.5, initialMinLengthPx: 40 },
      { lengthPx: 50, ratio: 0.5 },
    ];

    resizePanels(panels, 50);

    assert.strictEqual(panels[0].lengthPx, 40);
    assert.strictEqual(panels[1].lengthPx, 10);
  });
});
