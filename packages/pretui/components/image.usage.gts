// Pretui — Image usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Image } from './image';

// A small inline SVG, so the page renders offline and in the indexer.
const PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f6c38b'/><stop offset='1' stop-color='#8a5a44'/></linearGradient></defs><rect width='640' height='480' fill='url(#g)'/><circle cx='470' cy='150' r='60' fill='#fde7c2'/><path d='M0 360 L180 240 L320 330 L460 220 L640 350 L640 480 L0 480 Z' fill='#4b3326'/></svg>",
  );
const BROKEN = 'data:image/png;base64,AAAA';
const FIT_OPTIONS = ['cover', 'contain'];

export class ImageUsage extends Component {
  fitOptions = FIT_OPTIONS;
  @tracked alt = 'Estate hills at dawn';
  @tracked ratio = '16 / 9';
  @tracked fit = 'cover';
  @tracked preview = true;
  @tracked broken = false;
  @tracked useFallback = false;
  setAlt = (v: string) => (this.alt = v);
  setRatio = (v: string) => (this.ratio = v);
  setFit = (v: string) => (this.fit = v);
  setPreview = (v: boolean) => (this.preview = v);
  setBroken = (v: boolean) => (this.broken = v);
  setUseFallback = (v: boolean) => (this.useFallback = v);
  get src() {
    return this.broken ? BROKEN : PHOTO;
  }
  get fallback() {
    return this.useFallback ? PHOTO : undefined;
  }
  get fitArg() {
    return this.fit as 'cover' | 'contain';
  }
  get usage() {
    let bits = [`@src={{this.photo}}`, `@alt='${this.alt}'`, `@ratio='${this.ratio}'`];
    if (this.fit !== 'cover') bits.push(`@fit='${this.fit}'`);
    if (this.useFallback) bits.push('@fallback={{this.placeholder}}');
    if (this.preview) bits.push('@preview={{true}}');
    return `<Image ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Image'
      @description='An image in a frame that reserves its ratio before the bytes arrive, with a load state, a fallback source, a failure face instead of the broken-image icon, and an optional preview dialog. Alt is required; an empty alt means decorative. AspectRatio is the plain frame; ImageFrame is the MediaViewer adapter.'
      @source={{this.usage}}
    >
      <:example>
        <div class='img-demo'>
          <Image
            @src={{this.src}}
            @alt={{this.alt}}
            @ratio={{this.ratio}}
            @fit={{this.fitArg}}
            @fallback={{this.fallback}}
            @preview={{this.preview}}
            @bordered={{true}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String @name='src' @description='The image source.' />
        <Args.String
          @name='alt'
          @required={{true}}
          @value={{this.alt}}
          @description='The accessible name. An empty string marks the image decorative.'
          @onInput={{this.setAlt}}
        />
        <Args.String
          @name='ratio'
          @value={{this.ratio}}
          @description='A number or the CSS spelling. Defaults to width / height, then 4 / 3.'
          @onInput={{this.setRatio}}
        />
        <Args.String
          @name='fit'
          @value={{this.fit}}
          @options={{this.fitOptions}}
          @defaultValue='cover'
          @onInput={{this.setFit}}
        />
        <Args.Bool
          @name='preview'
          @defaultValue={{false}}
          @value={{this.preview}}
          @description='Click or Enter opens the image larger in a dialog.'
          @onInput={{this.setPreview}}
        />
        <Args.Bool
          @name='broken source (demo)'
          @value={{this.broken}}
          @description='Swap in a source that fails to decode.'
          @onInput={{this.setBroken}}
        />
        <Args.Bool
          @name='fallback'
          @value={{this.useFallback}}
          @description='A second source tried once when src fails.'
          @onInput={{this.setUseFallback}}
        />
        <Args.Number @name='width' @description='Intrinsic width; with height, the default ratio.' />
        <Args.Number @name='height' />
        <Args.String @name='loading' @defaultValue='lazy' />
        <Args.String @name='previewLabel' @defaultValue='View larger' />
        <Args.String @name='radius' />
        <Args.Bool @name='bordered' @defaultValue={{false}} />
        <Args.Action @name='onStatusChange' @description='loading, loaded or error, whenever it changes.' />
        <Args.Yield @name='fallback' @description='What shows when every source has failed.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .img-demo {
        max-inline-size: 26rem;
      }
    </style>
  </template>
}

export const DEMOS_IMAGE: Record<string, unknown> = {
  Image: ImageUsage,
};
