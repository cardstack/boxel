// Success is the worker being able to process this module and not hang

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
