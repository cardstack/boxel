import FilmRoute from 'test-app/components/film-route';
import SagradaFilm from 'test-app/components/sagrada-film';

<template>
  <FilmRoute @id="sagrada">
    <:film><SagradaFilm @embed={{true}} /></:film>
  </FilmRoute>
</template>
