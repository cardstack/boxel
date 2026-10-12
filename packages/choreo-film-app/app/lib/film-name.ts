export const FILMS = ['sagrada', 'sylva', 'towers'] as const;

export type FilmName = (typeof FILMS)[number];

/**
 * The film this document plays. The page that mounts the app names it on the
 * root element (`<html data-film="towers">`); the dev server takes it from
 * `?film=` instead.
 */
export function filmName(): FilmName | undefined {
  const named =
    document.documentElement.dataset['film'] ??
    new URLSearchParams(window.location.search).get('film');
  return FILMS.find((film) => film === named);
}
