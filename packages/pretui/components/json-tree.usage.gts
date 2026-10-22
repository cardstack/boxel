// Pretui — JsonTree usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { JsonTree } from './json-tree';
import { SAMPLE } from '../demo-json';

/** 300 items, so the page shows truncation rather than describing it. */
function longArrayDocument(): string {
  const items: string[] = [];
  for (let i = 1; i <= 300; i++) {
    items.push('{ "n": ' + String(i) + ', "sku": "SKU-' + String(1000 + i) + '" }');
  }
  return '{\n  "catalogue": [\n    ' + items.join(',\n    ') + '\n  ]\n}';
}

const LONG = longArrayDocument();

const BROKEN = '{\n  "a": 1,\n  "b": [2, 3,]\n}';

const PARTIAL = '{\n  "a": ';

const DUPLICATED = '{ "a": 1, "b": 2, "a": 3 }';

class JsonTreeUsage extends Component {
  @tracked source = 'sample';
  @tracked query = '';
  @tracked label = 'Order SO-4471';
  @tracked expandAll = true;
  @tracked hideToolbar = false;
  @tracked pageSize = 25;
  @tracked picked = 'nothing selected yet';

  setSource = (v: string) => (this.source = v);
  setQuery = (v: string) => (this.query = v);
  setLabel = (v: string) => (this.label = v);
  setExpandAll = (v: boolean) => (this.expandAll = v);
  setHideToolbar = (v: boolean) => (this.hideToolbar = v);
  setPageSize = (v: number) => (this.pageSize = v);

  sourceOptions = ['sample', 'long array', 'malformed', 'half-typed', 'duplicate keys'];

  get json(): string {
    if (this.source === 'long array') {
      return LONG;
    }
    if (this.source === 'malformed') {
      return BROKEN;
    }
    if (this.source === 'half-typed') {
      return PARTIAL;
    }
    if (this.source === 'duplicate keys') {
      return DUPLICATED;
    }
    return SAMPLE;
  }

  onSelect = (_node: unknown, path: ReadonlyArray<string | number>) => {
    this.picked = path.length === 0 ? '$ (the root)' : path.join(' › ');
  };

  get usage(): string {
    const bits = ['@json={{this.json}}', `@label='${this.label}'`];
    if (this.expandAll) {
      bits.push('@expandAll={{true}}');
    }
    if (this.query !== '') {
      bits.push(`@query='${this.query}'`);
    }
    if (this.pageSize !== 100) {
      bits.push(`@pageSize={{${this.pageSize}}}`);
    }
    if (this.hideToolbar) {
      bits.push('@hideToolbar={{true}}');
    }
    bits.push('@onSelect={{this.onSelect}}');
    return `<JsonTree\n  ${bits.join('\n  ')}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='JsonTree'
      @description='A read-only JSON document as a WAI-ARIA treeview. Every
      value carries a type badge, containers carry a child count, and long
      containers truncate with an explicit "Showing N of M" row you can press
      Enter on to see more — a viewer that renders 50,000 rows is not a
      viewer. Keyboard: Up/Down move, Right expands then descends, Left
      collapses then climbs, Home/End jump, * expands every sibling at the
      level, single-character type-ahead cycles through property names, and
      Ctrl/Cmd+C copies the focused value while Ctrl/Cmd+Shift+C copies its
      path. Numbers keep their SOURCE TEXT, so an id beyond 2^53 is displayed
      and copied exactly rather than silently rounded, and the document warns
      you when that happens. Duplicate property names are kept and reported
      rather than dropped the way JSON.parse drops them. Honest limits: the
      row actions are pointer affordances rather than buttons (a button inside
      a treeitem is nested-interactive ARIA), which is why the copy keyboard
      shortcuts exist; long containers truncate rather than virtualize,
      because virtualization needs measurement timers this realm forbids and
      an honest count beats a scrollbar that lies; and there is no inline
      syntax highlighting of raw text — this is a structural view.'
      @source={{this.usage}}
    >
      <:example>
        <div class='jd-stack'>
          <JsonTree
            @json={{this.json}}
            @label={{this.label}}
            @expandAll={{this.expandAll}}
            @query={{this.query}}
            @pageSize={{this.pageSize}}
            @hideToolbar={{this.hideToolbar}}
            @onSelect={{this.onSelect}}
          />
          <p class='jd-readout'>Selected: {{this.picked}}</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='json'
          @value={{this.source}}
          @options={{this.sourceOptions}}
          @defaultValue='sample'
          @description='The document as text. Switch between a well-formed
          order, a 300-item catalogue that truncates, a malformed document, a
          half-typed one, and one with duplicate keys.'
          @onInput={{this.setSource}}
        />
        <Args.Object
          @name='value'
          @description='The document as a plain JavaScript value, when you
          have data rather than text. @json wins when both are set.'
          @hideControls={{true}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='JSON document'
          @description='Accessible name for the tree, and the toolbar caption.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='query'
          @value={{this.query}}
          @description='Case-insensitive filter over property names and scalar
          values. Matches pull their ancestors open without disturbing your own
          expansion state — clearing the query restores exactly what you had.'
          @onInput={{this.setQuery}}
        />
        <Args.Bool
          @name='expandAll'
          @value={{this.expandAll}}
          @defaultValue={{false}}
          @description='Open every container on first render.'
          @onInput={{this.setExpandAll}}
        />
        <Args.Number
          @name='pageSize'
          @value={{this.pageSize}}
          @min={{5}}
          @max={{200}}
          @step={{5}}
          @defaultValue={{100}}
          @description='Children rendered per container before truncating.'
          @onInput={{this.setPageSize}}
        />
        <Args.Bool
          @name='hideToolbar'
          @value={{this.hideToolbar}}
          @defaultValue={{false}}
          @description='Hide the name, match count and expand/collapse buttons.'
          @onInput={{this.setHideToolbar}}
        />
        <Args.Array
          @name='defaultExpanded'
          @description='Container paths open on first render.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onSelect'
          @description='Fires with the node and its path on Enter, Space or click.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onParseError'
          @description='Fires with every diagnostic when @json will not parse.
          Called from a modifier rather than a getter, so a caller may safely
          write tracked state in it.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name=':empty'
          @description='Replaces the default EmptyState.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .jd-stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-3, 8px);
      }
      .jd-readout {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_JSON_TREE: Record<string, unknown> = {
  JsonTree: JsonTreeUsage,
};
