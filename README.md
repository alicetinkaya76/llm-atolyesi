# LLM Atölyesi

Paul Graham'ın "LLM'leri sıfırdan kurmayı öğren, elindeki donanımla
eğitebildiğin en güçlü modeli eğit" tavsiyesinin müstakil atölyesi —
aynı zamanda statik bir web sitesi. Hiçbir bulut servisine bağımlı
değildir: veri düz JSON, arayüz CLI + statik HTML, hepsi bu depoda.

## Site

`index.html` kapak + canlı panodur (durum.json'dan hesaplar); `harita.html`
yol haritası, `defter.html` etkileşimli defter, `fazlar/` haftalık faz
planlarıdır. Yerelde önizleme:

```bash
node serve.mjs   # http://localhost:8933
```

### GitHub Pages'te yayınlama

```bash
gh repo create llm-atolyesi --public --source . --push
```

Sonra web arayüzünden: Settings → Pages → "Deploy from a branch" → `main` /
`/ (root)`. Sonrası: her `git push` siteyi günceller.

**Gizlilik notu:** ücretsiz planda Pages yalnız *public* depoda çalışır —
`durum.json` ve seans günlüğün de görünür olur. Public yapacaksan buna
bilerek karar ver; istemiyorsan depo private kalır (Pages için GitHub Pro /
eğitim paketi gerekir) ya da site yerelde `node serve.mjs` ile yaşar.

## Dosyalar

| Dosya | Ne |
|---|---|
| `index.html` | Kapak + canlı pano (fetch ile `durum.json`'dan hesaplar) |
| `harita.html` | Yol haritası (6 faz, kaynaklar, maliyet merdiveni) |
| `fazlar/*.html` | Haftalık faz planları (zemin + faz 0–5), kişiye özel notlarla |
| `mufredat.json` | Müfredat: 42 madde, fazlar, ustalık basamakları (tek kaynak) |
| `durum.json` | **İlerlemenin tek kaynağı** — git ile izlenir |
| `defter.py` | CLI + `defter.html` üreticisi (yalnız stdlib, Python ≥3.9) |
| `defter.html` | Etkileşimli defter; sunucudan açılınca en taze `durum.json`'u kendisi çeker |
| `stil.css` / `serve.mjs` | Ortak stil / yerel önizleme sunucusu |
| `zemin/ faz0..faz5/` | Faz çalışma klasörleri — kanıt kodların buraya, her seans bir commit |

## Günlük kullanım

```bash
python3 defter.py durum        # terminal panosu: %'ler, kapılar, bu haftaki saat
python3 defter.py liste f0     # madde kimlikleri ve basamakları
python3 defter.py seviye f0a 2 # micrograd'ı kapalı kitap yazdım
python3 defter.py seans --saat 2.5 --faz f0 --yaptim "micrograd yeniden yazıldı" \
    --anlamadim "topo sort sırası" --yarin "makemore 1"
python3 defter.py html         # defter.html'i tazele, tarayıcıda aç
```

Tarayıcı defterinde yapılan değişiklikler localStorage'da saklanır;
alttaki **"durum.json indir"** düğmesiyle indirip depodakiyle değiştir
(ya da `python3 defter.py ice-aktar indirilen.json`). Tek veri kaynağı
her zaman depodaki `durum.json`'dur.

## Yöntem (kısa)

1. **Bütünü gör** → 2. **kapalı kitap yeniden yaz** (kopyalamak yasak) →
3. **egzersizi/testi koştur** → 4. **Türkçe'ye bük** (kendi korpusunda mini deney) →
5. **beş satır defter** (yaptım/öğrendim/anlamadım/yarın).

Ustalık merdiveni: `0 başlamadım · 1 bütünü gördüm · 2 kapalı kitap yazdım ·
3 egzersiz/test yeşil · 4 Türkçe büküm + defter` (okuma maddeleri: `okudum · özetledim`).
Kapı kuralı: bir fazın çekirdek (Ç) maddelerinin tümü ≥ 3 (oku: ≥ 2) ve en az
biri tavandaysa kapı geçilir — `defter.py` bunu kendisi hesaplar.

Haftalık ritim: 2 derin blok (2–3 sa) + 1 hafif blok (1–2 sa), hedef 8–10 sa.
Her seans bir commit; "kapalı kitap yazdım" iddiasının kanıtı commit'tir.

## Dış yedekten dönüş

Başka bir yerde (ör. eski claude.ai defteri) tutulmuş bir JSON yedeğin varsa:

```bash
python3 defter.py ice-aktar yedek.json   # öncekini durum.onceki.json'a yedekler
```
