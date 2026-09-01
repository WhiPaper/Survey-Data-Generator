# Export Contract

## Meaning

Default export is a normal combined survey-response dataset:

```text
original rows
+
synthetic rows
=
final dataset
```

Do not include by default:

```text
origin
is_synthetic
template_response_id
seed
run_id
constraint metadata
validation score
```

Do not add a metadata worksheet by default.

## Row order

Do not simply put all originals before all synthetics.

Default order:

```text
Response Timestamp ascending
```

Synthetic timestamps therefore mix naturally with originals.

Use a seed-stable tie-break for equal timestamps so repeated export of the same Run is stable.

## Time zone

Project stores an IANA timezone:

```ts
interface ProjectTemporalContext {
  timeZone: string
}
```

Default at project creation: OS timezone.

Use this consistently for:

- timestamp profiling
- timestamp generation
- XLSX display

## Columns

Order:

```text
Response Timestamp
question 1
question 2
...
```

based on the Form snapshot order.

Sections do not become columns.

Headers use question titles.

Duplicate titles are minimally disambiguated:

```text
만족도
만족도 (2)
만족도 (3)
```

Do not expose internal question IDs.

## Single choice

One cell with the selected display value.

Other option may render as:

```text
기타: <text>
```

while internal model keeps option and other text separate.

## Checkbox

One question = one export column.

Selected options are rendered in original Form option order:

```text
서비스 A, 서비스 C
```

Absence states become blank cells in normal export.

## Grids

Flatten each grid row to a column.

Example:

```text
서비스 만족도 [가격]
서비스 만족도 [품질]
서비스 만족도 [배송]
```

Checkbox grid row cell contains its selected column labels.

## Ordinal/rating

Export numeric value, not stars/hearts/icons.

XLSX uses numeric cells.

## Numeric short text

If resolved as numeric, XLSX uses number cell.

Identifier-like values with leading zeros remain strings.

## Free text

Raw original text remains unchanged.

Synthetic output follows the selected strategy.

`exclude` removes the column entirely.

## Dates

CSV:

```text
2026-09-02
```

XLSX: date cell + `yyyy-mm-dd`.

Annual no-year dates remain text-like month/day representations such as `09-02`; do not invent a year.

Date+time Form question:

- CSV local semantic datetime, no arbitrary timezone
- XLSX datetime cell

## Time

Time-of-day:

- CSV `14:30`
- XLSX time value + `hh:mm`

Duration:

- CSV `01:45:00`
- XLSX numeric duration + `[h]:mm:ss`

## Response timestamp

CSV uses ISO 8601 with offset:

```text
2026-09-02T09:32:15+09:00
```

XLSX uses a datetime cell displayed in the project timezone.

## File uploads

Do not download/create/duplicate actual files.

Default export value for existing original file answers may use filenames.

Multiple:

```text
file-a.pdf, photo.jpg
```

Synthetic default: blank.

Placeholder mode may emit a synthetic filename but must not imply that a real file exists.

Do not export Drive IDs/URLs by default.

## Original value immutability

Profiler normalization is analysis-only.

If original free text contained whitespace/case oddities, export the original stored semantic value unchanged.

Synthetic categorical values may use canonical generated representation.

## CSV

Default:

```text
UTF-8 with BOM
comma delimiter
CRLF
double-quote escaping
```

Support Korean text and standard office spreadsheet workflows.

### Formula injection

Potentially dangerous string prefixes such as:

```text
=
+
-
@
```

must be exported as safe text, not formulas.

CSV safety layer escapes appropriately.

## XLSX

Default workbook: one sheet, e.g. `응답`.

Useful minimal behavior:

- bold header
- freeze top row
- auto filter
- reasonable clamped column widths
- typed date/time/number cells
- wrap long paragraph cells

Do not apply decorative report themes.

Never serialize user response text as formula cells.

## Export architecture

Compile one logical schema first:

```ts
interface ExportSchema {
  columns: ExportColumn[]
}
```

Both CSV and XLSX consume the same mapped rows, so logical data must match.

Flow:

```text
FormSnapshot
→ ExportSchemaCompiler
→ ExportRowMapper
→ CSV writer / XLSX writer
```

## Save flow

```text
React
→ exports.save
→ TS sidecar
→ host.dialog.save
→ chosen path
→ sidecar streams file to disk
```

Do not send huge datasets/file bytes through React IPC.

CSV must stream.

Use a low-memory XLSX writer where practical.

If an XLSX row limit is exceeded, recommend CSV rather than silently splitting the semantic dataset across multiple sheets.

## Export does not rerun synthesis

A saved `Run` is exported as-is.

Exporting both XLSX and CSV from the same Run must not trigger:

- solver
- mutation
- AI regeneration

Only representation changes.
