// Pretui — Card usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { SizeAlias } from '../internal/structure-layout';
import type { PretuiTone } from '../pretui-primitives';
import { AspectRatio } from './aspect-ratio';
import { Button } from './button';
import { Card } from './card';
import type { CardAppearance } from './card';
import { FreestyleUsage } from './freestyle-usage';
import { LOTS, Lot, SWATCH } from '../internal/structure-layout-fixtures';

// ── Card ─────────────────────────────────────────────────────────────────

export class CardUsage extends Component {
  @tracked tone = 'neutral';
  @tracked appearance = 'outlined';
  @tracked size = 'm';
  @tracked orientation: 'horizontal' | 'vertical' = 'vertical';
  @tracked interactive = true;

  toneOptions = [
    'neutral',
    'primary',
    'info',
    'success',
    'warning',
    'danger',
    'attention',
  ];
  appearanceOptions = [
    'outlined',
    'filled',
    'filled-outlined',
    'accent',
    'plain',
  ];
  sizeOptions = ['xs', 's', 'm', 'l', 'xl'];
  orientationOptions = ['vertical', 'horizontal'];
  swatch = SWATCH;
  lot = LOTS[0] as Lot;

  setTone = (v: string) => {
    this.tone = v;
  };
  setAppearance = (v: string) => {
    this.appearance = v;
  };
  setSize = (v: string) => {
    this.size = v;
  };
  setOrientation = (v: string) => {
    this.orientation = v as 'horizontal' | 'vertical';
  };
  setInteractive = (v: boolean) => {
    this.interactive = v;
  };

  get toneValue(): PretuiTone {
    return this.tone as PretuiTone;
  }
  get appearanceValue(): CardAppearance {
    return this.appearance as CardAppearance;
  }
  get sizeValue(): SizeAlias {
    return this.size as SizeAlias;
  }

  get usage(): string {
    return [
      '<Card',
      "  @title='Lot " + this.lot.id + "'",
      "  @description='" + this.lot.tea + "'",
      "  @tone='" + this.tone + "'",
      "  @appearance='" + this.appearance + "'",
      '>',
      '  <:action>…</:action>',
      '  <:media>…</:media>',
      '  <:default>…</:default>',
      '  <:footer>…</:footer>',
      '</Card>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Card'
      @description="The name collision worth getting right: CopyFit is a container-query identity, Panel is a surface, and this is neither — it is the composition shape React means by Card. Header with a title, a description and an action parked at the end edge; then media, body and footer."
      @source={{this.usage}}
    >
      <:example>
        <div class='card-stage'>
          <Card
            @title={{this.lot.tea}}
            @eyebrow={{this.lot.id}}
            @description='First flush, hand-rolled, single estate.'
            @tone={{this.toneValue}}
            @appearance={{this.appearanceValue}}
            @size={{this.sizeValue}}
            @orientation={{this.orientation}}
            @interactive={{this.interactive}}
          >
            <:action>
              <Button @size='xs' @appearance='plain' @tone='neutral'>Edit</Button>
            </:action>
            <:media>
              <AspectRatio
                @ratio='16 / 9'
                @src={{this.swatch}}
                @alt='Estate at dawn'
              />
            </:media>
            <:default>
              <p class='card-body'>{{this.lot.place}} ·
                {{this.lot.chests}}
                chests. The header grid gains its second column only when an
                action block is present — and it knows that from a block test,
                not from a selector probe that a nested action would defeat.</p>
            </:default>
            <:footer>
              <Button @size='s'>Open lot</Button>
              <Button @size='s' @appearance='plain' @tone='neutral'>Archive</Button>
            </:footer>
          </Card>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @description='Header title. Sugar for the title block; the block wins when both exist. Rendered as a real h3 with an id, and the section is labelled by it — so a card with a title is a named region, and a card without one adds nothing to the rotor.'
        />
        <Args.String
          @name='description'
          @description='The supporting line under the title.'
        />
        <Args.String
          @name='eyebrow'
          @description='A small uppercase line above the title.'
        />
        <Args.String
          @name='tone'
          @description='The kit tone axis: which hue and why.'
          @options={{this.toneOptions}}
          @value={{this.tone}}
          @onInput={{this.setTone}}
          @defaultValue='neutral'
        />
        <Args.String
          @name='appearance'
          @description='The kit appearance axis: how loud. outlined is the hairline surface, plain removes it entirely.'
          @options={{this.appearanceOptions}}
          @value={{this.appearance}}
          @onInput={{this.setAppearance}}
          @defaultValue='outlined'
        />
        <Args.String
          @name='size'
          @description='Sets the host font size only; every internal dimension is em, so one declaration scales the whole card.'
          @options={{this.sizeOptions}}
          @value={{this.size}}
          @onInput={{this.setSize}}
          @defaultValue='m'
        />
        <Args.String
          @name='orientation'
          @description='vertical stacks media above the body; horizontal puts media on the start edge, which mirrors in RTL for free.'
          @options={{this.orientationOptions}}
          @value={{this.orientation}}
          @onInput={{this.setOrientation}}
          @defaultValue='vertical'
        />
        <Args.Bool
          @name='interactive'
          @description='Hover elevation plus a focus-within ring. It does not make the card itself clickable — a card-sized button around arbitrary content is a nested-interactive trap. The focus-within half is the part every source library omits.'
          @defaultValue={{false}}
          @value={{this.interactive}}
          @onInput={{this.setInteractive}}
        />
        <Args.Bool
          @name='scroll'
          @description='The body scrolls and the header and footer pin. The caller supplies the height.'
          @defaultValue={{false}}
        />
        <Args.Yield
          @name='header / title / description / action / media / footer'
          @description='The Glimmer equivalent of the React compound children. Once any named block is present, wrap the body in a default block — loose content beside named blocks passes local parse and fails the realm transpile.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-card-pad'
          @type='dimension'
          @description='Padding for the header, body and footer, in em so it rides the size scale.'
          @defaultValue='1.1em'
        />
        <Css.Basic
          @name='pretui-card-radius'
          @type='dimension'
          @description='Corner radius; the media band inherits the two corners it touches.'
          @defaultValue='var(--radius-surface)'
        />
        <Css.Basic
          @name='pretui-card-media-size'
          @type='dimension'
          @description='Media width in the horizontal orientation.'
          @defaultValue='34%'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .card-stage {
        max-inline-size: 420px;
        padding: var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--canvas, var(--boxel-100));
      }
      .card-body {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.55;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_CARD: Record<string, unknown> = {
  Card: CardUsage,
};
