// Tiny make.fun frontend on the public API (GET only). Hash routes:
// #/  #/bounty/<slug>  #/bounty/<slug>/leaderboard  #/u/<handle>
// window.__shotReady: false while a view loads, true once rendered.

const API = 'https://make.fun/api';
const cache = new Map(); // url -> {etag, data}
const app = document.getElementById('app');

async function get(path) {
  const url = API + path;
  const hit = cache.get(url);
  const res = await fetch(url, { headers: hit ? { 'If-None-Match': hit.etag } : {} });
  if (res.status === 304 && hit) return hit.data;
  if (!res.ok) throw new Error(`make.fun API answered ${res.status}`);
  const data = await res.json();
  const etag = res.headers.get('etag');
  if (etag) cache.set(url, { etag, data });
  return data;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (v) => '$' + Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pot = (b) => money(b.potUsd ?? b.rewardAmount);
const utc = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
  return d ? `${d}d ${h}h left` : h ? `${h}h ${m}m left` : `${m}m left`;
}
const isOpen = (b) => b.status === 'open' && new Date(b.deadline).getTime() > Date.now();
const statusTag = (b) => isOpen(b) ? '<span class="tag open">Open</span>' : '<span class="tag closed">Closed</span>';
const feeTag = (b) => b.entryFeeUsd ? ` <span class="tag">${money(b.entryFeeUsd)} entry fee</span>` : '';

// One 30 s ticker refreshes only the countdown text nodes.
setInterval(() => {
  for (const el of document.querySelectorAll('[data-dl]')) el.textContent = timeLeft(el.dataset.dl);
}, 30000);

function show(html, title) {
  document.title = title;
  app.innerHTML = html;
  const h = app.querySelector('h1');
  if (h) h.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  window.__shotReady = true;
}

function showError(err) {
  show(`<h1 tabindex="-1">Something went wrong</h1>
    <div class="err" role="alert"><p>${esc(err.message || err)}</p>
    <p><button id="retry" type="button">Retry</button></p></div>
    <p><a href="#/">Back to the bounty board</a></p>`, 'Error | make.fun');
  document.getElementById('retry').addEventListener('click', render);
}

/* Board */
let boardItems = [];
function boardRows(items) {
  if (!items.length) return '<li>No bounties match.</li>';
  return items.map((b) => `<li>
    <span><a href="#/bounty/${encodeURIComponent(b.slug)}">${esc(b.title)}</a>${feeTag(b)}</span>
    <span class="pot" aria-label="Live pot">${pot(b)}</span>
    <span class="meta">${b.submissionCount} entries</span>
    <span class="meta" data-dl="${esc(b.deadline)}">${timeLeft(b.deadline)}</span>
  </li>`).join('');
}
async function viewBoard() {
  const data = await get('/competitions?status=open&activity=times');
  boardItems = data.items || [];
  show(`<h1 tabindex="-1">Live bounty board</h1>
    <p class="dim">Every open bounty on make.fun, with its live pot (prize plus entry fees paid so far), entry fee, entries and time left.</p>
    <label for="q">Filter bounties</label>
    <input id="q" type="search" placeholder="Type to filter by title…" autocomplete="off">
    <ul class="board" id="rows">${boardRows(boardItems)}</ul>`, 'Live bounty board | make.fun');
  const q = document.getElementById('q');
  q.addEventListener('input', () => {
    const needle = q.value.trim().toLowerCase();
    document.getElementById('rows').innerHTML =
      boardRows(boardItems.filter((b) => b.title.toLowerCase().includes(needle)));
  });
}

/* Bounty page */
async function viewBounty(slug) {
  const b = await get(`/competitions/${encodeURIComponent(slug)}`);
  const rewards = (b.rewardsNow || []).map((r) => `<tr>
    <td class="n">${esc(r.place)}</td><td class="n">${money(r.baseUsd)}</td>
    <td class="n">${money(r.feeShareUsd)}</td><td class="n">${money(r.amountUsd)}</td></tr>`).join('');
  show(`<p><a href="#/">← All bounties</a></p>
    <h1 tabindex="-1">${esc(b.title)}</h1>
    <p>${esc(b.summary)}</p>
    <dl>
      <dt>Live pot</dt><dd class="pot">${pot(b)}</dd>
      ${b.entryFeeUsd ? `<dt>Entry fee</dt><dd>${money(b.entryFeeUsd)}</dd>` : ''}
      <dt>Entries</dt><dd>${b.submissionCount}</dd>
      <dt>Status</dt><dd>${statusTag(b)}</dd>
      ${b.opensAt ? `<dt>Opened</dt><dd>${utc(b.opensAt)}</dd>` : ''}
      <dt>Deadline</dt><dd>${utc(b.deadline)} (<span data-dl="${esc(b.deadline)}">${timeLeft(b.deadline)}</span>)</dd>
    </dl>
    <p><a href="#/bounty/${encodeURIComponent(slug)}/leaderboard">View the leaderboard →</a></p>
    ${rewards ? `<h2>Rewards</h2><table><thead><tr><th class="n">Place</th><th class="n">Prize</th><th class="n">Fee share</th><th class="n">Total</th></tr></thead><tbody>${rewards}</tbody></table>` : ''}
    <h2>About this bounty</h2>
    <div class="desc">${esc(b.description)}</div>`, `${b.title} | make.fun`);
}

/* Leaderboard, paginated client-side */
const PAGE = 50;
let lb = null; // {slug, columns, entries, page}
function lbTable() {
  const { columns, entries, page } = lb;
  const head = columns.map((c) => `<th class="n">${esc(c.title)}</th>`).join('');
  const rows = entries.slice(page * PAGE, page * PAGE + PAGE).map((e) => `<tr>
    <td class="n">${esc(e.rank)}</td>
    <td><a href="#/u/${encodeURIComponent(e.handle)}">@${esc(e.handle)}</a></td>
    <td>${esc(e.title)}</td>
    ${columns.map((c) => `<td class="n">${esc(e.display?.[c.key] ?? '–')}</td>`).join('')}
  </tr>`).join('');
  const pages = Math.max(1, Math.ceil(entries.length / PAGE));
  return `<table><thead><tr><th class="n">#</th><th>Entrant</th><th>Entry</th>${head}</tr></thead>
    <tbody>${rows || '<tr><td colspan="9">No entries yet.</td></tr>'}</tbody></table>
    <div class="pager">
      <button id="prev" type="button" ${page === 0 ? 'disabled' : ''}>← Previous</button>
      <span>Page ${page + 1} of ${pages} · ${entries.length} entries</span>
      <button id="next" type="button" ${page + 1 >= pages ? 'disabled' : ''}>Next →</button>
    </div>`;
}
function drawLb() {
  show(`<p><a href="#/bounty/${encodeURIComponent(lb.slug)}">← Back to the bounty</a></p>
    <h1 tabindex="-1">Leaderboard</h1>
    <p class="dim">Ranked entries for <a href="#/bounty/${encodeURIComponent(lb.slug)}">${esc(lb.slug)}</a>. Entrant names link to their public profiles.</p>
    <div id="lb">${lbTable()}</div>`, `Leaderboard | make.fun`);
  const prev = document.getElementById('prev'), next = document.getElementById('next');
  if (prev) prev.addEventListener('click', () => { lb.page--; drawLb(); });
  if (next) next.addEventListener('click', () => { lb.page++; drawLb(); });
}
async function viewLeaderboard(slug) {
  const data = await get(`/competitions/${encodeURIComponent(slug)}/leaderboard`);
  lb = { slug, columns: data.columns || [], entries: data.entries || [], page: 0 };
  drawLb();
}

/* Public profile */
async function viewProfile(handle) {
  const p = await get(`/profiles/${encodeURIComponent(handle)}`);
  const r = p.record || {};
  const sols = (p.solutions || []).map((s) => `<li>
    <a href="#/bounty/${encodeURIComponent(s.competition.slug)}">${esc(s.title)}</a>
    <span class="meta">in ${esc(s.competition.title)}${s.placement ? ` · placed ${esc(s.placement)}` : ''}${s.prize_usd ? ` · ${money(s.prize_usd)}` : ''}</span>
  </li>`).join('');
  show(`<p><a href="#/">← All bounties</a></p>
    <div class="who">
      ${p.image ? `<img class="avatar" crossorigin="anonymous" src="${esc(p.image)}" alt="">` : ''}
      <div><h1 tabindex="-1">${esc(p.display_name || p.handle)}</h1>
      <p class="dim">@${esc(p.handle)} · joined ${utc(p.joined_at).replace(/,.*UTC/, ' UTC')}</p></div>
    </div>
    ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
    <h2>Record</h2>
    <dl>
      <dt>Entered</dt><dd>${r.competitions_entered ?? 0} competitions</dd>
      <dt>Placed</dt><dd>${r.competitions_placed ?? 0}</dd>
      <dt>Won</dt><dd>${r.competitions_won ?? 0}</dd>
      <dt>Best placement</dt><dd>${r.best_placement ?? '–'}</dd>
      <dt>Prizes</dt><dd>${money(r.prize_usd)}</dd>
    </dl>
    ${sols ? `<h2>Entries</h2><ul class="board">${sols}</ul>` : '<p class="dim">No entries yet.</p>'}`,
    `@${p.handle} | make.fun`);
}

/* Router */
async function render() {
  window.__shotReady = false;
  app.innerHTML = '<p class="dim">Loading…</p>';
  const seg = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (seg[0] === 'bounty' && seg[1] && seg[2] === 'leaderboard') await viewLeaderboard(seg[1]);
    else if (seg[0] === 'bounty' && seg[1]) await viewBounty(seg[1]);
    else if (seg[0] === 'u' && seg[1]) await viewProfile(seg[1]);
    else await viewBoard();
  } catch (err) {
    showError(err);
  }
}
window.addEventListener('hashchange', render);
render();
