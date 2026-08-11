import {
  toAfterOptionsComponent,
  toBeforeOptionsComponent,
  toMultiSelectTriggerComponent,
  toSelectedItemComponent,
  toTriggerComponent,
} from '@cardstack/boxel-ui/components';
import { module, test } from 'qunit';

module('Unit | select component adapters', function () {
  test('the trusted public adapters preserve component identity', function (assert) {
    class ExampleComponent {}
    let component = ExampleComponent as never;
    let assertIdentity = (adapted: unknown) =>
      assert.strictEqual(adapted, ExampleComponent);

    assertIdentity(toTriggerComponent(component));
    assertIdentity(toMultiSelectTriggerComponent(component));
    assertIdentity(toBeforeOptionsComponent(component));
    assertIdentity(toSelectedItemComponent(component));
    assertIdentity(toAfterOptionsComponent(component));
  });
});
