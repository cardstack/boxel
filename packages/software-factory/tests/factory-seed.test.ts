import { module, test } from 'qunit';

import type { FactoryBrief } from '../src/factory-brief.ts';
import { shouldWarnMissingSourceCardUrl } from '../src/factory-seed.ts';

function makeBrief(overrides: Partial<FactoryBrief> = {}): FactoryBrief {
  return {
    title: 'Sticky Note',
    sourceUrl: 'http://localhost:4201/software-factory/Wiki/sticky-note',
    content: 'Build a colorful short-form note card for spatial boards.',
    contentSummary: 'A colorful sticky note card.',
    tags: [],
    ...overrides,
  };
}

module('factory-seed > shouldWarnMissingSourceCardUrl', function () {
  test('warns when adjust-intent prose has no sourceCardUrl', function (assert) {
    let brief = makeBrief({
      title: 'Wine Cellar — User Rating',
      content:
        'This adjusts an existing card that already lives in the catalog realm. ' +
        'Bring the source card in and adjust it rather than rebuild from scratch.',
    });
    assert.true(shouldWarnMissingSourceCardUrl(brief));
  });

  test('does not warn for a normal greenfield brief', function (assert) {
    let brief = makeBrief();
    assert.false(shouldWarnMissingSourceCardUrl(brief));
  });

  test('does not warn when sourceCardUrl is set (adjust flow already triggered)', function (assert) {
    let brief = makeBrief({
      title: 'Wine Cellar — User Rating',
      content: 'This adjusts an existing card. Bring the source card in.',
      sourceCardUrl:
        'https://localhost:4201/catalog/4b6602-wine-cellar-card-definition/WineCellar/c7b6f051',
    });
    assert.false(shouldWarnMissingSourceCardUrl(brief));
  });
});
