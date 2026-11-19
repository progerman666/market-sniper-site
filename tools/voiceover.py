# voiceover.py — озвучка промо-ролика по-русски и сборка финального MP4.
#
# Требуется: pip install --user edge-tts (нейроголос Microsoft, аккаунт не нужен),
# ffmpeg (по умолчанию берётся из Jellyfin).
#
# Запуск:
#   python tools\voiceover.py
#   python tools\voiceover.py --voice ru-RU-SvetlanaNeural

import asyncio
import argparse
import os
import subprocess
import sys

import edge_tts

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO = os.path.join(ROOT, "promo", "video", "market-sniper-promo-9x16.mp4")
OUT = os.path.join(ROOT, "promo", "video", "market-sniper-promo-9x16-voice.mp4")
VOICE_DIR = os.path.join(ROOT, "promo", "video", "voice")
FFMPEG = r"C:\Program Files\Jellyfin\Server\ffmpeg.exe"
FFPROBE = r"C:\Program Files\Jellyfin\Server\ffprobe.exe"

# Текст по сценам. Вопросительные знаки edge-tts иногда отклоняет, поэтому точки.
LINES = [
    "Продаёте на маркетплейсе.",
    "Комиссия и доставка съедают маржу.",
    "Чистая прибыль — прямо на карточке.",
    "Ставки и налоги — один раз.",
    "Семь дней бесплатно.",
]

# Старты сцен и их длительность в секундах — должны совпадать с build-promo-video.ps1.
STARTS = [0.0, 3.0, 7.0, 11.0, 14.0]
SLOTS = [3.0, 4.0, 4.0, 3.0, 2.5]
TOTAL = 16.5


async def synth(text: str, path: str, voice: str) -> bool:
    for attempt in range(1, 4):
        try:
            if os.path.exists(path):
                os.remove(path)
            await edge_tts.Communicate(text, voice).save(path)
            if os.path.exists(path) and os.path.getsize(path) > 1000:
                return True
        except Exception as error:  # noqa: BLE001
            print(f"    попытка {attempt}: {error}")
        await asyncio.sleep(0.8)
    return False


def synth_sapi(text: str, wav_path: str, voice: str = "Microsoft Irina Desktop") -> bool:
    """Резерв: системный голос Windows (работает офлайн, без интернета)."""
    txt_path = wav_path + ".txt"
    with open(txt_path, "w", encoding="utf-8") as handle:
        handle.write(text)
    script = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        f"$s.SelectVoice('{voice}'); $s.Rate = 0; "
        f"$s.SetOutputToWaveFile('{wav_path}'); "
        f"$text = Get-Content -LiteralPath '{txt_path}' -Raw -Encoding UTF8; "
        "$s.Speak($text); $s.Dispose()"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True)
    try:
        os.remove(txt_path)
    except OSError:
        pass
    return os.path.exists(wav_path) and os.path.getsize(wav_path) > 1000


def duration(path: str) -> float:
    result = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default="ru-RU-DmitryNeural")
    parser.add_argument("--engine", default="auto", choices=["auto", "edge", "sapi"])
    parser.add_argument("--video", default=VIDEO)
    parser.add_argument("--out", default=OUT)
    args = parser.parse_args()

    os.makedirs(VOICE_DIR, exist_ok=True)
    if not os.path.exists(args.video):
        print("Нет видео:", args.video)
        return 1

    # Голос должен быть один на весь ролик: проверяем нейроголос и, если Microsoft
    # отдаёт ошибку, озвучиваем все строки системным голосом Windows.
    engine = args.engine
    if engine == "auto":
        probe = os.path.join(VOICE_DIR, "probe.mp3")
        engine = "edge" if asyncio.run(synth(LINES[0], probe, args.voice)) else "sapi"
        if os.path.exists(probe):
            os.remove(probe)
    print("Движок озвучки:", "нейроголос" if engine == "edge" else "системный голос Windows")

    files = []
    for index, text in enumerate(LINES, start=1):
        print(f"Озвучка {index}: {text}")
        if engine == "edge":
            path = os.path.join(VOICE_DIR, f"{index:02d}.mp3")
            ok = asyncio.run(synth(text, path, args.voice))
        else:
            path = os.path.join(VOICE_DIR, f"{index:02d}.wav")
            ok = synth_sapi(text, path)
        if not ok:
            print("  не удалось получить аудио")
            return 1
        files.append(path)

    filters = []
    for index, path in enumerate(files):
        length = duration(path)
        slot = SLOTS[index] - 0.15
        tempo = 1.0
        if length > slot:
            tempo = min(1.4, length / slot)
        chain = f"[{index}:a]aresample=48000"
        if tempo > 1.01:
            chain += f",atempo={tempo:.3f}"
        chain += f",adelay={int(STARTS[index] * 1000)}|{int(STARTS[index] * 1000)}"
        chain += f"[a{index}]"
        filters.append(chain)
        print(f"  {index + 1}: {length:.2f} c, сцена {SLOTS[index]:.1f} c, темп {tempo:.2f}")

    mix = "".join(f"[a{i}]" for i in range(len(files)))
    filters.append(f"{mix}amix=inputs={len(files)}:duration=longest:normalize=0,"
                   f"apad,atrim=0:{TOTAL},asetpts=N/SR/TB,"
                   f"loudnorm=I=-16:TP=-1.5:LRA=11[a]")

    command = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", args.video]
    for path in files:
        command += ["-i", path]
    command += [
        "-filter_complex", ";".join(filters),
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", "-shortest", args.out,
    ]
    print("Сборка…")
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr)
        return 1

    size = os.path.getsize(args.out) / (1024 * 1024)
    print(f"Готово: {args.out} ({size:.2f} МБ)")

    info = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height",
         "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1", args.out],
        capture_output=True, text=True,
    )
    print(info.stdout.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
