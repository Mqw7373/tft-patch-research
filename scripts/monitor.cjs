const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { chromium } = require("playwright");
const out = path.resolve(process.env.LAB_DATA_DIR || "data");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
function json(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function rank(data) {
  if (data.filter_adjustment?.override_applied !== false)
    throw Error("Filter verification missing or expanded");
  const rows = data.results?.filter((x) => x.cluster && x.cluster !== "-1");
  if (!rows || rows.length < 10)
    throw Error("Fewer than ten verified compositions");
  return rows
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((x, i) => ({ ...x, rank: i + 1 }));
}
async function main() {
  const run = new Date().toISOString().replace(/[:.]/g, "-");
  const relative = "snapshots/" + run,
    dir = path.join(out, relative),
    manifest = [];
  const stateFile = path.join(out, "monitor-state.json");
  const previous = fs.existsSync(stateFile) ? read(stateFile) : null;
  const status = {
    checkedAt: new Date().toISOString(),
    status: "collecting",
    errors: [],
    scope: "NA1 Ranked Diamond/Master/Grandmaster/Challenger",
    snapshot: relative,
  };
  function save(name, body, url) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
    manifest.push({
      file: name,
      url,
      retrievedAt: new Date().toISOString(),
      sha256: sha(body),
      bytes: Buffer.byteLength(body),
    });
    json(path.join(dir, "manifest.json"), manifest);
  }
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
  });
  try {
    const p = await browser.newPage({
      viewport: { width: 1500, height: 1200 },
    });
    const index =
      "https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/";
    await p.goto(index, { waitUntil: "domcontentloaded", timeout: 60000 });
    const link = p.locator('a[href*="/teamfight-tactics-patch-"]').first();
    await link.waitFor({ state: "attached", timeout: 30000 });
    const officialUrl = new URL(await link.getAttribute("href"), index).href;
    if (!officialUrl.startsWith(index)) throw Error("Unexpected patch source");
    await p.goto(officialUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const content = await p.locator("main").innerText();
    if (content.length < 500) throw Error("Official patch article incomplete");
    save("official-patch.txt", content, officialUrl);
    status.official = {
      url: officialUrl,
      sha256: sha(content.replace(/\s+/g, " ").trim()),
    };
    status.sourceChanged =
      !previous || previous.official?.sha256 !== status.official.sha256;
    // A changed article is a review trigger; it is not proof of a numerical hotfix.
    status.previousSnapshot = previous?.snapshot || null;
    try {
      await p.goto("https://tftalphasim.com/simulator.html?locale=en", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      for (const name of [
        "champions-catalog",
        "items-catalog",
        "traits-catalog",
      ]) {
        const url = "https://tftalphasim.com/api/" + name,
          r = await p.request.get(url);
        if (!r.ok()) throw Error("AlphaSim catalog HTTP " + r.status());
        const body = await r.text();
        JSON.parse(body);
        save("alpha-" + name + ".json", body, url);
      }
    } catch (e) {
      status.errors.push(e.message);
    }
    const captures = new Map(),
      pending = [];
    const listener = (r) => {
      const url = new URL(r.url());
      if (url.hostname !== "api-hc.metatft.com") return;
      const name = url.pathname.split("/").at(-1);
      if (["patch", "comps_data", "unit_items_processed"].includes(name))
        pending.push(
          (async () => {
            if (!r.ok()) return;
            const body = await r.text();
            const value = JSON.parse(body);
            captures.set(name, value);
            save("metatft-" + name + ".json", body, r.url());
          })(),
        );
    };
    p.on("response", listener);
    await p.goto("https://www.metatft.com/comps", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await p.locator(".Comp_Title").first().waitFor({ timeout: 60000 });
    await Promise.all(pending);
    p.off("response", listener);
    const cluster = captures.get("comps_data")?.cluster_id;
    if (!cluster || !captures.has("patch"))
      throw Error("MetaTFT version/catalog capture incomplete");
    const url = new URL("https://api-hc.metatft.com/tft-comps-api/comps_stats");
    Object.entries({
      queue: "1100",
      patch: "current",
      days: "3",
      rank: "CHALLENGER,DIAMOND,GRANDMASTER,MASTER",
      permit_filter_adjustment: "false",
      server: "NA1",
      cluster_id: String(cluster),
    }).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = await p.request.get(url.href);
    if (!r.ok()) throw Error("MetaTFT ranking HTTP " + r.status());
    const stats = await r.json();
    const checkUrl = new URL(url);
    checkUrl.searchParams.set("permit_filter_adjustment", "true");
    const check = await p.request.get(checkUrl.href);
    if (!check.ok()) throw Error("Filter audit HTTP " + check.status());
    const checked = await check.json();
    save("meta-na-filter-check.json", JSON.stringify(checked), checkUrl.href);
    const top = rank({
      ...stats,
      filter_adjustment: checked.filter_adjustment,
    });
    save("meta-na-current.json", JSON.stringify(stats), url.href);
    save(
      "meta-na-top10.json",
      JSON.stringify({
        url: url.href,
        patch: captures.get("patch"),
        top,
        filter: checked.filter_adjustment,
        scope: status.scope,
      }),
      url.href,
    );
    const situational = p.getByRole("button", {
      name: "Situational",
      exact: true,
    });
    if (await situational.count()) await situational.click();
    status.boards = [];
    for (const row of top) {
      const id = String(row.cluster),
        title = p.locator("#row_" + id + " .Comp_Title");
      try {
        await title.scrollIntoViewIfNeeded();
        await title.click();
        const board = p.locator("#teambuilder_" + id);
        await board
          .locator(".UnitHexImage")
          .first()
          .waitFor({ state: "attached" });
        const cells = await board.locator('polygon[id^="Hex_"]').evaluateAll(
          (es, id) =>
            es.map((e) => {
              const pattern = e.closest("g").querySelector("pattern"),
                image = pattern?.querySelector("image"),
                cell = Number(e.id.slice(4));
              return {
                row: Math.floor(cell / 7),
                col: cell % 7,
                apiName: image ? pattern.id.slice(5, -(id.length + 1)) : null,
              };
            }),
          id,
        );
        if (cells.length !== 28) throw Error("Expected 28 board cells");
        const units = cells.filter((u) => u.apiName);
        save(
          "board-" + id + ".json",
          JSON.stringify({
            cluster: id,
            retrievedAt: status.checkedAt,
            units,
            source:
              "Current globally recommended positioning, ranked by NA statistics; completeness/roles/items require audit",
          }),
          p.url(),
        );
        const detailUrl =
          "https://api-hc.metatft.com/tft-comps-api/comp_details?comp=" +
          id +
          "&cluster_id=" +
          cluster;
        const detail = await p.request.get(detailUrl);
        if (!detail.ok()) throw Error("Details HTTP " + detail.status());
        save("details-" + id + ".json", await detail.text(), detailUrl);
        status.boards.push({
          cluster: id,
          units: units.length,
          captured: true,
          fullyVerified: false,
        });
        await title.click();
      } catch (e) {
        status.boards.push({ cluster: id, captured: false, error: e.message });
      }
    }
    status.status =
      !status.errors.length && status.boards.every((b) => b.captured)
        ? "sources_collected"
        : "partial";
    status.engineParityVerified = false;
    status.researchStatus = "awaiting_evidence_review";
    // Keep the last successful snapshot immutable; incomplete scrapes cannot replace it.
    if (status.status === "sources_collected") {
      json(path.join(out, "latest-snapshot.json"), { directory: relative });
      json(stateFile, status);
    } else process.exitCode = 1;
  } catch (e) {
    status.status = "failed";
    status.errors.push(e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    json(path.join(out, "last-check.json"), status);
    fs.mkdirSync("reports", { recursive: true });
    json("reports/monitor.json", status);
    fs.writeFileSync(
      "reports/monitor.md",
      `# 版本监测\n\n检查时间：${status.checkedAt}\n\n状态：${status.status}\n\n${status.official?.url || ""}\n\n完整研究与正式对战尚须核验引擎版本、历史十套完整棋盘及阵容输入。监测成功不等于对战完成。\n\n${status.errors.join("\n")}\n`,
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        fs.readFileSync("reports/monitor.md"),
      );
    console.log(JSON.stringify(status));
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { rank };
