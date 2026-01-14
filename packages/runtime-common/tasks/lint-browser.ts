export function lintSource() {
  return () => {
    throw new Error(`lintSource does not work in the browser`);
  };
}
