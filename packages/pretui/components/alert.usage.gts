// Pretui — Alert usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Alert } from './alert';
import { Button } from './button';

// ── Alert ← alert/usage.gts ──────────────────────────────────────────────
// feedback.gts keeps AlertTone module-private; mirror it for the cast getter.
type DemoAlertTone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_TONE_OPTIONS = ['info', 'success', 'warning', 'danger'];

// Dropped knobs: none remain fully dropped — messages (Args.Array) is now
// documented as the default-block Yield (Pretui Alert takes prose, not a
// messages array), and retryAction (Args.Action) as the action-block Yield.
class AlertUsage extends GlimmerComponent {
  @tracked tone = 'danger';
  @tracked title = 'Patch failed';
  setTone = (v: string) => (this.tone = v);
  setTitle = (v: string) => (this.title = v);
  get toneVal() {
    return this.tone as DemoAlertTone;
  }
  get titleVal() {
    return this.title || undefined;
  }
  get usage() {
    let bits = [`@tone='${this.tone}'`];
    if (this.title) {
      bits.push(`@title='${this.title}'`);
    }
    return `<Alert ${bits.join(' ')}>…</Alert>`;
  }
  <template>
    <FreestyleUsage
      @name='Alert'
      @description='A component that displays error or warning messages with an optional action.'
      @source={{this.usage}}
    >
      <:example>
        <div class='alert-col'>
          <Alert @tone={{this.toneVal}} @title={{this.titleVal}}>
            <:default>Patch command can’t run because it doesn’t have all the
              fields in arguments returned by Open AI.</:default>
            <:action>
              <Button @tone='neutral' @appearance='outlined' @size='xs'>
                Retry
              </Button>
            </:action>
          </Alert>
          <Alert @tone='warning'>
            <:default>You are about to run out of credit. Please upgrade your
              plan or buy additional credit soon.</:default>
          </Alert>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='tone'
          @description="Type of the first message — spans Pretui's full AlertTone set."
          @options={{ALERT_TONE_OPTIONS}}
          @defaultValue='info'
          @value={{this.tone}}
          @onInput={{this.setTone}}
        />
        <Args.String
          @name='title'
          @description='Bold headline above the prose (Pretui addition).'
          @value={{this.title}}
          @onInput={{this.setTitle}}
        />
        <Args.Yield
          @name='default'
          @description="Alert messages — Pretui takes prose in the default block in place of boxel-ui's messages array."
        />
        <Args.Yield
          @name='action'
          @description='Optional callback affordance that is triggered when the retry button is clicked — in Pretui a yielded action block (shown with a Retry button) rather than a retryAction arg.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .alert-col {
        width: min(100%, 420px);
        display: grid;
        gap: var(--space-3, 8px);
      }
    </style>
  </template>
}

export const DEMOS_ALERT: Record<string, unknown> = {
  Alert: AlertUsage,
};
