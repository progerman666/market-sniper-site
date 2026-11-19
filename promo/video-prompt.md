# Промты для видео-ИИ: «Маркет-Снайпер» (v2, кинематографичная версия)

Как пользоваться:
1. Выберите блок под свою модель: **A** — один промт на весь ролик (Sora 2, Veo 3, Kling 2.5),
   **B** — пять отдельных клипов (если модель генерирует по 3–5 секунд), **C** — стартовый кадр.
2. Формат: **9:16, 1080×1920, 24–30 fps**, 15 секунд (5 клипов по 3 с).
3. Обязательно добавьте **негативный промт (D)** — иначе появятся текст, логотипы и кривые руки.
4. Сгенерируйте 6–8 вариантов, выберите 5 удачных, остальное — монтаж, титры, музыка.

Важно: ни одна модель не рисует читаемый интерфейс и русский текст. В промте экран описан
как «абстрактные блоки без текста» — реальный скриншот расширения вставляется при монтаже.

---

## A. Один промт в одно поле (2413 символов из 4500)

Позитив и негатив в одном тексте — вставляется в одно поле: Sora 2, Veo 3, Kling 2.5. Раскадровка по кадрам — в разделе B.

```
Vertical 9:16 cinematic ad for a browser extension that shows real profit on marketplace product pages.
15 seconds, five shots, photorealistic, shot on 35mm anamorphic, shallow depth of field, subtle film
grain, 24fps, premium fintech mood. Color story: cold navy-blue monitor light (#0b1f3a) gradually
turns into warm gold (#f5c451) as the hero finds clarity. Smooth motivated camera moves, realistic
physics, natural skin texture, consistent character and wardrobe across all shots.

Hero: 32-year-old man, short dark hair, light stubble, grey hoodie, sitting at a wooden desk in a small
home office at night; shelves with cardboard parcels and a warm desk lamp behind him.

Shot 1 (0-3s): slow dolly-in through the dark room, dust motes floating in a beam of warm lamp light,
the man silhouetted by the cold glow of a laptop, deep shadows, cinematic contrast, screen content
unreadable and out of focus.

Shot 2 (3-6s): macro over-the-shoulder on the laptop screen with abstract blurred marketplace product
cards made of soft light blocks (no readable text, no interface), his fingers typing fast, coffee steam
drifting through the light, rack focus from hands to screen, realistic skin and fabric detail.

Shot 3 (6-9s): a gold light sweep passes across the screen and a floating holographic panel
materializes in front of him: abstract digits and a rising bar chart made of golden light particles,
soft volumetric glow reflecting on his face, slow orbit camera around the screen, subtle lens flare.

Shot 4 (9-12s): the man leans back from the laptop, exhales, gives a small tired-but-relieved smile;
the light on his face shifts from cold blue to warm gold, bokeh of the dark room behind, gentle
push-in, calm confident mood.

Shot 5 (12-15s): extreme macro of a golden sniper crosshair locking onto a rising luminous profit curve
over a deep navy background, floating gold particles, subtle lens flare, elegant minimal composition,
empty negative space on the right for a logo.

Style: premium fintech commercial, cinematic lighting, deep shadows, soft highlights, film grain, no
cuts inside a shot. Avoid: on-screen text, letters, captions, subtitles, logos, brand marks,
watermarks, distorted hands, extra or missing fingers, deformed face, warped screen, glitch, flicker,
cartoon, oversaturated colors, plastic CGI skin, low resolution, duplicated limbs, warped keyboard.
```

Негатив уже включён в промт строкой Style/Avoid. Если сервис принимает негатив отдельным полем — используйте короткий вариант из раздела D.
## B. Пять отдельных промтов (Kling / Runway / Hailuo / Pika)

Одинаковое описание героя во всех клипах — иначе лицо и одежда «поплывут».

**B1 — 0–3 с**
```
Vertical 9:16, cinematic photorealistic shot, 35mm anamorphic, shallow depth of field, film grain.
Slow dolly-in through a dark home office at night: dust motes in a beam of warm lamp light,
a 32-year-old man with short dark hair, light stubble and a grey hoodie silhouetted by the cold
glow of a laptop, shelves with cardboard parcels behind, deep shadows, screen unreadable.
No text, no logos, no watermark.
```

**B2 — 3–6 с**
```
Vertical 9:16, cinematic photorealistic macro, shallow depth of field. Over-the-shoulder view of a
laptop screen showing abstract blurred marketplace product cards (no text), the hands of a 32-year-old
man in a grey hoodie typing fast, coffee steam drifting through warm lamp light, rack focus from
hands to screen, realistic skin and fabric.
No text, no logos, no watermark.
```

**B3 — 6–9 с**
```
Vertical 9:16, cinematic photorealistic, slow orbit camera. A gold light sweep passes across a dark
laptop screen and a floating holographic panel materializes: abstract numbers and a rising bar chart
made of golden light particles, soft glow reflecting on the face of a 32-year-old man in a grey hoodie,
deep navy room, volumetric haze.
No readable text, no logos, no watermark.
```

**B4 — 9–12 с**
```
Vertical 9:16, cinematic photorealistic, slow push-in. A 32-year-old man with short dark hair and a
grey hoodie leans back from a laptop, exhales and gives a small tired-but-relieved smile; the light on
his face shifts from cold navy blue to warm gold, bokeh of a dark home office behind, natural skin
texture, film grain.
No text, no logos, no watermark.
```

**B5 — 12–15 с**
```
Vertical 9:16, cinematic macro, elegant minimal fintech look. A golden sniper crosshair locks onto a
rising luminous profit curve over deep navy background, floating gold particles, subtle lens flare,
smooth slow push-in, empty space on the right for a logo.
No text, no logos, no watermark.
```

## C. Стартовый кадр для Kling / Runway (Midjourney, Flux, Recraft)

```
Cinematic still, vertical 9:16: a 32-year-old man in a grey hoodie at a wooden desk at night, lit by a
cold laptop screen and a warm desk lamp, dark navy room with cardboard parcels on shelves, a faint
golden holographic profit chart glowing above the keyboard, shallow depth of field, film grain,
photorealistic, premium fintech mood, negative space on the right. --ar 9:16
```

## D. Негативный промт (обязательно)

```
text, letters, captions, subtitles, logo, brand marks, watermark, distorted hands, extra fingers,
missing fingers, deformed face, warped screen, glitch, flicker, jump cuts, oversaturated colors,
cartoon, anime, plastic CGI skin, low resolution, duplicated limbs, warped keyboard, messy background
```

## E. Вариант без людей (если человек в кадре не нужен)

```
Vertical 9:16, cinematic macro product commercial, 15 seconds, single continuous camera move.
A dark navy desk surface, a laptop screen with abstract blurred marketplace product cards (no text).
A gold light sweep reveals a floating holographic profit panel: rising bar chart and abstract numbers
made of golden particles, soft depth of field, subtle reflections on the desk, dust motes in the air,
slow orbital camera around the screen, elegant minimal fintech aesthetic, deep navy and gold palette,
film grain, 24fps. No text, no logos, no watermark.
```

## F. Настройки по моделям

| Модель | Формат | Длина клипа | Особенности |
|---|---|---|---|
| Sora 2 | 9:16 | до 15 с | лучше всех держит сцену, звук и свет; вставлять промт A целиком |
| Veo 3 | 9:16 | 8 с | генерирует со звуком; клипы B1–B5 отдельно, герой один и тот же |
| Kling 2.5 | 9:16 | 5–10 с | есть негативный промт и стартовый кадр (C), лучшая физика |
| Runway Gen-4 | 9:16 | 5 с | camera control + motion brush на область экрана |
| Hailuo / Pika | 9:16 | 5–6 с | быстрые черновики, для финала слабее |

## G. После генерации: монтаж (2–3 минуты в CapCut)

| Время | Титр | Озвучка |
|---|---|---|
| 0–3 с | Продаёте на маркетплейсе? | «Продаёте на маркетплейсе?» |
| 3–6 с | Прибыль считаете в таблице? | «А прибыль считаете в таблице?» |
| 6–9 с | Чистая прибыль — на карточке | «Маркет-Снайпер показывает чистую прибыль прямо на карточке» |
| 9–12 с | Комиссия · доставка · реклама | «Комиссия, доставка и реклама уже вычтены» |
| 12–15 с | 7 дней бесплатно | «Семь дней бесплатно» + адрес на плашке |

Правила:
- на 6–9 с вставить реальный скриншот расширения (бейдж «Чистая прибыль ≈ 42 060 ₽») поверх кадра;
- логотипы маркетплейса не показывать, в озвучке говорить «маркетплейс»;
- музыка: минимал-бит 95–105 BPM (Pixabay / Free Music Archive), тихо под голосом,
  акцент-whoosh на 6-й секунде;
- шрифт титров — жирный без засечек, белый на золотой плашке, крупно (10–12% высоты кадра).

## H. Чек-лист

- [ ] 6–8 генераций по промту A (или B1–B5), отобрать 5 без артефактов на руках и экране.
- [ ] Склеить 5 клипов по 3 с, добавить переходы не длиннее 0.2 с.
- [ ] Вставить реальный скриншот расширения на 6–9 с.
- [ ] Титры по таблице G, озвучка (своя или нейроголос).
- [ ] Музыка 95–105 BPM, приглушить до −18 dB под голосом.
- [ ] Экспорт 1080×1920, 30 fps, H.264, до 30 МБ.

