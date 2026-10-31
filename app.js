import { createBackend, isDemo } from './data.js';

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── Dates ── */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = d => addDays(startOfDay(d), -((d.getDay() + 6) % 7)); // Monday
const todayYmd = () => ymd(new Date());
const fmt = (d, o) => d.toLocaleString(undefined, o);
const fmtClock = d => fmt(d, { hour: 'numeric', minute: '2-digit' });
const fmtTime = t => {
  if (!t) return 'All day';
  const [h, m] = t.split(':').map(Number);
  return fmtClock(new Date(2000, 0, 1, h, m));
};
function fmtStamp(iso) {
  const d = new Date(iso);
  const mins = (Date.now() - d) / 60000;
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${Math.floor(mins)}m ago · ${fmtClock(d)}`;
  const day = ymd(d);
  if (day === todayYmd()) return `Today · ${fmtClock(d)}`;
  if (day === ymd(addDays(new Date(), -1))) return `Yesterday · ${fmtClock(d)}`;
  return `${fmt(d, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtClock(d)}`;
}
const fmtDayLong = s => fmt(parseYmd(s), { weekday: 'long', month: 'long', day: 'numeric' });

/* ── State ── */
const S = {
  db: null, me: null, team: null,
  members: new Map(),
  posts: new Map(),
  events: new Map(),
  tab: 'today',
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  calDay: todayYmd(),
  cal: null,
  feedCount: 20,
  unsub: null,
  dirty: false,
};

const KINDS = [['workout', 'Workout'], ['social', 'Get-together'], ['other', 'Other']];
const kindLabel = k => KINDS.find(([v]) => v === k)?.[1] ?? 'Event';

/* ── People ── */
const COLORS = ['#FF5A36', '#0A84FF', '#30B158', '#BF5AF2', '#FF9F0A', '#32ADE6', '#FF375F', '#5E5CE6', '#C9A227', '#AC8E68'];
function colorFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}
const nameOf = id => S.members.get(id)?.name ?? 'Former member';
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const avatar = (id, size = '') =>
  `<span class="av ${size}" style="--c:${colorFor(id)}" aria-hidden="true">${esc(initials(nameOf(id)))}</span>`;

async function loadMembers() {
  const list = await S.db.members();
  S.members = new Map(list.map(m => [m.id, m]));
  if (S.members.has(S.me.id)) S.me.name = S.members.get(S.me.id).name;
}

function daysByUser(activity) {
  const map = new Map();
  for (const a of activity) {
    if (!map.has(a.userId)) map.set(a.userId, new Set());
    map.get(a.userId).add(ymd(new Date(a.createdAt)));
  }
  return map;
}

function streakOf(days) {
  if (!days) return 0;
  let d = new Date();
  if (!days.has(ymd(d))) d = addDays(d, -1);
  let n = 0;
  while (days.has(ymd(d))) { n++; d = addDays(d, -1); }
  return n;
}

/* ── Icons ── */
const icon = {
  today: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  feed: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M3 9h18M9 21V9"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
  crew: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M17 14.3c2.5.1 4.2 1.7 4.6 4.7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  chevL: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
  chevR: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
};

/* ── Toast ── */
let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2800);
}
const toastErr = e => { console.error(e); toast(e?.message || 'Something went wrong', true); };

/* ── Sheets ── */
function openSheet(html) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="grab"></div>
      <button class="sheet-x" data-close aria-label="Close">✕</button>
      ${html}
    </div>`;
  $('#sheet-root').append(wrap);
  document.body.classList.add('locked');
  requestAnimationFrame(() => wrap.classList.add('open'));
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(wrap); });
  return $('.sheet', wrap);
}

function closeSheet(el) {
  const wrap = el?.closest?.('.sheet-wrap') ?? [...document.querySelectorAll('.sheet-wrap')].pop();
  if (!wrap) return;
  wrap.classList.remove('open');
  setTimeout(() => {
    wrap.remove();
    if (!document.querySelector('.sheet-wrap')) {
      document.body.classList.remove('locked');
      if (S.dirty) refresh();
    }
  }, 260);
}

/* ── Navigation ── */
const views = { today: renderToday, feed: renderFeed, calendar: renderCalendar, crew: renderCrew };
let renderSeq = 0;

async function go(tab, { keep = false } = {}) {
  S.tab = tab;
  tabbar.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const seq = ++renderSeq;
  if (!keep) {
    window.scrollTo(0, 0);
    if (!app.firstElementChild?.classList.contains(`v-${tab}`)) app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }
  try { await views[tab](seq); } catch (e) { toastErr(e); }
}
const stale = seq => seq !== renderSeq;

let refreshing = false;
async function refresh() {
  if (!S.team || refreshing) return;
  refreshing = true;
  S.dirty = false;
  try {
    await loadMembers();
    await go(S.tab, { keep: true });
  } catch (e) { toastErr(e); } finally { refreshing = false; }
}

/* ── Shared pieces ── */
function eventRow(e, { showDate = true } = {}) {
  S.events.set(e.id, e);
  const d = parseYmd(e.date);
  const meta = [showDate ? fmt(d, { weekday: 'short' }) : null, fmtTime(e.time), e.location].filter(Boolean).map(esc).join(' · ');
  return `<button class="row" data-act="event" data-id="${e.id}">
    ${showDate
      ? `<span class="datechip k-${e.kind}"><small>${fmt(d, { month: 'short' })}</small><b>${d.getDate()}</b></span>`
      : `<span class="kindbar k-${e.kind}"></span>`}
    <span class="grow"><b>${esc(e.title)}</b><small>${meta}</small></span>
    <span class="chev">${icon.chevR}</span>
  </button>`;
}

function planList(details) {
  const lines = (details || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  if (lines.length === 1) return `<p class="plan-p">${esc(lines[0])}</p>`;
  return `<ol class="plan">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>`;
}

function mediaGrid(p) {
  if (!p.media.length) return '';
  const shown = p.media.slice(0, 4);
  return `<div class="media n${shown.length}">${shown.map((m, i) => `
    <button class="m" data-act="view" data-id="${p.id}" data-i="${i}" aria-label="Open ${m.type}">
      ${m.type === 'video'
        ? `<video src="${esc(m.url)}#t=0.1" muted playsinline preload="metadata"></video><span class="play">▶</span>`
        : `<img src="${esc(m.url)}" loading="lazy" alt="">`}
      ${i === 3 && p.media.length > 4 ? `<span class="more">+${p.media.length - 4}</span>` : ''}
    </button>`).join('')}</div>`;
}

function postCard(p) {
  S.posts.set(p.id, p);
  const mine = p.userId === S.me.id;
  return `<article class="card post" data-id="${p.id}">
    <header class="post-h">
      ${avatar(p.userId)}
      <div class="grow"><b>${esc(nameOf(p.userId))}</b><time datetime="${p.createdAt}">${icon.clock}${fmtStamp(p.createdAt)}</time></div>
      ${mine ? `<button class="icon-btn" data-act="post-menu" data-id="${p.id}" aria-label="Post options">${icon.more}</button>` : ''}
    </header>
    ${p.eventTitle ? `<span class="tag">🏋️ ${esc(p.eventTitle)}</span>` : ''}
    ${p.body ? `<p class="body">${esc(p.body)}</p>` : ''}
    ${mediaGrid(p)}
    <footer class="post-f">
      <button class="chip ${p.reacted ? 'on' : ''}" data-act="react" data-id="${p.id}" aria-label="Flex">💪 <span>${p.reactCount || ''}</span></button>
      <button class="chip" data-act="comments" data-id="${p.id}" aria-label="Comments">💬 <span>${p.commentCount || ''}</span></button>
    </footer>
  </article>`;
}

function syncPost(p) {
  document.querySelectorAll(`.post[data-id="${p.id}"]`).forEach(c => {
    const r = $('[data-act=react]', c);
    r.classList.toggle('on', p.reacted);
    $('span', r).textContent = p.reactCount || '';
    $('[data-act=comments] span', c).textContent = p.commentCount || '';
  });
}

const empty = (title, text, btn = '') =>
  `<div class="empty"><b>${title}</b><p>${text}</p>${btn}</div>`;

/* ── Today ── */
async function renderToday(seq) {
  const now = new Date();
  const today = ymd(now);
  const start = startOfDay(now);
  const [events, posts, act] = await Promise.all([
    S.db.events(today, ymd(addDays(now, 7))),
    S.db.posts({ after: start.toISOString(), limit: 200 }),
    S.db.activity(addDays(start, -60).toISOString()),
  ]);
  if (stale(seq)) return;

  const todays = events.filter(e => e.date === today);
  const workouts = todays.filter(e => e.kind === 'workout');
  const upcoming = events.filter(e => e.date !== today || e.kind !== 'workout').slice(0, 6);
  const firstPost = new Map();
  for (const p of [...posts].reverse()) if (!firstPost.has(p.userId)) firstPost.set(p.userId, p);
  posts.forEach(p => S.posts.set(p.id, p));

  const members = [...S.members.values()].sort((a, b) => {
    const pa = firstPost.get(a.id), pb = firstPost.get(b.id);
    if (pa && pb) return pa.createdAt.localeCompare(pb.createdAt);
    return pa ? -1 : pb ? 1 : a.name.localeCompare(b.name);
  });
  const done = members.filter(m => firstPost.has(m.id)).length;
  const days = daysByUser(act);
  const myDays = days.get(S.me.id);
  const weekStart = ymd(startOfWeek(now));
  const myWeek = [...(myDays ?? [])].filter(d => d >= weekStart).length;
  const mine = firstPost.get(S.me.id);
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const pct = members.length ? Math.round(done / members.length * 100) : 0;

  const workoutCards = workouts.length ? workouts.map(w => {
    S.events.set(w.id, w);
    return `<section class="card hero">
      <div class="hero-top"><p class="eyebrow">Today's workout</p><button class="link" data-act="event" data-id="${w.id}">Details</button></div>
      <h2>${esc(w.title)}</h2>
      <p class="meta">${icon.clock}${fmtTime(w.time)}${w.location ? ` <span class="dot">·</span> ${icon.pin}${esc(w.location)}` : ''}</p>
      ${planList(w.details)}
      ${mine
        ? `<button class="done-pill" data-act="comments" data-id="${mine.id}">${icon.check} You logged it at ${fmtClock(new Date(mine.createdAt))}</button>`
        : `<button class="btn primary block" data-act="compose" data-event="${w.id}">${icon.camera} Log this workout</button>`}
    </section>`;
  }).join('') : `<section class="card hero rest">
      <p class="eyebrow">Today's workout</p>
      <h2>Nothing scheduled</h2>
      <p class="meta">Rest day, or nobody has posted the plan yet.</p>
      <div class="btn-row">
        <button class="btn" data-act="new-event" data-date="${today}">Schedule workout</button>
        <button class="btn primary" data-act="compose">Log a workout</button>
      </div>
    </section>`;

  app.innerHTML = `<div class="v-today">
    <header class="top">
      <div><p class="eyebrow">${fmt(now, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1>${greet}, ${esc(S.me.name.split(' ')[0])}</h1></div>
      <button class="av-btn" data-act="tab" data-tab="crew" aria-label="Your crew">${avatar(S.me.id, 'lg')}</button>
    </header>

    <div class="stats">
      <div class="stat"><b>${streakOf(myDays)}<span>🔥</span></b><small>Day streak</small></div>
      <div class="stat"><b>${myWeek}</b><small>This week</small></div>
      <div class="stat"><b>${done}<span class="of">/${members.length}</span></b><small>Crew today</small></div>
    </div>

    ${workoutCards}

    <section class="card">
      <div class="sec-h"><h3>Crew check-in</h3><span class="muted">${done} of ${members.length} done</span></div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <div class="crew-grid">
        ${members.map(m => {
          const p = firstPost.get(m.id);
          return `<button class="crew-m ${p ? 'done' : ''}" ${p ? `data-act="comments" data-id="${p.id}"` : 'disabled'}>
            <span class="av-wrap">${avatar(m.id)}${p ? `<span class="badge">${icon.check}</span>` : ''}</span>
            <b>${esc(m.id === S.me.id ? 'You' : m.name.split(' ')[0])}</b>
            <small>${p ? fmtClock(new Date(p.createdAt)) : 'Not yet'}</small>
          </button>`;
        }).join('')}
      </div>
    </section>

    <section class="card list">
      <div class="sec-h"><h3>Coming up</h3><button class="link" data-act="tab" data-tab="calendar">Calendar</button></div>
      ${upcoming.length ? upcoming.map(e => eventRow(e)).join('') : '<p class="muted pad">Nothing on the calendar this week.</p>'}
    </section>

    ${posts.length ? `<div class="sec-h out"><h3>Today's posts</h3></div>${posts.slice(0, 10).map(postCard).join('')}` : ''}
  </div>`;
}

/* ── Feed ── */
async function renderFeed(seq) {
  const posts = await S.db.posts({ limit: S.feedCount });
  if (stale(seq)) return;
  const end = posts.length < S.feedCount;
  app.innerHTML = `<div class="v-feed">
    <header class="top"><div><p class="eyebrow">${esc(S.team.name)}</p><h1>Feed</h1></div></header>
    ${posts.length ? posts.map(postCard).join('') : empty('No posts yet', 'Be the first to log a workout. Add photos or videos so the crew can see the work.', '<button class="btn primary" data-act="compose">Log a workout</button>')}
    ${posts.length && !end ? '<button class="btn ghost block" data-act="more">Load more</button>' : ''}
    ${posts.length && end ? '<p class="muted center pad">That\'s everything 💪</p>' : ''}
  </div>`;
}

/* ── Calendar ── */
async function renderCalendar(seq) {
  const m = S.calMonth;
  const gridStart = addDays(m, -m.getDay());
  const key = ymd(m);
  if (S.cal?.key !== key) {
    const [events, act] = await Promise.all([
      S.db.events(ymd(gridStart), ymd(addDays(gridStart, 41))),
      S.db.activity(gridStart.toISOString(), addDays(gridStart, 42).toISOString()),
    ]);
    if (stale(seq)) return;
    S.cal = { key, events, act };
  }
  const { events, act } = S.cal;
  const byDay = new Map();
  for (const e of events) {
    S.events.set(e.id, e);
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  }
  const trained = new Map();
  for (const a of act) {
    const d = ymd(new Date(a.createdAt));
    if (!trained.has(d)) trained.set(d, new Set());
    trained.get(d).add(a.userId);
  }
  const today = todayYmd();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = addDays(gridStart, i);
    const k = ymd(d);
    const evs = byDay.get(k) ?? [];
    const kinds = [...new Set(evs.map(e => e.kind))];
    const cls = [
      d.getMonth() !== m.getMonth() && 'out',
      k === today && 'today',
      k === S.calDay && 'sel',
      trained.get(k)?.has(S.me.id) && 'trained',
    ].filter(Boolean).join(' ');
    return `<button class="day ${cls}" data-act="cal-day" data-date="${k}" aria-label="${fmtDayLong(k)}">
      <span class="num">${d.getDate()}</span>
      <span class="dots">${kinds.map(kd => `<i class="k-${kd}"></i>`).join('')}</span>
    </button>`;
  }).join('');

  const selEvents = byDay.get(S.calDay) ?? [];
  const who = [...(trained.get(S.calDay) ?? [])];
  const isPast = S.calDay <= today;

  app.innerHTML = `<div class="v-calendar">
    <header class="top">
      <div><p class="eyebrow">${m.getFullYear()}</p><h1>${fmt(m, { month: 'long' })}</h1></div>
      <div class="top-actions">
        <button class="icon-btn round" data-act="cal-move" data-n="-1" aria-label="Previous month">${icon.chevL}</button>
        <button class="btn sm" data-act="cal-today">Today</button>
        <button class="icon-btn round" data-act="cal-move" data-n="1" aria-label="Next month">${icon.chevR}</button>
      </div>
    </header>
    <section class="card cal">
      <div class="wk">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span>${d}</span>`).join('')}</div>
      <div class="grid">${cells}</div>
      <div class="legend"><span><i class="k-workout"></i>Workout</span><span><i class="k-social"></i>Get-together</span><span><i class="k-other"></i>Other</span><span><i class="ring"></i>You trained</span></div>
    </section>
    <section class="card list">
      <div class="sec-h"><h3>${fmtDayLong(S.calDay)}</h3><button class="btn sm primary" data-act="new-event" data-date="${S.calDay}">${icon.plus}Add</button></div>
      ${selEvents.length ? selEvents.map(e => eventRow(e, { showDate: false })).join('') : '<p class="muted pad">No events. Tap Add to schedule a workout or get-together.</p>'}
    </section>
    ${isPast ? `<section class="card">
      <div class="sec-h"><h3>Who trained</h3><span class="muted">${who.length} of ${S.members.size}</span></div>
      ${who.length ? `<div class="who">${who.map(id => avatar(id)).join('')}</div>
        <button class="btn ghost block" data-act="day-posts" data-date="${S.calDay}">See posts from this day</button>`
        : '<p class="muted">No workouts logged this day.</p>'}
    </section>` : ''}
  </div>`;
}

/* ── Crew ── */
async function renderCrew(seq) {
  const now = new Date();
  const act = await S.db.activity(addDays(startOfDay(now), -60).toISOString());
  if (stale(seq)) return;
  const days = daysByUser(act);
  const weekStart = ymd(startOfWeek(now));
  const rows = [...S.members.values()].map(m => {
    const d = days.get(m.id);
    return { ...m, week: [...(d ?? [])].filter(x => x >= weekStart).length, streak: streakOf(d) };
  }).sort((a, b) => b.week - a.week || b.streak - a.streak || a.name.localeCompare(b.name));

  app.innerHTML = `<div class="v-crew">
    <header class="top"><div><p class="eyebrow">Your crew</p><h1>${esc(S.team.name)}</h1></div></header>
    ${isDemo ? `<section class="card demo">
      <b>Demo mode</b>
      <p>You're looking at a sample crew and everything stays on this phone. Follow the setup guide (README) to connect Supabase so your whole crew can sign in and share.</p>
      <button class="btn sm" data-act="reset-demo">Reset demo data</button>
    </section>` : ''}
    <section class="card invite">
      <div><p class="eyebrow">Invite code</p><p class="code">${esc(S.team.code)}</p><p class="muted">Send this code to your crew. They sign up and enter it to join.</p></div>
      <button class="btn primary" data-act="share-code">Share</button>
    </section>
    <section class="card list">
      <div class="sec-h"><h3>This week</h3><span class="muted">Workouts since Monday</span></div>
      ${rows.map((r, i) => `<div class="row static">
        <span class="rank">${i + 1}</span>${avatar(r.id)}
        <span class="grow"><b>${esc(r.name)}${r.id === S.me.id ? ' <em>(you)</em>' : ''}</b><small>${r.streak ? `🔥 ${r.streak}-day streak` : 'No active streak'}</small></span>
        <span class="count">${r.week}</span>
      </div>`).join('')}
    </section>
    <section class="card">
      <h3>Your profile</h3>
      <form class="inline-form" data-form="rename">
        <input name="name" value="${esc(S.me.name)}" maxlength="40" required aria-label="Display name">
        <button class="btn">Save</button>
      </form>
      ${isDemo ? '' : `<div class="btn-row">
        <button class="btn ghost" data-act="signout">Sign out</button>
        <button class="btn ghost danger" data-act="leave">Leave crew</button>
      </div>`}
    </section>
  </div>`;
}

/* ── Post detail & comments ── */
async function openPost(id) {
  const p = S.posts.get(id);
  if (!p) return;
  const sheet = openSheet(`<div class="sheet-body">
      ${postCard(p)}
      <h3 class="sec">Comments</h3>
      <div class="comments"><div class="spinner"></div></div>
    </div>
    <form class="comment-form">
      <input name="body" placeholder="Add a comment…" autocomplete="off" maxlength="1000" aria-label="Comment">
      <button class="btn primary sm">Send</button>
    </form>`);
  const load = async () => {
    const list = await S.db.comments(id);
    p.commentCount = list.length;
    syncPost(p);
    $('.comments', sheet).innerHTML = list.length ? list.map(c => `<div class="comment">
        ${avatar(c.userId, 'sm')}
        <div class="grow"><p><b>${esc(nameOf(c.userId))}</b> ${esc(c.body)}</p><small>${fmtStamp(c.createdAt)}</small></div>
        ${c.userId === S.me.id ? `<button class="icon-btn" data-act="del-comment" data-id="${c.id}" data-post="${id}" aria-label="Delete comment">✕</button>` : ''}
      </div>`).join('') : '<p class="muted">No comments yet. Hype them up.</p>';
  };
  sheet.reload = load;
  $('.comment-form', sheet).addEventListener('submit', async e => {
    e.preventDefault();
    const input = e.target.body;
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try { await S.db.addComment(id, body); await load(); } catch (err) { toastErr(err); }
  });
  try { await load(); } catch (e) { toastErr(e); }
}

async function openDayPosts(date) {
  const start = parseYmd(date);
  const posts = await S.db.posts({ after: start.toISOString(), before: addDays(start, 1).toISOString(), limit: 200 });
  openSheet(`<div class="sheet-body">
    <h2>${fmtDayLong(date)}</h2>
    ${posts.length ? posts.map(postCard).join('') : '<p class="muted">No posts.</p>'}
  </div>`);
}

/* ── Media viewer ── */
function openViewer(id, start) {
  const p = S.posts.get(id);
  const n = p.media.length;
  let idx = start;
  const v = document.createElement('div');
  v.className = 'viewer';
  const show = () => {
    const m = p.media[idx];
    v.innerHTML = `<button class="vx" data-x aria-label="Close">✕</button>
      ${m.type === 'video' ? `<video src="${esc(m.url)}" controls autoplay playsinline></video>` : `<img src="${esc(m.url)}" alt="">`}
      ${n > 1 ? `<button class="vnav prev" data-nav="-1" aria-label="Previous">${icon.chevL}</button>
        <button class="vnav next" data-nav="1" aria-label="Next">${icon.chevR}</button>` : ''}
      <div class="vcap"><b>${esc(nameOf(p.userId))}</b> · ${fmtStamp(p.createdAt)}${n > 1 ? ` · ${idx + 1}/${n}` : ''}</div>`;
  };
  const step = d => { idx = (idx + d + n) % n; show(); };
  show();
  v.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) return step(+nav.dataset.nav);
    if (e.target.closest('[data-x]') || e.target === v) v.remove();
  });
  let x0 = null;
  v.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  v.addEventListener('touchend', e => {
    if (x0 === null || n < 2) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    x0 = null;
  });
  document.body.append(v);
}

/* ── Composer ── */
const MAX_FILES = 10;
const MAX_VIDEO_MB = 50;

function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Couldn't read that photo")); };
    img.src = url;
  });
}

async function compressImage(file, max = 1600) {
  const { img, url } = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.82));
}

async function openComposer(eventId) {
  const today = todayYmd();
  const workouts = (await S.db.events(today, today)).filter(e => e.kind === 'workout');
  if (!eventId && workouts.length) eventId = workouts[0].id;
  const files = [];
  const sheet = openSheet(`<form class="composer sheet-body">
    <h2>Log workout</h2>
    <label class="field"><span>Workout</span>
      <select name="event">
        ${workouts.map(e => `<option value="${e.id}" ${e.id === eventId ? 'selected' : ''}>${esc(e.title)} (today)</option>`).join('')}
        <option value="" ${eventId ? '' : 'selected'}>Something else / my own</option>
      </select>
    </label>
    <label class="field"><span>What did you do?</span>
      <textarea name="body" rows="5" maxlength="4000" placeholder="Sets, reps, weights, how it felt…"></textarea>
    </label>
    <div class="previews"></div>
    <label class="btn ghost block add-media">${icon.camera} Add photos or videos
      <input class="vh" type="file" accept="image/*,video/*" multiple>
    </label>
    <p class="hint">${icon.clock} Your post is timestamped the moment you share it.</p>
    <button class="btn primary block lg" type="submit">Post</button>
  </form>`);
  const form = $('form', sheet);
  const previews = $('.previews', sheet);

  const drawPreviews = () => {
    previews.innerHTML = files.map((f, i) => `<div class="pv">
      ${f.kind === 'video' ? `<video src="${f.url}#t=0.1" muted playsinline preload="metadata"></video><span class="play">▶</span>` : `<img src="${f.url}" alt="">`}
      <button type="button" class="pv-x" data-i="${i}" aria-label="Remove">✕</button>
    </div>`).join('');
  };
  previews.addEventListener('click', e => {
    const x = e.target.closest('.pv-x');
    if (!x) return;
    const [f] = files.splice(+x.dataset.i, 1);
    URL.revokeObjectURL(f.url);
    drawPreviews();
  });

  $('input[type=file]', sheet).addEventListener('change', async e => {
    const picked = [...e.target.files];
    e.target.value = '';
    for (const file of picked) {
      if (files.length >= MAX_FILES) { toast(`Up to ${MAX_FILES} photos/videos per post`, true); break; }
      try {
        if (file.type.startsWith('video/')) {
          if (file.size > MAX_VIDEO_MB * 1024 * 1024) { toast(`Videos must be under ${MAX_VIDEO_MB} MB. Try a shorter clip.`, true); continue; }
          files.push({ blob: file, kind: 'video', type: file.type || 'video/mp4', url: URL.createObjectURL(file) });
        } else {
          const blob = await compressImage(file);
          files.push({ blob, kind: 'image', type: blob.type || 'image/jpeg', url: URL.createObjectURL(blob) });
        }
      } catch (err) { toastErr(err); }
    }
    drawPreviews();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body && !files.length) return toast('Add a note or a photo first', true);
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = files.length ? `Uploading 0/${files.length}…` : 'Posting…';
    try {
      await S.db.createPost({
        body, eventId: form.event.value || null, files,
        onProgress: (i, n) => { btn.textContent = `Uploading ${i}/${n}…`; },
      });
      files.forEach(f => URL.revokeObjectURL(f.url));
      S.cal = null;
      closeSheet(sheet);
      toast('Posted 💪');
      if (S.tab === 'today' || S.tab === 'feed') refresh(); else go('feed');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Post';
      toastErr(err);
    }
  });
}

/* ── Events ── */
function openEvent(id) {
  const e = S.events.get(id);
  if (!e) return;
  const isToday = e.date === todayYmd();
  const sheet = openSheet(`<div class="sheet-body event-view">
    <span class="tag k-${e.kind}">${kindLabel(e.kind)}</span>
    <h2>${esc(e.title)}</h2>
    <p class="meta">${fmtDayLong(e.date)}</p>
    <p class="meta">${icon.clock}${fmtTime(e.time)}${e.location ? ` <span class="dot">·</span> ${icon.pin}${esc(e.location)}` : ''}</p>
    ${planList(e.details)}
    ${e.createdBy ? `<p class="muted small">Added by ${esc(nameOf(e.createdBy))}</p>` : ''}
    ${e.kind === 'workout' && isToday ? `<button class="btn primary block" data-act="compose" data-event="${e.id}">${icon.camera} Log this workout</button>` : ''}
    <div class="btn-row">
      <button class="btn" data-act="edit-event" data-id="${e.id}">Edit</button>
      <button class="btn ghost danger" data-act="del-event" data-id="${e.id}">Delete</button>
    </div>
  </div>`);
  return sheet;
}

function openEventForm(ev = {}) {
  const isNew = !ev.id;
  const kind = ev.kind || 'workout';
  const sheet = openSheet(`<form class="sheet-body ev-form">
    <h2>${isNew ? 'New event' : 'Edit event'}</h2>
    <div class="seg" role="radiogroup" aria-label="Type">
      ${KINDS.map(([k, label]) => `<label><input type="radio" name="kind" value="${k}" ${kind === k ? 'checked' : ''}><span>${label}</span></label>`).join('')}
    </div>
    <label class="field"><span>Title</span><input name="title" required maxlength="100" value="${esc(ev.title || '')}" placeholder="Push Day"></label>
    <div class="two">
      <label class="field"><span>Date</span><input type="date" name="date" required value="${ev.date || S.calDay}"></label>
      <label class="field"><span>Time <em>optional</em></span><input type="time" name="time" value="${ev.time || ''}"></label>
    </div>
    <label class="field"><span>Location</span><input name="location" maxlength="120" value="${esc(ev.location || '')}" placeholder="Gym, park, someone's house…"></label>
    <label class="field"><span>Details</span><textarea name="details" rows="6" maxlength="4000" placeholder="One exercise per line, e.g.&#10;Bench press 5×5&#10;Incline DB press 4×10">${esc(ev.details || '')}</textarea></label>
    ${isNew ? `<label class="field"><span>Repeat</span><select name="repeat">
      <option value="0">Does not repeat</option>
      <option value="4">Weekly for 4 weeks</option>
      <option value="8">Weekly for 8 weeks</option>
      <option value="12">Weekly for 12 weeks</option>
    </select></label>` : ''}
    <button class="btn primary block lg" type="submit">${isNew ? 'Add to calendar' : 'Save changes'}</button>
  </form>`);
  const form = $('form', sheet);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form);
    const data = {
      kind: f.get('kind'), title: f.get('title').trim(), date: f.get('date'),
      time: f.get('time') || null, location: f.get('location').trim(), details: f.get('details').trim(),
    };
    if (!data.title || !data.date) return;
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      if (isNew) {
        const weeks = +(f.get('repeat') || 0);
        const list = [data];
        for (let i = 1; i < weeks; i++) list.push({ ...data, date: ymd(addDays(parseYmd(data.date), 7 * i)) });
        await S.db.addEvents(list);
      } else {
        await S.db.updateEvent({ ...data, id: ev.id });
      }
      S.cal = null;
      S.calDay = data.date;
      closeSheet(sheet);
      toast(isNew ? 'Added to calendar' : 'Saved');
      refresh();
    } catch (err) { btn.disabled = false; toastErr(err); }
  });
}

/* ── Actions (event delegation) ── */
const actions = {
  tab: el => go(el.dataset.tab),
  compose: el => { closeSheet(); return openComposer(el.dataset.event); },
  comments: (el, id) => openPost(id),
  view: (el, id) => openViewer(id, +el.dataset.i),
  more: () => { S.feedCount += 20; return go('feed', { keep: true }); },
  event: (el, id) => openEvent(id),
  'new-event': el => openEventForm({ date: el.dataset.date }),
  'edit-event': (el, id) => { closeSheet(el); openEventForm(S.events.get(id)); },
  'del-event': async (el, id) => {
    if (!confirm('Delete this event for everyone?')) return;
    await S.db.deleteEvent(id);
    S.cal = null;
    closeSheet(el);
    toast('Event deleted');
    refresh();
  },
  'day-posts': el => openDayPosts(el.dataset.date),
  'cal-day': el => {
    S.calDay = el.dataset.date;
    const d = parseYmd(S.calDay);
    if (d.getMonth() !== S.calMonth.getMonth()) S.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    return go('calendar', { keep: true });
  },
  'cal-move': el => {
    const m = S.calMonth;
    S.calMonth = new Date(m.getFullYear(), m.getMonth() + +el.dataset.n, 1);
    S.calDay = S.calMonth.getMonth() === new Date().getMonth() && S.calMonth.getFullYear() === new Date().getFullYear() ? todayYmd() : ymd(S.calMonth);
    return go('calendar', { keep: true });
  },
  'cal-today': () => {
    const now = new Date();
    S.calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    S.calDay = todayYmd();
    return go('calendar', { keep: true });
  },
  react: async (el, id) => {
    const p = S.posts.get(id);
    p.reacted = !p.reacted;
    p.reactCount += p.reacted ? 1 : -1;
    syncPost(p);
    try { await S.db.toggleReaction(id, p.reacted); } catch (e) {
      p.reacted = !p.reacted;
      p.reactCount += p.reacted ? 1 : -1;
      syncPost(p);
      throw e;
    }
  },
  'post-menu': async (el, id) => {
    if (!confirm('Delete this post? This can\'t be undone.')) return;
    await S.db.deletePost(S.posts.get(id));
    S.cal = null;
    if (el.closest('.sheet')) closeSheet(el);
    toast('Post deleted');
    refresh();
  },
  'del-comment': async el => {
    await S.db.deleteComment(el.dataset.id);
    await el.closest('.sheet').reload();
  },
  'share-code': async () => {
    const url = location.href.split('#')[0];
    const text = `Join ${S.team.name} on Squad! Open ${url} , create an account, and enter invite code ${S.team.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my crew on Squad', text }); } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
      toast('Invite copied');
    }
  },
  signout: async () => {
    await S.db.signOut();
    location.reload();
  },
  leave: async () => {
    if (!confirm(`Leave ${S.team.name}? You can rejoin later with the invite code.`)) return;
    await S.db.leaveTeam();
    location.reload();
  },
  'reset-demo': async () => {
    if (!confirm('Reset all demo data?')) return;
    await S.db.reset();
    location.reload();
  },
};

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try { await fn(el, el.dataset.id, e); } catch (err) { toastErr(err); }
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form=rename]');
  if (!form) return;
  e.preventDefault();
  const name = form.name.value.trim();
  if (!name) return;
  try {
    await S.db.renameMe(name);
    toast('Name updated');
    refresh();
  } catch (err) { toastErr(err); }
});

/* ── Auth & onboarding ── */
function renderAuth(mode = 'in', msg = '') {
  tabbar.hidden = true;
  app.innerHTML = `<div class="auth">
    <div class="brand"><img src="icons/icon.svg" alt=""><h1>Squad</h1><p>Train together, even when you're apart.</p></div>
    <form class="card auth-form">
      <div class="seg">
        <label><input type="radio" name="mode" value="in" ${mode === 'in' ? 'checked' : ''}><span>Sign in</span></label>
        <label><input type="radio" name="mode" value="up" ${mode === 'up' ? 'checked' : ''}><span>Create account</span></label>
      </div>
      ${mode === 'up' ? '<label class="field"><span>Your name</span><input name="name" required maxlength="40" autocomplete="name" placeholder="John"></label>' : ''}
      <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email" inputmode="email"></label>
      <label class="field"><span>Password</span><input name="password" type="password" required minlength="6" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}"></label>
      <p class="msg">${esc(msg)}</p>
      <button class="btn primary block lg">${mode === 'up' ? 'Create account' : 'Sign in'}</button>
    </form>
  </div>`;
  const form = $('.auth-form');
  form.addEventListener('change', e => { if (e.target.name === 'mode') renderAuth(e.target.value); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button.primary', form);
    btn.disabled = true;
    try {
      const email = form.email.value.trim(), pw = form.password.value;
      const res = mode === 'up'
        ? await S.db.signUp(email, pw, form.name.value.trim())
        : await S.db.signIn(email, pw);
      if (res.needsConfirm) return renderAuth('in', 'Check your email to confirm your account, then sign in.');
      await route(res);
    } catch (err) {
      btn.disabled = false;
      $('.msg', form).textContent = err.message;
    }
  });
}

function renderOnboard() {
  tabbar.hidden = true;
  app.innerHTML = `<div class="auth">
    <div class="brand"><img src="icons/icon.svg" alt=""><h1>Hey ${esc(S.me.name.split(' ')[0])} 👋</h1><p>Join your crew with their invite code, or start a new one.</p></div>
    <form class="card" data-onboard="join">
      <h3>Join a crew</h3>
      <label class="field"><span>Invite code</span><input name="code" required maxlength="12" autocapitalize="characters" autocomplete="off" placeholder="ABC123" class="code-in"></label>
      <button class="btn primary block">Join</button>
    </form>
    <p class="or">or</p>
    <form class="card" data-onboard="create">
      <h3>Start a new crew</h3>
      <label class="field"><span>Crew name</span><input name="name" required maxlength="60" placeholder="Iron Crew"></label>
      <button class="btn block">Create crew</button>
    </form>
    <button class="link center-block" data-act="signout">Sign out</button>
  </div>`;
  app.querySelectorAll('[data-onboard]').forEach(form => form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button', form);
    btn.disabled = true;
    try {
      const res = form.dataset.onboard === 'join'
        ? await S.db.joinTeam(form.code.value.trim().toUpperCase())
        : await S.db.createTeam(form.name.value.trim());
      await route(res);
    } catch (err) { btn.disabled = false; toastErr(err); }
  }));
}

async function route(sess) {
  if (!sess) return renderAuth();
  S.me = sess.user;
  S.team = sess.team;
  if (!S.team) return renderOnboard();
  await loadMembers();
  S.unsub?.();
  let t;
  S.unsub = S.db.subscribe(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      S.cal = null;
      if (document.querySelector('.sheet-wrap')) S.dirty = true; else refresh();
    }, 500);
  });
  tabbar.hidden = false;
  go(S.tab);
}

/* ── Boot ── */
tabbar.innerHTML = `
  <button data-act="tab" data-tab="today">${icon.today}<span>Today</span></button>
  <button data-act="tab" data-tab="feed">${icon.feed}<span>Feed</span></button>
  <button class="fab" data-act="compose" aria-label="Log workout">${icon.plus}</button>
  <button data-act="tab" data-tab="calendar">${icon.calendar}<span>Calendar</span></button>
  <button data-act="tab" data-tab="crew">${icon.crew}<span>Crew</span></button>`;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.team) { S.cal = null; refresh(); }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

(async () => {
  try {
    S.db = await createBackend();
    await route(await S.db.session());
  } catch (e) {
    console.error(e);
    app.innerHTML = empty("Couldn't start", esc(e.message || 'Check your connection and try again.'), '<button class="btn primary" onclick="location.reload()">Retry</button>');
  }
})();
