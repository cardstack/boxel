// Pretui — AppAuthGate: a step that needs more access than the MCP App was granted.
import Component from '@glimmer/component';
import { ToolGate } from './tool-gate';
import type { ToolGateAction } from './tool-gate';

export interface AppAuthGateSignature {
  Args: {
    /** what needs access: 'Saving' */
    action: string;
    /** what access, in words: 'edit access to Home renovation' */
    access: string;
    /** ask the assistant to reconnect with that access (a message), which
     * is the one thing the iframe can do: it never collects credentials */
    onAskToReconnect?: () => unknown;
    /** open the connector's settings, where the host offers a link */
    onOpenSettings?: () => unknown;
  };
  Element: HTMLDivElement;
}

/**
 * "Saving needs edit access to Home renovation." When a tool answers with
 * an authorization challenge (`mcp/www_authenticate`), the iframe renders
 * this instead of nothing: what is missing, in words, and the one action
 * the iframe has. OAuth happens outside the iframe, in the host's connector
 * flow; this gate never asks for a password or a token.
 */
export class AppAuthGate extends Component<AppAuthGateSignature> {
  get prompt(): string {
    return `${this.args.action} needs ${this.args.access}.`;
  }
  get actions(): ToolGateAction[] {
    let out: ToolGateAction[] = [];
    if (this.args.onAskToReconnect) {
      out.push({ label: 'Ask to reconnect', kind: 'primary', onAct: this.args.onAskToReconnect, busyLabel: 'Asking…' });
    }
    if (this.args.onOpenSettings) {
      out.push({ label: 'Connector settings', kind: 'quiet', onAct: this.args.onOpenSettings });
    }
    return out;
  }
  <template>
    <ToolGate
      class='pretui-appauth'
      @prompt={{this.prompt}}
      @detail='You sign in through your assistant’s connector, not here.'
      @actions={{this.actions}}
      data-test-pretui-app-auth-gate
      ...attributes
    />
  </template>
}
