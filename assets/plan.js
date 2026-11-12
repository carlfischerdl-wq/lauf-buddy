// Ziel aus Freitext verstehen und daraus einen periodisierten Laufplan erzeugen.
import { trainingPaces, vdotFromRace, predictTime, fmtPace, fmtDuration, hrAt, clamp, DAY, localDayKey } from "./analysis.js";

const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
export const DOW = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// ---------- 1) Freitext → strukturierte Ziel-Parameter ----------
export function parseGoal(text, today = new Date()) {
  const t = ` ${text.toLowerCase().replace(/,/g, ".")} `;
  const g = { kind: "general", distanceKm: null, targetSec: null, targetDate: null, weeks: null, daysPerWeek: null, focus: null };

  // Distanz
  if (/halb\s*-?\s*marathon|\bhm\b|21[.]1/.test(t)) g.distanceKm = 21.0975;
  else if (/marathon/.test(t)) g.distanceKm = 42.195;
  else {
    const m = t.match(/(\d+(?:\.\d+)?)\s*(?:km|k|er|kilometer)\b/);
    if (m) g.distanceKm = parseFloat(m[1]);
  }

  // Zielzeit: "unter 50 min", "sub 25", "in 1:45", "1h45", "1 stunde 50", "24:30"
  let m;
  if ((m = t.match(/(\d{1,2}):(\d{2}):(\d{2})/))) g.targetSec = +m[1] * 3600 + +m[2] * 60 + +m[3];
  else if ((m = t.match(/(\d{1,3}):(\d{2})(?!\d)/))) {
    const a = +m[1], b = +m[2];
    const dist = g.distanceKm ?? 0;
    const hours = (dist >= 15 && a <= 6) || (dist > 10 && a <= 2);
    g.targetSec = hours ? a * 3600 + b * 60 : a * 60 + b;
  } else if ((m = t.match(/(\d)\s*(?:h|std|stunden?)\s*(?:und\s*)?(\d{1,2})?\s*(?:min|m\b)?/))) g.targetSec = +m[1] * 3600 + (+(m[2] || 0)) * 60;
  else if ((m = t.match(/(\d{2,3})\s*(?:min|minuten)\b/)) || (m = t.match(/(?:unter|sub)\s*(\d{2,3})\b(?!\s*(?:wochen|monat|km|k\b|kilo))/))) g.targetSec = +m[1] * 60;

  // Zeitraum / Datum
  if ((m = t.match(/(\d{1,2})\s*wochen/))) g.weeks = +m[1];
  else if ((m = t.match(/(\d{1,2})\s*monat/))) g.weeks = Math.round(+m[1] * 4.35);
  if ((m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/))) {
    let y = m[3] ? +m[3] : today.getFullYear();
    if (y < 100) y += 2000;
    let d = new Date(y, +m[2] - 1, +m[1]);
    if (!m[3] && d < today) d = new Date(y + 1, +m[2] - 1, +m[1]);
    g.targetDate = localDayKey(d);
  } else {
    const mi = MONTHS.findIndex((mn) => new RegExp(`\\b${mn}`).test(t));
    if (mi >= 0) {
      let d = new Date(today.getFullYear(), mi, 15);
      if (d <= today) d = new Date(today.getFullYear() + 1, mi, 15);
      g.targetDate = localDayKey(d);
    }
  }

  // Trainingstage pro Woche
  if ((m = t.match(/(\d)\s*(?:x|mal|tage?|läufe|einheiten)\s*(?:pro|die|in der|\/|je)?\s*woche/))) g.daysPerWeek = +m[1];
  else if ((m = t.match(/(zwei|drei|vier|fünf|sechs)\s*(?:mal|tage|läufe)/))) g.daysPerWeek = { zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6 }[m[1]];

  // Art des Ziels
  if (g.distanceKm) g.kind = "race";
  if (/abnehm|gewicht|kilo\b|kg\b|fett/.test(t)) g.focus = "weight";
  else if (/grundlage|ausdauer|fitter|fit\b|gesund|regelmäßig|anfang|einsteig/.test(t)) g.focus = "base";
  else if (/schneller|tempo|bestzeit|pb\b|pr\b/.test(t)) g.focus = "speed";
  if (!g.distanceKm && g.focus === "speed") { g.distanceKm = 5; g.kind = "race"; }

  return g;
}

export function describeGoal(g) {
  const parts = [];
  if (g.distanceKm) parts.push(distName(g.distanceKm));
  if (g.targetSec) parts.push(`in ${fmtDuration(g.targetSec)}`);
  if (g.targetDate) parts.push(`am ${new Date(g.targetDate).toLocaleDateString("de-DE")}`);
  else if (g.weeks) parts.push(`in ${g.weeks} Wochen`);
  if (g.focus === "weight") parts.push("Fokus Abnehmen");
  if (g.focus === "base") parts.push("Fokus Grundlagenausdauer");
  if (g.daysPerWeek) parts.push(`${g.daysPerWeek}× pro Woche`);
  return parts.join(" · ") || "Allgemeine Fitness";
}

export function distName(km) {
  if (Math.abs(km - 42.195) < 0.1) return "Marathon";
  if (Math.abs(km - 21.0975) < 0.1) return "Halbmarathon";
  return `${String(km).replace(".", ",")} km`;
}

// ---------- 2) Plan erzeugen ----------
const PEAK_KM = (d) => (!d ? 25 : d <= 5 ? 30 : d <= 10 ? 38 : d <= 21.1 ? 48 : 60); // bei 4 Tagen/Woche
const DAY_FACTOR = { 2: 0.55, 3: 0.75, 4: 1, 5: 1.15, 6: 1.3 };
const LONG_CAP = (d) => (!d ? 14 : d <= 5 ? 12 : d <= 10 ? 16 : d <= 21.1 ? 21 : 32);
const PATTERNS = {
  2: [["Q", 2], ["L", 6]],
  3: [["E", 1], ["Q", 3], ["L", 6]],
  4: [["Q", 1], ["E", 2], ["E", 4], ["L", 6]],
  5: [["E", 0], ["Q", 1], ["E", 3], ["Q2", 4], ["L", 6]],
  6: [["E", 0], ["Q", 1], ["E", 2], ["Q2", 3], ["E", 4], ["L", 6]],
};

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  return x;
}

export function generatePlan(goal, ctx) {
  const today = ctx.today ? new Date(ctx.today) : new Date();
  const p = ctx.profile;
  const days = clamp(goal.daysPerWeek || (goal.distanceKm >= 21 ? 4 : 3), 2, 6);
  const d = goal.distanceKm;

  // Start: diese Woche (bis Mittwoch) oder nächster Montag
  let start = mondayOf(today);
  if ((today.getDay() + 6) % 7 > 2) start = addDays(start, 7);

  let weeks = goal.weeks || (d >= 42 ? 16 : d >= 21 ? 12 : d ? 8 : 8);
  let raceDate = null;
  if (goal.targetDate) {
    raceDate = new Date(goal.targetDate + "T12:00:00");
    weeks = Math.round((mondayOf(raceDate) - start) / (7 * DAY)) + 1;
  }
  const warnings = [];
  if (weeks < 4) warnings.push("Sehr wenig Vorbereitungszeit – der Plan ist bewusst vorsichtig.");
  const maxWeeks = d >= 42 ? 20 : 16;
  if (raceDate && weeks > maxWeeks) {
    start = addDays(mondayOf(raceDate), -(maxWeeks - 1) * 7);
    warnings.push(`Der Plan startet erst am ${start.toLocaleDateString("de-DE")} (${maxWeeks} Wochen vor dem Rennen). Bis dahin: 2–4× pro Woche locker laufen.`);
    weeks = maxWeeks;
  }
  weeks = clamp(weeks, 2, 24);
  if (!raceDate && goal.weeks > 24) warnings.push("Plan auf 24 Wochen begrenzt – danach neu erstellen.");

  // Fitness & Paces
  let vdotNow = ctx.vdot;
  const goalVdot = d && goal.targetSec ? vdotFromRace(d * 1000, goal.targetSec) : null;
  const noData = !vdotNow;
  if (!vdotNow) {
    vdotNow = goalVdot ? goalVdot - 2 : 36;
    warnings.push("Noch keine Laufdaten – Tempi sind geschätzt und werden nach ein paar Läufen genauer.");
  }
  const possibleGain = Math.min(weeks * 0.35, 6);
  const vdotEnd = goalVdot ? Math.min(goalVdot, vdotNow + possibleGain) : vdotNow + Math.min(weeks * 0.2, 3);

  let feasibility = null;
  if (d && noData) feasibility = { level: "warn", text: "Für eine Prognose brauche ich erst ein paar Läufe mit Puls. Die Tempi im Plan sind vorerst grob geschätzt." };
  else if (d) {
    const pred = predictTime(vdotNow, d * 1000);
    const predEnd = predictTime(vdotEnd, d * 1000);
    if (goalVdot) {
      const diff = goalVdot - vdotNow;
      if (diff <= 0) feasibility = { level: "ok", text: `Dein Ziel ist schon in Reichweite – aktuelle Prognose ${fmtDuration(pred)}. Der Plan festigt das und gibt Luft für mehr.` };
      else if (diff <= possibleGain) feasibility = { level: "ok", text: `Ambitioniert, aber machbar. Prognose heute: ${fmtDuration(pred)} → Ziel ${fmtDuration(goal.targetSec)}.` };
      else if (diff <= possibleGain * 1.6) feasibility = { level: "warn", text: `Sehr ambitioniert. Prognose heute ${fmtDuration(pred)}, realistisch nach dem Plan etwa ${fmtDuration(predEnd)}.` };
      else feasibility = { level: "bad", text: `In ${weeks} Wochen kaum realistisch. Prognose heute ${fmtDuration(pred)}, nach dem Plan etwa ${fmtDuration(predEnd)}. Tipp: späteres Rennen oder Zwischenziel wählen.` };
    } else {
      feasibility = { level: "ok", text: `Prognose heute: ${fmtDuration(pred)} – nach dem Plan etwa ${fmtDuration(predEnd)}.` };
    }
  }

  // Wochenumfänge
  const taper = !d ? 0 : weeks < 6 ? 1 : d >= 42 ? 3 : d >= 21 ? 2 : 1;
  const factor = DAY_FACTOR[days];
  const startKm = Math.max(ctx.weeklyKm || days * 5, days * 4);
  const buildWeeks = Math.max(1, weeks - taper);
  const peakKm = Math.max(startKm, Math.min(PEAK_KM(d) * factor, startKm * 1.08 ** buildWeeks));
  const baseEnd = Math.round(buildWeeks * 0.4), buildEnd = Math.round(buildWeeks * 0.8);

  const out = [];
  for (let i = 0; i < weeks; i++) {
    const inTaper = i >= weeks - taper;
    let phase = inTaper ? "Tapering" : !d ? (i < weeks / 2 ? "Grundlage" : "Aufbau") : i < baseEnd ? "Grundlage" : i < buildEnd ? "Aufbau" : "Spezifisch";
    let km = inTaper ? peakKm * (i === weeks - 1 ? 0.5 : 0.7) : startKm + (peakKm - startKm) * (buildWeeks > 1 ? i / (buildWeeks - 1) : 1);
    const recovery = !inTaper && i > 0 && (i + 1) % 4 === 0 && i < buildWeeks - 1;
    if (recovery) { km *= 0.75; phase += " · Entlastung"; }
    const vdot = vdotNow + (vdotEnd - vdotNow) * (weeks > 1 ? i / (weeks - 1) : 1);
    const paces = trainingPaces(vdot);
    const weekStart = addDays(start, i * 7);
    out.push({ n: i + 1, phase, km: Math.round(km), weekStart: localDayKey(weekStart), sessions: buildWeek({ i, weeks, km, days, d, phase, paces, p, weekStart, recovery, inTaper, focus: goal.focus, raceDate, goal }) });
  }

  // Vor dem Rennen: Vortag frei, zwei Tage vorher nur kurz & locker
  if (raceDate) {
    const rk = localDayKey(raceDate);
    const before = (n) => localDayKey(new Date(raceDate.getTime() - n * DAY));
    for (const w of out) {
      w.sessions = w.sessions.filter((s) => s.date !== before(1) && s.date <= rk);
      for (const s of w.sessions) {
        if (s.date === before(2) || s.date === before(3)) {
          Object.assign(s, { type: "easy", title: "Locker + 3 Steigerungen", distanceKm: 4, durationMin: 25, desc: "Nur auflockern – Beine frisch halten für das Rennen." });
        }
      }
    }
  }

  return {
    createdAt: new Date().toISOString(),
    goalText: ctx.goalText || "",
    goal,
    title: describeGoal({ ...goal, daysPerWeek: days }),
    days,
    weeks: out,
    vdotNow: Math.round(vdotNow * 10) / 10,
    paces: trainingPaces(vdotNow),
    feasibility,
    warnings,
  };
}

function buildWeek({ i, weeks, km, days, d, phase, paces, p, weekStart, recovery, inTaper, focus, raceDate, goal }) {
  const pattern = PATTERNS[days];
  const hasRaceThisWeek = raceDate && i === weeks - 1;
  const longShare = days === 2 ? 0.45 : 0.3;
  const qCount = pattern.filter(([k]) => k.startsWith("Q")).length;
  const qKm = Math.min(km * 0.2, 14);
  const eCount = pattern.filter(([k]) => k === "E").length;
  const longKm = Math.min(LONG_CAP(d), Math.max(km * longShare, ((km - qKm * qCount) / (eCount + 1.4)) * 1.4));
  const eKm = eCount ? Math.max(3, (km - longKm - qKm * qCount) / eCount) : 0;

  const E = paces.E, easyMid = (E[0] + E[1]) / 2;
  const z2 = `Puls < ${hrAt(0.7, p)} bpm`;
  const ePace = `${fmtPace(E[0])}–${fmtPace(E[1])} min/km`;
  const sessions = [];

  for (const [kind, dow] of pattern) {
    const date = addDays(weekStart, dow);
    if (hasRaceThisWeek && date > raceDate) continue;
    let s;
    if (kind === "E") {
      s = { type: "easy", title: "Lockerer Lauf", distanceKm: eKm, paceText: ePace, hrText: z2, desc: "Entspannt, du kannst dich dabei unterhalten." };
    } else if (kind === "L") {
      const mPart = d >= 21 && phase.startsWith("Spezifisch") && !recovery ? Math.round(longKm * 0.35) : 0;
      s = { type: "long", title: "Langer Lauf", distanceKm: longKm, paceText: ePace, hrText: z2,
        desc: mPart ? `Locker beginnen, die letzten ${mPart} km im Renntempo (${fmtPace(d >= 42 ? paces.M : (paces.M + paces.T) / 2)} min/km).` : "Ruhig und gleichmäßig – Dauer zählt, nicht Tempo." };
    } else {
      s = quality({ kind, i, d, phase, paces, p, recovery, inTaper, focus, km: qKm });
    }
    s.date = localDayKey(date);
    s.dow = DOW[dow];
    s.distanceKm = Math.round(s.distanceKm * 2) / 2;
    s.durationMin = s.durationMin || Math.round((s.distanceKm * (s.type === "easy" || s.type === "long" ? easyMid : easyMid * 0.9)) / 60 / 5) * 5;
    sessions.push(s);
  }

  if (hasRaceThisWeek) {
    const rd = localDayKey(raceDate);
    const idx = sessions.findIndex((s) => s.date === rd);
    const race = { type: "race", title: `🏁 Wettkampf: ${distName(d)}`, date: rd, dow: DOW[(raceDate.getDay() + 6) % 7], distanceKm: d,
      durationMin: Math.round(goal.targetSec ? goal.targetSec / 60 : (d * paces.T * 1.03) / 60),
      paceText: goal.targetSec ? `Ziel ${fmtPace(goal.targetSec / d)} min/km` : `≈ ${fmtPace(paces.T * (d > 10 ? 1.05 : 0.98))} min/km`,
      hrText: "Gleichmäßig starten, am Ende zulegen", desc: "Viel Erfolg! Am Tag davor nur 15–20 min locker + 3 Steigerungen." };
    if (idx >= 0) sessions[idx] = race; else sessions.push(race);
    sessions.sort((a, b) => a.date.localeCompare(b.date));
  }
  return sessions;
}

function quality({ kind, i, d, phase, paces, p, recovery, inTaper, focus, km }) {
  const T = fmtPace(paces.T), I = fmtPace(paces.I), R = fmtPace(paces.R);
  const z4 = `Puls ${hrAt(0.8, p)}–${hrAt(0.9, p)} bpm`;
  const z5 = `Puls > ${hrAt(0.88, p)} bpm`;
  const wu = "2 km einlaufen, 1,5 km auslaufen";
  const strides = { type: "easy", title: "Locker + Steigerungen", distanceKm: Math.max(4, km * 0.9), paceText: `${fmtPace(paces.E[0])} min/km, Steigerungen bis ${R}`, hrText: `Puls < ${hrAt(0.7, p)} bpm`, desc: "Lockerer Lauf, am Ende 6× 20 s locker-schnell steigern, dazwischen gehen." };

  if (recovery || focus === "weight" || (!d && phase === "Grundlage")) {
    if (kind === "Q2" || recovery) return strides;
    return { type: "tempo", title: "Fahrtspiel", distanceKm: Math.max(5, km), paceText: `zügig ≈ ${T} min/km`, hrText: z4, desc: `${wu}. Dazwischen 8× 1 min zügig / 1 min locker.` };
  }
  if (inTaper) {
    return { type: "interval", title: "Kurz & knackig", distanceKm: Math.max(5, km * 0.7), paceText: `${d <= 10 ? I : T} min/km`, hrText: z4, desc: `${wu}. 4× 1 km im Wettkampftempo, 2 min Trabpause. Frisch bleiben!` };
  }
  if (phase.startsWith("Grundlage")) {
    if (kind === "Q2") return strides;
    return i % 2
      ? { type: "interval", title: "Bergsprints", distanceKm: Math.max(5, km), paceText: "kräftig bergauf", hrText: z5, desc: `${wu}. 8× 15–20 s steil bergauf, gehend zurück.` }
      : { type: "tempo", title: "Fahrtspiel", distanceKm: Math.max(5, km), paceText: `zügig ≈ ${T} min/km`, hrText: z4, desc: `${wu}. ${6 + (i % 3) * 2}× 1 min zügig / 1 min locker.` };
  }

  const threshold = () => {
    const mins = Math.min(8 + i, 20);
    const reps = d >= 21 ? 3 : 2;
    return { type: "tempo", title: "Schwellenlauf", distanceKm: 3.5 + (reps * mins * 60) / paces.T, paceText: `${T} min/km`, hrText: z4, desc: `${wu}. ${reps}× ${mins} min im Schwellentempo, 3 min Trabpause.` };
  };
  const intervals = () => {
    const set = d <= 5 ? (phase.startsWith("Spez") ? [6, 800] : [5, 1000]) : d <= 10 ? (phase.startsWith("Spez") ? [4, 1600] : [5, 1000]) : [5, 1000];
    return { type: "interval", title: "Intervalle", distanceKm: 3.5 + (set[0] * set[1] * 1.35) / 1000, paceText: `${I} min/km`, hrText: z5, desc: `${wu}. ${set[0]}× ${set[1]} m im Intervalltempo, Trabpause ≈ gleich lang wie die Belastung.` };
  };
  const raceSpecific = () => {
    if (d >= 21) {
      const k = d >= 42 ? 8 + Math.min(i, 6) : 2 * Math.min(2 + Math.floor(i / 3), 5);
      const pace = d >= 42 ? paces.M : (paces.M + paces.T) / 2;
      return { type: "tempo", title: d >= 42 ? "Marathontempo" : "HM-Tempo", distanceKm: 3.5 + k, paceText: `${fmtPace(pace)} min/km`, hrText: `Puls ${hrAt(0.75, p)}–${hrAt(0.85, p)} bpm`, desc: `${wu}. ${d >= 42 ? `${k} km am Stück` : `2× ${k / 2} km`} im Renntempo.` };
    }
    return intervals();
  };

  if (kind === "Q2") return phase.startsWith("Spez") ? threshold() : strides;
  if (phase.startsWith("Spez")) return i % 2 ? raceSpecific() : (d <= 10 ? threshold() : intervals());
  return i % 2 ? intervals() : threshold();
}

// Findet die geplante Einheit für ein Datum (für die Bewertung "wie geplant")
export function plannedFor(plan, dayKey) {
  if (!plan) return null;
  for (const w of plan.weeks) for (const s of w.sessions) if (s.date === dayKey) return s;
  return null;
}
