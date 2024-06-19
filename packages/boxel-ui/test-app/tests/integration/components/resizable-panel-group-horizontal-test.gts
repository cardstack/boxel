import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { doubleClick, render, RenderingTestContext } from '@ember/test-helpers';
import { ResizablePanelGroup } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { eq } from '@cardstack/boxel-ui/helpers';

function sleep(ms: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

class PanelProperties {
  @tracked lengthPx?: number;
  @tracked isHidden?: boolean;
  @tracked defaultLengthFraction?: number;
  @tracked minLengthPx?: number;

  innerContainerStyle?: string;
  outerContainerStyle?: string;
  showResizeHandle?: boolean;
  constructor(
    panelArgs: {
      lengthPx?: number;
      isHidden?: boolean;
      defaultLengthFraction?: number;
      minLengthPx?: number;
      innerContainerStyle?: string;
      outerContainerStyle?: string;
      showResizeHandle?: boolean;
    } = {},
    testArgs: {
      innerContainerStyle?: string;
      outerContainerStyle?: string;
      showResizeHandle?: boolean;
    } = {},
  ) {
    let {
      lengthPx,
      isHidden = false,
      defaultLengthFraction,
      minLengthPx,
    } = panelArgs;
    let { innerContainerStyle, outerContainerStyle, showResizeHandle } =
      testArgs;
    this.lengthPx = lengthPx;
    this.isHidden = isHidden;
    this.defaultLengthFraction = defaultLengthFraction;
    this.minLengthPx = minLengthPx;

    this.showResizeHandle = showResizeHandle;

    this.innerContainerStyle = innerContainerStyle;
    this.outerContainerStyle = outerContainerStyle;
  }
}

class RenderController {
  @tracked containerStyle = '';
  @tracked panels: PanelProperties[] = [];
}

interface MyTestContext extends RenderingTestContext {
  renderController: RenderController;
}

module('Integration | ResizablePanelGroup | horizontal', function (hooks) {
  setupRenderingTest(hooks);
  hooks.beforeEach(function (this: MyTestContext) {
    this.renderController = new RenderController();
    this.renderController.panels = [
      new PanelProperties(
        { defaultLengthFraction: 0.6 },
        {
          showResizeHandle: true,
          outerContainerStyle:
            'border: 1px solid red; height: 100%; overflow-y:auto',
        },
      ),
      new PanelProperties(
        { defaultLengthFraction: 0.4, minLengthPx: 50 },
        {
          outerContainerStyle: 'border: 1px solid red; height: 100%',
        },
      ),
    ];
  });

  async function renderHorizontalResizablePanelGroup(
    renderController: RenderController,
  ) {
    await render(<template>
      {{! template-lint-disable no-inline-styles }}
      <div id='test-container' style={{renderController.containerStyle}}>
        <ResizablePanelGroup
          @orientation='horizontal'
          @reverseCollapse={{true}}
          as |ResizablePanel ResizeHandle|
        >
          {{#each renderController.panels as |panel index|}}

            <ResizablePanel
              @defaultLengthFraction={{panel.defaultLengthFraction}}
              @lengthPx={{panel.lengthPx}}
              @minLengthPx={{panel.minLengthPx}}
              @isHidden={{panel.isHidden}}
            >
              {{#if (eq index 1)}}
                <div
                  class='panel-{{index}}-content'
                  style={{panel.outerContainerStyle}}
                >
                  <div>
                    Panel
                    {{index}}
                  </div>
                </div>
              {{else}}
                <div
                  class='panel-{{index}}-content'
                  style={{panel.outerContainerStyle}}
                >
                  Panel 2
                </div>
              {{/if}}
            </ResizablePanel>
            {{#if panel.showResizeHandle}}
              <ResizeHandle />
            {{/if}}
          {{/each}}
        </ResizablePanelGroup>
      </div>
    </template>);
    await sleep(100); // let didResizeModifier run
  }

  test<MyTestContext>('it can lay out panels horizontally', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 100px; width: 318px;';
    await renderHorizontalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-0-content', 'width', 300 * 0.6, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 300 * 0.4, 1);
  });

  test<MyTestContext>('it can lay out panels horizontally (length specified)', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 518px; border: 1px solid green';
    this.renderController.panels[0].lengthPx = 355;
    this.renderController.panels[1].lengthPx = 143;
    await renderHorizontalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-0-content', 'width', 355, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 143, 1);
  });

  test<MyTestContext>('it respects horizontal minLength (default)', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 108px;';
    await renderHorizontalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-0-content', 'width', 40, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 50, 1);
  });

  test<MyTestContext>('it respects horizontal minLength (length specified)', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 108px; border: 1px solid green';
    this.renderController.panels[0].lengthPx = 45;
    this.renderController.panels[1].lengthPx = 45;
    await renderHorizontalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-0-content', 'width', 40, 2);
    assert.hasNumericStyle('.panel-1-content', 'width', 50, 2);
  });

  test<MyTestContext>('it adjusts to its container growing (default)', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 218px;';
    await renderHorizontalResizablePanelGroup(this.renderController);
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 418px;';
    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-0-content', 'width', 240, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 160, 1);
  });

  test<MyTestContext>('it adjusts to its container growing (length specified)', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 218px; border: 1px solid green';
    this.renderController.panels[0].lengthPx = 100;
    this.renderController.panels[1].lengthPx = 100;
    await renderHorizontalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-0-content', 'width', 100, 1.5);
    assert.hasNumericStyle('.panel-1-content', 'width', 100, 1.5);
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 418px; border: 1px solid green';
    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-0-content', 'width', 200, 1.5);
    assert.hasNumericStyle('.panel-1-content', 'width', 200, 1.5);
  });

  test<MyTestContext>('it adjusts to its container shrinking (default)', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 418px;';
    await renderHorizontalResizablePanelGroup(this.renderController);
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 218px;';
    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-0-content', 'width', 120, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 80, 1);
  });

  test<MyTestContext>('it adjusts to its container shrinking (length specified A)', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 420px; border: 1px solid green';
    // Height ratio panel 1 and panel 2 is 3:2
    this.renderController.panels[0].lengthPx = 240;
    this.renderController.panels[1].lengthPx = 160;
    await renderHorizontalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-0-content', 'width', 240, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 160, 1);
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 220px; border: 1px solid green';
    await sleep(100); // let didResizeModifier run
    // Maintain the ratio 3:2 when resizing
    assert.hasNumericStyle('.panel-0-content', 'width', 120, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 80, 1);
  });

  test<MyTestContext>('it adjusts to its container shrinking (length specified B)', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 620px; border: 1px solid green';
    // Height ratio panel 1 and panel 2 is 2:1
    this.renderController.panels[0].lengthPx = 400;
    this.renderController.panels[1].lengthPx = 200;
    this.renderController.panels[0].innerContainerStyle =
      'height: 180px; background: blue';
    await renderHorizontalResizablePanelGroup(this.renderController);
    assert.hasNumericStyle('.panel-0-content', 'width', 400, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 200, 1);
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 220px; border: 1px solid green';
    await sleep(100); // let didResizeModifier run
    // Maintain the ratio 2:1 when resizing
    assert.hasNumericStyle('.panel-0-content', 'width', 133, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 67, 1);
  });

  test<MyTestContext>('it adjusts to its container shrinking and growing', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 620px; border: 1px solid green';
    this.renderController.panels[0].lengthPx = 400;
    this.renderController.panels[1].lengthPx = 200;
    this.renderController.panels[0].innerContainerStyle =
      'height: 180px; background: blue';
    await renderHorizontalResizablePanelGroup(this.renderController);
    this.renderController.panels[0].lengthPx = 50;
    this.renderController.panels[1].lengthPx = 550;
    await sleep(100); // let didResizeModifier run
    await doubleClick('[data-test-resize-handle]'); // Double-click to hide recent
    await sleep(100); // let onResizeHandleDblClick run
    assert.hasNumericStyle('.panel-0-content', 'width', 600, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 0, 2);
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 320px; border: 1px solid green'; // shrink container by ~50%
    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-0-content', 'width', 300, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 0, 2);
    await doubleClick('[data-test-resize-handle]'); // Double-click to unhide recent
    await sleep(100); // let onResizeHandleDblClick run
    assert.hasNumericStyle('.panel-0-content', 'width', 180, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 120, 1);
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 620px; border: 1px solid green'; // increase window/container height to original height
    await sleep(100); // let didResizeModifier run
    // expected behavior: panel height percentages would remain consistent
    assert.hasNumericStyle('.panel-0-content', 'width', 360, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 240, 1);
  });

  test<MyTestContext>('it excludes hidden panels from participating in layout', async function (assert) {
    this.renderController.containerStyle =
      'max-width: 100%; height: 200px; width: 218px;';
    this.renderController.panels = [
      new PanelProperties(
        { defaultLengthFraction: 0.6 },
        {
          outerContainerStyle: 'width: 100%; overflow-x:auto',
        },
      ),
      new PanelProperties(
        { defaultLengthFraction: 0.4, minLengthPx: 50, isHidden: true },
        {
          outerContainerStyle: 'width: 100%',
        },
      ),
    ];
    await renderHorizontalResizablePanelGroup(this.renderController);

    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-0-content', 'width', 218, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 0, 0);
    this.renderController.panels[1].isHidden = false;
    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-0-content', 'width', 168, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 50, 1);
    this.renderController.panels[1].isHidden = true;
    await sleep(100); // let didResizeModifier run
    assert.hasNumericStyle('.panel-0-content', 'width', 218, 1);
    assert.hasNumericStyle('.panel-1-content', 'width', 0, 0);
  });
});
