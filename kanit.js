/* LLM Atölyesi — KANIT katmanı.
   Kapı kuralı "kanıt commit'tir" diyor; bu dosya o iddiayı denetler.
   Depodaki faz klasörlerini (zemin/, faz0..faz5/) ve git geçmişini okur,
   defterdeki iddiaların KARŞISINA koyar.

   DOĞRULANMIŞ KISITLAR (kod bunlara göre):
   1. Kimliksiz istek sınırı 60/saat ve ÇAĞIRAN IP'ye bağlı. İstek
      ziyaretçinin tarayıcısından gittiği için bütçe kişiseldir; site tek bir
      havuzu paylaşmaz.
   2. ETag/If-None-Match İŞE YARAMAZ: kimliksiz 304 yanıtları da kotadan
      düşer (belgelerdeki muafiyet yalnız Authorization başlığıyla geçerli).
      Kotayı koruyan tek şey isteği HİÇ yapmamaktır → kendi TTL'li önbelleğim.
   3. /commits LİSTE yanıtı stats/files İÇERMEZ (belge sayfası yanıltıyor);
      commit başına ayrı istek ~250 KB'a ve 1 kotaya mal olur → yapılmaz.
      Dosya sayımı tek bir git/trees çağrısından gelir.
   4. git/trees'te `recursive` parametresi HERHANGİ bir değerle açılır
      (recursive=0 bile açar); kapatmak için parametreyi hiç yazma.

   Soğuk yükte toplam 9 istek: 1 ağaç + 7 faz + 1 genel son etkinlik. */
(function (global) {
  'use strict';

  var API = 'https://api.github.com';
  var ONBELLEK = 'atolye-kanit-v1';
  var TTL_DK = 30;          /* önbellek ömrü */
  var ALT_SINIR = 12;       /* bu kotanın altına inersek yeni istek yapma */

  function repoBilgisi() {
    if (global.Gh && global.Gh.repoBilgisi) return global.Gh.repoBilgisi();
    var m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
    if (m) {
      var ilk = location.pathname.split('/').filter(Boolean)[0];
      return { owner: m[1], repo: ilk || (m[1] + '.github.io') };
    }
    var meta = document.querySelector('meta[name="atolye-repo"]');
    if (meta && meta.content.indexOf('/') > 0) {
      var p = meta.content.split('/');
      return { owner: p[0], repo: p[1] };
    }
    return null;
  }

  /* ---------- önbellek ---------- */
  function onbellekOku() {
    try {
      var ham = localStorage.getItem(ONBELLEK);
      if (!ham) return null;
      var o = JSON.parse(ham);
      if (!o || !o.t || !o.veri) return null;
      var yasDk = (Date.now() - o.t) / 60000;
      o.veri.yasDk = Math.round(yasDk);
      o.veri.bayat = yasDk > TTL_DK;
      return o.veri;
    } catch (e) { return null; }
  }
  function onbellekYaz(veri) {
    try { localStorage.setItem(ONBELLEK, JSON.stringify({ t: Date.now(), veri: veri })); }
    catch (e) { /* kota dolu ya da kapalı: kanıt katmanı yine çalışır, yavaş */ }
  }

  /* ---------- HTTP ---------- */
  var sonKalan = null;

  function iste(yol) {
    var basliklar = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    /* Token varsa kullanılır: 60/saat yerine 5000/saat.
       Zorunlu değil — token yoksa da her şey çalışır. */
    if (global.Gh && global.Gh.tokenVar && global.Gh.tokenVar()) {
      basliklar.Authorization = 'Bearer ' + (global.Gh.token ? global.Gh.token() : '');
    }
    return fetch(API + yol, { headers: basliklar }).then(function (r) {
      var kalan = r.headers.get('x-ratelimit-remaining');
      if (kalan !== null) sonKalan = parseInt(kalan, 10);
      if (r.status === 403 || r.status === 429) {
        var e = new Error('kota'); e.kota = true; throw e;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---------- toplama ---------- */
  function agacOku(r) {
    /* TEK istekte tüm dosya listesi; path kökten tam yol olduğu için
       ilk bileşene göre kovalanır. */
    return iste('/repos/' + r.owner + '/' + r.repo + '/git/trees/HEAD?recursive=1')
      .then(function (a) {
        var kova = {}, kesildi = !!a.truncated;
        (a.tree || []).forEach(function (n) {
          if (n.type !== 'blob') return;
          var parca = n.path.split('/');
          if (parca.length < 2) return;              /* kök dosyaları sayma */
          var ust = parca[0];
          if (!kova[ust]) kova[ust] = { dosya: 0, kanitDosya: 0 };
          kova[ust].dosya++;
          /* README iskeletleri kanıt değil: onları ayrı say */
          if (parca[parca.length - 1].toLowerCase() !== 'readme.md') kova[ust].kanitDosya++;
        });
        return { kova: kova, kesildi: kesildi };
      });
  }

  function fazCommitleri(r, klasor) {
    return iste('/repos/' + r.owner + '/' + r.repo + '/commits?path=' +
                encodeURIComponent(klasor) + '&per_page=100')
      .then(function (liste) {
        if (!Array.isArray(liste)) return { adet: 0, son: null, sonMesaj: null };
        var son = null, sonMesaj = null;
        if (liste.length) {
          var c = liste[0];
          son = (c.commit && c.commit.author && c.commit.author.date) || null;
          sonMesaj = (c.commit && c.commit.message || '').split('\n')[0];
        }
        return { adet: liste.length, son: son, sonMesaj: sonMesaj, taban: liste.length >= 100 };
      })
      .catch(function (e) {
        if (e.kota) throw e;
        return { adet: null, son: null, sonMesaj: null };  /* 404/ağ: bilinmiyor */
      });
  }

  /* muf.phases[].klasor gerekiyor */
  function topla(muf) {
    var r = repoBilgisi();
    if (!r) return Promise.reject(new Error('Depo belirlenemedi.'));
    var fazlar = (muf.phases || []).filter(function (p) { return p.klasor; });

    return agacOku(r).then(function (agac) {
      return Promise.all(fazlar.map(function (p) {
        return fazCommitleri(r, p.klasor).then(function (c) {
          var k = agac.kova[p.klasor] || { dosya: 0, kanitDosya: 0 };
          return { id: p.id, klasor: p.klasor, commit: c.adet, son: c.son,
                   sonMesaj: c.sonMesaj, dosya: k.dosya, kanitDosya: k.kanitDosya };
        });
      })).then(function (satirlar) {
        var out = { fazlar: {}, agacKesildi: agac.kesildi, kalan: sonKalan, zaman: Date.now() };
        satirlar.forEach(function (s) { out.fazlar[s.id] = s; });
        return out;
      });
    });
  }

  /* Ana giriş: önbellek tazeyse ağa hiç çıkma. */
  function yukle(muf, zorla) {
    var onb = onbellekOku();
    if (onb && !onb.bayat && !zorla) {
      onb.kaynak = 'önbellek';
      return Promise.resolve(onb);
    }
    if (sonKalan !== null && sonKalan < ALT_SINIR && !zorla) {
      /* kota tükeniyor: elde ne varsa onu ver, bayat olsa bile */
      if (onb) { onb.kaynak = 'önbellek (kota korunuyor)'; return Promise.resolve(onb); }
      return Promise.resolve({ hata: 'kota', fazlar: {} });
    }
    return topla(muf).then(function (veri) {
      /* bir faz bile 'bilinmiyor' döndüyse bunu yarım saat kalıcılaştırma */
      var eksik = Object.keys(veri.fazlar).some(function (id) {
        return veri.fazlar[id].commit === null;
      });
      if (!eksik) onbellekYaz(veri);
      veri.kaynak = 'canlı';
      veri.yasDk = 0;
      return veri;
    }).catch(function (e) {
      if (onb) {
        /* Elde GEÇERLİ veri var; tazeleyemedik diye onu 'okunmadı' saymak
           K0/K1 ayrımını çökertir. `hata` YAZMIYORUZ — ayrı alan. */
        onb.kaynak = e.kota ? 'önbellek (kota)' : 'önbellek (ağ yok)';
        onb.tazelenemedi = e.kota ? 'kota' : 'ag';
        return onb;
      }
      return { hata: e.kota ? 'kota' : 'ag', fazlar: {} };
    });
  }

  /* ---------- iddia ↔ kanıt karşılaştırması ----------
     YANLIŞ POZİTİFE KARŞI ÜÇ KURAL:
     1. Yalnız "yap" maddeleri sayılır — okuma maddesi kod üretmez.
     2. Yalnız basamak ≥ 2 ("kapalı kitap yazdım") sayılır; 1 = "bütünü
        gördüm" henüz kod yazmayı gerektirmez.
     3. Kanıt = klasörde README DIŞINDA dosya bulunması. Commit sayısı tek
        başına yetmez: her faz klasörü kurulurken bir README iskeletiyle
        birlikte commit'lenmişti, yani "1 commit" her zaman vardır ve kanıt
        değildir. Commit sayısı yalnız bağlam olarak gösterilir.
     Sonuç bir SUÇLAMA değil, bir NOT: kanıt başka depoda/klasörde olabilir
     ya da henüz push'lanmamış olabilir. Dil buna göre seçilmiştir. */
  function karsilastir(muf, stats, kanit) {
    if (!kanit || kanit.hata) return null;
    var out = [];
    (muf.phases || []).forEach(function (p) {
      var k = kanit.fazlar[p.id];
      if (!k) return;
      var iddiali = (muf.items || []).filter(function (it) {
        return it.p === p.id && it.t === 'yap' && stats.lvl(it.id) >= 2;
      });
      var kanitVar = k.kanitDosya > 0;
      out.push({
        id: p.id, tag: p.tag, klasor: k.klasor,
        iddia: iddiali.length,
        iddiaKimlikleri: iddiali.map(function (i) { return i.id; }),
        commit: k.commit, dosya: k.kanitDosya, son: k.son, sonMesaj: k.sonMesaj,
        kanitVar: kanitVar,
        acik: iddiali.length > 0 && !kanitVar      /* iddia var, kanıt görünmüyor */
      });
    });
    return out;
  }

  global.Kanit = {
    yukle: yukle,
    karsilastir: karsilastir,
    onbellekOku: onbellekOku,
    repoBilgisi: repoBilgisi,
    TTL_DK: TTL_DK
  };
})(window);
