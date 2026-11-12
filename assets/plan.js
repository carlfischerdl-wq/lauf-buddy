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
          Object.assign(s, { type: "easy", title: "Locker + 3 Steigerungen", distanceKm: 4, durationMin: 25, desc: "Nur auflockern – Beine frisch halten für das Rennen.", struct: null, mPartKm: 0 });
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
        desc: mPart ? `Locker beginnen, die letzten ${mPart} km im Renntempo (${fmtPace(d >= 42 ? paces.M : (paces.M + paces.T) / 2)} min/km).` : "Ruhig und gleichmäßig – Dauer zählt, nicht Tempo.",
        mPartKm: mPart, mPace: Math.round(d >= 42 ? paces.M : (paces.M + paces.T) / 2) };
    } else {
      s = quality({ kind, i, d, phase, paces, p, recovery, inTaper, focus, km: qKm });
    }
    s.date = localDayKey(date);
    s.dow = DOW[dow];
    s.easyPace = [Math.round(E[0]), Math.round(E[1])];
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
  const wu = "2 km einlaufen, locker auslaufen";
  // Strukturdaten für den Apple-Watch-Export (Pace in s/km, [schnell, langsam])
  const rng = (pc, d = 6) => [Math.round(pc - d), Math.round(pc + d)];
  const W = (body) => ({ warmup: { dist_m: 2000 }, cooldown: { open: true }, blocks: body });
  const strides = { type: "easy", title: "Locker + Steigerungen", distanceKm: Math.max(4, km * 0.9), paceText: `${fmtPace(paces.E[0])} min/km, Steigerungen bis ${R}`, hrText: `Puls < ${hrAt(0.7, p)} bpm`, desc: "Lockerer Lauf, am Ende 6× 20 s locker-schnell steigern, dazwischen gehen.",
    struct: { blocks: [{ reps: 1, steps: [{ p: "work", dist_m: Math.round(Math.max(3, km * 0.9 - 1) * 1000), pace: [Math.round(paces.E[0]), Math.round(paces.E[1])], easy: true }] }, { reps: 6, steps: [{ p: "work", time_s: 20 }, { p: "recovery", time_s: 60 }] }] } };

  if (recovery || focus === "weight" || (!d && phase === "Grundlage")) {
    if (kind === "Q2" || recovery) return strides;
    return { type: "tempo", title: "Fahrtspiel", distanceKm: Math.max(5, km), paceText: `zügig ≈ ${T} min/km`, hrText: z4, desc: `${wu}. Dazwischen 8× 1 min zügig / 1 min locker.`,
      struct: W([{ reps: 8, steps: [{ p: "work", time_s: 60, pace: rng(paces.T, 10) }, { p: "recovery", time_s: 60 }] }]) };
  }
  if (inTaper) {
    return { type: "interval", title: "Kurz & knackig", distanceKm: Math.max(5, km * 0.7), paceText: `${d <= 10 ? I : T} min/km`, hrText: z4, desc: `${wu}. 4× 1 km im Wettkampftempo, 2 min Trabpause. Frisch bleiben!`,
      struct: W([{ reps: 4, steps: [{ p: "work", dist_m: 1000, pace: rng(d <= 10 ? paces.I : paces.T) }, { p: "recovery", time_s: 120 }] }]) };
  }
  if (phase.startsWith("Grundlage")) {
    if (kind === "Q2") return strides;
    return i % 2
      ? { type: "interval", title: "Bergsprints", distanceKm: Math.max(5, km), paceText: "kräftig bergauf", hrText: z5, desc: `${wu}. 8× 15–20 s steil bergauf, gehend zurück.`,
        struct: W([{ reps: 8, steps: [{ p: "work", time_s: 20 }, { p: "recovery", time_s: 90 }] }]) }
      : { type: "tempo", title: "Fahrtspiel", distanceKm: Math.max(5, km), paceText: `zügig ≈ ${T} min/km`, hrText: z4, desc: `${wu}. ${6 + (i % 3) * 2}× 1 min zügig / 1 min locker.`,
        struct: W([{ reps: 6 + (i % 3) * 2, steps: [{ p: "work", time_s: 60, pace: rng(paces.T, 10) }, { p: "recovery", time_s: 60 }] }]) };
  }

  const threshold = () => {
    const mins = Math.min(8 + i, 20);
    const reps = d >= 21 ? 3 : 2;
    return { type: "tempo", title: "Schwellenlauf", distanceKm: 3.5 + (reps * mins * 60) / paces.T, paceText: `${T} min/km`, hrText: z4, desc: `${wu}. ${reps}× ${mins} min im Schwellentempo, 3 min Trabpause.`,
      struct: W([{ reps, steps: [{ p: "work", time_s: mins * 60, pace: rng(paces.T) }, { p: "recovery", time_s: 180 }] }]) };
  };
  const intervals = () => {
    const set = d <= 5 ? (phase.startsWith("Spez") ? [6, 800] : [5, 1000]) : d <= 10 ? (phase.startsWith("Spez") ? [4, 1600] : [5, 1000]) : [5, 1000];
    return { type: "interval", title: "Intervalle", distanceKm: 3.5 + (set[0] * set[1] * 1.35) / 1000, paceText: `${I} min/km`, hrText: z5, desc: `${wu}. ${set[0]}× ${set[1]} m im Intervalltempo, Trabpause ≈ gleich lang wie die Belastung.`,
      struct: W([{ reps: set[0], steps: [{ p: "work", dist_m: set[1], pace: rng(paces.I) }, { p: "recovery", time_s: Math.round((set[1] / 1000) * paces.I / 30) * 30 }] }]) };
  };
  const raceSpecific = () => {
    if (d >= 21) {
      const k = d >= 42 ? 8 + Math.min(i, 6) : 2 * Math.min(2 + Math.floor(i / 3), 5);
      const pace = d >= 42 ? paces.M : (paces.M + paces.T) / 2;
      return { type: "tempo", title: d >= 42 ? "Marathontempo" : "HM-Tempo", distanceKm: 3.5 + k, paceText: `${fmtPace(pace)} min/km`, hrText: `Puls ${hrAt(0.75, p)}–${hrAt(0.85, p)} bpm`, desc: `${wu}. ${d >= 42 ? `${k} km am Stück` : `2× ${k / 2} km`} im Renntempo.`,
        struct: W(d >= 42 ? [{ reps: 1, steps: [{ p: "work", dist_m: k * 1000, pace: rng(pace, 8) }] }] : [{ reps: 2, steps: [{ p: "work", dist_m: (k / 2) * 1000, pace: rng(pace, 6) }, { p: "recovery", time_s: 180 }] }]) };
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

// ---------- 3) Einzeltraining für heute aus Freitext ("Worauf hast du heute Lust?") ----------
export function todaySession(text, ctx) {
  const t = ` ${text.toLowerCase().replace(/,/g, ".")} `;
  const p = ctx.profile;
  const vdot = ctx.vdot || 36;
  const paces = trainingPaces(vdot);
  const E = paces.E, easyMid = (E[0] + E[1]) / 2;
  const easyPace = [Math.round(E[0]), Math.round(E[1])];
  const rng = (pc, d = 6) => [Math.round(pc - d), Math.round(pc + d)];
  const z2 = `Puls < ${hrAt(0.7, p)} bpm`, z4 = `Puls ${hrAt(0.8, p)}–${hrAt(0.9, p)} bpm`, z5 = `Puls > ${hrAt(0.88, p)} bpm`;
  const wuTxt = "2 km einlaufen, locker auslaufen";
  const W = (blocks) => ({ warmup: { dist_m: 2000 }, cooldown: { open: true }, blocks });

  // Wunsch-Erholung erkennen ("3 min Erholung", "Pause 90 s", "2:30 Trabpause") und aus dem Text entfernen,
  // damit die Minuten nicht als Gesamtdauer gelesen werden
  let recWish = null;
  const recRe = [
    /(\d+(?:\.\d+)?)\s*(min|minuten|s|sek|sekunden)\.?\s*(?:lang\s*)?(?:trab)?(?:erholung|pause|trabpause|traben|gehpause)/,
    /(?:erholung|pause|trabpause|gehpause)\s*(?:von|:|je|jeweils|dazwischen)?\s*(\d+(?:\.\d+)?)\s*(min|minuten|s|sek|sekunden)\b/,
    /(\d{1,2}):(\d{2})\s*(?:min\s*)?(?:trab)?(?:erholung|pause|trabpause)/,
    /(?:erholung|pause|trabpause)\s*(?:von|:)?\s*(\d{1,2}):(\d{2})/,
  ];
  let tt = t;
  const ov = extractOverrides(tt);
  tt = ov.rest;
  for (let k = 0; k < recRe.length && recWish == null; k++) {
    const r = tt.match(recRe[k]);
    if (!r) continue;
    if (k >= 2) recWish = +r[1] * 60 + +r[2];
    else recWish = /^min/.test(r[2]) ? parseFloat(r[1]) * 60 : parseFloat(r[1]);
    tt = tt.replace(r[0], " ");
  }

  // Zahlen aus dem Text
  let m;
  const km = (m = tt.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometer)\b/)) && !/\d\s*[x×]\s*\d+(?:\.\d+)?\s*km/.test(tt) ? parseFloat(m[1]) : null;
  let min = null;
  if ((m = tt.match(/(\d+(?:\.\d+)?)\s*(?:h|std|stunden?)\b/))) min = parseFloat(m[1]) * 60;
  if ((m = tt.match(/(\d{1,3})\s*(?:min|minuten)\b/)) && !/\d\s*[x×]\s*\d+\s*min/.test(tt)) min = (min || 0) + +m[1];
  let rep = tt.match(/(\d{1,2})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(km|m|min|minuten|s|sek|sekunden)\b/);
  // ohne Einheit: "6x800" → Meter
  if (!rep && (m = tt.match(/(\d{1,2})\s*[x×]\s*(\d{3,5})(?![\d:.])/))) rep = [m[0], m[1], m[2], "m"];
  const reps = rep ? +rep[1] : null;
  const repVal = rep ? parseFloat(rep[2]) : null;
  const repUnit = rep ? rep[3] : null;

  // Art des Trainings
  let kind =
    /berg|hügel|hill/.test(tt) ? "hills" :
    /fahrtspiel|fartlek/.test(tt) ? "fartlek" :
    /steigerung/.test(tt) ? "strides" :
    /intervall|sprint|bahn|schnell|400|800|1000/.test(tt) || (rep && /^(m|km)$/.test(repUnit)) ? "interval" :
    /tempo|schwelle|zügig|threshold/.test(tt) || (rep && /min/.test(repUnit)) ? "tempo" :
    /lang|long|ausdauer/.test(tt) ? "long" :
    /locker|easy|entspannt|regener|ruhig|gemütlich|leicht/.test(tt) ? "easy" : null;

  // Kein Typ genannt → Vorschlag nach Belastung der letzten Tage
  let reason = "";
  if (!kind) {
    const last = ctx.lastType;
    kind = ["interval", "tempo", "race", "long"].includes(last) ? "easy" : km && km >= 12 ? "long" : "easy";
    reason = last && kind === "easy" ? "Dein letzter Lauf war intensiv – deshalb heute locker." : "";
  }

  let s;
  if (kind === "easy" || kind === "long") {
    const dist = km || (min ? (min * 60) / easyMid : kind === "long" ? 12 : 6);
    s = { type: kind, title: kind === "long" ? "Langer Lauf" : "Lockerer Lauf", distanceKm: dist, paceText: `${fmtPace(E[0])}–${fmtPace(E[1])} min/km`, hrText: z2,
      desc: kind === "long" ? "Ruhig und gleichmäßig – Dauer zählt, nicht Tempo." : "Entspannt, du kannst dich dabei unterhalten.", struct: null, mPartKm: 0 };
    if (min && !km) s.struct = { blocks: [{ reps: 1, steps: [{ p: "work", time_s: Math.round(min * 60), pace: easyPace, easy: true }] }] };
  } else if (kind === "strides") {
    const dist = km || 5;
    s = { type: "easy", title: "Locker + Steigerungen", distanceKm: dist, paceText: `${fmtPace(E[0])} min/km, Steigerungen bis ${fmtPace(paces.R)}`, hrText: z2,
      desc: "Lockerer Lauf, am Ende 6× 20 s locker-schnell steigern, dazwischen gehen.",
      struct: { blocks: [{ reps: 1, steps: [{ p: "work", dist_m: Math.round(Math.max(2, dist - 1) * 1000), pace: easyPace, easy: true }] }, { reps: 6, steps: [{ p: "work", time_s: 20 }, { p: "recovery", time_s: 60 }] }] } };
  } else if (kind === "hills") {
    const n = reps || 8;
    s = { type: "interval", title: "Bergsprints", distanceKm: 6, paceText: "kräftig bergauf", hrText: z5, desc: `${wuTxt}. ${n}× 20 s steil bergauf, gehend zurück.`,
      struct: W([{ reps: n, steps: [{ p: "work", time_s: 20 }, { p: "recovery", time_s: recWish || 90 }] }]) };
  } else if (kind === "fartlek") {
    const n = reps || 8;
    s = { type: "tempo", title: "Fahrtspiel", distanceKm: 3.5 + (n * 2 * 60) / easyMid, paceText: `zügig ≈ ${fmtPace(paces.T)} min/km`, hrText: z4, desc: `${wuTxt}. ${n}× 1 min zügig / ${recWish ? `${recWish} s` : "1 min"} locker.`,
      struct: W([{ reps: n, steps: [{ p: "work", time_s: 60, pace: rng(paces.T, 10) }, { p: "recovery", time_s: recWish || 60 }] }]) };
  } else if (kind === "tempo") {
    let n = 1, workMin;
    if (rep && /min/.test(repUnit)) { n = reps; workMin = repVal; }
    else if (min) workMin = Math.max(10, min - 20);
    else if (km) workMin = Math.max(10, ((km - 3.5) * paces.T) / 60);
    else workMin = 20;
    workMin = Math.round(workMin);
    s = { type: "tempo", title: n > 1 ? "Schwellenlauf" : "Tempodauerlauf", distanceKm: 3.5 + (n * workMin * 60) / paces.T, paceText: `${fmtPace(paces.T)} min/km`, hrText: z4,
      desc: `${wuTxt}. ${n > 1 ? `${n}× ${workMin} min` : `${workMin} min am Stück`} im Schwellentempo${n > 1 ? `, ${recWish || 180} s Trabpause` : ""}.`,
      struct: W([{ reps: n, steps: n > 1 ? [{ p: "work", time_s: workMin * 60, pace: rng(paces.T) }, { p: "recovery", time_s: recWish || 180 }] : [{ p: "work", time_s: workMin * 60, pace: rng(paces.T) }] }]) };
  } else {
    // Intervalle
    let n = reps || 5, dist = 1000, timeS = null;
    if (rep) {
      if (repUnit === "km") dist = repVal * 1000;
      else if (repUnit === "m") dist = repVal;
      else if (/min/.test(repUnit)) { timeS = repVal * 60; dist = null; }
      else { timeS = repVal; dist = null; }
    }
    const pace = dist && dist <= 400 ? paces.R : paces.I;
    const workSec = timeS || ((dist / 1000) * pace);
    // Erholung: Wunsch aus dem Text, sonst halbe Belastungszeit (60–180 s)
    const recSec = recWish || Math.min(180, Math.max(60, Math.round(workSec / 2 / 15) * 15));
    const work = dist ? { p: "work", dist_m: dist, pace: rng(pace) } : { p: "work", time_s: timeS, pace: rng(pace) };
    const label = dist ? `${n}× ${dist >= 1000 ? `${String(dist / 1000).replace(".", ",")} km` : `${dist} m`}` : `${n}× ${timeS >= 60 ? `${timeS / 60} min` : `${timeS} s`}`;
    s = { type: "interval", title: "Intervalle", distanceKm: 3.5 + n * (workSec / pace + recSec / (easyMid * 1.15)), paceText: `${fmtPace(pace)} min/km`, hrText: z5,
      desc: `${wuTxt}. ${label} im ${dist && dist <= 400 ? "Wiederholungs" : "Intervall"}tempo, ${recSec} s Trabpause.`,
      struct: W([{ reps: n, steps: [work, { p: "recovery", time_s: recSec }] }]) };
  }
  s.distanceKm = Math.round(s.distanceKm * 2) / 2;
  s.durationMin = Math.round((s.distanceKm * easyMid * (s.type === "easy" || s.type === "long" ? 1 : 0.9)) / 60 / 5) * 5;
  s.easyPace = easyPace;
  const today = new Date();
  s.date = localDayKey(today);
  s.dow = DOW[(today.getDay() + 6) % 7];
  s.reason = reason;
  s.request = text;
  finalizeStruct(s, ov);
  return s;
}

// ---------- Freitext-Wünsche, die Standards überschreiben ----------
// Standards ohne Angabe: Durchschnittstempo, Erholung mit HF-Zone-2-Warnung, Auslaufen offen.
const toSec = (mm, ss) => +mm * 60 + +ss;
const unitSec = (v, u) => (/^(min|minuten)$/.test(u) ? parseFloat(v) * 60 : /^(h|std|stunden?)$/.test(u) ? parseFloat(v) * 3600 : parseFloat(v));
const unitM = (v, u) => (u === "km" ? parseFloat(v) * 1000 : parseFloat(v));
export function extractOverrides(text) {
  let t = text;
  const o = {};
  const take = (re, fn) => { const m = t.match(re); if (m) { fn(m); t = t.replace(m[0], " "); return true; } return false; };
  const DU = "(min|minuten|s|sek|sekunden|km|m|h|std|stunden?)";
  // Einlaufen / Aufwärmen
  if (!take(/ohne\s*(?:ein|warm)?(?:laufen|aufwärmen|warmup|warm-up)/, () => (o.warmup = { none: true })))
    take(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${DU}\\.?\\s*(?:einlaufen|aufwärmen|warm\\s*-?\\s*up|warmlaufen)`), (m) => (o.warmup = /km|^m$/.test(m[2]) ? { dist_m: unitM(m[1], m[2]) } : { time_s: unitSec(m[1], m[2]) })) ||
    take(new RegExp(`(?:einlaufen|aufwärmen|warm\\s*-?\\s*up)\\s*(?:von|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*${DU}`), (m) => (o.warmup = /km|^m$/.test(m[2]) ? { dist_m: unitM(m[1], m[2]) } : { time_s: unitSec(m[1], m[2]) }));
  // Auslaufen / Cool-down
  if (!take(/ohne\s*(?:aus)?(?:laufen|auslaufen|cool\s*-?\s*down)/, () => (o.cooldown = { none: true })))
    take(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${DU}\\.?\\s*(?:auslaufen|cool\\s*-?\\s*down|austraben)`), (m) => (o.cooldown = /km|^m$/.test(m[2]) ? { dist_m: unitM(m[1], m[2]) } : { time_s: unitSec(m[1], m[2]) })) ||
    take(new RegExp(`(?:auslaufen|cool\\s*-?\\s*down)\\s*(?:von|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*${DU}`), (m) => (o.cooldown = /km|^m$/.test(m[2]) ? { dist_m: unitM(m[1], m[2]) } : { time_s: unitSec(m[1], m[2]) }));
  // HF: "ohne HF" → keine Warnung in der Erholung; "Zone X" je nach Umfeld für Erholung oder Belastung
  take(/ohne\s*(?:hf|puls|herzfrequenz)(?:\s*-?\s*(?:warnung|alarm|zone))?/, () => (o.recZone = null));
  for (let guard = 0; guard < 3; guard++) {
    const m = t.match(/(?:hf|puls|herzfrequenz)?\s*-?\s*(?:zone|bereich)\s*(\d)/);
    if (!m) break;
    const before = t.slice(Math.max(0, m.index - 25), m.index);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 20);
    if (/erholung|pause|trab/.test(before) || /^\s*(?:in|für|bei)\s*(?:der\s*)?(?:erholung|pause)/.test(after)) o.recZone = +m[1];
    else o.workZone = +m[1];
    t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length);
  }
  // Tempo: Messart
  if (/aktuell(?:es|em|en)?\s*(?:tempo|pace)/.test(t)) { o.metric = "current"; t = t.replace(/aktuell(?:es|em|en)?\s*(?:tempo|pace)/, " "); }
  else if (/durchschnitt/.test(t)) { o.metric = "average"; t = t.replace(/durchschnitt\w*/, " "); }
  // Korridorbreite
  take(/(?:±|\+\/-|plus\s*minus)\s*(\d+)\s*(?:s|sek|sekunden)\b/, (m) => (o.width = 2 * +m[1])) ||
    take(/(?:korridor|spanne|toleranz|bereich)\s*(?:von)?\s*(\d+)\s*(?:s|sek|sekunden)\b/, (m) => (o.width = +m[1])) ||
    take(/(\d+)\s*(?:s|sek|sekunden)\s*(?:korridor|spanne|toleranz)/, (m) => (o.width = +m[1]));
  // Tempo: Bereich "4:30-4:40" oder Einzelwert "in 4:30", "@4:30", "4:30er", "4:30 min/km"
  take(/(\d{1,2}):(\d{2})\s*(?:-|–|bis)\s*(\d{1,2}):(\d{2})\s*(?:min\/km|\/km|er|min)?/, (m) => {
    const a = toSec(m[1], m[2]), b = toSec(m[3], m[4]); o.paceRange = [Math.min(a, b), Math.max(a, b)];
  }) ||
    take(/(?:@|in|im|mit|bei|pace|tempo|schnitt|à|a)\s*(\d{1,2}):(\d{2})\s*(?:min\/km|\/km|er|min|pace)?/, (m) => (o.pace = toSec(m[1], m[2]))) ||
    take(/(\d{1,2}):(\d{2})\s*(?:min\/km|\/km|er\s*(?:pace|tempo|schnitt)?|pace)/, (m) => (o.pace = toSec(m[1], m[2])));
  o.rest = t;
  return o;
}

// Macht aus jeder Einheit eine vollständige, explizite Struktur und wendet Wünsche an
export function finalizeStruct(s, ov = {}) {
  let st = s.struct;
  if (!st) {
    const steps = s.mPartKm
      ? [{ p: "work", dist_m: Math.round((s.distanceKm - s.mPartKm) * 1000), pace: s.easyPace, easy: true }, { p: "work", dist_m: s.mPartKm * 1000, pace: [s.mPace, s.mPace] }]
      : [{ p: "work", dist_m: Math.round(s.distanceKm * 1000), pace: s.easyPace, easy: true }];
    st = { blocks: [{ reps: 1, steps }] };
  }
  st = JSON.parse(JSON.stringify(st));
  const easyMid = s.easyPace ? (s.easyPace[0] + s.easyPace[1]) / 2 : 420;
  // Einlaufen: Standard = Zeit in Sekunden
  if (ov.warmup) st.warmup = ov.warmup.none ? null : ov.warmup;
  else if (st.warmup?.dist_m) st.warmup = { time_s: Math.round(((st.warmup.dist_m / 1000) * easyMid) / 30) * 30 };
  // Auslaufen: Standard = offen (nur bei Einheiten mit Einlaufen/Intervallen)
  if (ov.cooldown) st.cooldown = ov.cooldown.none ? null : ov.cooldown;
  else if (st.cooldown || st.warmup) st.cooldown = { open: true };
  for (const b of st.blocks) for (const x of b.steps) {
    if (x.p === "recovery") {
      x.hrZone = ov.recZone !== undefined ? ov.recZone : 2;
      continue;
    }
    if (ov.workZone && (x.pace || !x.easy)) { x.hrZone = ov.workZone; delete x.pace; continue; }
    if (!x.pace) continue;
    const w = ov.width || (x.easy ? 20 : 10);
    let lo, hi;
    if (ov.paceRange && !(x.easy && b.steps.length > 1 && st.blocks.length > 1)) [lo, hi] = ov.paceRange;
    else {
      const mid = ov.pace && !(x.easy && st.blocks.length > 1) ? ov.pace : (x.pace[0] + x.pace[1]) / 2;
      lo = Math.round(mid - w / 2); hi = Math.round(mid + w / 2);
    }
    x.pace = [lo, hi];
    x.exact = true;
    x.metric = ov.metric || "average";
  }
  st.final = true;
  s.struct = st;
  return s;
}

// Lesbare Beschreibung des Ablaufs (für die Website)
export function describeStruct(st) {
  const fmtT = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")} min` : `${sec} s`);
  const goal = (x) => (x?.dist_m ? (x.dist_m >= 1000 ? `${String(x.dist_m / 1000).replace(".", ",")} km` : `${x.dist_m} m`) : x?.time_s ? fmtT(x.time_s) : "offen");
  const lines = [];
  if (st.warmup) lines.push(`Einlaufen: ${goal(st.warmup)}`);
  for (const b of st.blocks) {
    const parts = b.steps.map((x) => x.p === "recovery"
      ? `Erholung ${goal(x)}${x.hrZone ? ` (HF-Zone ${x.hrZone})` : ""}`
      : `${goal(x)}${x.hrZone ? ` in HF-Zone ${x.hrZone}` : x.pace ? ` @ ${fmtPace(x.pace[0])}–${fmtPace(x.pace[1])} /km (${x.metric === "current" ? "aktuelles" : "Ø"} Tempo)` : ""}`);
    lines.push(b.reps > 1 ? `${b.reps}× ( ${parts.join(" + ")} )` : parts.join(" + "));
  }
  if (st.cooldown) lines.push(`Auslaufen: ${st.cooldown.open ? "offen" : goal(st.cooldown)}`);
  return lines;
}
