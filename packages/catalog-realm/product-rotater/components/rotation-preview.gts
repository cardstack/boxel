import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn, concat } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';

import DragRotateModifier from '../modifiers/drag-rotate';

export interface RotationFrame {
  angle: number;
  label: string;
  base64: string;
}

export interface RotationPreviewSignature {
  Args: {
    frames?: RotationFrame[];
    currentIndex?: number;
    onSelect?: (index: number) => void;
    onDrag?: (deltaX: number) => void;
    onDragStart?: () => void;
  };
}

export class RotationPreview extends Component<RotationPreviewSignature> {
  get frames(): RotationFrame[] {
    return this.args.frames ?? [];
  }

  get currentIndex(): number {
    return this.args.currentIndex ?? 0;
  }

  get currentFrame(): RotationFrame | undefined {
    return this.frames[this.currentIndex];
  }

  get currentAngle() {
    return this.currentFrame?.angle ?? 0;
  }

  get currentLabel() {
    return this.currentFrame?.label ?? '';
  }

  get currentImage() {
    return this.currentFrame?.base64 ?? '';
  }

  get hasFrames() {
    return this.frames.length > 0;
  }

  private noop = (_delta: number) => {};
  private noopStart = () => {};

  get dragHandler() {
    return this.args.onDrag ?? this.noop;
  }

  get dragStartHandler() {
    return this.args.onDragStart ?? this.noopStart;
  }

  @action
  handleSelect(index: number) {
    this.args.onSelect?.(index);
  }

  <template>
    <section class='preview'>
      <header class='preview__header'>
        <h3>Interactive 360° View</h3>
        <p>Drag the image or choose a thumbnail to inspect each angle.</p>
      </header>

      <div class='preview__stage'>
        {{#if this.hasFrames}}
          <div
            class='preview__surface'
            {{DragRotateModifier this.dragHandler this.dragStartHandler}}
          >
            <img
              src={{this.currentImage}}
              alt={{this.currentLabel}}
              class='preview__image'
            />
            <div class='preview__angle'>
              {{this.currentAngle}}°
            </div>
          </div>

          <div class='preview__thumbnails'>
            {{#each this.frames as |frame index|}}
              <img
                src={{frame.base64}}
                alt={{frame.label}}
                class={{concat
                  'preview__thumbnail '
                  (if (eq index this.currentIndex) 'is-active' '')
                }}
                role='button'
                tabindex='0'
                {{on 'click' (fn this.handleSelect index)}}
              />
            {{/each}}
          </div>
        {{else}}
          <div class='preview__empty'>
            <p>Generated rotation views will appear here.</p>
          </div>
        {{/if}}
      </div>
    </section>

    <style scoped>
      .preview {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        background: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 16px;
        padding: 1.5rem;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }

      .preview__header h3 {
        margin: 0;
        font-size: 1.25rem;
        color: #0f172a;
      }

      .preview__header p {
        margin: 0.25rem 0 0;
        color: #475569;
        font-size: 0.9rem;
      }

      .preview__stage {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        width: 100%;
        max-width: 100%;
      }

      .preview__surface {
        position: relative;
        min-height: 320px;
        background: #ffffff;
        border-radius: 12px;
        border: 2px dashed rgba(148, 163, 184, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        overflow: hidden;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }

      .preview__surface:active {
        cursor: grabbing;
      }

      .preview__image {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .preview__angle {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        background: rgba(30, 64, 175, 0.85);
        color: #ffffff;
        padding: 0.35rem 0.65rem;
        border-radius: 9999px;
        font-weight: 600;
        font-size: 0.8rem;
      }

      .preview__thumbnails {
        display: flex;
        gap: 0.65rem;
        overflow-x: auto;
        padding-top: 0.5rem;
        padding-bottom: 0.5rem;
      }

      .preview__thumbnail {
        width: 72px;
        height: 72px;
        border-radius: 10px;
        object-fit: cover;
        border: 2px solid transparent;
        transition:
          transform 0.2s ease,
          border-color 0.2s ease;
        flex-shrink: 0;
      }

      .preview__thumbnail:hover {
        transform: scale(1.05);
        border-color: rgba(59, 130, 246, 0.5);
      }

      .preview__thumbnail.is-active {
        border-color: rgba(30, 64, 175, 0.85);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
      }

      .preview__empty {
        padding: 2rem;
        border-radius: 12px;
        border: 2px dashed rgba(148, 163, 184, 0.3);
        background: rgba(241, 245, 249, 0.5);
        color: #64748b;
        text-align: center;
      }
    </style>
  </template>
}
