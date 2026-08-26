/* LLM Atölyesi — tarayıcıdan depoya yazma (tamamen OPSİYONEL).
   Amaç: telefondan ya da terminal açmadan işaretleme yapabilmek.
   Token yoksa site tam çalışır; bu modül yalnızca uykuda bekler.

   DOĞRULANMIŞ TUZAKLAR (kod bunlara göre yazıldı):
   1. btoa(metin) Türkçe'de İKİ TÜRLÜ bozar: ş/ğ/İ/Ş/Ğ'de InvalidCharacterError
      fırlatır, ö/ü/ç/â/î/û'de ise HATA VERMEDEN Latin-1 mojibake yazar.
      Bu yüzden her zaman TextEncoder → bayt → base64.
   2. GET /contents yanıtı max-age=60 ile önbelleklenir; bayat sha → PUT 409.
      Bu yüzden sha her PUT'tan hemen önce cache:'no-store' ile alınır ve
      denemeler arasında asla yeniden kullanılmaz.
   3. 409 = verdiğin sha güncel değil (yeniden oku, tekrar dene).
      422 "sha wasn't supplied" = dosya var ama sha göndermedin.
   4. Push'tan sonra Pages'in yayınlaması 10 dakikayı bulabilir; doğrulama
      için Pages'ten değil, api.github.com'dan geri okunur. */
(function (global) {
  'use strict';

  var ANAHTAR = 'atolye-gh-token';
  var API = 'https://api.github.com';

  /* ---------- depo kimliği ---------- */
  /* alicetinkaya76.github.io/llm-atolyesi/... → owner=alicetinkaya76, repo=llm-atolyesi */
  function repoBilgisi() {
    var h = location.hostname, yol = location.pathname;
    var m = h.match(/^([\w-]+)\.github\.io$/i);
    if (m) {
      var ilk = yol.split('/').filter(Boolean)[0];
      return { owner: m[1], repo: ilk || (m[1] + '.github.io') };
    }
    /* yerelde çalışırken sayfa <meta name="atolye-repo" content="sahip/depo"> verebilir */
    var meta = document.querySelector('meta[name="atolye-repo"]');
    if (meta && meta.content.indexOf('/') > 0) {
      var p = meta.content.split('/');
      return { owner: p[0], repo: p[1] };
    }
    return null;
  }

  /* ---------- token ----------
     VARSAYILAN: kalıcı saklama YOK. Token yalnızca bu sekmenin belleğinde
     durur; kullanıcı açıkça "bu tarayıcıda hatırla" derse localStorage'a
     yazılır. Paylaşılan köken (github.io altındaki tüm proje siteleri aynı
     localStorage'ı görür) bu tercihin bilinçli olmasını gerektiriyor. */
  var bellekToken = '';

  function token() {
    if (bellekToken) return bellekToken;
    try { return localStorage.getItem(ANAHTAR) || ''; } catch (e) { return ''; }
  }
  function tokenVar() { return !!token(); }
  function kalici() {
    try { return !!localStorage.getItem(ANAHTAR); } catch (e) { return false; }
  }
  /* hatirla=true ise localStorage'a yazılır; değilse yalnız bellekte tutulur */
  function tokenYaz(t, hatirla) {
    bellekToken = String(t || '').trim();
    if (!hatirla) {
      try { localStorage.removeItem(ANAHTAR); } catch (e) {}
      return true;
    }
    try { localStorage.setItem(ANAHTAR, bellekToken); return true; }
    catch (e) { return false; }
  }
  function tokenUnut() {
    bellekToken = '';
    try { localStorage.removeItem(ANAHTAR); return true; } catch (e) { return false; }
  }

  /* ---------- base64 (UTF-8 güvenli) ---------- */
  function metindenB64(metin) {
    var bayt = new TextEncoder().encode(metin);
    var ikili = '';
    /* parça parça: çok büyük dizilerde apply yığını taşırabilir */
    for (var i = 0; i < bayt.length; i += 0x8000) {
      ikili += String.fromCharCode.apply(null, bayt.subarray(i, i + 0x8000));
    }
    return btoa(ikili);
  }
  function b64tenMetin(b64) {
    var temiz = String(b64).replace(/\s/g, ''); /* GitHub 60 karakterde bir \n koyar */
    var ikili = atob(temiz);
    var bayt = new Uint8Array(ikili.length);
    for (var i = 0; i < ikili.length; i++) bayt[i] = ikili.charCodeAt(i);
    return new TextDecoder().decode(bayt);
  }

  /* ---------- HTTP ---------- */
  function istek(yol, secenek) {
    secenek = secenek || {};
    var basliklar = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (tokenVar()) basliklar.Authorization = 'Bearer ' + token();
    if (secenek.body) basliklar['Content-Type'] = 'application/json';
    return fetch(API + yol, {
      method: secenek.method || 'GET',
      headers: basliklar,
      body: secenek.body ? JSON.stringify(secenek.body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      return r.text().then(function (gövde) {
        var veri = null;
        try { veri = gövde ? JSON.parse(gövde) : null; } catch (e) { veri = null; }
        return { ok: r.ok, status: r.status, veri: veri, ham: gövde, yanit: r };
      });
    });
  }

  function hataMesaji(s) {
    if (!s) return 'Bilinmeyen hata.';
    if (s.status === 401) return 'Token geçersiz ya da süresi dolmuş (401). Yenisini üret.';
    if (s.status === 403 || s.status === 429) {
      var kalan = s.yanit && s.yanit.headers.get('x-ratelimit-remaining');
      if (kalan === '0') return 'İstek sınırına takıldın (403). Bir süre bekle.';
      return 'İzin reddedildi (403): token bu depoya "Contents: write" yetkisi taşımıyor olabilir.';
    }
    if (s.status === 404) return 'Bulunamadı (404): depo adı yanlış ya da token bu depoyu görmüyor.';
    var m = s.veri && s.veri.message;
    return m ? m + ' (' + s.status + ')' : 'HTTP ' + s.status;
  }

  /* ---------- dosya oku / yaz ---------- */
  function dosyaOku(yol, dal) {
    var r = repoBilgisi();
    if (!r) return Promise.reject(new Error('Depo belirlenemedi.'));
    var q = '/repos/' + r.owner + '/' + r.repo + '/contents/' + yol +
            (dal ? '?ref=' + encodeURIComponent(dal) : '');
    return istek(q).then(function (s) {
      if (s.status === 404) return { yok: true, sha: null, metin: null };
      if (!s.ok) throw new Error(hataMesaji(s));
      return {
        yok: false,
        sha: s.veri.sha,
        metin: s.veri.content ? b64tenMetin(s.veri.content) : ''
      };
    });
  }

  /* JSON nesnesini depoya yaz. Çakışmada sha'yı tazeleyip yeniden dener. */
  function jsonYaz(yol, nesne, mesaj, secenek) {
    secenek = secenek || {};
    var r = repoBilgisi();
    if (!r) return Promise.reject(new Error('Depo belirlenemedi (github.io dışında meta etiketi gerek).'));
    if (!tokenVar()) return Promise.reject(new Error('Token yok.'));

    var metin = JSON.stringify(nesne, null, 1) + '\n';
    var icerik = metindenB64(metin);
    var enFazla = 3;

    function dene(kalan) {
      /* sha HER denemede yeniden okunur; denemeler arası taşınmaz */
      return dosyaOku(yol, secenek.dal).then(function (mevcut) {
        var gövde = {
          message: mesaj || ('defter: ' + new Date().toISOString().slice(0, 10)),
          content: icerik
        };
        if (secenek.dal) gövde.branch = secenek.dal;
        if (!mevcut.yok) gövde.sha = mevcut.sha;

        return istek('/repos/' + r.owner + '/' + r.repo + '/contents/' + yol, {
          method: 'PUT', body: gövde
        }).then(function (s) {
          if (s.ok) {
            return {
              commit: s.veri && s.veri.commit ? s.veri.commit.sha : null,
              url: s.veri && s.veri.commit ? s.veri.commit.html_url : null
            };
          }
          var msg = (s.veri && s.veri.message) || '';
          var cakisma = s.status === 409 ||
                        (s.status === 422 && /sha/i.test(msg));
          if (cakisma && kalan > 0) {
            /* biri (ör. terminalden push) araya girdi: sha'yı tazeleyip tekrar dene */
            return new Promise(function (c) { setTimeout(c, 400 * (enFazla - kalan + 1)); })
              .then(function () { return dene(kalan - 1); });
          }
          throw new Error(hataMesaji(s));
        });
      });
    }
    return dene(enFazla);
  }

  /* Token'ı doğrula: depoya yazma yetkisi var mı? */
  function dogrula() {
    var r = repoBilgisi();
    if (!r) return Promise.resolve({ ok: false, mesaj: 'Depo belirlenemedi.' });
    if (!tokenVar()) return Promise.resolve({ ok: false, mesaj: 'Token girilmemiş.' });
    return istek('/repos/' + r.owner + '/' + r.repo).then(function (s) {
      if (!s.ok) return { ok: false, mesaj: hataMesaji(s) };
      var yazabilir = s.veri && s.veri.permissions && s.veri.permissions.push;
      return yazabilir
        ? { ok: true, mesaj: r.owner + '/' + r.repo + ' — yazma yetkisi var ✓' }
        : { ok: false, mesaj: 'Token bu depoyu görüyor ama yazma yetkisi yok (Contents: Read and write gerekli).' };
    }).catch(function (e) { return { ok: false, mesaj: String(e.message || e) }; });
  }

  global.Gh = {
    repoBilgisi: repoBilgisi,
    tokenVar: tokenVar,
    kalici: kalici,
    tokenYaz: tokenYaz,
    tokenUnut: tokenUnut,
    dosyaOku: dosyaOku,
    jsonYaz: jsonYaz,
    dogrula: dogrula,
    metindenB64: metindenB64,
    b64tenMetin: b64tenMetin,
    ANAHTAR: ANAHTAR
  };
})(window);
