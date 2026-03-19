import type { RealmIndexingState } from '../indexing-event-sink';

export interface PendingJob {
  jobId: number;
  jobType: string;
  realmURL: string;
  createdAt: string;
  priority: number;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeSince(ms: number): string {
  let seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  let minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s ago`;
  }
  let hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function durationMs(startMs: number, endMs?: number): string {
  let ms = (endMs ?? Date.now()) - startMs;
  if (ms < 1000) {
    return `${ms}ms`;
  }
  let seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  let minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function renderActiveCard(state: RealmIndexingState): string {
  let remaining = state.totalFiles - state.filesCompleted;
  let pct =
    state.totalFiles > 0
      ? Math.round((state.filesCompleted / state.totalFiles) * 100)
      : 0;

  const completedSet = new Set(state.completedFiles);
  let remainingFiles = state.files.filter((f) => !completedSet.has(f));
  let remainingList = remainingFiles
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join('');
  let completedList = state.completedFiles
    .map((f) => `<li class="completed">${escapeHtml(f)}</li>`)
    .join('');

  return `
    <div class="realm-card indexing">
      <div class="realm-header">
        <span class="status-indicator"></span>
        <h3>${escapeHtml(state.realmURL)}</h3>
      </div>
      <div class="job-info">
        <span class="job-type">${escapeHtml(state.jobType)} index</span>
        <span class="job-meta">job #${state.jobId} &middot; started ${timeSince(state.startedAt)} &middot; ${durationMs(state.startedAt)} elapsed</span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar" style="width: ${pct}%"></div>
        <span class="progress-text">${state.filesCompleted} / ${state.totalFiles} files (${pct}%)</span>
      </div>
      <div class="remaining-count">${remaining} file${remaining !== 1 ? 's' : ''} remaining</div>
      ${
        remainingFiles.length > 0
          ? `<details>
        <summary>${remaining} file${remaining !== 1 ? 's' : ''} left to index</summary>
        <ul class="file-list">${remainingList}</ul>
      </details>`
          : ''
      }
      ${
        state.completedFiles.length > 0
          ? `<details>
        <summary>${state.filesCompleted} file${state.filesCompleted !== 1 ? 's' : ''} completed</summary>
        <ul class="file-list">${completedList}</ul>
      </details>`
          : ''
      }
    </div>`;
}

function renderHistoryRow(state: RealmIndexingState): string {
  let statsHtml = state.stats
    ? Object.entries(state.stats)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
    : '';
  return `
    <tr>
      <td>${state.jobId}</td>
      <td>${escapeHtml(state.jobType)}</td>
      <td class="realm-url-cell" title="${escapeHtml(state.realmURL)}">${escapeHtml(state.realmURL)}</td>
      <td>${state.totalFiles}</td>
      <td>${durationMs(state.startedAt, state.lastUpdatedAt)}</td>
      <td>${timeSince(state.lastUpdatedAt)}</td>
      <td class="stats-cell">${escapeHtml(statsHtml)}</td>
    </tr>`;
}

function renderPendingRow(job: PendingJob): string {
  // The DB column is `timestamp` (without tz) but stores UTC values.
  // Append 'Z' so Date parses it as UTC rather than local time.
  let isoString = job.createdAt.endsWith('Z')
    ? job.createdAt
    : job.createdAt + 'Z';
  let createdAt = new Date(isoString);
  return `
    <tr>
      <td>${job.jobId}</td>
      <td>${escapeHtml(job.jobType)}</td>
      <td class="realm-url-cell" title="${escapeHtml(job.realmURL)}">${escapeHtml(job.realmURL)}</td>
      <td>${job.priority}</td>
      <td>${timeSince(createdAt.getTime())}</td>
    </tr>`;
}

export interface DashboardSnapshot {
  active: RealmIndexingState[];
  pending: PendingJob[];
  history: RealmIndexingState[];
}

export function renderIndexingDashboard(snapshot: DashboardSnapshot): string {
  let { active, pending, history } = snapshot;

  let activeCards = active.map(renderActiveCard).join('');
  let pendingRows = pending.map(renderPendingRow).join('');
  let historyRows = history.map(renderHistoryRow).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Indexing Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f1117;
      color: #e1e4e8;
      padding: 24px;
      line-height: 1.5;
    }
    h1 { font-size: 24px; margin-bottom: 8px; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #8b949e; }
    h3 { font-size: 14px; font-weight: 600; word-break: break-all; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: #8b949e;
    }
    .auto-refresh { display: flex; align-items: center; gap: 6px; }
    .auto-refresh input { cursor: pointer; }
    .summary-bar {
      display: flex;
      gap: 16px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .summary-item {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 12px 20px;
      min-width: 120px;
    }
    .summary-item .value {
      font-size: 28px;
      font-weight: 700;
      color: #58a6ff;
    }
    .summary-item .label {
      font-size: 12px;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .summary-item.alert .value { color: #f0883e; }
    .realm-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(450px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .realm-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
    }
    .realm-card.indexing { border-color: #f0883e; }
    .realm-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #3fb950;
      flex-shrink: 0;
    }
    .indexing .status-indicator {
      background: #f0883e;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .job-info {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    .job-type {
      font-weight: 600;
      color: #f0883e;
      text-transform: capitalize;
    }
    .job-meta { color: #8b949e; font-size: 12px; }
    .progress-bar-container {
      position: relative;
      background: #21262d;
      border-radius: 4px;
      height: 24px;
      margin-bottom: 6px;
      overflow: hidden;
    }
    .progress-bar {
      background: linear-gradient(90deg, #238636, #3fb950);
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .progress-text {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }
    .remaining-count {
      font-size: 13px;
      color: #f0883e;
      margin-bottom: 8px;
    }
    details { margin-top: 6px; }
    summary {
      cursor: pointer;
      color: #58a6ff;
      font-size: 12px;
    }
    summary:hover { text-decoration: underline; }
    .file-list {
      list-style: none;
      padding: 6px 0;
      max-height: 300px;
      overflow-y: auto;
      font-size: 12px;
      font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    }
    .file-list li {
      padding: 2px 0;
      color: #c9d1d9;
      word-break: break-all;
    }
    .file-list li.completed {
      color: #3fb950;
    }
    .file-list li.completed::before {
      content: "\\2713 ";
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      padding: 8px 12px;
      border-bottom: 2px solid #30363d;
      color: #8b949e;
      font-weight: 600;
      white-space: nowrap;
    }
    td {
      padding: 6px 12px;
      border-bottom: 1px solid #21262d;
    }
    .realm-url-cell {
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stats-cell {
      font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
      font-size: 11px;
      color: #8b949e;
    }
    .table-wrapper {
      overflow-x: auto;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
    }
    .empty-state {
      text-align: center;
      padding: 40px;
      color: #8b949e;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Indexing Dashboard</h1>
    <div class="header-right">
      <span id="last-updated"></span>
      <label class="auto-refresh">
        <input type="checkbox" id="auto-refresh" checked>
        Auto-refresh (2s)
      </label>
    </div>
  </div>

  <div class="summary-bar">
    <div class="summary-item${active.length > 0 ? ' alert' : ''}">
      <div class="value">${active.length}</div>
      <div class="label">Active Jobs</div>
    </div>
    <div class="summary-item${pending.length > 0 ? ' alert' : ''}">
      <div class="value">${pending.length}</div>
      <div class="label">Pending Jobs</div>
    </div>
    <div class="summary-item">
      <div class="value">${active.reduce((s, a) => s + (a.totalFiles - a.filesCompleted), 0)}</div>
      <div class="label">Files Remaining</div>
    </div>
    <div class="summary-item">
      <div class="value">${history.length}</div>
      <div class="label">Completed</div>
    </div>
  </div>

  <h2>Active Indexing</h2>
  ${activeCards.length > 0 ? `<div class="realm-grid">${activeCards}</div>` : '<div class="empty-state">No active indexing jobs</div>'}

  <h2>Pending Jobs</h2>
  ${
    pending.length > 0
      ? `<div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Job</th>
          <th>Type</th>
          <th>Realm</th>
          <th>Priority</th>
          <th>Queued</th>
        </tr>
      </thead>
      <tbody>${pendingRows}</tbody>
    </table>
  </div>`
      : '<div class="empty-state">No pending jobs</div>'
  }

  <h2>Recent Completed</h2>
  ${
    history.length > 0
      ? `<div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Job</th>
          <th>Type</th>
          <th>Realm</th>
          <th>Files</th>
          <th>Duration</th>
          <th>Finished</th>
          <th>Stats</th>
        </tr>
      </thead>
      <tbody>${historyRows}</tbody>
    </table>
  </div>`
      : '<div class="empty-state">No completed jobs yet (history is populated from events received since the worker manager started)</div>'
  }

  <script>
    document.getElementById('last-updated').textContent =
      'Updated: ' + new Date().toLocaleTimeString();

    let refreshInterval;
    function startRefresh() {
      refreshInterval = setInterval(() => location.reload(), 2000);
    }
    function stopRefresh() {
      clearInterval(refreshInterval);
    }

    let checkbox = document.getElementById('auto-refresh');
    if (checkbox.checked) startRefresh();
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) startRefresh();
      else stopRefresh();
    });
  </script>
</body>
</html>`;
}
