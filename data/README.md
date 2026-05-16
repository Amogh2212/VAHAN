# Data Workflow

Use this project data flow:

1. Download free historical VAHAN data from Transport Data Commons.
2. Fill missing 2025-2026 months manually from the official VAHAN dashboard.
3. Keep both sources separate, then combine them in the dashboard/backend later.

## Historical TDC Data

List available TDC resources:

```powershell
npm run data:tdc -- --list
```

Download the default useful historical files:

```powershell
npm run data:tdc
```

Output folder:

```text
data/tdc-history/
```

Default downloads:

- registrations by fuel type
- registrations by maker
- registrations by vehicle category
- FY2011-FY2025 vehicle category + fuel summary

## Manual 2025-2026 VAHAN Fill

After running the downloader, fill:

```text
data/tdc-history/manual_vahan_2025_2026_template.csv
```

Use this for months not covered by TDC, especially after its current coverage
end date. Columns:

- `year`
- `month`
- `state`
- `maker`
- `fuel_type`
- `vehicle_count`
- `source_url`
- `collected_at`
- `notes`

Official dashboard:

https://analytics.parivahan.gov.in/

Only enter aggregate counts. Do not collect owner-level or vehicle-level data.
