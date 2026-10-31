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
  board: 'total',
  nDay: null,   // null = today
  nUser: null,  // whose nutrition is shown; null = me
  stats: null,
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
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  food: '<svg viewBox="0 0 24 24"><path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M18 3c-2.2 1-3.5 3.6-3.5 7.5H18V21"/></svg>',
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
const views = { today: renderToday, feed: renderFeed, calendar: renderCalendar, nutrition: renderNutrition, crew: renderCrew };
const nDay = () => S.nDay ?? todayYmd();
let renderSeq = 0;

async function go(tab, { keep = false } = {}) {
  S.tab = tab;
  tabbar.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === (tab === 'calendar' ? 'today' : tab)));
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

function exerciseList(list = []) {
  if (!list.length) return '';
  return `<ul class="ex-done">${list.map(x => {
    const sr = x.sets && x.reps ? `${x.sets} × ${esc(String(x.reps))}` : x.sets ? `${x.sets} sets` : x.reps ? `${esc(String(x.reps))} reps` : '';
    return `<li><b>${esc(x.name)}</b><span>${[sr, x.weight ? `${num(x.weight)} lb` : ''].filter(Boolean).join(' @ ')}</span></li>`;
  }).join('')}</ul>`;
}

// "Bench press 5×5" → { name: 'Bench press', sets: 5, reps: 5 }
function parsePlan(details) {
  return (details || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)[\s:-]+(\d+)\s*[×xX]\s*(\d+|AMRAP)?/i);
    return m ? { name: m[1].trim(), sets: +m[2], reps: m[3] && /\d/.test(m[3]) ? +m[3] : null } : { name: l, sets: null, reps: null };
  });
}

function postCard(p) {
  S.posts.set(p.id, p);
  const mine = p.userId === S.me.id;
  return `<article class="card post" data-id="${p.id}">
    <header class="post-h">
      <button class="av-btn" data-act="profile" data-id="${p.userId}" aria-label="${esc(nameOf(p.userId))}'s profile">${avatar(p.userId)}</button>
      <div class="grow"><b>${esc(nameOf(p.userId))}</b><time datetime="${p.createdAt}">${icon.clock}${fmtStamp(p.createdAt)}</time></div>
      ${mine ? `<button class="icon-btn" data-act="post-menu" data-id="${p.id}" aria-label="Post options">${icon.more}</button>` : ''}
    </header>
    ${p.eventTitle ? `<span class="tag">🏋️ ${esc(p.eventTitle)}</span>` : ''}
    ${p.body ? `<p class="body">${esc(p.body)}</p>` : ''}
    ${exerciseList(p.exercises)}
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
  const [events, posts, act, food, ngoals, stats] = await Promise.all([
    S.db.events(today, ymd(addDays(now, 7))),
    S.db.posts({ after: start.toISOString(), limit: 200 }),
    S.db.activity(addDays(start, -60).toISOString()),
    S.db.foodLogs(today, today),
    S.db.nutritionGoals(),
    S.db.stats(),
  ]);
  if (stale(seq)) return;
  S.stats = stats;
  const fuelT = targetsFor(S.me.id, ngoals, stats);
  const fuel = sumFood(food.filter(f => f.userId === S.me.id));

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
      <div class="top-actions">
        <button class="icon-btn round" data-act="tab" data-tab="calendar" aria-label="Calendar">${icon.calendar}</button>
        <button class="av-btn" data-act="profile" data-id="${S.me.id}" aria-label="My profile">${avatar(S.me.id, 'lg')}</button>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><b>${streakOf(myDays)}<span>🔥</span></b><small>Day streak</small></div>
      <div class="stat"><b>${myWeek}</b><small>This week</small></div>
      <div class="stat"><b>${done}<span class="of">/${members.length}</span></b><small>Crew today</small></div>
    </div>

    <button class="card coach-cta" data-act="coach">
      <span class="coach-icon">${icon.spark}</span>
      <span class="grow"><b>Ask Coach</b><small>Am I on track? What should I train today?</small></span>
      <span class="chev">${icon.chevR}</span>
    </button>

    ${workoutCards}

    <button class="card fuel-mini" data-act="nutrition-me">
      <span class="grow">
        <p class="eyebrow">Today's fuel</p>
        ${fuelT ? `<b>${num(fuel.calories)} <small>/ ${num(fuelT.calories)} kcal</small></b>
          ${macroBar('Protein', fuel.protein, fuelT.protein)}`
          : `<b>Set your nutrition targets</b><small class="muted">Calories and macros for your goal</small>`}
      </span>
      <span class="chev">${icon.chevR}</span>
    </button>

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
      <div><button class="link back" data-act="tab" data-tab="today">${icon.chevL}Today</button><h1>${fmt(m, { month: 'long' })}${m.getFullYear() !== new Date().getFullYear() ? ` <span class="yr">${m.getFullYear()}</span>` : ''}</h1></div>
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

/* ── Stats helpers ── */
const LIFTS = [['bench', 'Bench'], ['squat', 'Squat'], ['deadlift', 'Deadlift'], ['ohp', 'Overhead press'], ['pullup', 'Pull-ups']];
const BIG3 = ['bench', 'squat', 'deadlift'];
const liftName = l => LIFTS.find(([k]) => k === l)?.[1] ?? l;
const num = v => (Math.round(v * 10) / 10).toLocaleString();
const fmtLift = (lift, v) => lift === 'pullup' ? `${num(v)} reps` : `${num(v)} lb`;
const fmtHeight = h => h ? `${Math.floor(h / 12)}′${h % 12}″` : null;
const fmtShortDate = s => fmt(parseYmd(s), { month: 'short', day: 'numeric', year: parseYmd(s).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

// Best entry per lift for one person: { bench: entry, ... }
function bestLifts(stats, uid) {
  const best = {};
  for (const e of stats.lifts) {
    if (e.userId !== uid) continue;
    if (!best[e.lift] || e.value > best[e.lift].value) best[e.lift] = e;
  }
  return best;
}

const latestWeighIn = (stats, uid) => stats.weighins.filter(w => w.userId === uid).at(-1);

/* ── Crew ── */
async function renderCrew(seq) {
  const now = new Date();
  const [act, stats] = await Promise.all([
    S.db.activity(addDays(startOfDay(now), -60).toISOString()),
    S.db.stats(),
  ]);
  if (stale(seq)) return;
  S.stats = stats;
  const days = daysByUser(act);
  const weekStart = ymd(startOfWeek(now));
  const rows = [...S.members.values()].map(m => {
    const d = days.get(m.id);
    return { ...m, week: [...(d ?? [])].filter(x => x >= weekStart).length, streak: streakOf(d) };
  }).sort((a, b) => b.week - a.week || b.streak - a.streak || a.name.localeCompare(b.name));

  const board = [...S.members.values()].map(m => {
    const best = bestLifts(stats, m.id);
    if (S.board === 'total') {
      const have = BIG3.filter(l => best[l]);
      return { m, value: have.length === 3 ? have.reduce((s, l) => s + best[l].value, 0) : null, note: have.length === 3 ? BIG3.map(l => num(best[l].value)).join(' / ') : 'Needs bench, squat and deadlift' };
    }
    const e = best[S.board];
    return { m, value: e?.value ?? null, note: e ? fmtShortDate(e.date) : 'No max logged' };
  }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.m.name.localeCompare(b.m.name));
  const boardUnit = v => v == null ? '—' : S.board === 'pullup' ? `${num(v)}<small>reps</small>` : `${num(v)}<small>lb</small>`;

  app.innerHTML = `<div class="v-crew">
    <header class="top">
      <div><p class="eyebrow">Your crew</p><h1>${esc(S.team.name)}</h1></div>
      <button class="av-btn" data-act="profile" data-id="${S.me.id}" aria-label="My profile">${avatar(S.me.id, 'lg')}</button>
    </header>
    ${isDemo ? `<section class="card demo">
      <b>Demo mode</b>
      <p>You're looking at a sample crew and everything stays on this phone. Follow the setup guide (README) to connect Supabase so your whole crew can sign in and share.</p>
      <button class="btn sm" data-act="reset-demo">Reset demo data</button>
    </section>` : ''}
    <section class="card list">
      <div class="sec-h"><h3>Lift board</h3><button class="link" data-act="profile" data-id="${S.me.id}">My stats</button></div>
      <div class="chips-scroll">
        ${[['total', 'Big 3 total'], ...LIFTS].map(([k, label]) => `<button class="chip ${S.board === k ? 'on' : ''}" data-act="board" data-lift="${k}">${label}</button>`).join('')}
      </div>
      ${board.map((r, i) => `<button class="row" data-act="profile" data-id="${r.m.id}">
        <span class="rank">${r.value == null ? '' : i + 1}</span>${avatar(r.m.id)}
        <span class="grow"><b>${esc(r.m.name)}${r.m.id === S.me.id ? ' <em>(you)</em>' : ''}</b><small>${esc(r.note)}</small></span>
        <span class="count lift">${boardUnit(r.value)}</span>
      </button>`).join('')}
    </section>
    <section class="card list">
      <div class="sec-h"><h3>This week</h3><span class="muted">Workouts since Monday</span></div>
      ${rows.map((r, i) => `<button class="row" data-act="profile" data-id="${r.id}">
        <span class="rank">${i + 1}</span>${avatar(r.id)}
        <span class="grow"><b>${esc(r.name)}${r.id === S.me.id ? ' <em>(you)</em>' : ''}</b><small>${r.streak ? `🔥 ${r.streak}-day streak` : 'No active streak'}</small></span>
        <span class="count">${r.week}</span>
      </button>`).join('')}
    </section>
    <section class="card invite">
      <div><p class="eyebrow">Invite code</p><p class="code">${esc(S.team.code)}</p><p class="muted">Send this code to your crew. They sign up and enter it to join.</p></div>
      <button class="btn primary" data-act="share-code">Share</button>
    </section>
    ${isDemo ? '' : `<div class="btn-row">
      <button class="btn ghost" data-act="signout">Sign out</button>
      <button class="btn ghost danger" data-act="leave">Leave crew</button>
    </div>`}
  </div>`;
}

/* ── Profiles ── */
// On pace for a dated lift goal? Uses the rate of progress over the last ~6 months.
function liftPace(entries, target, targetDate) {
  const since = ymd(addDays(new Date(), -180));
  const recent = entries.filter(e => e.date >= since);
  if (recent.length < 2) return '<small class="pace">Log another max later to see your pace</small>';
  const best = recent.reduce((a, b) => (b.value > a.value ? b : a));
  const days = (parseYmd(best.date) - parseYmd(recent[0].date)) / 864e5;
  if (days < 14 || best.value <= recent[0].value) return '<small class="pace">Not enough progress logged to project yet</small>';
  const eta = addDays(parseYmd(best.date), Math.ceil((target - best.value) / ((best.value - recent[0].value) / days)));
  const ok = ymd(eta) <= targetDate;
  return `<small class="pace ${ok ? 'ok' : 'behind'}">${ok ? 'On pace' : 'Behind pace'} · at this rate you'll hit it around ${fmt(eta, { month: 'short', day: 'numeric', year: eta.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}</small>`;
}

function goalHtml(g, stats, mine) {
  const best = bestLifts(stats, g.userId);
  let title, progress = '';
  if (g.kind === 'text') {
    title = esc(g.text);
  } else if (g.kind === 'lift') {
    const cur = best[g.lift]?.value ?? 0;
    const pct = Math.min(100, Math.round(cur / g.target * 100));
    title = `${liftName(g.lift)} ${fmtLift(g.lift, g.target)}`;
    const pace = cur && cur < g.target && g.targetDate ? liftPace(stats.lifts.filter(e => e.userId === g.userId && e.lift === g.lift), g.target, g.targetDate) : '';
    progress = `<div class="progress"><span style="width:${pct}%"></span></div>
      <small>${cur ? `Now ${fmtLift(g.lift, cur)} · ${cur >= g.target ? 'reached 🎉' : `${fmtLift(g.lift, g.target - cur)} to go`}` : 'No max logged yet'}</small>${pace}`;
  } else {
    const w = latestWeighIn(stats, g.userId)?.weight;
    title = `Body weight ${num(g.target)} lb`;
    progress = `<small>${w ? `Now ${num(w)} lb · ${Math.abs(w - g.target) < 0.5 ? 'reached 🎉' : `${num(Math.abs(w - g.target))} lb to go`}` : 'No weigh-in yet'}</small>`;
  }
  const due = g.targetDate ? `<small>By ${fmtShortDate(g.targetDate)}</small>` : '';
  return `<div class="goal ${g.done ? 'done' : ''}">
    ${mine ? `<button class="check ${g.done ? 'on' : ''}" data-act="goal-done" data-id="${g.id}" aria-label="Mark done">${icon.check}</button>` : `<span class="check ${g.done ? 'on' : ''}">${icon.check}</span>`}
    <div class="grow"><b>${title}</b>${progress}${due}</div>
    ${mine ? `<button class="icon-btn" data-act="del-goal" data-id="${g.id}" aria-label="Delete goal">✕</button>` : ''}
  </div>`;
}

async function profileHtml(uid) {
  const stats = await S.db.stats();
  S.stats = stats;
  const m = S.members.get(uid) ?? { name: 'Former member' };
  const mine = uid === S.me.id;
  const best = bestLifts(stats, uid);
  const weighins = stats.weighins.filter(w => w.userId === uid);
  const lw = weighins.at(-1);
  const goals = stats.goals.filter(g => g.userId === uid).sort((a, b) => a.done - b.done);
  const total = BIG3.every(l => best[l]) ? BIG3.reduce((s, l) => s + best[l].value, 0) : null;

  // PR history: newest first; mark entries that beat everything before them.
  const hist = [];
  const top = {};
  for (const e of stats.lifts.filter(x => x.userId === uid)) {
    hist.push({ ...e, pr: !top[e.lift] || e.value > top[e.lift] });
    top[e.lift] = Math.max(top[e.lift] ?? 0, e.value);
  }
  hist.reverse();

  const facts = [fmtHeight(m.heightIn), lw ? `${num(lw.weight)} lb` : null, total ? `${num(total)} lb Big 3` : null].filter(Boolean);

  return `<div class="prof-h">
      ${avatar(uid, 'xl')}
      <h2>${esc(m.name)}</h2>
      <p class="muted">${facts.length ? facts.join(' · ') : mine ? 'Add your height and weight' : 'No stats yet'}</p>
      ${mine ? `<div class="btn-row center"><button class="btn sm" data-act="edit-profile">Edit profile</button><button class="btn sm primary" data-act="coach" data-q="Am I on track for my goals?">${icon.spark}Ask Coach</button></div>` : ''}
    </div>

    <div class="sec-h"><h3>Maxes</h3>${mine ? '<button class="link" data-act="log-lift">+ Log a lift</button>' : ''}</div>
    <div class="lift-grid">
      ${LIFTS.map(([k, label]) => {
        const e = best[k];
        return `<${mine ? `button data-act="log-lift" data-lift="${k}"` : 'div'} class="lift-tile">
          <small>${label}</small>
          <b>${e ? `${num(e.value)}<span>${k === 'pullup' ? 'reps' : 'lb'}</span>` : '—'}</b>
          <small>${e ? fmtShortDate(e.date) : mine ? 'Tap to add' : '&nbsp;'}</small>
        </${mine ? 'button' : 'div'}>`;
      }).join('')}
    </div>

    <div class="sec-h"><h3>Goals</h3>${mine ? '<button class="link" data-act="add-goal">+ Add goal</button>' : ''}</div>
    <div class="card list-tight">${goals.length ? goals.map(g => goalHtml(g, stats, mine)).join('') : `<p class="muted">${mine ? 'No goals yet. Add one so the crew can hold you to it.' : 'No goals yet.'}</p>`}</div>

    <div class="sec-h"><h3>Weigh-ins</h3>${mine ? '<button class="link" data-act="log-weight">+ Log weight</button>' : ''}</div>
    <div class="card list-tight">${weighins.length ? [...weighins].reverse().slice(0, 12).map((w, i, arr) => {
      const prev = arr[i + 1];
      const d = prev ? w.weight - prev.weight : 0;
      return `<div class="hist">
        <span class="grow"><b>${num(w.weight)} lb</b><small>${fmtShortDate(w.date)}</small></span>
        ${prev && d ? `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${num(Math.abs(d))}</span>` : ''}
        ${mine ? `<button class="icon-btn" data-act="del-weight" data-id="${w.id}" aria-label="Delete weigh-in">✕</button>` : ''}
      </div>`;
    }).join('') : '<p class="muted">No weigh-ins yet.</p>'}</div>

    <div class="sec-h"><h3>PR history</h3></div>
    <div class="card list-tight">${hist.length ? hist.map(e => `<div class="hist">
        <span class="grow"><b>${liftName(e.lift)} · ${fmtLift(e.lift, e.value)}</b><small>${fmtShortDate(e.date)}</small></span>
        ${e.pr ? '<span class="pr">PR</span>' : ''}
        ${mine ? `<button class="icon-btn" data-act="del-lift" data-id="${e.id}" aria-label="Delete entry">✕</button>` : ''}
      </div>`).join('') : '<p class="muted">No lifts logged yet.</p>'}</div>`;
}

async function openProfile(uid) {
  const sheet = openSheet('<div class="sheet-body profile"><div class="spinner"></div></div>');
  sheet.reload = async () => { $('.profile', sheet).innerHTML = await profileHtml(uid); };
  try { await sheet.reload(); } catch (e) { toastErr(e); }
}

// After any stats change: redraw open profiles, and the Crew tab when its sheet closes.
function statsChanged() {
  document.querySelectorAll('.sheet').forEach(s => s.reload?.());
  if (S.tab === 'crew') S.dirty = true;
}

function heightFields(h) {
  const ft = h ? Math.floor(h / 12) : '';
  const inch = h ? h % 12 : '';
  return `<div class="two">
    <label class="field"><span>Height (ft)</span><select name="ft"><option value=""></option>${[4, 5, 6, 7].map(v => `<option ${v === ft ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="field"><span>Height (in)</span><select name="in"><option value=""></option>${Array.from({ length: 12 }, (_, v) => `<option ${v === inch ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  </div>`;
}
const readHeight = f => f.get('ft') ? +f.get('ft') * 12 + +(f.get('in') || 0) : null;
const numIn = (name, ph, extra = '') => `<input name="${name}" type="number" inputmode="decimal" step="any" min="0" placeholder="${ph}" ${extra}>`;

function formSheet(html, onSubmit) {
  const sheet = openSheet(`<form class="sheet-body">${html}</form>`);
  const form = $('form', sheet);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await onSubmit(new FormData(form));
      closeSheet(sheet);
      statsChanged();
    } catch (err) { btn.disabled = false; toastErr(err); }
  });
  return sheet;
}

function openEditProfile() {
  formSheet(`<h2>Edit profile</h2>
    <label class="field"><span>Name</span><input name="name" required maxlength="40" value="${esc(S.me.name)}"></label>
    ${heightFields(S.members.get(S.me.id)?.heightIn)}
    <button class="btn primary block lg" type="submit">Save</button>`, async f => {
    await S.db.updateProfile({ name: f.get('name').trim(), heightIn: readHeight(f) });
    await loadMembers();
    toast('Profile saved');
    S.dirty = true;
  });
}

function openLiftForm(lift = 'bench') {
  const sheet = formSheet(`<h2>Log a lift</h2>
    <label class="field"><span>Lift</span><select name="lift">${LIFTS.map(([k, l]) => `<option value="${k}" ${k === lift ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="two">
      <label class="field"><span class="unit-label">${lift === 'pullup' ? 'Max reps' : 'Max (lb)'}</span>${numIn('value', lift === 'pullup' ? '15' : '225', 'required')}</label>
      <label class="field"><span>Date</span><input type="date" name="date" required value="${todayYmd()}" max="${todayYmd()}"></label>
    </div>
    <p class="hint">Your best one-rep max${lift === 'pullup' ? '' : ' (or best set)'}. Pull-ups are max reps in one set.</p>
    <button class="btn primary block lg" type="submit">Save</button>`, async f => {
    const l = f.get('lift');
    const best = bestLifts(S.stats ?? { lifts: [] }, S.me.id)[l]?.value ?? 0;
    const value = +f.get('value');
    await S.db.addLift({ lift: l, value, date: f.get('date') });
    toast(value > best && best ? `New ${liftName(l)} PR! 🔥` : 'Saved');
  });
  $('select[name=lift]', sheet).addEventListener('change', e => {
    $('.unit-label', sheet).textContent = e.target.value === 'pullup' ? 'Max reps' : 'Max (lb)';
  });
}

function openWeighInForm() {
  formSheet(`<h2>Log weight</h2>
    <div class="two">
      <label class="field"><span>Weight (lb)</span>${numIn('weight', '185', 'required')}</label>
      <label class="field"><span>Date</span><input type="date" name="date" required value="${todayYmd()}" max="${todayYmd()}"></label>
    </div>
    <button class="btn primary block lg" type="submit">Save</button>`, async f => {
    await S.db.addWeighIn({ weight: +f.get('weight'), date: f.get('date') });
    toast('Saved');
  });
}

function openGoalForm() {
  const sheet = formSheet(`<h2>New goal</h2>
    <div class="seg" role="radiogroup" aria-label="Goal type">
      <label><input type="radio" name="kind" value="lift" checked><span>Lift</span></label>
      <label><input type="radio" name="kind" value="weight"><span>Body weight</span></label>
      <label><input type="radio" name="kind" value="text"><span>Other</span></label>
    </div>
    <div data-for="lift" class="two">
      <label class="field"><span>Lift</span><select name="lift">${LIFTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="field"><span>Target</span>${numIn('liftTarget', '275')}</label>
    </div>
    <label class="field" data-for="weight" hidden><span>Target weight (lb)</span>${numIn('weightTarget', '185')}</label>
    <label class="field" data-for="text" hidden><span>Goal</span><input name="text" maxlength="300" placeholder="Run a sub-25 minute 5K"></label>
    <label class="field"><span>Target date <em>optional</em></span><input type="date" name="targetDate"></label>
    <button class="btn primary block lg" type="submit">Add goal</button>`, async f => {
    const kind = f.get('kind');
    const goal = { kind, targetDate: f.get('targetDate') || null };
    if (kind === 'lift') Object.assign(goal, { lift: f.get('lift'), target: +f.get('liftTarget') });
    if (kind === 'weight') goal.target = +f.get('weightTarget');
    if (kind === 'text') goal.text = f.get('text').trim();
    if (kind === 'text' ? !goal.text : !(goal.target > 0)) throw new Error('Fill in your goal first');
    await S.db.addGoal(goal);
    toast('Goal added');
  });
  sheet.addEventListener('change', e => {
    if (e.target.name !== 'kind') return;
    sheet.querySelectorAll('[data-for]').forEach(el => { el.hidden = el.dataset.for !== e.target.value; });
  });
}

// First-run profile setup, shown once after joining a crew.
const setupKey = () => `crucible-setup-done-${S.me.id}`;
function seenSetup() { try { return !!localStorage.getItem(setupKey()); } catch { return true; } }
function markSetup() { try { localStorage.setItem(setupKey(), '1'); } catch { /* private mode */ } }

async function maybeSetup() {
  if (seenSetup()) return;
  const stats = await S.db.stats();
  if (S.members.get(S.me.id)?.heightIn || stats.lifts.some(l => l.userId === S.me.id)) return markSetup();
  markSetup();
  formSheet(`<h2>Set up your profile</h2>
    <p class="muted intro">Your crew will see these. You can change them any time from your profile.</p>
    <label class="field"><span>Name</span><input name="name" required maxlength="40" value="${esc(S.me.name)}"></label>
    ${heightFields(null)}
    <label class="field"><span>Weight (lb)</span>${numIn('weight', '185')}</label>
    <h3 class="sec">Current maxes</h3>
    <div class="two">
      ${LIFTS.map(([k, l]) => `<label class="field"><span>${l}${k === 'pullup' ? ' (reps)' : ' (lb)'}</span>${numIn(`lift_${k}`, '—')}</label>`).join('')}
    </div>
    <label class="field"><span>Your goal <em>optional</em></span><input name="goal" maxlength="300" placeholder="Bench 275 by summer, drop 10 lb…"></label>
    <button class="btn primary block lg" type="submit">Save profile</button>
    <button class="btn ghost block skip" type="button" data-close>Skip for now</button>`, async f => {
    const date = todayYmd();
    await S.db.updateProfile({ name: f.get('name').trim(), heightIn: readHeight(f) });
    if (+f.get('weight') > 0) await S.db.addWeighIn({ weight: +f.get('weight'), date });
    for (const [k] of LIFTS) if (+f.get(`lift_${k}`) > 0) await S.db.addLift({ lift: k, value: +f.get(`lift_${k}`), date });
    if (f.get('goal').trim()) await S.db.addGoal({ kind: 'text', text: f.get('goal').trim() });
    await loadMembers();
    toast('Profile saved 💪');
    S.dirty = true;
  });
}

/* ── Nutrition ── */
const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']];
const GOALS = [['cut', 'Lose fat'], ['maintain', 'Maintain'], ['bulk', 'Build muscle']];
const ACTIVITY = [1.2, 1.3, 1.375, 1.45, 1.55, 1.6, 1.725, 1.8]; // by training days per week
const r10 = n => Math.round(n / 10) * 10;

// Daily calorie and macro targets. Mifflin-St Jeor for resting burn, scaled by training
// days, then adjusted for the goal (paced to the target date when there is one).
// Protein is 1 g per lb (goal weight when cutting), fat 25% of calories, carbs the rest.
function calcTargets({ sex, birthYear, trainingDays, goal, targetWeight, targetDate, weight, heightIn, calories, protein, carbs, fat }) {
  let auto = null;
  if (sex && birthYear && weight && heightIn) {
    const age = new Date().getFullYear() - birthYear;
    const bmr = 10 * weight * 0.4536 + 6.25 * heightIn * 2.54 - 5 * age + (sex === 'male' ? 5 : -161);
    const tdee = bmr * ACTIVITY[trainingDays ?? 3];
    let adj = { cut: -500, maintain: 0, bulk: 300 }[goal] ?? 0;
    const weeks = targetDate ? (parseYmd(targetDate) - startOfDay(new Date())) / (7 * 864e5) : 0;
    if (goal !== 'maintain' && targetWeight && weeks > 1) {
      adj = (targetWeight - weight) / weeks * 500;
      adj = goal === 'cut' ? Math.min(-250, Math.max(-750, adj)) : Math.max(150, Math.min(400, adj));
    }
    const kcal = r10(tdee + adj);
    const p = Math.round(goal === 'cut' && targetWeight ? Math.min(weight, targetWeight) : weight);
    const f = Math.round(kcal * 0.25 / 9);
    auto = { calories: kcal, protein: p, fat: f, carbs: Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4)), tdee: r10(tdee), perWeek: Math.round(adj / 500 * 10) / 10 };
  }
  if (!auto && !calories) return null;
  const t = { ...(auto ?? { calories: 0, protein: 0, carbs: 0, fat: 0 }) };
  if (calories) t.calories = calories;
  if (protein != null) t.protein = protein;
  if (carbs != null) t.carbs = carbs;
  if (fat != null) t.fat = fat;
  t.custom = [calories, protein, carbs, fat].some(v => v != null);
  return t;
}

function targetsFor(uid, ngoals, stats) {
  const g = ngoals.find(x => x.userId === uid);
  if (!g) return null;
  return calcTargets({ ...g, weight: latestWeighIn(stats, uid)?.weight, heightIn: S.members.get(uid)?.heightIn });
}

const sumFood = list => list.reduce((t, f) => ({
  calories: t.calories + f.calories, protein: t.protein + f.protein, carbs: t.carbs + f.carbs, fat: t.fat + f.fat,
}), { calories: 0, protein: 0, carbs: 0, fat: 0 });

const defaultMeal = () => { const h = new Date().getHours(); return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snack' : h < 21 ? 'dinner' : 'snack'; };

function macroBar(label, have, want, unit = 'g') {
  const pct = want ? Math.min(100, Math.round(have / want * 100)) : 0;
  return `<div class="mbar">
    <div class="mbar-top"><b>${label}</b><span>${num(Math.round(have))}${want ? ` / ${num(want)}` : ''} ${unit}</span></div>
    <div class="progress"><span style="width:${pct}%"></span></div>
  </div>`;
}

async function renderNutrition(seq) {
  const day = nDay();
  const [stats, ngoals, food, recov] = await Promise.all([
    S.db.stats(), S.db.nutritionGoals(), S.db.foodLogs(day, day), S.db.recoveryLogs(day, day),
  ]);
  if (stale(seq)) return;
  S.stats = stats;
  const uid = S.members.has(S.nUser) ? S.nUser : S.me.id;
  const mine = uid === S.me.id;
  const who = mine ? 'You' : esc(nameOf(uid).split(' ')[0]);
  const t = targetsFor(uid, ngoals, stats);
  const g = ngoals.find(x => x.userId === uid);
  const mineFood = food.filter(f => f.userId === uid);
  const tot = sumFood(mineFood);
  const rec = recov.find(r => r.userId === uid);
  const isToday = day === todayYmd();
  const label = isToday ? 'Today' : day === ymd(addDays(new Date(), -1)) ? 'Yesterday' : fmt(parseYmd(day), { weekday: 'short', month: 'short', day: 'numeric' });
  const left = t ? t.calories - tot.calories : 0;
  const pct = t?.calories ? Math.min(100, tot.calories / t.calories * 100) : 0;

  const targetsCard = t ? `<section class="card fuel">
      <div class="ring" style="--p:${pct}"><div><b>${num(tot.calories)}</b><small>of ${num(t.calories)} kcal</small></div></div>
      <div class="grow">
        <p class="left ${left < 0 ? 'over' : ''}">${left >= 0 ? `${num(left)} kcal left` : `${num(-left)} kcal over`}</p>
        ${macroBar('Protein', tot.protein, t.protein)}
        ${macroBar('Carbs', tot.carbs, t.carbs)}
        ${macroBar('Fat', tot.fat, t.fat)}
      </div>
    </section>
    <p class="goal-line muted">${g ? `${GOALS.find(([k]) => k === g.goal)?.[1]}${g.targetWeight ? ` → ${num(g.targetWeight)} lb` : ''}${g.targetDate ? ` by ${fmtShortDate(g.targetDate)}` : ''}${t.custom ? ' · custom targets' : t.perWeek ? ` · ${t.perWeek > 0 ? '+' : ''}${t.perWeek} lb/week` : ''}` : ''}
      ${mine ? `<span class="links"><button class="link" data-act="coach" data-q="How is my nutrition this week?">Ask Coach</button><button class="link" data-act="edit-targets">Edit targets</button></span>` : ''}</p>`
    : `<section class="card hero rest">
      <p class="eyebrow">Daily targets</p>
      <h2>${mine ? 'Set your targets' : 'No targets yet'}</h2>
      <p class="meta">${mine ? 'Answer a few questions and Crucible works out your calories, protein, carbs and fat for your goal.' : `${who} hasn't set up nutrition targets.`}</p>
      ${mine ? '<button class="btn primary block" data-act="edit-targets">Set my targets</button>' : ''}
      ${tot.calories ? `<div class="totals">${num(tot.calories)} kcal · ${num(Math.round(tot.protein))} P · ${num(Math.round(tot.carbs))} C · ${num(Math.round(tot.fat))} F</div>` : ''}
    </section>`;

  const crewRows = [...S.members.values()].map(m => {
    const mt = targetsFor(m.id, ngoals, stats);
    const s = sumFood(food.filter(f => f.userId === m.id));
    const hit = mt && s.protein >= mt.protein * 0.95;
    return { m, mt, s, hit };
  }).sort((a, b) => b.s.calories - a.s.calories);

  app.innerHTML = `<div class="v-nutrition">
    <header class="top">
      <div><p class="eyebrow">Nutrition${mine ? '' : ` · ${esc(nameOf(uid))}`}</p><h1>${label}</h1></div>
      <div class="top-actions">
        <button class="icon-btn round" data-act="n-day" data-n="-1" aria-label="Previous day">${icon.chevL}</button>
        ${isToday ? '' : '<button class="btn sm" data-act="n-today">Today</button>'}
        <button class="icon-btn round" data-act="n-day" data-n="1" aria-label="Next day" ${isToday ? 'disabled' : ''}>${icon.chevR}</button>
      </div>
    </header>

    <div class="chips-scroll people">
      ${[...S.members.values()].sort((a, b) => (b.id === S.me.id) - (a.id === S.me.id) || a.name.localeCompare(b.name)).map(m => `<button class="chip ${m.id === uid ? 'on' : ''}" data-act="n-user" data-id="${m.id}">${avatar(m.id, 'xs')}${esc(m.id === S.me.id ? 'You' : m.name.split(' ')[0])}</button>`).join('')}
    </div>

    ${targetsCard}

    <section class="card list">
      <div class="sec-h"><h3>Meals</h3>${mine ? `<button class="btn sm primary" data-act="add-food">${icon.plus}Add food</button>` : ''}</div>
      ${MEALS.map(([k, l]) => {
        const items = mineFood.filter(f => f.meal === k);
        if (!items.length && !mine) return '';
        return `<div class="meal">
          <div class="meal-h"><b>${l}</b><span class="muted">${items.length ? `${num(sumFood(items).calories)} kcal` : ''}</span>
            ${mine ? `<button class="link" data-act="add-food" data-meal="${k}">+ Add</button>` : ''}</div>
          ${items.map(f => `<div class="food">
            <span class="grow"><b>${esc(f.name)}</b><small>${num(f.protein)} P · ${num(f.carbs)} C · ${num(f.fat)} F</small></span>
            <span class="kcal">${num(f.calories)}</span>
            ${mine ? `<button class="icon-btn" data-act="del-food" data-id="${f.id}" aria-label="Delete">✕</button>` : ''}
          </div>`).join('')}
        </div>`;
      }).join('') || `<p class="muted pad">${who} hasn't logged any food ${isToday ? 'today' : 'this day'}.</p>`}
    </section>

    <section class="card">
      <div class="sec-h"><h3>Recovery</h3>${mine ? `<button class="link" data-act="recovery">${rec ? 'Update' : 'Check in'}</button>` : ''}</div>
      ${rec ? `<div class="recov">
        <div><b>${rec.sleep != null ? num(rec.sleep) : '—'}<span>h</span></b><small>Sleep</small></div>
        <div><b>${rec.soreness ?? '—'}<span>/5</span></b><small>Soreness</small></div>
        <div><b>${rec.energy ?? '—'}<span>/5</span></b><small>Energy</small></div>
      </div>` : `<p class="muted">${mine ? 'How did you sleep, how sore are you, how is your energy? Takes 10 seconds.' : 'No check-in.'}</p>`}
    </section>

    <section class="card list">
      <div class="sec-h"><h3>Crew ${isToday ? 'today' : 'this day'}</h3><span class="muted">Calories · protein</span></div>
      ${crewRows.map(({ m, mt, s, hit }) => `<button class="row" data-act="n-user" data-id="${m.id}">
        ${avatar(m.id)}
        <span class="grow"><b>${esc(m.id === S.me.id ? 'You' : m.name)}</b>
          <small>${num(s.calories)}${mt ? ` / ${num(mt.calories)}` : ''} kcal · ${num(Math.round(s.protein))}${mt ? ` / ${num(mt.protein)}` : ''} g protein</small></span>
        ${hit ? '<span class="pr ok">Protein ✓</span>' : ''}
      </button>`).join('')}
    </section>
  </div>`;
}

function foodChanged() {
  S.dirty = true;
  if (S.tab === 'nutrition' || S.tab === 'today') refresh();
}

async function openFoodForm(meal = defaultMeal()) {
  const recent = (await S.db.foodLogs(ymd(addDays(new Date(), -45)), todayYmd()))
    .filter(f => f.userId === S.me.id).reverse();
  const seen = new Set();
  const quick = recent.filter(f => !seen.has(f.name.toLowerCase()) && seen.add(f.name.toLowerCase())).slice(0, 12);
  const sheet = formSheet(`<h2>Add food</h2>
    <div class="seg" role="radiogroup" aria-label="Meal">
      ${MEALS.map(([k, l]) => `<label><input type="radio" name="meal" value="${k}" ${k === meal ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </div>
    ${quick.length ? `<p class="field-label">Recent</p><div class="chips-scroll quick">${quick.map((f, i) => `<button type="button" class="chip" data-quick="${i}">${esc(f.name)}</button>`).join('')}</div>` : ''}
    <label class="field"><span>What did you eat?</span><input name="name" required maxlength="120" placeholder="3 eggs, 2 slices toast, black coffee"></label>
    <div class="ai-row">
      <button type="button" class="btn sm primary" data-estimate>${icon.spark}Estimate macros</button>
      <label class="btn sm ghost">${icon.camera}Photo<input class="vh" type="file" accept="image/*" data-photo></label>
    </div>
    <div class="ai-result"></div>
    <div class="two">
      <label class="field"><span>Calories</span>${numIn('calories', '600', 'required')}</label>
      <label class="field"><span>Protein (g)</span>${numIn('protein', '45')}</label>
      <label class="field"><span>Carbs (g)</span>${numIn('carbs', '60')}</label>
      <label class="field"><span>Fat (g)</span>${numIn('fat', '15')}</label>
    </div>
    <p class="hint">Describe the meal or snap a photo and tap Estimate. You can adjust the numbers before adding.</p>
    <button class="btn primary block lg" type="submit">Add</button>`, async f => {
    await S.db.addFood({
      date: nDay(), meal: f.get('meal'), name: f.get('name').trim(),
      calories: Math.round(+f.get('calories') || 0), protein: +f.get('protein') || 0, carbs: +f.get('carbs') || 0, fat: +f.get('fat') || 0,
    });
    toast('Logged');
    foodChanged();
  });
  const form = $('form', sheet);
  let photo = null;
  const runEstimate = async () => {
    const text = form.elements.name.value.trim();
    if (!text && !photo) return toast('Describe the meal or add a photo first', true);
    const box = $('.ai-result', sheet);
    box.innerHTML = `<div class="coach-wait"><div class="spinner"></div><span>Estimating…</span></div>`;
    try {
      const res = await S.db.estimateFood({ text, image: photo && await blobToBase64(photo) });
      if (!res.items.length) { box.innerHTML = `<p class="muted small">${esc(res.note)}</p>`; return; }
      const tot = sumFood(res.items);
      if (!text) form.elements.name.value = res.items.map(i => i.name).join(', ').slice(0, 120);
      form.elements.calories.value = Math.round(tot.calories);
      for (const k of ['protein', 'carbs', 'fat']) form.elements[k].value = Math.round(tot[k]);
      box.innerHTML = `<div class="ai-items">${res.items.map(i => `<div><span>${esc(i.name)} <small>${esc(i.portion)}</small></span><b>${num(i.calories)}</b></div>`).join('')}</div>
        <p class="muted small">${esc(res.note)}${res.remaining != null && res.remaining < 6 ? ` · ${res.remaining} estimates left today` : ''}</p>`;
    } catch (e) {
      box.innerHTML = `<p class="small err-text">${esc(e.message)}</p>`;
    }
  };
  $('[data-photo]', sheet).addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      photo = await compressImage(file, 1024);
      $('.ai-result', sheet).innerHTML = `<img class="ai-photo" src="${URL.createObjectURL(photo)}" alt="">`;
      runEstimate();
    } catch (err) { toastErr(err); }
  });
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-estimate]')) return runEstimate();
    const q = e.target.closest('[data-quick]');
    if (!q) return;
    const f = quick[+q.dataset.quick];
    form.elements.name.value = f.name;
    for (const k of ['calories', 'protein', 'carbs', 'fat']) form.elements[k].value = f[k];
  });
}

async function openTargetsForm() {
  const [ngoals, stats] = await Promise.all([S.db.nutritionGoals(), S.db.stats()]);
  const g = ngoals.find(x => x.userId === S.me.id) ?? { goal: 'maintain', trainingDays: 4 };
  const weight = latestWeighIn(stats, S.me.id)?.weight;
  const heightIn = S.members.get(S.me.id)?.heightIn;
  const val = v => v ?? '';
  const sheet = formSheet(`<h2>Nutrition targets</h2>
    <div class="seg" role="radiogroup" aria-label="Goal">
      ${GOALS.map(([k, l]) => `<label><input type="radio" name="goal" value="${k}" ${g.goal === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </div>
    <div class="seg" role="radiogroup" aria-label="Sex">
      <label><input type="radio" name="sex" value="male" ${g.sex !== 'female' ? 'checked' : ''}><span>Male</span></label>
      <label><input type="radio" name="sex" value="female" ${g.sex === 'female' ? 'checked' : ''}><span>Female</span></label>
    </div>
    <div class="two">
      <label class="field"><span>Birth year</span>${numIn('birthYear', '1995', `required value="${val(g.birthYear)}"`)}</label>
      <label class="field"><span>Training days / week</span><select name="trainingDays">${[0, 1, 2, 3, 4, 5, 6, 7].map(n => `<option ${n === (g.trainingDays ?? 4) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field"><span>Current weight (lb)</span>${numIn('weight', '195', `required value="${val(weight)}"`)}</label>
      <label class="field" data-hide="maintain"><span>Goal weight (lb)</span>${numIn('targetWeight', '185', `value="${val(g.targetWeight)}"`)}</label>
    </div>
    ${heightIn ? '' : heightFields(null)}
    <label class="field" data-hide="maintain"><span>Reach it by <em>optional</em></span><input type="date" name="targetDate" value="${val(g.targetDate)}"></label>
    <div class="preview card"></div>
    <details class="custom" ${[g.calories, g.protein, g.carbs, g.fat].some(v => v != null) ? 'open' : ''}>
      <summary>Use my own numbers instead</summary>
      <div class="two">
        <label class="field"><span>Calories</span>${numIn('calories', 'auto', `value="${val(g.calories)}"`)}</label>
        <label class="field"><span>Protein (g)</span>${numIn('protein', 'auto', `value="${val(g.protein)}"`)}</label>
        <label class="field"><span>Carbs (g)</span>${numIn('carbs', 'auto', `value="${val(g.carbs)}"`)}</label>
        <label class="field"><span>Fat (g)</span>${numIn('fat', 'auto', `value="${val(g.fat)}"`)}</label>
      </div>
    </details>
    <button class="btn primary block lg" type="submit">Save targets</button>`, async f => {
    const goal = readGoalForm(f);
    if (!heightIn) await S.db.updateProfile({ name: S.me.name, heightIn: readHeight(f) });
    if (+f.get('weight') !== weight) await S.db.addWeighIn({ weight: +f.get('weight'), date: todayYmd() });
    await S.db.saveNutritionGoal(goal);
    await loadMembers();
    toast('Targets saved');
    foodChanged();
  });
  const form = $('form', sheet);
  const update = () => {
    const f = new FormData(form);
    const goal = readGoalForm(f);
    sheet.querySelectorAll('[data-hide]').forEach(el => { el.hidden = goal.goal === el.dataset.hide; });
    const t = calcTargets({ ...goal, weight: +f.get('weight') || null, heightIn: heightIn ?? readHeight(f) });
    $('.preview', sheet).innerHTML = t
      ? `<p class="eyebrow">Your daily targets</p><p class="pv-kcal">${num(t.calories)} kcal</p>
         <p>${num(t.protein)} g protein · ${num(t.carbs)} g carbs · ${num(t.fat)} g fat</p>
         ${t.tdee && !t.custom ? `<p class="muted small">You burn about ${num(t.tdee)} kcal a day${t.perWeek ? `. This pace is ${t.perWeek > 0 ? '+' : ''}${t.perWeek} lb per week.` : '.'}</p>` : ''}`
      : '<p class="muted">Fill in your details to see your targets.</p>';
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
}

function readGoalForm(f) {
  const n = k => (f.get(k) === '' || f.get(k) == null ? null : +f.get(k));
  const goal = f.get('goal');
  return {
    goal, sex: f.get('sex'), birthYear: n('birthYear'), trainingDays: +f.get('trainingDays'),
    targetWeight: goal === 'maintain' ? null : n('targetWeight'), targetDate: goal === 'maintain' ? null : f.get('targetDate') || null,
    calories: n('calories'), protein: n('protein'), carbs: n('carbs'), fat: n('fat'),
  };
}

async function openRecoveryForm() {
  const rec = (await S.db.recoveryLogs(nDay(), nDay())).find(r => r.userId === S.me.id) ?? {};
  const scale = (name, cur, lo, hi) => `<div class="seg scale" role="radiogroup" aria-label="${name}">
    ${[1, 2, 3, 4, 5].map(v => `<label><input type="radio" name="${name}" value="${v}" ${cur === v ? 'checked' : ''}><span>${v}</span></label>`).join('')}
  </div><p class="scale-ends muted small"><span>${lo}</span><span>${hi}</span></p>`;
  formSheet(`<h2>Recovery check-in</h2>
    <label class="field"><span>Hours of sleep last night</span>${numIn('sleep', '7.5', `value="${rec.sleep ?? ''}" step="0.5"`)}</label>
    <p class="field-label">Soreness</p>${scale('soreness', rec.soreness, 'Fresh', 'Wrecked')}
    <p class="field-label">Energy</p>${scale('energy', rec.energy, 'Drained', 'Fired up')}
    <button class="btn primary block lg" type="submit">Save</button>`, async f => {
    await S.db.saveRecovery({
      date: nDay(), sleep: f.get('sleep') === '' ? null : +f.get('sleep'),
      soreness: f.get('soreness') ? +f.get('soreness') : null, energy: f.get('energy') ? +f.get('energy') : null,
    });
    toast('Checked in');
    foodChanged();
  });
}

/* ── Coach ── */
const COACH_PROMPTS = [
  'Am I on track for my goals?',
  'What should I train today?',
  'How is my nutrition this week?',
  'How is my recovery?',
];

// Coach answers use a little markdown: ### headings, - bullets, 1. lists, **bold**, _italic_.
function mdToHtml(text) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1<em>$2</em>');
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#{1,4}\s+(.*)/);
    const ul = line.match(/^[-*•]\s+(.*)/);
    const ol = line.match(/^\d+[.)]\s+(.*)/);
    if (h) { close(); out.push(`<h4>${inline(h[1])}</h4>`); }
    else if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (list !== tag) { close(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inline((ul ?? ol)[1])}</li>`);
    } else if (!line) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join('');
}

async function myTargets() {
  const [ngoals, stats] = await Promise.all([S.db.nutritionGoals(), S.db.stats()]);
  const t = targetsFor(S.me.id, ngoals, stats);
  return t && { calories: t.calories, protein: t.protein, carbs: t.carbs, fat: t.fat };
}

async function openCoach(prompt) {
  const sheet = openSheet(`<div class="sheet-body coach">
    <div class="coach-h">
      <span class="coach-icon">${icon.spark}</span>
      <div><h2>Coach</h2><p class="muted">Looks at your lifts, goals, workouts, food and recovery.</p></div>
    </div>
    <div class="coach-prompts">${COACH_PROMPTS.map(q => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <form class="coach-ask">
      <textarea name="q" rows="2" maxlength="1000" placeholder="Or ask anything about your training or nutrition…"></textarea>
      <button class="btn primary">Ask</button>
    </form>
    <p class="muted small coach-left"></p>
    <div class="coach-out"></div>
    <div class="coach-hist"></div>
  </div>`);
  const form = $('form', sheet);
  const out = $('.coach-out', sheet);
  let busy = false;

  const showHistory = async () => {
    try {
      const hist = await S.db.coachHistory();
      $('.coach-hist', sheet).innerHTML = hist.length ? `<h3 class="sec">Earlier</h3>${hist.map(h => `<details class="card coach-past">
        <summary><b>${esc(h.question)}</b><small>${fmtStamp(h.createdAt)}</small></summary>
        <div class="coach-md">${mdToHtml(h.answer)}</div>
      </details>`).join('')}` : '';
    } catch (e) { console.error(e); }
  };

  const ask = async question => {
    if (busy || !question.trim()) return;
    busy = true;
    form.q.value = '';
    const btn = $('button', form);
    btn.disabled = true;
    out.innerHTML = `<div class="card coach-answer"><p class="coach-q">${esc(question)}</p><div class="coach-wait"><div class="spinner"></div><span>Going through your numbers…</span></div></div>`;
    try {
      const res = await S.db.askCoach(question, await myTargets());
      out.innerHTML = `<div class="card coach-answer"><p class="coach-q">${esc(question)}</p><div class="coach-md">${mdToHtml(res.answer)}</div></div>`;
      if (res.remaining != null) $('.coach-left', sheet).textContent = res.remaining > 0 ? `${res.remaining} question${res.remaining === 1 ? '' : 's'} left today` : 'That was your last question for today';
      showHistory();
    } catch (e) {
      out.innerHTML = `<div class="card coach-answer err"><p>${esc(e.message)}</p></div>`;
    } finally {
      busy = false;
      btn.disabled = false;
    }
  };

  sheet.addEventListener('click', e => {
    const q = e.target.closest('[data-q]');
    if (q) ask(q.dataset.q);
  });
  form.addEventListener('submit', e => { e.preventDefault(); ask(form.q.value); });
  showHistory();
  if (prompt) ask(prompt);
}

const blobToBase64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

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
    <div class="ex-sec">
      <p class="field-label">Exercises <em>optional</em></p>
      <div class="ex-head"><span>Exercise</span><span>Sets</span><span>Reps</span><span>lb</span><span></span></div>
      <div class="ex-list"></div>
      <button type="button" class="btn ghost sm" data-ex-add>${icon.plus}Add exercise</button>
    </div>
    <label class="field"><span>Notes</span>
      <textarea name="body" rows="3" maxlength="4000" placeholder="How it felt, PRs, anything else…"></textarea>
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
  const exList = $('.ex-list', sheet);
  let exTouched = false;
  const exRow = (x = {}) => `<div class="ex-row">
    <input name="exName" maxlength="60" placeholder="Bench press" value="${esc(x.name ?? '')}" aria-label="Exercise">
    <input name="exSets" type="number" inputmode="numeric" min="0" max="99" value="${x.sets ?? ''}" aria-label="Sets">
    <input name="exReps" maxlength="10" inputmode="numeric" value="${esc(x.reps ?? '')}" aria-label="Reps">
    <input name="exWeight" type="number" inputmode="decimal" step="any" min="0" value="${x.weight ?? ''}" aria-label="Weight in lb">
    <button type="button" class="icon-btn" data-ex-del aria-label="Remove exercise">✕</button>
  </div>`;
  const prefill = () => {
    if (exTouched) return;
    const ev = workouts.find(w => w.id === form.event.value);
    exList.innerHTML = ev ? parsePlan(ev.details).map(exRow).join('') : '';
  };
  prefill();
  form.event.addEventListener('change', prefill);
  exList.addEventListener('input', () => { exTouched = true; });
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-ex-add]')) { exList.insertAdjacentHTML('beforeend', exRow()); exTouched = true; exList.lastElementChild.querySelector('input').focus(); }
    const del = e.target.closest('[data-ex-del]');
    if (del) { del.closest('.ex-row').remove(); exTouched = true; }
  });
  const readExercises = () => [...exList.querySelectorAll('.ex-row')].map(r => {
    const v = n => r.querySelector(`[name=${n}]`).value.trim();
    const reps = v('exReps');
    return { name: v('exName'), sets: +v('exSets') || null, reps: reps === '' ? null : (/^\d+$/.test(reps) ? +reps : reps), weight: +v('exWeight') || null };
  }).filter(x => x.name && (x.sets || x.reps || x.weight));

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
    const exercises = readExercises();
    if (!body && !files.length && !exercises.length) return toast('Add your sets, a note or a photo first', true);
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = files.length ? `Uploading 0/${files.length}…` : 'Posting…';
    try {
      await S.db.createPost({
        body, eventId: form.event.value || null, exercises, files,
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
    const text = `Join ${S.team.name} on Crucible! Open ${url} , create an account, and enter invite code ${S.team.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my crew on Crucible', text }); } catch { /* cancelled */ }
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
  profile: (el, id) => openProfile(id),
  'nutrition-me': () => { S.nUser = null; S.nDay = null; return go('nutrition'); },
  'n-user': (el, id) => { closeSheet(); S.nUser = id === S.me.id ? null : id; return go('nutrition'); },
  'n-day': el => {
    const d = ymd(addDays(parseYmd(nDay()), +el.dataset.n));
    S.nDay = d >= todayYmd() ? null : d;
    return go('nutrition', { keep: true });
  },
  'n-today': () => { S.nDay = null; return go('nutrition', { keep: true }); },
  'add-food': el => openFoodForm(el.dataset.meal),
  'del-food': async (el, id) => {
    await S.db.deleteFood(id);
    foodChanged();
  },
  'edit-targets': () => openTargetsForm(),
  coach: el => { closeSheet(); return openCoach(el.dataset.q); },
  recovery: () => openRecoveryForm(),
  board: el => { S.board = el.dataset.lift; return go('crew', { keep: true }); },
  'edit-profile': () => openEditProfile(),
  'log-lift': el => openLiftForm(el.dataset.lift),
  'log-weight': () => openWeighInForm(),
  'add-goal': () => openGoalForm(),
  'goal-done': async (el, id) => {
    await S.db.setGoalDone(id, !el.classList.contains('on'));
    statsChanged();
  },
  'del-goal': async (el, id) => {
    if (!confirm('Delete this goal?')) return;
    await S.db.deleteGoal(id);
    statsChanged();
  },
  'del-lift': async (el, id) => {
    if (!confirm('Delete this lift entry?')) return;
    await S.db.deleteLift(id);
    statsChanged();
  },
  'del-weight': async (el, id) => {
    if (!confirm('Delete this weigh-in?')) return;
    await S.db.deleteWeighIn(id);
    statsChanged();
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

/* ── Auth & onboarding ── */
function renderAuth(mode = 'in', msg = '') {
  tabbar.hidden = true;
  app.innerHTML = `<div class="auth">
    <div class="brand"><img src="icons/icon.svg" alt=""><h1>Crucible</h1><p>Train together, even when you're apart.</p></div>
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
  await go(S.tab);
  maybeSetup().catch(toastErr);
}

/* ── Boot ── */
tabbar.innerHTML = `
  <button data-act="tab" data-tab="today">${icon.today}<span>Today</span></button>
  <button data-act="tab" data-tab="feed">${icon.feed}<span>Feed</span></button>
  <button class="fab" data-act="compose" aria-label="Log workout">${icon.plus}</button>
  <button data-act="tab" data-tab="nutrition">${icon.food}<span>Nutrition</span></button>
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
