# Export Contract

## Meaning

Export is a representation of a saved Run result. It does not rerun synthesis.

The default logical table is:

```text
kept source-derived rows
+ approved replacement rows
+ synthetic additions
= final dataset
```

Do not add provenance/debug columns by default, including:

```text
origin
is_synthetic
run_id
candidate_id
replacement flag
seed
```

## Ordering

Default row order is response timestamp ascending with a stable tie-break. Synthetic timestamps therefore mix naturally with source-derived rows.

## Columns

Use Form snapshot order. Sections are not columns. Duplicate titles are minimally disambiguated.

Keep export semantics aligned between CSV and XLSX through one shared logical row mapping.

## Values

- single choice: selected display value
- checkbox: selected options in Form order in one cell
- grids: flatten each grid row to a column
- ordinal/rating: numeric value
- numeric text: numeric cell only when deterministically resolved numeric
- free/high-cardinality text: preserve source text; generated values follow the non-LLM strategy used by the Run
- date/time: typed appropriately
- file upload: do not create/download files; synthetic value blank unless an explicit future placeholder policy exists

## Timestamp

CSV response timestamps use ISO 8601 with offset. XLSX uses datetime cells rendered consistently for the project's selected/display timezone.

A Run created from a submitted-time SourceScope must export exactly that frozen final result; changing the current project scope later has no effect.

## Original replacement

When a Run contains an approved EditPlan, export the approved final replacement row, not the imported source value. The immutable imported observation remains in persistence for provenance/review but is not the final dataset row.

## CSV

Use UTF-8 suitable for common spreadsheet workflows and safe quoting/escaping. User strings must not become spreadsheet formulas.

## XLSX

Keep formatting functional rather than decorative:

- header row
- freeze top row
- auto filter
- reasonable column widths
- typed number/date/time cells
- wrapped long text

## Architecture

Electron Main owns export orchestration and file dialogs. Renderer does not receive huge file byte payloads.

For large exports, write/stream from the application process using a suitable library. The Python compute engine is not required merely to serialize an already-saved Run.
