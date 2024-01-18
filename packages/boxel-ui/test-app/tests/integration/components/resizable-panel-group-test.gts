import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { doubleClick, render, RenderingTestContext } from '@ember/test-helpers';
import { ResizablePanelGroup } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';

function sleep(ms: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

class RenderController {
  @tracked containerStyle = '';
  @tracked panel1LengthPx: number | undefined;
  @tracked panel2LengthPx: number | undefined;
  panel1InnerContentStyle: string | undefined;
}

interface MyTestContext extends RenderingTestContext {
  renderController: RenderController;
}

module('Integration | ResizablePanelGroup', function (hooks) {
  setupRenderingTest(hooks);
  hooks.beforeEach(function (this: MyTestContext) {
    this.renderController = new RenderController();
  });

  async function renderVerticalResizablePanelGroup(
    renderController: RenderController,
  ) {
    await render(<template>
      {{! template-lint-disable no-inline-styles }}
      <div id='test-container' style={{renderController.containerStyle}}>
        <ResizablePanelGroup
          @orientation='vertical'
          @reverseCollapse={{true}}
          as |ResizablePanel ResizeHandler|
        >
          <ResizablePanel
            @defaultLengthFraction={{0.6}}
            @lengthPx={{renderController.panel1LengthPx}}
          >
            <div
              class='panel-1-content'
              style='border: 1px solid red; height: 100%; overflow-y:auto'
            >
              <div style={{renderController.panel1InnerContentStyle}}>
                Panel 1
              </div>
            </div>
          </ResizablePanel>
          <ResizeHandler />
          <ResizablePanel
            @defaultLengthFraction={{0.4}}
            @minLengthPx={{50}}
            @lengthPx={{renderController.panel2LengthPx}}
          >
            <div
              class='panel-2-content'
              style='border: 1px solid red; height: 100%;'
            >
              Panel 2
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </template>);
    await sleep(100); // let didResizeModifier run
  }

  test('it can lay out panels vertically (default)', async function (this: MyTestContext, assert) {
    this.renderController.containerStyle =
      'max-height: 100%; width: 100px; height: 318px;';
    await renderVerticalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-1-content', 'height', (318 - 18) * 0.6, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', (318 - 18) * 0.4, 1);
  });

  test('it can lay out panels vertically (length specified)', async function (this: MyTestContext, assert) {
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 518px; border: 1px solid green';
    this.renderController.panel1LengthPx = 355;
    this.renderController.panel2LengthPx = 143;
    await renderVerticalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-1-content', 'height', 355, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 143, 1);
  });

  test('it respects vertical minLength (default)', async function (this: MyTestContext, assert) {
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 108px;';
    await renderVerticalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-1-content', 'height', 40, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 50, 1);
  });

  test('it respects vertical minLength (length specified)', async function (this: MyTestContext, assert) {
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 108px; border: 1px solid green';
    this.renderController.panel1LengthPx = 45;
    this.renderController.panel2LengthPx = 45;
    await renderVerticalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-1-content', 'height', 40, 2);
    assert.hasNumericStyle('.panel-2-content', 'height', 50, 2);
  });

  test('it adjusts to its container growing (default)', async function (this: MyTestContext, assert) {
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 218px;';
    await renderVerticalResizablePanelGroup(this.renderController);
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 418px;';
    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-1-content', 'height', 240, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 160, 1);
  });

  test('it adjusts to its container growing (length specified)', async function (this: MyTestContext, assert) {
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 218px; border: 1px solid green';
    this.renderController.panel1LengthPx = 100;
    this.renderController.panel2LengthPx = 100;
    await renderVerticalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-1-content', 'height', 100, 1.5);
    assert.hasNumericStyle('.panel-2-content', 'height', 100, 1.5);
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 418px; border: 1px solid green';
    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-1-content', 'height', 200, 1.5);
    assert.hasNumericStyle('.panel-2-content', 'height', 200, 1.5);
  });

  test('it adjusts to its container shrinking (default)', async function (this: MyTestContext, assert) {
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 418px;';
    await renderVerticalResizablePanelGroup(this.renderController);
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 218px;';
    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-1-content', 'height', 120, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 80, 1);
  });

  test('it adjusts to its container shrinking (length specified A)', async function (this: MyTestContext, assert) {
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 420px; border: 1px solid green';
    // Height ratio panel 1 and panel 2 is 3:2
    this.renderController.panel1LengthPx = 240;
    this.renderController.panel2LengthPx = 160;
    await renderVerticalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-1-content', 'height', 240, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 160, 1);
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 220px; border: 1px solid green';
    await sleep(100); // let didResizeModifier run
    // Maintain the ratio 3:2 when resizing
    assert.hasNumericStyle('.panel-1-content', 'height', 120, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 80, 1);
  });

  test('it adjusts to its container shrinking (length specified B)', async function (this: MyTestContext, assert) {
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 620px; border: 1px solid green';
    // Height ratio panel 1 and panel 2 is 2:1
    this.renderController.panel1LengthPx = 400;
    this.renderController.panel2LengthPx = 200;
    this.renderController.panel1InnerContentStyle =
      'height: 180px; background: blue';
    await renderVerticalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-1-content', 'height', 400, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 200, 1);
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 220px; border: 1px solid green';
    await sleep(100); // let didResizeModifier run
    // Maintain the ratio 2:1 when resizing
    assert.hasNumericStyle('.panel-1-content', 'height', 133, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 67, 1);
  });

  test('it adjusts to its container shrinking and growing', async function (this: MyTestContext, assert) {
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 620px; border: 1px solid green';
    this.renderController.panel1LengthPx = 400;
    this.renderController.panel2LengthPx = 200;
    this.renderController.panel1InnerContentStyle =
      'height: 180px; background: blue';
    await renderVerticalResizablePanelGroup(this.renderController);
    this.renderController.panel1LengthPx = 50;
    this.renderController.panel2LengthPx = 550;
    await sleep(100); // let didResizeModifier run
    await doubleClick('[data-test-resize-handler]'); // Double-click to hide recent
    await sleep(100); // let onResizeHandlerDblClick run
    assert.hasNumericStyle('.panel-1-content', 'height', 600, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 0, 2);
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 320px; border: 1px solid green'; // shrink container by ~50%
    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-1-content', 'height', 300, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 0, 2);
    await doubleClick('[data-test-resize-handler]'); // Double-click to unhide recent
    await sleep(100); // let onResizeHandlerDblClick run
    assert.hasNumericStyle('.panel-1-content', 'height', 180, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 120, 1);
    this.renderController.containerStyle =
      'max-height: 100%; width: 200px; height: 620px; border: 1px solid green'; // increase window/container height to original height
    await sleep(100); // let didResizeModifier run
    // expected behavior: panel height percentages would remain consistent
    assert.hasNumericStyle('.panel-1-content', 'height', 360, 1);
    assert.hasNumericStyle('.panel-2-content', 'height', 240, 1);
  });
});
