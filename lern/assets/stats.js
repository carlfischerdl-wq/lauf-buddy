// Statistiken aus den Lerneinheiten (alle Zeiten in ms, Tage in lokaler Zeit)
export const DAY = 86400000;
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const startOfDay = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
export const startOfWeek = (t) => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };

export function fmtDur(ms, { short = false } = {}) {
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60), m = min % 60;
  if (short) return h ? `${h}:${String(m).padStart(2, "0")} h` : `${m} min`;
  return h ? `${h} h ${m ? `${m} min` : ""}`.trim() : `${m} min`;
}
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Minuten pro Tag (inkl. laufender Lernphase)
export function totalsByDay(sessions, running, now = Date.now()) {
  const map = new Map();
  const add = (start, end) => map.set(dayKey(start), (map.get(dayKey(start)) || 0) + (end - start));
  for (const s of sessions) add(s.start, s.end);
  if (running?.phase === "focus") add(running.phaseStart, now);
  return map;
}

export function summary(sessions, running, now = Date.now()) {
  const byDay = totalsByDay(sessions, running, now);
  const today = byDay.get(dayKey(now)) || 0;
  const wk = startOfWeek(now);
  let week = 0, last30 = 0, total = 0;
  for (const [k, v] of byDay) {
    const t = new Date(k + "T12:00").getTime();
    total += v;
    if (t >= wk) week += v;
    if (t >= startOfDay(now) - 29 * DAY) last30 += v;
  }
  // Serie: Tage in Folge mit Lernzeit (heute zählt, wenn schon gelernt; sonst ab gestern)
  let streak = 0;
  let t = byDay.get(dayKey(now)) ? startOfDay(now) : addDays(startOfDay(now), -1);
  while (byDay.get(dayKey(t))) { streak++; t = addDays(t, -1); }
  let best = 0, run = 0;
  const days = [...byDay.keys()].sort();
  for (let i = 0; i < days.length; i++) {
    const prev = i && addDays(new Date(days[i - 1] + "T12:00").getTime(), 1);
    run = i && dayKey(prev) === days[i] ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const longest = sessions.reduce((m, s) => Math.max(m, s.end - s.start), 0);
  const pomToday = sessions.filter((s) => s.mode === "pomodoro" && dayKey(s.start) === dayKey(now)).length;
  const firstDay = days[0] ? new Date(days[0] + "T12:00").getTime() : now;
  const activeDays30 = Math.max(1, Math.min(30, Math.round((startOfDay(now) - startOfDay(firstDay)) / DAY) + 1));
  return { today, week, avg30: last30 / activeDays30, total, streak, bestStreak: best, longest, pomToday, sessions: sessions.length };
}

export function lastDays(sessions, running, n = 14, now = Date.now()) {
  const byDay = totalsByDay(sessions, running, now);
  return Array.from({ length: n }, (_, i) => { const t = addDays(startOfDay(now), i - n + 1); return { t, ms: byDay.get(dayKey(t)) || 0 }; });
}
export function lastWeeks(sessions, running, n = 12, now = Date.now()) {
  const byDay = totalsByDay(sessions, running, now);
  const weeks = Array.from({ length: n }, (_, i) => ({ t: addDays(startOfWeek(now), (i - n + 1) * 7), ms: 0 }));
  for (const [k, v] of byDay) {
    const t = new Date(k + "T12:00").getTime();
    for (let i = n - 1; i >= 0; i--) if (t >= weeks[i].t) { if (i === n - 1 || t < weeks[i + 1].t) weeks[i].ms += v; break; }
  }
  return weeks;
}
// Wann am Tag lernst du? Minuten je Stunde (0–23) über alle Einheiten
export function byHour(sessions) {
  const h = Array(24).fill(0);
  for (const s of sessions) {
    for (let t = s.start; t < s.end; ) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const e = Math.min(next, s.end);
      h[d.getHours()] += e - t;
      t = e;
    }
  }
  return h;
}
