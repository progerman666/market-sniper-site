// voiceover-aitunnel.js — озвучка промо-ролика «Маркет-Снайпер» через AITunnel и сборка MP4.
//
// Берёт готовый ролик promo\video\market-sniper-promo-9x16.mp4 (9:16, 16.5 с), синтезирует
// пять реплик, расставляет их по сценам и приклеивает дорожку через ffmpeg.
//
// Запуск:
//   $env:AITUNNEL_API_KEY = 'sk-aitunnel-...'
//   node tools\voiceover-aitunnel.js                       # озвучка + сборка
//   node tools\voiceover-aitunnel.js --force               # переозвучить (иначе файлы кэшируются)
//   node tools\voiceover-aitunnel.js --model speech-2.8-turbo --voice Russian_ReliableMan
//   node tools\voiceover-aitunnel.js --mock                # проверка сборки без API (тишина)
//
// Русский голос: у gpt-4o-mini-tts набор alloy/onyx/nova…, у speech-2.8-turbo — Russian_ReliableMan.
// Список: curl https://api.aitunnel.ru/public/aitunnel/models/speech
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tts = require('./tts-aitunnel.js');

const ROOT = path.join(__dirname, '..');
const VIDEO = path.join(ROOT, 'promo', 'video', 'market-sniper-promo-9x16.mp4');
const OUT = path.join(ROOT, 'promo', 'video', 'market-sniper-promo-9x16-voice-aitunnel.mp4');
const VOICE_DIR = path.join(ROOT, 'promo', 'video', 'voice', 'aitunnel');

const FFMPEG_CANDIDATES = [
  process.env.FFMPEG,
  'C:\\Program Files\\Jellyfin\\Server\\ffmpeg.exe',
  'ffmpeg'
].filter(Boolean);
const FFPROBE_CANDIDATES = [
  process.env.FFPROBE,
  'C:\\Program Files\\Jellyfin\\Server\\ffprobe.exe',
  'ffprobe'
].filter(Boolean);

// Реплики по сценам — как в tools/voiceover.py, чтобы совпадала синхронизация.
const LINES = [
  'Продаёте на маркетплейсе.',
  'Комиссия и доставка съедают маржу.',
  'Чистая прибыль — прямо на карточке.',
  'Ставки и налоги — один раз.',
  'Семь дней бесплатно.'
];

// Старты сцен и их длительность в секундах — из build-promo-video.ps1.
const STARTS = [0.0, 3.0, 7.0, 11.0, 14.0];
const SLOTS = [3.0, 4.0, 4.0, 3.0, 2.5];
const TOTAL = 16.5;

const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'onyx';
const DEFAULT_INSTRUCTIONS = 'Спокойный уверенный мужской голос, деловая подача, без пафоса.';

function printHelp() {
  console.log([
    'Озвучка промо-ролика через AITunnel.',
    '',
    'Использование: node tools\\voiceover-aitunnel.js [параметры]',
    '',
    '  --model <имя>      модель TTS (по умолчанию ' + DEFAULT_MODEL + ');',
    '  --voice <голос>    голос (по умолчанию ' + DEFAULT_VOICE + ');',
    '  --instructions <т> стиль подачи (по умолчанию "' + DEFAULT_INSTRUCTIONS + '");',
    '  --video <путь>     исходный ролик (по умолчанию promo\\video\\market-sniper-promo-9x16.mp4);',
    '  --out <путь>       итоговый MP4 (по умолчанию ...-voice-aitunnel.mp4);',
    '  --ffmpeg <путь>    путь к ffmpeg;',
    '  --ffprobe <путь>   путь к ffprobe;',
    '  --force            переозвучить реплики, даже если файлы уже есть;',
    '  --mock             не звать API, сгенерировать тишину (проверка сборки);',
    '  -h, --help         эта справка.'
  ].join('\n'));
}

function parseArgs(argv) {
  const options = {
    model: process.env.AITUNNEL_MODEL || DEFAULT_MODEL,
    voice: process.env.AITUNNEL_VOICE || DEFAULT_VOICE,
    instructions: process.env.AITUNNEL_INSTRUCTIONS || DEFAULT_INSTRUCTIONS,
    speed: 1,
    video: VIDEO,
    out: OUT,
    ffmpeg: '',
    ffprobe: '',
    force: false,
    mock: false,
    help: false
  };

  const valueFlags = {
    '--model': 'model',
    '--voice': 'voice',
    '--instructions': 'instructions',
    '--video': 'video',
    '--out': 'out',
    '--ffmpeg': 'ffmpeg',
    '--ffprobe': 'ffprobe'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--mock') {
      options.mock = true;
      continue;
    }

    let name = arg;
    let value;
    const equals = arg.indexOf('=');
    if (arg.startsWith('--') && equals > 0) {
      name = arg.slice(0, equals);
      value = arg.slice(equals + 1);
    }
    const key = valueFlags[name];
    if (!key) {
      throw new tts.UsageError('неизвестный параметр: ' + arg);
    }
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new tts.UsageError('нет значения для ' + name);
      }
      index += 1;
    }
    options[key] = value;
  }

  return options;
}

function resolveTool(explicit, candidates) {
  const list = [explicit].concat(candidates).filter(Boolean);
  for (const candidate of list) {
    const result = spawnSync(candidate, ['-version'], { encoding: 'utf8', windowsHide: true });
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
}

function probeDuration(ffprobe, file) {
  const result = spawnSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file
  ], { encoding: 'utf8', windowsHide: true });
  const value = parseFloat(String(result.stdout || '').trim());
  return Number.isFinite(value) ? value : 0;
}

// Тишина нужной длины: проверяем сборку без обращений к API.
function makeMock(ffmpeg, file, seconds) {
  const build = (codec) => [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
    '-t', String(seconds), '-c:a', codec, '-b:a', '64k', file
  ];
  let result = spawnSync(ffmpeg, build('libmp3lame'), { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    result = spawnSync(ffmpeg, build('mp3'), { encoding: 'utf8', windowsHide: true });
  }
  if (result.status !== 0 || !fs.existsSync(file) || fs.statSync(file).size < 500) {
    throw new Error('ffmpeg не сгенерировал тишину: ' + String(result.stderr || '').trim());
  }
}

async function synthLine(text, file, options) {
  // instructions понимает gpt-4o-mini-tts; другим моделям поле может не понравиться.
  const instructions = /gpt-4o-mini-tts/i.test(options.model) ? options.instructions : '';
  const audio = await tts.synthesize(text, {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    voice: options.voice,
    instructions: instructions,
    speed: options.speed,
    format: 'mp3'
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, audio);
  return audio.length;
}

// Собираем дорожку теми же фильтрами, что и tools/voiceover.py.
function buildVideo(ffmpeg, video, out, files, durations) {
  const filters = [];
  files.forEach((file, index) => {
    const slot = SLOTS[index] - 0.15;
    const fit = durations[index] > slot ? durations[index] / slot : 1;
    const tempo = CLAMP(fit, 1, 1.4);
    let chain = '[' + (index + 1) + ':a]aresample=48000';
    if (tempo > 1.01) {
      chain += ',atempo=' + tempo.toFixed(3);
    }
    const delay = Math.round(STARTS[index] * 1000);
    chain += ',adelay=' + delay + '|' + delay + '[a' + index + ']';
    filters.push(chain);
    console.log('  ' + (index + 1) + ': ' + durations[index].toFixed(2) + ' c, сцена ' +
      SLOTS[index].toFixed(1) + ' c, темп ' + tempo.toFixed(2));
  });

  const mix = files.map((file, index) => '[a' + index + ']').join('');
  filters.push(mix + 'amix=inputs=' + files.length + ':duration=longest:normalize=0,' +
    'apad,atrim=0:' + TOTAL + ',asetpts=N/SR/TB,loudnorm=I=-16:TP=-1.5:LRA=11[a]');

  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', video];
  files.forEach((file) => args.push('-i', file));
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart', '-shortest', out
  );

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error('ffmpeg не собрал видео: ' + String(result.stderr || '').trim());
  }
}

function CLAMP(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error('Ошибка: ' + error.message);
    console.error('Справка: node tools\\voiceover-aitunnel.js --help');
    return 2;
  }
  if (options.help) {
    printHelp();
    return 0;
  }

  try {
    options.apiKey = String(process.env.AITUNNEL_API_KEY || '').trim();
    options.baseUrl = process.env.AITUNNEL_BASE_URL || tts.DEFAULT_BASE_URL;

    if (!options.mock && !options.apiKey) {
      throw new tts.UsageError('не задан ключ AITunnel: переменная окружения AITUNNEL_API_KEY');
    }

    const ffmpeg = resolveTool(options.ffmpeg, FFMPEG_CANDIDATES);
    if (!ffmpeg) {
      throw new Error('не найден ffmpeg: укажите --ffmpeg или переменную FFMPEG');
    }
    const ffprobe = resolveTool(options.ffprobe, FFPROBE_CANDIDATES);

    if (!fs.existsSync(options.video)) {
      throw new Error('нет исходного видео: ' + options.video);
    }

    fs.mkdirSync(VOICE_DIR, { recursive: true });
    if (options.instructions && !/gpt-4o-mini-tts/i.test(options.model)) {
      console.log('Модель ' + options.model + ' не принимает instructions — стиль пропускаю');
    }
    const files = [];
    const durations = [];

    for (let index = 0; index < LINES.length; index += 1) {
      const file = path.join(VOICE_DIR, String(index + 1).padStart(2, '0') + '.mp3');
      const cached = !options.force && !options.mock &&
        fs.existsSync(file) && fs.statSync(file).size > 1000;

      if (cached) {
        console.log('Реплика ' + (index + 1) + ': кэш ' + file);
      } else if (options.mock) {
        console.log('Реплика ' + (index + 1) + ': тишина ' + SLOTS[index].toFixed(1) + ' c');
        makeMock(ffmpeg, file, SLOTS[index]);
      } else {
        console.log('Реплика ' + (index + 1) + ': ' + LINES[index]);
        const size = await synthLine(LINES[index], file, options);
        console.log('  ' + (size / 1024).toFixed(1) + ' КБ -> ' + file);
      }

      files.push(file);
      const probed = ffprobe ? probeDuration(ffprobe, file) : 0;
      durations.push(probed > 0 ? probed : Math.max(0.5, SLOTS[index] - 0.3));
      if (!ffprobe) {
        console.log('  ffprobe не найден — длительность считаю по сцене');
      }
    }

    console.log('Сборка…');
    buildVideo(ffmpeg, options.video, options.out, files, durations);

    const size = fs.statSync(options.out).size / (1024 * 1024);
    console.log('Готово: ' + options.out + ' (' + size.toFixed(2) + ' МБ)');
    if (ffprobe) {
      console.log('Длительность: ' + probeDuration(ffprobe, options.out).toFixed(2) + ' c');
    }
    return 0;
  } catch (error) {
    console.error('Ошибка: ' + error.message);
    return error instanceof tts.UsageError ? 2 : 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

