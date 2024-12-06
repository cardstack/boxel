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
  @tracked horizontalPanel1MaxSize = undefined;
  @tracked horizontalPanel1Collapsible = true;

  @tracked horizontalPanel2DefaultSize = 50;
  @tracked horizontalPanel2MinSize = undefined;
  @tracked horizontalPanel2MaxSize = undefined;
  @tracked horizontalPanel2Collapsible = true;

  @tracked horizontalPanel3DefaultSize = 25;
  @tracked horizontalPanel3MinSize = undefined;
  @tracked horizontalPanel3MaxSize = undefined;
  @tracked horizontalPanel3Collapsible = true;
  @tracked horizontalPanel3IsHidden = false;

  @tracked verticalReverseCollapse = true;

  @tracked verticalPanel1DefaultSize = 33;
  @tracked verticalPanel1MinSize = undefined;
  @tracked verticalPanel1MaxSize = undefined;
  @tracked verticalPanel1Collapsible = true;

  @tracked verticalPanel2DefaultSize = 67;
  @tracked verticalPanel2MinSize = undefined;
  @tracked verticalPanel2MaxSize = undefined;
  @tracked verticalPanel2Collapsible = true;

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
            @maxSize={{this.horizontalPanel1MaxSize}}
            @collapsible={{this.horizontalPanel1Collapsible}}
          >
            Panel 1
          </ResizablePanel>
          <ResizeHandle />
          <ResizablePanel
            @defaultSize={{this.horizontalPanel2DefaultSize}}
            @minSize={{this.horizontalPanel2MinSize}}
            @maxSize={{this.horizontalPanel2MaxSize}}
            @collapsible={{this.horizontalPanel2Collapsible}}
          >
            Panel 2
          </ResizablePanel>
          {{#if (not this.horizontalPanel3IsHidden)}}
            <ResizeHandle />
            <ResizablePanel
              @defaultSize={{this.horizontalPanel3DefaultSize}}
              @minSize={{this.horizontalPanel3MinSize}}
              @maxSize={{this.horizontalPanel3MaxSize}}
              @collapsible={{this.horizontalPanel3Collapsible}}
            >
              Panel 3
            </ResizablePanel>
          {{/if}}
        </ResizablePanelGroup>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='defaultSize - Panel 1'
          @description='The default width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage.'
          @value={{this.horizontalPanel1DefaultSize}}
          @onInput={{fn (mut this.horizontalPanel1DefaultSize)}}
          @required={{true}}
        />
        <Args.Number
          @name='minSize - Panel 1'
          @description='The minimum width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage. In double-click event, this argumen will be ingored if the panel is collapsible.'
          @value={{this.horizontalPanel1MinSize}}
          @onInput={{fn (mut this.horizontalPanel1MinSize)}}
          @required={{false}}
        />
        <Args.Number
          @name='maxSize - Panel 1'
          @description='The maximum width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage.'
          @value={{this.horizontalPanel1MaxSize}}
          @onInput={{fn (mut this.horizontalPanel1MaxSize)}}
          @required={{false}}
        />
        <Args.Bool
          @name='collapsible - Panel 1'
          @description='Before collapsing a panel, this argument will be checked. The default value for this argument is true. Please also define minSize if you set the value of this argument to false.'
          @value={{this.horizontalPanel1Collapsible}}
          @onInput={{fn (mut this.horizontalPanel1Collapsible)}}
          @required={{false}}
        />
        <Args.Number
          @name='defaultSize - Panel 2'
          @description='The default width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage.'
          @value={{this.horizontalPanel2DefaultSize}}
          @onInput={{fn (mut this.horizontalPanel2DefaultSize)}}
          @required={{true}}
        />
        <Args.Number
          @name='minSize - Panel 2'
          @description='The minimum width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage. In double-click event, this argumen will be ingored if the panel is collapsible.'
          @value={{this.horizontalPanel2MinSize}}
          @onInput={{fn (mut this.horizontalPanel2MinSize)}}
          @required={{false}}
        />
        <Args.Number
          @name='maxSize - Panel 2'
          @description='The maximum width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage.'
          @value={{this.horizontalPanel2MaxSize}}
          @onInput={{fn (mut this.horizontalPanel2MaxSize)}}
          @required={{false}}
        />
        <Args.Bool
          @name='collapsible - Panel 2'
          @description='Before collapsing a panel, this argument will be checked. The default value for this argument is true. Please also define minSize if you set the value of this argument to false.'
          @value={{this.horizontalPanel2Collapsible}}
          @onInput={{fn (mut this.horizontalPanel2Collapsible)}}
          @required={{false}}
        />
        <Args.Number
          @name='defaultSize - Panel 3'
          @description='The default width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage.'
          @value={{this.horizontalPanel3DefaultSize}}
          @onInput={{fn (mut this.horizontalPanel3DefaultSize)}}
          @required={{true}}
        />
        <Args.Number
          @name='minSize - Panel 3'
          @description='The minimum width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage. In double-click event, this argumen will be ingored if the panel is collapsible.'
          @value={{this.horizontalPanel3MinSize}}
          @onInput={{fn (mut this.horizontalPanel3MinSize)}}
          @required={{false}}
        />
        <Args.Number
          @name='maxSize - Panel 3'
          @description='The maximum width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage.'
          @value={{this.horizontalPanel3MaxSize}}
          @onInput={{fn (mut this.horizontalPanel3MaxSize)}}
          @required={{false}}
        />
        <Args.Bool
          @name='collapsible - Panel 2'
          @description='Before collapsing a panel, this argument will be checked. The default value for this argument is true. Please also define minSize if you set the value of this argument to false.'
          @value={{this.horizontalPanel3Collapsible}}
          @onInput={{fn (mut this.horizontalPanel3Collapsible)}}
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
              @maxSize={{this.verticalPanel1MaxSize}}
              @collapsible={{this.verticalPanel1Collapsible}}
            >
              Panel 1
            </ResizablePanel>
            <ResizeHandle />
            <ResizablePanel
              @defaultSize={{this.verticalPanel2DefaultSize}}
              @minSize={{this.verticalPanel2MinSize}}
              @maxSize={{this.verticalPanel2MaxSize}}
              @collapsible={{this.verticalPanel2Collapsible}}
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
          @name='defaultSize - Panel 1'
          @description='The default width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage.'
          @value={{this.verticalPanel1DefaultSize}}
          @onInput={{fn (mut this.verticalPanel1DefaultSize)}}
          @required={{true}}
        />
        <Args.Number
          @name='minSize - Panel 1'
          @description='The minimum width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage. In double-click event, this argumen will be ingored if the panel is collapsible.'
          @value={{this.verticalPanel1MinSize}}
          @onInput={{fn (mut this.verticalPanel1MinSize)}}
          @required={{false}}
        />
        <Args.Number
          @name='maxSize - Panel 1'
          @description='The maximum width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage.'
          @value={{this.verticalPanel1MaxSize}}
          @onInput={{fn (mut this.verticalPanel1MaxSize)}}
          @required={{false}}
        />
        <Args.Number
          @name='collapsible - Panel 1'
          @description='Before collapsing a panel, this argument will be checked. The default value for this argument is true. Please also define minSize if you set the value of this argument to false.'
          @value={{this.verticalPanel1Collapsible}}
          @onInput={{fn (mut this.verticalPanel1Collapsible)}}
          @required={{false}}
        />
        <Args.Number
          @name='defaultSize - Panel 2'
          @description='The default width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage.'
          @value={{this.verticalPanel2DefaultSize}}
          @onInput={{fn (mut this.verticalPanel2DefaultSize)}}
          @required={{true}}
        />
        <Args.Number
          @name='minSize - Panel 2'
          @description='The minimum width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage. In double-click event, this argumen will be ingored if the panel is collapsible.'
          @value={{this.verticalPanel2MinSize}}
          @onInput={{fn (mut this.verticalPanel2MinSize)}}
          @required={{false}}
        />
        <Args.Number
          @name='maxSize - Panel 2'
          @description='The maximum width of the panel is determined by this argument. The value of the argument must be a number between 0 and 100, representing a percentage.'
          @value={{this.verticalPanel2MaxSize}}
          @onInput={{fn (mut this.verticalPanel2MaxSize)}}
          @required={{false}}
        />
        <Args.Bool
          @name='collapsible - Panel 2'
          @description='Before collapsing a panel, this argument will be checked. The default value for this argument is true. Please also define minSize if you set the value of this argument to false.'
          @value={{this.verticalPanel2Collapsible}}
          @onInput={{fn (mut this.verticalPanel2Collapsible)}}
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
