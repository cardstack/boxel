// Pretui — Logo usage page: live example, knobs for every arg, and the two
// places it has to fit (a Sidebar header, expanded and as an icon rail, and a
// section heading).
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Sidebar } from './sidebar';
import { LOGO_VARIANTS, Logo } from './logo';
import type { LogoVariant } from './logo';
import { PRETUI_SIZES } from '../pretui-primitives';
import type { PretuiSize } from '../pretui-primitives';

const VARIANTS = [...LOGO_VARIANTS];
const SIZES = [...PRETUI_SIZES];

const svg = (w: number, h: number, label: string, font: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="${h / 6}" fill="#4338ca"/><text x="${w / 2}" y="${h / 2}" fill="#fff" font-family="sans-serif" font-weight="700" font-size="${font}" text-anchor="middle" dominant-baseline="central">${label}</text></svg>`,
  )}`;
const MARK = svg(100, 100, 'A', 56);
const WORDMARK = svg(400, 100, 'ACME', 56);
const BROKEN = 'data:image/png;base64,AAAA';

export class LogoUsage extends GlimmerComponent {
  @tracked src = '';
  @tracked name = 'Acme Studio';
  @tracked variant = 'auto';
  @tracked size = 'm';
  @tracked decorative = false;
  setSrc = (v: string) => (this.src = v);
  setName = (v: string) => (this.name = v);
  setVariant = (v: string) => (this.variant = v);
  setSize = (v: string) => (this.size = v);
  setDecorative = (v: boolean) => (this.decorative = v);
  get srcVal() {
    return this.src || undefined;
  }
  get variantVal() {
    return this.variant as LogoVariant;
  }
  get sizeVal() {
    return this.size as PretuiSize;
  }
  get usage() {
    let bits: string[] = [];
    if (this.src) bits.push(`@src='${this.src}'`);
    bits.push(`@name='${this.name}'`);
    if (this.variant !== 'auto') bits.push(`@variant='${this.variant}'`);
    if (this.size !== 'm') bits.push(`@size='${this.size}'`);
    if (this.decorative) bits.push('@decorative={{true}}');
    return `<Logo ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Logo'
      @description='An app or brand mark: an image of any aspect ratio, never cropped, or the name as a wordmark (initials in a square mark) when there is no image. @size sets the height; the width follows the image.'
      @source={{this.usage}}
    >
      <:example>
        <div class='logo-demo'>
          <Logo
            @src={{this.srcVal}}
            @name={{this.name}}
            @variant={{this.variantVal}}
            @size={{this.sizeVal}}
            @decorative={{this.decorative}}
          />

          <div class='logo-row' data-logo-matrix>
            <Logo @src={{MARK}} @name='Acme mark' />
            <Logo @src={{WORDMARK}} @name='Acme wordmark' />
            <Logo @name='Acme Studio' />
            <Logo @name='Acme Studio' @variant='mark' />
            <Logo @src={{BROKEN}} @name='Broken image' />
            <Logo @src={{WORDMARK}} @name='Acme' @variant='mark' />
          </div>

          <div class='logo-row'>
            {{#each SIZES as |size|}}
              <Logo @src={{WORDMARK}} @name='Acme' @size={{size}} />
            {{/each}}
          </div>

          <div class='logo-stages'>
            <div class='logo-stage' data-logo-sidebar='expanded'>
              <Sidebar @label='Expanded' @open={{true}} @collapsible='rail'>
                <:header as |bar|>
                  <Logo
                    @src={{if bar.collapsed MARK WORDMARK}}
                    @name='Acme'
                    @variant={{if bar.collapsed 'mark' 'wordmark'}}
                  />
                </:header>
                <:nav></:nav>
              </Sidebar>
            </div>
            <div class='logo-stage' data-logo-sidebar='rail'>
              <Sidebar @label='Rail' @open={{false}} @collapsible='rail'>
                <:header as |bar|>
                  <Logo
                    @src={{if bar.collapsed MARK WORDMARK}}
                    @name='Acme'
                    @variant={{if bar.collapsed 'mark' 'wordmark'}}
                  />
                </:header>
                <:nav></:nav>
              </Sidebar>
            </div>
            <div class='logo-stage' data-logo-sidebar='text'>
              <Sidebar @label='Text only' @open={{false}} @collapsible='rail'>
                <:header as |bar|>
                  <Logo
                    @name='Acme Studio'
                    @variant={{if bar.collapsed 'mark' 'wordmark'}}
                  />
                </:header>
                <:nav></:nav>
              </Sidebar>
            </div>
          </div>

          <h2 class='logo-heading' data-logo-heading>
            <Logo @src={{MARK}} @name='Acme' @size='s' @decorative={{true}} />
            Acme workspace
          </h2>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='src'
          @value={{this.src}}
          @description='Image URL (svg, png, jpg, webp), drawn whole with object-fit: contain. Empty or failing to load: the name.'
          @onInput={{this.setSrc}}
        />
        <Args.String
          @name='name'
          @required={{true}}
          @value={{this.name}}
          @description='The wordmark when there is no image or it fails to load, the initials in a mark, and the accessible name (the image alt).'
          @onInput={{this.setName}}
        />
        <Args.String
          @name='variant'
          @value={{this.variant}}
          @options={{VARIANTS}}
          @defaultValue='auto'
          @description='mark is a square, wordmark is as wide as its content, auto picks from the loaded image aspect ratio (wider than 5:4 is a wordmark); with no image auto is a wordmark.'
          @onInput={{this.setVariant}}
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{SIZES}}
          @defaultValue='m'
          @description='The height, 2em of the size step; the width follows the image. --pretui-logo-h sets any height.'
          @onInput={{this.setSize}}
        />
        <Args.Bool
          @name='decorative'
          @value={{this.decorative}}
          @defaultValue={{false}}
          @description='Hides the logo from assistive tech (empty alt, aria-hidden). Use when text beside it already says the name.'
          @onInput={{this.setDecorative}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-logo-h'
          @type='dimension'
          @description='The height. Overrides the 2em of the @size step; set it on the Logo or an ancestor.'
          @defaultValue='2em'
        />
        <Css.Basic
          @name='pretui-logo-radius'
          @type='dimension'
          @description='Corner of the initials tile of a text-only mark.'
          @defaultValue='calc(var(--radius) / 2)'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      @layer PretComponent {
        .logo-demo {
          display: grid;
          gap: var(--boxel-sp);
          justify-items: start;
        }
        .logo-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--boxel-sp);
        }
        .logo-stages {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp);
        }
        .logo-stage {
          block-size: 9rem;
          inline-size: 16rem;
          overflow: hidden;
          border-radius: var(--radius);
          background: var(--card);
          color: var(--card-foreground);
          outline: 1px solid var(--border);
          outline-offset: -1px;
        }
        .logo-heading {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          margin: 0;
        }
      }
    </style>
  </template>
}

export const DEMOS_LOGO: Record<string, unknown> = {
  Logo: LogoUsage,
};
