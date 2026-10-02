# Second Himotoki ecosystem audit: Yomitan evidence

Source: `b4fc71f15c999620ba606d268f6a86177710db9e`. Run `node /path/to/yomitan-persistence-probe.mjs` from that checkout. The script imports the actual favorite builder and reads the repository's existing translator-test-results.json entry for 打ち込む. No account or network is accessed. Assertions confirm loss of the fixture's alternate pitch pattern. This is a code reproduction, not a browser screenshot.

## Excluded candidate

The first evidence commit included an artificial storage-write reordering test. It has been removed and will not become an issue: Chromium's storage frontend posts writes/removals to a sequenced backend. That double did not establish a reachable browser race. See [storage frontend](https://github.com/chromium/chromium/blob/main/extensions/browser/api/storage/storage_frontend.cc) and [sequenced backend](https://github.com/chromium/chromium/blob/main/extensions/browser/api/storage/backend_task_runner.cc).
