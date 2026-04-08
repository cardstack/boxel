---
layout: home

hero:
  name: Boxel
  text: The Card-Based Runtime for AI-Native Applications
  tagline: Build composable, searchable, and AI-powered applications using a revolutionary card-based architecture. Define once, render everywhere, connect anything.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/introduction
    - theme: alt
      text: Core Concepts
      link: /core-concepts/cards-and-fields
    - theme: alt
      text: View on GitHub
      link: https://github.com/cardstack/boxel

features:
  - icon: 🃏
    title: Card-Based Architecture
    details: Everything is a card — data, UI, and behavior unified into composable, reusable building blocks. Cards inherit, compose, and link to create rich applications.
    link: /core-concepts/cards-and-fields
    linkText: Learn about Cards

  - icon: 🌐
    title: Realms — Your Card Universe
    details: Realms are URL-oriented repositories that store, index, and serve your cards. They provide real-time sync, search, and content negotiation out of the box.
    link: /core-concepts/realms
    linkText: Explore Realms

  - icon: 🤖
    title: AI-Native Design
    details: Built from the ground up for AI agents. Skills, commands, and Matrix integration enable intelligent automation and natural language interaction with your cards.
    link: /ai-agents/overview
    linkText: AI & Agents

  - icon: 🎨
    title: Multi-Format Rendering
    details: "Cards render in five formats: isolated, embedded, fitted, edit, and atom. One definition, multiple views — from full-page layouts to inline chips."
    link: /core-concepts/card-rendering
    linkText: Card Rendering

  - icon: 🔍
    title: Powerful Query Engine
    details: Search across cards with type filters, equality checks, range queries, and full-text search. Queries work across multiple realms with federated search.
    link: /core-concepts/queries-and-search
    linkText: Queries & Search

  - icon: 🧬
    title: Rich Type System
    details: Cards and fields form a rich type hierarchy with inheritance, computed fields, and four relationship types — contains, containsMany, linksTo, and linksToMany.
    link: /card-development/field-types
    linkText: Field Types

  - icon: 🔧
    title: Developer Tools
    details: VS Code extension, CLI for workspace sync, custom ESLint rules, and a complete development environment with hot reload and visual testing.
    link: /developer-tools/cli
    linkText: Dev Tools

  - icon: 📡
    title: Real-Time Collaboration
    details: Built on the Matrix protocol for real-time event broadcasting, authentication, and collaborative editing across workspaces and teams.
    link: /ai-agents/matrix-integration
    linkText: Matrix Integration
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #6366f1 30%, #a855f7);
  --vp-home-hero-image-background-image: linear-gradient(-45deg, #6366f1aa 50%, #a855f7aa 50%);
  --vp-home-hero-image-filter: blur(44px);
}

.VPFeatures .VPFeature {
  border-radius: 12px;
}
</style>
