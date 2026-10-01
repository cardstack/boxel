import { array, concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion, type Sprite } from 'glimmer-motion';

type ClockTab = 'alarm' | 'timer' | 'world';

interface City {
  name: string;
  offset: string;
  time: string;
}

interface AlarmSeed {
  label: string;
  meridiem: string;
  time: string;
}

interface AlarmRow {
  enabled: boolean;
  index: number;
  label: string;
  meridiem: string;
  time: string;
}

const CITIES: City[] = [
  { name: 'Cupertino', offset: 'Today, -3HRS', time: '6:41' },
  { name: 'London', offset: 'Today, +5HRS', time: '2:41' },
  { name: 'Tokyo', offset: 'Tomorrow, +13HRS', time: '10:41' },
  { name: 'São Paulo', offset: 'Today, +1HR', time: '10:41' },
];

const ALARMS: AlarmSeed[] = [
  { label: 'Wake up', meridiem: 'AM', time: '6:30' },
  { label: 'Stand up', meridiem: 'AM', time: '11:00' },
  { label: 'Wind down', meridiem: 'PM', time: '9:45' },
];

const TIMER_START = 300;

interface ClockAppSignature {
  Element: HTMLDivElement;
}

/**
 * A fake iOS-flavoured Clock app for the phone mockup: three tabs, toggling
 * alarms, and a countdown timer that really counts.
 *
 * The body is one <Choreo> region. Switching tabs changes the pane's id, so
 * the changeset carries a removed pane and an inserted one — a crossfade
 * scored once, rather than three hand-written transitions. The knob rides the
 * switch's own layout flip: `justify-content` moves it, and the score tweens
 * the measured delta back to zero.
 */
export class ClockApp extends Component<ClockAppSignature> {
  @tracked tab: ClockTab = 'world';
  @tracked alarmFlags: boolean[] = [true, false, true];
  @tracked remaining = TIMER_START;
  @tracked running = false;

  intervalId: ReturnType<typeof setInterval> | undefined;

  cities = CITIES;

  /** the pane's identity IS the tab, which is what makes a swap a swap */
  get paneId(): string {
    return `pane-${this.tab}`;
  }

  get alarms(): AlarmRow[] {
    return ALARMS.map((alarm, index) => ({
      enabled: this.alarmFlags[index] ?? false,
      index,
      label: alarm.label,
      meridiem: alarm.meridiem,
      time: alarm.time,
    }));
  }

  get showWorld(): boolean {
    return this.tab === 'world';
  }

  get showAlarm(): boolean {
    return this.tab === 'alarm';
  }

  get showTimer(): boolean {
    return this.tab === 'timer';
  }

  /**
   * MM:SS.t — fixed width, so the readout never reflows as it counts.
   *
   * Everything is derived from an INTEGER number of tenths. Doing the
   * arithmetic on the fractional seconds instead gives `total % 60` of
   * 59.7 and a readout of "04:59.7.7"; floating point has no business in
   * a clock face.
   */
  get readout(): string {
    const tenths = Math.max(0, Math.round(this.remaining * 10));
    const minutes = Math.floor(tenths / 600);
    const seconds = Math.floor((tenths % 600) / 10);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
  }

  /**
   * Where the knob came from, in its own coordinates: the switch has already
   * flipped `justify-content` by the time the score runs, so the start of the
   * tween is minus the delta the region measured, and the end is home.
   */
  knobX = (sprite: Sprite) => [-(sprite.delta?.x ?? 0), 0];

  selectTab = (tab: ClockTab) => {
    this.tab = tab;
  };

  toggleAlarm = (index: number) => {
    this.alarmFlags = this.alarmFlags.map((flag, i) =>
      i === index ? !flag : flag
    );
  };

  toggleTimer = () => {
    if (this.running) {
      this.stopTicking();
      return;
    }
    if (this.remaining <= 0) {
      this.remaining = TIMER_START;
    }
    this.running = true;
    // sub-second, so a running timer LOOKS like one
    this.intervalId = setInterval(this.tick, 100);
  };

  resetTimer = () => {
    this.stopTicking();
    this.remaining = TIMER_START;
  };

  tick = () => {
    if (this.remaining <= 0.1) {
      this.remaining = 0;
      this.stopTicking();
      return;
    }
    this.remaining = Math.round((this.remaining - 0.1) * 10) / 10;
  };

  /** the one place the interval is cleared, so pause and destroy agree */
  stopTicking = () => {
    this.running = false;
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  };

  override willDestroy() {
    super.willDestroy();
    this.stopTicking();
  }

  <template>
    <div class="clock-app" ...attributes>
      <div class="clock-status">
        <span class="clock-status-time">9:41</span>
        <span class="clock-status-right">
          <span class="clock-status-dot"></span>
          <span class="clock-status-dot"></span>
          <span class="clock-status-battery"></span>
        </span>
      </div>

      <h1 class="clock-title">Clock</h1>

      <div class="clock-tabs">
        <button
          type="button"
          class="clock-tab {{if this.showWorld 'clock-tab-on'}}"
          {{on "click" (fn this.selectTab "world")}}
        >World</button>
        <button
          type="button"
          class="clock-tab {{if this.showAlarm 'clock-tab-on'}}"
          {{on "click" (fn this.selectTab "alarm")}}
        >Alarm</button>
        <button
          type="button"
          class="clock-tab {{if this.showTimer 'clock-tab-on'}}"
          {{on "click" (fn this.selectTab "timer")}}
        >Timer</button>
      </div>

      <Choreo class="clock-body" as |c|>
        <div class="clock-pane" {{motion id=this.paneId role="pane"}}>
          {{#if this.showWorld}}
            <ul class="clock-cities">
              {{#each this.cities key="name" as |city|}}
                <li
                  class="clock-city"
                  {{motion id=(concat "city-" city.name) role="row"}}
                >
                  <span class="clock-city-text">
                    <span class="clock-city-offset">{{city.offset}}</span>
                    <span class="clock-city-name">{{city.name}}</span>
                  </span>
                  <span class="clock-city-time">{{city.time}}</span>
                </li>
              {{/each}}
            </ul>
          {{/if}}

          {{#if this.showAlarm}}
            <ul class="clock-alarms">
              {{#each this.alarms key="label" as |alarm|}}
                <li
                  class="clock-alarm {{unless alarm.enabled 'clock-alarm-off'}}"
                  {{motion id=(concat "alarm-" alarm.label) role="row"}}
                >
                  <span class="clock-alarm-text">
                    <span class="clock-alarm-time">
                      {{alarm.time}}
                      <span
                        class="clock-alarm-meridiem"
                      >{{alarm.meridiem}}</span>
                    </span>
                    <span class="clock-alarm-label">{{alarm.label}}</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={{if alarm.enabled "true" "false"}}
                    aria-label={{alarm.label}}
                    class="clock-switch {{if alarm.enabled 'clock-switch-on'}}"
                    {{on "click" (fn this.toggleAlarm alarm.index)}}
                  >
                    <span
                      class="clock-knob"
                      {{motion id=(concat "knob-" alarm.label) role="knob"}}
                    ></span>
                  </button>
                </li>
              {{/each}}
            </ul>
          {{/if}}

          {{#if this.showTimer}}
            <div class="clock-timer">
              <div class="clock-dial {{if this.running 'clock-dial-live'}}">
                <span class="clock-readout">{{this.readout}}</span>
                <span class="clock-dial-label">
                  {{if this.running "Running" "Paused"}}
                </span>
              </div>
              <div class="clock-controls">
                <button
                  type="button"
                  class="clock-button clock-button-reset"
                  {{on "click" this.resetTimer}}
                >Reset</button>
                <button
                  type="button"
                  class="clock-button clock-button-go"
                  {{on "click" this.toggleTimer}}
                >{{if this.running "Pause" "Start"}}</button>
              </div>
            </div>
          {{/if}}
        </div>

        <c.Parallel>
          {{! The tab swap: the old pane is gone from the tree but still on
              screen, so it can leave while the new one is already arriving. }}
          <c.Tween
            @of={{c.removed "pane"}}
            @opacity={{array 1 0}}
            @duration={{0.16}}
          />
          <c.Tween
            @of={{c.inserted "pane"}}
            @opacity={{array 0 1}}
            @y={{array 12 0}}
            @delay={{0.1}}
            @duration={{0.28}}
          />
          {{! The rows land one after another under the pane's own arrival. }}
          <c.Tween
            @of={{c.inserted "row"}}
            @opacity={{array 0 1}}
            @y={{array 14 0}}
            @stagger={{0.045}}
            @delay={{0.12}}
            @duration={{0.42}}
          />
          {{! Toggling a switch is a layout change, nothing more: the knob is
              already at the far end, and this walks it back from where it
              stood. }}
          <c.Tween
            @of={{c.moved "knob"}}
            @x={{this.knobX}}
            @duration={{0.22}}
            @ease="easeOut"
          />
        </c.Parallel>
      </Choreo>

      <div class="clock-home"></div>
    </div>

    <style>
      .clock-app {
        position: absolute;
        inset: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        background:
          radial-gradient(
            120% 70% at 50% 0%,
            hsl(190 60% 16%) 0%,
            hsl(190 45% 8%) 55%,
            hsl(190 40% 5%) 100%
          ),
          hsl(190 40% 5%);
        color: hsl(190 25% 96%);
        font-family:
          -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue",
          system-ui, sans-serif;
        user-select: none;
        -webkit-user-select: none;
      }

      .clock-status {
        flex: 0 0 auto;
        height: 54px;
        padding: 0 28px;
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        color: hsl(190 20% 92%);
      }

      .clock-status-right {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .clock-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: hsl(190 20% 88%);
      }

      .clock-status-battery {
        width: 24px;
        height: 12px;
        border-radius: 3px;
        border: 1.5px solid hsl(190 20% 88%);
        background: linear-gradient(
            to right,
            hsl(190 20% 88%) 0 70%,
            transparent 70% 100%
          )
          content-box;
        padding: 1.5px;
      }

      .clock-title {
        flex: 0 0 auto;
        margin: 6px 0 2px;
        padding: 0 20px;
        font-size: 32px;
        line-height: 1.1;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: hsl(190 30% 98%);
      }

      .clock-tabs {
        flex: 0 0 auto;
        margin: 14px 20px 10px;
        padding: 4px;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px;
        border-radius: 14px;
        background: hsl(190 40% 12%);
        border: 1px solid hsl(190 40% 20%);
      }

      .clock-tab {
        appearance: none;
        border: 0;
        border-radius: 11px;
        padding: 9px 0;
        font: inherit;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        color: hsl(190 20% 70%);
        background: transparent;
        cursor: pointer;
        transition:
          background 140ms ease,
          color 140ms ease;
      }

      .clock-tab-on {
        background: hsl(190 80% 45%);
        color: hsl(190 60% 8%);
      }

      .clock-body {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }

      .clock-pane {
        position: absolute;
        inset: 0;
        padding: 6px 20px 0;
      }

      .clock-cities {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .clock-city {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 18px 2px;
        border-bottom: 1px solid hsl(190 35% 18%);
      }

      .clock-city-text {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }

      .clock-city-offset {
        font-size: 13px;
        font-weight: 500;
        color: hsl(190 25% 62%);
      }

      .clock-city-name {
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: hsl(190 25% 97%);
      }

      .clock-city-time {
        font-size: 40px;
        font-weight: 300;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
        color: hsl(190 30% 97%);
      }

      .clock-alarms {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .clock-alarm {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 22px 2px;
        border-bottom: 1px solid hsl(190 35% 18%);
      }

      .clock-alarm-text {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .clock-alarm-time {
        font-size: 38px;
        font-weight: 300;
        line-height: 1;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
        color: hsl(190 30% 97%);
      }

      .clock-alarm-meridiem {
        font-size: 20px;
        font-weight: 400;
        margin-left: 4px;
        color: hsl(190 25% 75%);
      }

      .clock-alarm-label {
        font-size: 15px;
        font-weight: 500;
        color: hsl(190 25% 68%);
      }

      .clock-alarm-off {
        opacity: 0.45;
      }

      .clock-switch {
        appearance: none;
        border: 0;
        flex: 0 0 auto;
        width: 56px;
        height: 32px;
        padding: 3px;
        border-radius: 999px;
        background: hsl(190 20% 26%);
        cursor: pointer;
        display: flex;
        justify-content: flex-start;
        transition: background 200ms ease;
      }

      .clock-switch-on {
        background: hsl(190 85% 45%);
        justify-content: flex-end;
      }

      .clock-knob {
        display: block;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: hsl(0 0% 100%);
        box-shadow: 0 2px 5px hsl(190 60% 4% / 0.5);
      }

      .clock-timer {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 44px;
        padding-bottom: 40px;
      }

      .clock-dial {
        width: 288px;
        height: 288px;
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        border: 6px solid hsl(190 40% 24%);
        background: radial-gradient(
          circle at 50% 35%,
          hsl(190 45% 14%),
          hsl(190 45% 9%)
        );
        transition:
          border-color 200ms ease,
          box-shadow 200ms ease;
      }

      .clock-dial-live {
        border-color: hsl(190 85% 48%);
        box-shadow: 0 0 40px hsl(190 85% 45% / 0.28);
      }

      .clock-readout {
        font-size: 64px;
        font-weight: 200;
        line-height: 1;
        letter-spacing: -0.03em;
        font-variant-numeric: tabular-nums;
        color: hsl(190 30% 98%);
      }

      .clock-dial-label {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: hsl(190 30% 62%);
      }

      .clock-controls {
        display: flex;
        gap: 44px;
      }

      .clock-button {
        appearance: none;
        width: 96px;
        height: 96px;
        border-radius: 50%;
        font: inherit;
        font-size: 18px;
        font-weight: 600;
        cursor: pointer;
        transition:
          transform 120ms ease,
          filter 120ms ease;
      }

      .clock-button:active {
        transform: scale(0.95);
      }

      .clock-button-reset {
        border: 2px solid hsl(190 30% 32%);
        background: hsl(190 35% 15%);
        color: hsl(190 20% 88%);
      }

      .clock-button-go {
        border: 2px solid hsl(190 85% 55%);
        background: hsl(190 80% 42%);
        color: hsl(190 60% 8%);
      }

      .clock-home {
        flex: 0 0 auto;
        width: 140px;
        height: 5px;
        margin: 10px auto 9px;
        border-radius: 999px;
        background: hsl(190 20% 80% / 0.55);
      }
    </style>
  </template>
}

export default ClockApp;
