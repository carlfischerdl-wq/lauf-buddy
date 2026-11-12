// Liest Exporte aus der App "Health Auto Export" (JSON, Version 1 oder 2) aus data/inbox/,
// wandelt sie ins Format der Website um und speichert sie in data/workouts/ + data/index.json.
// Wird von der GitHub Action aufgerufen, sobald der Kurzbefehl eine Datei hochlädt.

import { readFile, writeFile, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA = path.join(ROOT, "data");
const INBOX = path.join(DATA, "inbox");
const WORKOUTS = path.join(DATA, "workouts");
const INDEX = path.join(DATA, "index.json");

// "2024-02-06 14:30:00 -0800" → Date
export function parseHaeDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})$/);
  const d = m ? new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : new Date(s);
  return isNaN(d) ? null : d;
}

const qty = (o) => (o && typeof o === "object" ? o.qty : typeof o === "number" ? o : null);
function toMeters(o) {
  const q = qty(o);
  if (q == null) return null;
  const u = (o.units || "km").toLowerCase();
  return u === "km" ? q * 1000 : u === "mi" ? q * 1609.344 : u === "m" ? q : u === "ft" ? q * 0.3048 : u === "yd" ? q * 0.9144 : q * 1000;
}
function toKcal(o) {
  const q = qty(o);
  if (q == null) return null;
  return (o.units || "kcal").toLowerCase() === "kj" ? q / 4.184 : q;
}
const haversine = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// Baut 10-Sekunden-Verläufe (Zeit, Puls, Distanz, Tempo, Höhe) aus Pulsdaten und GPS-Route
function buildStreams(w, start, durationSec) {
  const hrPts = (w.heartRateData || [])
    .map((h) => ({ t: (parseHaeDate(h.date) - start) / 1000, hr: h.Avg ?? h.avg ?? h.qty }))
    .filter((h) => Number.isFinite(h.t) && h.hr > 0)
    .sort((a, b) => a.t - b.t);
  const route = (w.route || [])
    .map((p) => ({ t: (parseHaeDate(p.timestamp) - start) / 1000, lat: p.latitude ?? p.lat, lon: p.longitude ?? p.lon, alt: p.altitude, v: p.speed }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat))
    .sort((a, b) => a.t - b.t);
  if (route.length > 1) {
    route[0].d = 0;
    for (let i = 1; i < route.length; i++) route[i].d = route[i - 1].d + haversine(route[i - 1], route[i]);
  }
  if (hrPts.length < 3 && route.length < 10) return null;

  const T = Math.max(durationSec, hrPts.at(-1)?.t || 0, route.at(-1)?.t || 0);
  const s = { t: [], hr: [] };
  if (route.length > 1) Object.assign(s, { d: [], v: [], alt: [] });
  let hi = 0, ri = 0;
  for (let t = 0; t <= T; t += 10) {
    while (hi < hrPts.length - 1 && hrPts[hi + 1].t <= t) hi++;
    s.t.push(t);
    const h = hrPts[hi];
    s.hr.push(h && Math.abs(h.t - t) < 180 ? Math.round(h.hr) : null);
    if (s.d) {
      while (ri < route.length - 1 && route[ri + 1].t <= t) ri++;
      const a = route[ri], b = route[Math.min(ri + 1, route.length - 1)];
      const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
      s.d.push(Math.round(a.d + f * (b.d - a.d)));
      // Tempo aus Strecke über ±20 s (robuster als einzelne GPS-Werte)
      s.alt.push(a.alt != null ? Math.round(a.alt) : null);
    }
  }
  if (s.d) {
    for (let i = 0; i < s.d.length; i++) {
      const a = Math.max(0, i - 2), b = Math.min(s.d.length - 1, i + 2);
      s.v.push(b > a ? Math.round(((s.d[b] - s.d[a]) / (s.t[b] - s.t[a])) * 100) / 100 : null);
    }
  }
  if (!s.hr.some(Boolean)) delete s.hr;
  return s;
}

export function normalizeHae(w) {
  const start = parseHaeDate(w.start);
  const end = parseHaeDate(w.end);
  if (!start) return null;
  const durationSec = Math.round(w.duration ?? (end ? (end - start) / 1000 : 0));
  const streams = buildStreams(w, start, durationSec);
  let distanceM = toMeters(w.distance);
  if (!distanceM && streams?.d) distanceM = streams.d.at(-1);
  const hrs = streams?.hr?.filter(Boolean) || [];
  const avgHr = qty(w.avgHeartRate) ?? qty(w.heartRate?.avg) ?? (hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null);
  const maxHr = qty(w.maxHeartRate) ?? qty(w.heartRate?.max) ?? (hrs.length ? Math.max(...hrs) : null);
  const elev = w.elevationUp ?? w.elevation?.ascent;
  return {
    id: w.id ? String(w.id) : `hae-${start.getTime()}`,
    source: "health-auto-export",
    name: w.name || "Training",
    type: w.name || "Workout",
    start: start.toISOString(),
    startLocal: start.toISOString(),
    durationSec,
    elapsedSec: end ? Math.round((end - start) / 1000) : durationSec,
    distanceM: Math.round(distanceM || 0),
    elevationGainM: elev ? Math.round((elev.units || "m").toLowerCase().startsWith("ft") ? qty(elev) * 0.3048 : qty(elev)) : null,
    avgHr: avgHr ? Math.round(avgHr * 10) / 10 : null,
    maxHr: maxHr ? Math.round(maxHr) : null,
    avgCadence: qty(w.stepCadence) ? Math.round(qty(w.stepCadence)) : null,
    calories: toKcal(w.activeEnergyBurned ?? w.activeEnergy) ? Math.round(toKcal(w.activeEnergyBurned ?? w.activeEnergy)) : null,
    streams,
  };
}

// Sucht hochgeladene Exporte: data/upload.json (fester Name), data/inbox/*.json
// und data/inbox, falls versehentlich als Datei statt Ordner angelegt.
const HEALTH = path.join(DATA, "health.json");
// HAE-Gesundheitsmetriken: Ruheherzfrequenz pro Tag übernehmen
function mergeMetrics(health, metrics) {
  let n = 0;
  for (const m of metrics) {
    if (!/resting_heart_rate|ruheherz/i.test(m.name || "")) continue;
    for (const d of m.data || []) {
      const v = Number(d.qty ?? d.Avg ?? d.avg);
      const day = String(d.date || "").slice(0, 10);
      if (v > 30 && /^\d{4}-\d{2}-\d{2}$/.test(day)) { health.resting[day] = Math.round(v); n++; }
    }
  }
  return n;
}

async function findUploads() {
  const out = [];
  for (const f of await readdir(DATA)) if (/^upload.*\.json$/i.test(f)) out.push(path.join(DATA, f));
  if (existsSync(INBOX)) {
    if ((await stat(INBOX)).isDirectory()) {
      for (const f of await readdir(INBOX)) if (f.toLowerCase().endsWith(".json")) out.push(path.join(INBOX, f));
    } else out.push(INBOX);
  }
  return out;
}

async function main() {
  const files = await findUploads();
  if (!files.length) { console.log("Keine neuen Dateien."); return; }
  const index = existsSync(INDEX) ? JSON.parse(await readFile(INDEX, "utf8")) : { workouts: [] };
  const known = new Set(index.workouts.map((w) => w.id));
  const knownStarts = new Set(index.workouts.map((w) => w.start));
  await mkdir(WORKOUTS, { recursive: true });
  let added = 0, healthAdded = 0;
  const health = existsSync(HEALTH) ? JSON.parse(await readFile(HEALTH, "utf8")) : { resting: {} };

  for (const file of files) {
    const f = path.basename(file);
    try {
      const raw = JSON.parse(await readFile(file, "utf8"));
      const metrics = raw?.data?.metrics ?? raw?.metrics;
      if (Array.isArray(metrics)) healthAdded += mergeMetrics(health, metrics);
      const list = raw?.data?.workouts ?? raw?.workouts ?? (metrics ? [] : Array.isArray(raw) ? raw : [raw]);
      for (const w of list) {
        const n = normalizeHae(w);
        if (!n || n.durationSec < 120) continue;
        if (known.has(n.id) || knownStarts.has(n.start)) continue;
        await writeFile(path.join(WORKOUTS, `${n.id}.json`), JSON.stringify(n));
        const { streams, ...summary } = n;
        index.workouts.push({ ...summary, hasStreams: !!streams });
        known.add(n.id); knownStarts.add(n.start);
        added++;
        console.log(`+ ${n.start.slice(0, 16)}  ${n.name}  ${(n.distanceM / 1000).toFixed(2)} km`);
      }
      await unlink(file);
    } catch (e) {
      console.error(`Datei ${f} konnte nicht gelesen werden: ${e.message}`);
    }
  }
  if (healthAdded) { await writeFile(HEALTH, JSON.stringify(health, null, 1)); console.log(`Ruhepuls: ${healthAdded} Tage aktualisiert.`); }
  index.workouts.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  index.lastSync = new Date().toISOString();
  await writeFile(INDEX, JSON.stringify(index, null, 1));
  console.log(`Fertig: ${added} neue Trainings, ${index.workouts.length} insgesamt.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
