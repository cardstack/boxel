// Pretui — AppBar: the thin header of a card shown inside an MCP App iframe.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { concat } from '@ember/helper';
import ChevronLeftIcon from '@cardstack/boxel-icons/chevron-left';

export interface AppBarSignature {
  Args: {
    /** the card shown */
    title: string;
    /** its type, as a mono eyebrow */
    kind?: string;
    /** go back to the card before, by its title: "‹ Autumn relaunch" */
    backTitle?: string;
    onBack?: () => void;
  };
  Blocks: {
    /** the bar's actions: Choose, Save, a DisplayModeToggle */
    actions: [];
  };
  Element: HTMLElement;
}

/**
 * One 32px line at the top of the iframe: back to the previous card when
 * the reader followed a link inside the widget, the type and title of the
 * card shown, and its actions. It reads the host's theme through the
 * tokens HostThemeBridge sets, and McpAppFrame keeps it sticky and counts
 * it in the height it reports.
 */
export class AppBar extends Component<AppBarSignature> {
  back = () => this.args.onBack?.();
  <template>
    <header class='pretui-appbar' data-test-pretui-app-bar ...attributes>
      {{#if @onBack}}
        <button
          type='button'
          class='pretui-appbar-back'
          aria-label={{if @backTitle (concat 'Back to ' @backTitle) 'Back'}}
          data-test-pretui-app-bar-back
          {{on 'click' this.back}}
        ><ChevronLeftIcon width='14' height='14' aria-hidden='true' />{{#if @backTitle}}<span class='pretui-appbar-backtitle'>{{@backTitle}}</span>{{/if}}</button>
      {{/if}}
      <span class='pretui-appbar-heading'>
        {{#if @kind}}<span class='pretui-appbar-kind'>{{@kind}}</span>{{/if}}
        <span class='pretui-appbar-title' title={{@title}}>{{@title}}</span>
      </span>
      <span class='pretui-appbar-actions'>{{yield to='actions'}}</span>
    </header>
    <style scoped>
      @layer PretComponent {
        .pretui-appbar {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          height: 32px;
          padding: 0 6px 0 10px;
          box-shadow: 0 1px 0 var(--border);
          font-family: var(--font-sans, system-ui, sans-serif);
          color: var(--foreground);
        }
        .pretui-appbar-back {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          max-width: 40%;
          height: 24px;
          margin-inline-start: -4px;
          padding: 0 6px 0 2px;
          border: 0;
          border-radius: 6px;
          background: none;
          font: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-appbar-back:hover {
          color: var(--pretui-link, var(--primary));
          background: var(--hover, var(--inset));
        }
        .pretui-appbar-backtitle {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-appbar-heading {
          display: flex;
          align-items: baseline;
          gap: 6px;
          min-width: 0;
        }
        .pretui-appbar-kind {
          flex: none;
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--subtle-foreground, var(--muted-foreground));
        }
        .pretui-appbar-title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
          font-weight: 600;
        }
        .pretui-appbar-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-inline-start: auto;
        }
        .pretui-appbar-back:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
      }
    </style>
  </template>
}

