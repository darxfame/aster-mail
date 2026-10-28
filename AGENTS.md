# Repository Guidelines

## Project Structure & Module Organization

Aster Mail is an Electron client for Exchange OWA, initially targeting macOS
Apple Silicon. `desktop/main.cjs` owns windows, credentials, transport, and IPC;
`desktop/owa.cjs` implements OWA/EWS operations; `desktop/protocol.cjs` contains
payload builders and parsers. `src/` holds the plain HTML/CSS/JavaScript UI and
explicit demo data. `test/` contains Node.js tests, `assets/` contains the original
app mark, and `scripts/` contains development utilities. Generated bundles go in
ignored `release/`.

`desktop/notifications.cjs` owns alert deduplication. `desktop/meetings.cjs`
normalizes menu-bar meeting links and countdowns; `src/calendar.js` holds shared
calendar date arithmetic. `desktop/availability.cjs` adapts OWA free/busy responses; `src/availability.js`
calculates status and common slots. Never treat unknown availability as free.
`desktop/calendar-events.cjs` handles calendar details, scoped updates and safe
image previews. `src/meeting-ui.js` owns the meeting dialog; `src/sidebar-ui.js`
owns folder trees and the mini month picker. Never overwrite a stale meeting
or replay an invitation update after an uncertain response.
The isolated widget uses `src/widget.*`. Sound assets and their
generator are CC0; preserve their separate license.

## Build, Test, and Development Commands

- `npm ci`: install the locked dependency tree.
- `npm start`: run the desktop client.
- `npm run preview`: serve the UI on localhost:4173; browser preview supports demo only.
- `npm run check`: validate JavaScript syntax.
- `npm test`: run the built-in Node.js test runner.
- `npm run pack:mac`: package an Apple Silicon `.app`.
- `npm run dist:mac`: produce a macOS arm64 DMG.
- `node scripts/icon.cjs`: regenerate the geometric PNG app icon.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, descriptive camelCase functions, and
CommonJS `.cjs` modules for Electron and tests. Renderer scripts use plain browser
JavaScript. Keep UI text in Russian and code/comments in English. No formatter
or linter is configured; avoid introducing tooling without a concrete need.

## Testing Guidelines

Name tests `test/*.test.cjs`. Exercise request shapes, normalization, credential
boundaries, and failure behavior using fictional data and injected transport.
Never run sending or invitation tests against a real mailbox. No coverage
threshold is configured. Run syntax checks and tests before packaging; verify
visible UI changes in the app or browser demo.

## Commit & Pull Request Guidelines

No historical convention is established. Use concise imperative subjects, such
as `Handle expired OWA sessions`. Explain behavior changes and verification in
pull requests. Include screenshots for UI changes and compatibility limitations
for protocol changes.

## Security & Licensing

Keep credentials out of source, logs, and renderer storage. Preserve TLS checks,
same-origin authentication, isolated rendering, and the no-retry sending policy.
Maintain MIT attribution for adapted mac-owa-widget code. Do not import Mustang's
proprietary modules. Update README limitations when capabilities change.
