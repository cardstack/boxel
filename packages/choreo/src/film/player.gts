import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { motion } from 'glimmer-motion';

import { Choreo } from '../choreo.gts';
import type { Chapter, ElementModifier } from './types.ts';

/** one chapter as a segment of the scrub bar */
export interface PlaybarSegment {
  head: number;
  n: string;
  style: string;
  title: string;
}

/** what the hand is pointing at on the bar: the chapter and the time */
export interface ScrubTip {
  ch: string;
  t: string;
}

export interface PlayerSignature {
  Args: {
    /** the front door is up: the transport waits outside */
    away: boolean;
    /** which cut of the film this is; shown only under debug */
    build?: string;
    /** toggle captions */
    cc: () => void;
    chapter: Chapter;
    clock: string;
    debug?: boolean;
    duration: string;
    /** the fader moved */
    fade: (e: Event) => void;
    full: boolean;
    hear: () => void;
    /** nobody has touched the frame for a while: the apparatus leaves */
    idle: boolean;
    /** rolling AND not held by the viewer: what the play button shows */
    live: boolean;
    /** sound on, and the fader up: the speaker glyph's three states */
    loud: 'high' | 'low' | 'off';
    menu: boolean;
    next: () => void;
    playbar: PlaybarSegment[];
    prev: () => void;
    restart: () => void;
    screen: () => void;
    /** the fraction the hand is holding while scrubbing, else null */
    scrubAt: null | number;
    scrubDown: (e: PointerEvent) => void;
    scrubLeave: () => void;
    scrubMove: (e: PointerEvent) => void;
    scrubUp: (e: PointerEvent) => void;
    /** keeps the bar's element, for the slider's live value */
    slider: ElementModifier;
    sound: boolean;
    subsOn: boolean;
    /** the bubble over the bar, while a pointer is on it */
    tip: null | ScrubTip;
    toc: () => void;
    toggle: () => void;
    /** measures the track, so the head can sit at the fill's end in pixels */
    trackWrap: ElementModifier;
    /** the master fader, 0..1 */
    vol: number;
    /** the fader's value as a custom property, for its own fill */
    volStyle: string;
  };
}

/**
 * THE PLAYER. The grammar every viewer knows from a decade of video on the
 * web: one full-width bar with the chapters as segments, a knob that sits
 * exactly where the fill ends, the transport on the left, the modes on
 * the right, the time beside the chapter's name, and the whole apparatus
 * fading off the picture when nobody is touching it. The bar listens: a
 * resting pointer gets the chapter and the time in a bubble and a ghost
 * fill to where it would cut, and every button names itself and its key.
 * The playhead is honest: a film cut on a chased lens cannot seek, so the
 * drag reads as time and the release RE-CUTS from the shot under the hand.
 */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Player extends Component<PlayerSignature> {
  <template>
    <div class='cf-player {{if @idle "is-idle"}} {{if @away "is-away"}}'>
      <div
        class='cf-scrub {{if @scrubAt "is-live"}}'
        role='slider'
        aria-label='playhead'
        aria-valuemin='0'
        aria-valuemax='100'
        aria-valuenow='0'
        tabindex='0'
        {{@slider}}
        {{on 'pointerdown' @scrubDown}}
        {{on 'pointermove' @scrubMove}}
        {{on 'pointerup' @scrubUp}}
        {{on 'pointerleave' @scrubLeave}}
      >
        <span class='cf-scrub-track' {{@trackWrap}}>
          {{#each @playbar as |c|}}
            <span class='cf-scrub-ch' style={{c.style}}>
              <span class='cf-scrub-ghost'></span>
              <span class='cf-scrub-fill'></span>
            </span>
          {{/each}}
          <span class='cf-scrub-head'></span>
          {{#if @tip}}
            <span class='cf-scrub-tip'>
              <span class='cf-scrub-tip-ch'>{{@tip.ch}}</span>
              <span class='cf-scrub-tip-t'>{{@tip.t}}</span>
            </span>
          {{/if}}
        </span>
      </div>

      <div class='cf-controls'>
        <button
          type='button'
          class='cf-ic'
          aria-label={{if @live 'pause' 'play'}}
          data-tip={{if @live 'Pause (k)' 'Play (k)'}}
          {{on 'click' @toggle}}
        >
          {{#if @live}}
            <svg viewBox='0 0 24 24'><path
                d='M7 5h4v14H7zM13 5h4v14h-4z'
              /></svg>
          {{else}}
            <svg viewBox='0 0 24 24'><path d='M8 5v14l11-7z' /></svg>
          {{/if}}
        </button>
        <button
          type='button'
          class='cf-ic'
          aria-label='previous chapter'
          data-tip='Previous chapter (←)'
          {{on 'click' @prev}}
        >
          <svg viewBox='0 0 24 24'><path
              d='M6 6h2v12H6zM18 6l-9 6 9 6z'
            /></svg>
        </button>
        <button
          type='button'
          class='cf-ic'
          aria-label='next chapter'
          data-tip='Next chapter (→)'
          {{on 'click' @next}}
        >
          <svg viewBox='0 0 24 24'><path
              d='M16 6h2v12h-2zM6 6l9 6-9 6z'
            /></svg>
        </button>
        {{! the speaker and, on a hover, the fader beside it }}
        <span class='cf-vol'>
          <button
            type='button'
            class='cf-ic'
            aria-label={{if @sound 'mute' 'sound'}}
            data-tip={{if @sound 'Mute (m)' 'Unmute (m)'}}
            {{on 'click' @hear}}
          >
            {{#if (eq @loud 'high')}}
              <svg viewBox='0 0 24 24'><path
                  d='M4 9v6h4l5 4V5L8 9zm11.5 3a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2zm-2-7.6v2.1a5.6 5.6 0 0 1 0 11v2.1a7.7 7.7 0 0 0 0-15.2z'
                /></svg>
            {{else if (eq @loud 'low')}}
              <svg viewBox='0 0 24 24'><path
                  d='M4 9v6h4l5 4V5L8 9zm11.5 3a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2z'
                /></svg>
            {{else}}
              <svg viewBox='0 0 24 24'><path
                  d='M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z'
                /></svg>
            {{/if}}
          </button>
          <input
            class='cf-vol-range'
            type='range'
            min='0'
            max='1'
            step='0.02'
            value={{@vol}}
            aria-label='volume'
            style={{@volStyle}}
            {{on 'input' @fade}}
          />
        </span>
        <span class='cf-time'>
          <b>{{@clock}}</b>
          <i>/</i>
          {{@duration}}
        </span>
        {{! the chapter's name, beside the clock, is the way into the list }}
        <button
          type='button'
          class='cf-chap'
          data-tip='Chapters (c)'
          {{on 'click' @toc}}
        >
          <span>·</span>
          {{@chapter.n}}
          {{@chapter.title}}
          <svg viewBox='0 0 24 24'><path
              d='M8.6 6 7.2 7.4 11.8 12l-4.6 4.6L8.6 18l6-6z'
            /></svg>
        </button>
        <span class='cf-spacer'></span>
        {{#if @debug}}
          <span class='cf-build'>{{@build}}</span>
        {{/if}}
        <button
          type='button'
          class='cf-ic cf-ic-cc {{if @subsOn "is-on"}}'
          aria-label='captions'
          data-tip='Captions (v)'
          {{on 'click' @cc}}
        >CC</button>
        {{! the way back to the door, with its name on it: a title screen
        is a place, not a loop }}
        <button
          type='button'
          class='cf-word'
          data-tip='Back to the title screen (0)'
          {{on 'click' @restart}}
        >
          {{! a title card, not a loop: the glyph is the card itself }}
          <svg viewBox='0 0 24 24'><path
              d='M3 5h18v14H3zm2 2v10h14V7zm3 3h8v1.6H8zm0 3.4h5V15H8z'
            /></svg>
          Title screen
        </button>
        <button
          type='button'
          class='cf-ic cf-ic-last'
          aria-label={{if @full 'exit fullscreen' 'fullscreen'}}
          data-tip={{if @full 'Exit full screen (f)' 'Full screen (f)'}}
          {{on 'click' @screen}}
        >
          {{#if @full}}
            <svg viewBox='0 0 24 24'><path
                d='M9 4H7v3H4v2h5zM4 15h3v3h2v-5H4zm11 3h2v-3h3v-2h-5zm0-14v5h5V7h-3V4z'
              /></svg>
          {{else}}
            <svg viewBox='0 0 24 24'><path
                d='M4 4h5v2H6v3H4zm11 0h5v5h-2V6h-3zM4 15h2v3h3v2H4zm14 0h2v5h-5v-2h3z'
              /></svg>
          {{/if}}
        </button>
      </div>
    </div>
  </template>
}

export interface BurstSignature {
  Args: {
    /** the animation ran out: take the glyph down */
    done: () => void;
    kind: 'pause' | 'play';
  };
}

/**
 * THE CONFIRMATION GLYPH: a play or a pause, once, in the middle of the
 * picture, gone in half a second — the way every player answers a tap
 * on the glass.
 */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Burst extends Component<BurstSignature> {
  <template>
    <div class='cf-burst' {{on 'animationend' @done}}>
      {{#if (eq @kind 'play')}}
        <svg viewBox='0 0 24 24'><path d='M8 5v14l11-7z' /></svg>
      {{else}}
        <svg viewBox='0 0 24 24'><path d='M7 5h4v14H7zM13 5h4v14h-4z' /></svg>
      {{/if}}
    </div>
  </template>
}

/** a chapter, as the menu lists it */
export interface MenuEntry {
  head: number;
  here: boolean;
  n: string;
  secs: number;
  shots: number;
  title: string;
}

export interface MenuSignature {
  Args: {
    contents: MenuEntry[];
    /** the key legend under the list */
    keys?: string;
    pick: (head: number) => void;
    sub: string;
    title: string;
  };
}

/**
 * THE DISC MENU. A film with chapters owes the viewer a way into them,
 * and the arrow keys alone are a secret. Picking one re-cuts the score
 * from that chapter's head — the same move the arrows make, because a
 * skip here is an edit and never a seek. The film keeps running behind
 * it, blurred: a menu that freezes the picture makes it feel like a file.
 */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Menu extends Component<MenuSignature> {
  <template>
    <Choreo class='cf-menu' as |m|>
      <div class='cf-menu-in' {{motion id='menu' role='sheet'}}>
        <p class='cf-menu-head'>{{@title}}</p>
        <p class='cf-menu-sub'>{{@sub}}</p>
        <ol class='cf-menu-list'>
          {{#each @contents as |c|}}
            <li>
              <button
                type='button'
                class='cf-menu-item {{if c.here "is-here"}}'
                {{on 'click' (fn @pick c.head)}}
              >
                <span class='cf-menu-n'>{{c.n}}</span>
                <span class='cf-menu-t'>{{c.title}}</span>
                <span class='cf-menu-d'>{{c.shots}} shots</span>
              </button>
            </li>
          {{/each}}
        </ol>
        <p class='cf-menu-keys'>{{if
            @keys
            @keys
            'space / K play · ← → chapter · 1–9 chapter · M sound · F full screen · V captions · 0 title screen · C close'
          }}</p>
      </div>
      <m.Tween
        @of={{m.inserted 'sheet'}}
        @y={{array 26 0}}
        @scale={{array 0.97 1}}
        @opacity={{array 0 1}}
        @duration={{0.42}}
        @ease={{array 0.22 1 0.36 1}}
      />
      <m.Tween
        @of={{m.removed 'sheet'}}
        @y={{array 0 18}}
        @opacity={{array 1 0}}
        @duration={{0.2}}
        @ease='easeIn'
      />
    </Choreo>
  </template>
}

function array<T>(...items: T[]): T[] {
  return items;
}

function eq(a: unknown, b: unknown): boolean {
  return a === b;
}
