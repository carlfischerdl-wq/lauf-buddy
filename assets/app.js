import * as A from "./analysis.js";
import * as P from "./plan.js";

// ---------- Zustand ----------
const S = { config: {}, index: null, base: "data", demo: false, details: new Map(), profile: null };
const store = {
  get(k, f = null) { try { const v = localStorage.getItem("lb:" + k); return v ? JSON.parse(v) : f; } catch { return f; } },
  set(k, v) { try { localStorage.setItem("lb:" + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("lb:" + k); } catch {} },
};
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (iso, opt = { weekday: "short", day: "numeric", month: "short" }) => new Date(iso).toLocaleDateString("de-DE", opt);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const num = (x, d = 1) => Number(x).toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });
const scoreColor = (s) => (s >= 7.5 ? "var(--good)" : s >= 5.5 ? "var(--warning)" : s >= 4 ? "var(--serious)" : "var(--critical)");

async function getJson(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

async function load() {
  S.config = await getJson("config.json").catch(() => ({}));
  let idx = await getJson("data/index.json").catch(() => ({ workouts: [] }));
  if (!idx.workouts?.length) {
    idx = await getJson("data/demo/index.json").catch(() => ({ workouts: [] }));
    S.base = "data/demo";
    S.demo = true;
  }
  S.index = idx;
  S.profile = A.buildProfile(S.config, store.get("profil", {}), idx.workouts);
  document.getElementById("demo-banner").hidden = !S.demo;
  const ls = idx.lastSync ? `Sync ${fmtDate(idx.lastSync, { day: "numeric", month: "short" })}, ${fmtTime(idx.lastSync)}` : "";
  document.getElementById("sync").textContent = ls;
}

async function detail(id) {
  if (S.details.has(id)) return S.details.get(id);
  const p = getJson(`${S.base}/workouts/${id}.json`).catch(() => S.index.workouts.find((w) => w.id === id));
  S.details.set(id, p);
  return p;
}

function analysisFor(w) {
  const plan = store.get("plan");
  const planned = P.plannedFor(plan, A.localDayKey(w.start));
  return A.analyzeRun(w, S.index.workouts, S.profile, planned);
}

// Lädt Details für mehrere Läufe parallel (begrenzt) und liefert Analysen
async function analyses(list) {
  const out = new Map();
  const queue = [...list];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      out.set(s.id, analysisFor(await detail(s.id)));
    }
  }));
  return out;
}

// ---------- Mini-Charts (SVG) ----------
function lineChart({ xs, ys, w = 360, h = 150, yMin, yMax, fmtY = (v) => Math.round(v), tip, xTicks = [], bands = [], invert = false, dots = false }) {
  const pad = { l: 34, r: 8, t: 8, b: 20 };
  const vals = ys.filter(Number.isFinite);
  if (vals.length < 2) return `<p class="muted small">Zu wenig Daten für ein Diagramm.</p>`;
  let lo = yMin ?? Math.min(...vals), hi = yMax ?? Math.max(...vals);
  if (hi === lo) { hi += 1; lo -= 1; }
  const x0 = xs[0], x1 = xs[xs.length - 1] || 1;
  const X = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
  const Y = (y) => { const f = (y - lo) / (hi - lo); return pad.t + (invert ? f : 1 - f) * (h - pad.t - pad.b); };
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img">`;
  for (const b of bands) {
    const ya = Y(Math.min(hi, Math.max(lo, b.from))), yb = Y(Math.min(hi, Math.max(lo, b.to)));
    if (Math.abs(yb - ya) > 0.5) svg += `<rect x="${pad.l}" y="${Math.min(ya, yb)}" width="${w - pad.l - pad.r}" height="${Math.abs(yb - ya)}" fill="${b.color}" opacity="0.13"/>`;
  }
  for (const t of ticks) svg += `<line class="gridline" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pad.l - 6}" y="${Y(t) + 4}" text-anchor="end">${fmtY(t)}</text>`;
  for (const [x, label] of xTicks) svg += `<text x="${X(x)}" y="${h - 4}" text-anchor="middle">${label}</text>`;
  let d = "", pen = false;
  xs.forEach((x, i) => {
    const y = ys[i];
    if (!Number.isFinite(y)) { pen = false; return; }
    d += `${pen ? "L" : "M"}${X(x).toFixed(1)},${Y(Math.min(hi, Math.max(lo, y))).toFixed(1)}`;
    pen = true;
  });
  svg += `<path class="ln" d="${d}"/>`;
  if (dots) xs.forEach((x, i) => Number.isFinite(ys[i]) && (svg += `<circle class="dot" cx="${X(x)}" cy="${Y(ys[i])}" r="4"/>`));
  // Hover-Zonen (größer als die Marke)
  if (tip) {
    const step = Math.max(1, Math.floor(xs.length / 80));
    for (let i = 0; i < xs.length; i += step) {
      if (!Number.isFinite(ys[i])) continue;
      const xa = i ? (X(xs[i - step] ?? xs[0]) + X(xs[i])) / 2 : pad.l;
      const xb = i + step < xs.length ? (X(xs[i]) + X(xs[i + step])) / 2 : w - pad.r;
      svg += `<rect class="hit" x="${xa}" y="${pad.t}" width="${Math.max(1, xb - xa)}" height="${h - pad.t - pad.b}" data-tip="${esc(tip(i))}" data-cx="${X(xs[i])}" data-cy="${Y(ys[i])}"/>`;
    }
  }
  return svg + `</svg>`;
}

function barChart({ labels, values, w = 360, h = 140, fmt = (v) => v, tip }) {
  const pad = { l: 34, r: 8, t: 8, b: 20 };
  const hi = Math.max(1, ...values) * 1.1;
  const bw = (w - pad.l - pad.r) / values.length;
  const Y = (v) => pad.t + (1 - v / hi) * (h - pad.t - pad.b);
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img">`;
  for (const t of [0, hi / 2, hi]) svg += `<line class="gridline" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pad.l - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  values.forEach((v, i) => {
    const x = pad.l + i * bw + 1, bwi = Math.max(2, bw - 2), y = Y(v), bh = h - pad.b - y;
    const r = Math.min(4, bwi / 2, bh);
    if (v > 0) svg += `<path class="bar" d="M${x},${h - pad.b}V${y + r}Q${x},${y} ${x + r},${y}H${x + bwi - r}Q${x + bwi},${y} ${x + bwi},${y + r}V${h - pad.b}Z"/>`;
    const st = Math.ceil(values.length / 5);
    if ((i % st === 0 && values.length - 1 - i >= st / 2) || i === values.length - 1) svg += `<text x="${x + bwi / 2}" y="${h - 4}" text-anchor="middle">${labels[i]}</text>`;
    svg += `<rect class="hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}" data-tip="${esc(tip(i))}"/>`;
  });
  return svg + `</svg>`;
}

// Tooltip für alle [data-tip]
const $tip = document.getElementById("tip");
function showTip(el) {
  const r = el.getBoundingClientRect();
  const svg = el.ownerSVGElement;
  let x = r.left + r.width / 2, y = r.top;
  if (svg && el.dataset.cx) {
    const sr = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    x = sr.left + (+el.dataset.cx / vb.width) * sr.width;
    y = sr.top + (+el.dataset.cy / vb.height) * sr.height;
  }
  $tip.textContent = el.dataset.tip;
  $tip.hidden = false;
  const half = $tip.offsetWidth / 2 + 6;
  $tip.style.left = Math.min(innerWidth - half, Math.max(half, x)) + "px";
  $tip.style.top = Math.max(40, y) + "px";
}
document.addEventListener("pointerover", (e) => { const el = e.target.closest?.("[data-tip]"); if (el) showTip(el); });
document.addEventListener("pointerdown", (e) => { const el = e.target.closest?.("[data-tip]"); if (el) showTip(el); else $tip.hidden = true; });
document.addEventListener("pointerout", (e) => { if (e.target.closest?.("[data-tip]") && e.pointerType === "mouse") $tip.hidden = true; });
addEventListener("scroll", () => ($tip.hidden = true), { passive: true });

// ---------- Bausteine ----------
function scoreBadge(score) {
  return `<div class="score" style="--c:${scoreColor(score)}" aria-label="Note ${num(score)} von 10"><div>${num(score)}<small>von 10</small></div></div>`;
}
function chip(score) {
  return `<span class="chip" style="--c:${scoreColor(score)}">${num(score)}</span>`;
}
function runCard(w, a, { link = true } = {}) {
  return `<section class="card">
    <div class="row between">
      <div>
        <div class="muted small">${fmtDate(w.start, { weekday: "long", day: "numeric", month: "long" })}, ${fmtTime(w.start)}</div>
        <h2 style="margin:4px 0">${esc(a.headline)}</h2>
        <span class="tag">${a.typeLabel}</span>
      </div>
      ${scoreBadge(a.score)}
    </div>
    <p style="line-height:1.45;margin:12px 0 4px">${esc(a.summary)}</p>
    <ul class="points">
      ${a.positives.map((t) => `<li class="plus">${esc(t)}</li>`).join("")}
      ${a.improvements.map((t) => `<li class="minus">${esc(t)}</li>`).join("")}
    </ul>
    <div class="next"><b>Nächster Schritt:</b> ${esc(a.next)}</div>
    ${link ? `<div class="actions"><a class="btn ghost small" href="#/lauf/${w.id}">Details ansehen</a></div>` : ""}
  </section>`;
}
function zoneBar(a) {
  if (!a.zones) return `<p class="muted small">Keine Pulsdaten.</p>`;
  const tot = a.zones.seconds.reduce((x, y) => x + y, 0) || 1;
  const zb = A.zoneBounds(S.profile);
  return `<div class="zones">${a.zones.seconds.map((s, i) => s > 0 ? `<i style="flex:${s};background:var(--z${i + 1})" data-tip="${zb[i].label}: ${A.fmtDuration(s)} (${Math.round((s / tot) * 100)} %)"></i>` : "").join("")}</div>
    <div class="legend">${zb.map((z, i) => `<span style="--c:var(--z${i + 1})">Z${z.z} ${Math.round((a.zones.seconds[i] / tot) * 100)} %</span>`).join("")}</div>`;
}
function weeklyKm(n = 12) {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const weeks = Array.from({ length: n }, (_, i) => ({ start: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - (n - 1 - i) * 7), km: 0, runs: 0 }));
  for (const w of S.index.workouts) {
    const t = new Date(w.start);
    for (let i = n - 1; i >= 0; i--) if (t >= weeks[i].start) { weeks[i].km += w.distanceM / 1000; weeks[i].runs++; break; }
  }
  return weeks;
}

// ---------- Seiten ----------
async function viewHome() {
  const ws = S.index.workouts;
  if (!ws.length) {
    $app.innerHTML = `<section class="card"><h2>Noch keine Läufe</h2><p>Nach dem Lauf einmal den Kurzbefehl „Lauf hochladen“ antippen – etwa eine Minute später steht hier deine Auswertung.</p></section>`;
    return;
  }
  const last = await detail(ws[0].id);
  const a = analysisFor(last);
  const plan = store.get("plan");
  const today = P.plannedFor(plan, A.localDayKey(new Date()));
  const weeks = weeklyKm(12);
  const vdot = A.estimateVdot(ws, S.profile);
  const recent = ws.slice(0, 20).reverse();
  const scores = await analyses(recent);
  const sc = recent.map((w) => scores.get(w.id)?.score);

  $app.innerHTML = `
    <h1>Hallo${S.profile.name ? " " + esc(S.profile.name) : ""} 👋</h1>
    ${today ? `<section class="card"><div class="muted small">Heute laut Plan</div><h2 style="margin:4px 0">${esc(today.title)} · ${num(today.distanceKm, 1)} km</h2><p class="small" style="margin:4px 0">${esc(today.paceText)} · ${esc(today.hrText)}</p><p class="small muted" style="margin:0">${esc(today.desc)}</p><div class="actions"><button class="btn small" id="today-watch">⌚ Auf die Apple Watch</button></div></section>` : ""}
    <div class="muted small" style="margin:14px 4px -4px">Letztes Training</div>
    ${runCard(last, a)}
    <div class="grid2">
      <div class="stat"><div class="v">${num(weeks[11].km, 1)} km</div><div class="l">diese Woche · ${weeks[11].runs} Läufe</div></div>
      <div class="stat"><div class="v">${num(weeks.slice(7, 11).reduce((s, w) => s + w.km, 0) / 4, 1)} km</div><div class="l">Ø pro Woche (4 Wochen)</div></div>
      ${vdot ? `<div class="stat"><div class="v">${A.fmtDuration(A.predictTime(vdot, 5000))}</div><div class="l">5 km Prognose</div></div>
      <div class="stat"><div class="v">${A.fmtDuration(A.predictTime(vdot, 10000))}</div><div class="l">10 km Prognose</div></div>` : ""}
    </div>
    <section class="card"><h2>Trainingsnoten</h2>
      ${lineChart({ xs: recent.map((_, i) => i), ys: sc, yMin: 0, yMax: 10, dots: true, fmtY: (v) => Math.round(v),
        xTicks: [[0, fmtDate(recent[0].start, { day: "numeric", month: "short" })], [recent.length - 1, fmtDate(recent.at(-1).start, { day: "numeric", month: "short" })]],
        tip: (i) => `${fmtDate(recent[i].start)} · ${scores.get(recent[i].id)?.typeLabel} · Note ${num(sc[i])}` })}
    </section>
    <section class="card"><h2>Kilometer pro Woche</h2>
      ${barChart({ labels: weeks.map((w) => fmtDate(w.start, { day: "numeric", month: "numeric" })), values: weeks.map((w) => w.km), fmt: (v) => Math.round(v),
        tip: (i) => `Woche ab ${fmtDate(weeks[i].start, { day: "numeric", month: "short" })}: ${num(weeks[i].km, 1)} km, ${weeks[i].runs} Läufe` })}
    </section>`;
  const tw = document.getElementById("today-watch");
  if (tw) tw.onclick = () => watchExport(today, tw);
}

async function viewRuns() {
  const ws = S.index.workouts.slice(0, 60);
  $app.innerHTML = `<h1>Läufe</h1><section class="card tight list" id="list">${ws.map((w) => `
    <a href="#/lauf/${w.id}"><div><div class="t">${esc(w.name)}</div>
    <div class="s">${fmtDate(w.start)} · ${A.fmtKm(w.distanceM)} km · ${A.fmtDuration(w.durationSec)} · ${A.fmtPace(A.paceOf(w))}/km${w.avgHr ? ` · ${Math.round(w.avgHr)} bpm` : ""}</div></div>
    <span data-score="${w.id}" class="muted small">…</span></a>`).join("") || `<p style="padding:16px">Noch keine Läufe.</p>`}</section>`;
  const res = await analyses(ws);
  for (const [id, a] of res) {
    const el = $app.querySelector(`[data-score="${id}"]`);
    if (el) el.outerHTML = chip(a.score);
  }
}

function kmSplits(w) {
  const s = w.streams;
  if (!s?.d) return [];
  const out = [];
  let k = 1, lastT = 0, lastI = 0;
  for (let i = 1; i < s.d.length; i++) {
    if (s.d[i] >= k * 1000) {
      const f = (k * 1000 - s.d[i - 1]) / (s.d[i] - s.d[i - 1] || 1);
      const t = s.t[i - 1] + f * (s.t[i] - s.t[i - 1]);
      const hrs = s.hr ? s.hr.slice(lastI, i + 1).filter(Boolean) : [];
      out.push({ km: k, sec: t - lastT, hr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null });
      lastT = t; lastI = i; k++;
    }
  }
  return out;
}

function claudeText(w, a, splits) {
  const p = S.profile;
  return [
    `Bitte analysiere meinen Lauf und gib mir konkrete Tipps.`,
    `Datum: ${fmtDate(w.start, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${fmtTime(w.start)}`,
    a.summary,
    `Erkannter Typ: ${a.typeLabel}. Note vom Lauf-Buddy: ${num(a.score)}/10 (${a.headline}).`,
    ...a.components.map((c) => `- ${c.label}: ${num(c.score)}/10 – ${c.text}`),
    a.zones ? `Zeit in Zonen (Z1–Z5): ${a.zones.seconds.map((s) => A.fmtDuration(s)).join(" / ")}` : "",
    splits.length ? `Kilometer-Splits: ${splits.map((s) => `${s.km}: ${A.fmtPace(s.sec)}${s.hr ? ` (${s.hr})` : ""}`).join(", ")}` : "",
    `Profil: Max-HF ${p.maxHr}, Ruhe-HF ${p.restHr}${p.age ? `, Alter ${p.age}` : ""}.`,
    store.get("goalText") ? `Mein Ziel: ${store.get("goalText")}` : "",
  ].filter(Boolean).join("\n");
}

async function viewRun(id) {
  const w = await detail(id);
  if (!w) { $app.innerHTML = `<p>Lauf nicht gefunden.</p>`; return; }
  const a = analysisFor(w);
  const s = w.streams;
  const zb = A.zoneBounds(S.profile);
  const splits = kmSplits(w);
  const mins = s?.t?.map((t) => t / 60) || [];
  const T = mins.at(-1) || 0;
  const tTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => [f * T, `${Math.round(f * T)}′`]);
  const paceArr = s?.v?.map((v) => (v > 1.2 ? 1000 / v : null)) || [];
  // gleitender Durchschnitt fürs Tempo (glättet GPS-Rauschen)
  const smooth = paceArr.map((_, i) => { const win = paceArr.slice(Math.max(0, i - 3), i + 4).filter(Number.isFinite); return win.length ? win.reduce((x, y) => x + y, 0) / win.length : null; });
  const pv = smooth.filter(Number.isFinite).sort((x, y) => x - y);

  $app.innerHTML = `
    <p style="margin:12px 4px 0"><a href="#/laeufe">← Alle Läufe</a></p>
    <h1>${esc(w.name)}</h1>
    ${runCard(w, a, { link: false })}
    <div class="grid2">
      <div class="stat"><div class="v">${A.fmtKm(w.distanceM)}</div><div class="l">km</div></div>
      <div class="stat"><div class="v">${A.fmtDuration(w.durationSec)}</div><div class="l">Bewegungszeit</div></div>
      <div class="stat"><div class="v">${A.fmtPace(A.paceOf(w))}</div><div class="l">Ø min/km</div></div>
      <div class="stat"><div class="v">${w.avgHr ? Math.round(w.avgHr) : "–"}</div><div class="l">Ø Puls${w.maxHr ? ` · max ${Math.round(w.maxHr)}` : ""}</div></div>
      <div class="stat"><div class="v">${a.trimp}</div><div class="l">Belastung (TRIMP)</div></div>
      <div class="stat"><div class="v">${w.avgCadence || "–"}</div><div class="l">Schritte/min</div></div>
    </div>
    <section class="card"><h2>So kommt die Note zustande</h2>
      ${a.components.map((c) => `<div class="comp"><div class="row between"><b>${c.label}</b><span class="small muted">${num(c.score)} · Gewicht ${Math.round(c.weight * 100)} %</span></div>
        <div class="bar"><i style="width:${c.score * 10}%"></i></div><div class="small muted" style="margin-top:4px">${esc(c.text)}</div></div>`).join("")}
    </section>
    <section class="card"><h2>Pulszonen</h2>${zoneBar(a)}</section>
    ${s?.hr ? `<section class="card"><h2>Puls (bpm)</h2>
      ${lineChart({ xs: mins, ys: s.hr, xTicks: tTicks, yMin: Math.min(...s.hr.filter(Boolean)) - 5, yMax: Math.max(...s.hr.filter(Boolean)) + 5,
        bands: zb.map((z, i) => ({ from: z.hrFrom, to: z.hrTo, color: `var(--z${i + 1})` })),
        tip: (i) => `${Math.round(mins[i])} min · ${s.hr[i]} bpm${smooth[i] ? ` · ${A.fmtPace(smooth[i])}/km` : ""}` })}
      <div class="small muted">Hinterlegt: deine Pulszonen Z1–Z5.</div></section>` : ""}
    ${pv.length ? `<section class="card"><h2>Tempo (min/km)</h2>
      ${lineChart({ xs: mins, ys: smooth, xTicks: tTicks, yMin: pv[Math.floor(pv.length * 0.02)] - 10, yMax: pv[Math.floor(pv.length * 0.98)] + 10, invert: true, fmtY: A.fmtPace,
        tip: (i) => `${Math.round(mins[i])} min · ${A.fmtPace(smooth[i])}/km` })}
      <div class="small muted">Oben = schneller.</div></section>` : ""}
    ${splits.length ? `<section class="card"><h2>Kilometer</h2><table class="paces">${splits.map((x) => `<tr><td>km ${x.km}</td><td>${x.hr ? x.hr + " bpm" : ""}</td><td>${A.fmtPace(x.sec)} /km</td></tr>`).join("")}</table></section>` : ""}
    <section class="card"><h2>Tiefere Analyse mit Claude</h2>
      <p class="small" style="margin-top:0">Kopiert eine Zusammenfassung dieses Laufs. Füge sie im Claude-Chat ein und frag nach Tipps.</p>
      <button class="btn" id="copy">Für Claude kopieren</button> <span id="copied" class="small muted"></span>
    </section>`;
  document.getElementById("copy").onclick = async () => {
    const txt = claudeText(w, a, splits);
    try { await navigator.clipboard.writeText(txt); document.getElementById("copied").textContent = "Kopiert ✓"; }
    catch { prompt("Text kopieren:", txt); }
  };
}

// ---------- Apple-Watch-Export ----------
async function watchExport(session, btn) {
  if (!session.easyPace && session.type !== "race") {
    alert("Dieser Plan wurde vor dem Watch-Export erstellt. Bitte unter „Ziel & Plan“ einmal „Plan neu berechnen“ tippen.");
    return;
  }
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Erstelle Training…";
  try {
    const { exportToWatch } = await import("./watch.js");
    const r = await exportToWatch(session);
    btn.textContent = r === "aborted" ? label : "✓ Exportiert";
  } catch (e) {
    console.error(e);
    btn.textContent = "Fehler – nochmal versuchen";
  } finally {
    btn.disabled = false;
    setTimeout(() => (btn.textContent = label), 4000);
  }
}

// ---------- Ziel & Plan ----------
function planContext() {
  const ws = S.index.workouts;
  const km28 = ws.filter((w) => Date.now() - Date.parse(w.start) < 28 * A.DAY).reduce((s, w) => s + w.distanceM / 1000, 0);
  return { vdot: A.estimateVdot(ws, S.profile), weeklyKm: km28 / 4 || null, profile: S.profile, goalText: store.get("goalText", "") };
}

function parseTimeInput(v) {
  if (!v) return null;
  const parts = v.trim().split(":").map(Number);
  if (parts.some((x) => !Number.isFinite(x))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 60;
}

function goalForm(g) {
  const dists = [["", "kein Wettkampf"], ["5", "5 km"], ["10", "10 km"], ["21.0975", "Halbmarathon"], ["42.195", "Marathon"]];
  const dv = g.distanceKm ? String(g.distanceKm) : "";
  if (dv && !dists.some(([v]) => v === dv)) dists.push([dv, `${dv} km`]);
  return `<div class="form2">
    <div><label>Distanz</label><select id="g-dist">${dists.map(([v, l]) => `<option value="${v}" ${v === dv ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div><label>Zielzeit (z. B. 49:30 oder 1:55:00)</label><input id="g-time" inputmode="numeric" value="${g.targetSec ? A.fmtDuration(g.targetSec) : ""}" placeholder="optional"></div>
    <div><label>Wettkampf-Datum</label><input id="g-date" type="date" value="${g.targetDate || ""}"></div>
    <div><label>…oder Dauer in Wochen</label><input id="g-weeks" type="number" min="2" max="24" value="${g.weeks || ""}" placeholder="z. B. 10"></div>
    <div><label>Läufe pro Woche</label><select id="g-days">${[2, 3, 4, 5, 6].map((n) => `<option ${n === (g.daysPerWeek || (g.distanceKm >= 21 ? 4 : 3)) ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div><label>Schwerpunkt</label><select id="g-focus">${[["", "Leistung"], ["base", "Grundlagenausdauer"], ["weight", "Abnehmen / fit werden"], ["speed", "Schneller werden"]].map(([v, l]) => `<option value="${v}" ${v === (g.focus || "") ? "selected" : ""}>${l}</option>`).join("")}</select></div>
  </div>`;
}
function readGoalForm() {
  const d = parseFloat(document.getElementById("g-dist").value) || null;
  return {
    kind: d ? "race" : "general",
    distanceKm: d,
    targetSec: d ? parseTimeInput(document.getElementById("g-time").value) : null,
    targetDate: document.getElementById("g-date").value || null,
    weeks: parseInt(document.getElementById("g-weeks").value) || null,
    daysPerWeek: parseInt(document.getElementById("g-days").value),
    focus: document.getElementById("g-focus").value || null,
  };
}

function planHtml(plan) {
  const todayKey = A.localDayKey(new Date());
  const doneDays = new Set(S.index.workouts.map((w) => A.localDayKey(w.start)));
  const pc = plan.paces;
  const curIdx = plan.weeks.findIndex((w) => w.sessions.some((s) => s.date >= todayKey));
  const lvl = { ok: "var(--good)", warn: "var(--warning)", bad: "var(--critical)" };
  return `
    <section class="card">
      <div class="muted small">Dein Plan</div>
      <h2 style="margin:4px 0 8px">${esc(plan.title)}</h2>
      <div class="small muted">${plan.weeks.length} Wochen · ab ${fmtDate(plan.weeks[0].weekStart, { day: "numeric", month: "long" })} · Formwert (VDOT) ${num(plan.vdotNow)}</div>
      ${plan.feasibility ? `<div class="notice" style="--c:${lvl[plan.feasibility.level]}">${plan.feasibility.level === "ok" ? "✓" : "⚠︎"} ${esc(plan.feasibility.text)}</div>` : ""}
      ${plan.warnings.map((t) => `<div class="notice" style="--c:var(--warning)">⚠︎ ${esc(t)}</div>`).join("")}
      <h3>Deine Tempo-Bereiche</h3>
      <table class="paces">
        <tr><td>Locker (Z2)</td><td>${A.fmtPace(pc.E[0])}–${A.fmtPace(pc.E[1])} /km</td></tr>
        <tr><td>Marathontempo</td><td>${A.fmtPace(pc.M)} /km</td></tr>
        <tr><td>Schwelle</td><td>${A.fmtPace(pc.T)} /km</td></tr>
        <tr><td>Intervall</td><td>${A.fmtPace(pc.I)} /km</td></tr>
        <tr><td>Sprints/Wiederholungen</td><td>${A.fmtPace(pc.R)} /km</td></tr>
      </table>
    </section>
    <section class="card tight">
      ${plan.weeks.map((w, i, _a, wi = i) => `<details class="week" ${i === Math.max(0, curIdx) ? "open" : ""}>
        <summary><b>Woche ${w.n} <span class="muted small" style="font-weight:500">· ${esc(w.phase)}</span></b><span class="small muted">${fmtDate(w.weekStart, { day: "numeric", month: "short" })} · ${w.km} km</span></summary>
        ${w.sessions.map((s, si) => `<div class="sess ${s.date === todayKey ? "today" : ""} ${s.date <= todayKey && doneDays.has(s.date) ? "done" : ""}">
          <div class="d">${s.dow}<small>${fmtDate(s.date + "T12:00", { day: "numeric", month: "numeric" })}</small></div>
          <div><div class="title">${esc(s.title)}</div><div class="small muted">${esc(s.paceText)} · ${esc(s.hrText)}</div></div>
          <div class="small" style="text-align:right;white-space:nowrap"><b>${num(s.distanceKm, s.distanceKm % 1 ? 1 : 0)} km</b><br><span class="muted">~${s.durationMin} min</span></div>
          <div class="desc">${esc(s.desc)}</div>
          <div class="desc"><button class="btn ghost small" data-watch="${wi}-${si}">⌚ Auf die Apple Watch</button></div>
        </div>`).join("")}
      </details>`).join("")}
    </section>
    <div class="actions"><button class="btn ghost" id="del-plan">Plan löschen</button></div>`;
}

function viewGoal() {
  const plan = store.get("plan");
  const text = store.get("goalText", "");
  const g = plan?.goal || (text ? P.parseGoal(text) : null);
  $app.innerHTML = `
    <h1>Ziel &amp; Plan</h1>
    <section class="card">
      <h2>Was ist dein Ziel?</h2>
      <textarea id="goal" placeholder="z. B. „Ich will in 12 Wochen 10 km unter 50 Minuten laufen, 4× pro Woche“ oder „Halbmarathon am 26.4. in 1:55“">${esc(text)}</textarea>
      <div class="actions"><button class="btn" id="parse">Plan erstellen</button></div>
      <div id="form" ${g ? "" : "hidden"}>
        <h3>So habe ich dein Ziel verstanden – gern anpassen:</h3>
        <div id="form-inner">${g ? goalForm(g) : ""}</div>
        <div class="actions"><button class="btn ghost" id="regen">Plan neu berechnen</button></div>
      </div>
    </section>
    <div id="plan">${plan ? planHtml(plan) : ""}</div>`;

  const make = (goal) => {
    const pl = P.generatePlan(goal, planContext());
    store.set("plan", pl);
    viewGoal();
    document.getElementById("plan").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  document.getElementById("parse").onclick = () => {
    const t = document.getElementById("goal").value.trim();
    if (!t) return;
    store.set("goalText", t);
    make(P.parseGoal(t));
  };
  document.getElementById("regen").onclick = () => make(readGoalForm());
  $app.querySelectorAll("[data-watch]").forEach((b) => (b.onclick = () => {
    const [wi, si] = b.dataset.watch.split("-").map(Number);
    watchExport(plan.weeks[wi].sessions[si], b);
  }));
  const del = document.getElementById("del-plan");
  if (del) del.onclick = () => { if (confirm("Plan wirklich löschen?")) { store.del("plan"); viewGoal(); } };
}

function viewSettings() {
  const o = store.get("profil", {});
  const p = S.profile;
  const zb = A.zoneBounds(p);
  $app.innerHTML = `
    <h1>Profil</h1>
    <section class="card">
      <h2>Deine Werte</h2>
      <p class="small muted" style="margin-top:0">Je genauer, desto besser die Pulszonen und Noten. Wird nur in diesem Browser gespeichert.</p>
      <div class="form2">
        <div><label>Name</label><input id="p-name" value="${esc(o.name ?? S.config.name ?? "")}"></div>
        <div><label>Geburtsjahr</label><input id="p-year" type="number" inputmode="numeric" value="${o.geburtsjahr ?? S.config.geburtsjahr ?? ""}" placeholder="z. B. 2003"></div>
        <div><label>Max. Puls (falls bekannt)</label><input id="p-max" type="number" inputmode="numeric" value="${o.maxHF ?? ""}" placeholder="${p.maxHr}"></div>
        <div><label>Ruhepuls (morgens)</label><input id="p-rest" type="number" inputmode="numeric" value="${o.ruheHF ?? ""}" placeholder="${p.restHr}"></div>
      </div>
      <div class="actions"><button class="btn" id="save">Speichern</button></div>
      <p class="small muted">Aktuell: Max-HF ${p.maxHr} (${p.maxHrSource}), Ruhe-HF ${p.restHr} (${p.restHrSource}). Tipp: Den Ruhepuls zeigt die Apple Watch in der Health-App.</p>
    </section>
    <section class="card"><h2>Deine Pulszonen</h2>
      <table class="paces">${zb.map((z, i) => `<tr><td><span class="legend"><span style="--c:var(--z${i + 1})">${z.label}</span></span></td><td>${z.hrFrom}–${z.hrTo} bpm</td></tr>`).join("")}</table>
    </section>
    <section class="card"><h2>Wie die Note entsteht</h2>
      <p class="small" style="margin-top:0;line-height:1.5">Jeder Lauf bekommt fünf Teilnoten: <b>Intensität passend</b> (30 %, passt der Puls zum Trainingsziel?), <b>Effizienz</b> (25 %, Tempo pro Herzschlag im Vergleich zu deinen letzten 6 Wochen), <b>Belastungssteuerung</b> (20 %, die letzten 7 Tage im Vergleich zu den letzten 4 Wochen), <b>Gleichmäßigkeit</b> (15 %, Puls-Drift bzw. gleichmäßige Intervalle) und <b>Umfang</b> (10 %, wie geplant bzw. wie üblich). Wenn du einen Plan hast, wird jeder Lauf an der geplanten Einheit gemessen.</p>
    </section>
    <section class="card"><h2>Daten</h2>
      <p class="small" style="margin-top:0">${S.demo ? "Es werden gerade Demo-Daten angezeigt – sie verschwinden mit deinem ersten echten Lauf." : `${S.index.workouts.length} Trainings gespeichert.`} ${S.index.lastSync ? `Zuletzt aktualisiert: ${fmtDate(S.index.lastSync)} ${fmtTime(S.index.lastSync)}.` : ""}</p>
    </section>`;
  document.getElementById("save").onclick = () => {
    store.set("profil", {
      name: document.getElementById("p-name").value.trim(),
      geburtsjahr: document.getElementById("p-year").value,
      maxHF: document.getElementById("p-max").value,
      ruheHF: document.getElementById("p-rest").value,
    });
    S.profile = A.buildProfile(S.config, store.get("profil", {}), S.index.workouts);
    viewSettings();
  };
}

// ---------- Routing ----------
async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [page, arg] = h.split("/");
  const tab = { "": "home", laeufe: "runs", lauf: "runs", ziel: "goal", einstellungen: "settings" }[page] || "home";
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  $tip.hidden = true;
  try {
    if (page === "laeufe") await viewRuns();
    else if (page === "lauf") await viewRun(arg);
    else if (page === "ziel") viewGoal();
    else if (page === "einstellungen") viewSettings();
    else await viewHome();
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<section class="card"><h2>Fehler</h2><p class="small">${esc(e.message)}</p></section>`;
  }
  if (page !== "ziel") scrollTo(0, 0);
}

addEventListener("hashchange", route);
load().then(route);
