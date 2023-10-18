import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  cssVariable,
  CSSVariableInfo,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import ResizablePanelGroup from './index.gts';

export default class ResizablePanelUsage extends Component {
  @tracked horizontalPanel1DefaultWidth = '25%';
  @tracked horizontalPanel1MinWidth = 'none';

  @tracked horizontalPanel2DefaultWidth = '50%';
  @tracked horizontalPanel2MinWidth = 'none';

  @tracked horizontalPanel3DefaultWidth = '25%';
  @tracked horizontalPanel3MinWidth = 'none';

  @tracked verticalPanel1DefaultHeight = '25%';
  @tracked verticalPanel1MinHeight = 'none';

  @tracked verticalPanel2DefaultHeight = '50%';
  @tracked verticalPanel2MinHeight = 'none';

  @tracked verticalPanel3DefaultHeight = '25%';
  @tracked verticalPanel3MinHeight = 'none';

  cssClassName = 'boxel-panel';
  @cssVariable declare boxelPanelResizeHandlerHeight: CSSVariableInfo;
  @cssVariable declare boxelPanelResizeHandlerWidth: CSSVariableInfo;
  @cssVariable declare boxelPanelResizeHandlerBackgroundColor: CSSVariableInfo;

  <template>
    <FreestyleUsage @name='Horizontal ResizablePanelGroup'>
      <:example>
        <ResizablePanelGroup @orientation='horizontal' as |ResizablePanel|>
          <ResizablePanel
            @defaultLength={{this.horizontalPanel1DefaultWidth}}
            @minLength={{this.horizontalPanel1MinWidth}}
            style={{cssVar
              boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
              boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
            }}
          >
            Panel 1
          </ResizablePanel>
          <ResizablePanel
            @defaultLength={{this.horizontalPanel2DefaultWidth}}
            @minLength={{this.horizontalPanel2MinWidth}}
            style={{cssVar
              boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
              boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
            }}
          >
            Panel 2
          </ResizablePanel>
          <ResizablePanel
            @defaultLength={{this.horizontalPanel3DefaultWidth}}
            @minLength={{this.horizontalPanel3MinWidth}}
            style={{cssVar
              boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
              boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
            }}
          >
            Panel 3
          </ResizablePanel>
        </ResizablePanelGroup>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='defaultWidth - Panel 1'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.horizontalPanel1DefaultWidth}}
          @onInput={{fn (mut this.horizontalPanel1DefaultWidth)}}
          @required={{true}}
        />
        <Args.String
          @name='minWidth - Panel 1'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.horizontalPanel1MinWidth}}
          @onInput={{fn (mut this.horizontalPanel1MinWidth)}}
          @required={{false}}
        />
        <Args.String
          @name='defaultWidth - Panel 2'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.horizontalPanel2DefaultWidth}}
          @onInput={{fn (mut this.horizontalPanel2DefaultWidth)}}
          @required={{true}}
        />
        <Args.String
          @name='minWidth - Panel 2'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.horizontalPanel2MinWidth}}
          @onInput={{fn (mut this.horizontalPanel2MinWidth)}}
          @required={{false}}
        />
        <Args.String
          @name='defaultWidth - Panel 3'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.horizontalPanel3DefaultWidth}}
          @onInput={{fn (mut this.horizontalPanel3DefaultWidth)}}
          @required={{true}}
        />
        <Args.String
          @name='minWidth - Panel 3'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.horizontalPanel3MinWidth}}
          @onInput={{fn (mut this.horizontalPanel3MinWidth)}}
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
      </:cssVars>
    </FreestyleUsage>
    <FreestyleUsage @name='Vertical ResizablePanelGroup'>
      <:example>
        <div class='vertical-container'>
          <ResizablePanelGroup @orientation='vertical' as |ResizablePanel|>
            <ResizablePanel
              @defaultLength={{this.verticalPanel1DefaultHeight}}
              @minLength={{this.verticalPanel1MinHeight}}
              style={{cssVar
                boxel-panel-resize-handler-width=this.boxelPanelResizeHandlerWidth.value
                boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
              }}
            >
              Panel 1
            </ResizablePanel>
            <ResizablePanel
              @defaultLength={{this.verticalPanel2DefaultHeight}}
              @minLength={{this.verticalPanel2MinHeight}}
              style={{cssVar
                boxel-panel-resize-handler-width=this.boxelPanelResizeHandlerWidth.value
                boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
              }}
            >
              Panel 2
            </ResizablePanel>
            <ResizablePanel
              @defaultLength={{this.verticalPanel3DefaultHeight}}
              @minLength={{this.verticalPanel3MinHeight}}
              style={{cssVar
                boxel-panel-resize-handler-width=this.boxelPanelResizeHandlerWidth.value
                boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
              }}
            >
              Panel 3
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='defaultHeight - Panel 1'
          @description="The default height of the panel is determined by this argument, which operates similarly to the 'height' property in CSS."
          @value={{this.verticalPanel1DefaultHeight}}
          @onInput={{fn (mut this.verticalPanel1DefaultHeight)}}
          @required={{true}}
        />
        <Args.String
          @name='minHeight - Panel 1'
          @description="The minimum height of the panel is determined by this argument, which operates similarly to the 'min-height' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.verticalPanel1MinHeight}}
          @onInput={{fn (mut this.verticalPanel1MinHeight)}}
          @required={{false}}
        />
        <Args.String
          @name='defaultHeight - Panel 2'
          @description="The default height of the panel is determined by this argument, which operates similarly to the 'height' property in CSS."
          @value={{this.verticalPanel2DefaultHeight}}
          @onInput={{fn (mut this.verticalPanel2DefaultHeight)}}
          @required={{true}}
        />
        <Args.String
          @name='minHeight - Panel 2'
          @description="The minimum height of the panel is determined by this argument, which operates similarly to the 'min-height' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.verticalPanel2MinHeight}}
          @onInput={{fn (mut this.verticalPanel2MinHeight)}}
          @required={{false}}
        />
        <Args.String
          @name='defaultHeight - Panel 3'
          @description="The default height of the panel is determined by this argument, which operates similarly to the 'height' property in CSS."
          @value={{this.verticalPanel3DefaultHeight}}
          @onInput={{fn (mut this.verticalPanel3DefaultHeight)}}
          @required={{true}}
        />
        <Args.String
          @name='minHeight - Panel 3'
          @description="The minimum height of the panel is determined by this argument, which operates similarly to the 'min-height' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.verticalPanel3MinHeight}}
          @onInput={{fn (mut this.verticalPanel3MinHeight)}}
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
      </:cssVars>
    </FreestyleUsage>
    <style>
      .vertical-container {
        height: 30rem;
      }
    </style>
  </template>
}
