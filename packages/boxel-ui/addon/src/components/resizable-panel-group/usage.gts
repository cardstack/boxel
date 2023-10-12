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
  @tracked panel1DefaultWidth = '25%';
  @tracked panel1MinWidth = 'none';

  @tracked panel2DefaultWidth = '50%';
  @tracked panel2MinWidth = 'none';

  @tracked panel3DefaultWidth = '25%';
  @tracked panel3MinWidth = 'none';

  cssClassName = 'boxel-panel';
  @cssVariable declare boxelPanelResizeHandlerHeight: CSSVariableInfo;
  @cssVariable declare boxelPanelResizeHandlerBackgroundColor: CSSVariableInfo;

  <template>
    <FreestyleUsage @name='ResizablePanel'>
      <:example>
        <ResizablePanelGroup as |ResizablePanel|>
          <ResizablePanel
            @defaultWidth={{this.panel1DefaultWidth}}
            @minWidth={{this.panel1MinWidth}}
            style={{cssVar
              boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
              boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
            }}
          >
            Panel 1
          </ResizablePanel>
          <ResizablePanel
            @defaultWidth={{this.panel2DefaultWidth}}
            @minWidth={{this.panel2MinWidth}}
            style={{cssVar
              boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
              boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
            }}
          >
            Panel 2
          </ResizablePanel>
          <ResizablePanel
            @defaultWidth={{this.panel3DefaultWidth}}
            @minWidth={{this.panel3MinWidth}}
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
          @value={{this.panel1DefaultWidth}}
          @onInput={{fn (mut this.panel1DefaultWidth)}}
          @required={{true}}
        />
        <Args.String
          @name='minWidth - Panel 1'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.panel1MinWidth}}
          @onInput={{fn (mut this.panel1MinWidth)}}
          @required={{false}}
        />
        <Args.String
          @name='defaultWidth - Panel 2'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.panel2DefaultWidth}}
          @onInput={{fn (mut this.panel2DefaultWidth)}}
          @required={{true}}
        />
        <Args.String
          @name='minWidth - Panel 2'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.panel2MinWidth}}
          @onInput={{fn (mut this.panel2MinWidth)}}
          @required={{false}}
        />
        <Args.String
          @name='defaultWidth - Panel 3'
          @description="The default width of the panel is determined by this argument, which operates similarly to the 'width' property in CSS."
          @value={{this.panel3DefaultWidth}}
          @onInput={{fn (mut this.panel3DefaultWidth)}}
          @required={{true}}
        />
        <Args.String
          @name='minWidth - Panel 3'
          @description="The minimum width of the panel is determined by this argument, which operates similarly to the 'min-width' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.panel3MinWidth}}
          @onInput={{fn (mut this.panel3MinWidth)}}
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
  </template>
}
