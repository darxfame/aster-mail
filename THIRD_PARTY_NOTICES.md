# Third-party notices

Aster Mail is an independent implementation inspired by the workflows of
[Mustang / Parula](https://github.com/mustang-im/mustang). No Mustang source,
artwork, proprietary modules, or trademarks are included.

OWA request structures, forms authentication, and EWS payloads in
`desktop/protocol.cjs`, `desktop/owa.cjs`, and `desktop/availability.cjs` are adapted from
[mac-owa-widget](https://github.com/ilyabazhenov/mac-owa-widget), reviewed at commit
`9285de5140d54f0bb6e7a830e70abc80f6be05e5`.

## mac-owa-widget — MIT License

Copyright (c) 2026 Ilya Bazhenov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Runtime dependencies

The original synthesized notification sounds and their generator are available
under CC0-1.0. See `assets/sounds/LICENSE.md`. They contain no third-party samples.

Electron, DOMPurify, fast-xml-parser, and their dependencies retain their respective
licenses in installed packages. Chromium notices accompany packaged applications.
See `package-lock.json` for exact versions.
