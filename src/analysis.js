/* Statistics over recorded samples only. No combat model or interpolation. */
(function (root) {
  const canonical = (v) =>
    Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : v && typeof v === "object"
        ? "{" +
          Object.keys(v)
            .sort()
            .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
            .join(",") +
          "}"
        : JSON.stringify(v);
  function config(b) {
    if (
      !Array.isArray(b.request?.myLineup) ||
      !Array.isArray(b.request?.enemyLineup)
    )
      return null;
    const r = { ...b.request };
    for (const k of ["seed", "randomSeed", "iterations"]) delete r[k];
    return r;
  }
  function groups(battles) {
    const map = new Map(),
      opponents = new Map();
    return battles.reduce((out, b, index) => {
      const request = config(b),
        key = request
          ? canonical({ request, synthetic: b.synthetic })
          : "unknown:" + index;
      if (!map.has(key)) {
        const enemy = request
          ? canonical({
              lineup: request.enemyLineup,
              augments: request.enemyAugments,
              config: request.enemyConfig,
            })
          : "unknown:" + index;
        if (!opponents.has(enemy)) opponents.set(enemy, opponents.size + 1);
        const g = {
          id: out.length,
          label: "方案 " + (out.length + 1),
          request,
          opponent: opponents.get(enemy),
          indices: [],
          synthetic: b.synthetic,
        };
        map.set(key, g);
        out.push(g);
      }
      map.get(key).indices.push(index);
      return out;
    }, []);
  }
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const j = (sorted.length - 1) * p,
      i = Math.floor(j);
    return sorted[i] + (sorted[Math.ceil(j)] - sorted[i]) * (j - i);
  }
  function stats(values) {
    const a = values.filter(Number.isFinite).sort((a, b) => a - b);
    return {
      n: a.length,
      median: quantile(a, 0.5),
      q1: quantile(a, 0.25),
      q3: quantile(a, 0.75),
    };
  }
  function units(b, side, api) {
    const a = b.sides[side];
    if (!api) return a;
    const found = a.filter((u) => u.initial && u.api === api);
    return found.length === 1 ? found : null;
  }
  function damage(b, side, api, t) {
    const list = units(b, side, api);
    if (!list) return { value: null, reason: "单位缺失或同名多个" };
    if (b.times.at(-1) < t - 1e-6)
      return { value: null, reason: "已结束 / 记录不足 " + t + "s" };
    let i = 0;
    while (i + 1 < b.times.length && b.times[i + 1] <= t + 1e-6) i++;
    if (list.some((u) => u.birth === null && u.cum[i] > 0))
      return { value: null, reason: "召唤物出生时间未知" };
    return {
      value: list.reduce(
        (s, u) =>
          s + (u.birth !== null && b.times[i] + 1e-6 < u.birth ? 0 : u.cum[i]),
        0,
      ),
      sample: b.times[i],
    };
  }
  function metrics(b, side, api) {
    const list = units(b, side, api),
      u = list?.[0],
      indices = list ? list.map((x) => b.sides[side].indexOf(x)) : [];
    const events = b.events.filter(
      (e) => e.side === side && indices.includes(e.ci),
    );
    const first = events.find((e) => e.kind === "cast")?.t ?? null;
    const skill =
      events.find(
        (e) =>
          e.kind === "damage" &&
          e.raw.dmg > 0 &&
          e.raw.stage != null &&
          e.raw.popKind !== "burn",
      )?.t ?? null;
    const survival = (t) =>
      !u
        ? null
        : u.death !== null && u.death <= t + 1e-6
          ? 0
          : b.times.at(-1) >= t - 1e-6
            ? 1
            : null;
    return {
      team: [5, 10, 20].map((t) => damage(b, side, null, t)),
      carry: [5, 10, 20].map((t) => damage(b, side, api, t)),
      finalTeam: b.sides[side].reduce((s, u) => s + u.total, 0),
      finalCarry: list ? list.reduce((s, u) => s + u.total, 0) : null,
      firstCast: first,
      firstSkill: skill,
      death: u?.death ?? null,
      survival10: survival(10),
      survival20: survival(20),
    };
  }
  root.BattleAnalysis = { canonical, groups, stats, damage, metrics };
  if (typeof module !== "undefined") module.exports = root.BattleAnalysis;
})(typeof window !== "undefined" ? window : globalThis);
