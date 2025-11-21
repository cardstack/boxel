import { not, eq } from '@cardstack/boxel-ui/helpers';
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import XIcon from '@cardstack/boxel-icons/x';
import ZoomInIcon from '@cardstack/boxel-icons/zoom-in';

interface BrowsePreviewArgs {
  Args: {
    imageData: string;
    fileName?: string;
    onRemove: () => void;
    onZoom: () => void;
    showZoomButton?: boolean;
  };
}

export default class BrowsePreview extends GlimmerComponent<BrowsePreviewArgs> {
  <template>
    <div class='browse-preview'>
      {{! ⁷ Main container }}
      <div class='image-wrapper'>
        <img src={{@imageData}} alt={{@fileName}} class='preview-image' />
        <button type='button' {{on 'click' @onRemove}} class='remove-button'>
          <XIcon class='icon' />
        </button>
        {{#if (not (eq @showZoomButton false))}}
          <button type='button' {{on 'click' @onZoom}} class='zoom-button'>
            <ZoomInIcon class='icon' />
          </button>
        {{/if}}
      </div>
    </div>

    <style
      scoped
    > {{! ⁹ Component styles }}
      .browse-preview {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .image-wrapper {
        position: relative;
        border: 2px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
      }

      .preview-image {
        width: 100%;
        height: 12rem;
        object-fit: cover;
      }

      .remove-button,
      .zoom-button {
        position: absolute;
        width: 2rem;
        height: 2rem;
        border-radius: 9999px;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      }

      .remove-button {
        top: 0.5rem;
        right: 0.5rem;
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
      }

      .remove-button:hover {
        background: #dc2626;
      }

      .zoom-button {
        top: 0.5rem;
        left: 0.5rem;
        background: var(--background, #ffffff);
        color: var(--foreground, #1a1a1a);
      }

      .zoom-button:hover {
        background: var(--muted, #f1f5f9);
      }

      .icon {
        width: 1rem;
        height: 1rem;
      }
    </style>
  </template>
}
