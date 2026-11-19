// rates.js — справочник комиссий Mercado Livre Brasil (общий для content.js и popup.js).
// Проверено по справочникам продавцов Mercado Livre Brasil.
// commission — доля от цены (не проценты), например 0.14 = 14 %.
// icms — approximate share of ICMS/PIS/COFINS the seller keeps in mind (Brazil).

var ML_DEFAULTS = {
  commission: 0.14,      // comissão de venda ML (11 % – 19 % dependendo categoria)
  fixedFee: 0,           // custo fixo por unidade (se preço abaixo do limite da categoria)
  logistics: 0,          // frete (Mercado Envios), R$ por pedido
  ads: 0,                // publicidade por venda, R$
  cost: 0,               // custo do produto (compra ao fornecedor), R$
  icms: 0.12,            // estimativa de impostos (ICMS/PIS/COFINS) — ajustar pelo seu estado
  country: 'BR',
  currency: 'BRL'
};

// Formato de dinheiro brasileiro: R$ 1.234,56
function mlFmtMoney(value) {
  if (value === null || value === undefined || !isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Math.round(value));
}

function mlFmtPct(fraction) {
  if (fraction === null || fraction === undefined || !isFinite(fraction)) return '—';
  return String(Math.round(fraction * 1000) / 10).replace('.', ',') + '%';
}

// Lucro = preço − comissão − custo fixo − frete − publicidade − custo produto − impostos aproximados
function mlNetProfit(price, settings) {
  var s = settings || {};
  var p = Number(price) || 0;
  var comissao = p * Number(s.commission || 0);
  var fixo = Number(s.fixedFee || 0);
  var frete = Number(s.logistics || 0);
  var pub = Number(s.ads || 0);
  var custo = Number(s.cost || 0);
  var impostos = p * Number(s.icms || 0);

  return Math.round(p - comissao - fixo - frete - pub - custo - impostos);
}

// Preço de equilíbrio (sem prejuízo): p * (1 - c - icms) = fixo + frete + pub + custo
function mlBreakEven(settings) {
  var s = settings || {};
  var rate = Number(s.commission || 0) + Number(s.icms || 0);
  if (rate >= 1) return null;
  var fixed = Number(s.fixedFee || 0) + Number(s.logistics || 0) +
              Number(s.ads || 0) + Number(s.cost || 0);
  return Math.round(fixed / (1 - rate));
}

// Preço alvo para margem desejada (em %)
function mlTargetMarginPrice(settings, marginPercent) {
  var s = settings || {};
  var rate = Number(s.commission || 0) + Number(s.icms || 0);
  var margin = Number(marginPercent) / 100;
  var denominator = 1 - rate - margin;
  if (denominator <= 0) return null;
  var fixed = Number(s.fixedFee || 0) + Number(s.logistics || 0) +
              Number(s.ads || 0) + Number(s.cost || 0);
  return Math.round(fixed / denominator);
}

// Estatísticas de mercado (mesma estrutura que rates.js do Yandex)
function mlMarketStats(prices, currentPrice) {
  var list = [];
  (prices || []).forEach(function (value) {
    var p = Number(value);
    if (isFinite(p) && p > 0) list.push(p);
  });
  if (!list.length) return null;

  list.sort(function (a, b) { return a - b; });

  var mid = Math.floor(list.length / 2);
  var median = list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;

  var stats = {
    count: list.length,
    min: list[0],
    max: list[list.length - 1],
    median: Math.round(median),
    current: null,
    position: null,
    cheaperCount: null
  };

  var current = Number(currentPrice);
  if (isFinite(current) && current > 0) {
    var cheaper = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] < current) cheaper++;
    }
    stats.current = current;
    stats.cheaperCount = cheaper;
    stats.position = cheaper + 1;
  }

  return stats;
}