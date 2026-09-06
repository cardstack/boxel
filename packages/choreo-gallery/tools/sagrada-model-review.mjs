import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const out =
  process.env.SAGRADA_REVIEW_OUT ||
  process.cwd() + '/out/sagrada-facade-finish';
const baseline = process.argv[2];
if (!baseline) {
  throw Error(
    'Usage: node scripts/sagrada-model-review.mjs /absolute/path/to/baseline.html',
  );
}
mkdirSync(out, { recursive: true });
const chrome = spawn(
  process.env.CHROME_PATH || 'chromium',
  [
    '--headless=new',
    '--remote-debugging-port=9574',
    '--mute-audio',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--user-data-dir=/tmp/sagrada-static-chrome',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let pages;
  for (let i = 0; i < 60; i++) {
    try {
      pages = await (await fetch('http://127.0.0.1:9574/json/list')).json();
      if (pages.length) {
        break;
      }
    } catch {
      /* Browser startup may not have opened its debugging port yet. */
    }
    await wait(250);
  }
  ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0,
    before = false;
  const pending = new Map(),
    errors = [];
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error
        ? p?.reject(Error(JSON.stringify(m.error)))
        : p?.resolve(m.result);
    } else if (m.method === 'Fetch.requestPaused') {
      await send(
        before ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest',
        before
          ? {
              requestId: m.params.requestId,
              responseCode: 200,
              responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
              body: readFileSync(baseline).toString('base64'),
            }
          : { requestId: m.params.requestId },
      );
    } else if (
      (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') ||
      m.method === 'Runtime.exceptionThrown' ||
      (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
    ) {
      errors.push(m.params);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*sagrada-model.html*', requestStage: 'Request' }],
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw Error(JSON.stringify(r.exceptionDetails));
    }
    return r.result?.value;
  };
  const metrics = [];
  for (const version of ['before', 'after']) {
    before = version === 'before';
    await send('Page.navigate', {
      url: 'http://localhost:4202/asset/sagrada-model.html?host',
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      await wait(250);
      if (await ev('!!window.__film')) {
        ready = true;
        break;
      }
    }
    if (!ready) {
      throw Error('Model not ready ' + version + ' ' + JSON.stringify(errors));
    }
    await ev(
      `(()=>{const f=window.__film;f.hold(true);f.year(2026.5);f.plan('off');f.city('off');f.grass(false);f.wx(0,true);f.theme(1,true);f.light({az:1.9,el:.55});f.haze(0);f.cloud(0);f.wash('');f.dim(0);f.lut({look:'neutral',amount:0,grain:0,ca:0,lift:0,vig:0,tone:0},true);f.grade({bri:1,sat:1,con:1,sep:0,hue:0,gradeA:0,vigA:0,warm:[1,1,1],cool:[1,1,1]},true);})()`,
    );
    if (process.env.SAGRADA_REVIEW_GRADE) {
      await ev(
        `(()=>{const f=window.__film;f.grade({sat:.65,con:1.16,bri:1.08,sep:.35,hue:.04,gradeA:.5,vigA:.5,warm:[1,.86,.68],cool:[.72,.82,1]},true);f.lut({look:'plate',amount:.8,grain:.04,ca:.0014,lift:.055,vig:.12},true);f.wash('plate','#ecdcbc');f.cloud(.5);})()`,
      );
    }
    await ev('window.__film.detailReady?.()');
    await wait(1500);
    for (const [name, az, zoom, fx, fz, lookY, el] of [
      ['01-east-wide', 1.1, 0.88, 0, -0.8, 0, 0.1],
      ['02-west-wide', -1.1, 0.88, 0, -0.8, 0, 0.1],
      ['03-apse-wide', 3.05, 0.88, 0, -1.3, 0, 0.12],
      ['04-roofs-wide', 0.65, 1.0, 0, -0.6, -0.4, 0.65],
      ['05-nativity-close', 1.55, 3.2, 2.45, -0.95, -3.5, 0.01],
      ['06-passion-close', -1.55, 3.2, -2.45, -0.95, -3.5, 0.01],
      ['07-nave-close', 1.2, 3.1, 1.5, 1.5, -3.7, 0.15],
      ['08-apse-close', 3.1, 3.1, 0, -3.2, -3.8, 0.1],
      ['09-mary-close', 2.75, 4.2, 0, -2.08, 3.65, 0.1],
      ['10-jesus-close', 0.55, 4.2, 0, -0.95, 6.0, 0.13],
      ['11-evangelists-close', 1.6, 5, 0, -0.95, 3.9, 0.03],
      ['12-finials-close', 1.4, 4, 2.2, -0.95, 1.3, 0.1],
      ['14-passion-oblique', -0.95, 2.7, -2.45, -0.95, -3.7, 0.05],
    ]) {
      const data = await ev(
        `(()=>{const f=window.__film;f.light({az:${az},el:.55});f.pose({fx:${fx},fz:${fz},lookY:${lookY},az:${az},el:${el},zoom:${zoom},near:null,ox:0,oy:0,snap:true});return f.snapshot();})()`,
      );
      writeFileSync(
        out + '/' + name + '-' + version + '.jpg',
        Buffer.from(data.split(',')[1], 'base64'),
      );
    }
    for (const offset of [0, 0.002, 0.004]) {
      const grass = await ev(
        `(()=>{const f=window.__film;f.year(1882);f.grass(true);f.pose({az:${1.1 + offset},zoom:1.4,fx:0,fz:0,lookY:-4,el:.12,snap:true});return f.snapshot();})()`,
      );
      writeFileSync(
        out + '/grass-' + offset + '-' + version + '.jpg',
        Buffer.from(grass.split(',')[1], 'base64'),
      );
    }
    await ev('window.__film.grass(false);window.__film.year(2026.5)');
    metrics.push(
      await ev(
        `(()=>{const f=window.__film,d=f.dbg();let bytes=0,invalid=0;d.scene.traverse(o=>{if(o.geometry)for(const a of Object.values(o.geometry.attributes)){bytes+=a.array.byteLength;for(const v of a.array)if(!Number.isFinite(v))invalid++;}});d.renderer.info.autoReset=false;d.renderer.info.reset();f.snapshot();const render={...d.renderer.info.render};d.renderer.info.autoReset=true;return {version:'${version}',bytes,invalid,render};})()`,
      ),
    );
    const night = await ev(
      `(()=>{const f=window.__film;f.theme(3,true);f.pose({fx:0,fz:-.8,lookY:0,az:1.1,el:.1,zoom:.88,snap:true});return f.snapshot();})()`,
    );
    writeFileSync(
      out + '/13-night-wide-' + version + '.jpg',
      Buffer.from(night.split(',')[1], 'base64'),
    );
    if (!before) {
      metrics.at(-1).states = await ev(
        `(()=>{const f=window.__film,results=[];for(const theme of [0,1,2,3])for(const year of [1882,1931,1976,2026.5]){f.theme(theme,true);f.year(year);f.snapshot();const d=f.dbg();let bad=0;for(const c of d.CAMPS)for(const m of c.meshes){if(m.visible!==(c.k>0&&(!m.userData.detail||f.view().zoom>1.9)))bad++;if(m.geometry.attributes.aCavity&&m.geometry.attributes.aCavity.count!==m.geometry.attributes.position.count)bad++;}results.push({theme,year,bad});}return results;})()`,
      );
    }
  }
  writeFileSync(
    out + '/metrics.json',
    JSON.stringify({ metrics, errors }, null, 2),
  );
  console.log(JSON.stringify({ metrics, errors }));
  if (
    errors.length ||
    metrics.some((m) => m.invalid || m.states?.some((s) => s.bad))
  ) {
    throw Error('Model validation failed; see metrics.json');
  }
  const names = [
    '01-east-wide',
    '02-west-wide',
    '03-apse-wide',
    '04-roofs-wide',
    '05-nativity-close',
    '06-passion-close',
    '07-nave-close',
    '08-apse-close',
    '09-mary-close',
    '10-jesus-close',
    '11-evangelists-close',
    '12-finials-close',
  ];
  writeFileSync(
    out + '/index.html',
    `<!doctype html><meta charset="utf-8"><title>Sagrada — model review</title><style>body{background:#181a1d;color:#e6e1d8;font:16px system-ui;margin:32px}h1{font-size:28px}section{margin:32px 0}figure{margin:0}img{width:100%;display:block}main{max-width:1500px;margin:auto}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figcaption{padding:10px;color:#aaa}a{color:#a8d5ef}</style><main><h1>Sagrada — whole-model refinement</h1><p>Static HTML views. Left: previous pass. Right: current model. Same camera and lighting in each pair. These are procedural, photo-guided interpretations, not surveyed geometry.</p>${names.map((n) => `<section><h2>${n.slice(3).replaceAll('-', ' ')}</h2><div class="pair">${['before', 'after'].map((v) => `<figure><a href="${n}-${v}.jpg"><img src="${n}-${v}.jpg" loading="lazy"></a><figcaption>${v}</figcaption></figure>`).join('')}</div></section>`).join('')}<p><a href="metrics.json">Validation metrics</a></p></main>`,
  );
} finally {
  ws?.close();
  chrome.kill();
}
