const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  zlib = require("zlib"),
  assert = require("assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.resolve(process.env.LAB_DATA_DIR || path.join(root, "data"));
const read = (p) =>
  JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const snap = path.resolve(
  out,
  read(path.join(out, "latest-snapshot.json")).directory,
);
const C = new Map(
  read(path.join(snap, "alpha-champions-catalog.json")).champions.map((x) => [
    x.apiName,
    x,
  ]),
);
const I = new Map(
  read(path.join(snap, "alpha-items-catalog.json")).items.map((x) => [
    x.apiName,
    x,
  ]),
);
const A = require(path.join(root, "src/alphasim.js"));
const S = require(path.join(root, "src/analysis.js"));
const hash = (x) =>
  crypto.createHash("sha256").update(S.canonical(x)).digest("hex");
const write = (file, v) => {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(v, null, 2));
  fs.renameSync(temp, file);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function validateTeam(lineup, roles, population) {
  assert.equal(
    new Set(lineup.map((x) => x.apiName)).size,
    lineup.length,
    "Duplicate unit",
  );
  assert.equal(
    new Set(lineup.map((x) => `${x.position.row},${x.position.col}`)).size,
    lineup.length,
    "Duplicate hex",
  );
  assert.equal(
    lineup.reduce((n, u) => n + (u.apiName === "DA_18_ElderDragon" ? 2 : 1), 0),
    population,
    "Population / two-slot champion",
  );
  assert.equal(
    lineup.reduce((n, u) => n + u.items.length, 0),
    9,
    "Nine ordinary completed items",
  );
  assert.equal(
    new Set(Object.values(roles)).size,
    3,
    "Three distinct item holders",
  );
  for (const u of lineup) {
    assert(C.has(u.apiName), "Unknown unit");
    assert(!u.statOverrides, "No unverified stat overrides");
    assert(
      Number.isInteger(u.position.row) &&
        u.position.row >= 0 &&
        u.position.row < 4 &&
        Number.isInteger(u.position.col) &&
        u.position.col >= 0 &&
        u.position.col < 7,
      "Invalid hex",
    );
    const core = [roles.mainCarry, roles.mainTank].includes(u.apiName),
      cost = C.get(u.apiName).cost;
    assert(
      core && cost === 3
        ? [2, 3].includes(u.stars)
        : u.stars === (core && cost <= 2 ? 3 : 2),
      "Cost-dependent stars",
    );
    assert.equal(
      u.items.length,
      Object.values(roles).includes(u.apiName) ? 3 : 0,
      "Role items",
    );
    for (const id of u.items)
      assert.equal(
        I.get(id)?.kind,
        "craftable",
        "Ordinary current items only: " + id,
      );
    for (const id of new Set(u.items))
      if (I.get(id).unique)
        assert.equal(
          u.items.filter((i) => i === id).length,
          1,
          "Duplicate unique item",
        );
  }
}
function wireLineup(config) {
  return config.lineup.map((u) =>
    Object.fromEntries(
      Object.entries(u).filter(
        ([k]) =>
          ["apiName", "stars", "position", "items"].includes(k) ||
          k.startsWith("s18"),
      ),
    ),
  );
}
function requestFor(c, config, e, enemyConfig) {
  validateTeam(config.lineup, c.roles, c.population);
  validateTeam(enemyConfig.lineup, e.roles, e.population);
  const side = (x) => ({
    playerLevel: x.population,
    combatStage: 5,
    missingPlayerHp: 20,
    combatWispApiNames: [],
    boardHexEffects: [],
    primalBlessings: x.mechanisms?.primalBlessings || [],
    primalPhoenixTakedowns: 0,
    faePixies: 0,
  });
  return {
    myLineup: wireLineup(config),
    enemyLineup: wireLineup(enemyConfig),
    myAugments: [],
    enemyAugments: [],
    myConfig: side(c),
    enemyConfig: side(e),
  };
}
function itemName(id) {
  const canonical = id.replace(/^TFT_Item_Corrupted/, "TFT_Item_");
  assert(I.has(canonical), "Unverified runtime item alias " + id);
  return I.get(canonical).name;
}
function validateResponse(req, d) {
  const audit = [];
  for (const [input, output] of [
    ["myConfig", "myNextConfig"],
    ["enemyConfig", "enemyNextConfig"],
  ]) {
    if (req[input]?.primalBlessings?.length)
      assert.deepEqual(
        d[output]?.primalBlessings,
        req[input].primalBlessings,
        "Primal selection not retained",
      );
  }
  for (const [key, initial] of [
    ["myLineup", "myChamps"],
    ["enemyLineup", "enemyChamps"],
  ]) {
    assert.equal(d[initial].length, req[key].length, "Unit count");
    for (const u of req[key]) {
      const a = d[initial].find((c) => c.apiName === u.apiName);
      assert(a, "Missing unit");
      assert.equal(a.stars, u.stars, "Star mismatch");
      assert.deepEqual(a.pos, u.position, "Hex mismatch");
      assert.deepEqual(
        a.equipment.map((i) => itemName(i.itemApiName)).sort(),
        u.items.map(itemName).sort(),
        "Item alias/name mismatch",
      );
      for (const k of ["s18PermanentBonusAP", "s18PermanentBonusHealth"])
        assert.equal(a[k] || 0, u[k] || 0, "Historical bonus mismatch " + k);
      assert.equal(
        !!a.s18RiftbeastAlphaMarked,
        !!u.s18RiftbeastAlphaMarked,
        "Alpha mark mismatch",
      );
      const base = C.get(u.apiName).stats;
      // Fail closed: alternate forms need their own verified numeric expectations before a formal run.
      const expected = {
        rawBaseHp: Math.round(base.hp * 1.8 ** (u.stars - 1)),
        rawBaseAd: Math.round(base.damage * 1.5 ** (u.stars - 1)),
        rawBaseArmor: base.armor,
        rawBaseMr: base.magicResist,
        rawBaseAs: base.attackSpeed,
        mm: base.mana,
        range: base.range,
      };
      // Verified against the saved Headshot descriptor: catalog 3 is an attack counter, not casting mana.
      if (
        u.apiName === "DA_18_Caitlyn" &&
        base.mana === 3 &&
        a.ability.passiveOnly &&
        a.ability.replacementAuto?.every === 3
      )
        expected.mm = 0;
      for (const [k, v] of Object.entries(expected))
        assert(
          Math.abs(a[k] - v) < 0.01,
          `${u.apiName} ${k}: ${a[k]} vs catalog ${v}`,
        );
      audit.push({
        side: key,
        apiName: u.apiName,
        stars: a.stars,
        position: a.pos,
        items: a.equipment,
        expected,
        actual: Object.fromEntries(Object.keys(expected).map((k) => [k, a[k]])),
        bonusAP: a.s18PermanentBonusAP,
        bonusHealth: a.s18PermanentBonusHealth,
        alphaMarked: a.s18RiftbeastAlphaMarked,
      });
    }
  }
  A.parse({ request: req, response: { data: d } });
  return audit;
}
function stats(values, N) {
  return { ...S.stats(values), N };
}
function measures(record, roles) {
  const b = A.parse(record),
    sides = {};
  for (const [side, r] of [
    ["my", roles.my],
    ["en", roles.en],
  ]) {
    const result = {
      team: {
        D5: S.damage(b, side, null, 5),
        D10: S.damage(b, side, null, 10),
        D20: S.damage(b, side, null, 20),
        final: S.metrics(b, side, null).finalTeam,
      },
    };
    for (const [role, api] of Object.entries(r)) {
      const m = S.metrics(b, side, api),
        list = b.sides[side],
        index = list.findIndex((u) => u.initial && u.api === api),
        u = list[index];
      const raw = record.response.data;
      const damageEvents = [
        ...(raw[side + "AtkEvents"] || []),
        ...(raw[side + "DmgPopEvents"] || []),
      ].filter((e) => e.ci === index && e.dmg > 0 && Number.isFinite(e.t));
      const firstAny = damageEvents.length
        ? Math.min(...damageEvents.map((e) => e.t))
        : null;
      result[role] = {
        apiName: api,
        D5: m.carry[0],
        D10: m.carry[1],
        D20: m.carry[2],
        final: m.finalCarry,
        firstCast: m.firstCast,
        firstAnyDamage: firstAny,
        firstSkillDamage: m.firstSkill,
        death: m.death,
        survival10: m.survival10,
        survival20: m.survival20,
        observedSurvival: Math.min(u.death ?? Infinity, b.times.at(-1)),
        survivalRightCensored: u.death === null,
      };
    }
    // Entire initial frontline: predeclared rows 0/1; excludes later summons.
    const front = record.request[side === "my" ? "myLineup" : "enemyLineup"]
      .filter((u) => u.position.row <= 1)
      .map((u) => b.sides[side].find((x) => x.initial && x.api === u.apiName));
    result.frontline = {
      definition: "Initial units in rows 0/1",
      survival10:
        b.times.at(-1) >= 10
          ? front.filter((u) => u.death === null || u.death > 10).length /
            front.length
          : null,
      survival20:
        b.times.at(-1) >= 20
          ? front.filter((u) => u.death === null || u.death > 20).length /
            front.length
          : null,
    };
    sides[side] = result;
  }
  return {
    trial: record.trial,
    requestSha256: record.requestSha256,
    winner: b.winner,
    duration: b.times.at(-1),
    warnings: b.warnings,
    sides,
  };
}
function exportRecords(records, label) {
  let batch = [],
    size = 0,
    index = 1;
  const flush = () => {
    if (!batch.length) return;
    const v = {
        format: "tft-replay-session/v1",
        purpose: label,
        records: batch,
      },
      raw = JSON.stringify(v);
    assert(Buffer.byteLength(raw) < 512 * 1024 * 1024);
    const gz = zlib.gzipSync(raw);
    assert(gz.length <= 50 * 1024 * 1024);
    fs.writeFileSync(path.join(out, `${label}-${index++}.json.gz`), gz);
    A.parseRecords(v);
    batch = [];
    size = 0;
  };
  for (const r of records) {
    const n = Buffer.byteLength(JSON.stringify(r));
    if (batch.length >= 100 || size + n > 480 * 1024 * 1024) flush();
    batch.push(r);
    size += n;
  }
  flush();
}
function compile() {
  const file = path.join(out, "执行清单.json"),
    plan = read(file),
    cs = read(path.join(out, "候选阵容.json")).candidates;
  assert(
    [
      "historicalFullBoardsVerified",
      "engineFullNumericParityVerified",
      "pilotMechanicsVerified",
    ].every((k) => plan.gates?.[k] === true),
    "BLOCKED: resolve and document the evidence gates before compilation",
  );
  assert.equal(
    plan.historicalOpponents.length,
    10,
    "Exactly ten previous-patch opponents",
  );
  assert.equal(
    new Set(plan.historicalOpponents.map((e) => e.id)).size,
    10,
    "Unique historical compositions",
  );
  const matchups = [];
  for (const e of plan.historicalOpponents) {
    assert(
      e.sourceVerified === true &&
        e.source?.url &&
        e.source?.snapshotFile &&
        e.source?.version !== plan.version,
      "Dated previous-version source required",
    );
    const sourcePath = path.resolve(out, e.source.snapshotFile);
    assert(
      sourcePath.startsWith(out + path.sep) && fs.existsSync(sourcePath),
      "Archived source missing",
    );
    assert(
      e.configurations?.length > 0,
      "Opponent star configurations required",
    );
    const coreApis = [e.roles.mainCarry, e.roles.mainTank].filter(
      (a) => C.get(a)?.cost === 3,
    );
    for (const a of coreApis)
      assert.deepEqual(
        [
          ...new Set(
            e.configurations.map(
              (cfg) => cfg.lineup.find((u) => u.apiName === a).stars,
            ),
          ),
        ].sort(),
        [2, 3],
        "Opponent three-cost branches",
      );
    for (const c of cs)
      for (const cfg of c.configurations)
        for (const ecfg of e.configurations) {
          const id = cfg.id + "--" + ecfg.id;
          assert(/^[a-zA-Z0-9_-]+$/.test(id), "Safe matchup id");
          const request = requestFor(c, cfg, e, ecfg);
          matchups.push({
            id,
            request,
            requestSha256: hash(request),
            roles: { my: c.roles, en: e.roles },
            source: e.source,
          });
        }
  }
  assert.equal(
    new Set(matchups.map((m) => m.id)).size,
    matchups.length,
    "Unique config pair IDs",
  );
  plan.matchups = matchups;
  plan.compiledAt = new Date().toISOString();
  plan.compiledSha256 = hash(matchups);
  write(file, plan);
  console.log(
    "COMPILED",
    matchups.length,
    "pairs;",
    matchups.length * 10,
    "trials",
  );
}
async function run(pilot = false) {
  assert.equal(
    process.env.ALPHASIM_RUN_ENABLED,
    "true",
    "Set ALPHASIM_RUN_ENABLED=true only for a requested run within service limits",
  );
  const plan = read(path.join(out, "执行清单.json"));
  const priorState = read(path.join(out, "研究状态.json"));
  assert(
    !priorState.retryNotBefore ||
      Date.now() >= Date.parse(priorState.retryNotBefore),
    "Retry-After not elapsed",
  );
  if (!pilot) {
    assert(
      [
        "historicalFullBoardsVerified",
        "engineFullNumericParityVerified",
        "pilotMechanicsVerified",
      ].every((k) => plan.gates?.[k] === true),
      "BLOCKED: historical full boards / numeric parity / pilots not verified",
    );
    assert.equal(plan.historicalOpponents.length, 10);
    assert(plan.matchups.length > 0, "No frozen Cartesian matchups");
    assert.equal(
      hash(plan.matchups),
      plan.compiledSha256,
      "Frozen matchup hash changed",
    );
  }
  const lock = path.join(out, "runner.lock.json");
  let fd;
  try {
    fd = fs.openSync(lock, "wx");
  } catch {
    throw Error(
      "Existing runner lock: check recorded PID and remove only if stale",
    );
  }
  fs.writeFileSync(
    fd,
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      pilot,
    }),
  );
  fs.closeSync(fd);
  const { chromium } = require("playwright");
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_CHANNEL
        ? { channel: process.env.BROWSER_CHANNEL }
        : {}),
    });
    const p = await browser.newPage();
    await p.goto("https://tftalphasim.com/simulator.html?locale=en", {
      waitUntil: "domcontentloaded",
    });
    const cs = read(path.join(out, "候选阵容.json")).candidates;
    const matchups = pilot
      ? cs.flatMap((c) =>
          c.configurations.map((cfg) => ({
            id: "candidate-" + cfg.id,
            request: requestFor(c, cfg, c, cfg),
            roles: { my: c.roles, en: c.roles },
            N: 1,
          })),
        )
      : plan.matchups.map((m) => ({ ...m, N: 10 }));
    const logdir = path.join(out, pilot ? "calibration" : "battles");
    fs.mkdirSync(logdir, { recursive: true });
    for (const m of matchups) {
      const requestHash = hash(m.request);
      for (let trial = 1; trial <= m.N; trial++) {
        const file = path.join(
          logdir,
          `${m.id}-${String(trial).padStart(2, "0")}.json.gz`,
        );
        if (fs.existsSync(file)) {
          const prev = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
          assert.equal(
            prev.requestSha256,
            requestHash,
            "Changed request under same trial",
          );
          const audit = validateResponse(m.request, prev.response.data);
          write(file.replace(".json.gz", ".audit.json"), {
            requestSha256: requestHash,
            validatedAt: new Date().toISOString(),
            audit,
          });
          const state = read(path.join(out, "研究状态.json"));
          if (pilot)
            state.calibrationTrials = [
              ...new Set([...state.calibrationTrials, m.id + "-" + trial]),
            ];
          else {
            state.completedTrials[m.id] = [
              ...new Set([...(state.completedTrials[m.id] || []), trial]),
            ];
            if (state.completedTrials[m.id].length === 10)
              state.completedMatchups = [
                ...new Set([...state.completedMatchups, m.id]),
              ];
          }
          write(path.join(out, "研究状态.json"), state);
          console.log("CACHED", m.id, trial);
          continue;
        }
        const quota = await p.evaluate(async () => {
          const r = await fetch("/api/quota");
          return { status: r.status, data: await r.json() };
        });
        assert.equal(quota.status, 200);
        assert(
          quota.data.simulate.remaining > 0,
          "Daily quota exhausted; resume later",
        );
        const retrievedAt = new Date().toISOString(),
          r = await p.evaluate(async (request) => {
            const r = await fetch("/api/simulate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(request),
            });
            return {
              status: r.status,
              headers: Object.fromEntries(r.headers),
              data: await r.json(),
            };
          }, m.request);
        const record = {
          version: plan.version,
          purpose: pilot
            ? "candidate input calibration, not efficacy benchmark"
            : "formal benchmark",
          matchup: m.id,
          trial,
          requestSha256: requestHash,
          retrievedAt,
          request: m.request,
          roles: m.roles,
          response: r,
          provenance: { snapshotDirectory: snap, seedSent: false },
        };
        if (r.status !== 200) {
          write(path.join(out, "last-api-error.json"), record);
          if (r.status === 429) {
            const h = r.headers["retry-after"];
            const seconds = h
              ? Number.isFinite(Number(h))
                ? Number(h)
                : Math.max(0, (Date.parse(h) - Date.now()) / 1000)
              : Number(r.data.retryAfter) || 60;
            const state = read(path.join(out, "研究状态.json"));
            state.retryNotBefore = new Date(
              Date.now() + seconds * 1000,
            ).toISOString();
            write(path.join(out, "研究状态.json"), state);
          }
          throw Error(
            "HTTP " +
              r.status +
              "; response saved, stop and resume after retryNotBefore",
          );
        }
        // Persist the real response before auditing; bad responses never become successful trials.
        fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(record)));
        const audit = validateResponse(m.request, r.data);
        write(file.replace(".json.gz", ".audit.json"), {
          requestSha256: requestHash,
          validatedAt: new Date().toISOString(),
          audit,
        });
        const state = read(path.join(out, "研究状态.json"));
        state.activeRun.lastHeartbeat = new Date().toISOString();
        if (pilot) {
          state.calibrationTrials = [
            ...new Set([...state.calibrationTrials, m.id + "-" + trial]),
          ];
        } else {
          state.completedTrials[m.id] = [
            ...new Set([...(state.completedTrials[m.id] || []), trial]),
          ];
          if (state.completedTrials[m.id].length === 10)
            state.completedMatchups = [
              ...new Set([...state.completedMatchups, m.id]),
            ];
        }
        write(path.join(out, "研究状态.json"), state);
        console.log(
          "SAVED",
          m.id,
          trial,
          r.data.winner,
          r.data.timeAxis.at(-1),
        );
        await sleep(5000);
      }
    }
  } finally {
    if (browser) await browser.close();
    fs.unlinkSync(lock);
  }
}
function analyze() {
  const records = fs
    .readdirSync(path.join(out, "calibration"))
    .filter((x) => x.endsWith(".json.gz"))
    .map((x) =>
      JSON.parse(
        zlib.gunzipSync(fs.readFileSync(path.join(out, "calibration", x))),
      ),
    );
  const reports = records.map((r) =>
    measures(
      r,
      r.roles || {
        my: {
          mainCarry: "DA_18_Camille",
          secondaryCarry: "DA_18_Ashe",
          mainTank: "DA_18_Maokai",
        },
        en: {
          mainCarry: "DA_18_Camille",
          secondaryCarry: "DA_18_Ashe",
          mainTank: "DA_18_Maokai",
        },
      },
    ),
  );
  const groups = [];
  for (const r of reports) {
    let g = groups.find((g) => g.requestSha256 === r.requestSha256);
    if (!g) {
      g = { requestSha256: r.requestSha256, records: [] };
      groups.push(g);
    }
    g.records.push(r);
  }
  for (const g of groups) {
    g.N = g.records.length;
    g.summary = {};
    for (const side of ["my", "en"]) {
      g.summary[side] = {};
      for (const role of [
        "team",
        "mainCarry",
        "secondaryCarry",
        "mainTank",
        "frontline",
      ]) {
        g.summary[side][role] = {};
        const keys = Object.keys(g.records[0].sides[side][role]);
        for (const k of keys) {
          if (["apiName", "definition"].includes(k)) continue;
          const vals = g.records.map((r) => {
            const v = r.sides[side][role][k];
            return typeof v === "object" && v !== null ? v.value : v;
          });
          g.summary[side][role][k] = stats(vals, g.N);
        }
      }
    }
    delete g.records;
  }
  write(path.join(out, "校验指标.json"), {
    purpose:
      "Calibration only, different configs are separate; no 10-trial matchup results",
    generatedAt: new Date().toISOString(),
    reports,
    groups,
  });
  exportRecords(records, "校验回放");
  console.log(
    "ANALYZED",
    records.length,
    "records;",
    groups.length,
    "separate configs",
  );
}
if (require.main === module) {
  const mode = process.argv[2];
  Promise.resolve()
    .then(() =>
      mode === "--pilot"
        ? run(true)
        : mode === "--run"
          ? run(false)
          : mode === "--compile"
            ? compile()
            : mode === "--analyze"
              ? analyze()
              : null,
    )
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
module.exports = {
  validateTeam,
  validateResponse,
  requestFor,
  hash,
  measures,
  exportRecords,
};
