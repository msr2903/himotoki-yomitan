# Deep audit evidence — 30 September 2026

Repository: msr2903/himotoki-yomitan. Baseline: `b4fc71f1`. Tests assert the observed defects; passing them confirms the current bad behavior rather than fixing it. No product source is changed.

Copy display/audio.test.js into test/ as audit-*.test.js. Run npm run build:libs, then node node_modules/vitest/vitest.mjs run test/audit-display.test.js test/audit-audio.test.js.

Account tests exercise the actual client against controlled deferred HTTP/session stores, without real credentials or live cloud writes. UI controller tests use DOM/browser API stubs and the actual controller. Native/browser availability tests model missing APIs and do not claim a physical-device end-to-end result.
