import {
  CardDef,
  Component,
  field,
  contains,
  getCardMeta,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import GamepadIcon from '@cardstack/boxel-icons/gamepad-2';
import { realmURL } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
import { ResolvedCodeRef, Query } from '@cardstack/runtime-common';
import PlayerPreview from './components/player-preview';

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

interface PlayerLeaderboardEntry {
  player: CardDef;
  wins: number;
  losses: number;
  draws: number;
  totalGames: number;
  rank: number;
}

class IsolatedTemplate extends Component<typeof GameLeaderboard> {
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

  // Auto-select first game when data loads
  get shouldAutoSelectFirstGame() {
    return !this.selectedGameRef && this.gameOptions.length > 0;
  }

  // Auto-select first game when options are available
  get autoSelectedGameRef() {
    if (this.shouldAutoSelectFirstGame) {
      return this.gameOptions[0];
    }
    return this.selectedGameRef;
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

  get playerLeaderboard(): PlayerLeaderboardEntry[] {
    // Early return if data is not available or still loading
    if (!this.gameRecordsData || this.gameRecordsData.isLoading) {
      return [];
    }

    // STEP 1: Determine which game results to process
    // Use auto-selected game if no game is manually selected
    const currentGameRef = this.autoSelectedGameRef;
    let results: GameResult[];

    if (currentGameRef) {
      // Filter results for the selected game type and specific game instance
      results = (this.gameRecordsData.instances ?? []).filter((gameResult) => {
        const adoptsFrom = getCardMeta(
          gameResult,
          'adoptsFrom',
        ) as ResolvedCodeRef;
        return (
          adoptsFrom?.module === currentGameRef.adoptsFrom.module &&
          adoptsFrom?.name === currentGameRef.adoptsFrom.name &&
          (gameResult as GameResult).ref.module === currentGameRef.ref.module &&
          (gameResult as GameResult).ref.name === currentGameRef.ref.name
        );
      }) as GameResult[];
    } else {
      // Use all game results if no specific game is selected
      results = (this.gameRecordsData.instances ?? []) as GameResult[];
    }

    // STEP 2: Initialize leaderboard Map for efficient player lookup
    // Key: player.id, Value: aggregated stats object
    const leaderboard = new Map<
      string,
      {
        player: CardDef;
        wins: number;
        losses: number;
        draws: number;
        totalGames: number;
      }
    >();

    // STEP 3: Process each game result and aggregate player statistics
    for (let result of results) {
      let player = result.outcome?.player;

      // Skip invalid results (no player or no player ID)
      if (!player || !player.id) {
        continue;
      }

      // Create new leaderboard entry for first-time players
      if (!leaderboard.has(player.id)) {
        leaderboard.set(player.id, {
          player,
          wins: 0,
          losses: 0,
          draws: 0,
          totalGames: 0,
        });
      }

      // Get existing player entry and increment total games
      let entry = leaderboard.get(player.id)!;
      entry.totalGames += 1;

      // Increment specific outcome counter based on game result
      switch (result.outcome?.outcome?.label) {
        case 'Win':
          entry.wins += 1;
          break;
        case 'Lose':
          entry.losses += 1;
          break;
        case 'Draw':
          entry.draws += 1;
          break;
      }
    }

    // STEP 4: Sort players by ranking algorithm and assign ranks
    return Array.from(leaderboard.values())
      .sort((a, b) => {
        // PRIMARY SORT: Most wins first (descending)
        if (b.wins !== a.wins) {
          return b.wins - a.wins;
        }

        // SECONDARY SORT: If tied on wins, most total games first (descending)
        if (b.totalGames !== a.totalGames) {
          return b.totalGames - a.totalGames;
        }

        // TERTIARY SORT: If still tied, alphabetical by player name (ascending)
        let titleA = String(a.player?.title ?? '');
        let titleB = String(b.player?.title ?? '');
        return titleA.localeCompare(titleB);
      })
      .map((entry, index) => ({
        // Convert sorted array to final leaderboard entries with ranks
        player: entry.player,
        wins: entry.wins,
        losses: entry.losses,
        draws: entry.draws,
        totalGames: entry.totalGames,
        rank: index + 1, // Convert 0-based index to 1-based rank
      }));
  }

  @action
  onGameSelect(gameTitle: string | null) {
    if (gameTitle) {
      const selectedOption = this.gameOptions.find(
        (option) => option.title === gameTitle,
      );
      this.selectedGameRef = selectedOption ?? null;
    } else {
      this.selectedGameRef = null;
    }
  }

  get selectedGameIndex() {
    const currentSelection = this.autoSelectedGameRef;
    if (!currentSelection) {
      return -1;
    }
    return this.gameOptions.findIndex(
      (option) =>
        option.title === currentSelection.title &&
        option.ref.module === currentSelection.ref.module &&
        option.ref.name === currentSelection.ref.name,
    );
  }

  get currentTime() {
    return new Date().toLocaleTimeString();
  }

  get getSelectedGameTitle() {
    return (
      this.selectedGameRef?.title || this.gameTitles[0] || 'No Games Available'
    );
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
          <GamepadIcon class='main-icon' />
          <div>
            <h1 class='main-title'>LEADERBOARD</h1>
            <p>{{this.getSelectedGameTitle}}</p>
          </div>
        </div>
      </header>

      <main class='data-terminal'>
        <div class='terminal-header'>
          <div class='game-carousel-section'>
            <div class='carousel-container'>
              {{#each this.gameOptions as |gameOption index|}}
                <button
                  class='game-option{{if
                      (eq index this.selectedGameIndex)
                      " game-option--selected"
                    }}'
                  {{on 'click' (fn this.onGameSelect gameOption.title)}}
                  type='button'
                >
                  <div class='game-option__icon'>
                    <GamepadIcon />
                  </div>
                  <span class='game-option__title'>{{gameOption.title}}</span>
                </button>
              {{/each}}
            </div>
          </div>
        </div>

        <div class='terminal-content'>
          <div class='scan-line'></div>
          {{#if this.gameRecordsData.isLoading}}
            <div class='player-leaderboard__loading'>Loading leaderboard…</div>
          {{else if this.playerLeaderboard.length}}
            <ol class='player-leaderboard'>
              {{#each this.playerLeaderboard as |entry|}}
                <li class='player-leaderboard__item'>
                  <PlayerPreview
                    @player={{entry.player}}
                    @wins={{entry.wins}}
                    @losses={{entry.losses}}
                    @draws={{entry.draws}}
                    @totalGames={{entry.totalGames}}
                    @rank={{entry.rank}}
                  />
                </li>
              {{/each}}
            </ol>
          {{else}}
            <div class='player-leaderboard__empty'>
              No players found for this selection.
            </div>
          {{/if}}
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
        gap: 1.5rem;
        padding: 1.5rem;
        position: relative;
        overflow: hidden;
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
        flex-shrink: 0;
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
        padding: 1rem 2rem;
        background: rgba(0, 255, 255, 0.1);
        border-bottom: 1px solid rgba(0, 255, 255, 0.3);
      }

      .game-carousel-section {
        width: 100%;
        overflow: hidden;
      }

      .carousel-container {
        display: flex;
        gap: 1rem;
        overflow-x: auto;
        padding: 0.5rem 0;
        scrollbar-width: thin;
        scrollbar-color: rgba(0, 255, 255, 0.5) transparent;
        scroll-snap-type: x mandatory;
      }
      .carousel-container > * {
        scroll-snap-align: start;
      }

      .carousel-container::-webkit-scrollbar {
        height: 6px;
      }

      .carousel-container::-webkit-scrollbar-track {
        background: rgba(0, 255, 255, 0.1);
        border-radius: 3px;
      }

      .carousel-container::-webkit-scrollbar-thumb {
        background: rgba(0, 255, 255, 0.5);
        border-radius: 3px;
      }

      .carousel-container::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 255, 255, 0.7);
      }

      .game-option {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem 1.5rem;
        background: rgba(0, 0, 0, 0.4);
        border: 1px solid rgba(0, 255, 255, 0.3);
        border-radius: 12px;
        color: #00ffff;
        cursor: pointer;
        transition: all 0.3s ease;
        min-width: 120px;
        flex-shrink: 0;
        backdrop-filter: blur(10px);
      }

      .game-option:hover {
        background: rgba(0, 255, 255, 0.1);
        border-color: rgba(0, 255, 255, 0.6);
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0, 255, 255, 0.2);
      }

      .game-option--selected {
        background: rgba(0, 255, 255, 0.4) !important;
        border-color: #00ffff !important;
        box-shadow: 0 0 20px rgba(0, 255, 255, 0.6) !important;
        transform: translateY(-2px);
      }

      .game-option__icon {
        width: 24px;
        height: 24px;
        color: #00ffff;
        filter: drop-shadow(0 0 8px #00ffff);
      }

      .game-option--selected .game-option__icon {
        filter: drop-shadow(0 0 12px #00ffff);
        animation: iconPulse 2s ease-in-out infinite;
      }

      .game-option__title {
        font-family: 'Orbitron', monospace;
        font-size: 0.75rem;
        font-weight: 600;
        text-align: center;
        letter-spacing: 1px;
        color: #ffffff;
        text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
      }

      .game-option--selected .game-option__title {
        color: #00ffff;
        text-shadow: 0 0 12px rgba(0, 255, 255, 0.8);
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

      .player-leaderboard {
        position: relative;
        z-index: 0;
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp);
      }

      .player-leaderboard__item {
        display: block;
      }

      .player-leaderboard__loading,
      .player-leaderboard__empty {
        position: relative;
        z-index: 0;
        font: 600 var(--boxel-font-sm);
        color: #00ffff;
        text-align: center;
        padding: var(--boxel-sp-lg) 0;
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
          padding: 1rem;
        }

        .main-title {
          font-size: 2rem;
        }

        .terminal-content {
          padding: 1rem;
        }
      }

      @container (max-width: 480px) {
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

export class GameLeaderboard extends CardDef {
  static displayName = 'Game Leaderboard';
  static icon = GamepadIcon;

  @field title = contains(StringField, {
    computeVia: function (this: GameLeaderboard) {
      return 'Game Leaderboard';
    },
  });

  static isolated = IsolatedTemplate;
}
