# Project Plan

## Feature: Export all batch files with selectable per-file output grouping

- [x] STEP-01 Inspect the batch list, export dialog, settings persistence, and existing export pipeline.
- [x] STEP-02 Add an export-all action and the two batch output modes (separate segments or merge within each source file) while preserving the current single-file export behavior and the existing export-settings visibility preference.
  - [x] STEP-02a Replace the detached export selector with an integrated split button and bind the selected segment-merge mode to the active batch job.
- [x] STEP-03 Re-verify the refined workflow, review the localized UI copy, and refresh the Windows build artifact in the repository-root `Release/` directory.
