// Datenspeicher: alles bleibt auf diesem Gerät (localStorage).
// Lerneinheiten, Pomodoro-Phasen und Backup-Import. Reines ES-Modul ohne Abhängigkeiten.

const DATA_KEY = "lern:data";
const CFG_KEY = "lern:cfg";
const MIN_SESSION_MS = 60 * 1000; // kürzere Einheiten werden verworfen

const read = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const emptyData = () => ({ version: 1, sessions: [], deleted: [], running: null });

// Zwei Datenstände zusammenführen (für den Backup-Import): Einheiten über ihre ID vereinigen
export function mergeData(a, b) {
  const deleted = [...new Set([...(a.deleted || []), ...(b.deleted || [])])].sort();
  const gone = new Set(deleted);
  const byId = new Map();
  for (const s of [...(a.sessions || []), ...(b.sessions || [])]) if (!gone.has(s.id)) byId.set(s.id, s);
  const sessions = [...byId.values()].sort((x, y) => x.start - y.start || x.id.localeCompare(y.id));
  return { version: 1, sessions, deleted, running: a.running || b.running || null };
}

export class Store {
  constructor() {
    this.data = mergeData(emptyData(), read(DATA_KEY, emptyData()));
    this.cfg = { focusMin: 25, breakMin: 5, ...read(CFG_KEY, {}) };
    this.saveOk = true;
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
  saveCfg(patch) { Object.assign(this.cfg, patch); write(CFG_KEY, this.cfg); this.emit(); }
  commit() { this.saveOk = write(DATA_KEY, this.data); this.emit(); }

  // ---------- Timer ----------
  start(mode, at = Date.now()) {
    this.data.running = { start: at, mode, phase: "focus", phaseStart: at, focusMin: this.cfg.focusMin, breakMin: this.cfg.breakMin };
    this.commit();
  }
  addSession(start, end, mode = "frei") {
    if (end - start < MIN_SESSION_MS) return null;
    const s = { id: uid(), start: Math.round(start), end: Math.round(end), mode };
    this.data.sessions.push(s);
    this.data.sessions.sort((x, y) => x.start - y.start);
    return s;
  }
  // Beendet die laufende Lernphase und speichert sie
  stop(at = Date.now(), { save = true } = {}) {
    const r = this.data.running;
    if (!r) return null;
    const s = save && r.phase === "focus" ? this.addSession(r.phaseStart, at, r.mode) : null;
    this.data.running = null;
    this.commit();
    return s;
  }
  // Pomodoro: Phasenwechsel nachholen (auch wenn die App zwischendurch zu war).
  // Gibt die Wechsel zurück, damit die Oberfläche einen Ton spielen kann.
  tick(now = Date.now()) {
    const r = this.data.running;
    if (!r || r.mode !== "pomodoro") return [];
    const events = [];
    for (let guard = 0; guard < 4; guard++) {
      const len = (r.phase === "focus" ? r.focusMin : r.breakMin) * 60000;
      const end = r.phaseStart + len;
      if (now < end) break;
      if (r.phase === "focus") {
        this.addSession(r.phaseStart, end, "pomodoro");
        r.phase = "break";
        r.phaseStart = end;
        events.push({ type: "focus-end", at: end });
      } else {
        // Nach der Pause wartet die App auf den nächsten Knopfdruck
        this.data.running = null;
        events.push({ type: "break-end", at: end });
        break;
      }
    }
    if (events.length) this.commit();
    return events;
  }
  // Pause überspringen → direkt die nächste Lernphase
  nextFocus(at = Date.now()) {
    const r = this.data.running;
    if (!r) return;
    Object.assign(r, { phase: "focus", phaseStart: at });
    this.commit();
  }
  remove(id) {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    if (!this.data.deleted.includes(id)) this.data.deleted.push(id);
    this.commit();
  }
  importData(obj) {
    if (!obj || !Array.isArray(obj.sessions)) throw new Error("Keine Lern-Buddy-Datei");
    this.data = mergeData(this.data, obj);
    this.commit();
  }
}
