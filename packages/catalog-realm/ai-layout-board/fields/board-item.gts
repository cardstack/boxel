import {
  CardDef,
  field,
  contains,
  Component,
  FieldDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { BoardPosition } from './board-position';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { get, concat } from '@ember/helper';
import { and } from '@cardstack/boxel-ui/helpers';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';

export class BoardItem extends FieldDef {
  static displayName = 'Board Item';

  @field position = contains(BoardPosition);
}

// ²⁹ Image node with URL field and fitted formats
export class IsolatedImageNode extends Component<typeof ImageNode> {
  <template>
    <div class='image-node-isolated'>
      <div class='image-stage'>
        <div class='image-container'>
          {{#if @model.imageUrl}}
            <img
              src={{@model.imageUrl}}
              alt={{if @model.caption @model.caption 'Image'}}
              class='main-image'
            />
          {{else}}
            <div class='image-placeholder'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <circle cx='8.5' cy='8.5' r='1.5' />
                <polyline points='21,15 16,10 5,21' />
              </svg>
              <p>No image provided</p>
            </div>
          {{/if}}

          {{#if @model.caption}}
            <div class='caption-overlay'>
              <div class='caption-text'>{{@model.caption}}</div>
            </div>
          {{/if}}
        </div>

        {{#if @fields.position}}
          <div class='position-info'>
            <@fields.position />
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .image-node-isolated {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        padding: 1rem;
        overflow-y: auto;
      }

      .image-stage {
        max-width: 48rem;
        width: 100%;
      }

      .image-container {
        position: relative;
        background: white;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        margin-bottom: 1.5rem;
      }

      .main-image {
        width: 100%;
        max-height: 70vh;
        object-fit: contain;
        background: #f8fafc;
      }

      .image-placeholder {
        width: 100%;
        height: 400px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        color: #6b7280;
        gap: 1rem;
      }

      .image-placeholder svg {
        width: 64px;
        height: 64px;
      }

      .image-placeholder p {
        font-size: 1.125rem;
        margin: 0;
      }

      .caption-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(
          to top,
          rgba(0, 0, 0, 0.8) 0%,
          transparent 100%
        );
        padding: 2rem 1.5rem 1.5rem;
      }

      .caption-text {
        color: white;
        font-size: 1.125rem;
        font-weight: 500;
        line-height: 1.4;
      }

      .position-info {
        background: #f8fafc;
        border-radius: 8px;
        padding: 1rem;
      }
    </style>
  </template>
}

export class EmbeddedImageNode extends Component<typeof ImageNode> {
  <template>
    <div class='image-node'>
      {{#if @model.imageUrl}}
        <img
          src={{@model.imageUrl}}
          alt={{if @model.caption @model.caption 'Image'}}
        />
      {{else}}
        <div class='image-placeholder'>
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
            <circle cx='8.5' cy='8.5' r='1.5' />
            <polyline points='21,15 16,10 5,21' />
          </svg>
        </div>
      {{/if}}
      {{#if @model.caption}}
        <div class='caption'>{{@model.caption}}</div>
      {{/if}}
    </div>

    <style scoped>
      .image-node {
        background: white;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .image-node img {
        width: 100%;
        height: auto;
        object-fit: cover;
        max-height: 300px;
      }

      .image-placeholder {
        width: 100%;
        height: 150px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        color: #6b7280;
      }

      .image-placeholder svg {
        width: 48px;
        height: 48px;
      }

      .caption {
        padding: 12px;
        font-size: 0.875rem;
        color: #374151;
        border-top: 1px solid #e5e7eb;
      }
    </style>
  </template>
}

export class FittedImageNode extends Component<typeof ImageNode> {
  <template>
    <div class='fitted-container'>
      {{! Badge Format: Ultra-compact }}
      <div class='badge-format'>
        <div class='image-badge'>
          {{#if @model.imageUrl}}
            <img
              src={{@model.imageUrl}}
              alt={{if @model.caption @model.caption 'Image'}}
            />
          {{else}}
            <div class='placeholder-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <circle cx='8.5' cy='8.5' r='1.5' />
                <polyline points='21,15 16,10 5,21' />
              </svg>
            </div>
          {{/if}}
          <div class='badge-text'>
            <div class='primary-text'>{{if
                @model.caption
                @model.caption
                'Image'
              }}</div>
          </div>
        </div>
      </div>

      {{! Strip Format: Horizontal layout }}
      <div class='strip-format'>
        <div class='strip-image'>
          {{#if @model.imageUrl}}
            <img
              src={{@model.imageUrl}}
              alt={{if @model.caption @model.caption 'Image'}}
            />
          {{else}}
            <div class='placeholder-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <circle cx='8.5' cy='8.5' r='1.5' />
                <polyline points='21,15 16,10 5,21' />
              </svg>
            </div>
          {{/if}}
        </div>
        <div class='strip-content'>
          <div class='primary-text'>{{if
              @model.caption
              @model.caption
              'Untitled Image'
            }}</div>
          <div class='tertiary-text'>{{if
              @model.imageUrl
              'Image loaded'
              'No image'
            }}</div>
        </div>
      </div>

      {{! Tile Format: Vertical card }}
      <div class='tile-format'>
        <div class='tile-image'>
          {{#if @model.imageUrl}}
            <img
              src={{@model.imageUrl}}
              alt={{if @model.caption @model.caption 'Image'}}
            />
          {{else}}
            <div class='tile-placeholder'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <circle cx='8.5' cy='8.5' r='1.5' />
                <polyline points='21,15 16,10 5,21' />
              </svg>
            </div>
          {{/if}}
        </div>
        <div class='tile-content'>
          <div class='primary-text'>{{if
              @model.caption
              @model.caption
              'Untitled Image'
            }}</div>
        </div>
      </div>

      {{! Card Format: Full layout }}
      <div class='card-format'>
        <div class='card-image'>
          {{#if @model.imageUrl}}
            <img
              src={{@model.imageUrl}}
              alt={{if @model.caption @model.caption 'Image'}}
            />
          {{else}}
            <div class='card-placeholder'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <circle cx='8.5' cy='8.5' r='1.5' />
                <polyline points='21,15 16,10 5,21' />
              </svg>
              <span>No image</span>
            </div>
          {{/if}}
        </div>
        <div class='card-content'>
          <div class='primary-text'>{{if
              @model.caption
              @model.caption
              'Untitled Image'
            }}</div>
          {{#if @fields.position}}
            <div class='card-position'>
              <@fields.position />
            </div>
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      .fitted-container {
        width: 100%;
        height: 100%;
      }

      /* Hide all by default */
      .badge-format,
      .strip-format,
      .tile-format,
      .card-format {
        display: none;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
      }

      /* Badge Format: ≤150px width, ≤169px height */
      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
          align-items: center;
        }
      }

      .image-badge {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
      }

      .image-badge img {
        width: 32px;
        height: 32px;
        object-fit: cover;
        border-radius: 4px;
      }

      .placeholder-icon {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        border-radius: 4px;
        color: #9ca3af;
      }

      .placeholder-icon svg {
        width: 16px;
        height: 16px;
      }

      .badge-text {
        flex: 1;
        min-width: 0;
      }

      /* Strip Format: >150px width, ≤169px height */
      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
          align-items: center;
        }
      }

      .strip-format {
        gap: 0.75rem;
      }

      .strip-image {
        flex-shrink: 0;
      }

      .strip-image img {
        width: 40px;
        height: 40px;
        object-fit: cover;
        border-radius: 6px;
      }

      .strip-content {
        flex: 1;
        min-width: 0;
      }

      /* Tile Format: ≤399px width, ≥170px height */
      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
          flex-direction: column;
        }
      }

      .tile-image {
        flex: 1.618;
        min-height: 0;
      }

      .tile-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 6px;
      }

      .tile-placeholder,
      .card-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        color: #9ca3af;
        border-radius: 6px;
        gap: 0.5rem;
      }

      .tile-placeholder svg,
      .card-placeholder svg {
        width: 32px;
        height: 32px;
      }

      .tile-content {
        flex: 1;
        display: flex;
        align-items: center;
        margin-top: 0.5rem;
      }

      /* Card Format: ≥400px width, ≥170px height */
      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
          flex-direction: column;
        }
      }

      /* Compact card: horizontal split at golden ratio */
      @container (min-width: 400px) and (height: 170px) {
        .card-format {
          flex-direction: row;
          gap: 1rem;
        }
        .card-format > * {
          display: flex;
          flex-direction: column;
        }
        .card-format > *:first-child {
          flex: 1.618;
        }
        .card-format > *:last-child {
          flex: 1;
        }
      }

      .card-image {
        flex: 1.618;
        min-height: 0;
      }

      .card-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 8px;
      }

      .card-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.75rem;
      }

      .card-position {
        margin-top: auto;
      }

      /* Typography hierarchy */
      .primary-text {
        font-size: 1em;
        font-weight: 600;
        color: rgba(0, 0, 0, 0.95);
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tertiary-text {
        font-size: 0.75em;
        font-weight: 400;
        color: rgba(0, 0, 0, 0.7);
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

export class ImageNode extends BoardItem {
  static displayName = 'Image Node';

  @field imageUrl = contains(UrlField);
  @field caption = contains(StringField);

  static isolated = IsolatedImageNode;
  static embedded = EmbeddedImageNode;
  static fitted = FittedImageNode;
}

class EmbeddedPostitNote extends Component<typeof PostitNote> {
  @tracked isEditing = false; // ²¹⁸ Track editing state
  @tracked originalContent = ''; // ²¹⁹ Store original content for cancel

  // ²⁴¹ Format content to handle line breaks properly
  formatContentLines(content: string) {
    if (!content) return [];

    // Split on newlines and handle double newlines as paragraph breaks
    const lines = content.split('\n');
    const formattedLines: Array<{ text: string; isEmpty: boolean }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim() === '') {
        // Empty line - add a break
        formattedLines.push({ text: '', isEmpty: true });
      } else {
        // Non-empty line
        formattedLines.push({ text: line, isEmpty: false });
      }
    }

    return formattedLines;
  }

  @action
  startEditing(event: Event) {
    // ²²⁰ Start editing mode with contentEditable
    event.stopPropagation();
    this.isEditing = true;
    this.originalContent = this.args.model?.content || '';

    // Focus the contentEditable element after it renders
    setTimeout(() => {
      const editableDiv = document.querySelector(
        '.note-content-editable',
      ) as HTMLDivElement;
      if (editableDiv) {
        editableDiv.focus();
        // Select all text for easy replacement
        const range = document.createRange();
        range.selectNodeContents(editableDiv);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }, 10);
  }

  @action
  saveEdit() {
    // ²²¹ Save the edited content from contentEditable
    const editableDiv = document.querySelector(
      '.note-content-editable',
    ) as HTMLDivElement;
    if (editableDiv && this.args.model) {
      this.args.model.content = editableDiv.textContent || '';
    }
    this.isEditing = false;
  }

  @action
  cancelEdit() {
    // ²²² Cancel editing and restore original content
    this.isEditing = false;
    // Original content is restored when we exit editing mode
  }

  @action
  handleKeydown(event: KeyboardEvent) {
    // ²²³ Handle keyboard shortcuts for contentEditable
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      // Ctrl/Cmd + Enter to save
      event.preventDefault();
      this.saveEdit();
    } else if (event.key === 'Escape') {
      // Escape to cancel
      event.preventDefault();
      this.cancelEdit();
    }
  }

  @action
  handleInput(event: Event) {
    // ²²⁴ Handle content changes to prevent empty state
    const target = event.target as HTMLDivElement;
    if (target.textContent?.trim() === '') {
      target.innerHTML = ''; // Clean up any residual HTML
    }
  }

  @action
  handleDisplayKeydown(event: KeyboardEvent) {
    // Provide keyboard access when the note is in display mode
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.startEditing(event);
    }
  }

  <template>
    <div
      class='postit-note'
      style={{htmlSafe
        (concat 'background-color: ' (if @model.color @model.color '#fef08a'))
      }}
    >
      {{#if this.isEditing}}
        {{! ²²⁵ Editing mode with contentEditable }}
        <div class='editing-mode'>
          <div
            class='note-content-editable'
            contenteditable='true'
            placeholder='Enter your note...'
            role='textbox'
            tabindex='0'
            {{on 'keydown' this.handleKeydown}}
            {{on 'input' this.handleInput}}
            {{on 'blur' this.saveEdit}}
          >{{@model.content}}</div>
          <div class='edit-hint'>
            <span>Ctrl+Enter to save • Esc to cancel</span>
          </div>
        </div>
      {{else}}
        {{! ²²⁶ Display mode with click to edit }}
        <button
          type='button'
          class='note-content'
          {{on 'click' this.startEditing}}
          {{on 'keydown' this.handleDisplayKeydown}}
        >
          {{#if @model.content}}
            {{#each (this.formatContentLines @model.content) as |line|}}
              <span
                class='note-line{{if line.isEmpty " note-line--empty"}}'
                aria-hidden={{line.isEmpty}}
              >
                {{unless line.isEmpty line.text}}
              </span>
            {{/each}}
          {{else}}
            <span class='note-placeholder'>Click to add note...</span>
          {{/if}}
        </button>
      {{/if}}
    </div>

    <style scoped>
      .postit-note {
        padding: 0.75rem; /* ²²⁷ Reduced top padding from 1rem to 0.75rem */
        background: #fef08a;
        border-radius: 4px;
        box-shadow:
          0 1px 3px rgba(0, 0, 0, 0.1),
          0 1px 2px rgba(0, 0, 0, 0.06);
        position: relative;
        cursor: pointer; /* ²²⁸ Indicate clickability */
        transition: box-shadow 0.15s ease;
        min-height: 2rem; /* ²²⁹ Minimum height for empty notes */
      }

      .postit-note:hover {
        box-shadow:
          0 2px 6px rgba(0, 0, 0, 0.15),
          0 2px 4px rgba(0, 0, 0, 0.1); /* ²³⁰ Hover effect */
      }

      .postit-note::before {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        width: 0;
        height: 0;
        border-left: 20px solid transparent;
        border-top: 20px solid rgba(0, 0, 0, 0.1);
        border-radius: 0 4px 0 0;
      }

      .note-content {
        display: block;
        width: 100%;
        padding: 0;
        margin: 0;
        background: none;
        border: none;
        text-align: left;
        color: #374151;
        font-family: 'Comic Sans MS', cursive, sans-serif;
        font-size: 0.875rem;
        line-height: 1.4;
        word-wrap: break-word;
        min-height: 1.2em;
        cursor: pointer;
      }

      .note-content:focus-visible {
        outline: 2px solid #3b82f6; /* ²³² Accessibility focus indicator */
        outline-offset: 2px;
      }

      .note-line {
        display: block;
        white-space: pre-wrap;
      }

      .note-line--empty::after {
        content: '\\00a0';
      }

      .note-placeholder {
        color: rgba(17, 24, 39, 0.65);
      }

      /* ²³³ Editing mode styles with contentEditable */
      .editing-mode {
        position: relative;
        width: 100%;
        min-height: 100%; /* Allow growth */
        display: flex;
        flex-direction: column;
      }

      .note-content-editable {
        width: 100%;
        min-height: 2rem; /* ²³⁴ Start with minimum height */
        border: none;
        background: transparent;
        font-family: 'Comic Sans MS', cursive, sans-serif;
        font-size: 0.875rem;
        line-height: 1.4;
        color: #374151;
        outline: none;
        padding: 0;
        margin: 0;
        word-wrap: break-word;
        white-space: pre-wrap; /* ²³⁵ Preserve line breaks and allow wrapping */
        overflow-wrap: break-word;
        /* ²³⁶ Allow the contentEditable to grow naturally */
        resize: none;
        overflow: visible;
      }

      .note-content-editable:empty::before {
        content: attr(placeholder);
        color: #9ca3af;
        font-style: italic;
        pointer-events: none;
      }

      .note-content-editable:focus {
        outline: none; /* ²³⁷ Removed focus outline for cleaner editing experience */
      }

      /* ²³⁸ Auto-growing behavior with smooth transitions */
      .note-content-editable {
        transition: min-height 0.1s ease;
      }

      .edit-hint {
        position: absolute;
        bottom: -24px;
        left: 0;
        right: 0;
        text-align: center;
        font-size: 0.625rem;
        color: #6b7280;
        background: rgba(255, 255, 255, 0.9);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        backdrop-filter: blur(4px);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        pointer-events: none; /* ²³⁹ Don't interfere with contentEditable focus */
        z-index: 10;
      }

      /* ²⁴⁰ Responsive editing in different container sizes */
      @container (max-height: 100px) {
        .note-content-editable {
          min-height: 1.5rem;
          font-size: 0.75rem;
        }

        .edit-hint {
          font-size: 0.5rem;
          padding: 0.125rem 0.25rem;
        }
      }

      @container (max-width: 200px) {
        .edit-hint {
          display: none; /* Hide hint in very narrow containers */
        }
      }
    </style>
  </template>
}

class FittedPostitNote extends Component<typeof PostitNote> {
  <template>
    <div class='fitted-container'>
      {{! Badge Format }}
      <div class='badge-format'>
        <div
          class='note-badge'
          style={{htmlSafe
            (concat
              'background-color: ' (if @model.color @model.color '#fef08a')
            )
          }}
        >
          <div class='badge-icon'>📝</div>
          <div class='badge-text'>
            <div class='primary-text'>{{if @model.content 'Note' 'Note'}}</div>
          </div>
        </div>
      </div>

      {{! Strip Format }}
      <div class='strip-format'>
        <div
          class='strip-indicator'
          style={{htmlSafe
            (concat
              'background-color: ' (if @model.color @model.color '#fef08a')
            )
          }}
        >
          📝
        </div>
        <div class='strip-content'>
          <div class='primary-text'>{{if
              @model.content
              @model.content
              'Empty note'
            }}</div>
          <div class='tertiary-text'>Sticky note</div>
        </div>
      </div>

      {{! Tile Format }}
      <div class='tile-format'>
        <div
          class='tile-note'
          style={{htmlSafe
            (concat
              'background-color: ' (if @model.color @model.color '#fef08a')
            )
          }}
        >
          <div class='tile-corner'></div>
          <div class='tile-content'>
            <div class='primary-text'>Note</div>
            <div class='secondary-text'>{{if
                @model.content
                @model.content
                'Click to add content...'
              }}</div>
          </div>
        </div>
      </div>

      {{! Card Format }}
      <div class='card-format'>
        <div
          class='card-note'
          style={{htmlSafe
            (concat
              'background-color: ' (if @model.color @model.color '#fef08a')
            )
          }}
        >
          <div class='card-corner'></div>
          <div class='card-header'>
            <div class='primary-text'>Sticky Note</div>
            <div
              class='color-dot'
              style={{htmlSafe
                (concat
                  'background-color: ' (if @model.color @model.color '#fef08a')
                )
              }}
            ></div>
          </div>
          <div class='card-body'>
            <div class='secondary-text'>{{if
                @model.content
                @model.content
                'Empty note - click to add content'
              }}</div>
          </div>
        </div>
        {{#if @fields.position}}
          <div class='card-position'>
            <@fields.position />
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .fitted-container {
        width: 100%;
        height: 100%;
      }

      /* Hide all by default */
      .badge-format,
      .strip-format,
      .tile-format,
      .card-format {
        display: none;
        width: 100%;
        height: 100%;
        box-sizing: border-box; /* ¹⁹² Remove padding to allow full space usage */
      }

      /* Badge Format */
      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
          align-items: center;
        }
      }

      .note-badge {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        position: relative;
      }

      .note-badge::before {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        width: 0;
        height: 0;
        border-left: 8px solid transparent;
        border-top: 8px solid rgba(0, 0, 0, 0.1);
      }

      .badge-icon {
        font-size: 1rem;
        flex-shrink: 0;
      }

      /* Strip Format */
      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
          align-items: center;
        }
      }

      .strip-format {
        gap: 0.75rem;
      }

      .strip-indicator {
        width: 40px;
        height: 40px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.25rem;
        position: relative;
        flex-shrink: 0;
      }

      .strip-indicator::before {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        width: 0;
        height: 0;
        border-left: 10px solid transparent;
        border-top: 10px solid rgba(0, 0, 0, 0.1);
        border-radius: 0 6px 0 0;
      }

      .strip-content {
        flex: 1;
        min-width: 0;
      }

      /* Tile Format */
      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
        }
      }

      .tile-note {
        width: 100%;
        height: 100%;
        border-radius: 8px;
        padding: 1rem;
        position: relative;
        display: flex;
        flex-direction: column;
      }

      .tile-corner {
        position: absolute;
        top: 0;
        right: 0;
        width: 0;
        height: 0;
        border-left: 16px solid transparent;
        border-top: 16px solid rgba(0, 0, 0, 0.1);
        border-radius: 0 8px 0 0;
      }

      .tile-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      /* Card Format */
      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
          flex-direction: column;
        }
      }

      .card-note {
        flex: 1;
        border-radius: 12px;
        padding: 1rem;
        position: relative;
        display: flex;
        flex-direction: column;
        margin-bottom: 0.75rem;
      }

      .card-corner {
        position: absolute;
        top: 0;
        right: 0;
        width: 0;
        height: 0;
        border-left: 24px solid transparent;
        border-top: 24px solid rgba(0, 0, 0, 0.1);
        border-radius: 0 12px 0 0;
      }

      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;
      }

      .color-dot {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid rgba(0, 0, 0, 0.2);
      }

      .card-body {
        flex: 1;
      }

      .card-position {
        margin-top: auto;
      }

      /* Typography hierarchy */
      .primary-text {
        font-size: 1em;
        font-weight: 600;
        color: rgba(0, 0, 0, 0.95);
        line-height: 1.2;
        font-family: 'Comic Sans MS', cursive, sans-serif;
      }

      .secondary-text {
        font-size: 0.875em;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.85);
        line-height: 1.3;
        font-family: 'Comic Sans MS', cursive, sans-serif;
      }

      .tertiary-text {
        font-size: 0.75em;
        font-weight: 400;
        color: rgba(0, 0, 0, 0.7);
        line-height: 1.4;
      }

      /* Text overflow handling */
      .badge-text .primary-text,
      .strip-content .primary-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tile-content .secondary-text,
      .card-body .secondary-text {
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        white-space: pre-line;
      }
    </style>
  </template>
}

// ³⁰ Postit note with color field
export class PostitNote extends BoardItem {
  static displayName = 'Postit Note';

  @field content = contains(StringField);
  @field color = contains(StringField);

  static embedded = EmbeddedPostitNote;

  static fitted = FittedPostitNote;
}

// ³¹ External card wrapper for linking other cards
export class ExternalCard extends BoardItem {
  static displayName = 'External Card';

  @field externalCard = linksTo(CardDef);
  @field caption = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='external-card-container'>
        {{! ¹⁰⁰ Direct rendering of linked card for full interactivity }}
        {{#if @model.externalCard}}
          {{#let @model.externalCard as |linkedCard|}}
            {{! @glint-ignore }}
            {{#if (and linkedCard (get linkedCard 'constructor'))}}
              {{#let (get linkedCard 'constructor') as |LinkedCtor|}}
                {{#if (get LinkedCtor 'embedded')}}
                  {{#let (get LinkedCtor 'embedded') as |Embedded|}}
                    <div class='linked-card-wrapper'>
                      {{#if @model.caption}}
                        <div class='caption-overlay'>{{@model.caption}}</div>
                      {{/if}}
                      <div class='interactive-content'>
                        {{! @glint-ignore }}
                        {{component Embedded model=linkedCard}}
                      </div>
                    </div>
                  {{/let}}
                {{else}}
                  <div class='missing-format-error'>
                    <div class='error-icon'>⚠️</div>
                    <div class='error-text'>Linked card missing embedded format</div>
                  </div>
                {{/if}}
              {{/let}}
            {{else}}
              <div class='missing-card-error'>
                <div class='error-icon'>❌</div>
                <div class='error-text'>Linked card not available</div>
              </div>
            {{/if}}
          {{/let}}
        {{else}}
          <div class='no-card-placeholder'>
            <div class='placeholder-icon'>🔗</div>
            <div class='placeholder-text'>
              <div class='placeholder-title'>{{if
                  @model.caption
                  @model.caption
                  'External Card'
                }}</div>
              <div class='placeholder-subtitle'>No card linked - click to edit</div>
            </div>
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* ¹⁰¹ Container for external card with interactive content */
        .external-card-container {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 8px;
          overflow: hidden;
        }

        /* Linked card wrapper allows full interactivity */
        .linked-card-wrapper {
          position: relative;
          width: 100%;
          height: 100%;
          /* Enable all pointer events for linked card content */
          pointer-events: auto;
        }

        /* Interactive content passes ALL events to the embedded card */
        .interactive-content {
          width: 100%;
          height: 100%;
          /* CRITICAL: Ensure all events pass through to the 3D model */
          pointer-events: auto;
          position: relative;
        }

        /* Caption overlay - positioned to not interfere with card content */
        .caption-overlay {
          position: absolute;
          top: 0.5rem;
          left: 0.5rem;
          background: rgba(139, 92, 246, 0.95);
          color: white;
          padding: 0.25rem 0.75rem;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
          z-index: 10;
          backdrop-filter: blur(4px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          /* CRITICAL: Caption must not block interaction with 3D model */
          pointer-events: none;
        }

        /* Error states */
        .missing-format-error,
        .missing-card-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          background: #fef2f2;
          border: 2px dashed #f87171;
          border-radius: 8px;
          color: #dc2626;
          text-align: center;
          padding: 1rem;
        }

        .error-icon {
          font-size: 1.5rem;
          margin-bottom: 0.5rem;
        }

        .error-text {
          font-size: 0.875rem;
          font-weight: 500;
        }

        /* Placeholder for unlinked cards */
        .no-card-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          background: rgba(139, 92, 246, 0.1);
          border: 2px dashed #8b5cf6;
          border-radius: 8px;
          padding: 1rem;
          text-align: center;
        }

        .placeholder-icon {
          font-size: 2rem;
          color: #8b5cf6;
          margin-bottom: 0.5rem;
        }

        .placeholder-title {
          font-size: 1rem;
          font-weight: 600;
          color: #374151;
          margin-bottom: 0.25rem;
        }

        .placeholder-subtitle {
          font-size: 0.875rem;
          color: #6b7280;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        {{! Badge Format }}
        <div class='badge-format'>
          <div class='external-badge-placeholder'>
            <div class='placeholder-icon'>🔗</div>
            <div class='badge-text'>
              <div class='primary-text'>{{if
                  @model.caption
                  @model.caption
                  'External'
                }}</div>
            </div>
          </div>
        </div>

        {{! Strip Format }}
        <div class='strip-format'>
          <div class='strip-placeholder'>
            <div class='strip-icon'>🔗</div>
            <div class='strip-content'>
              <div class='primary-text'>{{if
                  @model.caption
                  @model.caption
                  'External Card'
                }}</div>
              <div class='tertiary-text'>{{if
                  @model.externalCard.title
                  @model.externalCard.title
                  'No card linked'
                }}</div>
            </div>
          </div>
        </div>

        {{! Tile Format }}
        <div class='tile-format'>
          {{! ¹⁰² Tile format with interactive content }}
          {{#if @model.externalCard}}
            {{! @glint-ignore }}
            {{#let @model.externalCard as |linkedCard|}}
              {{! @glint-ignore }}
              {{! @glint-ignore }}
              {{#if (and linkedCard (get linkedCard 'constructor'))}}
                {{! @glint-ignore }}
                {{#let (get linkedCard 'constructor') as |LinkedCtor|}}
                  {{#if (get LinkedCtor 'fitted')}}
                    {{#let (get LinkedCtor 'fitted') as |Fitted|}}
                      <div class='tile-interactive-wrapper full-space-content'>
                        {{! ¹⁸⁸ Add full-space-content class }}
                        {{#if @model.caption}}
                          <div class='tile-caption'>{{@model.caption}}</div>
                        {{/if}}
                        {{! @glint-ignore }}
                        {{component Fitted model=linkedCard}}
                      </div>
                    {{/let}}
                  {{else if (get LinkedCtor 'embedded')}}
                    {{! @glint-ignore }}
                    {{#let (get LinkedCtor 'embedded') as |Embedded|}}
                      <div class='tile-interactive-wrapper full-space-content'>
                        {{! ¹⁸⁹ Add full-space-content class }}
                        {{#if @model.caption}}
                          <div class='tile-caption'>{{@model.caption}}</div>
                        {{/if}}
                        {{! @glint-ignore }}
                        {{component Embedded model=linkedCard}}
                      </div>
                    {{/let}}
                  {{else}}
                    <div class='tile-error'>Missing formats</div>
                  {{/if}}
                {{/let}}
              {{else}}
                <div class='tile-error'>Card unavailable</div>
              {{/if}}
            {{/let}}
          {{else}}
            <div class='tile-placeholder'>
              <div class='tile-icon'>🔗</div>
              <div class='tile-content'>
                <div class='primary-text'>{{if
                    @model.caption
                    @model.caption
                    'External Card'
                  }}</div>
                <div class='secondary-text'>Click to link an external card</div>
              </div>
            </div>
          {{/if}}
        </div>

        {{! Card Format }}
        <div class='card-format'>
          {{! ¹⁰³ Card format with interactive content }}
          {{#if @model.externalCard}}
            {{! @glint-ignore }}
            {{#let @model.externalCard as |linkedCard|}}
              {{! @glint-ignore }}
              {{#if (and linkedCard (get linkedCard 'constructor'))}}
                {{#let (get linkedCard 'constructor') as |LinkedCtor|}}
                  {{#if (get LinkedCtor 'fitted')}}
                    {{#let (get LinkedCtor 'fitted') as |Fitted|}}
                      <div class='card-interactive-wrapper full-space-content'>
                        {{! ¹⁹⁰ Add full-space-content class }}
                        {{#if @model.caption}}
                          <div class='card-caption'>{{@model.caption}}</div>
                        {{/if}}
                        {{! @glint-ignore }}
                        {{component Fitted model=linkedCard}}
                      </div>
                    {{/let}}
                  {{else if (get LinkedCtor 'embedded')}}
                    {{#let (get LinkedCtor 'embedded') as |Embedded|}}
                      <div class='card-interactive-wrapper full-space-content'>
                        {{! ¹⁹¹ Add full-space-content class }}
                        {{#if @model.caption}}
                          <div class='card-caption'>{{@model.caption}}</div>
                        {{/if}}
                        {{! @glint-ignore }}
                        {{component Embedded model=linkedCard}}
                      </div>
                    {{/let}}
                  {{else}}
                    <div class='card-error'>
                      <div class='error-icon'>⚠️</div>
                      <div class='error-text'>Linked card missing display
                        formats</div>
                    </div>
                  {{/if}}
                {{/let}}
              {{else}}
                <div class='card-error'>
                  <div class='error-icon'>❌</div>
                  <div class='error-text'>Linked card not available</div>
                </div>
              {{/if}}
            {{/let}}
          {{else}}
            <div class='card-placeholder'>
              <div class='card-icon'>🔗</div>
              <div class='card-content'>
                <div class='primary-text'>{{if
                    @model.caption
                    @model.caption
                    'External Card'
                  }}</div>
                <div class='secondary-text'>No external card is currently linked
                  to this board item.</div>
                <div class='tertiary-text'>Use the edit panel to select an
                  external card to display here.</div>
              </div>
            </div>
          {{/if}}

          {{#if @fields.position}}
            <div class='card-position'>
              <@fields.position />
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .fitted-container {
          width: 100%;
          height: 100%;
        }

        /* Hide all by default */
        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box; /* ¹⁹³ Removed padding to allow timer to use full allocated height */
        }

        /* Badge Format: ≤150px width, ≤169px height */
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            align-items: center;
          }
        }

        .external-badge-placeholder {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          padding: 0.375rem 0.75rem;
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
          border-radius: 6px;
          color: white;
          box-shadow: 0 2px 4px rgba(139, 92, 246, 0.3);
        }

        .placeholder-icon {
          font-size: 1.125rem;
          flex-shrink: 0;
        }

        .badge-text {
          flex: 1;
          min-width: 0;
        }

        /* Strip Format: >150px width, ≤169px height */
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
          }
        }

        .strip-placeholder {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          width: 100%;
          background: white;
          border: 2px solid #8b5cf6;
          border-radius: 8px;
          padding: 0.5rem;
        }

        .strip-icon {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
          font-size: 1.5rem;
          color: white;
          flex-shrink: 0;
        }

        .strip-content {
          flex: 1;
          min-width: 0;
          color: #374151;
        }

        /* Tile Format: ≤399px width, ≥170px height */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
          }
        }

        .tile-placeholder {
          width: 100%;
          height: 100%;
          background: white;
          border: 3px dashed #8b5cf6;
          border-radius: 12px;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .tile-icon {
          font-size: 2.5rem;
          margin-bottom: 1rem;
          color: #8b5cf6;
        }

        .tile-content {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          color: #374151;
        }

        /* Card Format: ≥400px width, ≥170px height */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        .card-placeholder {
          flex: 1;
          background: white;
          border: 3px dashed #8b5cf6;
          border-radius: 16px;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          margin-bottom: 0.75rem;
        }

        .card-icon {
          font-size: 3.5rem;
          margin-bottom: 1.5rem;
          color: #8b5cf6;
        }

        .card-content {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          max-width: 24rem;
          color: #374151;
        }

        .card-position {
          margin-top: auto;
        }

        /* Typography hierarchy */
        .primary-text {
          font-size: 1em;
          font-weight: 600;
          color: currentColor;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .secondary-text {
          font-size: 0.875em;
          font-weight: 500;
          color: currentColor;
          line-height: 1.3;
        }

        .tertiary-text {
          font-size: 0.75em;
          font-weight: 400;
          color: currentColor;
          line-height: 1.4;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

// ³² Countdown timer with datetime field
export class EmbeddedCountdownTimer extends Component<typeof CountdownTimer> {
  @tracked currentTime = new Date();
  @tracked isRunning = false; // ¹¹⁵ Add test controls for event debugging
  private timerInterval: number | null = null;

  updateTime = () => {
    if (this.isRunning) {
      this.currentTime = new Date();
    }
  };

  constructor(owner: any, args: any) {
    super(owner, args);
    // Only start timer in browser environment
    if (typeof window !== 'undefined') {
      this.timerInterval = setInterval(
        this.updateTime,
        1000,
      ) as unknown as number;
    }
  }

  // ¹¹⁶ Test actions to debug event flow
  @action
  startTimer() {
    this.isRunning = true;
  }

  @action
  stopTimer() {
    this.isRunning = false;
  }

  get timeRemaining() {
    if (!this.args.model?.targetDate) return null;

    const target = new Date(this.args.model.targetDate);
    const now = this.currentTime;
    const diff = target.getTime() - now.getTime();

    if (diff <= 0) return { expired: true };

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return { days, hours, minutes, seconds, expired: false };
  }

  willDestroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    super.willDestroy();
  }

  <template>
    <div class='countdown-timer'>
      <div class='timer-title'>
        {{if @model.title @model.title 'Countdown'}}
        {{! ¹¹⁷ Event flow debug indicator }}
        {{#if this.isRunning}}
          <span class='running-indicator'>● RUNNING</span>
        {{else}}
          <span class='stopped-indicator'>○ STOPPED</span>
        {{/if}}
      </div>

      {{! ¹¹⁸ Add test controls to debug event handling }}
      <div class='test-controls'>
        <button
          class='test-btn start-btn'
          {{on 'click' this.startTimer}}
          type='button'
        >
          ▶ START
        </button>
        <button
          class='test-btn stop-btn'
          {{on 'click' this.stopTimer}}
          type='button'
        >
          ⏸ STOP
        </button>
      </div>

      {{#if this.timeRemaining}}
        {{#if this.timeRemaining.expired}}
          <div class='timer-expired'>⏰ TIME'S UP!</div>
        {{else}}
          <div class='timer-display'>
            <div class='time-unit'>
              <span class='number'>{{this.timeRemaining.days}}</span>
              <span class='label'>Days</span>
            </div>
            <div class='time-unit'>
              <span class='number'>{{this.timeRemaining.hours}}</span>
              <span class='label'>Hours</span>
            </div>
            <div class='time-unit'>
              <span class='number'>{{this.timeRemaining.minutes}}</span>
              <span class='label'>Min</span>
            </div>
            <div class='time-unit'>
              <span class='number'>{{this.timeRemaining.seconds}}</span>
              <span class='label'>Sec</span>
            </div>
          </div>
        {{/if}}
      {{else}}
        <div class='timer-placeholder'>Set target date</div>
      {{/if}}
    </div>

    <style scoped>
      .countdown-timer {
        padding: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 12px;
        color: white;
        text-align: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .timer-title {
        font-size: 1.125rem;
        font-weight: 600;
        margin-bottom: 16px;
      }

      .timer-display {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }

      .time-unit {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .time-unit .number {
        font-size: 1.5rem;
        font-weight: 700;
        line-height: 1;
      }

      .time-unit .label {
        font-size: 0.75rem;
        opacity: 0.9;
        margin-top: 4px;
      }

      .timer-expired {
        font-size: 1.25rem;
        font-weight: 700;
        color: #fbbf24;
        animation: pulse 1s infinite;
      }

      .timer-placeholder {
        color: rgba(255, 255, 255, 0.8);
        font-style: italic;
      }

      /* ¹¹⁹ Test controls for event debugging */
      .test-controls {
        display: flex;
        gap: 0.5rem;
        margin: 0.75rem 0;
        justify-content: center;
      }

      .test-btn {
        padding: 0.375rem 0.75rem;
        font-size: 0.75rem;
        font-weight: 600;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        color: white;
        min-width: 4rem;
      }

      .start-btn {
        background: #22c55e;
      }

      .start-btn:hover {
        background: #16a34a;
        transform: translateY(-1px);
      }

      .stop-btn {
        background: #ef4444;
      }

      .stop-btn:hover {
        background: #dc2626;
        transform: translateY(-1px);
      }

      .debug-btn {
        background: #8b5cf6;
      }

      .debug-btn:hover {
        background: #7c3aed;
        transform: translateY(-1px);
      }

      .running-indicator {
        color: #22c55e;
        font-size: 0.75rem;
        font-weight: 600;
        margin-left: 0.5rem;
      }

      .stopped-indicator {
        color: #ef4444;
        font-size: 0.75rem;
        font-weight: 600;
        margin-left: 0.5rem;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }
    </style>
  </template>
}

export class FittedCountdownTimer extends Component<typeof CountdownTimer> {
  @tracked currentTime = new Date();
  private timerInterval: number | null = null;

  updateTime = () => {
    this.currentTime = new Date();
  };

  constructor(owner: any, args: any) {
    super(owner, args);
    if (typeof window !== 'undefined') {
      this.timerInterval = setInterval(
        this.updateTime,
        1000,
      ) as unknown as number;
    }
  }

  get timeRemaining() {
    if (!this.args.model?.targetDate) return null;

    const target = new Date(this.args.model.targetDate);
    const now = this.currentTime;
    const diff = target.getTime() - now.getTime();

    if (diff <= 0) return { expired: true };

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return { days, hours, minutes, seconds, expired: false };
  }

  willDestroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    super.willDestroy();
  }

  <template>
    <div class='fitted-container'>
      {{! Badge Format }}
      <div class='badge-format'>
        <div class='timer-badge'>
          <div class='badge-icon'>⏱️</div>
          <div class='badge-text'>
            <div class='primary-text'>{{if
                @model.title
                @model.title
                'Timer'
              }}</div>
          </div>
          {{#if this.timeRemaining}}
            {{#if this.timeRemaining.expired}}
              <div class='badge-status expired'>⏰</div>
            {{else}}
              <div
                class='badge-status active'
              >{{this.timeRemaining.days}}d</div>
            {{/if}}
          {{/if}}
        </div>
      </div>

      {{! Strip Format }}
      <div class='strip-format'>
        <div class='strip-icon'>⏱️</div>
        <div class='strip-content'>
          <div class='primary-text'>{{if
              @model.title
              @model.title
              'Countdown Timer'
            }}</div>
          {{#if this.timeRemaining}}
            {{#if this.timeRemaining.expired}}
              <div class='tertiary-text expired'>Time's up!</div>
            {{else}}
              <div class='tertiary-text'>{{this.timeRemaining.days}}d
                {{this.timeRemaining.hours}}h
                {{this.timeRemaining.minutes}}m</div>
            {{/if}}
          {{else}}
            <div class='tertiary-text'>No target date</div>
          {{/if}}
        </div>
      </div>

      {{! Tile Format }}
      <div class='tile-format'>
        <div class='tile-timer'>
          <div class='tile-header'>
            <div class='primary-text'>{{if
                @model.title
                @model.title
                'Timer'
              }}</div>
            <div class='timer-icon'>⏱️</div>
          </div>
          <div class='tile-body'>
            {{#if this.timeRemaining}}
              {{#if this.timeRemaining.expired}}
                <div class='tile-expired'>
                  <div class='expired-large'>⏰</div>
                  <div class='secondary-text'>Time's Up!</div>
                </div>
              {{else}}
                <div class='tile-countdown'>
                  <div class='time-row'>
                    <div class='time-compact'>
                      <span
                        class='number-compact'
                      >{{this.timeRemaining.days}}</span>
                      <span class='label-compact'>d</span>
                    </div>
                    <div class='time-compact'>
                      <span
                        class='number-compact'
                      >{{this.timeRemaining.hours}}</span>
                      <span class='label-compact'>h</span>
                    </div>
                  </div>
                  <div class='time-row'>
                    <div class='time-compact'>
                      <span
                        class='number-compact'
                      >{{this.timeRemaining.minutes}}</span>
                      <span class='label-compact'>m</span>
                    </div>
                    <div class='time-compact'>
                      <span
                        class='number-compact'
                      >{{this.timeRemaining.seconds}}</span>
                      <span class='label-compact'>s</span>
                    </div>
                  </div>
                </div>
              {{/if}}
            {{else}}
              <div class='tile-placeholder'>
                <div class='placeholder-icon'>📅</div>
                <div class='tertiary-text'>No date set</div>
              </div>
            {{/if}}
          </div>
        </div>
      </div>

      {{! Card Format }}
      <div class='card-format'>
        <div class='card-timer'>
          <div class='card-header'>
            <div class='primary-text'>{{if
                @model.title
                @model.title
                'Countdown Timer'
              }}</div>
            <div class='timer-icon'>⏱️</div>
          </div>
          <div class='card-body'>
            {{#if this.timeRemaining}}
              {{#if this.timeRemaining.expired}}
                <div class='card-expired'>
                  <div class='expired-icon'>⏰</div>
                  <div class='secondary-text'>Time's Up!</div>
                  <div class='tertiary-text'>The countdown has ended</div>
                </div>
              {{else}}
                <div class='card-countdown'>
                  <div class='time-grid'>
                    <div class='time-unit-card'>
                      <span
                        class='number-card'
                      >{{this.timeRemaining.days}}</span>
                      <span class='label-card'>Days</span>
                    </div>
                    <div class='time-unit-card'>
                      <span
                        class='number-card'
                      >{{this.timeRemaining.hours}}</span>
                      <span class='label-card'>Hours</span>
                    </div>
                    <div class='time-unit-card'>
                      <span
                        class='number-card'
                      >{{this.timeRemaining.minutes}}</span>
                      <span class='label-card'>Min</span>
                    </div>
                    <div class='time-unit-card'>
                      <span
                        class='number-card'
                      >{{this.timeRemaining.seconds}}</span>
                      <span class='label-card'>Sec</span>
                    </div>
                  </div>
                </div>
              {{/if}}
            {{else}}
              <div class='card-placeholder'>
                <div class='placeholder-icon'>📅</div>
                <div class='secondary-text'>No target date set</div>
                <div class='tertiary-text'>Configure a date to start countdown</div>
              </div>
            {{/if}}
          </div>
        </div>
        {{#if @fields.position}}
          <div class='card-position'>
            <@fields.position />
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .fitted-container {
        width: 100%;
        height: 100%;
      }

      /* Hide all by default */
      .badge-format,
      .strip-format,
      .tile-format,
      .card-format {
        display: none;
        width: 100%;
        height: 100%;
        padding: clamp(0.1875rem, 2%, 0.625rem);
        box-sizing: border-box;
      }

      /* Badge Format */
      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
          align-items: center;
        }
      }

      .timer-badge {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.25rem 0.5rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 6px;
        color: white;
      }

      .badge-icon {
        font-size: 1rem;
        flex-shrink: 0;
      }

      .badge-text {
        flex: 1;
        min-width: 0;
      }

      .badge-status {
        font-size: 0.75rem;
        font-weight: 600;
        flex-shrink: 0;
      }

      .badge-status.expired {
        color: #fbbf24;
      }

      /* Strip Format */
      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
          align-items: center;
        }
      }

      .strip-format {
        gap: 0.75rem;
      }

      .strip-icon {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        font-size: 1.25rem;
        flex-shrink: 0;
      }

      .strip-content {
        flex: 1;
        min-width: 0;
      }

      /* Tile Format */
      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
        }
      }

      .tile-timer {
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 12px;
        padding: 1rem;
        color: white;
        display: flex;
        flex-direction: column;
      }

      .tile-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;
      }

      .timer-icon {
        font-size: 1.25rem;
        opacity: 0.9;
      }

      .tile-body {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .tile-countdown {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        align-items: center;
      }

      .time-row {
        display: flex;
        gap: 1rem;
      }

      .time-compact {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .number-compact {
        font-size: 1.5rem;
        font-weight: 700;
        line-height: 1;
      }

      .label-compact {
        font-size: 0.75rem;
        opacity: 0.9;
        margin-top: 0.25rem;
      }

      .tile-expired,
      .card-expired {
        text-align: center;
      }

      .expired-large {
        font-size: 2rem;
        margin-bottom: 0.5rem;
      }

      .tile-placeholder,
      .card-placeholder {
        text-align: center;
        opacity: 0.8;
      }

      .placeholder-icon {
        font-size: 1.5rem;
        margin-bottom: 0.5rem;
      }

      /* Card Format */
      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
          flex-direction: column;
        }
      }

      .card-timer {
        flex: 1;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 16px;
        padding: 1.5rem;
        color: white;
        display: flex;
        flex-direction: column;
        margin-bottom: 0.75rem;
      }

      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.5rem;
      }

      .card-body {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .time-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.75rem;
        width: 100%;
      }

      .time-unit-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 0.75rem 0.5rem;
      }

      .number-card {
        font-size: 1.25rem;
        font-weight: 700;
        line-height: 1;
      }

      .label-card {
        font-size: 0.75rem;
        opacity: 0.9;
        margin-top: 0.25rem;
      }

      .expired-icon {
        font-size: 2.5rem;
        margin-bottom: 0.75rem;
      }

      .card-position {
        margin-top: auto;
      }

      /* Typography hierarchy */
      .primary-text {
        font-size: 1em;
        font-weight: 600;
        color: currentColor;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .secondary-text {
        font-size: 0.875em;
        font-weight: 500;
        color: currentColor;
        line-height: 1.3;
      }

      .tertiary-text {
        font-size: 0.75em;
        font-weight: 400;
        color: currentColor;
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tertiary-text.expired {
        color: #fbbf24;
        font-weight: 600;
      }
    </style>
  </template>
}

export class IsolatedCountdownTimer extends Component<typeof CountdownTimer> {
  @tracked currentTime = new Date();
  private timerInterval: number | null = null;

  updateTime = () => {
    this.currentTime = new Date();
  };

  constructor(owner: any, args: any) {
    super(owner, args);
    if (typeof window !== 'undefined') {
      this.timerInterval = setInterval(
        this.updateTime,
        1000,
      ) as unknown as number;
    }
  }

  get timeRemaining() {
    if (!this.args.model?.targetDate) return null;

    const target = new Date(this.args.model.targetDate);
    const now = this.currentTime;
    const diff = target.getTime() - now.getTime();

    if (diff <= 0) return { expired: true };

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return { days, hours, minutes, seconds, expired: false };
  }

  get formattedTargetDate() {
    if (!this.args.model?.targetDate) return 'No date set';
    return new Date(this.args.model.targetDate).toLocaleString();
  }

  willDestroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    super.willDestroy();
  }

  <template>
    <div class='timer-isolated'>
      <div class='timer-stage'>
        <div class='large-timer'>
          <div class='timer-header'>
            <h1 class='timer-title'>{{if
                @model.title
                @model.title
                'Countdown Timer'
              }}</h1>
            <div class='target-date'>Target:
              {{this.formattedTargetDate}}</div>
          </div>

          <div class='timer-body'>
            {{#if this.timeRemaining}}
              {{#if this.timeRemaining.expired}}
                <div class='timer-expired-large'>
                  <div class='expired-icon'>⏰</div>
                  <div class='expired-text'>TIME'S UP!</div>
                  <div class='expired-subtitle'>The countdown has reached zero</div>
                </div>
              {{else}}
                <div class='timer-display-large'>
                  <div class='time-unit-large'>
                    <span
                      class='number-large'
                    >{{this.timeRemaining.days}}</span>
                    <span class='label-large'>Days</span>
                  </div>
                  <div class='separator'>:</div>
                  <div class='time-unit-large'>
                    <span
                      class='number-large'
                    >{{this.timeRemaining.hours}}</span>
                    <span class='label-large'>Hours</span>
                  </div>
                  <div class='separator'>:</div>
                  <div class='time-unit-large'>
                    <span
                      class='number-large'
                    >{{this.timeRemaining.minutes}}</span>
                    <span class='label-large'>Minutes</span>
                  </div>
                  <div class='separator'>:</div>
                  <div class='time-unit-large'>
                    <span
                      class='number-large'
                    >{{this.timeRemaining.seconds}}</span>
                    <span class='label-large'>Seconds</span>
                  </div>
                </div>
              {{/if}}
            {{else}}
              <div class='timer-placeholder-large'>
                <div class='placeholder-icon'>📅</div>
                <div class='placeholder-text'>No target date set</div>
                <div class='placeholder-subtitle'>Set a target date to start the
                  countdown</div>
              </div>
            {{/if}}
          </div>
        </div>

        {{#if @fields.position}}
          <div class='position-info'>
            <@fields.position />
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .timer-isolated {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        padding: 2rem;
        overflow-y: auto;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }

      .timer-stage {
        max-width: 48rem;
        width: 100%;
      }

      .large-timer {
        background: rgba(255, 255, 255, 0.95);
        border-radius: 20px;
        padding: 3rem;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        margin-bottom: 1.5rem;
        backdrop-filter: blur(10px);
      }

      .timer-header {
        text-align: center;
        margin-bottom: 3rem;
      }

      .timer-title {
        font-size: 2.5rem;
        font-weight: 700;
        color: #1f2937;
        margin: 0 0 1rem 0;
      }

      .target-date {
        font-size: 1.125rem;
        color: #6b7280;
        font-weight: 500;
      }

      .timer-body {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 200px;
      }

      .timer-display-large {
        display: flex;
        align-items: center;
        gap: 1.5rem;
      }

      .time-unit-large {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 1.5rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 16px;
        color: white;
        min-width: 120px;
      }

      .number-large {
        font-size: 3rem;
        font-weight: 700;
        line-height: 1;
      }

      .label-large {
        font-size: 1rem;
        opacity: 0.9;
        margin-top: 0.5rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .separator {
        font-size: 2rem;
        font-weight: 700;
        color: #374151;
      }

      .timer-expired-large {
        text-align: center;
        color: #dc2626;
      }

      .expired-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
      }

      .expired-text {
        font-size: 2.5rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
      }

      .expired-subtitle {
        font-size: 1.25rem;
        color: #6b7280;
      }

      .timer-placeholder-large {
        text-align: center;
        color: #6b7280;
      }

      .placeholder-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
      }

      .placeholder-text {
        font-size: 1.5rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
      }

      .placeholder-subtitle {
        font-size: 1rem;
      }

      .position-info {
        background: rgba(255, 255, 255, 0.9);
        border-radius: 12px;
        padding: 1rem;
        backdrop-filter: blur(10px);
      }
    </style>
  </template>
}

export class CountdownTimer extends BoardItem {
  static displayName = 'Countdown Timer';

  @field targetDate = contains(DatetimeField);
  @field title = contains(StringField);

  static isolated = IsolatedCountdownTimer;
  static embedded = EmbeddedCountdownTimer;
  static fitted = FittedCountdownTimer;
}
