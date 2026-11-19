// dzen-article.js — собирает HTML-страницу статьи из markdown-файла в promo\dzen.
//
// Зачем: Дзен-студия — визуальный редактор, markdown она не понимает. Если копировать текст
// из браузера, заголовки, жирный и списки сохраняются, а `##` и `**` вставляются как мусор.
// Скрипт делает страницу, с которой текст копируется «как есть».
//
// Запуск:
//   node tools\dzen-article.js
//   node tools\dzen-article.js --in promo\dzen\article-01-pribyl-na-kartochke.md --out promo\dzen\article-01.html
//
// Что понимает: `##`-заголовки, списки `-` и `1.`, `**жирный**`, `код`, ссылки,
// разделители `---` и метки иллюстраций вида
//   [ИЛЛЮСТРАЦИЯ 1] `site/img/badge.png` — подпись: «…»
// Всё, что вне статьи (метаданные и чек-лист), в HTML не попадает.
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SITE = 'https://sniper.gadget-nakhodki.ru';
const DEFAULT_IN = path.join(root, 'promo', 'dzen', 'article-01-pribyl-na-kartochke.md');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  const value = i > -1 ? process.argv[i + 1] : undefined;
  return value && !value.startsWith('--') ? value : fallback;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1">$1</a>');
  return out;
}

// site/img/… отдаётся с боевого сайта, остальные пути оставляем как есть.
function imageUrl(localPath) {
  const normalized = localPath.replace(/\\/g, '/');
  if (normalized.startsWith('site/')) {
    return SITE + '/' + normalized.slice('site/'.length);
  }
  return normalized;
}

function renderFigure(line) {
  // Метка вида: [ИЛЛЮСТРАЦИЯ 1] `site/img/badge.png` — подпись: «…»
  const match = line.match(/^\[[^\]]+\]\s+`([^`]+)`[^«]*«(.+)»\s*$/);
  if (!match) { return null; }
  const caption = match[2];
  const src = imageUrl(match[1]);
  return '<figure><img src="' + src + '" alt="' + escapeHtml(caption) + '">'
    + '<figcaption>' + inline(caption) + '</figcaption></figure>';
}

function convert(markdown) {
  const lines = markdown.split(/\r?\n/);

  // Тело статьи лежит между первым и последним разделителем --- :
  // выше — метаданные для студии, ниже — чек-лист публикации.
  const rules = [];
  lines.forEach((line, index) => {
    if (line.trim() === '---') { rules.push(index); }
  });
  if (!rules.length) {
    throw new Error('В файле нет разделителей ---, не видно границ статьи');
  }
  const startRule = rules[0];
  const endRule = rules.length > 1 ? rules[rules.length - 1] : lines.length;
  const body = lines.slice(startRule + 1, endRule);

  const html = [];
  let paragraph = [];
  let listTag = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push('<p>' + inline(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listTag) {
      html.push('</' + listTag + '>');
      listTag = null;
    }
  };
  const openList = (tag) => {
    if (listTag !== tag) {
      closeList();
      html.push('<' + tag + '>');
      listTag = tag;
    }
  };

  body.forEach((rawLine) => {
    const line = rawLine.replace(/\s+$/, '');

    if (!line.trim()) {
      flushParagraph();
      closeList();
      return;
    }

    const figure = renderFigure(line.trim());
    if (figure) {
      flushParagraph();
      closeList();
      html.push(figure);
      return;
    }

    if (line.trim() === '---') {
      flushParagraph();
      closeList();
      html.push('<hr>');
      return;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      closeList();
      html.push('<h3>' + inline(line.slice(4)) + '</h3>');
      return;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      closeList();
      html.push('<h2>' + inline(line.slice(3)) + '</h2>');
      return;
    }

    const unordered = line.match(/^-\s+(.*)$/);
    if (unordered) {
      flushParagraph();
      openList('ul');
      html.push('<li>' + inline(unordered[1]) + '</li>');
      return;
    }

    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      openList('ol');
      html.push('<li>' + inline(ordered[1]) + '</li>');
      return;
    }

    // Строка с отступом — продолжение предыдущего пункта списка.
    if (/^\s{2,}/.test(rawLine) && listTag && html.length) {
      const last = html.length - 1;
      html[last] = html[last].replace(/<\/li>$/, ' ' + inline(line.trim()) + '</li>');
      return;
    }

    paragraph.push(line.trim());
  });

  flushParagraph();
  closeList();
  return html.join('\n');
}


function page(contentHtml, title) {
  return '<!DOCTYPE html>\n'
    + '<html lang="ru">\n'
    + '<head>\n'
    + '<meta charset="utf-8">\n'
    + '<title>' + escapeHtml(title) + '</title>\n'
    + '<!-- Копируйте содержимое (Ctrl+A, Ctrl+C) и вставляйте в Дзен-студию:\n'
    + '     заголовки, жирный, списки, ссылки и картинки сохранятся. -->\n'
    + '<style>\n'
    + '  body { margin: 0; background: #fff; color: #1a1a1a; font: 18px/1.65 -apple-system, "Segoe UI", Roboto, sans-serif; }\n'
    + '  article { max-width: 720px; margin: 40px auto; padding: 0 20px 60px; }\n'
    + '  h2 { font-size: 26px; line-height: 1.3; margin: 38px 0 14px; }\n'
    + '  h3 { font-size: 21px; margin: 28px 0 10px; }\n'
    + '  p { margin: 14px 0; }\n'
    + '  ul, ol { margin: 14px 0; padding-left: 26px; }\n'
    + '  li { margin: 8px 0; }\n'
    + '  figure { margin: 26px 0; }\n'
    + '  img { max-width: 100%; height: auto; border-radius: 10px; display: block; }\n'
    + '  figcaption { color: #6b7280; font-size: 15px; margin-top: 8px; }\n'
    + '  code { background: #f3f4f6; border-radius: 4px; padding: 1px 5px; font-size: 15px; }\n'
    + '  hr { border: 0; border-top: 1px solid #e5e7eb; margin: 34px 0; }\n'
    + '  a { color: #1d4ed8; }\n'
    + '</style>\n'
    + '</head>\n'
    + '<body>\n'
    + '<article>\n'
    + contentHtml + '\n'
    + '</article>\n'
    + '</body>\n'
    + '</html>\n';
}

const inPath = path.resolve(root, arg('in', DEFAULT_IN));
const outPath = path.resolve(root, arg('out', inPath.replace(/\.md$/i, '.html')));

if (!fs.existsSync(inPath)) { throw new Error('Нет файла статьи: ' + inPath); }

const markdown = fs.readFileSync(inPath, 'utf8');
const titleMatch = markdown.match(/^#\s+(.+)$/m);
const content = convert(markdown);
const result = page(content, titleMatch ? titleMatch[1] : path.basename(inPath));

fs.writeFileSync(outPath, result, 'utf8');

const plain = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const count = (re) => (content.match(re) || []).length;

console.log('Готово: ' + outPath);
console.log('  знаков в тексте без разметки: ' + plain.length);
console.log('  абзацев: ' + count(/<p>/g)
  + ', подзаголовков: ' + count(/<h2>/g)
  + ', иллюстраций: ' + count(/<figure>/g)
  + ', ссылок: ' + count(/<a /g));
if (!count(/<figure>/g)) {
  console.log('  ВНИМАНИЕ: не найдено ни одной метки иллюстрации');
}
console.log('Откройте файл в браузере, выделите всё и вставьте в Дзен-студию.');

