import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { doubleClick, render, RenderingTestContext } from '@ember/test-helpers';
import { htmlSafe } from '@ember/template';
import { ResizablePanelGroup } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { triggerEvent } from '@ember/test-helpers';

const RESIZE_HANDLE_WIDTH = 15.126;
const PANEL_INDEX_1_MIN_LENGTH = 50;

class PanelProperties {
  @tracked lengthPx?: number;
  @tracked isHidden?: boolean;
  @tracked defaultLengthFraction?: number;
  @tracked minLengthPx?: number;
  collapsible: boolean;

  outerContainerStyle?: string;
  showResizeHandle?: boolean;
  constructor(
    panelArgs: {
      lengthPx?: number;
      isHidden?: boolean;
      defaultLengthFraction?: number;
      minLengthPx?: number;
      outerContainerStyle?: string;
      showResizeHandle?: boolean;
      collapsible?: boolean;
    } = {},
    testArgs: {
      outerContainerStyle?: string;
      showResizeHandle?: boolean;
    } = {},
  ) {
    let {
      lengthPx,
      isHidden = false,
      defaultLengthFraction,
      minLengthPx,
      collapsible,
    } = panelArgs;
    let { outerContainerStyle, showResizeHandle } = testArgs;
    this.lengthPx = lengthPx;
    this.isHidden = isHidden;
    this.defaultLengthFraction = defaultLengthFraction;
    this.minLengthPx = minLengthPx;
    this.collapsible = collapsible ?? true;

    this.showResizeHandle = showResizeHandle;

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

let orientationPropertiesToTest = [
  {
    orientation: 'horizontal',
    axis: 'x',
    dimension: 'width',
    perpendicularDimension: 'height',
  },
  {
    orientation: 'vertical',
    axis: 'y',
    dimension: 'height',
    perpendicularDimension: 'width',
  },
];

orientationPropertiesToTest.forEach((orientationProperties) => {
  module(
    `Integration | ResizablePanelGroup | ${orientationProperties.orientation}`,
    function (hooks) {
      setupRenderingTest(hooks);
      hooks.beforeEach(function (this: MyTestContext) {
        this.renderController = new RenderController();
        this.renderController.panels = [
          new PanelProperties(
            { defaultLengthFraction: 0.6 },
            {
              showResizeHandle: true,
              outerContainerStyle: `
                border: 1px solid red;
                ${orientationProperties.dimension}: 100%;
                overflow-${orientationProperties.axis}: auto
              `,
            },
          ),
          new PanelProperties(
            {
              defaultLengthFraction: 0.4,
              minLengthPx: PANEL_INDEX_1_MIN_LENGTH,
            },
            {
              outerContainerStyle: `
                border: 1px solid red;
                ${orientationProperties.dimension}: 100%
              `,
            },
          ),
        ];
      });

      async function renderResizablePanelGroup(
        renderController: RenderController,
      ) {
        // Putting this in <style scoped> causes syntax highlighting to break
        let testContainerStyles = `
            #test-container {
              ${orientationProperties.perpendicularDimension}: 100px;
              max-${orientationProperties.dimension}: 100%;
            }
        `;
        console.log(renderController.panels[1]);

        await render(<template>
          {{! template-lint-disable no-inline-styles }}
          <style scoped>{{testContainerStyles}}</style>
          <div style={{htmlSafe renderController.containerStyle}}>
            <ResizablePanelGroup
              @orientation={{orientationProperties.orientation}}
              @reverseCollapse={{true}}
              as |ResizablePanel ResizeHandle|
            >
              {{#each renderController.panels as |panel index|}}
                <ResizablePanel
                  @defaultLengthFraction={{panel.defaultLengthFraction}}
                  @lengthPx={{panel.lengthPx}}
                  @minLengthPx={{panel.minLengthPx}}
                  @isHidden={{panel.isHidden}}
                  @collapsible={{panel.collapsible}}
                >
                  <div
                    class='panel'
                    style={{htmlSafe
                      (if
                        panel.outerContainerStyle panel.outerContainerStyle ''
                      )
                    }}
                    data-test-panel-index={{index}}
                  >
                    <div>
                      Panel
                      {{index}}
                    </div>
                  </div>
                </ResizablePanel>
                {{#if panel.showResizeHandle}}
                  <ResizeHandle />
                {{/if}}
              {{/each}}
            </ResizablePanelGroup>
          </div>
        </template>);
        await waitForRerender();
      }

      test<MyTestContext>(`it can lay out panels with ${orientationProperties.orientation} orientation (default)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${300 + RESIZE_HANDLE_WIDTH}px;
        `;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          300 * 0.6,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          300 * 0.4,
          1,
        );
      });

      test<MyTestContext>(`it can lay out panels with ${orientationProperties.orientation} orientation (length specified)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${500 + RESIZE_HANDLE_WIDTH}px;
          `;

        this.renderController.panels[0].lengthPx = 355;
        this.renderController.panels[1].lengthPx = 143;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          355,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          143,
          1,
        );
      });

      test<MyTestContext>(`it respects ${orientationProperties.orientation} minLength (default)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 105px;
        `;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          40,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          PANEL_INDEX_1_MIN_LENGTH,
          1,
        );
      });

      test<MyTestContext>(`it respects ${orientationProperties.orientation} minLength (length specified)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 105px;
        `;

        this.renderController.panels[0].lengthPx = 45;
        this.renderController.panels[1].lengthPx = 45;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          40,
          2,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          PANEL_INDEX_1_MIN_LENGTH,
          2,
        );
      });

      test<MyTestContext>(`it adjusts to its container growing (default)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${200 + RESIZE_HANDLE_WIDTH}px;
        `;

        await renderResizablePanelGroup(this.renderController);

        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${400 + RESIZE_HANDLE_WIDTH}px;
        `;
        await waitForRerender();

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          240,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          160,
          1,
        );
      });

      test<MyTestContext>(`it adjusts to its container growing (length specified)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${200 + RESIZE_HANDLE_WIDTH}px;
        `;

        this.renderController.panels[0].lengthPx = 100;
        this.renderController.panels[1].lengthPx = 100;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          100,
          1.5,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          100,
          1.5,
        );

        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${400 + RESIZE_HANDLE_WIDTH}px;
        `;
        await waitForRerender();

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          200,
          1.5,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          200,
          1.5,
        );
      });

      test<MyTestContext>(`it adjusts to its container shrinking (default)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${400 + RESIZE_HANDLE_WIDTH}x;
        `;

        await renderResizablePanelGroup(this.renderController);
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${200 + RESIZE_HANDLE_WIDTH}px;
        `;

        await waitForRerender();

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          120,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          80,
          1,
        );
      });

      test<MyTestContext>(`it maintans ratio when its container shrinks`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 417px;
        `;

        // length ratio panel 1 and panel 2 is 3:2
        this.renderController.panels[0].lengthPx = 240;
        this.renderController.panels[1].lengthPx = 160;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          240,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          160,
          1,
        );

        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 217px;
        `;

        await waitForRerender();
        // Maintain the ratio 3:2 when resizing
        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          120,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          80,
          1,
        );
      });

      test<MyTestContext>(`it adjusts to its container shrinking and growing`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${600 + RESIZE_HANDLE_WIDTH}px;
        `;

        this.renderController.panels[0].lengthPx = 400;
        this.renderController.panels[1].lengthPx = 200;

        await renderResizablePanelGroup(this.renderController);

        this.renderController.panels[0].lengthPx = 50;
        this.renderController.panels[1].lengthPx = 550;

        await waitForRerender();

        await doubleClick('[data-test-resize-handle]'); // Double-click to hide recent
        await waitForRerender();

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          600,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          0,
          2,
        );

        // shrink container by ~5
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${300 + RESIZE_HANDLE_WIDTH}px;
        `;

        await waitForRerender();

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          300,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          0,
          2,
        );

        await doubleClick('[data-test-resize-handle]'); // Double-click to unhide recent

        await waitForRerender();

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          180,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          120,
          1,
        );

        // increase window/container length to original length
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 617px;
        `;

        await waitForRerender();

        // expected behavior: panel length percentages would remain consistent
        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          360,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          240,
          1,
        );
      });

      test<MyTestContext>(`it excludes hidden panels from participating in layout`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${200 + RESIZE_HANDLE_WIDTH}px;
        `;

        this.renderController.panels = [
          new PanelProperties(
            { defaultLengthFraction: 0.6 },
            {
              outerContainerStyle: `
                ${orientationProperties.dimension}: 100%;
                overflow-${orientationProperties.axis}: auto
              `,
            },
          ),
          new PanelProperties(
            {
              defaultLengthFraction: 0.4,
              minLengthPx: PANEL_INDEX_1_MIN_LENGTH,
              isHidden: true,
            },
            {
              outerContainerStyle: `
                ${orientationProperties.dimension}: 100%
              `,
            },
          ),
        ];

        await renderResizablePanelGroup(this.renderController);

        await waitForRerender();

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          215,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          0,
          0,
        );

        this.renderController.panels[1].isHidden = false;
        await waitForRerender();

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          165,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          PANEL_INDEX_1_MIN_LENGTH,
          1,
        );

        this.renderController.panels[1].isHidden = true;
        await waitForRerender();

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          215,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          0,
          0,
        );
      });

      test<MyTestContext>(`it stops expanding/shrinking if cursor is not in the right position`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${300 + RESIZE_HANDLE_WIDTH}px;
        `;
        this.renderController.panels[1].minLengthPx = 60;
        this.renderController.panels[1].collapsible = false;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '[data-test-panel-index="0"]',
          orientationProperties.dimension,
          300 * 0.6,
          1,
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          300 * 0.4,
          1,
        );

        let resizeHandleRect = document
          .querySelector('[data-test-resize-handle]')!
          .getBoundingClientRect();
        await triggerEvent('[data-test-resize-handle]', 'mousedown');
        await triggerEvent(
          '[data-test-resize-handle]',
          'mousemove',
          orientationProperties.orientation === 'horizontal'
            ? {
                clientX: resizeHandleRect.x + 60,
                clientY: 25,
              }
            : {
                clientX: 25,
                clientY: resizeHandleRect.y + 60,
              },
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          this.renderController.panels[1].minLengthPx,
          1,
        );

        // Mouse move event doesn't give any effects
        // since the cursor drags past minimum length
        resizeHandleRect = document
          .querySelector('[data-test-resize-handle]')!
          .getBoundingClientRect();
        await triggerEvent(
          '[data-test-resize-handle]',
          'mousemove',
          orientationProperties.orientation === 'horizontal'
            ? {
                clientX: resizeHandleRect.x + 40,
                clientY: 25,
              }
            : {
                clientX: 25,
                clientY: resizeHandleRect.y + 40,
              },
        );
        assert.hasNumericStyle(
          '[data-test-panel-index="1"]',
          orientationProperties.dimension,
          this.renderController.panels[1].minLengthPx,
          1,
        );
        await triggerEvent('[data-test-resize-handle]', 'mouseup');
      });
    },
  );
});

function waitForRerender() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 100);
  });
}
