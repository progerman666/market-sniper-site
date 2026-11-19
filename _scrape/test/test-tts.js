// test-tts.js — проверка tools/tts-aitunnel.js на локальном мок-сервере AITunnel.
// Реальный API не вызывается: проверяем тело запроса, заголовки, ретраи, чанки и коды выхода.
//
// Запуск: node _scrape\test\test-tts.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');
const cli = path.join(root, 'tools', 'tts-aitunnel.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-aitunnel-'));
const AUDIO = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]), Buffer.alloc(2048, 0x11)]);

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!ok) failed = 1;
}

let requests = [];
let script = [];
let server;
let base;

// script — очередь ответов мок-сервера. Пустая очередь отвечает аудио.
function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(raw); } catch (error) { body = null; }
        requests.push({ url: req.url, method: req.method, headers: req.headers, body, raw });
        const next = script.shift() || { audio: true };
        setTimeout(() => {
          if (next.audio) {
            res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(AUDIO.length) });
            res.end(AUDIO);
            return;
          }
          res.writeHead(next.status || 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(next.body || { error: { message: 'mock error' } }));
        }, next.delay || 0);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      base = 'http://127.0.0.1:' + server.address().port;
      resolve();
    });
  });
}

function runCli(args, env, stdin) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli].concat(args), {
      cwd: tmp,
      env: Object.assign({}, process.env, { AITUNNEL_API_KEY: '' }, env || {}),
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString('utf8'); });
    child.stderr.on('data', (data) => { stderr += data.toString('utf8'); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (stdin !== undefined) {
      child.stdin.end(stdin);
    }
  });
}

function reset(state) {
  requests = [];
  script = state || [];
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

(async () => {
  await startServer();
  const key = { AITUNNEL_API_KEY: 'test-key' };
  const api = ['--base-url', base + '/v1'];

  // 1. Обычный синтез: файл, заголовок авторизации, тело запроса.
  reset([{ audio: true }]);
  const okOut = path.join(tmp, 'nested', 'ok.mp3');
  const ok = await runCli(['--text', 'Привет, мир!', '--out', okOut].concat(api), key);
  check('успех: код 0', ok.code === 0, ok.stderr.trim());
  check('успех: файл записан', Buffer.isBuffer(read(okOut)) && read(okOut).equals(AUDIO));
  check('успех: создана папка вывода', fs.existsSync(path.dirname(okOut)));
  check('успех: один запрос', requests.length === 1, requests.length);
  const first = requests[0] || { headers: {}, body: {} };
  check('успех: URL /v1/audio/speech', first.url === '/v1/audio/speech', first.url);
  check('успех: метод POST', first.method === 'POST', first.method);
  check('успех: Bearer-ключ', first.headers.authorization === 'Bearer test-key', first.headers.authorization);
  check('успех: модель по умолчанию', first.body && first.body.model === 'gpt-4o-mini-tts', first.body && first.body.model);
  check('успех: голос по умолчанию', first.body && first.body.voice === 'alloy', first.body && first.body.voice);
  check('успех: формат mp3', first.body && first.body.response_format === 'mp3', first.body && first.body.response_format);
  check('успех: без instructions по умолчанию', first.body && first.body.instructions === undefined, first.body && first.body.instructions);
  check('успех: текст передан как есть', first.body && first.body.input === 'Привет, мир!', first.body && first.body.input);

  // 2. Без ключа — ошибка параметров, запрос не уходит.
  reset([]);
  const noKeyOut = path.join(tmp, 'nokey.mp3');
  const noKey = await runCli(['--text', 'тест', '--out', noKeyOut].concat(api));
  check('без ключа: код 2', noKey.code === 2, noKey.code);
  check('без ключа: подсказка про AITUNNEL_API_KEY', /AITUNNEL_API_KEY/.test(noKey.stderr), noKey.stderr.trim());
  check('без ключа: запросов нет', requests.length === 0, requests.length);
  check('без ключа: файл не создан', !fs.existsSync(noKeyOut));

  // 3. 401 — сразу ошибка, без повторов.
  reset([{ audio: false, status: 401, body: { error: { message: 'Invalid API key' } } }]);
  const badKey = await runCli(['--text', 'тест', '--out', path.join(tmp, 'bad.mp3')].concat(api),
    { AITUNNEL_API_KEY: 'bad-key' });
  check('401: код 1', badKey.code === 1, badKey.code);
  check('401: текст ошибки', /401/.test(badKey.stderr) && /Invalid API key/.test(badKey.stderr), badKey.stderr.trim());
  check('401: один запрос, без ретраев', requests.length === 1, requests.length);

  // 4. 500 + 503, затем успех — должны быть ретраи.
  reset([
    { audio: false, status: 500, body: { error: { message: 'upstream down' } } },
    { audio: false, status: 503, body: { error: { message: 'unavailable' } } },
    { audio: true }
  ]);
  const retryOut = path.join(tmp, 'retry.mp3');
  const retry = await runCli(['--text', 'повтор', '--out', retryOut].concat(api), key);
  check('ретраи: код 0', retry.code === 0, retry.stderr.trim());
  check('ретраи: три запроса', requests.length === 3, requests.length);
  check('ретраи: файл записан', Buffer.isBuffer(read(retryOut)) && read(retryOut).equals(AUDIO));

  // 5. JSON с кодом 200 вместо аудио — ошибка, а не битый mp3.
  reset([{ audio: false, status: 200, body: { error: { message: 'model not found' } } }]);
  const jsonOut = path.join(tmp, 'json.mp3');
  const json = await runCli(['--text', 'модель', '--out', jsonOut].concat(api), key);
  check('JSON вместо аудио: код 1', json.code === 1, json.code);
  check('JSON вместо аудио: сообщение', /model not found/.test(json.stderr), json.stderr.trim());
  check('JSON вместо аудио: без ретраев', requests.length === 1, requests.length);
  check('JSON вместо аудио: файл не создан', !fs.existsSync(jsonOut));


  // 6. Длинный текст режется на фрагменты <= 4000 символов и склеивается.
  const long = Array.from({ length: 120 }, (unused, index) =>
    'Строка ' + (index + 1) + ' про чистую прибыль на маркетплейсе.').join(' ');
  reset([]);
  const longOut = path.join(tmp, 'long.mp3');
  const longRun = await runCli(['--text', long, '--out', longOut].concat(api), key);
  check('чанки: текст длиннее лимита', long.length > 4000, long.length);
  check('чанки: код 0', longRun.code === 0, longRun.stderr.trim());
  check('чанки: несколько запросов', requests.length > 1, requests.length);
  check('чанки: каждый фрагмент <= 4000',
    requests.every((item) => item.body && item.body.input.length <= 4000),
    requests.map((item) => item.body && item.body.input.length).join(','));
  check('чанки: файл склеен из всех ответов',
    Buffer.isBuffer(read(longOut)) && read(longOut).length === requests.length * AUDIO.length,
    read(longOut) && read(longOut).length);
  const restored = requests.map((item) => item.body.input).join(' ').replace(/\s+/g, ' ');
  check('чанки: текст сохранён целиком', restored === long.replace(/\s+/g, ' '));

  // 7. Текст из файла.
  const scriptFile = path.join(tmp, 'script.txt');
  fs.writeFileSync(scriptFile, 'Файл со сценарием промо.', 'utf8');
  reset([]);
  const fileOut = path.join(tmp, 'file.mp3');
  const fromFile = await runCli(['--file', scriptFile, '--out', fileOut,
    '--instructions', 'деловая подача'].concat(api), key);
  check('--file: код 0', fromFile.code === 0, fromFile.stderr.trim());
  check('--file: текст прочитан', requests[0] && requests[0].body.input === 'Файл со сценарием промо.',
    requests[0] && requests[0].body.input);
  check('--instructions: передан в запрос', requests[0] && requests[0].body.instructions === 'деловая подача',
    requests[0] && requests[0].body.instructions);

  // 8. Текст из stdin.
  reset([]);
  const stdinOut = path.join(tmp, 'stdin.mp3');
  const fromStdin = await runCli(['--out', stdinOut].concat(api), key, 'Текст из stdin.');
  check('stdin: код 0', fromStdin.code === 0, fromStdin.stderr.trim());
  check('stdin: текст прочитан', requests[0] && requests[0].body.input === 'Текст из stdin.',
    requests[0] && requests[0].body.input);

  // 9. Неизвестный параметр и справка.
  reset([]);
  const unknown = await runCli(['--bogus', 'x'], key);
  check('неизвестный параметр: код 2', unknown.code === 2, unknown.code);
  check('неизвестный параметр: сообщение', /неизвестный параметр/.test(unknown.stderr), unknown.stderr.trim());
  const help = await runCli(['--help'], key);
  check('--help: код 0', help.code === 0, help.code);
  check('--help: содержит --text', /--text/.test(help.stdout));
  check('--help: запросов нет', requests.length === 0, requests.length);

  console.log(failed ? 'ITOG: FAIL' : 'ITOG: OK');
})().catch((error) => {
  console.error('ERROR:', error && error.stack ? error.stack : error);
  failed = 1;
}).finally(() => {
  if (server) {
    server.close();
  }
  if (!failed) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
});

