function event_page_loaded() {
    if (!window.ProductionBoard) {
        throw new Error("Plantafel_Core oder das Produktionsprofil Plantafel_001 fehlt. Query-Verknuepfungen pruefen.");
    }
    return window.ProductionBoard.mount();
}
