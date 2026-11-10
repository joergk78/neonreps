# Trainingslog – offlinefähige Trainings-App (Version 0.4)

Eine schlanke PWA für zwei A/B-Trainingspläne. Die App hat **keinen Server für Trainingsdaten** und sendet keine Trainingsdaten an irgendeine Gegenstelle. Alle Eingaben werden in der IndexedDB des verwendeten Browsers gespeichert.

## Unter Windows starten

1. Den ZIP-Ordner entpacken, beispielsweise nach `C:\dev\Trainingslog`.
2. In diesem Ordner die Eingabeaufforderung oder PowerShell öffnen.
3. `node server.cjs` ausführen.
4. Auf dem Windows-PC `http://localhost:4173` im Browser öffnen.

Wenn `node` nicht gefunden wird, die vollständige Adresse zur vorhandenen `node.exe` verwenden. Bei einer portablen Node-Installation könnte der Befehl beispielsweise so aussehen:

```powershell
& "C:\Tools\node\node.exe" server.cjs
```

Es sind keine Adminrechte und keine weiteren npm-Pakete erforderlich. Den Server mit `Strg+C` beenden.

## Bereits enthalten

- Training A und Training B mit *Beispielübungen*, die über **Pläne** bearbeitet werden können
- Schwarzes Matrix-Design mit neongrünen Akzenten und weißen Trainingszahlen
- Große Plus- und Minustasten, gewichtsspezifische Schrittweite, Wiederholungen, Satzanzeige
- Gewichte und Wiederholungen durch Antippen der Zahl direkt eingeben (auch `42,5` kg)
- Einheitliche, symmetrische Eingabefelder; kompakte Trainingserfassung für iPhone-Displays
- Sofortige Speicherung je Satz, automatischer Satz- und Übungswechsel
- Freies Vor-/Zurückblättern zwischen Sätzen und Übungen, ohne einen Satz zu speichern
- Bereits gespeicherte Sätze erneut ansehen und bei Bedarf aktualisieren
- Kurze, offline verfügbare Technik-Cues (ⓘ) je Übung, im Planeditor änderbar
- Übungen vor dem ersten Satz ausfallen lassen, optional mit Grund, oder für später überspringen
- Begonnene Übungen mit Grund vorzeitig beenden, bereits absolvierte Sätze bleiben erhalten; abgeschlossene Übungen können nicht nachträglich ausfallen
- Pausentimer auf Basis einer echten Endzeit, mit **Pause beenden** und **+30 Sekunden**
- Laufende Trainingseinheiten nach Schließen/Neustart fortsetzen
- Übung überspringen, Übungen direkt anwählen, letzten Satz rückgängig machen
- Abschlussübersicht mit erledigten, offenen, ausgefallenen und vorzeitig beendeten Übungen
- Dezente Steigerungsempfehlung nach einer vollständig erreichten oberen Wiederholungsgrenze
- Automatische Planversionen bei jeder Änderung, frühere Versionen ansehen und wiederherstellen
- Aktive Trainingseinheiten behalten einen Schnappschuss ihres ursprünglichen Plans
- Historie, einfacher Gewichtsverlauf, CSV-Export für deutsches Excel
- „Mehr“-Menü mit Daten & Backup, Einstellungen, Hilfe und „Über die App“ mit Jörgs Namen
- CSV inklusive Ausfall- und Teilabbruchgründen; JSON-Backup inklusive Planversionen und Import (auch Backups aus 0.1/0.2/0.3)
- PWA-Manifest, Icon, Service Worker und Offline-Datei-Cache

## Wichtige Hinweise

- Ein lokal unter Windows gespeicherter Trainingssatz ist **nicht automatisch auf dem iPhone**. Das sind getrennte Datenbanken. Für eine Übertragung gibt es JSON-Export/-Import.
- Beim Update auf 0.4 die vorhandenen Programmdateien ersetzen, **nicht** Browserdaten löschen. Danach ggf. zweimal neu laden (F5), damit der neue Offline-Cache aktiv wird. Das vorhandene Datenbankformat bleibt erhalten.
- Wenn du eine vorhandene Übung durch eine andere ersetzt, aktiviere im Planeditor **„Als neue Übung behandeln“**. Dadurch bleiben die Fortschrittsverläufe getrennt. Eine bloße Namenskorrektur braucht das Häkchen nicht.
- Die Steigerungsempfehlung erscheint nur, wenn beim letzten abgeschlossenen Training alle geplanten Sätze mit demselben Gewicht und jeweils mindestens der oberen Ziel-Wiederholungszahl erreicht wurden. Sie verändert keine Gewichte automatisch.
- Die spätere iPhone-Installation erfolgt über eine HTTPS-Adresse. Dazu wird die App in Safari aufgerufen und über **Teilen → Zum Home-Bildschirm → Als Web-App öffnen** installiert.
- Die eigentliche Offline-Prüfung muss auf dem iPhone stattfinden. Nach der Installation im Flugmodus neu öffnen, Sätze erfassen, die App schließen und erneut öffnen.
- iOS kann Web-App-Speicher unter bestimmten Umständen entfernen. Bitte deshalb regelmäßig ein Backup speichern.
- Ein Ton oder eine Benachrichtigung bei gesperrtem Display ist in dieser Version nicht zugesagt.
- Einträge über Browser-Einstellungen zu löschen oder die installierte Web-App zu entfernen, kann Trainingsdaten löschen.

## Technischer Aufbau

| Datei | Zweck |
| --- | --- |
| `index.html` | Startseite, Installations-Metadaten |
| `styles.css` | Handyoptimierte Oberfläche |
| `app.js` | Trainingslogik, IndexedDB, Export/Import |
| `sw.js` | Speichert App-Dateien für Offline-Start |
| `manifest.webmanifest` | PWA-Konfiguration |
| `icons/` | App-Symbole |
| `server.cjs` | Kleiner lokaler HTTP-Server nur für den Windows-Test |

Es werden keine Online-Schriftarten, Analytics oder CDNs geladen.

## Noch offen bis zum ersten echten Studiotest

1. Deinen tatsächlichen A/B-Plan samt Gewichten übernehmen.
2. Auf dem iPhone über HTTPS installieren und die Speicherung im Flugmodus prüfen.
3. Touch-Größen, Trainingstempo, Timer und Datei-Export auf dem iPhone beurteilen.

## Funktionstest für Version 0.4

1. Training A starten, auf Gewicht **und** Wiederholungen tippen und die Werte direkt eingeben.
2. Einen Satz speichern, die Pause mit **+30 Sek.** verlängern und dann **Pause beenden** drücken.
3. Über **ⓘ** die kurzen Ausführungshinweise ansehen.
4. Eine Übung nur überspringen und später über die Übungsleiste wieder öffnen.
5. Eine noch nicht begonnene Übung mit Grund „Gerät besetzt“ ausfallen lassen. Bei einer anderen Übung einen von drei Sätzen absolvieren und dann vorzeitig mit Grund beenden.
6. Unter **Pläne** eine Übung ändern; die Version erhöht sich. Anschließend die vorige Version wiederherstellen.
7. Einen Satz speichern, F5 drücken und das laufende Training wieder aufnehmen.
8. Unter „Mehr“ die Hilfeseite und „Über die App“ ansehen. Ein JSON-Backup erzeugen und die gespeicherten Pläne/Versionen/Historie nachvollziehen.

Für eine Aktualisierung der Offline-App die Versionsnummer in `sw.js` (Konstante `CACHE_NAME`) erhöhen und die neuen Dateien über den HTTPS-Host bereitstellen. Vor Updates immer die Trainingsdaten sichern.
