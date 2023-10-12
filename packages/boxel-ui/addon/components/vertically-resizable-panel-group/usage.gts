import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import ResizablePanelGroup from './index';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import {
  cssVariable,
  CSSVariableInfo,
} from 'ember-freestyle/decorators/css-variable';

export default class VerticalResizablePanelUsage extends Component {
  @tracked panel1DefaultHeight = '25%';
  @tracked panel1MinHeight = 'none';

  @tracked panel2DefaultHeight = '50%';
  @tracked panel2MinHeight = 'none';

  @tracked panel3DefaultHeight = '25%';
  @tracked panel3MinHeight = 'none';

  cssClassName = 'boxel-panel';
  @cssVariable declare boxelPanelResizeHandlerHeight: CSSVariableInfo;
  @cssVariable declare boxelPanelResizeHandlerBackgroundColor: CSSVariableInfo;

  <template>
    <FreestyleUsage @name='VerticalResizablePanel'>
      <:example>
        <div class='height-container'>
          <ResizablePanelGroup as |ResizablePanel|>
            <ResizablePanel
              @defaultHeight={{this.panel1DefaultHeight}}
              @minHeight={{this.panel1MinHeight}}
              style={{cssVar
                boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
                boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
              }}
            >
              Panel 1
            </ResizablePanel>
            <ResizablePanel
              @defaultHeight={{this.panel2DefaultHeight}}
              @minHeight={{this.panel2MinHeight}}
              style={{cssVar
                boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
                boxel-panel-resize-handler-background-color=this.boxelPanelResizeHandlerBackgroundColor.value
              }}
            >
              Panel 2
            </ResizablePanel>
            <ResizablePanel
              @defaultHeight={{this.panel3DefaultHeight}}
              @minHeight={{this.panel3MinHeight}}
              style={{cssVar
                boxel-panel-resize-handler-height=this.boxelPanelResizeHandlerHeight.value
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
          @value={{this.panel1DefaultHeight}}
          @onInput={{fn (mut this.panel1DefaultHeight)}}
          @required={{true}}
        />
        <Args.String
          @name='minHeight - Panel 1'
          @description="The minimum height of the panel is determined by this argument, which operates similarly to the 'min-height' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.panel1MinHeight}}
          @onInput={{fn (mut this.panel1MinHeight)}}
          @required={{false}}
        />
        <Args.String
          @name='defaultHeight - Panel 2'
          @description="The default height of the panel is determined by this argument, which operates similarly to the 'height' property in CSS."
          @value={{this.panel2DefaultHeight}}
          @onInput={{fn (mut this.panel2DefaultHeight)}}
          @required={{true}}
        />
        <Args.String
          @name='minHeight - Panel 2'
          @description="The minimum height of the panel is determined by this argument, which operates similarly to the 'min-height' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.panel2MinHeight}}
          @onInput={{fn (mut this.panel2MinHeight)}}
          @required={{false}}
        />
        <Args.String
          @name='defaultHeight - Panel 3'
          @description="The default height of the panel is determined by this argument, which operates similarly to the 'height' property in CSS."
          @value={{this.panel3DefaultHeight}}
          @onInput={{fn (mut this.panel3DefaultHeight)}}
          @required={{true}}
        />
        <Args.String
          @name='minHeight - Panel 3'
          @description="The minimum height of the panel is determined by this argument, which operates similarly to the 'min-height' property in CSS. In double-click event, this argumen will be ingored."
          @value={{this.panel3MinHeight}}
          @onInput={{fn (mut this.panel3MinHeight)}}
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
    <style>
      .height-container {
        height: 30rem;
      }
    </style>
  </template>
}
