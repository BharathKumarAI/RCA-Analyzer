---
name: RCA Analyzer
description: Bounded, evidence-grounded incident analysis for SREs and platform operators
colors:
  primary: "#6ea4e8"
  primary-glow: "rgba(110, 164, 232, 0.16)"
  secondary: "#8cb8ee"
  accent-teal: "#5bc09e"
  accent-rose: "#f07891"
  accent-amber: "#e8b858"
  neutral-bg: "#101820"
  neutral-card: "#172330"
  neutral-card-hover: "#1d2d3d"
  neutral-card-subtle: "#14202b"
  neutral-line: "#2a3a4b"
  neutral-line-strong: "#40546a"
  text-primary: "#e8eef5"
  text-muted: "#aebccd"
  text-dim: "#8191a3"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-bg}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.neutral-card}"
    rounded: "{rounded.md}"
    padding: "16px"
---

# Design System: RCA Analyzer

## Overview

**Creative North Star: "The Telemetry Terminal"**

RCA Analyzer's design language is built for precision, high cognitive density, and immediate clarity during critical production incidents. The visual hierarchy recedes into the background, providing dark-mode-first contrast that surfaces anomalous metrics, log evidence, and citations with zero ambiguity.

Key Characteristics:
- Low-fatigue dark-mode default with deep blue-slate tonal layering (`#101820` base, `#172330` cards).
- Structured telemetry and evidence cards with monospaced log excerpts and timestamp alignments.
- Semantic status accents (teal for verified recovery, amber for triage warnings, rose for critical root causes).
- Functional, compact density designed for complex multivariable incident analysis.

## Colors

A utilitarian, high-contrast dark palette anchored by deep blue-gray neutrals and crisp semantic indicators.

- **Primary Accent (`#6ea4e8`)**: Interactive triggers, focused states, and current step indicators.
- **Success/Verified Teal (`#5bc09e`)**: Verified citations, passing health checks, and resolved statuses.
- **Critical Rose (`#f07891`)**: Root cause anomalies, validation errors, and high-severity incidents.
- **Warning Amber (`#e8b858`)**: Bounded extraction warnings, timeouts, and pending review states.
- **Background & Elevation**: Dark slate neutrals (`#101820` root, `#172330` surface, `#1d2d3d` interactive hover) separated by hairline borders (`#2a3a4b`).

## Typography

Functional, scannable typographic hierarchy pairing crisp UI sans-serif with high-legibility monospaced data blocks.

- **Display & Section Headers**: Clean bold sans-serif with slight negative tracking for punchy section grouping.
- **Body & Captions**: Standard 13-14px weights engineered for legibility across dense status tables and modal sheets.
- **Data & Telemetry**: Monospaced font stack (`SFMono-Regular`, `Consolas`, monospace) for execution logs, hashes, timestamps, and connector endpoints.

## Layout

- **Shell**: Sticky elevated topbar (52px) with breadcrumbs and connection scope, collapsible 240px sidebar navigation, and fluid responsive content canvas.
- **Density**: Compact table and grid layouts maximizing viewable diagnostic data without horizontal scrolling.
- **Breakpoints**: Desktop-first (1280px+ optimal) with responsive reflow for tablet monitoring.

## Elevation & Depth

- **Tonal Layering**: Depth is created primarily through color contrast between surfaces (`--bg` -> `--card` -> `--card-subtle`) and 1px crisp borders (`--line`).
- **Ambient Shadows**: Subtle dark glows (`rgba(0, 0, 0, 0.22)`) reserved for floating modals, tooltips, and flyout command palettes.

## Shapes

- **Corner Radii**: Utilitarian `4px` (tags, buttons) to `6px` (cards, containers) and `10px` (modals).
- **Forms & Inputs**: Crisp 1px borders with blue accent glow on focus; no rounded pill shapes for data inputs.

## Components

- **Buttons**: Compact 32-36px heights with clear visual hierarchy (primary solid, secondary outlined, tertiary ghost).
- **Evidence Cards**: Bordered cards containing source metadata, timestamp, verification hash, and raw text preview.
- **Status Badges**: Small tinted badges with dot indicators displaying incident severity and capability run status.
- **Timeline Nodes**: Linear progression nodes displaying agent workflow events, tool invocations, and join states.

## Do's and Don'ts

- **Do**: Ground all displayed assertions with clickable evidence links or citation badges.
- **Do**: Maintain monospaced alignment for timestamps, UUIDs, and system logs.
- **Don't**: Use decorative gradient text or animated layout width/height properties that cause visual reflow.
- **Don't**: Introduce pure black (`#000000`) or saturated rainbow accents outside semantic status meanings.
