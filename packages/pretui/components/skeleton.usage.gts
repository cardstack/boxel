// Pretui — Skeleton usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Skeleton } from '../structure';

// ── Skeleton ← skeleton-placeholder/usage.gts ────────────────────────────
// Dropped knobs: animation (wave/pulse/none — Pretui ships one shimmer;
// reduced-motion turns it off in CSS).
class SkeletonUsage extends GlimmerComponent {
  @tracked width = '200px';
  @tracked height = '20px';
  setWidth = (v: string) => (this.width = v);
  setHeight = (v: string) => (this.height = v);
  <template>
    <FreestyleUsage
      @name='Skeleton'
      @description='A skeleton placeholder component to show loading states'
    >
      <:example>
        <div class='skeleton-stack'>
          <Skeleton @width={{this.width}} @height={{this.height}} />
          <Skeleton @width='140px' @height='12px' />
          <Skeleton @width='80px' @height='12px' />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='width'
          @description='Width of the skeleton (px or %)'
          @defaultValue='100%'
          @value={{this.width}}
          @onInput={{this.setWidth}}
        />
        <Args.String
          @name='height'
          @description='Height of the skeleton (px or %)'
          @defaultValue='12px'
          @value={{this.height}}
          @onInput={{this.setHeight}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .skeleton-stack {
        width: 240px;
        display: grid;
        gap: var(--space-3, 8px);
      }
    </style>
  </template>
}

export const DEMOS_SKELETON: Record<string, unknown> = {
  Skeleton: SkeletonUsage,
};
