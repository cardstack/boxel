import type { TOC } from '@ember/component/template-only';
import type { FilmModel } from 'choreo-film-app/routes/application';

interface Signature {
  Args: { model: FilmModel };
}

<template>
  {{#if @model.Film}}
    <@model.Film @embed={{true}} @picture={{@model.picture}} />
  {{else}}
    <p class="no-film">Name a film with ?film=towers, sagrada or sylva.</p>
  {{/if}}
</template> satisfies TOC<Signature>;
