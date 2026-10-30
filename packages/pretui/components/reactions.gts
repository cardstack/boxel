// Pretui — Reactions: who reacted to a message or a call, as small pills under it.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

export interface Reaction {
  /** the emoji: '👍', '👎', '🎉' */
  key: string;
  /** who reacted, in order, as the room names them */
  by: string[];
  /** the reader is among them: the pill is pressed */
  mine?: boolean;
}

export interface ReactionsSignature {
  Args: {
    reactions: Reaction[];
    /** toggle the reader's own reaction; omit and the pills only show */
    onToggle?: (key: string) => void;
    /** what the reactions are on, for the group's name: 'the read' */
    subject?: string;
  };
  Element: HTMLDivElement;
}

/**
 * "👍 Chris" under the thing it answers, the way a chat shows a reaction:
 * the content stays as it was, and the pill says who. Two names show, then
 * "+N"; every name is in the pill's title and its accessible name. With
 * `@onToggle` a pill is a pressed toggle for the reader's own reaction.
 */
export class Reactions extends Component<ReactionsSignature> {
  names = (reaction: Reaction): string => {
    let [a, b, ...rest] = reaction.by;
    let shown = [a, b].filter(Boolean).join(', ');
    return rest.length ? `${shown} +${rest.length}` : shown;
  };
  label = (reaction: Reaction): string =>
    `${reaction.key} by ${reaction.by.join(', ')}`;
  toggle = (key: string) => this.args.onToggle?.(key);
  get groupLabel(): string {
    return this.args.subject
      ? `Reactions to ${this.args.subject}`
      : 'Reactions';
  }
  <template>
    <div
      class='pretui-reactions'
      role='group'
      aria-label={{this.groupLabel}}
      data-test-pretui-reactions
      ...attributes
    >
      {{#each @reactions as |reaction|}}
        {{#if @onToggle}}
          <button
            type='button'
            class='pretui-reaction'
            aria-pressed={{if reaction.mine 'true' 'false'}}
            aria-label={{this.label reaction}}
            title={{this.label reaction}}
            {{on 'click' (fn this.toggle reaction.key)}}
            data-test-pretui-reaction={{reaction.key}}
          ><span
              class='pretui-reaction-key'
              aria-hidden='true'
            >{{reaction.key}}</span><span
              class='pretui-reaction-by'
              aria-hidden='true'
            >{{this.names reaction}}</span></button>
        {{else}}
          <span
            class='pretui-reaction'
            data-mine={{if reaction.mine 'true'}}
            role='img'
            aria-label={{this.label reaction}}
            title={{this.label reaction}}
            data-test-pretui-reaction={{reaction.key}}
          ><span
              class='pretui-reaction-key'
              aria-hidden='true'
            >{{reaction.key}}</span><span
              class='pretui-reaction-by'
              aria-hidden='true'
            >{{this.names reaction}}</span></span>
        {{/if}}
      {{/each}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-reactions {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-4xs);
        }
        .pretui-reaction {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          /* the least a pointer target takes */
          height: 1.5rem;
          padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-2xs);
          border: 0;
          border-radius: var(--boxel-border-radius-pill);
          /* knob: a reaction hung over an edge takes the ground it sits on */
          background-color: var(--pretui-reaction-surface, var(--muted));
          box-shadow: inset 0 0 0 1px var(--border);
          font-family: inherit;
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          line-height: 1;
          color: var(--muted-foreground);
        }
        .pretui-reaction-key {
          font-size: var(--boxel-font-size-xs);
        }
        .pretui-reaction[data-mine],
        .pretui-reaction[aria-pressed='true'] {
          background-color: color-mix(
            in oklch,
            var(--primary) 14%,
            var(--pretui-reaction-surface, var(--card))
          );
          box-shadow: inset 0 0 0 1px
            color-mix(in oklch, var(--primary) 45%, transparent);
          color: var(--foreground);
        }
        button.pretui-reaction {
          cursor: pointer;
        }
        button.pretui-reaction:hover {
          color: var(--foreground);
        }
        button.pretui-reaction:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
      }
    </style>
  </template>
}
