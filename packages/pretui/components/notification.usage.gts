// Pretui — Notification usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Notification } from './notification';
import type { ToastTone } from './toaster';

const TONE_OPTIONS = ['neutral', 'info', 'success', 'warning', 'danger'];

export class NotificationUsage extends Component {
  toneOptions = TONE_OPTIONS;
  @tracked title = 'Lot 7 is ready to ship';
  @tracked message = 'Roasted 12 kg on Tuesday. Labels are printed.';
  @tracked tone = 'success';
  @tracked busy = false;
  @tracked live = false;
  @tracked actionLabel = 'View lot';
  @tracked dismissed = false;
  @tracked actions = 0;
  setTitle = (v: string) => (this.title = v);
  setMessage = (v: string) => (this.message = v);
  setTone = (v: string) => (this.tone = v);
  setBusy = (v: boolean) => (this.busy = v);
  setLive = (v: boolean) => (this.live = v);
  setActionLabel = (v: string) => (this.actionLabel = v);
  onAction = () => this.actions++;
  onDismiss = () => (this.dismissed = true);
  restore = () => (this.dismissed = false);
  get toneArg() {
    return this.tone as ToastTone;
  }
  get usage() {
    let bits = [`@title='${this.title}'`];
    if (this.message) bits.push(`@message='${this.message}'`);
    if (this.tone !== 'neutral') bits.push(`@tone='${this.tone}'`);
    if (this.busy) bits.push('@busy={{true}}');
    if (this.live) bits.push('@live={{true}}');
    if (this.actionLabel) bits.push(`@actionLabel='${this.actionLabel}' @onAction={{this.view}}`);
    bits.push('@onDismiss={{this.dismiss}}');
    return `<Notification\n  ${bits.join('\n  ')}\n/>`;
  }
  <template>
    <FreestyleUsage
      @name='Notification'
      @description='A persistent notification item: title, message, tone stripe, one inline action and a dismiss button. It wears the Toaster face but has no clock, so it stays until dismissed. Toast is the slimmer transient card; Toaster stacks items and ages them out.'
      @source={{this.usage}}
    >
      <:example>
        {{#if this.dismissed}}
          <button type='button' class='nt-demo-restore' {{on 'click' this.restore}}>Show it again</button>
        {{else}}
          <Notification
            @title={{this.title}}
            @message={{this.message}}
            @tone={{this.toneArg}}
            @busy={{this.busy}}
            @live={{this.live}}
            @actionLabel={{this.actionLabel}}
            @onAction={{this.onAction}}
            @onDismiss={{this.onDismiss}}
          />
        {{/if}}
        {{#if this.actions}}<p class='nt-demo-count'>Action pressed {{this.actions}} times</p>{{/if}}
      </:example>
      <:api as |Args|>
        <Args.String @name='title' @required={{true}} @value={{this.title}} @onInput={{this.setTitle}} />
        <Args.String
          @name='message'
          @value={{this.message}}
          @description='The second line. The default block takes markup instead; @description is an alias.'
          @onInput={{this.setMessage}}
        />
        <Args.String
          @name='tone'
          @value={{this.tone}}
          @options={{this.toneOptions}}
          @defaultValue='neutral'
          @description='Paints the stripe. Kit tone spellings resolve.'
          @onInput={{this.setTone}}
        />
        <Args.Bool
          @name='busy'
          @defaultValue={{false}}
          @value={{this.busy}}
          @description='A spinner in place of the icon while the reported work is still running.'
          @onInput={{this.setBusy}}
        />
        <Args.Bool
          @name='live'
          @defaultValue={{false}}
          @value={{this.live}}
          @description='Announce it on arrival: alert for warning and danger, status otherwise. Leave off inside a Toaster or a list that already announces.'
          @onInput={{this.setLive}}
        />
        <Args.String
          @name='actionLabel'
          @value={{this.actionLabel}}
          @description='A single inline action, fired through @onAction. The action block replaces it.'
          @onInput={{this.setActionLabel}}
        />
        <Args.Action @name='onAction' @description='Fired by the inline action.' />
        <Args.Action @name='onDismiss' @description='Shows the dismiss button and fires when it is pressed.' />
        <Args.String @name='dismissLabel' @defaultValue='Dismiss' @description="The dismiss button's accessible name." />
        <Args.Yield @name='icon' @description='A leading icon, tinted with the tone.' />
        <Args.Yield @name='default' @description='The message, when it needs markup.' />
        <Args.Yield @name='action' @description='Replaces the inline action.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .nt-demo-restore {
        font: inherit;
      }
      .nt-demo-count {
        margin: var(--space-2, 0.375rem) 0 0;
        font-size: var(--text-ui-sm, 0.72rem);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_NOTIFICATION: Record<string, unknown> = {
  Notification: NotificationUsage,
};
