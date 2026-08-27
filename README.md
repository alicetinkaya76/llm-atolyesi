# LLM Atölyesi

Paul Graham'ın "LLM'leri sıfırdan kurmayı öğren, elindeki donanımla
eğitebildiğin en güçlü modeli eğit" tavsiyesinin müstakil atölyesi — aynı
zamanda statik bir site. Bulut servisine bağımlı değil: veri düz JSON,
arayüz bir CLI + statik HTML, hepsi bu depoda.

Canlı: <https://alicetinkaya76.github.io/llm-atolyesi/>

## Mimari: tek yazıcı

Yazan tek şey **terminaldir**. Sayfalar `durum.json`'u yalnızca okur.

Bu bir kısıtlama gibi görünür ama asıl işi bir sorun *sınıfını* yok
etmektir: tarayıcıda taslak tutulmadığı için uzlaştırılacak iki durum yok,
dolayısıyla içerik imzası, zaman damgası karşılaştırması, geri-al yığını,
indir-ve-değiştir akışı ve tarayıcıdan-depoya-yazma token'ı da yok. Aynı
sebeple ilerleme matematiği **bir kez** yazılıdır (`atolye.mjs`); tarayıcı
Python koşamaz ama terminal Node koşar, o yüzden ortak dil JavaScript'tir.

```
mufredat.json   ne öğrenilecek        (42 madde / 7 faz — tek kaynak)
durum.json      nerede olunduğu       (yalnız `atolye` yazar)
atolye.mjs      ilerleme matematiği   (tek uygulama; CLI ve sayfa aynısını koşar)
atolye          terminal arayüzü      (tek yazıcı)
app.js          sayfa arayüzü         (salt okunur)
```

## Kurulum

```bash
ln -sf ~/Desktop/llm-atolyesi/atolye /usr/local/bin/atolye
```

Bağımlılık yok; Node 18+ yeter.

## Günlük kullanım

```bash
atolye              # bugün ne açacağım: kendine notun, sıradaki iş, açık sorular
atolye f0a 3 -y     # basamak ata → kaydet → commit → push
atolye seans        # $EDITOR'de seans notu (git commit kalıbı; boş bırakırsan kaydedilmez)
atolye rapor        # son 12 hafta + faz durumu + eşikler
atolye liste f1     # bir fazın madde kimlikleri
atolye site         # yerel önizleme → http://localhost:8933
```

`-y` (`--yayinla`): `durum.json` commit'lenip push'lanır, site birkaç dakika
içinde güncellenir. Unutursan sonra `atolye yayinla`.

## Ustalık merdiveni ve kapı kuralı

İşaret kutusu yok. Her *yap* maddesi beş basamakta durur:

```
0 başlamadım · 1 bütünü gördüm · 2 kapalı kitap yazdım ·
3 egzersiz/test yeşil · 4 Türkçe büküm + defter
```

*Oku* maddeleri iki basamaklıdır (`okudum · deftere özetledim`). Eşik, *yap*
için 3, *oku* için 2'dir; bir maddenin tavanı müfredatta daha düşük
tutulmuşsa (örn. `z1` için 3) eşik tavana kırpılır.

**Kapı kuralı:** bir faz, çekirdek (Ç) maddelerinin tümü eşikteyse *ve en az
biri tavandaysa* geçilir. İkinci şart kasıtlı — her şeyi "yeterince" yapıp
hiçbirini sonuna kadar götürmemek bu müfredatın en olası başarısızlık biçimi.

Panodaki eşik yüzdeleri elle yazılmaz; müfredattan türetilir
(`atolye.mjs → esikler()`) ve testte bağımsız bir simülasyonla karşılaştırılır.
Son kapı %100'de **değildir**: kalan pay 4. basamaktır ve hiçbir kapının şartı
değildir. Bu gizlenmiyor, panoda yazıyor.

## Yöntem

1. **Bütünü gör** → 2. **kapalı kitap yeniden yaz** (kopyalamak yasak) →
3. **egzersizi/testi koştur** → 4. **Türkçe'ye bük** (kendi korpusunda mini
deney) → 5. **beş satır defter** (yaptım / öğrendim / anlamadım / yarın).

Haftalık ritim: 2 derin blok (2–3 sa) + 1 hafif blok. Hedef sayacı ve seri
(streak) yok — ölçüt kapılar, saatler yalnızca bağlam.

Her seans bir commit; çalışma dosyaları `zemin/`, `faz0/` … klasörlerinde.
"Kapalı kitap yazdım" iddiasının kanıtı commit'tir.

Beşinci adımın "yarın ilk iş" satırı panonun en üstüne çıkar: sistemdeki tek
gerçekten ileriye dönük veri, çünkü bağlam sıcakken sen yazdın.

## Dosyalar

| Dosya | Ne |
|---|---|
| `mufredat.json` | Müfredat: 42 madde, 7 faz, ustalık basamakları (tek kaynak) |
| `durum.json` | İlerlemenin tek kaynağı — git ile izlenir |
| `atolye.mjs` | İlerleme matematiği (tek uygulama) |
| `atolye` | Terminal arayüzü ve `durum.json`'un tek yazıcısı |
| `atolye.test.mjs` | `node --test atolye.test.mjs` — 11 test |
| `app.js` | Sayfaların salt-okunur betiği (pano + madde rozetleri) |
| `index.html` | Pano: kendine not · sıradaki iş · kapı merdiveni · saatler |
| `harita.html` | Yol haritası (6 faz + zemin, kaynaklar, maliyet merdiveni) |
| `fazlar/*.html` | Haftalık planlar; `app.js` her maddenin basamağını buraya yazar |
| `tezgah.html` + `bpe.js` + `tezgah.js` | Tokenizer tezgâhı: sıfırdan byte-level BPE |
| `stil.css` | Sitenin tek stil dosyası (satır-içi stil yok, CSP'de `unsafe-inline` yok) |
| `serve.mjs` | Yerel önizleme sunucusu |
| `zemin/ faz0..faz5/` | Faz çalışma klasörleri — kanıt kodların buraya |

## Tokenizer tezgâhı

`tezgah.html` Faz 1'in egzersizini anlatmaz, **çalıştırır**: kendi metnini
ver, tarayıcıda gerçek byte-level BPE eğitilsin. Kütüphane yok — `bpe.js`
sıfırdan ~200 satır. Ölçüm dürüstlüğü kuralları koda gömülü: fertility
eğitildiği metinde ölçülmez (%80 eğitim / %20 ölçüm), örneklem boyutu her
zaman yazılır, hiçbir sayı elle girilmez.

## Yayınlama

Depo public; `main`/root'tan GitHub Pages. Her `git push` siteyi günceller.

**Gizlilik notu:** public depoda `durum.json` ve seans günlüğün de görünür.
Bilerek karar ver; istemiyorsan depo private kalır ve site yerelde
`atolye site` ile yaşar.

## Neyin çıkarıldığı, neden

Bu depo bir ara PWA servis çalışanı, komut paleti, klavye kısayolları,
tarayıcıdan-depoya-yazma token'ı, kanıt/tazelik/kestirim katmanları ve
Python ile JS'te iki kez yazılmış bir ilerleme matematiği (artı ikisini
tutarlı tutan bir çapraz test) taşıyordu. Hiçbiri "bugün ne açacağım"
sorusunun cevabını değiştirmiyordu; ölçme aygıtı ölçtüğü müfredatın üç katı
büyüklüğe çıkmıştı. Hepsi git geçmişinde duruyor.

Tazelik katmanının tavsiyesi kayıp değil, yeri değişti: müfredatın kendisi
onu nedeniyle birlikte söylüyor (`z4`: "Faz 0'ın sonunda testi tekrarla").
