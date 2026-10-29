# External Fire Spread Studio

External Fire Spread Studio is a browser application for checking external fire spread between buildings by radiant heat. You draw the site boundaries and the building as storey blocks, place the openings on each wall, and the application works out the radiant heat received along each boundary, whether each fire compartment passes, and how far the building would need to move to meet the limit.

It is a single HTML file. It runs offline once loaded, keeps everything in the browser, and works on desktop browsers and on iPad (Safari).

**Live version:** https://vinnleo99.github.io/external-fire-spread-studio/

## Important: not a substitute for professional judgement

This application is an aid to calculation. It is not a substitute for the judgement of a competent fire engineer. The results depend entirely on the geometry and assumptions entered, and the method has limitations (listed below). Any design decision, submission or approval must be checked and signed off by a suitably qualified and competent person. No warranty is given, and no responsibility is accepted for any use of the results.

## What it does

- **Site plan:** draw relevant and notional boundaries as straight, angled or stepped lines, and storey blocks as rectangles or outlines. Grid snapping, point dragging, point insertion and deletion, and numeric co-ordinates are available.
- **Building model:** each storey block has its own footprint, base level, number of storeys, floor-to-floor height and fire compartment, so set-back and stepped floors are modelled as real geometry. Walls are generated from the footprints, and openings are edited on each wall's elevation.
- **Results:** pass or fail, the peak received intensity along each boundary shown on plan, a heat-mapped surface along each boundary in the three-dimensional view, results for each boundary, compartment and face, the governing openings, the uniform offset that just meets the limit, and a printable report.
- **Simple elevation:** a single-façade method for quick checks of one elevation.
- **Project files:** projects are saved to and opened from `.efs.json` files on your own device.

### Using it on an iPad

Open the live address in Safari. To use it like an application, tap Share, then Add to Home Screen. On a touch screen:

- drag with one finger to move a point, an opening or the view;
- pinch with two fingers to zoom and drag with two fingers to pan the plan;
- double-tap instead of double-clicking (to finish a line or add a point);
- in the three-dimensional view, drag with one finger to orbit and pinch to zoom.

## Method summary

- Each unprotected area (window, door, non-fire-resisting wall) is treated as a uniform rectangular radiator. The source intensity is 84 kilowatts per square metre for residential, office, assembly and recreation uses, and 168 kilowatts per square metre for shop and commercial, industrial, storage and other non-residential uses, following Approved Document B and BR 187. Combustible cladding counts at half its area.
- The configuration factor from each rectangle to each receiver point is calculated exactly by contour integration, for any receiver orientation, rather than read from tables.
- Receiver points are placed along the real boundary line at a range of heights. By default the receiver is the mirror image of the building across the local boundary line (the relevant boundary is half the separation); placing the receiver on the boundary is available as an option. Three receiver orientations are checked.
- The received intensity is the sum, over the openings of one fire compartment, of source intensity multiplied by unprotected fraction and configuration factor. Compartments are assumed to burn one at a time, and the worst compartment governs. The limit is 12.6 kilowatts per square metre.
- Sprinkler allowances (halving the source intensity, or doubling the permitted unprotected area) and an optional approximate allowance for shielding by other parts of the building are available.

## Validation status

- The configuration factor routine has been checked against the closed-form corner formula for parallel surfaces, against the perpendicular-surface equation in BR 187, and against numerical integration for oblique surfaces. The agreement is to rounding error for the closed forms, and within about 0.013 per cent for the numerical integration. The figures are shown in the application's report.
- The boundary distances produced by the engine have been compared privately with the published table in BR 187 (1991 edition) across its full range. The summary statistics of that comparison are shown in the application's report, but the table values themselves are not included in this repository (see below).
- The site engine has been checked against the earlier single-façade engine and a separate Python reference implementation (required distances and enclosing rectangles), against numerical integration for a stepped building, for rotation invariance, and for consistency between the mirror-image and on-boundary receiver options.
- The application has not been independently peer reviewed. Treat it as a checking tool under development.

## Limitations

- Only radiation is modelled. Flame projection, convective spread, fire spread over the external surface, and the reaction to fire of materials are not assessed.
- Radiators are uniform rectangles at a fixed intensity. Real fires, partial openings and non-rectangular openings are approximated.
- The shielding allowance is approximate, and is off by default.
- The boundary is treated as a sequence of straight segments in plan; terrain and level differences across the boundary are not modelled.
- Results must be read alongside the current guidance (for example Approved Document B and BR 187) and any project-specific fire strategy.

## Public version and licensed data

This public version does not include the values of Table 1 of BR 187 (1991 edition), which are Crown copyright. Where the full version shows those values for comparison, this version shows "Table values not included in this public version". All calculations are unaffected, because the engine calculates distances from first principles. The automated test suite compares against that table, so it is kept with the licensed data and is not published here.

## Building

You need Node.js 20 or later.

```
npm install
npm run build        # writes dist/index.html (a single self-contained file)
npm run build:pages  # builds and copies the result into docs/ for GitHub Pages
npm run dev          # local development server
```

The iPad check (`npm run check:ipad -- <address or file> <screenshot folder>`) runs the built application in WebKit with iPad emulation in portrait and landscape. It needs the Playwright WebKit browser (`npx playwright install webkit`).

The published site is the committed `docs/` folder, served by GitHub Pages from the main branch.

## Copyright and permitted use

Copyright © 2026 Victricius Vinnleo. All rights reserved.

The source code is published so that it can be viewed and the method can be inspected. It is not released under an open-source licence, and no permission is given to copy, modify, distribute or reuse it, in whole or in part, without written permission. Using the hosted application to carry out your own calculations is permitted, subject to the disclaimer above.
