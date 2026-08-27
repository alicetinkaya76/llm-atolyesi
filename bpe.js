/* LLM Atölyesi — byte-level BPE, sıfırdan.
   Bu bir oyuncak değil: minbpe'nin/GPT-2'nin yaptığı işin aynısı, tarayıcıda
   koşacak kadar hızlı yazılmış hâli. Faz 1'in egzersizi burada OYNANIR.

   TASARIM KARARLARI
   1. Bayt düzeyi. Metin önce UTF-8'e çevrilir, ilk 256 token baytlardır.
      Türkçe için bu önemli: 'ğ' TEK karakter ama İKİ bayt (0xC4 0x9F).
      Yani eğitilmemiş bir bayt-BPE'de 'ğ' bile bir "birleşme" gerektirir —
      Türkçe daha ilk adımdan İngilizce'ye göre dezavantajlı başlar.
   2. Ön-parçalama (pre-tokenization). Birleşmelerin kelime sınırını
      geçmesini engeller. Farklı desenler seçilebilir; amaç öğrenenin
      GPT-2 deseninin Türkçe'de ne yaptığını GÖRMESİ (kesme işareti!).
   3. Kelime-frekansı optimizasyonu. Gerçek eğiticiler ham akış üzerinde
      değil, BENZERSİZ kelime tipleri üzerinde frekans ağırlıklı çalışır.
      Aynı birleşmeleri üretir, kat kat hızlıdır.
   4. Artımlı çift sayacı. Her birleşmede baştan saymak O(birleşme × korpus)
      olurdu; yalnız etkilenen kelimeler güncellenir.
   5. NFC normalizasyonu. macOS ve bazı editörler NFD üretir: orada 'ğ'
      g + U+0306 (3 bayt), 'ö' o + U+0308 (3 bayt) olur. Gözle aynı, token
      akışı bambaşka; yarısı NFC yarısı NFD bir korpus frekans kütlesini
      ikiye böler ve tokenizer sebepsiz kötüleşir. Girişte bir kez NFC'ye
      çevriliyor ve arayüzde söyleniyor. ('ğüş' NFC'de 6, NFD'de 9 bayt.)
   6. Belirlenimli — ve eşitlikler KURAL DIŞI DEĞİL, KURAL. Gerçek bir
      korpusta birleşme adımlarının ~%61'i en az iki çiftin aynı sayıda
      olduğu adımlardır; hangisinin kazandığı sözlüğü baştan aşağı değiştirir.
      İki yerleşik kural var:
        · minbpe: belgede İLK GÖRÜLEN çift kazanır (Python dict ekleme
          sırasına dayanan, kodda hiç yazılmayan örtük bir kural).
        · HF tokenizers: sözlük sırasına göre EN KÜÇÜK (a,b) çifti kazanır
          (trainer.rs'te açıkça yazılı).
      Burada HF kuralı seçildi: artımlı sayaç çiftleri silip yeniden
      eklediği için "ilk görülen" sırası zamanla bozulur; en-küçük-çift
      kuralı ise sıradan bağımsızdır, yani sonuç her koşuda aynıdır. */
(function (global) {
  'use strict';

  /* ---------- ön-parçalama desenleri ----------
     GPT-2'nin deseni İngilizce kısaltmalar ('s, 't, 're…) için özel dallar
     taşır. Türkçe'de bunların karşılığı yoktur; buna karşılık Türkçe'nin
     kesme işareti (Türkiye'nin) hiçbir dala uymadığı için kelime ÜÇE
     bölünür: "Türkiye" + "'" + "nin". Tezgâhın göstermek istediği tam da
     bu tür sessiz hasarlardır. */
  var DESENLER = {
    yok: {
      ad: 'yok (saf bayt)',
      not: 'Ön-parçalama yok: birleşmeler kelime sınırını geçebilir. ' +
           'Sözlük "  bir" gibi boşluklu parçalar öğrenir.',
      re: null
    },
    gpt2: {
      ad: 'GPT-2',
      not: 'İngilizce kısaltma dalları (\'s, \'t, \'re…) Türkçe\'de boşta kalır; ' +
           'Türkçe kesme işareti hiçbir dala uymadığı için "Türkiye\'nin" üçe bölünür.',
      re: /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu
    },
    gpt4: {
      ad: 'GPT-4 (cl100k)',
      not: 'Kısaltma dalları büyük/küçük harf duyarsız, sayılar en fazla 3 ' +
           'basamak öbeklenir. Türkçe kesme işareti sorunu aynen sürer.',
      re: /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/giu
    },
    tr: {
      ad: 'Türkçe-duyarlı',
      not: 'Kesme işaretini kelimeye BAĞLI tutar: "Türkiye\'nin" tek parça kalır. ' +
           'Fark, aynı korpusta GPT-2 deseniyle karşılaştırılarak ölçülebilir.',
      re: /ler|lar| ?\p{L}+(?:['’]\p{L}+)*| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu
    }
  };

  function onParcala(metin, desenAdi) {
    var d = DESENLER[desenAdi] || DESENLER.gpt2;
    if (!d.re) return [metin];
    return metin.match(d.re) || [];
  }

  /* ---------- yardımcı ---------- */
  var kodlayici = new TextEncoder();
  var cozucu = new TextDecoder('utf-8', { fatal: false });

  function baytlar(s) { return Array.from(kodlayici.encode(s)); }

  /* Girişte tek sefer NFC. Farkı ölçmek isteyen için ikisini de döndürür. */
  function normalle(metin) {
    var nfc = metin.normalize('NFC');
    return {
      metin: nfc,
      degisti: nfc !== metin,
      baytFarki: kodlayici.encode(metin).length - kodlayici.encode(nfc).length
    };
  }

  /* ---------- eğitim ---------- */
  /* secenek: { vocab, desen, ilerleme(fn) } */
  function egit(metin, secenek) {
    secenek = secenek || {};
    var hedefVocab = Math.max(256, secenek.vocab || 512);
    var desen = secenek.desen || 'gpt2';

    /* 1) benzersiz kelime tipleri + frekansları */
    var parcalar = onParcala(metin, desen);
    var frekans = new Map();
    for (var i = 0; i < parcalar.length; i++) {
      frekans.set(parcalar[i], (frekans.get(parcalar[i]) || 0) + 1);
    }

    /* 2) her tipi bayt dizisine çevir */
    var kelimeler = [];   /* {ids: number[], f: number} */
    frekans.forEach(function (f, k) {
      var b = baytlar(k);
      if (b.length) kelimeler.push({ ids: b, f: f });
    });

    var toplamBayt = 0, toplamParca = 0;
    kelimeler.forEach(function (w) { toplamBayt += w.ids.length * w.f; toplamParca += w.f; });

    /* 3) çift sayaçları + hangi kelimede geçtiği */
    var sayac = new Map();        /* "a,b" -> adet */
    var iceren = new Map();       /* "a,b" -> Set(kelime indeksi) */

    /* sayısal anahtar: string birleştirme 3-5 kat yavaş ve çöp üretir.
       Token kimlikleri < 2^20 olduğu sürece güvenli (çarpım < 2^53). */
    var K = 1 << 20;
    function anahtar(a, b) { return a * K + b; }

    function kelimeCiftEkle(wi, isaret) {
      var w = kelimeler[wi], ids = w.ids;
      for (var j = 0; j + 1 < ids.length; j++) {
        var k = anahtar(ids[j], ids[j + 1]);
        var yeni = (sayac.get(k) || 0) + isaret * w.f;
        if (yeni <= 0) { sayac.delete(k); }
        else { sayac.set(k, yeni); }
        if (isaret > 0) {
          if (!iceren.has(k)) iceren.set(k, new Set());
          iceren.get(k).add(wi);
        }
      }
    }
    for (var wi = 0; wi < kelimeler.length; wi++) kelimeCiftEkle(wi, +1);

    /* 4) birleşme döngüsü */
    var birlesmeler = [];         /* {a,b,yeni,adet,parca} */
    var sozluk = new Map();       /* id -> bayt dizisi */
    for (var b0 = 0; b0 < 256; b0++) sozluk.set(b0, [b0]);

    var sonrakiId = 256;
    while (sonrakiId < hedefVocab) {
      /* En sık çift. EŞİTLİKTE: en küçük (a,b) kazanır — HF kuralı.
         Anahtar a*2^20+b olduğu için sayısal karşılaştırma sözlük sırasıyla
         aynı şeydir. Bu kural sıradan bağımsızdır: artımlı sayaç çiftleri
         silip yeniden eklese de sonuç değişmez. */
      var enIyi = -1, enCok = 0;
      sayac.forEach(function (v, k) {
        if (v > enCok || (v === enCok && enIyi >= 0 && k < enIyi)) { enCok = v; enIyi = k; }
      });
      if (enIyi < 0 || enCok < 2) break;   /* tekrar eden çift kalmadı */

      var A = Math.floor(enIyi / K), B = enIyi % K;
      var yeniId = sonrakiId++;
      sozluk.set(yeniId, sozluk.get(A).concat(sozluk.get(B)));

      /* yalnız bu çifti içeren kelimeleri güncelle */
      var etkilenen = iceren.get(enIyi) || new Set();
      etkilenen.forEach(function (wj) {
        var w = kelimeler[wj];
        if (!w) return;
        /* eski katkıları düş */
        kelimeCiftEkle(wj, -1);
        /* birleştir */
        var out = [], ids = w.ids;
        for (var j = 0; j < ids.length; j++) {
          if (j + 1 < ids.length && ids[j] === A && ids[j + 1] === B) { out.push(yeniId); j++; }
          else out.push(ids[j]);
        }
        w.ids = out;
        /* yeni katkıları ekle */
        kelimeCiftEkle(wj, +1);
      });
      sayac.delete(enIyi);
      iceren.delete(enIyi);

      birlesmeler.push({
        a: A, b: B, yeni: yeniId, adet: enCok,
        parca: metinle(sozluk.get(yeniId))
      });

      if (secenek.ilerleme && (birlesmeler.length % 25 === 0)) {
        secenek.ilerleme(birlesmeler.length, hedefVocab - 256);
      }
    }

    return {
      birlesmeler: birlesmeler,
      sozluk: sozluk,
      desen: desen,
      vocab: sonrakiId,
      toplamBayt: toplamBayt,
      toplamParca: toplamParca
    };
  }

  /* bayt dizisini okunabilir metne çevir; yarım UTF-8 dizileri için
     görünür bir yer tutucu bırakır (Türkçe'de sık: 'ğ'nin ilk baytı) */
  function metinle(bytes) {
    var s = cozucu.decode(new Uint8Array(bytes));
    return s;
  }

  /* ---------- uygulama (kodlama) ---------- */
  function kodla(metin, model) {
    var parcalar = onParcala(metin, model.desen);
    /* birleşme sırası = öncelik */
    var sira = new Map();
    model.birlesmeler.forEach(function (m, i) { sira.set(m.a + ',' + m.b, i); });

    var cikti = [];
    parcalar.forEach(function (p) {
      var ids = baytlar(p);
      while (ids.length >= 2) {
        var enIyi = null, enIyiSira = Infinity, enIyiIdx = -1;
        for (var j = 0; j + 1 < ids.length; j++) {
          var s = sira.get(ids[j] + ',' + ids[j + 1]);
          if (s !== undefined && s < enIyiSira) { enIyiSira = s; enIyi = j; enIyiIdx = j; }
        }
        if (enIyi === null) break;
        var m = model.birlesmeler[enIyiSira];
        var out = [];
        for (var j2 = 0; j2 < ids.length; j2++) {
          if (j2 === enIyiIdx) { out.push(m.yeni); j2++; }
          else out.push(ids[j2]);
        }
        ids = out;
      }
      for (var q = 0; q < ids.length; q++) cikti.push(ids[q]);
    });
    return cikti;
  }

  function tokenMetni(id, model) {
    var b = model.sozluk.get(id);
    return b ? metinle(b) : '�';
  }

  /* Tersinirlik: decode(encode(w)) === w. Bu bir PUAN değil KAPIDIR —
     tersinir olmayan bir tokenizer üretim için geçersizdir. */
  function tersinirMi(metin, model) {
    var ids = kodla(metin, model);
    var b = [];
    ids.forEach(function (id) {
      var v = model.sozluk.get(id);
      if (v) for (var i = 0; i < v.length; i++) b.push(v[i]);
    });
    return metinle(b) === metin;
  }

  global.BPE = {
    normalle: normalle,
    tersinirMi: tersinirMi,
    DESENLER: DESENLER,
    onParcala: onParcala,
    egit: egit,
    kodla: kodla,
    tokenMetni: tokenMetni,
    baytlar: baytlar
  };
})(window);
