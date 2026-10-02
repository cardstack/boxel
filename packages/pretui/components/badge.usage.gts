// Pretui — Badge usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Badge } from './badge';
import { Avatar } from './avatar';
import { IconButton } from './icon-button';

const PLACEMENTS = ['top-end', 'top-start', 'bottom-end', 'bottom-start'];

export class BadgeUsage extends Component {
  placements = PLACEMENTS;
  @tracked count = 3;
  @tracked max = 99;
  @tracked dot = false;
  @tracked showZero = false;
  @tracked placement = 'top-end';
  setCount = (v: number | null) => (this.count = v ?? 0);
  setMax = (v: number | null) => (this.max = v ?? 99);
  setDot = (v: boolean) => (this.dot = v);
  setShowZero = (v: boolean) => (this.showZero = v);
  setPlacement = (v: string) => (this.placement = v);
  get usage() {
    let bits = [`@count={{${this.count}}}`, "@label='unread'"];
    if (this.max !== 99) bits.push(`@max={{${this.max}}}`);
    if (this.dot) bits.push('@dot={{true}}');
    if (this.showZero) bits.push('@showZero={{true}}');
    if (this.placement !== 'top-end') bits.push(`@placement='${this.placement}'`);
    return `<Badge ${bits.join(' ')}>\n  <IconButton @label='Messages'>…</IconButton>\n</Badge>`;
  }
  <template>
    <FreestyleUsage
      @name='Badge'
      @description='A count or status mark on the corner of another control: the unread 3 on an inbox button, 99+ on an avatar. The mark is hidden from assistive technology and the meaning is spoken after the child, so the child keeps its own name. The inline pill shadcn calls Badge is Chip; a dot with no number is Indicator.'
      @source={{this.usage}}
    >
      <:example>
        <div class='bd-demo'>
          <Badge @count={{this.count}} @max={{this.max}} @dot={{this.dot}} @showZero={{this.showZero}} @placement={{this.placement}} @label='unread'>
            <IconButton @label='Messages'>✉</IconButton>
          </Badge>
          <Badge @count={{128}} @circular={{true}} @label='notifications'>
            <Avatar @name='Ana Ruiz' />
          </Badge>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number @name='count' @value={{this.count}} @onInput={{this.setCount}} />
        <Args.Number @name='max' @value={{this.max}} @defaultValue={{99}} @description='Above this it reads max+.' @onInput={{this.setMax}} />
        <Args.Bool @name='dot' @value={{this.dot}} @defaultValue={{false}} @description='A dot instead of the number.' @onInput={{this.setDot}} />
        <Args.Bool @name='showZero' @value={{this.showZero}} @defaultValue={{false}} @onInput={{this.setShowZero}} />
        <Args.Bool @name='invisible' @defaultValue={{false}} @description='Hide without unmounting the child.' />
        <Args.String @name='tone' @defaultValue='danger' />
        <Args.String @name='placement' @value={{this.placement}} @options={{this.placements}} @defaultValue='top-end' @onInput={{this.setPlacement}} />
        <Args.Bool @name='circular' @defaultValue={{false}} @description='Pull the mark in for a round child.' />
        <Args.String @name='label' @value='unread' @description='What the count means, read after it.' />
        <Args.Yield @name='default' @description='The control the badge sits on.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .bd-demo {
        display: flex;
        align-items: center;
        gap: var(--space-6, 1.25rem);
        padding: var(--space-4, 0.6875rem);
      }
    </style>
  </template>
}

export const DEMOS_BADGE: Record<string, unknown> = {
  Badge: BadgeUsage,
};
