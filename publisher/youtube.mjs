// Uploads clips the publisher has posted to Instagram to the Startup Gyaan Daily YouTube channel, one per run, and
// records the video id in state. Off until Google's API audit passes (repo variable YT_CLOUD=1 turns it on); before
// that, uploads from this API project are forced private. Refuses any channel but Startup Gyaan Daily.
// usage: node publisher/youtube.mjs            (GitHub Actions, next posted clip without a YouTube id)
//        node publisher/youtube.mjs --test <mp4> (one private test upload, not recorded)
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const CHANNEL = 'UCr6ziR0pcV9Ubz-gsJnsNxQ';
const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
const PRIVACY = process.env.YT_PRIVACY || 'private';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) { console.log('no YouTube login yet: nothing uploaded'); process.exit(0); }

const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
  client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET, refresh_token: YT_REFRESH_TOKEN, grant_type: 'refresh_token' }) })).json();
if (!tok.access_token) { console.error(`YOUTUBE LOGIN FAILED ${tok.error}: ${tok.error_description || ''}`); process.exit(7); }

async function upload(file, title, description, privacy) {
  const size = fs.statSync(file).size;
  const meta = { snippet: { title: title.slice(0, 100), description: description.slice(0, 4900), categoryId: '22' },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } };
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', body: JSON.stringify(meta), headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json',
      'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(size) } });
  if (!start.ok) throw new Error(`start ${start.status}: ${(await start.text()).slice(0, 300)}`);
  const put = await fetch(start.headers.get('location'), { method: 'PUT', body: fs.readFileSync(file), headers: { 'Content-Type': 'video/mp4' } });
  const v = await put.json();
  if (!put.ok || !v.id) throw new Error(`upload ${put.status}: ${JSON.stringify(v).slice(0, 300)}`);
  if (v.snippet?.channelId !== CHANNEL) console.error(`WARNING: uploaded to channel ${v.snippet?.channelId}, not Startup Gyaan Daily. Log in again and pick the right channel.`);
  return v;
}

if (process.argv[2] === '--test') {
  const v = await upload(process.argv[3], 'Uploader test (private)', 'Test upload from the Startup Gyaan uploader.', 'private');
  console.log(`TEST OK: private video ${v.id} on channel ${v.snippet?.channelId === CHANNEL ? 'Startup Gyaan Daily' : v.snippet?.channelId}, status ${v.status?.privacyStatus}`);
  process.exit(0);
}

const state = readJson('state/published.json', { items: {} }), queue = readJson('queue.json', { items: [] });
const it = queue.items.find(i => state.items[i.id] && !state.items[i.id].yt_id && !state.items[i.id].note?.startsWith('seed'));
if (!it) { console.log('nothing to upload to YouTube'); process.exit(0); }
try {
  const v = await upload(it.video, it.title, it.caption, PRIVACY);
  state.items[it.id].yt_id = v.id;
  fs.writeFileSync('state/published.json', JSON.stringify(state, null, 2));
  if (process.env.GITHUB_ACTIONS) execSync(`git add state && git commit -q -m "youtube: ${it.id}" && git pull -q --rebase && git push -q`);
  console.log(`YOUTUBE ${it.id}: https://youtube.com/shorts/${v.id} (${v.status?.privacyStatus})`);
} catch (e) { console.error(`YOUTUBE FAILED ${it.id}: ${e.message}`); process.exit(8); }
