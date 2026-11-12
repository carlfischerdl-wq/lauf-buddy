// Wandelt eine Plan-Einheit in eine Apple-Watch-Trainingsdatei (.workout) um.
// Nutzt die MIT-lizenzierte Bibliothek @bibixx/workoutkit (assets/vendor/workoutkit.js).
import {
  WorkoutPlan, Step, Distance, Duration, DistanceGoal, TimeGoal, OpenGoal,
  Speed, SpeedRangeAlert, HeartRateZoneAlert, toBlob,
} from "./vendor/workoutkit.js";

// Tempo-Korridor um die Mitte des Zielbereichs, gemessen am DURCHSCHNITTSTEMPO.
// Breite: 20 s bei Dauerläufen, 10 s bei Intervallen/Tempo.
function paceAlert(pace, width) {
  if (!pace) return undefined;
  const mid = (pace[0] + pace[1]) / 2;
  const fast = Math.round(mid - width / 2), slow = Math.round(mid + width / 2);
  const km = new Distance(1, "kilometers");
  return new SpeedRangeAlert(new Speed(km, new Duration(slow, "seconds")), new Speed(km, new Duration(fast, "seconds")), "average");
}
function goalOf(x) {
  if (x?.dist_m) return x.dist_m % 1000 === 0 ? new DistanceGoal(new Distance(x.dist_m / 1000, "kilometers")) : new DistanceGoal(new Distance(x.dist_m, "meters"));
  if (x?.time_s) return x.time_s % 60 === 0 ? new TimeGoal(new Duration(x.time_s / 60, "minutes")) : new TimeGoal(new Duration(x.time_s, "seconds"));
  return new OpenGoal();
}
// Zeiten immer in Sekunden (Aufwärmen, Erholung)
const secondsGoal = (sec) => new TimeGoal(new Duration(Math.round(sec), "seconds"));

export function buildWorkoutPlan(s) {
  const plan = new WorkoutPlan({ referenceId: crypto.randomUUID() });
  const name = `${s.title.replace(/^🏁\s*/, "")} · ${String(s.distanceKm).replace(".", ",")} km`;

  // Wettkampf → Pacer-Training (Distanz in Zielzeit)
  if (s.type === "race" && s.durationMin) {
    plan.asPacer({ activity: "running", location: "outdoor", distance: new Distance(s.distanceKm, "kilometers"), time: new Duration(Math.round(s.durationMin), "minutes") });
    return plan;
  }

  const custom = plan.asCustom({ activity: "running", location: "outdoor", displayName: name.slice(0, 60) });
  let struct = s.struct;
  if (!struct) {
    // Lockerer / langer Lauf: eine Strecke im Grundlagentempo, ggf. mit Renntempo-Teil am Ende
    const total = Math.round(s.distanceKm * 1000);
    const steps = s.mPartKm
      ? [{ p: "work", dist_m: total - s.mPartKm * 1000, pace: s.easyPace, easy: true }, { p: "work", dist_m: s.mPartKm * 1000, pace: [s.mPace, s.mPace] }]
      : [{ p: "work", dist_m: total, pace: s.easyPace, easy: true }];
    struct = { blocks: [{ reps: 1, steps }] };
  }
  // Aufwärmen als Zeit in Sekunden (Strecke × lockeres Tempo, auf 30 s gerundet)
  const easyMid = s.easyPace ? (s.easyPace[0] + s.easyPace[1]) / 2 : 420;
  if (struct.warmup) {
    const sec = struct.warmup.time_s || Math.round(((struct.warmup.dist_m / 1000) * easyMid) / 30) * 30;
    custom.warmup = new Step(secondsGoal(sec));
  }
  for (const b of struct.blocks) {
    const block = custom.addBlock(b.reps);
    for (const st of b.steps) {
      if (st.p === "recovery") {
        // Erholung: Zeit in Sekunden + Herzfrequenz-Zone 2
        const sec = st.time_s || Math.round(((st.dist_m || 400) / 1000) * easyMid);
        block.addStep("recovery", secondsGoal(sec), undefined, new HeartRateZoneAlert(2));
      } else {
        block.addStep("work", goalOf(st), undefined, paceAlert(st.pace, st.easy ? 20 : 10));
      }
    }
  }
  // Auslaufen: offen (ohne Ziel) – du beendest es selbst
  if (struct.cooldown) custom.cooldown = new Step(new OpenGoal());
  return plan;
}

// Datei erzeugen und übergeben: auf dem iPhone über das Teilen-Menü, sonst als Download
export async function exportToWatch(s) {
  const blob = toBlob(buildWorkoutPlan(s));
  const fname = `${s.date || "training"} ${s.title.replace(/[^\p{L}\p{N} &-]/gu, "").trim()}.workout`;
  const file = new File([blob], fname, { type: "application/octet-stream" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: s.title }); return "shared"; }
    catch (e) { if (e.name === "AbortError") return "aborted"; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: fname });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}
