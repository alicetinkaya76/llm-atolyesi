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
| `defter.py` + `atolye` | Terminal aracı: `bugun`, `rapor`, `seviye`, `seans`, `yayinla` (yalnız stdlib) |
| `defter.html` + `defter.js` | Etkileşimli defter: ⌘K paleti, j/k + 0–4 klavye, geri al, seans günlüğü |
| `atolye.js` | İlerleme + tazelik + kestirim matematiği (defter.py'ın JS ikizi) |
| `kanit.js` | Kanıt katmanı: depo klasörleri ve git geçmişi |
| `pano.js` / `github.js` | Ana pano çizimi / opsiyonel tarayıcıdan-depoya-yazma |
| `sw.js` + `manifest.json` | Çevrimdışı çalışma + telefona kurulum (PWA) |
| `stil.css` / `serve.mjs` | Ortak stil / yerel önizleme sunucusu |
| `capraz-test.sh` | Python ve JS aynı sonucu veriyor mu — ayrışırsa kırmızı |
| `zemin/ faz0..faz5/` | Faz çalışma klasörleri — kanıt kodların buraya, her seans bir commit |

## Kurulum (bir kez)

```bash
ln -sf ~/Desktop/llm-atolyesi/atolye /usr/local/bin/atolye
```

Artık her dizinden `atolye` yazabilirsin.

## Günlük kullanım

```bash
atolye                          # bugün ne yapmalıyım: sıradaki iş, haftalık durum, açık sorular
atolye seviye z1 3 -y           # basamak ata + commit + push (tek komut)
atolye seans --saat 2.5 --faz f0 --yaptim "micrograd yeniden yazıldı" \
    --anlamadim "topo sort sırası" --yarin "makemore 1" -y
atolye rapor                    # haftalık retro: saat grafiği, en verimli gün, kapıya kalan
atolye tazele                   # yarılanmayı geçmiş maddeler · atolye tazele z1 -y
atolye durum | atolye liste f0  # pano | madde kimlikleri
atolye ac                       # canlı siteyi aç · atolye site → yerel sunucu
```

`-y` (`--yayinla`) bayrağı: `durum.json` commit'lenip push'lanır,
site birkaç dakika içinde güncellenir. Bayrağı unutursan sonra `atolye yayinla`.

Tarayıcı defterinde yapılan değişiklikler localStorage'da saklanır;
alttaki **"durum.json indir"** düğmesiyle indirip depodakiyle değiştir
(ya da `atolye ice-aktar indirilen.json`). Tek veri kaynağı her zaman
depodaki `durum.json`'dur.

## Telefondan kullanmak

Siteyi Safari'de aç → Paylaş → **Ana Ekrana Ekle**. Uygulama gibi açılır ve
çevrimdışı çalışır. Telefondan kayıt tutmak istersen defterin altındaki
**⚙︎ bölümünden** kendi fine-grained GitHub token'ını girebilirsin (yalnız
`llm-atolyesi` deposu · yalnız *Contents: Read and write* · GitHub'da bir
son kullanma tarihi ver). "Bu tarayıcıda hatırla" kutusunu işaretlemezsen
token sekme kapanınca silinir.

**Bilerek karar ver:** `alicetinkaya76.github.io` altındaki *bütün* proje
siteleri aynı kaynağı paylaşır, yani aynı `localStorage`'ı görür. Token'ı
hatırlatırsan, o kaynakta çalışan herhangi bir betik onu okuyabilir — bu
yüzden kapsam tek depo ve tek izinle sınırlı tutulur; en kötü senaryoda
kaybedilen şey bu öğrenme deposuna yazma yetkisidir. Token'sız da site
tam çalışır; kayıt `durum.json indir` ya da terminal ile yapılır.

## Klavye

| Tuş | İş |
|---|---|
| `⌘K` / `/` | komut paleti (madde, faz, komut ara) |
| `t` | odaktaki maddeyi tazele (yeniden türettim) |
| `j` / `k` | maddeler arasında gez |
| `0`–`4` | odaktaki maddeye basamak ata |
| `u` | geri al |
| `n` | yeni seans |
| `?` | kısayolları göster |

## Üç katman — bu neden bir işaret listesi değil

Atölye sadece ne dediğini kaydetmez; söylediğini denetler, çürümesini
modeller ve nereye vardığını kestirir.

**KANIT.** Kapı kuralı "kanıtı commit'tir" diyor, o yüzden site depoya bakar:
her faz klasörünün dosyaları ve commit geçmişi (`git/trees` + `commits?path=`,
9 istek, 30 dakikalık kendi önbelleği). Bir fazda "kapalı kitap yazdım" ya da
üstü işaretliyken klasörde kurulum README'si dışında dosya *görünmüyorsa* bir
not düşülür. Suçlama değil: çalışma başka bir depoda ya da henüz
commit'lenmemiş olabilir. Dikkat edilen ayrım: **"bakılmadı" ile "bakıldı,
boştu" asla aynı görünmez** — karışırlarsa katman yalan söyler.

**TAZELİK.** Ustalık çürür. Model FSRS-6'nın kuvvet yasası; basamak→kararlılık
eşlemesi öyle denk geliyor ki 3. basamağın yarılanma ömrü (199 gün ≈ 6,5 ay)
Tatel & Ackerman'ın 2025 meta-analizinde prosedürel beceri için ölçülen
"kazanımın yarısı ~6,5 ayda gider" bulgusuyla örtüşüyor. Eşik bilinçli olarak
gevşek: **"gecikmiş" diye bir kavram yok**, kuyruk en fazla 3 madde gösterir,
sayaç birikmez. Gerekçe ölçülü: Anki yığını anketinde kullanıcıların %82'si
aracı bunaltıcı buluyor, %75'i eski tekrarları hiç yetiştiremiyor. Yeniden
türetebildiysen `atolye tazele <madde>` — basamak değişmez, saat sıfırlanır.

**KESTİRİM.** Haftalık ilerleme geçmişinden Monte Carlo yeniden örnekleme
(10.000 deneme), sonuç tek tarih değil bant: P50 / P85 / P95. **5 gözlemin
altında hiçbir tarih verilmez** — n=5'te P85 ile P95 aynı sayıya çöker ve
bilgi taşımaz. 10'un altında "zayıf temel" uyarısı düşer, çünkü ölçüm o
aralıkta tahminin kendisinin 2–3 kat oynadığını gösteriyor.

Üçünün de matematiği `atolye.js` ile `defter.py` içinde İKİ KEZ yazılı;
`./capraz-test.sh` ikisinin aynı sayıyı verdiğini doğrular (Monte Carlo dahil:
üreteç tohumlu ve bit-bit aynı). Ayrışırlarsa test kırmızı yanar.

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
