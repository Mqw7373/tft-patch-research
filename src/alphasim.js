/* AlphaSim saved-response adapter. No engine code, network calls or game database. */
(function (root) {
  "use strict";
  const keys = [
    "hp",
    "maxHp",
    "mana",
    "shield",
    "curAD",
    "curAP",
    "curAS",
    "curArmor",
    "curMR",
    "armorShredPct",
    "mrShredPct",
    "durabilityPct",
    "dmgAmpPct",
    "dead",
    "ccEnd",
    "castingEnd",
    "channelEnd",
    "attackRange",
    "attackWasBlocked",
  ];
  const finite = (n) => typeof n === "number" && Number.isFinite(n);
  const fail = (message) => {
    throw new Error(message);
  };
  const array = (v, name) =>
    Array.isArray(v) ? v : fail(`缺少数组 ${name}，不是支持的完整日志。`);
  function parse(record, label = "Imported battle") {
    if (!record || typeof record !== "object") fail("日志必须是 JSON 对象。");
    const d = record.response?.data ?? record.data ?? record;
    const times = array(d.timeAxis, "timeAxis");
    if (
      times.length < 2 ||
      times.length > 20000 ||
      times[0] !== 0 ||
      times.some((t, i) => !finite(t) || (i && t <= times[i - 1]))
    )
      fail("timeAxis 必须从 0 开始，严格递增，长度 2–20000。");
    if (!["my", "enemy", "en", "draw"].includes(d.winner))
      fail("缺少有效的 winner。");
    const battle = {
      trial: record.trial || 1,
      label,
      winner: d.winner === "en" ? "enemy" : d.winner,
      times,
      request: record.request || null,
      sides: {},
      events: [],
      warnings: [],
      original: record,
      synthetic: record.synthetic === true,
    };
    for (const side of ["my", "en"]) {
      const champs = array(d[side + "ReplayChamps"], side + "ReplayChamps");
      const initial = array(
        d[side === "my" ? "myChamps" : "enemyChamps"],
        "initial champions",
      );
      if (
        !champs.length ||
        champs.length > 64 ||
        initial.length > champs.length
      )
        fail("单位数量不受支持。");
      for (const suffix of [
        "CsSnaps",
        "PosSnaps",
        "CumDmg",
        "DeathTimes",
        "TotalDmg",
      ]) {
        if (array(d[side + suffix], side + suffix).length !== champs.length)
          fail(`${side + suffix} 单位数不匹配。`);
      }
      battle.sides[side] = champs.map((c, i) => {
        if (
          !c ||
          typeof c.apiName !== "string" ||
          !Number.isInteger(c.stars) ||
          c.stars < 1 ||
          c.stars > 4 ||
          !finite(c.mm) ||
          c.mm < 0
        )
          fail(`单位 ${side}:${i} 基础字段无效。`);
        if (i < initial.length && initial[i]?.apiName !== c.apiName)
          fail("初始单位与回放单位顺序不一致。");
        const stats = array(d[side + "CsSnaps"][i], "CsSnaps"),
          positions = array(d[side + "PosSnaps"][i], "PosSnaps"),
          cum = array(d[side + "CumDmg"][i], "CumDmg");
        if ([stats, positions, cum].some((a) => a.length !== times.length))
          fail(`单位 ${side}:${i} 快照长度不匹配。`);
        stats.forEach((s) => {
          if (
            !s ||
            ["hp", "maxHp", "mana", "shield"].some((k) => !finite(s[k])) ||
            s.maxHp <= 0
          )
            fail("生命 / 法力 / 护盾快照无效。");
        });
        if (
          positions.some(
            (p) =>
              !p ||
              !finite(p.cx) ||
              !finite(p.cy) ||
              p.cx < -2 ||
              p.cx > 9 ||
              p.cy < -2 ||
              p.cy > 10,
          ) ||
          cum.some((x) => !finite(x) || x < 0)
        )
          fail("位置或累计伤害数据无效。");
        const death = d[side + "DeathTimes"][i],
          total = d[side + "TotalDmg"][i];
        if (
          (death !== null && (!finite(death) || death < 0)) ||
          !finite(total) ||
          total < 0
        )
          fail("死亡时刻或全场伤害无效。");
        let birth = 0,
          birthNote = "开战单位";
        if (i >= initial.length) {
          // Known ceiling: only Krug death summons have a supported inferred birth rule.
          // Other summons stay off-board until a documented timestamp is supported.
          const parent = champs.findIndex((x) => x.apiName === "DA_Krug18");
          if (
            String(c.id).startsWith("death_summon_DA_Krug18_") &&
            parent >= 0 &&
            finite(d[side + "DeathTimes"][parent])
          ) {
            birth = d[side + "DeathTimes"][parent];
            birthNote = "按石甲虫死亡时刻推定出生；出生前快照为补齐值";
          } else {
            birth = null;
            birthNote = "出生时刻未知，不在棋盘显示";
            battle.warnings.push(`${side}:${i} ${c.apiName}：${birthNote}`);
          }
        }
        return {
          api: c.apiName,
          name: String(c.displayName || c.name || c.apiName),
          stars: c.stars,
          items: (c.equipment || []).map((it) =>
            String(it.name || it.itemApiName || "unknown"),
          ),
          manaMax: c.mm,
          initial: i < initial.length,
          birth,
          birthNote,
          death,
          positions,
          stats: stats.map((s) => keys.map((k) => s[k] ?? null)),
          cum,
          total,
          ability: c.ability || null,
          preCombatSacrifice: c.preCombatSacrifice || null,
          loadedStats: Object.fromEntries(
            [
              "hp",
              "ap",
              "ad",
              "as",
              "armor",
              "mr",
              "rawBaseHp",
              "rawBaseAd",
              "rawBaseAp",
              "rawBaseArmor",
              "rawBaseMr",
              "s18RiftbeastAlphaMarked",
              "s18PermanentBonusAP",
              "s18PermanentBonusHealth",
            ].map((k) => [k, c[k] ?? null]),
          ),
        };
      });
      d[side + "DeathTimes"].forEach((t, ci) => {
        if (t !== null)
          battle.events.push({
            t,
            side,
            ci,
            kind: "death",
            raw: { deathTime: t },
          });
      });
      for (const [suffix, kind] of [
        ["CastEvents", "cast"],
        ["DmgPopEvents", "damage"],
      ]) {
        if (!Array.isArray(d[side + suffix]))
          battle.warnings.push(`${side + suffix} 缺失，相关事件不可查看。`);
        for (const event of d[side + suffix] || []) {
          if (
            !event ||
            !finite(event.t) ||
            event.t < 0 ||
            !Number.isInteger(event.ci) ||
            event.ci < 0 ||
            event.ci >= champs.length ||
            (kind === "damage" && !finite(event.dmg))
          )
            fail(`${side + suffix} 事件字段无效。`);
          for (const k of ["stage", "popKind", "abType"])
            if (
              event[k] != null &&
              !["number", "string"].includes(typeof event[k])
            )
              fail(`事件 ${k} 字段无效。`);
          if (
            event.targetCis != null &&
            (!Array.isArray(event.targetCis) ||
              event.targetCis.some((x) => !Number.isInteger(x)))
          )
            fail("targetCis 无效。");
          battle.events.push({
            t: event.t,
            side,
            ci: event.ci,
            kind: kind === "damage" && event.dmg < 0 ? "heal" : kind,
            raw: event,
          });
        }
      }
    }
    for (const e of battle.events)
      if (
        e.kind === "damage" &&
        (!Number.isInteger(e.raw.tci) ||
          !battle.sides[e.side === "my" ? "en" : "my"][e.raw.tci])
      )
        fail("伤害目标索引不匹配。");
    const tail = battle.events.filter((e) => e.t > times.at(-1) + 1e-6).length;
    if (tail)
      battle.warnings.push(
        `${tail} 条事件晚于最后一个状态采样点；保留事件原值，无法展示其对应时刻的状态。`,
      );
    battle.events.sort((a, b) => a.t - b.t);
    return battle;
  }
  async function readRecords(file) {
    if (file.size > 50 * 1024 * 1024) fail("单文件不能超过 50 MB。");
    const buffer = await file.arrayBuffer(),
      bytes = new Uint8Array(buffer);
    let stream = new Blob([buffer]).stream();
    if (bytes[0] === 31 && bytes[1] === 139) {
      if (typeof DecompressionStream === "undefined")
        fail("当前浏览器不支持 gzip，请先解压为 JSON。");
      stream = stream.pipeThrough(new DecompressionStream("gzip"));
    }
    const reader = stream.getReader(),
      chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 512 * 1024 * 1024) {
        await reader.cancel();
        fail("解压后的日志超过 512 MB。");
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      joined.set(c, offset);
      offset += c.length;
    }
    const raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(joined),
    );
    const result = parseRecords(raw, file.name);
    result.rawBytes = size;
    return result;
  }
  function parseRecords(raw, label = "Imported battle") {
    const records =
      raw?.format === "tft-replay-session/v1" ? raw.records : [raw];
    if (!Array.isArray(records) || !records.length || records.length > 100)
      fail("多场记录必须包含 1–100 场。");
    return records.map((r, i) =>
      parse(r, records.length === 1 ? label : label + " #" + (i + 1)),
    );
  }
  async function readFile(file) {
    const records = await readRecords(file);
    if (records.length !== 1) fail("多场文件请使用 readRecords");
    return records[0];
  }
  root.AlphaSim = { keys, parse, readFile, readRecords, parseRecords };
  if (typeof module !== "undefined") module.exports = root.AlphaSim;
})(typeof window !== "undefined" ? window : globalThis);
