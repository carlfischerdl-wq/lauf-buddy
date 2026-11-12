# 🏃 Lauf-Buddy

Deine eigene Lauf-Website, vollautomatisch: Du beendest das Workout auf der Apple Watch. Ein bis zwei Minuten später zeigt deine Website eine **Zusammenfassung mit Note von 1–10**, Tipps und die Empfehlung für den nächsten Lauf. Dazu gibt es ein **Ziel-Feld**, aus dem ein Trainingsplan entsteht.

```
Apple Watch ──► Health ──► Automation „Workout beendet“ ──► Kurzbefehl mit Health Auto Export
                                   │  lädt das Training als JSON zu GitHub hoch
                                   ▼
             GitHub Action wertet aus ──► GitHub Pages = deine Website
```

**Kosten:** einmalig 29,99 € für *Health Auto Export – Premium Lifetime* (kein Abo). GitHub ist kostenlos.

---

## 1. GitHub einrichten (ca. 10 Min.)
1. Kostenlosen Account auf [github.com](https://github.com/signup) anlegen.
2. **+ → New repository** → Name `lauf-buddy` → **Public** → *Create repository*.
3. **uploading an existing file** anklicken → **alle Dateien und Ordner** aus diesem Paket hineinziehen → *Commit changes*.
   ⚠️ Der Ordner `.github` ist auf dem Mac versteckt: Im Finder **⌘ + ⇧ + .** drücken, dann ist er sichtbar und kann mit hochgeladen werden.
4. **Settings → Pages → Source: „GitHub Actions“** auswählen.
5. Tab **Actions** → Workflows aktivieren → „Training verarbeiten & Website aktualisieren“ → **Run workflow**.
   Nach ca. 1 Minute ist deine Seite online: `https://DEIN-NAME.github.io/lauf-buddy/`, zunächst mit Demo-Daten.

## 2. Zugangsschlüssel für den Kurzbefehl (ca. 3 Min.)
1. GitHub → Profilbild → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name: `Lauf-Buddy`, Ablauf: z. B. 1 Jahr.
3. **Repository access → Only select repositories → `lauf-buddy`**.
4. **Permissions → Repository permissions → Contents: Read and write**.
5. *Generate token* → den Schlüssel (beginnt mit `github_pat_`) kopieren. Er wird nur einmal angezeigt.

## 3. Health Auto Export & Kurzbefehl (ca. 10 Min.)
1. App **„Health Auto Export – JSON+CSV“** (Entwickler: Lybron Sobers) laden und Zugriff auf Health erlauben (Workouts, Herzfrequenz, Strecken).
   Die ersten 7 Tage kannst du alles kostenlos testen, danach **Premium Lifetime (29,99 €, einmalig)** kaufen. Basic reicht nicht, weil die App nur mit Premium in Automationen laufen darf.
2. App **Kurzbefehle** öffnen → **+** → Name: **„Lauf hochladen“**. Füge diese Aktionen der Reihe nach hinzu:

| # | Aktion | Einstellungen |
|---|---|---|
| 0 | **Warten** | 60 Sekunden, damit die Uhr das Training fertig ans iPhone übertragen hat |
| 1 | **Health Auto Export → Workouts exportieren** (Name kann je nach App-Version leicht abweichen) | Zeitraum: *Heute* · Format: **JSON** · Version **2** · Herzfrequenz-Daten **an** · Route **an** |
| 2 | **Base64-Codierung** | Modus: *Codieren* · Zeilenumbrüche: **Keine** |
| 3 | **Datum formatieren** | Datum: *Aktuelles Datum* · Format: *Eigenes* → `yyyyMMdd-HHmmss` |
| 4 | **Inhalte von URL abrufen** | URL: `https://api.github.com/repos/DEIN-NAME/lauf-buddy/contents/data/inbox/` + Variable *Formatiertes Datum* + `.json`<br>Methode: **PUT**<br>Header: `Authorization` = `Bearer DEIN-TOKEN` und `Accept` = `application/vnd.github+json`<br>Hauptteil: **JSON** → Feld `message` (Text) = `Training` und Feld `content` (Text) = Variable *Base64-codiert* |
| 5 | **Mitteilung anzeigen** | `Lauf hochgeladen ✓ – Auswertung in ca. 1 Minute auf deiner Website` |

3. **Automation anlegen (das macht es vollautomatisch):** Kurzbefehle → Tab **Automation** → **+** → **Apple Watch-Workout** → *Endet* (Trainingsart: *Beliebig* oder *Laufen*) → **Sofort ausführen** wählen → Kurzbefehl **„Lauf hochladen“** auswählen → Fertig.
4. Website-Icon auf den Home-Bildschirm legen (siehe unten). Nach dem Lauf öffnest du nur noch die Website. 🎉

> Testlauf: Kurzbefehl einmal von Hand starten. Unter GitHub → **Actions** siehst du, ob die Verarbeitung grün durchläuft. Bei einem Fehler einen Screenshot an Claude schicken.

**Falls ein Lauf mal fehlt** (z. B. weil das iPhone beim Training nicht in der Nähe war): Den Kurzbefehl einfach von Hand starten. Doppelte Trainings werden automatisch erkannt.

## 4. Auf dem iPhone einrichten
- Website in Safari öffnen → Teilen → **Zum Home-Bildschirm**.
- **Profil:** Geburtsjahr und Ruhepuls eintragen. Dadurch werden die Pulszonen genauer.
- **Ziel & Plan:** dein Ziel in eigenen Worten eingeben, z. B. *„10 km unter 50 Minuten in 12 Wochen, 4× pro Woche“*.

---

## Wie die Note entsteht
| Teilnote | Gewicht | Was wird gemessen |
|---|---|---|
| Intensität passend | 30 % | Passt die Zeit in den Pulszonen zum Trainingsziel (locker, lang, Tempo, Intervall)? |
| Effizienz | 25 % | Tempo pro Herzschlag im Vergleich zu deinen letzten 6 Wochen |
| Belastungssteuerung | 20 % | Belastung der letzten 7 Tage im Verhältnis zum 4-Wochen-Schnitt (ideal 0,8–1,3) |
| Gleichmäßigkeit | 15 % | Puls-Drift im Verlauf bzw. gleichmäßige Intervalle |
| Umfang | 10 % | Wie geplant bzw. im Verhältnis zu deinen üblichen Läufen |

Mit aktivem Plan wird jeder Lauf an der Einheit gemessen, die für diesen Tag geplant war. Tempi und Prognosen basieren auf dem VDOT-Modell von Jack Daniels. Effizienz und Belastung werden erst nach ein paar Wochen Daten aussagekräftig.

## Gut zu wissen
- **Datenschutz:** Das Repository ist öffentlich. Deine Trainingsdateien (Datum, Distanz, Puls) kann also jeder sehen, der das Repo findet. Die GPS-Strecke wird nur zur Tempo-Berechnung genutzt und nicht gespeichert. Den Token gibst du nur in den Kurzbefehl ein.
- Lädst du denselben Tag zweimal hoch, ist das kein Problem. Doppelte Trainings werden erkannt.
- **Tiefere Analyse:** In jeder Lauf-Ansicht gibt es „Für Claude kopieren“. Den Text in den Claude-Chat einfügen und nach Tipps fragen.
