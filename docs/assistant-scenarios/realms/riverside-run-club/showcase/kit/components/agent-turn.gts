// Pretui — AgentTurn: one assistant turn, its working header, and the transcript's rhythm.
import { AgentMark } from './agent-mark';
import Component from '@glimmer/component';
import { StateGlyph } from './state-glyph';
import { TextShimmer } from './text-shimmer';
import { ToolMeta } from './tool-meta';
import { SpeakerLabel } from './speaker-label';
import { formatToolDuration } from './tool-row';

export interface AgentTurnSignature {
  Args: {
    /** the turn is still working: its header shimmers "Working · {phase}" */
    working?: boolean;
    /** what it is doing now, in a word or two: 'lint', 'reading the plan' */
    phase?: string;
    /** seconds the turn has worked; the caller feeds it, so the turn keeps
     * no clock. Settled, it heads the turn: "Worked for 48s" */
    elapsed?: number;
    /** the reader stopped the turn: its footer says what was kept */
    stopped?: boolean;
    /** what a stop kept. Default 'partial answer kept' */
    stoppedNote?: string;
    /** when, as the caller formats it; shown while the turn is hovered or
     * focused */
    time?: string;
    /** a room with more than one voice names the speaker */
    speaker?: string;
    /** whose session carried it: 'Chris' */
    via?: string;
    /** the turn's particulars, revealed on hover: model, speed, tokens */
    meta?: (string | undefined)[];
    /** settled work recedes while a later turn runs. Default false */
    recede?: boolean;
  };
  Blocks: {
    /** replaces the working / worked-for header */
    header: [];
    /** the plan the turn follows, above its work (ToolPlan) */
    plan: [];
    /** the turn's work and answer, in order */
    default: [];
    /** the answer's actions (AnswerFooter) */
    footer: [];
  };
  Element: HTMLElement;
}

/**
 * The container every assistant turn sits in. It owns the transcript's
 * rhythm (12px between a turn's blocks, 24px between turns, both tokens)
 * and the turn's header: a shimmering "Working · lint" while it runs that
 * settles to a quiet "Worked for 48s", the receipt of the whole turn.
 *
 * ```hbs
 * <AgentTurn @working={{turn.live}} @phase={{turn.phase}} @elapsed={{turn.seconds}}>
 *   <:default>{{#each turn.parts as |part|}}…{{/each}}</:default>
 *   <:footer><AnswerFooter … /></:footer>
 * </AgentTurn>
 * ```
 */
export class AgentTurn extends Component<AgentTurnSignature> {
  get workingLabel(): string {
    return this.args.phase ? `Working · ${this.args.phase}` : 'Working';
  }
  get elapsedText(): string | undefined {
    let e = this.args.elapsed;
    return e === undefined ? undefined : formatToolDuration(e);
  }
  get workedLabel(): string | undefined {
    return this.elapsedText ? `Worked for ${this.elapsedText}` : undefined;
  }
  get state(): string {
    if (this.args.working) {
      return 'working';
    }
    return this.args.stopped ? 'stopped' : 'settled';
  }
  <template>
    <section
      class='pretui-turn'
      data-state={{this.state}}
      data-recede={{if @recede 'true'}}
      aria-busy={{if @working 'true'}}
      data-test-pretui-agent-turn={{this.state}}
      ...attributes
    >
      {{#if @speaker}}
        <SpeakerLabel @name={{@speaker}} @agent={{true}} @via={{@via}} @working={{@working}} />
      {{/if}}
      {{#if (has-block 'header')}}
        {{yield to='header'}}
      {{else if @working}}
        <p class='pretui-turn-head' data-test-pretui-agent-turn-head>
          {{#unless @speaker}}<AgentMark class='pretui-turn-mark' @working={{true}} />{{/unless}}
          <TextShimmer @text={{this.workingLabel}} />
          {{#if this.elapsedText}}<span
              class='pretui-turn-elapsed'
            >{{this.elapsedText}}</span>{{/if}}
          {{#if @time}}<span class='pretui-turn-time'>{{@time}}</span>{{/if}}
        </p>
      {{else if this.workedLabel}}
        <p class='pretui-turn-head' data-test-pretui-agent-turn-head>
          {{#unless @speaker}}<AgentMark class='pretui-turn-mark' />{{/unless}}
          <span class='pretui-turn-worked'>{{this.workedLabel}}</span>
          {{#if @time}}<span class='pretui-turn-time'>{{@time}}</span>{{/if}}
        </p>
      {{/if}}
      {{#if (has-block 'plan')}}{{yield to='plan'}}{{/if}}
      {{yield}}
      {{#if @stopped}}
        <p class='pretui-turn-stopped' data-test-pretui-agent-turn-stopped>
          <StateGlyph @glyph='stop' @size={{10}} />
          Stopped ·
          {{if @stoppedNote @stoppedNote 'partial answer kept'}}
        </p>
      {{/if}}
      {{#if (has-block 'footer')}}{{yield to='footer'}}{{/if}}
      {{#if @meta}}<ToolMeta class='pretui-turn-meta' @items={{@meta}} />{{/if}}
    </section>
    <style scoped>
      @layer PretComponent {
        .pretui-turn {
          display: grid;
          gap: var(--pretui-block-gap, var(--step-12, 12px));
          min-width: 0;
        }
        /* the gap between turns is twice the gap inside one: a turn reads
           as a unit */
        .pretui-turn + .pretui-turn,
        :global(.pretui-turn + .pretui-bubble-turn),
        :global(.pretui-bubble-turn + .pretui-turn) {
          margin-block-start: calc(
            var(--pretui-turn-gap, var(--step-24, 24px)) -
              var(--pretui-block-gap, var(--step-12, 12px))
          );
        }
        .pretui-turn[data-recede] {
          opacity: var(--pretui-recede-opacity, 1);
        }
        .pretui-turn-head {
          display: flex;
          align-items: center;
          gap: var(--step-8, 8px);
          margin: 0;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--ink-2, var(--muted-foreground));
        }
        /* a duration is a receipt, not a string to paste: sans, tabular */
        .pretui-turn-worked,
        .pretui-turn-elapsed {
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-variant-numeric: tabular-nums;
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        /* the time is for the reader who looks for it */
        .pretui-turn-time {
          margin-inline-start: auto;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-variant-numeric: tabular-nums;
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
          opacity: 0;
          transition: opacity 160ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        .pretui-turn:hover .pretui-turn-time,
        .pretui-turn:focus-within .pretui-turn-time {
          opacity: 1;
        }
        @media (hover: none) {
          .pretui-turn-time {
            opacity: 1;
          }
        }
        .pretui-turn-stopped {
          display: flex;
          align-items: center;
          gap: var(--step-8, 8px);
          margin: 0;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-2, var(--muted-foreground));
        }
        /* the particulars hang under the turn, revealed with its time, and
           take no line of the turn's rhythm */
        .pretui-turn-meta {
          padding-inline-start: 0;
          margin-top: calc(
            -1 * var(--pretui-block-gap, var(--step-12, 12px)) + 2px
          );
          height: 0;
          overflow: visible;
        }
        .pretui-turn:hover :global(.pretui-toolmeta[data-reveal='hover']),
        .pretui-turn:focus-within :global(.pretui-toolmeta[data-reveal='hover']) {
          opacity: 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-turn-time {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
