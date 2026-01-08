import { eq } from '@cardstack/boxel-ui/helpers';
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import TextAreaField from 'https://cardstack.com/base/text-area';
import ColorField from '../fields/color'; // ² Color field for customization
import { tracked } from '@glimmer/tracking';
import { fn, concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import MailIcon from '@cardstack/boxel-icons/mail';

class IsolatedTemplate extends Component<typeof EmailTemplateEditor> {
  // ¹⁷ Isolated format - true inline visual editor with contentEditable
  @tracked selectedSection: string | null = null;
  @tracked showEditPanel: boolean = false;

  // Color mapping configuration - maps section/colorType to model field names
  static readonly COLOR_MAPPING = {
    header: {
      bg: 'headerBgColor',
      text: 'headerTextColor',
    },
    body: {
      bg: 'backgroundColor',
      text: 'textColor',
    },
    button: {
      bg: 'buttonColor',
      text: 'buttonTextColor',
    },
    footer: {
      bg: 'footerBgColor',
      text: 'footerTextColor',
    },
  } as const;

  get formattedFromLine() {
    const name = this.args.model?.fromName || 'Sender Name';
    const email = this.args.model?.fromEmail || 'sender@example.com';
    return `${name} <${email}>`;
  }

  get panelClass() {
    return this.showEditPanel ? 'edit-panel active' : 'edit-panel';
  }

  // Dynamic getters that read from model - ensures reactivity
  get headerBgColor() {
    return this.args.model?.headerBgColor ?? '#6366f1';
  }

  get headerTextColor() {
    return this.args.model?.headerTextColor ?? '#ffffff';
  }

  get bodyBgColor() {
    return this.args.model?.backgroundColor ?? '#ffffff';
  }

  get bodyTextColor() {
    return this.args.model?.textColor ?? '#000000';
  }

  get buttonBgColor() {
    return this.args.model?.buttonColor ?? '#3b82f6';
  }

  get buttonTextColor() {
    return this.args.model?.buttonTextColor ?? '#ffffff';
  }

  get footerBgColor() {
    return this.args.model?.footerBgColor ?? '#6366f1';
  }

  get footerTextColor() {
    return this.args.model?.footerTextColor ?? '#ffffff';
  }

  @action
  openEditPanel(section: string, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.selectedSection = section;
    this.showEditPanel = true;
    // Colors are now reactive getters, no need to manually sync
  }

  @action
  closeEditPanel() {
    this.showEditPanel = false;
    this.selectedSection = null;
  }

  @action
  updateText(field: string, event: Event) {
    const target = event.target as HTMLElement;
    const value = target.innerText || '';
    if (this.args.model) {
      (this.args.model as any)[field] = value;
    }
  }

  // Dynamic color update method (kept for potential future use)
  // Note: ColorField components handle updates automatically via @args.set,
  // so this method may not be needed, but kept for flexibility
  @action
  updateColor(section: string, colorType: 'bg' | 'text', value: string) {
    const mapping =
      IsolatedTemplate.COLOR_MAPPING[
        section as keyof typeof IsolatedTemplate.COLOR_MAPPING
      ];
    if (!mapping || !mapping[colorType]) {
      return;
    }

    const modelField = mapping[colorType];
    if (this.args.model) {
      (this.args.model as any)[modelField] = value;
    }
  }

  @action
  handleKeydown(event: KeyboardEvent) {
    // Prevent Enter from creating new lines in single-line fields
    if (event.key === 'Enter' && !event.shiftKey) {
      const target = event.target as HTMLElement;
      if (target.dataset.multiline !== 'true') {
        event.preventDefault();
      }
    }
  }

  @action
  handleOverlayKeydown(event: KeyboardEvent) {
    // Close panel on Enter or Space key
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.closeEditPanel();
    }
  }

  <template>
    <div class='visual-editor-container'>
      {{! Visual Editor Header }}
      <div class='editor-toolbar'>
        <div class='toolbar-left'>
          <svg
            class='toolbar-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <rect x='2' y='4' width='20' height='16' rx='2' />
            <path d='m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' />
          </svg>
          <h1>Email Template Designer</h1>
        </div>
        <div class='toolbar-info'>
          <span class='info-item'>
            Subject:
            <strong
              contenteditable='true'
              role='textbox'
              {{on 'blur' (fn this.updateText 'subject')}}
              {{on 'keydown' this.handleKeydown}}
              class='inline-editable'
            >{{if
                @model.subject
                @model.subject
                'Click to add subject'
              }}</strong>
          </span>
          <span class='divider'>•</span>
          <span class='info-item'>From: {{this.formattedFromLine}}</span>
        </div>
      </div>

      <div class='visual-editor-layout'>
        {{! Main Canvas }}
        <div class='canvas-area'>
          <div class='email-canvas'>
            <div class='email-wrapper'>
              {{! Header Section }}
              <div
                class='email-section header-section'
                style={{htmlSafe
                  (concat
                    'background-color: '
                    (if @model.headerBgColor @model.headerBgColor '#6366f1')
                    '; color: '
                    (if @model.headerTextColor @model.headerTextColor '#ffffff')
                    ';'
                  )
                }}
              >
                <button
                  class='edit-button'
                  {{on 'click' (fn this.openEditPanel 'header')}}
                  title='Edit header'
                >
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'
                    />
                    <path
                      d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'
                    />
                  </svg>
                </button>

                <h2
                  contenteditable='true'
                  role='textbox'
                  {{on 'blur' (fn this.updateText 'headerText')}}
                  {{on 'keydown' this.handleKeydown}}
                  class='inline-editable header-text'
                >{{if @model.headerText @model.headerText 'Welcome!'}}</h2>
              </div>

              {{! Body Section }}
              <div
                class='email-section body-section'
                style={{htmlSafe
                  (concat
                    'background-color: '
                    (if @model.backgroundColor @model.backgroundColor '#ffffff')
                    '; color: '
                    (if @model.textColor @model.textColor '#000000')
                    ';'
                  )
                }}
              >
                <button
                  class='edit-button'
                  {{on 'click' (fn this.openEditPanel 'body')}}
                  title='Edit body'
                >
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'
                    />
                    <path
                      d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'
                    />
                  </svg>
                </button>

                <p
                  contenteditable='true'
                  role='textbox'
                  data-multiline='true'
                  {{on 'blur' (fn this.updateText 'bodyContent')}}
                  class='inline-editable body-text'
                >{{if
                    @model.bodyContent
                    @model.bodyContent
                    'Click here to add your email content'
                  }}</p>

                {{! Button }}
                <div class='button-wrapper'>
                  <button
                    class='edit-button button-edit'
                    {{on 'click' (fn this.openEditPanel 'button')}}
                    title='Edit button'
                  >
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path
                        d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'
                      />
                      <path
                        d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'
                      />
                    </svg>
                  </button>

                  <a
                    href='#'
                    class='email-button inline-editable'
                    contenteditable='true'
                    role='textbox'
                    {{on 'blur' (fn this.updateText 'buttonText')}}
                    {{on 'keydown' this.handleKeydown}}
                    style={{htmlSafe
                      (concat
                        'background-color: '
                        (if @model.buttonColor @model.buttonColor '#3b82f6')
                        '; color: '
                        (if
                          @model.buttonTextColor
                          @model.buttonTextColor
                          '#ffffff'
                        )
                        ';'
                      )
                    }}
                  >{{if @model.buttonText @model.buttonText 'Get Started'}}</a>
                </div>
              </div>

              {{! Footer Section }}
              <div
                class='email-section footer-section'
                style={{htmlSafe
                  (concat
                    'background-color: '
                    (if @model.footerBgColor @model.footerBgColor '#f9fafb')
                    '; color: '
                    (if @model.footerTextColor @model.footerTextColor '#6b7280')
                    ';'
                  )
                }}
              >
                <button
                  class='edit-button'
                  {{on 'click' (fn this.openEditPanel 'footer')}}
                  title='Edit footer'
                >
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'
                    />
                    <path
                      d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'
                    />
                  </svg>
                </button>

                <p
                  contenteditable='true'
                  role='textbox'
                  data-multiline='true'
                  {{on 'blur' (fn this.updateText 'footerText')}}
                  class='inline-editable footer-text'
                >{{if
                    @model.footerText
                    @model.footerText
                    'Click to add footer text'
                  }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {{! Slide-in Edit Panel }}
      <div class={{this.panelClass}}>
        <div class='panel-header'>
          <h3>Edit
            {{if this.selectedSection this.selectedSection 'Section'}}</h3>
          <button class='close-button' {{on 'click' this.closeEditPanel}}>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <line x1='18' y1='6' x2='6' y2='18' />
              <line x1='6' y1='6' x2='18' y2='18' />
            </svg>
          </button>
        </div>

        <div class='panel-content'>
          {{#if (eq this.selectedSection 'header')}}
            <div class='color-section'>
              <label>Header Background Color</label>
              <@fields.headerBgColor @format='edit' />
            </div>
            <div class='color-section'>
              <label>Header Text Color</label>
              <@fields.headerTextColor @format='edit' />
            </div>
          {{else if (eq this.selectedSection 'body')}}
            <div class='color-section'>
              <label>Background Color</label>
              <@fields.backgroundColor @format='edit' />
            </div>
            <div class='color-section'>
              <label>Text Color</label>
              <@fields.textColor @format='edit' />
            </div>
          {{else if (eq this.selectedSection 'button')}}
            <div class='color-section'>
              <label>Button Background Color</label>
              <@fields.buttonColor @format='edit' />
            </div>
            <div class='color-section'>
              <label>Button Text Color</label>
              <@fields.buttonTextColor @format='edit' />
            </div>
            <div class='color-section'>
              <label>Button URL</label>
              <@fields.buttonUrl @format='edit' />
            </div>
          {{else if (eq this.selectedSection 'footer')}}
            <div class='color-section'>
              <label>Footer Background Color</label>
              <@fields.footerBgColor @format='edit' />
            </div>
            <div class='color-section'>
              <label>Footer Text Color</label>
              <@fields.footerTextColor @format='edit' />
            </div>
          {{/if}}

          <div class='email-settings'>
            <h4>Email Settings</h4>
            <div class='color-section'>
              <label>From Name</label>
              <@fields.fromName @format='edit' />
            </div>
            <div class='color-section'>
              <label>From Email</label>
              <@fields.fromEmail @format='edit' />
            </div>
          </div>
        </div>
      </div>

      {{! Overlay for closing panel }}
      {{#if this.showEditPanel}}
        <div
          class='overlay'
          role='button'
          tabindex='0'
          {{on 'click' this.closeEditPanel}}
          {{on 'keydown' this.handleOverlayKeydown}}
        ></div>
      {{/if}}
    </div>

    <style scoped>
      /* ¹⁸ Visual Editor styles with slide-in panel */
      .visual-editor-container {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        font-family: var(--font-sans, system-ui, sans-serif);
        background: #f8fafc;
        position: relative;
      }

      .editor-toolbar {
        background: white;
        border-bottom: 1px solid #e5e7eb;
        padding: 1rem 2rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .toolbar-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .toolbar-icon {
        width: 1.75rem;
        height: 1.75rem;
        color: var(--primary, #667eea);
      }

      .editor-toolbar h1 {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--foreground, #1f2937);
        margin: 0;
      }

      .toolbar-info {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
      }

      .info-item {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }

      .inline-editable {
        display: inline-block;
        padding: 0.125rem 0.375rem;
        border-radius: 4px;
        transition: all 0.2s;
        outline: none;
        min-width: 80px;
      }

      .inline-editable:hover {
        background: rgba(102, 126, 234, 0.1);
      }

      .inline-editable:focus {
        background: transparent;
        box-shadow: 0 0 0 2px #667eea;
      }

      .divider {
        color: var(--border, #e5e7eb);
      }

      .visual-editor-layout {
        flex: 1;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 2rem;
        overflow-y: auto;
      }

      .canvas-area {
        width: 100%;
        max-width: 650px;
      }

      .email-canvas {
        background: white;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        overflow: hidden;
      }

      .email-wrapper {
        background: white;
      }

      /* Email sections */
      .email-section {
        position: relative;
        transition: all 0.2s;
      }

      .email-section:hover .edit-button {
        opacity: 1;
      }

      /* Edit buttons */
      .edit-button {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid rgba(0, 0, 0, 0.1);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: all 0.2s;
        z-index: 10;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        pointer-events: auto;
      }

      .edit-button:hover {
        background: white;
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .edit-button svg {
        width: 16px;
        height: 16px;
        color: #6366f1;
        pointer-events: none;
      }

      .button-edit {
        top: -0.5rem;
        right: -0.5rem;
      }

      /* Section specific styles */
      .header-section {
        padding: 3rem 2rem;
        text-align: center;
      }

      .body-section {
        padding: 3rem 2rem;
      }

      .footer-section {
        padding: 2rem;
        text-align: center;
        border-top: 1px solid #e5e7eb;
      }

      /* Text styles */
      .header-text {
        font-size: 2.25rem;
        font-weight: 700;
        margin: 0;
        /* Color is inherited from parent .header-section */
      }

      .body-text {
        font-size: 1.0625rem;
        line-height: 1.7;
        margin: 0 0 2rem 0;
        white-space: pre-wrap;
        min-height: 100px;
      }

      .footer-text {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.6;
        white-space: pre-wrap;
        min-height: 50px;
      }

      /* Button wrapper */
      .button-wrapper {
        position: relative;
        display: inline-block;
      }

      .email-button {
        display: inline-block;
        padding: 1rem 2.5rem;
        color: white;
        text-decoration: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 1.0625rem;
        transition: all 0.2s;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .email-button:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
      }

      /* Slide-in Edit Panel */
      .edit-panel {
        position: absolute;
        top: 0;
        right: -400px;
        width: 400px;
        height: 100vh;
        background: white;
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
        transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        visibility: hidden;
      }

      .edit-panel.active {
        right: 0;
        visibility: visible;
      }

      .panel-header {
        padding: 1.5rem;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .panel-header h3 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
        color: #1f2937;
        text-transform: capitalize;
      }

      .close-button {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: transparent;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .close-button:hover {
        background: #f3f4f6;
      }

      .close-button svg {
        width: 20px;
        height: 20px;
        color: #6b7280;
      }

      .panel-content {
        flex: 1;
        padding: 1.5rem;
        overflow-y: auto;
      }

      .color-section {
        margin-bottom: 1.5rem;
      }

      .color-section label {
        display: block;
        font-size: 0.875rem;
        font-weight: 600;
        color: #374151;
        margin-bottom: 0.5rem;
      }

      .info-text {
        font-size: 0.875rem;
        color: #6b7280;
        line-height: 1.5;
      }

      .email-settings {
        margin-top: 2rem;
        padding-top: 2rem;
        border-top: 1px solid #e5e7eb;
      }

      .email-settings h4 {
        margin: 0 0 1rem 0;
        font-size: 1rem;
        font-weight: 600;
        color: #1f2937;
      }

      /* Overlay */
      .overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.3);
        z-index: 9998;
      }

      @media (max-width: 1200px) {
        .visual-editor-layout {
          flex-direction: column;
        }

        .settings-panel {
          width: 100%;
          max-height: none;
        }

        .canvas-area {
          max-width: 100%;
        }
      }

      @media (max-width: 768px) {
        .visual-editor-layout {
          padding: 1rem;
        }

        .toolbar-info {
          display: none;
        }

        .color-button {
          width: 28px;
          height: 28px;
        }

        .color-button svg {
          width: 16px;
          height: 16px;
        }
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof EmailTemplateEditor> {
  // ¹⁸ Embedded format
  <template>
    <div class='email-editor-card'>
      <div class='card-header'>
        <svg
          class='card-icon'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='2'
        >
          <rect x='2' y='4' width='20' height='16' rx='2' />
          <path d='m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' />
        </svg>
        <h3>{{if @model.subject @model.subject 'Email Template Editor'}}</h3>
      </div>
      <div class='card-info'>
        <p>From: {{if @model.fromName @model.fromName 'Not set'}}</p>
        <p>Colors configured:
          {{if @model.headerBgColor '✓' '○'}}
          {{if @model.backgroundColor '✓' '○'}}
          {{if @model.buttonColor '✓' '○'}}</p>
      </div>
    </div>

    <style scoped>
      /* ¹⁹ Embedded styles */
      .email-editor-card {
        padding: 1rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 0.5rem);
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
      }

      .card-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary, #3b82f6);
      }

      .card-header h3 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--foreground, #1f2937);
      }

      .card-info p {
        margin: 0.25rem 0;
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof EmailTemplateEditor> {
  // ²⁰ Fitted format
  <template>
    <div class='fitted-container'>
      <div class='badge-format'>
        <svg
          class='fitted-icon'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='2'
        >
          <rect x='2' y='4' width='20' height='16' rx='2' />
          <path d='m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' />
        </svg>
        <span class='fitted-text'>{{if
            @model.subject
            @model.subject
            'Email Template'
          }}</span>
      </div>

      <div class='strip-format'>
        <div class='strip-content'>
          <svg
            class='strip-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <rect x='2' y='4' width='20' height='16' rx='2' />
            <path d='m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' />
          </svg>
          <div class='strip-text'>
            <div class='primary-text'>{{if
                @model.subject
                @model.subject
                'Email Template'
              }}</div>
            <div class='secondary-text'>{{if
                @model.fromName
                @model.fromName
                'No sender'
              }}</div>
          </div>
        </div>
      </div>

      <div class='tile-format'>
        <svg
          class='tile-icon'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='2'
        >
          <rect x='2' y='4' width='20' height='16' rx='2' />
          <path d='m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' />
        </svg>
        <h4 class='primary-text'>{{if
            @model.subject
            @model.subject
            'Email Template'
          }}</h4>
        <p class='secondary-text'>{{if
            @model.fromName
            @model.fromName
            'No sender set'
          }}</p>
        <div class='color-dots'>
          {{#if @model.headerBgColor}}
            <span
              class='color-dot'
              style={{htmlSafe (concat 'background:' @model.headerBgColor)}}
            ></span>
          {{/if}}
          {{#if @model.buttonColor}}
            <span
              class='color-dot'
              style={{htmlSafe (concat 'background:' @model.buttonColor)}}
            ></span>
          {{/if}}
        </div>
      </div>

      <div class='card-format'>
        <div class='card-content'>
          <svg
            class='card-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <rect x='2' y='4' width='20' height='16' rx='2' />
            <path d='m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' />
          </svg>
          <div class='card-text'>
            <h4 class='primary-text'>{{if
                @model.subject
                @model.subject
                'Email Template Editor'
              }}</h4>
            <p class='secondary-text'>From:
              {{if @model.fromName @model.fromName 'Not configured'}}</p>
            <p class='tertiary-text'>{{if
                @model.bodyContent
                @model.bodyContent
                'No content yet'
              }}</p>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      /* ²¹ Fitted styles */
      .fitted-container {
        container-type: size;
        width: 100%;
        height: 100%;
      }

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

      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
      }

      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
        }
      }

      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
      }

      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
        }
      }

      .fitted-icon,
      .strip-icon {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--primary, #3b82f6);
        flex-shrink: 0;
      }

      .fitted-text {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1f2937);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .strip-content {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
      }

      .strip-text {
        flex: 1;
        min-width: 0;
      }

      .tile-icon,
      .card-icon {
        width: 2.5rem;
        height: 2.5rem;
        color: var(--primary, #3b82f6);
        margin-bottom: 0.75rem;
      }

      .color-dots {
        display: flex;
        gap: 0.375rem;
        margin-top: auto;
      }

      .color-dot {
        width: 1rem;
        height: 1rem;
        border-radius: 50%;
        border: 2px solid white;
        box-shadow: var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
      }

      .card-content {
        display: flex;
        gap: 1rem;
        width: 100%;
      }

      .card-text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .primary-text {
        font-size: 1em;
        font-weight: 600;
        color: var(--text-primary, rgba(0, 0, 0, 0.95));
        line-height: 1.2;
        margin: 0;
      }

      .secondary-text {
        font-size: 0.875em;
        font-weight: 500;
        color: var(--text-secondary, rgba(0, 0, 0, 0.85));
        line-height: 1.3;
        margin: 0;
      }

      .tertiary-text {
        font-size: 0.75em;
        font-weight: 400;
        color: var(--text-tertiary, rgba(0, 0, 0, 0.7));
        line-height: 1.4;
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
    </style>
  </template>
}

export class EmailTemplateEditor extends CardDef {
  // ³ Card definition
  static displayName = 'Email Template Editor';
  static icon = MailIcon;
  static prefersWideFormat = true;

  @field subject = contains(StringField); // ⁴ Email subject
  @field fromName = contains(StringField); // ⁵ Sender name
  @field fromEmail = contains(StringField); // ⁶ Sender email
  @field headerText = contains(StringField); // ⁷ Header text
  @field bodyContent = contains(TextAreaField); // ⁸ Main email content
  @field footerText = contains(TextAreaField); // ⁹ Footer text
  @field buttonText = contains(StringField); // ¹⁰ CTA button text
  @field buttonUrl = contains(StringField); // ¹¹ CTA button URL

  // Color customization fields
  static get paletteColors() {
    return [
      '#ffffff', // White baseline
      '#f8fafc', // Very light neutral
      '#e2e8f0', // Soft blue gray
      '#cbd5f5', // Light periwinkle
      '#dbeafe', // Light sky blue
      '#a5b4fc', // Light indigo
      '#60a5fa', // Bright sky (AA)
      '#1d4ed8', // Strong blue (AAA)
      '#0f172a', // Deep navy (AAA)
      '#ef4444', // Warning red (fails WCAG)
    ];
  }
  @field headerBgColor = contains(ColorField, {
    // ¹² Primary brand color
    configuration: {
      variant: 'swatches-picker',
      options: {
        paletteColors: EmailTemplateEditor.paletteColors,
      },
    },
  });
  @field backgroundColor = contains(ColorField, {
    // ¹³ Background color
    configuration: {
      variant: 'swatches-picker',
      options: {
        paletteColors: EmailTemplateEditor.paletteColors,
      },
    },
  });
  @field textColor = contains(ColorField, {
    // ¹⁴ Text color
    configuration: function (this: EmailTemplateEditor) {
      return {
        variant: 'swatches-picker',
        options: {
          paletteColors: EmailTemplateEditor.paletteColors,
          showContrastChecker: true,
          contrastColor: this.backgroundColor ?? '#ffffff', // Default header background color
        },
      };
    },
  });
  @field buttonColor = contains(ColorField, {
    // ¹⁵ Button color
    configuration: {
      variant: 'swatches-picker',
      options: {
        paletteColors: EmailTemplateEditor.paletteColors,
      },
    },
  });
  @field headerTextColor = contains(ColorField, {
    // Header text color
    configuration: function (this: EmailTemplateEditor) {
      return {
        variant: 'swatches-picker',
        options: {
          paletteColors: EmailTemplateEditor.paletteColors,
          showContrastChecker: true,
          contrastColor: this.headerBgColor ?? '#6366f1', // Default header background color
        },
      };
    },
  });
  @field footerBgColor = contains(ColorField, {
    // Footer background color
    configuration: {
      variant: 'swatches-picker',
      options: {
        paletteColors: EmailTemplateEditor.paletteColors,
      },
    },
  });
  @field footerTextColor = contains(ColorField, {
    // Footer text color
    configuration: function (this: EmailTemplateEditor) {
      return {
        variant: 'swatches-picker',
        options: {
          paletteColors: EmailTemplateEditor.paletteColors,
          showContrastChecker: true,
          contrastColor: this.footerBgColor ?? '#6366f1', // Default footer background color
        },
      };
    },
  });
  @field buttonTextColor = contains(ColorField, {
    // Button text color
    configuration: {
      variant: 'swatches-picker',
      options: {
        paletteColors: EmailTemplateEditor.paletteColors,
      },
    },
  });

  @field title = contains(StringField, {
    // ¹⁶ Computed title
    computeVia: function (this: EmailTemplateEditor) {
      return this.subject ?? 'Email Template Editor';
    },
  });

  static isolated = IsolatedTemplate;

  static embedded = EmbeddedTemplate;

  static fitted = FittedTemplate;
}
