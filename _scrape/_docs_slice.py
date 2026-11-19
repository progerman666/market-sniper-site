import io

SRC = "C:/Users/dlypo/AppData/Local/Temp/aitunnel-videos.md"
DST = "C:/Users/dlypo/AppData/Local/Temp/gen.md"

text = io.open(SRC, encoding="utf-8").read()
start = text.index("## \u0413\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f \u0432\u0438\u0434\u0435\u043e")
end = text.index("## \u041b\u0443\u0447\u0448\u0438\u0435 \u043f\u0440\u0430\u043a\u0442\u0438\u043a\u0438")
io.open(DST, "w", encoding="utf-8").write(text[start:end])
print("ok", start, end, end - start)
