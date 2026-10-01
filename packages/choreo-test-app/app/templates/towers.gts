import FilmRoute from 'test-app/components/film-route';
import TowerFilm from 'test-app/components/tower-film';

<template>
  <FilmRoute @id="towers">
    <:film><TowerFilm @embed={{true}} /></:film>
  </FilmRoute>
</template>
