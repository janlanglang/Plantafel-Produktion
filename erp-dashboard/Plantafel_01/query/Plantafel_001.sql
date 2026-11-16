SELECT TOP (10001)
    CASE WHEN a.ERROR_MESSAGE IS NOT NULL THEN N'error'
        WHEN e.WAUFTRAGPOS_ID IS NULL THEN N'empty' ELSE N'event' END AS ROW_KIND,
    a.ERROR_MESSAGE,
    N'production:operation:' + CONVERT(nvarchar(20), e.WAUFTRAGPOS_ID) AS EVENT_ID,
    N'production:machineGroup:' + CONVERT(nvarchar(20), e.MAGR_ID) AS RESOURCE_ID,
    e.WAUFTRAGPOS_ID, e.WAUFTRAG_ID, e.BAUFTRAG, e.POSITION, e.AG,
    e.BAUFTRAG + N' - ' + CONVERT(nvarchar(10), e.POSITION)
        + N' - AG ' + CONVERT(nvarchar(10), e.AG) AS TITLE,
    CONVERT(nvarchar(23), e.START_DATE, 126) AS START_DATE,
    CONVERT(nvarchar(23), e.PRE_RUN_END, 126) AS PRE_RUN_END,
    CONVERT(nvarchar(23), e.POST_RUN_START, 126) AS POST_RUN_START,
    CONVERT(nvarchar(23), e.END_DATE, 126) AS END_DATE,
    e.KOST, e.KOST_NAME, e.MAGR, e.MAGR_NAME,
    e.KOST + N' / ' + e.MAGR AS RESOURCE_LABEL,
    e.ARTIKEL, e.BENENNUNG, e.PROJEKT, e.AG_STATUS,
    CASE e.AG_STATUS WHEN 2 THEN N'terminiert' WHEN 3 THEN N'in Arbeit' END AS AG_STATUS_TEXT,
    e.AUFTRAG_STATUS, e.ISFIXED AS FIXED_CODE,
    CONVERT(bit, CASE WHEN e.PLANAG = 1 THEN 1 ELSE 0 END) AS IS_SIMULATION,
    e.MENGE, e.MENGE_REST, e.T_SOLL AS PLANNED_SECONDS,
    e.T_REST AS REMAINING_SECONDS, e.COMPLETION_PERCENT,
    CASE WHEN e.PLANAG = 1 THEN N'COLORSIMAG'
        WHEN e.AG_STATUS = 2 THEN N'COLORAG2'
        WHEN e.AG_STATUS = 3 AND DATEADD(second,
            CONVERT(int, CEILING(CONVERT(float, e.COMPLETION_PERCENT) / 100.0
                * DATEDIFF(second, e.START_DATE, e.END_DATE))), e.START_DATE) < GETDATE()
            THEN N'COLORAG3NOTOK'
        ELSE N'COLORAG3OK' END AS COLOR_TOKEN,
    NULL AS TEAM_CODE, NULL AS TEAM_NAME, NULL AS RESOURCE_CODE
FROM
(
    SELECT f.*,
        CASE
            WHEN f.VON IS NULL OR f.BIS IS NULL
                OR (N'$P{von}' <> N'' AND (LEN(N'$P{von}') <> 8 OR N'$P{von}' <> CONVERT(nvarchar(8), f.VON, 112)))
                OR (N'$P{bis}' <> N'' AND (LEN(N'$P{bis}') <> 8 OR N'$P{bis}' <> CONVERT(nvarchar(8), f.BIS, 112)))
                THEN N'Datum muss JJJJMMTT entsprechen.'
            WHEN f.VON >= f.BIS OR DATEDIFF(day, f.VON, f.BIS) > 93
                THEN N'Zeitraum muss zwischen 1 und 93 Tagen liegen.'
            WHEN LEN(N'$P{bauftrag}') > 19
                THEN N'Betriebsauftrag darf maximal 19 Zeichen enthalten.'
            WHEN N'$P{position}' <> N'' AND (f.POSITION IS NULL OR f.POSITION < 0 OR N'$P{bauftrag}' = N'')
                THEN N'Position erfordert einen Betriebsauftrag und eine gueltige Positionsnummer.'
            WHEN N'$P{simulationen}' NOT IN (N'0', N'1')
                THEN N'Simulationen muss 0 oder 1 sein.'
            WHEN N'$P{ausserhalb}' NOT IN (N'0', N'1')
                OR (N'$P{ausserhalb}' = N'1' AND N'$P{bauftrag}' = N'')
                THEN N'Ohne Zeitfilter ist ein Betriebsauftrag erforderlich; ausserhalb muss 0 oder 1 sein.'
            ELSE NULL
        END AS ERROR_MESSAGE
    FROM
    (
        SELECT
            TRY_CONVERT(datetime, CASE WHEN N'$P{von}' = N''
                THEN CONVERT(nvarchar(8), GETDATE(), 112) ELSE N'$P{von}' END, 112) AS VON,
            CASE WHEN N'$P{bis}' = N''
                THEN DATEADD(day, 28, TRY_CONVERT(datetime, CASE WHEN N'$P{von}' = N''
                    THEN CONVERT(nvarchar(8), GETDATE(), 112) ELSE N'$P{von}' END, 112))
                ELSE TRY_CONVERT(datetime, N'$P{bis}', 112) END AS BIS,
            TRY_CONVERT(smallint, NULLIF(N'$P{position}', N'')) AS POSITION
    ) AS f
) AS a
LEFT JOIN
(
    SELECT b.*, CONVERT(decimal(5, 2),
        CASE WHEN b.RAW_COMPLETION < 0 THEN 0.0
            WHEN b.RAW_COMPLETION > 100 THEN 100.0
            ELSE b.RAW_COMPLETION END) AS COMPLETION_PERCENT
    FROM
    (
        SELECT
            p.ID AS WAUFTRAGPOS_ID, w.ID AS WAUFTRAG_ID, m.ID AS MAGR_ID,
            p.BAUFTRAG, p.POSITION, p.AG, p.STATUS AS AG_STATUS,
            w.STATUS AS AUFTRAG_STATUS,
            p.KOST, k.NAME_KOST AS KOST_NAME, p.MAGR, m.NAME AS MAGR_NAME,
            p.[START] AS START_DATE, p.ENDE_VLZ AS PRE_RUN_END,
            p.START_NLZ AS POST_RUN_START, p.ENDE AS END_DATE,
            p.ISFIXED, p.PLANAG,
            w.APLAN AS ARTIKEL, w.NAME AS BENENNUNG, w.PROJEKT,
            p.MENGE, p.MENGE_REST, p.T_SOLL, p.T_REST,
            CASE WHEN p.T_SOLL IS NULL OR p.T_SOLL = 0 THEN 0.0
                ELSE ROUND((CONVERT(float, p.T_SOLL) - COALESCE(p.T_REST, 0))
                    * 100.0 / p.T_SOLL, 2)
            END AS RAW_COMPLETION
        FROM dbo.WAUFTRAGPOS AS p
        INNER JOIN dbo.MAGR AS m
            ON m.KOST = p.KOST AND m.MAGR = p.MAGR AND COALESCE(m.MANDANT, N'') = N''
        LEFT JOIN dbo.KOST AS k
            ON k.KOST = p.KOST AND COALESCE(k.MANDANT, N'') = N''
        LEFT JOIN dbo.WAUFTRAG AS w
            ON w.BAUFTRAG = p.BAUFTRAG AND w.POSITION = p.POSITION AND COALESCE(w.MANDANT, N'') = N''
        WHERE COALESCE(p.MANDANT, N'') = N''
            AND m.PLANEN = 1 AND p.STATUS IN (2, 3)
            AND p.[START] IS NOT NULL AND p.ENDE_VLZ IS NOT NULL
            AND p.START_NLZ IS NOT NULL AND p.ENDE IS NOT NULL
            AND p.KOST IS NOT NULL AND p.MAGR IS NOT NULL
            AND (N'$P{simulationen}' = N'1' OR p.PLANAG IS NULL OR p.PLANAG = 0)
            AND (N'$P{bauftrag}' = N'' OR p.BAUFTRAG = N'$P{bauftrag}')
    ) AS b
) AS e
    ON a.ERROR_MESSAGE IS NULL
    AND (N'$P{ausserhalb}' = N'1' OR (e.START_DATE < a.BIS AND e.END_DATE > a.VON))
    AND (N'$P{position}' = N'' OR e.POSITION = a.POSITION)
UNION ALL
SELECT
    CASE WHEN m.ID IS NULL THEN N'team' ELSE N'resource' END AS ROW_KIND,
    NULL AS ERROR_MESSAGE, NULL AS EVENT_ID,
    CASE WHEN m.ID IS NOT NULL THEN N'production:machineGroup:'
        + CONVERT(nvarchar(20), m.ID) END AS RESOURCE_ID,
    NULL AS WAUFTRAGPOS_ID, NULL AS WAUFTRAG_ID, NULL AS BAUFTRAG, NULL AS POSITION, NULL AS AG,
    NULL AS TITLE, NULL AS START_DATE, NULL AS PRE_RUN_END, NULL AS POST_RUN_START, NULL AS END_DATE,
    k.KOST, k.NAME_KOST AS KOST_NAME, m.MAGR, m.NAME AS MAGR_NAME,
    CASE WHEN m.ID IS NOT NULL THEN k.KOST + N' / ' + m.MAGR END AS RESOURCE_LABEL,
    NULL AS ARTIKEL, NULL AS BENENNUNG, NULL AS PROJEKT, NULL AS AG_STATUS,
    NULL AS AG_STATUS_TEXT, NULL AS AUFTRAG_STATUS, NULL AS FIXED_CODE,
    NULL AS IS_SIMULATION, NULL AS MENGE, NULL AS MENGE_REST,
    NULL AS PLANNED_SECONDS, NULL AS REMAINING_SECONDS, NULL AS COMPLETION_PERCENT, NULL AS COLOR_TOKEN,
    k.KOST AS TEAM_CODE, NULL AS TEAM_NAME, m.MAGR AS RESOURCE_CODE
FROM dbo.KOST AS k
LEFT JOIN dbo.MAGR AS m
    ON m.KOST = k.KOST AND m.AKTIV = 1 AND COALESCE(m.MANDANT, N'') = N''
WHERE k.AKTIV = 1 AND COALESCE(k.MANDANT, N'') = N''
ORDER BY KOST, MAGR, START_DATE, BAUFTRAG, POSITION, AG
