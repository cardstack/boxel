/**
 * How the shell moves between the gallery and a demo page. `null` is the
 * gallery itself; a slug is that demo's page.
 *
 * The gallery card owns the state, so moving never touches the host's URL or
 * title: `go` swaps the page inside the card, and `hrefFor` is the real URL
 * the same link opens at when it is followed in a new tab.
 */
export interface GalleryNavigation {
  go(slug: string | null): void;
  hrefFor(slug: string | null): string;
  /** a film's page, opened straight into theater */
  openInTheater(slug: string): void;
}
