// Tiny make.fun frontend: board, bounty, leaderboard, profile.
// One module, one fetch per view, ETag-revalidated in-memory cache.
const API = 'https://make.fun/api';
const app = document.getElementById('app');
const cache = new Map(); // url -> {etag, data}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

async function api(path) {
  const url = API + path;
  const hit = cache.get(url);
  const headers = hit?.etag ? { 'If-None-Match': hit.etag } : {};
  const res = await fetch(url, { headers });
  if (res.status === 304 && hit) return hit.data;
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  const data = await res.json();
  cache.set(url, { etag: res.headers.get('ETag'), data });
  return data;
}

const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n)
    ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : esc(v);
};
const pot = (b) => money(b.potUsd ?? b.rewardAmount);
const isOpen = (b) => new Date(b.deadline).getTime() > Date.now();
const utc = (iso) => new Date(iso).toUTCString().replace(' GMT', ' UTC');

function timeLeft(iso) {
  let ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  const d = Math.floor(ms / 864e5); ms -= d * 864e5;
  const h = Math.floor(ms / 36e5); ms -= h * 36e5;
  const m = Math.floor(ms / 6e4);
  return d ? `${d}d ${h}h left` : h ? `${h}h ${m}m left` : `${m}m left`;
}

// One 30s ticker refreshes only the countdown text nodes.
setInterval(() => {
  document.querySelectorAll('[data-left]').forEach((el) => {
    el.textContent = timeLeft(el.dataset.left);
  });
}, 30000);

function page(title, html) {
  document.title = `${title} · make.fun`;
  app.innerHTML = html;
  const h = app.querySelector('h1');
  if (h) h.focus();
  window.__shotReady = true;
}
function fail(route, err) {
  page('Error', `<h1 tabindex="-1">Something went wrong</h1>
    <div class="err"><p>${esc(err.message || err)}</p>
    <button type="button" id="retry">Retry</button></div>`);
  document.getElementById('retry').addEventListener('click', route);
}

// ---------- Board ----------
let boardItems = [];
function boardRows(items) {
  if (!items.length) return '<li class="card">No bounties match.</li>';
  return items.map((b) => `<li class="card">
    <h2><a href="#/bounty/${esc(b.slug)}">${esc(b.title)}</a></h2>
    <p class="meta">
      <span class="pot">Pot ${pot(b)}</span>
      ${b.entryFeeUsd != null ? `<span>Entry fee ${money(b.entryFeeUsd)}</span>` : ''}
      <span data-left="${esc(b.deadline)}">${timeLeft(b.deadline)}</span>
      <span>${esc(b.submissionCount ?? 0)} entries</span>
      <span class="${isOpen(b) ? 'open' : 'closed'}">${isOpen(b) ? 'Open' : 'Closed'}</span>
      <span><a href="#/bounty/${esc(b.slug)}/leaderboard">Leaderboard</a></span>
    </p></li>`).join('');
}
async function viewBoard() {
  const data = await api('/competitions?status=open&activity=times');
  boardItems = data.items || [];
  page('Bounty board', `<h1 tabindex="-1">Live bounty board</h1>
    <p><label for="q">Filter bounties</label>
    <input type="search" id="q" placeholder="Type to filter…" autocomplete="off"></p>
    <ul class="cards" id="list">${boardRows(boardItems)}</ul>`);
  document.getElementById('q').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.getElementById('list').innerHTML = boardRows(
      boardItems.filter((b) => (b.title + ' ' + b.slug).toLowerCase().includes(q)));
  });
}

// ---------- Bounty ----------
async function viewBounty(slug) {
  const b = await api('/competitions/' + encodeURIComponent(slug));
  const rows = (b.rewardsNow || []).map((r) => `<tr>
    <td data-l="Place">${esc(r.place)}</td><td data-l="Base prize">${money(r.baseUsd)}</td>
    <td data-l="Fee share">${money(r.feeShareUsd)}</td><td data-l="Total">${money(r.amountUsd)}</td></tr>`).join('');
  page(b.title, `<p class="crumb"><a href="#/">← Bounty board</a></p>
    <h1 tabindex="-1">${esc(b.title)}</h1>
    <p>${esc(b.summary || '')}</p>
    <p class="meta">
      <span class="pot">Live pot ${pot(b)}</span>
      ${b.entryFeeUsd != null ? `<span>Entry fee ${money(b.entryFeeUsd)}</span>` : ''}
      <span>${esc(b.submissionCount ?? 0)} entries</span>
      <span class="${isOpen(b) ? 'open' : 'closed'}">${isOpen(b) ? 'Open' : 'Closed'} · ${esc(b.status || '')}</span>
    </p>
    <p class="meta"><span>Opens ${utc(b.opensAt)}</span>
    <span>Deadline ${utc(b.deadline)} (<span data-left="${esc(b.deadline)}">${timeLeft(b.deadline)}</span>)</span></p>
    <p><a href="#/bounty/${esc(b.slug)}/leaderboard">View the leaderboard →</a></p>
    ${rows ? `<h2>Rewards (live pot split)</h2><table><thead><tr>
      <th>Place</th><th>Base prize</th><th>Fee share</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody></table>` : ''}
    <h2>About this bounty</h2>
    <div class="desc">${esc(b.description || '')}</div>`);
}

// ---------- Leaderboard (50 per page, data fetched once) ----------
const PAGE = 50;
let lbData = null, lbSlug = '', lbPage = 0;
function lbTable() {
  const cols = lbData.columns || [];
  const entries = lbData.entries || [];
  const pages = Math.max(1, Math.ceil(entries.length / PAGE));
  lbPage = Math.min(lbPage, pages - 1);
  const slice = entries.slice(lbPage * PAGE, lbPage * PAGE + PAGE);
  const head = `<th>Rank</th><th>Entrant</th><th>Entry</th>` +
    cols.map((c) => `<th>${esc(c.title)}</th>`).join('');
  const body = slice.map((e) => `<tr>
    <td data-l="Rank">${esc(e.rank)}</td>
    <td data-l="Entrant"><a href="#/u/${esc(e.handle)}">@${esc(e.handle)}</a></td>
    <td data-l="Entry">${esc(e.title || '')}</td>
    ${cols.map((c) => `<td data-l="${esc(c.title)}">${esc(e.display?.[c.key] ?? '')}</td>`).join('')}
    </tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td>No entries yet.</td></tr>'}</tbody></table>
    <div class="pager">
      <button type="button" id="prev" ${lbPage === 0 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${lbPage + 1} of ${pages} · ${entries.length} entries</span>
      <button type="button" id="next" ${lbPage >= pages - 1 ? 'disabled' : ''}>Next →</button>
    </div>`;
}
function lbWire() {
  const prev = document.getElementById('prev'), next = document.getElementById('next');
  const go = (d) => () => {
    lbPage += d;
    document.getElementById('lbwrap').innerHTML = lbTable();
    lbWire();
  };
  if (prev) prev.addEventListener('click', go(-1));
  if (next) next.addEventListener('click', go(1));
}
async function viewLeaderboard(slug) {
  const b = await api('/competitions/' + encodeURIComponent(slug));
  if (lbSlug !== slug) { lbData = null; lbPage = 0; lbSlug = slug; }
  if (!lbData) lbData = await api(`/competitions/${encodeURIComponent(slug)}/leaderboard`);
  page(`${b.title} leaderboard`, `<p class="crumb"><a href="#/bounty/${esc(slug)}">← ${esc(b.title)}</a></p>
    <h1 tabindex="-1">Leaderboard</h1>
    <p class="meta"><span class="pot">Live pot ${pot(b)}</span>
    <span data-left="${esc(b.deadline)}">${timeLeft(b.deadline)}</span></p>
    <div id="lbwrap">${lbTable()}</div>`);
  lbWire();
}

// ---------- Profile ----------
async function viewProfile(handle) {
  const p = await api('/profiles/' + encodeURIComponent(handle));
  const r = p.record || {};
  const sols = (p.solutions || []).map((s) => `<li class="card">
    <a href="#/bounty/${esc(s.competition?.slug)}">${esc(s.title || s.competition?.title || '')}</a>
    <p class="meta">${s.placement != null ? `<span>Placed #${esc(s.placement)}</span>` : ''}
    ${s.prize_usd != null ? `<span>Prize ${money(s.prize_usd)}</span>` : ''}</p></li>`).join('');
  page(`@${p.handle}`, `<p class="crumb"><a href="#/">← Bounty board</a></p>
    <h1 tabindex="-1">${p.image ? `<img class="avatar" crossorigin="anonymous" src="${esc(p.image)}" alt="">` : ''}${esc(p.display_name || p.handle)} <small>@${esc(p.handle)}</small></h1>
    ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
    <p class="meta"><span>Joined ${utc(p.joined_at)}</span></p>
    <h2>Record</h2>
    <ul class="stats">
      <li><b>${esc(r.competitions_entered ?? 0)}</b>entered</li>
      <li><b>${esc(r.competitions_placed ?? 0)}</b>placed</li>
      <li><b>${esc(r.competitions_won ?? 0)}</b>won</li>
      <li><b>${r.best_placement != null ? '#' + esc(r.best_placement) : '—'}</b>best placement</li>
      <li><b>${money(r.prize_usd ?? 0)}</b>prizes</li>
    </ul>
    <h2>Entries</h2>
    <ul class="cards">${sols || '<li class="card">No entries yet.</li>'}</ul>`);
}

// ---------- Router ----------
async function render() {
  window.__shotReady = false;
  app.innerHTML = '<p>Loading…</p>';
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (parts[0] === 'bounty' && parts[1] && parts[2] === 'leaderboard') await viewLeaderboard(parts[1]);
    else if (parts[0] === 'bounty' && parts[1]) await viewBounty(parts[1]);
    else if (parts[0] === 'u' && parts[1]) await viewProfile(parts[1]);
    else await viewBoard();
  } catch (err) {
    fail(render, err);
  }
}
window.addEventListener('hashchange', render);
render();
