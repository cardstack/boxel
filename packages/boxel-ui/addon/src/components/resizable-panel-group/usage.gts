import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import ResizablePanelGroup from './index.gts';

export default class ResizablePanelUsage extends Component {
  @tracked horizontalPanel1DefaultWidthFraction = 0.25;
  @tracked horizontalPanel1MinWidthPx = undefined;

  @tracked horizontalPanel2DefaultWidthFraction = 0.5;
  @tracked horizontalPanel2MinWidthPx = undefined;

  @tracked horizontalPanel3DefaultWidthFraction = 0.25;
  @tracked horizontalPanel3MinWidthPx = undefined;

  @tracked verticalReverseCollapse = true;

  @tracked verticalPanel1DefaultHeightFraction = 0.33;
  @tracked verticalPanel1MinHeightPx = undefined;

  @tracked verticalPanel2DefaultHeightFraction = 0.67;
  @tracked verticalPanel2MinHeightPx = undefined;

  cssClassName = 'boxel-panel';
  @cssVariable declare boxelPanelResizeHandlerHeight: CSSVariableInfo;
  @cssVariable declare boxelPanelResizeHandlerWidth: CSSVariableInfo;
  @cssVariable declare boxelPanelResizeHandlerBackgroundColor: CSSVariableInfo;
  @cssVariable
  declare boxelPanelResizeHandlerHoverBackgroundColor: CSSVariableInfo;

  <template>
    <FreestyleUsage @name='Horizontal ResizablePanelGroup'>
      <:example>
        <ResizablePanelGroup @orientation='horizontal' as |ResizablePanel|>
          <ResizablePanel
            @defaultLengthFraction={{this.horizontalPanel1DefaultWidthFraction}}
            @minLengthPx={{this.horizontalPanel1MinWidthPx}}
            style={{cssVar
              boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
              boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
              boxel-panel-resize-handler-hover-background-color=this.boxelPanelResizeHandlerHoverBackgroundColor.value
            }}
          >
            Panel 1
          </ResizablePanel>
          <ResizablePanel
            @defaultLengthFraction={{this.horizontalPanel2DefaultWidthFraction}}
            @minLengthPx={{this.horizontalPanel2MinWidthPx}}
            style={{cssVar
              boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
              boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
              boxel-panel-resize-handler-hover-background-color=this.boxelPanelResizeHandlerHoverBackgroundColor.value
            }}
          >
            Panel 2
          </ResizablePanel>
          <ResizablePanel
            @defaultLengthFraction={{this.horizontalPanel3DefaultWidthFraction}}
            @minLengthPx={{this.horizontalPanel3MinWidthPx}}
            style={{cssVar
              boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
              boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
              boxel-panel-resize-handler-hover-background-color=this.boxelPanelResizeHandlerHoverBackgroundColor.value
            }}
          >
            Panel 3
          </ResizablePanel>
        </ResizablePanelGroup>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='defaultWidthFraction - Panel 1'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.horizontalPanel1DefaultWidthFraction}}
          @onInput={{fn (mut this.horizontalPanel1DefaultWidthFraction)}}
          @required={{true}}
        />
        <Args.String
          @name='minWidthPx - Panel 1'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.horizontalPanel1MinWidthPx}}
          @onInput={{fn (mut this.horizontalPanel1MinWidthPx)}}
          @required={{false}}
        />
        <Args.String
          @name='defaultWidthFraction - Panel 2'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.horizontalPanel2DefaultWidthFraction}}
          @onInput={{fn (mut this.horizontalPanel2DefaultWidthFraction)}}
          @required={{true}}
        />
        <Args.String
          @name='minWidthPx - Panel 2'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.horizontalPanel2MinWidthPx}}
          @onInput={{fn (mut this.horizontalPanel2MinWidthPx)}}
          @required={{false}}
        />
        <Args.String
          @name='defaultWidthFraction - Panel 3'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.horizontalPanel3DefaultWidthFraction}}
          @onInput={{fn (mut this.horizontalPanel3DefaultWidthFraction)}}
          @required={{true}}
        />
        <Args.String
          @name='minWidthPx - Panel 3'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.horizontalPanel3MinWidthPx}}
          @onInput={{fn (mut this.horizontalPanel3MinWidthPx)}}
          @required={{false}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-panel-resize-handler-height'
          @type='dimension'
          @defaultValue={{this.boxelPanelResizeHandlerHeight.defaults}}
          @value={{this.boxelPanelResizeHandlerHeight.value}}
          @onInput={{this.boxelPanelResizeHandlerHeight.update}}
        />
        <Css.Basic
          @name='boxel-panel-resize-handler-background-color'
          @type='color'
          @defaultValue={{this.boxelPanelResizeHandlerBackgroundColor.defaults}}
          @value={{this.boxelPanelResizeHandlerBackgroundColor.value}}
          @onInput={{this.boxelPanelResizeHandlerBackgroundColor.update}}
        />
        <Css.Basic
          @name='boxel-panel-resize-handler-hover-background-color'
          @type='color'
          @defaultValue={{this.boxelPanelResizeHandlerHoverBackgroundColor.defaults}}
          @value={{this.boxelPanelResizeHandlerHoverBackgroundColor.value}}
          @onInput={{this.boxelPanelResizeHandlerHoverBackgroundColor.update}}
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
            as |ResizablePanel|
          >
            <ResizablePanel
              @defaultLengthFraction={{this.verticalPanel1DefaultHeightFraction}}
              @minLengthPx={{this.verticalPanel1MinHeightPx}}
              style={{cssVar
                boxel-panel-resize-handler-width=this.boxelPanelResizeHandlerWidth.value
                boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
                boxel-panel-resize-handler-hover-background-color=this.boxelPanelResizeHandlerHoverBackgroundColor.value
              }}
            >
              Panel 1
            </ResizablePanel>
            <ResizablePanel
              @defaultLengthFraction={{this.verticalPanel2DefaultHeightFraction}}
              @minLengthPx={{this.verticalPanel2MinHeightPx}}
              style={{cssVar
                boxel-panel-resize-handler-width=this.boxelPanelResizeHandlerWidth.value
                boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
                boxel-panel-resize-handler-hover-background-color=this.boxelPanelResizeHandlerHoverBackgroundColor.value
              }}
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
          @value={{this.verticalPanel1DefaultHeightFraction}}
          @onInput={{fn (mut this.verticalPanel1DefaultHeightFraction)}}
          @required={{true}}
        />
        <Args.Number
          @name='minHeightPx - Panel 1'
          @description="The minimum height of the panel is determined by this argument, which operates similarly to the 'min-height' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.verticalPanel1MinHeightPx}}
          @onInput={{fn (mut this.verticalPanel1MinHeightPx)}}
          @required={{false}}
        />
        <Args.Number
          @name='defaultHeightFraction - Panel 2'
          @description="The default height of the panel is determined by this argument, which operates similarly to the 'height' property in CSS."
          @value={{this.verticalPanel2DefaultHeightFraction}}
          @onInput={{fn (mut this.verticalPanel2DefaultHeightFraction)}}
          @required={{true}}
        />
        <Args.Number
          @name='minHeightPx - Panel 2'
          @description="The minimum height of the panel is determined by this argument, which operates similarly to the 'min-height' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.verticalPanel2MinHeightPx}}
          @onInput={{fn (mut this.verticalPanel2MinHeightPx)}}
          @required={{false}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-panel-resize-handler-width'
          @type='dimension'
          @defaultValue={{this.boxelPanelResizeHandlerWidth.defaults}}
          @value={{this.boxelPanelResizeHandlerWidth.value}}
          @onInput={{this.boxelPanelResizeHandlerWidth.update}}
        />
        <Css.Basic
          @name='boxel-panel-resize-handler-background-color'
          @type='color'
          @defaultValue={{this.boxelPanelResizeHandlerBackgroundColor.defaults}}
          @value={{this.boxelPanelResizeHandlerBackgroundColor.value}}
          @onInput={{this.boxelPanelResizeHandlerBackgroundColor.update}}
        />
        <Css.Basic
          @name='boxel-panel-resize-handler-hover-background-color'
          @type='color'
          @defaultValue={{this.boxelPanelResizeHandlerHoverBackgroundColor.defaults}}
          @value={{this.boxelPanelResizeHandlerHoverBackgroundColor.value}}
          @onInput={{this.boxelPanelResizeHandlerHoverBackgroundColor.update}}
        />
      </:cssVars>
    </FreestyleUsage>
    <style>
      .vertical-container {
        height: 30rem;
      }
    </style>
  </template>
}
