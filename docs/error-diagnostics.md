# Technische Fehlerdetails im Frontend

In der Verarbeitungsanzeige, bei PDF-/TOP-Aufträgen und bei der selektiven
Protokollerstellung gibt es einen aufklappbaren Bereich **Technische Fehlerdetails**.
Er lädt den Bericht erst beim Öffnen. **Aktualisieren** lädt den aktuellen Stand;
**Fehlerbericht kopieren** kopiert den JSON-Bericht zur Analyse. Die Kopierfunktion
unterstützt auch LAN-Installationen über HTTP ohne Clipboard API.

Der Bericht enthält Job-ID und Status, FAST-/SLOW-Modus, Verarbeitungsschritt,
Modellkonfiguration, Code-Prüfsummen, aufgezeichnete Fehlermeldungen,
Ursachen-Kette und Stackframes mit Datei, Zeilennummer und Funktionsname.
HTTP-Fehler enthalten den Statuscode, sofern die Exception ihn bereitstellt.
Die normale Statusabfrage bleibt kompakt; Details stehen separat unter
`GET /api/model-jobs/{job_id}/error-details` bereit.

Bekannte Zugangsdaten aus der Backend-Umgebung, typische Schlüssel-/Tokenfelder,
Bearer-Header und Zugangsdaten oder Querywerte in URLs werden vor der Speicherung
und erneut beim Abruf maskiert. Lokale Variablen, Quellcodezeilen, vollständige
Requests und private Modellantwort-Artefakte werden nicht mit exportiert.
Die Originalfehlermeldung selbst kann Ausschnitte aus Sitzungsinhalten enthalten.

Die Verarbeitung und ihre Prüfungen bleiben unverändert. Auch intern abgefangene
Fehler der TOP-Zuordnung und Zusammenfassung werden aufgezeichnet. Diagnosefehler
ersetzen nicht die eigentliche Fehlerursache. Bestehende SQLite-Artefakte werden
verwendet; eine Datenbankmigration oder neue Environment-Einstellung ist nicht nötig.

## Grenzen und Aktualisierung

Backend **und** Frontend müssen mit dieser Änderung neu gebaut und aktualisiert
werden. Ausführliche Stacktraces entstehen für Fehler nach diesem Update.
Bei älteren Aufträgen werden vorhandene Diagnosecodes angezeigt; eine früher
verworfene Originalmeldung lässt sich nicht nachträglich rekonstruieren.

Der Abruf liefert die neuesten 20 Berichte. Je Bericht werden bis zu acht
verkettete Exceptions mit jeweils 40 Stackframes und 12.000 Zeichen Meldung
aufgenommen. Begrenzungen werden ausdrücklich mit `truncated` gekennzeichnet.
Der Bereich bleibt ein Fehlerbericht, kein allgemeiner Export sämtlicher
Backendlogs oder aller Modellantworten.

## Technische Lücken in der TOP-Zuordnung

Technisch nicht verarbeitete Zeilen werden zusätzlich oben im Zuordnungseditor
als rote Fehlermeldung angezeigt. Anzahl und erste Fehlerursache bleiben sichtbar,
auch wenn der übergeordnete Auftrag nur einen Prüfentwurf statt eines Abbruchs
meldet. Fachlich unzugeordnete Zeilen lösen diese technische Fehlermeldung nicht aus.
Veraltete Vorschläge und eine gerade laufende Neuberechnung werden dabei nicht
als aktueller Fehler angezeigt.

`invalid_source_response` bezeichnet eine ungültige Antwortstruktur im bisherigen
Quellenprotokoll (Ergebnis oder Quellenanforderung). Scheitert damit eine globale
Vorbereitungsphase, erhalten alle noch unverarbeiteten Zeilen denselben Fehlercode.
Die direkte FAST-Zuordnung mit vorhandener TOP-Liste verwendet diese Vorbereitungsphase
nicht. Bereits gespeicherte Fehler bleiben sichtbar, bis eine neue Zuordnung
berechnet wurde.
