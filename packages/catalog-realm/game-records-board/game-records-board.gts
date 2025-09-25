import {
  CardDef,
  Component,
  field,
  contains,
  getCardMeta,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import GamepadIcon from '@cardstack/boxel-icons/gamepad-2';
import { CardList } from '../components/card-list';
import { realmURL } from '@cardstack/runtime-common';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { ResolvedCodeRef, Query } from '@cardstack/runtime-common';

interface GameStatusField {
  label: string;
}

interface PlayerOutcomeField {
  player: CardDef;
  outcome: GameStatusField;
}

interface GameResult extends CardDef {
  game: CardDef;
  outcome: PlayerOutcomeField;
  ref: {
    module: string;
    name: string;
  };
  title: string;
}

interface GameResultRef {
  adoptsFrom: ResolvedCodeRef;
  ref: ResolvedCodeRef;
  title: string;
}

class IsolatedTemplate extends Component<typeof GameRecordsBoard> {
  @tracked selectedGameRef: GameResultRef | null = null;

  get allGameRecordsQuery(): Query {
    return {
      filter: {
        eq: {
          _cardType: 'Game Result',
        },
      },
      sort: [
        {
          by: 'lastModified' as const,
          direction: 'desc' as const,
        },
      ],
    };
  }

  get selectedGameRecordsQuery(): Query {
    if (!this.selectedGameRef) {
      return this.allGameRecordsQuery;
    }

    const adoptsFromModule = new URL(
      this.selectedGameRef.adoptsFrom.module,
      import.meta.url,
    ).href;
    const adoptsFromName = this.selectedGameRef.adoptsFrom.name;
    const refModule = new URL(this.selectedGameRef.ref.module, import.meta.url)
      .href;
    const refName = this.selectedGameRef.ref.name;

    return {
      filter: {
        on: {
          module: adoptsFromModule,
          name: adoptsFromName,
        },
        eq: {
          ref: {
            module: refModule,
            name: refName,
          },
        },
      },
      sort: [
        {
          by: 'lastModified' as const,
          direction: 'desc' as const,
        },
      ],
    };
  }

  //Prerendered Search
  get gameRecordsQuery(): Query {
    return this.selectedGameRef
      ? this.selectedGameRecordsQuery
      : this.allGameRecordsQuery;
  }

  get realms() {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  //getCards - Game Titles for dropdown
  gameRecordsData = this.args.context?.getCards(
    this,
    () => this.allGameRecordsQuery,
    () => this.realms,
    { isLive: true },
  );

  get gameTitles() {
    if (!this.gameRecordsData || this.gameRecordsData.isLoading) {
      return [];
    }

    return [
      'All Games',
      ...new Set(this.gameRecordsData.instances?.map((game) => game.title)),
    ];
  }

  get gameOptions() {
    if (!this.gameRecordsData || this.gameRecordsData.isLoading) {
      return [];
    }
    // Create a map of unique game references with their titles
    const gameMap = new Map<
      string,
      { adoptsFrom: ResolvedCodeRef; ref: ResolvedCodeRef; title: string }
    >();

    (this.gameRecordsData.instances as GameResult[]).forEach((gameResult) => {
      const adoptsFrom = getCardMeta(gameResult, 'adoptsFrom');
      const key = `${gameResult.ref.module}#${gameResult.ref.name}`;

      if (!gameMap.has(key)) {
        gameMap.set(key, {
          adoptsFrom: adoptsFrom as ResolvedCodeRef,
          ref: {
            module: gameResult.ref.module,
            name: gameResult.ref.name,
          },
          title: gameResult.game.title,
        });
      }
    });

    return Array.from(gameMap.values());
  }

  //getCards - stats, based on selected game
  gameStatsData = this.args.context?.getCards(
    this,
    () => this.gameRecordsQuery,
    () => this.realms,
    { isLive: true },
  );

  get gameStats() {
    if (!this.gameStatsData || this.gameStatsData.isLoading) {
      return { wins: 0, losses: 0, draws: 0, total: 0 };
    }

    const results = (this.gameStatsData.instances ?? []) as GameResult[];

    const wins = results.filter(
      (result) => result.outcome.outcome.label === 'Win',
    ).length;
    const losses = results.filter(
      (result) => result.outcome.outcome.label === 'Lose',
    ).length;
    const draws = results.filter(
      (result) => result.outcome.outcome.label === 'Draw',
    ).length;
    const total = results.length;

    return { wins, losses, draws, total };
  }

  @action
  onGameSelect(gameTitle: string | null) {
    if (gameTitle && gameTitle !== 'All Games') {
      const selectedOption = this.gameOptions.find(
        (option) => option.title === gameTitle,
      );
      this.selectedGameRef = selectedOption ?? null;
    } else {
      this.selectedGameRef = null;
    }
  }

  get currentTime() {
    return new Date().toLocaleTimeString();
  }

  get getSelectedGameTitle() {
    return this.selectedGameRef?.title || 'All Games';
  }

  <template>
    <div class='dashboard-arena'>
      <div class='bg-matrix'></div>
      <div class='bg-grid'></div>
      <div class='bg-glow'></div>

      <div class='particles'>
        <div class='particle'></div>
        <div class='particle'></div>
        <div class='particle'></div>
        <div class='particle'></div>
        <div class='particle'></div>
      </div>

      <header class='command-center'>
        <div class='status-bar'>
          <div class='status-indicator active'></div>
          <span class='status-text'>SYSTEM ONLINE</span>
          <div class='timestamp'>{{this.currentTime}}</div>
        </div>

        <div class='title-arena'>
          <div class='icon-matrix'>
            <GamepadIcon class='main-icon' />
            <div class='icon-ring'></div>
          </div>
          <div class='title-stack'>
            <h1 class='main-title'>GAME RECORDS</h1>
            <div class='title-underline'></div>
          </div>
        </div>
      </header>

      <section class='stats-grid'>
        {{#if this.selectedGameRef}}
          <div class='stats-header'>
            <div class='stats-title'>STATISTICS FOR:
              {{this.getSelectedGameTitle}}</div>
            <div class='stats-subtitle'>Game-specific performance metrics</div>
          </div>
        {{else}}
          <div class='stats-header'>
            <div class='stats-title'>OVERALL STATISTICS</div>
            <div class='stats-subtitle'>All games combined performance</div>
          </div>
        {{/if}}
        <div class='stats-cards'>
          <div class='stat-card primary'>
            <div class='stat-icon'>🏆</div>
            <div class='stat-label'>VICTORIES</div>
            <div class='stat-value'>
              {{#if this.gameRecordsData.isLoading}}
                Loading...
              {{else}}
                {{this.gameStats.wins}}
              {{/if}}
            </div>
            <div class='stat-pulse'></div>
          </div>
          <div class='stat-card danger'>
            <div class='stat-icon'>💀</div>
            <div class='stat-label'>DEFEATS</div>
            <div class='stat-value'>
              {{#if this.gameRecordsData.isLoading}}
                Loading...
              {{else}}
                {{this.gameStats.losses}}
              {{/if}}
            </div>
            <div class='stat-pulse'></div>
          </div>
          <div class='stat-card warning'>
            <div class='stat-icon'>🤝</div>
            <div class='stat-label'>DRAWS</div>
            <div class='stat-value'>
              {{#if this.gameRecordsData.isLoading}}
                Loading...
              {{else}}
                {{this.gameStats.draws}}
              {{/if}}
            </div>
            <div class='stat-pulse'></div>
          </div>
          <div class='stat-card info'>
            <div class='stat-icon'>🎮</div>
            <div class='stat-label'>TOTAL GAMES</div>
            <div class='stat-value'>
              {{#if this.gameRecordsData.isLoading}}
                Loading...
              {{else}}
                {{this.gameStats.total}}
              {{/if}}
            </div>
            <div class='stat-pulse'></div>
          </div>
        </div>
      </section>

      <main class='data-terminal'>
        <div class='terminal-header'>
          <div class='game-filter-section'>
            <div class='filter-label'>FILTER BY GAME:</div>

            <BoxelSelect
              @placeholder='Select a game'
              @selected={{this.selectedGameRef.title}}
              @onChange={{this.onGameSelect}}
              @options={{this.gameTitles}}
              @searchEnabled={{true}}
              @disabled={{this.gameRecordsData.isLoading}}
              class='game-selector'
              aria-label='Filter by game'
              as |gameTitle|
            >
              {{gameTitle}}
            </BoxelSelect>
          </div>
        </div>

        <div class='terminal-content'>
          <div class='scan-line'></div>
          <CardList
            @query={{this.gameRecordsQuery}}
            @realms={{this.realms}}
            @context={{@context}}
          />
        </div>
      </main>
    </div>

    <style scoped>
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Inter:wght@400;500;600&display=swap');

      .dashboard-arena {
        position: relative;
        width: 100%;
        background:
          radial-gradient(
            circle at 20% 80%,
            rgba(0, 255, 255, 0.1) 0%,
            transparent 50%
          ),
          radial-gradient(
            circle at 80% 20%,
            rgba(255, 0, 255, 0.1) 0%,
            transparent 50%
          ),
          linear-gradient(
            135deg,
            #0a0a0f 0%,
            #1a1a2e 25%,
            #16213e 75%,
            #0f3460 100%
          );
        color: #00ffff;
        font-family: 'Inter', sans-serif;
        padding: 2rem;
        box-sizing: border-box;
        container-type: inline-size;
        overflow: hidden;
      }

      .dashboard-arena :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute;
      }

      /* Animated background layers */
      .bg-matrix {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background:
          linear-gradient(90deg, transparent 98%, rgba(0, 255, 255, 0.03) 100%),
          linear-gradient(transparent 98%, rgba(0, 255, 255, 0.03) 100%);
        background-size: 50px 50px;
        animation: matrixMove 20s linear infinite;
        pointer-events: none;
      }

      .bg-grid {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background:
          linear-gradient(90deg, rgba(0, 255, 255, 0.05) 1px, transparent 1px),
          linear-gradient(rgba(0, 255, 255, 0.05) 1px, transparent 1px);
        background-size: 100px 100px;
        animation: gridPulse 4s ease-in-out infinite;
        pointer-events: none;
      }

      .bg-glow {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 800px;
        height: 800px;
        transform: translate(-50%, -50%);
        background: radial-gradient(
          circle,
          rgba(0, 255, 255, 0.05) 0%,
          transparent 70%
        );
        animation: glowPulse 6s ease-in-out infinite;
        pointer-events: none;
      }

      @keyframes matrixMove {
        0% {
          transform: translate(0, 0);
        }
        100% {
          transform: translate(50px, 50px);
        }
      }

      @keyframes gridPulse {
        0%,
        100% {
          opacity: 0.3;
        }
        50% {
          opacity: 0.6;
        }
      }

      @keyframes glowPulse {
        0%,
        100% {
          opacity: 0.5;
          transform: translate(-50%, -50%) scale(1);
        }
        50% {
          opacity: 0.8;
          transform: translate(-50%, -50%) scale(1.1);
        }
      }

      /* Floating particles */
      .particles {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
      }

      .particle {
        position: absolute;
        width: 2px;
        height: 2px;
        background: #00ffff;
        border-radius: 50%;
        animation: float 8s infinite linear;
        box-shadow: 0 0 6px #00ffff;
      }

      .particle:nth-child(1) {
        left: 10%;
        animation-delay: 0s;
        animation-duration: 8s;
      }
      .particle:nth-child(2) {
        left: 30%;
        animation-delay: 2s;
        animation-duration: 10s;
      }
      .particle:nth-child(3) {
        left: 50%;
        animation-delay: 4s;
        animation-duration: 12s;
      }
      .particle:nth-child(4) {
        left: 70%;
        animation-delay: 6s;
        animation-duration: 9s;
      }
      .particle:nth-child(5) {
        left: 90%;
        animation-delay: 1s;
        animation-duration: 11s;
      }

      @keyframes float {
        0% {
          transform: translateY(100vh) scale(0);
          opacity: 0;
        }
        10% {
          opacity: 1;
        }
        90% {
          opacity: 1;
        }
        100% {
          transform: translateY(-10vh) scale(1);
          opacity: 0;
        }
      }

      /* Header command center */
      .command-center {
        position: relative;
        z-index: 10;
        margin-bottom: 2rem;
      }

      .status-bar {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.5rem;
        padding: 0.75rem 1.5rem;
        background: rgba(0, 255, 255, 0.1);
        border: 1px solid rgba(0, 255, 255, 0.3);
        border-radius: 25px;
        backdrop-filter: blur(10px);
        font-family: 'Orbitron', monospace;
        font-size: 0.75rem;
        letter-spacing: 2px;
      }

      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #00ff00;
        box-shadow: 0 0 10px #00ff00;
        animation: statusBlink 2s infinite;
      }

      @keyframes statusBlink {
        0%,
        50% {
          opacity: 1;
        }
        51%,
        100% {
          opacity: 0.3;
        }
      }

      .status-text {
        flex: 1;
        color: #00ff00;
        font-weight: 700;
      }

      .timestamp {
        color: #00ffff;
        font-family: monospace;
      }

      .title-arena {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1.5rem;
        padding: 1.5rem;
        background: linear-gradient(
          135deg,
          rgba(0, 255, 255, 0.1) 0%,
          rgba(255, 0, 255, 0.1) 100%
        );
        border: 2px solid transparent;
        border-radius: 16px;
        backdrop-filter: blur(20px);
        position: relative;
        overflow: hidden;
      }

      .title-arena::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(45deg, #00ffff, #ff00ff, #00ffff);
        border-radius: 20px;
        padding: 2px;
        mask:
          linear-gradient(#fff 0 0) content-box,
          linear-gradient(#fff 0 0);
        mask-composite: exclude;
        animation: borderRotate 3s linear infinite;
      }

      @keyframes borderRotate {
        0% {
          filter: hue-rotate(0deg);
        }
        100% {
          filter: hue-rotate(360deg);
        }
      }

      .icon-matrix {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .main-icon {
        width: 60px;
        height: 60px;
        color: #00ffff;
        filter: drop-shadow(0 0 15px #00ffff);
        z-index: 2;
        animation: iconPulse 3s ease-in-out infinite;
      }

      .icon-ring {
        position: absolute;
        width: 90px;
        height: 90px;
        border: 2px solid rgba(0, 255, 255, 0.3);
        border-radius: 50%;
        animation: ringRotate 4s linear infinite;
      }

      @keyframes iconPulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.1);
        }
      }

      @keyframes ringRotate {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .title-stack {
        text-align: center;
        position: relative;
      }

      .main-title {
        font-family: 'Orbitron', monospace;
        font-size: clamp(2rem, 4vw, 3rem);
        font-weight: 900;
        margin: 0;
        background: linear-gradient(45deg, #00ffff, #ff00ff, #ffff00, #00ffff);
        background-size: 300% 300%;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: titleShimmer 4s ease-in-out infinite;
        text-shadow: 0 0 20px rgba(0, 255, 255, 0.5);
        letter-spacing: 2px;
      }

      .sub-title {
        font-family: 'Orbitron', monospace;
        font-size: 1rem;
        font-weight: 400;
        margin: 0.375rem 0;
        color: rgba(255, 255, 255, 0.7);
        letter-spacing: 3px;
      }

      .title-underline {
        width: 100%;
        height: 3px;
        background: linear-gradient(90deg, transparent, #00ffff, transparent);
        margin-top: 1rem;
        animation: underlineGlow 2s ease-in-out infinite;
      }

      @keyframes titleShimmer {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      @keyframes underlineGlow {
        0%,
        100% {
          opacity: 0.5;
        }
        50% {
          opacity: 1;
        }
      }

      /* Stats grid */
      .stats-grid {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        margin-bottom: 2rem;
        z-index: 10;
        position: relative;
      }

      .stats-header {
        text-align: center;
        padding: 1rem;
        background: rgba(0, 255, 255, 0.1);
        border: 1px solid rgba(0, 255, 255, 0.3);
        border-radius: 15px;
        backdrop-filter: blur(10px);
      }

      .stats-title {
        font-family: 'Orbitron', monospace;
        font-size: 1.2rem;
        font-weight: 700;
        color: #00ffff;
        margin-bottom: 0.5rem;
        letter-spacing: 1px;
        text-shadow: 0 0 10px rgba(0, 255, 255, 0.5);
      }

      .stats-subtitle {
        font-family: 'Inter', sans-serif;
        font-size: 0.875rem;
        color: rgba(255, 255, 255, 0.7);
        opacity: 0.8;
      }

      .stats-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 1rem;
      }

      .stat-card {
        position: relative;
        padding: 1rem;
        background: rgba(0, 0, 0, 0.4);
        border: 1px solid rgba(0, 255, 255, 0.3);
        border-radius: 12px;
        backdrop-filter: blur(15px);
        text-align: center;
        overflow: hidden;
        transition: all 0.3s ease;
      }

      .stat-card:hover {
        transform: translateY(-3px);
        box-shadow: 0 10px 20px rgba(0, 255, 255, 0.15);
      }

      .stat-card.primary {
        border-color: rgba(0, 255, 0, 0.5);
      }
      .stat-card.danger {
        border-color: rgba(255, 0, 0, 0.5);
      }
      .stat-card.warning {
        border-color: rgba(255, 255, 0, 0.5);
      }
      .stat-card.info {
        border-color: rgba(0, 255, 255, 0.5);
      }

      .stat-icon {
        font-size: 1.5rem;
        margin-bottom: 0.375rem;
        filter: drop-shadow(0 0 8px currentColor);
      }

      .stat-label {
        font-family: 'Orbitron', monospace;
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.5px;
        margin-bottom: 0.375rem;
        opacity: 0.8;
      }

      .stat-value {
        font-family: 'Orbitron', monospace;
        font-size: 1.5rem;
        font-weight: 900;
        color: #00ffff;
        text-shadow: 0 0 12px #00ffff;
      }

      .stat-pulse {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(
          90deg,
          transparent,
          currentColor,
          transparent
        );
        animation: statPulse 2s ease-in-out infinite;
      }

      @keyframes statPulse {
        0%,
        100% {
          opacity: 0.3;
        }
        50% {
          opacity: 1;
        }
      }

      /* Data terminal */
      .data-terminal {
        position: relative;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid rgba(0, 255, 255, 0.4);
        border-radius: 20px;
        backdrop-filter: blur(20px);
        box-shadow:
          0 20px 40px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      .terminal-header {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 1rem 2rem;
        background: rgba(0, 255, 255, 0.1);
        border-bottom: 1px solid rgba(0, 255, 255, 0.3);
        gap: 2rem;
      }

      .game-filter-section {
        display: flex;
        align-items: center;
        flex: 1;
        justify-content: flex-end;
        gap: 1rem;
      }

      .filter-label {
        font-family: 'Orbitron', monospace;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 1px;
        color: #00ffff;
        white-space: nowrap;
      }

      .game-selector {
        min-width: 200px;
        max-width: 300px;
      }

      .hidden-loader {
        display: none;
      }

      .tab {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        font-family: 'Orbitron', monospace;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 1px;
        background: rgba(0, 255, 255, 0.2);
        border: 1px solid rgba(0, 255, 255, 0.4);
        border-radius: 10px;
        color: #00ffff;
      }

      .tab-icon {
        font-size: 1rem;
      }

      .tab-indicators {
        display: flex;
        gap: 0.5rem;
      }

      .indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: rgba(0, 255, 255, 0.3);
        animation: indicatorBlink 1.5s infinite;
      }

      .indicator:nth-child(2) {
        animation-delay: 0.5s;
      }
      .indicator:nth-child(3) {
        animation-delay: 1s;
      }

      @keyframes indicatorBlink {
        0%,
        80% {
          opacity: 0.3;
        }
        40% {
          opacity: 1;
        }
      }

      .terminal-content {
        position: relative;
        padding: 2rem;
        max-height: 500px;
        overflow-y: auto;
        --embedded-card-min-height: auto;
      }

      .scan-line {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, transparent, #00ffff, transparent);
        animation: scanMove 3s linear infinite;
        z-index: 1;
      }

      @keyframes scanMove {
        0% {
          transform: translateY(0);
          opacity: 1;
        }
        100% {
          transform: translateY(400px);
          opacity: 0;
        }
      }

      /* Responsive design */
      @container (max-width: 768px) {
        .dashboard-arena {
          padding: 1rem;
        }

        .title-arena {
          flex-direction: column;
          gap: 0.75rem;
          padding: 1rem;
        }

        .stats-grid {
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
        }

        .main-title {
          font-size: 2rem;
        }

        .terminal-content {
          padding: 1rem;
        }
      }

      @container (max-width: 480px) {
        .stats-grid {
          grid-template-columns: 1fr 1fr;
        }

        .main-title {
          font-size: 1.5rem;
          letter-spacing: 1px;
        }

        .title-arena {
          padding: 1rem;
        }
      }
    </style>
  </template>
}

export class GameRecordsBoard extends CardDef {
  static displayName = 'Game Records Board';
  static icon = GamepadIcon;

  @field title = contains(StringField, {
    computeVia: function (this: GameRecordsBoard) {
      return 'Game Records Board';
    },
  });

  static isolated = IsolatedTemplate;
}
