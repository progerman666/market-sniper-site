// popup.js — popup: coleta dados da página, tabela de cálculo e configuração das taxas.
// VAI AQUI: document.getElementById('collect') existe apenas neste popup (regras do projeto).
var STORAGE_KEY = 'ml-settings';
var DEFAULTS = (typeof ML_DEFAULTS !== 'undefined') ? ML_DEFAULTS : {
  commission: 0.14, fixedFee: 0, logistics: 0, ads: 0, cost: 0, icms: 0.12, country: 'BR', currency: 'BRL'
};

var els = {
  collect: document.getElementById('collect'),
  table: document.getElementById('data'),
  out: document.getElementById('out'),
  country: document.getElementById('country'),
  price: document.getElementById('price'),
  commission: document.getElementById('commission'),
  fixedFee: document.getElementById('fixedFee'),
  logistics: document.getElementById('logistics'),
  ads: document.getElementById('ads'),
  cost: document.getElementById('cost'),
  icms: document.getElementById('icms'),
  applyCategory: document.getElementById('apply-category'),
  reset: document.getElementById('reset'),
  hint: document.getElementById('hint'),
  status: document.getElementById('status'),
  licenseKey: document.getElementById('license-key'),
  activate: document.getElementById('activate'),
  licenseMsg: document.getElementById('license-msg'),
  buy: document.getElementById('buy')
};

var CONTROL_IDS = ['country', 'commission', 'fixedFee', 'logistics', 'ads', 'cost', 'icms', 'apply-category', 'reset'];
var access = null;

var saveTimer = null;
var lastData = null;

function fmtMoney(value) {
  if (value === null || value === undefined || !isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Math.round(value));
}

function fmtPercent(fraction) {
  if (fraction === null || fraction === undefined || !isFinite(fraction)) return '—';
  return String(Math.round(fraction * 1000) / 10).replace('.', ',') + '%';
}

function readForm() {
  var commissionPercent = parseFloat(els.commission.value);
  return {
    commission: isFinite(commissionPercent) ? commissionPercent / 100 : DEFAULTS.commission,
    fixedFee: parseFloat(els.fixedFee.value) || 0,
    logistics: parseFloat(els.logistics.value) || 0,
    ads: parseFloat(els.ads.value) || 0,
    cost: parseFloat(els.cost.value) || 0,
    icms: parseFloat(els.icms.value) || 0,
    country: els.country.value
  };
}

function fillForm(settings) {
  var s = Object.assign({}, DEFAULTS, settings || {});
  els.country.value = s.country;
  els.commission.value = Math.round(s.commission * 1000) / 10;
  els.fixedFee.value = s.fixedFee || '';
  els.logistics.value = s.logistics || '';
  els.ads.value = s.ads || '';
  els.cost.value = s.cost ? s.cost : '';
  els.icms.value = Math.round(s.icms * 1000) / 10;
  renderHint();
}
function renderTable(data) {
  var t = els.table;
  t.textContent = '';
  if (!data) return;

  function row(label, value, cls) {
    var tr = document.createElement('tr');
    var td1 = document.createElement('td');
    td1.textContent = label;
    var td2 = document.createElement('td');
    td2.textContent = value;
    if (cls) td2.className = cls;
    tr.appendChild(td1);
    tr.appendChild(td2);
    t.appendChild(tr);
  }

  row('Preço de venda', data.price ? fmtMoney(data.price) : '—');
  row('Comissão ML', data.settings.commission ? fmtMoney(data.price * data.settings.commission) : '—');
  row('Custo fixo por unidade', fmtMoney(data.settings.fixedFee));
  row('Frete', fmtMoney(data.settings.logistics));
  row('Publicidade', fmtMoney(data.settings.ads));
  row('Custo do produto', fmtMoney(data.settings.cost));
  row('Impostos (ICMS)', data.settings.icms ? fmtMoney(data.price * data.settings.icms) : '—');

  var profitCls = data.profit >= 0 ? 'profit' : 'loss';
  row('Lucro líquido', fmtMoney(data.profit), profitCls);
  if (data.margin !== null) {
    row('Margem sobre o preço', fmtPercent(data.margin / 100));
  }
}

function renderStatus() {
  if (!els.status) return;
  if (access.mode === 'pro') {
    els.status.className = 'status status-pro';
    els.status.textContent = 'Versão completa ativa';
  } else if (access.mode === 'trial') {
    els.status.className = 'status status-trial';
    els.status.textContent = 'Período de teste: ' + access.daysLeft + ' dia(s) restante(s)';
  } else {
    els.status.className = 'status status-expired';
    els.status.textContent = 'Teste expirado — apenas cálculo básico';
  }
}

function saveSettings() {
  var s = readForm();
  chrome.storage.local.set({ [STORAGE_KEY]: s }, function () {
    settings = s;
  });
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 800);
}

function getActiveTab() {
  return new Promise(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      resolve(tabs[0]);
    });
  });
}

function renderHint() {
  var parts = [];
  parts.push('Preço de venda − comissão ML − frete − publicidade − custo do produto − impostos = lucro.');
  parts.push('Ajuste o ICMS de acordo com o seu estado e regime tributário.');
  els.hint.textContent = parts.join(' ');
}
[els.country, els.commission, els.fixedFee, els.logistics, els.ads, els.cost, els.icms].forEach(function (el) {
  el.addEventListener('input', scheduleSave);
  el.addEventListener('change', scheduleSave);
});

els.collect.addEventListener('click', async function () {
  els.collect.disabled = true;
  els.out.textContent = '';
  try {
    var tab = await getActiveTab();
    if (!tab || !tab.id) {
      els.out.textContent = 'Abra uma página do Mercado Livre Brasil.';
      return;
    }
    var data = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT' });
    if (!data) {
      els.out.textContent = 'Página não respondeu. Atualize-a.';
      return;
    }
    if (data.status === 'no-price') {
      els.out.textContent = 'Não foi possível ler o preço nesta página.';
      return;
    }
    lastData = data;
    renderTable(data);
    if (data.access) {
      access = data.access;
      renderStatus();
    }
  } catch (e) {
    els.out.textContent = 'Erro: ' + e.message + '\n(Abra mercadolivre.com.br e atualize a página)';
  } finally {
    els.collect.disabled = false;
  }
});

els.reset.addEventListener('click', function () {
  fillForm(DEFAULTS);
  saveSettings();
  els.out.textContent = '';
  els.table.textContent = '';
  lastData = null;
});
els.activate.addEventListener('click', async function () {
  var raw = els.licenseKey.value.trim();
  if (!raw) {
    els.licenseMsg.style.color = '#c0392b';
    els.licenseMsg.textContent = 'Cole a chave recebida após o pagamento';
    return;
  }
  if (typeof msActivateKey !== 'function') {
    els.licenseMsg.style.color = '#c0392b';
    els.licenseMsg.textContent = 'Módulo de licença não carregado';
    return;
  }
  els.activate.disabled = true;
  try {
    var result = await msActivateKey(raw);
    if (result.ok) {
      els.licenseKey.value = '';
      els.licenseMsg.style.color = '#0b7a3b';
      els.licenseMsg.textContent = 'Chave aceita. Versão completa ativada.';
      try {
        var tab = await getActiveTab();
        if (tab && tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' });
      } catch (e) { /* aba não é ML */ }
    } else {
      els.licenseMsg.style.color = '#c0392b';
      els.licenseMsg.textContent = result.error || 'Chave não serviu';
    }
  } finally {
    els.activate.disabled = false;
  }
});

// --- init ---
fillForm(DEFAULTS);
renderHint();
chrome.storage.local.get(STORAGE_KEY).then(function (res) {
  fillForm((res && res[STORAGE_KEY]) || DEFAULTS);
  renderStatus();
});