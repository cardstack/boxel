(function installDocumentBridge() {
  const install = installDocumentBridge.toString();
  const pending = new WeakSet();
  async function bridge(frame) {
    if (frame.srcdoc || pending.has(frame) || !frame.getAttribute('src')) {
      return;
    }
    const url = new URL(frame.getAttribute('src'), document.baseURI);
    if (
      !url.pathname.endsWith('.html') ||
      url.origin !== new URL(document.baseURI).origin
    ) {
      return;
    }
    pending.add(frame);
    try {
      const response = await fetch(url.href, {
        headers: { Accept: 'application/vnd.card+source' },
      });
      if (!response.ok) {
        throw Error('Embedded document ' + response.status);
      }
      let html = await response.text();
      const code =
        'window.__widgetPageURL=' +
        JSON.stringify(url.href) +
        ';location.hash=' +
        JSON.stringify(url.hash) +
        ';(' +
        install +
        ')();';
      html = html.replace(
        /<head[^>]*>/i,
        (head) =>
          head +
          '<base href="' +
          url.href.replace(/"/g, '&quot;') +
          '"><script>' +
          code.replaceAll('</script>', '<\\/script>') +
          '</script>',
      );
      if (frame.isConnected) {
        frame.srcdoc = html;
      }
    } catch (error) {
      console.error(error);
    } finally {
      pending.delete(frame);
    }
  }
  const observer = new MutationObserver(() =>
    document.querySelectorAll('iframe[src]').forEach(bridge),
  );
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  document.querySelectorAll('iframe[src]').forEach(bridge);
})();
