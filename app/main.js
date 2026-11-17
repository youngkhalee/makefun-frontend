// Tiny static make.fun frontend; public API only (GET). Routes: #/ board,
// #/bounty/<slug>, #/bounty/<slug>/leaderboard, #/u/<handle>.
// window.__shotReady: false while loading, true once rendered (errors too).

const API = 'https://make.fun/api';
const etags = new Map(); // url -> { etag, data }
const root = document.getElementById('app');

async function fetchJson(path) { // If-None-Match revalidation; 304 = cache hit
  const url = API + path;
  const seen = etags.get(url);
  const res = await fetch(url, { headers: seen ? { 'If-None-Match': seen.etag } : {} });
  if (res.status === 304 && seen) return seen.data;
  if (!res.ok) throw new Error(`make.fun API answered ${res.status}`);
  const data = await res.json();
  const etag = res.headers.get('etag');
  if (etag) etags.set(url, { etag, data });
  return data;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const usd = (v) => '$' + Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const livePot = (b) => usd(b.potUsd ?? b.rewardAmount);
const utcDate = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

function left(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
  return d ? `${d}d ${h}h left` : h ? `${h}h ${m}m left` : `${m}m left`;
}
const stillOpen = (b) => b.status === 'open' && new Date(b.deadline).getTime() > Date.now();
const stateTag = (b) => stillOpen(b) ? '<span class="tag open">Open</span>' : '<span class="tag closed">Closed</span>';
const feeTag = (b) => b.entryFeeUsd ? ` <span class="tag">${usd(b.entryFeeUsd)} entry fee</span>` : '';

// One 30 s ticker updates only the countdown text nodes.
setInterval(() => {
  for (const el of document.querySelectorAll('[data-dl]')) el.textContent = left(el.dataset.dl);
}, 30000);

function paint(html, title) {
  document.title = title;
  root.innerHTML = html;
  const h = root.querySelector('h1');
  if (h) h.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  window.__shotReady = true;
}

function paintError(err) {
  paint(`<h1 tabindex="-1">Something went wrong</h1>
    <div class="err" role="alert"><p>${esc(err.message || err)}</p>
    <p><button id="retry" type="button">Retry</button></p></div>
    <p><a href="#/">Back to the bounty board</a></p>`, 'Error | make.fun');
  document.getElementById('retry').addEventListener('click', render);
}

let boardCache = [];
function rowHtml(items) {
  if (!items.length) return '<li>No bounties match.</li>';
  return items.map((b) => `<li>
    <span><a href="#/bounty/${encodeURIComponent(b.slug)}">${esc(b.title)}</a>${feeTag(b)}</span>
    <span class="pot" aria-label="Live pot">${livePot(b)}</span>
    <span class="meta">${b.submissionCount} entries</span>
    <span class="meta" data-dl="${esc(b.deadline)}">${left(b.deadline)}</span>
  </li>`).join('');
}
async function boardView() {
  const data = await fetchJson('/competitions?status=open&activity=times');
  boardCache = data.items || [];
  paint(`<h1 tabindex="-1">Live bounty board</h1>
    <p class="dim">Every open bounty on make.fun: live pot (prize plus fees paid), entry fee, entries, time left.</p>
    <label for="q">Filter bounties</label>
    <input id="q" type="search" placeholder="Type to filter by title…" autocomplete="off">
    <ul class="board" id="rows">${rowHtml(boardCache)}</ul>`, 'Live bounty board | make.fun');
  const q = document.getElementById('q');
  q.addEventListener('input', () => { // filters the fetched list, never refetches
    const needle = q.value.trim().toLowerCase();
    document.getElementById('rows').innerHTML =
      rowHtml(boardCache.filter((b) => b.title.toLowerCase().includes(needle)));
  });
}

async function bountyView(slug) {
  const b = await fetchJson(`/competitions/${encodeURIComponent(slug)}`);
  const rewardRows = (b.rewardsNow || []).map((r) => `<tr>
    <td class="n">${esc(r.place)}</td><td class="n">${usd(r.baseUsd)}</td>
    <td class="n">${usd(r.feeShareUsd)}</td><td class="n">${usd(r.amountUsd)}</td></tr>`).join('');
  paint(`<p><a href="#/">← All bounties</a></p>
    <h1 tabindex="-1">${esc(b.title)}</h1>
    <p>${esc(b.summary)}</p>
    <dl>
      <dt>Live pot</dt><dd class="pot">${livePot(b)}</dd>
      ${b.entryFeeUsd ? `<dt>Entry fee</dt><dd>${usd(b.entryFeeUsd)}</dd>` : ''}
      <dt>Entries</dt><dd>${b.submissionCount}</dd>
      <dt>Status</dt><dd>${stateTag(b)}</dd>
      ${b.opensAt ? `<dt>Opened</dt><dd>${utcDate(b.opensAt)}</dd>` : ''}
      <dt>Deadline</dt><dd>${utcDate(b.deadline)} (<span data-dl="${esc(b.deadline)}">${left(b.deadline)}</span>)</dd>
    </dl>
    <p><a href="#/bounty/${encodeURIComponent(slug)}/leaderboard">View the leaderboard →</a></p>
    ${rewardRows ? `<h2>Rewards</h2><table><thead><tr><th class="n">Place</th><th class="n">Prize</th><th class="n">Fee share</th><th class="n">Total</th></tr></thead><tbody>${rewardRows}</tbody></table>` : ''}
    <h2>About this bounty</h2>
    <div class="desc">${esc(b.description)}</div>`, `${b.title} | make.fun`);
}

const PER_PAGE = 50;
let lbState = null; // { slug, columns, entries, page }
function lbHtml() {
  const { columns, entries, page } = lbState;
  const head = columns.map((c) => `<th class="n">${esc(c.title)}</th>`).join('');
  const rows = entries.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE).map((e) => `<tr>
    <td class="n">${esc(e.rank)}</td>
    <td><a href="#/u/${encodeURIComponent(e.handle)}">@${esc(e.handle)}</a></td>
    <td>${esc(e.title)}</td>
    ${columns.map((c) => `<td class="n">${esc(e.display?.[c.key] ?? '–')}</td>`).join('')}
  </tr>`).join('');
  const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  return `<table><thead><tr><th class="n">#</th><th>Entrant</th><th>Entry</th>${head}</tr></thead>
    <tbody>${rows || '<tr><td colspan="9">No entries yet.</td></tr>'}</tbody></table>
    <div class="pager">
      <button id="prev" type="button" ${page === 0 ? 'disabled' : ''}>← Previous</button>
      <span>Page ${page + 1} of ${pages} · ${entries.length} entries</span>
      <button id="next" type="button" ${page + 1 >= pages ? 'disabled' : ''}>Next →</button>
    </div>`;
}
function drawLb() {
  paint(`<p><a href="#/bounty/${encodeURIComponent(lbState.slug)}">← Back to the bounty</a></p>
    <h1 tabindex="-1">Leaderboard</h1>
    <p class="dim">Ranked entries for <a href="#/bounty/${encodeURIComponent(lbState.slug)}">${esc(lbState.slug)}</a>. Entrant names link to their public profiles.</p>
    <div id="lb">${lbHtml()}</div>`, 'Leaderboard | make.fun');
  const prev = document.getElementById('prev'), next = document.getElementById('next');
  if (prev) prev.addEventListener('click', () => { lbState.page--; drawLb(); });
  if (next) next.addEventListener('click', () => { lbState.page++; drawLb(); });
}
async function leaderboardView(slug) {
  const data = await fetchJson(`/competitions/${encodeURIComponent(slug)}/leaderboard`);
  lbState = { slug, columns: data.columns || [], entries: data.entries || [], page: 0 };
  drawLb();
}

async function profileView(handle) {
  const p = await fetchJson(`/profiles/${encodeURIComponent(handle)}`);
  const rec = p.record || {};
  const entries = (p.solutions || []).map((s) => `<li>
    <a href="#/bounty/${encodeURIComponent(s.competition.slug)}">${esc(s.title)}</a>
    <span class="meta">in ${esc(s.competition.title)}${s.placement ? ` · placed ${esc(s.placement)}` : ''}${s.prize_usd ? ` · ${usd(s.prize_usd)}` : ''}</span>
  </li>`).join('');
  paint(`<p><a href="#/">← All bounties</a></p>
    <div class="who">
      ${p.image ? `<img class="avatar" crossorigin="anonymous" src="${esc(p.image)}" alt="">` : ''}
      <div><h1 tabindex="-1">${esc(p.display_name || p.handle)}</h1>
      <p class="dim">@${esc(p.handle)} · joined ${utcDate(p.joined_at).replace(/,.*UTC/, ' UTC')}</p></div>
    </div>
    ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
    <h2>Record</h2>
    <dl>
      <dt>Entered</dt><dd>${rec.competitions_entered ?? 0} competitions</dd>
      <dt>Placed</dt><dd>${rec.competitions_placed ?? 0}</dd>
      <dt>Won</dt><dd>${rec.competitions_won ?? 0}</dd>
      <dt>Best placement</dt><dd>${rec.best_placement ?? '–'}</dd>
      <dt>Prizes</dt><dd>${usd(rec.prize_usd)}</dd>
    </dl>
    ${entries ? `<h2>Entries</h2><ul class="board">${entries}</ul>` : '<p class="dim">No entries yet.</p>'}`,
    `@${p.handle} | make.fun`);
}

async function render() {
  window.__shotReady = false;
  root.innerHTML = '<p class="dim">Loading…</p>';
  const seg = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (seg[0] === 'bounty' && seg[1] && seg[2] === 'leaderboard') await leaderboardView(seg[1]);
    else if (seg[0] === 'bounty' && seg[1]) await bountyView(seg[1]);
    else if (seg[0] === 'u' && seg[1]) await profileView(seg[1]);
    else await boardView();
  } catch (err) {
    paintError(err);
  }
}
window.addEventListener('hashchange', render);
render();
