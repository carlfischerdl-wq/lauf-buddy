import { Store } from "./store.js";
import * as St from "./stats.js";

const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (t, o = { weekday: "short", day: "numeric", month: "short" }) => new Date(t).toLocaleDateString("de-DE", o);
const fmtTime = (t) => new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

const store = new Store();
let page = "home";
let mode = (() => { try { return localStorage.getItem("lern:mode") || "frei"; } catch { return "frei"; } })();

// ---------- Ton (muss einmal durch einen Tipp freigeschaltet werden) ----------
let audio = null;
const unlockAudio = () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch {} };
function chime(times = 2) {
  if (!audio) return;
  const t0 = audio.currentTime;
  for (let i = 0; i < times; i++) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = i % 2 ? 660 : 880;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.3);
    o.connect(g).connect(audio.destination);
    o.start(t0 + i * 0.35);
    o.stop(t0 + i * 0.35 + 0.32);
  }
  navigator.vibrate?.(200);
}

// ---------- Lernen: der große Knopf ----------
const R = 108, C = 2 * Math.PI * R;
function viewHome() {
  const r = store.data.running;
  const now = Date.now();
  const sum = St.summary(store.data.sessions, r, now);
  let label = "Start", sub = mode === "pomodoro" ? `${store.cfg.focusMin} min lernen · ${store.cfg.breakMin} min Pause` : "Tippen, wenn du loslegst", progress = 0, cls = "idle";
  if (r) {
    const elapsed = now - r.phaseStart;
    if (r.mode === "pomodoro") {
      const len = (r.phase === "focus" ? r.focusMin : r.breakMin) * 60000;
      label = St.fmtClock(len - elapsed);
      progress = Math.min(1, elapsed / len);
      cls = r.phase === "focus" ? "focus" : "break";
      sub = r.phase === "focus" ? `Pomodoro ${sum.pomToday + 1} · tippen zum Beenden` : "Pause · tippen für die nächste Runde";
    } else {
      label = St.fmtClock(elapsed);
      progress = (elapsed % 3600000) / 3600000;
      cls = "focus";
      sub = `seit ${fmtTime(r.phaseStart)} · tippen zum Beenden`;
    }
  }
  $app.innerHTML = `
    ${r ? "" : `<div class="seg" role="tablist">
      <button data-mode="frei" class="${mode === "frei" ? "on" : ""}">Frei</button>
      <button data-mode="pomodoro" class="${mode === "pomodoro" ? "on" : ""}">Pomodoro</button>
    </div>`}
    <div class="stage">
      <button id="big" class="big ${cls}" aria-label="${r ? "Stoppen" : "Lernen starten"}">
        <svg viewBox="0 0 240 240" aria-hidden="true">
          <circle class="track" cx="120" cy="120" r="${R}"/>
          <circle class="prog" cx="120" cy="120" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - progress)}"/>
        </svg>
        <span class="lbl">${label}</span>
      </button>
      <p class="sub">${esc(sub)}</p>
      ${r ? `<button class="link" id="discard">${r.phase === "break" ? "Pomodoro beenden" : "Verwerfen"}</button>` : ""}
    </div>
    <div class="tiles">
      <div class="tile"><div class="v">${St.fmtDur(sum.today, { short: true })}</div><div class="l">heute${sum.pomToday ? ` · ${sum.pomToday} 🍅` : ""}</div></div>
      <div class="tile"><div class="v">${St.fmtDur(sum.week, { short: true })}</div><div class="l">diese Woche</div></div>
      <div class="tile"><div class="v">${sum.streak} ${sum.streak === 1 ? "Tag" : "Tage"}</div><div class="l">Serie 🔥</div></div>
    </div>`;

  $app.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { mode = b.dataset.mode; try { localStorage.setItem("lern:mode", mode); } catch {} viewHome(); }));
  document.getElementById("big").onclick = () => {
    unlockAudio();
    const cur = store.data.running;
    if (!cur) store.start(mode);
    else if (cur.mode === "pomodoro" && cur.phase === "break") store.nextFocus();
    else {
      const long = Date.now() - cur.phaseStart > 5 * 3600000;
      if (long && !confirm(`Der Timer läuft seit ${St.fmtDur(Date.now() - cur.phaseStart)}. Trotzdem so speichern?`)) return;
      store.stop();
    }
  };
  const d = document.getElementById("discard");
  if (d) d.onclick = () => {
    const cur = store.data.running;
    if (cur.phase === "break" || confirm("Diese Lernphase verwerfen, ohne sie zu speichern?")) store.stop(Date.now(), { save: false });
  };
}

// ---------- Statistik ----------
function bars(items, { fmtLabel, tip, highlightLast = true }) {
  const max = Math.max(1, ...items.map((x) => x.ms));
  return `<div class="bars">${items.map((x, i) => `<div class="bar" data-tip="${esc(tip(x))}" title="${esc(tip(x))}">
      <i style="height:${(x.ms / max) * 100}%" class="${highlightLast && i === items.length - 1 ? "cur" : ""}"></i>
      <span>${fmtLabel(x, i)}</span></div>`).join("")}</div>`;
}
function viewStats() {
  const { sessions, running } = store.data;
  const sum = St.summary(sessions, running);
  const days = St.lastDays(sessions, running, 14);
  const weeks = St.lastWeeks(sessions, running, 12);
  const hours = St.byHour(sessions);
  const peak = hours.indexOf(Math.max(...hours));
  const recent = [...sessions].reverse().slice(0, 30);
  $app.innerHTML = `
    <h1>Statistik</h1>
    <div class="tiles">
      <div class="tile"><div class="v">${St.fmtDur(sum.today, { short: true })}</div><div class="l">heute</div></div>
      <div class="tile"><div class="v">${St.fmtDur(sum.week, { short: true })}</div><div class="l">diese Woche</div></div>
      <div class="tile"><div class="v">${St.fmtDur(sum.avg30, { short: true })}</div><div class="l">Ø pro Tag (30 Tage)</div></div>
      <div class="tile"><div class="v">${sum.streak} / ${sum.bestStreak}</div><div class="l">Serie / Rekord (Tage)</div></div>
      <div class="tile"><div class="v">${St.fmtDur(sum.longest, { short: true })}</div><div class="l">längste Einheit</div></div>
      <div class="tile"><div class="v">${St.fmtDur(sum.total, { short: true })}</div><div class="l">gesamt · ${sum.sessions} Einheiten</div></div>
    </div>
    <section class="card"><h2>Letzte 14 Tage</h2>
      ${bars(days, { fmtLabel: (x, i) => (i % 2 === 1 ? "" : fmtDate(x.t, { weekday: "narrow" })), tip: (x) => `${fmtDate(x.t)}: ${St.fmtDur(x.ms)}` })}
    </section>
    <section class="card"><h2>Pro Woche</h2>
      ${bars(weeks, { fmtLabel: (x, i) => (i % 3 === 2 ? fmtDate(x.t, { day: "numeric", month: "numeric" }) : ""), tip: (x) => `Woche ab ${fmtDate(x.t, { day: "numeric", month: "short" })}: ${St.fmtDur(x.ms)}` })}
    </section>
    ${sessions.length >= 3 ? `<section class="card"><h2>Wann du lernst</h2>
      ${bars(hours.map((ms, h) => ({ ms, h })), { highlightLast: false, fmtLabel: (x) => (x.h % 6 === 0 ? `${x.h}` : ""), tip: (x) => `${x.h}–${x.h + 1} Uhr: ${St.fmtDur(x.ms)}` })}
      <p class="small muted">Am meisten lernst du zwischen ${peak} und ${peak + 1} Uhr.</p>
    </section>` : ""}
    <section class="card"><h2>Lernzeit nachtragen</h2>
      <div class="form3">
        <label>Tag<input type="date" id="m-day" value="${St.dayKey(Date.now())}"></label>
        <label>Beginn<input type="time" id="m-start" value="${fmtTime(Date.now() - 3600000)}"></label>
        <label>Minuten<input type="number" id="m-min" inputmode="numeric" min="1" value="60"></label>
      </div>
      <div class="actions"><button class="btn small" id="m-add">Hinzufügen</button></div>
    </section>
    <section class="card tight"><h2 style="padding:0 16px">Einheiten</h2>
      ${recent.length ? recent.map((s) => `<div class="row">
        <div><b>${St.fmtDur(s.end - s.start)}</b>${s.mode === "pomodoro" ? " 🍅" : ""}<div class="small muted">${fmtDate(s.start)} · ${fmtTime(s.start)}–${fmtTime(s.end)}</div></div>
        <button class="x" data-del="${s.id}" aria-label="Löschen">✕</button></div>`).join("") : `<p class="muted" style="padding:0 16px">Noch keine Einheiten – drück auf den großen Knopf.</p>`}
    </section>`;
  document.getElementById("m-add").onclick = () => {
    const day = document.getElementById("m-day").value, st = document.getElementById("m-start").value, min = +document.getElementById("m-min").value;
    const start = new Date(`${day}T${st || "12:00"}`).getTime();
    if (!Number.isFinite(start) || !(min > 0)) return alert("Bitte Tag, Beginn und Minuten angeben.");
    store.addSession(start, start + min * 60000, "nachgetragen");
    store.commit();
  };
  $app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { if (confirm("Diese Einheit löschen?")) store.remove(b.dataset.del); }));
}

// ---------- Einstellungen ----------
function viewSettings() {
  const c = store.cfg;
  $app.innerHTML = `
    <h1>Einstellungen</h1>
    <section class="card"><h2>Deine Daten</h2>
      <p class="small" style="margin-top:0;line-height:1.45">Alle Lernzeiten liegen nur auf diesem iPhone. ${store.data.sessions.length} Einheiten gespeichert.${store.saveOk ? "" : " <b class=\"err\">⚠︎ Speichern gerade nicht möglich.</b>"}</p>
      <p class="small muted" style="line-height:1.45">Tipp: Ab und zu ein Backup exportieren (z. B. in die Dateien-App). Löschst du in den iPhone-Einstellungen die Safari-Websitedaten, wären die Lernzeiten sonst weg.</p>
      <div class="actions"><button class="btn ghost small" id="b-exp">Backup exportieren</button><label class="btn ghost small">Backup importieren<input type="file" id="b-imp" accept="application/json,.json" hidden></label></div>
    </section>
    <section class="card"><h2>Pomodoro</h2>
      <div class="form3">
        <label>Lernen (min)<input type="number" id="p-focus" min="5" max="120" inputmode="numeric" value="${c.focusMin}"></label>
        <label>Pause (min)<input type="number" id="p-break" min="1" max="60" inputmode="numeric" value="${c.breakMin}"></label>
      </div>
      <p class="small muted">Hinweis: Ist die App im Hintergrund, kann das iPhone keinen Ton spielen. Die Zeit läuft aber korrekt weiter und wird beim Öffnen nachgetragen.</p>
    </section>
`;
  const num = (id, lo, hi, def) => Math.min(hi, Math.max(lo, Math.round(+document.getElementById(id).value || def)));
  document.getElementById("p-focus").onchange = () => store.saveCfg({ focusMin: num("p-focus", 5, 120, 25) });
  document.getElementById("p-break").onchange = () => store.saveCfg({ breakMin: num("p-break", 1, 60, 5) });
  document.getElementById("b-exp").onclick = () => {
    const blob = new Blob([JSON.stringify(store.data, null, 1)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `lern-buddy-${St.dayKey(Date.now())}.json` });
    a.click();
  };
  document.getElementById("b-imp").onchange = async (e) => {
    try { store.importData(JSON.parse(await e.target.files[0].text())); alert("Importiert ✓"); } catch { alert("Das ist keine gültige Lern-Buddy-Backup-Datei."); }
  };
}

// ---------- Routing & Aktualisierung ----------
function render() {
  if (page === "stats") viewStats();
  else if (page === "settings") viewSettings();
  else viewHome();
}
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  page = { statistik: "stats", einstellungen: "settings" }[h] || "home";
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === page));
  render();
  scrollTo(0, 0);
}
store.on(() => {
  // Nie neu zeichnen, während du in ein Feld tippst
  const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (!typing) render();
});
setInterval(() => {
  const ev = store.tick();
  if (ev.some((e) => Date.now() - e.at < 10000)) chime(ev.at(-1).type === "focus-end" ? 3 : 2);
  if (page === "home" && store.data.running) viewHome();
}, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { store.tick(); render(); } });
addEventListener("hashchange", route);

route();
store.tick();
