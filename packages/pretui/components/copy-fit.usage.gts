// Pretui — CopyFit usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { CopyFit } from './copy-fit';

// ── CopyFit (formerly FittedCard) ← fitted-card/usage.gts ────────────────
// Dropped knobs: imageAlt (the media image is decorative — alt='' baked in);
// imageLoading (no arg); titleTag (title renders as a span, not a heading);
// layout (container queries only — no forced direction); subtitle,
// placeholder, background, badgeLeft, badgeRight, badgeRow blocks (no
// Pretui equivalents).
class CopyFitUsage extends GlimmerComponent {
  @tracked title = "Singularity's Echo";
  @tracked eyebrow = 'Movie Review';
  @tracked meta = 'Oct 17, 2024';
  @tracked media =
    'https://boxel-images.boxel.ai/app-assets/blog-posts/space-movie-thumb.jpeg';
  @tracked mediaBg = '';
  @tracked monogram = '';
  @tracked footerLeft = 'Robert Fields';
  @tracked footerRight = '4.8 ★';
  setTitle = (v: string) => (this.title = v);
  setEyebrow = (v: string) => (this.eyebrow = v);
  setMeta = (v: string) => (this.meta = v);
  setMedia = (v: string) => (this.media = v);
  setMediaBg = (v: string) => (this.mediaBg = v);
  setMonogram = (v: string) => (this.monogram = v);
  setFooterLeft = (v: string) => (this.footerLeft = v);
  setFooterRight = (v: string) => (this.footerRight = v);
  <template>
    <FreestyleUsage
      @name='CopyFit'
      @description='The copy-fitting layout mechanism (formerly FittedCard). One adaptive design across the badge / strip / tile / card sub-formats, chosen automatically via CSS container queries on the card root — media-forward when media exists, monogram placeholder otherwise. Content is supplied via args; only title is required.'
    >
      <:example>
        {{! FIXED-SIZE FORMAT BOXES — one adaptive design, four sub-formats,
            container-query driven (the fitted-card usage-preview idea). }}
        <figure class='format'>
          <div class='size-badge'>
            <CopyFit
              @title={{this.title}}
              @eyebrow={{this.eyebrow}}
              @meta={{this.meta}}
              @media={{this.media}}
              @mediaBg={{this.mediaBg}}
              @monogram={{this.monogram}}
              @footerLeft={{this.footerLeft}}
              @footerRight={{this.footerRight}}
            />
          </div>
          <figcaption>badge · 130×40</figcaption>
        </figure>
        <figure class='format'>
          <div class='size-strip'>
            <CopyFit
              @title={{this.title}}
              @eyebrow={{this.eyebrow}}
              @meta={{this.meta}}
              @media={{this.media}}
              @mediaBg={{this.mediaBg}}
              @monogram={{this.monogram}}
              @footerLeft={{this.footerLeft}}
              @footerRight={{this.footerRight}}
            />
          </div>
          <figcaption>strip · 230×64</figcaption>
        </figure>
        <figure class='format'>
          <div class='size-tile'>
            <CopyFit
              @title={{this.title}}
              @eyebrow={{this.eyebrow}}
              @meta={{this.meta}}
              @media={{this.media}}
              @mediaBg={{this.mediaBg}}
              @monogram={{this.monogram}}
              @footerLeft={{this.footerLeft}}
              @footerRight={{this.footerRight}}
            />
          </div>
          <figcaption>tile · 180×160</figcaption>
        </figure>
        <figure class='format'>
          <div class='size-card'>
            <CopyFit
              @title={{this.title}}
              @eyebrow={{this.eyebrow}}
              @meta={{this.meta}}
              @media={{this.media}}
              @mediaBg={{this.mediaBg}}
              @monogram={{this.monogram}}
              @footerLeft={{this.footerLeft}}
              @footerRight={{this.footerRight}}
            />
          </div>
          <figcaption>card · 210×260</figcaption>
        </figure>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='media'
          @description='Cover image URL. When present the image fills the media column; clear it to show the monogram placeholder instead.'
          @value={{this.media}}
          @onInput={{this.setMedia}}
        />
        <Args.String
          @name='title'
          @description='Primary heading.'
          @value={{this.title}}
          @required={{true}}
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='eyebrow'
          @description='Tiny uppercase overline rendered above the title. Styled with muted-foreground color and letter-spacing. Shown at tile and card sizes.'
          @value={{this.eyebrow}}
          @onInput={{this.setEyebrow}}
        />
        <Args.String
          @name='meta'
          @description='Additional content between the header and footer. Use for stats, tags, or secondary metadata. Hidden at badge size.'
          @value={{this.meta}}
          @onInput={{this.setMeta}}
        />
        <Args.String
          @name='footerLeft'
          @description='Left slot of the bottom row — for date, location, price, stats, etc. Anchored to the bottom of the content column; shown at card size only.'
          @value={{this.footerLeft}}
          @onInput={{this.setFooterLeft}}
        />
        <Args.String
          @name='footerRight'
          @description='Right slot of the bottom row; shown at card size only.'
          @value={{this.footerRight}}
          @onInput={{this.setFooterRight}}
        />
        <Args.String
          @name='monogram'
          @description='Letter shown in the media area when no media exists; defaults to the first character of the title.'
          @value={{this.monogram}}
          @onInput={{this.setMonogram}}
        />
        <Args.String
          @name='mediaBg'
          @description='Background color behind the media area when the monogram placeholder shows.'
          @value={{this.mediaBg}}
          @onInput={{this.setMediaBg}}
        />
        <Args.Yield
          @name='media'
          @description='Custom media block, rendered directly inside the media column. Alternative to @media for when you need markup rather than a bare URL.'
          @hideControls={{true}}
        />
        <Args.Base
          @typeLabel='CSS'
          @name='--fc-*'
          @description="The boxel-ui page's ~40 CSS-variable knobs (layout, image column, badges, typography, section visibility) — CSS knob layer not yet ported. Pretui exposes --pretui-fitted-mediabg."
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .format {
        margin: 0;
        display: grid;
        gap: 6px;
        justify-items: center;
        align-self: end;
      }
      .format figcaption {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .size-badge {
        width: 130px;
        height: 40px;
      }
      .size-strip {
        width: 230px;
        height: 64px;
      }
      .size-tile {
        width: 180px;
        height: 160px;
      }
      .size-card {
        width: 210px;
        height: 260px;
      }
    </style>
  </template>
}

export const DEMOS_COPY_FIT: Record<string, unknown> = {
  CopyFit: CopyFitUsage,
};
