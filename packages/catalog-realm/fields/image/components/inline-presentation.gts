import GlimmerComponent from '@glimmer/component';
import CameraIcon from '@cardstack/boxel-icons/camera';

interface InlinePresentationSignature {
  Args: {
    imageUrl?: string;
    hasImage: boolean;
  };
}

export default class InlinePresentation extends GlimmerComponent<InlinePresentationSignature> {
  <template>
    <div class='image-inline'>
      {{#if @hasImage}}
        <div class='inline-image-wrapper'>
          <img src={{@imageUrl}} alt='' class='inline-image' />
        </div>
        <div class='inline-info'>
          <div class='inline-url'>{{@imageUrl}}</div>
        </div>
      {{else}}
        <div class='inline-placeholder'>
          <CameraIcon class='placeholder-icon' />
        </div>
        <div class='inline-info'>
          <div class='inline-url-empty'>No image uploaded</div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .image-inline {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        background: var(--background, #ffffff);
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        transition: all 0.2s ease;
      }

      .image-inline:hover {
        box-shadow: var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
      }

      .inline-image-wrapper {
        flex-shrink: 0;
        width: 4rem;
        height: 4rem;
        border-radius: var(--radius, 0.375rem);
        overflow: hidden;
        background: var(--muted, #f1f5f9);
      }

      .inline-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .inline-placeholder {
        flex-shrink: 0;
        width: 4rem;
        height: 4rem;
        border-radius: var(--radius, 0.375rem);
        background: var(--muted, #f1f5f9);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .placeholder-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .inline-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .inline-url {
        font-size: 0.8125rem;
        color: var(--foreground, #1a1a1a);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-height: 1.4;
        word-break: break-all;
      }

      .inline-url-empty {
        font-size: 0.8125rem;
        color: var(--muted-foreground, #9ca3af);
        font-style: italic;
      }
    </style>
  </template>
}

