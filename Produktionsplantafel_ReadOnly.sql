/*
  Lesender SQL-Server-Entwurf der APplus-Produktionsplantafel
  Stand: 13.11.2026

  Drei unabhaengige SELECT-Abfragen, KEINE Schreiboperationen:
    1. EVENTS    - Arbeitsgaenge inklusive Auftrags-/Tooltipdaten
    2. RESOURCES - alle planbaren Maschinengruppen, auch ohne Belegung
    3. DETAILS   - alle Arbeitsgaenge genau eines Werkstattauftrags

  Fuer den ersten Entwurf reicht Abfrage 1, wenn nur belegte Ressourcen
  gezeigt werden. Abfrage 2 ist fuer leere Ressourcenzeilen sinnvoll.
  Abfrage 3 ist optional fuer ein Detailpanel; fuer die bereits in 1
  enthaltenen Auftrags-/Tooltipfelder ist kein weiterer Request noetig.

  Werkstattauftrag: WAUFTRAG, Schluessel BAUFTRAG + POSITION.
  Arbeitsgang:     WAUFTRAGPOS, zusaetzlich AG.
  BAUFTRAG allein bezeichnet nicht zwingend genau einen Werkstattauftrag.

  PARAMETER UND SCOPE:
  - @Mandant vor Ausfuehrung auf den serverseitig freigegebenen DB-Mandanten
    setzen. NULL liefert absichtlich keine Zeilen. N'' bedeutet explizit
    den leeren/NULL-DB-Mandanten, NICHT alle Mandanten.
  - Diese Vorlage begrenzt ALLE vier Tabellen auf denselben DB-Mandanten.
    Ob Stamm-/Bewegungsdaten in dieser Installation gemeinsam, getrennt
    oder mandantenuebergreifend gefuehrt werden, ist noch zu pruefen.
    Bei abweichendem Stammdatenscope die jeweiligen Bedingungen kontrolliert
    an das reale APplus-Partitions-/Mandantenmodell anpassen; NICHT pauschal
    alle Mandanten oder mehrfach vorhandene Stammsaetze dazujoinen.
  - Der Mandantenwert ist keine Berechtigungspruefung. Produktiv nur ueber
    autorisierten APplus-/QV-Lesepfad mit passenden Query-/Spaltenrechten.
  - Tabellennamen/Felder wurden gegen lokalen Code/Schemaquellen geprueft,
    nicht gegen eine laufende Datenbank. SQL noch nicht dort ausgefuehrt.
  - Schema dbo ggf. an die tatsaechliche Installation anpassen.

  ZEITRAUM:
  @Von inklusiv, @Bis exklusiv. Beispiel: 01.11. bis einschl. 30.11.
  => @Von='20261101', @Bis='20261201'.
  Zeitwerte sind hier bestehende DB-Ortszeiten, keine behaupteten UTC-Werte.

  QUICKVIEW:
  Jede SELECT-Abfrage als eigene QVQUERY verwenden, NICHT alle drei als
  Mehrfach-Resultset in eine QVQUERY kopieren. Der DECLARE-Block dient dem
  SQL-Test; fuer QV Parameter typisiert/validiert bereitstellen.
  QV-Platzhalter $P{...} sind Stringersetzung, keine SQL-Parameterbindung.
  Bei Nutzung im Alt-QV muessen alle Parameter definiert sein und Stringwerte
  escape="true" erhalten; Datum/Zahlen zusaetzlich streng validieren.
  Scope/Mandant niemals frei aus einer manipulierbaren Browser-URL ableiten.
  JSON-Datenabruf: vorhandener Query-Endpunkt mit xhr=json.

  UMGESETZTER QUICKVIEW-PROTOTYP (13.11.2026):
  - Dashboard Plantafel_01, Provider Plantafel_001, Bibliothek
    Plantafel_Vis_850 (vis-timeline 8.5.0, lokal als Script-only-QV).
  - Die lauffaehige Einzelabfrage liegt separat unter
    erp-dashboard\Plantafel_01\query\Plantafel_001.sql.
    Der normale APplus-QV-SQL-Parser akzeptiert den DECLARE-/CTE-Block
    dieser Testvorlage nicht. Der Provider ist deshalb ein einzelnes
    SELECT mit abgeleiteten Tabellen; ANP_DIRECTSQL bleibt ausgeschaltet.
  - Der freigegebene leere DB-Mandant wurde im Deploy-System bestaetigt
    und im Provider fest begrenzt, nicht als Browserparameter angeboten.
  - Parameterdefinition: Plantafel_001.options.xml, alle escape="true".
    Server und Client begrenzen Zeitraeume auf 1 bis 93 Tage.
    TOP (10001) dient dem Client als expliziter Ueberlaufnachweis > 10000.
  - JSON-Vertrag des Providers: ROW_KIND=event fuer Arbeitsgaenge.
    Bei leerem Ergebnis genau eine ROW_KIND=empty-Zeile; bei ungueltigen
    Parametern ROW_KIND=error mit ERROR_MESSAGE. Diese Marker sind keine
    Balken. Fehler werden sichtbar gemeldet, nicht als leere Tafel kaschiert.
    Query.aspx laesst SQL-NULL-Felder im JSON weg. Optionale Tooltipwerte
    duerfen deshalb fehlen; fehlende Schluessel-/Zeit-/Farbspalten sind Fehler.
  - Gegen den echten QV-Endpunkt getestet: November 2024 mit 5 AG /
    4 Ressourcen und Dezember 2024 mit 15 AG / 3 Ressourcen.
    Datums-/93-Tage-Grenze und BAUFTRAG+POSITION-Filter ebenfalls geprueft.
    Browser: Auswahl, Details, Refresh und Ressourcenfilter getestet.
  - Noch keine produktive Vollparitaet: nur belegte Ressourcen, lokale
    Prototyp-Farbpalette statt Sysconf-Farbwerten, kein Kapazitaetsdiagramm,
    keine Schreibaktionen und keine vollstaendige Werkstattauftragsliste.
    Das Detailpanel zeigt ausschliesslich den ausgewaehlten geladenen AG.
    Ressourcenzeilen und Auswahltexte verwenden KOST / MAGR statt Namen.
  - Der Host nutzt die verfuegbare Inhaltsbreite. Arbeitsgangdetails
    oeffnen rechts als nicht-modale Overlay-Sidebar (Schliessen / Escape).
    Die Sidebar markiert wahlweise BAUFTRAG + POSITION oder BAUFTRAG;
    weitere Positionen desselben BA erhalten eine andere Kontur.
    Die zugehoerigen Modusschaltflaechen tragen die Listenfarben Blau
    (Werkstattauftrag) und Orange (Betriebsauftrag).
    Listen und Zaehler beziehen sich nur auf geladene Arbeitsgaenge,
    nicht auf saemtliche Statuswerte/Termine eines vollstaendigen Auftrags.
    Auf Benutzerwunsch zusaetzlich gestrichelte, schematische Folgepfeile
    nach POSITION DESC, AG ASC. Im BA-Modus werden auch Positionsgrenzen
    verbunden. KEINE bestaetigten APplus-Vorgaengerbeziehungen!
    "Nur Zugehoerige anzeigen" reduziert Arbeitsgaenge und Ressourcen
    auf die ausgewaehlte Gruppe, ohne Daten neu zu laden.
    Pfeile verbinden nur unmittelbar benachbarte geladene AG der Folge
    und werden nur mit beiden Endpunkten im sichtbaren Ausschnitt gezeichnet.
    Bei Scrollen, Zoom, Resize und Refresh wird das SVG-Overlay aktualisiert;
    eine Textanzeige nennt sichtbare/insgesamt moegliche Folgepfeile.
    Ausgeblendete Zwischenknoten werden nicht durch neue Direktpfeile ersetzt.
  - Verschieben/Zoom ausserhalb des geladenen Fensters laedt nach 300 ms
    Ruhezeit den neuen Ausschnitt ueber dieselbe QVQUERY nach. Keine
    unbeschraenkte Ansammlung alter Daten. Laufende Bereichsanfragen werden
    bei weiterer Navigation abgebrochen; das sichtbare Fenster bleibt stehen.
    Abfragegrenzen werden auf ganze DB-Ortstage erweitert. An der 93-Tage-
    Grenze wird auf genau 93 Kalendertage eingerastet, statt unvollstaendige
    Randdaten oder einen ungueltigen 94. Abfragetag zu akzeptieren.
    Gleitender Puffer: Vorhandener und neuer Bereich werden bis maximal
    93 Tagen zusammengefasst. Danach faellt die gegenueberliegende Kante
    heraus, nicht der Zoom. Die begrenzte Gesamtspanne wird frisch gelesen,
    statt inkonsistente Teilsnapshots oder geloeschte Events anzusammeln.
    Bei Nachladefehlern bleiben alte Daten mit deutlicher Warnung stehen.
  - Ressourcenfilter als Checkbox-Baum: KOST/Kapazitaetsstelle -> MAGR.
    Eltern koennen komplett ein-/ausgeblendet, Kinder einzeln ausgewaehlt
    werden. Teilselektion wird am Elternknoten angezeigt. Die Regeln gelten
    auch nach Bereichsnachladung und fuer neu auftauchende Maschinen einer
    ausgeblendeten KOST. Baum und Zaehler enthalten nur geladene Ressourcen.
    Der Filter ist rein lokal; keine Stammdaten-/Planungsdaten-Aenderung.
    Die Ressourcensuche befindet sich im KOST/MAGR-Menue. Separate
    Vor-/Zurueck-Zeitraumschaltflaechen und das Arbeitsgangdropdown entfallen;
    Arbeitsgaenge werden direkt im Gantt fuer die Sidebar ausgewaehlt.
  - Sidebar-Checkbox "Auch ausserhalb des Zeitfensters laden": liest die
    Folge des gewaehlten Werkstattauftrags (BAUFTRAG + POSITION) oder
    Betriebsauftrags (BAUFTRAG) mit derselben QVQUERY ohne Zeitfilter nach.
    Weiterhin nur Status 2/3, planbare Maschinen, vollstaendige Planungszeiten
    und gewaehlter Simulationsfilter. Parameter ausserhalb=1 erfordert
    serverseitig einen BAUFTRAG; unbeschraenkte Gesamtabfragen sind verboten.
    Die Nachladung ersetzt die geladenen Daten des gewaehlten Auftrags,
    ergaenzt sie ausserhalb des Basiszeitraums und zoomt auf die ganze Folge,
    ggf. auch ueber 93 Tage. Ressourcenfilter und 10000-AG-Grenze gelten.
    Allgemeines Bereichsnachladen pausiert dabei. Abwaehlen/Schliessen
    stellt Basisdaten und vorherigen Ausschnitt wieder her. Aktualisieren
    liest die Auftragsfolge erneut; "Laden" wechselt zur Bereichsabfrage.
  - Nach 250 ms Ueberfahren wird ein zu schmaler AG-Balken nur optisch auf seine
    Textbreite erweitert. Ein eigener Tooltip steht daneben, bei Platzmangel
    links bzw. ober-/unterhalb. Beim Verlassen/Scrollen/Zoom verschwindet
    diese Darstellung; Planungszeiten und gespeicherte Balkenbreiten bleiben.
    Kurzes Ueberfliegen loest weder Verbreiterung noch Tooltip aus.
  - Der Rahmen nutzt die verfuegbare Fensterhoehe; die bisherige leere
    obere Navigationszeile entfaellt bei weiterhin erreichbarem Home-Symbol.
    Der Gantt fuellt die Resthoehe. Folgepfeilhinweise stehen nur in der
    Sidebar, nicht mehr als Text unter der Plantafel.
  - Das Datumsfeld "Bis (inklusiv)" schliesst den gewaehlten letzten Tag
    vollstaendig ein. Intern und fuer QV-/URL-Parameter bleibt die obere
    Grenze exklusiv: Anzeige = bis minus ein Tag, Abfrage = Eingabe plus
    ein Kalendertag. Dadurch bleiben bestehende Links und DB-Ortszeitgrenzen
    kompatibel, auch bei Monats-/Jahreswechsel und Sommerzeit.
  - Folgepfeile verwenden kurze, glatte Kurven. Bei zeitlicher Ueberlappung
    werden einander zugewandte obere/untere Balkenkanten verbunden, statt
    ueber feste Haken ausserhalb der Balken zurueckzulaufen.
  - tools\Deploy-Plantafel.ps1 installiert nur QV-Konfiguration und legt
    vor Aenderungen eine Sicherung an. Optionen und Bibliothek werden
    ueber diesen Installer gepflegt; JS/CSS/Provider-SQL auch per QV-Sync.
    Der erste Host liegt wegen des vorhandenen Sync-Vertrags in
    JSPAGESCRIPT; eine gemeinsame kompilierte Runtime bleibt ein Folgeschritt.
*/

DECLARE @Mandant nvarchar(15) = NULL; -- Pflicht: freigegebenen DB-Wert eintragen
DECLARE @Von datetime = CONVERT(datetime, CONVERT(date, GETDATE()));
DECLARE @Bis datetime = DATEADD(day, 28, @Von);
DECLARE @Simulationen bit = 0;
DECLARE @Bauftrag nvarchar(19) = NULL; -- NULL = alle im erlaubten Scope
DECLARE @Position smallint = NULL;    -- zusammen mit BAUFTRAG filtern


/* =====================================================================
   1. EVENTS: Ein Datensatz je geplantem Arbeitsgang

   Stammdatenjoin MAGR: KOST + MAGR, nicht nur MAGR!
   Kopfjoin WAUFTRAG: BAUFTRAG + POSITION, nicht nur BAUFTRAG!

   Renderer-Mapping, z.B. fuer vis-timeline:
     id       <- EVENT_ID
     group    <- RESOURCE_ID
     start    <- START_DATE
     end      <- END_DATE
     content  <- TITLE (als Text rendern, nicht ungeprueft als HTML)

   COLOR_TOKEN ist eine fachliche Klassifikation, kein fertiger RGB-Wert.
   Farben ueber konfigurierte Sysconf-/Board-Farben im Renderer aufloesen.
   Fortschritt entspricht der Java-Grundformel T_SOLL/T_REST, nicht Menge.
   ===================================================================== */
;WITH EventBasis AS
(
    SELECT
        p.ID AS WAUFTRAGPOS_ID,
        w.ID AS WAUFTRAG_ID,
        m.ID AS MAGR_ID,
        p.BAUFTRAG,
        p.POSITION,
        p.AG,
        p.STATUS AS AG_STATUS,
        w.STATUS AS AUFTRAG_STATUS,
        p.KOST,
        k.NAME_KOST AS KOST_NAME,
        p.MAGR,
        m.NAME AS MAGR_NAME,
        p.[START] AS START_DATE,
        p.ENDE_VLZ AS PRE_RUN_END,
        p.START_NLZ AS POST_RUN_START,
        p.ENDE AS END_DATE,
        p.ISFIXED,
        p.PLANAG,
        w.APLAN AS ARTIKEL,
        w.NAME AS BENENNUNG,
        w.PROJEKT,
        p.MENGE,
        p.MENGE_REST,
        p.T_SOLL,
        p.T_REST,
        CASE
            WHEN p.T_SOLL IS NULL OR p.T_SOLL = 0 THEN 0.0
            ELSE ROUND(
                (CONVERT(float, p.T_SOLL) - COALESCE(p.T_REST, 0))
                * 100.0 / p.T_SOLL,
                2
            )
        END AS RAW_COMPLETION
    FROM dbo.WAUFTRAGPOS AS p
    INNER JOIN dbo.MAGR AS m
        ON m.KOST = p.KOST
       AND m.MAGR = p.MAGR
       AND COALESCE(m.MANDANT, N'') = @Mandant
    LEFT JOIN dbo.KOST AS k
        ON k.KOST = p.KOST
       AND COALESCE(k.MANDANT, N'') = @Mandant
    LEFT JOIN dbo.WAUFTRAG AS w
        ON w.BAUFTRAG = p.BAUFTRAG
       AND w.POSITION = p.POSITION
       AND COALESCE(w.MANDANT, N'') = @Mandant
    WHERE
        @Mandant IS NOT NULL
        AND @Von < @Bis
        AND COALESCE(p.MANDANT, N'') = @Mandant
        AND m.PLANEN = 1
        AND p.STATUS IN (2, 3) -- terminiert / in Arbeit, wie Bestandsplantafel
        AND p.[START] IS NOT NULL
        AND p.ENDE_VLZ IS NOT NULL
        AND p.START_NLZ IS NOT NULL
        AND p.ENDE IS NOT NULL
        AND p.KOST IS NOT NULL
        AND p.MAGR IS NOT NULL
        AND (@Simulationen = 1 OR p.PLANAG IS NULL OR p.PLANAG = 0)
        AND p.[START] < @Bis
        AND p.ENDE > @Von
        AND (@Bauftrag IS NULL OR p.BAUFTRAG = @Bauftrag)
        AND (@Position IS NULL OR p.POSITION = @Position)
),
EventFortschritt AS
(
    SELECT
        b.*,
        CONVERT(decimal(5, 2),
            CASE
                WHEN b.RAW_COMPLETION < 0 THEN 0.0
                WHEN b.RAW_COMPLETION > 100 THEN 100.0
                ELSE b.RAW_COMPLETION
            END
        ) AS COMPLETION_PERCENT
    FROM EventBasis AS b
)
SELECT
    N'production:operation:' + CONVERT(nvarchar(20), e.WAUFTRAGPOS_ID) AS EVENT_ID,
    N'production:machineGroup:' + CONVERT(nvarchar(20), e.MAGR_ID) AS RESOURCE_ID,
    e.WAUFTRAGPOS_ID,
    e.WAUFTRAG_ID,
    e.BAUFTRAG,
    e.POSITION,
    e.AG,
    e.BAUFTRAG + N' - ' + CONVERT(nvarchar(10), e.POSITION)
        + N' - AG ' + CONVERT(nvarchar(10), e.AG) AS TITLE,
    e.START_DATE,
    e.PRE_RUN_END,
    e.POST_RUN_START,
    e.END_DATE,
    e.KOST,
    e.KOST_NAME,
    e.MAGR,
    e.MAGR_NAME,
    e.KOST + N'/' + e.MAGR + N' ' + COALESCE(e.MAGR_NAME, N'') AS RESOURCE_LABEL,
    e.ARTIKEL,
    e.BENENNUNG,
    e.PROJEKT,
    e.AG_STATUS,
    CASE e.AG_STATUS
        WHEN 2 THEN N'terminiert'
        WHEN 3 THEN N'in Arbeit'
    END AS AG_STATUS_TEXT,
    e.AUFTRAG_STATUS,
    e.ISFIXED AS FIXED_CODE, -- Rohwert erhalten; keine Bit-Semantik unterstellen
    CONVERT(bit, CASE WHEN e.PLANAG = 1 THEN 1 ELSE 0 END) AS IS_SIMULATION,
    e.MENGE,
    e.MENGE_REST,
    e.T_SOLL AS PLANNED_SECONDS,
    e.T_REST AS REMAINING_SECONDS,
    e.COMPLETION_PERCENT,
    CASE
        WHEN e.PLANAG = 1 THEN N'COLORSIMAG'
        WHEN e.AG_STATUS = 2 THEN N'COLORAG2'
        WHEN e.AG_STATUS = 3 AND DATEADD(
            second,
            CONVERT(int, CEILING(
                CONVERT(float, e.COMPLETION_PERCENT) / 100.0
                * DATEDIFF(second, e.START_DATE, e.END_DATE)
            )),
            e.START_DATE
        ) < GETDATE() THEN N'COLORAG3NOTOK'
        ELSE N'COLORAG3OK'
    END AS COLOR_TOKEN
FROM EventFortschritt AS e
ORDER BY e.KOST, e.MAGR, e.START_DATE, e.BAUFTRAG, e.POSITION, e.AG;


/* =====================================================================
   2. RESOURCES: Alle planbaren Maschinengruppen, auch ohne Balken

   Als zweite QVQUERY nur erforderlich, wenn auch leere Maschinenzeilen
   erscheinen sollen. Bei "nur belegte" Gruppen aus Abfrage 1 ableiten.
   ===================================================================== */
SELECT
    N'production:machineGroup:' + CONVERT(nvarchar(20), m.ID) AS RESOURCE_ID,
    m.ID AS MAGR_ID,
    m.KOST,
    k.NAME_KOST AS KOST_NAME,
    m.MAGR,
    m.NAME AS MAGR_NAME,
    m.KOST + N'/' + m.MAGR + N' ' + COALESCE(m.NAME, N'') AS RESOURCE_LABEL
FROM dbo.MAGR AS m
LEFT JOIN dbo.KOST AS k
    ON k.KOST = m.KOST
   AND COALESCE(k.MANDANT, N'') = @Mandant
WHERE
    @Mandant IS NOT NULL
    AND COALESCE(m.MANDANT, N'') = @Mandant
    AND m.PLANEN = 1
ORDER BY m.KOST, m.MAGR;


/* =====================================================================
   3. DETAILS: Arbeitsgaenge eines ausgewaehlten Werkstattauftrags

   Bewusst KEIN Zeitfenster-, AG-Status- oder PLANEN-Filter:
   Das Detailpanel soll auch beendete/noch ungeplante Arbeitsgaenge zeigen.
   Erst mit @Bauftrag UND @Position werden Zeilen geliefert.
   p.BEMERKUNG kann gross sein und wird deshalb nicht in EVENTS geladen.

   Fuer nur einen Arbeitsgang zusaetzlich p.AG auf einen typisierten
   @AG-Parameter einschraenken. Nicht den gesamten Auftrag pro Hover laden.
   ===================================================================== */
SELECT
    w.ID AS WAUFTRAG_ID,
    p.ID AS WAUFTRAGPOS_ID,
    w.BAUFTRAG,
    w.POSITION,
    w.STATUS AS AUFTRAG_STATUS,
    w.APLAN AS ARTIKEL,
    w.NAME AS BENENNUNG,
    w.PROJEKT,
    p.AG,
    p.STATUS AS AG_STATUS,
    p.KOST,
    k.NAME_KOST AS KOST_NAME,
    p.MAGR,
    m.NAME AS MAGR_NAME,
    p.[START] AS START_DATE,
    p.ENDE_VLZ AS PRE_RUN_END,
    p.START_NLZ AS POST_RUN_START,
    p.ENDE AS END_DATE,
    p.T_SOLL AS PLANNED_SECONDS,
    p.T_REST AS REMAINING_SECONDS,
    p.MENGE,
    p.MENGE_REST,
    p.PLANAG,
    p.ISFIXED AS FIXED_CODE,
    p.BEMERKUNG
FROM dbo.WAUFTRAG AS w
LEFT JOIN dbo.WAUFTRAGPOS AS p
    ON p.BAUFTRAG = w.BAUFTRAG
   AND p.POSITION = w.POSITION
   AND COALESCE(p.MANDANT, N'') = @Mandant
LEFT JOIN dbo.MAGR AS m
    ON m.KOST = p.KOST
   AND m.MAGR = p.MAGR
   AND COALESCE(m.MANDANT, N'') = @Mandant
LEFT JOIN dbo.KOST AS k
    ON k.KOST = p.KOST
   AND COALESCE(k.MANDANT, N'') = @Mandant
WHERE
    @Mandant IS NOT NULL
    AND COALESCE(w.MANDANT, N'') = @Mandant
    AND w.BAUFTRAG = @Bauftrag
    AND w.POSITION = @Position
ORDER BY p.AG;


/*
  ABWEICHUNGEN / BEWUSSTE GRENZEN DIESES LESEENTWURFS:
  - Keine Kapazitaetsberechnung. Dafuer liefert die Bestandsplantafel
    GetBelegung / Capa.capacityPlanningMagr; einfache Balkenzaehlung ist
    fachlich nicht gleichwertig.
  - Halb offenes Zeitfenster statt der teils inklusiven Alt-Abfrage.
    Events ohne positive Dauer ggf. separat als Punkt modellieren;
    insbesondere genau am Fensterrand gilt die dokumentierte Semantik.
  - Null T_REST wird im Entwurf als 0 behandelt. Alt-Getterverhalten und
    Produktionsdaten vor einer Behauptung exakter Paritaet pruefen.
  - SQL-Farbtoken folgt der Java-Grundlogik, ist aber keine Garantie fuer
    exakte P2Time-Paritaet bei DST, ungueltigen Zeiten oder Nullwerten.
    DATEDIFF(second) setzt normale AG-Zeitraeume < ca. 68 Jahre voraus.
  - N'production:...' IDs gelten innerhalb der gewaehlten Datenquelle.
    Bei Kombination mehrerer Datenbankpartitionen Providerkennung ergaenzen.
  - Keine NOLOCK-Hints: inkonsistente/fehlende/doppelte Balken vermeiden.
  - Keine direkte Fortschritts-/Termin-/Statusaenderung mit diesem SQL.
*/