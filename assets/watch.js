// Wandelt eine Plan-Einheit in eine Apple-Watch-Trainingsdatei (.workout) um.
// Nutzt die MIT-lizenzierte Bibliothek @bibixx/workoutkit (assets/vendor/workoutkit.js).
import {
  WorkoutPlan, Step, Distance, Duration, DistanceGoal, TimeGoal, OpenGoal,
  Speed, SpeedRangeAlert, toBlob,
} from "./vendor/workoutkit.js";

// Pace-Bereich [schnell, langsam] in s/km → Tempo-Alarm der Watch
function paceAlert(pace) {
  if (!pace) return undefined;
  const km = new Distance(1, "kilometers");
  return new SpeedRangeAlert(new Speed(km, new Duration(pace[1], "seconds")), new Speed(km, new Duration(pace[0], "seconds")));
}
function goalOf(x) {
  if (x?.dist_m) return x.dist_m % 1000 === 0 ? new DistanceGoal(new Distance(x.dist_m / 1000, "kilometers")) : new DistanceGoal(new Distance(x.dist_m, "meters"));
  if (x?.time_s) return x.time_s % 60 === 0 ? new TimeGoal(new Duration(x.time_s / 60, "minutes")) : new TimeGoal(new Duration(x.time_s, "seconds"));
  return new OpenGoal();
}

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
      ? [{ p: "work", dist_m: total - s.mPartKm * 1000, pace: s.easyPace }, { p: "work", dist_m: s.mPartKm * 1000, pace: [s.mPace - 8, s.mPace + 8] }]
      : [{ p: "work", dist_m: total, pace: s.easyPace }];
    struct = { blocks: [{ reps: 1, steps }] };
  }
  if (struct.warmup) custom.warmup = new Step(goalOf(struct.warmup));
  for (const b of struct.blocks) {
    const block = custom.addBlock(b.reps);
    for (const st of b.steps) block.addStep(st.p, goalOf(st), undefined, st.p === "work" ? paceAlert(st.pace) : undefined);
  }
  if (struct.cooldown) custom.cooldown = new Step(goalOf(struct.cooldown));
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
