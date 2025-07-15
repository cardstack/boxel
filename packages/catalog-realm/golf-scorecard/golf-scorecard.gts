import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';
import BooleanField from 'https://cardstack.com/base/boolean';
import { cn } from '@cardstack/boxel-ui/helpers';
import TrophyIcon from '@cardstack/boxel-icons/trophy';

export class HoleField extends FieldDef {
  static displayName = 'Hole';
  @field holeNumber = contains(NumberField);
  @field par = contains(NumberField);
  @field yards = contains(NumberField);
  @field strokes = contains(NumberField);
  @field putts = contains(NumberField);

  @field score = contains(StringField, {
    computeVia: function (this: HoleField) {
      try {
        const strokes = this.strokes ?? 0;
        const par = this.par ?? 4;
        const diff = strokes - par;

        if (strokes === 1) return 'Hole-in-One';
        if (diff === -3) return 'Albatross';
        if (diff === -2) return 'Eagle';
        if (diff === -1) return 'Birdie';
        if (diff === 0) return 'Par';
        if (diff === 1) return 'Bogey';
        if (diff === 2) return 'Double Bogey';
        return `+${diff}`;
      } catch (e) {
        console.error('Error computing score:', e);
        return 'Par';
      }
    },
  });
}

export class GolfScorecard extends CardDef {
  static displayName = 'Golf Scorecard';
  static icon = TrophyIcon;
  static prefersWideFormat = true;

  @field tournamentName = contains(StringField);
  @field courseName = contains(StringField);
  @field playerName = contains(StringField);
  @field roundDate = contains(DateField);
  @field roundNumber = contains(NumberField);
  @field holes = containsMany(HoleField);
  @field signedByPlayer = contains(BooleanField);
  @field signedByMarker = contains(BooleanField);

  @field frontNineTotal = contains(NumberField, {
    computeVia: function (this: GolfScorecard) {
      try {
        if (!this.holes || !Array.isArray(this.holes)) return 0;
        return this.holes
          .slice(0, 9)
          .reduce((total, hole) => total + (hole.strokes ?? 0), 0);
      } catch (e) {
        console.error('Error computing front nine total:', e);
        return 0;
      }
    },
  });

  @field backNineTotal = contains(NumberField, {
    computeVia: function (this: GolfScorecard) {
      try {
        if (!this.holes || !Array.isArray(this.holes)) return 0;
        return this.holes
          .slice(9, 18)
          .reduce((total, hole) => total + (hole.strokes ?? 0), 0);
      } catch (e) {
        console.error('Error computing back nine total:', e);
        return 0;
      }
    },
  });

  @field totalScore = contains(NumberField, {
    computeVia: function (this: GolfScorecard) {
      try {
        return this.frontNineTotal + this.backNineTotal;
      } catch (e) {
        console.error('Error computing total score:', e);
        return 0;
      }
    },
  });

  @field scoreToPar = contains(StringField, {
    computeVia: function (this: GolfScorecard) {
      try {
        if (!this.holes || !Array.isArray(this.holes)) return 'E';
        const totalPar = this.holes.reduce(
          (total, hole) => total + (hole.par ?? 4),
          0,
        );
        const diff = this.totalScore - totalPar;

        if (diff === 0) return 'E';
        if (diff > 0) return `+${diff}`;
        return `${diff}`;
      } catch (e) {
        console.error('Error computing score to par:', e);
        return 'E';
      }
    },
  });

  constructor(data?: Record<string, any> | undefined) {
    super(data);

    this.tournamentName = 'US Open Championship';
    this.roundDate = new Date();
    this.roundNumber = 1;
    this.signedByPlayer = false;
    this.signedByMarker = false;

    // Initialize 18 holes with US Open typical setup
    const defaultHoles = [
      { holeNumber: 1, par: 4, yards: 445 },
      { holeNumber: 2, par: 4, yards: 411 },
      { holeNumber: 3, par: 3, yards: 198 },
      { holeNumber: 4, par: 4, yards: 381 },
      { holeNumber: 5, par: 5, yards: 567 },
      { holeNumber: 6, par: 4, yards: 450 },
      { holeNumber: 7, par: 3, yards: 176 },
      { holeNumber: 8, par: 4, yards: 422 },
      { holeNumber: 9, par: 4, yards: 436 },
      { holeNumber: 10, par: 4, yards: 447 },
      { holeNumber: 11, par: 5, yards: 551 },
      { holeNumber: 12, par: 3, yards: 164 },
      { holeNumber: 13, par: 4, yards: 408 },
      { holeNumber: 14, par: 4, yards: 458 },
      { holeNumber: 15, par: 3, yards: 227 },
      { holeNumber: 16, par: 4, yards: 479 },
      { holeNumber: 17, par: 4, yards: 429 },
      { holeNumber: 18, par: 5, yards: 543 },
    ];

    // Create proper HoleField instances
    this.holes = defaultHoles.map((holeData) => {
      const hole = new HoleField({});
      hole.holeNumber = holeData.holeNumber;
      hole.par = holeData.par;
      hole.yards = holeData.yards;
      hole.strokes = 0;
      hole.putts = 0;
      return hole;
    });
  }

  static embedded = class Embedded extends Component<typeof this> {
    get formattedRoundDate() {
      let date = this.args.model?.roundDate;
      if (!date) return '';
      if (typeof date === 'string') date = new Date(date);
      return date instanceof Date && !isNaN(date.getTime())
        ? date.toLocaleDateString()
        : '';
    }
    <template>
      <div class='tv-scoreboard'>
        <div class='scoreboard-container'>
          <div class='scoreboard-header'>
            <div class='tournament-branding'>
              <div class='logo-container'>
                <img
                  src='https://cdn.brandfetch.io/id2q8bBLix/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B'
                  alt='USGA'
                  class='usga-logo'
                />
              </div>
              <div class='tournament-info'>
                <div class='tournament-name'>{{@model.tournamentName}}</div>
                <div class='course-name'>{{@model.courseName}}</div>
              </div>
              <div class='logo-container'>
                <img
                  src='https://cdn.brandfetch.io/idjcY_09lV/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B'
                  alt='PGA Tour'
                  class='pga-logo'
                />
              </div>
            </div>
            <div class='player-banner'>
              <div class='player-name'>{{@model.playerName}}</div>
              <div class='live-indicator'>
                <span class='live-dot'></span>LIVE
              </div>
              <div class='player-score'>
                <span class='score-label'>TO PAR</span>
                <span
                  class='score-value {{this.scoreClass}}'
                >{{@model.scoreToPar}}</span>
              </div>
            </div>
          </div>

          <div class='scorecard-grid'>
            <div class='hole-row header-row'>
              <div class='hole-cell'>HOLE</div>
              {{#each @model.holes as |hole|}}
                <div class='hole-cell'>{{hole.holeNumber}}</div>
              {{/each}}
              <div class='hole-cell total-cell'>TOTAL</div>
            </div>
            <div class='par-row'>
              <div class='hole-cell'>PAR</div>
              {{#each @model.holes as |hole|}}
                <div class='hole-cell'>{{hole.par}}</div>
              {{/each}}
              <div class='hole-cell total-cell'>{{this.totalPar}}</div>
            </div>
            <div class='score-row'>
              <div class='hole-cell'>SCORE</div>
              {{#each @model.holes as |hole|}}
                <div class='hole-cell score-cell {{getScoreClass hole.score}}'>
                  {{hole.strokes}}
                </div>
              {{/each}}
              <div
                class='hole-cell total-cell score-total'
              >{{@model.totalScore}}</div>
            </div>
          </div>

          <div class='scoreboard-footer'>
            <div class='round-info'>ROUND
              {{@model.roundNumber}}
              •
              {{this.formattedRoundDate}}</div>
            <div class='tv-graphics'>OFFICIAL PARTNER: USGA × PGA TOUR</div>
          </div>
        </div>
      </div>

      <style scoped>
        .tv-scoreboard {
          width: 100%;
          position: relative;
          background: linear-gradient(
            135deg,
            #001f3f 0%,
            #003366 50%,
            #000f1f 100%
          );
          color: white;
          border-radius: 12px;
          overflow: hidden;
          font-family: 'Helvetica Neue', 'Arial', sans-serif;
          /* 16:9 aspect ratio container */
          padding-top: 56.25%;
          box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.4),
            0 0 40px rgba(255, 255, 255, 0.1) inset;
          border: 2px solid rgba(255, 255, 255, 0.15);
        }

        .scoreboard-container {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          padding: 16px;
        }

        .scoreboard-header {
          margin-bottom: 16px;
        }

        .tournament-branding {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          background: linear-gradient(
            90deg,
            rgba(255, 193, 7, 0.1) 0%,
            rgba(255, 255, 255, 0.05) 50%,
            rgba(255, 193, 7, 0.1) 100%
          );
          padding: 12px 20px;
          border-radius: 8px;
          border: 1px solid rgba(255, 193, 7, 0.3);
        }

        .logo-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          max-width: 140px;
          height: 70px;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.2) 0%,
            rgba(255, 255, 255, 0.1) 100%
          );
          border-radius: 8px;
          padding: 8px;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .usga-logo,
        .pga-logo {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.2));
        }

        .tournament-info {
          flex: 3;
          text-align: center;
          padding: 0 8px;
        }

        .tournament-name {
          font-size: 22px;
          font-weight: 800;
          margin-bottom: 6px;
          color: #ffffff;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
          letter-spacing: 0.5px;
          background: linear-gradient(135deg, #ffffff 0%, #ffd700 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .course-name {
          font-size: 16px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.95);
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
          letter-spacing: 0.3px;
        }

        .player-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: linear-gradient(
            135deg,
            rgba(0, 0, 0, 0.4) 0%,
            rgba(0, 0, 0, 0.2) 100%
          );
          padding: 16px 24px;
          border-radius: 8px;
          margin-top: 12px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(15px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .player-name {
          font-size: 28px;
          font-weight: 800;
          flex: 3;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
          letter-spacing: 0.5px;
          background: linear-gradient(135deg, #ffffff 0%, #ffd700 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .live-indicator {
          display: flex;
          align-items: center;
          background: linear-gradient(135deg, #ff0040 0%, #cc0033 100%);
          color: #ffffff;
          padding: 8px 16px;
          border-radius: 25px;
          font-size: 14px;
          font-weight: 800;
          margin: 0 20px;
          flex: 1;
          justify-content: center;
          border: 2px solid rgba(255, 255, 255, 0.3);
          box-shadow: 0 0 20px rgba(255, 0, 64, 0.6);
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        }

        .live-dot {
          width: 10px;
          height: 10px;
          background: #ffffff;
          border-radius: 50%;
          margin-right: 8px;
          animation: pulse 1.2s infinite;
          box-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
        }

        @keyframes pulse {
          0% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
          100% {
            opacity: 1;
          }
        }

        .player-score {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          background: linear-gradient(
            135deg,
            rgba(255, 193, 7, 0.2) 0%,
            rgba(0, 0, 0, 0.3) 100%
          );
          padding: 8px 16px;
          border-radius: 8px;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 193, 7, 0.4);
        }

        .score-label {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.9);
          letter-spacing: 1px;
          text-transform: uppercase;
          font-weight: 600;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        }

        .score-value {
          font-size: 32px;
          font-weight: 900;
          letter-spacing: -1px;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
        }

        .score-value.under-par {
          color: #4ade80;
          text-shadow: 0 0 10px rgba(74, 222, 128, 0.5);
        }

        .score-value.over-par {
          color: #f87171;
          text-shadow: 0 0 10px rgba(248, 113, 113, 0.5);
        }

        .score-value.even-par {
          color: #ffffff;
          text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
        }

        .scorecard-grid {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow-x: auto;
          margin-bottom: 16px;
          background: linear-gradient(
            135deg,
            rgba(0, 0, 0, 0.4) 0%,
            rgba(0, 31, 63, 0.3) 100%
          );
          border-radius: 12px;
          padding: 16px;
          box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(15px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .hole-row {
          display: grid;
          grid-template-columns: 60px repeat(18, minmax(40px, 1fr)) 70px;
          margin-bottom: 6px;
          text-align: center;
        }

        .header-row {
          font-weight: 700;
          font-size: 14px;
          color: #ffd700;
          letter-spacing: 1px;
          border-bottom: 2px solid rgba(255, 215, 0, 0.5);
          padding-bottom: 8px;
          margin-bottom: 12px;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
          background: linear-gradient(
            90deg,
            rgba(255, 215, 0, 0.1) 0%,
            transparent 100%
          );
        }

        .hole-cell {
          padding: 8px 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: 600;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        }

        .par-row {
          color: rgba(255, 255, 255, 0.8);
          margin-bottom: 8px;
        }

        .score-cell {
          font-weight: 700;
          border-radius: 6px;
          margin: 0 2px;
          backdrop-filter: blur(10px);
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
        }

        .score-cell.birdie {
          background: linear-gradient(
            135deg,
            rgba(34, 197, 94, 0.8) 0%,
            rgba(21, 128, 61, 0.6) 100%
          );
          color: #ffffff;
          border: 2px solid rgba(34, 197, 94, 0.9);
          box-shadow: 0 0 15px rgba(34, 197, 94, 0.5);
        }

        .score-cell.eagle,
        .score-cell.albatross {
          background: linear-gradient(
            135deg,
            rgba(6, 182, 212, 0.9) 0%,
            rgba(3, 105, 161, 0.7) 100%
          );
          color: #ffffff;
          font-weight: 800;
          border: 2px solid rgba(6, 182, 212, 1);
          box-shadow: 0 0 20px rgba(6, 182, 212, 0.6);
        }

        .score-cell.bogey {
          background: linear-gradient(
            135deg,
            rgba(251, 146, 60, 0.8) 0%,
            rgba(217, 119, 6, 0.6) 100%
          );
          color: #ffffff;
          border: 2px solid rgba(251, 146, 60, 0.9);
          box-shadow: 0 0 15px rgba(251, 146, 60, 0.5);
        }

        .score-cell.double-bogey,
        .score-cell._3 {
          background: linear-gradient(
            135deg,
            rgba(239, 68, 68, 0.9) 0%,
            rgba(185, 28, 28, 0.7) 100%
          );
          color: #ffffff;
          font-weight: 800;
          border: 2px solid rgba(239, 68, 68, 1);
          box-shadow: 0 0 20px rgba(239, 68, 68, 0.6);
        }

        .score-cell.hole-in-one {
          background-color: rgba(168, 85, 247, 0.7);
          color: white;
          font-weight: 800;
          animation: highlight 3s infinite;
          border: 2px solid white;
        }

        @keyframes highlight {
          0% {
            background-color: rgba(168, 85, 247, 0.7);
          }
          50% {
            background-color: rgba(168, 85, 247, 0.9);
          }
          100% {
            background-color: rgba(168, 85, 247, 0.7);
          }
        }

        .total-cell {
          font-weight: 700;
          color: white;
        }

        .score-total {
          background: linear-gradient(
            135deg,
            rgba(255, 215, 0, 0.3) 0%,
            rgba(255, 255, 255, 0.2) 100%
          );
          font-size: 20px;
          font-weight: 800;
          border-radius: 8px;
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.4);
          border: 2px solid rgba(255, 215, 0, 0.6);
          text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
        }

        .scoreboard-footer {
          display: flex;
          justify-content: space-between;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.9);
          padding-top: 12px;
          border-top: 2px solid rgba(255, 215, 0, 0.3);
          background: linear-gradient(
            90deg,
            rgba(255, 215, 0, 0.05) 0%,
            transparent 50%,
            rgba(255, 215, 0, 0.05) 100%
          );
          padding: 12px;
          border-radius: 8px;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
          font-weight: 600;
        }

        /* Responsive adjustments */
        @media (max-width: 1200px) {
          .hole-cell {
            font-size: 12px;
            padding: 4px 2px;
          }

          .player-name {
            font-size: 18px;
          }
        }

        @media (max-width: 900px) {
          .scorecard-grid {
            font-size: 10px;
          }

          .tournament-name {
            font-size: 16px;
          }
        }
      </style>
    </template>

    get scoreClass() {
      try {
        const scoreToPar = this.args.model?.scoreToPar;
        if (scoreToPar === 'E') return 'even-par';
        if (scoreToPar && scoreToPar.startsWith('-')) return 'under-par';
        if (scoreToPar && scoreToPar.startsWith('+')) return 'over-par';
        return 'even-par';
      } catch (e) {
        return 'even-par';
      }
    }

    get totalPar() {
      try {
        if (!this.args.model?.holes) return 72;
        return this.args.model.holes.reduce(
          (total, hole) => total + (hole.par || 0),
          0,
        );
      } catch (e) {
        return 72;
      }
    }
  };

  static isolated = class Isolated extends Component<typeof this> {
    get formattedRoundDate() {
      let date = this.args.model?.roundDate;
      if (!date) return '';
      if (typeof date === 'string') date = new Date(date);
      return date instanceof Date && !isNaN(date.getTime())
        ? date.toLocaleDateString()
        : '';
    }

    get frontNinePar() {
      try {
        if (!this.args.model?.holes) return 0;
        return this.args.model.holes
          .slice(0, 9)
          .reduce((total, hole) => total + (hole.par ?? 0), 0);
      } catch (e) {
        return 0;
      }
    }

    get backNinePar() {
      try {
        if (!this.args.model?.holes) return 0;
        return this.args.model.holes
          .slice(9, 18)
          .reduce((total, hole) => total + (hole.par ?? 0), 0);
      } catch (e) {
        return 0;
      }
    }

    get frontNineYards() {
      try {
        if (!this.args.model?.holes) return 0;
        return this.args.model.holes
          .slice(0, 9)
          .reduce((total, hole) => total + (hole.yards ?? 0), 0);
      } catch (e) {
        return 0;
      }
    }

    get backNineYards() {
      try {
        if (!this.args.model?.holes) return 0;
        return this.args.model.holes
          .slice(9, 18)
          .reduce((total, hole) => total + (hole.yards ?? 0), 0);
      } catch (e) {
        return 0;
      }
    }

    get frontNinePutts() {
      try {
        if (!this.args.model?.holes) return 0;
        return this.args.model.holes
          .slice(0, 9)
          .reduce((total, hole) => total + (hole.putts ?? 0), 0);
      } catch (e) {
        return 0;
      }
    }

    get backNinePutts() {
      try {
        if (!this.args.model?.holes) return 0;
        return this.args.model.holes
          .slice(9, 18)
          .reduce((total, hole) => total + (hole.putts ?? 0), 0);
      } catch (e) {
        return 0;
      }
    }

    <template>
      <div class='scorecard'>
        <div class='header'>
          <div class='branding'>
            <div class='brand-logos'>
              <img
                src='https://cdn.brandfetch.io/id2q8bBLix/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B'
                alt='USGA'
                class='usga-logo'
              />
              <img
                src='https://cdn.brandfetch.io/idjcY_09lV/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B'
                alt='PGA Tour'
                class='pga-logo'
              />
            </div>
            <h1 class='tournament-title'>{{@model.tournamentName}}</h1>
          </div>

          <div class='player-info'>
            <div class='info-row'>
              <span class='label'>Player:</span>
              <span class='value'>{{@model.playerName}}</span>
            </div>
            <div class='info-row'>
              <span class='label'>Course:</span>
              <span class='value'>{{@model.courseName}}</span>
            </div>
            <div class='info-row'>
              <span class='label'>Round:</span>
              <span class='value'>{{@model.roundNumber}}</span>
            </div>
            <div class='info-row'>
              <span class='label'>Date:</span>
              <span class='value'>{{this.formattedRoundDate}}</span>
            </div>
          </div>
        </div>

        <div class='nine-section'>
          <h2 class='nine-title'>Front Nine</h2>
          <div class='scorecard-table-wrapper'>
            <table class='scorecard-table'>
              <thead>
                <tr class='table-header'>
                  <th class='hole-cell'>Hole</th>
                  <th class='par-cell'>Par</th>
                  <th class='yards-cell'>Yards</th>
                  <th class='score-cell'>Score</th>
                  <th class='putts-cell'>Putts</th>
                  <th class='result-cell'>Result</th>
                </tr>
              </thead>
              <tbody>
                {{#if @model.holes}}
                  {{#each (slice @model.holes 0 9) as |hole|}}
                    <tr class='table-row'>
                      <td class='hole-cell hole-number'>{{hole.holeNumber}}</td>
                      <td class='par-cell'>{{hole.par}}</td>
                      <td class='yards-cell'>{{hole.yards}}</td>
                      <td class='score-cell score-value'>{{hole.strokes}}</td>
                      <td class='putts-cell'>{{hole.putts}}</td>
                      <td class='result-cell'>
                        <span
                          class={{cn 'score-badge' (getScoreClass hole.score)}}
                        >
                          {{hole.score}}
                        </span>
                      </td>
                    </tr>
                  {{/each}}
                {{/if}}
                <tr class='total-row'>
                  <td class='hole-cell'>OUT</td>
                  <td class='par-cell'>{{this.frontNinePar}}</td>
                  <td class='yards-cell'>{{this.frontNineYards}}</td>
                  <td
                    class='score-cell total-score'
                  >{{@model.frontNineTotal}}</td>
                  <td class='putts-cell'>{{this.frontNinePutts}}</td>
                  <td class='result-cell'></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class='nine-section'>
          <h2 class='nine-title'>Back Nine</h2>
          <div class='scorecard-table-wrapper'>
            <table class='scorecard-table'>
              <thead>
                <tr class='table-header'>
                  <th class='hole-cell'>Hole</th>
                  <th class='par-cell'>Par</th>
                  <th class='yards-cell'>Yards</th>
                  <th class='score-cell'>Score</th>
                  <th class='putts-cell'>Putts</th>
                  <th class='result-cell'>Result</th>
                </tr>
              </thead>
              <tbody>
                {{#if @model.holes}}
                  {{#each (slice @model.holes 9 18) as |hole|}}
                    <tr class='table-row'>
                      <td class='hole-cell hole-number'>{{hole.holeNumber}}</td>
                      <td class='par-cell'>{{hole.par}}</td>
                      <td class='yards-cell'>{{hole.yards}}</td>
                      <td class='score-cell score-value'>{{hole.strokes}}</td>
                      <td class='putts-cell'>{{hole.putts}}</td>
                      <td class='result-cell'>
                        <span
                          class={{cn 'score-badge' (getScoreClass hole.score)}}
                        >
                          {{hole.score}}
                        </span>
                      </td>
                    </tr>
                  {{/each}}
                {{/if}}
                <tr class='total-row'>
                  <td class='hole-cell'>IN</td>
                  <td class='par-cell'>{{this.backNinePar}}</td>
                  <td class='yards-cell'>{{this.backNineYards}}</td>
                  <td
                    class='score-cell total-score'
                  >{{@model.backNineTotal}}</td>
                  <td class='putts-cell'>{{this.backNinePutts}}</td>
                  <td class='result-cell'></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class='summary'>
          <div class='summary-stats'>
            <div class='stat-item'>
              <span class='stat-label'>Total Score</span>
              <span class='stat-value total'>{{@model.totalScore}}</span>
            </div>
            <div class='stat-item'>
              <span class='stat-label'>To Par</span>
              <span class='stat-value par'>{{@model.scoreToPar}}</span>
            </div>
          </div>

          <div class='signatures'>
            <div class='signature-row'>
              <span class='signature-label'>Player Signature:</span>
              <div class='signature-box'>
                {{#if @model.signedByPlayer}}
                  <span class='signed'>✓ Signed</span>
                {{else}}
                  <span class='unsigned'>Awaiting signature</span>
                {{/if}}
              </div>
            </div>
            <div class='signature-row'>
              <span class='signature-label'>Marker Signature:</span>
              <div class='signature-box'>
                {{#if @model.signedByMarker}}
                  <span class='signed'>✓ Signed</span>
                {{else}}
                  <span class='unsigned'>Awaiting signature</span>
                {{/if}}
              </div>
            </div>
          </div>
        </div>

        <div class='footer'>
          <div class='partnership-text'>
            Official Partnership: USGA × PGA TOUR
          </div>
        </div>
      </div>

      <style scoped>
        .scorecard {
          --masters-green: #076652;
          --masters-dark: #044536;
          --pga-blue: #00507a;
          --pga-light-blue: #0078b3;
          --paper-white: #fefefe;
          --grid-border: #d0e0d0;
          --text-primary: #2c2c2c;
          --text-secondary: #555;
          --success-green: #15803d;
          --warning-orange: #d97706;
          --danger-red: #dc2626;
          --pxg-black: #222;
          --pxg-gold: #d4af37;
          padding: 16px;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 32px;
          padding-bottom: 20px;
          border-bottom: 2px solid var(--masters-green);
          background-color: rgba(7, 102, 82, 0.05);
          padding: 20px;
          border-radius: 6px;
        }

        .branding {
          flex: 1;
        }

        .brand-logos {
          display: flex;
          gap: 20px;
          align-items: center;
          margin-bottom: 12px;
        }

        .usga-logo,
        .pga-logo {
          max-height: 50px;
          width: auto;
          object-fit: contain;
        }

        .tournament-title {
          font-size: 28px;
          font-weight: 700;
          color: var(--pxg-black);
          margin: 0;
        }

        .player-info {
          flex: 1;
          max-width: 300px;
        }

        .info-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          padding: 4px 0;
        }

        .label {
          font-weight: 600;
          color: var(--text-secondary);
        }

        .value {
          font-weight: 500;
          color: var(--text-primary);
        }

        .nine-section {
          margin-bottom: 32px;
        }

        .nine-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 12px 0;
          padding: 8px 12px;
          background: linear-gradient(
            135deg,
            var(--masters-green) 0%,
            var(--pga-blue) 100%
          );
          color: white;
          border-radius: 4px;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .scorecard-table-wrapper {
          width: 100%;
          overflow-x: auto;
        }
        .scorecard-table {
          width: 100%;
          min-width: 600px;
          border-collapse: collapse;
        }
        .scorecard-table th,
        .scorecard-table td {
          border: 1px solid var(--grid-border);
          padding: 8px;
          text-align: center;
        }
        .scorecard-table th {
          background: var(--pxg-black);
          color: var(--pxg-gold);
          font-weight: 600;
        }
        .scorecard-table .total-row td {
          background: #f8f9fa;
          font-weight: 700;
        }

        .summary {
          background: linear-gradient(
            135deg,
            var(--masters-green) 0%,
            var(--masters-dark) 100%
          );
          color: white;
          padding: 24px;
          margin-top: 32px;
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .summary-stats {
          display: flex;
          gap: 32px;
          justify-content: center;
          margin-bottom: 24px;
        }

        .stat-item {
          text-align: center;
        }

        .stat-label {
          display: block;
          font-size: 14px;
          margin-bottom: 4px;
          opacity: 0.8;
        }

        .stat-value {
          display: block;
          font-size: 36px;
          font-weight: 900;
        }

        .signatures {
          display: flex;
          gap: 32px;
          justify-content: center;
        }

        .signature-row {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .signature-label {
          font-size: 14px;
          opacity: 0.8;
        }

        .signature-box {
          border: 1px solid var(--pxg-gold);
          padding: 8px 16px;
          min-width: 120px;
          text-align: center;
        }

        .signed {
          color: var(--success-green);
          font-weight: 600;
        }

        .unsigned {
          opacity: 0.6;
          font-style: italic;
        }

        .footer {
          text-align: center;
          margin-top: 24px;
          padding-top: 16px;
          border-top: 1px solid var(--grid-border);
        }

        .partnership-text {
          font-size: 12px;
          color: var(--text-secondary);
          font-style: italic;
        }

        .score-badge {
          padding: 2px 6px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          display: inline-block;
        }
        .score-badge.hole-in-one {
          background: #8b5cf6;
          color: white;
          font-weight: 700;
          box-shadow: 0 1px 3px rgba(139, 92, 246, 0.5);
        }
        .score-badge.albatross {
          background: #06b6d4;
          color: white;
          font-weight: 700;
          box-shadow: 0 1px 3px rgba(6, 182, 212, 0.5);
        }
        .score-badge.eagle {
          background: #059669;
          color: white;
          font-weight: 700;
          box-shadow: 0 1px 3px rgba(5, 150, 105, 0.5);
        }
        .score-badge.birdie {
          background: #16a34a;
          color: white;
          box-shadow: 0 1px 3px rgba(22, 163, 74, 0.5);
        }
        .score-badge.par {
          background: #4b5563;
          color: white;
          box-shadow: 0 1px 3px rgba(75, 85, 99, 0.5);
        }
        .score-badge.bogey {
          background: #d97706;
          color: white;
          box-shadow: 0 1px 3px rgba(217, 119, 6, 0.5);
        }
        .score-badge.double-bogey {
          background: #dc2626;
          color: white;
          font-weight: 700;
          box-shadow: 0 1px 3px rgba(220, 38, 38, 0.5);
        }

        @media (max-width: 768px) {
          .header {
            flex-direction: column;
            gap: 16px;
          }

          .table-header,
          .table-row,
          .total-row {
            grid-template-columns: 40px 40px 60px 50px 50px 70px;
          }

          .cell {
            padding: 6px 4px;
            font-size: 12px;
          }
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='edit-form'>
        <div class='form-section'>
          <h3>Tournament Information</h3>
          <div class='field-grid'>
            <div class='field-group'>
              <label>Tournament Name</label>
              <@fields.tournamentName />
            </div>
            <div class='field-group'>
              <label>Course Name</label>
              <@fields.courseName />
            </div>
            <div class='field-group'>
              <label>Player Name</label>
              <@fields.playerName />
            </div>
            <div class='field-group'>
              <label>Round Number</label>
              <@fields.roundNumber />
            </div>
            <div class='field-group'>
              <label>Round Date</label>
              <@fields.roundDate />
            </div>
          </div>
        </div>

        <div class='form-section'>
          <h3>Hole Scores</h3>
          <@fields.holes />
        </div>

        <div class='form-section'>
          <h3>Signatures</h3>
          <div class='field-grid'>
            <div class='field-group'>
              <label>
                <@fields.signedByPlayer />
                Player Signature Confirmed
              </label>
            </div>
            <div class='field-group'>
              <label>
                <@fields.signedByMarker />
                Marker Signature Confirmed
              </label>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .edit-form {
          padding: 20px;
          max-width: 800px;
        }

        .form-section {
          margin-bottom: 32px;
        }

        .form-section h3 {
          color: #1a1a1a;
          margin-bottom: 16px;
          padding-bottom: 8px;
          border-bottom: 2px solid #d4af37;
        }

        .field-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
        }

        .field-group {
          display: flex;
          flex-direction: column;
        }

        .field-group label {
          font-weight: 600;
          margin-bottom: 4px;
          color: #2c2c2c;
        }
      </style>
    </template>
  };
}

function getScoreClass(score: string) {
  if (!score) return '';
  return score.toLowerCase().replace(/[^a-z]/g, '_');
}

function slice(array: any[], start: number, end: number) {
  if (!array || !Array.isArray(array)) return [];
  return array.slice(start, end);
}
