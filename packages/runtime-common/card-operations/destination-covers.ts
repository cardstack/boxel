// Kept in a module of its own, importing nothing, so a client outside the
// realm server (the CLI) can ask the same question without bundling the rest
// of `callApi`.

// Whether a request to `url` goes where `destination` says. Both are compared
// as the URL parser serializes them, and a destination's path ends with `/`, so
// a match always ends at a `/`: `https://api.example.com/` does not cover
// `https://api.example.com.evil.net/`, and `https://api.example.com/v1/` does
// not cover `https://api.example.com/v1beta`. This is the one rule for that
// question: the send-time check asks it of every request, and an approval of a
// key for a destination is judged by it too.
export function destinationCovers(destination: string, url: string): boolean {
  let parsedDestination: URL;
  let parsedURL: URL;
  try {
    parsedDestination = new URL(destination);
    parsedURL = new URL(url);
  } catch {
    return false;
  }
  if (
    parsedDestination.username ||
    parsedDestination.password ||
    parsedDestination.search ||
    parsedDestination.hash ||
    !parsedDestination.pathname.endsWith('/')
  ) {
    return false;
  }
  return parsedURL.href.startsWith(parsedDestination.href);
}
