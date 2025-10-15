import {
  CardDef,
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import { action } from '@ember/object';
import Modifier from 'ember-modifier';
import { Button } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import { gt } from '@cardstack/boxel-ui/helpers';
import CubeIcon from '@cardstack/boxel-icons/cube';
import { htmlSafe } from '@ember/template';

// @ts-ignore
import * as THREE from 'https://esm.sh/three@0.160.0';
// @ts-ignore
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
// @ts-ignore
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

interface ThreeCanvasModifierSignature {
  Args: {
    Named: {
      onCanvas?: (canvas: HTMLCanvasElement) => void;
    };
  };
  Element: HTMLCanvasElement;
}

class ThreeCanvasModifier extends Modifier<ThreeCanvasModifierSignature> {
  element!: HTMLCanvasElement;

  modify(
    element: HTMLCanvasElement,
    _positional: any[],
    named: { onCanvas?: (canvas: HTMLCanvasElement) => void },
  ) {
    this.element = element;
    named.onCanvas?.(element);
  }
}

// ⁷ GLTF Settings field for advanced controls
export class GltfSettingsField extends FieldDef {
  static displayName = 'GLTF Settings';

  @field autoRotate = contains(BooleanField);
  @field rotationSpeed = contains(NumberField);
  @field cameraDistance = contains(NumberField);
  @field enableControls = contains(BooleanField);
  @field showWireframe = contains(BooleanField);
  @field exposure = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='gltf-settings'>
        <div class='setting-row'>
          <label>Auto Rotate: {{if @model.autoRotate 'On' 'Off'}}</label>
        </div>
        {{#if @model.rotationSpeed}}
          <div class='setting-row'>
            <label>Speed: {{@model.rotationSpeed}}x</label>
          </div>
        {{/if}}
        {{#if @model.exposure}}
          <div class='setting-row'>
            <label>Exposure: {{@model.exposure}}</label>
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* ⁸ Settings styles */
        .gltf-settings {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          font-size: 0.75rem;
        }

        .setting-row {
          display: flex;
          justify-content: space-between;
        }

        .setting-row label {
          color: var(--boxel-400);
        }
      </style>
    </template>
  };
}

class GltfViewerIsolated extends Component<typeof GltfViewer> {
  @tracked errorMessage = '';
  @tracked loadingProgress = 0;
  @tracked isModelLoaded = false;
  @tracked showControls = false;

  private canvasElement?: HTMLCanvasElement;
  private scene?: any;
  private camera?: any;
  private renderer?: any;
  private controls?: any;
  private model?: any;
  private animationId?: number;

  private initializeScene = task(async () => {
    try {
      if (!this.canvasElement) {
        throw new Error('Canvas not available');
      }

      // Scene setup
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x2c3e50);

      // Camera setup
      const aspect =
        this.canvasElement.clientWidth / this.canvasElement.clientHeight;
      this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);
      this.camera.position.set(0, 1, 3);

      // Renderer setup
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvasElement,
        antialias: true,
      });
      this.renderer.setSize(
        this.canvasElement.clientWidth,
        this.canvasElement.clientHeight,
      );
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure =
        this.args.model?.settings?.exposure ?? 1;

      // Lighting setup
      const hemisphereLight = new THREE.HemisphereLight(
        0xffffff,
        0x444444,
        1.2,
      );
      this.scene.add(hemisphereLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(5, 5, 5);
      directionalLight.castShadow = true;
      directionalLight.shadow.mapSize.width = 2048;
      directionalLight.shadow.mapSize.height = 2048;
      this.scene.add(directionalLight);

      // Controls setup
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.autoRotate = this.args.model?.settings?.autoRotate ?? false;
      this.controls.autoRotateSpeed =
        this.args.model?.settings?.rotationSpeed ?? 2;
      this.controls.minDistance = 1;
      this.controls.maxDistance = 10;

      this.animate();

      // Load model if URL is provided
      if (this.args.model?.modelUrl) {
        this.loadModel.perform();
      }
    } catch (error: any) {
      this.errorMessage = `Scene initialization failed: ${error.message}`;
      console.error('GltfViewer: Scene initialization error', error);
    }
  });

  private loadModel = task(async () => {
    if (!this.args.model?.modelUrl || !this.scene) {
      return;
    }

    try {
      this.loadingProgress = 0;
      this.isModelLoaded = false;

      // Clear existing model
      if (this.model) {
        this.scene.remove(this.model);
      }

      const loader = new GLTFLoader();

      // Set up progress tracking
      loader.load(
        this.args.model.modelUrl,
        (gltf: any) => {
          // Model loaded successfully
          this.model = gltf.scene;

          // Center and scale the model
          const box = new THREE.Box3().setFromObject(this.model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          // Center the model
          this.model.position.sub(center);

          // Scale to fit in view
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 2) {
            this.model.scale.multiplyScalar(2 / maxDim);
          }

          // Apply wireframe if enabled
          if (this.args.model?.settings?.showWireframe) {
            this.model.traverse((child: any) => {
              if (child.isMesh && child.material) {
                child.material.wireframe = true;
              }
            });
          }

          this.scene.add(this.model);
          this.isModelLoaded = true;
          this.loadingProgress = 100;

          // Adjust camera distance
          const distance = this.args.model?.settings?.cameraDistance ?? 3;
          this.camera.position.set(0, 1, distance);

          if (this.controls) {
            this.controls.update();
          }
        },
        (progress: any) => {
          // Progress tracking
          if (progress.lengthComputable) {
            this.loadingProgress = (progress.loaded / progress.total) * 100;
          }
        },
        (error: any) => {
          // Error handling
          this.errorMessage = `Failed to load model: ${error.message}`;
          console.error('GltfViewer: Model loading error', error);
        },
      );
    } catch (error: any) {
      this.errorMessage = `Model loading failed: ${error.message}`;
      console.error('GltfViewer: Model loading error', error);
    }
  });

  private animate = () => {
    this.animationId = requestAnimationFrame(this.animate);

    if (this.controls) {
      this.controls.update();
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  @action
  onCanvas(canvas: HTMLCanvasElement) {
    this.canvasElement = canvas;
    this.initializeScene.perform();
  }

  @action
  reloadModel() {
    this.errorMessage = '';
    this.loadModel.perform();
  }

  @action
  toggleControls() {
    this.showControls = !this.showControls;
  }

  @action
  resetCamera() {
    if (this.camera && this.controls) {
      this.camera.position.set(0, 1, 3);
      this.controls.reset();
    }
  }

  willDestroy() {
    super.willDestroy();
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  <template>
    <div class='gltf-viewer'>
      <header class='viewer-header'>
        <h1>{{if @model.modelName @model.modelName '3D Model Viewer'}}</h1>
        {{#if @model.description}}
          <p class='description'>{{@model.description}}</p>
        {{/if}}

        <div class='viewer-controls'>
          <Button class='control-btn' {{on 'click' this.toggleControls}}>
            {{if this.showControls 'Hide' 'Show'}}
            Controls
          </Button>

          {{#if this.isModelLoaded}}
            <Button
              class='control-btn secondary'
              {{on 'click' this.resetCamera}}
            >
              Reset View
            </Button>
          {{/if}}

          {{#if @model.modelUrl}}
            <Button
              class='control-btn secondary'
              {{on 'click' this.reloadModel}}
            >
              Reload Model
            </Button>
          {{/if}}
        </div>
      </header>

      {{#if this.showControls}}
        <div class='controls-panel'>
          {{#if @model.settings}}
            <@fields.settings />
          {{else}}
            <div class='no-settings'>No advanced settings configured</div>
          {{/if}}
        </div>
      {{/if}}

      <div class='canvas-container'>
        {{#if this.errorMessage}}
          <div class='error-overlay'>
            <div class='error-content'>
              <h3>Error Loading 3D Model</h3>
              <p>{{this.errorMessage}}</p>
              {{#if @model.modelUrl}}
                <Button class='retry-btn' {{on 'click' this.reloadModel}}>
                  Try Again
                </Button>
              {{/if}}
            </div>
          </div>
        {{/if}}

        {{#if this.loadModel.isRunning}}
          <div class='loading-overlay'>
            <div class='loading-content'>
              <div class='loading-spinner'></div>
              <p>Loading 3D Model...</p>
              {{#if (gt (Number this.loadingProgress) 0)}}
                <div class='progress-bar'>
                  <div
                    class='progress-fill'
                    style={{htmlSafe 'width: {{this.loadingProgress}}%'}}
                  ></div>
                </div>
                <span class='progress-text'>{{this.loadingProgress}}%</span>
              {{/if}}
            </div>
          </div>
        {{/if}}

        <canvas
          class='three-canvas'
          {{ThreeCanvasModifier onCanvas=this.onCanvas}}
        ></canvas>

        {{#unless @model.modelUrl}}
          <div class='no-model-overlay'>
            <div class='no-model-content'>
              <CubeIcon class='placeholder-icon' />
              <h3>No 3D Model Loaded</h3>
              <p>Add a GLB/GLTF model URL to view your 3D content</p>
            </div>
          </div>
        {{/unless}}
      </div>
    </div>

    <style scoped>
      .gltf-viewer {
        display: flex;
        flex-direction: column;
        height: 100vh;
        max-height: 800px;
        background: #f8fafc;
        border-radius: 12px;
        overflow: hidden;
        font-family:
          'Inter',
          -apple-system,
          sans-serif;
      }

      .viewer-header {
        padding: 1.5rem;
        background: white;
        border-bottom: 1px solid #e2e8f0;
      }

      .viewer-header h1 {
        margin: 0 0 0.5rem 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #1e293b;
      }

      .description {
        margin: 0 0 1rem 0;
        color: #64748b;
        font-size: 0.875rem;
        line-height: 1.5;
      }

      .viewer-controls {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .control-btn {
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
        border-radius: 6px;
        border: 1px solid #d1d5db;
        background: white;
        color: #374151;
        cursor: pointer;
        transition: all 0.2s;
      }

      .control-btn:hover {
        background: #f9fafb;
        border-color: #9ca3af;
      }

      .control-btn.secondary {
        background: #f8fafc;
        color: #6b7280;
      }

      .controls-panel {
        padding: 1rem 1.5rem;
        background: #f1f5f9;
        border-bottom: 1px solid #e2e8f0;
      }

      .no-settings {
        font-size: 0.875rem;
        color: #64748b;
        font-style: italic;
      }

      .canvas-container {
        position: relative;
        flex: 1;
        min-height: 400px;
        background: #1e293b;
      }

      .three-canvas {
        width: 100%;
        height: 100%;
        display: block;
      }

      .error-overlay,
      .loading-overlay,
      .no-model-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(30, 41, 59, 0.9);
        z-index: 10;
      }

      .error-content,
      .loading-content,
      .no-model-content {
        text-align: center;
        color: white;
        max-width: 400px;
        padding: 2rem;
      }

      .error-content h3,
      .no-model-content h3 {
        margin: 0 0 1rem 0;
        font-size: 1.125rem;
        font-weight: 600;
      }

      .error-content p,
      .no-model-content p {
        margin: 0 0 1.5rem 0;
        color: #cbd5e1;
        line-height: 1.5;
      }

      .retry-btn {
        padding: 0.75rem 1.5rem;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 500;
      }

      .retry-btn:hover {
        background: #2563eb;
      }

      .loading-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid #475569;
        border-top: 3px solid #3b82f6;
        border-radius: 50%;
        margin: 0 auto 1rem auto;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .progress-bar {
        width: 100%;
        height: 8px;
        background: #475569;
        border-radius: 4px;
        margin: 1rem 0 0.5rem 0;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: #3b82f6;
        transition: width 0.3s ease;
      }

      .progress-text {
        font-size: 0.875rem;
        color: #cbd5e1;
      }

      .placeholder-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem auto;
        opacity: 0.6;
      }

      .viewer-footer {
        padding: 1rem 1.5rem;
        background: white;
        border-top: 1px solid #e2e8f0;
      }

      .model-info {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.875rem;
      }

      .status-indicator {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.75rem;
        border-radius: 999px;
        font-weight: 500;
      }

      .status-indicator.success {
        background: #dcfce7;
        color: #166534;
      }

      .status-indicator.success::before {
        content: '●';
        color: #22c55e;
      }

      .model-link {
        color: #3b82f6;
        text-decoration: none;
        font-weight: 500;
      }

      .model-link:hover {
        text-decoration: underline;
      }

      @media (max-width: 768px) {
        .gltf-viewer {
          height: 100vh;
          border-radius: 0;
        }

        .viewer-header {
          padding: 1rem;
        }

        .viewer-controls {
          flex-direction: column;
        }

        .control-btn {
          width: 100%;
          justify-content: center;
        }

        .canvas-container {
          min-height: 300px;
        }
      }
    </style>
  </template>
}

export class GltfViewer extends CardDef {
  static displayName = 'GLTF Loader';
  static icon = CubeIcon;

  @field modelName = contains(StringField);
  @field modelUrl = contains(UrlField);
  @field description = contains(StringField);
  @field settings = contains(GltfSettingsField);

  @field title = contains(StringField, {
    computeVia: function (this: GltfViewer) {
      try {
        return this.modelName ?? '3D Model';
      } catch (e) {
        console.error('GltfViewer: Error computing title', e);
        return '3D Model';
      }
    },
  });

  static isolated = GltfViewerIsolated;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='gltf-card'>
        <div class='card-header'>
          <CubeIcon class='card-icon' />
          <div class='card-info'>
            <h3>{{if @model.modelName @model.modelName '3D Model'}}</h3>
            {{#if @model.description}}
              <p>{{@model.description}}</p>
            {{else}}
              <p class='placeholder'>No description provided</p>
            {{/if}}
          </div>
        </div>

        <div class='card-footer'>
          {{#if @model.modelUrl}}
            <span class='model-status ready'>Ready to load</span>
          {{else}}
            <span class='model-status pending'>No model URL</span>
          {{/if}}

          {{#if @model.settings}}
            <div class='settings-preview'>
              <@fields.settings />
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .gltf-card {
          padding: 1rem;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          font-family:
            'Inter',
            -apple-system,
            sans-serif;
        }

        .card-header {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }

        .card-icon {
          width: 24px;
          height: 24px;
          color: #6366f1;
          flex-shrink: 0;
          margin-top: 0.125rem;
        }

        .card-info h3 {
          margin: 0 0 0.25rem 0;
          font-size: 1rem;
          font-weight: 600;
          color: #1e293b;
        }

        .card-info p {
          margin: 0;
          font-size: 0.875rem;
          color: #64748b;
          line-height: 1.4;
        }

        .card-info p.placeholder {
          font-style: italic;
          color: #9ca3af;
        }

        .card-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }

        .model-status {
          font-size: 0.75rem;
          font-weight: 500;
          padding: 0.25rem 0.5rem;
          border-radius: 999px;
        }

        .model-status.ready {
          background: #dcfce7;
          color: #166534;
        }

        .model-status.pending {
          background: #fef3c7;
          color: #92400e;
        }

        .settings-preview {
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='badge-content'>
            <CubeIcon class='badge-icon' />
            <div class='badge-info'>
              <span class='badge-title'>{{if
                  @model.modelName
                  @model.modelName
                  '3D Model'
                }}</span>
              {{#if @model.modelUrl}}
                <span class='badge-status ready'>●</span>
              {{else}}
                <span class='badge-status pending'>○</span>
              {{/if}}
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <CubeIcon class='strip-icon' />
          <div class='strip-content'>
            <div class='strip-title'>{{if
                @model.modelName
                @model.modelName
                '3D Model'
              }}</div>
            <div class='strip-meta'>
              {{#if @model.modelUrl}}
                <span class='strip-status ready'>Ready to load</span>
              {{else}}
                <span class='strip-status pending'>No model URL</span>
              {{/if}}
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-header'>
            <CubeIcon class='tile-icon' />
            <span class='tile-title'>{{if
                @model.modelName
                @model.modelName
                '3D Model'
              }}</span>
          </div>

          <div class='tile-content'>
            {{#if @model.description}}
              <p class='tile-description'>{{@model.description}}</p>
            {{else}}
              <p class='tile-placeholder'>GLTF 3D model viewer</p>
            {{/if}}
          </div>

          <div class='tile-footer'>
            {{#if @model.modelUrl}}
              <span class='tile-status ready'>● Ready</span>
            {{else}}
              <span class='tile-status pending'>○ Pending</span>
            {{/if}}
          </div>
        </div>

        <div class='card-format'>
          <div class='card-main'>
            <div class='card-header'>
              <CubeIcon class='card-icon' />
              <div class='card-title-area'>
                <h4>{{if @model.modelName @model.modelName '3D Model'}}</h4>
                {{#if @model.description}}
                  <p>{{@model.description}}</p>
                {{else}}
                  <p class='card-placeholder'>Interactive 3D model viewer
                    powered by Three.js</p>
                {{/if}}
              </div>
            </div>

            <div class='card-details'>
              {{#if @model.modelUrl}}
                <div class='detail-row'>
                  <span class='detail-label'>Status:</span>
                  <span class='detail-value ready'>Ready to load</span>
                </div>
              {{else}}
                <div class='detail-row'>
                  <span class='detail-label'>Status:</span>
                  <span class='detail-value pending'>No model URL configured</span>
                </div>
              {{/if}}

              {{#if @model.settings}}
                <div class='detail-row'>
                  <span class='detail-label'>Settings:</span>
                  <span class='detail-value'>Configured</span>
                </div>
              {{/if}}
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family:
            'Inter',
            -apple-system,
            sans-serif;
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
          }
        }

        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        .badge-format {
          align-items: center;
        }

        .badge-content {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
        }

        .badge-icon {
          width: 16px;
          height: 16px;
          color: #6366f1;
          flex-shrink: 0;
        }

        .badge-info {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
        }

        .badge-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: #1e293b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .badge-status {
          font-size: 0.625rem;
          margin-left: 0.25rem;
        }

        .badge-status.ready {
          color: #22c55e;
        }
        .badge-status.pending {
          color: #f59e0b;
        }

        .strip-format {
          align-items: center;
          gap: 0.75rem;
        }

        .strip-icon {
          width: 24px;
          height: 24px;
          color: #6366f1;
          flex-shrink: 0;
        }

        .strip-content {
          flex: 1;
          min-width: 0;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1e293b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 0.25rem;
        }

        .strip-meta {
          font-size: 0.75rem;
          color: #64748b;
        }

        .strip-status.ready {
          color: #22c55e;
        }
        .strip-status.pending {
          color: #f59e0b;
        }

        .tile-format {
          justify-content: space-between;
        }

        .tile-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .tile-icon {
          width: 20px;
          height: 20px;
          color: #6366f1;
        }

        .tile-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1e293b;
        }

        .tile-content {
          flex: 1;
          margin-bottom: 0.75rem;
        }

        .tile-description {
          margin: 0;
          font-size: 0.75rem;
          color: #64748b;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .tile-placeholder {
          margin: 0;
          font-size: 0.75rem;
          color: #9ca3af;
          font-style: italic;
        }

        .tile-footer {
          margin-top: auto;
        }

        .tile-status {
          font-size: 0.75rem;
          font-weight: 500;
        }

        .tile-status.ready {
          color: #22c55e;
        }
        .tile-status.pending {
          color: #f59e0b;
        }

        .card-format {
          gap: 1rem;
        }

        .card-header {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
        }

        .card-icon {
          width: 24px;
          height: 24px;
          color: #6366f1;
          flex-shrink: 0;
          margin-top: 0.125rem;
        }

        .card-title-area h4 {
          margin: 0 0 0.25rem 0;
          font-size: 1rem;
          font-weight: 600;
          color: #1e293b;
        }

        .card-title-area p {
          margin: 0;
          font-size: 0.875rem;
          color: #64748b;
          line-height: 1.4;
        }

        .card-placeholder {
          font-style: italic;
          color: #9ca3af;
        }

        .card-details {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.75rem;
        }

        .detail-label {
          color: #64748b;
          font-weight: 500;
        }

        .detail-value {
          font-weight: 600;
        }

        .detail-value.ready {
          color: #22c55e;
        }
        .detail-value.pending {
          color: #f59e0b;
        }
      </style>
    </template>
  };
}
