/*
 * Read-only QV prototype. Provider: Plantafel_001, library: Plantafel_Vis_850.
 * The existing QV sync transports JavaScript, so this first host lives in
 * JSPAGESCRIPT. A shared, compiled runtime can replace it before more boards
 * are added. No scheduling services or database write APIs are called here.
 */
window.ProductionBoard = (function () {
    "use strict";

    const QUERY = "Plantafel_001";
    const MAX_EVENTS = 10000;
    const DAY = 86400000;
    const PARAMS = ["von", "bis", "bauftrag", "position", "simulationen"];
    const COLORS = {
        COLORAG2: ["pb-scheduled", "Terminiert"],
        COLORAG3OK: ["pb-working", "In Arbeit / im Plan"],
        COLORAG3NOTOK: ["pb-delayed", "In Arbeit / Zeitfortschritt hinter Plan"],
        COLORSIMAG: ["pb-simulation", "Simulation"]
    };
    const FIELDS = [
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
    ];
    let instance = null;

    function parseLocalDate(value) {
        const parts = typeof value === "string" &&
            /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
        if (!parts) throw new Error("Ungueltige lokale DB-Zeit: " + String(value));
        const numbers = parts.slice(1, 7).map(part => Number(part || 0));
        const [year, month, day, hour, minute, second] = numbers;
        const ms = Number((parts[7] || "0").padEnd(3, "0"));
        const date = new Date(year, month - 1, day, hour, minute, second, ms);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 ||
            date.getDate() !== day || date.getHours() !== hour ||
            date.getMinutes() !== minute || date.getSeconds() !== second) {
            throw new Error("Ungueltige lokale DB-Zeit: " + value);
        }
        return date;
    }

    function dateInput(date) {
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")].join("-");
    }

    function shiftDate(value, days) {
        const date = parseLocalDate(value);
        date.setDate(date.getDate() + days);
        return dateInput(date);
    }

    function rangeParameters(start, end, params, loaded = null) {
        const von = dateInput(start);
        let bis = dateInput(end);
        if (end > parseLocalDate(bis)) bis = shiftDate(bis, 1);
        const first = parseLocalDate(von), last = parseLocalDate(bis);
        const days = (Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) -
            Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / DAY;
        const snapped = days > 93;
        if (snapped) bis = shiftDate(von, 93);
        let queryVon = von, queryBis = bis;
        if (loaded) {
            const unionVon = von < loaded.von ? von : loaded.von;
            const unionBis = bis > loaded.bis ? bis : loaded.bis;
            const unionStart = parseLocalDate(unionVon), unionEnd = parseLocalDate(unionBis);
            const unionDays = (Date.UTC(unionEnd.getFullYear(), unionEnd.getMonth(), unionEnd.getDate()) -
                Date.UTC(unionStart.getFullYear(), unionStart.getMonth(), unionStart.getDate())) / DAY;
            if (unionDays <= 93) {
                queryVon = unionVon;
                queryBis = unionBis;
            } else if (von < loaded.von) {
                queryBis = shiftDate(von, 93);
            } else {
                queryVon = shiftDate(bis, -93);
            }
        }
        return { params: { ...params, von: queryVon, bis: queryBis }, snapped };
    }

    function coversRange(params, start, end) {
        return start >= parseLocalDate(params.von) && end <= parseLocalDate(params.bis);
    }

    function decodeParameters(value) {
        let text = value || "";
        for (let i = 0; i < 3 && !text.includes("=") && /%[0-9a-f]{2}/i.test(text); i++) {
            text = decodeURIComponent(text);
        }
        return new URLSearchParams(text);
    }

    function resolveParameters(search, globalParam, localParam, today) {
        const start = dateInput(today);
        const result = { von: start, bis: shiftDate(start, 28),
            bauftrag: "", position: "", simulationen: "0" };
        const url = new URLSearchParams(search);
        [decodeParameters(localParam), decodeParameters(globalParam),
            decodeParameters(url.get("param")), url].forEach(source => {
            PARAMS.forEach(key => {
                if (!source.has(key)) return;
                let value = source.get(key);
                if ((key === "von" || key === "bis") && /^\d{8}$/.test(value)) {
                    value = value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6);
                }
                result[key] = value;
            });
        });
        return result;
    }

    function validateParameters(params) {
        const start = parseLocalDate(params.von);
        const end = parseLocalDate(params.bis);
        const days = (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
            Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / DAY;
        if (days < 1 || days > 93) throw new Error("Bitte einen Zeitraum von 1 bis 93 Tagen waehlen.");
        if (params.bauftrag.length > 19) throw new Error("Betriebsauftrag: maximal 19 Zeichen.");
        if (params.position && (!params.bauftrag || !/^\d+$/.test(params.position) ||
            Number(params.position) > 32767)) {
            throw new Error("Eine Position von 0 bis 32767 erfordert einen Betriebsauftrag.");
        }
        if (!["0", "1"].includes(params.simulationen)) throw new Error("Simulationen: nur 0 oder 1.");
        return { start, end };
    }

    function normalizeRows(rows) {
        if (!Array.isArray(rows)) throw new Error("QV-Antwort ist keine JSON-Zeilenliste.");
        const errorRow = rows.find(row => row && row.ROW_KIND === "error");
        if (errorRow) throw new Error("Query-Parameter: " + errorRow.ERROR_MESSAGE);
        if (rows.length === 1 && rows[0] && rows[0].ROW_KIND === "empty") {
            return { items: [], groups: [] };
        }
        if (rows.length > MAX_EVENTS) {
            throw new Error("Mehr als 10.000 Arbeitsgaenge. Bitte Zeitraum oder Betriebsauftrag eingrenzen.");
        }
        const ids = new Set();
        const groups = new Map();
        // Query.aspx omits SQL NULL values from JSON, including optional tooltip fields.
        const required = ["EVENT_ID", "RESOURCE_ID", "TITLE", "COLOR_TOKEN",
            "KOST", "MAGR", "RESOURCE_LABEL", "BAUFTRAG", "POSITION", "AG",
            "START_DATE", "PRE_RUN_END", "POST_RUN_START", "END_DATE",
            "AG_STATUS_TEXT", "IS_SIMULATION", "COMPLETION_PERCENT"];
        const items = rows.map(row => {
            if (!row || typeof row !== "object" || row.ROW_KIND !== "event" ||
                required.some(key => !Object.hasOwn(row, key))) {
                throw new Error("QV-Pflichtspalten fehlen. Query-Konfiguration und Spaltenrechte pruefen.");
            }
            if (!row.EVENT_ID || !row.RESOURCE_ID || !row.TITLE || !row.RESOURCE_LABEL ||
                row.BAUFTRAG == null || row.POSITION == null || row.AG == null) {
                throw new Error("Unvollstaendiger Arbeitsgang-/Ressourcenschluessel in der QV-Antwort.");
            }
            if (ids.has(row.EVENT_ID)) throw new Error("Doppelte Arbeitsgang-ID: " + row.EVENT_ID);
            ids.add(row.EVENT_ID);
            if (!Object.hasOwn(COLORS, row.COLOR_TOKEN)) {
                throw new Error("Unbekannte Farbklassifikation: " + row.COLOR_TOKEN);
            }
            const start = parseLocalDate(row.START_DATE);
            const end = parseLocalDate(row.END_DATE);
            parseLocalDate(row.PRE_RUN_END);
            parseLocalDate(row.POST_RUN_START);
            if (end < start) throw new Error("Arbeitsgang endet vor seinem Beginn: " + row.TITLE);
            if (typeof row.COMPLETION_PERCENT !== "number" ||
                row.COMPLETION_PERCENT < 0 || row.COMPLETION_PERCENT > 100) {
                throw new Error("Ungueltiger Fertigstellungsgrad: " + row.TITLE);
            }
            const group = { id: row.RESOURCE_ID, label: row.RESOURCE_LABEL,
                kost: String(row.KOST), magr: String(row.MAGR),
                order: String(row.KOST) + "\u0000" + String(row.MAGR) };
            const previous = groups.get(group.id);
            if (previous && previous.label !== group.label) {
                throw new Error("Widerspruechliche Ressourcen-ID: " + group.id);
            }
            groups.set(group.id, group);
            return { id: row.EVENT_ID, group: row.RESOURCE_ID, start, end,
                type: end.getTime() === start.getTime() ? "point" : "range",
                className: COLORS[row.COLOR_TOKEN][0], row };
        });
        return { items, groups: [...groups.values()].sort((a, b) => a.order.localeCompare(b.order, "de")) };
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function fieldValue(row, key) {
        const value = row[key];
        if (value === null || value === undefined || value === "") return "-";
        if (key === "IS_SIMULATION") return value === true || value === 1 ? "Ja" : "Nein";
        if (key.endsWith("_SECONDS")) return (Number(value) / 3600).toLocaleString("de-DE", { maximumFractionDigits: 2 });
        if (key.endsWith("_DATE") || key === "PRE_RUN_END" || key === "POST_RUN_START") {
            return parseLocalDate(value).toLocaleString("de-DE");
        }
        return typeof value === "number" ? value.toLocaleString("de-DE") : String(value);
    }

    function detailText(row) {
        return FIELDS.map(([key, label]) => label + ": " + fieldValue(row, key)).join("\n");
    }

    function getMembership(row, anchor) {
        if (!anchor || row.BAUFTRAG !== anchor.BAUFTRAG) return "unrelated";
        return String(row.POSITION) === String(anchor.POSITION) ? "work-order" : "production-order";
    }

    function getSequence(items, anchor, mode) {
        return items.filter(item => {
            const relation = getMembership(item.row, anchor);
            return relation === "work-order" || (mode === "production-order" && relation === "production-order");
        }).sort((a, b) => Number(b.row.POSITION) - Number(a.row.POSITION) ||
            Number(a.row.AG) - Number(b.row.AG) || a.id.localeCompare(b.id));
    }

    function orderParameters(params, anchor, mode) {
        if (!anchor || !anchor.BAUFTRAG) throw new Error("Bitte zuerst einen Arbeitsgang auswaehlen.");
        const result = { ...params, bauftrag: String(anchor.BAUFTRAG),
            position: mode === "work-order" ? String(anchor.POSITION) : "", ausserhalb: "1" };
        validateParameters(result);
        return result;
    }

    function mergeOrderModel(base, order, anchor, mode) {
        const matches = item => getMembership(item.row, anchor) === "work-order" ||
            (mode === "production-order" && getMembership(item.row, anchor) === "production-order");
        if (!anchor || order.items.some(item => !matches(item))) {
            throw new Error("Auftragsnachladung enthaelt Arbeitsgaenge ausserhalb des gewaehlten Auftrags.");
        }
        return normalizeRows([...base.items.filter(item => !matches(item)), ...order.items].map(item => item.row));
    }

    async function fetchModel(params, signal) {
        validateParameters(params);
        const queryParams = new URLSearchParams(params);
        queryParams.set("von", params.von.replaceAll("-", ""));
        queryParams.set("bis", params.bis.replaceAll("-", ""));
        const url = new URL("Query.aspx", location.href);
        url.search = new URLSearchParams({ name: QUERY, xhr: "json", param: queryParams.toString() }).toString();
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal });
        if (!response.ok) throw new Error("Query.aspx: HTTP " + response.status);
        let rows;
        try {
            rows = JSON.parse(await response.text());
        } catch (error) {
            if (signal.aborted) throw error;
            throw new Error("Query.aspx liefert kein JSON. Query-/Rollenrechte, SQL und Servermeldung pruefen.", { cause: error });
        }
        return normalizeRows(rows);
    }

    function isResourceVisible(group, filter) {
        const cost = filter.costs.get(group.kost);
        if (!cost) return filter.defaultVisible;
        return cost.overrides.has(group.id) ? cost.overrides.get(group.id) : cost.defaultVisible;
    }

    function setCostVisibility(filter, kost, visible) {
        filter.costs.set(kost, { defaultVisible: visible, overrides: new Map() });
    }

    function setMachineVisibility(filter, group, visible) {
        if (!filter.costs.has(group.kost)) setCostVisibility(filter, group.kost, filter.defaultVisible);
        const cost = filter.costs.get(group.kost);
        if (visible === cost.defaultVisible) cost.overrides.delete(group.id);
        else cost.overrides.set(group.id, visible);
    }

    function sequencePath(source, target) {
        let start = { x: source.right, y: (source.top + source.bottom) / 2 };
        let end = { x: target.left, y: (target.top + target.bottom) / 2 };
        if (Math.abs(end.y - start.y) < 1) {
            if (end.x > start.x + 8) return { start, end, d: `M${start.x},${start.y} L${end.x},${end.y}` };
            start = { x: source.right - Math.min(4, (source.right - source.left) / 2), y: source.top };
            end = { x: target.left + Math.min(4, (target.right - target.left) / 2), y: target.top };
            return { start, end, d: `M${start.x},${start.y} C${start.x},${start.y - 12} ${end.x},${end.y - 12} ${end.x},${end.y}` };
        }
        if (end.x - start.x >= 16) {
            const bend = Math.min(32, (end.x - start.x) / 2);
            return { start, end,
                d: `M${start.x},${start.y} C${start.x + bend},${start.y} ${end.x - bend},${end.y} ${end.x},${end.y}` };
        }
        const downward = end.y > start.y;
        start = { x: source.right - Math.min(4, (source.right - source.left) / 2),
            y: downward ? source.bottom : source.top };
        end = { x: target.left + Math.min(4, (target.right - target.left) / 2),
            y: downward ? target.top : target.bottom };
        const middle = (start.y + end.y) / 2;
        return { start, end,
            d: `M${start.x},${start.y} C${start.x},${middle} ${end.x},${middle} ${end.x},${end.y}` };
    }

    function tooltipPosition(bar, size, viewport) {
        const gap = 12;
        let left = bar.right + gap, top = bar.top;
        if (left + size.width > viewport.width - gap) {
            left = bar.left - size.width - gap;
            if (left < gap) {
                left = bar.left;
                top = bar.bottom + gap;
                if (top + size.height > viewport.height - gap) top = bar.top - size.height - gap;
            }
        }
        return {
            left: Math.max(gap, Math.min(left, viewport.width - size.width - gap)),
            top: Math.max(gap, Math.min(top, viewport.height - size.height - gap))
        };
    }

    function mount() {
        if (instance && instance.root.isConnected) return instance.refresh();
        if (instance) instance.destroy();
        const page = document.querySelector("#content");
        const parent = page && (page.querySelector(".P2FORM") || page);
        if (!parent) throw new Error("Quickview-Inhaltsbereich fehlt.");
        const root = element("section", "production-board");
        root.setAttribute("aria-label", "Produktionsplantafel, nur lesend");
        parent.appendChild(root);
        page.classList.add("production-board-dashboard");
        const stockRefresh = document.querySelector("#auto-refresh");
        const stockRefreshHost = stockRefresh && stockRefresh.parentElement;
        if (stockRefreshHost) stockRefreshHost.classList.add("pb-native-refresh");
        const heading = element("header", "pb-heading");
        heading.append(element("h2", "", "Produktionsplantafel"), element("span", "pb-readonly", "Nur lesend"));
        root.appendChild(heading);
        const status = element("div", "pb-status", "Initialisieren ...");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        root.appendChild(status);
        if (!window.vis || !window.vis.Timeline || !window.vis.DataSet) {
            status.classList.add("pb-error");
            status.textContent = "Lokale Bibliothek Plantafel_Vis_850 fehlt. Quickview-Konfiguration pruefen.";
            console.error(status.textContent);
            return;
        }

        const form = element("form", "pb-filters");
        const inputs = {};
        [["von", "Von", "date"], ["bis", "Bis (inklusiv)", "date"],
            ["bauftrag", "Betriebsauftrag", "text"], ["position", "Position", "text"]].forEach(([name, text, type]) => {
            const label = element("label", "", text);
            const input = element("input");
            input.name = name;
            input.type = type;
            if (type === "date") input.required = true;
            else input.maxLength = name === "bauftrag" ? 19 : 5;
            if (name === "position") input.inputMode = "numeric";
            label.appendChild(input);
            form.appendChild(label);
            inputs[name] = input;
        });
        const simLabel = element("label", "pb-checkbox");
        inputs.simulationen = element("input");
        inputs.simulationen.type = "checkbox";
        simLabel.append(inputs.simulationen, document.createTextNode("Simulationen"));
        const submit = element("button", "", "Laden");
        submit.type = "submit";
        form.append(simLabel, submit);
        root.appendChild(form);

        const toolbar = element("div", "pb-toolbar");
        const searchLabel = element("label", "pb-resource-search", "Ressourcen filtern ");
        const search = element("input");
        search.type = "search";
        search.placeholder = "Kostenstelle / Maschine";
        searchLabel.appendChild(search);
        const resourcePicker = element("details", "pb-resource-picker");
        const resourceSummary = element("summary", "", "KOST / MAGR waehlen");
        const resourcePanel = element("div", "pb-resource-panel");
        const resourceActions = element("div", "pb-resource-actions");
        const showAllResources = element("button", "", "Alle anzeigen");
        const hideAllResources = element("button", "", "Alle ausblenden");
        showAllResources.type = hideAllResources.type = "button";
        resourceActions.append(showAllResources, hideAllResources);
        const resourceTree = element("ul", "pb-resource-tree");
        resourceTree.setAttribute("aria-label", "Kostenstellen und Maschinengruppen");
        resourcePanel.append(searchLabel, resourceActions,
            element("p", "pb-note", "Geladene Maschinengruppen. Auswahl bleibt beim Nachladen erhalten."), resourceTree);
        resourcePicker.append(resourceSummary, resourcePanel);
        toolbar.appendChild(resourcePicker);
        root.appendChild(toolbar);
        const legend = element("div", "pb-legend");
        Object.values(COLORS).forEach(([className, label]) => legend.appendChild(element("span", className, label)));
        root.appendChild(legend);
        root.appendChild(element("p", "pb-note",
            "Nur belegte Maschinen. DB-Ortszeit. Farben: Prototyp-Palette, keine Kapazitaetsberechnung. " +
            "Verschieben/Zoom ueber den geladenen Bereich hinaus laedt automatisch nach. " +
            "Maximal 93 Abfragetage; Balken sind nicht editierbar."));
        const timelineHost = element("div", "pb-timeline");
        timelineHost.setAttribute("aria-label", "Maschinenbelegung");
        timelineHost.tabIndex = 0;
        root.appendChild(timelineHost);
        const hoverTooltip = element("div", "pb-tooltip pb-hover-tooltip");
        hoverTooltip.id = "production-board-hover-tooltip";
        hoverTooltip.setAttribute("role", "tooltip");
        hoverTooltip.hidden = true;
        root.appendChild(hoverTooltip);
        const sequenceStatus = element("p", "pb-note pb-sequence-status",
            "Fuer schematische Folgepfeile einen Arbeitsgang auswaehlen.");
        const details = element("aside", "pb-details");
        details.id = "production-board-details";
        details.hidden = true;
        details.tabIndex = -1;
        details.setAttribute("role", "dialog");
        details.setAttribute("aria-modal", "false");
        details.setAttribute("aria-labelledby", "production-board-detail-title");
        const detailHeader = element("header", "pb-detail-header");
        const detailTitle = element("h3");
        detailTitle.id = "production-board-detail-title";
        const close = element("button", "pb-detail-close", "Schliessen");
        close.type = "button";
        close.setAttribute("aria-label", "Details schliessen");
        detailHeader.append(detailTitle, close);
        const detailBody = element("div", "pb-detail-body");
        const membership = element("section", "pb-membership");
        membership.appendChild(element("h4", "", "Zugehoerigkeit markieren"));
        const membershipButtons = element("div", "pb-membership-buttons");
        const workOrderButton = element("button", "pb-member-work", "Werkstattauftrag");
        const productionOrderButton = element("button", "pb-member-production", "Betriebsauftrag");
        workOrderButton.type = productionOrderButton.type = "button";
        membershipButtons.append(workOrderButton, productionOrderButton);
        const membershipSummary = element("p", "pb-membership-summary");
        const membershipList = element("ul", "pb-related-list");
        const isolateLabel = element("label", "pb-checkbox");
        const isolateInput = element("input");
        isolateInput.type = "checkbox";
        isolateLabel.append(isolateInput, document.createTextNode("Nur Zugehoerige anzeigen"));
        const arrowsLabel = element("label", "pb-checkbox");
        const arrowsInput = element("input");
        arrowsInput.type = "checkbox";
        arrowsInput.checked = true;
        arrowsLabel.append(arrowsInput, document.createTextNode("Schematische Folgepfeile"));
        const outsideLabel = element("label", "pb-checkbox");
        const outsideInput = element("input");
        outsideInput.type = "checkbox";
        outsideLabel.append(outsideInput, document.createTextNode("Auch ausserhalb des Zeitfensters laden"));
        const outsideStatus = element("p", "pb-note pb-order-status");
        outsideStatus.setAttribute("role", "status");
        const membershipNote = element("p", "pb-note");
        membership.append(membershipButtons, isolateLabel, arrowsLabel, outsideLabel, outsideStatus,
            membershipSummary, membershipNote, sequenceStatus, membershipList);
        const detailFields = element("dl");
        detailBody.append(membership, detailFields);
        details.append(detailHeader, detailBody);
        root.appendChild(details);

        const items = new window.vis.DataSet();
        const groups = new window.vis.DataSet();
        const timeline = new window.vis.Timeline(timelineHost, items, groups, {
            editable: false, groupEditable: false, selectable: true, multiselect: false,
            stack: true, orientation: "top", locale: "de",
            height: "100%", verticalScroll: true, zoomKey: "ctrlKey",
            zoomMin: 3600000, zoomMax: 94 * DAY, groupOrder: "sortIndex",
            margin: { item: { horizontal: 3, vertical: 6 }, axis: 12 }
        });
        let baseModel = { items: [], groups: [] };
        let model = baseModel;
        let loadedParams = null;
        let selection = null;
        let controller = null;
        let generation = 0;
        let destroyed = false;
        let timer = null;
        let membershipMode = "work-order";
        let returnFocus = null;
        let isolate = false;
        let arrowFrame = null;
        let rangeTimer = null;
        let rangeRequest = false;
        let ignoreRangeEvents = false;
        let orderController = null;
        let orderGeneration = 0;
        let orderData = null;
        let orderScope = null;
        let outsideWindow = null;
        let outsideSelection = null;
        let hoveredItem = null;
        let hoverTimer = null;
        const resourceFilter = { defaultVisible: true, costs: new Map() };
        let resourceChecks = [];

        function updateResourceChecks() {
            resourceChecks.forEach(cost => {
                let checked = 0;
                cost.children.forEach(child => {
                    child.input.checked = isResourceVisible(child.group, resourceFilter);
                    if (child.input.checked) checked++;
                });
                cost.input.checked = checked === cost.children.length;
                cost.input.indeterminate = checked > 0 && checked < cost.children.length;
            });
            const count = model.groups.filter(group => isResourceVisible(group, resourceFilter)).length;
            resourceSummary.textContent = "KOST / MAGR (" + count + " / " + model.groups.length + " gewaehlt)";
        }

        function buildResourceTree() {
            resourceTree.replaceChildren();
            resourceChecks = [];
            const costs = new Map();
            model.groups.forEach(group => {
                if (!costs.has(group.kost)) costs.set(group.kost, []);
                costs.get(group.kost).push(group);
            });
            costs.forEach((children, kost) => {
                const item = element("li");
                const label = element("label", "pb-checkbox pb-cost-label");
                const input = element("input");
                input.type = "checkbox";
                input.setAttribute("aria-label", "KOST " + kost);
                label.append(input, document.createTextNode(kost));
                const list = element("ul");
                const checks = { input, children: [] };
                input.addEventListener("change", () => {
                    setCostVisibility(resourceFilter, kost, input.checked);
                    updateViewStatus(render());
                });
                children.forEach(group => {
                    const child = element("li");
                    const childLabel = element("label", "pb-checkbox");
                    const childInput = element("input");
                    childInput.type = "checkbox";
                    childInput.setAttribute("aria-label", "MAGR " + group.magr + " (KOST " + kost + ")");
                    childLabel.append(childInput, document.createTextNode(group.magr));
                    child.appendChild(childLabel);
                    list.appendChild(child);
                    checks.children.push({ input: childInput, group });
                    childInput.addEventListener("change", () => {
                        setMachineVisibility(resourceFilter, group, childInput.checked);
                        updateViewStatus(render());
                    });
                });
                resourceChecks.push(checks);
                item.append(label, list);
                resourceTree.appendChild(item);
            });
            updateResourceChecks();
        }

        showAllResources.addEventListener("click", () => {
            resourceFilter.defaultVisible = true;
            resourceFilter.costs.clear();
            updateViewStatus(render());
        });
        hideAllResources.addEventListener("click", () => {
            resourceFilter.defaultVisible = false;
            resourceFilter.costs.clear();
            updateViewStatus(render());
        });

        function hideHover() {
            if (hoverTimer !== null) clearTimeout(hoverTimer);
            hoverTimer = null;
            if (hoveredItem) {
                hoveredItem.classList.remove("pb-hover-expanded");
                hoveredItem.style.removeProperty("--pb-hover-width");
                hoveredItem.style.removeProperty("--pb-hover-shift");
                const content = hoveredItem.querySelector("[data-pb-event-id]");
                if (content) content.removeAttribute("aria-describedby");
                hoveredItem = null;
            }
            hoverTooltip.hidden = true;
        }

        function showHover(event) {
            const node = event.target.closest(".vis-item");
            if (!node || node === hoveredItem) return;
            const content = node.querySelector("[data-pb-event-id]");
            const item = content && model.items.find(candidate => candidate.id === content.dataset.pbEventId);
            if (!item) return;
            hideHover();
            hoveredItem = node;
            hoverTimer = setTimeout(() => {
                hoverTimer = null;
                if (destroyed || !node.isConnected || hoveredItem !== node) return;
                const box = node.getBoundingClientRect();
                const width = Math.ceil(content.getBoundingClientRect().width + 16);
                if (width > box.width) {
                    const panel = timelineHost.querySelector(".vis-panel.vis-center").getBoundingClientRect();
                    const shift = Math.max(panel.left + 4 - box.left, Math.min(0, panel.right - 4 - box.left - width));
                    node.style.setProperty("--pb-hover-width", width + "px");
                    node.style.setProperty("--pb-hover-shift", shift + "px");
                    node.classList.add("pb-hover-expanded");
                }
                content.setAttribute("aria-describedby", hoverTooltip.id);
                hoverTooltip.textContent = detailText(item.row);
                hoverTooltip.hidden = false;
                const size = hoverTooltip.getBoundingClientRect();
                const position = tooltipPosition(node.getBoundingClientRect(), size,
                    { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });
                hoverTooltip.style.left = position.left + "px";
                hoverTooltip.style.top = position.top + "px";
            }, 250);
        }

        function leaveHover(event) {
            if (hoveredItem && (!event.relatedTarget || !hoveredItem.contains(event.relatedTarget))) hideHover();
        }

        timelineHost.addEventListener("pointerover", showHover);
        timelineHost.addEventListener("pointerout", leaveHover);

        function svgElement(tag, attributes) {
            const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
            Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
            return node;
        }

        const arrowSvg = svgElement("svg", { class: "pb-sequence-overlay", "aria-hidden": "true" });
        const defs = svgElement("defs", {});
        const marker = svgElement("marker", { id: "pb-sequence-head", markerWidth: 7, markerHeight: 7,
            refX: 6, refY: 3.5, orient: "auto", markerUnits: "userSpaceOnUse" });
        marker.appendChild(svgElement("path", { d: "M0,0 L7,3.5 L0,7 Z", fill: "#324e6b" }));
        const clip = svgElement("clipPath", { id: "pb-sequence-clip" });
        const clipRect = svgElement("rect", {});
        clip.appendChild(clipRect);
        defs.append(marker, clip);
        const arrowPaths = svgElement("g", { "clip-path": "url(#pb-sequence-clip)" });
        arrowSvg.append(defs, arrowPaths);
        timelineHost.appendChild(arrowSvg);

        function drawConnections() {
            arrowFrame = null;
            if (destroyed) return;
            arrowPaths.replaceChildren();
            const anchor = model.items.find(item => item.id === selection);
            if (!anchor || !arrowsInput.checked) {
                sequenceStatus.textContent = anchor ? "Schematische Folgepfeile ausgeschaltet." :
                    "Fuer schematische Folgepfeile einen Arbeitsgang auswaehlen.";
                return;
            }
            const sequence = getSequence(model.items, anchor.row, membershipMode);
            const hostBox = timelineHost.getBoundingClientRect();
            const panel = timelineHost.querySelector(".vis-panel.vis-center");
            if (!panel) return;
            const panelBox = panel.getBoundingClientRect();
            arrowSvg.setAttribute("viewBox", "0 0 " + hostBox.width + " " + hostBox.height);
            const left = panelBox.left - hostBox.left;
            const top = panelBox.top - hostBox.top;
            clipRect.setAttribute("x", left);
            clipRect.setAttribute("y", top);
            clipRect.setAttribute("width", panelBox.width);
            clipRect.setAttribute("height", panelBox.height);
            const boxes = new Map();
            timelineHost.querySelectorAll("[data-pb-event-id]").forEach(node => {
                const item = node.closest(".vis-item");
                if (item) boxes.set(node.dataset.pbEventId, item.getBoundingClientRect());
            });
            let drawn = 0;
            for (let i = 1; i < sequence.length; i++) {
                const source = boxes.get(sequence[i - 1].id);
                const target = boxes.get(sequence[i].id);
                if (!source || !target) continue;
                const localBox = box => ({ left: box.left - hostBox.left, right: box.right - hostBox.left,
                    top: box.top - hostBox.top, bottom: box.bottom - hostBox.top });
                const path = sequencePath(localBox(source), localBox(target));
                const { x: sx, y: sy } = path.start, { x: tx, y: ty } = path.end;
                if (sx < left || sx > left + panelBox.width || tx < left || tx > left + panelBox.width ||
                    sy < top || sy > top + panelBox.height || ty < top || ty > top + panelBox.height) continue;
                arrowPaths.appendChild(svgElement("path", { d: path.d, class: "pb-sequence-link",
                    "marker-end": "url(#pb-sequence-head)",
                    "data-from": sequence[i - 1].id, "data-to": sequence[i].id }));
                drawn++;
            }
            sequenceStatus.textContent = "Schematische Folge POSITION absteigend / AG aufsteigend: " + drawn + " von " +
                Math.max(0, sequence.length - 1) + " Pfeilen im Ausschnitt. " +
                "Fuer eine gemeinsame Ansicht rechts 'Nur Zugehoerige anzeigen' waehlen; bei Bedarf scrollen/zoomen. " +
                "Keine bestaetigten APplus-Abhaengigkeiten; Luecken durch Zeitraum/Status moeglich.";
        }

        function scheduleConnections() {
            hideHover();
            if (!destroyed && arrowFrame === null) arrowFrame = requestAnimationFrame(drawConnections);
        }

        timeline.on("changed", scheduleConnections);
        timeline.on("rangechange", scheduleConnections);
        timelineHost.addEventListener("scroll", scheduleConnections, { capture: true, passive: true });
        const resizeObserver = new ResizeObserver(scheduleConnections);
        resizeObserver.observe(timelineHost);

        function onRangeChanged() {
            if (destroyed || ignoreRangeEvents || outsideInput.checked || !loadedParams) return;
            if (rangeTimer !== null) clearTimeout(rangeTimer);
            rangeTimer = null;
            if (rangeRequest && controller) {
                ++generation;
                controller.abort();
                controller = null;
                rangeRequest = false;
                outsideInput.disabled = false;
            }
            const range = timeline.getWindow();
            if (coversRange(loadedParams, range.start, range.end)) {
                if (!controller) {
                    root.setAttribute("aria-busy", "false");
                    inputs.von.value = loadedParams.von;
                    inputs.bis.value = shiftDate(loadedParams.bis, -1);
                    updateViewStatus(items.length + " Arbeitsgaenge / " + groups.length + " Ressourcen");
                }
                return;
            }
            root.setAttribute("aria-busy", "true");
            status.classList.remove("pb-error");
            status.textContent = "Ansicht verschoben: neuer Bereich wird nachgeladen. Bisherige Daten noch nicht aktuell.";
            rangeTimer = setTimeout(() => {
                rangeTimer = null;
                const current = timeline.getWindow();
                const next = rangeParameters(current.start, current.end, readInputs(), loadedParams);
                writeInputs(next.params);
                if (next.snapped) {
                    // Whole-day query boundaries must still fit the server's 93-day limit.
                    ignoreRangeEvents = true;
                    try {
                        timeline.setWindow(parseLocalDate(next.params.von), parseLocalDate(next.params.bis), { animation: false });
                    } finally { ignoreRangeEvents = false; }
                }
                refresh(true);
            }, 300);
        }

        timeline.on("rangechanged", onRangeChanged);

        function updateMembership() {
            const anchor = model.items.find(item => item.id === selection);
            const visibleIds = new Set(items.getIds());
            const sameWorkOrder = [];
            const sameProductionOrder = [];
            const updates = [];
            model.items.forEach(item => {
                const relation = getMembership(item.row, anchor && anchor.row);
                if (relation === "work-order") sameWorkOrder.push(item);
                if (relation !== "unrelated") sameProductionOrder.push(item);
                if (!visibleIds.has(item.id)) return;
                let className = item.className;
                if (anchor) {
                    if (item.id === anchor.id) className += " pb-anchor";
                    else if (relation === "work-order") className += " pb-related-work";
                    else if (relation === "production-order" && membershipMode === "production-order") {
                        className += " pb-related-production";
                    } else className += " pb-unrelated";
                }
                updates.push({ id: item.id, className });
            });
            if (updates.length) items.update(updates);
            workOrderButton.setAttribute("aria-pressed", String(membershipMode === "work-order"));
            productionOrderButton.setAttribute("aria-pressed", String(membershipMode === "production-order"));
            membershipNote.textContent =
                "Blau: gleicher BAUFTRAG + POSITION. Orange: andere Position desselben BAUFTRAG. " +
                (outsideInput.checked ? "Auftragsnachladung ohne Zeitfilter; " : "Nur geladener Zeitraum; ") +
                "Status 2/3, planbare Maschinen und wirksame Ressourcen-/Simulationsfilter. " +
                "Pfeile verbinden AG nach POSITION DESC, AG ASC, im Betriebsauftrag auch ueber Positionen hinweg. " +
                "Dies ist eine schematische Reihenfolge, KEINE bestaetigte Terminierungsabhaengigkeit.";
            membershipList.replaceChildren();
            scheduleConnections();
            if (!anchor) return;
            const related = membershipMode === "work-order" ? sameWorkOrder : sameProductionOrder;
            const positions = new Set(sameProductionOrder.map(item => String(item.row.POSITION)));
            membershipSummary.textContent =
                "Werkstattauftrag " + anchor.row.BAUFTRAG + " / " + anchor.row.POSITION + ": " +
                sameWorkOrder.length + " AG. Betriebsauftrag " + anchor.row.BAUFTRAG + ": " +
                sameProductionOrder.length + " AG in " + positions.size + " Positionen. " +
                "In der aktuellen Ressourcenansicht enthalten: " + related.filter(item => visibleIds.has(item.id)).length + ".";
            getSequence(related, anchor.row, membershipMode).forEach(item => {
                const relation = getMembership(item.row, anchor.row);
                membershipList.appendChild(element("li", relation === "work-order" ? "pb-member-work" : "pb-member-production",
                    item.row.TITLE + " | " + item.row.RESOURCE_LABEL));
            });
        }

        function showDetails(row, takeFocus = false) {
            if (row && takeFocus && details.hidden) {
                returnFocus = document.activeElement;
            }
            details.hidden = !row;
            detailTitle.textContent = row ? row.TITLE : "Arbeitsgangdetails";
            detailFields.replaceChildren();
            if (row) FIELDS.forEach(([key, label]) =>
                detailFields.append(element("dt", "", label), element("dd", "", fieldValue(row, key))));
            updateMembership();
            if (row && takeFocus) details.focus({ preventScroll: true });
        }

        function closeDetails() {
            if (outsideInput.checked) stopOutside(false);
            selection = null;
            isolate = false;
            isolateInput.checked = false;
            timeline.setSelection([]);
            updateViewStatus(render());
            const target = returnFocus && returnFocus.isConnected && returnFocus !== document.body ? returnFocus : timelineHost;
            target.focus({ preventScroll: true });
        }

        close.addEventListener("click", closeDetails);
        details.addEventListener("keydown", event => {
            if (event.key === "Escape") { event.preventDefault(); closeDetails(); }
        });
        workOrderButton.addEventListener("click", () => {
            membershipMode = "work-order";
            if (isolate) updateViewStatus(render()); else updateMembership();
            if (outsideInput.checked) loadOrderSequence();
        });
        productionOrderButton.addEventListener("click", () => {
            membershipMode = "production-order";
            if (isolate) updateViewStatus(render()); else updateMembership();
            if (outsideInput.checked) loadOrderSequence();
        });
        isolateInput.addEventListener("change", () => { isolate = isolateInput.checked; updateViewStatus(render()); });
        arrowsInput.addEventListener("change", scheduleConnections);
        outsideInput.addEventListener("change", () => {
            if (outsideInput.checked) {
                outsideWindow = timeline.getWindow();
                outsideSelection = selection;
                if (rangeTimer !== null) clearTimeout(rangeTimer);
                rangeTimer = null;
                if (rangeRequest && controller) {
                    ++generation;
                    controller.abort();
                    controller = null;
                    rangeRequest = false;
                }
                root.setAttribute("aria-busy", "false");
                if (loadedParams) writeInputs(loadedParams);
                loadOrderSequence();
            } else stopOutside();
        });

        function stopOutside(restoreSelection = true) {
            ++orderGeneration;
            if (orderController) orderController.abort();
            orderController = null;
            orderData = orderScope = null;
            outsideInput.checked = false;
            outsideStatus.textContent = "";
            outsideStatus.classList.remove("pb-error");
            membership.setAttribute("aria-busy", "false");
            model = baseModel;
            if (restoreSelection && !model.items.some(item => item.id === selection)) selection = outsideSelection;
            ignoreRangeEvents = true;
            try {
                timeline.setOptions({ zoomMax: 94 * DAY });
                if (outsideWindow) timeline.setWindow(outsideWindow.start, outsideWindow.end, { animation: false });
            } finally { ignoreRangeEvents = false; }
            outsideWindow = outsideSelection = null;
            buildResourceTree();
            updateViewStatus(render());
        }

        function fitOrderSequence() {
            const anchor = model.items.find(item => item.id === selection);
            if (!anchor) return;
            const sequence = getSequence(model.items, anchor.row, membershipMode);
            if (!sequence.length) return;
            const start = Math.min(...sequence.map(item => item.start.getTime()));
            const end = Math.max(...sequence.map(item => item.end.getTime()));
            const padding = Math.max(3600000, (end - start) * 0.05);
            ignoreRangeEvents = true;
            try {
                timeline.setOptions({ zoomMax: Math.max(94 * DAY, end - start + 2 * padding) });
                timeline.setWindow(new Date(start - padding), new Date(end + padding), { animation: false });
            } finally { ignoreRangeEvents = false; }
        }

        async function loadOrderSequence(fit = true, force = false) {
            const current = ++orderGeneration;
            if (orderController) orderController.abort();
            const request = new AbortController();
            orderController = request;
            const timeout = setTimeout(() => request.abort(), 30000);
            membership.setAttribute("aria-busy", "true");
            outsideStatus.classList.remove("pb-error");
            outsideStatus.textContent = "Auftragsfolge ohne Zeitfilter wird geladen ...";
            try {
                const anchor = model.items.find(item => item.id === selection);
                const params = orderParameters(loadedParams, anchor && anchor.row, membershipMode);
                const scope = JSON.stringify(params);
                const order = !force && scope === orderScope ? orderData : await fetchModel(params, request.signal);
                if (current !== orderGeneration || destroyed || !outsideInput.checked) return;
                const combined = mergeOrderModel(baseModel, order, anchor.row, membershipMode);
                if (!combined.items.some(item => item.id === selection)) {
                    throw new Error("Der ausgewaehlte Arbeitsgang ist nicht mehr in der Auftragsfolge enthalten. Bitte aktualisieren.");
                }
                orderData = order;
                orderScope = scope;
                model = combined;
                buildResourceTree();
                updateViewStatus(render());
                if (current !== orderGeneration || !outsideInput.checked) return;
                outsideStatus.textContent = order.items.length + " AG ohne Zeitfilter geladen (Status 2/3). " +
                    "Ressourcenfilter gelten weiterhin. Allgemeines Bereichsnachladen pausiert bis zum Abwaehlen.";
                if (fit) fitOrderSequence();
            } catch (error) {
                if (current !== orderGeneration || destroyed) return;
                const failure = request.signal.aborted ? "Ladeabbruch / Zeitlimit von 30 Sekunden erreicht." : error.message;
                if (!orderData) stopOutside();
                outsideStatus.classList.add("pb-error");
                outsideStatus.textContent = "Auftragsnachladung fehlgeschlagen: " + failure +
                    " Bisherige Daten bleiben erhalten; die Auftragsfolge ist ggf. unvollstaendig.";
                console.error("Produktionsplantafel Auftragsnachladung:", error);
            } finally {
                clearTimeout(timeout);
                if (current === orderGeneration && !destroyed) {
                    orderController = null;
                    membership.setAttribute("aria-busy", "false");
                }
            }
        }

        function updateViewStatus(counts) {
            if (loadedParams && !status.classList.contains("pb-error") && root.getAttribute("aria-busy") !== "true") {
                status.textContent = counts + (isolate ? " | Nur Zugehoerige" : "") +
                    " | Geladen insgesamt: " + model.items.length + " AG | " +
                    loadedParams.von + " bis " + shiftDate(loadedParams.bis, -1) + " (inklusiv)" +
                    (outsideInput.checked ? " | Auftragsfolge zusaetzlich ohne Zeitfilter" : "");
            }
        }

        function render() {
            hideHover();
            const filter = search.value.toLocaleLowerCase("de");
            const visible = model.groups.filter(group => isResourceVisible(group, resourceFilter) &&
                group.label.toLocaleLowerCase("de").includes(filter));
            const allowed = new Set(visible.map(group => group.id));
            let anchor = model.items.find(item => item.id === selection);
            if (!anchor || !allowed.has(anchor.group)) {
                if (outsideInput.checked) {
                    stopOutside(false);
                    return items.length + " Arbeitsgaenge / " + groups.length + " Ressourcen";
                }
                anchor = null;
                selection = null;
                isolate = false;
                isolateInput.checked = false;
            }
            const relatedIds = isolate ? new Set(getSequence(model.items, anchor.row, membershipMode).map(item => item.id)) : null;
            const visibleItems = model.items.filter(item => allowed.has(item.group) && (!relatedIds || relatedIds.has(item.id)));
            const usedGroups = new Set(visibleItems.map(item => item.group));
            const visibleGroups = visible.filter(group => usedGroups.has(group.id));
            items.clear();
            groups.clear();
            groups.add(visibleGroups.map((group, index) => ({
                id: group.id, sortIndex: index, content: element("span", "", group.label)
            })));
            items.add(visibleItems.map(item => {
                const content = element("span", "", item.row.TITLE + " | " + item.row.COMPLETION_PERCENT + "%");
                content.dataset.pbEventId = item.id;
                return {
                    id: item.id, group: item.group, start: item.start, end: item.end, type: item.type,
                    className: item.className, editable: false, content
                };
            }));
            const selected = visibleItems.find(item => item.id === selection);
            selection = selected ? selected.id : null;
            if (selected) timeline.setSelection([selected.id]);
            showDetails(selected ? selected.row : null);
            updateResourceChecks();
            return visibleItems.length + " Arbeitsgaenge / " + visibleGroups.length + " Ressourcen";
        }

        function readInputs() {
            return { von: inputs.von.value, bis: inputs.bis.value ? shiftDate(inputs.bis.value, 1) : "",
                bauftrag: inputs.bauftrag.value.trim(),
                position: inputs.position.value.trim(), simulationen: inputs.simulationen.checked ? "1" : "0" };
        }

        function writeInputs(params) {
            PARAMS.forEach(name => {
                if (name === "simulationen") inputs[name].checked = params[name] === "1";
                else if (name === "bis") inputs[name].value = shiftDate(params[name], -1);
                else inputs[name].value = params[name];
            });
        }

        function showError(error) {
            baseModel = model = { items: [], groups: [] };
            buildResourceTree();
            render();
            status.classList.add("pb-error");
            status.textContent = "Plantafel konnte nicht geladen werden: " + error.message;
            console.error("Produktionsplantafel:", error);
        }

        async function refresh(preserveWindow = false) {
            if (outsideInput.checked) stopOutside();
            if (rangeTimer !== null) clearTimeout(rangeTimer);
            rangeTimer = null;
            const current = ++generation;
            if (controller) controller.abort();
            controller = new AbortController();
            rangeRequest = preserveWindow === true;
            const request = controller;
            const timeout = setTimeout(() => request.abort(new Error("Zeitlimit von 30 Sekunden erreicht.")), 30000);
            root.setAttribute("aria-busy", "true");
            outsideInput.disabled = true;
            status.classList.remove("pb-error");
            status.textContent = "Laden ... bisherige Anzeige wird noch nicht als aktuell bestaetigt.";
            try {
                const params = readInputs();
                const range = validateParameters(params);
                const nextModel = await fetchModel(params, request.signal);
                if (current !== generation || destroyed) return;
                const rangeChanged = !loadedParams || params.von !== loadedParams.von || params.bis !== loadedParams.bis;
                baseModel = model = nextModel;
                buildResourceTree();
                loadedParams = params;
                if (rangeChanged && preserveWindow !== true) {
                    ignoreRangeEvents = true;
                    try { timeline.setWindow(range.start, range.end, { animation: false }); }
                    finally { ignoreRangeEvents = false; }
                }
                const counts = render();
                status.textContent = (model.items.length ? counts : "Keine geplanten Arbeitsgaenge im gewaehlten Zeitraum.") +
                    (isolate ? " | Nur Zugehoerige | Geladen insgesamt: " + model.items.length + " AG" : "") +
                    " | Geladen: " + new Date().toLocaleTimeString("de-DE") +
                    " | " + params.von + " bis " + shiftDate(params.bis, -1) + " (inklusiv)";
            } catch (error) {
                if (current !== generation || destroyed) return;
                const failure = request.signal.aborted ? new Error("Ladeabbruch / Zeitlimit von 30 Sekunden erreicht.") : error;
                if (preserveWindow === true && loadedParams) {
                    writeInputs(loadedParams);
                    status.classList.add("pb-error");
                    status.textContent = "Nachladen fehlgeschlagen: " + failure.message +
                        " | Bisherige Daten bleiben erhalten; der neue Ausschnitt ist ggf. unvollstaendig.";
                    console.error("Produktionsplantafel:", failure);
                } else showError(failure);
            } finally {
                clearTimeout(timeout);
                if (current === generation && !destroyed) {
                    controller = null;
                    rangeRequest = false;
                    root.setAttribute("aria-busy", "false");
                    outsideInput.disabled = false;
                }
            }
        }

        function button(label, action) {
            const node = element("button", "", label);
            node.type = "button";
            node.addEventListener("click", action);
            toolbar.appendChild(node);
        }

        button("Heute", () => {
            const params = readInputs();
            params.von = dateInput(new Date());
            params.bis = shiftDate(params.von, 28);
            writeInputs(params);
            refresh();
        });
        button("Zoom +", () => timeline.zoomIn(0.5));
        button("Zoom -", () => timeline.zoomOut(0.5));
        button("Gesamter Zeitraum", () => {
            if (outsideInput.checked) fitOrderSequence();
            else if (loadedParams) timeline.setWindow(parseLocalDate(loadedParams.von), parseLocalDate(loadedParams.bis));
        });
        function refreshView() {
            return outsideInput.checked ? loadOrderSequence(false, true) : refresh();
        }
        button("Aktualisieren", refreshView);
        const autoLabel = element("label", "pb-checkbox");
        const auto = element("input");
        auto.type = "checkbox";
        autoLabel.append(auto, document.createTextNode("Alle 5 Minuten"));
        auto.addEventListener("change", () => {
            if (timer) clearInterval(timer);
            if (rangeTimer !== null) clearTimeout(rangeTimer);
            timer = auto.checked ? setInterval(() => {
                if (root.getAttribute("aria-busy") !== "true" && !orderController) refreshView();
            }, 300000) : null;
        });
        toolbar.appendChild(autoLabel);

        timeline.on("select", properties => {
            selection = properties.items[0] || null;
            const item = model.items.find(item => item.id === selection);
            if (!item && outsideInput.checked) stopOutside(false);
            if (!item && isolate) { isolate = false; isolateInput.checked = false; updateViewStatus(render()); }
            showDetails(item ? item.row : null, Boolean(item));
            if (outsideInput.checked) {
                if (item) loadOrderSequence();
                else stopOutside(false);
            }
        });
        search.addEventListener("input", () => {
            const counts = render();
            updateViewStatus(counts);
        });
        form.addEventListener("submit", event => { event.preventDefault(); refresh(); });

        instance = {
            root, refresh: refreshView,
            destroy() {
                destroyed = true;
                hideHover();
                ++generation;
                if (controller) controller.abort();
                ++orderGeneration;
                if (orderController) orderController.abort();
                if (rangeTimer !== null) clearTimeout(rangeTimer);
                if (timer) clearInterval(timer);
                if (arrowFrame !== null) cancelAnimationFrame(arrowFrame);
                resizeObserver.disconnect();
                timelineHost.removeEventListener("scroll", scheduleConnections, true);
                timelineHost.removeEventListener("pointerover", showHover);
                timelineHost.removeEventListener("pointerout", leaveHover);
                timeline.off("changed", scheduleConnections);
                timeline.off("rangechange", scheduleConnections);
                timeline.off("rangechanged", onRangeChanged);
                timeline.destroy();
                root.remove();
                page.classList.remove("production-board-dashboard");
                if (stockRefreshHost) stockRefreshHost.classList.remove("pb-native-refresh");
                instance = null;
            }
        };
        showDetails(null);
        try {
            const globalData = document.querySelector("#global-data");
            const provider = document.querySelector('[data-query="' + QUERY + '"]');
            const params = resolveParameters(location.search, globalData && globalData.getAttribute("data-param"),
                provider && provider.getAttribute("data-localparam"), new Date());
            validateParameters(params);
            writeInputs(params);
            return refresh();
        } catch (error) { showError(error); }
    }

    window.addEventListener("pagehide", () => { if (instance) instance.destroy(); });
    window.addEventListener("pageshow", event => { if (event.persisted) mount(); });
    return { mount, refresh: () => instance && instance.refresh(),
        destroy: () => instance && instance.destroy(),
        parseLocalDate, resolveParameters, validateParameters, normalizeRows, getMembership, getSequence,
        rangeParameters, coversRange, isResourceVisible, setCostVisibility, setMachineVisibility, sequencePath,
        orderParameters, mergeOrderModel, tooltipPosition };
})();

function event_page_loaded() {
    return window.ProductionBoard.mount();
}