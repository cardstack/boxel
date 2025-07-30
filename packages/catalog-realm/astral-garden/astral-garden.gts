import { fn } from '@ember/helper';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DateField from 'https://cardstack.com/base/date';
import { Button } from '@cardstack/boxel-ui/components';
import { formatDateTime, eq } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import SparklesIcon from '@cardstack/boxel-icons/sparkles';

class IsolatedTemplate extends Component<typeof AstralGardens> {
  @tracked activeSection = 'luminous-grove';
  @tracked isAnimating = false;

  get experienceSections() {
    return [
      {
        id: 'luminous-grove',
        name: 'The Luminous Grove',
        description:
          'Bioluminescent trees from Andromeda create shifting patterns of light',
        duration: '20 minutes',
        color: '#10B981',
      },
      {
        id: 'crystal-meadows',
        name: 'Crystal Meadows',
        description:
          'Singing crystals harmonize with ethereal flora under twin moons',
        duration: '15 minutes',
        color: '#8B5CF6',
      },
      {
        id: 'nebula-sanctuary',
        name: 'The Nebula Sanctuary',
        description:
          'Zero-gravity gardens where cosmic winds shape living sculptures',
        duration: '25 minutes',
        color: '#F59E0B',
      },
      {
        id: 'stellar-pavilion',
        name: 'Stellar Pavilion',
        description:
          'Interactive constellation mapping with plant-based star charts',
        duration: '30 minutes',
        color: '#F472B6',
      },
    ];
  }

  get currentSection() {
    return this.experienceSections.find(
      (section) => section.id === this.activeSection,
    );
  }

  @action
  selectSection(sectionId: string) {
    if (this.isAnimating) return;

    this.isAnimating = true;
    setTimeout(() => {
      this.activeSection = sectionId;
      this.isAnimating = false;
    }, 300);
  }

  <template>
    <div class='kaleidoscope-stage'>
      <article class='astral-gardens-mat'>
        <header class='hero-section'>
          <div class='ornate-frame'>
            <div class='frame-corner top-left'></div>
            <div class='frame-corner top-right'></div>
            <div class='frame-corner bottom-left'></div>
            <div class='frame-corner bottom-right'></div>

            <div class='hero-content'>
              <h1 class='installation-title'>
                {{@model.installationName}}
              </h1>
              <p class='tagline'>
                {{@model.tagline}}
              </p>

              <div class='marquee-container'>
                <div class='marquee-text'>
                  {{#if @model.nextShowingDate}}
                    ⭐ Next Experience:
                    {{formatDateTime @model.nextShowingDate size='medium'}}
                  {{/if}}
                  {{#if @model.ticketPrice}}
                    • Admission:
                    {{@model.ticketPrice}}
                  {{/if}}
                  {{#if @model.location}}
                    • Location:
                    {{@model.location}}
                  {{/if}}
                  ⭐ Limited Capacity • Advanced Booking Required ⭐
                </div>
              </div>

              <Button
                class='cta-button'
                @variant='primary'
                {{on 'click' (fn this.selectSection 'luminous-grove')}}
              >
                Begin Your Journey
              </Button>
            </div>
          </div>
        </header>

        <section class='experience-nav'>
          <h2 class='nav-title'>Choose Your Path</h2>
          <div class='nav-grid'>
            {{#each this.experienceSections as |section|}}
              <button
                class='nav-tile
                  {{if (eq section.id this.activeSection) "active" ""}}'
                style={{htmlSafe (concat '--tile-color: ' section.color)}}
                type='button'
                {{on 'click' (fn this.selectSection section.id)}}
              >
                <div class='tile-frame'>
                  <span class='tile-title'>{{section.name}}</span>
                  <p class='tile-description'>{{section.description}}</p>
                  <span class='tile-duration'>{{section.duration}}</span>
                </div>
              </button>
            {{/each}}
          </div>
        </section>

        {{#if this.currentSection}}
          <section
            class='featured-experience
              {{if this.isAnimating "transitioning" ""}}'
          >
            <div
              class='experience-frame'
              style={{htmlSafe
                (concat '--accent-color: ' this.currentSection.color)
              }}
            >
              <h2 class='experience-title'>{{this.currentSection.name}}</h2>
              <p
                class='experience-detail'
              >{{this.currentSection.description}}</p>

              {{#if @model.description}}
                <div class='experience-description'>
                  <@fields.description />
                </div>
              {{/if}}

              <div class='experience-details'>
                <div class='detail-item'>
                  <span class='detail-label'>Duration:</span>
                  <span class='detail-value'>
                    {{@model.experienceDuration}}
                  </span>
                </div>

                {{#if @model.nextShowingDate}}
                  <div class='detail-item'>
                    <span class='detail-label'>Next Experience:</span>
                    <span class='detail-value'>{{formatDateTime
                        @model.nextShowingDate
                        size='long'
                      }}</span>
                  </div>
                {{/if}}

                {{#if @model.location}}
                  <div class='detail-item'>
                    <span class='detail-label'>Location:</span>
                    <span class='detail-value'>{{@model.location}}</span>
                  </div>
                {{/if}}
              </div>
            </div>
          </section>
        {{/if}}

        <footer class='footer-section'>
          <div class='contact-frame'>
            <h3 class='contact-title'>Reserve Your Journey</h3>
            <p class='contact-description'>Limited capacity ensures an intimate
              experience with the cosmos</p>

            <div class='contact-actions'>
              <Button class='contact-button primary'>Book Experience</Button>
              <Button class='contact-button secondary'>Private Events</Button>
              <Button class='contact-button tertiary'>Learn More</Button>
            </div>
          </div>
        </footer>
      </article>
    </div>

    <style scoped>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Montserrat:wght@300;400;500;600&display=swap');

      .kaleidoscope-stage {
        --midnight-navy: #0a0b1a;
        --electric-purple: #8b5cf6;
        --golden-amber: #f59e0b;
        --emerald-green: #10b981;
        --rose-gold: #f472b6;
        --neon-glow:
          0 0 20px currentColor, 0 0 40px currentColor, 0 0 60px currentColor;

        width: 100%;
        height: auto;
        background: var(--midnight-navy);
        background-image:
          radial-gradient(
            circle at 25% 25%,
            var(--electric-purple) 0%,
            transparent 25%
          ),
          radial-gradient(
            circle at 75% 75%,
            var(--emerald-green) 0%,
            transparent 25%
          ),
          radial-gradient(
            circle at 50% 50%,
            var(--golden-amber) 0%,
            transparent 50%
          );
        background-size:
          200% 200%,
          150% 150%,
          300% 300%;
        animation: kaleidoscope-bg 20s ease-in-out infinite;
        position: relative;
      }

      @keyframes kaleidoscope-bg {
        0%,
        100% {
          background-position:
            0% 0%,
            100% 100%,
            50% 50%;
        }
        33% {
          background-position:
            100% 0%,
            0% 100%,
            25% 75%;
        }
        66% {
          background-position:
            0% 100%,
            100% 0%,
            75% 25%;
        }
      }

      .astral-gardens-mat {
        max-width: 1200px;
        margin: 0 auto;
        padding: 3rem 2rem;
        font-family: 'Montserrat', sans-serif;
        color: white;
        position: relative;
      }

      .hero-section {
        margin-bottom: 4rem;
        position: relative;
      }

      .ornate-frame {
        position: relative;
        padding: 3rem;
        border: 3px solid var(--golden-amber);
        background: linear-gradient(
          135deg,
          rgba(139, 92, 246, 0.2) 0%,
          rgba(16, 185, 129, 0.1) 50%,
          rgba(245, 158, 11, 0.2) 100%
        );
        backdrop-filter: blur(10px);
        border-radius: 20px;
      }

      .frame-corner {
        position: absolute;
        width: 40px;
        height: 40px;
        border: 2px solid var(--golden-amber);
        background: var(--midnight-navy);
      }

      .frame-corner::before,
      .frame-corner::after {
        content: '';
        position: absolute;
        width: 20px;
        height: 20px;
        border: 1px solid var(--golden-amber);
      }

      .top-left {
        top: -20px;
        left: -20px;
        border-bottom-right-radius: 10px;
      }

      .top-left::before {
        top: -10px;
        left: -10px;
        border-bottom-right-radius: 5px;
      }

      .top-right {
        top: -20px;
        right: -20px;
        border-bottom-left-radius: 10px;
      }

      .top-right::before {
        top: -10px;
        right: -10px;
        border-bottom-left-radius: 5px;
      }

      .bottom-left {
        bottom: -20px;
        left: -20px;
        border-top-right-radius: 10px;
      }

      .bottom-left::before {
        bottom: -10px;
        left: -10px;
        border-top-right-radius: 5px;
      }

      .bottom-right {
        bottom: -20px;
        right: -20px;
        border-top-left-radius: 10px;
      }

      .bottom-right::before {
        bottom: -10px;
        right: -10px;
        border-top-left-radius: 5px;
      }

      .hero-content {
        text-align: center;
        position: relative;
      }

      .installation-title {
        font-family: 'Playfair Display', serif;
        font-size: 4rem;
        font-weight: 700;
        line-height: 1.1;
        margin-bottom: 1rem;
        background: linear-gradient(
          45deg,
          var(--golden-amber),
          var(--electric-purple),
          var(--emerald-green)
        );
        background-size: 300% 300%;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: neon-text 3s ease-in-out infinite;
        text-shadow: var(--neon-glow);
      }

      @keyframes neon-text {
        0%,
        100% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
      }

      .tagline {
        font-size: 1.5rem;
        font-weight: 300;
        margin-bottom: 2rem;
        color: var(--rose-gold);
        font-style: italic;
      }

      .marquee-container {
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(139, 92, 246, 0.3) 25%,
          rgba(139, 92, 246, 0.3) 75%,
          transparent 100%
        );
        border: 1px solid var(--electric-purple);
        border-radius: 25px;
        padding: 0.75rem 0;
        margin: 2rem 0;
        overflow: hidden;
        position: relative;
      }

      .marquee-text {
        display: inline-block;
        white-space: nowrap;
        animation: marquee 30s linear infinite;
        font-size: 1.125rem;
        color: var(--golden-amber);
        font-weight: 500;
      }

      @keyframes marquee {
        from {
          transform: translateX(100%);
        }
        to {
          transform: translateX(-100%);
        }
      }

      .cta-button {
        background: linear-gradient(
          135deg,
          var(--electric-purple),
          var(--rose-gold)
        );
        border: 2px solid var(--golden-amber);
        color: white;
        font-family: 'Montserrat', sans-serif;
        font-weight: 600;
        font-size: 1.25rem;
        padding: 1rem 2.5rem;
        border-radius: 50px;
        cursor: pointer;
        transition: all 0.3s ease;
        text-transform: uppercase;
        letter-spacing: 1px;
        box-shadow: var(--neon-glow);
        position: relative;
        overflow: hidden;
      }

      .cta-button::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, white, transparent);
        opacity: 0.3;
        animation: shimmer 2s infinite;
      }

      @keyframes shimmer {
        0% {
          left: -100%;
        }
        100% {
          left: 100%;
        }
      }

      .cta-button:hover {
        transform: scale(1.05);
        box-shadow:
          0 0 30px var(--electric-purple),
          0 0 60px var(--rose-gold);
      }

      .experience-nav {
        margin-bottom: 3rem;
      }

      .nav-title {
        font-family: 'Playfair Display', serif;
        font-size: 2.5rem;
        text-align: center;
        color: var(--golden-amber);
        margin-bottom: 2rem;
        text-shadow: 0 0 20px currentColor;
      }

      .nav-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
      }

      .nav-tile {
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.1) 0%,
          transparent 50%
        );
        border: 2px solid var(--tile-color, var(--electric-purple));
        border-radius: 15px;
        padding: 1.5rem;
        cursor: pointer;
        transition: all 0.4s ease;
        position: relative;
        overflow: hidden;
      }

      .nav-tile::before {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: conic-gradient(
          from 0deg at 50% 50%,
          transparent,
          var(--tile-color),
          transparent
        );
        opacity: 0;
        animation: rotate-border 3s linear infinite;
      }

      @keyframes rotate-border {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .nav-tile:hover::before,
      .nav-tile.active::before {
        opacity: 0.3;
      }

      .nav-tile:hover,
      .nav-tile.active {
        transform: translateY(-5px) scale(1.02);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        border-color: var(--golden-amber);
      }

      .tile-frame {
        position: relative;
      }

      .tile-title {
        font-family: 'Playfair Display', serif;
        font-size: 1.5rem;
        color: var(--tile-color);
        margin-bottom: 0.5rem;
      }

      .tile-description {
        font-size: 0.875rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 1rem;
      }

      .tile-duration {
        display: inline-block;
        background: var(--tile-color);
        color: var(--midnight-navy);
        padding: 0.25rem 0.75rem;
        border-radius: 15px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .featured-experience {
        margin-bottom: 3rem;
        transition: opacity 0.3s ease;
      }

      .featured-experience.transitioning {
        opacity: 0.7;
      }

      .experience-frame {
        border: 3px solid var(--accent-color);
        border-radius: 20px;
        padding: 2.5rem;
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.1) 0%,
          rgba(255, 255, 255, 0.05) 100%
        );
        backdrop-filter: blur(10px);
        position: relative;
      }

      .experience-frame::before {
        content: '';
        position: absolute;
        top: -2px;
        left: -2px;
        right: -2px;
        bottom: -2px;
        background: linear-gradient(
          45deg,
          var(--accent-color),
          var(--golden-amber),
          var(--accent-color)
        );
        border-radius: 20px;
        z-index: -1;
        animation: border-glow 2s ease-in-out infinite alternate;
      }

      @keyframes border-glow {
        from {
          opacity: 0.5;
        }
        to {
          opacity: 1;
        }
      }

      .experience-title {
        font-family: 'Playfair Display', serif;
        font-size: 2.5rem;
        color: var(--accent-color);
        margin-bottom: 1rem;
        text-shadow: 0 0 15px currentColor;
      }

      .experience-detail {
        font-size: 1.25rem;
        color: rgba(255, 255, 255, 0.9);
        margin-bottom: 1.5rem;
        font-style: italic;
      }

      .experience-description {
        font-size: 1rem;
        line-height: 1.6;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 2rem;
      }

      .experience-details {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 1rem;
      }

      .detail-item {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid var(--accent-color);
        border-radius: 10px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .detail-label {
        font-size: 0.875rem;
        color: var(--accent-color);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .detail-value {
        font-size: 1rem;
        color: white;
        font-weight: 500;
      }

      .footer-section {
        margin-top: 4rem;
        text-align: center;
      }

      .contact-frame {
        border: 2px solid var(--golden-amber);
        border-radius: 20px;
        padding: 3rem 2rem;
        background: linear-gradient(
          135deg,
          rgba(139, 92, 246, 0.2) 0%,
          rgba(245, 158, 11, 0.1) 100%
        );
        backdrop-filter: blur(15px);
      }

      .contact-title {
        font-family: 'Playfair Display', serif;
        font-size: 2rem;
        color: var(--golden-amber);
        margin-bottom: 1rem;
      }

      .contact-description {
        font-size: 1.125rem;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 2rem;
      }

      .contact-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        justify-content: center;
      }

      .contact-button {
        font-family: 'Montserrat', sans-serif;
        font-weight: 600;
        padding: 0.875rem 2rem;
        border-radius: 25px;
        cursor: pointer;
        transition: all 0.3s ease;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border: 2px solid;
      }

      .contact-button.primary {
        background: linear-gradient(
          135deg,
          var(--electric-purple),
          var(--rose-gold)
        );
        color: white;
        border-color: var(--golden-amber);
        box-shadow: 0 5px 15px rgba(139, 92, 246, 0.4);
      }

      .contact-button.secondary {
        background: transparent;
        color: var(--emerald-green);
        border-color: var(--emerald-green);
      }

      .contact-button.tertiary {
        background: transparent;
        color: var(--golden-amber);
        border-color: var(--golden-amber);
      }

      .contact-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
      }

      .contact-button.primary:hover {
        box-shadow: 0 8px 25px rgba(139, 92, 246, 0.6);
      }

      @media (max-width: 768px) {
        .astral-gardens-mat {
          padding: 2rem 1rem;
        }

        .installation-title {
          font-size: 2.5rem;
        }

        .tagline {
          font-size: 1.25rem;
        }

        .ornate-frame {
          padding: 2rem 1.5rem;
        }

        .nav-grid {
          grid-template-columns: 1fr;
        }

        .contact-actions {
          flex-direction: column;
          align-items: center;
        }
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof AstralGardens> {
  <template>
    <div class='astral-gardens-embedded'>
      <div class='embedded-frame'>
        <h3 class='embedded-title'>
          {{@model.installationName}}
        </h3>
        <p class='embedded-tagline'>
          {{@model.tagline}}
        </p>

        <div class='embedded-details'>
          {{#if @model.nextShowingDate}}
            <div class='detail-chip'>
              <span class='detail-label'>Next Experience:</span>
              <span class='detail-value'>{{formatDateTime
                  @model.nextShowingDate
                  size='short'
                }}</span>
            </div>
          {{/if}}

          {{#if @model.experienceDuration}}
            <div class='detail-chip'>
              <span class='detail-label'>Duration:</span>
              <span class='detail-value'>{{@model.experienceDuration}}</span>
            </div>
          {{/if}}

          {{#if @model.ticketPrice}}
            <div class='detail-chip'>
              <span class='detail-label'>From:</span>
              <span class='detail-value'>{{@model.ticketPrice}}</span>
            </div>
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Montserrat:wght@400;500&display=swap');

      .astral-gardens-embedded {
        --midnight-navy: #0a0b1a;
        --electric-purple: #8b5cf6;
        --golden-amber: #f59e0b;
        --emerald-green: #10b981;
        --rose-gold: #f472b6;
      }

      .embedded-frame {
        background: linear-gradient(
          135deg,
          var(--midnight-navy) 0%,
          rgba(139, 92, 246, 0.2) 50%,
          rgba(245, 158, 11, 0.1) 100%
        );
        border: 2px solid var(--electric-purple);
        border-radius: 15px;
        padding: 1.5rem;
        font-family: 'Montserrat', sans-serif;
        color: white;
        position: relative;
        overflow: hidden;
      }

      .embedded-frame::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: radial-gradient(
          circle at 70% 30%,
          rgba(139, 92, 246, 0.3) 0%,
          transparent 70%
        );
        pointer-events: none;
      }

      .embedded-title {
        font-family: 'Playfair Display', serif;
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--golden-amber);
        margin-bottom: 0.5rem;
        position: relative;
      }

      .embedded-tagline {
        font-size: 0.875rem;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 1rem;
        font-style: italic;
        position: relative;
      }

      .embedded-details {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        position: relative;
      }

      .detail-chip {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid var(--emerald-green);
        border-radius: 20px;
        padding: 0.25rem 0.75rem;
        font-size: 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }

      .detail-label {
        color: var(--emerald-green);
        font-weight: 500;
      }

      .detail-value {
        color: white;
        font-weight: 400;
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof AstralGardens> {
  <template>
    <div class='astral-fitted-container'>
      <div class='badge-format'>
        <div class='badge-content'>
          <h4 class='badge-title'>
            {{@model.installationName}}
          </h4>
          {{#if @model.nextShowingDate}}
            <span class='badge-date'>{{formatDateTime
                @model.nextShowingDate
                size='tiny'
              }}</span>
          {{/if}}
        </div>
      </div>

      <div class='strip-format'>
        <div class='strip-content'>
          <div class='strip-main'>
            <h4 class='strip-title'>
              {{@model.installationName}}
            </h4>
            <p class='strip-tagline'>
              {{@model.tagline}}
            </p>
          </div>
          <div class='strip-meta'>
            {{#if @model.ticketPrice}}
              <span class='meta-price'>{{@model.ticketPrice}}</span>
            {{/if}}
            {{#if @model.nextShowingDate}}
              <span class='meta-date'>{{formatDateTime
                  @model.nextShowingDate
                  size='tiny'
                }}</span>
            {{/if}}
          </div>
        </div>
      </div>

      <div class='tile-format'>
        <div class='tile-content'>
          <div class='tile-header'>
            <h4 class='tile-title'>
              {{@model.installationName}}
            </h4>
            <p class='tile-tagline'>
              {{@model.tagline}}
            </p>
          </div>

          <div class='tile-details'>
            {{#if @model.nextShowingDate}}
              <div class='tile-detail'>
                <span class='detail-key'>Next:</span>
                <span class='detail-val'>{{formatDateTime
                    @model.nextShowingDate
                    size='short'
                  }}</span>
              </div>
            {{/if}}

            {{#if @model.experienceDuration}}
              <div class='tile-detail'>
                <span class='detail-key'>Duration:</span>
                <span class='detail-val'>{{@model.experienceDuration}}</span>
              </div>
            {{/if}}

            {{#if @model.ticketPrice}}
              <div class='tile-detail'>
                <span class='detail-key'>From:</span>
                <span class='detail-val'>{{@model.ticketPrice}}</span>
              </div>
            {{/if}}
          </div>

          {{#if @model.location}}
            <div class='tile-footer'>
              <span class='location-text'>{{@model.location}}</span>
            </div>
          {{/if}}
        </div>
      </div>

      <div class='card-format'>
        <div class='card-content'>
          <div class='card-header'>
            <h4 class='card-title'>
              {{@model.installationName}}
            </h4>
            <p class='card-subtitle'>
              {{@model.tagline}}
            </p>
          </div>

          <div class='card-body'>
            {{#if @model.description}}
              <div class='card-description'>
                <@fields.description />
              </div>
            {{/if}}
          </div>

          <div class='card-details'>
            {{#if @model.nextShowingDate}}
              <div class='card-detail'>
                <span class='detail-key'>Next Experience:</span>
                <span class='detail-val'>{{formatDateTime
                    @model.nextShowingDate
                    size='medium'
                  }}</span>
              </div>
            {{/if}}

            <div class='detail-row'>
              {{#if @model.experienceDuration}}
                <div class='card-detail compact'>
                  <span class='detail-key'>Duration:</span>
                  <span class='detail-val'>{{@model.experienceDuration}}</span>
                </div>
              {{/if}}

              {{#if @model.ticketPrice}}
                <div class='card-detail compact'>
                  <span class='detail-key'>From:</span>
                  <span class='detail-val'>{{@model.ticketPrice}}</span>
                </div>
              {{/if}}
            </div>

            {{#if @model.location}}
              <div class='card-detail'>
                <span class='detail-key'>Location:</span>
                <span class='detail-val'>{{@model.location}}</span>
              </div>
            {{/if}}
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Montserrat:wght@400;500;600&display=swap');

      .astral-fitted-container {
        container-type: size;
        width: 100%;
        height: 100%;
        font-family: 'Montserrat', sans-serif;

        --midnight-navy: #0a0b1a;
        --electric-purple: #8b5cf6;
        --golden-amber: #f59e0b;
        --emerald-green: #10b981;
        --rose-gold: #f472b6;
      }

      .badge-format,
      .strip-format,
      .tile-format,
      .card-format {
        display: none;
        width: 100%;
        height: 100%;
        padding: clamp(0.1875rem, 2%, 0.625rem);
        box-sizing: border-box;
        background: linear-gradient(
          135deg,
          var(--midnight-navy) 0%,
          rgba(139, 92, 246, 0.3) 50%,
          rgba(245, 158, 11, 0.2) 100%
        );
        border: 2px solid var(--electric-purple);
        border-radius: 12px;
        color: white;
        position: relative;
        overflow: hidden;
      }

      .badge-format::before,
      .strip-format::before,
      .tile-format::before,
      .card-format::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: radial-gradient(
          circle at 80% 20%,
          rgba(139, 92, 246, 0.4) 0%,
          transparent 60%
        );
        pointer-events: none;
        z-index: 0;
      }

      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
        }
      }

      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
        }
      }

      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
          flex-direction: column;
        }
      }

      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
          flex-direction: column;
        }
      }

      .badge-format {
        align-items: center;
        justify-content: center;
        text-align: center;
      }

      .badge-content {
        position: relative;
      }

      .badge-title {
        font-family: 'Playfair Display', serif;
        font-size: clamp(0.75rem, 3vw, 1rem);
        font-weight: 600;
        color: var(--golden-amber);
        margin: 0 0 0.25rem 0;
        line-height: 1.1;
      }

      .badge-date {
        font-size: clamp(0.625rem, 2.5vw, 0.75rem);
        color: var(--emerald-green);
        font-weight: 500;
      }

      .strip-format {
        align-items: center;
        padding-left: clamp(0.5rem, 3%, 1rem);
        padding-right: clamp(0.5rem, 3%, 1rem);
      }

      .strip-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        position: relative;
      }

      .strip-main {
        flex: 1;
        min-width: 0;
      }

      .strip-title {
        font-family: 'Playfair Display', serif;
        font-size: clamp(0.875rem, 3.5vw, 1.25rem);
        font-weight: 600;
        color: var(--golden-amber);
        margin: 0 0 0.25rem 0;
        line-height: 1.2;
      }

      .strip-tagline {
        font-size: clamp(0.625rem, 2.5vw, 0.75rem);
        color: rgba(255, 255, 255, 0.8);
        margin: 0;
        line-height: 1.3;
      }

      .strip-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.25rem;
        margin-left: 1rem;
      }

      .meta-price {
        background: var(--electric-purple);
        color: white;
        padding: 0.125rem 0.5rem;
        border-radius: 10px;
        font-size: 0.625rem;
        font-weight: 600;
      }

      .meta-date {
        font-size: 0.625rem;
        color: var(--emerald-green);
        font-weight: 500;
      }

      .tile-content {
        display: flex;
        flex-direction: column;
        height: 100%;
        position: relative;
      }

      .tile-header {
        margin-bottom: auto;
      }

      .tile-title {
        font-family: 'Playfair Display', serif;
        font-size: clamp(1rem, 4vw, 1.5rem);
        font-weight: 600;
        color: var(--golden-amber);
        margin: 0 0 0.5rem 0;
        line-height: 1.2;
      }

      .tile-tagline {
        font-size: clamp(0.75rem, 3vw, 0.875rem);
        color: rgba(255, 255, 255, 0.8);
        margin: 0 0 1rem 0;
        line-height: 1.3;
      }

      .tile-details {
        margin-bottom: auto;
      }

      .tile-detail {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.5rem;
        font-size: 0.75rem;
      }

      .detail-key {
        color: var(--emerald-green);
        font-weight: 500;
      }

      .detail-val {
        color: white;
        font-weight: 400;
      }

      .tile-footer {
        margin-top: auto;
        padding-top: 0.75rem;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
      }

      .location-text {
        font-size: 0.75rem;
        color: var(--rose-gold);
        font-weight: 500;
      }

      .card-content {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 1rem;
        position: relative;
      }

      .card-header {
        flex-shrink: 0;
      }

      .card-title {
        font-family: 'Playfair Display', serif;
        font-size: clamp(1.25rem, 4vw, 2rem);
        font-weight: 600;
        color: var(--golden-amber);
        margin: 0 0 0.5rem 0;
        line-height: 1.2;
      }

      .card-subtitle {
        font-size: clamp(0.875rem, 3vw, 1.125rem);
        color: var(--rose-gold);
        margin: 0;
        line-height: 1.3;
        font-style: italic;
      }

      .card-body {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      .card-description {
        font-size: clamp(0.75rem, 2.5vw, 0.875rem);
        color: rgba(255, 255, 255, 0.8);
        line-height: 1.4;
        margin: 0;

        display: -webkit-box;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .card-details {
        flex-shrink: 0;
        margin-top: auto;
      }

      .card-detail {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.5rem;
        font-size: clamp(0.75rem, 2.5vw, 0.875rem);
      }

      .card-detail.compact {
        font-size: 0.75rem;
      }

      .detail-row {
        display: flex;
        gap: 1rem;
      }

      .detail-row .card-detail {
        flex: 1;
        margin-bottom: 0.25rem;
      }

      @container (min-width: 400px) and (height: 170px) {
        .card-format {
          flex-direction: row;
          gap: 1rem;
        }

        .card-content > * {
          display: flex;
          flex-direction: column;
        }

        .card-content > *:first-child {
          flex: 1.618;
        }
        .card-content > *:last-child {
          flex: 1;
        }
      }

      @container (max-width: 80px) and (max-height: 80px) {
        .badge-format {
          padding: 0.1875rem;
        }
      }

      @container (max-width: 150px) {
        .badge-format,
        .strip-format {
          padding: 0.25rem;
        }
      }

      @container (min-width: 250px) and (max-width: 399px) {
        .tile-format {
          padding: 0.5rem;
        }
      }

      @container (min-width: 400px) {
        .card-format {
          padding: clamp(0.5rem, 2%, 0.625rem);
        }
      }
    </style>
  </template>
}

export class AstralGardens extends CardDef {
  static displayName = 'The Astral Gardens';
  static icon = SparklesIcon;

  @field title = contains(StringField, {
    computeVia: function (this: AstralGardens) {
      return this.installationName;
    },
  });

  @field installationName = contains(StringField);
  @field tagline = contains(StringField);
  @field description = contains(MarkdownField);
  @field experienceDuration = contains(StringField);
  @field nextShowingDate = contains(DateField);
  @field ticketPrice = contains(StringField);
  @field location = contains(StringField);

  static isolated = IsolatedTemplate;
  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}
