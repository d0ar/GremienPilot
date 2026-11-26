# Plan: UI-Verbesserungen November 2026

Stand 2026-11-27. Die Entscheidungen wurden im Gespräch vom 2026-11-26 einzeln
abgestimmt. Jeder Abschnitt wird als eigener Branch und eigener PR umgesetzt,
in der unten angegebenen Reihenfolge. Erledigte Punkte werden hier abgehakt.

| PR | Branch | Inhalt | Status |
| --- | --- | --- | --- |
| 1 | `feature/summary-prompt-cache` | Prompt-Wirkung prüfen, Cache beim Neugenerieren umgehen, Herkunftszeile | offen |
| 2 | `feature/top-history` | Gemeinsamer Rückgängig-Verlauf, TOPs verschieben | offen |
| 3 | `feature/transcript-search-highlight` | Transkriptsuche, Begriffsliste zum Hervorheben | offen |
| 4 | `feature/resizable-panes` | Bereiche in der Breite/Höhe verschiebbar | offen |
| 5 | `feature/regeneration-status` | Status pro TOP beim Neugenerieren | offen |
| 6 | `feature/invitation-upload` | Neue Einladung hochladen und Tagesordnung abgleichen | offen |

Abhängigkeiten: PR 2 vor PR 6 (Übernahme nutzt den Verlauf). Suche und
Hervorhebung teilen sich in PR 3 eine Markierungskomponente.

---

## PR 1 – Wirkt ein neuer KI-Prompt beim Neugenerieren?

**Befund aus dem Code (2026-11-26):**

- Im Stil `gemma4-lora` ist der Prompt fest. Das Feld in den KI-Einstellungen ist
  schreibgeschützt (`LLMSettingsPanel.tsx`, `fixedPrompt`). Ein eigener Prompt
  wirkt nur im Stil `gemma4-custom` oder bei einem Nicht-Gemma-Modell (`systemPrompt`).
- Im eigenen Stil kommt der Prompt laut Code an: `App.tsx`
  (`handleRegenerateSummaries`) → Job-`refs` (`main.py`, Summary-Job-Start) →
  `summarize_segment` → `gemma_summary.protocol_messages`.
- Der Antwort-Cache (`LLM_CACHE_DIR`, `llm_transport.cache_key`) enthält die
  Nachrichten. Ein geänderter Prompt erzeugt eine neue Anfrage. Ein unveränderter
  Prompt liefert beim Neugenerieren aus dem Cache **denselben Text**.

**Entscheidungen:**

- Eine manuelle Neugenerierung umgeht den Cache immer. Das neue Ergebnis wird
  danach wieder gespeichert. Pipeline und Wiederaufnahme nutzen den Cache weiter.
- Tests:
  - Backend: Ein geänderter `custom_summary_prompt` landet in der Modellnachricht.
    Die manuelle Neugenerierung ruft das Modell trotz vorhandenem Cache-Eintrag auf.
  - Frontend: „Neu generieren“ sendet die aktuellen Einstellungen.
- Herkunftszeile pro TOP unter der Zusammenfassung: Erzeugungszeit, Stil und eine
  Warnung „Prompt geändert seit Erzeugung“, wenn der aktuelle Prompt nicht zum
  gespeicherten `prompt_sha256` passt.
- Der Bestätigungsdialog nennt den verwendeten Stil. Bei LoRA steht dort
  ausdrücklich „fester Prompt, Einstellungen-Prompt wird nicht verwendet“.

**Umsetzung:**

- [ ] Flag für frische Generierung im Summary-Job (`refs`) bis zu den Workflow-Aufrufen
      durchreichen. Cache lesen überspringen, schreiben beibehalten.
- [ ] `prompt_sha256` und Stil im Frontend-Typ verfügbar machen und vergleichen.
- [ ] Herkunftszeile und Dialogtext in `SummaryStep.tsx`.
- [ ] Tests (Backend und Frontend).

## PR 2 – Rückgängig-Verlauf und TOPs verschieben

**Befund:**

- „TOP löschen“ löscht ohne Rückfrage (`AssignmentStep.tsx`, `deleteSelectedTop`).
  Zusammenfassung und Status des TOPs entfallen über `handleTopsChange` und werden
  automatisch gespeichert.
- Der bestehende Rückgängig-Verlauf umfasst nur Zuordnungen und wird bei jeder
  Änderung der TOP-Liste geleert.
- Zuordnungen verweisen auf TOP-Positionen, Zusammenfassungen auf TOP-IDs.

**Entscheidungen:**

- Ein gemeinsamer Verlauf für alle Änderungen auf der Zuordnungsseite. Jeder Eintrag
  ist ein vollständiger Snapshot: TOPs, IDs, Zuordnungen, Zusammenfassungen,
  Zusammenfassungsstatus und Reviews.
- Erfasst werden Zeilenzuordnungen, Löschen, Zusammenlegen, Umbenennen, Hinzufügen,
  Verschieben, die Übernahme einer PDF-Tagesordnung und die Übernahme von
  Zuordnungsvorschlägen.
- Bedienung über den bestehenden Rückgängig-Knopf und Strg+Z. Nach dem Löschen
  erscheint zusätzlich der Hinweis „TOP ‚…‘ gelöscht – Rückgängig“.
- Der Verlauf liegt nur im Browserspeicher: Er übersteht den Seitenwechsel, aber
  kein Neuladen.
- Während eines laufenden Zusammenfassungsjobs ist Rückgängig gesperrt, mit Hinweis.
- Verschieben: Drag & Drop in der TOP-Liste, Pfeilknöpfe ▲/▼ und Alt+↑/↓.
  Titel und Nummern bleiben unverändert. Zuordnungen werden umnummeriert,
  Zusammenfassungen folgen der ID.

**Umsetzung:**

- [ ] Verlauf aus `AssignmentStep` in den Zustand von `App.tsx` heben, mit Snapshot-Typ.
- [ ] Alle TOP-Operationen und Übernahmen über eine gemeinsame Funktion „Zustand ändern
      und Snapshot anlegen“ führen. Das Leeren des Verlaufs bei TOP-Änderungen entfällt.
- [ ] Hinweis nach dem Löschen. Sperre während eines Jobs.
- [ ] Verschieben (Drag & Drop barrierearm, Knöpfe, Tastenkürzel).
- [ ] Tests: Rückgängig für jede Operation, inklusive Wiederherstellung der Zusammenfassung.

## PR 3 – Transkriptsuche und Begriffsliste

**Entscheidungen zur Suche:**

- Ein Suchfeld über dem Transkript. Alle Treffer werden markiert (gelber Hintergrund),
  der aktuelle kräftiger. Zähler „3 / 17“, ▲/▼ bzw. Enter und Umschalt+Enter,
  Esc leert die Suche.
- Ohne Rücksicht auf Groß-/Kleinschreibung, durchsucht Zeilentext und Sprechername.
  Strg+F wird nicht abgefangen.
- Auf der Zuordnungsseite und für das Originaltranskript der Protokollseite, als eine
  gemeinsame Komponente.

**Entscheidungen zur Begriffsliste:**

- Zentral auf dem Server (SQLite, kleine API) und für alle Arbeitsplätze gleich.
  Zur Laufzeit änderbar.
- Treffer: standardmäßig ganzes Wort, ohne Rücksicht auf Groß-/Kleinschreibung.
  Platzhalter `Rat*` (Wortanfang), `*rat` (Wortende), `*rat*` (Teilwort).
  Mehrwortbegriffe sind erlaubt.
- Darstellung: **fett**, nur in den Transkripten (Zuordnungsseite und Protokollseite).
  Nicht in Zusammenfassungen und nicht im Export.
- Bearbeitung im Abschnitt „Hervorhebungen“ des bisherigen Dialogs „KI-Einstellungen“,
  der in „Einstellungen“ umbenannt wird. Ein Begriff pro Zeile, Hinweis
  „gilt für alle Arbeitsplätze“, Erklärung der Platzhalter.
- Bei gleichzeitiger Bearbeitung gewinnt der zuletzt Speichernde, mit Warnung, wenn
  sich die Liste zwischenzeitlich geändert hat (Revisionsnummer).

**Umsetzung:**

- [ ] Markierungskomponente für Textsegmente: Suchtreffer und Begriffe, überlappungsfähig.
- [ ] Suchleiste mit Navigation, auf beiden Seiten eingebunden.
- [ ] Backend: Tabelle und `GET`/`PUT /api/settings/highlight-terms` mit Revision.
- [ ] Einstellungsdialog umbenennen, Abschnitt „Hervorhebungen“.
- [ ] Tests: Trefferlogik (Wortgrenzen, Umlaute, Platzhalter), API, UI.

## PR 4 – Verschiebbare Bereiche

**Befund:** Die Zuordnungsseite hat zwei Spalten mit fester Tagesordnungsbreite (17rem).
Die Protokollseite hat die Tagesordnung plus Zusammenfassung und Transkript im
Verhältnis 3:2: ab 80rem nebeneinander, darunter übereinander (`index.css`).

**Entscheidungen:**

- Ziehbare Trenner zwischen allen Bereichen beider Seiten. Liegen Zusammenfassung
  und Transkript übereinander, ist der Trenner vertikal verschiebbar.
- Pro Browser (localStorage) und pro Seite gespeichert, für alle Sitzungen gleich.
  Doppelklick setzt auf Standard zurück. Mindestgrößen pro Bereich.
- Unter 64rem Breite bleibt das gestapelte Layout ohne Trenner.

**Umsetzung:**

- [ ] Eigene kleine Trennerkomponente (Pointer Events, Tastaturbedienung mit Pfeiltasten,
      `role="separator"`), keine neue Abhängigkeit.
- [ ] Einbinden in `AssignmentStep` und `SummaryStep`, CSS-Variablen statt fester Spalten.
- [ ] Tests: Speichern, Zurücksetzen, Mindestgrößen.

## PR 5 – Status beim Neugenerieren

**Befund:** Es gibt einen Statuskasten oben auf der Seite und beim betroffenen TOP nur
den Text „Im laufenden Auftrag“. Der alte Text bleibt unverändert sichtbar.

**Entscheidungen:**

- Der alte Text wird beim Start durch einen Statusplatzhalter im TOP ersetzt.
  Die bisherige Fassung ist über „Bisherige Fassung anzeigen“ aufklappbar.
  Bei Erfolg wird sie ersetzt, bei Fehler oder Abbruch kehrt sie automatisch zurück,
  mit Fehlerhinweis.
- Jeder betroffene TOP hat einen eigenen Zustand im Platzhalter und als Abzeichen in der
  TOP-Liste: *Wartet (Platz n von m)* → *Läuft: Phase, seit x min* → *Fertig* /
  *Fehlgeschlagen (Grund)*. Der Statuskasten oben bleibt als Gesamtübersicht.
- Keine geschätzte Restdauer.

**Umsetzung:**

- [ ] Zustand pro TOP aus `summaryJob` ableiten (`top_ids`, `current_top_id`, `outcomes`,
      Phase, Startzeit).
- [ ] Platzhalter mit aufklappbarer bisheriger Fassung und Abzeichen in der TOP-Liste.
- [ ] Tests für alle Zustände, auch Abbruch und Fehler.

## PR 6 – Neue Einladung hochladen

**Befund:** „TOPs aus PDF neu extrahieren“ wertet nur die gespeicherte Einladung aus
(`POST /api/sessions/{id}/pdf-jobs`) und ist ohne gespeicherte PDF deaktiviert.
Die Übernahme erhält Zuordnungen nur bei exakt gleichem Titel.

**Entscheidungen:**

- „Einladung hochladen“ ist immer verfügbar, auch für Sitzungen ohne bisherige PDF.
- Die neue PDF ist zunächst nur ein Kandidat. Erst mit „TOP-Liste übernehmen“ wird sie
  zur gespeicherten Einladung (Quelle für Neu-Extrahieren, PDF-Belege und
  Export-Metadaten). Wird der Kandidat verworfen, bleibt die alte Einladung.
- Der Abgleich bei der Übernahme ignoriert führende Nummerierung, Groß-/Kleinschreibung,
  Leerzeichen und Präfixe wie „[Öffentlich]“.
- Vor der Übernahme zeigt eine Vorschau pro TOP „bleibt / neu / entfällt“ mit der Zahl
  der betroffenen Zeilen und Zusammenfassungen.
- Häkchen „Anschließend TOP-Zuordnung neu berechnen“, standardmäßig an.
- Die Übernahme ist über den Verlauf aus PR 2 rückgängig zu machen.

**Umsetzung:**

- [ ] Backend: Upload-Endpunkt am Sitzungs-PDF-Job (Datei optional). Kandidat getrennt
      von der gespeicherten Einladung ablegen und erst bei Übernahme umstellen.
- [ ] Abgleichsfunktion mit Normalisierung, eindeutige Zuordnung, Tests mit Umnummerierung
      und eingeschobenen TOPs.
- [ ] Vorschau-UI und Häkchen, Start der Neuberechnung nach Übernahme.
- [ ] Tests (Backend und Frontend).

---

## Nebenbefunde

- **Möglicher sporadischer Testfehler:** `tests/test_main.py::test_agenda_api_explicit_llm_policy`
  scheiterte am 2026-11-26 in einem Containerlauf einmalig mit einem SQLite-`OperationalError`
  in `persistence.py`. Bei der Wiederholung trat er nicht auf. Beobachten.
- **CI-Laufzeit:** Ein PR-Lauf dauert etwa 20–25 Minuten, fast nur wegen der Docker-Probe-Builds.
  Option für später: Probe-Builds bei PRs nur bei Änderungen an Dockerfiles bzw. Abhängigkeiten.
- **Veröffentlichung:** Images werden nur mit der Repository-Variable `PUBLISH_IMAGES=true`
  gepusht und deployt (seit PR #2).
