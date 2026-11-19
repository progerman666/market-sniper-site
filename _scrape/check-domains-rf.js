// check-domains-rf.js — проверка кириллических доменов .рф (punycode + WHOIS ТЦИ).
const net = require('net');
const { domainToASCII } = require('url');

const CANDIDATES = ['снайпер-маркет.рф', 'маркет-снайпер.рф', 'прибыль-маркет.рф', 'маржа.рф'];

function whois(domain) {
  return new Promise((resolve) => {
    let data = '';
    const socket = net.connect(43, 'whois.tcinet.ru', () => socket.write(domain + '\r\n'));
    socket.setTimeout(8000);
    socket.on('data', (chunk) => (data += chunk));
    socket.on('end', () => resolve(data));
    socket.on('timeout', () => { socket.destroy(); resolve(data || 'TIMEOUT'); });
    socket.on('error', () => resolve('ERR'));
  });
}

(async () => {
  for (const name of CANDIDATES) {
    const ascii = domainToASCII(name);
    const response = await whois(ascii);
    const status = /No entries found/i.test(response)
      ? 'СВОБОДЕН'
      : (/^domain:/im.test(response) ? 'занят' : 'неизвестно');
    console.log(name.padEnd(20) + ascii.padEnd(28) + status);
    await new Promise((r) => setTimeout(r, 400));
  }
})();
