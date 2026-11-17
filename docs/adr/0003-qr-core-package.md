# ADR 0003 — Own QR engine as a workspace package

Status: accepted

## Context

The design needs styled modules, eye shapes, logo plates with error-correction-aware sizing, frames and
captions, rendered identically in the editor and in paid files, and later offered as an npm/API client.

## Decision

`packages/qr-core` (`@heyqr/qr-core`) contains the encoder, renderer, layout composer, payload encoders
and the scan check, with no DOM or Node dependencies in its main entry. Node-only helpers are separate
subpaths: `/raster` (resvg) and `/verify` (ZXing wasm), so the web bundle never loads the decoder.
Tests decode every style and frame with ZXing at several sizes.

## Consequences

The app consumes it from source (`transpilePackages`). Publishing to npm needs a build step (HEY-28).
