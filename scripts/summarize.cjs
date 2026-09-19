const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
const {
  measures,
  validateResponse,
  hash,
  exportRecords,
} = require("./lab.cjs");
const S = require("../src/analysis.js");
const out = path.resolve(process.env.LAB_DATA_DIR || "data");
const records = fs
  .readdirSync(path.join(out, "battles"))
  .filter((f) => f.endsWith(".json.gz"))
  .map((f) =>
    JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(out, "battles", f)))),
  );
const groups = new Map();
for (const r of records) {
  if (r.requestSha256 !== hash(r.request)) throw Error("Request hash mismatch");
  validateResponse(r.request, r.response.data);
  const key = r.version + ":" + r.requestSha256;
  if (!groups.has(key))
    groups.set(key, {
      version: r.version,
      matchup: r.matchup,
      records: [],
      ids: new Set(),
    });
  const g = groups.get(key);
  if (g.ids.has(r.trial)) throw Error("Duplicate trial within configuration");
  g.ids.add(r.trial);
  g.records.push(measures(r, r.roles));
}
const summaries = [...groups.values()].map((g) => ({
  version: g.version,
  matchup: g.matchup,
  n: g.records.length,
  complete: g.records.length === 10,
  wins: g.records.filter((r) => r.winner === "my").length,
  draws: g.records.filter((r) => r.winner === "draw").length,
  roles: Object.fromEntries(
    ["my", "en"].map((side) => [
      side,
      Object.fromEntries(
        ["team", "mainCarry", "secondaryCarry", "mainTank"].map((role) => [
          role,
          Object.fromEntries(
            [
              "D5",
              "D10",
              "D20",
              "survival10",
              "survival20",
              "firstCast",
              "firstAnyDamage",
              "death",
            ].map((k) => [
              k,
              S.stats(
                g.records.map((r) => {
                  const v = r.sides[side][role][k];
                  return v && typeof v === "object" ? v.value : v;
                }),
              ),
            ]),
          ),
        ]),
      ),
    ]),
  ),
  trials: g.records,
}));
fs.mkdirSync("reports", { recursive: true });
fs.writeFileSync("reports/battles.json", JSON.stringify(summaries, null, 2));
const cell = (s) =>
  s.n
    ? `${s.median.toFixed(1)} [${s.q1.toFixed(1)}, ${s.q3.toFixed(1)}] (${s.n}场)`
    : "缺测";
const lines = [
  "# 正式对战汇总",
  "",
  "每组目标10场，未满10场标为未完成。D(t)仅统计记录覆盖该时刻的样本；模拟胜率不等于排位胜率。",
  "",
  "| 配置 | 胜/平/负 | 已完成 | 主C D5 | 主C D10 | 主C D20 |",
  "|---|---|---|---|---|---|",
];
for (const g of summaries)
  lines.push(
    `| ${g.matchup} | ${g.wins}/${g.draws}/${g.n - g.wins - g.draws} | ${g.n}/10 | ${["D5", "D10", "D20"].map((k) => cell(g.roles.my.mainCarry[k])).join(" | ")} |`,
  );
fs.writeFileSync("reports/battles.md", lines.join("\n") + "\n");
if (records.length) exportRecords(records, "正式回放");
console.log("Summarized", records.length, "audited formal trials");
