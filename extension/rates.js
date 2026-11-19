// rates.js — справочник ставок Яндекс.Маркета, общий для content.js и popup.js.
// Проверено 14.11.2026 по официальной справке:
//   https://yandex.ru/support/marketplace/ru/introduction/rates/placement      (тариф за размещение, %)
//   https://yandex.ru/support/marketplace/ru/introduction/rates/models/fby     (доставка 5%, max 1000 ₽; средняя миля от 92 ₽)
//   https://yandex.ru/support/marketplace/ru/introduction/rates/models/fbs
//   https://yandex.ru/support/marketplace/ru/introduction/rates/models/dbs
// Тариф за размещение в 2026 одинаков для FBY / FBS / Экспресс / DBS, но различается по категориям.

// Значения по умолчанию (как в ТЗ MVP). commission — доля от цены, не проценты.
var MS_DEFAULTS = {
  commission: 0.42,      // 42% — официальный тариф Маркета для категории «Все товары»
  logistics: 100,        // ₽ за заказ
  ads: 0,                // ₽ за заказ
  cost: 0,               // себестоимость товара, ₽ (0 — не задана)
  model: 'FBS',
  category: 'Все товары'
};

// Верхнеуровневые категории: доля от указанной продавцом цены товара.
var MS_PLACEMENT = {
  'Все товары': 0.42,
  'Авто': 0.52,
  'Аптека': 0.52,
  'Бытовая техника': 0.51,
  'Дача, сад и огород': 0.52,
  'Детские товары': 0.52,
  'Досуг и развлечения': 0.52,
  'Книги': 0.43,
  'Компьютерная техника': 0.515,
  'Оборудование': 0.52,
  'Одежда, обувь и аксессуары': 0.52,
  'Продукты': 0.52,
  'Ритуальные товары': 0.50,
  'Спорт и отдых': 0.53,
  'Строительство и ремонт': 0.53,
  'Товары для дома': 0.52,
  'Товары для животных': 0.50,
  'Товары для красоты': 0.52,
  'Цветы, букеты, композиции': 0.32,
  'Электроника': 0.515
};

// Прочие услуги, которые влияют на прибыль (для подсказок и пресетов).
var MS_TARIFFS = {
  deliveryPercent: 0.05,   // доставка покупателю в FBY/FBS: 5% от цены
  deliveryMax: 1000,       // но не больше 1000 ₽
  avgMileBase: 92,         // средняя миля: 92 ₽ за первый литр
  avgMilePerLiter: 8,      // + 8 ₽ за каждый литр сверх 1 (до 200 л)
  cheapPriceMax: 300,      // тариф для недорогих товаров: цена <= 300 ₽
  cheapVolumeMax: 5,       // и объём <= 5 л
  cheapRate: 0.42          // 42% — вместо размещения + доставки + средней мили
};

// Схемы работы — человеческими словами: аббревиатура остаётся в скобках для тех, кто её знает.
var MS_MODELS = {
  'FBY': {
    option: 'Товар на складе Маркета (FBY)',
    short: 'склад Маркета',
    full: 'товар лежит на складе Маркета — он сам хранит, пакует и доставляет покупателю'
  },
  'FBS': {
    option: 'Свой склад, доставка Маркета (FBS)',
    short: 'свой склад, везёт Маркет',
    full: 'вы храните и отгружаете заказы, а везёт покупателю Маркет'
  },
  'DBS': {
    option: 'Свой склад и своя доставка (DBS)',
    short: 'свой склад и своя доставка',
    full: 'вы храните и доставляете сами, Маркет — только витрина'
  },
  'Экспресс': {
    option: 'Быстрая доставка за 1–2 часа (Экспресс)',
    short: 'быстрая доставка',
    full: 'товар на складе рядом с городом, покупателю привозят за 1–2 часа'
  }
};

function msModelShort(code) {
  var model = MS_MODELS[code];
  return model ? model.short : String(code || '');
}

function msModelOption(code) {
  var model = MS_MODELS[code];
  return model ? model.option : String(code || '');
}

function msModelFull(code) {
  var model = MS_MODELS[code];
  return model ? model.full : '';
}

function msEstimateLogistics(price) {
  var t = MS_TARIFFS;
  var delivery = Math.min(price * t.deliveryPercent, t.deliveryMax);
  return Math.round(delivery + t.avgMileBase);
}

// Доля комиссии для категории: 42% в дефолте, свой тариф — по кнопке в попапе.
function msCategoryCommission(category) {
  var rate = MS_PLACEMENT[category];
  return typeof rate === 'number' ? rate : MS_DEFAULTS.commission;
}

// ---------------------------------------------------------------------------
// Рыночные данные и обратная задача цены.
// Прибыль считается после себестоимости: price * (1 - commission) - logistics - ads - cost.
// Эти функции общие для content.js и popup.js — держим их здесь, чтобы не дублировать.
// ---------------------------------------------------------------------------

function msNum(value) {
  var n = Number(value);
  return isFinite(n) ? n : 0;
}

// Прибыль с продажи (после закупки). cost — себестоимость товара.
function msNetProfit(price, settings) {
  var s = settings || {};
  var p = msNum(price);
  return Math.round(p * (1 - msNum(s.commission)) - msNum(s.logistics) - msNum(s.ads) - msNum(s.cost));
}

// Минимальная цена без убытка: price * (1 - c) = logistics + ads + cost.
function msBreakEvenPrice(settings) {
  var s = settings || {};
  var rate = msNum(s.commission);
  if (rate >= 1) return null;
  var fixed = msNum(s.logistics) + msNum(s.ads) + msNum(s.cost);
  return Math.round(fixed / (1 - rate));
}

// Цена, при которой от цены остаётся нужная маржа (в процентах, например 20).
// price * (1 - c - m) = logistics + ads + cost
function msTargetMarginPrice(settings, marginPercent) {
  var s = settings || {};
  var rate = msNum(s.commission);
  var margin = msNum(marginPercent) / 100;
  var denominator = 1 - rate - margin;
  if (denominator <= 0) return null; // ставка + желаемая маржа не оставляют места цене
  var fixed = msNum(s.logistics) + msNum(s.ads) + msNum(s.cost);
  return Math.round(fixed / denominator);
}

// Сводка по ценам конкурентов: count / min / max / median / квартили.
// currentPrice — цена товара, на карточке которого открыт попап.
function msMarketStats(prices, currentPrice) {
  var list = [];
  (prices || []).forEach(function (value) {
    var p = Number(value);
    if (isFinite(p) && p > 0) list.push(p);
  });
  if (!list.length) return null;

  list.sort(function (a, b) { return a - b; });

  var mid = Math.floor(list.length / 2);
  var median = list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  var q = function (share) {
    var index = Math.min(list.length - 1, Math.max(0, Math.round((list.length - 1) * share)));
    return list[index];
  };

  var stats = {
    count: list.length,
    min: list[0],
    max: list[list.length - 1],
    median: Math.round(median),
    p25: q(0.25),
    p75: q(0.75),
    current: null,
    position: null,
    cheaperCount: null,
    percentBelowMedian: null
  };

  var current = Number(currentPrice);
  if (isFinite(current) && current > 0) {
    var cheaper = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] < current) cheaper++;
    }
    stats.current = current;
    stats.cheaperCount = cheaper;
    stats.position = cheaper + 1; // 1 = самый дешёвый на рынке
    stats.percentBelowMedian = stats.median
      ? Math.round(((stats.median - current) / stats.median) * 1000) / 10
      : null;
  }

  return stats;
}

