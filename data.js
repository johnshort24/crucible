// Data layer. Two interchangeable backends with the same async API:
//   SupabaseBackend — real shared crew (accounts, database, photo/video storage)
//   LocalBackend    — demo mode, everything stored on this device
//
// Shapes returned to the UI:
//   member  { id, name }
//   post    { id, userId, body, eventId, eventTitle, createdAt, media: [{ type, url }],
//             reactCount, reacted, commentCount }
//   event   { id, title, kind: 'workout'|'social'|'other', date: 'YYYY-MM-DD',
//             time: 'HH:MM'|null, location, details, createdBy }
//   comment { id, userId, body, createdAt }

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isDemo = !SUPABASE_URL || !SUPABASE_ANON_KEY;

export async function createBackend() {
  return isDemo ? new LocalBackend() : SupabaseBackend.create();
}

const uuid = () => crypto.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });

const extFor = f => f.kind === 'image' ? 'jpg' : (f.type.split('/')[1] || 'mp4').replace('quicktime', 'mov');

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/* ───────────────────────── Supabase ───────────────────────── */

const SIGNED_URL_TTL = 6 * 3600;

class SupabaseBackend {
  static async create() {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    const b = new SupabaseBackend();
    b.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    b.urls = new Map();
    return b;
  }

  async session() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return null;
    this.uid = data.session.user.id;
    return this.loadMe();
  }

  async loadMe() {
    const profile = check(await this.sb.from('profiles')
      .select('id, display_name, team_id').eq('id', this.uid).single());
    let team = null;
    if (profile.team_id) {
      const t = check(await this.sb.from('teams')
        .select('id, name, invite_code').eq('id', profile.team_id).single());
      team = { id: t.id, name: t.name, code: t.invite_code };
    }
    this.teamId = team?.id ?? null;
    return { user: { id: profile.id, name: profile.display_name }, team };
  }

  async signUp(email, password, name) {
    const data = check(await this.sb.auth.signUp({
      email, password, options: { data: { display_name: name } },
    }));
    if (!data.session) return { needsConfirm: true };
    this.uid = data.user.id;
    return this.loadMe();
  }

  async signIn(email, password) {
    const data = check(await this.sb.auth.signInWithPassword({ email, password }));
    this.uid = data.user.id;
    return this.loadMe();
  }

  async signOut() {
    await this.sb.auth.signOut();
    this.uid = this.teamId = null;
  }

  async createTeam(name) {
    check(await this.sb.rpc('create_team', { team_name: name }));
    return this.loadMe();
  }

  async joinTeam(code) {
    check(await this.sb.rpc('join_team', { code }));
    return this.loadMe();
  }

  async leaveTeam() {
    check(await this.sb.rpc('leave_team'));
    this.teamId = null;
  }

  async updateProfile({ name, heightIn }) {
    check(await this.sb.from('profiles')
      .update({ display_name: name, height_in: heightIn ?? null }).eq('id', this.uid));
  }

  async members() {
    const rows = check(await this.sb.from('profiles')
      .select('id, display_name, height_in').eq('team_id', this.teamId).order('display_name'));
    return rows.map(r => ({ id: r.id, name: r.display_name, heightIn: r.height_in }));
  }

  // Lifts, weigh-ins and goals for the whole crew (row level security limits it to teammates).
  async stats() {
    const [l, w, g] = await Promise.all([
      this.sb.from('lift_entries').select('id, user_id, lift, value, recorded_on, created_at')
        .order('recorded_on').order('created_at'),
      this.sb.from('weigh_ins').select('id, user_id, weight_lbs, recorded_on, created_at')
        .order('recorded_on').order('created_at'),
      this.sb.from('goals').select('*').order('created_at'),
    ]);
    return {
      lifts: check(l).map(r => ({ id: r.id, userId: r.user_id, lift: r.lift, value: +r.value, date: r.recorded_on, createdAt: r.created_at })),
      weighins: check(w).map(r => ({ id: r.id, userId: r.user_id, weight: +r.weight_lbs, date: r.recorded_on, createdAt: r.created_at })),
      goals: check(g).map(r => ({
        id: r.id, userId: r.user_id, kind: r.kind, lift: r.lift, target: r.target == null ? null : +r.target,
        text: r.body, targetDate: r.target_date, done: r.done, createdAt: r.created_at,
      })),
    };
  }

  async addLift({ lift, value, date }) {
    check(await this.sb.from('lift_entries').insert({ lift, value, recorded_on: date }));
  }

  async deleteLift(id) {
    check(await this.sb.from('lift_entries').delete().eq('id', id));
  }

  async addWeighIn({ weight, date }) {
    check(await this.sb.from('weigh_ins').insert({ weight_lbs: weight, recorded_on: date }));
  }

  async deleteWeighIn(id) {
    check(await this.sb.from('weigh_ins').delete().eq('id', id));
  }

  async addGoal({ kind, lift, target, text, targetDate }) {
    check(await this.sb.from('goals').insert({
      kind, lift: lift || null, target: target ?? null, body: text || null, target_date: targetDate || null,
    }));
  }

  async setGoalDone(id, done) {
    check(await this.sb.from('goals').update({ done }).eq('id', id));
  }

  async nutritionGoals() {
    return check(await this.sb.from('nutrition_goals').select('*')).map(r => ({
      userId: r.user_id, sex: r.sex, birthYear: r.birth_year, trainingDays: r.training_days, goal: r.goal,
      targetWeight: r.target_weight == null ? null : +r.target_weight, targetDate: r.target_date,
      calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
    }));
  }

  async saveNutritionGoal(g) {
    const row = {
      sex: g.sex, birth_year: g.birthYear, training_days: g.trainingDays, goal: g.goal,
      target_weight: g.targetWeight ?? null, target_date: g.targetDate || null,
      calories: g.calories ?? null, protein: g.protein ?? null, carbs: g.carbs ?? null, fat: g.fat ?? null,
    };
    const updated = check(await this.sb.from('nutrition_goals').update(row).eq('user_id', this.uid).select('user_id'));
    if (!updated.length) check(await this.sb.from('nutrition_goals').insert(row));
  }

  async foodLogs(fromDate, toDate) {
    const rows = check(await this.sb.from('food_logs')
      .select('id, user_id, eaten_on, meal, name, calories, protein, carbs, fat, created_at')
      .gte('eaten_on', fromDate).lte('eaten_on', toDate).order('created_at').limit(5000));
    return rows.map(r => ({
      id: r.id, userId: r.user_id, date: r.eaten_on, meal: r.meal, name: r.name, calories: r.calories,
      protein: +r.protein, carbs: +r.carbs, fat: +r.fat, createdAt: r.created_at,
    }));
  }

  async addFood(f) {
    check(await this.sb.from('food_logs').insert({
      eaten_on: f.date, meal: f.meal, name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
    }));
  }

  async deleteFood(id) {
    check(await this.sb.from('food_logs').delete().eq('id', id));
  }

  async recoveryLogs(fromDate, toDate) {
    const rows = check(await this.sb.from('recovery_logs')
      .select('id, user_id, logged_on, sleep_hours, soreness, energy')
      .gte('logged_on', fromDate).lte('logged_on', toDate));
    return rows.map(r => ({
      id: r.id, userId: r.user_id, date: r.logged_on,
      sleep: r.sleep_hours == null ? null : +r.sleep_hours, soreness: r.soreness, energy: r.energy,
    }));
  }

  // One check-in per person per day: update today's if it exists.
  async saveRecovery({ date, sleep, soreness, energy }) {
    const vals = { sleep_hours: sleep ?? null, soreness: soreness ?? null, energy: energy ?? null };
    const updated = check(await this.sb.from('recovery_logs').update(vals)
      .eq('user_id', this.uid).eq('logged_on', date).select('id'));
    if (!updated.length) check(await this.sb.from('recovery_logs').insert({ ...vals, logged_on: date }));
  }

  async deleteGoal(id) {
    check(await this.sb.from('goals').delete().eq('id', id));
  }

  async signedUrls(paths) {
    const now = Date.now();
    const need = paths.filter(p => !(this.urls.get(p)?.exp > now));
    if (need.length) {
      const data = check(await this.sb.storage.from('media').createSignedUrls(need, SIGNED_URL_TTL));
      for (const d of data) {
        if (d.signedUrl) this.urls.set(d.path, { url: d.signedUrl, exp: now + (SIGNED_URL_TTL - 300) * 1000 });
      }
    }
    return new Map(paths.map(p => [p, this.urls.get(p)?.url]));
  }

  async posts({ before, after, limit = 20 } = {}) {
    let q = this.sb.from('posts')
      .select('id, user_id, body, event_id, media, exercises, created_at, events(title), comments(count), reactions(user_id)')
      .eq('team_id', this.teamId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (before) q = q.lt('created_at', before);
    if (after) q = q.gte('created_at', after);
    const rows = check(await q);
    const urls = await this.signedUrls(rows.flatMap(r => r.media.map(m => m.path)));
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      body: r.body,
      eventId: r.event_id,
      eventTitle: r.events?.title ?? null,
      createdAt: new Date(r.created_at).toISOString(),
      media: r.media.map(m => ({ type: m.type, path: m.path, url: urls.get(m.path) })),
      exercises: r.exercises ?? [],
      reactCount: r.reactions.length,
      reacted: r.reactions.some(x => x.user_id === this.uid),
      commentCount: r.comments[0]?.count ?? 0,
    }));
  }

  async activity(from, to) {
    let q = this.sb.from('posts').select('user_id, created_at')
      .eq('team_id', this.teamId).gte('created_at', from).limit(5000);
    if (to) q = q.lt('created_at', to);
    return check(await q).map(r => ({ userId: r.user_id, createdAt: r.created_at }));
  }

  async createPost({ body, eventId, exercises = [], files, onProgress }) {
    const media = [];
    try {
      for (const [i, f] of files.entries()) {
        const path = `${this.teamId}/${this.uid}/${uuid()}.${extFor(f)}`;
        check(await this.sb.storage.from('media').upload(path, f.blob, {
          contentType: f.type, cacheControl: '31536000',
        }));
        media.push({ type: f.kind, path });
        onProgress?.(i + 1, files.length);
      }
      check(await this.sb.from('posts').insert({
        team_id: this.teamId, body, event_id: eventId || null, media, exercises,
      }));
    } catch (e) {
      if (media.length) await this.sb.storage.from('media').remove(media.map(m => m.path));
      throw e;
    }
  }

  async deletePost(post) {
    check(await this.sb.from('posts').delete().eq('id', post.id));
    const paths = post.media.map(m => m.path).filter(Boolean);
    if (paths.length) await this.sb.storage.from('media').remove(paths);
  }

  async toggleReaction(postId, on) {
    check(on
      ? await this.sb.from('reactions').insert({ post_id: postId })
      : await this.sb.from('reactions').delete().eq('post_id', postId).eq('user_id', this.uid));
  }

  async comments(postId) {
    const rows = check(await this.sb.from('comments')
      .select('id, user_id, body, created_at').eq('post_id', postId).order('created_at'));
    return rows.map(r => ({ id: r.id, userId: r.user_id, body: r.body, createdAt: r.created_at }));
  }

  async addComment(postId, body) {
    check(await this.sb.from('comments').insert({ post_id: postId, body }));
  }

  async deleteComment(id) {
    check(await this.sb.from('comments').delete().eq('id', id));
  }

  async events(fromDate, toDate) {
    const rows = check(await this.sb.from('events').select('*')
      .eq('team_id', this.teamId).gte('event_date', fromDate).lte('event_date', toDate)
      .order('event_date').order('start_time', { nullsFirst: true }));
    return rows.map(r => ({
      id: r.id, title: r.title, kind: r.kind, date: r.event_date,
      time: r.start_time ? r.start_time.slice(0, 5) : null,
      location: r.location, details: r.details, createdBy: r.created_by,
    }));
  }

  async addEvents(list) {
    check(await this.sb.from('events').insert(list.map(e => ({
      team_id: this.teamId, title: e.title, kind: e.kind, event_date: e.date,
      start_time: e.time || null, location: e.location || null, details: e.details || null,
    }))));
  }

  async updateEvent(e) {
    check(await this.sb.from('events').update({
      title: e.title, kind: e.kind, event_date: e.date, start_time: e.time || null,
      location: e.location || null, details: e.details || null,
    }).eq('id', e.id));
  }

  async deleteEvent(id) {
    check(await this.sb.from('events').delete().eq('id', id));
  }

  subscribe(onChange) {
    const filter = `team_id=eq.${this.teamId}`;
    const ch = this.sb.channel(`team-${this.teamId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter }, () => onChange('posts'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter }, () => onChange('events'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => onChange('comments'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, () => onChange('reactions'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lift_entries' }, () => onChange('stats'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weigh_ins' }, () => onChange('stats'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goals' }, () => onChange('stats'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nutrition_goals' }, () => onChange('food'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_logs' }, () => onChange('food'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recovery_logs' }, () => onChange('food'))
      .subscribe();
    return () => this.sb.removeChannel(ch);
  }
}

/* ───────────────────────── Demo (on-device) ───────────────────────── */

const LS_KEY = 'crucible-demo-v3';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('crucible-demo-media', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('m');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('m', mode);
    const req = fn(tx.objectStore('m'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

class LocalBackend {
  constructor() {
    this.urls = new Map();
    try { this.d = JSON.parse(localStorage.getItem(LS_KEY)); } catch { this.d = null; }
    if (!this.d) { this.d = seed(); this.save(); }
  }

  save() { localStorage.setItem(LS_KEY, JSON.stringify(this.d)); }

  member(id) { return this.d.members.find(m => m.id === id); }

  async session() {
    return { user: { id: this.d.me, name: this.member(this.d.me).name }, team: this.d.team };
  }

  async signOut() {}
  async updateProfile({ name, heightIn }) {
    Object.assign(this.member(this.d.me), { name, heightIn: heightIn ?? null });
    this.save();
  }

  async members() { return this.d.members.map(({ id, name, heightIn }) => ({ id, name, heightIn })); }

  async stats() {
    const byDate = (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
    return {
      lifts: [...this.d.lifts].sort(byDate),
      weighins: [...this.d.weighins].sort(byDate),
      goals: [...this.d.goals],
    };
  }

  add(list, item) {
    this.d[list].push({ ...item, id: uuid(), userId: this.d.me, createdAt: new Date().toISOString() });
    this.save();
  }

  remove(list, id) {
    this.d[list] = this.d[list].filter(x => x.id !== id);
    this.save();
  }

  async addLift({ lift, value, date }) { this.add('lifts', { lift, value, date }); }
  async deleteLift(id) { this.remove('lifts', id); }
  async addWeighIn({ weight, date }) { this.add('weighins', { weight, date }); }
  async deleteWeighIn(id) { this.remove('weighins', id); }
  async addGoal(g) {
    this.add('goals', { kind: g.kind, lift: g.lift || null, target: g.target ?? null, text: g.text || null, targetDate: g.targetDate || null, done: false });
  }
  async setGoalDone(id, done) { this.d.goals.find(g => g.id === id).done = done; this.save(); }

  async nutritionGoals() { return Object.values(this.d.ngoals); }
  async saveNutritionGoal(g) { this.d.ngoals[this.d.me] = { ...g, userId: this.d.me }; this.save(); }

  async foodLogs(fromDate, toDate) {
    return this.d.food.filter(f => f.date >= fromDate && f.date <= toDate)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addFood(f) { this.add('food', f); }
  async deleteFood(id) { this.remove('food', id); }

  async recoveryLogs(fromDate, toDate) {
    return this.d.recovery.filter(r => r.date >= fromDate && r.date <= toDate);
  }

  async saveRecovery(r) {
    const cur = this.d.recovery.find(x => x.userId === this.d.me && x.date === r.date);
    if (cur) { Object.assign(cur, r); this.save(); } else this.add('recovery', r);
  }
  async deleteGoal(id) { this.remove('goals', id); }

  async reset() {
    localStorage.removeItem(LS_KEY);
    await idbDo('readwrite', s => s.clear());
  }

  async mediaUrl(key) {
    if (!this.urls.has(key)) {
      const blob = await idbDo('readonly', s => s.get(key));
      this.urls.set(key, blob ? URL.createObjectURL(blob) : '');
    }
    return this.urls.get(key);
  }

  async posts({ before, after, limit = 20 } = {}) {
    const list = this.d.posts
      .filter(p => (!before || p.createdAt < before) && (!after || p.createdAt >= after))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    return Promise.all(list.map(async p => {
      const reacts = this.d.reactions.filter(r => r.postId === p.id);
      return {
        ...p,
        eventTitle: this.d.events.find(e => e.id === p.eventId)?.title ?? null,
        media: await Promise.all(p.media.map(async m => ({ type: m.type, key: m.key, url: await this.mediaUrl(m.key) }))),
        reactCount: reacts.length,
        reacted: reacts.some(r => r.userId === this.d.me),
        commentCount: this.d.comments.filter(c => c.postId === p.id).length,
      };
    }));
  }

  async activity(from, to) {
    return this.d.posts
      .filter(p => p.createdAt >= from && (!to || p.createdAt < to))
      .map(({ userId, createdAt }) => ({ userId, createdAt }));
  }

  async createPost({ body, eventId, exercises = [], files, onProgress }) {
    const media = [];
    for (const [i, f] of files.entries()) {
      const key = uuid();
      await idbDo('readwrite', s => s.put(f.blob, key));
      media.push({ type: f.kind, key });
      onProgress?.(i + 1, files.length);
    }
    this.d.posts.push({
      id: uuid(), userId: this.d.me, body, eventId: eventId || null, media, exercises,
      createdAt: new Date().toISOString(),
    });
    this.save();
  }

  async deletePost(post) {
    this.d.posts = this.d.posts.filter(p => p.id !== post.id);
    this.d.comments = this.d.comments.filter(c => c.postId !== post.id);
    this.d.reactions = this.d.reactions.filter(r => r.postId !== post.id);
    this.save();
    for (const m of post.media) if (m.key) await idbDo('readwrite', s => s.delete(m.key));
  }

  async toggleReaction(postId, on) {
    this.d.reactions = this.d.reactions.filter(r => !(r.postId === postId && r.userId === this.d.me));
    if (on) this.d.reactions.push({ postId, userId: this.d.me });
    this.save();
  }

  async comments(postId) {
    return this.d.comments.filter(c => c.postId === postId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addComment(postId, body) {
    this.d.comments.push({ id: uuid(), postId, userId: this.d.me, body, createdAt: new Date().toISOString() });
    this.save();
  }

  async deleteComment(id) {
    this.d.comments = this.d.comments.filter(c => c.id !== id);
    this.save();
  }

  async events(fromDate, toDate) {
    return this.d.events
      .filter(e => e.date >= fromDate && e.date <= toDate)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
  }

  async addEvents(list) {
    for (const e of list) this.d.events.push({ ...e, id: uuid(), time: e.time || null, createdBy: this.d.me });
    this.save();
  }

  async updateEvent(e) {
    const i = this.d.events.findIndex(x => x.id === e.id);
    this.d.events[i] = { ...this.d.events[i], ...e, time: e.time || null };
    this.save();
  }

  async deleteEvent(id) {
    this.d.events = this.d.events.filter(e => e.id !== id);
    this.save();
  }

  subscribe() { return () => {}; }
}

function seed() {
  let s = 7;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

  const names = ['You', 'Marcus', 'Tyler', 'Dre', 'Jake', 'Chris', 'Nate', 'Luis', 'Ben'];
  const members = names.map((name, i) => ({ id: i ? `m${i}` : 'me', name }));
  const plan = [
    ['Push Day', 'Bench press 5×5\nIncline DB press 4×10\nOverhead press 3×8\nDips 3×AMRAP\nTricep pushdowns 3×12'],
    ['Pull Day', 'Deadlift 5×3\nPull-ups 4×AMRAP\nBarbell rows 4×8\nFace pulls 3×15\nHammer curls 3×12'],
    ['Leg Day', 'Back squat 5×5\nRomanian deadlift 4×8\nWalking lunges 3×12 each leg\nLeg press 3×15\nCalf raises 4×15'],
    ['Conditioning', '2 mile run\n100 burpees for time\nPlank 3×1 min'],
  ];

  const events = [];
  const workoutOn = {};
  let n = 0;
  for (let i = -21; i <= 21; i++) {
    const d = day(i);
    if (d.getDay() === 0) continue;
    const [title, details] = plan[n++ % plan.length];
    const ev = { id: `e${i}`, title, kind: 'workout', date: ymd(d), time: '06:00', location: 'Iron Works Gym', details, createdBy: 'm1' };
    events.push(ev);
    workoutOn[i] = ev.id;
  }
  const sat = (6 - day(0).getDay() + 7) % 7 || 7;
  events.push({ id: 'bbq', title: 'Crew BBQ', kind: 'social', date: ymd(day(sat)), time: '17:00', location: "Marcus's place", details: 'Bring a side. Marcus has the grill.', createdBy: 'm1' });
  events.push({ id: 'race', title: 'Turkey Trot 5K', kind: 'other', date: ymd(day(sat + 14)), time: '08:00', location: 'Riverside Park', details: 'Sign up online before the 20th.', createdBy: 'm3' });

  const lines = [
    'Hit a PR today 🔥 felt strong the whole way through.',
    'Heavy one. Got every set in though.',
    'Solo session before work, kept rest times short.',
    'Knees were barking so I swapped in leg press. Still got it done.',
    'All sets done. That last superset was brutal.',
    'Went up 10 lbs across the board 💪',
    'Early one today, had the gym to myself.',
    'Lunch break lift. Quick but solid.',
  ];
  const posts = [];
  const now = Date.now();
  for (let i = -6; i <= 0; i++) {
    if (!workoutOn[i]) continue;
    members.forEach((m, mi) => {
      if (i === 0 && (mi === 0 || mi > 4)) return;
      if (i < 0 && rand() < 0.2) return;
      const t = day(i);
      t.setHours(5, 15 + Math.floor(rand() * 180));
      let at = t.getTime();
      if (at > now) at = now - (mi + 1) * 9 * 60000;
      posts.push({
        id: `p${i}_${mi}`, userId: m.id, eventId: workoutOn[i], media: [],
        body: lines[Math.floor(rand() * lines.length)], createdAt: new Date(at).toISOString(),
      });
    });
  }
  const reactions = [];
  const comments = [];
  for (const p of posts) {
    for (const m of members) if (m.id !== p.userId && rand() < 0.35) reactions.push({ postId: p.id, userId: m.id });
  }
  const latest = posts.filter(p => p.userId !== 'me').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latest) {
    comments.push({ id: 'c1', postId: latest.id, userId: 'm5', body: "Let's go!! 🔥", createdAt: new Date(Date.parse(latest.createdAt) + 5 * 60000).toISOString() });
  }

  // Stats for the sample crew. "You" starts empty so the profile setup shows.
  const lifts = [];
  const weighins = [];
  const goals = [];
  const r5 = x => Math.round(x / 5) * 5;
  const stamp = d => new Date(d.getTime() + 12 * 3600000).toISOString();
  members.slice(1).forEach((m, mi) => {
    m.heightIn = 67 + Math.floor(rand() * 9);
    const bench = r5(185 + rand() * 130);
    const top = { bench, squat: r5(bench * 1.3), deadlift: r5(bench * 1.6), ohp: r5(bench * 0.62), pullup: 8 + Math.floor(rand() * 12) };
    [[-120, 0.88], [-60, 0.94], [-12, 1]].forEach(([d, f], k) => {
      for (const [lift, v] of Object.entries(top)) {
        lifts.push({ id: `l${mi}${lift}${k}`, userId: m.id, lift, value: lift === 'pullup' ? Math.round(v * f) : r5(v * f), date: ymd(day(d)), createdAt: stamp(day(d)) });
      }
    });
    let w = 165 + Math.floor(rand() * 60);
    for (let k = 5; k >= 0; k--) {
      weighins.push({ id: `w${mi}${k}`, userId: m.id, weight: w, date: ymd(day(-k * 7)), createdAt: stamp(day(-k * 7)) });
      w += Math.round((rand() - 0.6) * 4);
    }
    goals.push({ id: `g${mi}a`, userId: m.id, kind: 'lift', lift: 'bench', target: r5(bench + 30), text: null, targetDate: null, done: false, createdAt: stamp(day(-30)) });
    if (mi % 2 === 0) goals.push({ id: `g${mi}b`, userId: m.id, kind: 'text', lift: null, target: null, text: 'Run a sub-25 minute 5K', targetDate: null, done: false, createdAt: stamp(day(-20)) });
  });

  // Nutrition: targets, two days of meals and recovery check-ins for the sample crew.
  const foods = {
    breakfast: [['3 eggs + 2 slices toast', 430, 25, 30, 22], ['Oatmeal with whey + banana', 520, 38, 80, 8], ['Greek yogurt + berries', 260, 24, 30, 4]],
    lunch: [['Chipotle chicken bowl', 750, 55, 80, 22], ['Turkey sandwich + chips', 680, 38, 75, 24], ['Chicken, rice + broccoli', 620, 52, 70, 12]],
    dinner: [['Steak, potatoes + salad', 820, 60, 55, 38], ['Salmon + rice', 700, 45, 65, 25], ['Spaghetti with meat sauce', 780, 42, 95, 24]],
    snack: [['Protein shake', 160, 30, 4, 2], ['Protein bar', 210, 20, 22, 7], ['Apple + peanut butter', 290, 7, 28, 16]],
  };
  const ngoals = {};
  const food = [];
  const recovery = [];
  const hourNow = new Date().getHours();
  members.slice(1).forEach((m, mi) => {
    ngoals[m.id] = {
      userId: m.id, sex: 'male', birthYear: 1990 + Math.floor(rand() * 10), trainingDays: 4 + (mi % 3),
      goal: ['cut', 'bulk', 'maintain'][mi % 3], targetWeight: null, targetDate: null,
      calories: null, protein: null, carbs: null, fat: null,
    };
    for (const d of [-1, 0]) {
      const meals = d < 0 ? ['breakfast', 'lunch', 'snack', 'dinner'] : ['breakfast', 'lunch', 'snack', 'dinner'].slice(0, hourNow < 11 ? 1 : hourNow < 15 ? 2 : hourNow < 19 ? 3 : 4);
      meals.forEach((meal, k) => {
        const [name, calories, protein, carbs, fat] = foods[meal][Math.floor(rand() * 3)];
        const t = day(d);
        t.setHours(7 + k * 4);
        food.push({ id: `f${mi}${d}${k}`, userId: m.id, date: ymd(day(d)), meal, name, calories, protein, carbs, fat, createdAt: t.toISOString() });
      });
      recovery.push({ id: `r${mi}${d}`, userId: m.id, date: ymd(day(d)), sleep: 5.5 + Math.floor(rand() * 6) / 2, soreness: 1 + Math.floor(rand() * 4), energy: 2 + Math.floor(rand() * 4), createdAt: stamp(day(d)) });
    }
  });

  return {
    me: 'me',
    team: { id: 'demo', name: 'Iron Crew', code: 'DEMO42' },
    members, events, posts, reactions, comments, lifts, weighins, goals, ngoals, food, recovery,
  };
}
