// Pretui — ImageFrame usage page.
import Component from '@glimmer/component';
import { FreestyleUsage } from './freestyle-usage';
import { ImageFrame } from './image-frame';

const IMAGE_ASSET = {
  src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='960' height='540' viewBox='0 0 960 540'%3E%3Crect width='960' height='540' fill='%23e7ece7'/%3E%3Cpath d='M0 390C190 285 340 440 520 330S790 260 960 350V540H0Z' fill='%23b8cbb7'/%3E%3Cpath d='M0 430C210 350 350 485 575 390S820 330 960 410V540H0Z' fill='%238ca98c'/%3E%3Ccircle cx='760' cy='130' r='58' fill='%23fff8d7'/%3E%3C/svg%3E",
  label: 'Tea terraces at first light',
  alt: 'Layered green tea terraces beneath a pale morning sun',
  kind: 'image' as const,
  width: 960,
  height: 540,
  aspectRatio: '16 / 9',
};

class ImageFrameUsage extends Component {
  asset = IMAGE_ASSET;
  <template>
    <FreestyleUsage @name='ImageFrame' @description='A still-image frame that reserves intrinsic aspect ratio before bytes arrive and carries real alt text plus dimensions.' @source='<ImageFrame @asset={{this.asset}} />' @viewportMode='wide'>
      <:example><ImageFrame @asset={{this.asset}} /></:example>
      <:api as |Args|><Args.Object @name='asset' @value={{this.asset}} /></:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_IMAGE_FRAME: Record<string, unknown> = {
  ImageFrame: ImageFrameUsage,
};
