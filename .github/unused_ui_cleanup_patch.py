from pathlib import Path

manifest = Path("apps/desktop/package.json")
text = manifest.read_text(encoding="utf-8")
for line in [
    '    "@fontsource-variable/inter": "^5.3.0",\n',
    '    "date-fns": "^4.4.0",\n',
    '    "react-day-picker": "^10.0.1",\n',
    '    "recharts": "3.8.0",\n',
]:
    if text.count(line) != 1:
        raise RuntimeError(f"expected dependency line once: {line.strip()}")
    text = text.replace(line, "", 1)
manifest.write_text(text, encoding="utf-8")

unused = [
    "apps/desktop/src/components/ui/alert-dialog.tsx",
    "apps/desktop/src/components/ui/alert.tsx",
    "apps/desktop/src/components/ui/avatar.tsx",
    "apps/desktop/src/components/ui/badge.tsx",
    "apps/desktop/src/components/ui/calendar.tsx",
    "apps/desktop/src/components/ui/card.tsx",
    "apps/desktop/src/components/ui/chart.tsx",
    "apps/desktop/src/components/ui/collapsible.tsx",
    "apps/desktop/src/components/ui/empty.tsx",
    "apps/desktop/src/components/ui/field.tsx",
    "apps/desktop/src/components/ui/label.tsx",
    "apps/desktop/src/components/ui/popover.tsx",
    "apps/desktop/src/components/ui/separator.tsx",
    "apps/desktop/src/components/ui/sidebar.tsx",
    "apps/desktop/src/components/ui/skeleton.tsx",
    "apps/desktop/src/components/ui/spinner.tsx",
    "apps/desktop/src/components/ui/table.tsx",
    "apps/desktop/src/components/ui/toggle-group.tsx",
    "apps/desktop/src/components/ui/toggle.tsx",
    "apps/desktop/src/components/ui/tooltip.tsx",
    "apps/desktop/src/hooks/use-mobile.ts",
]

for name in unused:
    path = Path(name)
    if not path.is_file():
        raise RuntimeError(f"expected cleanup candidate to exist: {name}")
    path.unlink()
