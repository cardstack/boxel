import type Koa from 'koa';
import { query } from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware';
import type { CreateRoutesArgs } from '../routes';

interface IndexingJob {
  id: number;
  job_type: string;
  concurrency_group: string | null;
  status: string;
  priority: number;
  args: Record<string, unknown> | null;
  created_at: string;
  finished_at: string | null;
  result: Record<string, unknown> | null;
  worker_id: string | null;
  reservation_started: string | null;
  locked_until: string | null;
}

interface RealmIndexInfo {
  realm_url: string;
  total_entries: number;
  instances: number;
  files: number;
  errors: number;
}

interface WorkingEntry {
  realm_url: string;
  working_count: number;
}

async function getIndexingData(dbAdapter: CreateRoutesArgs['dbAdapter']) {
  let [activeJobs, recentJobs, realmIndex, workingEntries] = await Promise.all([
    // Active/pending indexing jobs with reservation info
    query(dbAdapter, [
      `SELECT
        j.id, j.job_type, j.concurrency_group, j.status, j.priority,
        j.args, j.created_at, j.finished_at, j.result,
        jr.worker_id, jr.created_at as reservation_started, jr.locked_until
      FROM jobs j
      LEFT JOIN job_reservations jr ON jr.job_id = j.id AND jr.completed_at IS NULL
      WHERE j.job_type IN ('from-scratch-index', 'incremental-index', 'copy-index')
        AND j.status = 'unfulfilled'
      ORDER BY j.priority DESC, j.created_at`,
    ]) as unknown as IndexingJob[],

    // Recent completed jobs
    query(dbAdapter, [
      `SELECT
        j.id, j.job_type, j.concurrency_group, j.status, j.priority,
        j.args, j.created_at, j.finished_at, j.result,
        NULL as worker_id, NULL as reservation_started, NULL as locked_until
      FROM jobs j
      WHERE j.job_type IN ('from-scratch-index', 'incremental-index', 'copy-index')
        AND j.status IN ('resolved', 'rejected')
      ORDER BY j.finished_at DESC
      LIMIT 50`,
    ]) as unknown as IndexingJob[],

    // Index entry counts per realm
    query(dbAdapter, [
      `SELECT
        realm_url,
        CAST(COUNT(*) AS INTEGER) as total_entries,
        CAST(COUNT(*) FILTER (WHERE type = 'instance') AS INTEGER) as instances,
        CAST(COUNT(*) FILTER (WHERE type = 'file') AS INTEGER) as files,
        CAST(COUNT(*) FILTER (WHERE has_error = true) AS INTEGER) as errors
      FROM boxel_index
      WHERE is_deleted IS NOT TRUE
      GROUP BY realm_url
      ORDER BY realm_url`,
    ]) as unknown as RealmIndexInfo[],

    // Working entries per realm (shows in-progress batch work)
    query(dbAdapter, [
      `SELECT
        realm_url,
        CAST(COUNT(*) AS INTEGER) as working_count
      FROM boxel_index_working
      GROUP BY realm_url`,
    ]) as unknown as WorkingEntry[],
  ]);

  return { activeJobs, recentJobs, realmIndex, workingEntries };
}

function extractRealmURL(job: IndexingJob): string {
  if (job.args && typeof job.args === 'object' && 'realmURL' in job.args) {
    return job.args.realmURL as string;
  }
  if (job.concurrency_group) {
    return job.concurrency_group.replace('indexing:', '');
  }
  return 'unknown';
}

function extractChanges(job: IndexingJob): string[] {
  if (
    job.args &&
    typeof job.args === 'object' &&
    'changes' in job.args &&
    Array.isArray(job.args.changes)
  ) {
    return job.args.changes.map(
      (c: { url: string; operation: string }) =>
        `${c.operation}: ${c.url}`,
    );
  }
  return [];
}

function extractStats(
  job: IndexingJob,
): Record<string, unknown> | null {
  if (
    job.result &&
    typeof job.result === 'object' &&
    'stats' in job.result
  ) {
    return job.result.stats as Record<string, unknown>;
  }
  return null;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeSince(dateStr: string): string {
  let date = new Date(dateStr);
  let seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  let minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  let hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m ago`;
  }
  let days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function duration(startStr: string, endStr: string | null): string {
  if (!endStr) {
    return 'in progress';
  }
  let ms = new Date(endStr).getTime() - new Date(startStr).getTime();
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

function renderDashboard(data: Awaited<ReturnType<typeof getIndexingData>>): string {
  let { activeJobs, recentJobs, realmIndex, workingEntries } = data;

  let workingMap = new Map(
    workingEntries.map((w) => [w.realm_url, w.working_count]),
  );

  // Group active jobs by realm
  let activeByRealm = new Map<string, IndexingJob[]>();
  for (let job of activeJobs) {
    let realmURL = extractRealmURL(job);
    let jobs = activeByRealm.get(realmURL) || [];
    jobs.push(job);
    activeByRealm.set(realmURL, jobs);
  }

  // Build realm status cards
  let realmCards = realmIndex
    .map((realm) => {
      let active = activeByRealm.get(realm.realm_url) || [];
      let working = workingMap.get(realm.realm_url) || 0;
      let isIndexing = active.length > 0;
      let statusClass = isIndexing ? 'indexing' : 'idle';

      let activeJobsHtml = '';
      if (active.length > 0) {
        activeJobsHtml = active
          .map((job) => {
            let changes = extractChanges(job);
            let jobTypeLabel = job.job_type.replace('-', ' ');
            let startedInfo = job.reservation_started
              ? `started ${timeSince(job.reservation_started)}`
              : `queued ${timeSince(job.created_at)}`;
            let workerInfo = job.worker_id
              ? ` (worker: ${escapeHtml(job.worker_id.substring(0, 8))})`
              : '';

            let changesHtml = '';
            if (changes.length > 0) {
              let changesList = changes
                .map((c) => `<li>${escapeHtml(c)}</li>`)
                .join('');
              changesHtml = `
                <details>
                  <summary>${changes.length} file${changes.length !== 1 ? 's' : ''} to process</summary>
                  <ul class="file-list">${changesList}</ul>
                </details>`;
            }

            return `
              <div class="job-card">
                <div class="job-header">
                  <span class="job-type">${escapeHtml(jobTypeLabel)}</span>
                  <span class="job-meta">${escapeHtml(startedInfo)}${escapeHtml(workerInfo)}</span>
                </div>
                ${changesHtml}
                ${working > 0 ? `<div class="progress-info">${working} entries written to working index</div>` : ''}
              </div>`;
          })
          .join('');
      }

      return `
        <div class="realm-card ${statusClass}">
          <div class="realm-header">
            <span class="status-indicator"></span>
            <h3>${escapeHtml(realm.realm_url)}</h3>
          </div>
          <div class="realm-stats">
            <span class="stat"><strong>${realm.total_entries}</strong> entries</span>
            <span class="stat"><strong>${realm.instances}</strong> instances</span>
            <span class="stat"><strong>${realm.files}</strong> files</span>
            ${realm.errors > 0 ? `<span class="stat error"><strong>${realm.errors}</strong> errors</span>` : ''}
          </div>
          ${activeJobsHtml}
        </div>`;
    })
    .join('');

  // Also show realms that have active jobs but no index entries yet
  for (let [realmURL, jobs] of activeByRealm) {
    if (!realmIndex.find((r) => r.realm_url === realmURL)) {
      let working = workingMap.get(realmURL) || 0;
      let jobsHtml = jobs
        .map((job) => {
          let jobTypeLabel = job.job_type.replace('-', ' ');
          let startedInfo = job.reservation_started
            ? `started ${timeSince(job.reservation_started)}`
            : `queued ${timeSince(job.created_at)}`;
          let changes = extractChanges(job);
          let changesHtml = '';
          if (changes.length > 0) {
            let changesList = changes
              .map((c) => `<li>${escapeHtml(c)}</li>`)
              .join('');
            changesHtml = `
              <details>
                <summary>${changes.length} file${changes.length !== 1 ? 's' : ''} to process</summary>
                <ul class="file-list">${changesList}</ul>
              </details>`;
          }
          return `
            <div class="job-card">
              <div class="job-header">
                <span class="job-type">${escapeHtml(jobTypeLabel)}</span>
                <span class="job-meta">${escapeHtml(startedInfo)}</span>
              </div>
              ${changesHtml}
              ${working > 0 ? `<div class="progress-info">${working} entries written to working index</div>` : ''}
            </div>`;
        })
        .join('');

      realmCards += `
        <div class="realm-card indexing">
          <div class="realm-header">
            <span class="status-indicator"></span>
            <h3>${escapeHtml(realmURL)}</h3>
          </div>
          <div class="realm-stats">
            <span class="stat"><strong>0</strong> entries (new index)</span>
          </div>
          ${jobsHtml}
        </div>`;
    }
  }

  // Recent completed jobs table
  let recentJobsRows = recentJobs
    .map((job) => {
      let realmURL = extractRealmURL(job);
      let stats = extractStats(job);
      let statsHtml = stats
        ? Object.entries(stats)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')
        : '';
      let statusClass = job.status === 'resolved' ? 'success' : 'failure';
      return `
        <tr class="${statusClass}">
          <td>${job.id}</td>
          <td>${escapeHtml(job.job_type.replace('-', ' '))}</td>
          <td class="realm-url-cell" title="${escapeHtml(realmURL)}">${escapeHtml(realmURL)}</td>
          <td><span class="status-badge ${statusClass}">${escapeHtml(job.status)}</span></td>
          <td>${duration(job.created_at, job.finished_at)}</td>
          <td>${job.finished_at ? timeSince(job.finished_at) : ''}</td>
          <td class="stats-cell">${escapeHtml(statsHtml)}</td>
        </tr>`;
    })
    .join('');

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
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
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
    .realm-stats {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 8px;
      font-size: 13px;
      color: #8b949e;
    }
    .realm-stats .stat strong { color: #e1e4e8; }
    .realm-stats .stat.error strong { color: #f85149; }
    .job-card {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 10px 12px;
      margin-top: 8px;
      font-size: 13px;
    }
    .job-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .job-type {
      font-weight: 600;
      color: #f0883e;
      text-transform: capitalize;
    }
    .job-meta { color: #8b949e; font-size: 12px; }
    .progress-info {
      margin-top: 6px;
      font-size: 12px;
      color: #58a6ff;
    }
    details { margin-top: 8px; }
    summary {
      cursor: pointer;
      color: #58a6ff;
      font-size: 12px;
    }
    summary:hover { text-decoration: underline; }
    .file-list {
      list-style: none;
      padding: 6px 0;
      max-height: 200px;
      overflow-y: auto;
      font-size: 12px;
      font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    }
    .file-list li {
      padding: 2px 0;
      color: #c9d1d9;
      word-break: break-all;
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
    tr.failure td { color: #f85149; }
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .status-badge.success { background: #238636; color: #fff; }
    .status-badge.failure { background: #da3633; color: #fff; }
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
        Auto-refresh (5s)
      </label>
    </div>
  </div>

  <div class="summary-bar">
    <div class="summary-item${activeJobs.length > 0 ? ' alert' : ''}">
      <div class="value">${activeJobs.length}</div>
      <div class="label">Active Jobs</div>
    </div>
    <div class="summary-item">
      <div class="value">${realmIndex.length}</div>
      <div class="label">Realms</div>
    </div>
    <div class="summary-item">
      <div class="value">${realmIndex.reduce((s, r) => s + r.total_entries, 0)}</div>
      <div class="label">Total Entries</div>
    </div>
    <div class="summary-item">
      <div class="value">${realmIndex.reduce((s, r) => s + r.errors, 0)}</div>
      <div class="label">Total Errors</div>
    </div>
  </div>

  <h2>Realms</h2>
  ${realmCards.length > 0 ? `<div class="realm-grid">${realmCards}</div>` : '<div class="empty-state">No realms found</div>'}

  <h2>Recent Jobs</h2>
  ${
    recentJobs.length > 0
      ? `<div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Type</th>
          <th>Realm</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Finished</th>
          <th>Stats</th>
        </tr>
      </thead>
      <tbody>${recentJobsRows}</tbody>
    </table>
  </div>`
      : '<div class="empty-state">No recent jobs</div>'
  }

  <script>
    document.getElementById('last-updated').textContent =
      'Updated: ' + new Date().toLocaleTimeString();

    let refreshInterval;
    function startRefresh() {
      refreshInterval = setInterval(() => location.reload(), 5000);
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

export default function handleIndexingDashboard({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let data = await getIndexingData(dbAdapter);
    let html = renderDashboard(data);

    return setContextResponse(
      ctxt,
      new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
  };
}
