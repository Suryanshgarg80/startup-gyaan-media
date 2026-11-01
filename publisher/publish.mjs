// Runs on GitHub Actions so @startupgyaan.daily posts Reels even when the Mac is asleep. Posts at most one queued
// clip per run, oldest first, within limits.json (per day, gap, IST window). State is committed after every post so
// nothing is posted twice. Refuses to post unless the token belongs to @startupgyaan.daily: India clips never go elsewhere.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const API = 'https://graph.instagram.com/v23.0';
const ACCOUNT = 'startupgyaan.daily';
const { IG_USER_ID, IG_ACCESS_TOKEN, GITHUB_REPOSITORY } = process.env;
const DRY = process.env.DRY_RUN === '1';
const RAW = `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/main`;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const state = readJson('state/published.json', { items: {}, last_ts: null, events: [] });
const queue = readJson('queue.json', { items: [] });
const limits = readJson('limits.json', {});
const save = () => fs.writeFileSync('state/published.json', JSON.stringify(state, null, 2));
const event = e => { state.events = [...(state.events || []), { ts: new Date().toISOString(), ...e }].slice(-300); };
const istDate = d => new Date(new Date(d).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const istHour = d => { const x = new Date(new Date(d).getTime() + 5.5 * 3600e3); return x.getUTCHours() + x.getUTCMinutes() / 60; };

if (fs.existsSync('PAUSED')) { console.log(`paused: ${fs.readFileSync('PAUSED', 'utf8').trim()}`); process.exit(0); }
if (!IG_USER_ID || !IG_ACCESS_TOKEN) { console.log('no Instagram token yet: nothing posted'); process.exit(0); }
if (!DRY && state.blocked_until && new Date(state.blocked_until) > new Date()) { console.log(`cooling down until ${state.blocked_until}`); process.exit(0); }

async function call(path, params, method = 'POST') {
  const body = new URLSearchParams({ access_token: IG_ACCESS_TOKEN, ...params });
  const r = await fetch(method === 'GET' ? `${API}${path}?${body}` : `${API}${path}`, method === 'GET' ? {} : { method, body });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(JSON.stringify(j.error || j));
  return j;
}
const me = await call('/me', { fields: 'username,user_id' }, 'GET');
if (me.username !== ACCOUNT) { console.error(`token belongs to @${me.username}, not @${ACCOUNT}: refusing to post`); process.exit(6); }

const pending = queue.items.filter(it => !state.items[it.id]);
if (!pending.length) { console.log('queue empty'); process.exit(0); }
const now = new Date();
const postedToday = Object.values(state.items).filter(v => istDate(v.ts) === istDate(now)).length;
const gap = state.last_ts ? (now - new Date(state.last_ts)) / 60e3 : Infinity;
if (!DRY) {
  const h = istHour(now);
  if (h < limits.earliest_hour_ist || h >= limits.latest_hour_ist) { console.log(`outside posting window (IST hour ${h.toFixed(1)})`); process.exit(0); }
  if (postedToday >= limits.max_per_day) { console.log(`daily limit reached (${postedToday})`); process.exit(0); }
  if (gap < limits.min_gap_min) { console.log(`last post ${Math.round(gap)} min ago, waiting`); process.exit(0); }
}

function commit() {
  if (DRY || !process.env.GITHUB_ACTIONS) return;
  execSync('git config user.name "startup-gyaan-publisher" && git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  for (let i = 0; i < 5; i++) {
    try {
      execSync('git fetch -q origin main', { stdio: 'pipe' });
      try {
        const r = JSON.parse(execSync('git show origin/main:state/published.json', { stdio: 'pipe' }).toString());
        state.items = { ...(r.items || {}), ...state.items };
        if (r.last_ts && (!state.last_ts || r.last_ts > state.last_ts)) state.last_ts = r.last_ts;
      } catch {}
      save();
      execSync(`git reset -q --mixed origin/main && git add state && (git diff --cached --quiet || git commit -q -m "state: ${new Date().toISOString()}") && git push -q origin HEAD:main && git checkout -q -- .`, { stdio: 'pipe' });
      return;
    } catch (e) { console.error(`state push attempt ${i + 1} failed: ${String(e.message).slice(0, 200)}`); execSync('sleep 6'); }
  }
}
// Instagram can return an error for a post that still went live, so check before treating anything as failed
async function findLive(caption, sinceMs) {
  try {
    const r = await call(`/${IG_USER_ID}/media`, { fields: 'id,caption,timestamp,permalink', limit: '12' }, 'GET');
    const head = s => String(s || '').slice(0, 200);
    return r.data.find(m => head(m.caption) === head(caption) && new Date(m.timestamp).getTime() >= sinceMs - 120e3) || null;
  } catch { return null; }
}
async function waitReady(id) {
  for (let i = 0; i < 90; i++) {
    const s = await call(`/${id}`, { fields: 'status_code' }, 'GET');
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`container ${id}: ${s.status_code}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`container ${id} timed out`);
}
const record = (it, live, note) => {
  state.items[it.id] = { media_id: live.id, permalink: live.permalink, ts: new Date().toISOString(), title: it.title, ...(note ? { note } : {}) };
  state.last_ts = state.items[it.id].ts;
};

const it = pending[0];
const started = Date.now();
const already = DRY ? null : await findLive(it.caption, started - 72 * 3600e3);
if (already) { record(it, already, 'already live, not reposted'); event({ event: 'already_live', id: it.id }); save(); commit(); console.log(`already live: ${it.id}`); process.exit(0); }
try {
  const c = await call(`/${IG_USER_ID}/media`, { media_type: 'REELS', video_url: `${RAW}/${it.video}`, cover_url: `${RAW}/${it.cover}`, caption: it.caption, share_to_feed: 'true' });
  await waitReady(c.id);
  if (DRY) { console.log(`DRY RUN: container ${c.id} ready for ${it.id} on @${me.username}, not published`); process.exit(0); }
  let id;
  for (let i = 0; ; i++) {
    try { id = (await call(`/${IG_USER_ID}/media_publish`, { creation_id: c.id })).id; break; }
    catch (e) { if (i >= 5 || !String(e.message).includes('"code":9007')) throw e; await new Promise(r => setTimeout(r, 10000)); }
  }
  const { permalink } = await call(`/${id}`, { fields: 'permalink' }, 'GET');
  record(it, { id, permalink });
  event({ event: 'published', id: it.id, media_id: id });
  save(); commit();
  console.log(`PUBLISHED ${it.id}: ${permalink}`);
} catch (e) {
  const live = await findLive(it.caption, started);
  if (live) { record(it, live, 'went live despite an error'); event({ event: 'published_despite_error', id: it.id, reason: String(e.message).slice(0, 300) }); save(); commit(); console.log(`went live despite an error: ${it.id}`); process.exit(0); }
  if (/"code":4,|2207051|action is blocked/i.test(String(e.message))) state.blocked_until = new Date(Date.now() + 24 * 3600e3).toISOString();
  event({ event: 'publish_failed', id: it.id, reason: String(e.message).slice(0, 500) });
  save(); commit();
  console.error('PUBLISH FAILED', e.message);
  process.exit(5);
}
