# REA (morluto/rea)

Orbz's reverse engineering (PLAN 4.8, `packages/home/src/reverse/`) takes its logic from REA, "Reverse Engineer
Anything" (https://github.com/morluto/rea), read at commit db4e360 on 2026-10-10. The owner chose to port its logic
into our own tools rather than run REA itself (10-10: "Port its logic into our own tools"). No REA file was copied:
our code is written for Orbz, from what REA reads and reports:

- the ASAR container's extents admitted before its header is decoded (`AsarHeader.ts`) → `reverse/app.ts`
- an Electron app's facts: IPC by side and operation with literal or dynamic channels, contextBridge keys,
  BrowserWindow web preferences and preload, native `.node` bindings, source maps (`domain/javascript/electron*`,
  `javascript/sourceMaps`) → `reverse/js.ts`, `reverse/app.ts`; REA walks a Babel tree, ours reads tokens
- a native binary's facts (sections, symbols, strings, imports, mitigation candidates, Apple bundle anatomy), which
  REA gets from Hopper, Ghidra, IDA, otool or pwntools → our own parsers, `reverse/binary.ts`, `reverse/bytes.ts`
- offline EVM reading (dispatch selectors, a raw or hex carrier; REA uses evmole) → `reverse/evm.ts`
- HAR captures (UTF-8 with one byte-order mark skipped, `log.entries`, the 1.2 profile, sensitive values redacted)
  → `reverse/har.ts`

Each of those files carries the notice below in its header.

## Licence

MIT License

Copyright (c) 2026 morluto

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
