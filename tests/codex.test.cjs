const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  binding,
  threadParams,
  inspect,
  Client,
} = require("../scripts/codex.cjs");
test("model comes from user config, not a fixed model override", () => {
  assert.equal(threadParams({ model: "user-default" }).model, "user-default");
  assert.equal(Object.hasOwn(threadParams({}), "model"), false);
  assert.equal(threadParams({}).sandbox, "workspace-write");
});
test("only this project binding is resumed; never global latest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-binding-")),
    file = path.join(dir, "session.json");
  try {
    assert.equal(binding(file, dir), null);
    fs.writeFileSync(
      file,
      JSON.stringify({ project: dir, threadId: "thread-test" }),
    );
    assert.equal(binding(file, dir).threadId, "thread-test");
    assert.throws(() => binding(file, path.dirname(dir)), /不匹配/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("check does not start a turn; missing login is reported", async () => {
  const calls = [],
    client = {
      send() {},
      async call(method) {
        calls.push(method);
        return method === "account/read"
          ? { account: { type: "chatgpt" } }
          : method === "config/read"
            ? { config: { model: "default-model" } }
            : {};
      },
    };
  assert.equal((await inspect(client, null)).accountType, "chatgpt");
  assert.deepEqual(calls, ["initialize", "account/read", "config/read"]);
  await assert.rejects(
    inspect(
      {
        send() {},
        async call() {
          return {};
        },
      },
      null,
    ),
    /尚未登录/,
  );
});
test("JSON-RPC transport works over stdio and reports server errors", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rpc-")),
    file = path.join(dir, "fake.cjs");
  fs.writeFileSync(
    file,
    `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id!==undefined)console.log(JSON.stringify(m.method==='bad'?{id:m.id,error:{message:'test error'}}:{id:m.id,result:{ok:true}}));});`,
  );
  const client = new Client([process.execPath, file]);
  try {
    assert.deepEqual(await client.call("initialize"), { ok: true });
    await assert.rejects(client.call("bad"), /test error/);
  } finally {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("launcher creates then resumes its session with current defaults and releases locks on failure", () => {
  const { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-launcher-"));
  try {
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.mkdirSync(path.join(dir, ".github/prompts"), { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, "../scripts/codex.cjs"),
      path.join(dir, "scripts/codex.cjs"),
    );
    fs.writeFileSync(
      path.join(dir, ".github/prompts/research.md"),
      "Test prompt only.",
    );
    const fake = path.join(dir, "fake.js");
    fs.writeFileSync(
      fake,
      `
const fs = require('node:fs');
const send = m => console.log(JSON.stringify(m));
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  fs.appendFileSync('requests.jsonl', JSON.stringify(m) + '\\n');
  if(m.id === undefined) return;
  let result = {};
  if(m.method === 'account/read') result = {account:{type:'chatgpt'}};
  if(m.method === 'config/read') result = {config:{model:process.env.TEST_MODEL}};
  if(m.method.startsWith('thread/')) result = {thread:{id:'test-thread',cwd:process.cwd(),status:{type:'idle'}}};
  if(m.method === 'turn/start') result = {turn:{id:'test-turn'}};
  send({id:m.id,result});
  if(m.method === 'turn/start') send({method:'turn/completed',params:{threadId:'test-thread',turn:{id:'test-turn',status:process.env.TEST_FAIL ? 'failed' : 'completed',error:process.env.TEST_FAIL ? {message:'fixture failure'} : null}}});
});
`,
    );
    const run = (args = [], extra = {}) =>
      spawnSync(process.execPath, ["scripts/codex.cjs", ...args], {
        cwd: dir,
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
        env: {
          ...process.env,
          CODEX_BIN: fake,
          TEST_MODEL: "default-one",
          ...extra,
        },
      });
    const session = path.join(dir, ".codex-session.json");
    let r = run(["--check"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(session), false);
    r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(session)), {
      project: dir,
      threadId: "test-thread",
    });
    r = run([], { TEST_MODEL: "default-two" });
    assert.equal(r.status, 0, r.stderr);
    let requests = fs
      .readFileSync(path.join(dir, "requests.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(requests.filter((m) => m.method === "thread/start").length, 1);
    assert.equal(
      requests.find((m) => m.method === "thread/start").params.model,
      "default-one",
    );
    assert.equal(
      requests.find((m) => m.method === "thread/resume").params.model,
      "default-two",
    );
    assert.equal(
      requests.find((m) => m.method === "thread/resume").params.threadId,
      "test-thread",
    );
    r = run([], { TEST_FAIL: "1" });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /fixture failure/);
    assert.equal(fs.existsSync(path.join(dir, ".codex-research.lock")), false);
    fs.writeFileSync(path.join(dir, ".codex-research.lock"), "existing lock");
    r = run();
    assert.equal(r.status, 1, r.stderr);
    assert.equal(
      fs.readFileSync(path.join(dir, ".codex-research.lock"), "utf8"),
      "existing lock",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
