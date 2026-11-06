# Changelog

## 1.0.0 — 2026-11-06
- First public release.
- Two-step AI tidy: taxonomy (named categories with scope) → per-tab classification with a strict schema (one key per tab), plus a second pass for leftovers.
- Groq engine with model rotation on rate limits; fallbacks to Zen's local AI and to domain grouping.
- Collapsible, colored sections below the pinned line; persisted across restarts.
- Space suggestions, manual editing (rename, drag, move to Space, ungroup, unload, close), one-click undo.
- English and Spanish UI and category names.
