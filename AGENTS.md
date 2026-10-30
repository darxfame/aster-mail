# Repository Guidelines

## Project Structure & Module Organization

Aster Mail is an Electron client for Exchange OWA, targeting macOS
Apple Silicon and Windows x64. `desktop/main.cjs` owns windows, credentials, transport, and IPC;
`desktop/owa.cjs` implements OWA/EWS operations; `desktop/protocol.cjs` contains
payload builders and parsers. `src/` holds the plain HTML/CSS/JavaScript UI and
explicit demo data. `test/` contains Node.js tests, `assets/` contains the original
app mark, and `scripts/` contains development utilities. Generated bundles go in
ignored `release/`.

`desktop/folder-actions.cjs` performs folder changes: protect system folders by identity, suppress read receipts for bulk reads, and move removed folders to Deleted Items without permanent deletion or mutation retries.

`desktop/mail-cache.cjs` caches mail in account-local memory only; never persist payloads, cache failed reads, or let an old in-flight read repopulate an invalidated cache. Background mail polls bypass TTL and publish account-session-scoped inbox snapshots.
Keep the reader and compose dialog mounted during background list updates; discard
snapshots overtaken by navigation or mailbox writes. Images share the memory budget,
survive ordinary mailbox invalidation, and clear on logout or explicit cache reset.

`desktop/notifications.cjs` owns alert deduplication. Mail polls independently every 15 seconds; keep preview queues bounded, in memory and scoped to the current account. Reply/forward references require fresh ChangeKeys; after CreateAttachment, send with the last RootItemChangeKey. Calendar gestures must preserve duration and organizer permissions, and distinguish occurrences from series. `desktop/meetings.cjs`
normalizes menu-bar meeting links and countdowns; `src/calendar.js` holds shared
calendar date arithmetic. `desktop/availability.cjs` adapts OWA free/busy responses; `src/availability.js`
calculates status and common slots. Never treat unknown availability as free.
`desktop/calendar-events.cjs` handles calendar details, scoped updates and safe
image previews. `src/meeting-ui.js` owns the meeting dialog; `src/sidebar-ui.js`
owns folder trees and the mini month picker. Never overwrite a stale meeting
or replay an invitation update after an uncertain response.
`src/time.js` normalizes UTC Exchange instants and converts IANA wall times;
`src/calendar-layout.js` assigns overlap columns. Keep OWA UTC headers and
wall-time request bodies consistent. Never derive participation from opening an event. Invitees may update only
`reminder` / `reminderSet`; keep the organizer-only field check in the backend.
`desktop/directory.cjs` searches the Exchange GAL through EWS ResolveNames with
ActiveDirectoryContacts scope. Accept name-resolution warnings only for that read
operation; do not hide access or transport errors.
`src/recipients.js` owns participant matching and accessible directory suggestions;
discard stale search responses and preserve other comma-separated recipients.
`src/mail-editor.js` uses native rich-text editing. Keep pasted markup and outgoing
formatting within the shared style allowlist; never mount unsanitized mail in the editor.
`src/rich-content.js` renders sanitized HTML with scripts disabled; parent code
handles inline links. `desktop/content-images.cjs` validates raster images, and
external image requests use a separate session without account credentials.
`desktop/attachment-files.cjs` opens explicitly requested attachments in the system
application using private temporary copies. This user-authorized exception does
not permit background persistence: clear copies at account retirement, quit and
startup; never open active file types or launch after account retirement. Files
locked by an external app are retried at the next cleanup. Save As remains explicit.
The isolated widget uses `src/widget.*`. Sound assets and their
generator are CC0; preserve their separate license.

`desktop/updates.cjs` checks stable GitHub releases and verifies installer size
and SHA-256 before opening. Keep update traffic separate from OWA, allow only
HTTPS GitHub/CDN destinations, and never auto-quit or replace the unsigned app.
Automatic checks retry failures after a minute and honor the six-hour successful
check interval. Queue update prompts behind open/dirty dialogs. Download and open
an installer only after an explicit action; closing its prompt cancels launching.
`src/server.js` accepts HTTPS only, including restored accounts. Preserve
same-origin authentication and TLS validation for HTTPS.

`src/mail-ui.js` owns drag-to-folder, rule prompts, signature previews and
attachment cards; `src/people-ui.js` owns directory suggestions and lazy avatars.
`desktop/mail-rules.cjs` appends rules without deleting the Outlook rule blob.
Keep photo caches per account, verify inline raster images, and never replay
moves, rule creation or sends after an uncertain response. Mail rendering must
ignore stale responses after navigation; folder unread filters run on the server.

## Build, Test, and Development Commands

Connection recovery retries reads through the existing 15-second OWA poll and
reports account-scoped health in the compact header indicator. Do not replay
mutations, repeat rejected credentials, replace open composers or show large
network-error banners for transient connection loss.

Connection diagnostics was removed at the user's request after the server version
was identified. Do not reintroduce diagnostic controls or probes unless requested.

- `npm ci`: install the locked dependency tree.
- `npm start`: run the desktop client.
- `npm run preview`: serve the UI on localhost:4173; browser preview supports demo only.
- `npm run check`: validate JavaScript syntax.
- `npm test`: run the built-in Node.js test runner.
- `npm run pack:mac`: package an Apple Silicon `.app`.
- `npm run dist:mac`: produce a macOS arm64 DMG.
- `npm run dist:win -- --x64`: produce a Windows x64 EXE installer.
- `node scripts/icon.cjs`: regenerate the geometric PNG app icon.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, descriptive camelCase functions, and
CommonJS `.cjs` modules for Electron and tests. Renderer scripts use plain browser
JavaScript. Keep Russian/English UI strings in the shared `src/i18n.js` dictionary
and code/comments in English. Never translate mailbox content, contact names,
user folder names or protocol identifiers. No formatter
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

### Release Notes

Write release notes in Russian. Include only changes in that release, necessary
installation or update instructions, and one short joke about bugs as the last
bullet in the Changes section, before installation instructions. Compose a
different joke for every release; do not reuse the previous release's joke.
Omit introductions, roadmaps, test reports, and internal implementation details.

## Security & Licensing

Keep credentials out of source, logs, and renderer storage. Preserve TLS checks,
same-origin authentication, isolated rendering, and the no-retry sending policy.
Maintain MIT attribution for adapted mac-owa-widget code. Do not import Mustang's
proprietary modules. Update README limitations when capabilities change.
