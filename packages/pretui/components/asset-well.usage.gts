// Pretui — AssetWell usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { AssetWell } from './asset-well';
import type { MediaAssetSpec } from '../internal/media-viewer';
import type { FileRejection } from '../internal/file-intake';
import { platePoster } from '../media-examples';
import { Token } from './token';

// ── AssetWell ────────────────────────────────────────────────────────────
const WELL_ASSET: MediaAssetSpec = {
  src: platePoster('Chest 118, front', '1600 / 1067'),
  name: 'chest-118-front.svg',
  kind: 'image',
  mimeType: 'image/svg+xml',
  alt: 'Chest 118 photographed square-on before grading',
  width: 1600,
  height: 1067,
  bytes: 184_320,
};

class AssetWellUsage extends Component {
  @tracked filled = true;
  @tracked uploading = false;
  @tracked fraction = 0.42;
  @tracked determinate = true;
  @tracked failure = '';
  @tracked viewOnly = false;
  @tracked ratio = '3 / 2';
  @tracked lastEvent = '—';

  get asset(): MediaAssetSpec | null {
    return this.filled ? WELL_ASSET : null;
  }
  get uploadFraction(): number | undefined {
    return this.determinate ? this.fraction : undefined;
  }

  setFilled = (v: boolean) => (this.filled = v);
  setUploading = (v: boolean) => (this.uploading = v);
  setDeterminate = (v: boolean) => (this.determinate = v);
  setFraction = (v: number | null) => (this.fraction = v ?? 0);
  setFailure = (v: string) => (this.failure = v);
  setViewOnly = (v: boolean) => (this.viewOnly = v);
  setRatio = (v: string) => (this.ratio = v);

  noteSelect = (file: File) => {
    this.lastEvent = `onSelect: ${file.name} (${file.size} bytes)`;
  };
  noteReject = (rejections: FileRejection[]) => {
    this.lastEvent = `onReject: ${rejections.length} file(s) turned away`;
  };
  noteRemove = () => {
    this.filled = false;
    this.lastEvent = 'onRemove';
  };
  noteRetry = () => {
    this.failure = '';
    this.lastEvent = 'onRetry — failure cleared';
  };
  noteCancel = () => {
    this.uploading = false;
    this.lastEvent = 'onCancel — upload stopped';
  };

  get usage(): string {
    return [
      '<AssetWell',
      '  @asset={{this.asset}}',
      "  @accept='image/*'",
      '  @maxSize={{5242880}}',
      "  @ratio='3 / 2'",
      "  @label='Drop the plate photograph here'",
      '  @uploading={{this.uploading}}',
      '  @uploadFraction={{this.fraction}}',
      '  @errorMessage={{this.failure}}',
      '  @onSelect={{this.upload}}',
      '  @onRemove={{this.clear}}',
      '  @onRetry={{this.upload}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='AssetWell'
      @description="One asset, one slot, five states — empty, drag-over, in-flight, filled, failed — over a Dropzone that is the root in every one of them. That single composition decision is what makes the keyboard path structural rather than optional: Dropzone renders a FileTrigger, FileTrigger encapsulates a real file input, and neither can be designed away by a caller replacing the body. It also means dragging a file onto a FILLED well replaces it, which the catalog source could not do, and that accept lists and size limits are enforced identically on the drop path and the picker path because it is literally the same screening code. Drive the four states from the rail; nothing reflows between them because the preview's aspect ratio is reserved before any bytes arrive."
      @source={{this.usage}}
    >
      <:example>
        <AssetWell
          @asset={{this.asset}}
          @accept='image/*'
          @maxSize={{5242880}}
          @ratio={{this.ratio}}
          @label='Drop the plate photograph here'
          @hint='PNG, JPEG or SVG, up to 5 MB'
          @altLabel='Alt text'
          @uploading={{this.uploading}}
          @uploadFraction={{this.uploadFraction}}
          @errorMessage={{this.failure}}
          @viewOnly={{this.viewOnly}}
          @onSelect={{this.noteSelect}}
          @onReject={{this.noteReject}}
          @onRemove={{this.noteRemove}}
          @onRetry={{this.noteRetry}}
          @onCancel={{this.noteCancel}}
        />
        <p class='dml-readout'>
          <span class='dml-readoutLabel'>last event</span>
          <Token @value={{this.lastEvent}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.Object
          @name='asset'
          @description='Controlled asset (a MediaAssetSpec). Omit the arg entirely for the uncontrolled case, where a dropped file becomes a local preview through an object URL the component owns and revokes — on replace, and again in willDestroy. A controlled well never invents an asset, because inventing a blob URL the caller cannot see is a resource it can never free.'
          @value={{this.asset}}
        />
        <Args.Bool
          @name='(demo) filled'
          @value={{this.filled}}
          @defaultValue={{true}}
          @description='Not an argument — the demo toggling whether the asset arg is a spec or null.'
          @onInput={{this.setFilled}}
        />
        <Args.Bool
          @name='uploading'
          @value={{this.uploading}}
          @defaultValue={{false}}
          @description='Puts the well in its in-flight state. The zone goes inert while it is set: a second drop mid-upload is a race nobody asked for.'
          @onInput={{this.setUploading}}
        />
        <Args.Bool
          @name='(demo) determinate'
          @value={{this.determinate}}
          @defaultValue={{true}}
          @description='Not an argument — whether the demo passes uploadFraction at all. Off means the fraction is undefined and the well shows an indeterminate spinner, which is the honest answer when the transport reports no progress. A fake percentage is a lie with a progress bar around it.'
          @onInput={{this.setDeterminate}}
        />
        <Args.Number
          @name='uploadFraction'
          @value={{this.fraction}}
          @min={{0}}
          @max={{1}}
          @step={{0.01}}
          @description='Completed fraction, 0–1. Omit while uploading for the indeterminate spinner.'
          @onInput={{this.setFraction}}
        />
        <Args.String
          @name='errorMessage'
          @value={{this.failure}}
          @description='Non-empty puts the well in its failure state and is the text shown. The failure channel is a glyph AND a word AND a role — never a colour, which is the one thing the source had no answer for.'
          @onInput={{this.setFailure}}
        />
        <Args.String
          @name='ratio'
          @value={{this.ratio}}
          @description="Aspect ratio reserved for the preview — '16 / 9', '1 / 1'. Defaults to the asset's own, then 4 / 3. Reserving it before the bytes land is why nothing on the card reflows. The value goes through the shared cssValue guard, so a caller string can never inject declarations into a style attribute."
          @onInput={{this.setRatio}}
        />
        <Args.Bool
          @name='viewOnly'
          @value={{this.viewOnly}}
          @defaultValue={{false}}
          @description='Show the preview and nothing that mutates — no replace, no remove.'
          @onInput={{this.setViewOnly}}
        />
        <Args.String
          @name='accept'
          @value='image/*'
          @description='An input accept list. Enforced on BOTH the picker and the drop, by the same code, with the same wording in the same live region.'
          @hideControls={{true}}
        />
        <Args.Number
          @name='maxSize'
          @value={{5242880}}
          @description='Largest acceptable file, in bytes. Anything over it lands on onReject with a reason.'
          @hideControls={{true}}
        />
        <Args.String
          @name='altLabel'
          @description="Offer an alt-text line under the preview. Opt-in because some slots really are decorative — but the source hardcoded alt='' with no alt field anywhere on its model, which made every image it ever held permanently undescribable."
          @value='Alt text'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onSelect'
          @description='(file) — THE event. Fires with the accepted file from a drop or a pick, before any preview exists. Upload from here.'
        />
        <Args.Action
          @name='onAssetChange'
          @description="(asset | null) whenever the well's own asset changes: on adopt in the uncontrolled case, on remove in both."
        />
        <Args.Action
          @name='onReject'
          @description='(rejections) — everything that failed screening, one reason each.'
        />
        <Args.Action
          @name='onRemove'
          @description='() when the reader clears the slot.'
        />
        <Args.Action
          @name='onRetry'
          @description='() from the failure state. Omit it and no retry button is offered at all — an affordance that does nothing is worse than none.'
        />
        <Args.Action
          @name='onCancel'
          @description='() from the in-flight state, on the same terms.'
        />
        <Args.Yield
          @name='preview'
          @description='Replaces the preview entirely; receives the resolved asset.'
        />
        <Args.Yield
          @name='empty'
          @description="Replaces the invitation's copy. The browse button is NOT part of this block — it is the keyboard path."
        />
        <Args.Yield
          @name='actions'
          @description='Extra controls beside Remove in the filled state.'
        />
      </:api>

      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-well-aspect'
          @type='ratio'
          @description='Reserved preview ratio. Set through @ratio; exposed so a season can floor it.'
        />
        <Css.Basic
          @name='pretui-well-glyph-size'
          @type='dimension'
          @description="Size of the empty state's icon."
        />
        <Css.Basic
          @name='pretui-well-transition'
          @type='duration'
          @description='Fade of the preview tools. Zeroed under prefers-reduced-motion.'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .dml-readout {
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
        margin: var(--space-3, 8px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .dml-readoutLabel {
        font-weight: var(--weight-medium, 500);
      }
    </style>
  </template>
}

export const DEMOS_ASSET_WELL: Record<string, unknown> = {
  AssetWell: AssetWellUsage,
};
