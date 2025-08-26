import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MonacoService from '@cardstack/host/services/monaco-service';

module('Unit | Service | ai-assistant-panel-service', function (hooks) {
  setupTest(hooks);

  test('focusPillCodeRange returns undefined when there is no selection', function (assert) {
    let service = this.owner.lookup(
      'service:ai-assistant-panel-service',
    ) as AiAssistantPanelService;

    let monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;

    // Mock no selection
    monacoService.trackedSelection = null;

    assert.strictEqual(
      service.focusPillCodeRange,
      undefined,
      'returns undefined when trackedSelection is null',
    );
  });

  test('focusPillCodeRange returns undefined when there is only a cursor position (no actual selection)', function (assert) {
    let service = this.owner.lookup(
      'service:ai-assistant-panel-service',
    ) as AiAssistantPanelService;

    let monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;

    // Mock cursor position at line 5, column 10 (no text selected)
    monacoService.trackedSelection = {
      startLineNumber: 5,
      startColumn: 10,
      endLineNumber: 5,
      endColumn: 10,
    } as any;

    assert.strictEqual(
      service.focusPillCodeRange,
      undefined,
      'returns undefined when there is only a cursor position',
    );
  });

  test('focusPillCodeRange returns "Line X" when selection is on a single line', function (assert) {
    let service = this.owner.lookup(
      'service:ai-assistant-panel-service',
    ) as AiAssistantPanelService;

    let monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;

    // Mock selection on line 3, columns 5-15
    monacoService.trackedSelection = {
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 3,
      endColumn: 15,
    } as any;

    assert.strictEqual(
      service.focusPillCodeRange,
      'Line 3',
      'returns "Line X" when selection is on a single line',
    );
  });

  test('focusPillCodeRange returns "Lines X-Y" when selection spans multiple lines', function (assert) {
    let service = this.owner.lookup(
      'service:ai-assistant-panel-service',
    ) as AiAssistantPanelService;

    let monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;

    // Mock selection from line 2 to line 5
    monacoService.trackedSelection = {
      startLineNumber: 2,
      startColumn: 10,
      endLineNumber: 5,
      endColumn: 20,
    } as any;

    assert.strictEqual(
      service.focusPillCodeRange,
      'Lines 2-5',
      'returns "Lines X-Y" when selection spans multiple lines',
    );
  });

  test('focusPillCodeRange handles single character selection on same line', function (assert) {
    let service = this.owner.lookup(
      'service:ai-assistant-panel-service',
    ) as AiAssistantPanelService;

    let monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;

    // Mock single character selection on line 1 (column 5 to 6)
    monacoService.trackedSelection = {
      startLineNumber: 1,
      startColumn: 5,
      endLineNumber: 1,
      endColumn: 6,
    } as any;

    assert.strictEqual(
      service.focusPillCodeRange,
      'Line 1',
      'returns "Line 1" for single character selection',
    );
  });
});
