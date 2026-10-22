# Project Context

## Project Overview
LosslessCut is a desktop media utility for lossless video and audio trimming, remuxing, and related file operations. This task adds a batch export workflow for files already loaded in the batch list. Batch export processes sources sequentially and can keep segments separate or merge segments within each source file.

## Stack & Architecture
The application uses Electron, React, TypeScript, Vite, FFmpeg, and Yarn 4. The repository root contains the application source under `src/`, language resources under `locales/`, and build scripts under `script/`.

## Constraints & Rules
- Preserve upstream behavior for single-file export unless the user explicitly selects export-all.
- Use existing export and FFmpeg code paths wherever possible.
- Store the batch segment-merge choice on the active batch job so each sequentially opened source uses the selected mode.
- Keep interface text in the existing localization system.
- Do not overwrite source videos. Generated export artifacts belong in the root `Release/` directory for this task.
- Before release packaging, inspect the repository release instructions and local build requirements.

## Glossary
- «Пакетный список» — список исходных файлов, загруженных для пакетной работы.
- «Сегмент» — отмеченный диапазон видео, который LosslessCut экспортирует.
- «Склейка по исходникам» — сегменты одного исходного видео объединяются в один результат, а разные исходные видео остаются отдельными файлами.
