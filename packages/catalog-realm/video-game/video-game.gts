import {
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';

import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import UrlField from 'https://cardstack.com/base/url';
import MarkdownField from 'https://cardstack.com/base/markdown';

import { Game } from '../base-entity/game';

import { formatDateTime, formatCurrency } from '@cardstack/boxel-ui/helpers';

import GamepadIcon from '@cardstack/boxel-icons/gamepad-2';

export class VideoGame extends Game {
  static displayName = 'Video Game';
  static icon = GamepadIcon;

  @field platform = contains(StringField);
  @field releaseDate = contains(DateField);
  @field coverImageUrl = contains(UrlField);
  @field price = contains(NumberField);
  @field metacriticScore = contains(NumberField);
  @field userRating = contains(NumberField);
  @field isMultiplayer = contains(BooleanField);
  @field estimatedHours = contains(NumberField);
  @field achievements = contains(NumberField);
  @field systemRequirements = contains(MarkdownField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='stage'>
        <article class='game-detail-mat'>
          <header class='game-header'>
            <div class='cover-showcase'>
              {{#if @model.coverImageUrl}}
                <img
                  src={{@model.coverImageUrl}}
                  alt='{{@model.title}} cover'
                  class='cover-image'
                />
              {{else}}
                <div class='cover-placeholder'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                    <circle cx='9' cy='9' r='2' />
                    <path d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
                  </svg>
                  <div class='placeholder-text'>No Cover Available</div>
                </div>
              {{/if}}

              {{#if @model.price}}
                <div class='price-tag'>
                  {{formatCurrency @model.price currency='USD'}}
                </div>
              {{/if}}
            </div>

            <div class='game-info'>
              <h1 class='game-title'>{{if
                  @model.title
                  @model.title
                  'Untitled Game'
                }}</h1>

              <div class='game-meta-row'>
                {{#if @model.platform}}
                  <span class='platform-badge'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <rect x='2' y='3' width='20' height='14' rx='2' ry='2' />
                      <line x1='8' y1='21' x2='16' y2='21' />
                      <line x1='12' y1='17' x2='12' y2='21' />
                    </svg>
                    {{@model.platform}}
                  </span>
                {{/if}}

                {{#if @model.genre}}
                  <span class='genre-badge'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <polygon points='12 2 2 7 12 12 22 7 12 2' />
                      <polyline points='2,17 12,22 22,17' />
                      <polyline points='2,12 12,17 22,12' />
                    </svg>
                    {{@model.genre}}
                  </span>
                {{/if}}

                {{#if @model.releaseDate}}
                  <span class='release-badge'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
                      <line x1='16' y1='2' x2='16' y2='6' />
                      <line x1='8' y1='2' x2='8' y2='6' />
                      <line x1='3' y1='10' x2='21' y2='10' />
                    </svg>
                    {{formatDateTime @model.releaseDate size='short'}}
                  </span>
                {{/if}}
              </div>

              <div class='ratings-showcase'>
                {{#if @model.metacriticScore}}
                  <div class='rating-item metacritic'>
                    <div class='rating-label'>Metacritic</div>
                    <div
                      class='rating-score metacritic-score'
                    >{{@model.metacriticScore}}</div>
                  </div>
                {{/if}}

                {{#if @model.userRating}}
                  <div class='rating-item user'>
                    <div class='rating-label'>User Rating</div>
                    <div class='rating-score user-score'>
                      <span class='stars'>⭐</span>
                      {{@model.userRating}}/10
                    </div>
                  </div>
                {{/if}}

                {{#if @model.estimatedHours}}
                  <div class='rating-item hours'>
                    <div class='rating-label'>Playtime</div>
                    <div class='rating-score hours-score'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <circle cx='12' cy='12' r='10' />
                        <polyline points='12,6 12,12 16,14' />
                      </svg>
                      {{@model.estimatedHours}}h
                    </div>
                  </div>
                {{/if}}
              </div>

              {{#if @model.isMultiplayer}}
                <div class='multiplayer-badge'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
                    <circle cx='9' cy='7' r='4' />
                    <path d='M23 21v-2a4 4 0 0 0-3-3.87' />
                    <path d='M16 3.13a4 4 0 0 1 0 7.75' />
                  </svg>
                  Multiplayer Supported
                </div>
              {{/if}}
            </div>
          </header>

          {{#if @model.description}}
            <section class='game-description'>
              <h2>About this Game</h2>
              <div class='description-content'>
                <@fields.description />
              </div>
            </section>
          {{/if}}

          {{#if @model.systemRequirements}}
            <section class='system-requirements'>
              <h2>System Requirements</h2>
              <div class='requirements-content'>
                <@fields.systemRequirements />
              </div>
            </section>
          {{/if}}

          {{#if @model.achievements}}
            <section class='achievements-info'>
              <div class='achievement-count'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M6 9H4.5a2.5 2.5 0 0 1 0-5H6' />
                  <path d='M18 9h1.5a2.5 2.5 0 0 0 0-5H18' />
                  <path d='M4 22h16' />
                  <path
                    d='M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22'
                  />
                  <path
                    d='M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22'
                  />
                  <path d='M18 2H6v7a6 6 0 0 0 12 0V2Z' />
                </svg>
                <span>{{@model.achievements}} Achievements Available</span>
              </div>
            </section>
          {{/if}}
        </article>
      </div>

      <style scoped>
        .stage {
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          padding: 0.5rem;
          background: linear-gradient(
            135deg,
            #0f0f23 0%,
            #1a1a2e 50%,
            #16213e 100%
          );
          overflow: hidden;
        }

        .game-detail-mat {
          max-width: 50rem;
          width: 100%;
          padding: 2rem;
          overflow-y: auto;
          max-height: 100%;
          background: rgba(15, 23, 42, 0.95);
          backdrop-filter: blur(20px);
          border-radius: 20px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          font-family: 'Inter', system-ui, sans-serif;
          box-shadow:
            0 0 50px rgba(99, 102, 241, 0.1),
            0 20px 40px rgba(0, 0, 0, 0.3);
        }

        .game-header {
          display: grid;
          grid-template-columns: 240px 1fr;
          gap: 2rem;
          margin-bottom: 2rem;
          padding: 1.5rem;
          background: rgba(30, 41, 59, 0.6);
          border-radius: 16px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          backdrop-filter: blur(10px);
        }

        @media (max-width: 768px) {
          .game-header {
            grid-template-columns: 1fr;
            gap: 1.5rem;
            text-align: center;
          }

          .stage {
            padding: 0;
          }

          .game-detail-mat {
            padding: 1.5rem;
            border-radius: 0;
          }
        }

        .cover-showcase {
          position: relative;
        }

        .cover-image {
          width: 100%;
          height: 320px;
          object-fit: cover;
          border-radius: 12px;
          border: 2px solid rgba(99, 102, 241, 0.3);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          filter: drop-shadow(0 0 20px rgba(99, 102, 241, 0.3));
        }

        .cover-placeholder {
          width: 100%;
          height: 320px;
          background: linear-gradient(
            135deg,
            rgba(30, 41, 59, 0.8),
            rgba(99, 102, 241, 0.1)
          );
          border-radius: 12px;
          border: 2px dashed rgba(99, 102, 241, 0.4);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #a5b4fc;
          position: relative;
          overflow: hidden;
        }

        .cover-placeholder::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            45deg,
            transparent 25%,
            rgba(99, 102, 241, 0.1) 50%,
            transparent 75%
          );
          animation: shimmer 3s infinite;
        }

        .cover-placeholder svg {
          width: 64px;
          height: 64px;
          margin-bottom: 1rem;
          z-index: 1;
          position: relative;
        }

        .placeholder-text {
          font-size: 0.875rem;
          font-weight: 500;
          opacity: 0.8;
          z-index: 1;
          position: relative;
        }

        .price-tag {
          position: absolute;
          top: 1rem;
          right: 1rem;
          padding: 0.5rem 1rem;
          background: linear-gradient(135deg, #f59e0b, #d97706);
          color: white;
          border-radius: 8px;
          font-weight: 700;
          font-size: 1rem;
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .game-info {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .game-title {
          font-size: 2.25rem;
          font-weight: 800;
          margin: 0;
          background: linear-gradient(135deg, #ffffff, #6366f1, #a855f7);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          font-family: 'Orbitron', monospace;
          line-height: 1.1;
        }

        .game-meta-row {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .platform-badge,
        .genre-badge,
        .release-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          border-radius: 12px;
          font-size: 0.875rem;
          font-weight: 600;
          backdrop-filter: blur(10px);
          border: 1px solid;
          transition: all 0.3s ease;
        }

        .platform-badge {
          background: rgba(6, 182, 212, 0.1);
          color: #06b6d4;
          border-color: rgba(6, 182, 212, 0.3);
        }

        .genre-badge {
          background: rgba(168, 85, 247, 0.1);
          color: #a855f7;
          border-color: rgba(168, 85, 247, 0.3);
        }

        .release-badge {
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.3);
        }

        .platform-badge svg,
        .genre-badge svg,
        .release-badge svg {
          width: 16px;
          height: 16px;
        }

        .ratings-showcase {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 1rem;
        }

        .rating-item {
          padding: 1rem;
          background: rgba(30, 41, 59, 0.6);
          border-radius: 12px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          text-align: center;
          backdrop-filter: blur(10px);
          transition: all 0.3s ease;
        }

        .rating-item:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(99, 102, 241, 0.2);
        }

        .rating-label {
          font-size: 0.75rem;
          color: #94a3b8;
          margin-bottom: 0.5rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .rating-score {
          font-size: 1.25rem;
          font-weight: 700;
          font-family: 'Orbitron', monospace;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
        }

        .metacritic-score {
          color: #22c55e;
        }

        .user-score {
          color: #f59e0b;
        }

        .hours-score {
          color: #06b6d4;
        }

        .hours-score svg {
          width: 16px;
          height: 16px;
        }

        .multiplayer-badge {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem;
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
          border: 1px solid rgba(34, 197, 94, 0.3);
          border-radius: 12px;
          font-weight: 600;
          backdrop-filter: blur(10px);
        }

        .multiplayer-badge svg {
          width: 20px;
          height: 20px;
        }

        .game-description,
        .system-requirements,
        .achievements-info {
          background: rgba(30, 41, 59, 0.4);
          padding: 1.5rem;
          border-radius: 16px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          margin-bottom: 1.5rem;
          backdrop-filter: blur(10px);
        }

        .game-description h2,
        .system-requirements h2 {
          font-size: 1.25rem;
          font-weight: 700;
          margin: 0 0 1rem 0;
          color: #e2e8f0;
          font-family: 'Orbitron', monospace;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .description-content,
        .requirements-content {
          color: #cbd5e1;
          line-height: 1.6;
          font-size: 0.875rem;
        }

        .achievement-count {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: #f59e0b;
          font-weight: 600;
          font-size: 1rem;
        }

        .achievement-count svg {
          width: 24px;
          height: 24px;
        }

        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='game-card-compact'>
        <div class='game-cover-compact'>
          {{#if @model.coverImageUrl}}
            <img
              src={{@model.coverImageUrl}}
              alt='{{@model.title}} cover'
              class='cover-img'
            />
          {{else}}
            <div class='cover-placeholder'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <circle cx='9' cy='9' r='2' />
                <path d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
              </svg>
            </div>
          {{/if}}

          {{#if @model.price}}
            <div class='price-tag'>{{formatCurrency
                @model.price
                currency='USD'
                size='tiny'
              }}</div>
          {{/if}}
        </div>

        <div class='game-content'>
          <div class='game-title-section'>
            <h4 class='game-name'>{{if
                @model.title
                @model.title
                'Untitled Game'
              }}</h4>
            <div class='game-badges'>
              {{#if @model.platform}}
                <span class='platform-tag'>{{@model.platform}}</span>
              {{/if}}
              {{#if @model.genre}}
                <span class='genre-tag'>{{@model.genre}}</span>
              {{/if}}
            </div>
          </div>

          <div class='game-metrics'>
            {{#if @model.userRating}}
              <div class='metric rating'>
                <span class='metric-icon'>⭐</span>
                <span class='metric-value'>{{@model.userRating}}/10</span>
              </div>
            {{/if}}

            {{#if @model.metacriticScore}}
              <div class='metric metacritic'>
                <span class='metric-label'>MC</span>
                <span class='metric-value'>{{@model.metacriticScore}}</span>
              </div>
            {{/if}}

            {{#if @model.estimatedHours}}
              <div class='metric playtime'>
                <span class='metric-icon'>🕐</span>
                <span class='metric-value'>{{@model.estimatedHours}}h</span>
              </div>
            {{/if}}

            {{#if @model.isMultiplayer}}
              <div class='metric multiplayer'>
                <span class='metric-icon'>👥</span>
                <span class='metric-label'>MP</span>
              </div>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .game-card-compact {
          background: linear-gradient(
            135deg,
            rgba(15, 23, 42, 0.95),
            rgba(30, 41, 59, 0.9)
          );
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 12px;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          backdrop-filter: blur(10px);
          box-shadow:
            0 4px 16px rgba(0, 0, 0, 0.2),
            0 0 0 1px rgba(99, 102, 241, 0.05);
          display: flex;
          gap: 0.875rem;
          padding: 0.875rem;
          align-items: flex-start;
        }

        .game-card-compact:hover {
          transform: translateY(-1px);
          border-color: rgba(99, 102, 241, 0.4);
          box-shadow:
            0 8px 25px rgba(0, 0, 0, 0.15),
            0 0 20px rgba(99, 102, 241, 0.15);
        }

        .game-card-compact::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent,
            #6366f1,
            #a855f7,
            transparent
          );
          opacity: 0.6;
        }

        .game-cover-compact {
          position: relative;
          flex-shrink: 0;
          width: 64px;
          height: 80px;
        }

        .cover-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 6px;
          border: 1px solid rgba(99, 102, 241, 0.3);
        }

        .cover-placeholder {
          width: 100%;
          height: 100%;
          background: linear-gradient(
            135deg,
            rgba(30, 41, 59, 0.8),
            rgba(99, 102, 241, 0.2)
          );
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #a5b4fc;
        }

        .cover-placeholder svg {
          width: 24px;
          height: 24px;
        }

        .price-tag {
          position: absolute;
          top: -2px;
          right: -2px;
          padding: 0.125rem 0.375rem;
          background: linear-gradient(135deg, #f59e0b, #d97706);
          color: white;
          border-radius: 4px;
          font-weight: 600;
          font-size: 0.625rem;
          line-height: 1;
          box-shadow: 0 2px 6px rgba(245, 158, 11, 0.4);
        }

        .game-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .game-title-section {
          margin-bottom: 0.375rem;
        }

        .game-name {
          font-size: 0.9375rem;
          font-weight: 700;
          margin: 0 0 0.375rem 0;
          color: #e2e8f0;
          line-height: 1.3;
          font-family: 'Orbitron', monospace;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }

        .game-badges {
          display: flex;
          gap: 0.375rem;
          flex-wrap: wrap;
        }

        .platform-tag,
        .genre-tag {
          padding: 0.1875rem 0.5rem;
          border-radius: 10px;
          font-size: 0.6875rem;
          font-weight: 600;
          border: 1px solid;
        }

        .platform-tag {
          background: rgba(6, 182, 212, 0.15);
          color: #67e8f9;
          border-color: rgba(6, 182, 212, 0.4);
        }

        .genre-tag {
          background: rgba(168, 85, 247, 0.15);
          color: #c084fc;
          border-color: rgba(168, 85, 247, 0.4);
        }

        .game-metrics {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          align-items: center;
        }

        .metric {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.25rem 0.5rem;
          border-radius: 8px;
          backdrop-filter: blur(5px);
        }

        .metric.rating {
          color: #f59e0b;
          background: rgba(245, 158, 11, 0.1);
        }

        .metric.metacritic {
          color: #22c55e;
          background: rgba(34, 197, 94, 0.1);
        }

        .metric.playtime {
          color: #06b6d4;
          background: rgba(6, 182, 212, 0.1);
        }

        .metric.multiplayer {
          color: #10b981;
          background: rgba(16, 185, 129, 0.1);
        }

        .metric-icon {
          font-size: 0.75rem;
          line-height: 1;
        }

        .metric-value,
        .metric-label {
          font-family: 'Orbitron', monospace;
          line-height: 1;
        }

        @media (max-width: 480px) {
          .game-card-compact {
            flex-direction: column;
            text-align: center;
            gap: 0.75rem;
            padding: 0.75rem;
          }

          .game-cover-compact {
            width: 48px;
            height: 60px;
            align-self: center;
          }

          .game-metrics {
            justify-content: center;
          }
        }
      </style>
    </template>
  };
}
