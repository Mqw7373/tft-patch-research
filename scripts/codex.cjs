const fs = require("node:fs"),
  path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const root = path.resolve(__dirname, "..");
const sessionFile = path.join(root, ".codex-session.json");

// Use executable argv, never a shell; npm .cmd shims are resolved to their JS entry point.
function executable(file) {
  if (/\.cmd$/i.test(file)) {
    const js = path.join(
      path.dirname(file),
      "node_modules/@openai/codex/bin/codex.js",
    );
    if (!fs.existsSync(js))
      throw Error(
        "无法解析 Codex cmd 启动器，请将 CODEX_BIN 设为 codex.exe 或 codex.js。",
      );
    return [process.execPath, js];
  }
  return /\.js$/i.test(file) ? [process.execPath, file] : [file];
}
function discover() {
  if (process.env.CODEX_BIN)
    return executable(path.resolve(process.env.CODEX_BIN));
  const candidates = [];
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const bin = path.join(process.env.LOCALAPPDATA, "OpenAI/Codex/bin");
    if (fs.existsSync(bin))
      for (const d of fs.readdirSync(bin)) {
        const p = path.join(bin, d, "codex.exe");
        if (fs.existsSync(p)) candidates.push(p);
      }
  }
  for (const d of (process.env.PATH || "").split(path.delimiter)) {
    for (const name of process.platform === "win32"
      ? ["codex.exe", "codex.cmd"]
      : ["codex"]) {
      const p = path.join(d, name);
      if (fs.existsSync(p)) candidates.push(p);
    }
  }
  const found = [...new Set(candidates)]
    .map((p) => {
      try {
        const argv = executable(p),
          r = spawnSync(argv[0], [...argv.slice(1), "--version"], {
            encoding: "utf8",
            timeout: 10000,
            windowsHide: true,
          });
        const version = r.stdout
          ?.match(/(\d+)\.(\d+)\.(\d+)/)
          ?.slice(1)
          .map(Number);
        return r.status === 0 && version ? { argv, version } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.version[0] - a.version[0] ||
        b.version[1] - a.version[1] ||
        b.version[2] - a.version[2],
    );
  if (!found.length)
    throw Error(
      "未找到 Codex。请安装并登录 Codex CLI，或用 CODEX_BIN 指定可执行文件。",
    );
  return found[0].argv;
}
class Client {
  constructor(argv) {
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.child = spawn(
      argv[0],
      [
        ...argv.slice(1),
        "-c",
        "sandbox_workspace_write.network_access=true",
        "app-server",
      ],
      { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    // Don't copy service diagnostics, account details or config contents into reports.
    this.child.stderr.resume();
    const fail = (e) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(e);
      }
      this.pending.clear();
    };
    this.child.on("error", fail);
    this.child.on("exit", (code) => {
      fail(Error("Codex 服务已退出（" + code + "）"));
      for (const fn of this.listeners)
        fn({ method: "connection/closed", params: { code } });
    });
    readline
      .createInterface({ input: this.child.stdout })
      .on("line", (line) => {
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          return;
        }
        if (m.id !== undefined && !m.method) {
          const p = this.pending.get(m.id);
          if (!p) return;
          clearTimeout(p.timer);
          this.pending.delete(m.id);
          m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
        } else if (m.method && m.id !== undefined) {
          // The launcher cannot silently approve permissions or answer on the user's behalf.
          this.send({
            id: m.id,
            error: {
              code: -32601,
              message: "此启动器不处理交互审批；请在 Codex 中处理后重试。",
            },
          });
        } else for (const fn of this.listeners) fn(m);
      });
  }
  send(m) {
    this.child.stdin.write(JSON.stringify(m) + "\n");
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id,
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(Error("Codex 请求超时：" + method));
        }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  async close() {
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 3000);
    timer.unref();
  }
}
function binding(file = sessionFile, cwd = root) {
  if (!fs.existsSync(file)) return null;
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    s.project !== cwd ||
    typeof s.threadId !== "string" ||
    !/^[\w-]+$/.test(s.threadId)
  )
    throw Error("会话绑定与此项目不匹配；使用 --new 创建本项目研究会话。");
  return s;
}
function threadParams(config, cwd = root) {
  const p = { cwd, approvalPolicy: "never", sandbox: "workspace-write" };
  if (typeof config.model === "string" && config.model) p.model = config.model;
  return p;
}
async function inspect(client, saved) {
  await client.call("initialize", {
    clientInfo: { name: "tft_patch_research", version: "0.2.0" },
  });
  client.send({ method: "initialized", params: {} });
  const auth = await client.call("account/read", { refreshToken: false });
  if (!auth.account)
    throw Error("Codex 尚未登录，请先运行 codex login，再重新启动。");
  const conf = await client.call("config/read", {
    cwd: root,
    includeLayers: false,
  });
  if (saved) {
    const { thread } = await client.call("thread/read", {
      threadId: saved.threadId,
      includeTurns: false,
    });
    if (path.resolve(thread.cwd) !== root)
      throw Error("已保存会话属于其他目录，拒绝自动接入。");
    if (thread.status?.type === "active")
      throw Error("研究会话正在运行；请等待它结束后再启动。");
  }
  return { config: conf.config || {}, accountType: auth.account.type };
}
async function main(args = process.argv.slice(2)) {
  if (args.some((x) => !["--check", "--new"].includes(x)))
    throw Error("用法：npm run research:codex -- [--check] [--new]");
  const saved = args.includes("--new") ? null : binding();
  const client = new Client(discover());
  let lock;
  try {
    const info = await inspect(client, saved);
    console.log(
      "Codex 已登录：" +
        info.accountType +
        "；模型：" +
        (info.config.model || "Codex 默认") +
        "；会话：" +
        (saved ? saved.threadId : "首次运行时自动创建"),
    );
    if (args.includes("--check")) return;
    const lockPath = path.join(root, ".codex-research.lock");
    try {
      lock = fs.openSync(lockPath, "wx");
    } catch {
      throw Error("已有研究进程或遗留锁；请确认旧进程结束，勿重复启动。");
    }
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    const params = threadParams(info.config);
    const r = saved
      ? await client.call("thread/resume", {
          ...params,
          threadId: saved.threadId,
        })
      : await client.call("thread/start", params);
    const id = r.thread.id;
    fs.writeFileSync(
      sessionFile,
      JSON.stringify({ project: root, threadId: id }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(root, "reports"), { recursive: true });
    console.log(
      "研究会话：" + id + "。使用 Ctrl+C 中断；下次启动会继续此会话。",
    );
    const completion = new Promise((resolve, reject) => {
      client.listeners.add((m) => {
        if (m.method === "connection/closed")
          reject(Error("Codex 连接中断，可重新启动继续研究。"));
        if (m.params?.threadId !== id) return;
        if (m.method === "item/agentMessage/delta")
          process.stdout.write(m.params.delta || "");
        if (m.method === "turn/completed") {
          const t = m.params.turn;
          t.status === "completed"
            ? resolve()
            : reject(Error(t.error?.message || "研究回合状态：" + t.status));
        }
      });
    });
    completion.catch(() => {});
    let turn,
      interrupted = false;
    const stop = () => {
      interrupted = true;
      if (turn)
        client
          .call("turn/interrupt", { threadId: id, turnId: turn.id })
          .catch(() => {});
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      const prefix =
        "手动开始本项目研究。使用 Codex 已有登录和默认模型。先运行 npm run monitor 获取当前来源；如果失败，先审计真实错误，继续可以核验的工作，不伪造模拟结果。此处是本机执行，data 与 reports 位于当前仓库，不依赖 GitHub 缓存。不要重新提交、推送或部署代码。\n\n";
      ({ turn } = await client.call("turn/start", {
        threadId: id,
        input: [
          {
            type: "text",
            text:
              prefix +
              fs.readFileSync(
                path.join(root, ".github/prompts/research.md"),
                "utf8",
              ),
          },
        ],
      }));
      if (interrupted) stop();
      await completion;
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
    console.log("\n研究回合结束，报告位于 reports/。");
  } finally {
    if (lock !== undefined) {
      fs.closeSync(lock);
      fs.unlinkSync(path.join(root, ".codex-research.lock"));
    }
    await client.close();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { binding, threadParams, inspect, Client, executable };
