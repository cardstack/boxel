# Getting Started

Choreo helps you add motion to a Glimmer application. You can animate a button, coordinate a changing interface, or direct a recorded film. These guides begin with the elements already in your template and introduce more coordination as you need it.

The foundation is **glimmer-motion**, which connects Glimmer to the Motion engine. Interactive Choreo and the Film components build on that foundation. You install one main package and choose the tools that fit your application.

## Motivation

People use motion to understand where something came from, what changed, and which action just succeeded. Small, consistent responses can make an interface easier to follow without requiring a timeline for every button.

Core glimmer-motion gives you those building blocks on the elements already in your Glimmer templates. Begin here when an element needs to respond to state, input, or a layout change.

## Learning Goals

By the end of this section, you will be able to:

- Animate an element from its current appearance to a new target.
- Choose a spring or tween and tune how it responds.
- Keep entering, leaving, and moving items connected to stable identities.
- Support gestures and scrolling while preserving keyboard access and reduced motion.
- Test the outcome of an animation and its behavior when interrupted.

## Installing the Library

The verified path for this checkout uses built local packages in a separate Ember/Vite app. Follow [Build Your First Choreo Application](/docs/core-first-app) for the generator and exact commands. The local package manifests remain at version 0.0.0; these guides do not assume a published npm installation. Keep Motion peer versions aligned with the generated package.json and the repository lockfile.

## Your First Animation

Let's make a message appear when its component is rendered. Create a template tag component and import the modifier and helpers directly.

```gts title="app/components/welcome-message.gts"
import { motion, spring, to } from 'glimmer-motion';

const entrance = spring({ visualDuration: 0.4, bounce: 0.12 });

<template>
  <p
    {{motion
      initial=(to opacity=0 y=12)
      animate=(to opacity=1 y=0)
      transition=entrance
    }}
  >
    Welcome to your workspace.
  </p>
</template>
```

When the paragraph enters the page, it moves up 12 pixels and becomes visible. `initial` describes its starting appearance. `animate` describes the target. `transition` controls how it travels between them.

The modifier works on the paragraph itself. You do not need a special animated element or a wrapper component.

## Choosing Your Next Step

For hover, tap, and changes to a single element, continue with [Animating an Element](/docs/core-elements). For a list that adds or removes items, read [Entering and Leaving](/docs/core-presence).

For cameras, live DOM planes, and galleries, explore [Spatial & 3D Choreo](/docs/spatial-start). When several changes need to happen in an order, move on to [Interactive Choreo](/docs/interactive-start). When a clock needs to reproduce an entire presentation, start with [Recorded & Film Choreo](/docs/film-start).

## A complete working tutorial

Continue with the [end-to-end tutorial](/docs/core-first-app) for a runnable application, complete source, and verification commands.
