# Gemeinsame Codebasis: Produktion und Service

Der Ressourcenfilter bietet pro KOST bzw. Team einen separaten Pfeil zum
Auf-/Zuklappen. Das aendert keine Checkbox-Auswahl und keine Timeline-Filterung.
Der Klappzustand bleibt innerhalb der geoeffneten Plantafel auch nach Nachladen
erhalten; nach einem Seitenneustart sind die Gruppen wieder aufgeklappt.

Stand: 13.11.2026. Beide Plantafeln sind ausschliesslich lesend.

## Gemeinsamer Core

| Baustein | Verantwortung |
| --- | --- |
| `Plantafel_Vis_850` | Lokal bereitgestellte vis-timeline 8.5.0, kein CDN. |
| `Plantafel_Core` | Factory `window.PlantafelCore(profile)`, Timeline, Datums-/Bereichsladen, Ressourcenbaum und Suchfeld, Sidebar, Tooltip mit verzoegerter Balkenverbreiterung, Validierung des gemeinsamen Datenvertrags und gemeinsames CSS. |
| Dashboard | Nur `event_page_loaded()` und `mount()` der jeweiligen Instanz. |

Der Core kennt keine Produktions- oder Servicetabellen. Er wird einmal in der
Datenbank gepflegt und von beiden Dashboards referenziert. Jede Factory-Instanz
hat eigenen Zustand. Die vorhandene CSS-Klasse `production-board` ist historisch
benannt, aber auch fuer Service das gemeinsame Layout.

**Fuehrender Bearbeitungsordner fuer Core und Vendor ist dieser
Produktionsordner.** Exporte im Serviceordner sind keine zweite Codebasis.
Besonders leere oder veraltete Core-Dateien aus Service niemals zuruecksynchronisieren:
gleiche Query-GUID bedeutet dieselbe Datenbankzeile fuer beide Dashboards.
Nach Core-Aenderungen beide Fachprofile pruefen. Kein separater Service-Fork.

## Getrennte Fachprofile und Datenquellen

| | Produktion | Service RSC |
| --- | --- | --- |
| Dashboard | `Plantafel_01` | `Plantafel_02` |
| Fachquery | `Plantafel_001` | `Plantafel_002` |
| JavaScript | `window.ProductionBoard` | `window.ServiceBoard` |
| SQL | WAUFTRAGPOS/WAUFTRAG, KOST/MAGR | RSCSERVICEEINSATZ/RSCSEPERSONAL, Team/Ressource |
| Fachschluessel | BAUFTRAG + POSITION + AG | Einsatzkopf-ID bzw. Personalzuordnungs-ID |
| Ressourcenbaum | KOST / MAGR | Team / Ressource |
| Fachlogik | Status 2/3, Simulationen, Fortschritt, WA/BA-Markierung und Nachladung | Eigene Einsatzstatus, optionale Anzeige abgerechneter Einsaetze, WV-Sonderfilter |

SQL, QV-Parameteroptionen, Profil-JavaScript, Detailfelder und Farbpalette bleiben
in der jeweiligen Fachquery. Keine Produktionsfelder oder Status-2/3-Annahmen in
Service kopieren. Produktionspfeile sind weiterhin schematisch
POSITION DESC / AG ASC, keine bestaetigten Terminierungsabhaengigkeiten.
Das Serviceprofil aktiviert keine Folgepfeile oder WA/BA-Steuerung.

## Gemeinsamer Datenvertrag

Eine QV-Abfrage liefert genau eine flache JSON-Zeilenliste mit `ROW_KIND`.
Ereignisse enthalten `EVENT_ID`, `RESOURCE_ID`, `TITLE`, `START_DATE`, `END_DATE`,
`RESOURCE_LABEL`, `COLOR_TOKEN` plus vom Profil definierte Fachfelder.
`empty` und `error` sind ausdrueckliche Ergebnisarten; Fehler nie als leere
Ergebnisliste verschleiern. Das Profil ordnet Ressourcen ueber
`parentId`, `parentLabel`, `code` und `order` ein.

QV-Parameter `von`/`bis` bleiben intern Start inklusive / Ende exklusiv;
die Oberflaeche zeigt das Enddatum inklusive. Normale Bereichsabfragen maximal
93 Tage, maximal 10.000 Ereignisse; TOP 10001 ermoeglicht die Ueberlaufmeldung.
NULL-Felder koennen im Query.aspx-JSON fehlen. Keine freien DB-Mandanten im Browser.

## Einbindung und Arbeitsweise

Pro Dashboard in dieser Reihenfolge als SCRIPTONLY einbinden:

1. `Plantafel_Vis_850`
2. dieselbe `Plantafel_Core` (GUID A1B3793C-0392-47FE-A85D-BBD77D7EB405)
3. jeweilige Fachquery `Plantafel_001` oder `Plantafel_002`

Danach startet der kleine Dashboard-Hook die jeweilige Instanz.
ERP-Sync pro Ordner/Dashboard betreiben, bevorzugt in getrennten VS-Code-Fenstern.
Bei Multi-Root waehlt Initialisieren/Laden im aktuellen Plugin den ersten Ordner;
Dateisynchronisierung verwendet dagegen den Ordner der gespeicherten Datei.
SQL-Optionen und Linkreihenfolge sind nicht allein durch Speichern der JS-Datei
konfiguriert. Den Produktionsinstaller nicht fuer das Servicedashboard verwenden.

## Stand und Grenzen

Produktion laeuft bereits mit dem Core. Service wurde lokal vorentworfen, nicht
deployt. Service liest Einsatzkoepfe und Personalzuordnungen als getrennte Balken
mit ihren jeweiligen Zeiten. Die Query verwendet den fuer Produktion bestaetigten
Mandantenkontext `COALESCE(MANDANT, N'') = N''`; Servicefreigabe und Rechteparitaet
zur bestehenden Fachplantafel sind vor Inbetriebnahme gesondert zu bestaetigen.

Noch nicht in Service enthalten: unzugewiesene Einsaetze, Fehlzeiten/Blocker,
leere Ressourcenzeilen, Kunden-/Adressdetails, Mehrfachfilter auf dem Server,
Abspruenge, Kapazitaeten und Schreibaktionen.
Die einfache Palette ist keine Uebernahme der fachlichen FARBCODE-Konfiguration.
Es ist noch ein lesbarer JavaScript-QV-Prototyp, kein TypeScript-/JSON-Definitionssystem.

Der Service-Lesetest hat ausserdem einen Bestandskopf mit Ende vor Beginn
gefunden. Der Core meldet diesen unveraendert als Datenfehler; vor Serviceabnahme
ist der betroffene Zeitraum fachlich zu klaeren (Details im Servicekonzept).

Details zum Serviceentwurf und zur Inbetriebnahme:
[Servicekonzept](../Plantafel%20Service%20RSC/Plantafel_Konzept.md).

Pruefung Produktion: `npm test` und `npm run check`.

## Aktiver KOST-/MAGR-Katalog im Produktionsfilter

`Plantafel_001` liefert neben Ereignissen auch `ROW_KIND=resource/team`:
alle KOST und zugehoerigen MAGR mit `AKTIV=1` im freigegebenen Mandanten.
Der Katalog ist unabhaengig von Zeitraum, Auftragsfilter, Belegung und `PLANEN`.
Aktuell sind das 15 KOST / 67 MAGR. Auch Kostenstellen ohne aktive MAGR werden
als Elternknoten unterstuetzt.

Das Produktionsprofil aktiviert dafuer `includeResourceCatalog`, nicht
`showEmptyResources`: der Filterbaum ist vollstaendig, die Zeitleiste behaelt
ihre belegten Zeilen. Die Ereignisauswahl (insbesondere Status 2/3 und PLANEN)
bleibt unveraendert. Auftragsnachladung erneuert den Katalog ebenfalls.
Stammdatenzeilen zaehlen nicht gegen das Limit von 10.000 Ereignissen.
Der gemeinsame Core unterstuetzt weiterhin die leeren Ressourcenzeilen des
Serviceprofils; Produktions- und Serviceverhalten bleiben getrennt konfiguriert.
