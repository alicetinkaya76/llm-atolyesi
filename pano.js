/* LLM Atölyesi — ana pano.
   Ayrı dosya: CSP script-src 'self' satır-içi betiği engelliyor
   (token localStorage'da olduğu için XSS yüzeyini kapatmak şart). */
(function () {
  'use strict';
  var A = window.Atolye;

  /* ---- service worker: çevrimdışı + telefona kurulum ---- */
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(function (reg) {
        reg.update();
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) reg.update();
        });
      })
      .catch(function () { /* SW olmasa da site çalışır */ });
    /* yeni sürüm devraldığında bir kez tazele (döngüye karşı korumalı) */
    var tazelendi = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (tazelendi) return;
      tazelendi = true;
      location.reload();
    });
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---- ısı haritası ---- */
  /* Renk kademesi sabit eşiklerle değil, kendi dağılımının çeyrekleriyle
     belirlenir. Çalışma saatleri sağa çarpık ve çoğu gün sıfır: doğrusal
     bir ramp'te tek bir 6 saatlik Cumartesi bütün 1.5 saatlik günleri
     görünmez yapar. Çeyreklikler kendini kalibre eder — 1. ayda da
     (en fazla 2 sa) 9. ayda da (8 sa) okunur kalır. */
  function kademeYapici(byDay) {
    var dolu = Object.keys(byDay).map(function (k) { return byDay[k]; })
      .filter(function (h) { return h > 0; }).sort(function (a, b) { return a - b; });
    if (!dolu.length) return function (h) { return h > 0 ? 4 : 0; };
    function ceyrek(p) { return dolu[Math.min(dolu.length - 1, Math.floor(p * dolu.length))]; }
    var c1 = ceyrek(0.25), c2 = ceyrek(0.5), c3 = ceyrek(0.75);
    return function (h) {
      if (h <= 0) return 0;
      if (h <= c1) return 1;
      if (h <= c2) return 2;
      if (h <= c3) return 3;
      return 4;
    };
  }

  function isiHaritasi(s, hafta) {
    var kolon = s.heatmap(hafta);
    var kademe = kademeYapici(s.byDay);
    var hucre = 13, bosluk = 3, solPay = 22, ustPay = 14;
    var g = solPay + kolon.length * (hucre + bosluk);
    var y = ustPay + 7 * (hucre + bosluk);
    var parca = ['<svg viewBox="0 0 ' + g + ' ' + y + '" role="img" aria-label="Son ' + hafta + ' haftanın günlük çalışma saatleri">'];

    var gunAd = ['Pzt', '', 'Çar', '', 'Cum', '', 'Paz'];
    for (var d = 0; d < 7; d++) {
      if (!gunAd[d]) continue;
      parca.push('<text x="0" y="' + (ustPay + d * (hucre + bosluk) + hucre - 2) +
        '" font-size="7" fill="currentColor" opacity="0.45" font-family="IBM Plex Mono, monospace">' + gunAd[d] + '</text>');
    }

    var sonAy = -1;
    kolon.forEach(function (kol, ki) {
      var x = solPay + ki * (hucre + bosluk);
      var ilk = A.parseDate(kol[0].date);
      if (ilk && ilk.getMonth() !== sonAy && ki < kolon.length - 1) {
        sonAy = ilk.getMonth();
        var aylar = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
        parca.push('<text x="' + x + '" y="8" font-size="7" fill="currentColor" opacity="0.45" font-family="IBM Plex Mono, monospace">' + aylar[sonAy] + '</text>');
      }
      kol.forEach(function (gun, gi) {
        var yy = ustPay + gi * (hucre + bosluk);
        if (gun.future) {
          parca.push('<rect x="' + x + '" y="' + yy + '" width="' + hucre + '" height="' + hucre +
            '" rx="3" fill="var(--surface-2)" opacity="0.4"/>');
          return;
        }
        var h = gun.hours, kat = kademe(h);
        var dolgu = kat === 0 ? 'var(--surface-2)' : 'var(--accent)';
        var opak = [1, 0.28, 0.5, 0.75, 1][kat];
        parca.push('<rect x="' + x + '" y="' + yy + '" width="' + hucre + '" height="' + hucre +
          '" rx="3" fill="' + dolgu + '" opacity="' + opak + '"><title>' +
          A.esc(gun.date) + ' — ' + A.fmtHours(h) + ' sa</title></rect>');
      });
    });
    parca.push('</svg>');
    return parca.join('');
  }

  function panoCiz(muf, st, agdan, taslakVar) {
    var s = A.stats(muf, st);
    var pano = document.getElementById('pano');
    pano.innerHTML = '';

    /* --- sıradaki iş --- */
    var it = s.nextItem;
    var hero = el('div', 'hero');
    if (it) {
      var faz = A.phaseById(muf, it.p);
      hero.style.setProperty('--pc', faz ? faz.color : 'var(--accent)');
      var adlar = A.levelNames(muf, it);
      var sev = s.lvl(it.id);
      hero.appendChild(el('div', 'ust', 'sıradaki iş · ' + A.esc(faz ? faz.tag : it.p)));
      hero.appendChild(el('div', 'baslik', A.esc(it.lbl)));
      hero.appendChild(el('div', 'alt',
        'şu an: <strong>' + A.esc(adlar[sev]) + '</strong> → hedef: <strong>' +
        A.esc(adlar[A.passLevel(it)]) + '</strong>'));
      if (it.hint) hero.appendChild(el('div', 'alt', A.esc(it.hint)));
      if (s.lastYarin) {
        hero.appendChild(el('div', 'alt',
          '<b>Kendine not (' + A.esc(s.lastYarin.date) + '):</b> ' + A.esc(s.lastYarin.metin)));
      }
      var eylem = el('div', 'eylem');
      var b1 = el('a', 'dugme', 'Haftalık plana git');
      b1.href = A.phasePage(it.p);
      var b2 = el('a', 'dugme ikincil', 'Defterde işaretle');
      b2.href = 'defter.html#' + encodeURIComponent(it.id);
      eylem.appendChild(b1); eylem.appendChild(b2);
      hero.appendChild(eylem);
    } else {
      hero.appendChild(el('div', 'ust', 'durum'));
      hero.appendChild(el('div', 'baslik', 'Tüm çekirdek maddeler eşiği geçti 🎉'));
      hero.appendChild(el('div', 'alt', 'Kalan maddeler seçmeli. Capstone’a odaklanma vakti.'));
    }
    pano.appendChild(hero);

    /* --- rakamlar --- */
    var r = el('div', 'rakamlar');

    var k1 = el('div', 'rakam');
    k1.appendChild(el('div', 'v', '%' + s.overallPct));
    k1.appendChild(el('div', 'l', 'çekirdek ilerleme'));
    var m1 = el('div', 'mini'); var i1 = el('i'); i1.style.width = s.overallPct + '%';
    m1.appendChild(i1); k1.appendChild(m1);
    r.appendChild(k1);

    var hedefPct = Math.min(100, Math.round(100 * s.hoursThisWeek / s.weekTarget));
    var k2 = el('div', 'rakam');
    k2.appendChild(el('div', 'v', A.fmtHours(s.hoursThisWeek) + ' <span class="ek">/ ' + s.weekTarget + ' sa</span>'));
    k2.appendChild(el('div', 'l', 'bu hafta'));
    var m2 = el('div', 'mini'); var i2 = el('i');
    i2.style.width = hedefPct + '%';
    if (hedefPct >= 100) i2.style.background = 'var(--ok)';
    m2.appendChild(i2); k2.appendChild(m2);
    r.appendChild(k2);

    var seri = s.weekStreak();
    var k3 = el('div', 'rakam');
    k3.appendChild(el('div', 'v', seri + (seri ? ' 🔥' : '')));
    k3.appendChild(el('div', 'l', 'hedefi tutan hafta'));
    k3.appendChild(el('div', 'ek', seri ? 'ardışık' : 'haftalık hedef: ' + s.weekTarget + ' sa'));
    r.appendChild(k3);

    var k4 = el('div', 'rakam');
    k4.appendChild(el('div', 'v', A.fmtHours(s.totalHours) + ' <span class="ek">sa</span>'));
    k4.appendChild(el('div', 'l', 'toplam'));
    k4.appendChild(el('div', 'ek', s.sessions + ' seans' +
      (s.daysSinceLast === 0 ? ' · bugün ✓' :
       s.daysSinceLast === 1 ? ' · dün' :
       s.daysSinceLast != null ? ' · ' + s.daysSinceLast + ' gün önce' : '')));
    r.appendChild(k4);
    pano.appendChild(r);

    /* --- ısı haritası --- */
    /* hafta sayısı gerçek kullanılabilir genişlikten türetilir (medya sorgusu
       değil): pencere yükleme anında dar olup sonra genişleyebiliyor. */
    var enBoy = pano.clientWidth || 640;
    var hafta = Math.max(10, Math.min(20, Math.floor((enBoy - 22) / 16)));
    var isi = el('div', 'isi', isiHaritasi(s, hafta));
    isi.style.setProperty('--isi-genislik', (22 + hafta * 16) + 'px');
    pano.appendChild(isi);
    var alt = el('div', 'isi-alt');
    alt.style.maxWidth = (22 + hafta * 16) + 'px';
    alt.appendChild(el('span', null, 'son ' + hafta + ' hafta'));
    var olcek = el('div', 'isi-olcek');
    olcek.appendChild(el('span', null, 'az'));
    [0.28, 0.5, 0.75, 1].forEach(function (o) {
      var i = document.createElement('i');
      i.style.background = 'var(--accent)'; i.style.opacity = o;
      olcek.appendChild(i);
    });
    olcek.appendChild(el('span', null, 'çok'));
    alt.appendChild(olcek);
    pano.appendChild(alt);

    if (!agdan) {
      pano.appendChild(el('div', 'uyari',
        'Veri sayfaya gömülü anlık görüntüden okundu (ağ yok ya da dosyadan açıldı). ' +
        'Güncel için siteyi çevrimiçi aç.'));
    }
    if (taslakVar) {
      var u = el('div', 'uyari',
        'Bu rakamlar defterdeki <b>henüz depoya işlenmemiş</b> değişiklikleri içeriyor. ' +
        '<a href="defter.html">Defterden kaydet →</a>');
      pano.appendChild(u);
    }

    /* --- faz listesi --- */
    var liste = document.getElementById('faz-listesi');
    liste.innerHTML = '';
    muf.phases.forEach(function (p) {
      var a = el('a', 'faz-satir');
      a.href = A.phasePage(p.id);
      a.style.setProperty('--pc', p.color);
      var pct = s.phasePct(p.id), g = s.gate(p.id), kalan = s.gateRemaining(p.id);
      a.appendChild(el('span', 'etiket', A.esc(p.tag)));
      a.appendChild(el('span', 'ad', A.esc(p.name)));
      var c = el('div', 'cubuk'); var ci = el('i');
      ci.style.width = pct + '%'; ci.style.background = A.barColor(p);
      c.appendChild(ci); a.appendChild(c);
      a.appendChild(el('span', 'yuzde', '%' + pct));
      a.appendChild(el('span', 'kapi' + (g === 'on' ? ' on' : ''),
        g === 'on' ? 'kapı geçildi' : (kalan ? kalan + ' madde kaldı' : 'başlamadı')));
      liste.appendChild(a);
    });
  }

  /* pencere boyu değişince ısı haritası yeniden ölçeklensin (geciktirilmiş) */
  var sonVeri = null, zaman = null;
  window.addEventListener('resize', function () {
    if (!sonVeri) return;
    clearTimeout(zaman);
    zaman = setTimeout(function () { panoCiz(sonVeri.muf, sonVeri.state, sonVeri.fromNetwork, sonVeri.taslakVar); }, 180);
  });

  /* Defterdeki kaydedilmemiş taslağı da hesaba kat: yoksa ön sayfa sıfır
     gösterirken defter gerçek ilerlemeyi gösterir ve pano yalan söyler. */
  function taslagiKatmanla(v) {
    if (!v) return v;
    try {
      var ham = localStorage.getItem('atolye-taslak-v1');
      if (!ham) return v;
      var t = A.normalizeState(JSON.parse(ham), v.muf);
      if (!t) return v;
      if (A.icerikImzasi(t) === A.icerikImzasi(v.state)) return v;
      if (A.dahaYeni(t.updated, v.state.updated)) {
        v.state = t;
        v.taslakVar = true;
      }
    } catch (e) { /* taslak okunamadı: depo hâliyle devam */ }
    return v;
  }

  A.load('./').then(taslagiKatmanla).then(function (v) {
    sonVeri = v;
    if (!v) {
      document.getElementById('pano').innerHTML =
        '<p class="uyari">Müfredat yüklenemedi. Site bir sunucudan servis edilmeli ' +
        '(<code>node serve.mjs</code>) ya da terminalden: <code>atolye durum</code></p>';
      return;
    }
    panoCiz(v.muf, v.state, v.fromNetwork, v.taslakVar);
  }).catch(function (e) {
    document.getElementById('pano').innerHTML =
      '<p class="uyari">Pano çizilemedi: ' + A.esc(e && e.message ? e.message : e) + '</p>';
  });
})();
