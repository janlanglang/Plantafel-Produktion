const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..", "erp-dashboard", "Plantafel_01");
const context = { window: { addEventListener() {} }, URLSearchParams, Date, console };
[
    path.join(root, "query", "Plantafel_Core__Core__A1B3793C-0392-47FE-A85D-BBD77D7EB405.js"),
    path.join(root, "query", "Plantafel_001__Plantafel_Produktion__ED56BE7D-CC7A-4D77-9DC6-615F646B2186.js"),
    path.join(root, "dashboard", "Plantafel_01__Plantafel_Produktion__BA8D0503-22C9-4409-A730-F079A57ACB53.js")
].forEach(file => vm.runInNewContext(fs.readFileSync(file, "utf8"), context));
const board = context.window.ProductionBoard;

function row(overrides = {}) {
    return {
        ROW_KIND: "event", ERROR_MESSAGE: null,
        EVENT_ID: "op:1", RESOURCE_ID: "machine:1", TITLE: "<img src=x onerror=alert(1)>",
        BAUFTRAG: "B123", POSITION: 1, AG: 10, ARTIKEL: "A1", BENENNUNG: "Test", PROJEKT: null,
        KOST: "100", KOST_NAME: "Produktion", MAGR: "01", RESOURCE_LABEL: "100 / 01",
        AG_STATUS_TEXT: "terminiert", AUFTRAG_STATUS: 2, FIXED_CODE: null, IS_SIMULATION: false,
        START_DATE: "2026-07-01T08:00:00", PRE_RUN_END: "2026-07-01T08:15:00",
        POST_RUN_START: "2026-07-01T09:45:00", END_DATE: "2026-07-01T10:00:00",
        MENGE: 10, MENGE_REST: 10, PLANNED_SECONDS: 7200, REMAINING_SECONDS: 7200,
        COMPLETION_PERCENT: 0, COLOR_TOKEN: "COLORAG2", ...overrides
    };
}

test("keeps local DB wall times, milliseconds and point events; rejects rollover", () => {
    const date = board.parseLocalDate("2026-07-01T08:00:00.12");
    assert.equal(date.getHours(), 8);
    assert.equal(date.getMilliseconds(), 120);
    assert.throws(() => board.parseLocalDate("2026-02-30T08:00:00"), /Ungueltige/);
    assert.throws(() => board.parseLocalDate("2026-07-01T08:00:00Z"), /Ungueltige/);
    assert.equal(board.normalizeRows([row({ END_DATE: "2026-07-01T08:00:00" })]).items[0].type, "point");
    assert.throws(() => board.normalizeRows([row({ END_DATE: "2026-06-30T08:00:00" })]), /endet vor/);
});

test("normalizes nested navview parameters without losing explicit overrides", () => {
    const params = board.resolveParameters("?param=von%3D20260701%26bauftrag%3DB123&position=2",
        "bis%253D20260729%2526position%253D1", "bauftrag%3DB456", new Date(2026, 10, 13));
    assert.equal(params.von, "2026-07-01");
    assert.equal(params.bis, "2026-07-29");
    assert.equal(params.bauftrag, "B123");
    assert.equal(params.position, "2");
});

test("enforces exact 93-day bound, including daylight-saving changes, and composite order filter", () => {
    const params = { von: "2026-09-01", bis: "2026-12-03", bauftrag: "", position: "", simulationen: "0" };
    assert.doesNotThrow(() => board.validateParameters(params));
    assert.throws(() => board.validateParameters({ ...params, bis: "2026-12-04" }), /93/);
    assert.throws(() => board.validateParameters({ ...params, bis: params.von }), /93/);
    assert.throws(() => board.validateParameters({ ...params, position: "1" }), /Betriebsauftrag/);
    assert.throws(() => board.validateParameters({ ...params, bauftrag: "B1", position: "32768" }), /32767/);
    assert.throws(() => board.validateParameters({ ...params, simulationen: "yes" }), /Simulationen/);
});

test("keeps same machine code in different cost centers separate and preserves text as text", () => {
    const rows = [row(), row({ EVENT_ID: "op:2", RESOURCE_ID: "machine:2",
        KOST: "200", RESOURCE_LABEL: "200/01 Maschine" })];
    const model = board.normalizeRows(rows);
    assert.equal(model.groups.length, 2);
    assert.equal(model.groups[0].label, "100 / 01");
    assert.equal(model.items[0].row.TITLE, rows[0].TITLE);
    assert.equal(model.items[0].className, "pb-scheduled");
    assert.equal(board.normalizeRows([]).groups.length, 0);
});

test("fails explicitly for missing rights/columns, duplicate IDs, unknown colors and overflow", () => {
    const missing = row();
    delete missing.POSITION;
    assert.throws(() => board.normalizeRows([missing]), /Spaltenrechte/);
    assert.throws(() => board.normalizeRows([row(), row()]), /Doppelte/);
    assert.throws(() => board.normalizeRows([row({ COLOR_TOKEN: "unexpected" })]), /Farbklassifikation/);
    assert.throws(() => board.normalizeRows([row({ COMPLETION_PERCENT: 101 })]), /Fertigstellungsgrad/);
    assert.throws(() => board.normalizeRows(Array(10001).fill(row())), /10.000/);
    assert.throws(() => board.normalizeRows({ rows: [] }), /Zeilenliste/);
});

test("distinguishes server-side validation errors from an explicitly empty result", () => {
    assert.equal(board.normalizeRows([{ ROW_KIND: "empty", ERROR_MESSAGE: null }]).items.length, 0);
    assert.throws(() => board.normalizeRows([{ ROW_KIND: "error", ERROR_MESSAGE: "Zeitraum ungueltig" }]), /Zeitraum ungueltig/);
    assert.throws(() => board.normalizeRows([row(), { ROW_KIND: "empty" }]), /Spaltenrechte/);
});

test("accepts nullable tooltip fields omitted by the live Query.aspx serializer", () => {
    const operation = row();
    delete operation.PROJEKT;
    delete operation.FIXED_CODE;
    delete operation.KOST_NAME;
    assert.equal(board.normalizeRows([operation]).items.length, 1);
});

function resourceRow(overrides = {}) {
    return {
        ROW_KIND: "resource", RESOURCE_ID: "machine:empty", RESOURCE_LABEL: "200 / 02",
        KOST: "200", MAGR: "02", RESOURCE_CODE: "02", ...overrides
    };
}

test("keeps the active resource catalogue and empty cost centers without any operations", () => {
    const model = board.normalizeRows([
        { ROW_KIND: "empty" }, resourceRow(), { ROW_KIND: "team", TEAM_CODE: "300" }
    ]);
    assert.equal(model.items.length, 0);
    assert.equal(model.groups.length, 1);
    assert.equal(model.groups[0].parentId, "200");
    assert.equal(model.teams.map(team => team.id).join(","), "200,300");
    const filter = { defaultVisible: true, costs: new Map() };
    board.setCostVisibility(filter, "200", false);
    assert.equal(board.isResourceVisible(model.groups[0], filter), false);
});

test("counts only operations toward the event limit when the complete resource catalogue is included", () => {
    const model = board.normalizeRows([
        ...Array.from({ length: 10000 }, (_, index) => row({ EVENT_ID: "op:" + index })),
        resourceRow()
    ]);
    assert.equal(model.items.length, 10000);
    assert.equal(model.groups.length, 2);
});

test("refreshes the complete resource catalogue when loading an order outside the time range", () => {
    const base = board.normalizeRows([row(), resourceRow()]);
    const catalogue = resourceRow({ RESOURCE_ID: "machine:new", KOST: "300", RESOURCE_LABEL: "300 / 02" });
    const order = board.normalizeRows([row(), catalogue, { ROW_KIND: "team", TEAM_CODE: "400" }]);
    const merged = board.mergeOrderModel(base, order, row(), "work-order");
    assert.equal(merged.items.length, 1);
    assert.equal(merged.groups.length, 2);
    assert.equal(merged.groups.some(group => group.id === "machine:new"), true);
    assert.equal(merged.groups.some(group => group.id === "machine:empty"), false);
    assert.equal(merged.teams.some(team => team.id === "400"), true);
});

test("accepts exactly 10,000 operations without merging their identities", () => {
    const rows = Array.from({ length: 10000 }, (_, index) => row({ EVENT_ID: "op:" + index }));
    const model = board.normalizeRows(rows);
    assert.equal(model.items.length, 10000);
    assert.equal(model.groups.length, 1);
});

test("distinguishes work order membership from production order membership", () => {
    const anchor = row({ BAUFTRAG: "B123", POSITION: 1, AG: 10 });
    assert.equal(board.getMembership(row({ POSITION: "1", AG: 20 }), anchor), "work-order");
    assert.equal(board.getMembership(row({ POSITION: 2 }), anchor), "production-order");
    assert.equal(board.getMembership(row({ BAUFTRAG: "B124", POSITION: 1 }), anchor), "unrelated");
    assert.equal(board.getMembership(row(), null), "unrelated");
});

test("schematic sequence orders numerically by position DESC then AG ASC, not by time or resource", () => {
    const data = [
        row({ EVENT_ID: "op:1", BAUFTRAG: "B123", POSITION: 10, AG: 10 }),
        row({ EVENT_ID: "op:2", BAUFTRAG: "B123", POSITION: 2, AG: 100 }),
        row({ EVENT_ID: "op:3", BAUFTRAG: "B123", POSITION: 2, AG: 20 }),
        row({ EVENT_ID: "op:4", BAUFTRAG: "B124", POSITION: 1, AG: 10 })
    ];
    const model = board.normalizeRows(data);
    const work = board.getSequence(model.items, data[1], "work-order");
    const production = board.getSequence(model.items, data[1], "production-order");
    assert.equal(work.map(item => item.id).join(","), "op:3,op:2");
    assert.equal(production.map(item => item.id).join(","), "op:1,op:3,op:2");
    assert.equal(model.items[0].id, "op:1");
    assert.equal(board.getSequence(model.items, null, "production-order").length, 0);
});

test("panning requests whole days covering the visible interval and preserves order filters", () => {
    const params = { von: "2025-02-01", bis: "2025-04-01", bauftrag: "B123", position: "2", simulationen: "1" };
    const start = board.parseLocalDate("2025-03-15T12:00:00");
    const end = board.parseLocalDate("2025-05-01T10:00:00");
    const next = board.rangeParameters(start, end, params);
    assert.equal(next.params.von, "2025-03-15");
    assert.equal(next.params.bis, "2025-05-02");
    assert.equal(next.params.bauftrag, "B123");
    assert.equal(next.params.position, "2");
    assert.equal(next.params.simulationen, "1");
    assert.equal(next.snapped, false);
    assert.equal(board.coversRange(params, start, end), false);
    assert.equal(board.coversRange(next.params, start, end), true);
    assert.equal(board.rangeParameters(start, board.parseLocalDate("2025-05-01"), params).params.bis, "2025-05-01");
});

test("order loading overrides form filters with the selected composite scope and keeps simulations", () => {
    const params = { von: "2025-02-01", bis: "2025-04-01", bauftrag: "OLD", position: "9", simulationen: "1" };
    const work = board.orderParameters(params, row({ POSITION: 2 }), "work-order");
    assert.equal(work.bauftrag, "B123");
    assert.equal(work.position, "2");
    assert.equal(work.ausserhalb, "1");
    assert.equal(work.simulationen, "1");
    assert.equal(work.von, params.von);
    assert.equal(board.orderParameters(params, row(), "production-order").position, "");
    assert.equal(params.bauftrag, "OLD");
    assert.throws(() => board.orderParameters(params, null, "work-order"), /auswaehlen/);
});

test("order loading replaces its old scope without duplicates and retains unrelated base operations", () => {
    const base = board.normalizeRows([
        row(), row({ EVENT_ID: "op:2", AG: 20 }),
        row({ EVENT_ID: "op:3", POSITION: 2 }),
        row({ EVENT_ID: "op:4", BAUFTRAG: "OTHER" })
    ]);
    const order = board.normalizeRows([
        row({ COMPLETION_PERCENT: 50 }),
        row({ EVENT_ID: "op:5", START_DATE: "2024-01-01T08:00:00", END_DATE: "2024-01-01T10:00:00" })
    ]);
    const merged = board.mergeOrderModel(base, order, row(), "work-order");
    assert.equal(merged.items.map(item => item.id).sort().join(","), "op:1,op:3,op:4,op:5");
    assert.equal(merged.items.find(item => item.id === "op:1").row.COMPLETION_PERCENT, 50);
    assert.equal(merged.items.find(item => item.id === "op:5").start.getFullYear(), 2024);
    assert.equal(base.items.length, 4);
    assert.throws(() => board.mergeOrderModel(base, board.normalizeRows([row({ POSITION: 2 })]),
        row(), "work-order"), /ausserhalb/);
    const production = board.mergeOrderModel(base, order, row(), "production-order");
    assert.equal(production.items.map(item => item.id).sort().join(","), "op:1,op:4,op:5");
});

test("combined order and period data still enforce the total event limit", () => {
    const base = board.normalizeRows(Array.from({ length: 10000 }, (_, index) =>
        row({ EVENT_ID: "base:" + index, BAUFTRAG: "OTHER" })));
    assert.throws(() => board.mergeOrderModel(base, board.normalizeRows([row()]), row(), "work-order"), /10.000/);
});

test("hover tooltip stays beside the bar, switches sides at the right edge and falls back above wide bars", () => {
    const viewport = { width: 1000, height: 800 }, size = { width: 300, height: 200 };
    const right = board.tooltipPosition({ left: 100, right: 200, top: 100, bottom: 130 }, size, viewport);
    assert.equal(right.left, 212);
    assert.equal(right.top, 100);
    const left = board.tooltipPosition({ left: 800, right: 950, top: 700, bottom: 730 }, size, viewport);
    assert.equal(left.left, 488);
    assert.equal(left.top, 588);
    const above = board.tooltipPosition({ left: 10, right: 950, top: 600, bottom: 630 }, size, viewport);
    assert.equal(above.left, 12);
    assert.equal(above.top, 388);
});

test("maximum zoom snaps to exactly 93 calendar days instead of requesting an invalid 94th day", () => {
    const next = board.rangeParameters(board.parseLocalDate("2026-09-01T12:00:00"),
        board.parseLocalDate("2026-12-03T12:00:00"), { bauftrag: "", position: "", simulationen: "0" });
    assert.equal(next.snapped, true);
    assert.equal(next.params.von, "2026-09-01");
    assert.equal(next.params.bis, "2026-12-03");
    assert.doesNotThrow(() => board.validateParameters(next.params));
});

test("resource tree hides whole cost centers, supports individual exceptions and new machine groups", () => {
    const filter = { defaultVisible: true, costs: new Map() };
    const first = { id: "m:1", parentId: "100", code: "01" };
    const second = { id: "m:2", parentId: "100", code: "02" };
    const otherCost = { id: "m:3", parentId: "200", code: "01" };
    board.setCostVisibility(filter, "100", false);
    assert.equal(board.isResourceVisible(first, filter), false);
    assert.equal(board.isResourceVisible(second, filter), false);
    assert.equal(board.isResourceVisible(otherCost, filter), true);
    board.setMachineVisibility(filter, first, true);
    assert.equal(board.isResourceVisible(first, filter), true);
    assert.equal(board.isResourceVisible(second, filter), false);
    assert.equal(board.isResourceVisible({ id: "m:new", parentId: "100", code: "03" }, filter), false);
    board.setCostVisibility(filter, "100", true);
    assert.equal(board.isResourceVisible(second, filter), true);
    board.setMachineVisibility(filter, first, false);
    assert.equal(board.isResourceVisible(first, filter), false);
    assert.equal(board.isResourceVisible(otherCost, filter), true);
});

test("hiding all resources also hides newly loaded cost centers until explicitly enabled", () => {
    const filter = { defaultVisible: false, costs: new Map() };
    const group = { id: "m:new", parentId: "new", code: "01" };
    assert.equal(board.isResourceVisible(group, filter), false);
    board.setMachineVisibility(filter, group, true);
    assert.equal(board.isResourceVisible(group, filter), true);
    assert.equal(board.isResourceVisible({ ...group, id: "m:later" }, filter), false);
});

test("rolling load range grows without dropping old coverage until the 93-day bound", () => {
    const params = { von: "2025-02-01", bis: "2025-04-01", bauftrag: "", position: "", simulationen: "0" };
    const next = board.rangeParameters(board.parseLocalDate("2025-02-15"),
        board.parseLocalDate("2025-04-15"), params, params);
    assert.equal(next.params.von, "2025-02-01");
    assert.equal(next.params.bis, "2025-04-15");
    assert.equal(next.snapped, false);
});

test("rolling range evicts the opposite edge and always retains the new visible window", () => {
    const params = { von: "2025-02-01", bis: "2025-05-05", bauftrag: "", position: "", simulationen: "0" };
    const right = board.rangeParameters(board.parseLocalDate("2025-03-01"),
        board.parseLocalDate("2025-05-10"), params, params);
    assert.equal(right.params.von, "2025-02-06");
    assert.equal(right.params.bis, "2025-05-10");
    const left = board.rangeParameters(board.parseLocalDate("2025-01-20"),
        board.parseLocalDate("2025-03-01"), params, params);
    assert.equal(left.params.von, "2025-01-20");
    assert.equal(left.params.bis, "2025-04-23");
    [right, left].forEach(next => assert.doesNotThrow(() => board.validateParameters(next.params)));
});

test("overlapping bars use facing vertical edges with no horizontal detour", () => {
    const path = board.sequencePath({ left: 100, right: 200, top: 10, bottom: 40 },
        { left: 180, right: 240, top: 60, bottom: 90 });
    assert.equal(path.start.x, 196);
    assert.equal(path.start.y, 40);
    assert.equal(path.end.x, 184);
    assert.equal(path.end.y, 60);
    assert.equal(path.d, "M196,40 C196,50 184,50 184,60");
    const upward = board.sequencePath({ left: 180, right: 240, top: 60, bottom: 90 },
        { left: 100, right: 200, top: 10, bottom: 40 });
    assert.equal(upward.start.y, 60);
    assert.equal(upward.end.y, 40);
});

test("forward connections stay within their horizontal gap; same-row gaps stay straight", () => {
    const source = { left: 100, right: 200, top: 10, bottom: 40 };
    const forward = board.sequencePath(source, { left: 300, right: 340, top: 60, bottom: 90 });
    assert.equal(forward.d, "M200,25 C232,25 268,75 300,75");
    assert.equal(board.sequencePath(source, { left: 300, right: 340, top: 10, bottom: 40 }).d,
        "M200,25 L300,25");
});

test("the same core accepts an independent profile without production keys, progress or order relationships", () => {
    const other = context.window.PlantafelCore({
        id: "contract-board", query: "Contract_Data", title: "Andere Ressourcenplantafel",
        parameters: [
            { name: "von", label: "Von", type: "date" },
            { name: "bis", label: "Bis (inklusiv)", type: "date" },
            { name: "team", label: "Team", type: "text" }
        ],
        fields: [["TITLE", "Einsatz"]], colors: { SERVICE: ["contract-service", "Service"] },
        requiredFields: ["TEAM", "EMPLOYEE"],
        resource: value => ({ parentId: value.TEAM, parentLabel: value.TEAM,
            code: value.EMPLOYEE, order: value.TEAM + value.EMPLOYEE }),
        validateParameters() {}, validateRow() {},
        formatField: (value, key) => String(value[key]),
        itemTitle: value => value.TITLE, itemContent: value => value.TITLE
    });
    const params = other.resolveParameters("?param=von%3D20250201%26bis%3D20250301%26team%3DA%26bauftrag%3Dignored",
        null, null, new Date(2026, 10, 13));
    assert.equal(params.team, "A");
    assert.equal(Object.hasOwn(params, "bauftrag"), false);
    assert.doesNotThrow(() => other.validateParameters(params));
    const values = [{
        ROW_KIND: "event", EVENT_ID: "service:assignment:1", RESOURCE_ID: "person:1",
        TITLE: "Einsatz", COLOR_TOKEN: "SERVICE", RESOURCE_LABEL: "Team A / Person 1",
        START_DATE: "2025-02-01T08:00:00", END_DATE: "2025-02-01T10:00:00", TEAM: "A", EMPLOYEE: "1"
    }];
    const model = other.normalizeRows(values);
    assert.equal(model.groups[0].parentId, "A");
    assert.equal(model.groups[0].code, "1");
    assert.equal(model.items[0].className, "contract-service");
    assert.equal(other.getSequence(model.items, values[0], "anything").length, 0);
    assert.throws(() => other.orderParameters(params, values[0], "anything"), /unterstuetzt keine/);
    assert.throws(() => board.normalizeRows(values), /Pflichtspalten/);
    assert.equal(board.normalizeRows([row()]).items[0].className, "pb-scheduled");
});
