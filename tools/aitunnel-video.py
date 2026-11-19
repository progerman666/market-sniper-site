#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# aitunnel-video.py — генерация видео через AITUNNEL: POST /v1/videos, опрос статуса, скачивание MP4.
#
# Ключ берётся из переменной окружения AITUNNEL_API_KEY (или --api-key), в код его не пишем.
# Внешних пакетов не нужно: только стандартная библиотека Python 3.8+.
#
# Документация: https://aitunnel.ru/docs/videos.md
# Модели и цены без ключа: https://api.aitunnel.ru/public/aitunnel/models/videos
#
# Примеры:
#   $env:AITUNNEL_API_KEY = 'sk-aitunnel-...'
#   python tools\aitunnel-video.py
#   python tools\aitunnel-video.py --prompt "A golden retriever playing fetch on a sunny beach"
#   python tools\aitunnel-video.py --prompt "..." --duration 10 --resolution 720p --aspect-ratio 9:16
#   python tools\aitunnel-video.py --prompt "..." --dry-run
#
# Коды возврата: 0 — видео получено; 1 — ошибка сети/API; 2 — неверные параметры;
# 3 — таймаут ожидания (задача продолжается на сервере); 4 — задача завершилась без результата.

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:  # stdout уже подменён (например, в некоторых IDE)
    pass

DEFAULT_BASE_URL = "https://api.aitunnel.ru/v1"
DEFAULT_MODEL = "grok-imagine-video-1.5-lite"
DEFAULT_DURATION = 5
DEFAULT_RESOLUTION = "480p"
DEFAULT_ASPECT_RATIO = "16:9"

# Документация советует опрашивать статус каждые 15-30 секунд.
DEFAULT_POLL_INTERVAL = 15.0
# Сколько всего ждём результат. После таймаута задача всё равно досчитается на сервере.
DEFAULT_TIMEOUT = 900.0
HTTP_TIMEOUT = 90.0
SUBMIT_ATTEMPTS = 3
POLL_FAILURES = 4

STATUS_DONE = "completed"
STATUS_FAILED = ("failed", "expired", "cancelled")
USER_AGENT = "market-sniper-aitunnel-video/1.0"

EXIT_OK = 0
EXIT_API = 1
EXIT_USAGE = 2
EXIT_TIMEOUT = 3
EXIT_JOB_FAILED = 4


class UsageError(Exception):
    """Неверные параметры запуска."""


class ApiError(Exception):
    """AITUNNEL ответил ошибкой."""

    def __init__(self, status, message, payload=None):
        super().__init__(message)
        self.status = status
        self.payload = payload


class NetworkError(Exception):
    """Сеть недоступна, таймаут или обрыв соединения."""


class JobFailed(Exception):
    """Задача завершилась статусом failed / expired / cancelled."""

    def __init__(self, data):
        status = str((data or {}).get("status") or "failed")
        error = (data or {}).get("error")
        if isinstance(error, dict):
            error = error.get("message") or error.get("type") or json.dumps(error, ensure_ascii=False)
        if error:
            message = "задача " + status + ": " + str(error)
        else:
            message = "задача " + status
        super().__init__(message)
        self.data = data or {}


class JobTimeout(Exception):
    """Не дождались терминального статуса за отведённое время."""

    def __init__(self, job_id, timeout):
        super().__init__("не дождались результата за " + format_seconds(timeout))
        self.job_id = job_id


# --- вспомогательное -------------------------------------------------------

def stamp():
    return time.strftime("%H:%M:%S")


def log(text):
    print("[" + stamp() + "] " + text, flush=True)


def format_seconds(value):
    total = int(round(float(value)))
    if total < 60:
        return str(total) + " с"
    minutes, seconds = divmod(total, 60)
    if minutes < 60:
        return f"{minutes} мин {seconds} с"
    hours, minutes = divmod(minutes, 60)
    return f"{hours} ч {minutes} мин"


def money(value):
    """Рубли в русском виде: 17,00 ₽; 1 234,56 ₽."""
    if value is None:
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    text = f"{number:,.2f}".replace(",", " ").replace(".", ",")
    return text + " ₽"


def safe_name(value):
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value)).strip("_")
    return name or "video"

# --- HTTP -----------------------------------------------------------------

def json_or_none(raw):
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except (ValueError, AttributeError):
        return None


def error_message(status, raw):
    """Достаём человекочитаемую причину из тела ошибки AITUNNEL."""
    data = json_or_none(raw)
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict):
            parts = [str(error.get("message") or error.get("type") or "").strip()]
            meta = error.get("metadata")
            if isinstance(meta, dict) and meta:
                parts.append("metadata: " + json.dumps(meta, ensure_ascii=False))
            text = " · ".join(part for part in parts if part)
            if text:
                return text
        if isinstance(error, str) and error.strip():
            return error.strip()
        for key in ("message", "detail"):
            if data.get(key):
                return str(data[key])
    text = raw.decode("utf-8", "replace").strip()
    return text[:400] if text else "пустой ответ сервера (HTTP " + str(status) + ")"


def api_request(method, url, api_key="", payload=None):
    """Запрос к API. Возвращает разобранный JSON или бросает ApiError/NetworkError."""
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    body = None
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if api_key:
        headers["Authorization"] = "Bearer " + api_key

    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            status = response.status
            raw = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read() or b""
        raise ApiError(error.code, error_message(error.code, raw), json_or_none(raw))
    except urllib.error.URLError as error:
        raise NetworkError(str(getattr(error, "reason", error)))
    except OSError as error:  # таймаут сокета, сброс соединения
        raise NetworkError(str(error))

    data = json_or_none(raw)
    if data is None:
        raise ApiError(status, "ответ не JSON: " + raw.decode("utf-8", "replace")[:200])
    return data


def download_file(url, api_key, out_path):
    """Скачивает MP4 по ссылке из unsigned_urls и сохраняет на диск. Возвращает размер в байтах."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "video/mp4,video/*;q=0.9,*/*;q=0.8",
    }
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            content_type = response.headers.get("Content-Type", "")
            body = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read() or b""
        raise ApiError(error.code, error_message(error.code, raw))
    except urllib.error.URLError as error:
        raise NetworkError(str(getattr(error, "reason", error)))
    except OSError as error:
        raise NetworkError(str(error))

    if "json" in content_type.lower():
        raise ApiError(200, "вместо видео пришёл JSON: " + error_message(200, body))
    if not body:
        raise ApiError(200, "сервер вернул пустой файл")

    folder = os.path.dirname(os.path.abspath(out_path))
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(out_path, "wb") as handle:
        handle.write(body)
    return len(body)

# --- каталог моделей (без ключа) -------------------------------------------

def public_catalog_url(base_url):
    host = base_url.rstrip("/")
    if host.endswith("/v1"):
        host = host[: -len("/v1")]
    return host + "/public/aitunnel/models/videos"


def load_model_info(base_url, model):
    """Возможности модели из публичного каталога. None, если каталог недоступен."""
    try:
        data = api_request("GET", public_catalog_url(base_url))
    except (ApiError, NetworkError) as error:
        log("каталог моделей недоступен (" + str(error) + ") — проверка параметров пропущена")
        return None
    catalog = data
    if isinstance(data, dict) and isinstance(data.get("data"), dict):
        catalog = data["data"]
    info = catalog.get(model) if isinstance(catalog, dict) else None
    if not isinstance(info, dict):
        log("модель " + model + " не найдена в публичном каталоге — проверка параметров пропущена")
        return None
    return info


def validate_against_catalog(info, model, duration, resolution, aspect_ratio, size):
    """Сверяем параметры с возможностями модели, чтобы не ловить 400 после отправки."""
    if not info:
        return
    durations = info.get("supported_durations") or []
    if durations and duration not in durations:
        raise UsageError(
            "duration=" + str(duration) + " не поддерживается моделью " + model +
            "; допустимо: " + ", ".join(str(value) for value in durations)
        )
    if size:
        sizes = info.get("supported_sizes") or []
        if sizes and size not in sizes:
            raise UsageError(
                "size=" + size + " не поддерживается моделью " + model +
                "; допустимо: " + ", ".join(sizes[:12]) + ("…" if len(sizes) > 12 else "")
            )
        return
    resolutions = info.get("supported_resolutions") or []
    if resolution and resolutions and resolution not in resolutions:
        raise UsageError(
            "resolution=" + resolution + " не поддерживается моделью " + model +
            "; допустимо: " + ", ".join(resolutions)
        )
    ratios = info.get("supported_aspect_ratios") or []
    if aspect_ratio and ratios and aspect_ratio not in ratios:
        raise UsageError(
            "aspect_ratio=" + aspect_ratio + " не поддерживается моделью " + model +
            "; допустимо: " + ", ".join(ratios)
        )


def estimate_reserve(info, duration, resolution, size):
    """Оценка резерва: цена за секунду нужного размера × длительность. None, если цен нет."""
    if not info:
        return None
    prices = info.get("size_prices") or {}
    rate = None
    if size and isinstance(prices.get(size), (int, float)):
        rate = float(prices[size])
    else:
        candidates = []
        for name, price in prices.items():
            if not isinstance(price, (int, float)):
                continue
            sides = str(name).split("x")
            if len(sides) != 2 or not all(side.isdigit() for side in sides):
                continue
            candidates.append((min(int(sides[0]), int(sides[1])), float(price)))
        if resolution:
            digits = resolution.lower().rstrip("p")
            if digits.isdigit():
                matched = [price for short_side, price in candidates if short_side == int(digits)]
                if matched:
                    rate = max(matched)
        if rate is None and candidates:
            rate = max(price for _, price in candidates)
    if rate is None:
        return None
    return rate * duration

# --- задача ---------------------------------------------------------------

def submit_job(base_url, api_key, payload):
    """POST /videos. 429/502/503/504 и сетевые сбои повторяем: резерв в этих случаях не удерживается."""
    url = base_url.rstrip("/") + "/videos"
    last_error = None
    for attempt in range(1, SUBMIT_ATTEMPTS + 1):
        try:
            return api_request("POST", url, api_key, payload)
        except ApiError as error:
            if error.status in (429, 502, 503, 504) and attempt < SUBMIT_ATTEMPTS:
                last_error = error
                pause = attempt * 5
                log("POST /videos: HTTP " + str(error.status) + " — повтор через " + str(pause) + " с")
                time.sleep(pause)
                continue
            raise
        except NetworkError as error:
            if attempt < SUBMIT_ATTEMPTS:
                last_error = error
                pause = attempt * 5
                log("POST /videos: " + str(error) + " — повтор через " + str(pause) + " с")
                time.sleep(pause)
                continue
            raise
    raise last_error  # страховка: цикл всегда либо вернёт результат, либо бросит исключение


def poll_job(base_url, api_key, job_id, interval, timeout):
    """GET /videos/{id}, пока статус не станет терминальным. Возвращает финальный ответ."""
    url = base_url.rstrip("/") + "/videos/" + urllib.parse.quote(job_id, safe="")
    started = time.monotonic()
    deadline = started + timeout
    last_status = ""
    failures = 0
    expires_logged = False
    while True:
        data = None
        try:
            data = api_request("GET", url, api_key)
            failures = 0
        except ApiError as error:
            # 401/403/404 и прочие 4xx (кроме 429) повтором не лечатся.
            if error.status != 429 and error.status < 500:
                raise
            failures += 1
            if failures >= POLL_FAILURES:
                raise
            log("опрос: HTTP " + str(error.status) + " — повтор через " + format_seconds(interval))
        except NetworkError as error:
            failures += 1
            if failures >= POLL_FAILURES:
                raise
            log("опрос: " + str(error) + " — повтор через " + format_seconds(interval))

        if data is not None:
            status = str(data.get("status") or "").lower()
            if status != last_status:
                elapsed = time.monotonic() - started
                usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
                cost = usage.get("cost_rub")
                extra = ", начислено " + money(cost) if cost else ""
                log("статус: " + (status or "—") + " (прошло " + format_seconds(elapsed) + extra + ")")
                last_status = status
            if data.get("expires_at") and not expires_logged:
                log("задача доступна до: " + str(data["expires_at"]))
                expires_logged = True
            if status == STATUS_DONE:
                return data
            if status in STATUS_FAILED:
                raise JobFailed(data)

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise JobTimeout(job_id, timeout)
        time.sleep(min(interval, remaining))

# --- параметры запуска -----------------------------------------------------

def resolve_prompt(args):
    prompt = (args.prompt_opt or args.prompt_arg or "").strip()
    if not prompt and args.prompt_file:
        try:
            with open(args.prompt_file, "r", encoding="utf-8") as handle:
                prompt = handle.read().strip()
        except OSError as error:
            raise UsageError("не читается --prompt-file: " + str(error))
    if not prompt and not sys.stdin.isatty():
        # Промт можно передать потоком: Get-Content prompt.txt -Raw | python tools\aitunnel-video.py
        prompt = sys.stdin.read().strip()
    if not prompt:
        print("Опишите сцену на английском: что в кадре, стиль, свет, движение камеры.")
        print("Пустой ввод — выход.")
        try:
            prompt = input("Промт: ").strip()
        except EOFError:
            prompt = ""
    if not prompt:
        raise UsageError("пустой промт")
    return prompt


def build_payload(args):
    payload = {"model": args.model, "prompt": args.prompt, "duration": args.duration}
    if args.size:
        payload["size"] = args.size
    else:
        if args.resolution:
            payload["resolution"] = args.resolution
        if args.aspect_ratio:
            payload["aspect_ratio"] = args.aspect_ratio
    if args.seed is not None:
        payload["seed"] = args.seed
    return payload


def resolve_out_path(args, job_id):
    if args.out:
        path = os.path.abspath(args.out)
        if os.path.isdir(path) or args.out.endswith(("/", "\\")):
            return os.path.join(path, "video-" + safe_name(job_id) + ".mp4")
        return path
    return os.path.abspath("video-" + safe_name(job_id) + ".mp4")


def build_parser():
    parser = argparse.ArgumentParser(
        prog="aitunnel-video.py",
        description="Генерация видео через AITUNNEL: POST /v1/videos, опрос статуса, скачивание MP4.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Ключ: переменная окружения AITUNNEL_API_KEY или --api-key.\n"
            "Модели и цены без ключа: https://api.aitunnel.ru/public/aitunnel/models/videos\n"
            "\n"
            "Коды возврата: 0 — видео получено; 1 — ошибка сети/API; 2 — неверные параметры;\n"
            "3 — таймаут ожидания (задача продолжается на сервере);\n"
            "4 — задача завершилась failed / expired / cancelled."
        ),
    )
    parser.add_argument("prompt_arg", nargs="?", default="", metavar="ПРОМТ",
                        help="промт на английском (можно вместо --prompt)")
    parser.add_argument("-p", "--prompt", dest="prompt_opt", default="",
                        help="промт на английском; без него спросим интерактивно")
    parser.add_argument("--prompt-file", default="",
                        help="прочитать промт из файла (UTF-8)")
    parser.add_argument("--model", default=os.environ.get("AITUNNEL_VIDEO_MODEL", DEFAULT_MODEL),
                        help="модель, по умолчанию " + DEFAULT_MODEL)
    parser.add_argument("--duration", type=int, default=DEFAULT_DURATION,
                        help="длительность в секундах, по умолчанию " + str(DEFAULT_DURATION))
    parser.add_argument("--resolution", default=DEFAULT_RESOLUTION,
                        help="480p | 720p | 1080p, по умолчанию " + DEFAULT_RESOLUTION + " (самое дешёвое)")
    parser.add_argument("--aspect-ratio", default=DEFAULT_ASPECT_RATIO,
                        help="соотношение сторон, по умолчанию " + DEFAULT_ASPECT_RATIO)
    parser.add_argument("--size", default="",
                        help="точные пиксели WxH (например 854x480) вместо --resolution и --aspect-ratio")
    parser.add_argument("--seed", type=int, default=None,
                        help="seed, если модель его поддерживает")
    parser.add_argument("--out", default="",
                        help="файл для сохранения, по умолчанию video-<request_id>.mp4 рядом")
    parser.add_argument("--no-download", action="store_true",
                        help="только показать ссылку, файл не скачивать")
    parser.add_argument("--poll-interval", type=float, default=DEFAULT_POLL_INTERVAL,
                        help="интервал опроса, секунд (по умолчанию " + str(int(DEFAULT_POLL_INTERVAL)) + ")")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT,
                        help="сколько всего ждать результат, секунд (по умолчанию " + str(int(DEFAULT_TIMEOUT)) + ")")
    parser.add_argument("--base-url", default=os.environ.get("AITUNNEL_BASE_URL", DEFAULT_BASE_URL),
                        help="по умолчанию " + DEFAULT_BASE_URL + "; при блокировке — https://ru-api.aitunnel.ru/v1")
    parser.add_argument("--api-key", default=os.environ.get("AITUNNEL_API_KEY", ""),
                        help="ключ AITUNNEL (лучше через AITUNNEL_API_KEY, в код не пишем)")
    parser.add_argument("--dry-run", action="store_true",
                        help="показать запрос и выйти, ничего не отправляя")
    return parser

# --- вывод результата ------------------------------------------------------

def hint_for_status(status):
    """Короткая подсказка по частым ошибкам AITUNNEL."""
    if status == 400:
        return ("Подсказка: сверьте duration / resolution / aspect_ratio / size с возможностями модели: "
                "GET https://api.aitunnel.ru/public/aitunnel/models/videos")
    if status == 401:
        return "Подсказка: ключ неверный, истёк или удалён — создайте новый: https://aitunnel.ru/panel/keys"
    if status == 402:
        return ("Подсказка: не хватает баланса или бюджета ключа на резерв задачи; "
                "в error.metadata есть available_rub и required_rub.")
    if status == 403:
        return "Подсказка: ключ приостановлен или ограничен по моделям/IP — проверьте настройки ключа."
    if status == 404:
        return "Подсказка: модель или задача не найдена — проверьте --model и request_id."
    if status in (429, 503):
        return "Подсказка: временная перегрузка — повторите запуск через несколько секунд."
    if status in (502, 504):
        return "Подсказка: провайдер не принял задачу, резерв возвращён — можно повторить запуск."
    return ""


def report_error(error, args, job_id):
    """Печатает понятную причину сбоя и возвращает код выхода."""
    if isinstance(error, UsageError):
        print("Ошибка параметров: " + str(error), file=sys.stderr)
        print("Справка: python tools\\aitunnel-video.py --help", file=sys.stderr)
        return EXIT_USAGE

    if isinstance(error, JobFailed):
        print("Задача не выполнена: " + str(error), file=sys.stderr)
        failed_id = (error.data or {}).get("id") or job_id
        if failed_id:
            print("request_id: " + str(failed_id), file=sys.stderr)
        print("Резерв возвращён на баланс — можно повторить с другим промтом.", file=sys.stderr)
        return EXIT_JOB_FAILED

    if isinstance(error, JobTimeout):
        print("Таймаут: " + str(error), file=sys.stderr)
        print("request_id: " + error.job_id, file=sys.stderr)
        print("Задача продолжается на сервере, результат можно забрать позже:", file=sys.stderr)
        print("  GET " + args.base_url.rstrip("/") + "/videos/" + error.job_id, file=sys.stderr)
        print("  Логи → Задачи: https://aitunnel.ru/panel/logs/jobs", file=sys.stderr)
        return EXIT_TIMEOUT

    if isinstance(error, ApiError):
        print("Ошибка API (HTTP " + str(error.status) + "): " + str(error), file=sys.stderr)
        if job_id:
            print("request_id: " + job_id, file=sys.stderr)
        hint = hint_for_status(error.status)
        if hint:
            print(hint, file=sys.stderr)
        return EXIT_API

    if isinstance(error, NetworkError):
        print("Ошибка сети: " + str(error), file=sys.stderr)
        print("Если api.aitunnel.ru недоступен (таймаут, Connection reset), используйте зеркало:", file=sys.stderr)
        print("  --base-url https://ru-api.aitunnel.ru/v1", file=sys.stderr)
        return EXIT_API

    print("Непредвиденная ошибка: " + repr(error), file=sys.stderr)
    return EXIT_API

def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    job_id = ""

    try:
        if args.duration <= 0:
            raise UsageError("--duration должен быть больше нуля")
        if args.poll_interval <= 0:
            raise UsageError("--poll-interval должен быть больше нуля")
        if args.timeout <= 0:
            raise UsageError("--timeout должен быть больше нуля")

        args.prompt = resolve_prompt(args)
        payload = build_payload(args)
        if re.search(r"[\u0410-\u044f\u0401\u0451]", args.prompt):
            log("внимание: в промте есть кириллица — модель обучена на английских описаниях")

        if args.dry_run:
            print("Запрос (ничего не отправлено):")
            print("  POST " + args.base_url.rstrip("/") + "/videos")
            print("  Authorization: Bearer " + ("<ключ скрыт>" if args.api_key else "<ключ не задан>"))
            for line in json.dumps(payload, ensure_ascii=False, indent=2).splitlines():
                print("  " + line)
            return EXIT_OK

        if not args.api_key:
            raise UsageError("не задан ключ AITUNNEL: переменная окружения AITUNNEL_API_KEY или --api-key")
        if not args.api_key.startswith("sk-aitunnel-"):
            log("внимание: ключ не начинается с sk-aitunnel- — проверьте, что скопирован полностью")

        info = load_model_info(args.base_url, args.model)
        validate_against_catalog(info, args.model, args.duration,
                                 args.resolution, args.aspect_ratio, args.size)
        reserve = estimate_reserve(info, args.duration, args.resolution, args.size)

        mode = args.size or ((args.resolution + " " + args.aspect_ratio).strip())
        log("модель: " + args.model + " · " + str(args.duration) + " с · " + mode)
        log("промт: " + args.prompt)
        if reserve is not None:
            log("оценка резерва: " + money(reserve) + " (остаток вернётся после завершения)")

        log("POST " + args.base_url.rstrip("/") + "/videos")
        job = submit_job(args.base_url, args.api_key, payload)
        job_id = str(job.get("id") or job.get("request_id") or "")
        if not job_id:
            raise ApiError(200, "в ответе нет id задачи: " + json.dumps(job, ensure_ascii=False)[:300])

        print("request_id: " + job_id)
        if job.get("polling_url"):
            print("polling_url: " + str(job["polling_url"]))
        log("статус: " + str(job.get("status") or "pending"))

        result = poll_job(args.base_url, args.api_key, job_id, args.poll_interval, args.timeout)
        urls = result.get("unsigned_urls") or []
        if not urls:
            raise ApiError(200, "задача completed, но ссылок в unsigned_urls нет")
        link = str(urls[0])
        usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}
        cost = usage.get("cost_rub")

        print("")
        print("Ссылка на видео: " + link)
        print("Стоимость: " + money(cost))

        if args.no_download:
            return EXIT_OK

        out_path = resolve_out_path(args, job_id)
        log("скачивание…")
        size = download_file(link, args.api_key, out_path)
        print("Сохранено: " + out_path + f" ({size / (1024 * 1024):.1f} МБ)")
        return EXIT_OK

    except KeyboardInterrupt:
        print("", file=sys.stderr)
        if job_id:
            print("Прервано. Задача продолжается на сервере, request_id: " + job_id, file=sys.stderr)
        else:
            print("Прервано.", file=sys.stderr)
        return EXIT_API
    except Exception as error:  # noqa: BLE001 — разбор веток в report_error
        return report_error(error, args, job_id)


if __name__ == "__main__":
    raise SystemExit(main())

