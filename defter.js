/* LLM Atölye Defteri — uygulama katmanı.
   Hesap mantığı atolye.js'te; burada yalnızca arayüz, klavye ve kaydetme var.

   KAYDETME MODELİ (üç katman, tek doğru kaynak):
     · DEPO   — durum.json (git). Tek gerçek kaynak.
     · TASLAK — localStorage. Henüz depoya işlenmemiş değişiklikler.
     · EKRAN  — state nesnesi.
   Açılışta depo okunur; taslak daha yeniyse o yüklenir ve "kaydedilmedi" denir.
   Kaydetme iki yoldan olur: durum.json indir (her zaman) ya da GitHub'a yaz
   (token varsa). İkincisi tamamen opsiyoneldir; yoksa site tam çalışır. */
(function () {
  'use strict';
  var A = window.Atolye, G = window.Gh;
  var TASLAK = 'atolye-taslak-v1';

  var muf = null, state = null, DEPO_JSON = null, DEPO_IMZA = null, s = null;
  var taslakVar = false, agdan = false;
  var odakIndex = -1, siraliMaddeler = [];
  var geriYigin = [];
  var acikFazlar = {};

  /* ---------------- yardımcı ---------------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(x) { return A.esc(x); }

  /* Türkçe duyarlı arama normalizasyonu.
     Katlama toLowerCase()'ten ÖNCE yapılır: JS'te 'İ'.toLowerCase() "i" +
     U+0307 (birleşik nokta) üretir, sonradan [ıİ] ile yakalanamaz ve
     "istanbul" araması "İSTANBUL"u bulamaz. Sonda kalan birleşik işaretler
     de temizlenir (macOS NFD metinleri için emniyet). */
  function norm(x) {
    return String(x)
      .replace(/[İIı]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
      .replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c')
      .replace(/[âÂ]/g, 'a').replace(/[îÎ]/g, 'i').replace(/[ûÛ]/g, 'u')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  /* alt dizi eşleşmesi: "tnsr" → "tensor puzzles" */
  function eslesir(sorgu, metin) {
    var q = norm(sorgu), m = norm(metin);
    if (!q) return 0;
    if (m.indexOf(q) >= 0) return 100 - m.indexOf(q); /* bitişik eşleşme yüksek puan */
    var qi = 0;
    for (var i = 0; i < m.length && qi < q.length; i++) if (m[i] === q[qi]) qi++;
    return qi === q.length ? 10 : -1;
  }

  var toastZaman = null;
  function toast(mesaj) {
    var t = $('toast');
    t.textContent = mesaj;
    t.classList.add('gor');
    clearTimeout(toastZaman);
    toastZaman = setTimeout(function () { t.classList.remove('gor'); }, 2200);
  }

  /* ---------------- durum / kayıt ---------------- */
  /* yalnızca içerik karşılaştırılır; `updated` her yazımda değişir */
  function kirliMi() { return A.icerikImzasi(state) !== DEPO_IMZA; }

  function taslakYaz() {
    state.updated = new Date().toISOString();
    try { localStorage.setItem(TASLAK, JSON.stringify(state)); }
    catch (e) { toast('Uyarı: tarayıcı depolaması yazılamadı.'); }
  }
  function taslakSil() {
    try { localStorage.removeItem(TASLAK); } catch (e) {}
    taslakVar = false;
  }

  function degistir(fn, mesaj) {
    geriYigin.push(JSON.stringify(state));
    if (geriYigin.length > 60) geriYigin.shift();
    fn();
    taslakYaz();
    taslakVar = true;
    yenidenCiz();
    if (mesaj) toast(mesaj);
  }

  function geriAl() {
    if (!geriYigin.length) { toast('Geri alınacak bir şey yok.'); return; }
    var onceki = geriYigin.pop();
    state = JSON.parse(onceki);
    taslakYaz();
    yenidenCiz();
    toast('Geri alındı.');
  }

  function indir() {
    var blob = new Blob([JSON.stringify(state, null, 1) + '\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'durum.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
    toast('durum.json indirildi — depodakiyle değiştir.');
  }

  function ghKaydet() {
    if (!G || !G.tokenVar()) { toast('Önce token ekle (aşağıdaki ⚙︎ bölümü).'); return; }
    var btn = $('btn-gh-kaydet');
    if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…'; }
    var ozet = 'defter: ' + A.todayLocal() + ' — %' + s.overallPct +
               ', ' + state.journal.length + ' seans';
    G.jsonYaz('durum.json', state, ozet).then(function (sonuc) {
      DEPO_JSON = JSON.stringify(state);
      DEPO_IMZA = A.icerikImzasi(state);
      taslakSil();
      yenidenCiz();
      toast('GitHub\'a kaydedildi ✓ (site birkaç dakika içinde güncellenir)');
      if (sonuc && sonuc.url) console.log('commit:', sonuc.url);
    }).catch(function (e) {
      toast('Kaydedilemedi: ' + (e && e.message ? e.message : e));
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'GitHub\'a kaydet'; }
      kayitBarCiz();
    });
  }

  /* ---------------- çizim ---------------- */
  function ozetCiz() {
    var k = $('ozet');
    k.innerHTML = '';
    function kutu(v, l) {
      var d = el('div', 'k');
      d.appendChild(el('div', 'v', v));
      d.appendChild(el('div', 'l', esc(l)));
      return d;
    }
    k.appendChild(kutu('%' + s.overallPct, 'çekirdek ilerleme'));
    k.appendChild(kutu(A.fmtHours(s.hoursThisWeek) + ' <span class="l">/ ' + s.weekTarget + ' sa</span>', 'bu hafta'));
    k.appendChild(kutu(A.fmtHours(s.totalHours) + ' <span class="l">sa</span>', s.sessions + ' seans'));
    var ge = s.nextItem ? esc(s.nextItem.id) : '—';
    k.appendChild(kutu('<span style="font-size:0.95rem">' + ge + '</span>', 'sıradaki madde'));
  }

  function merdivenCiz() {
    $('merdiven').innerHTML =
      'Merdiven — <b>yap</b>: <span class="mono">' + esc(muf.levels.yap.join(' · ')) + '</span>; ' +
      '<b>oku</b>: <span class="mono">' + esc(muf.levels.oku.join(' · ')) + '</span>. ' +
      'Kapı: çekirdek (Ç) maddelerin tümü eşikte ve en az biri tavanda. ' +
      'Aynı basamağa ikinci tıklama bir geri alır.';
  }

  function fazlarCiz() {
    var kap = $('fazlar');
    kap.innerHTML = '';
    siraliMaddeler = [];

    muf.phases.forEach(function (p) {
      var acik = acikFazlar[p.id];
      var card = el('div', 'pcard' + (acik ? ' acik' : ''));
      card.style.setProperty('--pc', p.color);
      card.dataset.faz = p.id;

      var head = el('div', 'phead');
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      head.setAttribute('aria-expanded', acik ? 'true' : 'false');
      head.appendChild(el('span', 'tag' + (p.dark ? ' inkdark' : ''), esc(p.tag)));
      head.appendChild(el('span', 'nm', esc(p.name)));
      var plan = el('a', 'plan', 'plan ↗');
      plan.href = A.phasePage(p.id);
      plan.addEventListener('click', function (ev) { ev.stopPropagation(); });
      head.appendChild(plan);
      head.appendChild(kanitRozeti(p));
      var g = s.gate(p.id), kalan = s.gateRemaining(p.id);
      head.appendChild(el('span', 'gate' + (g === 'on' ? ' on' : g === 'run' ? ' run' : ''),
        g === 'on' ? 'KAPI GEÇİLDİ' : (kalan ? kalan + ' madde' : 'başlamadı')));
      head.appendChild(el('span', 'ppct', '%' + s.phasePct(p.id)));
      head.appendChild(el('span', 'chev', '▶'));
      function acKapa() {
        acikFazlar[p.id] = !acikFazlar[p.id];
        yenidenCiz();
      }
      head.addEventListener('click', acKapa);
      head.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); acKapa(); }
      });
      card.appendChild(head);

      var body = el('div', 'pbody');
      s.phaseItems(p.id).forEach(function (it) {
        siraliMaddeler.push(it);
        body.appendChild(maddeCiz(it, p));
      });
      card.appendChild(body);
      kap.appendChild(card);
    });
    odakGoster();
  }

  /* ---------------- kanıt ---------------- */
  var kanitVeri = null, kanitKarsi = null;

  function kanitRozeti(p) {
    var el2 = el('a', 'kanit');
    var r = (window.Kanit && window.Kanit.repoBilgisi && window.Kanit.repoBilgisi()) || null;
    var klasor = p.klasor || '';
    el2.href = r && klasor
      ? 'https://github.com/' + r.owner + '/' + r.repo + '/tree/main/' + klasor
      : '#';
    el2.target = '_blank';
    el2.rel = 'noopener';
    el2.addEventListener('click', function (ev) { ev.stopPropagation(); });

    /* K0 ("bakılmadı") ile K1 ("bakıldı, iskeletten başka şey yok") ASLA
       aynı görünmemeli: karışırlarsa katman yalan söyler. Ayrı metin,
       ayrı stil. */
    if (!kanitVeri || kanitVeri.hata) {
      el2.className = 'kanit bakilmadi';
      el2.textContent = 'kanıt okunmadı';
      el2.title = kanitVeri && kanitVeri.hata === 'kota'
        ? 'GitHub istek sınırına takıldı; kanıt bu ziyarette okunamadı.'
        : 'Kanıt okunamadı (çevrimdışı ya da henüz denenmedi).';
      return el2;
    }
    var k = kanitVeri.fazlar[p.id];
    if (!k) {
      el2.className = 'kanit bakilmadi';
      el2.textContent = 'kanıt okunmadı';
      return el2;
    }

    var satir = kanitKarsi && kanitKarsi.filter(function (x) { return x.id === p.id; })[0];
    var acik = satir && satir.acik;
    el2.className = 'kanit' + (acik ? ' acik' : (k.kanitDosya > 0 ? ' var' : ' iskelet'));
    el2.textContent = k.kanitDosya > 0
      ? klasor + '/ ' + k.kanitDosya + ' dosya'
      : klasor + '/ iskelet';
    el2.title = acik
      ? 'Bu fazda ' + satir.iddia + ' madde "kapalı kitap yazdım" ya da üstünde, ama ' +
        klasor + '/ klasöründe README dışında dosya görünmüyor. Kanıt başka bir depoda ' +
        'ya da henüz push\'lanmamış olabilir.'
      : (k.commit != null ? k.commit + ' commit' : 'commit sayısı bilinmiyor') +
        (k.son ? ' · son ' + String(k.son).slice(0, 10) : '');
    return el2;
  }

  function kanitYukle() {
    if (!window.Kanit) return;
    window.Kanit.yukle(muf).then(function (v) {
      kanitVeri = v;
      yenidenCiz();
    }).catch(function () { /* kanıt katmanı isteğe bağlıdır; sessizce geç */ });
  }

  function maddeCiz(it, p) {
    var row = el('div', 'item');
    row.id = 'madde-' + it.id;
    row.dataset.madde = it.id;

    var r1 = el('div', 'row');
    /* madde kimliği, o maddenin haftalık plandaki anlatımına götürür:
       okuma ve kayıt tarafı madde düzeyinde buluşsun */
    var lbl = el('span', 'lbl',
      '<a class="kid" href="' + A.phasePage(it.p) + '#' + esc(it.id) +
      '" title="Haftalık planda gör">' + esc(it.id) + '</a> ' + esc(it.lbl) +
      (it.core ? ' <span class="core">Ç</span>' : ''));
    r1.appendChild(lbl);

    var lv = el('div', 'lvls');
    var adlar = A.levelNames(muf, it);
    var tavan = A.itemMax(it);
    for (var n = 0; n <= tavan; n++) {
      (function (n) {
        var b = document.createElement('button');
        b.textContent = n;
        b.title = adlar[n];
        b.setAttribute('aria-label', it.lbl + ': ' + adlar[n]);
        if (s.lvl(it.id) >= n && n > 0) b.className = 'hit' + (p.dark ? ' inkdark' : '');
        b.addEventListener('click', function () {
          /* tıklanan madde aynı zamanda klavye odağı olsun: fareyle
             başlayıp klavyeyle devam etmek doğal olsun */
          siraliMaddeler.forEach(function (x, i) { if (x.id === it.id) odakIndex = i; });
          seviyeAta(it, n);
        });
        lv.appendChild(b);
      })(n);
    }
    r1.appendChild(lv);
    row.appendChild(r1);
    if (it.hint) row.appendChild(el('div', 'hint', esc(it.hint)));

    var alt = el('div', 'lvlname');
    alt.innerHTML = esc(adlar[s.lvl(it.id)] || '');
    var f = s.tazelik(it.id);
    if (f && !f.bilinmiyor && f.durum !== 'taze') {
      var ay = (f.gun / 30.4).toFixed(1);
      var et = el('span', 'tazelik ' + f.durum);
      et.textContent = ' · ' + ay + ' ay önce, ~%' + Math.round(f.R * 100) + ' hatırlama';
      et.title = f.durum === 'yarilanma'
        ? 'Yarılanma süresini (' + (f.yarilanmaGun / 30.4).toFixed(1) + ' ay) geçti. ' +
          'Yeniden türetmeyi dene; hâlâ yazabiliyorsan tazele.'
        : 'Solmaya başladı; henüz acil değil.';
      alt.appendChild(et);
      if (f.durum === 'yarilanma') {
        var tb = el('button', 'tazele-dugme', 'tazele');
        tb.title = 'Bugün yeniden türettim — saati sıfırla (basamak değişmez)';
        tb.addEventListener('click', function (ev) {
          ev.stopPropagation();
          siraliMaddeler.forEach(function (x, i) { if (x.id === it.id) odakIndex = i; });
          tazeleMadde(it);
        });
        alt.appendChild(tb);
      }
    }
    row.appendChild(alt);
    return row;
  }

  function seviyeAta(it, n) {
    var simdi = s.lvl(it.id);
    var yeni = (simdi === n) ? Math.max(0, n - 1) : n;
    if (yeni === simdi) return;
    var oncekiKapi = s.gate(it.p);
    degistir(function () { A.basamakAta(state, it, yeni); });
    var adlar = A.levelNames(muf, it);
    if (s.gate(it.p) === 'on' && oncekiKapi !== 'on') {
      toast('🎉 ' + (A.phaseById(muf, it.p) || {}).tag + ' kapısı geçildi!');
    } else {
      toast(it.id + ' → ' + adlar[yeni]);
    }
  }

  function tazeleMadde(it) {
    if (!A.tazele(state, it)) { toast('Bu maddede tazelenecek bir basamak yok.'); return; }
    degistir(function () {}, it.id + ' tazelendi — saat bugünden başlıyor.');
  }

  /* ---------------- günlük ---------------- */
  var taslakSeans = bosSeans();
  function bosSeans() { return { date: '', hours: '', phase: 'z', j1: '', j2: '', j3: '', j4: '' }; }

  function jformCiz() {
    var f = $('jform');
    f.innerHTML =
      '<div class="jgrid">' +
        '<div><label for="jd">Tarih</label><input id="jd" type="date"></div>' +
        '<div><label for="jh">Saat</label><input id="jh" type="number" min="0" step="0.5" placeholder="2.5" inputmode="decimal"></div>' +
        '<div><label for="jp">Faz</label><select id="jp">' +
          muf.phases.map(function (p) {
            return '<option value="' + esc(p.id) + '">' + esc(p.tag + ' — ' + p.name) + '</option>';
          }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="jgrid">' +
        '<div><label for="j1">Ne yaptım</label><textarea id="j1"></textarea></div>' +
        '<div><label for="j2">Ne öğrendim</label><textarea id="j2"></textarea></div>' +
        '<div><label for="j3">Neyi anlamadım</label><textarea id="j3"></textarea></div>' +
        '<div><label for="j4">Yarın ilk iş</label><textarea id="j4"></textarea></div>' +
      '</div>';

    var d = $('jd');
    d.value = taslakSeans.date || A.todayLocal();
    $('jh').value = taslakSeans.hours;
    $('jp').value = taslakSeans.phase;
    $('j1').value = taslakSeans.j1; $('j2').value = taslakSeans.j2;
    $('j3').value = taslakSeans.j3; $('j4').value = taslakSeans.j4;

    function esitle() {
      taslakSeans = {
        date: $('jd').value, hours: $('jh').value, phase: $('jp').value,
        j1: $('j1').value, j2: $('j2').value, j3: $('j3').value, j4: $('j4').value
      };
    }
    f.addEventListener('input', esitle);
    f.addEventListener('change', esitle);

    var btn = el('button', 'dugme', 'Seansı kaydet');
    btn.addEventListener('click', seansEkle);
    f.appendChild(btn);
    var ip = el('span', 'ipucu', ' <kbd>⌘</kbd>+<kbd>Enter</kbd>');
    ip.style.marginLeft = '0.5rem';
    f.appendChild(ip);
  }

  function seansEkle() {
    var kayit = {
      id: 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: $('jd').value || A.todayLocal(),
      hours: parseFloat($('jh').value) || 0,
      phase: $('jp').value,
      yaptim: $('j1').value.trim(), ogrendim: $('j2').value.trim(),
      anlamadim: $('j3').value.trim(), yarin: $('j4').value.trim()
    };
    if (!kayit.yaptim && !kayit.hours) { toast('En azından "ne yaptım" ya da saat gir.'); return; }
    taslakSeans = bosSeans();
    degistir(function () { state.journal.push(kayit); },
      'Seans eklendi — bu hafta ' + A.fmtHours(s.hoursThisWeek + kayit.hours) + ' sa');
  }

  function jlisteCiz() {
    var k = $('jliste');
    k.innerHTML = '';
    state.journal.slice().sort(function (a, b) {
      if (a.date === b.date) return a.id === b.id ? 0 : (a.id < b.id ? 1 : -1);
      return a.date < b.date ? 1 : -1;
    }).forEach(function (e) {
      var d = el('div', 'jentry');
      var p = A.phaseById(muf, e.phase);
      var top = el('div', 'top');
      top.appendChild(el('span', 'd', esc(e.date)));
      top.appendChild(el('span', 'h', esc(A.fmtHours(e.hours) + ' sa · ' + (p ? p.tag : ''))));
      var del = el('button', 'del', '✕');
      del.title = 'Seansı sil';
      del.setAttribute('aria-label', e.date + ' seansını sil');
      del.addEventListener('click', function () {
        degistir(function () {
          state.journal = state.journal.filter(function (x) { return x.id !== e.id; });
        }, 'Seans silindi — geri almak için u');
      });
      top.appendChild(del);
      d.appendChild(top);
      var dl = el('dl');
      [['Yaptım', e.yaptim], ['Öğrendim', e.ogrendim], ['Anlamadım', e.anlamadim], ['Yarın', e.yarin]]
        .forEach(function (c) {
          if (c[1]) { dl.appendChild(el('dt', null, c[0])); dl.appendChild(el('dd', null, esc(c[1]))); }
        });
      d.appendChild(dl);
      k.appendChild(d);
    });
  }

  /* ---------------- kayıt çubuğu / bannerlar ---------------- */
  function kayitBarCiz() {
    var bar = $('kayitbar');
    bar.innerHTML = '';
    if (!kirliMi()) { bar.className = 'kayitbar'; return; }
    bar.className = 'kayitbar gorunur';
    bar.appendChild(el('span', 'msg', 'Depoya işlenmemiş değişiklik var'));
    var b1 = el('button', 'dugme', 'durum.json indir');
    b1.addEventListener('click', indir);
    bar.appendChild(b1);
    if (G && G.tokenVar()) {
      var b2 = el('button', 'dugme', 'GitHub\'a kaydet');
      b2.id = 'btn-gh-kaydet';
      b2.addEventListener('click', ghKaydet);
      bar.appendChild(b2);
    }
  }

  function bannerCiz() {
    var k = $('banner-alani');
    k.innerHTML = '';
    /* iddia-kanıt farkı: suçlama değil not. Kanıt başka depoda olabilir. */
    if (kanitKarsi) {
      var acikFaz = kanitKarsi.filter(function (x) { return x.acik; });
      if (acikFaz.length) {
        var ad = acikFaz.map(function (x) { return esc(x.klasor) + '/'; }).join(', ');
        var toplam = acikFaz.reduce(function (n, x) { return n + x.iddia; }, 0);
        k.appendChild(el('div', 'banner',
          '<b>Kanıt notu.</b> ' + toplam + ' maddede "kapalı kitap yazdım" ya da üstü ' +
          'işaretli, ama ' + ad + ' klasöründe kurulum README\'si dışında dosya ' +
          '<i>görünmüyor</i>. Bu bir hata değil bir boşluk: çalışma büyük olasılıkla ' +
          'başka bir yerde — ayrı bir depo, bir Colab defteri ya da henüz ' +
          'commit\'lenmemiş bir çalışma dizini. Buraya bir kopya ya da not koyarsan ' +
          'kapı kuralı kendi kendini denetler.'));
      }
    }
    if (!agdan) {
      k.appendChild(el('div', 'banner dikkat',
        'Depodaki <code>durum.json</code> okunamadı (çevrimdışı ya da dosyadan açıldı). ' +
        'Gösterilen veri tarayıcı taslağı olabilir; kaydetmeden önce çevrimiçi tazele.'));
    } else if (taslakVar) {
      k.appendChild(el('div', 'banner',
        'Tarayıcıda depodakinden yeni değişiklikler var — aşağıdaki çubuktan kaydet.'));
    }
  }

  function altbilgiCiz() {
    $('altbilgi').innerHTML =
      'Veri: <code>durum.json</code>' + (state.updated ? ' · son güncelleme ' + esc(String(state.updated).slice(0, 16).replace('T', ' ')) : '') +
      ' · terminal: <code>atolye bugun</code>';
  }

  function yenidenCiz() {
    s = A.stats(muf, state);
    /* iddia listesi basamaklarla birlikte değişir: karşılaştırmayı burada
       tazele, yalnız kanıt yüklenirken değil */
    if (kanitVeri && window.Kanit) kanitKarsi = window.Kanit.karsilastir(muf, s, kanitVeri);
    ozetCiz(); fazlarCiz(); jlisteCiz(); kayitBarCiz(); bannerCiz(); altbilgiCiz();
  }

  /* ---------------- odak / klavye ---------------- */
  function odakGoster() {
    document.querySelectorAll('.item.odak').forEach(function (n) { n.classList.remove('odak'); });
    if (odakIndex < 0 || odakIndex >= siraliMaddeler.length) return;
    var it = siraliMaddeler[odakIndex];
    var n = $('madde-' + it.id);
    if (n) n.classList.add('odak');
  }

  function odakla(idx, kaydir) {
    if (!siraliMaddeler.length) return;
    odakIndex = Math.max(0, Math.min(siraliMaddeler.length - 1, idx));
    var it = siraliMaddeler[odakIndex];
    if (!acikFazlar[it.p]) { acikFazlar[it.p] = true; yenidenCiz(); }
    odakGoster();
    if (kaydir !== false) {
      var n = $('madde-' + it.id);
      if (n) n.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function maddeyeGit(id) {
    var idx = -1;
    siraliMaddeler.forEach(function (it, i) { if (it.id === id) idx = i; });
    if (idx < 0) {
      /* faz kapalıysa listede yok: aç ve tekrar dene */
      var hedef = muf.items.filter(function (i) { return i.id === id; })[0];
      if (!hedef) return;
      acikFazlar[hedef.p] = true;
      yenidenCiz();
      siraliMaddeler.forEach(function (it, i) { if (it.id === id) idx = i; });
    }
    if (idx < 0) return;
    odakla(idx);
    var n = $('madde-' + id);
    if (n) { n.classList.add('vurgu'); setTimeout(function () { n.classList.remove('vurgu'); }, 1700); }
  }

  function yazmaAlaniMi(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function klavye(ev) {
    /* ⌘K / Ctrl+K her yerde çalışır */
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault(); paletAc(); return;
    }
    /* ⌘Enter: form içindeyken seansı kaydet */
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      if ($('jform').contains(document.activeElement)) { ev.preventDefault(); seansEkle(); }
      return;
    }
    if (paletAcikMi()) return;
    if (yazmaAlaniMi(ev.target)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    var t = ev.key;
    if (t === 'j' || t === 'ArrowDown') { ev.preventDefault(); odakla(odakIndex + 1); }
    else if (t === 'k' || t === 'ArrowUp') { ev.preventDefault(); odakla(odakIndex - 1); }
    else if (/^[0-4]$/.test(t)) {
      if (odakIndex < 0) { toast('Önce bir maddeye gel (j / k) ya da ⌘K ile ara.'); return; }
      var it = siraliMaddeler[odakIndex];
      var n = parseInt(t, 10);
      if (n > A.itemMax(it)) { toast(it.id + ' için en yüksek basamak ' + A.itemMax(it)); return; }
      ev.preventDefault();
      seviyeAta(it, n);
    }
    else if (t === 'u') { ev.preventDefault(); geriAl(); }
    else if (t === 't') {
      if (odakIndex < 0) { toast('Önce bir maddeye gel (j / k).'); return; }
      ev.preventDefault(); tazeleMadde(siraliMaddeler[odakIndex]);
    }
    else if (t === 'n') { ev.preventDefault(); $('gunluk').scrollIntoView({ behavior: 'smooth' }); setTimeout(function () { $('j1').focus(); }, 300); }
    else if (t === '/') { ev.preventDefault(); paletAc(); }
    else if (t === '?') { ev.preventDefault(); yardimGoster(); }
    else if (t === 'g') { ev.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  function yardimGoster() {
    var v = $('yardim');
    if (v) { v.remove(); return; }
    var d = el('div', 'banner');
    d.id = 'yardim';
    d.innerHTML =
      '<b>Klavye:</b> <kbd>j</kbd>/<kbd>k</kbd> madde gez · <kbd>0</kbd>–<kbd>4</kbd> basamak ata · ' +
      '<kbd>u</kbd> geri al · <kbd>t</kbd> tazele · <kbd>n</kbd> yeni seans · <kbd>⌘K</kbd> ya da <kbd>/</kbd> komut paleti · ' +
      '<kbd>g</kbd> başa dön · <kbd>?</kbd> bu yardımı kapat';
    $('banner-alani').appendChild(d);
  }

  /* ---------------- komut paleti ---------------- */
  var paletKayitlar = [], paletSecili = 0, paletSuzulmus = [];

  function paletAcikMi() { return $('palet').classList.contains('acik'); }

  function paletKayitlariKur() {
    paletKayitlar = [];
    muf.items.forEach(function (it) {
      var p = A.phaseById(muf, it.p);
      paletKayitlar.push({
        tur: 'madde', kod: it.id, metin: it.lbl,
        /* sağdaki bilgi çizim anında hesaplanır: basamak değişiyor */
        sagHesapla: function () {
          return (p ? p.tag : '') + ' · ' + s.lvl(it.id) + '/' + A.itemMax(it);
        },
        ara: it.id + ' ' + it.lbl + ' ' + (p ? p.name : '') + ' ' + (it.hint || ''),
        calistir: function () { maddeyeGit(it.id); }
      });
    });
    muf.phases.forEach(function (p) {
      paletKayitlar.push({
        tur: 'faz', kod: p.id, metin: p.tag + ' — ' + p.name + ' (haftalık plan)',
        sag: 'sayfa', ara: p.id + ' ' + p.tag + ' ' + p.name + ' plan faz',
        calistir: function () { location.href = A.phasePage(p.id); }
      });
    });
    [
      ['yeni seans', 'n', function () { $('gunluk').scrollIntoView({ behavior: 'smooth' }); setTimeout(function () { $('j1').focus(); }, 300); }],
      ['durum.json indir', '', indir],
      ['GitHub\'a kaydet', '', ghKaydet],
      ['geri al', 'u', geriAl],
      ['tümünü aç', '', function () { muf.phases.forEach(function (p) { acikFazlar[p.id] = true; }); yenidenCiz(); }],
      ['tümünü kapa', '', function () { acikFazlar = {}; yenidenCiz(); }],
      ['yol haritası', '', function () { location.href = 'harita.html'; }],
      ['atölye ana sayfası', '', function () { location.href = 'index.html'; }],
      ['klavye kısayolları', '?', yardimGoster]
    ].forEach(function (c) {
      paletKayitlar.push({
        tur: 'komut', kod: '›', metin: c[0], sag: c[1],
        ara: c[0] + ' komut', calistir: c[2]
      });
    });
  }

  function paletCiz(sorgu) {
    var liste = $('palet-liste');
    liste.innerHTML = '';
    var kaynak;
    if (sorgu) {
      kaynak = paletKayitlar
        .map(function (k) { return { k: k, p: eslesir(sorgu, k.ara) }; })
        .filter(function (x) { return x.p >= 0; })
        .sort(function (a, b) { return b.p - a.p; })
        .map(function (x) { return x.k; });
    } else {
      /* Boş sorgu boş liste demek değil: en olası işler öne alınır —
         sıradaki madde, seans kaydı, sonra içinde bulunulan fazın maddeleri. */
      var oncelik = [];
      if (s.nextItem) {
        paletKayitlar.forEach(function (k) {
          if (k.tur === 'madde' && k.kod === s.nextItem.id) oncelik.push(k);
        });
      }
      paletKayitlar.forEach(function (k) {
        if (k.tur === 'komut' && /seans|kaydet|indir/.test(k.metin)) oncelik.push(k);
      });
      var aktifFaz = s.nextItem ? s.nextItem.p : null;
      paletKayitlar.forEach(function (k) {
        if (k.tur === 'madde' && aktifFaz && oncelik.indexOf(k) < 0) {
          var it = muf.items.filter(function (i) { return i.id === k.kod; })[0];
          if (it && it.p === aktifFaz) oncelik.push(k);
        }
      });
      var kalan = paletKayitlar.filter(function (k) { return oncelik.indexOf(k) < 0; });
      kaynak = oncelik.concat(kalan);
    }
    paletSuzulmus = kaynak.slice(0, 40);
    if (!paletSuzulmus.length) {
      liste.appendChild(el('li', 'bos', 'Eşleşme yok.'));
      return;
    }
    if (paletSecili >= paletSuzulmus.length) paletSecili = 0;
    paletSuzulmus.forEach(function (k, i) {
      var li = el('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === paletSecili ? 'true' : 'false');
      li.id = 'palet-op-' + i;
      li.appendChild(el('span', 'pk', esc(k.kod)));
      li.appendChild(el('span', 'pl', esc(k.metin)));
      var sag = k.sagHesapla ? k.sagHesapla() : k.sag;
      if (sag) li.appendChild(el('span', 'pr', esc(sag)));
      li.addEventListener('mouseenter', function () { paletSecili = i; paletIsaretle(); });
      li.addEventListener('click', function () { paletCalistir(i); });
      liste.appendChild(li);
    });
    paletIsaretle();
  }

  function paletIsaretle() {
    var liste = $('palet-liste');
    Array.prototype.forEach.call(liste.children, function (li, i) {
      li.setAttribute('aria-selected', i === paletSecili ? 'true' : 'false');
    });
    var sec = liste.children[paletSecili];
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'nearest' });
    $('palet-arama').setAttribute('aria-activedescendant', sec ? sec.id : '');
  }

  function paletCalistir(i) {
    var k = paletSuzulmus[i];
    paletKapat();
    if (k && k.calistir) k.calistir();
  }

  function paletAc() {
    paletSecili = 0;
    $('perde').classList.add('acik');
    $('palet').classList.add('acik');
    var g = $('palet-arama');
    g.value = '';
    paletCiz('');
    g.focus();
  }
  function paletKapat() {
    $('perde').classList.remove('acik');
    $('palet').classList.remove('acik');
  }

  /* ---------------- GitHub bölümü ---------------- */
  function ghCiz() {
    var k = $('gh-icerik');
    k.innerHTML = '';
    if (!G) { k.appendChild(el('p', 'small', 'github.js yüklenmedi.')); return; }
    var r = G.repoBilgisi();

    var aciklama = el('p', 'small');
    aciklama.innerHTML =
      'Normalde ilerlemeyi terminalden işlersin (<code>atolye seviye z1 3 -y</code>). ' +
      'Telefondan ya da terminal açmadan kaydetmek istersen, kendi <b>fine-grained</b> ' +
      'token\'ını buraya girebilirsin; defter <code>durum.json</code>\'u doğrudan depoya yazar.';
    k.appendChild(aciklama);

    var uyari = el('div', 'banner dikkat');
    uyari.innerHTML =
      '<b>Bilerek karar ver:</b> token bu tarayıcının <code>localStorage</code>\'ında durur. ' +
      'GitHub Pages\'te <code>' + esc(r ? r.owner : 'kullanıcı') + '.github.io</code> altındaki ' +
      '<em>tüm</em> proje siteleri aynı kaynağı paylaşır — birinde çalışan herhangi bir betik ' +
      'bu token\'ı okuyabilir. Bu yüzden token yalnızca <b>bu depoya</b> ve yalnızca ' +
      '<b>Contents: Read and write</b> yetkisine kapsanmalı, kısa süreli olmalı. ' +
      'En kötü senaryoda kaybedilen şey: bu öğrenme deposuna yazma yetkisi.';
    k.appendChild(uyari);

    var durum = el('p', 'small');
    durum.id = 'gh-durum';
    durum.textContent = G.tokenVar()
      ? (G.kalici() ? 'Token bu tarayıcıda kayıtlı. Doğrulamak için "Sına".'
                    : 'Token yalnızca bu oturumda etkin (kaydedilmedi).')
      : 'Token yok — site tam çalışıyor, yalnızca doğrudan kaydetme kapalı.';
    k.appendChild(durum);

    if (!G.tokenVar()) {
      var yol = el('p', 'small');
      yol.innerHTML = 'Üretmek için: GitHub → Settings → Developer settings → ' +
        'Personal access tokens → <b>Fine-grained tokens</b> → Generate new token → ' +
        'Repository access: <b>Only select repositories</b> → <code>' +
        esc(r ? r.repo : 'llm-atolyesi') + '</code> → Permissions → Repository permissions → ' +
        '<b>Contents: Read and write</b>.';
      k.appendChild(yol);

      var giris = document.createElement('input');
      giris.type = 'password';
      giris.id = 'gh-token';
      giris.placeholder = 'github_pat_… (yalnızca sen yapıştır)';
      giris.autocomplete = 'off';
      k.appendChild(giris);

      /* Kalıcı saklama açık onayla. İşaretlenmezse token yalnız bu sekmenin
         belleğinde kalır ve sekme kapanınca gider. */
      var satirH = el('label', 'small');
      satirH.style.display = 'flex';
      satirH.style.alignItems = 'center';
      satirH.style.gap = '0.4rem';
      var kutu = document.createElement('input');
      kutu.type = 'checkbox';
      kutu.id = 'gh-hatirla';
      kutu.style.width = 'auto';
      satirH.appendChild(kutu);
      satirH.appendChild(document.createTextNode(
        'Bu tarayıcıda hatırla (localStorage). İşaretlemezsen sekme kapanınca silinir.'));
      k.appendChild(satirH);

      var kaydet = el('button', 'dugme', 'Token\'ı kullan');
      kaydet.addEventListener('click', function () {
        var v = giris.value.trim();
        if (!v) { toast('Token boş.'); return; }
        G.tokenYaz(v, kutu.checked);
        giris.value = '';
        ghCiz(); kayitBarCiz();
        toast(kutu.checked ? 'Token bu tarayıcıya kaydedildi.' : 'Token bu oturum için etkin.');
      });
      k.appendChild(kaydet);
    } else {
      var sat = el('div', 'arac');
      var sina = el('button', 'dugme ikincil', 'Sına');
      sina.addEventListener('click', function () {
        $('gh-durum').textContent = 'Sınanıyor…';
        G.dogrula().then(function (r2) {
          $('gh-durum').textContent = (r2.ok ? '✓ ' : '✗ ') + r2.mesaj;
        });
      });
      var unut = el('button', 'dugme ikincil', 'Token\'ı unut');
      unut.addEventListener('click', function () {
        G.tokenUnut(); ghCiz(); kayitBarCiz(); toast('Token silindi.');
      });
      sat.appendChild(sina); sat.appendChild(unut);
      k.appendChild(sat);
    }
  }

  /* ---------------- başlangıç ---------------- */
  function kur(v) {
    muf = v.muf;
    agdan = v.fromNetwork;
    var depo = v.state;
    DEPO_JSON = JSON.stringify(depo);
    DEPO_IMZA = A.icerikImzasi(depo);
    state = JSON.parse(DEPO_JSON);

    /* Taslak depodakinden yeniyse onu yükle. Karşılaştırma Date üzerinden:
       metin karşılaştırması yerel-ofset ile UTC damgalarını yanlış sıralar. */
    try {
      var ham = localStorage.getItem(TASLAK);
      if (ham) {
        var t = A.normalizeState(JSON.parse(ham), muf);
        if (t && A.icerikImzasi(t) === DEPO_IMZA) {
          taslakSil(); /* depo taslağı yakalamış, gereksiz */
        } else if (t && A.dahaYeni(t.updated, depo.updated)) {
          state = t; taslakVar = true;
        } else if (t) {
          /* taslak depodan eski ama farklı: depo kazanır, taslağı at ki
             kullanıcı eski veriyi yanlışlıkla geri yazmasın */
          taslakSil();
        }
      }
    } catch (e) { /* taslak okunamadı, depoyla devam */ }

    /* ilk açılışta sürmekte olan fazlar açık gelsin */
    s = A.stats(muf, state);
    var acildi = false;
    muf.phases.forEach(function (p) {
      if (s.gate(p.id) === 'run') { acikFazlar[p.id] = true; acildi = true; }
    });
    if (!acildi && s.nextItem) acikFazlar[s.nextItem.p] = true;

    paletKayitlariKur();
    merdivenCiz();
    jformCiz();
    yenidenCiz();
    ghCiz();

    kanitYukle();

    /* derin bağlantı: defter.html#f0a
       hashchange de dinlenir — aynı sayfada hash değişimi belgeyi yeniden
       yüklemez, dolayısıyla yalnızca açılışta bakmak yetmez. */
    function hashUygula() {
      if (location.hash.length > 1) {
        maddeyeGit(decodeURIComponent(location.hash.slice(1)));
      }
    }
    hashUygula();
    window.addEventListener('hashchange', hashUygula);

    /* araç düğmeleri */
    $('btn-palet').addEventListener('click', paletAc);
    $('btn-yeni').addEventListener('click', function () {
      $('gunluk').scrollIntoView({ behavior: 'smooth' });
      setTimeout(function () { $('j1').focus(); }, 300);
    });
    $('btn-ac-kapa').addEventListener('click', function () {
      var hepsiAcik = muf.phases.every(function (p) { return acikFazlar[p.id]; });
      acikFazlar = {};
      if (!hepsiAcik) muf.phases.forEach(function (p) { acikFazlar[p.id] = true; });
      yenidenCiz();
    });

    document.addEventListener('keydown', klavye);
    $('perde').addEventListener('click', paletKapat);
    $('palet-arama').addEventListener('input', function () { paletSecili = 0; paletCiz(this.value); });
    $('palet-arama').addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); paletKapat(); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); paletSecili = Math.min(paletSuzulmus.length - 1, paletSecili + 1); paletIsaretle(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); paletSecili = Math.max(0, paletSecili - 1); paletIsaretle(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); paletCalistir(paletSecili); }
    });

    window.addEventListener('beforeunload', function (ev) {
      if (kirliMi()) { ev.preventDefault(); ev.returnValue = ''; }
    });
  }

  /* service worker (index ile aynı) */
  /* Service worker YEREL geliştirmede kaydedilmez: varlıklar cache-first
     servis edildiği için düzenlenen JS bir sonraki yüklemeye kadar eski
     kalıyor ve bu, geliştirirken saatler yiyen bir yanılgı üretiyor
     (bir kez yaşandı). Canlı sitede normal çalışır. */
  var YEREL_MI = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 && !YEREL_MI) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(function (reg) { reg.update(); }).catch(function () {});
  }

  A.load('./').then(function (v) {
    if (!v) {
      $('banner-alani').innerHTML =
        '<div class="banner dikkat">Müfredat yüklenemedi. Bu sayfa bir sunucudan servis edilmeli: ' +
        '<code>node serve.mjs</code> ya da canlı site. Terminal: <code>atolye durum</code></div>';
      return;
    }
    kur(v);
  }).catch(function (e) {
    $('banner-alani').innerHTML = '<div class="banner dikkat">Defter açılamadı: ' +
      esc(e && e.message ? e.message : e) + '</div>';
  });
})();
