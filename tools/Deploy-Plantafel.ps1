<#
  Installs only the QV configuration of Plantafel_01 in APplus Deploy.
  No production/order/master records are written. Requires Windows login.

  npm ci --ignore-scripts
  .\tools\Deploy-Plantafel.ps1 -BackupDirectory <absolute backup directory>

  The existing empty Plantafel_001 becomes a script-only JSON provider.
  Plantafel_Vis_850 is a reusable script-only library (no external CDN).
  JSPAGESCRIPT/CSSSTYLE remain editable through the existing ERP sync.
  SQL/options/library changes require this installer, not just file-save.

  Rollback: restore the backed-up dashboard/query fields via
  flexmobility/utils.xmlUpdateOffline; remove only the newly added
  QVDASHBOARDQUERY links (their GUIDs are printed below). An unlinked
  library query is harmless and may remain for another dashboard.
  The backup contains all previous fields, including the original SQL.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $BackupDirectory
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$base = 'https://applusdeploy.systec-lab.local/APplusdeploy'
$dashboard = 'Plantafel_01'
$provider = 'Plantafel_001'
$library = 'Plantafel_Vis_850'
$dashboardGuid = 'BA8D0503-22C9-4409-A730-F079A57ACB53'
$stem = Join-Path $root 'erp-dashboard\Plantafel_01\dashboard\Plantafel_01__Plantafel_Produktion__BA8D0503-22C9-4409-A730-F079A57ACB53'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Escape-Xml([string] $Value) {
    return [System.Security.SecurityElement]::Escape($Value)
}

function Invoke-ErpRead([string] $Sql) {
    $result = & curl.exe -sS --fail-with-body --negotiate -u : -k --max-time 60 --get --data-urlencode "sql=$Sql" "$base/flexmobility/customutils.asmx/dbFetchJSON"
    if ($LASTEXITCODE -ne 0) { throw "ERP read failed: $result" }
    try { [xml] $xml = $result -join "`n" }
    catch { throw "ERP read did not return XML: $result" }
    if ($xml.DocumentElement.LocalName -ne 'string') { throw "Unexpected ERP read response: $result" }
    $rows = ConvertFrom-Json -InputObject $xml.DocumentElement.InnerText
    foreach ($row in $rows) { Write-Output $row }
}

function Invoke-ErpWrite([string] $Table, [System.Collections.IDictionary] $Fields, [string] $Where = '') {
    if ($Table -notin @('QVQUERY', 'QVDASHBOARD', 'QVDASHBOARDQUERY')) {
        throw "Writing $Table is not allowed by this installer."
    }
    $row = '<row>'
    foreach ($field in $Fields.Keys) {
        $row += "<$field>$(Escape-Xml ([string] $Fields[$field]))</$field>"
    }
    $row += '</row>'
    $method = 'xmlInsert'
    $dataName = 'insertData'
    if ($Where) { $method = 'xmlUpdateOffline'; $dataName = 'updateData' }
    $body = '<?xml version="1.0" encoding="utf-8"?>' +
        '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>' +
        "<$method xmlns=`"http://tempuri.org/`"><table>$Table</table>" +
        "<$dataName>$(Escape-Xml $row)</$dataName>"
    if ($Where) { $body += "<sWhere>$(Escape-Xml $Where)</sWhere>" }
    $body += "</$method></soap12:Body></soap12:Envelope>"
    $temp = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText($temp, $body, $utf8)
        $response = & curl.exe -sS --fail-with-body --negotiate -u : -k --max-time 90 `
            -H 'Content-Type: application/soap+xml; charset=utf-8' `
            --data-binary "@$temp" "$base/flexmobility/utils.asmx"
        if ($LASTEXITCODE -ne 0) { throw "ERP write failed ($Table): $response" }
        [xml] $xml = $response -join "`n"
        if ($xml.SelectSingleNode("//*[local-name()='Fault']")) { throw "SOAP Fault: $response" }
        if (-not $xml.SelectSingleNode("//*[local-name()='$($method)Response']")) {
            throw "Unexpected ERP write response: $response"
        }
    }
    finally { Remove-Item -LiteralPath $temp -Force }
}

function Assert-Fields([string] $Table, [string] $Guid, [System.Collections.IDictionary] $Fields) {
    $columns = ($Fields.Keys | ForEach-Object {
        if ($_ -eq 'OPTIONS') { 'CONVERT(nvarchar(max),[OPTIONS]) AS [OPTIONS]' } else { "[$_]" }
    }) -join ','
    $rows = @(Invoke-ErpRead "SELECT $columns FROM $Table WHERE GUID='$Guid'")
    if ($rows.Count -ne 1) { throw "Read-back failed for $Table / $Guid." }
    foreach ($key in $Fields.Keys) {
        # XML parsers normalize CRLF to LF during SOAP transport.
        $actual = ([string] $rows[0].$key).Replace("`r`n", "`n")
        $expected = ([string] $Fields[$key]).Replace("`r`n", "`n")
        if ($actual -cne $expected) {
            throw "Read-back differs: $Table.$key / $Guid."
        }
    }
}

$dashRows = @(Invoke-ErpRead "SELECT * FROM QVDASHBOARD WHERE QVDASHBOARD='$dashboard' AND GUID='$dashboardGuid'")
$queryRows = @(Invoke-ErpRead "SELECT *,CONVERT(nvarchar(max),OPTIONS) AS OPTIONS_TEXT FROM QVQUERY WHERE QVQUERY IN ('$provider','$library')")
$links = @(Invoke-ErpRead "SELECT * FROM QVDASHBOARDQUERY WHERE QVDASHBOARD='$dashboard'")
if ($dashRows.Count -ne 1) { throw 'Expected linked dashboard was not found.' }
$events = @($queryRows | Where-Object { $_.QVQUERY -eq $provider })
if ($events.Count -ne 1) { throw 'Expected Plantafel_001 provider was not found.' }
if ($events[0].STATEMENT.Trim() -notmatch '^(?i:select\s+1)$' -and
    $events[0].STATEMENT -notlike '*Lesender Quickview-Provider fuer Plantafel_01*' -and
    $events[0].DESCRIPTION -notlike 'Nur lesend: belegte Produktionsressourcen*') {
    throw 'Plantafel_001 has unexpected SQL. Review it before replacing it.'
}
$otherUse = @(Invoke-ErpRead "SELECT QVDASHBOARD FROM QVDASHBOARDQUERY WHERE QVQUERY='$provider' AND QVDASHBOARD<>'$dashboard'")
if ($otherUse.Count) { throw 'Plantafel_001 is used by another dashboard; refusing to change it.' }
if ($links | Where-Object { $_.QVQUERY -notin @($provider, $library) }) {
    throw 'Dashboard contains other elements; refusing to change its page hooks.'
}

$bundle = Join-Path $root 'node_modules\vis-timeline\standalone\umd\vis-timeline-graph2d.min.js'
$bundleCss = Join-Path $root 'node_modules\vis-timeline\styles\vis-timeline-graph2d.min.css'
$license = Join-Path $root 'node_modules\vis-timeline\LICENSE.MIT.txt'
if (-not (Test-Path -LiteralPath $bundle)) { throw 'Run npm ci --ignore-scripts first.' }
$libPackage = Get-Content -Raw -LiteralPath (Join-Path $root 'node_modules\vis-timeline\package.json') | ConvertFrom-Json
if ($libPackage.version -ne '8.5.0') { throw 'Expected pinned vis-timeline 8.5.0.' }

$backupPath = [System.IO.Path]::GetFullPath($BackupDirectory)
[System.IO.Directory]::CreateDirectory($backupPath) | Out-Null
$backup = Join-Path $backupPath ('Plantafel_01-before-' + (Get-Date -Format 'yyyyMMdd-HHmmssfff') + '.json')
@{ dashboard = $dashRows; queries = $queryRows; links = $links } |
    ConvertTo-Json -Depth 20 | ForEach-Object { [System.IO.File]::WriteAllText($backup, $_, $utf8) }
Write-Output "Backup: $backup"

$libRows = @($queryRows | Where-Object { $_.QVQUERY -eq $library })
$libraryGuid = if ($libRows.Count -eq 1) { $libRows[0].GUID } else { [guid]::NewGuid().ToString().ToUpperInvariant() }
$libraryFields = [ordered]@{
    QVQUERY = $library
    TITLE = 'vis-timeline 8.5.0 (lokal, MIT)'
    DESCRIPTION = 'Gepinnte standalone UMD-Bibliothek fuer lesende Plantafeln; kein CDN.'
    STATEMENT = 'SELECT 1 AS LIBRARY'
    SCRIPTONLY = '1'
    VERSION = '20261113'
    JSPAGESCRIPT = ([System.IO.File]::ReadAllText($bundle) -replace '(?m)^//# sourceMappingURL=.*$', '')
    CSSSTYLE = [System.IO.File]::ReadAllText($bundleCss)
    INFO = [System.IO.File]::ReadAllText($license)
}
if ($libRows.Count -eq 1) {
    Invoke-ErpWrite 'QVQUERY' $libraryFields "GUID='$libraryGuid'"
} else {
    $libraryFields['GUID'] = $libraryGuid
    Invoke-ErpWrite 'QVQUERY' $libraryFields
}
Assert-Fields 'QVQUERY' $libraryGuid $libraryFields

$providerGuid = $events[0].GUID
$providerFields = [ordered]@{
    STATEMENT = [System.IO.File]::ReadAllText((Join-Path $root 'erp-dashboard\Plantafel_01\query\Plantafel_001.sql'))
    OPTIONS = [System.IO.File]::ReadAllText((Join-Path $root 'erp-dashboard\Plantafel_01\query\Plantafel_001.options.xml'))
    DESCRIPTION = 'Nur lesend: belegte Produktionsressourcen, Status 2/3, explizit leerer DB-Mandant. Max. 93 Abfragetage / 10.000 Events; Auftragsnachladung mit ausserhalb=1 ohne Zeitfilter nur fuer einen BAUFTRAG. Werkstattauftrag = BAUFTRAG + POSITION. Keine Kapazitaetsberechnung.'
    SCRIPTONLY = '1'
    VERSION = '20261113'
    CACHEDURATION = '0'
    ANP_DIRECTSQL = '0'
}
Invoke-ErpWrite 'QVQUERY' $providerFields "GUID='$providerGuid'"
# SQL Server stores XML canonically, so compare its semantic form below.
$options = $providerFields['OPTIONS']
$providerFields.Remove('OPTIONS')
Assert-Fields 'QVQUERY' $providerGuid $providerFields
$optionRows = @(Invoke-ErpRead "SELECT CONVERT(nvarchar(max),OPTIONS) AS OPTIONS FROM QVQUERY WHERE GUID='$providerGuid'")
if (([xml] $optionRows[0].OPTIONS).DocumentElement.OuterXml -cne ([xml] $options).DocumentElement.OuterXml) {
    throw 'Provider options differ after installation.'
}

$dashFields = [ordered]@{
    JSPAGESCRIPT = [System.IO.File]::ReadAllText("$stem.js")
    CSSSTYLE = [System.IO.File]::ReadAllText("$stem.css")
    ANP_VERSION = '20261113'
}
Invoke-ErpWrite 'QVDASHBOARD' $dashFields "GUID='$dashboardGuid'"
Assert-Fields 'QVDASHBOARD' $dashboardGuid $dashFields
foreach ($name in @($library, $provider)) {
    $existing = @($links | Where-Object { $_.QVQUERY -eq $name })
    if ($existing.Count -gt 1) { throw "Duplicate dashboard link: $name" }
    $linkGuid = if ($existing.Count) { $existing[0].GUID } else { [guid]::NewGuid().ToString().ToUpperInvariant() }
    $linkFields = [ordered]@{ QVDASHBOARD = $dashboard; QVQUERY = $name; ORDERPOSITION = $(if ($name -eq $library) { '1' } else { '2' }) }
    if ($existing.Count) {
        Invoke-ErpWrite 'QVDASHBOARDQUERY' $linkFields "GUID='$linkGuid'"
    } else {
        $linkFields['GUID'] = $linkGuid
        Invoke-ErpWrite 'QVDASHBOARDQUERY' $linkFields
    }
    Assert-Fields 'QVDASHBOARDQUERY' $linkGuid $linkFields
    Write-Output "Verified link: $name / $linkGuid"
}
Write-Output "Verified provider: $provider / $providerGuid"
Write-Output "Verified library: $library / $libraryGuid"
Write-Output "Installed: $base/Quickviews/Dashboard.aspx?name=$dashboard"
