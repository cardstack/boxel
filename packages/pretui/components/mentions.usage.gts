// Pretui — Mentions usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Mentions } from './mentions';
import type { MentionItem } from './mentions';

const AT = '@';

const PEOPLE: MentionItem[] = [
  { id: 'ana', label: 'Ana Ruiz' },
  { id: 'ben', label: 'Ben Okafor' },
  { id: 'cai', label: 'Cai Lin' },
  { id: 'dev', label: 'Dev Patel' },
];

export class MentionsUsage extends Component {
  people = PEOPLE;
  @tracked text = 'Thanks @Ana Ruiz for the cupping notes. ';
  @tracked mentioned: string[] = [];
  setText = (v: string) => (this.text = v);
  onMention = (item: MentionItem) => (this.mentioned = [...this.mentioned, item.label]);
  get usage() {
    return "<Mentions @items={{this.people}} @value={{this.text}} @onChange={{this.setText}} @onMention={{this.record}} @label='Comment' />";
  }
  <template>
    <FreestyleUsage
      @name='Mentions'
      @description='A textarea that offers suggestions after @ and inserts the chosen one. The text stays a plain string, so copy, paste and undo work as usual; onMention reports each insertion for whoever stores the references. Arrow keys move through the list, Enter or Tab inserts, Escape closes it.'
      @source={{this.usage}}
    >
      <:example>
        <div class='mn-demo'>
          <Mentions @items={{this.people}} @value={{this.text}} @onChange={{this.setText}} @onMention={{this.onMention}} @label='Comment' @placeholder='Type @ to mention someone' />
          {{#if this.mentioned.length}}
            <p class='mn-demo-log'>Mentioned: {{#each this.mentioned as |name|}}{{name}}; {{/each}}</p>
          {{/if}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object @name='items' @required={{true}} @description='{ id, label }[]. Filtered by the typed query unless onQuery is set.' />
        <Args.String @name='value' @description='Controlled text. defaultValue seeds the uncontrolled form.' />
        <Args.Action @name='onChange' @description='The whole text on every change.' />
        <Args.Action @name='onQuery' @description='The query as it is typed, for a remote search that replaces items.' />
        <Args.Action @name='onMention' @description='The item, each time one is inserted.' />
        <Args.String @name='trigger' @defaultValue={{AT}} />
        <Args.String @name='label' />
        <Args.String @name='placeholder' />
        <Args.Number @name='rows' @defaultValue={{3}} />
        <Args.Number @name='limit' @defaultValue={{8}} @description='At most this many suggestions.' />
        <Args.Bool @name='disabled' @defaultValue={{false}} />
        <Args.Yield @name='item' @description='One suggestion face, yielded the item and whether it is active.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .mn-demo {
        display: grid;
        gap: var(--space-2, 0.375rem);
        max-inline-size: 30rem;
        padding-block-end: 9rem;
      }
      .mn-demo-log {
        margin: 0;
        font-size: var(--text-ui-sm, 0.72rem);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_MENTIONS: Record<string, unknown> = {
  Mentions: MentionsUsage,
};
