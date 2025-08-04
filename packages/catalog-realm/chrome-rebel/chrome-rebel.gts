import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import MotorcycleIcon from '@cardstack/boxel-icons/bike';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

class IsolatedChromeRebelTemplate extends Component<typeof ChromeRebel> {
  @tracked chromeShine = false;
  @tracked engineRunning = false;

  get bikeData() {
    return {
      name: this.args?.model?.bikeName,
      engine: this.args?.model?.engineType,
      displacement: this.args?.model?.displacement,
      year: this.args?.model?.buildYear,
      features: this.args?.model?.customFeatures,
      isCustom: this.args?.model?.isCustomBuild,
    };
  }

  @action
  activateChromeShine() {
    this.chromeShine = true;
    setTimeout(() => {
      this.chromeShine = false;
    }, 2000);
  }

  @action
  startEngine() {
    this.engineRunning = !this.engineRunning;
  }

  <template>
    <div class='garage-stage {{if this.engineRunning "engine-on"}}'>
      <div class='motorcycle-tank {{if this.chromeShine "chrome-flash"}}'>
        <button
          class='chrome-badge'
          {{on 'click' this.activateChromeShine}}
          type='button'
        >
          <div class='skull-emblem'>
            <svg class='skull-svg' viewBox='0 0 100 100' fill='none'>
              <path
                d='M50 15C35 15 25 25 25 40c0 8 4 15 10 19v10c0 2 2 4 4 4h22c2 0 4-2 4-4V59c6-4 10-11 10-19 0-15-10-25-25-25z'
                fill='currentColor'
              />
              <circle cx='40' cy='42' r='3' fill='#1a1a1a' />
              <circle cx='60' cy='42' r='3' fill='#1a1a1a' />
              <path d='M47 55h6v3h-6z' fill='#1a1a1a' />
              <path d='M45 60h10v2h-10z' fill='#1a1a1a' />
            </svg>
          </div>
          <div class='badge-ring'>
            <div class='badge-text'>REBEL BORN</div>
            <div class='badge-subtext'>CHROME FORGED</div>
          </div>
        </button>

        <div class='tank-spec top-left'>
          <div class='spec-title'>{{this.bikeData.name}}</div>
          <div class='spec-detail'>CUSTOM BUILD {{this.bikeData.year}}</div>
        </div>

        <div class='tank-spec top-right'>
          <div class='spec-title'>{{this.bikeData.displacement}}</div>
          <div class='spec-detail'>{{this.bikeData.engine}} ENGINE</div>
        </div>

        <div class='tank-spec bottom-left'>
          <div class='spec-title'>STEEL REBELS</div>
          <div class='spec-detail'>CALIFORNIA GARAGE</div>
        </div>

        <div class='tank-spec bottom-right'>
          <div class='spec-title'>LIMITED</div>
          <div class='spec-detail'>EDITION #047</div>
        </div>

        <div class='rivet top-rivet-1'></div>
        <div class='rivet top-rivet-2'></div>
        <div class='rivet top-rivet-3'></div>
        <div class='rivet bottom-rivet-1'></div>
        <div class='rivet bottom-rivet-2'></div>
        <div class='rivet bottom-rivet-3'></div>

        <div class='exhaust-pipe left-pipe'></div>
        <div class='exhaust-pipe right-pipe'></div>
      </div>

      <div class='engine-controls'>
        <button
          class='engine-starter {{if this.engineRunning "running"}}'
          {{on 'click' this.startEngine}}
        >
          <svg
            class='engine-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <circle cx='12' cy='12' r='10' />
            <path d='15 9l-7 7-3-3' />
          </svg>
          {{if this.engineRunning 'ENGINE ON' 'START ENGINE'}}
        </button>

        <div class='engine-stats'>
          <div class='stat-item'>
            <span class='stat-label'>DISPLACEMENT</span>
            <span class='stat-value'>{{this.bikeData.displacement}}CC</span>
          </div>
          <div class='stat-item'>
            <span class='stat-label'>BUILD YEAR</span>
            <span class='stat-value'>{{this.bikeData.year}}</span>
          </div>
          <div class='stat-item'>
            <span class='stat-label'>TYPE</span>
            <span class='stat-value'>{{if
                this.bikeData.isCustom
                'CUSTOM'
                'STOCK'
              }}</span>
          </div>
        </div>
      </div>

      {{#if this.bikeData.features}}
        <div class='features-panel'>
          <h3 class='features-title'>CUSTOM FEATURES</h3>
          <p class='features-text'>{{this.bikeData.features}}</p>
          <div class='rebel-motto'>RIDE HARD • FEAR NOTHING</div>
        </div>
      {{/if}}

      <div class='engine-vibration'></div>
    </div>

    <style scoped>
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;500;600;700&display=swap');

      .garage-stage {
        --matte-black: #0f0f0f;
        --steel-gray: #2a2a2a;
        --chrome-silver: #e8e8e8;
        --chrome-shine: #ffffff;
        --rebel-red: #8b0000;
        --warning-orange: #ff6b35;
        --font-stencil: 'Orbitron', 'Arial Black', sans-serif;
        --font-rebel: 'Rajdhani', 'Impact', sans-serif;
      }

      .garage-stage {
        width: 100%;
        height: 100%;
        min-height: 700px;
        background:
          radial-gradient(
            circle at 30% 20%,
            var(--steel-gray) 0%,
            var(--matte-black) 50%
          ),
          linear-gradient(180deg, #1a1a1a 0%, var(--matte-black) 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        position: relative;
        overflow: hidden;
        color: var(--chrome-silver);
      }

      .garage-stage.engine-on {
        animation: engineVibration 0.1s infinite;
      }

      @keyframes engineVibration {
        0%,
        100% {
          transform: translate(0, 0);
        }
        25% {
          transform: translate(-1px, 1px);
        }
        50% {
          transform: translate(1px, -1px);
        }
        75% {
          transform: translate(-1px, -1px);
        }
      }

      .motorcycle-tank {
        width: 600px;
        height: 350px;
        background: linear-gradient(
          145deg,
          #1a1a1a 0%,
          var(--matte-black) 30%,
          #2a2a2a 100%
        );
        border-radius: 60px 60px 80px 80px;
        position: relative;
        margin-bottom: 3rem;
        box-shadow:
          0 20px 60px rgba(0, 0, 0, 0.8),
          inset 0 10px 20px rgba(255, 255, 255, 0.02),
          inset 0 -10px 20px rgba(0, 0, 0, 0.5);
        border: 2px solid #3a3a3a;
      }

      .motorcycle-tank.chrome-flash {
        animation: chromeFlash 0.5s ease-out;
      }

      @keyframes chromeFlash {
        0% {
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
        }
        50% {
          box-shadow:
            0 0 40px rgba(232, 232, 232, 0.6),
            0 20px 60px rgba(0, 0, 0, 0.8);
        }
        100% {
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
        }
      }

      .chrome-badge {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 160px;
        height: 160px;
        background: radial-gradient(
          circle at 30% 30%,
          var(--chrome-shine) 0%,
          var(--chrome-silver) 50%,
          #b8b8b8 100%
        );
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 10;
        box-shadow:
          0 0 20px rgba(232, 232, 232, 0.3),
          0 8px 32px rgba(0, 0, 0, 0.6),
          inset 0 4px 8px rgba(255, 255, 255, 0.4),
          inset 0 -4px 8px rgba(0, 0, 0, 0.3);
        border: 3px solid var(--chrome-silver);
        transition: all 0.3s ease;
        padding: 0;
        margin: 0;
        font: inherit;
        color: inherit;
      }

      .chrome-badge:hover {
        transform: translate(-50%, -50%) scale(1.05);
        box-shadow:
          0 0 30px rgba(232, 232, 232, 0.5),
          0 8px 32px rgba(0, 0, 0, 0.6);
      }

      .skull-emblem {
        margin-bottom: 10px;
      }

      .skull-svg {
        width: 60px;
        height: 60px;
        color: var(--matte-black);
        filter: drop-shadow(0 2px 4px rgba(255, 255, 255, 0.2));
      }

      .badge-ring {
        text-align: center;
      }

      .badge-text {
        font-family: var(--font-stencil);
        font-size: 12px;
        font-weight: 900;
        color: var(--matte-black);
        letter-spacing: 1px;
        margin-bottom: 2px;
      }

      .badge-subtext {
        font-family: var(--font-stencil);
        font-size: 8px;
        font-weight: 700;
        color: #333;
        letter-spacing: 0.5px;
      }

      .tank-spec {
        position: absolute;
        text-align: center;
        font-family: var(--font-rebel);
      }

      .top-left {
        top: 30px;
        left: 40px;
      }

      .top-right {
        top: 30px;
        right: 40px;
        text-align: right;
      }

      .bottom-left {
        bottom: 40px;
        left: 40px;
      }

      .bottom-right {
        bottom: 40px;
        right: 40px;
        text-align: right;
      }

      .spec-title {
        font-family: var(--font-stencil);
        font-size: 18px;
        font-weight: 700;
        color: var(--chrome-silver);
        letter-spacing: 1.5px;
        margin-bottom: 4px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
      }

      .spec-detail {
        font-size: 11px;
        font-weight: 500;
        color: #999;
        letter-spacing: 1px;
      }

      .rivet {
        position: absolute;
        width: 16px;
        height: 16px;
        background: radial-gradient(circle at 30% 30%, #666, #333);
        border-radius: 50%;
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.6),
          inset 0 1px 2px rgba(255, 255, 255, 0.2);
      }

      .top-rivet-1 {
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
      }
      .top-rivet-2 {
        top: 20px;
        left: 30%;
      }
      .top-rivet-3 {
        top: 20px;
        right: 30%;
      }
      .bottom-rivet-1 {
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
      }
      .bottom-rivet-2 {
        bottom: 20px;
        left: 30%;
      }
      .bottom-rivet-3 {
        bottom: 20px;
        right: 30%;
      }

      .exhaust-pipe {
        position: absolute;
        bottom: -10px;
        width: 80px;
        height: 20px;
        background: linear-gradient(
          180deg,
          var(--chrome-silver) 0%,
          #b8b8b8 50%,
          var(--chrome-silver) 100%
        );
        border-radius: 10px;
        box-shadow:
          0 4px 8px rgba(0, 0, 0, 0.4),
          inset 0 2px 4px rgba(255, 255, 255, 0.3);
      }

      .left-pipe {
        left: 80px;
      }
      .right-pipe {
        right: 80px;
      }

      .engine-controls {
        display: flex;
        gap: 3rem;
        align-items: center;
        margin-bottom: 2rem;
      }

      .engine-starter {
        background: linear-gradient(
          145deg,
          var(--steel-gray) 0%,
          var(--matte-black) 100%
        );
        color: var(--chrome-silver);
        border: 2px solid #3a3a3a;
        padding: 1rem 2rem;
        border-radius: 12px;
        font-family: var(--font-stencil);
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 1px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        transition: all 0.3s ease;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      }

      .engine-starter:hover {
        background: linear-gradient(145deg, #3a3a3a 0%, var(--steel-gray) 100%);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
      }

      .engine-starter.running {
        background: linear-gradient(145deg, var(--rebel-red) 0%, #660000 100%);
        border-color: var(--warning-orange);
        box-shadow:
          0 0 20px rgba(255, 107, 53, 0.4),
          0 4px 16px rgba(0, 0, 0, 0.5);
        animation: enginePulse 1s infinite;
      }

      @keyframes enginePulse {
        0%,
        100% {
          box-shadow: 0 0 20px rgba(255, 107, 53, 0.4);
        }
        50% {
          box-shadow: 0 0 30px rgba(255, 107, 53, 0.6);
        }
      }

      .engine-icon {
        width: 20px;
        height: 20px;
      }

      .engine-stats {
        display: flex;
        gap: 2rem;
      }

      .stat-item {
        text-align: center;
      }

      .stat-label {
        display: block;
        font-family: var(--font-stencil);
        font-size: 10px;
        font-weight: 600;
        color: #666;
        letter-spacing: 0.8px;
        margin-bottom: 4px;
      }

      .stat-value {
        display: block;
        font-family: var(--font-rebel);
        font-size: 16px;
        font-weight: 700;
        color: var(--chrome-silver);
      }

      .features-panel {
        max-width: 600px;
        text-align: center;
        background: linear-gradient(
          145deg,
          rgba(42, 42, 42, 0.8) 0%,
          rgba(15, 15, 15, 0.9) 100%
        );
        border: 1px solid #3a3a3a;
        border-radius: 12px;
        padding: 2rem;
        backdrop-filter: blur(10px);
      }

      .features-title {
        font-family: var(--font-stencil);
        font-size: 16px;
        font-weight: 700;
        color: var(--chrome-silver);
        letter-spacing: 2px;
        margin-bottom: 1rem;
      }

      .features-text {
        font-family: var(--font-rebel);
        font-size: 14px;
        line-height: 1.6;
        color: #ccc;
        margin-bottom: 1.5rem;
      }

      .rebel-motto {
        font-family: var(--font-stencil);
        font-size: 12px;
        font-weight: 700;
        color: var(--rebel-red);
        letter-spacing: 2px;
        border-top: 1px solid #3a3a3a;
        padding-top: 1rem;
      }

      .engine-vibration {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: radial-gradient(
          circle at 50% 50%,
          transparent 60%,
          rgba(255, 107, 53, 0.03) 100%
        );
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }

      .garage-stage.engine-on .engine-vibration {
        opacity: 1;
        animation: vibrationPulse 2s ease-in-out infinite;
      }

      @keyframes vibrationPulse {
        0%,
        100% {
          opacity: 0.3;
        }
        50% {
          opacity: 0.6;
        }
      }

      @media (max-width: 900px) {
        .motorcycle-tank {
          width: 500px;
          height: 280px;
        }

        .chrome-badge {
          width: 120px;
          height: 120px;
        }

        .skull-svg {
          width: 45px;
          height: 45px;
        }

        .spec-title {
          font-size: 14px;
        }

        .engine-controls {
          flex-direction: column;
          gap: 1.5rem;
        }

        .engine-stats {
          gap: 1rem;
        }
      }

      @media (max-width: 600px) {
        .garage-stage {
          padding: 1rem;
          min-height: 600px;
        }

        .motorcycle-tank {
          width: 350px;
          height: 200px;
        }

        .chrome-badge {
          width: 80px;
          height: 80px;
        }

        .skull-svg {
          width: 30px;
          height: 30px;
        }

        .badge-text {
          font-size: 8px;
        }

        .spec-title {
          font-size: 10px;
        }

        .spec-detail {
          font-size: 8px;
        }

        .features-panel {
          padding: 1rem;
        }
      }
    </style>
  </template>
}

class FittedChromeRebelTemplate extends Component<typeof ChromeRebel> {
  get bikeData() {
    return {
      name: this.args?.model?.bikeName,
      engine: this.args?.model?.engineType,
      displacement: this.args?.model?.displacement,
      year: this.args?.model?.buildYear,
      isCustom: this.args?.model?.isCustomBuild,
    };
  }

  <template>
    <div class='fitted-container'>
      <div class='badge-format'>
        <div class='badge-chrome-skull'>
          <svg class='badge-skull-svg' viewBox='0 0 100 100' fill='none'>
            <path
              d='M50 20C38 20 30 28 30 40c0 6 3 12 7 15v8c0 1 1 2 2 2h22c1 0 2-1 2-2v-8c4-3 7-9 7-15 0-12-8-20-20-20z'
              fill='currentColor'
              stroke='#1a1a1a'
              stroke-width='1'
            />
            <circle cx='42' cy='42' r='2' fill='#1a1a1a' />
            <circle cx='58' cy='42' r='2' fill='#1a1a1a' />
            <rect x='47' y='52' width='6' height='2' fill='#1a1a1a' />
          </svg>
        </div>
        <div class='badge-info'>
          <div class='primary-text'>{{this.bikeData.name}}</div>
          <div class='secondary-text'>{{this.bikeData.engine}}
            {{this.bikeData.displacement}}CC</div>
          <div class='tertiary-text'>{{if
              this.bikeData.isCustom
              'CUSTOM'
              'STOCK'
            }}
            {{this.bikeData.year}}</div>
        </div>
      </div>

      <div class='strip-format'>
        <div class='strip-chrome-skull'>
          <svg class='strip-skull-svg' viewBox='0 0 100 100' fill='none'>
            <path
              d='M50 20C38 20 30 28 30 40c0 6 3 12 7 15v8c0 1 1 2 2 2h22c1 0 2-1 2-2v-8c4-3 7-9 7-15 0-12-8-20-20-20z'
              fill='currentColor'
            />
            <circle cx='42' cy='42' r='2' fill='#1a1a1a' />
            <circle cx='58' cy='42' r='2' fill='#1a1a1a' />
            <rect x='47' y='52' width='6' height='2' fill='#1a1a1a' />
          </svg>
        </div>
        <div class='strip-content'>
          <div class='primary-text'>{{this.bikeData.name}}</div>
          <div class='secondary-text'>{{this.bikeData.displacement}}CC
            {{this.bikeData.engine}}
            •
            {{this.bikeData.year}}
            BUILD</div>
        </div>
        <div class='strip-badge'>
          {{if this.bikeData.isCustom 'CUSTOM' 'STOCK'}}
        </div>
      </div>

      <div class='tile-format'>
        <div class='tile-header'>
          <div class='tile-chrome-skull'>
            <svg class='tile-skull-svg' viewBox='0 0 100 100' fill='none'>
              <path
                d='M50 20C38 20 30 28 30 40c0 6 3 12 7 15v8c0 1 1 2 2 2h22c1 0 2-1 2-2v-8c4-3 7-9 7-15 0-12-8-20-20-20z'
                fill='currentColor'
              />
              <circle cx='42' cy='42' r='2' fill='#1a1a1a' />
              <circle cx='58' cy='42' r='2' fill='#1a1a1a' />
              <rect x='47' y='52' width='6' height='2' fill='#1a1a1a' />
            </svg>
          </div>
          <div class='primary-text'>{{this.bikeData.name}}</div>
          <div class='tile-year-badge'>{{this.bikeData.year}}</div>
        </div>
        <div class='tile-body'>
          <div class='tile-engine-spec'>
            <div class='secondary-text'>{{this.bikeData.displacement}}CC</div>
            <div class='secondary-text'>{{this.bikeData.engine}}</div>
          </div>
          <div class='tile-build-status'>
            {{if this.bikeData.isCustom 'CUSTOM BUILD' 'FACTORY SPEC'}}
          </div>
        </div>
        <div class='tile-footer'>
          <div class='tertiary-text'>STEEL REBELS</div>
          <div class='bike-number'>#047</div>
        </div>
      </div>

      <div class='card-format'>
        <div class='card-header'>
          <div class='card-chrome-skull'>
            <svg class='card-skull-svg' viewBox='0 0 100 100' fill='none'>
              <path
                d='M50 20C38 20 30 28 30 40c0 6 3 12 7 15v8c0 1 1 2 2 2h22c1 0 2-1 2-2v-8c4-3 7-9 7-15 0-12-8-20-20-20z'
                fill='currentColor'
              />
              <circle cx='42' cy='42' r='2' fill='#1a1a1a' />
              <circle cx='58' cy='42' r='2' fill='#1a1a1a' />
              <rect x='47' y='52' width='6' height='2' fill='#1a1a1a' />
            </svg>
          </div>
          <div class='card-title'>
            <div class='primary-text'>{{this.bikeData.name}}</div>
            <div class='secondary-text'>REBEL BORN • CHROME FORGED</div>
          </div>
        </div>
        <div class='card-body'>
          <div class='card-specs'>
            <div class='spec-row'>
              <span class='spec-label'>ENGINE</span>
              <span class='spec-value'>{{this.bikeData.displacement}}CC
                {{this.bikeData.engine}}</span>
            </div>
            <div class='spec-row'>
              <span class='spec-label'>BUILD</span>
              <span class='spec-value'>{{this.bikeData.year}}
                {{if this.bikeData.isCustom 'CUSTOM' 'STOCK'}}</span>
            </div>
            <div class='spec-row'>
              <span class='spec-label'>GARAGE</span>
              <span class='spec-value'>STEEL REBELS #047</span>
            </div>
          </div>
          <div class='card-motto'>RIDE HARD • FEAR NOTHING</div>
        </div>
      </div>
    </div>

    <style scoped>
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;500;600;700&display=swap');

      .fitted-container {
        container-type: size;
        width: 100%;
        height: 100%;
        --matte-black: #0f0f0f;
        --steel-gray: #444444;
        --chrome-silver: #e8e8e8;
        --chrome-shine: #ffffff;
        --rebel-red: #8b0000;
        --chrome-gradient: linear-gradient(
          135deg,
          #c0c0c0 0%,
          #ffffff 50%,
          #e8e8e8 100%
        );
        --font-stencil: 'Orbitron', sans-serif;
        --font-rebel: 'Rajdhani', sans-serif;
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
        background: var(--matte-black);
        color: var(--chrome-silver);
        font-family: var(--font-rebel);
      }

      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
      }

      .badge-chrome-skull {
        width: 32px;
        height: 32px;
        background: var(--chrome-gradient);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 10px rgba(232, 232, 232, 0.3);
        border: 1px solid var(--chrome-silver);
      }

      .badge-skull-svg {
        width: 20px;
        height: 20px;
        color: var(--matte-black);
      }

      .badge-info {
        text-align: center;
      }

      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
      }

      .strip-chrome-skull {
        width: 40px;
        height: 40px;
        background: var(--chrome-gradient);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 0 10px rgba(232, 232, 232, 0.3);
        border: 1px solid var(--chrome-silver);
      }

      .strip-skull-svg {
        width: 24px;
        height: 24px;
        color: var(--matte-black);
      }

      .strip-content {
        flex: 1;
        min-width: 0;
      }

      .strip-badge {
        background: var(--steel-gray);
        color: var(--chrome-silver);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-family: var(--font-stencil);
        font-weight: 700;
        font-size: 0.75rem;
        flex-shrink: 0;
      }

      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
      }

      .tile-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        position: relative;
      }

      .tile-chrome-skull {
        width: 50px;
        height: 50px;
        background: var(--chrome-gradient);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 15px rgba(232, 232, 232, 0.3);
        border: 2px solid var(--chrome-silver);
      }

      .tile-skull-svg {
        width: 30px;
        height: 30px;
        color: var(--matte-black);
      }

      .tile-year-badge {
        position: absolute;
        top: 0;
        right: 0;
        background: var(--rebel-red);
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-family: var(--font-stencil);
        font-weight: 700;
        font-size: 0.625rem;
      }

      .tile-body {
        text-align: center;
        margin: 1rem 0;
      }

      .tile-engine-spec {
        margin-bottom: 0.75rem;
      }

      .tile-build-status {
        color: var(--rebel-red);
        font-family: var(--font-stencil);
        font-weight: 600;
        font-size: 0.75rem;
        letter-spacing: 0.5px;
      }

      .tile-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid var(--steel-gray);
        padding-top: 0.75rem;
      }

      .bike-number {
        background: var(--chrome-gradient);
        color: var(--matte-black);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-family: var(--font-stencil);
        font-weight: 700;
        font-size: 0.75rem;
      }

      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
          flex-direction: column;
        }
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        margin-bottom: 1.5rem;
      }

      .card-chrome-skull {
        width: 70px;
        height: 70px;
        background: var(--chrome-gradient);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 20px rgba(232, 232, 232, 0.3);
        border: 2px solid var(--chrome-silver);
        flex-shrink: 0;
      }

      .card-skull-svg {
        width: 40px;
        height: 40px;
        color: var(--matte-black);
      }

      .card-title {
        flex: 1;
      }

      .card-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }

      .card-specs {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .spec-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0;
        border-bottom: 1px solid rgba(42, 42, 42, 0.8);
      }

      .spec-row:last-child {
        border-bottom: none;
      }

      .spec-label {
        font-family: var(--font-stencil);
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--steel-gray);
        letter-spacing: 0.5px;
      }

      .spec-value {
        font-family: var(--font-rebel);
        font-weight: 600;
        color: var(--chrome-silver);
      }

      .card-motto {
        text-align: center;
        font-family: var(--font-stencil);
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--rebel-red);
        letter-spacing: 1px;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid var(--steel-gray);
      }

      .primary-text {
        font-size: 1em;
        font-weight: 700;
        color: var(--chrome-silver);
        line-height: 1.2;
        font-family: var(--font-stencil);
        letter-spacing: 0.5px;
      }

      .secondary-text {
        font-size: 0.875em;
        font-weight: 500;
        color: rgba(232, 232, 232, 0.85);
        line-height: 1.3;
        margin-top: 0.5em;
      }

      .tertiary-text {
        font-size: 0.75em;
        font-weight: 400;
        color: rgba(232, 232, 232, 0.7);
        line-height: 1.4;
        margin-top: 0.375em;
      }

      @container (min-width: 400px) and (height: 170px) {
        .card-format {
          flex-direction: row;
          gap: 1.5rem;
        }
        .card-header {
          flex-direction: column;
          margin-bottom: 0;
          width: 100px;
        }
        .card-body {
          margin-top: 0;
        }
      }
    </style>
  </template>
}

export class ChromeRebel extends CardDef {
  static displayName = 'Chrome & Rebel';
  static icon = MotorcycleIcon;

  @field bikeName = contains(StringField);
  @field engineType = contains(StringField);
  @field displacement = contains(StringField);
  @field buildYear = contains(NumberField);
  @field customFeatures = contains(StringField);
  @field isCustomBuild = contains(BooleanField);

  @field title = contains(StringField, {
    computeVia: function (this: ChromeRebel) {
      return this.bikeName;
    },
  });

  static isolated = IsolatedChromeRebelTemplate;
  static fitted = FittedChromeRebelTemplate;
}
