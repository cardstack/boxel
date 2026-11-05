// One Pret UI component that wraps boxel-ui, Accordion, with an item open,
// and one boxel-icons icon. The item's chevron is boxel-ui's own boxel-icons
// import, and the key is the package's, so the bundle reaches boxel-icons
// both through Pret UI and from the package by name.
import KeyRound from '@cardstack/boxel-icons/key-round';
import { Accordion } from '@cardstack/pretui/components/accordion';

<template>
  <main class='probe' data-test-build-probe>
    <Accordion @displayContainer={{true}} as |A|>
      <A.Item @isOpen={{true}} @id='probe-item'>
        <:title>
          <KeyRound class='probe-icon' data-test-build-probe-icon />
          Build probe
        </:title>
        <:content>
          <p data-test-build-probe-content>Pret UI and boxel-icons render here.</p>
        </:content>
      </A.Item>
    </Accordion>
  </main>
  <style scoped>
    .probe {
      max-width: 30rem;
      margin: 2rem auto;
    }
    .probe-icon {
      width: 1rem;
      height: 1rem;
    }
  </style>
</template>
