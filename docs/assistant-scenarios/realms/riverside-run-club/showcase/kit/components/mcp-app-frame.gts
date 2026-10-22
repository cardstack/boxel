// Pretui — McpAppFrame: the top-level wrapper for a Boxel card inside an MCP App iframe.
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { CardEmbed } from './card-embed';
import type { CardEmbedFormat, CardEmbedState } from './card-embed';
import { HostThemeBridge } from './host-theme-bridge';
import type { HostStyleVariables } from './host-theme-bridge';

/**
 * What the frame needs from the MCP host. The iframe's own code fills it
 * from its `App` (the ext-apps SDK), so Pret UI imports no SDK:
 *
 * ```ts
 * let bridge: AppHostBridge = {
 *   reportSize: (size) => app.sendSizeChanged(size),
 *   get hostContext() { return app.getHostContext(); },
 *   openLink: (url) => app.openLink({ url }),
 *   requestDisplayMode: (mode) => app.requestDisplayMode({ mode }),
 * };
 * ```
 */
export interface AppHostBridge {
  /** report the frame's height to the host */
  reportSize?: (size: { height: number }) => unknown;
  /** the host's context: theme, styles, display mode, container limits */
  hostContext?: {
    theme?: 'light' | 'dark';
    styles?: { variables?: HostStyleVariables; css?: { fonts?: string } };
    displayMode?: string;
    availableDisplayModes?: string[];
    containerDimensions?: { maxHeight?: number; height?: number; width?: number };
  };
  openLink?: (url: string) => unknown;
  requestDisplayMode?: (mode: string) => unknown;
}

export interface McpAppFrameSignature {
  Args: {
    bridge: AppHostBridge;
    /** the card's state, from the tool's input and result: 'pending' while
     * the input arrives, 'loading' while the kernel boots and the card
     * fetches, 'ready', 'error', 'missing', 'auth-required', 'cancelled' */
    state?: CardEmbedState;
    format?: CardEmbedFormat;
    label?: string;
    kind?: string;
    error?: string;
    onRetry?: () => void;
    /** the card's URL in Boxel: "Open in Boxel" asks the host to open it */
    boxelUrl?: string;
    /** the auth step-up: what access is missing, and the one action */
    authPrompt?: string;
    authorizeLabel?: string;
    onAuthorize?: () => void;
    /** the most height reported inline. Default: the host's maxHeight,
     * capped at 600px. Past it the card scrolls inside the frame */
    maxHeight?: number;
    /** a fitted card's definite box: '16 / 9' or '180px' */
    envelope?: string;
  };
  Blocks: {
    /** the frame's header: an AppBar */
    bar: [];
    /** the card: the kernel's CardRenderer */
    default: [];
    /** the frame's footer: a SaveBar, a receipt */
    foot: [];
  };
  Element: HTMLDivElement;
}

const MAX_INLINE = 600;

/**
 * The whole iframe, as one Pret UI part: the host's theme (HostThemeBridge),
 * an optional bar, the card in a filling CardEmbed (so its box is held while
 * the call writes it and while the kernel boots, and every state says
 * itself in place), an optional foot, and the height loop: it measures
 * itself, reports its height to the host capped at the host's maxHeight (or
 * 600px), lets the card scroll past that, and stops reporting in fullscreen,
 * where the host owns the size.
 */
export class McpAppFrame extends Component<McpAppFrameSignature> {
  get context() {
    return this.args.bridge.hostContext;
  }
  get theme() {
    return this.context?.theme ?? 'light';
  }
  get variables() {
    return this.context?.styles?.variables;
  }
  get fonts() {
    return this.context?.styles?.css?.fonts;
  }
  get fullscreen() {
    return this.context?.displayMode === 'fullscreen';
  }
  get cap(): number {
    let host = this.context?.containerDimensions?.maxHeight;
    return this.args.maxHeight ?? Math.min(host ?? Infinity, MAX_INLINE);
  }
  get capCss(): string | undefined {
    return this.fullscreen ? undefined : `${this.cap}px`;
  }
  openInBoxel = () => {
    let url = this.args.boxelUrl;
    if (url) {
      this.args.bridge.openLink?.(url);
    }
  };
  get canOpen() {
    return Boolean(this.args.boxelUrl && this.args.bridge.openLink);
  }

  // the height loop: one ResizeObserver on the frame, a report per frame
  // of change at most, nothing in fullscreen
  reportHeight = modifier((element: HTMLElement) => {
    if (typeof ResizeObserver !== 'function') {
      return;
    }
    let last = -1;
    let pending: number | undefined;
    let send = () => {
      pending = undefined;
      if (this.fullscreen) {
        return;
      }
      let height = Math.min(Math.ceil(element.getBoundingClientRect().height), this.cap);
      if (height !== last) {
        last = height;
        this.args.bridge.reportSize?.({ height });
      }
    };
    let observer = new ResizeObserver(() => {
      if (pending === undefined) {
        pending = requestAnimationFrame(send);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (pending !== undefined) {
        cancelAnimationFrame(pending);
      }
    };
  });

  <template>
    <HostThemeBridge
      class='pretui-mcpframe-theme'
      @theme={{this.theme}}
      @variables={{this.variables}}
      @fonts={{this.fonts}}
    >
      <div
        class='pretui-mcpframe'
        data-display={{if this.context.displayMode this.context.displayMode 'inline'}}
        data-test-pretui-mcp-app-frame
        {{this.reportHeight}}
        ...attributes
      >
        {{#if (has-block 'bar')}}<div class='pretui-mcpframe-bar'>{{yield to='bar'}}</div>{{/if}}
        <CardEmbed
          @fill={{true}}
          @format={{@format}}
          @state={{@state}}
          @label={{@label}}
          @kind={{@kind}}
          @error={{@error}}
          @onRetry={{@onRetry}}
          @maxHeight={{this.capCss}}
          @envelope={{@envelope}}
          @openLabel='Open in Boxel'
          @hat={{false}}
          @onOpen={{if this.canOpen this.openInBoxel}}
          @authPrompt={{@authPrompt}}
          @authorizeLabel={{@authorizeLabel}}
          @onAuthorize={{@onAuthorize}}
        >{{yield}}</CardEmbed>
        {{#if (has-block 'foot')}}<div class='pretui-mcpframe-foot'>{{yield to='foot'}}</div>{{/if}}
      </div>
    </HostThemeBridge>
    <style scoped>
      @layer PretComponent {
        .pretui-mcpframe {
          display: grid;
          align-content: start;
          min-width: 0;
        }
        .pretui-mcpframe[data-display='fullscreen'] {
          min-height: 100vh;
          grid-template-rows: auto minmax(0, 1fr) auto;
        }
        .pretui-mcpframe-bar {
          position: sticky;
          inset-block-start: 0;
          z-index: 1;
          background: var(--background, transparent);
        }
        .pretui-mcpframe-foot {
          position: sticky;
          inset-block-end: 0;
          z-index: 1;
          background: var(--background, transparent);
        }
      }
    </style>
  </template>
}
