import { ResizablePanelGroup } from '@cardstack/boxel-ui/components';
import type { Orientation } from '@cardstack/boxel-ui/components/resizable-panel-group/utils/types';
import { not } from '@cardstack/boxel-ui/helpers';
import { htmlSafe } from '@ember/template';
import type { RenderingTestContext } from '@ember/test-helpers';
import { doubleClick, find, render } from '@ember/test-helpers';
import { triggerEvent } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

const RESIZE_HANDLE_WIDTH = 8;
const PANEL_INDEX_1_MIN_SIZE = 15;

class PanelProperties {
  @tracked defaultSize?: number;
  @tracked minSize?: number;
  @tracked maxSize?: number;
  @tracked collapsible: boolean;
  @tracked isHidden?: boolean;

  outerContainerStyle?: string;
  showResizeHandle?: boolean;
  constructor(
    panelArgs: {
      collapsible?: boolean;
      defaultSize?: number;
      isHidden?: boolean;
      maxSize?: number;
      minSize?: number;
      outerContainerStyle?: string;
      showResizeHandle?: boolean;
    } = {},
    testArgs: {
      outerContainerStyle?: string;
      showResizeHandle?: boolean;
    } = {},
  ) {
    let { defaultSize, minSize, maxSize, collapsible, isHidden } = panelArgs;
    let { outerContainerStyle, showResizeHandle } = testArgs;
    this.defaultSize = defaultSize;
    this.minSize = minSize;
    this.maxSize = maxSize;
    this.collapsible = collapsible ?? true;
    this.isHidden = isHidden;

    this.showResizeHandle = showResizeHandle;

    this.outerContainerStyle = outerContainerStyle;
  }
}

class RenderController {
  @tracked containerStyle = '';
  @tracked panels: PanelProperties[] = [];
  @tracked reverseCollapse = true;
}

interface MyTestContext extends RenderingTestContext {
  renderController: RenderController;
}

let orientationPropertiesToTest = [
  {
    orientation: 'horizontal' as Orientation,
    axis: 'x',
    dimension: 'width',
    perpendicularDimension: 'height',
  },
  {
    orientation: 'vertical' as Orientation,
    axis: 'y',
    dimension: 'height',
    perpendicularDimension: 'width',
  },
];

let moveResizePanelHandle = async function ({
  panelIndex,
  orientation,
  moveDelta, // A negative indicates movement to the left in a horizontal orientation and upward in a vertical orientation. Several are moves in one drag, each from where it started.
  hitAreaMargin = 0,
  moveWithSeparator = false, // Use the separator parent element of the handle to move
  afterMove, // Called after each move, before the pointer is released
}: {
  afterMove?: (moveIndex: number) => void;
  hitAreaMargin?: number;
  moveDelta: number | number[];
  moveWithSeparator?: boolean;
  orientation: string;
  panelIndex: number;
}) {
  let groupEl = document.querySelector('[data-boxel-panel-group]');
  if (!groupEl) {
    throw new Error(`panelGroup is not found`);
  }
  let resizePanelHandles = document.querySelectorAll(
    `[data-boxel-panel-resize-handle-id]`,
  );
  let resizeHandleId = resizePanelHandles[panelIndex]!.getAttribute(
    'data-boxel-panel-resize-handle-id',
  );
  if (!resizeHandleId) {
    throw new Error(`resizePanelHandle with index: ${panelIndex} is not found`);
  }

  let groupRect = groupEl.getBoundingClientRect();
  let groupSizeInPixels =
    orientation === 'horizontal' ? groupRect.width : groupRect.height;
  let resizeHandleRect =
    resizePanelHandles[panelIndex]!.children[0]!.getBoundingClientRect();

  let elementToMove = find(
    `[data-boxel-panel-resize-handle-id="${resizeHandleId}"]`,
  );

  if (moveWithSeparator) {
    elementToMove = elementToMove!.parentElement;
  }

  await triggerEvent(
    elementToMove!,
    'pointerdown',
    orientation === 'horizontal'
      ? {
          clientX: resizeHandleRect.x + hitAreaMargin,
          clientY: resizeHandleRect.y,
        }
      : {
          clientX: resizeHandleRect.x,
          clientY: resizeHandleRect.y + hitAreaMargin,
        },
  );
  let moveDeltas = Array.isArray(moveDelta) ? moveDelta : [moveDelta];
  for (let [moveIndex, delta] of moveDeltas.entries()) {
    let moveDeltaInPixels = (groupSizeInPixels * delta) / 100;
    await triggerEvent(
      elementToMove!,
      'pointermove',
      orientation === 'horizontal'
        ? {
            clientX: resizeHandleRect.x + moveDeltaInPixels + hitAreaMargin,
            clientY: resizeHandleRect.y,
          }
        : {
            clientX: resizeHandleRect.x,
            clientY: resizeHandleRect.y + moveDeltaInPixels + hitAreaMargin,
          },
    );
    if (afterMove) {
      await waitForRerender();
      afterMove(moveIndex);
    }
  }
  await triggerEvent(elementToMove!, 'pointerup');
  await waitForRerender();
};

let assertPanels = function ({
  assert,
  orientation,
  panelSizesInPixels,
}: {
  assert: Assert;
  orientation: string;
  panelSizesInPixels: string[];
}) {
  let elements = document.querySelectorAll('[data-test-panel-index]');
  let computedStyles = Array.from(elements).map((element) =>
    window.getComputedStyle(element),
  );
  assert.deepEqual(computedStyles.length, panelSizesInPixels.length);
  for (let index = 0; index < panelSizesInPixels.length; index++) {
    assert.deepEqual(
      orientation === 'horizontal'
        ? computedStyles[index]!.width
        : computedStyles[index]!.height,
      panelSizesInPixels[index],
    );
  }
};

orientationPropertiesToTest.forEach((orientationProperties) => {
  module(
    `Integration | ResizablePanelGroup | ${orientationProperties.orientation}`,
    function (hooks) {
      setupRenderingTest(hooks);
      hooks.beforeEach(function (this: MyTestContext) {
        this.renderController = new RenderController();
        this.renderController.panels = [
          new PanelProperties(
            { defaultSize: 60 },
            {
              showResizeHandle: true,
              outerContainerStyle: `
                ${orientationProperties.dimension}: 100%;
                overflow-${orientationProperties.axis}: auto
              `,
            },
          ),
          new PanelProperties(
            {
              defaultSize: 40,
              minSize: PANEL_INDEX_1_MIN_SIZE,
            },
            {
              outerContainerStyle: `
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

        await render(
          <template>
            {{! template-lint-disable no-inline-styles }}
            <style scoped>
              {{testContainerStyles}}
            </style>
            <div style={{htmlSafe renderController.containerStyle}}>
              <ResizablePanelGroup
                @orientation={{orientationProperties.orientation}}
                @reverseCollapse={{renderController.reverseCollapse}}
                as |ResizablePanel ResizeHandle|
              >
                {{#each renderController.panels as |panel index|}}
                  {{#if (not panel.isHidden)}}
                    <ResizablePanel
                      @defaultSize={{panel.defaultSize}}
                      @minSize={{panel.minSize}}
                      @maxSize={{panel.maxSize}}
                      @collapsible={{panel.collapsible}}
                    >
                      <div
                        class='panel'
                        style={{htmlSafe
                          (if
                            panel.outerContainerStyle
                            panel.outerContainerStyle
                            ''
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
                  {{/if}}
                {{/each}}
              </ResizablePanelGroup>
            </div>
          </template>,
        );
        await waitForRerender();
      }

      test<MyTestContext>(`it can lay out panels with a defined defaultSize and ${orientationProperties.orientation} orientation`, async function (assert) {
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);

        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['180px', '120px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 20,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['210px', '90px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['300px', '0px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['210px', '90px'],
        });

        // Update container size to simulate resizing window case
        let newContainerSize = 600 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${newContainerSize}px;
        `;
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['420px', '180px'],
        });
      });

      test<MyTestContext>(`it can handle dragging via the separator in ${orientationProperties.orientation} orientation`, async function (assert) {
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -10,
          moveWithSeparator: true,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });
      });

      test<MyTestContext>(`it can lay out panels with a defined minSize and ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.panels[0]!.minSize = 40;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);

        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['180px', '120px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -20,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['0px', '300px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['120px', '180px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['300px', '0px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });
      });

      test<MyTestContext>(`it can lay out panels with a defined minSize, not collapsible, and ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.panels[0]!.minSize = 40;
        this.renderController.panels[0]!.collapsible = false;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);

        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['180px', '120px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -20,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['120px', '180px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['300px', '0px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['120px', '180px'],
        });
      });

      test<MyTestContext>(`a double-click opens a panel a drag collapsed to the size it had before the drag, in ${orientationProperties.orientation} orientation`, async function (assert) {
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['180px', '120px'],
        });

        // From a size other than the panel's default, which a double-click
        // with nothing remembered would fall back to.
        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 45,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['300px', '0px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });
      });

      test<MyTestContext>(`a double-click opens a first panel that started collapsed, with no default or minimum size, at half the group, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.reverseCollapse = false;
        this.renderController.panels[0]!.defaultSize = 0;
        this.renderController.panels[1]!.defaultSize = 100;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['0px', '300px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });
      });

      test<MyTestContext>(`a double-click opens a panel that started collapsed no wider than the panel across the handle allows, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.reverseCollapse = false;
        this.renderController.panels[0]!.defaultSize = 0;
        this.renderController.panels[1]!.defaultSize = 100;
        this.renderController.panels[1]!.minSize = 60;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['120px', '180px'],
        });
      });

      test<MyTestContext>(`a double-click leaves a panel that started collapsed closed when the panel across the handle can't give up its minimum, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.reverseCollapse = false;
        this.renderController.panels[0]!.defaultSize = 0;
        this.renderController.panels[0]!.minSize = 30;
        this.renderController.panels[1]!.defaultSize = 100;
        this.renderController.panels[1]!.minSize = 80;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['0px', '300px'],
        });
      });

      test<MyTestContext>(`a double-click opens a panel that started collapsed at its minimum, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.panels[0]!.defaultSize = 100;
        this.renderController.panels[1]!.defaultSize = 0;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['300px', '0px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['255px', '45px'],
        });
      });

      test<MyTestContext>(`a double-click opens a first panel a drag collapsed to the size it had before the drag, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.reverseCollapse = false;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -10,
        });
        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -55,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['0px', '300px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });
      });

      test<MyTestContext>(`a double-click opens a panel that started collapsed with room from every other panel, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.reverseCollapse = false;
        let outerContainerStyle = `${orientationProperties.dimension}: 100%`;
        this.renderController.panels = [
          new PanelProperties(
            { defaultSize: 0 },
            { showResizeHandle: true, outerContainerStyle },
          ),
          new PanelProperties(
            { defaultSize: 22, minSize: 20 },
            { showResizeHandle: true, outerContainerStyle },
          ),
          new PanelProperties(
            { defaultSize: 78, collapsible: false },
            { outerContainerStyle },
          ),
        ];
        let containerSize = 300 + 2 * RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['0px', '66px', '234px'],
        });

        // The middle panel, collapsible, gives only the 2% above its minimum;
        // the last keeps half its 78% and gives 39%, so the first opens at 41%.
        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['123px', '60px', '117px'],
        });
      });

      test<MyTestContext>(`a panel a double-click opened with room from fractional sizes can still be resized, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.reverseCollapse = false;
        let outerContainerStyle = `${orientationProperties.dimension}: 100%`;
        this.renderController.panels = [
          new PanelProperties(
            { defaultSize: 0 },
            { showResizeHandle: true, outerContainerStyle },
          ),
          new PanelProperties(
            { defaultSize: 33.3333333333 },
            { showResizeHandle: true, outerContainerStyle },
          ),
          new PanelProperties(
            { defaultSize: 66.6666666667 },
            { outerContainerStyle },
          ),
        ];
        let containerSize = 300 + 2 * RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '50px', '100px'],
        });

        // Rounding the others' sizes mustn't leave the layout off 100%, which
        // would refuse this drag.
        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['120px', '80px', '100px'],
        });
      });

      test<MyTestContext>(`a double-click opens a panel whose default size is below its minimum at its minimum, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.reverseCollapse = false;
        this.renderController.panels[0]!.defaultSize = 10;
        this.renderController.panels[0]!.minSize = 20;
        this.renderController.panels[1]!.defaultSize = 90;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['0px', '300px'],
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['60px', '240px'],
        });
      });

      test<MyTestContext>(`a double-click with the pointer presses a browser sends collapses a panel and reopens it at its size, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.reverseCollapse = false;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;
        // Each click presses and releases the pointer, which starts and ends
        // a drag, before the dblclick.
        let browserDoubleClick = async () => {
          for (let click = 0; click < 2; click++) {
            await moveResizePanelHandle({
              panelIndex: 0,
              orientation: orientationProperties.orientation,
              moveDelta: [],
            });
          }
          await doubleClick('[data-test-resize-handle]');
          await waitForRerender();
        };

        await renderResizablePanelGroup(this.renderController);
        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -10,
        });

        await browserDoubleClick();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['0px', '300px'],
        });

        await browserDoubleClick();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });
      });

      test<MyTestContext>(`a drag that pulls a collapsed panel out and back keeps the size it had before it collapsed, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.reverseCollapse = false;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        // From a size other than the panel's default, which a double-click
        // with nothing remembered would fall back to.
        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: -10,
        });
        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['0px', '300px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: [5, 0],
          afterMove: (moveIndex) =>
            assertPanels({
              assert,
              orientation: orientationProperties.orientation,
              panelSizesInPixels:
                moveIndex === 0 ? ['15px', '285px'] : ['0px', '300px'],
            }),
        });

        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['150px', '150px'],
        });
      });

      test<MyTestContext>(`a panel dragged open forgets the size it had before an earlier collapse, in ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.reverseCollapse = false;
        this.renderController.panels[0]!.defaultSize = 0;
        this.renderController.panels[0]!.minSize = 15;
        this.renderController.panels[1]!.defaultSize = 100;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);
        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 15,
        });
        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['0px', '300px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 20,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['60px', '240px'],
        });

        // A change to the panels lays them out at their default sizes again,
        // which collapses the first one without remembering a size.
        this.renderController.panels[1]!.isHidden = true;
        await waitForRerender();
        this.renderController.panels[1]!.isHidden = false;
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['0px', '300px'],
        });

        // It opens at its minimum, not at the 30% it had before the
        // double-click collapsed it.
        await doubleClick('[data-test-resize-handle]');
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['45px', '255px'],
        });
      });

      test<MyTestContext>(`it can lay out panels with a defined maxSize and ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.panels[0]!.maxSize = 80;
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);

        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['180px', '120px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['210px', '90px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['240px', '60px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['240px', '60px'],
        });
      });

      test<MyTestContext>(`it can recalculate the panels with ${orientationProperties.orientation} orientation if a panel is hidden`, async function (assert) {
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);

        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['180px', '120px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['210px', '90px'],
        });

        this.renderController.panels[1]!.isHidden = true;
        await waitForRerender();
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['300px'],
        });
      });

      test<MyTestContext>(`it stops expanding/shrinking panels with ${orientationProperties.orientation} orientation if cursor is not in the right position`, async function (assert) {
        let containerSize = 300 + RESIZE_HANDLE_WIDTH;
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: ${containerSize}px;
        `;

        await renderResizablePanelGroup(this.renderController);

        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['180px', '120px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 10,
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['210px', '90px'],
        });

        await moveResizePanelHandle({
          panelIndex: 0,
          orientation: orientationProperties.orientation,
          moveDelta: 10,
          hitAreaMargin: RESIZE_HANDLE_WIDTH + 25, // Put cursor outside the right hit area
        });
        assertPanels({
          assert,
          orientation: orientationProperties.orientation,
          panelSizesInPixels: ['210px', '90px'],
        });
      });
    },
  );
});

function waitForRerender() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 100);
  });
}
