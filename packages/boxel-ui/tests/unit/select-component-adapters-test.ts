import { module, test } from 'qunit';

import {
  toAfterOptionsComponent,
  toBeforeOptionsComponent,
  toMultiSelectTriggerComponent,
  toSelectedItemComponent,
  toTriggerComponent,
} from '@cardstack/boxel-ui/components';

module('Unit | select component adapters', function () {
  test('the trusted public adapters preserve component identity', function (assert) {
    class ExampleComponent {}

    assert.strictEqual(toTriggerComponent(ExampleComponent), ExampleComponent);
    assert.strictEqual(
      toMultiSelectTriggerComponent(ExampleComponent),
      ExampleComponent,
    );
    assert.strictEqual(
      toBeforeOptionsComponent(ExampleComponent),
      ExampleComponent,
    );
    assert.strictEqual(
      toSelectedItemComponent(ExampleComponent),
      ExampleComponent,
    );
    assert.strictEqual(
      toAfterOptionsComponent(ExampleComponent),
      ExampleComponent,
    );
  });
});
