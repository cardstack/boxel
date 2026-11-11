// Pretui — LayoutControl usage page: a talent-tracker toolbar in a box the
// reader drags narrower, using today's controls (each slot swaps components
// per form until the controls grow their own display args).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '../helpers';
import { iconFor } from '../icon-registry';
import type { MenuEntry } from '../internal/menu';
import { FreestyleUsage } from './freestyle-usage';
import { LayoutControl } from './layout-control';
import type { LayoutControlChoice, LayoutControlForm } from './layout-control';
import { SearchInput } from './search-input';
import { FilterChips } from './filter-chips';
import { SegmentedControl } from './segmented-control';
import { Button } from './button';
import { IconButton } from './icon-button';
import { Menu } from './menu';
import { VisuallyHidden } from './visually-hidden';

// rem, richest first
const F = (...forms: [string, number][]): LayoutControlForm[] =>
  forms.map(([name, minWidth]) => ({ name, minWidth }));
const SEARCH_FORMS = F(['field', 14], ['field-s', 9], ['icon', 2], ['menu', 0]);
const STAGE_FORMS = F(['chips', 22], ['dropdown', 9], ['menu', 0]);
const VIEW_FORMS = F(['text', 8], ['icon', 4.5], ['menu', 0]);
const SORT_FORMS = F(['label', 9], ['icon', 2], ['menu', 0]);
const ADD_FORMS = F(['label', 9], ['short', 5], ['icon', 2]);

const STAGES = ['All', 'Applied', 'Screen', 'Interview', 'Offer'];
const VIEWS = [
  { value: 'board', label: 'Board' },
  { value: 'list', label: 'List' },
];
const SORTS = ['Newest', 'Oldest', 'Name'];

class LayoutControlUsage extends Component {
  @tracked stage = 'All';
  @tracked view = 'board';
  @tracked sort = 'Newest';
  @tracked label = 'Candidates';
  @tracked overflowLabel = 'More options';
  // held here, not in SearchInput, so the text survives a form change
  @tracked query = '';

  setQuery = (v: string) => (this.query = v);
  setStage = (v: string) => (this.stage = v);
  setView = (v: string) => (this.view = v);
  setSort = (v: string) => (this.sort = v);
  setLabel = (v: string) => (this.label = v);
  setOverflowLabel = (v: string) => (this.overflowLabel = v);
  icon = (name: string) => iconFor(name);

  get stageOptions() {
    return STAGES.map((v) => ({ value: v, label: v }));
  }
  get stageChoices(): LayoutControlChoice[] {
    return STAGES.map((v) => ({
      label: v,
      value: v,
      group: 'stage',
      checked: this.stage === v,
      onSelect: () => this.setStage(v),
    }));
  }
  get viewChoices(): LayoutControlChoice[] {
    return VIEWS.map((v) => ({
      label: v.label,
      value: v.value,
      group: 'view',
      checked: this.view === v.value,
      onSelect: () => this.setView(v.value),
    }));
  }
  get sortItems(): MenuEntry[] {
    return SORTS.map((s) => ({
      kind: 'radio' as const,
      group: 'sort',
      label: s,
      checked: this.sort === s,
      onSelect: () => this.setSort(s),
    }));
  }
  get usage() {
    return (
      "<LayoutControl @label='" + this.label + "' as |lc|>\n" +
      "  <lc.Slot @id='stage' @priority={{2}} @forms={{STAGE_FORMS}} @label='Stage' @menuItems={{this.stageChoices}} as |form|>…</lc.Slot>\n" +
      "  <lc.Slot @id='add' @priority={{0}} @forms={{ADD_FORMS}} @pinned={{true}} as |form|>…</lc.Slot>\n" +
      '</LayoutControl>'
    );
  }

  <template>
    <FreestyleUsage
      @name='LayoutControl'
      @description='A toolbar row that fits its controls to its own width. Each Slot lists the forms its control can take, richest first; the bar measures itself, steps slots down evenly (least important first on a tie), and folds what is left into one ⋯ menu. The pinned primary action never folds. Drag the box corner narrower, down to about 400px or the page width.'
      @source={{this.usage}}
    >
      <:example>
        <div class='lc-usage-box'>
          <LayoutControl
            @label={{this.label}}
            @overflowLabel={{this.overflowLabel}}
            as |lc|
          >
            <lc.Slot
              @id='search'
              @priority={{1}}
              @forms={{SEARCH_FORMS}}
              @label='Search'
              as |form|
            >
              {{#if (eq form 'icon')}}
                <SearchInput
                  @display='collapsed'
                  @placeholder='Search candidates'
                  @value={{this.query}}
                  @onInput={{this.setQuery}}
                />
              {{else}}
                <label class='lc-usage-search' data-form={{form}}>
                  <VisuallyHidden>Search candidates</VisuallyHidden>
                  <SearchInput
                    @placeholder='Search candidates…'
                    @value={{this.query}}
                    @onInput={{this.setQuery}}
                  />
                </label>
              {{/if}}
            </lc.Slot>

            <lc.Slot
              @id='stage'
              @priority={{2}}
              @forms={{STAGE_FORMS}}
              @label='Stage'
              @menuItems={{this.stageChoices}}
              as |form|
            >
              {{#if (eq form 'chips')}}
                <FilterChips
                  @label='Stage'
                  @options={{this.stageOptions}}
                  @value={{this.stage}}
                  @onValueChange={{this.setStage}}
                />
              {{else}}
                <Menu @items={{this.stageChoices}} @label='Stage'>
                  <:trigger as |_open toggle|>
                    <Button
                      @tone='neutral'
                      @appearance='outlined'
                      {{on 'click' toggle}}
                    >Stage: {{this.stage}}</Button>
                  </:trigger>
                </Menu>
              {{/if}}
            </lc.Slot>

            <span class='lc-usage-spacer'></span>

            <lc.Slot
              @id='view'
              @priority={{3}}
              @forms={{VIEW_FORMS}}
              @label='View'
              @menuItems={{this.viewChoices}}
              as |form|
            >
              {{#if (eq form 'text')}}
                <SegmentedControl
                  @label='View'
                  @options={{VIEWS}}
                  @value={{this.view}}
                  @onValueChange={{this.setView}}
                />
              {{else}}
                <span class='lc-usage-pair' role='group' aria-label='View'>
                  <IconButton
                    @label='Board'
                    @icon={{this.icon 'layout-grid'}}
                    @pressed={{eq this.view 'board'}}
                    {{on 'click' (fn this.setView 'board')}}
                  />
                  <IconButton
                    @label='List'
                    @icon={{this.icon 'list'}}
                    @pressed={{eq this.view 'list'}}
                    {{on 'click' (fn this.setView 'list')}}
                  />
                </span>
              {{/if}}
            </lc.Slot>

            <lc.Slot
              @id='sort'
              @priority={{3}}
              @forms={{SORT_FORMS}}
              @label='Sort'
              @menuItems={{this.sortItems}}
              as |form|
            >
              <Menu @items={{this.sortItems}} @label='Sort' @align='end'>
                <:trigger as |_open toggle|>
                  {{#if (eq form 'icon')}}
                    <IconButton
                      @label='Sort'
                      @icon={{this.icon 'arrow-down-up'}}
                      {{on 'click' toggle}}
                    />
                  {{else}}
                    <Button
                      @tone='neutral'
                      @appearance='outlined'
                      {{on 'click' toggle}}
                    >Sort: {{this.sort}}</Button>
                  {{/if}}
                </:trigger>
              </Menu>
            </lc.Slot>

            <lc.Slot
              @id='add'
              @priority={{0}}
              @forms={{ADD_FORMS}}
              @pinned={{true}}
              as |form|
            >
              {{#if (eq form 'icon')}}
                <IconButton
                  @label='Add candidate'
                  @icon={{this.icon 'plus'}}
                  @tone='primary'
                  @appearance='filled'
                />
              {{else}}
                <Button @tone='primary'>{{if
                    (eq form 'label')
                    'Add candidate'
                    'Add'
                  }}</Button>
              {{/if}}
            </lc.Slot>
          </LayoutControl>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Toolbar'
          @description='Accessible name of the role=group row.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='overflowLabel'
          @value={{this.overflowLabel}}
          @defaultValue='More options'
          @description='Accessible name of the ⋯ button.'
          @onInput={{this.setOverflowLabel}}
        />
        <Args.String
          @name='controlHeight'
          @description='Any CSS length; sets --pretui-row-h and --control-height on the bar. SegmentedControl, FilterChips, Select, Button, IconButton, Input (and the typed inputs, not Textarea), SearchInput and InputGroup size themselves from --pretui-row-h and share that height. Use 1.5rem or more.'
        />
        <Args.Yield
          @description='Yields { Slot, overflow: { active, folded } }. Slot takes @id, @priority (0 most important), @forms ({ name, minWidth in rem }[], richest first, ending in menu to allow folding), @label, @menuItems (native ⋯ items while folded) and @pinned (never folds), and yields the chosen form name.'
          @hideControls={{true}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-lc-gap'
          @type='length'
          @description='Gap between slots; the chooser reads the computed gap.'
        />
        <Css.Basic
          @name='control-height'
          @type='length'
          @description='The row minimum height and the room reserved for the ⋯ button.'
        />
        <Css.Basic
          @name='pretui-row-h'
          @type='length'
          @description='The height a control that reads it takes: SegmentedControl, FilterChips, Select, Button, IconButton, Input (and the typed inputs), SearchInput and InputGroup. Set by @controlHeight.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .lc-usage-box {
        inline-size: 60rem;
        min-inline-size: min(25rem, 100%);
        max-inline-size: 100%;
        resize: horizontal;
        overflow: hidden;
        padding: var(--boxel-sp-xs);
        border: 1px dashed var(--border);
        border-radius: var(--boxel-border-radius);
      }
      .lc-usage-search {
        display: block;
        inline-size: 14rem;
      }
      .lc-usage-search[data-form='field-s'] {
        inline-size: 9rem;
      }
      /* The chooser counts one gap between slots; the spacer is a flex item
         with a gap on each side, so half-gap negative margins make a
         zero-width spacer cost exactly one gap. */
      .lc-usage-spacer {
        flex-grow: 1;
        margin-inline: calc(var(--pretui-lc-gap, var(--boxel-sp-xs)) / -2);
      }
      .lc-usage-pair {
        display: inline-flex;
        gap: var(--boxel-sp-4xs);
      }
    </style>
  </template>
}

export const DEMOS_LAYOUT_CONTROL: Record<string, unknown> = {
  LayoutControl: LayoutControlUsage,
};
