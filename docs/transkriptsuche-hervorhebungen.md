# Transkriptsuche und Hervorhebungen

## Suche im Transkript

Über dem Transkript der Zuordnungsseite und über dem Originaltranskript der
Protokollseite steht ein Suchfeld. Beide Seiten nutzen dieselbe Komponente.

- Die Suche ignoriert Groß-/Kleinschreibung und durchsucht Zeilentext und
  angezeigten Sprechernamen. Sie findet auch Wortteile.
- Alle Treffer sind gelb hinterlegt, der aktuelle Treffer kräftiger. Der Zähler
  zeigt die Position, z. B. „3 / 17“.
- Enter oder ▼ springt zum nächsten Treffer, Umschalt+Enter oder ▲ zum
  vorherigen. Nach dem letzten Treffer geht es beim ersten weiter.
- Esc leert die Suche. Das Transkript bleibt immer vollständig sichtbar.
- Strg+F bleibt die Suche des Browsers.

## Hervorhebungen (Begriffsliste)

Begriffe aus der Liste erscheinen in beiden Transkripten **fett**. In
Zusammenfassungen und im Export bleibt der Text unverändert.

Die Liste wird unter „Einstellungen“ → „Hervorhebungen“ gepflegt, ein Begriff
pro Zeile. Sie liegt zentral in der SQLite-Datenbank des Backends (Tabelle
`app_settings`, Schlüssel `highlight_terms`) und gilt für alle Arbeitsplätze.

| Eingabe | Trifft |
| --- | --- |
| `Rat` | nur das ganze Wort „Rat“ |
| `Rat*` | Wörter, die mit „Rat“ beginnen, z. B. „Ratsbeschluss“ |
| `*rat` | Wörter, die auf „rat“ enden, z. B. „Stadtrat“ |
| `*rat*` | Wörter, die „rat“ enthalten, z. B. „Beratung“ |
| `Erster Beigeordneter` | die Wortfolge, auch mit mehreren Leerzeichen oder Zeilenumbruch dazwischen |

Groß-/Kleinschreibung spielt keine Rolle. Umlaute und ß gelten als Buchstaben,
„Öl“ trifft also nicht in „Heizöl“. Bei Platzhaltern wird das ganze Wort
fett dargestellt.

Beim Speichern entfernt der Server Leerzeilen und doppelte Einträge (ohne
Rücksicht auf Groß-/Kleinschreibung). Erlaubt sind höchstens 200 Begriffe mit je
höchstens 100 Zeichen.

### Gleichzeitige Bearbeitung

Jede Speicherung erhöht eine Revisionsnummer. Hat ein anderer Arbeitsplatz die
Liste seit dem Öffnen geändert, erscheint die Warnung „Die Liste wurde
zwischenzeitlich geändert …“. Danach kann man die eigene Fassung trotzdem
speichern (der zuletzt Speichernde gewinnt) oder die aktuelle Liste laden.

### API

- `GET /api/settings/highlight-terms` liefert `{ "terms": [...], "revision": n }`.
- `PUT /api/settings/highlight-terms` mit `{ "terms": [...], "revision": n }`
  speichert die Liste. Passt `revision` nicht zum Server, antwortet er mit `409`
  und liefert in `detail` die aktuelle Liste samt Revision. Ungültige Eingaben
  ergeben `422`.
