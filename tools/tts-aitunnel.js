// tts-aitunnel.js — синтез речи через AITunnel (OpenAI-совместимый /audio/speech).
//
// Ключ берётся из переменной окружения AITUNNEL_API_KEY (или --api-key), в код его не пишем.
// Внешних пакетов не нужно: работает на встроенном fetch (Node 18+).
//
// Примеры:
//   $env:AITUNNEL_API_KEY = 'sk-aitunnel-...'
//   node tools\tts-aitunnel.js --text "Привет! Это синтезированная речь от AITUNNEL." --out speech.mp3
//   node tools\tts-aitunnel.js --text "..." --model speech-2.8-turbo --voice Russian_ReliableMan --out ru.mp3
//   Get-Content script.txt -Raw | node tools\tts-aitunnel.js --voice onyx --out promo.mp3
//
// Голоса и модели: curl https://api.aitunnel.ru/public/aitunnel/models/speech (ключ не нужен).
// Поле russian_supported показывает, надёжно ли модель читает по-русски; у kokoro-82m его нет.
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://api.aitunnel.ru/v1';
const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'alloy';

const DEFAULT_FORMAT = 'mp3';
const DEFAULT_OUT = 'speech.mp3';

// OpenAI-совместимый /audio/speech принимает до 4096 символов, берём с запасом.
const MAX_INPUT = 4000;
// Ответ меньше этого считаем ошибкой: вместо аудио пришёл огрызок или JSON.
const MIN_AUDIO = 512;
const ATTEMPTS = 3;
const TIMEOUT_MS = 120000;
const FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];

class UsageError extends Error {}
class FatalError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function printHelp() {
  console.log([
    'Синтез речи через AITunnel (OpenAI-совместимый API).',
    '',
    'Использование:',
    '  node tools\\tts-aitunnel.js --text "текст" [--out speech.mp3]',
    '  node tools\\tts-aitunnel.js --file script.txt [--out speech.mp3]',
    '  Get-Content script.txt -Raw | node tools\\tts-aitunnel.js --out speech.mp3',
    '',
    'Параметры:',
    '  --text <строка>     текст для озвучки;',
    '  --file <путь>       прочитать текст из файла (UTF-8);',
    '  --out <путь>        куда сохранить аудио (по умолчанию speech.mp3);',
    '  --voice <голос>     голос, по умолчанию ' + DEFAULT_VOICE + ';',
    '  --model <модель>    модель, по умолчанию ' + DEFAULT_MODEL + ';',
    '  --format <формат>   ' + FORMATS.join(' | ') + ' (по умолчанию ' + DEFAULT_FORMAT + ');',
    '  --speed <число>     скорость 0.25–4.0 (по умолчанию голос как есть);',
    '  --instructions <т>  стиль подачи для gpt-4o-mini-tts, например «спокойно, уверенно»;',

    '  --base-url <url>    по умолчанию ' + DEFAULT_BASE_URL + ';',
    '  --api-key <ключ>    ключ AITunnel (лучше через AITUNNEL_API_KEY);',
    '  -h, --help          эта справка.',
    '',
    'Текст длиннее ' + MAX_INPUT + ' символов режется по предложениям; склейка',
    'поддерживается только для mp3 (для остальных форматов разбейте текст сами).',
    '',
    'Коды возврата: 0 — успех, 1 — ошибка сети/API, 2 — неверные параметры.',
  ].join('\n'));
}

function parseArgs(argv) {
  const options = {
    text: '',
    file: '',
    out: DEFAULT_OUT,
    voice: process.env.AITUNNEL_VOICE || DEFAULT_VOICE,
    model: process.env.AITUNNEL_MODEL || DEFAULT_MODEL,
    format: DEFAULT_FORMAT,
    speed: '',
    instructions: process.env.AITUNNEL_INSTRUCTIONS || '',
    baseUrl: process.env.AITUNNEL_BASE_URL || DEFAULT_BASE_URL,
    apiKey: process.env.AITUNNEL_API_KEY || '',
    help: false
  };

  const flags = {
    '--text': 'text',
    '--file': 'file',
    '--out': 'out',
    '--voice': 'voice',
    '--model': 'model',
    '--format': 'format',
    '--speed': 'speed',
    '--instructions': 'instructions',
    '--base-url': 'baseUrl',
    '--api-key': 'apiKey'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    let name = arg;
    let value;
    const equals = arg.indexOf('=');
    if (arg.startsWith('--') && equals > 0) {
      name = arg.slice(0, equals);
      value = arg.slice(equals + 1);
    }

    const key = flags[name];
    if (!key) {
      throw new UsageError('неизвестный параметр: ' + arg);
    }
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError('нет значения для ' + name);
      }
      index += 1;
    }
    options[key] = value;
  }

  if (options.help) {
    return options;
  }

  options.apiKey = String(options.apiKey || '').trim();
  options.format = String(options.format || DEFAULT_FORMAT).toLowerCase();
  if (FORMATS.indexOf(options.format) === -1) {
    throw new UsageError('неизвестный формат ' + options.format +
      ' (доступно: ' + FORMATS.join(', ') + ')');
  }

  if (String(options.speed).trim() !== '') {
    const speed = Number(options.speed);
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
      throw new UsageError('скорость должна быть числом 0.25–4.0');
    }
    options.speed = speed;
  } else {
    options.speed = 0;
  }

  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function resolveText(options) {
  if (options.text) {
    return options.text;
  }
  if (options.file) {
    return fs.readFileSync(path.resolve(options.file), 'utf8');
  }
  if (!process.stdin.isTTY) {
    return await readStdin();
  }
  throw new UsageError('не задан текст: используйте --text, --file или stdin');
}

// Режем по границам предложений, чтобы не порвать слово и интонацию.
function chunkText(text, limit) {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= limit) {
    return clean ? [clean] : [];
  }

  const chunks = [];
  let rest = clean;
  while (rest.length > limit) {
    const slice = rest.slice(0, limit);
    let cut = -1;
    const boundary = /[.!?…\n]+/g;
    let match;
    while ((match = boundary.exec(slice)) !== null) {
      if (match.index >= limit * 0.5) {
        cut = match.index + match[0].length;
      }
    }
    if (cut <= 0) {
      const space = slice.lastIndexOf(' ');
      cut = space > limit * 0.3 ? space : limit;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) {
    chunks.push(rest);
  }
  return chunks.filter((chunk) => chunk.length > 0);
}


function errorMessage(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return '';
  }
  try {
    const data = JSON.parse(text);
    if (typeof data.error === 'string') {
      return data.error;
    }
    if (data.error && data.error.message) {
      return String(data.error.message);
    }
    if (data.message) {
      return String(data.message);
    }
  } catch (error) {
    // не JSON — вернём как есть
  }
  return text.length > 300 ? text.slice(0, 300) + '…' : text;
}

async function requestChunk(text, options) {
  const body = {
    model: options.model,
    voice: options.voice,
    input: text,
    response_format: options.format
  };
  if (options.speed > 0) {
    body.speed = options.speed;
  }
  if (options.instructions) {
    body.instructions = options.instructions;
  }

  const url = String(options.baseUrl).replace(/\/+$/, '') + '/audio/speech';
  let lastError = '';

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + options.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/*'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });

      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.indexOf('application/json') === -1) {
        const audio = Buffer.from(await response.arrayBuffer());
        if (audio.length < MIN_AUDIO) {
          throw new Error('ответ слишком короткий (' + audio.length +
            ' байт) — похоже, аудио не пришло');
        }
        return audio;
      }

      const details = errorMessage(await response.text()) || response.statusText;
      if (response.ok) {
        // 200 + JSON — почти всегда неверная модель/голос; повтор не поможет.
        throw new FatalError('сервер вернул JSON вместо аудио: ' + details);
      }
      if (response.status === 401 || response.status === 403) {
        throw new FatalError('AITunnel отклонил ключ (HTTP ' + response.status + '): ' + details);
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = 'HTTP ' + response.status + ': ' + details;
      } else {
        throw new FatalError('HTTP ' + response.status + ': ' + details);
      }
    } catch (error) {
      if (error instanceof FatalError) {
        throw error;
      }
      lastError = error && error.name === 'TimeoutError'
        ? 'таймаут запроса (' + Math.round(TIMEOUT_MS / 1000) + ' c)'
        : (error && error.message ? error.message : String(error));
    }

    if (attempt < ATTEMPTS) {
      await sleep(700 * attempt);
    }
  }

  throw new Error(lastError || 'не удалось получить аудио');
}

// Синтез с автоматической нарезкой длинного текста. Возвращает готовый Buffer.
async function synthesize(text, options) {
  if (!options.apiKey) {
    throw new UsageError('не задан ключ AITunnel: переменная окружения AITUNNEL_API_KEY или --api-key');
  }

  const chunks = chunkText(text, options.maxInput || MAX_INPUT);
  if (chunks.length === 0) {
    throw new UsageError('пустой текст');
  }
  if (chunks.length > 1 && options.format !== 'mp3') {
    throw new UsageError(
      'текст длиннее ' + (options.maxInput || MAX_INPUT) + ' символов: для формата ' + options.format +
      ' разбейте его вручную (склейка поддерживается только для mp3)'
    );
  }

  const parts = [];
  for (let index = 0; index < chunks.length; index += 1) {
    if (chunks.length > 1) {
      process.stderr.write('Фрагмент ' + (index + 1) + '/' + chunks.length +
        ' (' + chunks[index].length + ' симв.)… ');
    }
    parts.push(await requestChunk(chunks[index], options));
    if (chunks.length > 1) {
      process.stderr.write('ok\n');
    }
  }
  return Buffer.concat(parts);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error('Ошибка: ' + error.message);
    console.error('Справка: node tools\\tts-aitunnel.js --help');
    return 2;
  }

  if (options.help) {
    printHelp();
    return 0;
  }

  try {
    const text = await resolveText(options);
    const audio = await synthesize(text, options);

    const outPath = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, audio);

    console.log('Готово: ' + outPath + ' (' + (audio.length / 1024).toFixed(1) + ' КБ)');
    return 0;
  } catch (error) {
    console.error('Ошибка: ' + error.message);
    return error instanceof UsageError ? 2 : 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  DEFAULT_BASE_URL: DEFAULT_BASE_URL,
  DEFAULT_MODEL: DEFAULT_MODEL,
  DEFAULT_VOICE: DEFAULT_VOICE,
  MAX_INPUT: MAX_INPUT,
  FORMATS: FORMATS,
  UsageError: UsageError,
  FatalError: FatalError,
  parseArgs: parseArgs,
  chunkText: chunkText,
  requestChunk: requestChunk,
  synthesize: synthesize
};

