window.ProductionBoard = (function () {
    "use strict";

    if (typeof window.PlantafelCore !== "function") {
        throw new Error("Plantafel_Core muss vor Plantafel_001 eingebunden werden.");
    }

    function classify(row, anchor) {
        if (!anchor || row.BAUFTRAG !== anchor.BAUFTRAG) return "unrelated";
        return String(row.POSITION) === String(anchor.POSITION) ? "work-order" : "production-order";
    }

    function sequence(items, anchor, mode) {
        return items.filter(item => {
            const relation = classify(item.row, anchor);
            return relation === "work-order" || (mode === "production-order" && relation === "production-order");
        }).sort((a, b) => Number(b.row.POSITION) - Number(a.row.POSITION) ||
            Number(a.row.AG) - Number(b.row.AG) || a.id.localeCompare(b.id));
    }

    return window.PlantafelCore({
        id: "production-board",
        query: "Plantafel_001",
        title: "Produktionsplantafel",
        includeResourceCatalog: true,
        parameters: [
            { name: "von", label: "Von", type: "date" },
            { name: "bis", label: "Bis (inklusiv)", type: "date" },
            { name: "bauftrag", label: "Betriebsauftrag", type: "text", maxLength: 19 },
            { name: "position", label: "Position", type: "text", maxLength: 5, inputMode: "numeric" },
            { name: "simulationen", label: "Simulationen", type: "checkbox", default: "0" }
        ],
        colors: {
            COLORAG2: ["pb-scheduled", "Terminiert"],
            COLORAG3OK: ["pb-working", "In Arbeit / im Plan"],
            COLORAG3NOTOK: ["pb-delayed", "In Arbeit / Zeitfortschritt hinter Plan"],
            COLORSIMAG: ["pb-simulation", "Simulation"]
        },
        fields: [
            ["BAUFTRAG", "Betriebsauftrag"], ["POSITION", "Position"], ["AG", "Arbeitsgang"],
            ["ARTIKEL", "Artikel"], ["BENENNUNG", "Benennung"], ["PROJEKT", "Projekt"],
            ["RESOURCE_LABEL", "Maschinengruppe"], ["KOST_NAME", "Kostenstelle"],
            ["AG_STATUS_TEXT", "AG-Status"], ["AUFTRAG_STATUS", "Auftragsstatus"],
            ["FIXED_CODE", "Fixierung (Rohwert)"], ["IS_SIMULATION", "Simulation"],
            ["START_DATE", "Beginn"], ["PRE_RUN_END", "Ende Vorlauf"],
            ["POST_RUN_START", "Beginn Nachlauf"], ["END_DATE", "Ende"],
            ["MENGE", "Menge"], ["MENGE_REST", "Restmenge"],
            ["PLANNED_SECONDS", "Sollzeit (h)"], ["REMAINING_SECONDS", "Restzeit (h)"],
            ["COMPLETION_PERCENT", "Fertigstellung (%)"]
        ],
        requiredFields: ["KOST", "MAGR", "BAUFTRAG", "POSITION", "AG", "PRE_RUN_END",
            "POST_RUN_START", "AG_STATUS_TEXT", "IS_SIMULATION", "COMPLETION_PERCENT"],
        validateParameters(params) {
            if (params.bauftrag.length > 19) throw new Error("Betriebsauftrag: maximal 19 Zeichen.");
            if (params.position && (!params.bauftrag || !/^\d+$/.test(params.position) ||
                Number(params.position) > 32767)) {
                throw new Error("Eine Position von 0 bis 32767 erfordert einen Betriebsauftrag.");
            }
            if (!["0", "1"].includes(params.simulationen)) throw new Error("Simulationen: nur 0 oder 1.");
        },
        validateRow(row, helpers) {
            if (row.BAUFTRAG == null || row.POSITION == null || row.AG == null ||
                row.KOST == null || row.MAGR == null) {
                throw new Error("Unvollstaendiger Arbeitsgang-/Ressourcenschluessel in der QV-Antwort.");
            }
            helpers.parseLocalDate(row.PRE_RUN_END);
            helpers.parseLocalDate(row.POST_RUN_START);
            if (typeof row.COMPLETION_PERCENT !== "number" ||
                row.COMPLETION_PERCENT < 0 || row.COMPLETION_PERCENT > 100) {
                throw new Error("Ungueltiger Fertigstellungsgrad: " + row.TITLE);
            }
        },
        resource(row) {
            return { parentId: String(row.KOST), parentLabel: String(row.KOST), code: String(row.MAGR),
                order: String(row.KOST) + "\u0000" + String(row.MAGR) };
        },
        formatField(row, key, helpers) {
            const value = row[key];
            if (value === null || value === undefined || value === "") return "-";
            if (key === "IS_SIMULATION") return value === true || value === 1 ? "Ja" : "Nein";
            if (key.endsWith("_SECONDS")) return (Number(value) / 3600).toLocaleString("de-DE", { maximumFractionDigits: 2 });
            if (key.endsWith("_DATE") || key === "PRE_RUN_END" || key === "POST_RUN_START") {
                return helpers.parseLocalDate(value).toLocaleString("de-DE");
            }
            return typeof value === "number" ? value.toLocaleString("de-DE") : String(value);
        },
        itemTitle: row => row.TITLE,
        itemContent: row => row.TITLE + " | " + row.COMPLETION_PERCENT + "%",
        labels: {
            items: "Arbeitsgaenge", short: "AG", details: "Arbeitsgangdetails", timeline: "Maschinenbelegung",
            noItems: "Keine geplanten Arbeitsgaenge im gewaehlten Zeitraum.",
            selectForSequence: "Fuer schematische Folgepfeile einen Arbeitsgang auswaehlen.",
            resourceTitle: "KOST / MAGR", resourceParent: "KOST", resourceChild: "MAGR",
            resourceTree: "Kostenstellen und Maschinengruppen", resourceSearch: "Kostenstelle / Maschine",
            resourceNote: "Alle aktiven KOST / MAGR, auch ohne Belegung oder Planungsfreigabe. Auswahl bleibt beim Nachladen erhalten.",
            note: "Nur belegte Maschinen. DB-Ortszeit. Farben: Prototyp-Palette, keine Kapazitaetsberechnung. " +
                "Verschieben/Zoom ueber den geladenen Bereich hinaus laedt automatisch nach. " +
                "Maximal 93 Abfragetage; Balken sind nicht editierbar."
        },
        related: {
            primaryMode: "work-order", secondaryMode: "production-order",
            primaryLabel: "Werkstattauftrag", secondaryLabel: "Betriebsauftrag",
            classify, sequence,
            parameters(params, anchor, mode) {
                if (!anchor || !anchor.BAUFTRAG) throw new Error("Bitte zuerst einen Arbeitsgang auswaehlen.");
                return { ...params, bauftrag: String(anchor.BAUFTRAG),
                    position: mode === "work-order" ? String(anchor.POSITION) : "", ausserhalb: "1" };
            },
            summary(anchor, work, production, visibleCount) {
                const positions = new Set(production.map(item => String(item.row.POSITION)));
                return "Werkstattauftrag " + anchor.BAUFTRAG + " / " + anchor.POSITION + ": " +
                    work.length + " AG. Betriebsauftrag " + anchor.BAUFTRAG + ": " +
                    production.length + " AG in " + positions.size + " Positionen. " +
                    "In der aktuellen Ressourcenansicht enthalten: " + visibleCount + ".";
            },
            note(outside) {
                return "Blau: gleicher BAUFTRAG + POSITION. Orange: andere Position desselben BAUFTRAG. " +
                    (outside ? "Auftragsnachladung ohne Zeitfilter; " : "Nur geladener Zeitraum; ") +
                    "Status 2/3, planbare Maschinen und wirksame Ressourcen-/Simulationsfilter. " +
                    "Pfeile verbinden AG nach POSITION DESC, AG ASC, im Betriebsauftrag auch ueber Positionen hinweg. " +
                    "Dies ist eine schematische Reihenfolge, KEINE bestaetigte Terminierungsabhaengigkeit.";
            },
            loaded(count) {
                return count + " AG ohne Zeitfilter geladen (Status 2/3). " +
                    "Ressourcenfilter gelten weiterhin. Allgemeines Bereichsnachladen pausiert bis zum Abwaehlen.";
            },
            sequenceStatus(drawn, total) {
                return "Schematische Folge POSITION absteigend / AG aufsteigend: " + drawn + " von " +
                    total + " Pfeilen im Ausschnitt. " +
                    "Fuer eine gemeinsame Ansicht rechts 'Nur Zugehoerige anzeigen' waehlen; bei Bedarf scrollen/zoomen. " +
                    "Keine bestaetigten APplus-Abhaengigkeiten; Luecken durch Zeitraum/Status moeglich.";
            }
        }
    });
})();