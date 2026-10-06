// Pretui — PageScaffold usage page.
import Component from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Chip } from './chip';
import { Token } from './token';
import { statusHue } from '../internal/ink';
import { PageScaffold } from './page-scaffold';
import type { PageScaffoldPreset } from './page-scaffold';

// ── PageScaffold ─────────────────────────────────────────────────────────
// Broken out so both frame shapes below can share it without the demo
// turning into two copies of the same markup.
const ScaffoldMasthead: TemplateOnlyComponent = <template>
  <div class='ps-demo-masthead'>
    <span class='ps-demo-brand'>Leaf &amp; Ledger</span>
    <span class='ps-demo-account'>Mei-Lin Chua</span>
  </div>
  <style scoped>
    .ps-demo-masthead {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-4, 11px);
    }
    .ps-demo-brand {
      font-size: var(--text-ui-lg, 14px);
      font-weight: 650;
      letter-spacing: var(--track-heading, -0.01em);
      color: var(--foreground);
    }
    .ps-demo-account {
      font-size: var(--text-ui-sm, 11.5px);
      color: var(--muted-foreground);
    }
  </style>
</template>;

const ScaffoldSubhead: TemplateOnlyComponent = <template>
  <div class='ps-demo-subhead'>
    <span>Lots</span>
    <span aria-hidden='true'>/</span>
    <span>Spring 2026</span>
    <span aria-hidden='true'>/</span>
    <Token @value='LOT-1181' />
  </div>
  <style scoped>
    .ps-demo-subhead {
      display: flex;
      align-items: center;
      gap: var(--space-2, 5px);
      font-size: var(--text-ui-sm, 11.5px);
      color: var(--muted-foreground);
    }
  </style>
</template>;

class ScaffoldNav extends Component {
  navItems = ['Lots', 'Suppliers', 'Shipments', 'Cupping notes', 'Invoices'];
  <template>
    <ul class='ps-demo-nav'>
      {{#each this.navItems key='@identity' as |item|}}
        <li>{{item}}</li>
      {{/each}}
    </ul>
    <style scoped>
      .ps-demo-nav {
        display: grid;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
      .ps-demo-nav li {
        padding: var(--space-2, 5px) var(--space-3, 8px);
        border-radius: var(--radius-chip, 6px);
      }
      .ps-demo-nav li:first-child {
        background: var(--muted);
        color: var(--foreground);
        font-weight: 600;
      }
    </style>
  </template>
}

const ScaffoldMain: TemplateOnlyComponent = <template>
  <h2 class='ps-demo-h'>Da Hong Pao, spring pick</h2>
  <p class='ps-demo-p'>Ninety-six kilograms out of Wuyishan, curing since the
    fourteenth. Wuyi Origins holds the contract and has asked for the cupping
    notes before the Rotterdam booking closes.</p>
  <p class='ps-demo-p'>The humidity log for the curing room is attached to the
    lot rather than the shipment, which is why it is missing from the customs
    packet.</p>
  <style scoped>
    .ps-demo-h {
      margin: 0 0 var(--space-3, 8px);
      font-size: var(--text-ui-lg, 14px);
      letter-spacing: var(--track-heading, -0.01em);
      color: var(--foreground);
    }
    .ps-demo-p {
      margin: 0 0 var(--space-3, 8px);
      max-width: 60ch;
      line-height: 1.55;
      color: var(--muted-foreground);
    }
  </style>
</template>;

class ScaffoldAside extends Component {
  curingHue = statusHue('curing');
  <template>
    <dl class='ps-demo-meta'>
      <dt>Supplier</dt>
      <dd>Wuyi Origins</dd>
      <dt>Status</dt>
      <dd><Chip @label='curing' @hue={{this.curingHue}} /></dd>
      <dt>Booked</dt>
      <dd>2026-03-14</dd>
    </dl>
    <style scoped>
      .ps-demo-meta {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--space-2, 5px) var(--space-3, 8px);
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
      }
      .ps-demo-meta dt {
        color: var(--muted-foreground);
      }
      .ps-demo-meta dd {
        margin: 0;
        color: var(--foreground);
      }
    </style>
  </template>
}

const ScaffoldFooter: TemplateOnlyComponent = <template>
  <p class='ps-demo-foot'>Ledger closes 2026-09-30 · Kericho, Uji, Wuyishan</p>
  <style scoped>
    .ps-demo-foot {
      margin: 0;
      font-size: var(--text-ui-xs, 11px);
      color: var(--muted-foreground);
    }
  </style>
</template>;

// Ported from @cardstack/boxel-layout's `Layout`, with Web Awesome's
// wa-page as the visual reference for the region set. Knobs follow
// wa-page's own surface (navigation width, aside width, sticky header,
// skip link) minus the ones that do not survive the port: wa-page's
// `slot="..."` string plumbing and `[navigation-placement]` /
// `[banner-placement]` attributes are gone, because here the shape is
// DERIVED from which named blocks you pass; its mobile drawer + hamburger
// is gone too — that is a component, not a frame, and belongs to Drawer.
class PageScaffoldUsage extends Component {
  presetOptions = ['bare', 'page', 'notebook', 'tools'];

  @tracked preset = 'page';
  @tracked label = 'Lot detail';
  @tracked navLabel = 'Section navigation';
  @tracked asideLabel = 'Lot metadata';
  @tracked navWidth = '12rem';
  @tracked asideWidth = '14rem';
  @tracked maxWidth = '';
  @tracked stickyMasthead = false;
  @tracked divided = false;
  @tracked skipLink = true;
  @tracked fullFrame = true;

  setPreset = (v: string) => (this.preset = v);
  setLabel = (v: string) => (this.label = v);
  setNavLabel = (v: string) => (this.navLabel = v);
  setAsideLabel = (v: string) => (this.asideLabel = v);
  setNavWidth = (v: string) => (this.navWidth = v);
  setAsideWidth = (v: string) => (this.asideWidth = v);
  setMaxWidth = (v: string) => (this.maxWidth = v);
  setStickyMasthead = (v: boolean) => (this.stickyMasthead = v);
  setDivided = (v: boolean) => (this.divided = v);
  setSkipLink = (v: boolean) => (this.skipLink = v);
  setFullFrame = (v: boolean) => (this.fullFrame = v);

  get presetVal() {
    return this.preset as PageScaffoldPreset;
  }
  get maxWidthVal() {
    return this.maxWidth || undefined;
  }

  get usage() {
    let bits = [`@preset='${this.preset}'`, `@label='${this.label}'`];
    if (this.stickyMasthead) bits.push('@stickyMasthead={{true}}');
    if (this.divided) bits.push('@divided={{true}}');
    if (!this.skipLink) bits.push('@skipLink={{false}}');
    let blocks = this.fullFrame
      ? '  <:masthead>…</:masthead>\n  <:subhead>…</:subhead>\n  <:navigation>…</:navigation>\n  <:default>…</:default>\n  <:aside>…</:aside>\n  <:footer>…</:footer>'
      : '  <:masthead>…</:masthead>\n  <:default>…</:default>';
    return `<PageScaffold ${bits.join(' ')}>\n${blocks}\n</PageScaffold>`;
  }

  <template>
    <FreestyleUsage
      @name='PageScaffold'
      @description="An application frame with real landmark regions — masthead, subhead, navigation, main, aside, footer — over the boxel-layout presets that supply the reading rhythm. Reach for it as the outermost shell of an isolated card or a tool. Three things it does that its two ancestors do not: the column shape is DERIVED with :has() from the blocks you actually pass, so there is no layout prop to hold wrong; it folds to a single column on an unnamed CONTAINER query, so it responds to the pane it is in rather than the browser window; and it ships a skip link that genuinely moves focus (the <main> takes tabindex=-1), which neither boxel-layout nor wa-page includes. Every hard-coded light hex in the presets (#f8fafc, #e2e8f0, #d1d5db) is repointed at a theme token — the reason this exists instead of 'just use Layout'. Tab into the example and the skip link is the first thing you meet."
      @source={{this.usage}}
    >
      <:example>
        <div class='ps-demo-host'>
          {{#if this.fullFrame}}
            <PageScaffold
              @preset={{this.presetVal}}
              @label={{this.label}}
              @navLabel={{this.navLabel}}
              @asideLabel={{this.asideLabel}}
              @navWidth={{this.navWidth}}
              @asideWidth={{this.asideWidth}}
              @maxWidth={{this.maxWidthVal}}
              @stickyMasthead={{this.stickyMasthead}}
              @divided={{this.divided}}
              @skipLink={{this.skipLink}}
            >
              <:masthead><ScaffoldMasthead /></:masthead>
              <:subhead><ScaffoldSubhead /></:subhead>
              <:navigation><ScaffoldNav /></:navigation>
              <:default><ScaffoldMain /></:default>
              <:aside><ScaffoldAside /></:aside>
              <:footer><ScaffoldFooter /></:footer>
            </PageScaffold>
          {{else}}
            <PageScaffold
              @preset={{this.presetVal}}
              @label={{this.label}}
              @maxWidth={{this.maxWidthVal}}
              @stickyMasthead={{this.stickyMasthead}}
              @divided={{this.divided}}
              @skipLink={{this.skipLink}}
            >
              <:masthead><ScaffoldMasthead /></:masthead>
              <:default><ScaffoldMain /></:default>
            </PageScaffold>
          {{/if}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='preset'
          @options={{this.presetOptions}}
          @value={{this.preset}}
          @defaultValue='page'
          @onInput={{this.setPreset}}
          @description="boxel-layout preset underneath: 'page' (editorial measure and rhythm), 'bare' (no opinions), 'notebook' (divided blocks), 'tools' (panel grid). notebook and tools draw the Pretui surface — hairline plus shadow, never the preset's own border."
        />
        <Args.Bool
          @name='full frame (demo only)'
          @value={{this.fullFrame}}
          @defaultValue={{true}}
          @onInput={{this.setFullFrame}}
          @description='Not a component arg — switches between passing all six blocks and passing only masthead + main, so you can watch the grid shape derive itself from the blocks rather than from a prop.'
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @onInput={{this.setLabel}}
          @description='Accessible name for the <main> region. Give it one whenever a page holds more than one main-ish area.'
        />
        <Args.String
          @name='navLabel'
          @value={{this.navLabel}}
          @defaultValue='Section navigation'
          @onInput={{this.setNavLabel}}
          @description='Accessible name for the <nav> landmark. Two navs on a page without distinct names is the classic screen-reader trap.'
        />
        <Args.String
          @name='asideLabel'
          @value={{this.asideLabel}}
          @defaultValue='Supplementary'
          @onInput={{this.setAsideLabel}}
          @description='Accessible name for the <aside> landmark.'
        />
        <Args.String
          @name='navWidth'
          @value={{this.navWidth}}
          @defaultValue='14rem'
          @onInput={{this.setNavWidth}}
          @description='Width of the navigation rail; any CSS length. Ignored once the container folds to one column.'
        />
        <Args.String
          @name='asideWidth'
          @value={{this.asideWidth}}
          @defaultValue='16rem'
          @onInput={{this.setAsideWidth}}
          @description='Width of the aside rail; any CSS length.'
        />
        <Args.String
          @name='maxWidth'
          @value={{this.maxWidth}}
          @onInput={{this.setMaxWidth}}
          @description="Cap on the content measure, overriding the preset's own. Empty leaves the preset in charge."
        />
        <Args.Bool
          @name='stickyMasthead'
          @value={{this.stickyMasthead}}
          @defaultValue={{false}}
          @onInput={{this.setStickyMasthead}}
          @description='Pin the masthead to the top of the scroll container. Set --pretui-page-sticky-top when something else is already pinned above it.'
        />
        <Args.Bool
          @name='divided'
          @value={{this.divided}}
          @defaultValue={{false}}
          @onInput={{this.setDivided}}
          @description="Hairlines between the bands. Defaults to true under the 'notebook' preset, whose own dividers only reach surface Units and so miss plain regions."
        />
        <Args.Bool
          @name='skipLink'
          @value={{this.skipLink}}
          @defaultValue={{true}}
          @onInput={{this.setSkipLink}}
          @description='Render the skip-to-content link — first in the tab order, hidden until focused, and it moves focus rather than only scrolling. Turn it off only when an outer frame already provides one.'
        />
        <Args.Yield
          @name='masthead'
          @hideControls={{true}}
          @description='Top band, full width, a <header> — product name, account, global actions.'
        />
        <Args.Yield
          @name='subhead'
          @hideControls={{true}}
          @description='Second band under the masthead — breadcrumb, filters, a Toolbar.'
        />
        <Args.Yield
          @name='navigation'
          @hideControls={{true}}
          @description='The start rail, a <nav> landmark. Passing it turns the body into two columns.'
        />
        <Args.Yield
          @name='default'
          @hideControls={{true}}
          @description='The content column, a <main> landmark. The only required block, and the skip-link target.'
        />
        <Args.Yield
          @name='aside'
          @hideControls={{true}}
          @description='The end rail, an <aside> landmark — outline, metadata, activity.'
        />
        <Args.Yield
          @name='footer'
          @hideControls={{true}}
          @description='Bottom band, full width, a <footer>.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-page-gap'
          @description='Vertical rhythm between the bands, and the padding above a divided band.'
        />
        <Css.Basic
          @name='pretui-page-column-gap'
          @description='Gap between navigation, main and aside.'
        />
        <Css.Basic
          @name='pretui-page-sticky-top'
          @defaultValue='0px'
          @description='Offset for the sticky masthead and the sticky rails, when something else is pinned above the frame.'
        />
        <Css.Basic
          @name='pretui-page-shadow'
          @description="Surface depth for the notebook and tools presets, replacing boxel-layout's border."
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .ps-demo-host {
        container-type: inline-size;
        padding: var(--space-4, 11px);
        font-size: var(--text-ui-md, 12.5px);
      }
    </style>
  </template>
}

export const DEMOS_PAGE_SCAFFOLD: Record<string, unknown> = {
  PageScaffold: PageScaffoldUsage,
};
