// Pretui — Tree usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Tree } from './tree';
import type { TreeNode } from './tree';
import { Token } from './token';

// ── Tree ← WAI-ARIA APG treeview ─────────────────────────────────────────
// The supplier taxonomy the sourcing desk actually navigates: region →
// supplier → lot. Two things in this data are deliberate demo material —
// the retired-suppliers node is `disabled` (focusable, not selectable, so
// the branch stays reachable), and three labels start with "d" so the
// single-character type-ahead has something to cycle through.
const SUPPLIER_TREE: TreeNode[] = [
  {
    id: 'fujian',
    label: 'Fujian',
    icon: 'globe',
    meta: '4 lots',
    children: [
      {
        id: 'wuyi-origins',
        label: 'Wuyi Origins',
        icon: 'folder',
        badge: 'contracted',
        children: [
          {
            id: 'da-hong-pao',
            label: 'Da Hong Pao',
            icon: 'rectangle-horizontal',
            badge: 'cupped',
            meta: '48 crates',
          },
          {
            id: 'lapsang',
            label: 'Lapsang Souchong',
            icon: 'rectangle-horizontal',
            meta: '11.2 kg',
          },
        ],
      },
      {
        id: 'fujian-maritime',
        label: 'Fujian Maritime Tea',
        icon: 'folder',
        badge: 'in transit',
        children: [
          {
            id: 'silver-needle',
            label: 'Silver Needle',
            icon: 'rectangle-horizontal',
            meta: '620 tins',
          },
          { id: 'white-peony', label: 'White Peony', icon: 'rectangle-horizontal', meta: '96 kg' },
        ],
      },
    ],
  },
  {
    id: 'uji',
    label: 'Uji',
    icon: 'globe',
    meta: '2 lots',
    children: [
      {
        id: 'uji-valley',
        label: 'Uji Valley Growers',
        icon: 'folder',
        badge: 'contracted',
        children: [
          {
            id: 'gyokuro',
            label: 'Gyokuro',
            icon: 'rectangle-horizontal',
            badge: 'cupped',
            meta: '3.4 t',
          },
          { id: 'genmaicha', label: 'Genmaicha', icon: 'rectangle-horizontal', meta: '$5.60/tin' },
        ],
      },
    ],
  },
  {
    id: 'darjeeling',
    label: 'Darjeeling',
    icon: 'globe',
    meta: '1 lot',
    children: [
      {
        id: 'first-flush',
        label: 'Darjeeling First Flush Ltd.',
        icon: 'folder',
        badge: 'pending',
        children: [
          { id: 'keemun', label: 'Keemun Hao Ya', icon: 'rectangle-horizontal', meta: '$102/kg' },
        ],
      },
    ],
  },
  {
    id: 'retired',
    label: 'Retired suppliers',
    icon: 'lock',
    meta: 'archive',
    disabled: true,
  },
];

const TREE_DENSITIES = ['comfortable', 'compact'];

class TreeUsage extends Component {
  nodes = SUPPLIER_TREE;
  densityOptions = TREE_DENSITIES;
  defaultExpanded = ['fujian', 'wuyi-origins'];

  @tracked label = 'Suppliers by origin';
  @tracked density = 'comfortable';
  @tracked indent: number | null = 14;
  @tracked typeahead = true;
  @tracked selectedLabel = '—';

  setLabel = (v: string) => (this.label = v);
  setDensity = (v: string) => (this.density = v);
  setIndent = (v: number | null) => (this.indent = v);
  setTypeahead = (v: boolean) => (this.typeahead = v);
  onSelect = (node: TreeNode) => (this.selectedLabel = node.label);

  get densityVal() {
    return this.density as 'compact' | 'comfortable';
  }
  get indentVal() {
    return this.indent ?? undefined;
  }
  get usage() {
    let bits = ['@nodes={{this.nodes}}', `@label='${this.label}'`];
    if (this.density !== 'comfortable') bits.push(`@density='${this.density}'`);
    if (this.indent !== null && this.indent !== 14) {
      bits.push(`@indent={{${this.indent}}}`);
    }
    if (!this.typeahead) bits.push('@typeahead={{false}}');
    bits.push("@defaultExpanded={{array 'fujian' 'wuyi-origins'}}");
    bits.push('@onSelect={{this.onSelect}}');
    return `<Tree\n  ${bits.join('\n  ')}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='Tree'
      @description="Hierarchy you can walk with the keyboard — file trees, taxonomies, org charts, any parent/child list where branches open and close. It implements the WAI-ARIA APG treeview pattern in full: role='tree'/'treeitem', aria-expanded on branches, aria-level/posinset/setsize on every row, aria-selected on all rows, and a ROVING TABINDEX — the whole tree is one tab stop, so Tab reaches it and Tab leaves it. Inside: Up/Down move through VISIBLE rows only, Right expands a closed branch then descends into it on the next press, Left collapses an open branch then climbs to its parent on the next press, Home/End jump to the first/last visible row, Enter/Space select (and toggle a branch), '*' expands every sibling at the focused level. Rows render flat — one list, aria-level carrying the depth — which is what fast production trees do and keeps DOM depth constant. Honest limits: type-ahead is SINGLE-character cycling (press 'd' repeatedly to walk Da Hong Pao → Darjeeling → Darjeeling First Flush Ltd.), because a multi-character buffer needs a debounce timer and the realm forbids timers; there is no multi-select, no drag-to-reorder, and no inline rename."
      @source={{this.usage}}
    >
      <:example>
        <div class='sd-frame sd-frame-tree'>
          <Tree
            @nodes={{this.nodes}}
            @label={{this.label}}
            @density={{this.densityVal}}
            @indent={{this.indentVal}}
            @typeahead={{this.typeahead}}
            @defaultExpanded={{this.defaultExpanded}}
            @defaultSelected='da-hong-pao'
            @onSelect={{this.onSelect}}
          />
        </div>
        <p class='sd-readout'>
          Selected:
          <Token @value={{this.selectedLabel}} />
        </p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='nodes'
          @required={{true}}
          @value={{this.nodes}}
          @description='The hierarchy. Each TreeNode is { id, label, icon?, badge?, meta?, disabled?, children? } — the presence of children is what makes a node a branch.'
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Tree'
          @description="Accessible name for the tree region (aria-label). Defaulted so nothing is required, but name it — 'Tree' tells a screen-reader user nothing."
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='density'
          @value={{this.density}}
          @options={{this.densityOptions}}
          @defaultValue='comfortable'
          @description="Row height preset: 'comfortable' (26px) or 'compact' (22px, one step down in type size)."
          @onInput={{this.setDensity}}
        />
        <Args.Number
          @name='indent'
          @value={{this.indent}}
          @min={{0}}
          @max={{40}}
          @step={{1}}
          @defaultValue={{14}}
          @description='Pixels of indent per level. Also settable as the --pretui-tree-indent custom property, which is the route to theming it globally.'
          @onInput={{this.setIndent}}
        />
        <Args.Bool
          @name='typeahead'
          @value={{this.typeahead}}
          @defaultValue={{true}}
          @description="Single-character type-ahead: pressing a letter moves to the next visible row starting with it, wrapping. Turn off if the <:label> block hosts anything that takes typing."
          @onInput={{this.setTypeahead}}
        />
        <Args.Object
          @name='expanded'
          @description='Controlled list of expanded node ids. Pass it and the tree stops owning expansion — pair with @onExpandedChange.'
          @hideControls={{true}}
        />
        <Args.Object
          @name='defaultExpanded'
          @value={{this.defaultExpanded}}
          @description='Initial expanded ids when uncontrolled. This demo opens Fujian and Wuyi Origins.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onExpandedChange'
          @description='Fires with the full expanded-id array on every expand/collapse, including the bulk expansion from the "*" key.'
          @hideControls={{true}}
        />
        <Args.String
          @name='selected'
          @description='Controlled selected id (or null for none). Omit for uncontrolled selection.'
          @hideControls={{true}}
        />
        <Args.String
          @name='defaultSelected'
          @defaultValue='da-hong-pao'
          @description='Initial selected id when uncontrolled; it is also where the single tab stop starts.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onSelect'
          @description='Fires with the TreeNode on Enter/Space/click. Disabled nodes never fire it, but still take keyboard focus so the branch under them stays reachable.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name=':label'
          @description='Replaces the label text. Receives (node, row) where row carries { level, posinset, setsize, parentId, hasChildren, expanded } — the same values the ARIA attributes are built from.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name=':empty'
          @description='Replaces the default EmptyState shown when @nodes is empty.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .sd-frame {
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        overflow: hidden;
      }
      .sd-frame-tree {
        max-width: 22rem;
      }
      .sd-readout {
        margin: 10px 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_TREE: Record<string, unknown> = {
  Tree: TreeUsage,
};
