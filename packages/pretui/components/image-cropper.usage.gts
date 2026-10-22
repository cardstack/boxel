// Pretui — ImageCropper usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { ImageCropper } from './image-cropper';
import type { CropBox } from './image-cropper';
import { platePoster } from '../media-examples';
import { Token } from './token';

// ── ImageCropper ─────────────────────────────────────────────────────────
const CROP_SOURCE = platePoster('Kandy plate 04', '1600 / 1067');

/** Google's own sample model. Networked, and the one thing on these pages
 * that is. */

class ImageCropperUsage extends Component {
  src = CROP_SOURCE;

  @tracked height = 320;
  @tracked transforms = true;
  @tracked box = '—';

  setHeight = (v: number | null) => (this.height = v ?? 320);
  setTransforms = (v: boolean) => (this.transforms = v);
  noteBox = (b: CropBox) => (this.box = `${b.width}×${b.height} @ ${b.x},${b.y}`);

  get usage(): string {
    return [
      '<ImageCropper',
      '  @src={{this.src}}',
      "  @alt='Kandy plate 04'",
      '  @onChange={{this.noteBox}}',
      '  @onExport={{this.save}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='ImageCropper'
      @description="Cropper.js 2.1.1 (MIT, vendored at ./cropper) is a Web Component suite in v2, so the crop surface is plain tags in a Glimmer template — no `new Cropper(img)` and no instance to hold. The interesting decision is what was left OFF: Cropper's own `keyboard` attribute attaches a keydown listener to the DOCUMENT, so every arrow key anywhere on the page nudges the crop box whether or not the cropper has focus. That is a global hotkey with no owner, not accessibility. It is off, and the four range sliders below are the keyboard path instead — native inputs, so arrows, Shift, PageUp/PageDown, Home and End all behave the way the platform already defines, and each announces something a person can act on. Drag the box with a pointer and watch the sliders follow: one state, two ways in."
      @source={{this.usage}}
    >
      <:example>
        <ImageCropper
          @src={{this.src}}
          @alt='Kandy plate 04 — a generated stand-in plate'
          @height={{this.height}}
          @transforms={{this.transforms}}
          @onChange={{this.noteBox}}
        />
        <p class='dm-readout'>
          <span class='dm-readoutLabel'>@onChange</span>
          <Token @value={{this.box}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='src'
          @value={{this.src}}
          @description='URL of the image. A generated SVG here, so the page crops something real with no network.'
          @hideControls={{true}}
        />
        <Args.String
          @name='alt'
          @value='Kandy plate 04'
          @description='Alt text. An empty string marks the image decorative.'
          @hideControls={{true}}
        />
        <Args.Number
          @name='height'
          @value={{this.height}}
          @min={{160}}
          @max={{560}}
          @defaultValue={{320}}
          @description='Height of the crop surface in px, reserved before the image decodes so the toolbar below does not jump down the page when it lands.'
          @onInput={{this.setHeight}}
        />
        <Args.Bool
          @name='transforms'
          @value={{this.transforms}}
          @defaultValue={{true}}
          @description='Offer rotate and flip alongside the ratio chips.'
          @onInput={{this.setTransforms}}
        />
        <Args.Number
          @name='aspectRatio'
          @value={{0}}
          @description='Lock the box to a ratio; 0 or omitted is free. The chips set the same state, so a caller-locked ratio and a user-chosen one are the same thing.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onChange'
          @description='({x, y, width, height}) on every change, from pointer or slider.'
        />
        <Args.Action
          @name='onExport'
          @description='(dataUrl, box) when Export is pressed. A PNG data URL, never an object URL — nothing to revoke means nothing to leak. A cross-origin source taints the canvas and lands on the error line instead, which is a real and common outcome rather than a hypothetical.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_IMAGE_CROPPER: Record<string, unknown> = {
  ImageCropper: ImageCropperUsage,
};
