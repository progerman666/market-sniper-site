// check-domains.js — проверка занятости доменов .ru через WHOIS ТЦИ (whois.tcinet.ru:43).
const net = require('net');

const CANDIDATES = [
  // бренд
  'sniper-market.ru',
  'market-sniper.ru',
  'market-snaiper.ru',
  'marksnaiper.ru',
  'marksniper.ru',
  'sniper-market24.ru',
  // цена и прицел
  'sniper-price.ru',
  'price-sniper.ru',
  'torg-sniper.ru',
  'sniper-pribyl.ru',
  // прибыль и маржа
  'sniperprofit.ru',
  'profit-sniper.ru',
  'cleanprofit.ru',
  'marketprofit24.ru',
  'pribyl-market.ru',
  'market-marza.ru',
  'marzha.ru',
  'torgprofit.ru',
  // короткие
  'msniper.ru',
  'snipr.ru',
  'snaiper24.ru',
  'sellersniper.ru',
  'seller-tools.ru',
  'myprofit.ru',
  'profitmarket.ru'
];

function whois(domain, server) {
  return new Promise((resolve) => {
    let data = '';
    const socket = net.connect(43, server, () => socket.write(domain + '\r\n'));
    socket.setTimeout(9000);
    socket.on('data', (chunk) => (data += chunk));
    socket.on('end', () => resolve(data));
    socket.on('timeout', () => { socket.destroy(); resolve(data || 'TIMEOUT'); });
    socket.on('error', (e) => resolve('ERR ' + e.message));
  });
}

(async () => {
  for (const domain of CANDIDATES) {
    const isRu = domain.endsWith('.ru') || domain.endsWith('.рф');
    const server = isRu ? 'whois.tcinet.ru' : 'whois.nic.market';
    const response = await whois(domain, server);

    let status = 'неизвестно';
    if (/No entries found/i.test(response) || /nothing found/i.test(response)) status = 'СВОБОДЕН';
    else if (/^domain:/im.test(response) || /created:/i.test(response)) status = 'занят';
    else if (/TIMEOUT|ERR/i.test(response)) status = response.slice(0, 40);

    console.log(domain.padEnd(20) + status +
      (status === 'занят' && /created:/im.test(response) ? '  (' + (response.match(/created:\s*(\S+)/i) || [])[1] + ')' : ''));
    await new Promise((r) => setTimeout(r, 400));
  }
})();
