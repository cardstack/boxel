import { LinkTo } from '@ember/routing';
import { pageTitle } from 'ember-page-title';
import { MotionConfig } from 'glimmer-motion';
import { ChoreoMark } from 'test-app/components/choreo-mark';
import { HowPanel } from 'test-app/components/how-panel';
import { TempoPicker } from 'test-app/components/tempo-picker';
import { ThemePicker } from 'test-app/components/theme-picker';

<template>
  {{pageTitle "Choreo"}}
  <MotionConfig @reducedMotion="user">
    <div class="app-shell">
      <header class="topbar">
        <LinkTo @route="index" class="brand">
          <ChoreoMark />
          <span class="brand-copy">
            <span class="brand-name">Choreo</span>
            <span class="brand-sub">by Cardstack</span>
          </span>
        </LinkTo>
        {{! One link. Motion is credited in the hero's tagline and the test
            runner is a development URL, not a destination — anything else here
            competes with the one thing this bar is for. }}
        <nav class="top-links">
          <TempoPicker />
          <ThemePicker />
          <a
            href="https://github.com/cardstack/choreo"
            target="_blank"
            rel="noopener"
          >GitHub</a>
        </nav>
      </header>
      {{! it flies out of the picker above and back into it, so it belongs
          next to the picker rather than inside whatever page is showing }}
      <HowPanel />
      <main class="page">
        {{outlet}}
      </main>
      <footer class="footer">
        <span>© 2026 Cardstack Foundation</span>
        <a
          href="https://github.com/cardstack/choreo/blob/main/LICENSE"
          target="_blank"
          rel="noopener"
        >
          MIT License
        </a>
      </footer>
    </div>
  </MotionConfig>
</template>
