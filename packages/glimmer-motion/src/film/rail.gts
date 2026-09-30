import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import type { Chapter } from './types.ts';

/** a chapter as a door on the rule */
export interface RailMark {
  /** where on the rule, 0..1 */
  at: number;
  done: boolean;
  head: number;
  here: boolean;
  /** the label the door announces when the rule is a clock */
  label?: string;
  n: string;
  title: string;
}

export interface RailSignature {
  Args: {
    /** the chapter on screen */
    chapter: Chapter;
    /** the ends of the rule, as the film writes them; empty when the rule is time */
    labels?: [string, string];
    marks: RailMark[];
    /** cut to a chapter's head */
    pick: (head: number) => void;
    /** the readout riding the head — the year, or nothing */
    readout?: string;
  };
}

/**
 * THE FILM ON ONE LINE. A rule the width of the chapter strip, the run
 * so far filled in the accent, a dot on the head and the readout riding
 * it; the chapters are dots at the places they open, so the distance
 * between them is a fact and not a layout. The dots are the doors into
 * the chapters. The head's position is a custom property (`--cf-head`)
 * written by the film every frame, so nothing here re-renders on the
 * clock.
 */
export class Rail extends Component<RailSignature> {
  atStyle = (m: RailMark): string =>
    `left:calc(5px + ${m.at.toFixed(4)} * (100% - 10px))`;

  <template>
    <div class='cf-rail'>
      <span class='cf-rail-n'>{{@chapter.n}}</span>
      <span class='cf-rail-t'>{{@chapter.title}}</span>
      <span class='cf-years'>
        <i class='cf-years-rule' aria-hidden='true'></i>
        <i class='cf-years-fill' aria-hidden='true'></i>
        {{#each @marks as |m|}}
          <button
            type='button'
            class='cf-years-ch {{if m.here "is-here"}} {{if m.done "is-done"}}'
            style={{this.atStyle m}}
            title='{{m.n}} {{m.title}}{{if m.label (concat " · " m.label)}}'
            {{on 'click' (fn @pick m.head)}}
          ></button>
        {{/each}}
        {{#if @readout}}
          <b class='cf-years-now' aria-hidden='true'>{{@readout}}</b>
        {{else}}
          <b class='cf-years-now is-mute' aria-hidden='true'></b>
        {{/if}}
        {{#if @labels}}
          <em class='cf-years-a' aria-hidden='true'>{{get @labels 0}}</em>
          <em class='cf-years-b' aria-hidden='true'>{{get @labels 1}}</em>
        {{/if}}
      </span>
    </div>
  </template>
}

function concat(...parts: unknown[]): string {
  return parts.map((p) => String(p ?? '')).join('');
}

function get<T>(list: readonly T[], i: number): T | undefined {
  return list[i];
}
