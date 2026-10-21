import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import ImageIcon from '@cardstack/boxel-icons/image';
import { htmlSafe } from '@ember/template';
import { Route } from './route';
import { RouteLine, safeColor } from './shared';

// film grain, drawn once and laid over every poster
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.35 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

function posterStyle(poster: PosterOption) {
  return htmlSafe(
    [
      `--accent: ${safeColor(poster.accent, '#5b8cff')}`,
      `--ground: ${safeColor(poster.ground, '#0d1522')}`,
      `--ink: ${safeColor(poster.ink, '#f4f1ea')}`,
      `--grain: ${GRAIN}`,
    ].join('; '),
  );
}

export class PosterOption extends CardDef {
  static displayName = 'Poster';
  static icon = ImageIcon;
  @field title = contains(StringField);
  @field tagline = contains(StringField);
  @field accent = contains(StringField);
  @field ground = contains(StringField);
  @field ink = contains(StringField);
  @field mood = contains(StringField);
  // the line along the poster's foot: "Tue 7 pm · Boathouse"
  @field when = contains(StringField);
  @field route = linksTo(() => Route);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PosterOption) {
      return this.title ?? 'Poster';
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: PosterOption) {
      return [this.mood, this.tagline].filter(Boolean).join(' · ');
    },
  });

  static atom = class Atom extends Component<typeof PosterOption> {
    get style() {
      return posterStyle(this.args.model as PosterOption);
    }
    <template>
      <span class='poster-atom' style={{this.style}}>
        <span class='swatch' aria-hidden='true'><i></i></span>
        <span class='name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .poster-atom {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          max-width: 100%;
        }
        .swatch {
          flex: none;
          display: grid;
          place-items: end start;
          width: 10px;
          height: 13px;
          padding: 2px;
          box-sizing: border-box;
          border-radius: 2px;
          background: var(--ground);
          box-shadow: 0 0 0 1px rgb(13 21 34 / 20%);
        }
        .swatch i {
          width: 6px;
          height: 2px;
          background: var(--accent);
        }
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof PosterOption> {
    get style() {
      return posterStyle(this.args.model as PosterOption);
    }
    <template>
      <div class='fit-frame'>
        <div class='poster' style={{this.style}}>
        <RouteLine class='line' @path={{@model.route.path}} @weight={{3}} @start={{true}} />
        <span class='club'>Riverside Run Club</span>
        <span class='title'>{{@model.title}}</span>
        <span class='when'>{{@model.when}}</span>
      </div>
      </div>
      <style scoped>
        .fit-frame {
          container: poster / size;
          height: 100%;
        }
        .poster {
          position: relative;
          height: 100%;
          box-sizing: border-box;
          padding: 9cqmin 8cqmin;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          gap: 3cqmin;
          background: var(--grain), var(--ground);
          color: var(--ink);
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }
        .line {
          position: absolute;
          inset: 8% 6% 42% 6%;
          width: 88%;
          height: 50%;
          color: var(--accent);
        }
        .club {
          position: absolute;
          top: 7cqmin;
          left: 8cqmin;
          right: 8cqmin;
          font: 600 max(8px, 6cqmin) / 1.2 'JetBrains Mono', ui-monospace, monospace;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .title {
          position: relative;
          font-family: 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 62%;
          font-weight: 900;
          font-size: max(18px, 21cqmin);
          line-height: 0.86;
          text-transform: uppercase;
          overflow-wrap: anywhere;
        }
        .when {
          position: relative;
          padding-top: 3cqmin;
          border-top: 1px solid var(--accent);
          font: 600 max(8px, 5.5cqmin) / 1.2 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* a strip: the title and the line side by side */
        @container poster (height < 80px) {
          .poster {
            flex-direction: row;
            align-items: center;
            justify-content: flex-start;
            padding: 8px 12px;
          }
          .club,
          .when {
            display: none;
          }
          .line {
            position: static;
            order: 2;
            width: 64px;
            height: 70%;
            margin-inline-start: auto;
          }
          .title {
            font-size: 22px;
            white-space: nowrap;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof PosterOption> {
    get style() {
      return posterStyle(this.args.model as PosterOption);
    }
    <template>
      <article class='poster-row' style={{this.style}}>
        <div class='art'>
          <RouteLine class='line' @path={{@model.route.path}} @weight={{2.5}} @start={{true}} />
          <span class='title'>{{@model.title}}</span>
        </div>
        <div class='body'>
          <span class='mood'>{{@model.mood}}</span>
          <h3>{{@model.title}}</h3>
          <p>{{@model.tagline}}</p>
          <p class='when'>{{@model.when}}</p>
        </div>
      </article>
      <style scoped>
        .poster-row {
          display: grid;
          grid-template-columns: 112px 1fr;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        .art {
          position: relative;
          display: flex;
          align-items: flex-end;
          min-height: 140px;
          padding: 10px;
          background: var(--grain), var(--ground);
          color: var(--ink);
          overflow: hidden;
        }
        .line {
          position: absolute;
          inset: 10px 8px auto;
          width: calc(100% - 16px);
          height: 50%;
          color: var(--accent);
        }
        .art .title {
          position: relative;
          font: 900 22px/0.86 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 62%;
          text-transform: uppercase;
        }
        .body {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .mood {
          font: 600 10px/14px 'JetBrains Mono', ui-monospace, monospace;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #67707d;
        }
        h3 {
          margin: 0;
          font-size: 17px;
          line-height: 21px;
        }
        p {
          margin: 0;
          font-size: 13px;
          line-height: 19px;
        }
        .when {
          margin-top: auto;
          font: 600 11px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: #67707d;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof PosterOption> {
    get style() {
      return posterStyle(this.args.model as PosterOption);
    }
    <template>
      <div class='stage'>
        <article class='poster' style={{this.style}}>
          <span class='club'>Riverside Run Club</span>
          <span class='mood'>{{@model.mood}}</span>
          <RouteLine class='line' @path={{@model.route.path}} @weight={{5}} @start={{true}} />
          <h1>{{@model.title}}</h1>
          <p class='tagline'>{{@model.tagline}}</p>
          <p class='when'>{{@model.when}}</p>
        </article>
      </div>
      <style scoped>
        .stage {
          min-height: 100%;
          box-sizing: border-box;
          padding: 40px;
          display: grid;
          place-items: center;
          background: #e9e4d9;
        }
        .poster {
          container-type: inline-size;
          position: relative;
          width: min(100%, 520px);
          aspect-ratio: 3 / 4;
          box-sizing: border-box;
          padding: 8cqi;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          gap: 2.5cqi;
          background: var(--grain), var(--ground);
          color: var(--ink);
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          box-shadow: 0 30px 60px rgb(13 21 34 / 25%);
          overflow: hidden;
        }
        .club,
        .mood {
          position: absolute;
          top: 7cqi;
          font: 600 3cqi/1.2 'JetBrains Mono', ui-monospace, monospace;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .club {
          left: 8cqi;
        }
        .mood {
          right: 8cqi;
          color: var(--accent);
        }
        .line {
          position: absolute;
          top: 16%;
          left: 8%;
          width: 84%;
          height: 42%;
          color: var(--accent);
        }
        h1 {
          position: relative;
          margin: 0;
          font-family: 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 62%;
          font-weight: 900;
          font-size: 24cqi;
          line-height: 0.84;
          text-transform: uppercase;
        }
        .tagline {
          position: relative;
          margin: 0;
          font-size: 4.2cqi;
          line-height: 1.3;
        }
        .when {
          position: relative;
          margin: 1cqi 0 0;
          padding-top: 2.5cqi;
          border-top: 2px solid var(--accent);
          font: 600 3.4cqi/1.2 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
        }
      </style>
    </template>
  };
}
