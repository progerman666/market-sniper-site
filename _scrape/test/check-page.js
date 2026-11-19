// check-page.js — читает состояние страницы из запущенного Edge через CDP (порт 9333).
(async () => {
  const http = require('http');
  const getJSON = (url) => new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const PORT = process.argv[2] || '9333';
  const list = await getJSON('http://127.0.0.1:' + PORT + '/json');
  const page = list.find((t) => t.type === 'page' && /^https?:/.test(t.url));
  if (!page) {
    console.log('НЕ НАЙДЕН page-таргет. Все таргеты:');
    list.forEach((t) => console.log(' -', t.type, t.url.slice(0, 100)));
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };

  const send = (method, params) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  await new Promise((resolve) => (ws.onopen = resolve));

  const logs = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push('console.' + msg.params.type + ': ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Log.entryAdded') {
      logs.push('log.' + msg.params.entry.level + ': ' + msg.params.entry.text);
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    return res && res.result ? res.result.value : undefined;
  };

  if (process.argv[3] === 'reload') {
    await send('Page.reload', { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 6000));
  } else {
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  const badgeExpr = "(document.getElementById('ms-profit-badge') || {}).textContent || 'БЕЙДЖА НЕТ'";
  const priceExpr = "(document.querySelector('[data-zone-name=\"price\"] [data-auto=\"snippet-price-current\"]') || {}).textContent || 'ЦЕНА НЕ НАЙДЕНА'";
  const sellerExpr = "(document.querySelector('[data-auto=\"shop-info-title\"]') || {}).textContent || 'МАГАЗИН НЕ НАЙДЕН'";

  console.log('path        :', await evaluate('location.pathname'));
  console.log('price       :', await evaluate(priceExpr));
  console.log('seller      :', await evaluate(sellerExpr));
  console.log('badge       :', await evaluate(badgeExpr));
  console.log('badge parent:', await evaluate("(document.getElementById('ms-profit-badge') ? document.getElementById('ms-profit-badge').previousElementSibling.getAttribute('data-zone-name') : 'нет')"));

  const ours = logs.filter((line) => line.indexOf('Снайпер') > -1);
  console.log('--- лог расширения ---');
  console.log(ours.length ? ours.join('\n') : '(нет сообщений от расширения)');
  console.log('--- ошибки страницы ---');
  const errors = logs.filter((line) => /error|uncaught|extension/i.test(line)).slice(0, 8);
  console.log(errors.length ? errors.join('\n') : '(нет)');

  ws.close();
  process.exit(0);
})();
