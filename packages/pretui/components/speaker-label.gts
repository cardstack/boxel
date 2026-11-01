// Pretui — SpeakerLabel: who said a message in a room with more than one person.
import Component from '@glimmer/component';
import { AgentMark } from './agent-mark';
import { Tooltip } from './tooltip';
import { fullDate, shortTime } from '../internal/message-time';

export interface SpeakerLabelSignature {
  Args: {
    /** the speaker: 'Rupert', 'Assistant' */
    name: string;
    /** whose session carried it: an assistant answering Rupert's question
     * in Chris's session is 'Assistant · via Chris' */
    via?: string;
    /** the speaker is the assistant, not a person */
    agent?: boolean;
    /** what follows the name, as the caller formats it: '2:04 PM', or a
     * turn's 'Worked for 24s' */
    time?: string;
    /** when it was said, in place of `@time`: shown as '2:04 PM', with the
     * full date in a tooltip on hover and keyboard focus */
    timestamp?: Date;
    /** the assistant is working: its mark animates */
    working?: boolean;
  };
  Blocks: {
    /** the person's own avatar, in place of the initial: the host's profile
     * mark, so a name in the transcript looks like it does everywhere else */
    mark: [];
  };
  Element: HTMLDivElement;
}

/**
 * A name above a message, only where the room has more than one voice. A
 * person gets an initial; the assistant gets its own mark (AgentMark: the
 * host's icon, animated while it works), so the two never read alike.
 */
export class SpeakerLabel extends Component<SpeakerLabelSignature> {
  get shortTime(): string | undefined {
    return this.args.timestamp ? shortTime(this.args.timestamp) : undefined;
  }
  get fullDate(): string | undefined {
    return this.args.timestamp ? fullDate(this.args.timestamp) : undefined;
  }
  get isoTime(): string | undefined {
    return this.args.timestamp?.toISOString();
  }
  get initial(): string {
    return this.args.name.trim()[0] ?? '?';
  }
  <template>
    <div
      class='pretui-speaker'
      data-agent={{if @agent 'true'}}
      data-test-pretui-speaker-label
      ...attributes
    >
      {{#if @agent}}
        <AgentMark class='pretui-speaker-agent' @working={{@working}} />
      {{else if (has-block 'mark')}}
        <span class='pretui-speaker-avatar' aria-hidden='true'>{{yield
            to='mark'
          }}</span>
      {{else}}
        <span
          class='pretui-speaker-mark'
          aria-hidden='true'
        >{{this.initial}}</span>
      {{/if}}
      <span class='pretui-speaker-name'>{{@name}}</span>
      {{#if @via}}<span class='pretui-speaker-via' data-test-pretui-speaker-via>
          via
          {{@via}}</span>{{/if}}
      {{#if this.fullDate}}
        <span class='pretui-speaker-dot' aria-hidden='true'>·</span>
        <Tooltip @content={{this.fullDate}} @side='right'>
          <time
            class='pretui-speaker-tiptime'
            datetime={{this.isoTime}}
            tabindex='0'
            data-test-pretui-speaker-time
          >{{this.shortTime}}</time>
        </Tooltip>
      {{else if @time}}
        <span class='pretui-speaker-time'>{{@time}}</span>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-speaker {
          display: flex;
          align-items: center;
          /* the mark is the thread's glyph column, its words one gap after,
             as every mark in the transcript */
          gap: var(--pretui-toolrow-gap, var(--boxel-sp-xs));
          min-width: 0;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--muted-foreground);
        }
        /* the host's avatar, held to the mark's circle */
        .pretui-speaker-avatar {
          flex: none;
          display: inline-flex;
          width: var(--pretui-toolrow-disc, 1rem);
          height: var(--pretui-toolrow-disc, 1rem);
          overflow: hidden;
          border-radius: 50%;
        }
        .pretui-speaker-mark {
          flex: none;
          display: grid;
          place-items: center;
          width: var(--pretui-toolrow-disc, 1rem);
          height: var(--pretui-toolrow-disc, 1rem);
          border-radius: 50%;
          background-color: var(--inset);
          box-shadow: inset 0 0 0 1px var(--border);
          /* one initial, not a kicker: caption, set to the circle's height */
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 600;
          text-transform: uppercase;
          color: var(--foreground);
        }
        .pretui-speaker-name {
          font-weight: 600;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-speaker-via,
        .pretui-speaker-time,
        .pretui-speaker-dot {
          white-space: nowrap;
        }
        /* the assistant's name is one short word and always reads; what
           follows it (a time, or a turn's "Worked for 2m 55s · 6 calls")
           gives way first */
        .pretui-speaker[data-agent] .pretui-speaker-name {
          flex: none;
        }
        .pretui-speaker[data-agent] .pretui-speaker-time {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-speaker-via::before,
        .pretui-speaker-time::before {
          content: '·';
          margin-inline-end: var(--boxel-sp-xs);
        }
        .pretui-speaker-time {
          font-variant-numeric: tabular-nums;
        }
        /* a time with its full date in a tooltip is a keyboard stop; its
           dot stands outside it, so the focus ring holds the time alone */
        .pretui-speaker-tiptime {
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .pretui-speaker-tiptime:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
          border-radius: var(--boxel-border-radius-xs);
        }
      }
    </style>
  </template>
}
