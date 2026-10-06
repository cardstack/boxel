// Pretui — DashboardItem usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { Token } from './token';
import { DashboardItem } from './dashboard-item';

// ── 3. DashboardItem ─────────────────────────────────────────────────────
const ITEM_SOURCE = `<DashboardItem @id='revenue' @label='Revenue'>
  <:title>Revenue</:title>
  <:actions><Token @value='series/revenue@2' /></:actions>
  <:default>…anything…</:default>
</DashboardItem>`;

const DashboardItemUsage: TemplateOnlyComponent = <template>
    <FreestyleUsage
      @name='DashboardItem'
      @description="The dashboard cell, on its own. DashboardGrid renders these for you and passes @host — the seam through which the cell registers with the engine and reads adjust-mode state. WITHOUT a host it degrades exactly as shown here: an inert titled panel with no handle and no engine attachment, which is what read-only mode renders and what makes the cell safe to drop into a static preview. The two engine class names on the root are part of the contract; they are inert unless the cell sits inside a .pretui-dashboard-plane."
      @source={{ITEM_SOURCE}}
      @viewportMode='narrow'
    >
      <:example>
        <div class='item-demo'>
          <DashboardItem @id='revenue' @label='Revenue'>
            <:title>Revenue</:title>
            <:actions>
              <Token @value='series/revenue@2' />
            </:actions>
            <:default>
              <p class='item-copy'>The body takes arbitrary content — a chart, a
                form, another card. It scrolls inside the tile rather than
                pushing the tile out of the grid.</p>
            </:default>
          </DashboardItem>
        </div>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='id'
          @description='Stable id. Must match the placement id in the grid layout.'
          @hideControls={{true}}
        />
        <Args.Object
          @name='host'
          @description='The grid that owns the cell. DashboardGrid supplies it. Absent, the cell is inert: no handle, no engine attachment, no keyboard mode.'
          @hideControls={{true}}
        />
        <Args.String
          @name='label'
          @description="Accessible label for the drag handle — normally the tile's title. Defaults to the id."
          @hideControls={{true}}
        />
        <Args.Number
          @name='x / y / w / h'
          @description='The placement, pushed into a live engine whenever it changes. Undefined means "let the engine auto-position this one".'
          @hideControls={{true}}
        />
        <Args.Object
          @name='staticStyle'
          @description='CSS-grid placement. Read-only mode ONLY — an editable cell must never bind style, because that is where gridstack keeps the live geometry.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='<:title>, <:actions> and the default block (the body).'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .item-demo {
        display: grid;
        height: 190px;
      }
    .item-copy {
      margin: 0;
      font-size: var(--text-ui-md, 12.5px);
      line-height: 1.55;
      color: var(--muted-foreground);
      max-width: 46ch;
    }
  </style>
</template>;

export const DEMOS_DASHBOARD_ITEM: Record<string, unknown> = {
  DashboardItem: DashboardItemUsage,
};
