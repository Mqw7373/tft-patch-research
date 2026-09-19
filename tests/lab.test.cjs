const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tft-lab-"));
process.env.LAB_DATA_DIR = tmp;
const write = (f, x) => fs.writeFileSync(path.join(tmp, f), JSON.stringify(x));
write("latest-snapshot.json", { directory: "." });
write("alpha-champions-catalog.json", {
  champions: [
    { apiName: "carry", cost: 1 },
    { apiName: "tank", cost: 3 },
    { apiName: "secondary", cost: 4 },
  ],
});
write("alpha-items-catalog.json", {
  items: [
    { apiName: "normal", kind: "craftable" },
    { apiName: "artifact", kind: "artifact" },
  ],
});
const { validateTeam } = require("../scripts/lab.cjs"),
  { rank } = require("../scripts/monitor.cjs");
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
test("fixed gear budget, cost stars and unique positioning", () => {
  const roles = {
    mainCarry: "carry",
    mainTank: "tank",
    secondaryCarry: "secondary",
  };
  const team = ["carry", "tank", "secondary"].map((apiName, col) => ({
    apiName,
    stars: apiName === "carry" ? 3 : 2,
    position: { row: 0, col },
    items: ["normal", "normal", "normal"],
  }));
  validateTeam(team, roles, 3);
  const changed = structuredClone(team);
  changed[0].stars = 2;
  assert.throws(() => validateTeam(changed, roles, 3));
  changed[0].stars = 3;
  changed[0].items[0] = "artifact";
  assert.throws(() => validateTeam(changed, roles, 3));
  changed[0].items[0] = "normal";
  changed[1].position = changed[0].position;
  assert.throws(() => validateTeam(changed, roles, 3));
});
test("NA ranking fails closed on expanded filters or insufficient rows", () => {
  const results = Array.from({ length: 12 }, (_, i) => ({
    cluster: String(i + 1),
    count: i,
  }));
  assert.equal(
    rank({ results, filter_adjustment: { override_applied: false } })[0].count,
    11,
  );
  assert.throws(() =>
    rank({ results, filter_adjustment: { override_applied: true } }),
  );
  assert.throws(() =>
    rank({
      results: results.slice(0, 9),
      filter_adjustment: { override_applied: false },
    }),
  );
});
test("synthetic fixture D(t) does not invent a later sample", () => {
  const A = require("../src/alphasim.js"),
    S = require("../src/analysis.js");
  const b = A.parse(require("../examples/synthetic-battle.json"));
  assert.notEqual(S.damage(b, "my", null, 5).value, null);
  assert.equal(S.damage(b, "my", null, 20).value, null);
});
