// Should this run hand off to another in ~50 min? GitHub's cron often skips hours, so each run schedules the next
// while today still has clips to post inside the IST window.
import fs from 'node:fs';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const state = readJson('state/published.json', { items: {} }), queue = readJson('queue.json', { items: [] }), limits = readJson('limits.json', {});
const ist = new Date(Date.now() + 5.5 * 3600e3), h = ist.getUTCHours() + ist.getUTCMinutes() / 60;
const day = ist.toISOString().slice(0, 10);
const istDate = d => new Date(new Date(d).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const posted = Object.values(state.items).filter(v => istDate(v.ts) === day).length;
const pending = queue.items.filter(i => !state.items[i.id]).length;
const more = !fs.existsSync('PAUSED') && !!process.env.HAS_TOKEN && h >= limits.earliest_hour_ist && h < limits.latest_hour_ist && pending > 0 && posted < limits.max_per_day;
console.log(`IST ${h.toFixed(1)}, pending ${pending}, posted today ${posted} -> continue: ${more}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `more=${more}\n`);
