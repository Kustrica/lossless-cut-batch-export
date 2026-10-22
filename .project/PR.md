# PR: Add "Export all files in batch" with a separate batch export mode

## Commit message

```
Add batch export of all files in the batch list

- Export button becomes a split button with "Export all files in batch",
  which opens and exports each batch file in turn using the normal export pipeline
- New persisted `batchExportMode` setting (merge / merge+separate / separate,
  default merge), shown in the export dialog during batch export and in Settings.
  It is applied only to batch export and does not change the normal export mode
- Removing the currently opened file from the batch list (also via
  "Close file and clean up") now opens the file that takes its place
  instead of showing the empty screen
- Keyboard shortcuts dialog: move the reset button to the top and label it
  "Reset all to defaults"

Changelog: Added "Export all files in batch" (next to the Export button) with its own batch export mode setting
```

## PR title

Add "Export all files in batch" with a separate batch export mode

## PR description

### What

Adds a way to export all files in the batch list in one go, using the existing per-file export pipeline.

- **Split Export button**: when a batch is loaded, a dropdown arrow next to Export offers **Export all files in batch**. The currently opened file is exported first, then each remaining batch file is opened and exported sequentially. Notifications are summarized in a single toast at the end ("Batch export finished", including any warnings), and the working indicator shows "Exporting batch item X of Y".
- **Batch export mode** (new persisted setting `batchExportMode`: `merge` (default) | `merge+separate` | `separate`):
  - Shown at the top of the export dialog when exporting a batch (the normal Export mode selector is hidden in that case), and in **Settings -> Options affecting exported files**.
  - Applied per batch only, including the companion "delete per-segment files after merge" behaviour (`merge` = merge and delete segment files, `merge+separate` = keep them, `separate` = no merge). The user's normal Export mode (`autoMerge` / `autoDeleteMergedSegments` / `segmentsToChaptersOnly`) is never modified.
  - Invalid stored values are reset to the default on startup.
- **Batch list removal**: when the currently opened file is removed from the batch (the X in the list, or "Close file and clean up"), the file that now takes its position (or the previous one, if it was the last) is selected and opened instead of showing the empty "drop video here" screen. Removing a non-opened file no longer changes the opened file. Previously removing the last item selected the first item; it now selects the previous one.
- **Keyboard shortcuts dialog**: the existing reset button (which was at the very bottom of the long list and labelled "Reset") is moved next to the search field and labelled "Reset all to defaults". It uses the existing `resetKeyBindings` (double confirmation kept).

### Notes

- Single-file export behaviour is unchanged.
- Merging only applies to files that have 2 or more segments (segments for non-opened files come from their saved project file).
- New English strings were added via `yarn scan-i18n`.
- Translations for the new strings were added for all locales. If you prefer translations to go through Weblate only, the non-`en` locale changes can be dropped from this PR.

### Testing

- `tsc --build`, `eslint` (whole repo) and `vitest run` (148 tests) pass.
- Manually tested on Windows (portable build):
  - Batch export with each batch export mode, with and without export options dialog enabled
  - Batch export mode persists across dialog reopen and app restart; normal Export mode unaffected
  - Removing opened / non-opened / last / only file from the batch list
  - "Reset all to defaults" in the keyboard shortcuts dialog