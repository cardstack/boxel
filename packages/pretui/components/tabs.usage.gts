// Pretui — Tabs usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Tabs } from './tabs';

// ── Tabs ← tabbed-header/usage.gts ───────────────────────────────────────

const TAB_OPTIONS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'requirements', label: 'Requirements' },
  { value: 'your-apps', label: 'Your Apps' },
  { value: 'sample-apps', label: 'Sample Apps' },
  { value: 'favorites', label: 'Favorites' },
];
const TAB_IDS = [
  'dashboard',
  'requirements',
  'your-apps',
  'sample-apps',
  'favorites',
];

// Dropped knobs: headerTitle / headerIcon / sideContent (Tabs has no title
// row — pair with Toolbar for that); headerBackgroundColor (color comes from
// theme tokens); the boxel-header-title-* CSS-variable knobs (CSS knob layer
// not yet ported).
export class TabsUsage extends GlimmerComponent {
  @tracked defaultValue = 'dashboard';
  setDefault = (v: string) => (this.defaultValue = v);
  <template>
    <FreestyleUsage
      @name='Tabs'
      @description='Header row with horizontally arranged tab buttons that switch between sections — pair with content panels below for the standard tabs pattern. Pretui Tabs renders just the tab bar plus its yielded panel; pair with Toolbar when you need a title row. The accent underline composes motion-core’s SlidingHighlight (underline cut) — the same indicator SegmentedControl wears, so it travels along the rail rather than reappearing under the new tab, and parks instantly under reduced motion.'
    >
      <:example>
        <div class='tabs-host'>
          <Tabs @options={{TAB_OPTIONS}} @defaultValue={{this.defaultValue}}>
            <:default as |active|>
              <p class='tabs-note'>Active section: <b>{{active}}</b></p>
            </:default>
          </Tabs>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @description='Tabs for navigation. Each entry is { value, label } — plain data replaces the { displayName, tabId } entries.'
          @value={{TAB_OPTIONS}}
        />
        <Args.String
          @name='defaultValue'
          @description='Initial active tab value — Tabs owns its state after first render; click the tabs in the example live.'
          @value={{this.defaultValue}}
          @options={{TAB_IDS}}
          @onInput={{this.setDefault}}
        />
        <Args.String
          @name='value'
          @description='Controlled active tab value; when set, Tabs defers to it entirely and reports picks via onValueChange.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Action to be called when a tab is clicked; receives the picked value.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='Tab panel content rendered below the rail; yields the active value.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .tabs-host {
        width: 100%;
        max-width: 460px;
      }
      .tabs-note {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
      .tabs-note b {
        color: var(--foreground);
        font-weight: 600;
      }
    </style>
  </template>
}

export const DEMOS_TABS: Record<string, unknown> = {
  Tabs: TabsUsage,
};
