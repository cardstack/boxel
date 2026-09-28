// Pretui — ThemeFrame proof: the upper-left dark/light switch must actually
// re-resolve theme tokens for the page subtree, through the same machinery
// the host uses (data-theme → --boxel-color-scheme signal → CardContainer's
// scoped style container query).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ThemeFrame } from './components/theme-frame';

const THEME = {
  id: 'https://test.example/theme/probe',
  cardTitle: 'Probe Theme',
  cssVariables: `:root {
  --background: rgb(1, 2, 3);
  --pretui-probe: rgb(10, 20, 30);
}
.dark {
  --background: rgb(4, 5, 6);
  --pretui-probe: rgb(40, 50, 60);
}`,
};

function probeColor(): string {
  let probe = document.querySelector('[data-test-probe]') as HTMLElement;
  return getComputedStyle(probe).backgroundColor;
}

// The mode picker is a SegmentedControl, which became a radiogroup over
// native <input type='radio'> on 2026-08-13 (it used to be role='tablist'
// over <button>s — invalid ARIA). Accept either shape so the helper survives
// the theme bar being re-cut again.
async function clickMode(label: string) {
  let candidates = Array.from(
    document.querySelectorAll('[data-test-pretui-theme-bar] button, [data-test-pretui-theme-bar] label'),
  );
  let target = candidates.find((b) => b.textContent?.trim() === label);
  if (!target) {
    throw new Error(`no mode button labeled ${label}`);
  }
  await click(target.querySelector('input') ?? target);
}

module('Pretui | ThemeFrame', function (hooks) {
  setupCardTest(hooks);

  test('dark/light switch re-resolves theme tokens in the subtree', async function (assert) {
    await render(<template>
      <ThemeFrame @theme={{THEME}}>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--pretui-probe)'>
          probe
        </div>
      </ThemeFrame>
    </template>);

    assert.strictEqual(
      probeColor(),
      'rgb(10, 20, 30)',
      'auto mode resolves the light token set',
    );

    await clickMode('Dark');
    assert.strictEqual(
      probeColor(),
      'rgb(40, 50, 60)',
      'dark mode re-resolves the theme dark block — no component changed',
    );

    await clickMode('Light');
    assert.strictEqual(
      probeColor(),
      'rgb(10, 20, 30)',
      'light mode forces the light set back on',
    );
  });

  test('frame without a theme still flips boxel-ui ambient tokens', async function (assert) {
    await render(<template>
      <ThemeFrame>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--background)'>
          probe
        </div>
      </ThemeFrame>
    </template>);

    let lightBg = probeColor();
    await clickMode('Dark');
    assert.notStrictEqual(
      probeColor(),
      lightBg,
      'data-theme flip reaches --background even with no theme card',
    );
  });
});

// ── Season re-tint proof (added with SS27 · The Night Shift) ─────────────
// Snapshots of the three shipped Theme instances' cssVariables, taken from
// Theme/*.json. These are the REAL strings, so the assertions below run the
// real extractCssVariables path — including the `.dark` bare-selector rule
// that a comma selector list would silently break.
const SS26_CSS = ":root {\n  --season-primary:oklch(.888 .193 164);\n  --season-primary-ink:oklch(.248 .02 305);\n  --season-accent:oklch(.928 .223 124);\n  --season-accent-ink:oklch(.248 .02 305);\n  --season-secondary:oklch(.517 .257 277);\n  --season-secondary-ink:oklch(1 0 0);\n  --season-attention:oklch(.558 .288 308);\n  --season-attention-dark:oklch(.68 .24 308);\n  --season-destructive:oklch(.663 .196 24);\n  --season-success:oklch(.82 .19 150);\n  --season-warning:oklch(.74 .15 80);\n  --season-info:oklch(.845 .132 192);\n  --season-ink:oklch(.248 .02 305);\n  --season-primary-text:oklch(.47 .14 164);\n  --season-attention-text:oklch(.5 .24 308);\n  --season-chart-1:oklch(.72 .16 163);\n  --season-chart-2:oklch(.72 .16 235);\n  --season-chart-3:oklch(.72 .16 307);\n  --season-chart-4:oklch(.72 .16 19);\n  --season-chart-5:oklch(.72 .16 91);\n  --season-chart-1-dark:oklch(.76 .16 163);\n  --season-chart-2-dark:oklch(.76 .16 235);\n  --season-chart-3-dark:oklch(.76 .16 307);\n  --season-chart-4-dark:oklch(.76 .16 19);\n  --season-chart-5-dark:oklch(.76 .16 91);\n  --season-cast-h:290;\n  --season-cast-c:.004;\n  --pretui-group-ratio:1.78;\n  --pretui-capsule-base:1.35;\n  --pretui-radius-encroach:.35;\n  --pretui-enclosure-factor:1.33;\n  --pretui-inset-exponent:.7;\n  --pretui-inset-k:.4;\n  --pretui-inset-min:11px;\n  --pretui-inset-max:25px;\n  --pretui-inset-slope:2.5;\n  --pretui-chip-mix:20%;\n  --pretui-ink-mix:34%;\n  --radius:10px;\n  --radius-surface:10px;\n  --radius-chip:6px;\n  --season-shadow-soft-a:.05;\n  --season-shadow-mid-a:.08;\n  --season-shadow-strong-a:.16;\n  --font-sans:'IBM Plex Sans','Helvetica Neue',Arial,system-ui,sans-serif;\n  --font-serif:'IBM Plex Serif',Georgia,serif;\n  --font-mono:'IBM Plex Mono',Menlo,ui-monospace,monospace;\n  --track-heading:-0.02em;\n  --track-ui:0.01em;\n  --track-eyebrow:.08em;\n  --type-ratio:1.333;\n  --background:oklch(.977 .007 290);\n  --canvas:oklch(.96 .008 290);\n  --card:oklch(1 0 0);\n  --card-foreground:var(--foreground);\n  --popover:oklch(1 0 0);\n  --popover-foreground:var(--foreground);\n  --inset:oklch(.968 .008 290);\n  --field:oklch(.995 .004 290);\n  --hover:oklch(.955 .01 290);\n  --hover-2:oklch(.935 .011 290);\n  --stripe:oklch(.984 .007 290);\n  --foreground:var(--season-ink);\n  --muted:oklch(.968 .008 290);\n  --muted-foreground:color-mix(in oklch,var(--season-ink) 62%,var(--card));\n  --ink-3:color-mix(in oklch,var(--season-ink) 40%,var(--card));\n  --border:oklch(.929 .011 290);\n  --line-strong:oklch(.875 .013 290);\n  --input:var(--border);\n  --pretui-control-rest:var(--field);\n  --pretui-control-border:oklch(.84 .015 290);\n  --pretui-control-hover:var(--hover);\n  --primary:var(--season-primary);\n  --primary-foreground:var(--season-primary-ink);\n  --pretui-primary-ink:var(--season-primary-text);\n  --secondary:var(--season-secondary);\n  --secondary-foreground:var(--season-secondary-ink);\n  --accent:var(--season-accent);\n  --accent-foreground:var(--season-accent-ink);\n  --pretui-selected:color-mix(in oklch,var(--season-primary) 12%,var(--card));\n  --ring:color-mix(in oklch,var(--season-primary) 70%,var(--foreground));\n  --destructive:var(--season-destructive);\n  --destructive-foreground:oklch(.985 .003 290);\n  --success:color-mix(in oklch,var(--season-success) 72%,var(--season-ink));\n  --warning:var(--season-warning);\n  --pretui-info:color-mix(in oklch,var(--season-info) 70%,var(--season-ink));\n  --pretui-attention:var(--season-attention);\n  --pretui-attention-ink:var(--season-attention-text);\n  --pretui-support:var(--season-accent);\n  --chart-1:var(--season-chart-1);\n  --chart-2:var(--season-chart-2);\n  --chart-3:var(--season-chart-3);\n  --chart-4:var(--season-chart-4);\n  --chart-5:var(--season-chart-5);\n  --tooltip:var(--season-ink);\n  --tooltip-foreground:oklch(.975 .007 290);\n  color-scheme:light;\n  --text-body:15px;\n  --leading-body:24px;\n  --text-ui-xs:11px;\n  --text-ui-sm:11.5px;\n  --text-ui:12px;\n  --text-ui-md:12.5px;\n  --text-heading:19px;\n  --leading-heading:26px;\n  --text-display:33px;\n  --text-stat:25px;\n  --weight-ui:500;\n  --weight-heading:700;\n  --spacing:4px;\n  --space-1:var(--spacing);\n  --space-2:calc(var(--spacing) * 1.5);\n  --space-3:calc(var(--spacing) * 2);\n  --space-4:calc(var(--spacing) * 2.75);\n  --space-5:calc(var(--spacing) * 3.5);\n  --space-6:calc(var(--spacing) * 4.75);\n  --space-7:calc(var(--spacing) * 6.25);\n  --space-8:calc(var(--spacing) * 8.5);\n  --space-9:calc(var(--spacing) * 11.25);\n  --space-10:calc(var(--spacing) * 15);\n  --row-h:32px;\n  --control-h:28px;\n  --space-within:var(--space-3);\n  --space-between:round(nearest, calc(var(--space-within) * var(--pretui-group-ratio, 1.78)), 1px);\n  --space-section:round(nearest, calc(var(--space-within) * var(--pretui-group-ratio, 1.78) * var(--pretui-group-ratio, 1.78)), 1px);\n  --space-between-enclosed:round(nearest, calc(var(--space-within) * var(--pretui-group-ratio, 1.78) / var(--pretui-enclosure-factor, 1.33)), 1px);\n  --pretui-gap-within:.55em;\n  --pretui-gap-between:calc(.55em * var(--pretui-group-ratio, 1.78));\n  --shadow-ink-soft:oklch(.20 .015 var(--season-cast-h) / var(--season-shadow-soft-a));\n  --shadow-ink-mid:oklch(.20 .015 var(--season-cast-h) / var(--season-shadow-mid-a));\n  --shadow-ink-strong:oklch(.18 .015 var(--season-cast-h) / var(--season-shadow-strong-a));\n  --pretui-shadow-hairline:0 0 0 1px var(--border);\n  --pretui-shadow-control:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft);\n  --pretui-shadow-card:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft),0 2px 6px var(--shadow-ink-soft);\n  --pretui-shadow-raised:0 0 0 1px var(--border),0 2px 10px var(--shadow-ink-mid);\n  --pretui-shadow-overlay:0 0 0 1px var(--border),0 8px 28px var(--shadow-ink-strong);\n  --pretui-shadow-inset:inset 0 1px 2px var(--shadow-ink-strong);\n  --pretui-edge-highlight:inset 0 1px 0 oklch(1 0 0 / .14);\n  --pretui-ease-enter:cubic-bezier(.23,1,.32,1);\n  --pretui-dur-enter:250ms;\n  --pretui-ease-snap:cubic-bezier(.2,.9,.25,1.05);\n  --pretui-dur-snap:180ms;\n  --pretui-ease-morph:cubic-bezier(.3,.7,.2,1.02);\n  --pretui-dur-morph:300ms;\n  --pretui-on-neutral:var(--background);\n  --pretui-on-info:oklch(.985 .003 290);\n  --pretui-on-success:oklch(.985 .003 290);\n  --pretui-on-warning:color-mix(in oklch,var(--season-ink) 85%,var(--season-warning));\n  --pretui-on-attention:oklch(.985 .003 290);\n  --pretui-overlay-scrim:color-mix(in oklch,var(--season-ink) 40%,transparent);\n}\n\n.dark {\n  --season-shadow-soft-a:.35;\n  --season-shadow-mid-a:.45;\n  --season-shadow-strong-a:.6;\n  color:var(--foreground);\n  --background:oklch(.175 .004 290);\n  --canvas:oklch(.205 .004 290);\n  --card:oklch(.24 .005 290);\n  --popover:oklch(.27 .005 290);\n  --inset:oklch(.215 .004 290);\n  --field:oklch(.265 .005 290);\n  --hover:oklch(.285 .005 290);\n  --hover-2:oklch(.315 .005 290);\n  --stripe:oklch(.255 .005 290);\n  --foreground:oklch(.965 .007 290);\n  --muted:oklch(.285 .005 290);\n  --muted-foreground:oklch(1 0 0 / .62);\n  --ink-3:oklch(1 0 0 / .38);\n  --border:oklch(.32 .006 290);\n  --line-strong:oklch(.38 .006 290);\n  --input:oklch(.34 .006 290);\n  --pretui-control-rest:oklch(.32 .005 290);\n  --pretui-control-border:oklch(.46 .006 290);\n  --pretui-control-hover:oklch(.37 .005 290);\n  --primary:var(--season-primary);\n  --primary-foreground:oklch(.2 .04 262);\n  --pretui-primary-ink:var(--season-primary);\n  --accent:var(--season-accent);\n  --accent-foreground:oklch(.2 .04 262);\n  --pretui-selected:color-mix(in oklch,var(--season-primary) 14%,var(--card));\n  --ring:var(--season-primary);\n  --destructive:var(--season-destructive);\n  --destructive-foreground:oklch(.985 .003 290);\n  --success:var(--season-success);\n  --warning:var(--season-warning);\n  --pretui-info:var(--season-info);\n  --pretui-attention:var(--season-attention-dark,var(--season-attention));\n  --pretui-attention-ink:var(--season-attention-dark,var(--season-attention));\n  --pretui-support:var(--season-accent);\n  --chart-1:var(--season-chart-1-dark,var(--season-chart-1));\n  --chart-2:var(--season-chart-2-dark,var(--season-chart-2));\n  --chart-3:var(--season-chart-3-dark,var(--season-chart-3));\n  --chart-4:var(--season-chart-4-dark,var(--season-chart-4));\n  --chart-5:var(--season-chart-5-dark,var(--season-chart-5));\n  --tooltip:oklch(.14 .004 290);\n  --tooltip-foreground:oklch(.965 .007 290);\n  color-scheme:dark;\n  --pretui-edge-highlight:inset 0 1px 0 oklch(1 0 0 / .08);\n  --shadow-ink-soft:oklch(.20 .015 var(--season-cast-h) / var(--season-shadow-soft-a));\n  --shadow-ink-mid:oklch(.20 .015 var(--season-cast-h) / var(--season-shadow-mid-a));\n  --shadow-ink-strong:oklch(.18 .015 var(--season-cast-h) / var(--season-shadow-strong-a));\n  --pretui-shadow-hairline:0 0 0 1px var(--border);\n  --pretui-shadow-control:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft);\n  --pretui-shadow-card:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft),0 2px 6px var(--shadow-ink-soft);\n  --pretui-shadow-raised:0 0 0 1px var(--border),0 2px 10px var(--shadow-ink-mid);\n  --pretui-shadow-overlay:0 0 0 1px var(--border),0 8px 28px var(--shadow-ink-strong);\n  --pretui-shadow-inset:inset 0 1px 2px var(--shadow-ink-strong);\n  --pretui-on-neutral:var(--background);\n  --pretui-on-info:var(--background);\n  --pretui-on-success:var(--background);\n  --pretui-on-warning:var(--background);\n  --pretui-on-attention:var(--background);\n  --pretui-overlay-scrim:rgb(0 0 0 / 0.55);\n}\n";
const AW26_CSS = ":root {\n  --season-primary:oklch(.888 .193 164);\n  --season-primary-ink:oklch(.248 .02 305);\n  --season-accent:oklch(.928 .223 124);\n  --season-accent-ink:oklch(.248 .02 305);\n  --season-secondary:oklch(.517 .257 277);\n  --season-secondary-ink:oklch(1 0 0);\n  --season-attention:oklch(.558 .288 308);\n  --season-attention-dark:oklch(.68 .24 308);\n  --season-destructive:oklch(.663 .196 24);\n  --season-success:oklch(.82 .19 150);\n  --season-warning:oklch(.74 .15 80);\n  --season-info:oklch(.845 .132 192);\n  --season-ink:oklch(.248 .02 305);\n  --season-primary-text:oklch(.47 .14 164);\n  --season-attention-text:oklch(.5 .24 308);\n  --season-chart-1:oklch(.72 .16 163);\n  --season-chart-2:oklch(.72 .16 235);\n  --season-chart-3:oklch(.72 .16 307);\n  --season-chart-4:oklch(.72 .16 19);\n  --season-chart-5:oklch(.72 .16 91);\n  --season-chart-6:oklch(.72 .16 55);\n  --season-chart-7:oklch(.72 .16 127);\n  --season-chart-8:oklch(.72 .16 271);\n  --season-chart-1-dark:oklch(.76 .16 163);\n  --season-chart-2-dark:oklch(.76 .16 235);\n  --season-chart-3-dark:oklch(.76 .16 307);\n  --season-chart-4-dark:oklch(.76 .16 19);\n  --season-chart-5-dark:oklch(.76 .16 91);\n  --season-chart-6-dark:oklch(.76 .16 55);\n  --season-chart-7-dark:oklch(.76 .16 127);\n  --season-chart-8-dark:oklch(.76 .16 271);\n  --season-cast-h:290;\n  --season-cast-c:.004;\n  --pretui-group-ratio:1.78;\n  --pretui-capsule-base:1.35;\n  --pretui-radius-encroach:.35;\n  --pretui-enclosure-factor:1.33;\n  --pretui-inset-exponent:.7;\n  --pretui-inset-k:.4;\n  --pretui-inset-min:11px;\n  --pretui-inset-max:25px;\n  --pretui-inset-slope:2.5;\n  --pretui-chip-mix:20%;\n  --pretui-ink-mix:34%;\n  --radius:10px;\n  --radius-surface:10px;\n  --radius-chip:6px;\n  --season-shadow-soft-a:.05;\n  --season-shadow-mid-a:.08;\n  --season-shadow-strong-a:.16;\n  --font-sans:'IBM Plex Sans','Helvetica Neue',Arial,system-ui,sans-serif;\n  --font-serif:'IBM Plex Serif',Georgia,serif;\n  --font-mono:'IBM Plex Mono',Menlo,ui-monospace,monospace;\n  --track-heading:-0.02em;\n  --track-ui:0.01em;\n  --track-eyebrow:.08em;\n  --type-ratio:1.333;\n  --background:oklch(.977 .007 290);\n  --canvas:oklch(.96 .008 290);\n  --card:oklch(1 0 0);\n  --card-foreground:var(--foreground);\n  --popover:oklch(1 0 0);\n  --popover-foreground:var(--foreground);\n  --inset:oklch(.968 .008 290);\n  --field:oklch(.995 .004 290);\n  --hover:oklch(.955 .01 290);\n  --hover-2:oklch(.935 .011 290);\n  --stripe:oklch(.984 .007 290);\n  --foreground:var(--season-ink);\n  --muted:oklch(.968 .008 290);\n  --muted-foreground:color-mix(in oklch,var(--season-ink) 62%,var(--card));\n  --ink-3:color-mix(in oklch,var(--season-ink) 40%,var(--card));\n  --border:oklch(.929 .011 290);\n  --line-strong:oklch(.875 .013 290);\n  --input:var(--border);\n  --pretui-control-rest:var(--field);\n  --pretui-control-border:oklch(.84 .015 290);\n  --pretui-control-hover:var(--hover);\n  --primary:var(--season-primary);\n  --primary-foreground:var(--season-primary-ink);\n  --pretui-primary-ink:var(--season-primary-text);\n  --secondary:var(--season-secondary);\n  --secondary-foreground:var(--season-secondary-ink);\n  --accent:var(--season-accent);\n  --accent-foreground:var(--season-accent-ink);\n  --pretui-selected:color-mix(in oklch,var(--season-primary) 12%,var(--card));\n  --ring:color-mix(in oklch,var(--season-primary) 70%,var(--foreground));\n  --destructive:var(--season-destructive);\n  --destructive-foreground:oklch(.985 .003 290);\n  --success:color-mix(in oklch,var(--season-success) 72%,var(--season-ink));\n  --warning:var(--season-warning);\n  --pretui-info:color-mix(in oklch,var(--season-info) 70%,var(--season-ink));\n  --pretui-attention:var(--season-attention);\n  --pretui-attention-ink:var(--season-attention-text);\n  --pretui-support:var(--season-accent);\n  --chart-1:var(--season-chart-1);\n  --chart-2:var(--season-chart-2);\n  --chart-3:var(--season-chart-3);\n  --chart-4:var(--season-chart-4);\n  --chart-5:var(--season-chart-5);\n  --chart-6:var(--season-chart-6);\n  --chart-7:var(--season-chart-7);\n  --chart-8:var(--season-chart-8);\n  --tooltip:var(--season-ink);\n  --season-primary-dark:oklch(.735 .105 235);\n  --season-primary-ink-dark:oklch(.18 .032 235);\n  --season-accent-dark:oklch(.720 .155 34);\n  --season-accent-ink-dark:oklch(.17 .030 34);\n  --season-secondary-dark:oklch(.660 .095 285);\n  --season-destructive-dark:oklch(.690 .165 30);\n  --season-success-dark:oklch(.720 .105 150);\n  --season-warning-dark:oklch(.800 .130 72);\n  --season-info-dark:oklch(.735 .085 230);\n  --tooltip-foreground:oklch(.975 .007 290);\n  color-scheme:light;\n  --text-body:15px;\n  --leading-body:24px;\n  --text-ui-xs:11px;\n  --text-ui-sm:11.5px;\n  --text-ui:12px;\n  --text-ui-md:12.5px;\n  --text-heading:19px;\n  --leading-heading:26px;\n  --text-display:33px;\n  --text-stat:25px;\n  --weight-ui:500;\n  --weight-heading:700;\n  --spacing:4px;\n  --space-1:var(--spacing);\n  --space-2:calc(var(--spacing) * 1.5);\n  --space-3:calc(var(--spacing) * 2);\n  --space-4:calc(var(--spacing) * 2.75);\n  --space-5:calc(var(--spacing) * 3.5);\n  --space-6:calc(var(--spacing) * 4.75);\n  --space-7:calc(var(--spacing) * 6.25);\n  --space-8:calc(var(--spacing) * 8.5);\n  --space-9:calc(var(--spacing) * 11.25);\n  --space-10:calc(var(--spacing) * 15);\n  --row-h:32px;\n  --control-h:28px;\n  --space-within:var(--space-3);\n  --space-between:round(nearest, calc(var(--space-within) * var(--pretui-group-ratio, 1.78)), 1px);\n  --space-section:round(nearest, calc(var(--space-within) * var(--pretui-group-ratio, 1.78) * var(--pretui-group-ratio, 1.78)), 1px);\n  --space-between-enclosed:round(nearest, calc(var(--space-within) * var(--pretui-group-ratio, 1.78) / var(--pretui-enclosure-factor, 1.33)), 1px);\n  --pretui-gap-within:.55em;\n  --pretui-gap-between:calc(.55em * var(--pretui-group-ratio, 1.78));\n  --shadow-ink-soft:oklch(.20 .015 var(--season-cast-h) / var(--season-shadow-soft-a));\n  --shadow-ink-mid:oklch(.20 .015 var(--season-cast-h) / var(--season-shadow-mid-a));\n  --shadow-ink-strong:oklch(.18 .015 var(--season-cast-h) / var(--season-shadow-strong-a));\n  --pretui-shadow-hairline:0 0 0 1px var(--border);\n  --pretui-shadow-control:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft);\n  --pretui-shadow-card:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft),0 2px 6px var(--shadow-ink-soft);\n  --pretui-shadow-raised:0 0 0 1px var(--border),0 2px 10px var(--shadow-ink-mid);\n  --pretui-shadow-overlay:0 0 0 1px var(--border),0 8px 28px var(--shadow-ink-strong);\n  --pretui-shadow-inset:inset 0 1px 2px var(--shadow-ink-strong);\n  --pretui-edge-highlight:inset 0 1px 0 oklch(1 0 0 / .14);\n  --pretui-ease-enter:cubic-bezier(.23,1,.32,1);\n  --pretui-dur-enter:250ms;\n  --pretui-ease-snap:cubic-bezier(.2,.9,.25,1.05);\n  --pretui-dur-snap:180ms;\n  --pretui-ease-morph:cubic-bezier(.3,.7,.2,1.02);\n  --pretui-dur-morph:300ms;\n  --pretui-on-neutral:var(--background);\n  --pretui-on-info:oklch(.985 .003 290);\n  --pretui-on-success:oklch(.985 .003 290);\n  --pretui-on-warning:color-mix(in oklch,var(--season-ink) 85%,var(--season-warning));\n  --pretui-on-attention:oklch(.985 .003 290);\n  --pretui-overlay-scrim:color-mix(in oklch,var(--season-ink) 40%,transparent);\n  /* AW26 The Poster Cut \u2014 season recompile (season2.css) */\n  --season-primary:oklch(.52 .09 235);\n  --season-primary-ink:oklch(.96 .015 95);\n  --season-accent:oklch(.62 .17 32);\n  --season-accent-ink:oklch(.96 .015 95);\n  --season-secondary:oklch(.45 .07 285);\n  --season-secondary-ink:oklch(.96 .015 95);\n  --season-attention:oklch(.74 .13 85);\n  --season-attention-dark:oklch(.78 .13 85);\n  --season-destructive:oklch(.58 .17 30);\n  --season-success:oklch(.55 .09 150);\n  --season-warning:oklch(.72 .12 70);\n  --season-info:oklch(.60 .08 230);\n  --season-ink:oklch(.28 .025 235);\n  --season-cast-h:100;\n  --season-cast-c:.007;\n  --season-primary-text:oklch(.44 .08 235);\n  --season-attention-text:oklch(.52 .11 85);\n  --season-chart-1:oklch(.55 .12 235);\n  --season-chart-2:oklch(.55 .12 307);\n  --season-chart-3:oklch(.55 .12 19);\n  --season-chart-4:oklch(.55 .12 91);\n  --season-chart-5:oklch(.55 .12 163);\n  --season-chart-6:oklch(.55 .12 55);\n  --season-chart-7:oklch(.55 .12 127);\n  --season-chart-8:oklch(.55 .12 271);\n  --season-chart-1-dark:oklch(.70 .12 235);\n  --season-chart-2-dark:oklch(.70 .12 307);\n  --season-chart-3-dark:oklch(.70 .12 19);\n  --season-chart-4-dark:oklch(.70 .12 91);\n  --season-chart-5-dark:oklch(.70 .12 163);\n  --season-chart-6-dark:oklch(.70 .12 55);\n  --season-chart-7-dark:oklch(.70 .12 127);\n  --season-chart-8-dark:oklch(.70 .12 271);\n  --pretui-chip-mix:24%;\n  --pretui-ink-mix:40%;\n  --radius:4px;\n  --radius-surface:8px;\n  --radius-chip:3px;\n  --season-shadow-soft-a:.04;\n  --season-shadow-mid-a:.06;\n  --season-shadow-strong-a:.12;\n  --font-serif:'IBM Plex Sans','Helvetica Neue',sans-serif;\n  --background:oklch(.885 .009 100);\n  --canvas:oklch(.862 .01 100);\n  --card:oklch(.962 .012 95);\n  --popover:oklch(.968 .012 95);\n  --inset:oklch(.845 .012 100);\n  --field:oklch(.942 .012 95);\n  --hover:oklch(.92 .013 95);\n  --hover-2:oklch(.895 .013 98);\n  --stripe:oklch(.945 .012 95);\n  --border:oklch(.795 .016 100);\n  --line-strong:oklch(.71 .02 100);\n  --input:var(--border);\n  --pretui-control-rest:var(--field);\n  --pretui-control-border:oklch(.68 .022 100);\n  --pretui-control-hover:var(--hover);\n  --tooltip:var(--season-ink);\n}\n\n.dark {\n  --season-shadow-soft-a:.35;\n  --season-shadow-mid-a:.45;\n  --season-shadow-strong-a:.6;\n  color:var(--foreground);\n  --background:oklch(.232 .021 82);\n  --canvas:oklch(.262 .022 82);\n  --card:oklch(.294 .023 82);\n  --popover:oklch(.324 .024 82);\n  --inset:oklch(.250 .020 82);\n  --field:oklch(.314 .023 82);\n  --hover:oklch(.344 .024 82);\n  --hover-2:oklch(.376 .025 82);\n  --stripe:oklch(.307 .023 82);\n  --foreground:oklch(.944 .017 88);\n  --muted:oklch(.344 .024 82);\n  --muted-foreground:oklch(.784 .027 85);\n  --ink-3:oklch(.606 .025 85);\n  --border:oklch(.402 .026 82);\n  --line-strong:oklch(.480 .029 82);\n  --input:oklch(.432 .027 82);\n  --pretui-control-rest:oklch(.322 .023 82);\n  --pretui-control-border:oklch(.520 .030 82);\n  --pretui-control-hover:oklch(.366 .025 82);\n  --primary:var(--season-primary-dark,var(--season-primary));\n  --primary-foreground:var(--season-primary-ink-dark);\n  --pretui-primary-ink:var(--season-primary-dark,var(--season-primary));\n  --accent:var(--season-accent-dark,var(--season-accent));\n  --accent-foreground:var(--season-accent-ink-dark);\n  --pretui-selected:color-mix(in oklch,var(--season-primary-dark) 16%,var(--card));\n  --ring:var(--season-primary-dark,var(--season-primary));\n  --destructive:var(--season-destructive-dark,var(--season-destructive));\n  --destructive-foreground:oklch(.16 .03 30);\n  --success:var(--season-success-dark,var(--season-success));\n  --warning:var(--season-warning-dark,var(--season-warning));\n  --pretui-info:var(--season-info-dark,var(--season-info));\n  --pretui-attention:var(--season-attention-dark,var(--season-attention));\n  --pretui-attention-ink:var(--season-attention-dark,var(--season-attention));\n  --pretui-support:var(--season-accent);\n  --chart-1:var(--season-chart-1-dark,var(--season-chart-1));\n  --chart-2:var(--season-chart-2-dark,var(--season-chart-2));\n  --chart-3:var(--season-chart-3-dark,var(--season-chart-3));\n  --chart-4:var(--season-chart-4-dark,var(--season-chart-4));\n  --chart-5:var(--season-chart-5-dark,var(--season-chart-5));\n  --chart-6:var(--season-chart-6-dark,var(--season-chart-6));\n  --chart-7:var(--season-chart-7-dark,var(--season-chart-7));\n  --chart-8:var(--season-chart-8-dark,var(--season-chart-8));\n  --tooltip:oklch(.180 .018 82);\n  --tooltip-foreground:oklch(.944 .017 88);\n  color-scheme:dark;\n  --pretui-edge-highlight:inset 0 1px 0 oklch(1 0 0 / .08);\n  --shadow-ink-soft:oklch(.20 .015 var(--season-cast-h) / var(--season-shadow-soft-a));\n  --shadow-ink-mid:oklch(.20 .015 var(--season-cast-h) / var(--season-shadow-mid-a));\n  --shadow-ink-strong:oklch(.18 .015 var(--season-cast-h) / var(--season-shadow-strong-a));\n  --pretui-shadow-hairline:0 0 0 1px var(--border);\n  --pretui-shadow-control:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft);\n  --pretui-shadow-card:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft),0 2px 6px var(--shadow-ink-soft);\n  --pretui-shadow-raised:0 0 0 1px var(--border),0 2px 10px var(--shadow-ink-mid);\n  --pretui-shadow-overlay:0 0 0 1px var(--border),0 8px 28px var(--shadow-ink-strong);\n  --pretui-shadow-inset:inset 0 1px 2px var(--shadow-ink-strong);\n  --pretui-on-neutral:var(--background);\n  --pretui-on-info:var(--background);\n  --pretui-on-success:var(--background);\n  --pretui-on-warning:var(--background);\n  --pretui-on-attention:var(--background);\n  --pretui-overlay-scrim:rgb(26 20 8 / 0.66);\n  --season-shadow-soft-a:.35;\n  --season-shadow-mid-a:.45;\n  --season-shadow-strong-a:.6;\n  --season-cast-h:82;\n  --secondary:var(--season-secondary-dark,var(--season-secondary));\n  --secondary-foreground:oklch(.17 .025 285);\n}\n";
const SS27_CSS = ":root {\n  /* SS27 The Night Shift \u2014 season knobs (the only layer a season owns) */\n  --season-primary:oklch(.5 .098 168);\n  --season-primary-dark:oklch(.82 .185 152);\n  --season-primary-ink:oklch(.985 .004 150);\n  --season-primary-ink-dark:oklch(.17 .03 155);\n  --season-accent:oklch(.56 .195 258);\n  --season-accent-dark:oklch(.74 .125 250);\n  --season-accent-ink:oklch(.99 .002 250);\n  --season-accent-ink-dark:oklch(.16 .03 250);\n  --season-secondary:oklch(.4 .03 262);\n  --season-secondary-dark:oklch(.6 .035 158);\n  --season-secondary-ink:oklch(.99 .002 250);\n  --season-attention:oklch(.58 .22 330);\n  --season-attention-dark:oklch(.76 .16 330);\n  --season-destructive:oklch(.576 .209 29);\n  --season-destructive-dark:oklch(.685 .18 28);\n  --season-destructive-ink-dark:oklch(.16 .03 30);\n  --season-success:oklch(.58 .12 158);\n  --season-success-dark:oklch(.78 .16 155);\n  --season-warning:oklch(.74 .145 72);\n  --season-warning-dark:oklch(.8 .155 80);\n  --season-info:oklch(.56 .13 248);\n  --season-info-dark:oklch(.74 .115 240);\n  --season-ink:oklch(.245 .022 265);\n  --season-primary-text:oklch(.455 .088 168);\n  --season-attention-text:oklch(.5 .2 330);\n  --season-chart-1:oklch(.55 .105 155);\n  --season-chart-2:oklch(.55 .105 250);\n  --season-chart-3:oklch(.55 .105 330);\n  --season-chart-4:oklch(.55 .105 29);\n  --season-chart-5:oklch(.55 .105 75);\n  --season-chart-6:oklch(.55 .105 110);\n  --season-chart-7:oklch(.55 .105 200);\n  --season-chart-8:oklch(.55 .105 290);\n  --season-chart-1-dark:oklch(.76 .115 155);\n  --season-chart-2-dark:oklch(.76 .115 250);\n  --season-chart-3-dark:oklch(.76 .115 330);\n  --season-chart-4-dark:oklch(.76 .115 29);\n  --season-chart-5-dark:oklch(.76 .115 75);\n  --season-chart-6-dark:oklch(.76 .115 110);\n  --season-chart-7-dark:oklch(.76 .115 200);\n  --season-chart-8-dark:oklch(.76 .115 290);\n  --season-cast-h:264;\n  --season-cast-c:.006;\n  /* geometry constants \u2014 shared craft, identical in every season */\n  --pretui-group-ratio:1.78;\n  --pretui-capsule-base:1.35;\n  --pretui-radius-encroach:.35;\n  --pretui-enclosure-factor:1.33;\n  --pretui-inset-exponent:.7;\n  --pretui-inset-k:.4;\n  --pretui-inset-min:11px;\n  --pretui-inset-max:25px;\n  --pretui-inset-slope:2.5;\n  --pretui-chip-mix:18%;\n  --pretui-ink-mix:34%;\n  --radius:3px;\n  --radius-surface:6px;\n  --radius-chip:2px;\n  --season-shadow-soft-a:.04;\n  --season-shadow-mid-a:.07;\n  --season-shadow-strong-a:.14;\n  --font-sans:'Space Grotesk','IBM Plex Sans',system-ui,sans-serif;\n  --font-serif:'Zilla Slab','IBM Plex Serif',Georgia,serif;\n  --font-mono:'JetBrains Mono','IBM Plex Mono',ui-monospace,monospace;\n  --track-heading:-0.02em;\n  --track-ui:0.01em;\n  --track-eyebrow:.08em;\n  --type-ratio:1.333;\n  --background:oklch(.958 .006 244);\n  --canvas:oklch(.935 .008 244);\n  --card:oklch(1 0 0);\n  --card-foreground:var(--foreground);\n  --popover:oklch(1 0 0);\n  --popover-foreground:var(--foreground);\n  --inset:oklch(.944 .007 244);\n  --field:oklch(.993 .003 264);\n  --hover:oklch(.928 .009 244);\n  --hover-2:oklch(.902 .011 244);\n  --stripe:oklch(.966 .005 244);\n  --foreground:var(--season-ink);\n  --muted:oklch(.963 .005 264);\n  --muted-foreground:color-mix(in oklch,var(--season-ink) 66%,var(--card));\n  --ink-3:color-mix(in oklch,var(--season-ink) 48%,var(--card));\n  --border:oklch(.902 .013 248);\n  --line-strong:oklch(.845 .017 248);\n  --input:var(--border);\n  --pretui-control-rest:var(--field);\n  --pretui-control-border:oklch(.83 .018 260);\n  --pretui-control-hover:var(--hover);\n  --primary:var(--season-primary);\n  --primary-foreground:var(--season-primary-ink);\n  --pretui-primary-ink:var(--season-primary-text);\n  --secondary:var(--season-secondary);\n  --secondary-foreground:var(--season-secondary-ink);\n  --accent:var(--season-accent);\n  --accent-foreground:var(--season-accent-ink);\n  --pretui-selected:color-mix(in oklch,var(--season-primary) 12%,var(--card));\n  --ring:color-mix(in oklch,var(--season-primary) 70%,var(--foreground));\n  --destructive:var(--season-destructive);\n  --destructive-foreground:oklch(.99 .002 250);\n  --success:color-mix(in oklch,var(--season-success) 72%,var(--season-ink));\n  --warning:var(--season-warning);\n  --pretui-info:color-mix(in oklch,var(--season-info) 70%,var(--season-ink));\n  --pretui-attention:var(--season-attention);\n  --pretui-attention-ink:var(--season-attention-text);\n  --pretui-support:var(--season-accent);\n  --chart-1:var(--season-chart-1);\n  --chart-2:var(--season-chart-2);\n  --chart-3:var(--season-chart-3);\n  --chart-4:var(--season-chart-4);\n  --chart-5:var(--season-chart-5);\n  --chart-6:var(--season-chart-6);\n  --chart-7:var(--season-chart-7);\n  --chart-8:var(--season-chart-8);\n  --tooltip:var(--season-ink);\n  --tooltip-foreground:oklch(.975 .004 264);\n  --boxel-color-scheme:light;\n  color-scheme:light;\n  --text-body:15px;\n  --leading-body:24px;\n  --text-ui-xs:11px;\n  --text-ui-sm:11.5px;\n  --text-ui:12px;\n  --text-ui-md:12.5px;\n  --text-heading:19px;\n  --leading-heading:26px;\n  --text-display:33px;\n  --text-stat:25px;\n  --weight-ui:500;\n  --weight-heading:700;\n  --spacing:4px;\n  --space-1:var(--spacing);\n  --space-2:calc(var(--spacing) * 1.5);\n  --space-3:calc(var(--spacing) * 2);\n  --space-4:calc(var(--spacing) * 2.75);\n  --space-5:calc(var(--spacing) * 3.5);\n  --space-6:calc(var(--spacing) * 4.75);\n  --space-7:calc(var(--spacing) * 6.25);\n  --space-8:calc(var(--spacing) * 8.5);\n  --space-9:calc(var(--spacing) * 11.25);\n  --space-10:calc(var(--spacing) * 15);\n  --row-h:32px;\n  --control-h:28px;\n  --space-within:var(--space-3);\n  --space-between:round(nearest, calc(var(--space-within) * var(--pretui-group-ratio, 1.78)), 1px);\n  --space-section:round(nearest, calc(var(--space-within) * var(--pretui-group-ratio, 1.78) * var(--pretui-group-ratio, 1.78)), 1px);\n  --space-between-enclosed:round(nearest, calc(var(--space-within) * var(--pretui-group-ratio, 1.78) / var(--pretui-enclosure-factor, 1.33)), 1px);\n  --pretui-gap-within:.55em;\n  --pretui-gap-between:calc(.55em * var(--pretui-group-ratio, 1.78));\n  --shadow-ink-soft:oklch(.20 .015 var(--season-cast-h) / var(--season-shadow-soft-a));\n  --shadow-ink-mid:oklch(.20 .015 var(--season-cast-h) / var(--season-shadow-mid-a));\n  --shadow-ink-strong:oklch(.18 .015 var(--season-cast-h) / var(--season-shadow-strong-a));\n  --pretui-shadow-hairline:0 0 0 1px var(--border);\n  --pretui-shadow-control:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft);\n  --pretui-shadow-card:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft),0 2px 6px var(--shadow-ink-soft);\n  --pretui-shadow-raised:0 0 0 1px var(--border),0 2px 10px var(--shadow-ink-mid);\n  --pretui-shadow-overlay:0 0 0 1px var(--border),0 8px 28px var(--shadow-ink-strong);\n  --pretui-shadow-inset:inset 0 1px 2px var(--shadow-ink-strong);\n  --pretui-edge-highlight:inset 0 1px 0 oklch(1 0 0 / .10);\n  --pretui-ease-enter:cubic-bezier(.2,.8,.3,1);\n  --pretui-dur-enter:190ms;\n  --pretui-ease-snap:cubic-bezier(.3,.85,.3,1);\n  --pretui-dur-snap:130ms;\n  --pretui-ease-morph:cubic-bezier(.35,.75,.25,1);\n  --pretui-dur-morph:230ms;\n  --pretui-on-neutral:var(--background);\n  --pretui-on-info:oklch(.99 .002 250);\n  --pretui-on-success:oklch(.99 .002 250);\n  --pretui-on-warning:color-mix(in oklch,var(--season-ink) 85%,var(--season-warning));\n  --pretui-on-attention:oklch(.99 .002 250);\n  --pretui-overlay-scrim:color-mix(in oklch,var(--season-ink) 46%,transparent);\n  --pretui-canvas-dot:color-mix(in oklch,var(--season-ink) 15%,transparent);\n}\n\n.dark {\n  --season-shadow-soft-a:.5;\n  --season-shadow-mid-a:.62;\n  --season-shadow-strong-a:.78;\n  --season-cast-h:150;\n  color:var(--foreground);\n  --background:oklch(.148 .012 150);\n  --canvas:oklch(.175 .012 150);\n  --card:oklch(.198 .013 150);\n  --popover:oklch(.228 .014 150);\n  --inset:oklch(.163 .011 150);\n  --field:oklch(.218 .013 150);\n  --hover:oklch(.245 .014 150);\n  --hover-2:oklch(.278 .015 150);\n  --stripe:oklch(.212 .013 150);\n  --foreground:oklch(.922 .052 150);\n  --muted:oklch(.245 .014 150);\n  --muted-foreground:oklch(.735 .045 150);\n  --ink-3:oklch(.565 .035 150);\n  --border:oklch(.335 .018 150);\n  --line-strong:oklch(.42 .022 150);\n  --input:oklch(.36 .019 150);\n  --pretui-control-rest:oklch(.245 .014 150);\n  --pretui-control-border:oklch(.47 .024 150);\n  --pretui-control-hover:oklch(.29 .016 150);\n  --primary:var(--season-primary-dark,var(--season-primary));\n  --primary-foreground:var(--season-primary-ink-dark);\n  --pretui-primary-ink:var(--season-primary-dark,var(--season-primary));\n  --secondary:var(--season-secondary-dark,var(--season-secondary));\n  --secondary-foreground:oklch(.15 .02 155);\n  --accent:var(--season-accent-dark,var(--season-accent));\n  --accent-foreground:var(--season-accent-ink-dark);\n  --pretui-selected:color-mix(in oklch,var(--season-primary-dark) 16%,var(--card));\n  --ring:var(--season-primary-dark,var(--season-primary));\n  --destructive:var(--season-destructive-dark,var(--season-destructive));\n  --destructive-foreground:var(--season-destructive-ink-dark);\n  --success:var(--season-success-dark,var(--season-success));\n  --warning:var(--season-warning-dark,var(--season-warning));\n  --pretui-info:var(--season-info-dark,var(--season-info));\n  --pretui-attention:var(--season-attention-dark,var(--season-attention));\n  --pretui-attention-ink:var(--season-attention-dark,var(--season-attention));\n  --pretui-support:var(--season-accent-dark,var(--season-accent));\n  --chart-1:var(--season-chart-1-dark,var(--season-chart-1));\n  --chart-2:var(--season-chart-2-dark,var(--season-chart-2));\n  --chart-3:var(--season-chart-3-dark,var(--season-chart-3));\n  --chart-4:var(--season-chart-4-dark,var(--season-chart-4));\n  --chart-5:var(--season-chart-5-dark,var(--season-chart-5));\n  --chart-6:var(--season-chart-6-dark,var(--season-chart-6));\n  --chart-7:var(--season-chart-7-dark,var(--season-chart-7));\n  --chart-8:var(--season-chart-8-dark,var(--season-chart-8));\n  --tooltip:oklch(.105 .01 150);\n  --tooltip-foreground:oklch(.94 .05 150);\n  --boxel-color-scheme:dark;\n  color-scheme:dark;\n  --pretui-chip-mix:24%;\n  --pretui-ink-mix:40%;\n  --pretui-edge-highlight:inset 0 1px 0 oklch(1 0 0 / .05);\n  --shadow-ink-soft:oklch(.08 .012 var(--season-cast-h) / var(--season-shadow-soft-a));\n  --shadow-ink-mid:oklch(.06 .012 var(--season-cast-h) / var(--season-shadow-mid-a));\n  --shadow-ink-strong:oklch(.04 .012 var(--season-cast-h) / var(--season-shadow-strong-a));\n  --pretui-shadow-hairline:0 0 0 1px var(--border);\n  --pretui-shadow-control:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft);\n  --pretui-shadow-card:0 0 0 1px var(--border),0 1px 2px var(--shadow-ink-soft),0 2px 6px var(--shadow-ink-soft);\n  --pretui-shadow-raised:0 0 0 1px var(--border),0 2px 10px var(--shadow-ink-mid);\n  --pretui-shadow-overlay:0 0 0 1px var(--border),0 8px 28px var(--shadow-ink-strong);\n  --pretui-shadow-inset:inset 0 1px 2px var(--shadow-ink-strong);\n  --pretui-on-neutral:var(--background);\n  --pretui-on-info:var(--background);\n  --pretui-on-success:var(--background);\n  --pretui-on-warning:var(--background);\n  --pretui-on-attention:var(--background);\n  --pretui-overlay-scrim:rgb(0 0 0 / 0.72);\n  --pretui-canvas-dot:color-mix(in oklch,var(--season-primary-dark) 16%,transparent);\n}\n";

const SEASONS = [
  { id: 'https://test.example/theme/ss26', cardTitle: 'SS26', cssVariables: SS26_CSS },
  { id: 'https://test.example/theme/aw26', cardTitle: 'AW26', cssVariables: AW26_CSS },
  { id: 'https://test.example/theme/ss27', cardTitle: 'SS27', cssVariables: SS27_CSS },
];

function readVar(name: string): string {
  let probe = document.querySelector('[data-test-probe]') as HTMLElement;
  return getComputedStyle(probe).getPropertyValue(name).trim();
}
// Chrome hands back the authored colour space, so a theme value comes out as
// `oklch(L C H)` and a browser-computed one as `rgb(...)`. Both reduce to a
// 0..1 perceptual lightness for the ground assertions below.
function lum(color: string): number {
  let m = color.match(/[\d.]+/g);
  if (!m) {
    throw new Error('unparseable colour ' + color);
  }
  if (color.startsWith('oklch')) {
    return Number(m[0]);
  }
  let [r, g, b] = m.slice(0, 3).map((v) => Number(v) / 255);
  let f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  let y = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return y ** (1 / 3);
}
function probeBg(): string {
  let probe = document.querySelector('[data-test-probe]') as HTMLElement;
  return getComputedStyle(probe).backgroundColor;
}

module('Pretui | ThemeFrame · seasons', function (hooks) {
  setupCardTest(hooks);

  test('SS27 The Night Shift resolves a real light AND a real dark set', async function (assert) {
    const SS27 = SEASONS[2];
    await render(<template>
      <ThemeFrame @theme={{SS27}}>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--background)'>probe</div>
      </ThemeFrame>
    </template>);

    await clickMode('Light');
    let lightBg = probeBg();
    let lightPrimary = readVar('--primary');
    let lightFg = readVar('--foreground');
    assert.ok(lum(lightBg) > 0.9, `light --background is paper (${lightBg})`);

    await clickMode('Dark');
    let darkBg = probeBg();
    let darkPrimary = readVar('--primary');
    let darkFg = readVar('--foreground');
    assert.ok(
      lum(darkBg) < 0.25,
      `dark --background is a near-black terminal ground (${darkBg})`,
    );
    assert.notStrictEqual(
      darkPrimary,
      lightPrimary,
      'the dark block swaps --primary to the phosphor variant',
    );
    assert.notStrictEqual(
      darkFg,
      lightFg,
      'the dark block swaps --foreground to the phosphor ink',
    );
    assert.ok(
      lum(darkBg) < lum(lightBg),
      'dark ground is darker than the light ground — the .dark block applied',
    );
  });

  test('every shipped season defines the same token set', async function (assert) {
    // Guards the "a missing token silently falls back to a component literal"
    // failure mode: compare the *resolved* names, not the source text.
    let names = SEASONS.map((s) => {
      let root = s.cssVariables.slice(
        s.cssVariables.indexOf('{') + 1,
        s.cssVariables.indexOf('}'),
      );
      return new Set(
        [...root.matchAll(/(--[a-z\d-]+)\s*:/g)].map((m) => m[1]),
      );
    });
    let ss26 = names[0];
    let ss27 = names[2];
    let missing = [...ss26].filter((n) => !ss27.has(n));
    assert.deepEqual(missing, [], 'SS27 defines every token SS26 defines');
    let missingAw = [...names[1]].filter((n) => !ss27.has(n));
    assert.deepEqual(missingAw, [], 'SS27 defines every token AW26 defines');
  });

  test('switching season re-tints — three seasons, three grounds', async function (assert) {
    let seen: string[] = [];
    for (let season of SEASONS) {
      await render(<template>
        <ThemeFrame @theme={{season}}>
          {{! template-lint-disable no-inline-styles }}
          <div data-test-probe style='background: var(--primary)'>probe</div>
        </ThemeFrame>
      </template>);
      await clickMode('Light');
      seen.push(probeBg());
    }
    assert.strictEqual(
      new Set(seen).size,
      3,
      `each season paints a different --primary (${seen.join(' / ')})`,
    );
  });
});

// ── Season SELECTOR proof ────────────────────────────────────────────────
// Regression guard for a defect that hid for the selector's whole life: the
// frame queried themes on `base/theme`/`default`, a re-export alias the realm
// search API does not resolve. A filter naming a ref nothing adopts matches
// ZERO cards rather than erroring, so `showThemeSelect` was permanently false
// and this entire branch had never rendered once. Fixing the ref turned the
// branch on for every page in the gallery at the same instant — so it needs a
// render proof of its own, not just a query fix.
const T_SS26 = SEASONS[0];
const T_AW26 = SEASONS[1];
const T_SS27 = SEASONS[2];
const STUB_CONTEXT = {
  getCards: () => ({ instances: SEASONS }),
};

module('Pretui | ThemeFrame · season selector', function (hooks) {
  setupCardTest(hooks);

  test('a populated theme query renders the selector instead of a static name', async function (assert) {
    await render(<template>
      <ThemeFrame @theme={{T_SS26}} @context={{STUB_CONTEXT}}>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--primary)'>probe</div>
      </ThemeFrame>
    </template>);

    assert.ok(
      document.querySelector('[data-test-pretui-theme-bar]'),
      'the theme bar rendered — the selector branch does not throw',
    );
    assert.dom('.pretui-theme-name').doesNotExist(
      'with 3 themes found the static name is replaced by the picker',
    );
    assert.ok(
      document.querySelector('.pretui-theme-pick'),
      'the season picker is present',
    );
  });

  test('theme labels read cardTitle, not title', async function (assert) {
    // CardDef exposes no `title`; reading it yielded undefined and every
    // option rendered "Untitled theme".
    await render(<template>
      <ThemeFrame @theme={{T_SS27}} @context={{STUB_CONTEXT}}>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--primary)'>probe</div>
      </ThemeFrame>
    </template>);
    let bar = document.querySelector('[data-test-pretui-theme-bar]') as HTMLElement;
    assert.notOk(
      /Untitled theme/.test(bar.textContent ?? ''),
      'no option falls back to the placeholder label',
    );
    assert.ok(
      /SS27/.test(bar.textContent ?? ''),
      `the active season names itself (${bar.textContent?.trim()})`,
    );
  });

  test('no context degrades to the linked theme only — no selector, no throw', async function (assert) {
    await render(<template>
      <ThemeFrame @theme={{T_AW26}}>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--primary)'>probe</div>
      </ThemeFrame>
    </template>);
    assert.dom('.pretui-theme-name').hasText(
      'AW26',
      'prerender/test contexts still name the linked theme',
    );
  });
});
