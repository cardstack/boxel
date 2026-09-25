// Pretui — StreamingText: text that reveals word by word without timers.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';

export interface StreamingTextSignature {
  Args: {
    text: string;
    // words per second for the CSS stagger (Law 7: seconds-based, unitless rates)
    rate?: number;
    startDelay?: number;
    cursor?: boolean;
  };
  Element: HTMLSpanElement;
}

// Timer-free stream: each word carries animation-delay = start + i/rate.
// Reduced motion / prerender shows the end state; sr-only mirror has full text.
export class StreamingText extends Component<StreamingTextSignature> {
  get words(): { word: string; style: ReturnType<typeof htmlSafe> }[] {
    let rate = this.args.rate ?? 18;
    let start = this.args.startDelay ?? 0;
    return this.args.text.split(' ').map((word, i) => ({
      word,
      style: htmlSafe(`animation-delay: ${(start + i / rate).toFixed(3)}s`),
    }));
  }
  <template>
    <span class='pretui-stream' data-test-pretui-streaming-text ...attributes>
      <span aria-hidden='true'>
        {{#each this.words as |w|}}<span class='pretui-stream-word' style={{w.style}}>{{w.word}} </span>{{/each}}
      </span>
      <span class='pretui-sr'>{{@text}}</span>
      {{#if @cursor}}<span class='pretui-stream-cursor' aria-hidden='true'></span>{{/if}}
    </span>
    <style scoped>
      @keyframes pretui-stream-in {
        from {
          opacity: 0;
          filter: blur(4px);
        }
        to {
          opacity: 1;
          filter: blur(0);
        }
      }
      .pretui-stream-word {
        display: inline;
        opacity: 0;
        animation: pretui-stream-in 420ms cubic-bezier(0.22, 0.61, 0.25, 1) both;
      }
      .pretui-stream-cursor {
        display: inline-block;
        width: 2px;
        height: 0.9em;
        vertical-align: -0.1em;
        border-radius: 1px;
        background: currentColor;
        margin-left: 1px;
      }
      .pretui-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-stream-word {
          animation: none;
          opacity: 1;
        }
      }
    </style>
  </template>
}
