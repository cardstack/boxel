// Pretui — Defer usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Defer } from './defer';

// ── Defer ────────────────────────────────────────────────────────────────
const TRIGGERS = ['visible', 'idle', 'intent', 'manual'];

// Dropped upstream surface: the error branch. Loading and failing belong to
// the deferred content, not to the gate that decided when to render it.
class DeferUsage extends Component {
  triggers = TRIGGERS;

  @tracked trigger = 'intent';
  @tracked minHeight = '120px';
  @tracked aspect = '';
  @tracked intentText = 'Show the chart';
  @tracked revealCount = 0;
  @tracked nonce = 0;

  setTrigger = (v: string) => {
    this.trigger = v;
    this.nonce = this.nonce + 1;
  };
  setMinHeight = (v: string) => (this.minHeight = v);
  setAspect = (v: string) => (this.aspect = v);
  setIntentText = (v: string) => (this.intentText = v);
  onReveal = () => (this.revealCount = this.revealCount + 1);
  reset = () => (this.nonce = this.nonce + 1);

  get triggerValue() {
    return this.trigger as 'visible' | 'idle' | 'intent' | 'manual';
  }
  /** One keyed entry — bumping the nonce tears the gate down and builds a
   *  fresh one, which is how the demo re-arms without a timer. */
  get gates() {
    return [{ id: 'gate-' + this.nonce }];
  }
  get aspectValue() {
    return this.aspect.length > 0 ? this.aspect : undefined;
  }
  get usage() {
    return "<Defer @trigger='" +
      this.trigger +
      "' @minHeight='" +
      this.minHeight +
      "' @onReveal={{this.load}}><:default>expensive thing</:default></Defer>";
  }

  <template>
    <FreestyleUsage
      @name='Defer'
      @description='A render gate. The subtree is not rendered until it is worth paying for — when it scrolls into view, when the main thread goes idle, when the reader signals intent, or when a caller flag says so — and the placeholder reserves the final space so nothing shifts when the content lands. Reset re-arms the gate.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-demo-defer'>
          {{#each this.gates key='id' as |gate|}}
            <Defer
              @trigger={{this.triggerValue}}
              @minHeight={{this.minHeight}}
              @aspect={{this.aspectValue}}
              @intentLabel='Load the revenue chart'
              @intentText={{this.intentText}}
              @announceText='Revenue chart loaded'
              @onReveal={{this.onReveal}}
            >
              <:placeholder>
                <div class='pretui-demo-skel' aria-hidden='true'>
                  reserved space
                </div>
              </:placeholder>
              <:default>
                <div class='pretui-demo-heavy'>
                  The expensive thing — a chart, a map, an editor, a WebGL
                  scene. Rendered exactly once,
                  {{gate.id}}.
                </div>
              </:default>
            </Defer>
          {{/each}}
        </div>
        <p class='pretui-demo-readout' data-test-defer-readout>
          revealed
          {{this.revealCount}}
          times
        </p>
        <Button
          @tone='neutral'
          @appearance='outlined'
          data-test-defer-reset
          {{on 'click' this.reset}}
        >Reset the gate</Button>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='trigger'
          @defaultValue='visible'
          @value={{this.trigger}}
          @options={{this.triggers}}
          @description='What decides. visible uses an IntersectionObserver; intent renders a real named button over the placeholder so hover, focus, tap and Enter are one control; idle uses a one-shot modifier-owned idle callback; manual obeys the when flag alone.'
          @onInput={{this.setTrigger}}
        />
        <Args.String
          @name='minHeight'
          @defaultValue=''
          @value={{this.minHeight}}
          @description='Reserved height while pending, kept afterwards as a floor. A floor can never cause a shift, which an aspect ratio can.'
          @onInput={{this.setMinHeight}}
        />
        <Args.String
          @name='aspect'
          @defaultValue=''
          @value={{this.aspect}}
          @description='Reserved aspect ratio while pending, dropped once revealed so real content is never distorted.'
          @onInput={{this.setAspect}}
        />
        <Args.String
          @name='intentText'
          @defaultValue=''
          @value={{this.intentText}}
          @description='Visible caption on the intent affordance. The accessible name comes from intentLabel and is always required.'
          @onInput={{this.setIntentText}}
        />
        <Args.Action
          @name='onReveal'
          @description='Fires the first time the content is revealed.'
        />
        <Args.Yield
          @name='placeholder'
          @description='Replaces the Skeleton. Supplying it requires an explicit default block alongside — a Glimmer rule, not a Defer one.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-defer {
        display: grid;
        gap: var(--space-4, 12px);
      }
      .pretui-demo-skel {
        display: grid;
        place-items: center;
        height: 100%;
        border-radius: var(--radius-surface, 10px);
        background: var(--inset, var(--boxel-100));
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--ink-3, var(--boxel-400));
      }
      .pretui-demo-heavy {
        display: grid;
        place-items: center;
        height: 100%;
        padding: var(--space-5, 16px);
        border-radius: var(--radius-surface, 10px);
        background: color-mix(in oklch, var(--primary) 10%, var(--card));
        font-size: var(--text-ui-md, 12.5px);
        text-align: center;
      }
      .pretui-demo-readout {
        margin: var(--space-3, 8px) 0;
        font-size: var(--text-ui-sm, 11.5px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_DEFER: Record<string, unknown> = {
  Defer: DeferUsage,
};
