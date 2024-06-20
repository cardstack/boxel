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
            { defaultLengthFraction: 0.4, minLengthPx: 50 },
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
        await render(<template>
          {{! template-lint-disable no-inline-styles }}
          <div id='test-container' style={{renderController.containerStyle}}>
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

      test<MyTestContext>(`it can lay out panels with ${orientationProperties.orientation} orientation (default)`, async function (assert) {
        this.renderController.containerStyle = `
            ${orientationProperties.perpendicularDimension}: 100px;
            max-${orientationProperties.dimension}: 100%;
            ${orientationProperties.dimension}: 318px;
          `;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          300 * 0.6,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          300 * 0.4,
          1,
        );
      });

      test<MyTestContext>(`it can lay out panels with ${orientationProperties.orientation} orientation (length specified)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.perpendicularDimension}: 200px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.dimension}: 518px;
          border: 1px solid green
          `;

        this.renderController.panels[0].lengthPx = 355;
        this.renderController.panels[1].lengthPx = 143;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          355,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          143,
          1,
        );
      });

      test<MyTestContext>(`it respects ${orientationProperties.orientation} minLength (default)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 108px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
        `;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          40,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          50,
          1,
        );
      });

      test<MyTestContext>(`it respects ${orientationProperties.orientation} minLength (length specified)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 108px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          border: 1px solid green
        `;

        this.renderController.panels[0].lengthPx = 45;
        this.renderController.panels[1].lengthPx = 45;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          40,
          2,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          50,
          2,
        );
      });

      test<MyTestContext>(`it adjusts to its container growing (default)`, async function (assert) {
        this.renderController.containerStyle = `
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          ${orientationProperties.dimension}: 218px;
        `;

        await renderResizablePanelGroup(this.renderController);

        this.renderController.containerStyle = `
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          ${orientationProperties.dimension}: 418px;
        `;
        await sleep(100); // let didResizeModifier run

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          240,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          160,
          1,
        );
      });

      test<MyTestContext>(`it adjusts to its container growing (length specified)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 218px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          border: 1px solid green;
        `;

        this.renderController.panels[0].lengthPx = 100;
        this.renderController.panels[1].lengthPx = 100;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          100,
          1.5,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          100,
          1.5,
        );

        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 418px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          border: 1px solid green;
        `;
        await sleep(100); // let didResizeModifier run

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          200,
          1.5,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          200,
          1.5,
        );
      });

      test<MyTestContext>(`it adjusts to its container shrinking (default)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 418px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
        `;

        await renderResizablePanelGroup(this.renderController);
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 218px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
        `;

        await sleep(100); // let didResizeModifier run

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          120,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          80,
          1,
        );
      });

      test<MyTestContext>(`it adjusts to its container shrinking (length specified A)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 420px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          border: 1px solid green
        `;

        // length ratio panel 1 and panel 2 is 3:2
        this.renderController.panels[0].lengthPx = 240;
        this.renderController.panels[1].lengthPx = 160;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          240,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          160,
          1,
        );

        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 220px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          border: 1px solid green
        `;

        await sleep(100); // let didResizeModifier run
        // Maintain the ratio 3:2 when resizing
        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          120,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          80,
          1,
        );
      });

      test<MyTestContext>(`it adjusts to its container shrinking (length specified B)`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 620px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          border: 1px solid green
        `;

        // length ratio panel 1 and panel 2 is 2:1
        this.renderController.panels[0].lengthPx = 400;
        this.renderController.panels[1].lengthPx = 200;

        this.renderController.panels[0].innerContainerStyle = `
          ${orientationProperties.dimension}: 180px;
          background: blue
        `;

        await renderResizablePanelGroup(this.renderController);

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          400,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          200,
          1,
        );

        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 220px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          border: 1px solid green
        `;

        await sleep(100); // let didResizeModifier run

        // Maintain the ratio 2:1 when resizing
        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          133,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          67,
          1,
        );
      });

      test<MyTestContext>(`it adjusts to its container shrinking and growing`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 620px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          border: 1px solid green
        `;

        this.renderController.panels[0].lengthPx = 400;
        this.renderController.panels[1].lengthPx = 200;

        this.renderController.panels[0].innerContainerStyle = `
          ${orientationProperties.dimension}: 180px;
          background: blue
        `;

        await renderResizablePanelGroup(this.renderController);

        this.renderController.panels[0].lengthPx = 50;
        this.renderController.panels[1].lengthPx = 550;

        await sleep(100); // let didResizeModifier run

        await doubleClick('[data-test-resize-handle]'); // Double-click to hide recent
        await sleep(100); // let onResizeHandleDblClick run

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          600,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          0,
          2,
        );

        // shrink container by ~5
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 320px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          border: 1px solid green
        `;

        await sleep(100); // let didResizeModifier run

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          300,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          0,
          2,
        );

        await doubleClick('[data-test-resize-handle]'); // Double-click to unhide recent

        await sleep(100); // let onResizeHandleDblClick run

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          180,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          120,
          1,
        );

        // increase window/container length to original length
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 620px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
          border: 1px solid green
        `;

        await sleep(100); // let didResizeModifier run

        // expected behavior: panel length percentages would remain consistent
        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          360,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          240,
          1,
        );
      });

      test<MyTestContext>(`it excludes hidden panels from participating in layout`, async function (assert) {
        this.renderController.containerStyle = `
          ${orientationProperties.dimension}: 218px;
          max-${orientationProperties.dimension}: 100%;
          ${orientationProperties.perpendicularDimension}: 200px;
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
            { defaultLengthFraction: 0.4, minLengthPx: 50, isHidden: true },
            {
              outerContainerStyle: `
                ${orientationProperties.dimension}: 100%
              `,
            },
          ),
        ];

        await renderResizablePanelGroup(this.renderController);

        await sleep(100); // let didResizeModifier run

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          218,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          0,
          0,
        );

        this.renderController.panels[1].isHidden = false;
        await sleep(100); // let didResizeModifier run

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          168,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          50,
          1,
        );

        this.renderController.panels[1].isHidden = true;
        await sleep(100); // let didResizeModifier run

        assert.hasNumericStyle(
          '.panel-0-content',
          orientationProperties.dimension,
          218,
          1,
        );
        assert.hasNumericStyle(
          '.panel-1-content',
          orientationProperties.dimension,
          0,
          0,
        );
      });
    },
  );
});
