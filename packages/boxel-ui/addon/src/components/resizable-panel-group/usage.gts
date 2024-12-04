import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { not } from '../../helpers.ts';
import cssVar from '../../helpers/css-var.ts';
import ResizablePanelGroup from './index.gts';

export default class ResizablePanelUsage extends Component {
  @tracked horizontalPanel1DefaultSize = 25;
  @tracked horizontalPanel1MinSize = undefined;

  @tracked horizontalPanel2DefaultSize = 50;
  @tracked horizontalPanel2MinSize = undefined;

  @tracked horizontalPanel3DefaultSize = 25;
  @tracked horizontalPanel3MinSize = undefined;
  @tracked horizontalPanel3IsHidden = false;

  @tracked verticalReverseCollapse = true;

  @tracked verticalPanel1DefaultSize = 33;
  @tracked verticalPanel1MinSize = undefined;

  @tracked verticalPanel2DefaultSize = 67;
  @tracked verticalPanel2MinSize = undefined;

  cssClassName = 'boxel-panel';
  @cssVariable declare boxelPanelResizeHandleHeight: CSSVariableInfo;
  @cssVariable declare boxelPanelResizeHandleWidth: CSSVariableInfo;
  @cssVariable declare boxelPanelResizeHandleBackgroundColor: CSSVariableInfo;
  @cssVariable
  declare boxelPanelResizeHandleHoverBackgroundColor: CSSVariableInfo;

  <template>
    <FreestyleUsage @name='Horizontal ResizablePanelGroup'>
      <:example>
        <ResizablePanelGroup
          @orientation='horizontal'
          style={{cssVar
            boxel-panel-resize-handle-height=this.boxelPanelResizeHandleHeight.value
            boxel-panel-resize-handle-background-color=this.boxelPanelResizeHandleBackgroundColor.value
            boxel-panel-resize-handle-hover-background-color=this.boxelPanelResizeHandleHoverBackgroundColor.value
          }}
          as |ResizablePanel ResizeHandle|
        >
          <ResizablePanel
            @defaultSize={{this.horizontalPanel1DefaultSize}}
            @minSize={{this.horizontalPanel1MinSize}}
          >
            Panel 1
          </ResizablePanel>
          <ResizeHandle />
          <ResizablePanel
            @defaultSize={{this.horizontalPanel2DefaultSize}}
            @minSize={{this.horizontalPanel2MinSize}}
          >
            Panel 2
          </ResizablePanel>
          {{#if (not this.horizontalPanel3IsHidden)}}
            <ResizeHandle />
            <ResizablePanel
              @defaultSize={{this.horizontalPanel3DefaultSize}}
              @minSize={{this.horizontalPanel3MinSize}}
            >
              Panel 3
            </ResizablePanel>
          {{/if}}
        </ResizablePanelGroup>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='defaultWidthFraction - Panel 1'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.horizontalPanel1DefaultSize}}
          @onInput={{fn (mut this.horizontalPanel1DefaultSize)}}
          @required={{true}}
        />
        <Args.Number
          @name='minWidthPx - Panel 1'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.horizontalPanel1MinSize}}
          @onInput={{fn (mut this.horizontalPanel1MinSize)}}
          @required={{false}}
        />
        <Args.Number
          @name='defaultWidthFraction - Panel 2'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.horizontalPanel2DefaultSize}}
          @onInput={{fn (mut this.horizontalPanel2DefaultSize)}}
          @required={{true}}
        />
        <Args.Number
          @name='minWidthPx - Panel 2'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.horizontalPanel2MinSize}}
          @onInput={{fn (mut this.horizontalPanel2MinSize)}}
          @required={{false}}
        />
        <Args.Number
          @name='defaultWidthFraction - Panel 3'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.horizontalPanel3DefaultSize}}
          @onInput={{fn (mut this.horizontalPanel3DefaultSize)}}
          @required={{true}}
        />
        <Args.Number
          @name='minWidthPx - Panel 3'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.horizontalPanel3MinSize}}
          @onInput={{fn (mut this.horizontalPanel3MinSize)}}
          @required={{false}}
        />
        <Args.Bool
          @name='isHidden'
          @optional={{true}}
          @onInput={{fn (mut this.horizontalPanel3IsHidden)}}
          @value={{this.horizontalPanel3IsHidden}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-panel-resize-handle-height'
          @type='dimension'
          @defaultValue={{this.boxelPanelResizeHandleHeight.defaults}}
          @value={{this.boxelPanelResizeHandleHeight.value}}
          @onInput={{this.boxelPanelResizeHandleHeight.update}}
        />
        <Css.Basic
          @name='boxel-panel-resize-handle-background-color'
          @type='color'
          @defaultValue={{this.boxelPanelResizeHandleBackgroundColor.defaults}}
          @value={{this.boxelPanelResizeHandleBackgroundColor.value}}
          @onInput={{this.boxelPanelResizeHandleBackgroundColor.update}}
        />
        <Css.Basic
          @name='boxel-panel-resize-handle-hover-background-color'
          @type='color'
          @defaultValue={{this.boxelPanelResizeHandleHoverBackgroundColor.defaults}}
          @value={{this.boxelPanelResizeHandleHoverBackgroundColor.value}}
          @onInput={{this.boxelPanelResizeHandleHoverBackgroundColor.update}}
        />
      </:cssVars>
    </FreestyleUsage>
    <FreestyleUsage
      @name='Two-panel vertical ResizablePanelGroup with reversed collapse'
    >
      <:description>
        @reverseCollapse
      </:description>
      <:example>
        <div class='vertical-container'>
          <ResizablePanelGroup
            @orientation='vertical'
            @reverseCollapse={{this.verticalReverseCollapse}}
            style={{cssVar
              boxel-panel-resize-handle-width=this.boxelPanelResizeHandleWidth.value
              boxel-panel-resize-handle-background-color=this.boxelPanelResizeHandleBackgroundColor.value
              boxel-panel-resize-handle-hover-background-color=this.boxelPanelResizeHandleHoverBackgroundColor.value
            }}
            as |ResizablePanel ResizeHandle|
          >
            <ResizablePanel
              @defaultSize={{this.verticalPanel1DefaultSize}}
              @minSize={{this.verticalPanel1MinSize}}
            >
              Panel 1
            </ResizablePanel>
            <ResizeHandle />
            <ResizablePanel
              @defaultSize={{this.verticalPanel2DefaultSize}}
              @minSize={{this.verticalPanel2MinSize}}
            >
              Panel 2
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </:example>

      <:api as |Args|>
        <Args.Bool
          @name='reverseCollapse'
          @description='Double-clicking the handle to collapse a panel will default to collapsing outward, this reverses it, which may be preferable in a two-panel setup.'
          @value={{this.verticalReverseCollapse}}
          @onInput={{fn (mut this.verticalReverseCollapse)}}
        />
        <Args.Number
          @name='defaultHeightFraction - Panel 1'
          @description="The default height of the panel is determined by this argument, which operates similarly to the 'height' property in CSS."
          @value={{this.verticalPanel1DefaultSize}}
          @onInput={{fn (mut this.verticalPanel1DefaultSize)}}
          @required={{true}}
        />
        <Args.Number
          @name='minHeightPx - Panel 1'
          @description="The minimum height of the panel is determined by this argument, which operates similarly to the 'min-height' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.verticalPanel1MinSize}}
          @onInput={{fn (mut this.verticalPanel1MinSize)}}
          @required={{false}}
        />
        <Args.Number
          @name='defaultHeightFraction - Panel 2'
          @description="The default height of the panel is determined by this argument, which operates similarly to the 'height' property in CSS."
          @value={{this.verticalPanel2DefaultSize}}
          @onInput={{fn (mut this.verticalPanel2DefaultSize)}}
          @required={{true}}
        />
        <Args.Number
          @name='minHeightPx - Panel 2'
          @description="The minimum height of the panel is determined by this argument, which operates similarly to the 'min-height' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.verticalPanel2MinSize}}
          @onInput={{fn (mut this.verticalPanel2MinSize)}}
          @required={{false}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-panel-resize-handle-width'
          @type='dimension'
          @defaultValue={{this.boxelPanelResizeHandleWidth.defaults}}
          @value={{this.boxelPanelResizeHandleWidth.value}}
          @onInput={{this.boxelPanelResizeHandleWidth.update}}
        />
        <Css.Basic
          @name='boxel-panel-resize-handle-background-color'
          @type='color'
          @defaultValue={{this.boxelPanelResizeHandleBackgroundColor.defaults}}
          @value={{this.boxelPanelResizeHandleBackgroundColor.value}}
          @onInput={{this.boxelPanelResizeHandleBackgroundColor.update}}
        />
        <Css.Basic
          @name='boxel-panel-resize-handle-hover-background-color'
          @type='color'
          @defaultValue={{this.boxelPanelResizeHandleHoverBackgroundColor.defaults}}
          @value={{this.boxelPanelResizeHandleHoverBackgroundColor.value}}
          @onInput={{this.boxelPanelResizeHandleHoverBackgroundColor.update}}
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .vertical-container {
        height: 30rem;
      }
    </style>
  </template>
}
