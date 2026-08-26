/* LLM Atölyesi — ana pano.
   Ayrı dosya: CSP script-src 'self' satır-içi betiği engelliyor
   (token localStorage'da olduğu için XSS yüzeyini kapatmak şart). */
(function () {
  'use strict';
  var A = window.Atolye;

  /* ---- service worker: çevrimdışı + telefona kurulum ---- */
  /* Service worker YEREL geliştirmede kaydedilmez: varlıklar cache-first
     servis edildiği için düzenlenen JS bir sonraki yüklemeye kadar eski
     kalıyor ve bu, geliştirirken saatler yiyen bir yanılgı üretiyor
     (bir kez yaşandı). Canlı sitede normal çalışır. */
  var YEREL_MI = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 && !YEREL_MI) {
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

  /* ---- YÖRÜNGE ----
     Tek grafikte üç şey: gerçekleşen ilerleme (olay günlüğünden yeniden
     oynatılmış), geçilmiş kapılar (kilometre taşı), ve kestirim konisi
     (P50–P95 arası belirsizlik bandı). Kestirim yoksa koni ÇİZİLMEZ —
     boş bir gelecek uydurmaktansa yalnız geçmişi göstermek dürüsttür. */
  function yorunge(muf, s) {
    var seri = s.ilerlemeSerisi(60);
    if (!seri) return null;
    /* ilk gerçek kayıttan başla: baştaki sıfır kuyruğu grafiği ezmesin */
    var ilk = 0;
    while (ilk < seri.length - 1 && seri[ilk].pct === 0 && seri[ilk + 1].pct === 0) ilk++;
    seri = seri.slice(ilk);
    if (seri.length < 2) return null;

    var kestirim = s.kestirim(100 - s.overallPct);
    var kapilar = s.kapiGecmisi() || {};

    var W = 640, H = 190, solP = 30, sagP = 54, ustP = 12, altP = 22;
    var ic = W - solP - sagP, yuk = H - ustP - altP;

    var haftaSayisi = seri.length;
    var ileriHafta = (kestirim && kestirim.yeterli && kestirim.p95)
      ? Math.min(kestirim.p95, 120) : 0;
    var toplamHafta = haftaSayisi + ileriHafta;

    function X(h) { return solP + ic * (h / Math.max(1, toplamHafta - 1)); }
    function Y(p) { return ustP + yuk * (1 - p / 100); }

    var g = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      A.esc('Çekirdek ilerlemenin zaman içindeki seyri ve kestirim aralığı') + '">'];

    /* ızgara */
    [0, 25, 50, 75, 100].forEach(function (p) {
      g.push('<line x1="' + solP + '" y1="' + Y(p).toFixed(1) + '" x2="' + (W - sagP) +
        '" y2="' + Y(p).toFixed(1) + '" stroke="currentColor" stroke-opacity="0.12"/>');
      g.push('<text x="' + (solP - 5) + '" y="' + (Y(p) + 3).toFixed(1) +
        '" font-size="8" text-anchor="end" fill="currentColor" opacity="0.45" ' +
        'font-family="IBM Plex Mono, monospace">' + p + '</text>');
    });

    /* kestirim konisi */
    if (ileriHafta > 0) {
      var x0 = X(haftaSayisi - 1), y0 = Y(s.overallPct);
      var xp50 = X(haftaSayisi - 1 + Math.min(kestirim.p50, 120));
      var xp95 = X(haftaSayisi - 1 + Math.min(kestirim.p95, 120));
      g.push('<path d="M' + x0.toFixed(1) + ',' + y0.toFixed(1) +
        ' L' + xp50.toFixed(1) + ',' + Y(100).toFixed(1) +
        ' L' + xp95.toFixed(1) + ',' + Y(100).toFixed(1) + ' Z" ' +
        'fill="var(--accent)" fill-opacity="0.14"/>');
      [['p50', 0.55, '4 3'], ['p85', 0.8, '2 3']].forEach(function (c) {
        var xw = X(haftaSayisi - 1 + Math.min(kestirim[c[0]], 120));
        g.push('<line x1="' + x0.toFixed(1) + '" y1="' + y0.toFixed(1) + '" x2="' + xw.toFixed(1) +
          '" y2="' + Y(100).toFixed(1) + '" stroke="var(--accent)" stroke-opacity="' + c[1] +
          '" stroke-width="1" stroke-dasharray="' + c[2] + '"/>');
      });
    }

    /* gerçekleşen çizgi */
    var nokta = seri.map(function (x, i) { return X(i).toFixed(1) + ',' + Y(x.pct).toFixed(1); });
    g.push('<polyline points="' + nokta.join(' ') + '" fill="none" stroke="var(--accent)" ' +
      'stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    /* bugün noktası */
    g.push('<circle cx="' + X(haftaSayisi - 1).toFixed(1) + '" cy="' + Y(s.overallPct).toFixed(1) +
      '" r="3" fill="var(--accent)"/>');

    /* geçilmiş kapılar: gerçekleşen çizgi üzerinde işaret */
    Object.keys(kapilar).forEach(function (pid) {
      var k = kapilar[pid];
      var idx = -1;
      seri.forEach(function (x, i) { if (x.son >= k.tarih && idx < 0) idx = i; });
      if (idx < 0) return;
      var p = A.phaseById(muf, pid);
      g.push('<circle cx="' + X(idx).toFixed(1) + '" cy="' + Y(k.pct).toFixed(1) +
        '" r="4" fill="' + A.barColor(p) + '" stroke="var(--surface)" stroke-width="1.5">' +
        '<title>' + A.esc((p ? p.tag : pid) + ' kapısı — ' + k.tarih) + '</title></circle>');
    });

    /* eksen etiketleri: ilk ay, bugün, kestirim ucu */
    var aylar = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
    function ayEtiket(iso) {
      var d = A.parseDate(iso); return d ? aylar[d.getMonth()] : '';
    }
    g.push('<text x="' + solP + '" y="' + (H - 6) + '" font-size="8" fill="currentColor" ' +
      'opacity="0.45" font-family="IBM Plex Mono, monospace">' + ayEtiket(seri[0].son) + '</text>');
    g.push('<text x="' + X(haftaSayisi - 1).toFixed(1) + '" y="' + (H - 6) +
      '" font-size="8" text-anchor="middle" fill="currentColor" opacity="0.6" ' +
      'font-family="IBM Plex Mono, monospace">bugün</text>');
    if (ileriHafta > 0) {
      g.push('<text x="' + (W - sagP) + '" y="' + (H - 6) + '" font-size="8" text-anchor="end" ' +
        'fill="currentColor" opacity="0.45" font-family="IBM Plex Mono, monospace">' +
        A.esc(String(kestirim.tarih95 || '').slice(0, 7)) + '</text>');
    }
    g.push('</svg>');
    return { svg: g.join(''), kestirim: kestirim, kapiSayisi: Object.keys(kapilar).length };
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

    /* --- yörünge + kestirim --- */
    var yor = yorunge(muf, s);
    if (yor) {
      var kutu = el('div', 'yorunge');
      kutu.appendChild(el('div', 'baslik-mini', 'Yörünge — gerçekleşen ilerleme ve kestirim'));
      kutu.appendChild(el('div', 'cizim', yor.svg));
      var k = yor.kestirim;
      var metin;
      if (k && k.yeterli && k.p85) {
        /* Tek tarih vermek yanıltıcı: yüzdelik bandı ve gözlem sayısı birlikte. */
        metin = '%85 güvenle <b>' + A.esc(k.tarih85) + '</b> (P50: ' + A.esc(k.tarih50) +
          (k.tarih95 ? ', P95: ' + A.esc(k.tarih95) : '') + ') — ' + k.gozlem + ' haftalık gözlemden.' +
          (k.zayif ? ' <b>Zayıf temel:</b> 10 haftadan az veriyle bu aralık kolayca 2–3 kat oynar.' : '');
      } else if (k && k.durgun) {
        metin = A.esc(k.neden);
      } else if (k) {
        metin = A.esc(k.neden || '') + ' Şimdilik yalnız geçmiş gösteriliyor.';
      }
      if (metin) kutu.appendChild(el('div', 'kestirim-metin', metin));
      if (yor.kapiSayisi) {
        kutu.appendChild(el('div', 'kestirim-metin',
          'Renkli noktalar geçilmiş faz kapıları.'));
      }
      pano.appendChild(kutu);
    }

    /* --- tazeleme önerisi (en fazla 3, borç yığını değil) --- */
    var kuyruk = s.tazelemeKuyrugu(3);
    if (kuyruk.length) {
      var tk = el('div', 'tazelik-kutu');
      tk.appendChild(el('div', 'baslik-mini', 'Tazeleme önerisi'));
      tk.appendChild(el('p', 'small',
        'Bu maddelerin üzerinden yarılanma süresinden fazla geçti — prosedürel ' +
        'becerinin yarısı ~6,5 ayda soluyor. Yeniden türetmeyi dene; hâlâ ' +
        'yazabiliyorsan defterden "tazele" de.'));
      var ul = el('ul', 'plain');
      kuyruk.forEach(function (x) {
        var ay = (x.tazelik.gun / 30.4).toFixed(1);
        var li = el('li', null,
          '<a href="defter.html#' + A.esc(x.it.id) + '">' + A.esc(x.it.id) + '</a> ' +
          A.esc(x.it.lbl) + ' — <span class="mono">' + ay + ' ay önce, tahmini hatırlama %' +
          Math.round(x.tazelik.R * 100) + '</span>');
        ul.appendChild(li);
      });
      tk.appendChild(ul);
      pano.appendChild(tk);
    }

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
