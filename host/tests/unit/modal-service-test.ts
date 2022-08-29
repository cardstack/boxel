import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';
import Modal from 'runtime-spike/services/modal';

module('Unit | modal-service', function (hooks) {
  setupTest(hooks);

  test('it can change the modal state on open and close', async function (assert) {
    let modalService = this.owner.lookup('service:modal') as Modal;
    assert.ok(!modalService.isShowing, 'modal is not showing on init');

    modalService.open();
    assert.ok(modalService.isShowing, 'modal is in loaded state');

    modalService.close();
    assert.ok(!modalService.isShowing, 'modal is in empty state');
  });
});
