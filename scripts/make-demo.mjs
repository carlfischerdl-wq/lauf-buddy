// Erzeugt realistische Demo-Läufe (data/demo/), damit die Website sofort etwas zeigt.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "data", "demo");
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function makeRun(id, date, kind, fitness) {
  const rest = 58, max = 192;
  const cfg = {
    easy: { min: 35 + rnd() * 15, v: 2.75, hrr: 0.64 },
    long: { min: 70 + rnd() * 25, v: 2.7, hrr: 0.67 },
    tempo: { min: 40, v: 3.35, hrr: 0.8 },
    interval: { min: 45, v: 2.8, hrr: 0.72 },
  }[kind];
  const T = Math.round(cfg.min * 60);
  const s = { t: [], hr: [], d: [], v: [], alt: [], cad: [] };
  let d = 0, hr = 95;
  for (let t = 0; t <= T; t += 10) {
    let v = cfg.v * fitness + (rnd() - 0.5) * 0.15;
    let target = rest + cfg.hrr * (max - rest);
    if (kind === "interval") {
      const inMain = t > 900 && t < T - 600;
      const fast = inMain && Math.floor((t - 900) / 240) % 2 === 0 && Math.floor((t - 900) / 240) < 12;
      if (fast) { v = 3.9 * fitness + (rnd() - 0.5) * 0.1; target = rest + 0.9 * (max - rest); }
    }
    if (kind === "tempo" && (t < 600 || t > T - 480)) { v = 2.8; target = rest + 0.65 * (max - rest); }
    target += (t / T) * (kind === "long" ? 9 : 4); // Drift
    hr += (target - hr) * 0.12 + (rnd() - 0.5) * 2;
    d += v * 10;
    s.t.push(t); s.hr.push(Math.round(hr)); s.d.push(Math.round(d)); s.v.push(Math.round(v * 100) / 100);
    s.alt.push(Math.round(40 + 8 * Math.sin(t / 400))); s.cad.push(Math.round(164 + v * 4 + (rnd() - 0.5) * 4));
  }
  const avgHr = s.hr.reduce((a, b) => a + b, 0) / s.hr.length;
  const names = { easy: "Lockerer Lauf", long: "Langer Sonntagslauf", tempo: "Tempolauf", interval: "Intervalle" };
  return {
    id: String(id), source: "demo", name: names[kind], type: "Run",
    start: date.toISOString(), startLocal: date.toISOString().slice(0, 19) + "Z",
    durationSec: T, elapsedSec: T + 60, distanceM: Math.round(d), elevationGainM: Math.round(20 + rnd() * 60),
    avgHr: Math.round(avgHr * 10) / 10, maxHr: Math.max(...s.hr), avgCadence: 170, calories: null, streams: s,
  };
}

const week = [[1, "easy"], [3, "interval"], [4, "easy"], [6, "long"]];
const workouts = [];
const now = new Date();
now.setHours(18, 0, 0, 0);
let id = 1000;
for (let w = 9; w >= 0; w--) {
  for (const [dow, kind] of week) {
    const date = new Date(now.getTime() - (w * 7 + (6 - dow)) * 86400000 - 86400000);
    if (date > now) continue;
    if (rnd() < 0.12) continue; // mal ausgelassen
    const k = w % 3 === 1 && kind === "interval" ? "tempo" : kind;
    workouts.push(makeRun(id++, date, k, 0.93 + (9 - w) * 0.008));
  }
}
await mkdir(path.join(OUT, "workouts"), { recursive: true });
for (const w of workouts) await writeFile(path.join(OUT, "workouts", `${w.id}.json`), JSON.stringify(w));
const index = {
  lastSync: new Date().toISOString(),
  demo: true,
  workouts: workouts.map(({ streams, ...r }) => ({ ...r, hasStreams: true })).sort((a, b) => Date.parse(b.start) - Date.parse(a.start)),
};
await writeFile(path.join(OUT, "index.json"), JSON.stringify(index));
console.log(`${workouts.length} Demo-Läufe erzeugt`);
