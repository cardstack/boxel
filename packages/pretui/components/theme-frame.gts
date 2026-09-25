// Pretui — ThemeFrame: per-page theme controls (upper-left).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { themeScope, themeScopedCss } from '@cardstack/boxel-ui/helpers';
import { Popover } from './popover';
import { Select } from './select';
import { SegmentedControl } from './segmented-control';

// Wraps a page in a theme island with a Light/Dark/Auto switch, built the
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
// 'Auto' stamps no attribute, so the island follows the ambient host
// scheme. Components never branch on dark (Appendix F) — the flip is
// entirely token re-resolution.

const THEME_MODES = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

interface ThemeLike {
  id?: string;
  cssVariables?: string | null;
  // `cardTitle`, not `title` — CardDef exposes no `title`, so reading `.title`
  // silently yields undefined and every theme labels itself "Untitled theme".
  cardTitle?: string;
}

export interface ThemeFrameSignature {
  Args: {
    // the Theme card linked from the page card's cardInfo (model.cardTheme)
    theme?: ThemeLike | null;
    // pass @context to enable the season selector: the frame queries the
    // realm for every Theme instance so all shipped seasons are choosable
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
    // false hides the frame's own pill — for pages that place the yielded
    // collapsed control in their own header instead
    bar?: boolean;
  };
  // yields two header-seatable controls: [collapsed popover trigger,
  // expanded inline segmented+select] — pages pick their presentation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Blocks: { default: [any, any] };
  Element: HTMLDivElement;
}

// The collapsed presentation: one small ◐ button; mode + season live in a
// Popover that opens on demand.
interface ThemePopoverControlsSignature {
  Args: { frame: ThemeFrame };
  Element: HTMLSpanElement;
}

// The expanded presentation: mode segmented + season select side by side,
// for pages that give theme controls a permanent seat in their header.
const ThemeInlineControls: TemplateOnlyComponent<ThemePopoverControlsSignature> =
  <template>
    <span class='pretui-theme-inline' data-test-pretui-theme-bar ...attributes>
      <SegmentedControl
        @options={{THEME_MODES}}
        @value={{@frame.mode}}
        @onValueChange={{@frame.setMode}}
      />
      {{#if @frame.showThemeSelect}}
        <span class='pretui-theme-inline-pick'>
          <Select
            @options={{@frame.themeOptions}}
            @value={{@frame.activeThemeId}}
            @onValueChange={{@frame.pickTheme}}
          />
        </span>
      {{/if}}
    </span>
    <style scoped>
      .pretui-theme-inline {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .pretui-theme-inline-pick {
        min-width: 170px;
        font-size: var(--text-ui, 12px);
      }
    </style>
  </template>
;

const ThemePopoverControls: TemplateOnlyComponent<ThemePopoverControlsSignature> =
  <template>
    <Popover @placement='bottom-end' @label='Theme' ...attributes>
      <:trigger as |open toggle|>
        <button
          type='button'
          class='pretui-theme-trigger'
          data-state={{if open 'open'}}
          title='Theme — {{@frame.themeName}}'
          aria-label='Theme controls'
          {{on 'click' toggle}}
        >◐</button>
      </:trigger>
      <:default>
        <div class='pretui-theme-pop' data-test-pretui-theme-bar>
          <span class='pretui-theme-pop-cap'>Mode</span>
          <SegmentedControl
            @options={{THEME_MODES}}
            @value={{@frame.mode}}
            @onValueChange={{@frame.setMode}}
          />
          {{#if @frame.showThemeSelect}}
            <span class='pretui-theme-pop-cap'>Season</span>
            <Select
              @options={{@frame.themeOptions}}
              @value={{@frame.activeThemeId}}
              @onValueChange={{@frame.pickTheme}}
            />
          {{else}}
            <span class='pretui-theme-name'>{{@frame.themeName}}</span>
          {{/if}}
        </div>
      </:default>
    </Popover>
    <style scoped>
      .pretui-theme-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: var(--radius-chip, 6px);
        background: transparent;
        color: var(--muted-foreground);
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
      }
      .pretui-theme-trigger:hover,
      .pretui-theme-trigger[data-state='open'] {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      .pretui-theme-pop {
        display: grid;
        gap: 8px;
        min-width: 210px;
      }
      .pretui-theme-pop-cap {
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-theme-name {
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
;

export class ThemeFrame extends Component<ThemeFrameSignature> {
  @tracked mode: string = 'auto';
  @tracked selectedThemeId: string | undefined;
  setMode = (v: string) => (this.mode = v);
  pickTheme = (v: string) => (this.selectedThemeId = v);

  // All Theme instances in the page card's realm (derived from the linked
  // theme's id — themes live one directory below the realm root). Absent
  // context (prerender, tests) degrades to the linked theme only.
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
      // theme id .../pretui/Theme/<slug> → realm root .../pretui/
      let id = this.args.theme?.id;
      return id ? [new URL('../', id).href] : undefined;
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
    return this.mode === 'auto' ? undefined : this.mode;
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
    return this.activeTheme?.cardTitle ?? 'No theme';
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
          <div class='pretui-theme-bar' data-test-pretui-theme-bar>
            <SegmentedControl
              @options={{THEME_MODES}}
              @value={{this.mode}}
              @onValueChange={{this.setMode}}
            />
            {{#if this.showThemeSelect}}
              <div class='pretui-theme-pick'>
                <Select
                  @options={{this.themeOptions}}
                  @value={{this.activeThemeId}}
                  @onValueChange={{this.pickTheme}}
                />
              </div>
            {{else}}
              <span class='pretui-theme-name'>{{this.themeName}}</span>
            {{/if}}
          </div>
        {{/if}}
        {{yield
          (component ThemePopoverControls frame=this)
          (component ThemeInlineControls frame=this)
        }}
      </div>
    </div>
    <style scoped>
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
      .pretui-theme-surface {
        min-height: 100%;
      }
      .pretui-theme-bar {
        /* in-flow (not sticky): pages may carry their own sticky top bar
           (the workbench format) and the bar must not collide with it.
           No box of its own — the segmented control and select carry their
           own rounded chrome, and wrapping rounded controls in another
           rounded container reads as double chrome. */
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        width: fit-content;
        margin: 10px 0 0 10px;
      }
      .pretui-theme-name {
        font-size: var(--text-ui, 12px);
        letter-spacing: var(--track-ui, 0.01em);
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .pretui-theme-pick {
        min-width: 180px;
        font-size: var(--text-ui, 12px);
      }
    </style>
  </template>
}
