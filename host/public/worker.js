/******/ (() => { // webpackBootstrap
var __webpack_exports__ = {};
/*!*********************!*\
  !*** ./src/main.ts ***!
  \*********************/
const worker = self;
worker.addEventListener('install', () => {
  // force moving on to activation even if another service worker had control
  worker.skipWaiting();
});
worker.addEventListener('activate', () => {
  // takes over when there is *no* existing service worker
  worker.clients.claim();
  console.log('activating service worker');
});
worker.addEventListener('fetch', event => {
  console.log(`SAW fetch ${event.request.url}`);
  event.respondWith(fetch(event.request));
});
/******/ })()
;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsTUFBTUEsTUFBTSxHQUFHQyxJQUFmO0FBRUFELE1BQU0sQ0FBQ0UsZ0JBQVAsQ0FBd0IsU0FBeEIsRUFBbUMsTUFBTTtBQUN2QztBQUNBRixFQUFBQSxNQUFNLENBQUNHLFdBQVA7QUFDRCxDQUhEO0FBS0FILE1BQU0sQ0FBQ0UsZ0JBQVAsQ0FBd0IsVUFBeEIsRUFBb0MsTUFBTTtBQUN4QztBQUNBRixFQUFBQSxNQUFNLENBQUNJLE9BQVAsQ0FBZUMsS0FBZjtBQUNBQyxFQUFBQSxPQUFPLENBQUNDLEdBQVIsQ0FBWSwyQkFBWjtBQUNELENBSkQ7QUFNQVAsTUFBTSxDQUFDRSxnQkFBUCxDQUF3QixPQUF4QixFQUFrQ00sS0FBRCxJQUF1QjtBQUN0REYsRUFBQUEsT0FBTyxDQUFDQyxHQUFSLENBQWEsYUFBWUMsS0FBSyxDQUFDQyxPQUFOLENBQWNDLEdBQUksRUFBM0M7QUFDQUYsRUFBQUEsS0FBSyxDQUFDRyxXQUFOLENBQWtCQyxLQUFLLENBQUNKLEtBQUssQ0FBQ0MsT0FBUCxDQUF2QjtBQUNELENBSEQsRSIsInNvdXJjZXMiOlsid2VicGFjazovL3dvcmtlci8uL3NyYy9tYWluLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImNvbnN0IHdvcmtlciA9IHNlbGYgYXMgdW5rbm93biBhcyBTZXJ2aWNlV29ya2VyR2xvYmFsU2NvcGU7XG5cbndvcmtlci5hZGRFdmVudExpc3RlbmVyKCdpbnN0YWxsJywgKCkgPT4ge1xuICAvLyBmb3JjZSBtb3Zpbmcgb24gdG8gYWN0aXZhdGlvbiBldmVuIGlmIGFub3RoZXIgc2VydmljZSB3b3JrZXIgaGFkIGNvbnRyb2xcbiAgd29ya2VyLnNraXBXYWl0aW5nKCk7XG59KTtcblxud29ya2VyLmFkZEV2ZW50TGlzdGVuZXIoJ2FjdGl2YXRlJywgKCkgPT4ge1xuICAvLyB0YWtlcyBvdmVyIHdoZW4gdGhlcmUgaXMgKm5vKiBleGlzdGluZyBzZXJ2aWNlIHdvcmtlclxuICB3b3JrZXIuY2xpZW50cy5jbGFpbSgpO1xuICBjb25zb2xlLmxvZygnYWN0aXZhdGluZyBzZXJ2aWNlIHdvcmtlcicpO1xufSk7XG5cbndvcmtlci5hZGRFdmVudExpc3RlbmVyKCdmZXRjaCcsIChldmVudDogRmV0Y2hFdmVudCkgPT4ge1xuICBjb25zb2xlLmxvZyhgU0FXIGZldGNoICR7ZXZlbnQucmVxdWVzdC51cmx9YCk7XG4gIGV2ZW50LnJlc3BvbmRXaXRoKGZldGNoKGV2ZW50LnJlcXVlc3QpKTtcbn0pO1xuIl0sIm5hbWVzIjpbIndvcmtlciIsInNlbGYiLCJhZGRFdmVudExpc3RlbmVyIiwic2tpcFdhaXRpbmciLCJjbGllbnRzIiwiY2xhaW0iLCJjb25zb2xlIiwibG9nIiwiZXZlbnQiLCJyZXF1ZXN0IiwidXJsIiwicmVzcG9uZFdpdGgiLCJmZXRjaCJdLCJzb3VyY2VSb290IjoiIn0=