// Pretui — HostThemeBridge: an MCP host's theme, as the tokens Pret UI and Boxel cards read.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';

/** the MCP Apps host's style variables (`hostContext.styles.variables`):
 * `--color-background-primary`, `--color-text-primary`, … */
export type HostStyleVariables = Record<string, string | undefined>;

export interface HostThemeBridgeSignature {
  Args: {
    /** the host's scheme (`hostContext.theme`). Default 'light' */
    theme?: 'light' | 'dark';
    /** the host's CSS variables, as it sends them */
    variables?: HostStyleVariables;
    /** a host font stylesheet's CSS (`hostContext.styles.css.fonts`) */
    fonts?: string;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

/** host variable → the tokens it feeds. The first host variable present
 * for a token wins */
const MAP: [token: string, host: string[]][] = [
  ['--background', ['--color-background-primary']],
  ['--card', ['--color-background-primary']],
  ['--popover', ['--color-background-primary']],
  ['--inset', ['--color-background-secondary', '--color-background-tertiary']],
  ['--muted', ['--color-background-secondary']],
  ['--hover', ['--color-background-tertiary', '--color-background-secondary']],
  ['--foreground', ['--color-text-primary']],
  ['--card-foreground', ['--color-text-primary']],
  ['--popover-foreground', ['--color-text-primary']],
  ['--muted-foreground', ['--color-text-secondary']],
  ['--subtle-foreground', ['--color-text-tertiary', '--color-text-secondary']],
  ['--border', ['--color-border-primary']],
  ['--border-strong', ['--color-border-secondary', '--color-border-primary']],
  ['--input', ['--color-border-primary']],
  ['--ring', ['--color-ring-primary']],
  ['--primary', ['--color-background-info', '--color-ring-primary']],
  // the ink on the host's accent: its inverse text, the colour a host draws
  // on a filled button
  ['--primary-foreground', ['--color-text-inverse', '--color-background-primary']],
  ['--pretui-link', ['--color-text-info', '--color-ring-primary']],
  ['--success', ['--color-text-success']],
  ['--pretui-destructive-ink', ['--color-text-danger']],
  ['--destructive', ['--color-background-danger']],
  ['--pretui-attention', ['--color-text-warning']],
  ['--pretui-attention-ink', ['--color-text-warning']],
  ['--font-sans', ['--font-sans']],
  ['--font-mono', ['--font-mono']],
  ['--radius', ['--border-radius-md']],
  ['--radius-surface', ['--border-radius-lg']],
];

/** the tokens a host's variables give, as `--token: value` declarations */
export function hostTokens(variables: HostStyleVariables | undefined): string[] {
  if (!variables) {
    return [];
  }
  let out: string[] = [];
  for (let [token, hosts] of MAP) {
    let value = hosts.map((h) => variables[h]).find((v) => v && v.trim());
    if (value && !/[;{}<]/.test(value)) {
      out.push(`${token}: ${value.trim()}`);
    }
  }
  return out;
}

/**
 * Inside an MCP App iframe there is no Boxel host around the card: the
 * host's theme arrives as `hostContext.theme` and its CSS variables. This
 * wrapper stamps the scheme (`data-theme`, `color-scheme`) and maps the
 * host's variables onto the tokens Pret UI parts and Boxel cards read, so
 * the frame's chrome follows the host's dark mode and its colours. A card
 * that brings its own theme scopes it inside, as anywhere in Boxel.
 * Variables the host does not send keep the kit's defaults.
 */
export class HostThemeBridge extends Component<HostThemeBridgeSignature> {
  get theme() {
    return this.args.theme ?? 'light';
  }
  get style() {
    return htmlSafe(hostTokens(this.args.variables).join('; '));
  }
  <template>
    <div
      class='pretui-hosttheme'
      data-theme={{this.theme}}
      style={{this.style}}
      data-test-pretui-host-theme={{this.theme}}
      ...attributes
    >
      {{#if @fonts}}
        {{! template-lint-disable require-scoped-style }}
        <style data-pretui-host-fonts>{{@fonts}}</style>
        {{! template-lint-enable require-scoped-style }}
      {{/if}}
      {{yield}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-hosttheme {
          min-height: 100%;
          background: var(--background, transparent);
          color: var(--foreground);
          font-family: var(--font-sans, system-ui, sans-serif);
        }
        .pretui-hosttheme[data-theme='dark'] {
          color-scheme: dark;
        }
        .pretui-hosttheme[data-theme='light'] {
          color-scheme: light;
        }
      }
    </style>
  </template>
}
