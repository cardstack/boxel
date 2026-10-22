// Pretui — Resizable usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { Resizable } from './resizable';

const SOURCE = `<Resizable as |Panel Handle|>
  <Panel @defaultSize={{40}}>…</Panel>
  <Handle />
  <Panel @defaultSize={{60}}>…</Panel>
</Resizable>`;

const ResizableUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='Resizable'
    @description='SplitPanes under the shadcn name: panes with draggable handles between them, on the boxel-ui ResizablePanelGroup engine. Import it when a port already says Resizable; the component and its writeup are SplitPanes.'
    @source={{SOURCE}}
  >
    <:example>
      <div class='rz-demo-host'>
        <Resizable as |Panel Handle|>
          <Panel @defaultSize={{40}}><div class='rz-demo-fill'>Lots</div></Panel>
          <Handle />
          <Panel @defaultSize={{60}}><div class='rz-demo-fill'>Roast profile</div></Panel>
        </Resizable>
      </div>
    </:example>
    <:api as |Args|>
      <Args.String @name='orientation' @defaultValue='horizontal' @description='horizontal lays panes left to right.' />
      <Args.Bool @name='reverseCollapse' @defaultValue={{false}} @description='Double-click collapse folds the last pane instead of the first.' />
      <Args.Action @name='onLayoutChange' @description='Called with the pane sizes as percentages.' />
      <Args.Yield @name='default' @description='Yields the Panel and Handle components.' />
    </:api>
  </FreestyleUsage>
  <style scoped>
    .rz-demo-host {
      block-size: 10rem;
      border-radius: var(--radius-surface, 10px);
      box-shadow: 0 0 0 1px var(--border);
      overflow: hidden;
    }
    .rz-demo-fill {
      display: grid;
      place-items: center;
      block-size: 100%;
      font-size: var(--text-ui-md, 0.78rem);
      color: var(--muted-foreground);
    }
  </style>
</template>;

export const DEMOS_RESIZABLE: Record<string, unknown> = {
  Resizable: ResizableUsage,
};
