# Quickviews Funktionsweise (Dashboard + Query)

Diese Datei beschreibt die technische Funktionsweise der Quickviews in APplus als Verstaendnisgrundlage fuer eigene QV-Entwicklung (auch mit KI-Unterstuetzung).

Lesereihenfolge fuer neue Entwicklungen:

- Abschnitte 1 bis 9: Framework, Parameter, Query-Aufrufe und Darstellungsarten.
- Abschnitte 10 und 11: vorhandene Service-Muster fuer Lesen, Schreiben und DMS.
- Ab Abschnitt 12: projektuebergreifende Rezepte fuer Zusatzfelder, Tabellenersatz, Detailbaender und Dokumentoberflaechen.

Die Projekt-Rezepte beruhen auf einer statischen Sichtung der lokal exportierten Quickviews am 11.11.2026. Sie sind kein Nachweis fuer einen erfolgreichen Lauf gegen den aktuellen APplus-/D3-Server. Beobachteter Bestand und Empfehlungen fuer neue Implementierungen werden ausdruecklich unterschieden. Codebeispiele mit eigenen Funktionsnamen sind Rezeptcode, keine zusaetzlichen APplus-APIs.

## 1) Gesamtbild

Ein Dashboard besteht aus mehreren Elementen (pro Element genau eine QVQUERY), die als Tabelle oder Chart dargestellt werden koennen.

Die Daten werden nicht direkt auf der Dashboard-Seite abgefragt, sondern pro Element per HTTP gegen `Query.aspx` geladen.

Wichtige Bausteine:

- `Dashboard.aspx`: rendert Container, Metadaten und JS/CSS-Optionen fuer alle Elemente.
- `utils.ts`: steuert Frontend-Load, Auto-Refresh, XHR-Aufrufe und Rendering.
- `Query.aspx`: fuehrt SQL aus und liefert je nach `xhr` HTML, JSON, Compute-JSON, Chart-JSON, XML oder Export.
- `qvdashboard.asmx.cs` / `qvquery.asmx.cs`: lesen Dashboard- und Query-Definitionen aus den Tabellen.
- `DashboardUtil.cs`: Parameterlogik, SQL-Aufbau, Filter, Compute- und HTML/Chart-Hilfsfunktionen.

## 2) Wie werden QVs in der Dashboardsicht geladen?

Grundsaetzlich muss zwischen zwei Einbettungsarten unterschieden werden:

1. eigenstaendiges Dashboard
2. Einbettung ueber `navview` in eine Fachmaske

Diese Unterscheidung ist fuer Entwicklung und Fehlersuche zentral, weil sich URL, Parameterquellen, DOM-Umgebung und Lebenszyklus unterscheiden.

### 2.0 Eigenstaendiges Dashboard vs. navview-Einbettung

#### A) Eigenstaendiges Dashboard

Typischer Aufruf:

- `Quickviews/Dashboard.aspx?name=<dashboard>`

Merkmale:

- Das Dashboard ist die eigentliche Seite.
- `Dashboard.aspx` rendert den kompletten sichtbaren Inhalt des Browserfensters.
- Globale Parameter kommen primaer aus der Dashboard-URL.
- Der Container `#content` gehoert funktional voll zum Dashboard.
- Es gibt keine umgebende Fachmaske, die weitere fachliche Steuerelemente oder Kontextfelder um das Quickview herum bereitstellt.

Folgen fuer die Entwicklung:

- DOM und Parameterlage sind meist einfacher.
- Ein Austausch des sichtbaren Inhalts ist leichter kontrollierbar.
- Probleme entstehen hier eher aus Query- oder Renderlogik als aus der Einbettung selbst.

#### B) Einbettung ueber `navview`

Typischer Ablauf:

1. Eine Fachmaske wird geoeffnet, zum Beispiel ein Arbeitsgang oder Auftrag.
2. In dieser Fachmaske ist ein Bereich ueber `navview=<guid>` konfiguriert.
3. APplus laedt fuer diesen Bereich intern ein Quickview-Dashboard nach, typischerweise als Aufruf nach Muster:
   - `Quickviews/Dashboard.aspx?name=<dashboard>&guid=<element-guid>&param=id=<fach-id>&_inframe=1`
4. Das Quickview lebt damit in einem eingebetteten Kontext innerhalb der Fachmaske.

Merkmale:

- Die Fachseite und das Quickview sind technisch getrennte Kontexte.
- Das Quickview kann in einem Frame oder vergleichbar isolierten Bereich laufen.
- Die sichtbare Fachmaske ist nicht identisch mit dem Quickview-DOM.
- Die Dashboard-Parameter kommen oft verteilt aus mehreren Quellen.
- Der eigentliche Query-Kontext ist haeufig nicht komplett in `location.search` enthalten.

Folgen fuer die Entwicklung:

- Bei DOM-Analyse immer pruefen, ob man gerade die Fachseite oder den eingebetteten Quickview-Kontext betrachtet.
- Parameter muessen oft aus mehreren Quellen zusammengesetzt werden.
- Ein aggressives Leeren des Containers kann technische Quickview-Knoten zerstoeren, obwohl die Fachseite weiter sichtbar bleibt.
- Reloads und Re-Renders koennen vom Quickview-Framework spaeter erneut Standardinhalt einsetzen.

### 2.1 Serverseitig: Dashboard-Grundseite aufbauen

Beim Aufruf von `Dashboard.aspx?name=<dashboard>` passiert grob:

1. Dashboard-Metadaten werden per `qvdashboard.getDashboard(...)` geladen.
2. Dashboard-Elemente werden per `qvdashboard.getDashboardElements(...)` geladen.
3. Fuer jedes Element wird ein `div.dashboard-element` mit `data-*` Attributen erzeugt, z. B.:
   - `data-query`
   - `data-guid`
   - `data-contenttype` (`table`/`chart`)
   - `data-compute-expr`
   - `data-localparam`
4. Danach werden `utils.js` und Seitenskript eingebunden.

### 2.2 Clientseitig: Initialladung pro Element

In `utils.ts`:

1. `onPageLoaded()` sammelt alle `DIV.config-element` und erzeugt interne Definitionen (`global.elements`).
2. `FinishPageLoad()` ruft `ReloadQueries(null, false, null)` auf.
3. `ReloadQueries(...)` iteriert alle Elemente und startet pro Element `LoadSingleQuery(...)`.
4. `LoadSingleQuery(...)` startet je nach Element bis zu zwei Requests:
   - Compute-Request (`xhr=compute`) wenn Compute-Bereich vorhanden ist.
   - Content-Request:
     - `xhr=html` fuer Tabelle
     - `xhr=chart` fuer Chart
5. Responses werden in `handleComputeRequest`, `handleTableRequest`, `handleChartRequest` verarbeitet.

Wichtig: Dashboards laden also elementweise asynchron nach, nicht als ein grosser Sammelrequest.

### 2.3 Was ist bei `navview` zusaetzlich wichtig?

Bei `navview`-Einbettungen gelten zusaetzlich diese Praxisregeln:

#### Parameterquellen bewusst unterscheiden

Typische Quellen sind:

- globale URL-Parameter des Dashboard-Aufrufs
- `param=` auf Dashboard-Ebene, oft in `#global-data[data-param]`
- `data-localparam` am jeweiligen `div.dashboard-element`
- optional weitere fachliche Werte aus der umgebenden Maske, falls diese separat uebergeben werden

Praxisfolge:

- `location.search` allein reicht oft nicht.
- Der fachliche Kontext kann auf mehrere Orte verteilt sein, zum Beispiel `id` global und `tabelle` lokal pro Element.

#### Beobachteter Parameteraufbau bei `navview`

Bei einer Einbettung in eine Fachmaske kann der Dashboard-Aufruf zum Beispiel so aussehen:

```text
Quickviews/Dashboard.aspx?name=checkliste_01&guid=<element-guid>&param=id=10560&_inframe=1
```

Im Quickview liegen die Werte dann typischerweise verteilt vor:

- `location.search` enthaelt `param=id=10560`.
- Der aus `param` gelesene verschachtelte Parameter enthaelt `id: "10560"`.
- `#global-data[data-param]` kann den globalen Wert erneut enthalten, zum Beispiel als URL-kodierter String `id%3D10560`.
- Das Dashboard-Element kann in `data-localparam` den Tabellenkontext enthalten, zum Beispiel `tabelle%3Daplanpos`.

Die beiden letzten Faelle sind keine normalen Objekte wie `{ tabelle: "aplanpos" }`. Nach einer einfachen Aufteilung an `&` erscheinen sie sonst faelschlich als Schluessel:

```json
{ "tabelle=aplanpos": "" }
{ "id=10560": "" }
```

Deshalb muss ein Parameterwert vor der Verwendung mehrfach dekodiert und anschliessend erneut als eigener Query-String geparst werden. Erst danach liegen die Werte korrekt unter `tabelle` und `id` vor.

Beispiel fuer die normalisierte Zusammenfuehrung:

```json
{
   "tabelle": "aplanpos",
   "id": "10560"
}
```

Der Tabellenname darf dabei nicht aus einem festen Dashboard- oder Query-Namen abgeleitet werden. Wenn kein Tabellenname aus den uebergebenen Parametern ermittelt werden kann, muss die Anwendung den fehlenden Kontext melden. Als zusaetzliche dynamische Hinweise koennen `_APStateVar`, Query-Parameter mit Schluesseln wie `ARTIKEL.ARTIKEL` und der Referrer-Pfad wie `AplanposRec.aspx` ausgewertet werden.

#### DOM nicht mit der Fachseite verwechseln

Wichtig fuer Fehlersuche und Entwicklung:

- Die Fachmaske hat ihren eigenen DOM.
- Das Quickview hat seinen eigenen DOM und eigenen Ladezyklus.
- Wenn eine Anpassung im Quickview erfolgen soll, muss immer der Quickview-Container analysiert werden, nicht nur die Hauptseite.

#### Standard-Content nur selektiv ersetzen

In eingebetteten Dashboards gilt besonders:

- nicht `#content` komplett leeren
- technische Knoten wie `#global-data` und `#loading` erhalten
- nur die sichtbare Standardausgabe des Query-Elements entfernen oder ausblenden

Typische sichtbare Standardknoten sind:

- `.P2FORM`
- `.dashboard-block`
- `.dashboard-content`
- `table.viewquery-table`

Der Grund ist der weitere Lebenszyklus des Frameworks:

- `FinishPageLoad()`
- `ReloadQueries(...)`
- Auto-Refresh
- spaetere Nachladungen pro Dashboard-Element

Diese Pfade erwarten bestimmte technische Knoten weiterhin im DOM.

## 3) Wie werden Ergebnisdaten aus einer Query geladen?

Die URL wird in `getDataUrl(def, type, dashboard)` gebaut, z. B.:

- Tabelle: `Query.aspx?name=<QVQUERY>&xhr=html...`
- Chart: `Query.aspx?name=<QVQUERY>&xhr=chart...`
- Compute: `Query.aspx?name=<QVQUERY>&xhr=compute&computeexpr=...`
- Optional: `param`, `localparam`, `sort`, `filter`, `wildcard`, `lng`

Serverseitig in `Query.aspx`:

1. Query-Konfiguration laden (`qvquery.getQueryDashboardElements(name)`).
2. SQL aus `DashboardUtil.GetSqlStatement()` holen (inkl. `$P{...}` Ersetzung).
3. Danach weitere Platzhalter ersetzen:
   - `$SC{...}` via `ReplaceSysConf(...)`
   - `$O{...}` via `ReplaceOperation(...)`
   - `$S{...}` via `ReplaceSys(...)`
   - `$T{...}` via `ReplaceTranslate(...)`
4. SQL ausfuehren:
   - Standard: `WebUtils.getDataTable("QVQUERY", queryStatement)`
   - Optional direkt: `SqlDataAdapter` wenn `ANP_DIRECTSQL = 1`
5. Optional In-Memory-Cache ueber MD5(SQL) und `CacheDuration`.
6. Optional serverseitiges Filtern (`filter` / `wildcard`).
7. Ausgabeformat je nach `xhr`.

## 4) Koennen nur Computed Values geladen werden (z. B. Summe)?

Ja.

Fuer Compute-only wird `Query.aspx` mit `xhr=compute` aufgerufen.

In `DashboardUtil.AppendComputeDataAsJsonToStream(...)`:

- Wenn `computeexpr` leer ist, Default = `count(*)`.
- Mehrere Expressions sind moeglich, komma-separiert, z. B.:
  - `sum(BETRAG)`
  - `avg(MENGE)`
  - `count(*)`
- Berechnung erfolgt auf dem bereits geladenen `DataTable`:
  - `count(*)` wird ueber `Rows.Count` ermittelt
  - sonst `DataTable.Compute(expression, null)`
- Rueckgabe als JSON-Liste mit Feldern `expression`, `value`, `format`.

Damit kann ein Dashboard-Element rein als KPI/Compute verwendet werden, ohne Detailtabelle zu oeffnen.

## 5) Wie werden Parameter in der SQL-Abfrage ersetzt?

### 5.1 Query-Parameter `$P{...}`

Die Ersetzung passiert in `DashboardUtil.GetSqlStatement()`.

Quellen fuer Parameterwerte:

1. `localparam` (Element-Parameter aus `QVDASHBOARDQUERY.PARAMSTRING`)
2. `param` (globale URL-Parameter)
3. Standardwerte aus Query-Optionen XML (`<parameter><p ...>default</p></parameter>`)

Technisch wichtige Details:

- Werte kommen als URL-kodierter String (`a=1&b=xyz`).
- Parsing macht `AddParameterFromString(...)`.
- Bei gleichen Namen ueberschreibt der spaeter eingelesene Wert den vorherigen.
- `Escape=true` im XML-Parameter fuehrt bei SQL-Einsatz zu `value.Replace("'", "''")`.

Hinweis zur Prioritaet:

- Der aktuelle Code liest in `GetParameter()` zuerst `localparam`, danach `param`.
- Dadurch gewinnt bei Namenskonflikt globaler `param` gegenueber `localparam`.
- In UI-Hilfetexten wird teils eine andere Reihenfolge beschrieben; fuer Implementierung gilt der laufende Code.

Wichtig fuer die Clientseite: Die Prioritaet der APplus-Query-Ersetzung ist von der eigenen Kontextaufloesung zu unterscheiden. Fuer die Ermittlung eines fachlichen Datensatzes sollte der Client die Quellen getrennt protokollieren und normalisieren:

1. direkte Dashboard-Parameter aus `location.search`
2. verschachtelte Werte aus `param`
3. lokale Werte aus `data-localparam`
4. globale Werte aus `#global-data[data-param]`
5. dynamische Erkennung aus `_APStateVar` oder Seitenpfad, falls die Tabelle nicht direkt uebergeben wurde

Ein vorhandener Wert muss dabei Vorrang haben; ein statischer Tabellen-Fallback ist in eingebetteten Dashboards riskant, weil derselbe Code in unterschiedlichen Fachmasken und Tabellen verwendet werden kann.

### 5.2 Weitere Platzhalter im SQL

Neben `$P{...}` werden in `Query.aspx` weitere Platzhalter verarbeitet:

- `$S{...}`: Systemwerte (z. B. aktueller User, Sprache, Query-Name, Mandant)
- `$SC{section,key}`: Sysconf-Werte
- `$O{operation}`: Berechtigung als `1`/`0`
- `$T{text}`: Uebersetzungstext

Optional kann mit `:e` SQL-Escaping fuer einzelne Werte aktiviert werden (je nach Platzhalterfunktion).

## 6) Praktische Checkliste fuer eigene QV-Entwicklung

1. SQL in QVQUERY so schreiben, dass `$P{...}` sauber ersetzt werden kann.
2. Parameter sauber in Query-Optionen definieren (`name`, optional `title`, optional `escape=true`).
3. Fuer KPI-Elemente `COMPUTEEXPRESSION` setzen und ggf. `HIDECOMPUTE`/`HIDECOMPUTEZERO` nutzen.
4. Bei Dashboard-Elementen lokale Vorbelegung ueber `PARAMSTRING` pflegen.
5. Bei Konflikten mit globalen Parametern die tatsaechliche Prioritaet im Code beachten.
6. Bei Performance `CacheDuration`, schlanke SQLs und ggf. `ANP_DIRECTSQL` bewusst einsetzen.
7. Fuer Charts die Chart-Definition in den Query-Optionen pflegen (siehe Abschnitt 8).
8. Zu Beginn immer klaeren, ob das Quickview eigenstaendig oder ueber `navview` eingebettet laeuft.
9. In `navview`-Szenarien Parameter nie nur aus der URL lesen, sondern auch `#global-data[data-param]` und `data-localparam` pruefen.
10. Standard-Content nur selektiv ersetzen; technische Framework-Knoten muessen erhalten bleiben.
11. Bei UI-Umbauten immer mit asynchronen Nachrendern durch `ReloadQueries(...)` rechnen.
12. Tests nicht nur im isolierten Quickview, sondern auch in der echten Fachmaske durchfuehren.

## 7) Einsatzfall: Mitarbeiterindividuelles Dashboard

Dein Ziel (Mitarbeiter stellt sein Dashboard selbst zusammen) passt sehr gut zur bestehenden Architektur.

Wichtigster Punkt: Daten muessen nicht neu entwickelt werden, sondern koennen direkt aus vorhandenen QVQUERY-Definitionen abgegriffen werden.

### 7.1 Empfehlung fuer das Datenmodell (Custom-Tabelle)

Die Positionierung und Auswahl kann in einer separaten Custom-Tabelle liegen, z. B.:

- Eine Kopf-Tabelle pro Mitarbeiterdashboard (User, Titel, globale Einstellungen)
- Eine Element-Tabelle pro Kachel mit Feldern wie:
   - Query-Name (`QVQUERY`)
   - Anzeigeart (`compute`, `chart`, `table`)
   - Position/Dimension (Zeile, Spalte, Breite, Hoehe)
   - `COMPUTEEXPRESSION` (fuer KPI)
   - lokale Parameter (`localparam`-String)
   - optionale Filter / Sortierung

### 7.2 Wie werden bestehende Queries technisch genutzt?

Pro Element baust du denselben Request-Mechanismus wie im Standard-Dashboard:

- KPI/Summe: `Query.aspx?name=<QVQUERY>&xhr=compute&computeexpr=<expr>`
- Kleine Tabelle: `Query.aspx?name=<QVQUERY>&xhr=html`
- Diagramm: `Query.aspx?name=<QVQUERY>&xhr=chart`

Optional je Element:

- `param=` fuer globale Dashboard-Parameter
- `localparam=` fuer elementbezogene Vorbelegung
- `filter=` / `wildcard=1` fuer eingeschraenkte Sicht

Damit kannst du fuer jeden Mitarbeiter beliebige vorhandene Queries unterschiedlich darstellen, ohne Query-Logik zu duplizieren.

### 7.3 Prioritaet bei Parametern im Mitarbeiterdashboard

Im laufenden Code gilt bei gleichem Parameternamen:

1. zuerst `localparam`
2. danach `param` (ueberschreibt vorhandene Werte)
3. danach Defaultwerte aus Query-Optionen

Fuer personalisierte Dashboards ist das wichtig, falls globale und elementlokale Werte denselben Namen verwenden.

## 8) Erstellung von Diagrammen (Chart) - geprueft

Pruefung: In der bisherigen MD war Chart-Laden beschrieben (`xhr=chart`), aber die eigentliche Chart-Erstellung war noch nicht detailliert genug.

Ergaenzung:

Diagramme werden serverseitig in `DashboardUtil.AppendFlotDataAsJsonToStream(...)` aus der Query-Options-XML erzeugt.

Die Chart-Konfiguration liegt in den Optionen der Query (`QVQUERY.OPTIONS`) unter `<chart>`.

Wichtige Tags:

- `<type>`: `lines`, `bars`, `pie`, `gauge`, `points`
- `<xaxis>`: Pflicht fuer `lines`, `bars`, `points`
- `<group label="...">...</group>`: Gruppierung / Legende
- `<measure>`: explizite Measure-Spalte; ohne Angabe werden Decimal-Spalten verwendet
- `<ticksize>`, `<barwidth>`, `<fill>`, `<stack>`, `<pielabel>`

Beispiel:

```xml
<option>
   <chart>
      <type>bars</type>
      <xaxis>DATUM</xaxis>
      <group label="BEZEICHNUNG">KATEGORIE</group>
      <measure>BETRAG</measure>
      <ticksize>day</ticksize>
      <stack>false</stack>
      <fill>0.6</fill>
   </chart>
</option>
```

Ergebnisfluss fuer Charts:

1. Frontend ruft `Query.aspx?...&xhr=chart` auf.
2. `Query.aspx` laedt SQL-Ergebnis als `DataTable`.
3. `AppendFlotDataAsJsonToStream(...)` baut Flot-Daten + Optionen als JSON.
4. `utils.ts` rendert den Chart via Flot im Element.

### 8.1 Matrix: Query vs. Dashboardelement bei Charts

| Thema | In der Query (QVQUERY / OPTIONS) | Im Dashboardelement (QVDASHBOARDQUERY) |
|---|---|---|
| Datenbasis | SQL-Statement liefert die Rohdaten | keine eigene SQL-Definition |
| Charttyp | `<chart><type>...</type></chart>` | kann indirekt ueber `FORCEDISPLAYTABLE` von Chart auf Tabelle umschalten |
| X-Achse / Measure / Grouping | `<xaxis>`, `<measure>`, `<group>` | keine eigene fachliche Definition |
| Serverseitige Chartberechnung | erfolgt in `AppendFlotDataAsJsonToStream(...)` | keine serverseitige Aggregationslogik |
| Elementbezogene Optik/Verhalten | nur allgemeine Chart-Basis aus Query | `CHARTOPTIONS` (JSON-Merge), `JSCHARTSCRIPT`, Hoehe/Breite, Titel, AutoOpen |
| Wiederverwendung | eine Query kann in vielen Kacheln genutzt werden | dieselbe Query kann je Kachel anders aussehen |

Praxisregel:

- Query definiert Was dargestellt wird (Daten + Grundchart).
- Dashboardelement definiert Wie es in dieser Kachel dargestellt wird (Layout + Feintuning).

Beispiel fuer euer Mitarbeiterdashboard:

- Query `UmsatzMonat` liefert Monatswerte mit Chart-Definition (z. B. Bars).
- Mitarbeiter A nutzt sie als grosse Kachel mit eigener Farbe/Options.
- Mitarbeiter B nutzt dieselbe Query als kleine Kachel mit anderem `CHARTOPTIONS`-JSON und anderem lokalen Parameter.

### 8.2 Matrix: KPI-Kachel (Compute) vs. Mini-Tabelle

| Thema | KPI-Kachel (Compute) | Mini-Tabelle |
|---|---|---|
| Request-Typ | `xhr=compute` | `xhr=html` |
| Zweck | verdichteter Einzelwert (z. B. Summe, Count, Durchschnitt) | detaillierte Zeilenansicht |
| Datenmenge im UI | sehr klein (JSON mit expression/value/format) | groesser (HTML-Tabelle mit Zeilen und Spalten) |
| Ausdruck in QVDASHBOARDQUERY | `COMPUTEEXPRESSION`, optional `COMPUTEUNIT`, `HIDECOMPUTE`, `HIDECOMPUTEZERO` | Anzeige als Tabelle ueber Elementtyp (kein Chart) |
| Typische Kennzahlen | `count(*)`, `sum(BETRAG)`, `avg(MENGE)` | komplette Listen, z. B. offene Vorgaenge |
| Filter/Sortierung | fachlich ueber Query/Parameter; kein Tabellensortier-UI | Sortierung/Filter auch interaktiv im Tabellenkopf bzw. Filterzeile |
| Performance | meist leichter im Frontend | kann bei vielen Zeilen schwerer werden |

Praxisregel fuer Mitarbeiterdashboards:

- KPI-Kachel fuer schnelle Orientierung (Top-Kennzahlen).
- Mini-Tabelle fuer operative Nachverfolgung (Details zum KPI).
- Bei Bedarf beide auf dieselbe Query setzen: eine Kachel als `compute`, eine als `html` mit passendem Filter.

## 9) Wichtige Dateien

- `Quickviews/Dashboard.aspx`
- `Quickviews/utils.ts`
- `Quickviews/Query.aspx`
- `Quickviews/DashboardUtil.cs`
- `Quickviews/qvdashboard.asmx.cs`
- `Quickviews/qvquery.asmx.cs`
- `Quickviews/Scripts/QvDashboardQueryRec.ts`

## 10) Praxisrezepte aus dem WSS-Projekt (ohne Formio)

Die folgenden Rezepte sind direkt aus dem Projektordner `erp-dashboard/wss_001` abgeleitet.

Wichtig:

- In den WSS-Skripten wird fuer Backend-Aufrufe durchgaengig `app.soap.call(...)` verwendet.
- Ein produktiv genutztes Muster mit `app.service...` wurde in diesem Ordner nicht gefunden (ausser Formio-Bibliothekscode, der hier bewusst ignoriert wird).
- Fuer neue WSS-Funktionen solltest du dich deshalb am bestehenden `app.soap.call(...)`-Stil orientieren.

### 10.1 Daten lesen per Query.aspx (JSON)

Wenn eine bestehende QVQUERY genutzt werden soll, verwende den Query-Helper (`extQueryUtils`):

```js
const data = await extQueryUtils.callWithQueryDataAsync("WSS_002", {
   bauftrag: "B-12345",
   position: "10"
});
```

Technik dahinter:

- URL-Bau auf `Query.aspx?name=<QUERY>&xhr=json...`
- `param` wird per `Tools.getUrlStringFromObject(...)` aufgebaut
- Response wird als JSON geparst

Einsatzfall:

- Standard fuer Read-Model-Daten in QV-Widgets, Tabellen und Baumdarstellungen

### 10.2 Direkter DB-Read per SOAP (freies SELECT)

Wenn keine passende QVQUERY existiert oder sehr gezielte Abfragen gebraucht werden, wird im WSS-Projekt `dbFetchJSON` genutzt:

```js
async function getObject(selectSql) {
   const response = await app.soap.call("flexmobility/customutils").dbFetchJSON(selectSql);
   return JSON.parse(response);
}

const rows = await getObject("select UGRUND, Name from UGRUND where UKAT='K' and WSSTERMINAL=1");
```

Typische Nutzung im Projekt:

- Lookup-Daten (z. B. Gruende)
- Nachladen einzelner Datensaetze nach Insert
- Hilfsabfragen fuer UI-Entscheidungen

### 10.3 Webservice-Aufrufe (WSS-Muster)

Beispiele fuer fachliche Services im Projekt:

```js
await app.soap.call("time/bdelog").processMessageInterActive(paramsXml);
const ret = app.soap.call("wp/aufstueli").addPositionAndQuantity(aufstueli, "ARTIKEL", artikel, menge, struktur);
const sn = app.soap.call("Custom/Anp_Masterdata").nextSerienNumber(artikelnummer);
```

Praxisregel:

- Fachlogik (Buchen, Position anlegen, Nummernkreis) ueber dedizierte Services aufrufen
- Nur dort direkt auf `dbInsert`/`dbUpdate` gehen, wo wirklich Datenpflege auf Tabellenebene benoetigt ist

### 10.4 D3-Dokumente laden (DMS-Schnittstelle)

Im WSS-Dashboard wird je Tabelle/ID eine Dateiliste geladen:

```js
const response = await app.soap.call("flexmobility/utils").getFileListAsXml("wauftragpos", wauftragposid);
const data = JSON.parse(response);
```

Aufbereitungsmuster:

1. Liste mit Suchkontexten bauen (z. B. `snk`, `wauftrag`, `aufstueli`, `aufstuelipos`, `bauftrag`)
2. Fuer jeden Kontext `getFileListAsXml(tabelle, id)` aufrufen
3. Ergebnis in Objektstruktur mappen (`Key`/`Value`)
4. Ordner (`Dateityp === "FOL"`) ausfiltern
5. Dokumentlink ueber Proxy aufbauen:

```text
../flexmobility/customutils.asmx/ProxyDocument?url=<encoded>
```

Hinweis:

- Der Proxy-Link wird im Projekt mit einem D3-Basispfad kombiniert und fuer den Browser URL-encodiert.
- Der globale D3-Basispfad ist im WSS-Dashboard als `global_D3Pfad` gesetzt auf `https://systec-vs72.systec-lab.local/`.
- Bei `ProxyDocument` muss dieser Basispfad vor den D3-Dokumentpfad, dann erst komplett URL-encodiert in den `url`-Parameter.

Beispielmuster:

```js
const href = "../flexmobility/customutils.asmx/ProxyDocument?url=" + encodeURIComponent(global_D3Pfad + doc._path);
```

### 10.4.1 Struktur von getFileListAsXml (nach JSON.parse)

Wichtig fuer die Weiterverarbeitung: Die Response ist nach dem Parse nicht direkt ein Objekt pro Datei, sondern zunaechst eine Liste von `Key`/`Value`-Eintraegen je Datei.

Typische Rohstruktur pro Datei:

```json
[
   { "Key": "Name", "Value": "A-001983_Angebot.PDF" },
   { "Key": "Datum", "Value": "06.11.2024 16:27:22" },
   { "Key": "Dokumenttyp", "Value": "Schriftverkehr" },
   { "Key": "Dateityp", "Value": "PDF" },
   { "Key": "Dateitypicon", "Value": "../Style/Icons/PDF.gif" },
   { "Key": "_path", "Value": "/dms/.../c" },
   { "Key": "_pathWithoutServer", "Value": "/dms/.../c" }
]
```

Deshalb wird im WSS-Code pro Datei in ein normales Objekt umgebaut:

```js
const data = JSON.parse(response);
const dokumente = data.map(dateiArray => {
   const obj = {};
   dateiArray.forEach(attr => {
      obj[attr.Key] = attr.Value;
   });
   return obj;
});
```

Danach liegen die Felder typischerweise so vor:

- `doc.Name`: Dateiname
- `doc.Datum`: Anzeige-/Ablagedatum
- `doc.Dokumenttyp`: fachlicher Dokumenttyp (z. B. Schriftverkehr)
- `doc.Dateityp`: Dateiendung/Klasse (z. B. PDF, DOCX, FOL)
- `doc.Dateitypicon`: Icon-Pfad
- `doc._path`: D3-Objektpfad fuer `ProxyDocument`
- `doc._pathWithoutServer`: alternativer Pfadwert

Wichtige Merkmale fuer die Praxis:

1. Ordnerobjekte werden ueber `doc.Dateityp === "FOL"` erkannt und oft ausgefiltert.
2. Fuer den Download/Viewer-Link ist `doc._path` das zentrale Feld.
3. `doc.Dokumenttyp` eignet sich fuer Gruppierung im Dokumentbaum.
4. Nicht davon ausgehen, dass jedes Feld immer gesetzt ist; defensiv auf `undefined` pruefen.

### 10.5 D3-Dokumente hochladen (Upload-Rezept)

Im WSS-Dashboard ist auch ein Upload auf die DMS-Schnittstelle umgesetzt (Drag&Drop + Upload-Button).

Technischer Ziel-Endpoint:

```text
../dms/DMSUploadTarget.aspx
```

Kernmuster aus dem Projekt:

```js
const formData = new FormData();
formData.append("filename", filename);
formData.append("Description", description);
formData.append("DocumentType", doctype);
formData.append("FileChooser", fileObject);
formData.append("NavTable", "WAUFTRAGPOS");
formData.append("Id", wauftragposid);

const response = await fetch("../dms/DMSUploadTarget.aspx", {
   method: "POST",
   body: formData
});

if (!response.ok) {
   throw new Error("Upload fehlgeschlagen: " + response.statusText);
}
```

Wichtige Upload-Parameter:

- `NavTable`: Zieltabelle im DMS-Kontext (im WSS-Fall `WAUFTRAGPOS`)
- `Id`: Datensatz-ID der Zieltabelle
- `DocumentType`: Dokumenttyp fuer D3-Klassifikation
- `Description`: Freitextbeschreibung
- `FileChooser`: Dateiinhalt

Praxisablauf:

1. Datei(en) lokal sammeln (Dropzone oder Dateiwaehler)
2. Pro Datei Upload ausfuehren
3. Bei Erfolg Dateieintrag aus Uploadliste entfernen
4. Danach D3-Liste neu laden (`wauftragposD3Dokumenteladen(...)`), damit der neue Stand sofort sichtbar ist

## 11) DB-Write Basics: Insert, Update, Sicherheit und Reihenfolge

### 11.1 Allgemeines Insert-Rezept (dbInsert)

Projektmuster (z. B. `snk`, `snkref`, `LAGERUMBUCHUNGSLISTE`):

```js
const xml = "<artikel>...</artikel><menge>...</menge>";
const newId = await app.soap.call("webobjects/navbar").dbInsert("LAGERUMBUCHUNGSLISTE", "<row>" + xml + "</row>");
```

Empfohlener Ablauf:

1. Pflichtfelder im UI validieren (z. B. Artikel, Menge > 0)
2. XML sauber escapen (mindestens `& < > ' "`)
3. Insert ausfuehren
4. Falls notwendig, neuen Datensatz per SELECT nachladen (z. B. ID/GUID/Position)
5. UI gezielt refreshen (nicht blind komplette Seite)

### 11.2 Allgemeines Update-Rezept (dbUpdate)

Im Projekt wird fuer konkurrierende Updates ein Timestamp mitgegeben:

```js
const ts = app.soap.call("masterdata/artikel").getDBValue("timestamp", "wauftragpos", "id", wauftragposid);
await app.soap.call("webobjects/navbar").dbUpdate(
   "wauftragpos",
   "<row><id>" + wauftragposid + "</id><timestamp>" + ts + "</timestamp><PEZ_BEMERKUNG>...</PEZ_BEMERKUNG></row>"
);
```

Empfohlener Ablauf:

1. Zielsatz per ID bestimmen
2. Aktuellen Timestamp lesen
3. XML mit `id`, `timestamp` und den zu aendernden Feldern bauen
4. Update ausfuehren
5. Bei Fehlern sauber reagieren (User-Hinweis, ggf. Reload)

Warum Timestamp wichtig ist:

- Er wirkt als Optimistic-Locking-Schutz gegen verlorene Updates bei paralleler Bearbeitung.

#### 11.2.1 Timestamp-Umrechnung fuer dbUpdate (Hex-Format)

Im WSS-Projekt gibt es zusaetzlich das Muster, den SQL-Timestamp explizit als Hex zu lesen und vor dem Update zu normalisieren.

Wichtige SQL-Formulierung im SELECT:

```sql
master.dbo.fn_varbintohexstr([timestamp]) as timestamp_hex
```

Praxisbedeutung:

- `timestamp_hex` kommt als String zurueck (typisch mit Praefix `0x`)
- vor `dbUpdate(...)` den Wert aufbereiten, z. B. `replace(/^0x/i, "")`
- den bereinigten Wert im `<timestamp>`-Feld der XML-Row verwenden

Beispiel (inkl. `0x`-Entfernung):

```js
const sql = "select top 1 id, master.dbo.fn_varbintohexstr([timestamp]) as timestamp_hex from wauftragpos where ...";
const response = await app.soap.call("flexmobility/customutils").dbFetchJSON(sql);
const rows = JSON.parse(response) || [];

const id = String(rows[0].id || "").trim();
const timestampHex = String(rows[0].timestamp_hex || "").trim().replace(/^0x/i, "");

await app.soap.call("webobjects/navbar").dbUpdate(
   "wauftragpos",
   "<row><id>" + id + "</id><timestamp>" + timestampHex + "</timestamp><astatus>5</astatus></row>"
);
```

Wann dieses Muster sinnvoll ist:

- Wenn du den zu aktualisierenden Satz vorher ohnehin per SQL selektierst
- Wenn du den Timestamp nicht ueber `getDBValue(...)`, sondern direkt aus demselben Select mitnehmen willst

Faustregel:

- Beide Varianten sind im Projekt vorhanden und gueltig:
   - `getDBValue("timestamp", ...)`
   - `fn_varbintohexstr([timestamp])` + Entfernen von `0x`

### 11.3 Kombinierter Ablauf: Insert -> Read -> Update

Ein haeufiges WSS-Muster:

1. Datensatz anlegen (`dbInsert` oder Fachservice, z. B. `addPositionAndQuantity`)
2. Rueckgabewert/ID pruefen
3. Ergaenzende Daten per `dbFetchJSON` lesen (z. B. neue Position)
4. Folgeupdate mit Timestamp schreiben (z. B. `agbedarf` setzen)

Dieses Muster ist robust, wenn ein einzelner API-Call nicht alle benoetigten Felder direkt setzt.

### 11.4 SQL/Injection-Basics im Frontend-Code

Im WSS-Code gibt es Hilfsfunktionen wie `escapeSqlLikeValue(...)`, um dynamische Werte fuer SQL-Strings zu entschaerfen.

Praxisregeln:

1. User-Eingaben nie ungefiltert in SQL-Strings einsetzen
2. Fuer XML-Payloads immer XML-escaping nutzen
3. Zahlen fuer SQL in konsistentes Dezimalformat bringen (Projektmuster: eigene `toSqlDecimal(...)`-Helfer)
4. Bei Suchbegriffen fuer `LIKE` zusaetzlich `%`/`_`-Semantik beachten

### 11.5 Fehlerbehandlung und Timeouts

Fuer Query-Loads (`callWithQueryDataAsync`) existiert im Projekt ein Timeout-Schutz mit Nutzerfeedback (z. B. Hinweis auf SQL Timeout bei grossen Stuecklisten).

Empfehlung fuer neue Funktionen:

1. Netzwerk-/SOAP-Aufrufe in `try/catch`
2. Fehlertext fuer User verstaendlich machen
3. Speziell auf Timeout-Indikatoren pruefen (`timeout`, `Execution Timeout Expired`)
4. UI-Loader in jedem Fehlerpfad wieder zuruecksetzen

## 12) Vor dem Implementieren: Darstellungsstrategie festlegen

Nicht jede individuelle Quickview-Oberflaeche ersetzt die Standardtabelle. Im Bestand gibt es unterschiedliche Strategien:

| Strategie | Beobachtetes Beispiel | Geeignet fuer |
|---|---|---|
| Standardtabelle beibehalten und erweitern | WSS: zusaetzliche `tr.WSS-Detail` unter einer Ergebniszeile | operative Listen mit Detailband, Dokumenten, Stueckliste oder Checkliste |
| Quelltabelle gezielt ausblenden, eigene Oberflaeche daneben einsetzen | D3-Navview: Tabelle verstecken und `.d3-shell` danach einfuegen | Dokumentliste mit Vorschau und Upload |
| SQL-/Kontextdaten als Ausgangspunkt fuer eigene Darstellung verwenden | Inventur und Sonder-AGZeit | spezialisierte Eingabemasken und Visualisierungen |

Entscheidungsregel fuer KI-Auftraege:

1. Zuerst Einbettung klaeren: eigenstaendig oder `navview`.
2. Danach entscheiden: Standardspalten erweitern, einzelne Detailbaender ergaenzen oder die sichtbare Tabelle vollstaendig ersetzen.
3. Die verantwortliche Query und das Dashboardelement bestimmen. Nicht vom Dashboardnamen auf den Querynamen oder die Fachtabelle schliessen.
4. Festlegen, woher ID, Tabellenname und weitere Schluessel stammen: Query-Zeilenattribute, globale/lokale Parameter oder eigener JSON-Request.
5. Den Render-Einstieg nach jeder Query-Nachladung ausfuehren; die Initialisierung muss wiederholbar sein.
6. Nur den eigenen sichtbaren Bereich veraendern. `#global-data`, `#loading` und technische Framework-Knoten erhalten.

Wichtige Unterscheidung: Die SQL-Query liefert Daten und gegebenenfalls HTML-Spalten. Das projektspezifische JavaScript entscheidet ueber Detailzeilen, Ersatzoberflaeche, Ereignisse und Nachladen. CSS allein kann Inhalte verstecken, ersetzt aber weder Initialisierung noch Datenbeschaffung.

## 13) Rezept: Zusatzfelder anzeigen

### 13.1 Selektionsfelder und Filter oberhalb der Tabelle

Im WSS-Dashboard erzeugt `event_page_loaded(isSingleTableView)` die Selektion. Voraussetzung ist die Queryressource `apqv-ext-menusel`, die `extMenuSel` bereitstellt. Gekuerztes WSS-Muster:

```js
function event_page_loaded(isSingleTableView) {
   const selection = extMenuSel.create();
   selection.createInput("ausweis", {
      label: "Ausweis", reloadonchange: false
   });
   selection.createInput("kost", {
      label: "Kapaz.",
      pickurl: "../masterdata/KostTab.aspx?pickCol=Kost&KOST.AKTIV=1",
      reloadonchange: true
   });
   selection.createInput("magr", {
      label: "MaGr.",
      pickurl: "../masterdata/MagrTab.aspx?pickCol=Magr&MAGR.AKTIV=1",
      reloadonchange: true, ref: "kost"
   });
   selection.createInput("teamanzeigen", {
      label: "gesamtes Team anzeigen", type: "boolean", reloadonchange: true
   });
   selection.createReloadButton();
   selection.complete();
}
```

Die lokale Bibliothek bietet unter anderem:

| Option/API | Wirkung |
|---|---|
| `createInput(name, options)` | Eingabefeld mit internem `data-name` |
| `type: "boolean"` | Checkbox |
| `type: "number"` | numerische Tastatureingabe; keine vollstaendige fachliche Validierung |
| `pickurl` | Picklist-Icon mit Zielmaske und `pickCol` |
| `ref` | lokale CUSTOM-Erweiterung fuer abhaengige Picklisten |
| `reloadonchange` | automatische Query-Nachladung bei Aenderung |
| `defaultvalue`, `width`, `span` | Vorbelegung, Breite, Von-/Bis-Eingabe |
| `createButton(name, options)` | zusaetzliche Aktion; WSS verwendet `onclick` |
| `createReloadButton()`, `complete()` | Aktualisieren-Aktion und Abschluss des Aufbaus |

Damit ein Filter wirkt, muss die SQL-Query denselben Parameternamen verwenden, beispielsweise `$P{kost}`. Das Erzeugen eines Felds allein aendert keine WHERE-Bedingung. Parameterdefinitionen und Defaults in APplus mitpflegen; Escaping und Prioritaet aus Abschnitt 5 beachten. Ein Selektionsfeld speichert kein Datenbankfeld.

### 13.2 Ergebnisfelder und technische Zeilenwerte

WSS selektiert sichtbare Spalten und technische Werte gemeinsam. Reduzierter SQL-Ausschnitt, ohne die fachlichen Filter der vollstaendigen Query:

```sql
SELECT
   WAUFTRAGPOS.BAUFTRAG AS _bauftrag,
   WAUFTRAGPOS.POSITION AS _position,
   WAUFTRAGPOS.ID AS _wauftragposid,
   WAUFTRAGPOS.AG,
   WAUFTRAG.NAME
FROM WAUFTRAGPOS
JOIN WAUFTRAG
   ON WAUFTRAG.BAUFTRAG = WAUFTRAGPOS.BAUFTRAG
  AND WAUFTRAG.POSITION = WAUFTRAGPOS.POSITION
```

Der WSS-Client liest diese technischen Werte als Zeilenattribute ohne fuehrenden Unterstrich:

```js
const id = row.getAttribute("data-wauftragposid");
const bauftrag = row.getAttribute("data-bauftrag");
const position = row.getAttribute("data-position");
```

Das belegt den SQL-/Clientvertrag dieses Projekts. Die allgemeine serverseitige Renderimplementierung liegt nicht in diesen Exportordnern. Deshalb bei neuen Aliasnamen das tatsaechlich gerenderte HTML pruefen und nicht ungeprueft fuer jede APplus-Version dieselbe automatische Attribut-/Ausblendlogik voraussetzen. D3_004 liest beispielsweise auch normale Ergebnisnamen wie `id`, `tabelle` und `d3metadata` aus `data-*`.

Rezept fuer ein weiteres Feld:

1. Feld in der verantwortlichen SQL-Query selektieren und eindeutigen Alias vergeben.
2. Entscheiden: sichtbare Standardspalte, technischer Zeilenwert oder Feld einer eigenen JSON-Darstellung.
3. Nach `event_table_loaded` im betroffenen Container pruefen, ob der Wert in einer Zelle, einem Zeilenattribut oder beiden ankommt.
4. Bei Standardspalten `th[data-column]` auswerten, statt feste Zellnummern zu hinterlegen.
5. In eigenen Views Werte mit `textContent` ausgeben. Nullwerte und `0` unterscheiden; `value || ""` wuerde auch die Zahl Null verwerfen.

Inventur `readPlaceTable(output)` liest Spalten anhand von `data-column`, ersatzweise der Ueberschrift. Sonder-AGZeit erkennt Quelltabellen anhand der Spalten `payload` und `dbaufruf`. Stabile Aliasse sind robuster als uebersetzte sichtbare Titel oder feste Spaltenindizes.

### 13.3 Eigene Anzeige- und Eingabefelder

WSS zeigt im Detailband unter anderem Bemerkungs-/Chatfelder, Checkliste und Stuecklisteninformationen. D3 zeigt Beschreibung, Sprache, Revision und Groesse. Das sind normale DOM-Elemente im eigenen Container. Minimales Rezept fuer eine reine Anzeige:

```js
function appendDisplayField(host, label, value) {
   const field = document.createElement("div");
   const title = document.createElement("strong");
   const content = document.createElement("span");
   title.textContent = label + ": ";
   content.textContent = value == null ? "-" : String(value);
   field.append(title, content);
   host.append(field);
}
```

Bei editierbaren DB-Zusatzfeldern zusaetzlich festlegen: Zieltabelle, ID, DB-Feld, Pflichtpruefung, Schreibberechtigung, Speicherdienst, Timestamp und Konfliktverhalten. Anzeige ist keine Persistierung. Fuer Updates gilt Abschnitt 11; vorhandene Fachservices bevorzugen. Ein DOM-Attribut ist kein Berechtigungsnachweis.

## 14) Rezept: Querytabelle ausblenden und ersetzen

### 14.1 Containerbezogener Austausch statt Leeren der Seite

D3-Navview sucht ausgehend von `tableContainer` die zugehoerige `.viewquery-table` beziehungsweise Tabelle, blendet nur diese aus und setzt `.bootstrapcontainer.d3-shell` direkt dahinter. Die Quelltabelle bleibt als technischer Anker erhalten.

Vereinfachtes Rezept fuer die Austauschoperation, ohne Datenbeschaffung und Instanzverwaltung:

```js
function mountReplacement(tableContainer, buildView) {
   const container = tableContainer && tableContainer.jquery
      ? tableContainer[0] : tableContainer;
   if (!container) throw new Error("Tabellencontainer fehlt.");
   const table = container.closest(".viewquery-table") ||
      container.querySelector(".viewquery-table") ||
      container.closest("table") || container.querySelector("table");
   if (!table) throw new Error("Quelltabelle fehlt.");
   const previous = table.style.getPropertyValue("display");
   const priority = table.style.getPropertyPriority("display");
   const view = buildView();
   table.after(view);
   table.style.setProperty("display", "none", "important");
   return function destroy() {
      view.remove();
      table.style.setProperty("display", previous, priority);
   };
}
```

Die Ersatzoberflaeche darf nicht innerhalb der versteckten Tabelle liegen. Sonst verschwindet sie ebenfalls. Die Containerstruktur pruefen, damit kein aeusserer Layout-Tabellenknoten getroffen wird. Der Aufrufer muss pro Container eine Instanz verwalten, erneute Mounts erkennen und beim Entfernen aufraeumen. Die vollstaendige D3-Komponente ergaenzt dafuer `WeakMap`, Observer, Abbruch alter Vorschauen, Generationen und Layout-Aufraeumen.

### 14.2 Lade-Hooks und Ladereihenfolge

- `event_page_loaded(isSingleTableView)` dient im WSS dem Seitenaufbau, insbesondere Selektionsfeldern.
- `event_table_loaded(guid, tableContainer)` dient dem Aufbau nach jeder Tabellenladung, also auch nach Reloads.

Das D3-Dashboard leitet an die Querykomponente weiter und puffert Aufrufe, falls deren JavaScript noch nicht geladen ist:

```js
async function event_table_loaded(guid, tableContainer) {
   if (window.D3DocumentView) {
      return window.D3DocumentView.mount(guid, tableContainer);
   }
   window.D3DocumentViewPending = window.D3DocumentViewPending || [];
   window.D3DocumentViewPending.push({ guid: guid, container: tableContainer });
}
```

Das Query-JavaScript stellt `D3DocumentView` bereit und arbeitet die Queue ab. Der Mount prueft Querykennung beziehungsweise Kontextzeile im uebergebenen Container, statt global die erste Tabelle zu greifen.

Pro globalem Kontext nur eine Definition desselben Hooks verwenden; mehrere Funktionen darin gezielt aufrufen. Query-GUID, Dashboardelement-GUID und Queryname nicht verwechseln. Ereigniskennung und `getDefinition(...)` am realen Frameworkvertrag pruefen. Im Single-Table-Modus kann `guid` laut WSS-Kommentar `null` sein; deshalb kann ein gepruefter Containervertrag zusaetzlich erforderlich sein.

### 14.3 Reload, Events, CSS und Aufraeumen

1. Aufbau idempotent machen: erneuter Hook erzeugt weder zweite View noch doppelte IDs.
2. Events nur einmal binden. Bei jQuery beispielsweise `.off("click.meinModul", selector).on("click.meinModul", selector, handler)` am eigenen stabilen Host verwenden.
3. Wenn der Framework-Hook genuegt, keinen zusaetzlichen allgemeinen Observer-Ladepfad erfinden.
4. Falls ein Observer noetig ist, eigene Aenderungen ignorieren und ihn beim Entfernen trennen. Sonst drohen Render-Endlosschleifen. Sonder-AGZeit zeigt das Ignorieren der eigenen Wurzel.
5. Query-JavaScript und Query-CSS gemeinsam ausliefern; Wrapperklassen allein erzeugen kein Layout.
6. CSS unter eigener Wurzel kapseln, beispielsweise `.bootstrapcontainer.d3-shell`. Lokale Bootstrap-4- und Bootstrap-5-Ressourcen nicht beliebig mischen.
7. Hoehe innerhalb des Quickview-Fensters berechnen. Aenderungen am Elternfenster nur bei Same-Origin und mit gezieltem Wiederherstellen eigener Styles vornehmen.

Nicht blind aus Altprojekten uebernehmen:

- D3_SNK definiert `event_table_loaded` zweimal. Die zweite Funktion ueberschreibt die erste; deren pauschales `hide()` ist deshalb kein verlaesslicher Teil des wirksamen Ablaufs.
- D3_SNK ersetzt `.P2FORM` mit `.html(...)`. Fuer wiederverwendbare Navviews ist das zu breit.
- Sonder-AGZeit versteckt `table.viewquery-table` per globaler CSS-Regel. Fuer Dashboards mit mehreren verschiedenen Queries stattdessen gezielt adressieren.
- Anfrage-PDF versteckt einen gefundenen `.dashboard-block`; diese Seitenannahme nicht ungeprueft in andere Einbettungen kopieren.
- Niemals `#content.innerHTML = ""` oder `$("#content").empty()` als allgemeines Ersatzrezept verwenden.

## 15) Rezept: WSS-Detailband in einer Tabelle

### 15.1 Tatsaechlicher WSS-Ablauf

`event_table_loaded` ruft `insertDatailRows()` auf; der Funktionsname ist im Bestand tatsaechlich so geschrieben. Die Funktion:

1. Waehlt `$('tr[data-aktiv="1"]').first()`. Aktuell wird nur die erste aktive Zeile erweitert, nicht jede Zeile und nicht automatisch eine beliebig aufgeklappte Zeile.
2. Liest `data-wauftragposid` und entfernt eine eventuell vorhandene Detailzeile mit derselben ID.
3. Erzeugt ein `tr` mit ID `WSS-Detail-<id>`, Klasse `WSS-Detail` und `data-wauftragposid`.
4. Fuegt darin ein einziges `td` mit `colspan` ueber alle Quellspalten ein und setzt die Detailzeile direkt nach die Quellzeile.
5. Rendert im `td` Stueckliste, Dokumente, Chat/Bemerkungen, Upload, Drucken und Checkliste.
6. Gibt die bearbeiteten Quellzeilen zurueck, nicht die neu erzeugten Detailzeilen.

Der Hook startet danach `alleD3Dokumenteladen(row)`, `wauftragposD3Dokumenteladen(row)`, `filedropping(row)`, `getBemerkungstext(row)`, optional `loadWssChecklist(row)` und `buildBOMTree(id)`.

### 15.2 Verallgemeinertes Grundgeruest

Dieses Rezept uebernimmt das WSS-Prinzip, begrenzt die Auswahl aber auf den uebergebenen Container und behaelt direkte DOM-Referenzen:

```js
function createDetailBands(tableContainer) {
   const container = tableContainer && tableContainer.jquery
      ? tableContainer[0] : tableContainer;
   if (!container) return [];
   const rows = Array.from(container.querySelectorAll(
      'tr[data-wauftragposid][data-aktiv="1"]:not(.qv-detail)'
   ));
   const result = [];
   for (const row of rows) {
      const id = row.getAttribute("data-wauftragposid");
      if (!/^[1-9][0-9]*$/.test(id || "")) continue;
      const previous = row.nextElementSibling;
      if (previous && previous.matches("tr.qv-detail") &&
          previous.getAttribute("data-owner-id") === id) previous.remove();
      const detail = document.createElement("tr");
      detail.className = "qv-detail";
      detail.setAttribute("data-owner-id", id);
      const cell = document.createElement("td");
      cell.colSpan = Array.from(row.cells).reduce(
         (count, item) => count + item.colSpan, 0
      );
      const host = document.createElement("div");
      host.className = "qv-detail-body";
      host.textContent = "Details werden geladen ...";
      cell.append(host);
      detail.append(cell);
      row.after(detail);
      result.push({ id: id, row: row, detail: detail, host: host });
   }
   return result;
}
```

Anders als WSS erweitert dieses Beispiel alle aktiven Quellzeilen im Container. Fuer nur eine Zeile `rows.slice(0, 1)` verwenden; Auf-/Zuklappen explizit an eine Benutzeraktion binden. Bei mehreren Dashboardelementen keine globalen IDs allein aus der Fach-ID bilden: dieselbe Fach-ID kann in mehreren Elementen vorkommen.

### 15.3 Detaildaten nachladen und Zustand halten

WSS laedt die Stueckliste ueber eine bestehende Query nach:

```js
const data = await extQueryUtils.callWithQueryDataAsync("WSS_002", {
   aufstueli: row.getAttribute("data-aufstueli"),
   struktur: row.getAttribute("data-aufstuelipos")
});
```

`buildBOMTree(...)` prueft auf ein Array, normalisiert Daten, behandelt leere Ergebnisse und Timeouts und haengt den Zustand als `detailRow.bomdata` an die Detailzeile. Weitere WSS-Funktionen greifen spaeter darauf zu. Das ist eine JavaScript-Eigenschaft am DOM-Knoten, kein HTML-Attribut und keine DB-Persistierung.

Fuer neue Entwicklungen beachten:

- Pro Band getrennte Lade-, Leer- und Fehlerzustaende vorsehen; ein DMS-Fehler darf nicht das ganze Band blockieren.
- Vor der Ausgabe nach `await` pruefen, ob Band und Fachkontext noch aktuell sind. Alte Antworten per Generation ignorieren beziehungsweise abbrechbare Abrufe stoppen.
- Erst beim Oeffnen laden, wenn viele Baender moeglich sind. WSS laedt zum Teil pro Stuecklistenartikel Dokumente; dieses N+1-Muster nicht bei grossen Listen blind vervielfachen.
- Immer im zugehoerigen Band rendern. Globale Selektoren wie `$('.grid-item.dokumente')` aus dem Ein-Band-WSS reichen fuer mehrere Baender nicht aus.
- Vor dem Ersetzen Formularinstanzen, Observer und sonstige Ressourcen freigeben. DOM-`remove()` allein beendet keine externen Ressourcen.
- Sortierung, Filterwechsel und Paginierung muessen das Band erneut der richtigen Quellzeile zuordnen. Das zusaetzliche `tr` ist keine Ergebniszeile der Query.

## 16) Rezept: D3-Dokumentliste und Zusatzinformationen

### 16.1 Liste laden und normalisieren

Der Einstieg bleibt der vorhandene SOAP-Dienst:

```js
const response = await app.soap.call("flexmobility/utils")
   .getFileListAsXml(tabelle, id);
```

Trotz des Namens wird hier JSON verarbeitet. WSS erwartet ein JSON-Array mit Key/Value-Arrays pro Datei; das einfache Mapping steht in Abschnitt 10.4.1. Die neuere D3-Navview unterstuetzt zusaetzlich mehrfach JSON-kodierte Antworten, `rows`-/`data`-Wrapper und Eintraege mit `Value`. Fuer generische Komponenten die dortigen Helfer `parseRows`, `toRecord` und `normalizeDocuments` als Referenz verwenden. Unerwartete Antwortformen als Integrationsfehler melden, nicht stillschweigend als leere Liste behandeln.

Nach der Normalisierung mindestens folgende Felder fuehren:

| Internes Feld | Quelle / Zweck |
|---|---|
| `name` | `Name`, gegebenenfalls `Dateiname` / `FileName` |
| `type` | `Dokumenttyp`, fuer Gruppierung |
| `extension` | `Dateityp`, einheitlich normalisiert |
| `date` | `Datum` aus dem Dienst |
| `url` | validierter `_pathWithoutServer` oder `_path` |
| `id` | `D3DocumentId` oder bestaetigte Objekt-ID aus dem validierten D3-Versionspfad |
| `repository` | Archivkennung aus dem validierten Pfad |
| `linkError`, `metadataError` | getrennte Fehler, damit gueltige Teilfunktionen nutzbar bleiben |

Ordner mit `Dateityp` gleich `FOL` herausfiltern, bei neuen Implementierungen ohne Beachtung der Gross-/Kleinschreibung. Namen und Metadaten mit `textContent` ausgeben oder bei unvermeidlichem HTML-Aufbau passend escapen. Diese Werte sind kein vertrauenswuerdiges HTML.

### 16.2 Einzelner Fachdatensatz oder mehrere Suchkontexte

WSS unterscheidet zwei Listen:

- Zugehoerige Dokumente mehrerer Objekte: Geraete-SNK, Werkstattauftrag, Auftragsstueckliste, Auftragsstuecklistenposition und Betriebsauftrag.
- Dokumente der aktuellen Werkstattauftragposition: separat geladen, weil neue Uploads genau dort abgelegt werden.

Das Suchmodell ist eine Liste mit `tabelle`, `id`, `name` und anschliessend `dokumente`. Leere IDs werden uebersprungen. `getDMSFiles(...)` faengt Fehler pro Kontext ab. `erzeugeBaumstruktur(...)` gruppiert zuerst nach Suchkontext und darin nach `Dokumenttyp`; leere Gruppen entfallen. Bei genau einer Dokumentart spart WSS die zusaetzliche Gruppenebene.

D3-Navview rendert dagegen eine Liste fuer genau einen Fachkontext: Suche, Anzahl, auf-/zuklappbare Dokumentarten, sortierte Namen, Auswahl, Metadaten, D3-Link und Download pro Dokument. Anfrage-PDF verwendet eine D3-Auswahlliste fuer die aktuelle `ANFRAGE`; die ausgewaehlte Datei wird ueber den Proxy fuer die weitere Verarbeitung geladen.

Mehrere Suchkontexte sind sinnvoll fuer eine Arbeitsuebersicht. Ein Upload braucht trotzdem genau ein festgelegtes Ziel aus Tabelle und ID. Die angeklickte Dokumentgruppe darf das Ablageziel nicht unbemerkt veraendern.

### 16.3 Beschreibung, Sprache, Revision, Groesse und Versionen

Die SOAP-Liste liefert diese Werte nicht automatisch vollstaendig. D3_004 ergaenzt sie mit einer nativen Query anhand der D3-Dokument-ID:

| Anzeige / Funktion | Quelle im aktuellen D3_004-SQL |
|---|---|
| Beschreibung | `phys_datei_d3.text` |
| Sprache | `firmen_spezifisch_d3.dok_dat_feld_29` |
| Revision | `firmen_spezifisch_d3.dok_dat_feld_30` |
| Groesse in Byte | `phys_datei_d3.size_in_byte` |
| Versionshistorie | `doc_versions_d3`, Zuordnung `doc_id = doku_id` |
| Erlaubte Upload-Dokumentarten | `ASDEFINITION` mit `DMSDOCUMENTTYPEREF` |
| APplus-Datensatzzuordnung | `dok_dat_feld_11 = tabelle`, `dok_dat_feld_80 = id` |

Diese Feldnummern und D3-Synonyme sind umgebungsspezifische Vertraege, keine universelle D3-Felddefinition. Views/Synonyme muessen ueber die Datenbankverbindung der Quickview lesbar sein.

D3_004 liefert genau eine Kontextzeile fuer den gespeicherten APplus-Datensatz mit `id`, `tabelle`, `d3metadata`, `d3versionhistory` und `d3types`. Die drei letztgenannten Felder enthalten JSON-Arrays aus `FOR JSON PATH`. So bleibt die Kontextzeile auch ohne Dokumente bestehen und einzelne Dokumentmetadaten werden nicht durch die Paginierung vieler HTML-Ergebniszeilen abgeschnitten.

Beim ersten Mount werden die JSON-Werte aus Attributen der Quellzeile gelesen. Bei fehlenden Attributen beziehungsweise spaeteren Aktualisierungen wird frisch nachgeladen:

```js
const payload = await extQueryUtils.callWithQueryDataAsync("D3_004", {
   tabelle: context.table, id: context.id
});
```

Die Rueckgabe wird auf denselben Fachkontext geprueft. Metadaten nur bei eindeutiger Dokument-ID und passender Archivzuordnung verbinden. Dateiname, Belegnummer und Listenindex sind keine Ersatzschluessel. Mehrere physische SQL-Dateizeilen zu derselben ID werden als mehrdeutig gemeldet; keine willkuerliche `TOP 1`-Auswahl einbauen.

Sicherheit: Die Query verwendet `FROM $P{tabelle}`. Ein Tabellenname ist ein SQL-Bezeichner, kein durch Apostroph-Escaping gesicherter Wert. Die Syntaxpruefung im Browser ersetzt keine serverseitige Tabellen-Allowlist und keine Datensatzberechtigung. Fuer neue Kontexte nur freigegebene Tabellen zulassen oder tabellenspezifische Queries einsetzen. Auch die native Metadatenquery muss selbst passend berechtigt sein; der Browserabgleich schuetzt nicht vor dem Ausliefern unerlaubter Daten.

## 17) Rezept: D3-Vorschau und Download

### 17.1 Sichere Dateiadresse und Proxy

Der vorhandene Basispfad ist `https://systec-vs72.systec-lab.local/`. Andere Umgebungen konfigurieren, keine Archiv-/Dokument-IDs durch Ersetzen von Praefixen konstruieren. Rezepthelfer nach dem strengeren D3-Navview-Muster:

```js
function documentProxyUrl(source, d3BaseUrl) {
   if (typeof source !== "string" || !source.trim()) {
      throw new Error("Dokumentpfad fehlt.");
   }
   const base = new URL(d3BaseUrl);
   const url = new URL(source.trim(), base);
   if (!["https:", "http:"].includes(base.protocol) ||
       url.origin !== base.origin || url.username || url.password ||
       !/^\/dms\/r\/[^/]+\/o2\//i.test(url.pathname)) {
      throw new Error("Ungueltige D3-Dateiadresse.");
   }
   return "../flexmobility/customutils.asmx/ProxyDocument?url=" +
      encodeURIComponent(url.href);
}
```

HTTPS produktiv bevorzugen. Der Browser ruft den APplus-Proxy auf; dieser uebernimmt den serverseitigen Dateizugriff. Keine D3-Zugangsdaten oder Tokens in Queryskripte schreiben. Auch das Backend muss Zielhost, Pfad, Weiterleitungen und Rechte pruefen. Ein blosser `StartsWith`-Vergleich auf einen Hoststring ist keine genaue Host-Allowlist.

Immer die gesamte absolute D3-URL als einen Parameterwert encodieren. Nicht nur den relativen Pfad encodieren oder den Basispfad ausserhalb von `encodeURIComponent` anhaengen. WSS enthaelt beide Schreibweisen; fuer neue Implementierungen die vollstaendig encodierte und validierte Variante verwenden. `new URL(...)` vermeidet fehlerhafte Slashes.

### 17.2 Vorschau nach Format

| Format | Implementierung in der neueren D3-Navview | Grenze / Ersatz |
|---|---|---|
| PDF | Proxyabruf, Blob-URL, `iframe` mit Titel | Browser-PDF-Unterstuetzung und APplus-CSP pruefen |
| PNG, JPG/JPEG, GIF, WEBP, BMP, AVIF | Proxyabruf, Blob-URL im `img` | defekte/zu grosse Bilder behandeln |
| TXT, CSV, JSON, XML | Proxyabruf, Ausgabe als Text im `pre` | Textvorschau maximal 5 MiB; Download bleibt moeglich |
| Office-, Mail- und unbekannte Formate | D3-PDF-Rendition ueber `/v/current/b/p1/c` versuchen | sonst offizieller D3-Vorschaulink im neuen Fenster |

Textvorschau: JSON wird formatiert, XML mit `DOMParser` validiert, CSV bleibt Originaltext. UTF-8 sowie UTF-16 mit BOM und ein Windows-1252-Fallback werden unterstuetzt. Binaere Inhalte mit Nullzeichen werden abgelehnt. XML oder Text nie als `innerHTML` rendern.

Die D3-Adressen haben unterschiedliche Zwecke:

```text
PDF-Rendition der aktuellen Version, Abruf ueber APplus-Proxy:
/dms/r/<repository>/o2/<document-id>/v/current/b/p1/c

Offizielle D3-Webvorschau, neues Fenster:
/dms/r/<repository>/o2/<document-id>/preview
```

Repository und Dokument-ID nur aus einem validierten Pfad beziehungsweise bestaetigten Vertrag ableiten. Eine PDF-Rendition existiert nicht fuer jedes Dokument. Der vorhandene Helfer prueft MIME-Typ beziehungsweise `%PDF-`-Signatur, bevor die Rendition als PDF angezeigt wird.

Die D3-Projekt-README berichtet von einer Livepruefung am 05.10.2026 mit `Content-Security-Policy: frame-ancestors 'self'` und `X-Frame-Options: SAMEORIGIN`. Das erklaert den dortigen Verzicht auf die direkte D3-UI im APplus-iframe. Dieser Befund wurde hier nicht erneut live geprueft. Keine Schutzheader umgehen; stattdessen Dateistream-Vorschau oder neues Fenster mit `rel="noopener noreferrer"` verwenden.

### 17.3 Asynchronitaet und Speicher

Pro Instanz ausgewaehltes Dokument, Fachkontext, `AbortController`, Vorschau-/Generationsnummer und Object-URL verwalten. Bei Auswahlwechsel alte Abrufe abbrechen und Object-URL mit `URL.revokeObjectURL(...)` freigeben, ebenso beim Entfernen der View. Vor dem Rendern nach `await` pruefen, ob Auswahl und Generation noch aktuell sind. Abbrechen allein verhindert nicht jeden spaeten Verarbeitungsschritt.

Proxyabrufe auf `response.ok`, unerwartete Weiterleitung und HTML statt einer Datei pruefen. Eine Anmeldeseite mit HTTP 200 darf nicht als PDF erscheinen. Die vorhandene Komponente prueft HTML anhand des Content-Type; fuer strikte Dateivertraege zusaetzlich den Inhalt plausibilisieren.

### 17.4 Download statt blossem Oeffnen

WSS erzeugt Links mit neuem Zielfenster. Ob der Browser anzeigt oder herunterlaedt, haengt von MIME-Typ und `Content-Disposition` ab. `target="_blank"` erzwingt keinen Download.

D3-Navview laedt den Originaldateistream als Blob und loest einen Download mit Dateinamen aus. Vereinfachtes Rezept fuer Nicht-HTML-Dokumente:

```js
async function downloadDocument(proxyUrl, filename) {
   const response = await fetch(proxyUrl, { credentials: "same-origin" });
   if (!response.ok || response.redirected) {
      throw new Error("Dateiabruf fehlgeschlagen: HTTP " + response.status);
   }
   const blob = await response.blob();
   if (/text\/html/i.test(blob.type)) {
      throw new Error("HTML statt des erwarteten Dokumentstreams erhalten.");
   }
   const url = URL.createObjectURL(blob);
   const link = document.createElement("a");
   link.href = url;
   link.download = String(filename || "Dokument")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
   link.hidden = true;
   document.body.append(link);
   link.click();
   link.remove();
   setTimeout(() => URL.revokeObjectURL(url), 60000);
}
```

`proxyUrl` muss zuvor aus einem validierten Pfad gebaut sein. In einer View nach `await` auch den aktuellen Instanz-/Fachkontext pruefen. Grosse Dateien benoetigen beim Blob-Abruf viel Browserspeicher; gegebenenfalls einen berechtigten serverseitigen Attachment-Download vorsehen. Der Download bleibt die Originaldatei; eine Vorschau-PDF darf ihn nicht unbemerkt ersetzen.

### 17.5 Drag-out

D3-Navview setzt beim Herausziehen einer Datei Chromiums nichtstandardisiertes `DownloadURL`:

```js
event.dataTransfer.setData("DownloadURL", mime + ":" + filename + ":" + proxyUrl);
```

Das ist eine optionale Komfortfunktion, kein universeller Dateitransfer. Explorer, klassisches und neues Outlook koennen sich unterschiedlich verhalten. Ein synthetischer Browsertest beweist keine native Dateiuebergabe. Den normalen Downloadknopf als Ersatz anbieten und mit den realen Zielanwendungen testen.

## 18) Rezept: D3-Upload mit Warteschlange

### 18.1 Endpoint und Formularvertrag

| Projekt | Verwendeter Endpoint | Besonderheit |
|---|---|---|
| WSS | `../dms/DMSUploadTarget.aspx` | Ziel `WAUFTRAGPOS`, einfache Metadaten |
| D3_SNK | `../custom/Anp_DMSUploadTarget.aspx` | dynamische Tabelle/ID, Sprache und Revision |
| D3-Navview | `../custom/Anp_DMSUploadTarget.aspx` | Queue, optionale Metadaten, unklare Uploadzustaende |

Der CUSTOM-Endpoint ist kein automatisch ueberall vorhandener APplus-Standard. Serverseitigen Vertrag, Rechte und Pflichtfelder pruefen. Die Upload-Backendquellen sind in den untersuchten Quickview-Exporten nicht enthalten.

| Formularfeld | Bedeutung |
|---|---|
| `filename` | gewuenschter Ablagename inklusive Endung |
| `Description` | Beschreibung |
| `DocumentType` | erlaubte DMS-Dokumentart |
| `FileChooser` | binaeres `File`-Objekt |
| `NavTable`, `Id` | APplus-Zieltabelle und gespeicherte Satz-ID, nicht D3-Dokument-ID |
| `sprache` | CUSTOM-Metadatum; D3-Navview: leer / `de` / `en` / `fr` / `es` |
| `Revision` | CUSTOM-Revisionsangabe |
| `revision` | wird zusaetzlich von D3_SNK gesendet, nicht vom aktuell gelesenen D3-Navview-JavaScript |
| `AlterationText` | D3-Navview sendet den Revisionswert auch als Versionshinweis |

Die D3-README nennt fuer `AlterationText` eine zusaetzliche Backendanpassung im D3-Abschlussrequest. Das Senden allein beweist keine Verarbeitung. Die README nennt ausserdem `revision` neben `Revision`; der aktuell gelesene D3-Navview-Code sendet nur `Revision`. Bei Widerspruechen gilt fuer die Beschreibung des Bestands der tatsaechliche Aufruf; den Zielvertrag separat verifizieren.

Minimaler CUSTOM-Request, noch ohne Validierungs-/Erfolgslogik:

```js
async function postD3File(context, draft) {
   const form = new FormData();
   form.append("filename", draft.filename);
   form.append("Description", draft.description || "");
   form.append("DocumentType", draft.doctype);
   form.append("sprache", draft.language || "");
   form.append("Revision", draft.revision || "");
   form.append("AlterationText", draft.revision || "");
   form.append("NavTable", context.table);
   form.append("Id", context.id);
   form.append("FileChooser", draft.file);
   return fetch("../custom/Anp_DMSUploadTarget.aspx", {
      method: "POST", credentials: "same-origin", body: form
   });
}
```

Keinen eigenen `Content-Type: multipart/form-data` setzen; der Browser erzeugt die Boundary. Das `File` nicht stattdessen als JSON serialisieren. Der Aufrufer muss vorher validieren und danach die Antwort gemaess Backendvertrag bewerten.

### 18.2 Queue und Validierung

Pro Datei verwaltet D3-Navview Original-`File`, editierbaren Dateinamen, Beschreibung, Dokumentart, Sprache, Revision, Status und Fehlertext.

1. Drop oder Dateiauswahl entgegennehmen; Dragover-/Drop-Standard unterbinden und mehrere Dateien erlauben.
2. Fachkontext aus validierter Tabelle und positiver gespeicherter ID ermitteln. Kein Upload fuer ungespeicherte Datensaetze.
3. Queueeintraege anlegen. D3-Navview vermeidet identische lokale Eintraege anhand von Name, Groesse und `lastModified`; das ist keine globale Archiv-Duplikatpruefung.
4. Metadaten pro Datei anzeigen und editierbar machen.
5. Dokumentarten aus `ASDEFINITION`/`DMSDOCUMENTTYPEREF` laden und gegen die Auswahl pruefen.
6. Dateiname inklusive unzulaessiger Zeichen und Dokumentart validieren. Serverseitige Groessen-/Dateityp-/Sicherheitsregeln bleiben erforderlich.
7. Batch gegen Doppelsenden sperren und Dateien sequenziell verarbeiten.
8. Fachkontext fuer den Batch kopieren. Ein Datensatzwechsel darf das Ziel gestarteter Requests nicht umbiegen.

Pflichtfelder sind projektabhaengig: D3_SNK verlangt unter anderem Beschreibung, Sprache und Revision. D3-Navview verlangt nur Dateiname und gueltige Dokumentart; Beschreibung, Sprache und Revision duerfen dort leer sein. Daraus keine erfundene globale Pflichtfeldregel machen.

D3-Navview hat eine ausdrueckliche Fallbackregel: Bei technisch erfolgreicher Dokumentartenabfrage ohne Treffer wird nur `Schriftverkehr` angeboten. Bei technischen Query-/Formatfehlern bleibt der Upload gesperrt. Fuer neue Projekte diese fachliche Fallbackfreigabe gesondert bestaetigen; ein fehlgeschlagener Abruf ist keine erlaubte leere Konfiguration.

### 18.3 Erfolg und unklaren Ausgang unterscheiden

Beobachteter aktueller Stand:

- WSS und D3_SNK werten vor allem `response.ok` aus und entfernen danach die Datei aus der Queue.
- D3-Navview behandelt Weiterleitungen als unklar, HTTP-5xx und Transportfehler ebenfalls als moeglicherweise bereits gespeichert. Eindeutige HTTP-Fehler unter 500 bleiben dort erneut sendbar.
- Bei erfolgreichem HTTP-Status ohne Weiterleitung entfernt auch der aktuell gelesene D3-Navview-Uploadpfad den Eintrag, ohne den Antwortbody fachlich auszuwerten.
- Der vorhandene Helfer `assessUpload(...)` kann Antwortobjekte/JSON auf `error`, `success`, `severity` beziehungsweise `status` pruefen, wird im aktuellen `upload()` aber nicht aufgerufen. Aus seiner Existenz darf keine wirksame Erfolgspruefung abgeleitet werden.

Empfehlung fuer neue Implementierungen: Einen eindeutigen Backendvertrag fuer Erfolg/Ablehnung vereinbaren und auswerten. HTTP 200 allein garantiert keine Ablage. Nach Versand kann bei Timeout oder unklarer Antwort bereits gespeichert worden sein. Dann sichtbar `uncertain` setzen und vor erneutem Senden das Archiv pruefen; keine automatische blinde Wiederholung.

| Status | Verhalten |
|---|---|
| `pending` | validieren, bearbeiten, senden oder entfernen |
| `uploading` | gegen Doppelsenden sperren |
| bestaetigter Erfolg | aus Queue entfernen, Liste aktualisieren |
| eindeutige Ablehnung | Fehler zeigen, nach Korrektur erneut senden |
| `uncertain` | nicht automatisch erneut senden; moegliche Doppelablage pruefen |

Ein Listenabgleich nach Dateiname beweist nicht, dass genau dieser Upload gespeichert wurde. Eine Serverbestaetigung mit Dokument-/Versions-ID ist belastbarer.

### 18.4 Nach dem Upload

Dokumentliste nachladen, bei D3-Navview einschliesslich Metadaten, Versionen und Dokumentarten. Nur bestaetigte Erfolge entfernen; fehlerhafte/unklare Dateien sichtbar lassen. Buttons und Ladeanzeige in `finally` zuruecksetzen.

WSS verwendet gezielt `wauftragposD3Dokumenteladen(row)`, D3-Navview `refresh()` mit Zusammenfassung des Batches. Ein selbst erzeugter DOM-Eintrag mit dem hochgeladenen Dateinamen ersetzt keine Aktualisierung aus dem Archiv.

## 19) Arbeitsrezept fuer KI-gestuetzte Entwicklungen

### 19.1 Verbindlicher Ablauf

1. Konkrete Referenz aus Abschnitt 21 und zustaendige Query-/Dashboarddateien lesen. Keine API aus dem Namen einer aehnlichen Bibliothek erfinden.
2. Laufzeitvertrag festhalten: Einbettung, Queryname, Elementkennung, Fachtabelle, ID, Parameterquellen und Berechtigungen.
3. Darstellungsstrategie aus Abschnitt 12 waehlen. Keine vollstaendige Ersatzoberflaeche bauen, wenn ein Zusatzfeld oder Detailband genuegt.
4. Datenvertrag zuerst absichern: SQL-Aliasse, JSON-Form, Nullwerte und erforderliche Zeilenattribute. Bei D3 SQL, JavaScript und CSS als zusammengehoerige Version behandeln.
5. Kleinsten vertikalen Ablauf implementieren: Kontext lesen, Daten laden, eine Anzeige rendern, Reload wiederholen.
6. Weitere Felder und Aktionen ergaenzen; dabei getrennte Instanzzustaende und fachliche Schreibpruefungen erhalten.
7. Tests aus Abschnitt 20 ausfuehren. Lokal simulierte Ergebnisse und echte APplus-/D3-Abnahme getrennt berichten.
8. Nur betroffene Ressourcen synchronisieren und Zuordnungen/Optionen in APplus pruefen. Kein Commit, Deployment oder echter DMS-Upload allein zu Testzwecken ohne Auftrag.

### 19.2 Wiederverwendbare Auftragsvorlage

Die folgenden Angaben vor einem Implementierungsauftrag ausfuellen. Offene Werte als offen markieren, nicht von der KI durch statische Fallbacks erraten lassen.

```text
Ziel: [konkreter fachlicher Ablauf]
Referenz: [Projekt, Query und Funktionen aus Abschnitt 21]
Einbettung: [Dashboard / navview / Single-Table]
Betroffene Ressourcen: [Dashboard-JS/CSS, Query-SQL/JS/CSS]
Queryname und Elementkennung: [...]
Fachkontext: [Tabelle, ID und genaue Parameterquellen]
Darstellung: [Standardspalte / Zusatzfeld / Detailband / Ersatzoberflaeche]
Datenvertrag: [Felder, Aliasse, JSON-Form, Nullwerte]
Schreibaktionen: [Fachservice, Rechte, Timestamp, Pflichtfelder]
D3: [Basis-URL, Archivzuordnung, Listenvertrag, Upload-Endpoint]
Uploadziel: [feste Regel fuer NavTable und Id]
Uploadbestaetigung: [Antwortvertrag, Verhalten bei unklarem Ausgang]
Abnahme: [konkrete Tests und benoetigte Livepruefungen]

Technische Framework-Knoten erhalten. Nur eigene Container veraendern.
Hooks nicht mehrfach definieren. Erneute Ladung muss idempotent sein.
Keine Tokens im Browser, kein ungeprueftes HTML und keine frei waehlbaren
SQL-Tabellen aus Benutzereingaben. Alte Antworten duerfen neue Datensaetze
nicht ueberschreiben. Bestehende Helfer verwenden; neue Rezeptfunktionen
nicht als eingebaute APplus-API darstellen.
```

## 20) Abnahme und Fehlersuche

### 20.1 Mindestpruefungen

| Pruefung | Erwartetes Ergebnis |
|---|---|
| Initialladung und zweimaliger Reload | genau eine View beziehungsweise ein Band je vorgesehenem Datensatz; keine doppelten Events |
| Zwei Queryelemente auf einer Seite | nur das Ziel wird veraendert; getrennte Instanzzustaende |
| Gleiche Fach-ID in zwei Elementen | keine kollidierenden DOM-IDs, falschen Uploadziele oder gemeinsamen Queues |
| Eigenstaendig und in echter navview | Kontext stimmt; technische Knoten bleiben erhalten |
| Fehlende/ungueltige Tabelle oder ID | deutlicher Fehler, keine geratene Tabelle und kein Upload |
| Datensatzwechsel waehrend eines Abrufs | alte Antwort wird verworfen; gestarteter Upload behaelt sein urspruengliches Ziel |
| Sortieren, Filtern und Paginieren | Detailband bleibt der richtigen Zeile zugeordnet oder wird sauber neu aufgebaut |
| Leere Liste und SOAP-/SQL-Fehler | leer und fehlgeschlagen werden unterschieden; Loader endet |
| Dateinamen mit Sonderzeichen/lange Namen | korrekte Textausgabe, gueltige URL, kein HTML und kein Layoutueberlauf |
| Fremder Host, Zugangsdaten in URL, falsches Archiv | kein ungeprueftes Weiterreichen an den Proxy |
| Fehlende/mehrdeutige Metadaten | sichtbarer Integrationsfehler statt erfundener Werte |
| PDF, Bild und Textdatei | korrekte Vorschau; Text wird nicht als HTML interpretiert |
| Nicht direkt darstellbares Format | PDF-Rendition versuchen, sonst offizieller D3-Link; Originaldownload bleibt verfuegbar |
| Anmeldeseite/Redirect statt Datei | Fehler statt scheinbar erfolgreicher Vorschau oder Download |
| Mehrfacher Vorschauwechsel/Entfernen | keine spaeten falschen Bilder, alte Object-URLs und Observer werden freigegeben |
| Mehrdatei-Upload mit Teilausfall | erfolgreiche, abgelehnte und unklare Dateien getrennt behandeln |
| Doppelklick, Timeout, HTTP-5xx | keine automatische Doppelablage durch blinde Wiederholung |
| Upload mit optional leeren Feldern | Verhalten entspricht dem konkret vereinbarten Endpointvertrag |
| Nach Upload aktualisieren | neuer Archivstand und Metadaten werden vom Backend gelesen |
| Kleine Viewports und eingebettete Hoehe | Liste, Vorschau und Upload bedienbar, kein abgeschnittener Bereich |

### 20.2 Vorhandene Tests und ihre Grenzen

Das D3-Navview-Projekt enthaelt [Regressionstests](../Dokumente/Quickviews/D3_Dokumentenansicht%20Navview/tests/d3-view.test.cjs) mit simulierten Schnittstellen. Die [Projekt-README](../Dokumente/Quickviews/D3_Dokumentenansicht%20Navview/README.md) beschreibt Node-, jsdom- und optionale Playwright-Pruefungen. Diese Tests sind eine Vorlage fuer Parser, Kontextbindung, wiederholtes Laden und View-Lebenszyklus; sie wurden fuer die vorliegende reine Dokumentergaenzung nicht ausgefuehrt.

Die JavaScript-Rezeptbeispiele in dieser MD sind vereinfachte Bausteine, keine vollstaendige zusaetzliche Anwendung. Syntaxpruefung ersetzt weder ihre Integration in den Framework-Hook noch die folgende Liveabnahme.

Nur in der Zielumgebung belastbar pruefbar sind insbesondere APplus-Parameterersetzung und Berechtigungen, D3-Synonyme/Feldzuordnung, Proxy-Authentifizierung, verfuegbare PDF-Renditionen, Uploadantwort und native Dateiuebergabe an Explorer/Outlook. Keine echten Archivdateien ohne vereinbarten Testdatensatz und Freigabe hochladen.

### 20.3 Typische Symptome

| Symptom | Zuerst pruefen |
|---|---|
| Ersatzansicht bleibt unsichtbar | liegt sie innerhalb der versteckten Tabelle? Query-CSS mitgeliefert? |
| Standardinhalt erscheint nach Reload erneut | Aufbau nur einmal ausgefuehrt statt nach `event_table_loaded`? |
| Zweite View oder doppelte Aktionen | mehrfacher Mount/Eventbinding oder doppelte Hookdefinition? |
| Falscher Fachdatensatz | globale Selektoren, verwechselte GUIDs oder unvollstaendige Parameterdekodierung? |
| Detailband nur einmal sichtbar | WSS verwendet bewusst `.first()` |
| D3-Liste vorhanden, Zusatzfelder fehlen | SQL-Version, JSON-Attribute, D3-ID und Archiv-/Feldzuordnung pruefen |
| Vorschau liefert HTML | Proxy-/Anmeldeseite statt Datei oder D3-UI statt Dateistream? |
| D3-Webvorschau im iframe blockiert | Frame-Schutzheader; neues Fenster statt Umgehung verwenden |
| Upload angeblich erfolgreich, Datei fehlt | HTTP-Erfolg mit fachlichem Erfolg verwechselt? richtige Tabelle/ID und Endpoint? |
| Dateiduplikat nach Wiederholen | vorheriger Ausgang war unklar; fehlende eindeutige Serverbestaetigung |

## 21) Quellenkarte der untersuchten Quickviews

Die Links beziehen sich auf die lokale Ordnerstruktur relativ zu dieser MD. Bei spaeteren Aenderungen die genannten Funktionen erneut lesen; dieses Rezept dokumentiert den am 11.11.2026 sichtbaren Exportstand, keine dauerhaft unveraenderliche API.

| Quelle | Konkrete Fundstellen / Nutzen |
|---|---|
| [WSS-Dashboard-JavaScript](../Dokumente/Quickviews/WSS/erp-dashboard/wss_001/dashboard/WSS_001__WSS__A3FE0D06-9541-4A9A-865C-FBE0E4C885A3.js) | `event_page_loaded`, `event_table_loaded`, `insertDatailRows`, `getDMSFiles`, `erzeugeBaumstruktur`, `buildBOMTree`, `upload_file` |
| [WSS-Hauptquery](../Dokumente/Quickviews/WSS/erp-dashboard/wss_001/query/WSS_001__WSS__C6C435D3-8F26-4AC5-B19F-A6A3262A18CA.sql) | sichtbare Spalten, technische `_...`-Aliasse, IDs und Aktionen |
| [WSS-Queryressourcen](../Dokumente/Quickviews/WSS/erp-dashboard/wss_001/query) | lokale `apqv-ext-menusel`- und `apqv-ext-queryutils`-Implementierungen; keine fremden Bibliotheksversionen voraussetzen |
| [D3-Navview-Komponente](../Dokumente/Quickviews/D3_Dokumentenansicht%20Navview/erp-dashboard/D3_002/query/D3_004__Navview_D3__7CC1E1C2-5545-43FA-B2CE-F6BBE3C8CFF0.js) | `DocumentView`, `mount`, Parser, Instanzverwaltung, Liste, Vorschau, Download und Queue |
| [D3-Kontext-/Metadatenquery](../Dokumente/Quickviews/D3_Dokumentenansicht%20Navview/erp-dashboard/D3_002/query/D3_004__Navview_D3__7CC1E1C2-5545-43FA-B2CE-F6BBE3C8CFF0.sql) | eine Kontextzeile, JSON-Metadaten, Dokumentarten und Versionshistorie |
| [D3-Dashboard-Einstieg](../Dokumente/Quickviews/D3_Dokumentenansicht%20Navview/erp-dashboard/D3_002/dashboard/D3_002__Navview_D3_Artikel__32D1D6EE-0FE7-4423-90D1-A41B721AD5C8.js) | schlanker Lade-Hook mit Pending-Queue |
| [D3_SNK-Dashboard](../Dokumente/Quickviews/D3_SNK/erp-dashboard/D3_SNK/dashboard/D3_SNK__D3_Dokumente__A4CEE941-2A7F-4D08-AC8C-C996E12B7CB0.js) | Kontextattribute, Uploadfelder; doppelte Hookdefinition als Warnbeispiel |
| [D3_SNK-Upload](../Dokumente/Quickviews/D3_SNK/erp-dashboard/D3_SNK/query/D3_002__Dateiupload__E88D5E11-BF3B-430A-B25E-1A515EEF96ED.js) | CUSTOM-Endpoint, `Revision`/`revision`, dateibezogene Queuefehler |
| [Inventur-Lagerlandkarte](../Dokumente/Quickviews/Inventur/erp-dashboard/Inventur_02/query/lager_08__Lagerlandkarte__4A6F9006-B32F-44A0-827D-8CDF6B17EE46.js) | `readPlaceTable(output)`, Spalten anhand von `data-column` lesen |
| [Sonder-AGZeit-Cockpit](../Dokumente/Quickviews/sonderagzeit/erp-dashboard/agzeit_01/dashboard/agzeit_01__Sonderbuchung_freigeben__DF63FC7A-4094-4CAB-A431-64262D48D1F4.js) | `readSource`, eigene View, Observer mit Ausschluss eigener Aenderungen |
| [Anfrage-PDF-Dashboard](../Dokumente/Quickviews/Anfrage_PDF_auslesen/erp-dashboard/Anfrage_01/dashboard/Anfrage_01__Angebot_PDF_auslesen__EA24F457-7EC7-4B6C-A102-7A8FFE6F2979.js) | `normalizeD3Rows`, `loadD3Documents`, D3-Auswahl und Proxydateien |

Zusaetzlicher Sichtungsbefund: Der Dashboard-JavaScript-Einstieg in Checkliste_Aplan enthaelt nur eine leere IIFE und ist keine weitere Renderreferenz. Die dortigen Queryressourcen und Ablaufdokumentation bleiben fachliche Kontextquellen fuer Checklisten. Der lokale Exportordner Stammdaten_02 ist leer und liefert keine belegbaren Umsetzungsmuster. Der Ordner Project enthaelt die VS-Code-Erweiterung, nicht eine zusaetzliche fachliche Quickview; Erweiterungscode wurde fuer diese UI-/DMS-Rezepte nicht als Laufzeitreferenz verwendet.
