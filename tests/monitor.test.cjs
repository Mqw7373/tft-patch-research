const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");

test("browser launch and cleanup failures save reports without overwriting a verified baseline", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tft-monitor-failure-"));
  try {
    const state = path.join(dir, "monitor-state.json");
    fs.writeFileSync(
      state,
      JSON.stringify({ snapshot: "verified-old-version" }),
    );
    const script = `
      const {chromium}=require(${JSON.stringify(require.resolve("playwright"))});
      chromium.launch=async()=>{
        if(process.env.TEST_LAUNCH_FAIL) throw Error('spawn EPERM');
        return {newPage:async()=>{throw Error('page failed')},close:async()=>{throw Error('close failed')}};
      };
      require(${JSON.stringify(path.resolve(__dirname, "../scripts/monitor.cjs"))}).main().catch(e=>{console.error(e);process.exitCode=1});
    `;
    for (const launchFail of ["1", ""]) {
      const r = spawnSync(process.execPath, ["-e", script], {
        cwd: dir,
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
        env: {
          ...process.env,
          LAB_DATA_DIR: dir,
          TEST_LAUNCH_FAIL: launchFail,
          GITHUB_STEP_SUMMARY: "",
        },
      });
      assert.equal(r.status, 1, r.stderr);
      const report = JSON.parse(
        fs.readFileSync(path.join(dir, "last-check.json")),
      );
      assert.equal(report.status, "failed");
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(dir, "reports/monitor.json"))),
        report,
      );
      assert.match(
        fs.readFileSync(path.join(dir, "reports/monitor.md"), "utf8"),
        launchFail ? /EPERM/ : /close failed/,
      );
      assert.equal(
        JSON.parse(fs.readFileSync(state)).snapshot,
        "verified-old-version",
      );
      assert.equal(
        fs.existsSync(path.join(dir, "latest-snapshot.json")),
        false,
      );
      if (launchFail) assert.match(report.browserHelp, /拒绝/);
      else
        assert.deepEqual(report.errors, [
          "page failed",
          "Browser cleanup: close failed",
        ]);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
