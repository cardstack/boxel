import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import BoxelContainer from '../../components/container/index.gts';
import cssVar from '../../helpers/css-var.ts';
import MarkdownContentShell from './index.gts';

// A short blog post standing in for a renderer's markdownToHtml() output; the
// shell only ever receives already-rendered HTML.
const SAMPLE_HTML = htmlSafe(`
  <h1>A Weekend in the Workshop</h1>
  <p><em>April 12 · 3 min read</em></p>
  <p>I finally got around to rebuilding the garden bench this weekend. The old
  one had survived <strong>six winters</strong>, which is five more than the
  <a href="#">original plans</a> promised.</p>
  <h2>What I'd do differently</h2>
  <ul>
    <li>Seal the end grain before assembly, not after</li>
    <li>Buy twice as many clamps as feels reasonable</li>
    <li>Sketch the joinery first — see the cut list below</li>
  </ul>
  <blockquote><p>Measure twice, cut once. Then measure again anyway.</p></blockquote>
  <pre><code>seat slats   4 × (120cm × 9cm)
legs         4 × (45cm × 7cm)</code></pre>
  <p>Next up: a matching planter box, if the weather holds.</p>
`);

export default class MarkdownContentShellUsage extends Component {
  @cssVariable({ cssClassName: 'markdown-shell-usage-container' })
  declare markdownFontSize: CSSVariableInfo;
  @cssVariable({ cssClassName: 'markdown-shell-usage-container' })
  declare markdownLineHeight: CSSVariableInfo;
  @cssVariable({ cssClassName: 'markdown-shell-usage-container' })
  declare markdownH1FontSize: CSSVariableInfo;
  @cssVariable({ cssClassName: 'markdown-shell-usage-container' })
  declare markdownHeadingFontWeight: CSSVariableInfo;
  @cssVariable({ cssClassName: 'markdown-shell-usage-container' })
  declare markdownLinkColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'markdown-shell-usage-container' })
  declare markdownPreBackground: CSSVariableInfo;
  @cssVariable({ cssClassName: 'markdown-shell-usage-container' })
  declare markdownBlockquoteBorderLeft: CSSVariableInfo;

  <template>
    <div
      class='markdown-shell-usage-container'
      style={{cssVar
        markdown-font-size=this.markdownFontSize.value
        markdown-line-height=this.markdownLineHeight.value
        markdown-h1-font-size=this.markdownH1FontSize.value
        markdown-heading-font-weight=this.markdownHeadingFontWeight.value
        markdown-link-color=this.markdownLinkColor.value
        markdown-pre-background=this.markdownPreBackground.value
        markdown-blockquote-border-left=this.markdownBlockquoteBorderLeft.value
      }}
    >
      <FreestyleUsage
        @name='MarkdownContentShell'
        @description='Styled surface for already-rendered markdown HTML. Customize by setting `--markdown-*` custom properties on any ancestor, never with :deep — the variables below are a sample; the full token list is documented on `.markdown-content` in the component source.'
      >
        <:example>
          <BoxelContainer class='container'>
            <MarkdownContentShell>
              {{SAMPLE_HTML}}
            </MarkdownContentShell>
          </BoxelContainer>
        </:example>
        <:cssVars as |Css|>
          <Css.Basic
            @name='markdown-font-size'
            @type='length'
            @description='Base font size of the rendered content; headings and code scale from it in em.'
            @defaultValue={{this.markdownFontSize.defaults}}
            @value={{this.markdownFontSize.value}}
            @onInput={{this.markdownFontSize.update}}
          />
          <Css.Basic
            @name='markdown-line-height'
            @type='number'
            @description='Base line height of the rendered content.'
            @defaultValue={{this.markdownLineHeight.defaults}}
            @value={{this.markdownLineHeight.value}}
            @onInput={{this.markdownLineHeight.update}}
          />
          <Css.Basic
            @name='markdown-h1-font-size'
            @type='length'
            @description='h1 font size; each heading level has -font-size, -font-weight, -line-height, and -margin-block tokens.'
            @defaultValue={{this.markdownH1FontSize.defaults}}
            @value={{this.markdownH1FontSize.value}}
            @onInput={{this.markdownH1FontSize.update}}
          />
          <Css.Basic
            @name='markdown-heading-font-weight'
            @type='number'
            @description='Shared heading weight, overridable per level.'
            @defaultValue={{this.markdownHeadingFontWeight.defaults}}
            @value={{this.markdownHeadingFontWeight.value}}
            @onInput={{this.markdownHeadingFontWeight.update}}
          />
          <Css.Basic
            @name='markdown-link-color'
            @type='color'
            @description='Link color; pairs with --markdown-link-text-decoration.'
            @defaultValue={{this.markdownLinkColor.defaults}}
            @value={{this.markdownLinkColor.value}}
            @onInput={{this.markdownLinkColor.update}}
          />
          <Css.Basic
            @name='markdown-pre-background'
            @type='color'
            @description='Code block surface; defaults to the Monaco editor surface when a renderer defines one.'
            @defaultValue={{this.markdownPreBackground.defaults}}
            @value={{this.markdownPreBackground.value}}
            @onInput={{this.markdownPreBackground.update}}
          />
          <Css.Basic
            @name='markdown-blockquote-border-left'
            @type='border'
            @description='Blockquote left rail; pairs with the other --markdown-blockquote-* tokens.'
            @defaultValue={{this.markdownBlockquoteBorderLeft.defaults}}
            @value={{this.markdownBlockquoteBorderLeft.value}}
            @onInput={{this.markdownBlockquoteBorderLeft.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
    <style scoped>
      .container {
        padding: var(--boxel-sp-xl);
        background: var(--background);
        color: var(--foreground);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}
