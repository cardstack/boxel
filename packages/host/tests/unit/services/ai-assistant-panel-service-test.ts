import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MonacoService from '@cardstack/host/services/monaco-service';

module('Unit | Service | ai-assistant-panel-service', function (hooks) {
  setupTest(hooks);

  let service: AiAssistantPanelService;
  let monacoService: MonacoService;

  hooks.beforeEach(function () {
    service = getService('ai-assistant-panel-service');
    monacoService = getService('monaco-service');
  });

  test('focusPillCodeRange returns undefined when there is no selection', function (assert) {
    // Mock no selection
    monacoService.trackedSelection = null;

    assert.strictEqual(
      service.focusPillCodeRange,
      undefined,
      'returns undefined when trackedSelection is null',
    );
  });

  test('focusPillCodeRange returns undefined when there is only a cursor position (no actual selection)', function (assert) {
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

  test('focusPillMetaPills returns array combining itemType and codeRange', function (assert) {
    // Mock selection for codeRange
    monacoService.trackedSelection = {
      startLineNumber: 2,
      startColumn: 10,
      endLineNumber: 5,
      endColumn: 20,
    } as any;

    // Test that the getter combines the existing getters correctly
    const result = service.focusPillMetaPills;

    const expected: string[] = [
      service.focusPillItemType,
      service.focusPillFormat,
      service.focusPillCodeRange,
    ].filter((s) => s !== undefined) as string[];

    assert.deepEqual(
      result,
      expected,
      'returns array combining itemType, format, and codeRange',
    );
  });

  test('focusPillMetaPills returns empty array when no selection', function (assert) {
    // Mock no selection
    monacoService.trackedSelection = null;

    const result = service.focusPillMetaPills;

    // When there's no selection, we should get an empty array or array with just itemType
    assert.ok(Array.isArray(result), 'returns an array');

    // If there's an itemType but no codeRange, we should get just itemType
    const itemType = service.focusPillItemType;
    if (itemType) {
      assert.deepEqual(
        result,
        [itemType],
        'returns array with just itemType when no selection',
      );
    } else {
      assert.deepEqual(
        result,
        [],
        'returns empty array when no itemType or codeRange',
      );
    }
  });

  test('focusPillMetaPills maintains correct order', function (assert) {
    // Mock selection to ensure we have a codeRange
    monacoService.trackedSelection = {
      startLineNumber: 3,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 10,
    } as any;

    const itemType = service.focusPillItemType;
    const codeRange = service.focusPillCodeRange;
    const metaPills = service.focusPillMetaPills;

    // Verify itemType comes first if it exists
    if (itemType !== undefined) {
      assert.strictEqual(
        metaPills[0],
        itemType,
        'itemType appears first in meta pills array',
      );
    }

    // Verify codeRange appears in correct position
    if (codeRange !== undefined) {
      const expectedIndex = itemType !== undefined ? 1 : 0;
      assert.strictEqual(
        metaPills[expectedIndex],
        codeRange,
        'codeRange appears in correct position in meta pills array',
      );
    }
  });
});
