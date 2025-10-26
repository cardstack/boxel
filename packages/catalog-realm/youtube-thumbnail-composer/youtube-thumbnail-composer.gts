import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import ColorField from 'https://cardstack.com/base/color';
import Base64ImageField from 'https://cardstack.com/base/base64-image';
import UrlField from 'https://cardstack.com/base/url';
import { Button, BoxelSelect } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { eq, gt, or, and, not, multiply } from '@cardstack/boxel-ui/helpers';
import { concat, array, hash, fn } from '@ember/helper';
import ImageIcon from '@cardstack/boxel-icons/image';
import TypeIcon from '@cardstack/boxel-icons/type';
import LayersIcon from '@cardstack/boxel-icons/layers';
import PaletteIcon from '@cardstack/boxel-icons/palette';
import DownloadIcon from '@cardstack/boxel-icons/download';
import EyeIcon from '@cardstack/boxel-icons/eye';
import EyeOffIcon from '@cardstack/boxel-icons/eye-off';
import MoveIcon from '@cardstack/boxel-icons/move';
import RotateCcwIcon from '@cardstack/boxel-icons/rotate-ccw';
import CopyIcon from '@cardstack/boxel-icons/copy';
import TrashIcon from '@cardstack/boxel-icons/trash-2';

// Text Element Field Definition
export class TextElement extends FieldDef {
  static displayName = 'Text Element';

  @field content = contains(StringField);
  @field x = contains(NumberField);
  @field y = contains(NumberField);
  @field fontSize = contains(NumberField);
  @field fontFamily = contains(StringField);
  @field fontWeight = contains(StringField);
  @field color = contains(ColorField);
  @field strokeColor = contains(ColorField);
  @field strokeWidth = contains(NumberField);
  @field rotation = contains(NumberField);
  @field opacity = contains(NumberField);
  @field visible = contains(BooleanField);
  @field layer = contains(NumberField);

  constructor() {
    super(...arguments);
    this.fontSize = 48;
    this.fontFamily = 'Arial, sans-serif';
    this.fontWeight = 'bold';
    this.color = '#FFFFFF';
    this.strokeColor = '#000000';
    this.strokeWidth = 2;
    this.rotation = 0;
    this.opacity = 1;
    this.visible = true;
    this.layer = 1;
    this.x = 100;
    this.y = 100;
  }
}

// Visual Element Field Definition
export class VisualElement extends FieldDef {
  static displayName = 'Visual Element';

  @field type = contains(StringField); // 'arrow', 'circle', 'rectangle', 'icon'
  @field x = contains(NumberField);
  @field y = contains(NumberField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
  @field rotation = contains(NumberField);
  @field opacity = contains(NumberField);
  @field fillColor = contains(ColorField);
  @field strokeColor = contains(ColorField);
  @field strokeWidth = contains(NumberField);
  @field visible = contains(BooleanField);
  @field layer = contains(NumberField);
  @field iconName = contains(StringField); // for icon type elements

  constructor() {
    super(...arguments);
    this.type = 'rectangle';
    this.x = 200;
    this.y = 200;
    this.width = 100;
    this.height = 100;
    this.rotation = 0;
    this.opacity = 1;
    this.fillColor = '#FF0000';
    this.strokeColor = '#000000';
    this.strokeWidth = 0;
    this.visible = true;
    this.layer = 0;
  }
}

// Background Field Definition
export class BackgroundElement extends FieldDef {
  static displayName = 'Background';

  @field type = contains(StringField); // 'solid', 'gradient', 'image'
  @field primaryColor = contains(ColorField);
  @field secondaryColor = contains(ColorField);
  @field gradientDirection = contains(StringField);
  @field backgroundImage = contains(Base64ImageField);
  @field imageUrl = contains(UrlField);
  @field opacity = contains(NumberField);

  constructor() {
    super(...arguments);
    this.type = 'gradient';
    this.primaryColor = '#FF6B6B';
    this.secondaryColor = '#4ECDC4';
    this.gradientDirection = 'to right';
    this.opacity = 1;
  }
}

export class YouTubeThumbnailComposer extends CardDef {
  static displayName = 'YouTube Thumbnail Composer';
  static icon = ImageIcon;
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
  @field background = contains(BackgroundElement);
  @field textElements = containsMany(TextElement);
  @field visualElements = containsMany(VisualElement);
  @field previewMode = contains(StringField);
  @field showGrid = contains(BooleanField);
  @field selectedElementId = contains(StringField);

  static isolated = class Isolated extends Component<
    typeof YouTubeThumbnailComposer
  > {
    @tracked selectedElement = null;
    @tracked activeTab = 'elements';

    get aspectRatio() {
      return (
        (this.args.model?.height ?? 720) / (this.args.model?.width ?? 1280)
      );
    }

    get previewWidth() {
      const containerWidth = Math.min(700, window.innerWidth * 0.6);
      return containerWidth;
    }

    get previewHeight() {
      return this.previewWidth * this.aspectRatio;
    }

    get scaleRatio() {
      const width = this.args.model?.width ?? 1280;
      if (!width || width === 0) return 1;
      return this.previewWidth / width;
    }

    get backgroundStyle() {
      const bg = this.args.model?.background;
      if (!bg)
        return 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);';

      if (bg.type === 'solid') {
        return `background: ${bg.primaryColor || '#000'};`;
      } else if (bg.type === 'gradient') {
        const primary = bg.primaryColor || '#6366f1';
        const secondary = bg.secondaryColor || '#8b5cf6';
        const direction = bg.gradientDirection || 'to bottom right';
        return `background: linear-gradient(${direction}, ${primary}, ${secondary});`;
      } else if (
        bg.type === 'image' &&
        (bg.imageUrl || bg.backgroundImage?.base64)
      ) {
        const imageUrl =
          bg.imageUrl ||
          (bg.backgroundImage?.base64
            ? `data:image/jpeg;base64,${bg.backgroundImage.base64}`
            : '');
        return `background-image: url(${imageUrl}); background-size: cover; background-position: center;`;
      }
      return 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);';
    }

    @action
    selectElement(element, event) {
      if (event) {
        event.stopPropagation();
      }
      this.selectedElement = element;
      this.activeTab = 'properties';
    }

    @action
    toggleGrid() {
      this.args.model.showGrid = !this.args.model.showGrid;
    }

    @action
    addTextElement() {
      const newElement = new TextElement();
      newElement.content = 'AMAZING!';
      newElement.x = Math.random() * 300 + 50;
      newElement.y = Math.random() * 150 + 100;

      if (!this.args.model.textElements) {
        this.args.model.textElements = [];
      }
      this.args.model.textElements = [
        ...this.args.model.textElements,
        newElement,
      ];
      this.selectedElement = newElement;
      this.activeTab = 'properties';
    }

    @action
    addVisualElement(type) {
      const newElement = new VisualElement();
      newElement.type = type;
      newElement.x = Math.random() * 300 + 200;
      newElement.y = Math.random() * 200 + 150;

      if (type === 'arrow') {
        newElement.width = 120;
        newElement.height = 30;
        newElement.fillColor = '#FFFF00';
        newElement.strokeColor = '#FF0000';
        newElement.strokeWidth = 3;
      } else if (type === 'circle') {
        newElement.width = 100;
        newElement.height = 100;
        newElement.fillColor = '#FF4444';
        newElement.strokeColor = '#FFFFFF';
        newElement.strokeWidth = 4;
      } else {
        newElement.width = 150;
        newElement.height = 80;
        newElement.fillColor = '#00FFFF';
        newElement.strokeColor = '#000000';
        newElement.strokeWidth = 2;
      }

      if (!this.args.model.visualElements) {
        this.args.model.visualElements = [];
      }
      this.args.model.visualElements = [
        ...this.args.model.visualElements,
        newElement,
      ];
      this.selectedElement = newElement;
      this.activeTab = 'properties';
    }

    @action
    updateElementProperty(element, property, event) {
      if (element && property) {
        element[property] = event.target.value;
      }
    }

    @action
    updateBackgroundProperty(property, event) {
      if (this.args.model?.background) {
        this.args.model.background[property] = event.target.value;
      }
    }

    @action
    toggleElementVisibility(element) {
      element.visible = !element.visible;
    }

    @action
    deleteElement(element) {
      if (this.args.model.textElements?.includes(element)) {
        this.args.model.textElements = this.args.model.textElements.filter(
          (el) => el !== element,
        );
      }
      if (this.args.model.visualElements?.includes(element)) {
        this.args.model.visualElements = this.args.model.visualElements.filter(
          (el) => el !== element,
        );
      }
      if (this.selectedElement === element) {
        this.selectedElement = null;
      }
    }

    @action
    duplicateElement(element) {
      let newElement;

      if (this.args.model.textElements?.includes(element)) {
        newElement = new TextElement();
        Object.assign(newElement, element);
        newElement.x = element.x + 20;
        newElement.y = element.y + 20;
        this.args.model.textElements = [
          ...this.args.model.textElements,
          newElement,
        ];
      } else if (this.args.model.visualElements?.includes(element)) {
        newElement = new VisualElement();
        Object.assign(newElement, element);
        newElement.x = element.x + 20;
        newElement.y = element.y + 20;
        this.args.model.visualElements = [
          ...this.args.model.visualElements,
          newElement,
        ];
      }

      this.selectedElement = newElement;
    }

    <template>
      <div class='composer-app'>
        <div class='app-header'>
          <h1><ImageIcon /> YouTube Thumbnail Composer</h1>
          <div class='header-controls'>
            <Button
              @kind={{if @model.showGrid 'primary' 'secondary-light'}}
              @size='small'
              {{on 'click' this.toggleGrid}}
            >
              {{if @model.showGrid 'Grid On' 'Grid Off'}}
            </Button>
          </div>
        </div>

        <div class='composer-layout'>
          <div class='preview-panel'>
            <div class='preview-container'>
              <div
                class='thumbnail-preview {{if @model.showGrid "show-grid"}}'
                style={{concat
                  'width: '
                  this.previewWidth
                  'px; height: '
                  this.previewHeight
                  'px; '
                  this.backgroundStyle
                }}
                {{on 'click' (fn this.selectElement null)}}
              >

                {{#if @model.showGrid}}
                  <div class='grid-overlay'></div>
                {{/if}}

                {{#each @model.visualElements as |element|}}
                  {{#if element.visible}}
                    <div
                      class='visual-element
                        {{element.type}}
                        {{if (eq this.selectedElement element) "selected"}}'
                      style={{concat
                        'left: '
                        (multiply element.x this.scaleRatio)
                        'px; top: '
                        (multiply element.y this.scaleRatio)
                        'px; width: '
                        (multiply element.width this.scaleRatio)
                        'px; height: '
                        (multiply element.height this.scaleRatio)
                        'px; background: '
                        element.fillColor
                        '; border: '
                        (multiply element.strokeWidth this.scaleRatio)
                        'px solid '
                        element.strokeColor
                        '; transform: rotate('
                        element.rotation
                        'deg); opacity: '
                        element.opacity
                        '; z-index: '
                        element.layer
                        ';'
                      }}
                      {{on 'click' (fn this.selectElement element)}}
                    >
                    </div>
                  {{/if}}
                {{/each}}

                {{#each @model.textElements as |element|}}
                  {{#if element.visible}}
                    <div
                      class='text-element
                        {{if (eq this.selectedElement element) "selected"}}'
                      style={{concat
                        'left: '
                        (multiply element.x this.scaleRatio)
                        'px; top: '
                        (multiply element.y this.scaleRatio)
                        'px; font-size: '
                        (multiply element.fontSize this.scaleRatio)
                        'px; font-family: '
                        element.fontFamily
                        '; font-weight: '
                        element.fontWeight
                        '; color: '
                        element.color
                        '; -webkit-text-stroke: '
                        (multiply element.strokeWidth this.scaleRatio)
                        'px '
                        element.strokeColor
                        '; transform: rotate('
                        element.rotation
                        'deg); opacity: '
                        element.opacity
                        '; z-index: '
                        element.layer
                        ';'
                      }}
                      {{on 'click' (fn this.selectElement element)}}
                    >
                      {{element.content}}
                    </div>
                  {{/if}}
                {{/each}}
              </div>
            </div>
          </div>

          <div class='tools-panel'>
            <div class='panel-tabs'>
              <button
                class='tab {{if (eq this.activeTab "elements") "active"}}'
                {{on 'click' (fn (mut this.activeTab) 'elements')}}
              >
                <LayersIcon />
                Elements
              </button>
              <button
                class='tab {{if (eq this.activeTab "properties") "active"}}'
                {{on 'click' (fn (mut this.activeTab) 'properties')}}
              >
                <TypeIcon />
                Properties
              </button>
              <button
                class='tab {{if (eq this.activeTab "background") "active"}}'
                {{on 'click' (fn (mut this.activeTab) 'background')}}
              >
                <PaletteIcon />
                Background
              </button>
            </div>

            {{#if (eq this.activeTab 'elements')}}
              <div class='elements-tab'>
                <h3>Add Elements</h3>
                <Button @kind='primary' {{on 'click' this.addTextElement}}>
                  <TypeIcon />
                  Add Text
                </Button>
                <div class='button-group'>
                  <Button
                    @kind='secondary'
                    {{on 'click' (fn this.addVisualElement 'arrow')}}
                  >➤ Arrow</Button>
                  <Button
                    @kind='secondary'
                    {{on 'click' (fn this.addVisualElement 'circle')}}
                  >● Circle</Button>
                  <Button
                    @kind='secondary'
                    {{on 'click' (fn this.addVisualElement 'rectangle')}}
                  >■ Rectangle</Button>
                </div>
              </div>
            {{/if}}

            {{#if (eq this.activeTab 'properties')}}
              <div class='properties-tab'>
                {{#if this.selectedElement}}
                  <h3>Edit Element</h3>
                  <div class='property-actions'>
                    <Button
                      @kind='secondary-light'
                      @size='small'
                      {{on
                        'click'
                        (fn this.duplicateElement this.selectedElement)
                      }}
                    >
                      <CopyIcon />
                      Duplicate
                    </Button>
                    <Button
                      @kind='danger-light'
                      @size='small'
                      {{on
                        'click'
                        (fn this.deleteElement this.selectedElement)
                      }}
                    >
                      <TrashIcon />
                      Delete
                    </Button>
                  </div>

                  {{#if this.selectedElement.content}}
                    <label>Content</label>
                    <input
                      type='text'
                      value={{this.selectedElement.content}}
                      {{on
                        'input'
                        (fn
                          this.updateElementProperty
                          this.selectedElement
                          'content'
                        )
                      }}
                    />

                    <label>Font Size</label>
                    <input
                      type='range'
                      min='12'
                      max='120'
                      value={{this.selectedElement.fontSize}}
                      {{on
                        'input'
                        (fn
                          this.updateElementProperty
                          this.selectedElement
                          'fontSize'
                        )
                      }}
                    />

                    <label>Color</label>
                    <input
                      type='color'
                      value={{this.selectedElement.color}}
                      {{on
                        'input'
                        (fn
                          this.updateElementProperty
                          this.selectedElement
                          'color'
                        )
                      }}
                    />
                  {{else}}
                    <label>Width</label>
                    <input
                      type='number'
                      value={{this.selectedElement.width}}
                      {{on
                        'input'
                        (fn
                          this.updateElementProperty
                          this.selectedElement
                          'width'
                        )
                      }}
                    />

                    <label>Height</label>
                    <input
                      type='number'
                      value={{this.selectedElement.height}}
                      {{on
                        'input'
                        (fn
                          this.updateElementProperty
                          this.selectedElement
                          'height'
                        )
                      }}
                    />

                    <label>Fill Color</label>
                    <input
                      type='color'
                      value={{this.selectedElement.fillColor}}
                      {{on
                        'input'
                        (fn
                          this.updateElementProperty
                          this.selectedElement
                          'fillColor'
                        )
                      }}
                    />
                  {{/if}}

                  <label>X Position</label>
                  <input
                    type='number'
                    value={{this.selectedElement.x}}
                    {{on
                      'input'
                      (fn this.updateElementProperty this.selectedElement 'x')
                    }}
                  />

                  <label>Y Position</label>
                  <input
                    type='number'
                    value={{this.selectedElement.y}}
                    {{on
                      'input'
                      (fn this.updateElementProperty this.selectedElement 'y')
                    }}
                  />

                  <label>Rotation</label>
                  <input
                    type='range'
                    min='-45'
                    max='45'
                    value={{this.selectedElement.rotation}}
                    {{on
                      'input'
                      (fn
                        this.updateElementProperty
                        this.selectedElement
                        'rotation'
                      )
                    }}
                  />
                {{else}}
                  <p class='no-selection'>Click an element to edit its
                    properties</p>
                {{/if}}
              </div>
            {{/if}}

            {{#if (eq this.activeTab 'background')}}
              <div class='background-tab'>
                <h3>Background</h3>
                <label>Primary Color</label>
                <input
                  type='color'
                  value={{@model.background.primaryColor}}
                  {{on
                    'input'
                    (fn this.updateBackgroundProperty 'primaryColor')
                  }}
                />

                {{#if (eq @model.background.type 'gradient')}}
                  <label>Secondary Color</label>
                  <input
                    type='color'
                    value={{@model.background.secondaryColor}}
                    {{on
                      'input'
                      (fn this.updateBackgroundProperty 'secondaryColor')
                    }}
                  />
                {{/if}}
              </div>
            {{/if}}

            <div class='layers-panel'>
              <h3>Layers</h3>
              {{#each @model.textElements as |element|}}
                <div
                  class='layer-item
                    {{if (eq this.selectedElement element) "selected"}}'
                >
                  <button
                    {{on 'click' (fn this.toggleElementVisibility element)}}
                  >
                    {{#if element.visible}}<EyeIcon />{{else}}<EyeOffIcon
                      />{{/if}}
                  </button>
                  <span {{on 'click' (fn this.selectElement element)}}>Text:
                    {{element.content}}</span>
                  <button
                    {{on 'click' (fn this.deleteElement element)}}
                  ><TrashIcon /></button>
                </div>
              {{/each}}

              {{#each @model.visualElements as |element|}}
                <div
                  class='layer-item
                    {{if (eq this.selectedElement element) "selected"}}'
                >
                  <button
                    {{on 'click' (fn this.toggleElementVisibility element)}}
                  >
                    {{#if element.visible}}<EyeIcon />{{else}}<EyeOffIcon
                      />{{/if}}
                  </button>
                  <span
                    {{on 'click' (fn this.selectElement element)}}
                  >{{element.type}}</span>
                  <button
                    {{on 'click' (fn this.deleteElement element)}}
                  ><TrashIcon /></button>
                </div>
              {{/each}}
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .composer-app {
          width: 100%;
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          font-family:
            -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .app-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px;
          background: rgba(255, 255, 255, 0.95);
          border-bottom: 2px solid #e5e7eb;
        }

        .app-header h1 {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0;
          font-size: 24px;
          font-weight: 700;
        }

        .composer-layout {
          flex: 1;
          display: flex;
          overflow: hidden;
        }

        .preview-panel {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
        }

        .thumbnail-preview {
          position: relative;
          border: 4px solid white;
          border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          overflow: hidden;
        }

        .thumbnail-preview.show-grid .grid-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image:
            linear-gradient(rgba(255, 255, 255, 0.2) 1px, transparent 1px),
            linear-gradient(
              90deg,
              rgba(255, 255, 255, 0.2) 1px,
              transparent 1px
            );
          background-size: 20px 20px;
          pointer-events: none;
          z-index: 1000;
        }

        .text-element,
        .visual-element {
          position: absolute;
          cursor: pointer;
          white-space: nowrap;
        }

        .text-element.selected,
        .visual-element.selected {
          outline: 3px dashed #6600ff;
          outline-offset: 4px;
        }

        .visual-element.circle {
          border-radius: 50%;
        }

        .visual-element.arrow {
          clip-path: polygon(
            0% 20%,
            60% 20%,
            60% 0%,
            100% 50%,
            60% 100%,
            60% 80%,
            0% 80%
          );
        }

        .tools-panel {
          width: 350px;
          background: white;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }

        .panel-tabs {
          display: flex;
          border-bottom: 1px solid #e5e7eb;
        }

        .tab {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: center;
          padding: 12px;
          border: none;
          background: none;
          cursor: pointer;
          border-bottom: 2px solid transparent;
        }

        .tab.active {
          border-bottom-color: #6600ff;
        }

        .elements-tab,
        .properties-tab,
        .background-tab {
          padding: 20px;
        }

        .elements-tab h3,
        .properties-tab h3,
        .background-tab h3 {
          margin: 0 0 16px 0;
        }

        .button-group {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-top: 12px;
        }

        .property-actions {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
        }

        label {
          display: block;
          margin: 12px 0 4px;
          font-size: 14px;
          font-weight: 500;
        }

        input[type='text'],
        input[type='number'] {
          width: 100%;
          padding: 8px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
        }

        input[type='color'] {
          width: 100%;
          height: 40px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          cursor: pointer;
        }

        input[type='range'] {
          width: 100%;
        }

        .no-selection {
          text-align: center;
          padding: 40px 20px;
          color: #9ca3af;
        }

        .layers-panel {
          border-top: 1px solid #e5e7eb;
          padding: 20px;
          margin-top: auto;
        }

        .layers-panel h3 {
          margin: 0 0 12px 0;
        }

        .layer-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          margin-bottom: 4px;
          border-radius: 4px;
        }

        .layer-item.selected {
          background: #ede9fe;
        }

        .layer-item button {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
        }

        .layer-item span {
          flex: 1;
          cursor: pointer;
          font-size: 14px;
        }
      </style>
    </template>
  };
}
