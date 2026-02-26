# Release Notes

## v2026.02.27

### Highlights
- Enforced gold nisab logic by total 24K-equivalent weight across all gold assets (85g threshold) and auto-synced old records.
- Added session persistence so assets, debts, rates, and dashboard context survive page refresh in the same browser session.
- Improved exports for history tracking:
	- Excel now includes description and notes columns for each asset.
	- PDF now includes dashboard context and renders Arabic text correctly.
- Updated Google Analytics tag to measurement ID `G-Z585XQG0EG`.

### Notes
- PDF generation now uses HTML snapshot rendering to preserve Arabic labels and notes.
- This release focuses on data continuity, reporting quality, and production analytics alignment.

## v2026.02.26.1

### Highlights
- Added and linked a full screenshots gallery in `README.md`.
- Added footer shortcut to open GitHub Issues directly for user feedback.
- Updated Azure Static Web Apps workflow output folder to `dist` for Vite compatibility.

### Notes
- Release metadata and tag created after repository history reset to a single publishing commit.

## v2026.02.26

### Highlights
- Added an investment-funds reference link in the Zakat basis section.
- Hardened repository hygiene with a project-level `.gitignore`.
- Reviewed and reduced personal-looking/static data in UI fallback mappings while preserving behavior.
- Kept contribution URL configured for the project repository.

### Notes
- Build artifacts under `dist/` are excluded from source control.
- This release focuses on privacy cleanup and publish readiness.
