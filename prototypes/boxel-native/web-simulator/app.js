const app = document.getElementById('app');
const tabs = [...document.querySelectorAll('[data-tab]')];

let state = null;
let view = { tab: 'chats', roomId: null, cardAlias: null, query: '' };

tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    view.tab = btn.dataset.tab;
    view.roomId = null;
    view.cardAlias = null;
    tabs.forEach((b) => b.classList.toggle('is-active', b === btn));
    render();
  });
});

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function refresh() {
  state = await api('/api/state');
  render();
}

function pill() {
  return state.online
    ? '<span class="pill online">online</span>'
    : '<span class="pill">offline</span>';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function render() {
  if (!state) {
    app.innerHTML = '<p class="muted" style="padding:1rem">Loading SQLite…</p>';
    return;
  }
  if (view.tab === 'chats' && view.roomId) return void renderThread();
  if (view.tab === 'cards' && view.cardAlias) return void renderCard();
  if (view.tab === 'chats') return void renderChats();
  if (view.tab === 'cards') return void renderCards();
  renderSync();
}

function renderChats() {
  app.innerHTML = `
    <div class="nav-title">
      <h2>Chats</h2>
      ${pill()}
      <p class="muted">${state.queuedMessages} queued · ${state.index.instances} indexed cards</p>
    </div>
    ${state.rooms
      .map(
        (room) => `
      <button class="list-row" data-open-room="${escapeHtml(room.id)}">
        <div>
          <strong>${escapeHtml(room.title)}</strong>
          <small>${escapeHtml(room.subtitle || '')}</small>
        </div>
        ${
          room.unsynced_count
            ? `<span class="badge">${room.unsynced_count}</span>`
            : `<span class="muted">${room.message_count}</span>`
        }
      </button>`,
      )
      .join('')}
  `;
  app.querySelectorAll('[data-open-room]').forEach((btn) => {
    btn.addEventListener('click', () => {
      view.roomId = btn.dataset.openRoom;
      renderThread();
    });
  });
}

async function renderThread() {
  const { room, messages } = await api(`/api/rooms/${view.roomId}/messages`);
  app.innerHTML = `
    <div class="thread">
      <button class="back" data-back>‹ Chats</button>
      <div class="nav-title">
        <h2>${escapeHtml(room.title)}</h2>
        ${pill()}
      </div>
      <div class="messages">
        ${messages
          .map((m) => {
            const card = m.card
              ? decorateMaybe(m.card)
              : m.card_url
                ? { title: m.card_url, fileAlias: aliasFromUrl(m.card_url) }
                : null;
            return `
          <div class="bubble ${m.sender === 'you' ? 'you' : ''}">
            <div class="who">${escapeHtml(m.sender)} · ${escapeHtml(m.sync_state)}</div>
            <div>${escapeHtml(m.body)}</div>
            ${
              card
                ? `<div class="card-chip" data-open-card="${escapeHtml(card.fileAlias || '')}">📎 ${escapeHtml(card.title || card.fileAlias)}</div>`
                : ''
            }
          </div>`;
          })
          .join('')}
      </div>
      <div class="composer">
        <select id="attach">
          <option value="">No card</option>
          ${state.cards
            .map(
              (c) =>
                `<option value="${escapeHtml(c.fileAlias)}">${escapeHtml(c.title)}</option>`,
            )
            .join('')}
        </select>
        <button class="primary" id="send">Send</button>
        <input id="draft" placeholder="Message (queues while offline)" style="grid-column:1 / -1" />
      </div>
    </div>
  `;
  app.querySelector('[data-back]').addEventListener('click', () => {
    view.roomId = null;
    renderChats();
  });
  app.querySelectorAll('[data-open-card]').forEach((el) => {
    el.addEventListener('click', () => {
      view.tab = 'cards';
      view.cardAlias = el.dataset.openCard;
      tabs.forEach((b) =>
        b.classList.toggle('is-active', b.dataset.tab === 'cards'),
      );
      renderCard();
    });
  });
  app.querySelector('#send').addEventListener('click', sendFromComposer);
  app.querySelector('#draft').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendFromComposer();
  });
}

async function sendFromComposer() {
  const input = app.querySelector('#draft');
  const attach = app.querySelector('#attach');
  const body = input.value.trim();
  if (!body) return;
  await api(`/api/rooms/${view.roomId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body, cardAlias: attach.value || null }),
  });
  state = await api('/api/state');
  await renderThread();
}

function decorateMaybe(card) {
  if (card.title) return card;
  try {
    const search = JSON.parse(card.search_doc || '{}');
    return { ...card, title: search.title, fileAlias: card.file_alias };
  } catch {
    return card;
  }
}

function aliasFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/^\//, '').replace(/\.json$/, '');
  } catch {
    return url;
  }
}

function renderCards() {
  const cards = view.query
    ? state.cards.filter((c) =>
        `${c.title} ${c.fileAlias}`.toLowerCase().includes(view.query),
      )
    : state.cards;
  app.innerHTML = `
    <div class="nav-title">
      <h2>Cards</h2>
      <p class="muted">${state.index.instances} instances in boxel_index · gen ${state.index.generation}</p>
    </div>
    <div class="search">
      <input id="q" placeholder="Search sqlite json_extract(search_doc)" value="${escapeHtml(view.query)}" />
    </div>
    <form class="form" id="new-card">
      <input name="firstName" placeholder="First name" required />
      <input name="lastName" placeholder="Last name" />
      <button class="primary" type="submit">Write JSON + index</button>
    </form>
    ${cards
      .map(
        (c) => `
      <button class="list-row" data-open-card="${escapeHtml(c.fileAlias)}">
        <div>
          <strong>${escapeHtml(c.title)}</strong>
          <small>${escapeHtml(c.fileAlias)}.json · ${escapeHtml(c.types[0] || '')}</small>
        </div>
      </button>`,
      )
      .join('')}
  `;
  app.querySelector('#q').addEventListener('input', (e) => {
    view.query = e.target.value.trim().toLowerCase();
    renderCards();
    app.querySelector('#q').focus();
    app.querySelector('#q').setSelectionRange(view.query.length, view.query.length);
  });
  app.querySelector('#new-card').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    await api('/api/cards', {
      method: 'POST',
      body: JSON.stringify({
        firstName: data.get('firstName'),
        lastName: data.get('lastName'),
      }),
    });
    await refresh();
  });
  app.querySelectorAll('[data-open-card]').forEach((btn) => {
    btn.addEventListener('click', () => {
      view.cardAlias = btn.dataset.openCard;
      renderCard();
    });
  });
}

async function renderCard() {
  const { card } = await api(`/api/cards/${view.cardAlias}`);
  app.innerHTML = `
    <button class="back" data-back>‹ Cards</button>
    <div class="nav-title">
      <h2>${escapeHtml(card.title)}</h2>
      <p class="muted">${escapeHtml(card.url)}</p>
    </div>
    <pre class="json-view">${escapeHtml(JSON.stringify(card.pristineDoc, null, 2))}</pre>
  `;
  app.querySelector('[data-back]').addEventListener('click', () => {
    view.cardAlias = null;
    renderCards();
  });
}

function renderSync() {
  const summary = state.sync.summary;
  const pending = state.sync.plan.filter((p) => p.action !== 'noop');
  app.innerHTML = `
    <div class="nav-title">
      <h2>Sync</h2>
      ${pill()}
      <p class="muted">Same classify/push/pull as <code>boxel realm sync --prefer-newest</code></p>
    </div>
    <div class="sync-grid">
      <div class="kv"><span>Indexed cards</span><strong>${state.index.instances}</strong></div>
      <div class="kv"><span>Local files</span><strong>${state.files.length}</strong></div>
      <div class="kv"><span>Push</span><strong class="action-push">${summary.push || 0}</strong></div>
      <div class="kv"><span>Pull</span><strong class="action-pull">${summary.pull || 0}</strong></div>
      <div class="kv"><span>Conflict</span><strong class="action-conflict">${summary.conflict || 0}</strong></div>
    </div>
    <div class="toolbar">
      <button class="primary" id="toggle-online">${state.online ? 'Go offline' : 'Go online'}</button>
      <button class="primary" id="run-sync">Sync now</button>
    </div>
    ${pending
      .map(
        (p) => `
      <div class="list-row" style="cursor:default">
        <div>
          <strong>${escapeHtml(p.relativePath)}</strong>
          <small>${escapeHtml(p.localStatus)} local · ${escapeHtml(p.remoteStatus)} remote</small>
        </div>
        <span class="action-${escapeHtml(p.action)}">${escapeHtml(p.action)}</span>
      </div>`,
      )
      .join('') || '<p class="muted" style="padding:0 1rem">In sync.</p>'}
    ${
      state.sync.log?.length
        ? `<p class="muted" style="padding:0.5rem 1rem 0">Last run</p>${state.sync.log
            .map(
              (l) =>
                `<div class="list-row" style="cursor:default"><div><strong>${escapeHtml(l.relativePath)}</strong><small>${escapeHtml(l.detail)}</small></div><span>${escapeHtml(l.action)}</span></div>`,
            )
            .join('')}`
        : ''
    }
  `;
  app.querySelector('#toggle-online').addEventListener('click', async () => {
    await api('/api/online', {
      method: 'POST',
      body: JSON.stringify({ online: !state.online }),
    });
    await refresh();
  });
  app.querySelector('#run-sync').addEventListener('click', async () => {
    try {
      await api('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ prefer: 'newest' }),
      });
    } catch (err) {
      alert(err.message);
    }
    await refresh();
  });
}

refresh().catch((err) => {
  app.innerHTML = `<p class="muted" style="padding:1rem">${escapeHtml(err.message)}</p>`;
});
