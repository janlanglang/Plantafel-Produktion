/* Shared read-only Quickview runtime. Business rules belong to the supplied profile. */
window.PlantafelCore = function createPlantafel(profile) {
    "use strict";

    if (!profile || !profile.id || !profile.query || !profile.title || !Array.isArray(profile.parameters) ||
        !Array.isArray(profile.fields) || !Array.isArray(profile.requiredFields) ||
        !profile.colors || typeof profile.colors !== "object" ||
        typeof profile.resource !== "function" || typeof profile.validateRow !== "function" ||
        typeof profile.validateParameters !== "function" || typeof profile.formatField !== "function" ||
        typeof profile.itemTitle !== "function" || typeof profile.itemContent !== "function") {
        throw new Error("Unvollstaendiges Plantafel-Profil.");
    }
    if (!["von", "bis"].every(name => profile.parameters.some(parameter => parameter.name === name && parameter.type === "date")) ||
        profile.parameters.some(parameter => !["date", "text", "checkbox"].includes(parameter.type))) {
        throw new Error("Plantafel-Profil benoetigt gueltige Parameter und die Datumsfelder von/bis.");
    }
    const QUERY = profile.query;
    const MAX_EVENTS = 10000;
    const DAY = 86400000;
    const PARAMS = profile.parameters.map(parameter => parameter.name);
    const COLORS = profile.colors;
    const FIELDS = profile.fields;
    const labels = {
        items: "Eintraege", short: "Eintraege", details: "Details", timeline: "Ressourcenbelegung",
        noItems: "Keine Eintraege im gewaehlten Zeitraum.",
        selectForSequence: "Fuer Folgepfeile einen Eintrag auswaehlen.",
        resourceTitle: "Ressourcen", resourceParent: "Gruppe", resourceChild: "Ressource",
        resourceTree: "Gruppen und Ressourcen", resourceSearch: "Gruppe / Ressource",
        resourceNote: "Geladene Ressourcen. Auswahl bleibt beim Nachladen erhalten.",
        note: "Nur lesend. Verschieben und Zoom ausserhalb des Bereichs laden automatisch nach.",
        ...profile.labels
    };
    const relation = profile.related;
    if (relation && (!relation.primaryMode || !relation.secondaryMode ||
        !["classify", "sequence", "parameters", "summary", "note", "loaded", "sequenceStatus"]
            .every(name => typeof relation[name] === "function"))) {
        throw new Error("Unvollstaendige Zugehoerigkeitsdefinition im Plantafel-Profil.");
    }
    const primaryMode = relation ? relation.primaryMode : "primary";
    const secondaryMode = relation ? relation.secondaryMode : "secondary";
    const helpers = { parseLocalDate, dateInput, shiftDate };
    let instance = null;
    let resumeAfterPageShow = false;

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
        const result = Object.fromEntries(profile.parameters.map(parameter => [parameter.name, parameter.default || ""]));
        result.von = start;
        result.bis = shiftDate(start, 28);
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
        profile.validateParameters(params);
        return { start, end };
    }

    function normalizeRows(rows) {
        const withResources = profile.showEmptyResources || profile.includeResourceCatalog;
        if (!Array.isArray(rows)) throw new Error("QV-Antwort ist keine JSON-Zeilenliste.");
        const errorRow = rows.find(row => row && row.ROW_KIND === "error");
        if (errorRow) throw new Error("Query-Parameter: " + errorRow.ERROR_MESSAGE);
        if (rows.length === 1 && rows[0] && rows[0].ROW_KIND === "empty") {
            return { items: [], groups: [], teams: [], warnings: [], resourceRows: [] };
        }
        const eventCount = rows.filter(row => row && row.ROW_KIND === "event").length;
        if (eventCount > MAX_EVENTS) {
            throw new Error("Mehr als 10.000 Eintraege. Bitte Zeitraum oder fachliche Filter eingrenzen.");
        }
        const ids = new Set();
        const groups = new Map();
        const teams = new Map();
        const warnings = [];
        function addGroup(row) {
            const group = { id: row.RESOURCE_ID, label: row.RESOURCE_LABEL, ...profile.resource(row) };
            if (typeof group.parentId !== "string" || typeof group.parentLabel !== "string" ||
                typeof group.code !== "string" || typeof group.order !== "string") {
                throw new Error("Unvollstaendige Ressourcenhierarchie: " + group.id);
            }
            const previous = groups.get(group.id);
            if (previous && previous.label !== group.label) {
                throw new Error("Widerspruechliche Ressourcen-ID: " + group.id);
            }
            teams.set(group.parentId, group.parentLabel);
            groups.set(group.id, group);
        }
        // Query.aspx omits SQL NULL values from JSON, including optional tooltip fields.
        const required = ["EVENT_ID", "RESOURCE_ID", "TITLE", "COLOR_TOKEN",
            "RESOURCE_LABEL", "START_DATE", "END_DATE", ...profile.requiredFields];
        const items = [];
        rows.forEach(row => {
            if (withResources && eventCount === 0 && row && row.ROW_KIND === "empty") return;
            if (withResources && row && ["team", "resource"].includes(row.ROW_KIND)) {
                if (row.ROW_KIND === "team") {
                    if (typeof row.TEAM_CODE !== "string" || !row.TEAM_CODE) {
                        throw new Error("Teamschluessel fehlt in der QV-Antwort.");
                    }
                    teams.set(row.TEAM_CODE, row.TEAM_NAME ?
                        row.TEAM_CODE + " - " + row.TEAM_NAME : row.TEAM_CODE);
                } else {
                    if (!row.RESOURCE_ID || !row.RESOURCE_LABEL || !row.RESOURCE_CODE) {
                        throw new Error("Ressourcenschluessel fehlt in der QV-Antwort.");
                    }
                    addGroup(row);
                }
                return;
            }
            if (!row || typeof row !== "object" || row.ROW_KIND !== "event" ||
                required.some(key => !Object.hasOwn(row, key))) {
                throw new Error("QV-Pflichtspalten fehlen. Query-Konfiguration und Spaltenrechte pruefen.");
            }
            if (!row.EVENT_ID || !row.RESOURCE_ID || !row.TITLE || !row.RESOURCE_LABEL) {
                throw new Error("Unvollstaendiger Ereignis-/Ressourcenschluessel in der QV-Antwort.");
            }
            if (ids.has(row.EVENT_ID)) throw new Error("Doppelte Ereignis-ID: " + row.EVENT_ID);
            ids.add(row.EVENT_ID);
            if (!Object.hasOwn(COLORS, row.COLOR_TOKEN)) {
                throw new Error("Unbekannte Farbklassifikation: " + row.COLOR_TOKEN);
            }
            let start, end;
            try {
                start = parseLocalDate(row.START_DATE);
                end = parseLocalDate(row.END_DATE);
                if (end < start) throw new Error("Eintrag endet vor seinem Beginn: " + row.TITLE);
            } catch (error) {
                if (!profile.skipInvalidDates) throw error;
                warnings.push({ id: row.EVENT_ID, title: row.TITLE, message: error.message });
                return;
            }
            profile.validateRow(row, helpers);
            addGroup(row);
            items.push({ id: row.EVENT_ID, group: row.RESOURCE_ID, start, end,
                type: end.getTime() === start.getTime() ? "point" : "range",
                className: COLORS[row.COLOR_TOKEN][0], row });
        });
        return { items, groups: [...groups.values()].sort((a, b) => a.order.localeCompare(b.order, "de")),
            teams: [...teams].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "de")),
            warnings, resourceRows: rows.filter(row => row && ["team", "resource"].includes(row.ROW_KIND)) };
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function fieldValue(row, key) {
        return profile.formatField(row, key, helpers);
    }

    function detailText(row) {
        return FIELDS.map(([key, label]) => label + ": " + fieldValue(row, key)).join("\n");
    }

    function getMembership(row, anchor) {
        return relation ? relation.classify(row, anchor) : "unrelated";
    }

    function getSequence(items, anchor, mode) {
        return relation ? relation.sequence(items, anchor, mode) : [];
    }

    function orderParameters(params, anchor, mode) {
        if (!relation) throw new Error("Dieses Profil unterstuetzt keine Zugehoerigkeitsnachladung.");
        const result = relation.parameters(params, anchor, mode);
        validateParameters(result);
        return result;
    }

    function mergeOrderModel(base, order, anchor, mode) {
        const matches = item => getMembership(item.row, anchor) === primaryMode ||
            (mode === secondaryMode && getMembership(item.row, anchor) === secondaryMode);
        if (!anchor || order.items.some(item => !matches(item))) {
            throw new Error("Auftragsnachladung enthaelt Arbeitsgaenge ausserhalb des gewaehlten Auftrags.");
        }
        return normalizeRows([
            ...[...base.items.filter(item => !matches(item)), ...order.items].map(item => item.row),
            ...(order.resourceRows || [])
        ]);
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
        const cost = filter.costs.get(group.parentId);
        if (!cost) return filter.defaultVisible;
        return cost.overrides.has(group.id) ? cost.overrides.get(group.id) : cost.defaultVisible;
    }

    function setCostVisibility(filter, kost, visible) {
        filter.costs.set(kost, { defaultVisible: visible, overrides: new Map() });
    }

    function setMachineVisibility(filter, group, visible) {
        if (!filter.costs.has(group.parentId)) setCostVisibility(filter, group.parentId, filter.defaultVisible);
        const cost = filter.costs.get(group.parentId);
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
        root.setAttribute("aria-label", profile.title + ", nur lesend");
        parent.appendChild(root);
        page.classList.add("production-board-dashboard");
        const stockRefresh = document.querySelector("#auto-refresh");
        const stockRefreshHost = stockRefresh && stockRefresh.parentElement;
        if (stockRefreshHost) stockRefreshHost.classList.add("pb-native-refresh");
        const heading = element("header", "pb-heading");
        heading.append(element("h2", "", profile.title), element("span", "pb-readonly", "Nur lesend"));
        root.appendChild(heading);
        const status = element("div", "pb-status", "Initialisieren ...");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        root.appendChild(status);
        const warnings = element("details", "pb-note");
        warnings.hidden = true;
        const warningSummary = element("summary");
        warningSummary.setAttribute("role", "status");
        const warningList = element("ul");
        warnings.append(warningSummary, warningList);
        root.appendChild(warnings);
        if (!window.vis || !window.vis.Timeline || !window.vis.DataSet) {
            status.classList.add("pb-error");
            status.textContent = "Lokale Bibliothek Plantafel_Vis_850 fehlt. Quickview-Konfiguration pruefen.";
            console.error(status.textContent);
            return;
        }

        const form = element("form", "pb-filters");
        const inputs = {};
        profile.parameters.forEach(parameter => {
            const { name, label: text, type } = parameter;
            const label = element("label", type === "checkbox" ? "pb-checkbox" : "", type === "checkbox" ? undefined : text);
            const input = element("input");
            input.name = name;
            input.type = type;
            if (type === "date") input.required = true;
            if (parameter.maxLength !== undefined) input.maxLength = parameter.maxLength;
            if (parameter.inputMode) input.inputMode = parameter.inputMode;
            label.appendChild(input);
            if (type === "checkbox") label.appendChild(document.createTextNode(text));
            form.appendChild(label);
            inputs[name] = input;
        });
        const submit = element("button", "", "Laden");
        submit.type = "submit";
        form.appendChild(submit);
        root.appendChild(form);

        const toolbar = element("div", "pb-toolbar");
        const searchLabel = element("label", "pb-resource-search", "Ressourcen filtern ");
        const search = element("input");
        search.type = "search";
        search.placeholder = labels.resourceSearch;
        searchLabel.appendChild(search);
        const resourcePicker = element("details", "pb-resource-picker");
        const resourceSummary = element("summary", "", labels.resourceTitle + " waehlen");
        const resourcePanel = element("div", "pb-resource-panel");
        const resourceActions = element("div", "pb-resource-actions");
        const showAllResources = element("button", "", "Alle anzeigen");
        const hideAllResources = element("button", "", "Alle ausblenden");
        showAllResources.type = hideAllResources.type = "button";
        resourceActions.append(showAllResources, hideAllResources);
        const resourceTree = element("ul", "pb-resource-tree");
        resourceTree.setAttribute("aria-label", labels.resourceTree);
        resourcePanel.append(searchLabel, resourceActions,
            element("p", "pb-note", labels.resourceNote), resourceTree);
        resourcePicker.append(resourceSummary, resourcePanel);
        toolbar.appendChild(resourcePicker);
        root.appendChild(toolbar);
        const legend = element("div", "pb-legend");
        Object.values(COLORS).forEach(([className, label]) => legend.appendChild(element("span", className, label)));
        root.appendChild(legend);
        root.appendChild(element("p", "pb-note", labels.note));
        const timelineHost = element("div", "pb-timeline");
        timelineHost.setAttribute("aria-label", labels.timeline);
        timelineHost.tabIndex = 0;
        root.appendChild(timelineHost);
        const hoverTooltip = element("div", "pb-tooltip pb-hover-tooltip");
        hoverTooltip.id = profile.id + "-hover-tooltip";
        hoverTooltip.setAttribute("role", "tooltip");
        hoverTooltip.hidden = true;
        root.appendChild(hoverTooltip);
        const sequenceStatus = element("p", "pb-note pb-sequence-status", labels.selectForSequence);
        const details = element("aside", "pb-details");
        details.id = profile.id + "-details";
        details.hidden = true;
        details.tabIndex = -1;
        details.setAttribute("role", "dialog");
        details.setAttribute("aria-modal", "false");
        details.setAttribute("aria-labelledby", profile.id + "-detail-title");
        const detailHeader = element("header", "pb-detail-header");
        const detailTitle = element("h3");
        detailTitle.id = profile.id + "-detail-title";
        const close = element("button", "pb-detail-close", "Schliessen");
        close.type = "button";
        close.setAttribute("aria-label", "Details schliessen");
        detailHeader.append(detailTitle, close);
        const detailBody = element("div", "pb-detail-body");
        const membership = element("section", "pb-membership");
        membership.hidden = !relation;
        membership.appendChild(element("h4", "", "Zugehoerigkeit markieren"));
        const membershipButtons = element("div", "pb-membership-buttons");
        const workOrderButton = element("button", "pb-member-work", relation ? relation.primaryLabel : "Objekt");
        const productionOrderButton = element("button", "pb-member-production", relation ? relation.secondaryLabel : "Gruppe");
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
        let membershipMode = primaryMode;
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
        const collapsedResourceParents = new Set();
        let resourceChecks = [];

        function updateResourceChecks() {
            resourceChecks.forEach(cost => {
                let checked = 0;
                cost.children.forEach(child => {
                    child.input.checked = isResourceVisible(child.group, resourceFilter);
                    if (child.input.checked) checked++;
                });
                cost.input.checked = cost.children.length ? checked === cost.children.length :
                    isResourceVisible({ parentId: cost.id, id: "" }, resourceFilter);
                cost.input.indeterminate = checked > 0 && checked < cost.children.length;
            });
            const count = model.groups.filter(group => isResourceVisible(group, resourceFilter)).length;
            resourceSummary.textContent = labels.resourceTitle + " (" + count + " / " + model.groups.length + " gewaehlt)";
        }

        function buildResourceTree() {
            resourceTree.replaceChildren();
            resourceChecks = [];
            const costs = new Map();
            const teamLabels = new Map((model.teams || []).map(team => [team.id, team.label]));
            teamLabels.forEach((label, id) => costs.set(id, []));
            model.groups.forEach(group => {
                if (!costs.has(group.parentId)) costs.set(group.parentId, []);
                costs.get(group.parentId).push(group);
            });
            costs.forEach((children, kost) => {
                const item = element("li");
                const label = element("label", "pb-checkbox pb-cost-label");
                const input = element("input");
                input.type = "checkbox";
                const parentLabel = teamLabels.get(kost) || children[0].parentLabel;
                input.setAttribute("aria-label", labels.resourceParent + " " + parentLabel);
                label.append(input, document.createTextNode(parentLabel));
                const list = element("ul");
                const heading = element("div", "pb-resource-parent");
                const toggle = element("button", "pb-resource-toggle");
                toggle.type = "button";
                toggle.disabled = children.length === 0;
                function updateExpanded() {
                    const expanded = !collapsedResourceParents.has(kost);
                    list.hidden = !expanded;
                    toggle.textContent = expanded ? "\u25be" : "\u25b8";
                    toggle.setAttribute("aria-expanded", String(expanded));
                    toggle.setAttribute("aria-label", labels.resourceParent + " " + parentLabel +
                        (expanded ? " zuklappen" : " aufklappen"));
                }
                toggle.addEventListener("click", () => {
                    if (collapsedResourceParents.has(kost)) collapsedResourceParents.delete(kost);
                    else collapsedResourceParents.add(kost);
                    updateExpanded();
                });
                updateExpanded();
                const checks = { id: kost, input, children: [] };
                input.addEventListener("change", () => {
                    setCostVisibility(resourceFilter, kost, input.checked);
                    updateViewStatus(render());
                });
                children.forEach(group => {
                    const child = element("li");
                    const childLabel = element("label", "pb-checkbox");
                    const childInput = element("input");
                    childInput.type = "checkbox";
                    const displayName = group.displayName || group.code;
                    childInput.setAttribute("aria-label", labels.resourceChild + " " + displayName +
                        " (" + labels.resourceParent + " " + parentLabel + ")");
                    childLabel.append(childInput, document.createTextNode(displayName));
                    child.appendChild(childLabel);
                    list.appendChild(child);
                    checks.children.push({ input: childInput, group });
                    childInput.addEventListener("change", () => {
                        setMachineVisibility(resourceFilter, group, childInput.checked);
                        updateViewStatus(render());
                    });
                });
                resourceChecks.push(checks);
                heading.append(toggle, label);
                item.append(heading, list);
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
        const marker = svgElement("marker", { id: profile.id + "-sequence-head", markerWidth: 7, markerHeight: 7,
            refX: 6, refY: 3.5, orient: "auto", markerUnits: "userSpaceOnUse" });
        marker.appendChild(svgElement("path", { d: "M0,0 L7,3.5 L0,7 Z", fill: "#324e6b" }));
        const clip = svgElement("clipPath", { id: profile.id + "-sequence-clip" });
        const clipRect = svgElement("rect", {});
        clip.appendChild(clipRect);
        defs.append(marker, clip);
        const arrowPaths = svgElement("g", { "clip-path": "url(#" + profile.id + "-sequence-clip)" });
        arrowSvg.append(defs, arrowPaths);
        timelineHost.appendChild(arrowSvg);

        function drawConnections() {
            arrowFrame = null;
            if (destroyed) return;
            arrowPaths.replaceChildren();
            const anchor = model.items.find(item => item.id === selection);
            if (!relation || !anchor || !arrowsInput.checked) {
                sequenceStatus.textContent = anchor ? "Schematische Folgepfeile ausgeschaltet." :
                    labels.selectForSequence;
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
                    "marker-end": "url(#" + profile.id + "-sequence-head)",
                    "data-from": sequence[i - 1].id, "data-to": sequence[i].id }));
                drawn++;
            }
            sequenceStatus.textContent = relation.sequenceStatus(drawn, Math.max(0, sequence.length - 1));
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
                    updateViewStatus(items.length + " " + labels.items + " / " + groups.length + " Ressourcen");
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
            const anchor = relation && model.items.find(item => item.id === selection);
            const visibleIds = new Set(items.getIds());
            const sameWorkOrder = [];
            const sameProductionOrder = [];
            const updates = [];
            model.items.forEach(item => {
                const relation = getMembership(item.row, anchor && anchor.row);
                if (relation === primaryMode) sameWorkOrder.push(item);
                if (relation !== "unrelated") sameProductionOrder.push(item);
                if (!visibleIds.has(item.id)) return;
                let className = item.className;
                if (anchor) {
                    if (item.id === anchor.id) className += " pb-anchor";
                    else if (relation === primaryMode) className += " pb-related-work";
                    else if (relation === secondaryMode && membershipMode === secondaryMode) {
                        className += " pb-related-production";
                    } else className += " pb-unrelated";
                }
                updates.push({ id: item.id, className });
            });
            if (updates.length) items.update(updates);
            workOrderButton.setAttribute("aria-pressed", String(membershipMode === primaryMode));
            productionOrderButton.setAttribute("aria-pressed", String(membershipMode === secondaryMode));
            membershipNote.textContent = relation ? relation.note(outsideInput.checked) : "";
            membershipList.replaceChildren();
            scheduleConnections();
            if (!anchor) return;
            const related = membershipMode === primaryMode ? sameWorkOrder : sameProductionOrder;
            membershipSummary.textContent = relation.summary(anchor.row, sameWorkOrder, sameProductionOrder,
                related.filter(item => visibleIds.has(item.id)).length);
            getSequence(related, anchor.row, membershipMode).forEach(item => {
                const relation = getMembership(item.row, anchor.row);
                membershipList.appendChild(element("li", relation === primaryMode ? "pb-member-work" : "pb-member-production",
                    profile.itemTitle(item.row) + " | " + item.row.RESOURCE_LABEL));
            });
        }

        function showDetails(row, takeFocus = false) {
            if (row && takeFocus && details.hidden) {
                returnFocus = document.activeElement;
            }
            details.hidden = !row;
            detailTitle.textContent = row ? profile.itemTitle(row) : labels.details;
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
            membershipMode = primaryMode;
            if (isolate) updateViewStatus(render()); else updateMembership();
            if (outsideInput.checked) loadOrderSequence();
        });
        productionOrderButton.addEventListener("click", () => {
            membershipMode = secondaryMode;
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
                    throw new Error("Der ausgewaehlte Eintrag ist nicht mehr in der Folge enthalten. Bitte aktualisieren.");
                }
                orderData = order;
                orderScope = scope;
                model = combined;
                buildResourceTree();
                updateViewStatus(render());
                if (current !== orderGeneration || !outsideInput.checked) return;
                outsideStatus.textContent = relation.loaded(order.items.length);
                if (fit) fitOrderSequence();
            } catch (error) {
                if (current !== orderGeneration || destroyed) return;
                const failure = request.signal.aborted ? "Ladeabbruch / Zeitlimit von 30 Sekunden erreicht." : error.message;
                if (!orderData) stopOutside();
                outsideStatus.classList.add("pb-error");
                outsideStatus.textContent = "Auftragsnachladung fehlgeschlagen: " + failure +
                    " Bisherige Daten bleiben erhalten; die Auftragsfolge ist ggf. unvollstaendig.";
                console.error(profile.title + " Zugehoerigkeitsnachladung:", error);
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
                    " | Geladen insgesamt: " + model.items.length + " " + labels.short + " | " +
                    loadedParams.von + " bis " + shiftDate(loadedParams.bis, -1) + " (inklusiv)" +
                    (outsideInput.checked ? " | Auftragsfolge zusaetzlich ohne Zeitfilter" : "");
            }
        }

        function render() {
            hideHover();
            const skipped = model.warnings || [];
            warnings.hidden = skipped.length === 0;
            warningSummary.textContent = skipped.length ?
                "Warnung: " + skipped.length + " Eintraege mit ungueltigen Zeiten uebersprungen. Details anzeigen." : "";
            warningList.replaceChildren(...skipped.map(warning =>
                element("li", "", warning.title + " [" + warning.id + "]: " + warning.message)));
            const filter = search.value.toLocaleLowerCase("de");
            const visible = model.groups.filter(group => isResourceVisible(group, resourceFilter) &&
                group.label.toLocaleLowerCase("de").includes(filter));
            const allowed = new Set(visible.map(group => group.id));
            let anchor = model.items.find(item => item.id === selection);
            if (!anchor || !allowed.has(anchor.group)) {
                if (outsideInput.checked) {
                    stopOutside(false);
                    return items.length + " " + labels.items + " / " + groups.length + " Ressourcen";
                }
                anchor = null;
                selection = null;
                isolate = false;
                isolateInput.checked = false;
            }
            const relatedIds = isolate ? new Set(getSequence(model.items, anchor.row, membershipMode).map(item => item.id)) : null;
            const visibleItems = model.items.filter(item => allowed.has(item.group) && (!relatedIds || relatedIds.has(item.id)));
            const usedGroups = new Set(visibleItems.map(item => item.group));
            const visibleGroups = profile.showEmptyResources ? visible : visible.filter(group => usedGroups.has(group.id));
            items.clear();
            groups.clear();
            groups.add(visibleGroups.map((group, index) => ({
                id: group.id, sortIndex: index, content: element("span", "", group.label)
            })));
            items.add(visibleItems.map(item => {
                const content = element("span", "", profile.itemContent(item.row));
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
            return visibleItems.length + " " + labels.items + " / " + visibleGroups.length + " Ressourcen";
        }

        function readInputs() {
            return Object.fromEntries(PARAMS.map(name => {
                const input = inputs[name];
                let value = input.type === "checkbox" ? (input.checked ? "1" : "0") : input.value.trim();
                if (name === "bis" && value) value = shiftDate(value, 1);
                return [name, value];
            }));
        }

        function writeInputs(params) {
            PARAMS.forEach(name => {
                if (inputs[name].type === "checkbox") inputs[name].checked = params[name] === "1";
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
            console.error(profile.title + ":", error);
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
                status.textContent = (model.items.length ? counts : labels.noItems) +
                    (isolate ? " | Nur Zugehoerige | Geladen insgesamt: " + model.items.length + " " + labels.short : "") +
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
                    console.error(profile.title + ":", failure);
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

    window.addEventListener("pagehide", () => {
        if (instance) { resumeAfterPageShow = true; instance.destroy(); }
    });
    window.addEventListener("pageshow", event => {
        if (event.persisted && resumeAfterPageShow) { resumeAfterPageShow = false; mount(); }
    });
    return { mount, refresh: () => instance && instance.refresh(),
        destroy: () => { resumeAfterPageShow = false; if (instance) instance.destroy(); },
        parseLocalDate, resolveParameters, validateParameters, normalizeRows, getMembership, getSequence,
        rangeParameters, coversRange, isResourceVisible, setCostVisibility, setMachineVisibility, sequencePath,
        orderParameters, mergeOrderModel, tooltipPosition };
};