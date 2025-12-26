import StringField from 'https://cardstack.com/base/string';
import { eq } from '@cardstack/boxel-ui/helpers';
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import ColorField from '../fields/color';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { task } from 'ember-concurrency';
import Modifier, { ArgsFor } from 'ember-modifier';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

// ² Global THREE accessor
function three() {
  return (globalThis as any).THREE;
}

// ³ Canvas modifier for Three.js initialization
type ThreeCanvasModifierSignature = {
  Element: HTMLCanvasElement;
  Args: {
    Positional: [];
    Named: {
      onInit: (canvas: HTMLCanvasElement) => void;
    };
  };
};

class ThreeCanvasModifier extends Modifier<ThreeCanvasModifierSignature> {
  element!: HTMLCanvasElement;
  callback!: (canvas: HTMLCanvasElement) => void;

  modify(
    element: HTMLCanvasElement,
    _positional: ArgsFor<ThreeCanvasModifierSignature>['positional'],
    named: ArgsFor<ThreeCanvasModifierSignature>['named'],
  ) {
    this.element = element;
    this.callback = named.onInit;
    this.callback(element);
  }
}

export class ThreejsCarCustomizer extends CardDef {
  // ⁴ Main card definition
  static displayName = 'Threejs Car Customizer';
  static prefersWideFormat = true;

  @field title = contains(StringField, {
    computeVia: function (this: ThreejsCarCustomizer) {
      return 'Threejs Car Customizer';
    },
  });

  @field bodyColor = contains(ColorField, {
    configuration: {
      variant: 'advanced',
      options: {
        defaultFormat: 'hex',
      },
    },
  }); // ⁵ Customization colors with advanced picker
  @field faceColor = contains(ColorField, {
    configuration: {
      variant: 'advanced',
      options: {
        defaultFormat: 'hex',
      },
    },
  });
  @field eyesColor = contains(ColorField, {
    configuration: {
      variant: 'advanced',
      options: {
        defaultFormat: 'hex',
      },
    },
  });
  @field outfitColor = contains(ColorField, {
    configuration: {
      variant: 'advanced',
      options: {
        defaultFormat: 'hex',
      },
    },
  });

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='car-edit-form'>
        <h2>🚗 Customize Your Car</h2>

        <div class='field-group'>
          <label>Car Body Color</label>
          <@fields.bodyColor @format='edit' />
        </div>

        <div class='field-group'>
          <label>Roof/Windows Color</label>
          <@fields.faceColor @format='edit' />
        </div>

        <div class='field-group'>
          <label>Wheels Color</label>
          <@fields.eyesColor @format='edit' />
        </div>

        <div class='field-group'>
          <label>Lights/Details Color</label>
          <@fields.outfitColor @format='edit' />
        </div>
      </div>

      <style scoped>
        .car-edit-form {
          padding: 1.5rem;
          max-width: 600px;
          margin: 0 auto;
        }

        .car-edit-form h2 {
          margin-bottom: 1.5rem;
          color: #1f2937;
        }

        .field-group {
          margin-bottom: 1.5rem;
        }

        .field-group label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 600;
          color: #374151;
        }
      </style>
    </template>
  };

  static isolated: typeof ThreejsCarCustomizerIsolated;
}

class ThreejsCarCustomizerIsolated extends Component<
  typeof ThreejsCarCustomizer
> {
  // ⁶ Isolated format
  @tracked private errorMessage = '';
  @tracked private selectedRegion: 'body' | 'face' | 'eyes' = 'body';
  @tracked private bodyColor = this.args.model?.bodyColor || '#9CA3AF';
  @tracked private faceColor = this.args.model?.faceColor || '#F3F4F6';
  @tracked private eyesColor = this.args.model?.eyesColor || '#1F2937';
  @tracked private outfitColor = this.args.model?.outfitColor || '#6366F1';
  @tracked private colorFormat: 'hex' | 'rgb' | 'hsl' = 'hex';
  @tracked private showAdvancedPicker = false;

  private canvasElement: HTMLCanvasElement | undefined;
  private scene: any;
  private camera: any;
  private renderer: any;
  private car: any;
  private bodyMesh: any;
  private faceMesh: any;
  private eyesMesh: any;
  private outfitMesh: any;
  private controls: any;
  private animationFrameId: number | undefined;
  private resizeObserver: any;

  // ⁷ Load Three.js library
  private loadThreeJs = task(async () => {
    if (three()) return;

    const script = document.createElement('script');
    script.src =
      'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
    script.async = true;

    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    // ⁸ Load OrbitControls
    const controlsScript = document.createElement('script');
    controlsScript.text = `
        (function() {
          const THREE = window.THREE;
          class OrbitControls {
            constructor(camera, domElement) {
              this.camera = camera;
              this.domElement = domElement;
              this.enabled = true;
              this.target = new THREE.Vector3();
              this.minDistance = 3;
              this.maxDistance = 8;
              this.minPolarAngle = 0;
              this.maxPolarAngle = Math.PI;
              this.enableDamping = true;
              this.dampingFactor = 0.05;
              this.rotateSpeed = 1.0;
              this.enableZoom = true;
              
              this.state = 'NONE';
              this.rotateStart = new THREE.Vector2();
              this.rotateEnd = new THREE.Vector2();
              this.rotateDelta = new THREE.Vector2();
              this.spherical = new THREE.Spherical();
              this.sphericalDelta = new THREE.Spherical();
              this.scale = 1;
              
              this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
              this.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
              this.domElement.addEventListener('wheel', this.onMouseWheel.bind(this));
            }
            
            onPointerDown(event) {
              if (!this.enabled) return;
              event.preventDefault();
              this.rotateStart.set(event.clientX, event.clientY);
              this.state = 'ROTATE';
              this.domElement.addEventListener('pointermove', this.onPointerMove.bind(this));
              this.domElement.addEventListener('pointerup', this.onPointerUp.bind(this));
            }
            
            onPointerMove(event) {
              if (!this.enabled) return;
              event.preventDefault();
              this.rotateEnd.set(event.clientX, event.clientY);
              this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart).multiplyScalar(this.rotateSpeed);
              this.rotateLeft(2 * Math.PI * this.rotateDelta.x / this.domElement.clientHeight);
              this.rotateUp(2 * Math.PI * this.rotateDelta.y / this.domElement.clientHeight);
              this.rotateStart.copy(this.rotateEnd);
              this.update();
            }
            
            onPointerUp() {
              if (!this.enabled) return;
              this.state = 'NONE';
              this.domElement.removeEventListener('pointermove', this.onPointerMove.bind(this));
              this.domElement.removeEventListener('pointerup', this.onPointerUp.bind(this));
            }
            
            onMouseWheel(event) {
              if (!this.enabled || !this.enableZoom) return;
              event.preventDefault();
              
              // Invert the zoom direction for natural feeling
              if (event.deltaY < 0) {
                this.dollyIn(1.02);  // Scroll up = zoom in
              } else {
                this.dollyOut(1.02); // Scroll down = zoom out
              }
            }
            
            rotateLeft(angle) {
              this.sphericalDelta.theta -= angle;
            }
            
            rotateUp(angle) {
              this.sphericalDelta.phi -= angle;
            }
            
            dollyIn(scale) {
              this.scale /= scale;
            }
            
            dollyOut(scale) {
              this.scale *= scale;
            }
            
            update() {
              const offset = new THREE.Vector3();
              const quat = new THREE.Quaternion().setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0));
              const quatInverse = quat.clone().invert();
              
              offset.copy(this.camera.position).sub(this.target);
              offset.applyQuaternion(quat);
              this.spherical.setFromVector3(offset);
              
              if (this.enableDamping) {
                this.spherical.theta += this.sphericalDelta.theta * this.dampingFactor;
                this.spherical.phi += this.sphericalDelta.phi * this.dampingFactor;
              } else {
                this.spherical.theta += this.sphericalDelta.theta;
                this.spherical.phi += this.sphericalDelta.phi;
              }
              
              this.spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.spherical.phi));
              this.spherical.makeSafe();
              this.spherical.radius *= this.scale;
              this.spherical.radius = Math.max(this.minDistance, Math.min(this.maxDistance, this.spherical.radius));
              
              offset.setFromSpherical(this.spherical);
              offset.applyQuaternion(quatInverse);
              this.camera.position.copy(this.target).add(offset);
              this.camera.lookAt(this.target);
              
              if (this.enableDamping) {
                this.sphericalDelta.theta *= (1 - this.dampingFactor);
                this.sphericalDelta.phi *= (1 - this.dampingFactor);
              } else {
                this.sphericalDelta.set(0, 0, 0);
              }
              
              this.scale = 1;
              return false;
            }
            
            dispose() {
              this.domElement.removeEventListener('contextmenu', () => {});
              this.domElement.removeEventListener('pointerdown', this.onPointerDown);
              this.domElement.removeEventListener('wheel', this.onMouseWheel);
            }
          }
          THREE.OrbitControls = OrbitControls;
        })();
      `;
    document.head.appendChild(controlsScript);
  });

  // ⁹ Initialize Three.js scene
  private initThreeJs = task(async () => {
    try {
      await this.loadThreeJs.perform();
      if (!three() || !this.canvasElement) return;

      const THREE = three();

      // ¹⁰ Scene setup
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0xf8fafc);

      // ¹¹ Camera
      this.camera = new THREE.PerspectiveCamera(
        50,
        this.canvasElement.clientWidth / this.canvasElement.clientHeight,
        0.1,
        1000,
      );

      // Calculate optimal camera distance based on viewport
      const aspectRatio =
        this.canvasElement.clientWidth / this.canvasElement.clientHeight;
      const baseDistance = aspectRatio > 1 ? 5.5 : 6.5; // Further away for better view
      this.camera.position.set(0, 1, baseDistance);

      // ¹² Renderer
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvasElement,
        antialias: true,
        alpha: true,
      });
      this.renderer.setSize(
        this.canvasElement.clientWidth,
        this.canvasElement.clientHeight,
      );
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if ('outputColorSpace' in this.renderer) {
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else {
        this.renderer.outputEncoding = THREE.sRGBEncoding;
      }
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1.0;

      // Add resize observer for dynamic fitting
      this.resizeObserver = new (window as any).ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.canvasElement);

      // ¹³ Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
      this.scene.add(ambientLight);

      const hemisphereLight = new THREE.HemisphereLight(
        0xffffff,
        0xcccccc,
        0.6,
      );
      hemisphereLight.position.set(0, 1, 0);
      this.scene.add(hemisphereLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
      directionalLight.position.set(5, 10, 5);
      directionalLight.castShadow = true;
      directionalLight.shadow.mapSize.width = 2048;
      directionalLight.shadow.mapSize.height = 2048;
      this.scene.add(directionalLight);

      const fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
      fillLight.position.set(-5, 5, -5);
      this.scene.add(fillLight);

      // ¹⁴ Create low-poly car
      this.createCar();

      // ¹⁵ OrbitControls
      this.controls = new THREE.OrbitControls(this.camera, this.canvasElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.enableZoom = true; // Re-enable zoom

      // Set zoom limits
      this.controls.minDistance = 2;
      this.controls.maxDistance = 8;
      this.controls.maxPolarAngle = Math.PI / 1.5;

      // ¹⁶ Start animation
      this.animate();
    } catch (e: any) {
      this.errorMessage = `Error initializing 3D: ${e.message}`;
    }
  });

  // ¹⁷ Create low-poly car model
  private createCar() {
    const THREE = three();
    this.car = new THREE.Group();

    // ¹⁸ Car body (main chassis)
    const bodyGeometry = new THREE.BoxGeometry(2, 0.6, 1);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: this.bodyColor,
      flatShading: true,
      roughness: 0.2,
      metalness: 0,
    });
    this.bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    this.bodyMesh.position.y = 0.4;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.car.add(this.bodyMesh);

    // ¹⁹ Car roof/cabin
    const roofGeometry = new THREE.BoxGeometry(1.2, 0.5, 0.9);
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: this.faceColor,
      flatShading: true,
      roughness: 0.25,
      metalness: 0,
    });
    this.faceMesh = new THREE.Mesh(roofGeometry, roofMaterial);
    this.faceMesh.position.set(0, 0.85, 0);
    this.faceMesh.castShadow = true;
    this.car.add(this.faceMesh);

    // ²⁰ Wheels (group)
    this.eyesMesh = new THREE.Group();
    const wheelGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.2, 8);

    // Create separate materials for each wheel so they can be updated
    // Front left wheel
    const frontLeftWheel = new THREE.Mesh(
      wheelGeometry,
      new THREE.MeshStandardMaterial({
        color: this.eyesColor,
        flatShading: true,
        roughness: 0.8,
        metalness: 0.2,
      }),
    );
    frontLeftWheel.position.set(-0.6, 0.15, 0.6);
    frontLeftWheel.rotation.z = Math.PI / 2;
    frontLeftWheel.castShadow = true;
    this.eyesMesh.add(frontLeftWheel);

    // Front right wheel
    const frontRightWheel = new THREE.Mesh(
      wheelGeometry,
      new THREE.MeshStandardMaterial({
        color: this.eyesColor,
        flatShading: true,
        roughness: 0.8,
        metalness: 0.2,
      }),
    );
    frontRightWheel.position.set(-0.6, 0.15, -0.6);
    frontRightWheel.rotation.z = Math.PI / 2;
    frontRightWheel.castShadow = true;
    this.eyesMesh.add(frontRightWheel);

    // Rear left wheel
    const rearLeftWheel = new THREE.Mesh(
      wheelGeometry,
      new THREE.MeshStandardMaterial({
        color: this.eyesColor,
        flatShading: true,
        roughness: 0.8,
        metalness: 0.2,
      }),
    );
    rearLeftWheel.position.set(0.6, 0.15, 0.6);
    rearLeftWheel.rotation.z = Math.PI / 2;
    rearLeftWheel.castShadow = true;
    this.eyesMesh.add(rearLeftWheel);

    // Rear right wheel
    const rearRightWheel = new THREE.Mesh(
      wheelGeometry,
      new THREE.MeshStandardMaterial({
        color: this.eyesColor,
        flatShading: true,
        roughness: 0.8,
        metalness: 0.2,
      }),
    );
    rearRightWheel.position.set(0.6, 0.15, -0.6);
    rearRightWheel.rotation.z = Math.PI / 2;
    rearRightWheel.castShadow = true;
    this.eyesMesh.add(rearRightWheel);

    this.car.add(this.eyesMesh);

    // ²¹ Car details (headlights, grille)
    const detailGeometry = new THREE.BoxGeometry(0.1, 0.15, 0.8);
    const detailMaterial = new THREE.MeshStandardMaterial({
      color: this.outfitColor,
      flatShading: true,
      roughness: 0.2,
      metalness: 0.9,
      emissive: this.outfitColor,
      emissiveIntensity: 0.3,
    });
    this.outfitMesh = new THREE.Mesh(detailGeometry, detailMaterial);
    this.outfitMesh.position.set(-1.05, 0.4, 0);
    this.outfitMesh.castShadow = true;
    this.car.add(this.outfitMesh);

    // Add rear lights
    const rearLightGeometry = new THREE.BoxGeometry(0.1, 0.15, 0.3);
    const rearLight1 = new THREE.Mesh(rearLightGeometry, detailMaterial);
    rearLight1.position.set(1.05, 0.4, 0.25);
    this.car.add(rearLight1);

    const rearLight2 = new THREE.Mesh(rearLightGeometry, detailMaterial);
    rearLight2.position.set(1.05, 0.4, -0.25);
    this.car.add(rearLight2);

    // ²² Ground shadow plane
    const groundGeometry = new THREE.CircleGeometry(3, 32);
    const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.2 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.car.add(ground);

    // Scale down the car to make it smaller
    this.car.scale.set(0.7, 0.7, 0.7);

    this.scene.add(this.car);
  }

  // ²³ Animation loop
  private animate = () => {
    if (!this.renderer || !this.scene || !this.camera) return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    if (this.controls) {
      this.controls.update();
    }

    // ²⁴ Gentle idle animation with wheel rotation
    if (this.car) {
      this.car.position.y = Math.sin(Date.now() * 0.001) * 0.02;
      // Rotate wheels
      if (this.eyesMesh) {
        this.eyesMesh.children.forEach((wheel: any) => {
          wheel.rotation.x += 0.02;
        });
      }
    }

    // Trigger reactive getters to check for color updates
    this.modelBodyColor;
    this.modelFaceColor;
    this.modelEyesColor;
    this.modelOutfitColor;

    this.renderer.render(this.scene, this.camera);
  };

  // ²⁵ Canvas initialization
  @action
  onCanvasInit(canvas: HTMLCanvasElement) {
    this.canvasElement = canvas;
    this.initThreeJs.perform();
  }

  // ²⁶ Region selection
  @action
  selectRegion(region: 'body' | 'face' | 'eyes') {
    this.selectedRegion = region;
  }

  // ²⁷ Color update
  @action
  updateColor(event: Event) {
    const color = (event.target as HTMLInputElement).value;
    this.applyColorToRegion(color);
  }

  private updateMaterialColor(material: any, color: string) {
    if (!material) {
      return;
    }
    material.color.set(color);
    material.needsUpdate = true;
  }

  // Update colors when model changes
  // Watch for model color changes and update 3D meshes
  get modelBodyColor() {
    const color = this.args.model?.bodyColor || '#9CA3AF';
    if (this.bodyMesh && color !== this.bodyColor) {
      this.bodyColor = color;
      this.updateMaterialColor(this.bodyMesh.material, color);
    }
    return color;
  }

  get modelFaceColor() {
    const color = this.args.model?.faceColor || '#F3F4F6';
    if (this.faceMesh && color !== this.faceColor) {
      this.faceColor = color;
      this.updateMaterialColor(this.faceMesh.material, color);
    }
    return color;
  }

  get modelEyesColor() {
    const color = this.args.model?.eyesColor || '#1F2937';
    if (this.eyesMesh && color !== this.eyesColor) {
      this.eyesColor = color;
      this.eyesMesh.children.forEach((wheel: any) => {
        if (wheel.material) {
          this.updateMaterialColor(wheel.material, color);
        }
      });
    }
    return color;
  }

  get modelOutfitColor() {
    const color = this.args.model?.outfitColor || '#6366F1';
    if (this.outfitMesh && color !== this.outfitColor) {
      this.outfitColor = color;
      this.updateMaterialColor(this.outfitMesh.material, color);
      // Also update rear lights
      this.car?.children.forEach((child: any) => {
        if (child.material === this.outfitMesh?.material) {
          this.updateMaterialColor(child.material, color);
        }
      });
    }
    return color;
  }

  // Helper to convert between color formats
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return (
      '#' +
      [r, g, b]
        .map((x) => {
          const hex = x.toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        })
        .join('')
    );
  }

  private rgbToHsl(
    r: number,
    g: number,
    b: number,
  ): { h: number; s: number; l: number } {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h = 0,
      s = 0,
      l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        case b:
          h = ((r - g) / d + 4) / 6;
          break;
      }
    }
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  }

  private hslToRgb(
    h: number,
    s: number,
    l: number,
  ): { r: number; g: number; b: number } {
    h /= 360;
    s /= 100;
    l /= 100;
    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
    };
  }

  @action
  updateColorFromInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    let hexColor = '';

    if (this.colorFormat === 'hex') {
      hexColor = value.startsWith('#') ? value : '#' + value;
    } else if (this.colorFormat === 'rgb') {
      // Parse RGB format: rgb(255, 255, 255) or 255,255,255
      const match = value.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (match) {
        hexColor = this.rgbToHex(
          parseInt(match[1]),
          parseInt(match[2]),
          parseInt(match[3]),
        );
      }
    } else if (this.colorFormat === 'hsl') {
      // Parse HSL format: hsl(360, 100%, 50%) or 360,100,50
      const match = value.match(/(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?/);
      if (match) {
        const rgb = this.hslToRgb(
          parseInt(match[1]),
          parseInt(match[2]),
          parseInt(match[3]),
        );
        hexColor = this.rgbToHex(rgb.r, rgb.g, rgb.b);
      }
    }

    if (hexColor && /^#[0-9A-F]{6}$/i.test(hexColor)) {
      this.applyColorToRegion(hexColor);
    }
  }

  private applyColorToRegion(color: string) {
    switch (this.selectedRegion) {
      case 'body':
        this.bodyColor = color;
        if (this.bodyMesh)
          this.updateMaterialColor(this.bodyMesh.material, color);
        if (this.args.model) this.args.model.bodyColor = color;
        break;
      case 'face':
        this.faceColor = color;
        if (this.faceMesh)
          this.updateMaterialColor(this.faceMesh.material, color);
        if (this.args.model) this.args.model.faceColor = color;
        break;
      case 'eyes':
        this.eyesColor = color;
        if (this.eyesMesh) {
          this.eyesMesh.children.forEach((wheel: any) => {
            if (wheel.material) {
              this.updateMaterialColor(wheel.material, color);
            }
          });
        }
        if (this.args.model) this.args.model.eyesColor = color;
        break;
    }
  }

  @action
  setColorFormat(format: 'hex' | 'rgb' | 'hsl') {
    this.colorFormat = format;
  }

  @action
  toggleAdvancedPicker() {
    this.showAdvancedPicker = !this.showAdvancedPicker;
  }

  get currentColorFormatted() {
    const color =
      this.selectedRegion === 'body'
        ? this.bodyColor
        : this.selectedRegion === 'face'
        ? this.faceColor
        : this.eyesColor;

    if (this.colorFormat === 'rgb') {
      const rgb = this.hexToRgb(color);
      return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    } else if (this.colorFormat === 'hsl') {
      const rgb = this.hexToRgb(color);
      const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);
      return `${hsl.h}, ${hsl.s}%, ${hsl.l}%`;
    }
    return color;
  }

  // ²⁸ Preset application
  @action
  applyPreset(preset: 'default' | 'cool' | 'warm' | 'vibrant') {
    const presets = {
      default: {
        body: '#9CA3AF',
        face: '#F3F4F6',
        eyes: '#1F2937',
        outfit: '#6366F1',
      },
      cool: {
        body: '#60A5FA',
        face: '#DBEAFE',
        eyes: '#1E3A8A',
        outfit: '#8B5CF6',
      },
      warm: {
        body: '#F59E0B',
        face: '#FEF3C7',
        eyes: '#78350F',
        outfit: '#EF4444',
      },
      vibrant: {
        body: '#EC4899',
        face: '#FDF2F8',
        eyes: '#831843',
        outfit: '#10B981',
      },
    };

    const colors = presets[preset];

    this.bodyColor = colors.body;
    this.faceColor = colors.face;
    this.eyesColor = colors.eyes;
    this.outfitColor = colors.outfit;

    if (this.bodyMesh)
      this.updateMaterialColor(this.bodyMesh.material, colors.body);
    if (this.faceMesh)
      this.updateMaterialColor(this.faceMesh.material, colors.face);
    if (this.eyesMesh) {
      this.eyesMesh.children.forEach((eye: any) => {
        if (eye.material) {
          this.updateMaterialColor(eye.material, colors.eyes);
        }
      });
    }
    if (this.outfitMesh)
      this.updateMaterialColor(this.outfitMesh.material, colors.outfit);

    if (this.args.model) {
      this.args.model.bodyColor = colors.body;
      this.args.model.faceColor = colors.face;
      this.args.model.eyesColor = colors.eyes;
      this.args.model.outfitColor = colors.outfit;
    }
  }

  // Rotate car by degrees
  @action
  rotateCar(degrees: number) {
    if (!this.car) return;
    const radians = (degrees * Math.PI) / 180;
    this.car.rotation.y += radians;
  }

  // ²⁹ Screenshot export
  @action
  exportScreenshot() {
    if (!this.renderer || !this.canvasElement) return;

    this.renderer.render(this.scene, this.camera);

    this.canvasElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `custom-car-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  // Handle dynamic resizing
  private handleResize() {
    if (!this.camera || !this.renderer || !this.canvasElement) return;

    const width = this.canvasElement.clientWidth;
    const height = this.canvasElement.clientHeight;

    // Update camera aspect ratio
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Update renderer size
    this.renderer.setSize(width, height);

    // Adjust camera distance based on aspect ratio
    const aspectRatio = width / height;
    const optimalDistance = aspectRatio > 1 ? 5.5 : 6.5;

    // Update camera position smoothly
    const currentDistance = this.camera.position.length();
    const scale = optimalDistance / currentDistance;
    this.camera.position.multiplyScalar(scale);

    // Update controls with zoom enabled
    if (this.controls) {
      // Keep zoom limits but adjust target distance
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  willDestroy() {
    super.willDestroy();
    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.controls) {
      this.controls.dispose();
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  <template>
    <div class='car-customizer'>
      {{#if this.initThreeJs.isRunning}}
        <div class='loading'>
          <div class='spinner'></div>
          <p>Loading 3D viewer...</p>
        </div>
      {{else if this.errorMessage}}
        <div class='error'>
          <p>⚠️ {{this.errorMessage}}</p>
        </div>
      {{else}}
        <div class='viewer-container'>
          <div class='view-controls'>
            <div class='control-hint'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M1 12a11 11 0 1 0 22 0 11 11 0 1 0-22 0' />
                <path d='M2 12h20' />
                <path
                  d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'
                />
              </svg>
              Drag to rotate
            </div>
            <div class='control-hint'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='3' />
                <path d='M12 1v6m0 6v6m11-7h-6m-6 0H1' />
                <path d='m20.5 7.5L16 12l4.5 4.5M3.5 7.5 8 12l-4.5 4.5' />
              </svg>
              Scroll to zoom
            </div>
          </div>

          <canvas
            class='three-canvas'
            {{ThreeCanvasModifier onInit=this.onCanvasInit}}
          ></canvas>

          <div class='rotate-controls'>
            <button class='rotate-btn' {{on 'click' (fn this.rotateCar -45)}}>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M23 4v6h-6M1 20v-6h6' />
                <path
                  d='M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15'
                />
              </svg>
            </button>
            <div class='rotate-label'>360° View</div>
            <button class='rotate-btn' {{on 'click' (fn this.rotateCar 45)}}>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
                class='flip-horizontal'
              >
                <path d='M23 4v6h-6M1 20v-6h6' />
                <path
                  d='M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15'
                />
              </svg>
            </button>
          </div>
        </div>

        <div class='customization-panel'>
          <h2>Customize Your Car</h2>

          <div class='region-selector'>
            <button
              class='region-btn {{if (eq this.selectedRegion "body") "active"}}'
              {{on 'click' (fn this.selectRegion 'body')}}
            >
              Car Body
            </button>
            <button
              class='region-btn {{if (eq this.selectedRegion "face") "active"}}'
              {{on 'click' (fn this.selectRegion 'face')}}
            >
              Roof/Windows
            </button>
            <button
              class='region-btn {{if (eq this.selectedRegion "eyes") "active"}}'
              {{on 'click' (fn this.selectRegion 'eyes')}}
            >
              Wheels
            </button>
          </div>

          <div class='color-picker-section'>
            <h3>Color Selection</h3>

            {{#if (eq this.selectedRegion 'body')}}
              <div class='field-group'>
                <label>Car Body Color</label>
                <@fields.bodyColor @format='edit' />
              </div>
            {{else if (eq this.selectedRegion 'face')}}
              <div class='field-group'>
                <label>Roof/Windows Color</label>
                <@fields.faceColor @format='edit' />
              </div>
            {{else if (eq this.selectedRegion 'eyes')}}
              <div class='field-group'>
                <label>Wheels Color</label>
                <@fields.eyesColor @format='edit' />
              </div>
            {{/if}}
          </div>

          <div class='presets-section'>
            <h3>Presets</h3>
            <div class='preset-buttons'>
              <button
                class='preset-btn'
                {{on 'click' (fn this.applyPreset 'default')}}
              >
                Default
              </button>
              <button
                class='preset-btn cool'
                {{on 'click' (fn this.applyPreset 'cool')}}
              >
                Cool
              </button>
              <button
                class='preset-btn warm'
                {{on 'click' (fn this.applyPreset 'warm')}}
              >
                Warm
              </button>
              <button
                class='preset-btn vibrant'
                {{on 'click' (fn this.applyPreset 'vibrant')}}
              >
                Vibrant
              </button>
            </div>
          </div>

          <button class='export-btn' {{on 'click' this.exportScreenshot}}>
            * 🚗 Export Car Screenshot
          </button>
        </div>
      {{/if}}
    </div>

    <style scoped>
      /* ³⁰ Component styles */
      .car-customizer {
        width: 100%;
        height: 100vh;
        display: flex;
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
      }

      .loading,
      .error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        color: white;
        gap: 1rem;
      }

      .spinner {
        width: 50px;
        height: 50px;
        border: 4px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .viewer-container {
        flex: 1;
        position: relative;
        overflow: hidden;
        background: #f8fafc;
        min-width: 0; /* Allow flex shrinking */
      }

      /* Interaction hints in top corners */
      .view-controls {
        position: absolute;
        top: 1rem;
        left: 1rem;
        right: 1rem;
        display: flex;
        justify-content: space-between;
        pointer-events: none;
        z-index: 10;
      }

      .control-hint {
        background: rgba(255, 255, 255, 0.9);
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.75rem;
        color: #6b7280;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .control-hint svg {
        width: 16px;
        height: 16px;
        opacity: 0.7;
      }

      .rotate-controls {
        position: absolute;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 1rem;
        background: rgba(255, 255, 255, 0.95);
        padding: 0.75rem 1.5rem;
        border-radius: 2rem;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
      }

      .rotate-btn {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 2px solid #6366f1;
        background: white;
        color: #6366f1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .rotate-btn:hover {
        background: #6366f1;
        color: white;
        transform: scale(1.1);
      }

      .rotate-btn svg {
        width: 20px;
        height: 20px;
      }

      .rotate-label {
        font-weight: 600;
        color: #374151;
        font-size: 0.875rem;
      }

      .three-canvas {
        width: 100%;
        height: 100%;
        display: block;
        cursor: grab;
      }

      .three-canvas:active {
        cursor: grabbing;
      }

      .customization-panel {
        width: 320px;
        background: white;
        overflow-y: auto;
        box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        padding: 1rem;
      }

      .customization-panel h2 {
        margin: 0;
        font-size: 1.5rem;
        color: #1f2937;
        font-weight: 700;
      }

      .region-selector {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
      }

      .region-btn {
        padding: 0.75rem;
        border: 2px solid #e5e7eb;
        background: white;
        border-radius: 0.5rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        color: #6b7280;
      }

      .region-btn:hover {
        border-color: #6366f1;
        background: #f0f0ff;
      }

      .region-btn.active {
        border-color: #6366f1;
        background: #6366f1;
        color: white;
      }

      .color-picker-section h3 {
        margin: 0 0 1rem 0;
        font-size: 1.125rem;
        color: #374151;
        font-weight: 600;
      }

      .field-group {
        margin-bottom: 1rem;
      }

      .field-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: #374151;
        font-size: 0.875rem;
      }

      .presets-section h3 {
        margin: 0;
        font-size: 1.125rem;
        color: #374151;
        font-weight: 600;
      }

      .preset-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
      }

      .preset-btn {
        padding: 0.75rem;
        border: 2px solid #e5e7eb;
        background: white;
        border-radius: 0.5rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        color: #6b7280;
      }

      .preset-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .preset-btn.cool {
        background: linear-gradient(135deg, #60a5fa, #8b5cf6);
        color: white;
        border-color: transparent;
      }

      .preset-btn.warm {
        background: linear-gradient(135deg, #f59e0b, #ef4444);
        color: white;
        border-color: transparent;
      }

      .preset-btn.vibrant {
        background: linear-gradient(135deg, #ec4899, #10b981);
        color: white;
        border-color: transparent;
      }

      .export-btn {
        padding: 1rem;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white;
        border: none;
        border-radius: 0.75rem;
        font-weight: 700;
        font-size: 1rem;
        cursor: pointer;
        transition: all 0.3s;
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }

      .export-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
      }

      .export-btn:active {
        transform: translateY(0);
      }

      .flip-horizontal {
        transform: scaleX(-1);
      }
    </style>
  </template>
}

ThreejsCarCustomizer.isolated = ThreejsCarCustomizerIsolated;
