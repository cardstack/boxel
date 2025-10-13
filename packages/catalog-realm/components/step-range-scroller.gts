import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

interface StepRangeScrollerArgs {
  startValue?: number;
  endValue?: number;
  min?: number;
  max?: number;
  interval?: number;
  onChange?: (values: { startValue: number; endValue: number }) => void;
}

export class StepRangeScroller extends Component<StepRangeScrollerArgs> {
  @tracked startValue = this.args.startValue ?? this.args.min ?? 1950;
  @tracked endValue = this.args.endValue ?? this.args.max ?? 2020;
  min = this.args.min ?? 1950;
  max = this.args.max ?? 2020;
  interval = this.args.interval ?? 10;

  // Generate steps array based on min, max, and interval
  get steps() {
    let steps = [];
    let startStep = Math.floor(this.min / this.interval) * this.interval;
    let endStep = Math.ceil(this.max / this.interval) * this.interval;
    for (let value = startStep; value <= endStep; value += this.interval) {
      steps.push(value);
    }
    return steps;
  }

  // Round values to nearest step
  get normalizedStartValue() {
    return Math.floor(this.startValue / this.interval) * this.interval;
  }

  get normalizedEndValue() {
    return Math.floor(this.endValue / this.interval) * this.interval;
  }

  get rangeStyle() {
    let maxIndex = this.steps.length - 1;
    let left = (this.startIndex / maxIndex) * 100;
    let right = (this.endIndex / maxIndex) * 100;
    return `left: ${left}%; width: ${right - left}%;`;
  }

  get leftThumbClass() {
    return this.normalizedStartValue === this.normalizedEndValue
      ? 'slider thumb thumb--left thumb--active'
      : 'slider thumb thumb--left';
  }

  @action
  setStartValue(event: Event) {
    let target = event.target as HTMLInputElement | null;
    if (!target) return;
    let stepIndex = parseInt(target.value, 10);
    let value = this.steps[stepIndex];
    if (value <= this.normalizedEndValue) {
      this.startValue = value;
      this.args.onChange?.({
        startValue: this.startValue,
        endValue: this.endValue,
      });
    }
  }

  @action
  setEndValue(event: Event) {
    let target = event.target as HTMLInputElement | null;
    if (!target) return;
    let stepIndex = parseInt(target.value, 10);
    let value = this.steps[stepIndex];
    if (value >= this.normalizedStartValue) {
      this.endValue = value;
      this.args.onChange?.({
        startValue: this.startValue,
        endValue: this.endValue,
      });
    }
  }

  get startIndex() {
    return this.steps.indexOf(this.normalizedStartValue);
  }

  get endIndex() {
    return this.steps.indexOf(this.normalizedEndValue);
  }

  get maxIndex() {
    return this.steps.length - 1;
  }

  <template>
    <div class='step-range-slider'>
      <div class='slider-track'>
        <div class='slider-background'></div>
        <label for='start-range' class='sr-only'>Start range</label>
        <input
          id='start-range'
          type='range'
          min='0'
          max={{this.maxIndex}}
          step='1'
          value={{this.startIndex}}
          {{on 'input' this.setStartValue}}
          class={{this.leftThumbClass}}
        />
        <label for='end-range' class='sr-only'>End range</label>
        <input
          id='end-range'
          type='range'
          min='0'
          max={{this.maxIndex}}
          step='1'
          value={{this.endIndex}}
          {{on 'input' this.setEndValue}}
          class='slider thumb thumb--right'
        />
        <div class='slider-range' style={{this.rangeStyle}}></div>
      </div>
      <div class='step-markers'>
        {{#each this.steps as |step|}}
          <div class='step-marker'>
            <span class='step-label'>{{step}}</span>
          </div>
        {{/each}}
      </div>
    </div>
    <style scoped>
      .step-range-slider {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        width: 100%;
      }
      .step-markers {
        display: flex;
        justify-content: space-between;
        position: relative;
        height: 2rem;
      }
      .step-marker {
        flex: 1;
        text-align: center;
        position: relative;
      }
      .step-marker:before {
        content: '';
        position: absolute;
        top: -0.5rem;
        left: 50%;
        transform: translateX(-50%);
        width: 2px;
        height: 0.5rem;
        background: #ccc;
      }
      .step-label {
        font-size: 0.75rem;
        color: #666;
        display: block;
        transform: rotate(-45deg);
        transform-origin: center center;
        white-space: nowrap;
        margin-top: 0.1rem;
      }
      .slider-track {
        position: relative;
        height: 2.5rem;
        display: flex;
        align-items: center;
      }
      .slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        background: none;
        position: absolute;
        top: 1rem;
        height: 0;
        margin: 0;
        pointer-events: auto;
      }
      .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 50%;
        background: #fff;
        border: 2px solid #2d72d2;
        box-shadow: 0 0 2px #888;
        cursor: pointer;
        position: relative;
        z-index: 10;
      }
      .slider::-moz-range-thumb {
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 50%;
        background: #fff;
        border: 2px solid #2d72d2;
        box-shadow: 0 0 2px #888;
        cursor: pointer;
        position: relative;
        z-index: 10;
      }
      .slider::-webkit-slider-runnable-track {
        height: 0.5rem;
        background: transparent;
        border-radius: 0.25rem;
      }
      .slider-background {
        position: absolute;
        height: 0.5rem;
        background: #e0e0e0;
        border-radius: 0.25rem;
        top: 1rem;
        width: 100%;
        z-index: 0;
      }
      .slider-range {
        position: absolute;
        height: 0.5rem;
        background: #2d72d2;
        border-radius: 0.25rem;
        top: 1rem;
        z-index: 1;
      }
      .thumb--left {
        z-index: 3;
      }
      .thumb--right {
        z-index: 4;
      }
      .thumb--active {
        z-index: 5;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    </style>
  </template>
}
