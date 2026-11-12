// Analyse eines Laufs: Pulszonen, Belastung, Effizienz, Note 1–10 und Textzusammenfassung.
// Reines ES-Modul ohne Abhängigkeiten – läuft im Browser und in Node (für Tests).

export const DAY = 86400000;

// ---------- Hilfsfunktionen ----------
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export function lin(x, x0, y0, x1, y1) {
  const t = clamp((x - x0) / (x1 - x0), 0, 1);
  return y0 + t * (y1 - y0);
}
const median = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const mean = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
};
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

export function fmtPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return "–";
  let m = Math.floor(secPerKm / 60);
  let s = Math.round(secPerKm % 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, "0")}`;
}
export function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return "–";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
export const fmtKm = (m) => (m / 1000).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const paceOf = (w) => (w.distanceM > 0 ? w.durationSec / (w.distanceM / 1000) : null);
export const dateOf = (w) => new Date(w.start);
export function localDayKey(d) {
  d = new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- Profil & Pulszonen ----------
export function buildProfile(config = {}, overrides = {}, workouts = []) {
  const c = { ...config, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== "" && v != null)) };
  const year = Number(c.geburtsjahr) || null;
  const age = year ? new Date().getFullYear() - year : null;
  const observedMax = Math.max(0, ...workouts.filter((w) => Date.now() - Date.parse(w.start) < 365 * DAY).map((w) => w.maxHr || 0));
  let maxHr = Number(c.maxHF) || null;
  let maxHrSource = "eingetragen";
  if (!maxHr) {
    const est = age ? Math.round(208 - 0.7 * age) : 195;
    maxHr = Math.max(est, observedMax || 0);
    maxHrSource = observedMax >= est ? "höchster gemessener Wert" : age ? "geschätzt aus Alter" : "Standardwert (Alter eintragen!)";
  }
  const restHr = Number(c.ruheHF) || 60;
  // Pulszonen der Apple Watch: Untergrenzen von Zone 2, 3, 4, 5 in bpm
  let zones = Array.isArray(c.zonen) ? c.zonen.map(Number) : null;
  if (!zones || zones.length !== 4 || zones.some((z, i) => !(z > 40) || (i && z <= zones[i - 1]))) zones = null;
  if (zones && zones[3] >= maxHr) maxHr = zones[3] + 10;
  return { name: c.name || "", age, maxHr, restHr, zones, maxHrSource, restHrSource: Number(c.ruheHF) ? "eingetragen" : "Standardwert" };
}

export const ZONES = [
  { z: 1, label: "Z1 Regeneration", from: 0.5, to: 0.6 },
  { z: 2, label: "Z2 Grundlage", from: 0.6, to: 0.7 },
  { z: 3, label: "Z3 Aerob/Tempo", from: 0.7, to: 0.8 },
  { z: 4, label: "Z4 Schwelle", from: 0.8, to: 0.9 },
  { z: 5, label: "Z5 Maximal", from: 0.9, to: 1.0 },
];
// Intensitätsskala 0–1: Zonengrenzen liegen bei 0,6 / 0,7 / 0,8 / 0,9.
// Mit Watch-Zonen wird stückweise linear zwischen deinen Zonengrenzen gerechnet,
// sonst nach Karvonen (Herzfrequenzreserve).
const zonePoints = (p) => [[0, p.restHr], [0.6, p.zones[0]], [0.7, p.zones[1]], [0.8, p.zones[2]], [0.9, p.zones[3]], [1, p.maxHr]];
export function hrrOf(hr, p) {
  if (!p.zones) return (hr - p.restHr) / (p.maxHr - p.restHr);
  const pts = zonePoints(p);
  if (hr <= pts[0][1]) return 0;
  for (let i = 1; i < pts.length; i++) {
    const [f0, h0] = pts[i - 1], [f1, h1] = pts[i];
    if (hr <= h1) return f0 + ((hr - h0) / (h1 - h0)) * (f1 - f0);
  }
  return 1 + (hr - p.maxHr) / (p.maxHr - p.restHr);
}
export function hrAt(frac, p) {
  if (!p.zones) return Math.round(p.restHr + frac * (p.maxHr - p.restHr));
  const pts = zonePoints(p);
  for (let i = 1; i < pts.length; i++) {
    const [f0, h0] = pts[i - 1], [f1, h1] = pts[i];
    if (frac <= f1) return Math.round(h0 + ((frac - f0) / (f1 - f0)) * (h1 - h0));
  }
  return p.maxHr;
}
export function zoneOf(hr, p) {
  const f = hrrOf(hr, p);
  if (f < 0.6) return 1;
  if (f < 0.7) return 2;
  if (f < 0.8) return 3;
  if (f < 0.9) return 4;
  return 5;
}
export function zoneBounds(p) {
  return ZONES.map((z) => ({ ...z, hrFrom: z.z === 1 && p.zones ? p.restHr : hrAt(z.from, p), hrTo: hrAt(z.to, p) }));
}

// Sekunden je Zone (aus Pulsverlauf, sonst Näherung über Durchschnittspuls)
export function zoneSeconds(w, p) {
  const out = [0, 0, 0, 0, 0];
  const s = w.streams;
  if (s?.hr?.length > 5) {
    for (let i = 1; i < s.t.length; i++) {
      const hr = s.hr[i];
      const dt = Math.min(s.t[i] - s.t[i - 1], 30); // Pausen nicht mitzählen
      if (hr) out[zoneOf(hr, p) - 1] += dt;
    }
    return { seconds: out, exact: true };
  }
  if (w.avgHr) {
    out[zoneOf(w.avgHr, p) - 1] = w.durationSec;
    return { seconds: out, exact: false };
  }
  return null;
}

// ---------- Belastung (TRIMP nach Banister) ----------
export function trimp(w, p) {
  const mins = w.durationSec / 60;
  const f = w.avgHr ? clamp(hrrOf(w.avgHr, p), 0, 1) : 0.65; // ohne Puls: moderate Annahme
  return mins * f * 0.64 * Math.exp(1.92 * f);
}

export function loadRatio(w, history, p) {
  const t = Date.parse(w.start);
  const inRange = (days) => history.filter((h) => { const d = t - Date.parse(h.start); return d >= 0 && d < days * DAY; });
  const acute = inRange(7).reduce((s, h) => s + trimp(h, p), 0) + trimp(w, p);
  const chronicRuns = inRange(28);
  const chronic = (chronicRuns.reduce((s, h) => s + trimp(h, p), 0) + trimp(w, p)) / 4;
  const oldest = history.length ? Math.max(...history.map((h) => t - Date.parse(h.start))) : 0;
  return { acute, chronic, ratio: chronic > 0 ? acute / chronic : null, enoughHistory: oldest >= 21 * DAY && chronicRuns.length >= 4 };
}

// ---------- Effizienz & Entkopplung ----------
export const efficiency = (w) => (w.avgHr && w.distanceM ? (w.distanceM / (w.durationSec / 60)) / w.avgHr : null);

export function decoupling(w) {
  const s = w.streams;
  if (!s?.hr || !s?.d || s.t.length < 30) return null;
  const T = s.t[s.t.length - 1];
  if (T < 20 * 60) return null; // erst ab 20 Minuten sinnvoll
  const start = Math.min(300, T * 0.1); // Einlaufen ignorieren
  const mid = start + (T - start) / 2;
  const half = (a, b) => {
    let dist = 0, hrSum = 0, time = 0;
    for (let i = 1; i < s.t.length; i++) {
      if (s.t[i] <= a || s.t[i] > b) continue;
      const dt = Math.min(s.t[i] - s.t[i - 1], 30);
      if (!s.hr[i]) continue;
      dist += Math.max(0, s.d[i] - s.d[i - 1]);
      hrSum += s.hr[i] * dt;
      time += dt;
    }
    return time && hrSum ? (dist / time) / (hrSum / time) : null;
  };
  const e1 = half(start, mid), e2 = half(mid, T);
  return e1 && e2 ? (e1 - e2) / e1 : null;
}

// Erkennt schnelle Abschnitte (Intervalle) im Geschwindigkeitsverlauf
export function fastSegments(w) {
  const s = w.streams;
  if (!s?.v || s.v.length < 30) return [];
  const med = median(s.v.filter((v) => v > 0.5));
  if (!med) return [];
  const segs = [];
  let cur = null;
  for (let i = 0; i < s.v.length; i++) {
    const fast = s.v[i] > med * 1.12;
    if (fast && !cur) cur = { i0: i, t0: s.t[i] };
    if ((!fast || i === s.v.length - 1) && cur) {
      cur.t1 = s.t[i];
      cur.dur = cur.t1 - cur.t0;
      if (cur.dur >= 40) {
        const vs = s.v.slice(cur.i0, i + 1);
        cur.v = mean(vs);
        segs.push(cur);
      }
      cur = null;
    }
  }
  return segs;
}

// ---------- Fitness (VDOT nach Jack Daniels) ----------
export const vo2AtSpeed = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v; // v in m/min
export const pctMaxAt = (tMin) => 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
export const vdotFromRace = (dM, tSec) => vo2AtSpeed(dM / (tSec / 60)) / pctMaxAt(tSec / 60);
export function speedForVo2(vo2) {
  const a = 0.000104, b = 0.182258, c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}
export const paceForPct = (vdot, pct) => 60000 / speedForVo2(vdot * pct); // s/km
export function predictTime(vdot, dM) {
  let lo = 60, hi = 12 * 3600;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFromRace(dM, mid) > vdot) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
export function trainingPaces(vdot) {
  return {
    E: [paceForPct(vdot, 0.74), paceForPct(vdot, 0.65)],
    M: paceForPct(vdot, 0.8),
    T: paceForPct(vdot, 0.88),
    I: paceForPct(vdot, 0.975),
    R: paceForPct(vdot, 1.05),
  };
}

// Schätzt die aktuelle Form aus den letzten Läufen (Puls-basiert, robust über Median)
export function estimateVdot(workouts, p) {
  const recent = workouts
    .filter((w) => Date.now() - Date.parse(w.start) < 90 * DAY && w.distanceM > 2000 && w.durationSec > 600)
    .slice(0, 15);
  const hrEst = [];
  let bestRace = 0;
  for (const w of recent) {
    const v = w.distanceM / (w.durationSec / 60);
    const vo2 = vo2AtSpeed(v);
    if (w.avgHr) {
      const f = hrrOf(w.avgHr, p);
      if (f > 0.5 && f < 0.97) hrEst.push((vo2 - 3.5) / f + 3.5);
      if (f >= 0.85) bestRace = Math.max(bestRace, vdotFromRace(w.distanceM, w.durationSec));
    }
  }
  const est = median(hrEst);
  if (!est && !bestRace) return null;
  return round(clamp(Math.max(est || 0, bestRace), 20, 85), 1);
}

// ---------- Lauftyp erkennen ----------
export const TYPE_LABELS = {
  recovery: "Regenerationslauf",
  easy: "Lockerer Lauf",
  long: "Langer Lauf",
  tempo: "Tempolauf",
  interval: "Intervalltraining",
  race: "Wettkampf / Test",
};

export function classify(w, p, history) {
  const segs = fastSegments(w);
  if (segs.length >= 3 && segs.length <= 30) return "interval";
  const f = w.avgHr ? hrrOf(w.avgHr, p) : null;
  const medDur = median(history.filter((h) => Date.parse(w.start) - Date.parse(h.start) < 42 * DAY).map((h) => h.durationSec)) || 2400;
  if (f != null && f >= 0.86 && w.durationSec >= 900) return "race";
  if (f != null && f >= 0.74) return "tempo";
  if (w.durationSec >= Math.max(70 * 60, medDur * 1.4)) return "long";
  if (f != null && f < 0.6 && w.durationSec < 40 * 60) return "recovery";
  return "easy";
}

// ---------- Hauptfunktion: Analyse eines Laufs ----------
export function analyzeRun(w, allWorkouts, p, plannedSession = null) {
  const t = Date.parse(w.start);
  const history = allWorkouts.filter((h) => h.id !== w.id && Date.parse(h.start) < t);
  const detected = classify(w, p, history);
  const intent = plannedSession?.type && TYPE_LABELS[plannedSession.type] ? plannedSession.type : detected;
  const zs = zoneSeconds(w, p);
  const zb = zoneBounds(p);
  const comps = [];
  const plus = [];
  const minus = [];

  // 1) Zielbereich: passt die Intensität zum Trainingsziel?
  {
    let score = 6.5, text = "Keine Pulsdaten – Intensität nicht bewertbar.";
    if (zs) {
      const tot = zs.seconds.reduce((a, b) => a + b, 0) || 1;
      const sh = zs.seconds.map((x) => x / tot);
      const low = sh[0] + sh[1], mid = sh[2] + sh[3], high = sh[3] + sh[4];
      if (intent === "easy" || intent === "recovery") {
        score = lin(low, 0.45, 2.5, 0.85, 10);
        text = `${Math.round(low * 100)} % der Zeit in Zone 1–2.`;
        if (score >= 8) plus.push(`Locker geblieben: ${Math.round(low * 100)} % in Zone 1–2 – genau so baust du Grundlagenausdauer auf.`);
        else minus.push(`Für einen lockeren Lauf zu intensiv – nur ${Math.round(low * 100)} % in Zone 1–2. Nimm Tempo raus und bleib unter ${zb[1].hrTo} bpm.`);
      } else if (intent === "long") {
        const ok = low + sh[2];
        score = Math.min(lin(ok, 0.6, 3, 0.92, 10), lin(sh[4], 0.15, 10, 0.35, 4));
        text = `${Math.round(ok * 100)} % in Zone 1–3.`;
        if (score >= 8) plus.push("Langer Lauf schön kontrolliert im aeroben Bereich.");
        else minus.push(`Langer Lauf zu hart – möglichst unter ${zb[2].hrTo} bpm bleiben, damit du dich schnell erholst.`);
      } else if (intent === "tempo") {
        score = Math.min(lin(mid, 0.3, 4, 0.7, 10), lin(sh[4], 0.2, 10, 0.5, 4));
        text = `${Math.round(mid * 100)} % in Zone 3–4.`;
        if (score >= 8) plus.push(`Tempoarbeit getroffen: ${Math.round(mid * 100)} % der Zeit in Zone 3–4.`);
        else minus.push(`Für einen Tempolauf zu selten im Zielbereich (${zb[2].hrFrom}–${zb[3].hrTo} bpm).`);
      } else if (intent === "interval") {
        score = lin(high, 0.05, 4, 0.25, 10);
        text = `${Math.round(high * 100)} % in Zone 4–5.`;
        if (score >= 8) plus.push("Intervalle mit echtem Reiz – du warst lange genug in Zone 4–5.");
        else minus.push("Belastungsphasen waren zu kurz oder zu locker für Intervalle.");
      } else if (intent === "race") {
        score = lin(high, 0.3, 5, 0.75, 10);
        text = `${Math.round(high * 100)} % in Zone 4–5.`;
        if (score >= 8) plus.push("Volle Leistung abgerufen – starker Test.");
      }
      if (!zs.exact) text += " (Näherung über Durchschnittspuls)";
    }
    comps.push({ key: "zone", label: "Intensität passend", weight: 0.3, score, text });
  }

  // 2) Effizienz: Tempo pro Herzschlag vs. deine letzten 6 Wochen
  {
    let score = 6.5, text = "Noch zu wenig Vergleichsläufe mit Puls.";
    const ef = efficiency(w);
    const base = mean(history.filter((h) => t - Date.parse(h.start) < 42 * DAY).map(efficiency));
    const n = history.filter((h) => t - Date.parse(h.start) < 42 * DAY && efficiency(h)).length;
    if (ef && base && n >= 3) {
      const r = ef / base;
      score = lin(r, 0.92, 2, 1.06, 10);
      const pct = Math.round((r - 1) * 100);
      text = `${pct >= 0 ? "+" : ""}${pct} % ggü. deinem 6-Wochen-Schnitt.`;
      if (r >= 1.03) plus.push(`Effizienter als sonst: ${pct} % mehr Tempo pro Herzschlag – deine Form steigt.`);
      if (r <= 0.95) minus.push("Weniger Tempo pro Herzschlag als üblich – oft Müdigkeit, Hitze, Hügel oder wenig Schlaf. Kein Drama, aber beobachten.");
    } else if (!ef) text = "Keine Pulsdaten.";
    comps.push({ key: "eff", label: "Effizienz", weight: 0.25, score, text });
  }

  // 3) Belastungssteuerung: akut (7 Tage) vs. chronisch (28 Tage)
  const load = loadRatio(w, history, p);
  {
    let score = 7, text = "Noch keine 3 Wochen Daten – Belastung neutral bewertet.";
    if (load.enoughHistory && load.ratio) {
      const r = load.ratio;
      score = r < 0.8 ? 7.5 : r <= 1.3 ? 10 : r <= 1.5 ? lin(r, 1.3, 9, 1.5, 5) : lin(r, 1.5, 5, 2.0, 1.5);
      text = `Belastungsquote ${round(r, 2).toLocaleString("de-DE")} (ideal 0,8–1,3).`;
      if (r > 1.3) minus.push(`Deine 7-Tage-Belastung liegt ${Math.round((r - 1) * 100)} % über deinem 4-Wochen-Schnitt – das Verletzungsrisiko steigt. Plane bewusst Erholung ein.`);
      else if (r >= 0.8) plus.push("Belastung im grünen Bereich – gute Steigerung ohne Überlastung.");
    }
    comps.push({ key: "load", label: "Belastungssteuerung", weight: 0.2, score, text });
  }

  // 4) Gleichmäßigkeit: Puls-Drift bzw. Konstanz der Intervalle
  {
    let score = 6.5, text = "Kein Puls-/Tempoverlauf vorhanden.";
    if (intent === "interval") {
      const segs = fastSegments(w);
      if (segs.length >= 3) {
        const vs = segs.map((s) => s.v);
        const cv = Math.sqrt(mean(vs.map((v) => (v - mean(vs)) ** 2))) / mean(vs);
        score = lin(cv, 0.03, 10, 0.12, 3.5);
        text = `${segs.length} schnelle Abschnitte, Tempo schwankt um ${Math.round(cv * 100)} %.`;
        if (cv < 0.05) plus.push("Intervalle sehr gleichmäßig gelaufen – gutes Pacing.");
        else if (cv > 0.09) minus.push("Intervalle unterschiedlich schnell – erste Wiederholungen etwas ruhiger angehen.");
      }
    } else {
      const dc = decoupling(w);
      if (dc != null) {
        score = lin(dc, 0.04, 10, 0.13, 3);
        text = `Puls-Tempo-Entkopplung ${round(dc * 100, 1).toLocaleString("de-DE")} % (gut < 5 %).`;
        if (dc < 0.05) plus.push("Puls blieb über den ganzen Lauf stabil – starke aerobe Basis.");
        else if (dc > 0.09) minus.push(`Puls stieg in der zweiten Hälfte deutlich (${Math.round(dc * 100)} % Drift): anfangs ruhiger starten, ausreichend trinken.`);
      } else if (w.durationSec < 20 * 60) text = "Lauf zu kurz für eine Drift-Analyse.";
    }
    comps.push({ key: "even", label: "Gleichmäßigkeit", weight: 0.15, score, text });
  }

  // 5) Umfang: wie geplant bzw. im Verhältnis zu deinen üblichen Läufen
  {
    let score, text;
    if (plannedSession?.durationMin) {
      const r = w.durationSec / 60 / plannedSession.durationMin;
      score = lin(Math.abs(1 - r), 0.1, 10, 0.5, 3);
      text = `${Math.round(r * 100)} % der geplanten ${plannedSession.durationMin} min.`;
      if (score >= 9) plus.push("Plan-Einheit im Umfang genau getroffen.");
      else if (r < 0.8) minus.push("Einheit deutlich kürzer als geplant.");
      else if (r > 1.25) minus.push("Deutlich länger als geplant – mehr ist nicht immer besser.");
    } else {
      const med = median(history.filter((h) => t - Date.parse(h.start) < 28 * DAY).map((h) => h.durationSec));
      const r = med ? w.durationSec / med : 1;
      score = w.durationSec < 15 * 60 ? 4 : lin(r, 0.4, 4, 0.9, 10);
      text = med ? `${Math.round(r * 100)} % deiner üblichen Laufdauer.` : "Erster Vergleichswert.";
    }
    comps.push({ key: "vol", label: "Umfang", weight: 0.1, score, text });
  }

  const total = clamp(round(comps.reduce((s, c) => s + c.score * c.weight, 0), 1), 1, 10);
  comps.forEach((c) => (c.score = round(c.score, 1)));

  const headline =
    total >= 8.5 ? "Starkes Training" : total >= 7 ? "Gutes Training" : total >= 5.5 ? "Solides Training" : total >= 4 ? "Ausbaufähig" : "Schwieriger Tag";

  const pace = paceOf(w);
  const summary =
    `${TYPE_LABELS[intent]} über ${fmtKm(w.distanceM)} km in ${fmtDuration(w.durationSec)} ` +
    `(Ø ${fmtPace(pace)} min/km${w.avgHr ? `, Ø ${Math.round(w.avgHr)} bpm` : ""}${w.elevationGainM ? `, ${Math.round(w.elevationGainM)} Hm` : ""}).`;

  // Empfehlung für den nächsten Lauf
  let next;
  const hard = ["interval", "tempo", "race", "long"].includes(intent);
  if (load.enoughHistory && load.ratio > 1.4) next = "Morgen Ruhetag – deine Wochenbelastung ist hoch.";
  else if (hard) next = `Nächster Lauf locker: 30–45 min in Zone 2 (unter ${zb[1].hrTo} bpm) oder Ruhetag.`;
  else next = `Du bist bereit für eine Qualitätseinheit (z. B. Tempo- oder Intervalltraining) – oder einen weiteren lockeren Lauf unter ${zb[1].hrTo} bpm.`;

  return {
    score: total,
    headline,
    summary,
    type: intent,
    detectedType: detected,
    typeLabel: TYPE_LABELS[intent],
    components: comps,
    positives: plus.slice(0, 3),
    improvements: minus.slice(0, 3),
    next,
    zones: zs,
    load,
    trimp: round(trimp(w, p)),
  };
}
