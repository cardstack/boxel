// Pretui — alias exports. Each catalog alias row is another kit's name for a
// component the kit already ships; these tests pin every alias to its target
// so a rename in one module cannot silently give the alias a different
// meaning. RangeSlider is the one alias that is a wrapper rather than the
// same export, so it renders.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Collapsible } from './components/collapsible';
import { Disclosure } from './components/disclosure';
import { Empty } from './components/empty';
import { EmptyState } from './components/empty-state';
import { Command } from './components/command';
import { CommandPalette } from './components/command-palette';
import { OtpInput } from './components/otp-input';
import { PinInput } from './components/pin-input';
import { RangeSlider } from './components/range-slider';
import { DuelingPicklist } from './components/dueling-picklist';
import { Transfer } from './components/transfer';
import { Alert } from './components/alert';
import { Callout } from './components/callout';
import { Loader } from './components/loader';
import { Snackbar } from './components/snackbar';
import { Spinner } from './components/spinner';
import { Toast } from './components/toast';
import { Sonner } from './components/sonner';
import { Toaster } from './components/toaster';
import { Fab } from './components/fab';
import { FloatButton } from './components/float-button';
import { Resizable } from './components/resizable';
import { SplitPanes } from './components/split-panes';
import { Modal } from './components/modal';
import { Dialog } from './components/dialog';
import { SlideOver } from './components/slide-over';
import { Drawer } from './components/drawer';
import { Separator } from './components/separator';
import { Divider } from './components/divider';

const BAND: [number, number] = [20, 60];

module('Pretui | alias exports', function (hooks) {
  setupCardTest(hooks);

  test('every renamed alias is the same export as its target', function (assert) {
    assert.strictEqual(Disclosure, Collapsible, 'Disclosure is Collapsible');
    assert.strictEqual(Empty, EmptyState, 'Empty is EmptyState');
    assert.strictEqual(Command, CommandPalette, 'Command is CommandPalette');
    assert.strictEqual(PinInput, OtpInput, 'PinInput is OtpInput');
    assert.strictEqual(Transfer, DuelingPicklist, 'Transfer is DuelingPicklist');
    assert.strictEqual(Callout, Alert, 'Callout is Alert');
    assert.strictEqual(Loader, Spinner, 'Loader is Spinner');
    assert.strictEqual(Snackbar, Toast, 'Snackbar is Toast');
    assert.strictEqual(Sonner, Toaster, 'Sonner is Toaster');
    assert.strictEqual(Fab, FloatButton, 'Fab is FloatButton');
    assert.strictEqual(Resizable, SplitPanes, 'Resizable is SplitPanes');
    assert.strictEqual(Modal, Dialog, 'Modal is Dialog');
    assert.strictEqual(SlideOver, Drawer, 'SlideOver is Drawer');
    assert.strictEqual(Separator, Divider, 'Separator is Divider');
  });

  test('RangeSlider is a Slider with two thumbs and no single-value mode', async function (assert) {
    await render(
      <template>
        <RangeSlider @label='Price' @min={{0}} @max={{100}} @defaultValues={{BAND}} />
      </template>,
    );
    let root = document.querySelector('[data-test-pretui-slider]') as HTMLElement;
    assert.ok(root, 'the wrapper renders the Slider root');
    assert.strictEqual(
      root.querySelectorAll('input[type="range"]').length,
      2,
      'range mode is forced on: two native inputs',
    );
  });
});
