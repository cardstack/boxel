// Pretui — FloatButton usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { FloatButton } from './float-button';
import type { FloatButtonAction } from './float-button';

const PLACEMENT_OPTIONS = ['bottom-end', 'bottom-start', 'top-end', 'top-start'];
const INBOX = [
  'Lot 7 roast profile approved',
  'Invoice 1042 paid',
  'Cupping notes from Tuesday',
  'Green coffee arrival: Huila',
  'Label proofs for the spring blend',
  'Warehouse count reconciled',
];

export class FloatButtonUsage extends Component {
  placementOptions = PLACEMENT_OPTIONS;
  inbox = INBOX;
  @tracked label = 'Compose';
  @tracked extended = false;
  @tracked placement = 'bottom-end';
  @tracked dial = true;
  @tracked last = '';
  setLabel = (v: string) => (this.label = v);
  setExtended = (v: boolean) => (this.extended = v);
  setPlacement = (v: string) => (this.placement = v);
  setDial = (v: boolean) => (this.dial = v);
  onAction = () => (this.last = 'Compose');
  actions: FloatButtonAction[] = [
    { id: 'note', label: 'New note', onSelect: () => (this.last = 'New note') },
    { id: 'task', label: 'New task', onSelect: () => (this.last = 'New task') },
    { id: 'lot', label: 'New lot', onSelect: () => (this.last = 'New lot') },
  ];
  get actionsArg() {
    return this.dial ? this.actions : undefined;
  }
  get usage() {
    let bits = [`@label='${this.label}'`];
    if (this.extended) bits.push('@extended={{true}}');
    if (this.placement !== 'bottom-end') bits.push(`@placement='${this.placement}'`);
    bits.push(this.dial ? '@actions={{this.actions}}' : '@onAction={{this.compose}}');
    return `<div style='position: relative'>\n  …the pane…\n  <FloatButton ${bits.join(' ')} />\n</div>`;
  }
  <template>
    <FreestyleUsage
      @name='FloatButton'
      @description='The primary action of a long pane, pinned to a corner of the pane rather than the viewport. With @actions it becomes a speed dial: a disclosure that opens a list of labelled actions. Fab is the same component under the MUI name.'
      @source={{this.usage}}
    >
      <:example>
        <div class='fb-demo-pane'>
          <ul class='fb-demo-list'>
            {{#each this.inbox as |line|}}<li>{{line}}</li>{{/each}}
          </ul>
          <FloatButton
            @label={{this.label}}
            @extended={{this.extended}}
            @placement={{this.placement}}
            @actions={{this.actionsArg}}
            @onAction={{this.onAction}}
          />
        </div>
        {{#if this.last}}<p class='fb-demo-last'>Last chosen: {{this.last}}</p>{{/if}}
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @required={{true}}
          @value={{this.label}}
          @description='The accessible name, and the visible text when extended.'
          @onInput={{this.setLabel}}
        />
        <Args.Bool
          @name='extended'
          @defaultValue={{false}}
          @value={{this.extended}}
          @description='Show the label beside the icon.'
          @onInput={{this.setExtended}}
        />
        <Args.String
          @name='placement'
          @value={{this.placement}}
          @options={{this.placementOptions}}
          @defaultValue='bottom-end'
          @description='The corner. Logical, so RTL flips it; bottom-right and friends map.'
          @onInput={{this.setPlacement}}
        />
        <Args.String @name='position' @defaultValue='absolute' @description='absolute anchors to the nearest positioned ancestor; fixed to the viewport.' />
        <Args.String @name='tone' @defaultValue='primary' @description='The button tone.' />
        <Args.String @name='size' @defaultValue='m' @description='s, m or l.' />
        <Args.Bool
          @name='actions'
          @value={{this.dial}}
          @description='Toggle the speed dial in this demo. In code, an array of { id, label, onSelect }.'
          @onInput={{this.setDial}}
        />
        <Args.Action @name='onAction' @description='Fired by the button when there are no actions.' />
        <Args.Bool @name='open' @description='Controlled dial state; omit for uncontrolled.' />
        <Args.Action @name='onOpenChange' @description='Reports every open or close request.' />
        <Args.Yield @name='default' @description='The icon. Defaults to a plus.' />
        <Args.Yield @name='actionIcon' @description='The icon for one dial action, yielded the action.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .fb-demo-pane {
        position: relative;
        block-size: 16rem;
        overflow: auto;
        border-radius: var(--radius-surface, 10px);
        box-shadow: 0 0 0 1px var(--border);
        background: var(--card);
      }
      .fb-demo-list {
        margin: 0;
        padding: var(--space-3, 0.5rem) var(--space-4, 0.6875rem);
        list-style: none;
        display: grid;
        gap: var(--space-3, 0.5rem);
        font-size: var(--text-ui-md, 0.78rem);
      }
      .fb-demo-last {
        margin: var(--space-2, 0.375rem) 0 0;
        font-size: var(--text-ui-sm, 0.72rem);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_FLOAT_BUTTON: Record<string, unknown> = {
  FloatButton: FloatButtonUsage,
};
