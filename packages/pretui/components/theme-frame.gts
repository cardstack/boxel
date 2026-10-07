// Pretui — ThemeFrame: per-page theme controls (upper-left).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { guidFor } from '@ember/object/internals';
import { Switch } from '@cardstack/boxel-ui/components';
import { themeScope, themeScopedCss } from '@cardstack/boxel-ui/helpers';
import Moon from '@cardstack/boxel-icons/moon';
import Sun from '@cardstack/boxel-icons/sun';
import { realmURL } from 'https://cardstack.com/base/card-api';
import { Select } from './select';

// Wraps a page in a theme island with a dark mode switch, built the
// way the monorepo's own theme cards preview themselves (see
// base/default-templates/theme-dashboard.gts). No custom theming code: the
// outer div stamps data-theme, which theme.css translates into the
// inherited --boxel-color-scheme signal; inside it, boxel-ui's `themeScope`
// and `themeScopedCss` helpers re-declare the theme's variables under a
// content-hashed scope, and their `.dark` block follows the signal through
// the style container query those helpers emit.
//
// The re-scoping must sit INSIDE the data-theme wrapper. Boxel already
// applied this card's theme at the card boundary above, but that scope
// resolves against the app chrome's scheme, not this toggle — so the island
// needs its own copy to flip. That is the same reasoning the ThemeDashboard
// comment gives.
//
// It deliberately does NOT wrap in a nested CardContainer: that re-applies
// a whole card box (background, radius, overflow, the --boxel-* derivation
// and the element reset) which the frame then has to undo. The scoping
// helpers are the part that was actually wanted.
//
// Components never branch on dark — the flip is entirely token
// re-resolution.

interface ThemeLike {
  id?: string;
  [realmURL]?: URL;
  cssVariables?: string | null;
  // `cardTitle`, not `title` — CardDef exposes no `title`, so reading `.title`
  // silently yields undefined and every theme labels itself "Untitled theme".
  cardTitle?: string;
}

export interface ThemeFrameSignature {
  Args: {
    // the Theme card linked from the page card's cardInfo (model.cardTheme)
    theme?: ThemeLike | null;
    // pass @context to enable the theme selector: the frame queries the
    // realm for every Theme instance so each one can be previewed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
    // false hides the frame's own bar — for pages that place the yielded
    // controls in their own header instead
    bar?: boolean;
  };
  // yields the controls (dark mode switch, and the theme select when the
  // realm has more than one theme) for pages that seat them in a header
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Blocks: { default: [any] };
  Element: HTMLDivElement;
}

// The same switch the base ThemeDashboard's ModeToggle renders, so a theme
// previews light and dark the way it does everywhere else in Boxel.
interface ThemeControlsSignature {
  Args: { frame: ThemeFrame };
  Element: HTMLSpanElement;
}

const ThemeControls: TemplateOnlyComponent<ThemeControlsSignature> = <template>
  <span class='pretui-theme-controls' data-test-pretui-theme-bar ...attributes>
    <Switch
      @isEnabled={{@frame.isDarkMode}}
      @onChange={{@frame.toggleDarkMode}}
      @size='touch'
      @checkedIcon={{Moon}}
      @uncheckedIcon={{Sun}}
      @label='Dark mode'
      data-test-pretui-theme-mode
    />
    {{#if @frame.showThemeSelect}}
      <span class='pretui-theme-pick' data-test-pretui-theme-pick>
        <Select
          @options={{@frame.themeOptions}}
          @value={{@frame.activeThemeId}}
          @onValueChange={{@frame.pickTheme}}
          @label='Theme'
        />
      </span>
    {{else if @frame.activeTheme}}
      <span
        class='pretui-theme-name'
        data-test-pretui-theme-name
      >{{@frame.themeName}}</span>
    {{/if}}
  </span>
  <style scoped>
    @layer PretComponent {
      .pretui-theme-controls {
        --pretui-theme-pick-min-w: 11.25rem;

        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .pretui-theme-pick {
        min-width: var(--pretui-theme-pick-min-w);
      }
      .pretui-theme-name {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        white-space: nowrap;
      }
    }
  </style>
</template>;

export class ThemeFrame extends Component<ThemeFrameSignature> {
  // Starts light, like ThemeDashboard: the Boxel chrome around the island
  // has fixed colors, so the switch previews dark rather than following the OS.
  @tracked isDarkMode = false;
  @tracked selectedThemeId: string | undefined;
  // a toggle, not a setter: the Switch in the CLI test harness passes its
  // click event to @onChange, not a boolean
  toggleDarkMode = () => (this.isDarkMode = !this.isDarkMode);
  pickTheme = (v: string) => (this.selectedThemeId = v);

  // All Theme instances in the linked theme's realm. Absent context
  // (prerender, tests) degrades to the linked theme only.
  themesResource = this.args.context?.getCards?.(
    this,
    () => ({
      filter: {
        // Themes must be queried on the ref they actually adopt from. The realm
        // search API does not resolve re-export aliases, so `base/theme`/`default`
        // (which re-exports this very class) matches zero cards rather than
        // erroring — the selector then silently falls back to one theme forever.
        type: { module: 'https://cardstack.com/base/card-api', name: 'Theme' },
      },
    }),
    () => {
      // the theme id may be prefix-form, which is not a URL base, so the
      // realm comes from the theme card itself
      let realm = this.args.theme?.[realmURL];
      return realm ? [realm.href] : undefined;
    },
  );

  get availableThemes(): ThemeLike[] {
    let found = (this.themesResource?.instances ?? []) as ThemeLike[];
    if (found.length > 0) {
      return found;
    }
    return this.args.theme ? [this.args.theme] : [];
  }
  get activeTheme(): ThemeLike | undefined {
    if (this.selectedThemeId) {
      let picked = this.availableThemes.find(
        (t) => t.id === this.selectedThemeId,
      );
      if (picked) {
        return picked;
      }
    }
    return this.args.theme ?? undefined;
  }
  get themeOptions() {
    return this.availableThemes.map((t) => ({
      value: t.id ?? '',
      label: t.cardTitle ?? 'Untitled theme',
    }));
  }
  get showThemeSelect() {
    return this.themeOptions.length > 1;
  }
  get activeThemeId() {
    return this.activeTheme?.id;
  }

  get dataTheme() {
    return this.isDarkMode ? 'dark' : 'light';
  }
  get themeCss() {
    return this.activeTheme?.cssVariables ?? undefined;
  }
  // boxel-ui's own scope helper: theme id plus a content hash of the CSS.
  // The hash matters because the emitted rules are page-global — two cached
  // renders sharing a scope but carrying different theme CSS would restyle
  // each other. A hand-rolled `${id}-frame` string could not tell two
  // versions of one theme apart.
  get themeScopeId() {
    return themeScope(this.activeThemeId, this.themeCss) ?? guidFor(this);
  }
  get themeName() {
    return this.activeTheme?.cardTitle ?? 'Untitled theme';
  }
  get showBar() {
    return this.args.bar ?? true;
  }
  <template>
    <div
      class='pretui-theme-frame'
      data-theme={{this.dataTheme}}
      data-test-pretui-theme-frame
      ...attributes
    >
      {{! The theme's variables are re-scoped INSIDE the data-theme wrapper,
          not above it: the card-level scope boxel already applied sits
          higher up and resolves against the app chrome's scheme, not this
          toggle. Same structure as the monorepo's ThemeDashboard. }}
      <div
        class='pretui-theme-surface'
        data-boxel-theme-scope={{if this.themeCss this.themeScopeId}}
      >
        {{#if this.themeCss}}
          {{! template-lint-disable require-scoped-style }}
          <style data-boxel-theme-style>
            {{themeScopedCss this.themeScopeId this.themeCss}}
          </style>
          {{! template-lint-enable require-scoped-style }}
        {{/if}}
        {{#if this.showBar}}
          <div class='pretui-theme-bar'>
            <ThemeControls @frame={{this}} />
          </div>
        {{/if}}
        {{yield (component ThemeControls frame=this)}}
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-theme-frame {
          min-height: 100%;
        }
        /* the scoped theme channel only carries custom properties, so the
           frame owns the native color-scheme switch for form controls */
        .pretui-theme-frame[data-theme='dark'] {
          color-scheme: dark;
        }
        .pretui-theme-frame[data-theme='light'] {
          color-scheme: light;
        }
        /* the island's tokens flip below the card's own surface, so the island
           applies its own background, foreground and font, or the card's show
           through */
        .pretui-theme-surface {
          min-height: 100%;
          background-color: var(--canvas);
          color: var(--foreground);
          font-family: var(--font-sans);
        }
        /* in-flow, not sticky: pages may carry their own sticky top bar */
        .pretui-theme-bar {
          width: fit-content;
          margin-block-start: var(--boxel-sp-xs);
          margin-inline-start: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}
