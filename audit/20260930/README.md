# Deep audit evidence — 30 September 2026

Repository: msr2903/himotoki-yomitan. Baseline: `b4fc71f1`. Tests assert the observed defects; passing them confirms the current bad behavior rather than fixing it. No product source is changed.

Copy display/audio.test.js into test/ as audit-*.test.js. Run npm run build:libs, then node node_modules/vitest/vitest.mjs run test/audit-display.test.js test/audit-audio.test.js.

Account tests exercise the actual client against controlled deferred HTTP/session stores, without real credentials or live cloud writes. UI controller tests use DOM/browser API stubs and the actual controller. Native/browser availability tests model missing APIs and do not claim a physical-device end-to-end result.

Cross-app custom identity: Yomitan baseline b4fc71f1 and himotoki-app a9de05ff. Run custom-entry.mts with YOMITAN_ROOT and APP_ROOT set to checkouts, using pnpm --filter @himotoki/api exec tsx /path/to/custom-entry.mts from the app repo. It builds real favorite payloads, requests the actual Hono routes, and writes only a temporary JSON file. Screenshots use the app production build in local preview with that synthetic JSON seeded into local-only storage. They are not a live OAuth/Firestore end-to-end test.

Identity collision: copy identity.test.js into test/audit-identity.test.js and run npm exec -- vitest run test/audit-identity.test.js. The two real Japanese word spellings/readings were discovered by scanning the real read-only Jitendex pack; the published self-contained test uses distinct positive custom dictionary local sequences and the actual builder/upsert. No live library writes.
