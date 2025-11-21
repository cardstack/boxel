import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { concat } from '@ember/helper';
import UploadIcon from '@cardstack/boxel-icons/upload';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    uploadText: string;
    uploadHint?: string;
    onFilesDropped: (files: File[]) => void;
    multiple?: boolean;
    height?: string;
    iconSize?: string;
    testId?: string;
    disabled?: boolean;
    allowedFormats?: string[];
  };
}

export default class DropZone extends Component<Signature> {
  @tracked isDragOver = false;

  get acceptAttribute(): string {
    if (this.args.allowedFormats && this.args.allowedFormats.length > 0) {
      return this.args.allowedFormats.join(',');
    }
    return 'image/*';
  }

  @action
  handleDragEnter(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  @action
  handleDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  @action
  handleDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    // Only set to false if we're leaving the drop zone itself
    const target = event.currentTarget as HTMLElement;
    const relatedTarget = event.relatedTarget as HTMLElement;
    if (!target.contains(relatedTarget)) {
      this.isDragOver = false;
    }
  }

  @action
  handleDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;

    if (this.args.disabled) return;

    const files = Array.from(event.dataTransfer?.files || []);
    
    // Filter by allowed formats if provided
    let filteredFiles: File[];
    if (this.args.allowedFormats && this.args.allowedFormats.length > 0) {
      filteredFiles = files.filter((file) =>
        this.args.allowedFormats!.includes(file.type),
      );
    } else {
      // Default to image files if no allowedFormats specified
      filteredFiles = files.filter((file) => file.type.startsWith('image/'));
    }

    if (filteredFiles.length > 0) {
      this.args.onFilesDropped(filteredFiles);
    }
  }

  @action
  handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    
    // Filter by allowed formats if provided
    let filteredFiles = files;
    if (this.args.allowedFormats && this.args.allowedFormats.length > 0) {
      filteredFiles = files.filter((file) =>
        this.args.allowedFormats!.includes(file.type),
      );
    } else {
      // Default to image files if no allowedFormats specified
      filteredFiles = files.filter((file) => file.type.startsWith('image/'));
    }

    if (filteredFiles.length > 0) {
      this.args.onFilesDropped(filteredFiles);
    }

    // Reset input
    input.value = '';
  }

  <template>
    <div
      class='drop-zone
        {{if this.isDragOver "drop-zone--drag-over"}}
        {{if @disabled "drop-zone--disabled"}}'
      {{on 'dragenter' this.handleDragEnter}}
      {{on 'dragover' this.handleDragOver}}
      {{on 'dragleave' this.handleDragLeave}}
      {{on 'drop' this.handleDrop}}
      data-test-drop-zone={{@testId}}
    >
      <label class='drop-zone-label'>
        <div class='drop-zone-content'>
          <UploadIcon
            class='drop-zone-icon'
            style={{if
              @iconSize
              (concat 'width: ' @iconSize '; height: ' @iconSize)
            }}
          />
          <p class='drop-zone-text'>
            <span class='drop-zone-text-bold'>{{@uploadText}}</span>
            {{#if @uploadHint}}
              <br />
              <span class='drop-zone-text-hint'>{{@uploadHint}}</span>
            {{/if}}
          </p>
          {{#if this.isDragOver}}
            <div class='drop-zone-overlay'>
              <span class='drop-overlay-text'>Drop files here</span>
            </div>
          {{/if}}
        </div>
        <input
          type='file'
          class='drop-zone-input'
          accept={{this.acceptAttribute}}
          multiple={{@multiple}}
          disabled={{@disabled}}
          {{on 'change' this.handleFileSelect}}
          data-test-file-input
        />
      </label>
    </div>

    <style
      scoped
    >
      .drop-zone {
        position: relative;
        width: 100%;
        height: {{@height}};
        border: 2px dashed var(--border, #d1d5db);
        border-radius: var(--radius, 0.5rem);
        background-color: var(--muted, #f9fafb);
        transition: all 0.2s ease;
      }

      .drop-zone-label {
        display: flex;
        width: 100%;
        height: 100%;
        cursor: pointer;
      }

      .drop-zone:hover:not(.drop-zone--disabled) {
        background-color: var(--accent, #f3f4f6);
        border-color: var(--primary, #3b82f6);
      }

      .drop-zone--drag-over {
        background-color: var(--primary, #eff6ff);
        border-color: var(--primary, #3b82f6);
        border-width: 3px;
      }

      .drop-zone--disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .drop-zone--disabled .drop-zone-label {
        cursor: not-allowed;
      }

      .drop-zone-input {
        display: none;
      }

      .drop-zone-content {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: calc(var(--spacing, 0.25rem) * 5)
          calc(var(--spacing, 0.25rem) * 6);
      }

      .drop-zone-icon {
        width: 3rem;
        height: 3rem;
        color: var(--muted-foreground, #9ca3af);
        margin-bottom: calc(var(--spacing, 0.25rem) * 3);
        transition: color 0.2s ease;
      }

      .drop-zone--drag-over .drop-zone-icon {
        color: var(--primary, #3b82f6);
      }

      .drop-zone-text {
        text-align: center;
        margin: 0;
      }

      .drop-zone-text-bold {
        font-weight: 600;
        color: var(--foreground, #374151);
      }

      .drop-zone-text-hint {
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
        margin-top: calc(var(--spacing, 0.25rem));
      }

      .drop-zone-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--primary, rgba(59, 130, 246, 0.1));
        border-radius: var(--radius, 0.5rem);
        pointer-events: none;
      }

      .drop-overlay-text {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--primary, #3b82f6);
        padding: calc(var(--spacing, 0.25rem) * 3)
          calc(var(--spacing, 0.25rem) * 6);
        background: white;
        border-radius: var(--radius, 0.5rem);
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      }
    </style>
  </template>
}
