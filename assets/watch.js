// Wandelt eine Plan-Einheit in eine Apple-Watch-Trainingsdatei (.workout) um.
// Nutzt die MIT-lizenzierte Bibliothek @bibixx/workoutkit (assets/vendor/workoutkit.js).
// Standards (wenn nichts anderes gewünscht): Tempo als Durchschnittstempo, Erholung mit
// HF-Zone-2-Warnung, Aufwärmen als Zeit in Sekunden, Auslaufen offen.
import {
  WorkoutPlan, Step, Distance, Duration, DistanceGoal, TimeGoal, OpenGoal,
  Speed, SpeedRangeAlert, HeartRateZoneAlert, toBlob,
} from "./vendor/workoutkit.js";
import { finalizeStruct } from "./plan.js";

const km1 = () => new Distance(1, "kilometers");
function paceAlert(x) {
  if (!x.pace) return undefined;
  const [fast, slow] = x.pace;
  return new SpeedRangeAlert(new Speed(km1(), new Duration(Math.round(slow), "seconds")), new Speed(km1(), new Duration(Math.round(fast), "seconds")), x.metric || "average");
}
function goalOf(x) {
  if (x?.dist_m) return x.dist_m % 1000 === 0 ? new DistanceGoal(new Distance(x.dist_m / 1000, "kilometers")) : new DistanceGoal(new Distance(x.dist_m, "meters"));
  if (x?.time_s) return new TimeGoal(new Duration(Math.round(x.time_s), "seconds")); // Zeiten immer in Sekunden
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

  // Plan-Einheiten haben noch keine vollständige Struktur → mit Standards ergänzen
  const st = s.struct?.final ? s.struct : finalizeStruct({ ...s }).struct;

  const custom = plan.asCustom({ activity: "running", location: "outdoor", displayName: name.slice(0, 60) });
  if (st.warmup) custom.warmup = new Step(goalOf(st.warmup));
  for (const b of st.blocks) {
    const block = custom.addBlock(b.reps);
    for (const x of b.steps) {
      const alert = x.hrZone ? new HeartRateZoneAlert(x.hrZone) : x.p === "work" ? paceAlert(x) : undefined;
      block.addStep(x.p, goalOf(x), undefined, alert);
    }
  }
  if (st.cooldown) custom.cooldown = new Step(st.cooldown.open ? new OpenGoal() : goalOf(st.cooldown));
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
