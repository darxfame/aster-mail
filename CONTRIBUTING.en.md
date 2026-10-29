# Contributing to Aster Mail

[Русский](CONTRIBUTING.md) · [English](CONTRIBUTING.en.md)

Aster Mail is an independent Exchange OWA/EWS desktop client built with Electron.
Issues and pull requests in English or Russian are welcome. The app interface
is currently Russian; English documentation does not imply an English app UI.

## Find a task

- [Good first issues](https://github.com/darxfame/aster-mail/contribute) have a
  small scope, an expected outcome, and verification steps.
- [Help wanted](https://github.com/darxfame/aster-mail/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22)
  includes work that may need platform access or more experience.
- You can contribute documentation, demo accessibility checks, or tests with
  fictional responses without an Exchange server.
- Existing users can submit a
  [compatibility report](https://github.com/darxfame/aster-mail/issues/new?template=compatibility_report.md).

Discuss larger changes in an issue before implementing them. For a small listed
task, leave a comment that you are starting so others can avoid duplicate work.

## Local setup

You need Git, Node.js 22+, and npm:

```sh
git clone https://github.com/darxfame/aster-mail.git
cd aster-mail
npm ci
npm start
```

For a browser demo with fictional data, run `npm run preview`, open
[localhost:4173](http://localhost:4173), and click «Посмотреть демо» (View demo).
Real Exchange connections require the desktop app.

## Pull requests and verification

Run `npm run check` and `npm test` before submitting code changes. Tests use the
built-in Node.js runner, fictional data, and injected transports. Never run
automated sending or invitation tests against a real mailbox.

Describe the problem, final behavior, and how you verified it. For UI changes,
include screenshots using demo data. For protocol changes, include request and
failure-handling tests and note any platform or Exchange-version limitations.
Documentation-only changes should have their links and instructions checked.

Follow [AGENTS.md](AGENTS.md): two-space indentation, semicolons, descriptive
camelCase names, CommonJS `.cjs` backend modules, and plain browser JavaScript.
Keep UI text in Russian and code/comments in English. Do not add tooling or
dependencies without a concrete need. Use concise imperative commit subjects,
such as `Handle expired OWA sessions`.

Preserve MIT attribution and the separate CC0 sound license. Do not import
proprietary Mustang modules. Keep credentials, tokens, cookies, authentication
logs, corporate addresses, and messages out of issues, PRs, and screenshots.
See [SECURITY.md](SECURITY.md) for private vulnerability reporting instructions.
