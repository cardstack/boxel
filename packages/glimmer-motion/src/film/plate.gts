import { array, concat, get } from '@ember/helper';
import Component from '@glimmer/component';

import { Choreo } from '../choreo.gts';
import motion from '../motion.ts';
import type { Beat, ElementModifier } from './types.ts';

export interface PlateSignature {
  Args: {
    /** the beat being set */
    beat: Beat;
    /** the chapter's numeral, set enormous behind a plate */
    chapterN: string;
    /** `--cf-glyphs`: how many characters the word is, for the column's size */
    glyphFit: string;
    /** 'is-latin' | 'is-tall' | '' — the script's own setting */
    glyphTone: string;
    /** the film's own handle on the block, for the parallax and the fade */
    mount: ElementModifier;
    /** one pass behind the boot: content mounts on this so its entrance is a real insertion */
    rolling: boolean;
    /** when each of up to four phrases lands, seconds into the beat */
    sayAt: number[];
    /** when the kicker, the word and the reading land, seconds into the beat */
    typeAt: number[];
  };
}

/**
 * THE FRONT LAYER — the lower third, the title, the plate and the point,
 * which are one component set four ways. Keyed on the beat, so every
 * hand-off replays the delivery: the kicker rises, the word lands
 * centre-out on an overshoot, the reading and the gloss follow, and the
 * phrases arrive one by one against the measured read. A beat change
 * drops the old type in one quick fall. All of it is score vocabulary.
 *
 * Each row is a PLANE, and the nesting is load-bearing: the wrapper is
 * the plane and the film's loop drifts it, the paragraph inside is the
 * type and Motion delivers it. One writer each.
 */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Plate extends Component<PlateSignature> {
  <template>
    <Choreo @id='plate' class='cf-type cf-{{@beat.mode}}' as |n|>
      <span class='cf-ghost' aria-hidden='true'>{{@chapterN}}</span>
      {{#if @rolling}}
        {{#each (array @beat) key='id' as |b|}}
          <div class='cf-block is-{{b.mode}}' {{@mount}}>
            {{#if b.kicker}}
              <div class='cf-plane'>
                <p class='cf-kicker' {{motion id='kicker' role='kick'}}>
                  <span>{{b.kicker}}</span>
                </p>
              </div>
            {{/if}}
            {{! when the beat has a MARK the term is already standing in
            the scene, so the front layer does not set it a second time }}
            {{#unless b.mark}}
              {{#if b.kanji}}
                <div class='cf-plane is-glyph' style={{@glyphFit}}>
                  <p
                    class='cf-kanji {{@glyphTone}}'
                    {{motion id='kanji' role='glyph'}}
                  >
                    {{b.kanji}}
                  </p>
                </div>
              {{/if}}
            {{/unless}}
            {{#if b.romaji}}
              <div class='cf-plane'>
                <p class='cf-read' {{motion id='read' role='read'}}>
                  <span class='cf-romaji'>{{b.romaji}}</span>
                  {{#if b.gloss}}
                    <span class='cf-gloss'>{{b.gloss}}</span>
                  {{/if}}
                </p>
              </div>
            {{/if}}
            {{! kinetic type, not a paragraph: each phrase is its own sprite
            with its own role, because a cue has a time }}
            {{#each b.says as |say index|}}
              <div class='cf-plane'>
                <p
                  class='cf-say'
                  {{motion id=(concat 'say' index) role=(concat 's' index)}}
                ><span class='cf-sayx sx-{{b.id}}-{{index}}'>{{say}}</span></p>
              </div>
            {{/each}}
          </div>
        {{/each}}
      {{/if}}

      {{! THE TYPE IS ITS OWN SCENE. Every element enters and leaves on one
      vocabulary and in one order: kicker, glyph, reading, then the lines
      against the voice; out as a wave in reverse. }}
      <n.Parallel>
        <n.Tween
          @of={{n.inserted 'kick'}}
          @delay={{get @typeAt 0}}
          @opacity={{array 0 1}}
          @y={{array 10 0}}
          @duration={{0.55}}
          @ease='easeOut'
        />
        <n.Tween
          @of={{n.inserted 'glyph'}}
          @by='character'
          @order='center'
          @stagger={{0.07}}
          @delay={{get @typeAt 1}}
          @opacity={{array 0 1}}
          @y={{array 16 0}}
          @duration={{0.9}}
          @ease='easeOut'
        />
        <n.Tween
          @of={{n.inserted 'read'}}
          @delay={{get @typeAt 2}}
          @opacity={{array 0 1}}
          @y={{array 8 0}}
          @duration={{0.62}}
          @ease='easeOut'
        />
        <n.Tween
          @of={{n.inserted 's0'}}
          @delay={{get @sayAt 0}}
          @opacity={{array 0 1}}
          @y={{array 8 0}}
          @duration={{0.7}}
          @ease='easeOut'
        />
        <n.Tween
          @of={{n.inserted 's1'}}
          @delay={{get @sayAt 1}}
          @opacity={{array 0 1}}
          @y={{array 8 0}}
          @duration={{0.7}}
          @ease='easeOut'
        />
        <n.Tween
          @of={{n.inserted 's2'}}
          @delay={{get @sayAt 2}}
          @opacity={{array 0 1}}
          @y={{array 8 0}}
          @duration={{0.7}}
          @ease='easeOut'
        />
        <n.Tween
          @of={{n.inserted 's3'}}
          @delay={{get @sayAt 3}}
          @opacity={{array 0 1}}
          @y={{array 8 0}}
          @duration={{0.7}}
          @ease='easeOut'
        />
        <n.Tween
          @of={{array
            (n.removed 's0')
            (n.removed 's1')
            (n.removed 's2')
            (n.removed 's3')
          }}
          @opacity={{0}}
          @y={{array 0 -7}}
          @duration={{0.3}}
          @ease='easeIn'
        />
        <n.Tween
          @of={{n.removed 'read'}}
          @delay={{0.05}}
          @opacity={{0}}
          @y={{array 0 -7}}
          @duration={{0.3}}
          @ease='easeIn'
        />
        <n.Tween
          @of={{n.removed 'glyph'}}
          @delay={{0.1}}
          @opacity={{0}}
          @y={{array 0 -9}}
          @duration={{0.34}}
          @ease='easeIn'
        />
        <n.Tween
          @of={{n.removed 'kick'}}
          @delay={{0.16}}
          @opacity={{0}}
          @y={{array 0 -7}}
          @duration={{0.3}}
          @ease='easeIn'
        />
      </n.Parallel>
    </Choreo>
  </template>
}
