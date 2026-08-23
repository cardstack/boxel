import { LinkTo } from '@ember/routing';
import { pageTitle } from 'ember-page-title';
import { MotionConfig } from 'glimmer-motion';
import { SparkMark } from 'test-app/components/spark-mark';

<template>
  {{pageTitle "glimmer-motion"}}
  <MotionConfig @reducedMotion="user">
    <div class="app-shell">
      <header class="topbar">
        <LinkTo @route="index" class="brand">
          <SparkMark />
          <span class="brand-copy">
            <span class="brand-name">glimmer-motion</span>
            <span class="brand-sub">examples</span>
          </span>
        </LinkTo>
        {{! One link. Motion is credited in the hero's tagline and the test
            runner is a development URL, not a destination — anything else here
            competes with the one thing this bar is for. }}
        <nav class="top-links">
          <a href="https://github.com/cardstack/glimmer-motion">GitHub</a>
        </nav>
      </header>
      <main class="page">
        {{outlet}}
      </main>
    </div>
  </MotionConfig>
</template>
