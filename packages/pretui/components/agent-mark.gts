// Pretui — AgentMark: the assistant's own icon, still when settled and animated while it works.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';

export interface AgentMarkSignature {
  Args: {
    /** the assistant is working: the mark animates (the host's animated
     * icon), and holds still under reduced motion */
    working?: boolean;
    /** px. Default 16 */
    size?: number;
  };
  Element: HTMLSpanElement;
}

/**
 * The assistant's mark, wherever the transcript names it: beside its
 * speaker label, at the head of a turn. The host gives its icon as tokens,
 * since a realm-served kit carries no bitmaps:
 *
 * ```css
 * --pretui-agent-icon: image-set(url(ai-assist-icon.webp) 1x, url(ai-assist-icon@2x.webp) 2x);
 * --pretui-agent-icon-working: url(ai-assist-icon-animated.webp);
 * --pretui-agent-glyph: '';
 * ```
 *
 * Without them it draws the ✦ the kit uses elsewhere, which pulses while
 * the assistant works. Decorative: the label beside it says who.
 */
export class AgentMark extends Component<AgentMarkSignature> {
  get style() {
    return htmlSafe(`--pretui-agent-mark-size: ${this.args.size ?? 16}px`);
  }
  <template>
    <span
      class='pretui-agentmark'
      data-working={{if @working 'true'}}
      style={{this.style}}
      aria-hidden='true'
      data-test-pretui-agent-mark={{if @working 'working' 'settled'}}
      ...attributes
    ></span>
    <style scoped>
      @layer PretComponent {
        .pretui-agentmark {
          display: inline-grid;
          place-items: center;
          flex: none;
          width: var(--pretui-agent-mark-size);
          height: var(--pretui-agent-mark-size);
          background-image: var(--pretui-agent-icon, none);
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          /* a mark, not text: the glyph scales with the mark's box */
          font-size: calc(var(--pretui-agent-mark-size) * 0.75);
          line-height: 1;
          /* settled, the fallback glyph is ink; teal is for live work */
          color: var(--muted-foreground);
          vertical-align: -0.2em;
        }
        .pretui-agentmark[data-working] {
          color: var(--primary-ink);
        }
        .pretui-agentmark::before {
          content: var(--pretui-agent-glyph, '✦');
        }
        .pretui-agentmark[data-working] {
          background-image: var(
            --pretui-agent-icon-working,
            var(--pretui-agent-icon, none)
          );
        }
        .pretui-agentmark[data-working]::before {
          animation: pretui-agentmark-pulse 1.2s ease-in-out infinite;
        }
        @keyframes pretui-agentmark-pulse {
          50% {
            opacity: 0.35;
            transform: scale(0.8);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-agentmark[data-working] {
            background-image: var(--pretui-agent-icon, none);
          }
          .pretui-agentmark[data-working]::before {
            animation: none;
          }
        }
      }
    </style>
  </template>
}
