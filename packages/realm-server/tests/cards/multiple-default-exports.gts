function a() {
  return 'a';
}
function b() {
  return 'b';
}
// @ts-ignore-error intentional multiple default exports
export default a;
// @ts-ignore-error intentional multiple default exports
export default b;
