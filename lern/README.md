# ⏱ Lern-Buddy

Ein großer Knopf: drücken, wenn du lernst, nochmal drücken, wenn du fertig bist. Dazu Pomodoro-Modus und Statistiken (heute, Woche, Serie, Tageszeit).

Läuft als Unterordner der Lauf-Buddy-Website: `https://DEIN-NAME.github.io/lauf-buddy/lern/`
Auf dem iPhone in Safari öffnen → Teilen → **Zum Home-Bildschirm**.

## Gut zu wissen

- Alle Daten bleiben **nur auf dem iPhone** (Browser-Speicher). Ab und zu unter *Einstellungen → Backup exportieren* sichern.
- Funktioniert offline.
- Pomodoro im Hintergrund: Das iPhone lässt Websites im Hintergrund keinen Ton spielen. Die Zeit wird trotzdem korrekt erfasst (eine Lernphase zählt maximal so lang wie eingestellt).
- Einheiten unter 1 Minute werden verworfen. Vergessene Zeiten unter *Statistik → Lernzeit nachtragen* ergänzen.

## Code

| Datei | Inhalt |
|---|---|
| `assets/store.js` | Daten, Timer, Pomodoro-Phasen, Backup-Import |
| `assets/stats.js` | Statistiken (Tage, Wochen, Serie, Tageszeit) |
| `assets/app.js` | Oberfläche & Routing |
| `assets/style.css` | Design (hell/dunkel) |
