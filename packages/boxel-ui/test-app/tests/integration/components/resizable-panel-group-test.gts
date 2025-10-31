import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import type { RenderingTestContext } from '@ember/test-helpers';
import { find, doubleClick, render } from '@ember/test-helpers';
import { htmlSafe } from '@ember/template';
import { ResizablePanelGroup } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { tracked } from '@glimmer/tracking';
import { triggerEvent } from '@ember/test-helpers';
import type { Orientation } from '@cardstack/boxel-ui/components/resizable-panel-group/utils/types';

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
      defaultSize?: number;
      minSize?: number;
      maxSize?: number;
      collapsible?: boolean;
      outerContainerStyle?: string;
      showResizeHandle?: boolean;
      isHidden?: boolean;
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
  moveDelta, // A negative indicates movement to the left in a horizontal orientation and upward in a vertical orientation."
  hitAreaMargin = 0,
  moveWithSeparator = false, // Use the separator parent element of the handle to move
}: {
  panelIndex: number;
  orientation: string;
  moveDelta: number;
  hitAreaMargin?: number;
  moveWithSeparator?: boolean;
}) {
  let groupEl = document.querySelector('[data-boxel-panel-group]');
  if (!groupEl) {
    throw new Error(`panelGroup is not found`);
  }
  let resizePanelHandles = document.querySelectorAll(
    `[data-boxel-panel-resize-handle-id]`,
  );
  let resizeHandleId = resizePanelHandles[panelIndex].getAttribute(
    'data-boxel-panel-resize-handle-id',
  );
  if (!resizeHandleId) {
    throw new Error(`resizePanelHandle with index: ${panelIndex} is not found`);
  }

  let groupRect = groupEl.getBoundingClientRect();
  let groupSizeInPixels =
    orientation === 'horizontal' ? groupRect.width : groupRect.height;
  let resizeHandleRect =
    resizePanelHandles[panelIndex].children[0]!.getBoundingClientRect();
  let moveDeltaInPixels = (groupSizeInPixels * moveDelta) / 100;

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
        ? computedStyles[index].width
        : computedStyles[index].height,
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
                {{/if}}
              {{/each}}
            </ResizablePanelGroup>
          </div>
        </template>);
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
        this.renderController.panels[0].minSize = 40;
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
        this.renderController.panels[0].minSize = 40;
        this.renderController.panels[0].collapsible = false;
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

      test<MyTestContext>(`it can lay out panels with a defined maxSize and ${orientationProperties.orientation} orientation`, async function (assert) {
        this.renderController.panels[0].maxSize = 80;
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

        this.renderController.panels[1].isHidden = true;
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
