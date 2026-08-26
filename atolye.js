/* LLM Atölyesi — ortak hesap çekirdeği.
   Klasik script (ES module değil): file:// ile de çalışsın diye.
   Tek küresel: window.Atolye
   Kural: müfredat semantiği ve ilerleme matematiği YALNIZCA burada tanımlanır;
   sayfalar bunu kullanır, kendi kopyasını tutmaz. (defter.py aynı mantığın
   Python ikizini taşır — biri değişirse diğeri de değişmeli.) */
(function (global) {
  'use strict';

  var TARIH = /^\d{4}-\d{2}-\d{2}$/;
  var HAFTA_HEDEF = 9; /* saat; harita "8–10" diyor, orta nokta */

  /* ---------- madde semantiği ---------- */
  function itemMax(it) { return it && it.max != null ? it.max : (it && it.t === 'yap' ? 4 : 2); }
  function passLevel(it) { return Math.min(it && it.t === 'yap' ? 3 : 2, itemMax(it)); }
  function levelNames(muf, it) {
    var ad = (muf && muf.levels && muf.levels[it.t]) || [];
    return ad.slice(0, itemMax(it) + 1);
  }

  /* ---------- tarih ---------- */
  function todayLocal(now) {
    var d = now || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseDate(s) {
    if (typeof s !== 'string' || !TARIH.test(s)) return null;
    var p = s.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  function weekStart(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); /* Pazartesi */
    return x;
  }
  function isoWeekKey(s) {
    var d = typeof s === 'string' ? parseDate(s) : s;
    if (!d) return '';
    return todayLocal(weekStart(d));
  }
  function dayDiff(a, b) { return Math.round((b - a) / 86400000); }

  /* Zaman damgalarını ASLA metin olarak karşılaştırma: defter.py yerel
     ofsetli yazıyor ("…T23:00:00+03:00"), tarayıcı UTC ("…T20:00:00.000Z").
     Metin karşılaştırması UTC+3'te tarayıcı kaydını 3 saate kadar yanlışlıkla
     "eski" gösterir ve düzenlemeler sessizce kaybolur. */
  function zamanMs(x) {
    if (!x) return 0;
    var t = Date.parse(x);
    return isNaN(t) ? 0 : t;
  }
  function dahaYeni(a, b) { return zamanMs(a) > zamanMs(b); }

  /* Kirlilik karşılaştırması: yalnızca içerik (items + journal).
     `updated` her yazımda değiştiği için ona bakmak, kullanıcı değeri geri
     alsa bile "kaydedilmedi" uyarısını sonsuza kadar açık bırakır. */
  function icerikImzasi(st) {
    if (!st) return '';
    /* basamaklar sabit sıralı ikiliye indirgenir: nesne anahtar sırası
       imzayı değiştirmesin */
    var siraliItems = [];
    Object.keys(st.items || {}).sort().forEach(function (k) {
      var b = st.items[k];
      siraliItems.push([k, (b && typeof b === 'object') ? b.n : b,
                           (b && typeof b === 'object') ? (b.t || null) : null]);
    });
    var siraliJournal = (st.journal || []).slice().sort(function (a, b) {
      return a.id === b.id ? 0 : (a.id < b.id ? -1 : 1);
    });
    var siraliOlay = (st.olaylar || []).slice().map(function (o) { return [o.d, o.id, o.n]; });
    return JSON.stringify({ items: siraliItems, journal: siraliJournal, olaylar: siraliOlay });
  }

  /* ---------- durum doğrulama ----------
     ŞEMA v2. Basamaklar artık zaman taşır:
        items: { "z1": { "n": 3, "t": "2026-08-27" } }
     v1 biçimi ( items: { "z1": 3 } ) OKUNMAYA devam eder ve okurken v2'ye
     göçürülür; tarihi bilinmeyen eski kayıtlara t=null verilir (çürüme
     hesabı "bilinmiyor" der, uydurmaz).
     Ayrıca `olaylar`: yalnızca eklenen basamak günlüğü — geçmiş ilerleme
     eğrisi ve hız buradan çıkar. items o günlüğün izdüşümüdür; ikisi
     çelişirse items kazanır (tek yazıcı ikisini birlikte yazar). */
  function defaultState() {
    return { v: 2, items: {}, olaylar: [], journal: [], updated: null };
  }

  /* tek basamak kaydını iki biçimden de kabul et */
  function basamakOku(ham, it) {
    var n = null, t = null;
    if (ham && typeof ham === 'object') {
      n = parseInt(ham.n, 10);
      t = (typeof ham.t === 'string' && TARIH.test(ham.t)) ? ham.t : null;
    } else {
      n = parseInt(ham, 10);
    }
    if (isNaN(n) || n <= 0) return null;
    return { n: Math.min(n, itemMax(it)), t: t };
  }

  function normalizeState(s, muf) {
    if (!s || typeof s !== 'object') return null;
    var byId = {};
    (muf && muf.items ? muf.items : []).forEach(function (i) { byId[i.id] = i; });
    var out = defaultState();
    out.updated = (typeof s.updated === 'string') ? s.updated : null;
    if (s.items && typeof s.items === 'object') {
      Object.keys(s.items).forEach(function (k) {
        var it = byId[k]; if (!it) return;
        var b = basamakOku(s.items[k], it);
        if (b) out.items[k] = b;
      });
    }
    if (Array.isArray(s.olaylar)) {
      s.olaylar.forEach(function (o) {
        if (!o || typeof o !== 'object') return;
        var it = byId[o.id]; if (!it) return;
        if (!TARIH.test(String(o.d))) return;
        var n = parseInt(o.n, 10);
        if (isNaN(n) || n < 0) return;
        out.olaylar.push({ d: o.d, id: o.id, n: Math.min(n, itemMax(it)) });
      });
      out.olaylar.sort(function (a, b) {
        return a.d === b.d ? 0 : (a.d < b.d ? -1 : 1);
      });
    }
    if (Array.isArray(s.journal)) {
      s.journal.forEach(function (e) {
        if (!e || typeof e !== 'object' || !TARIH.test(String(e.date))) return;
        var h = parseFloat(e.hours);
        out.journal.push({
          id: String(e.id || 'j' + Math.random().toString(36).slice(2)),
          date: e.date,
          hours: (h > 0 && isFinite(h)) ? h : 0,
          phase: typeof e.phase === 'string' ? e.phase : 'z',
          yaptim: String(e.yaptim || ''), ogrendim: String(e.ogrendim || ''),
          anlamadim: String(e.anlamadim || ''), yarin: String(e.yarin || '')
        });
      });
    }
    return out;
  }

  /* ---------- yazma ----------
     Tek giriş noktası: basamak ataması hem izdüşümü (items) hem günlüğü
     (olaylar) birlikte yazar. İkisi ayrı yerlerden yazılırsa kaçınılmaz
     olarak ayrışırlar. defter.py'daki ikizi aynı davranmak zorundadır. */
  function basamakAta(state, it, n, bugun) {
    var gun = bugun || todayLocal();
    var tavan = itemMax(it);
    n = Math.max(0, Math.min(n, tavan));
    var oncekiN = (function () {
      var b = state.items[it.id];
      if (!b) return 0;
      return (typeof b === 'object') ? (b.n || 0) : (b || 0);
    })();
    if (n === oncekiN) return false;
    if (n === 0) delete state.items[it.id];
    else state.items[it.id] = { n: n, t: gun };
    if (!Array.isArray(state.olaylar)) state.olaylar = [];
    state.olaylar.push({ d: gun, id: it.id, n: n });
    return true;
  }

  /* Aynı basamağı yeniden onayla ("tazeledim"): sayı değişmez, saat sıfırlanır.
     Çürüme modelinin tek anlamlı girdisi budur. */
  function tazele(state, it, bugun) {
    var b = state.items[it.id];
    var n = b ? ((typeof b === 'object') ? b.n : b) : 0;
    if (!n) return false;
    var gun = bugun || todayLocal();
    state.items[it.id] = { n: n, t: gun };
    if (!Array.isArray(state.olaylar)) state.olaylar = [];
    state.olaylar.push({ d: gun, id: it.id, n: n });
    return true;
  }

  /* ---------- istatistik ----------
     `bugunIso` isteğe bağlı: verilirse "şimdi" o güne sabitlenir. Hafta,
     seri, tazelik ve kestirim hesapları gerçek saate bağlı olduğu için
     testlerin zamanla kaymaması ancak böyle sağlanabilir. */
  function makeStats(muf, state, bugunIso) {
    var SIMDI = (bugunIso && TARIH.test(bugunIso)) ? parseDate(bugunIso) : new Date();
    var items = (muf && muf.items) || [];
    var phases = (muf && muf.phases) || [];
    var lvlMap = (state && state.items) || {};
    var journal = (state && state.journal) || [];

    function lvl(id) {
      var b = lvlMap[id];
      if (!b) return 0;
      var n = (typeof b === 'object') ? b.n : b;   /* v1 toleransı */
      return (n > 0) ? n : 0;
    }
    /* basamağın kazanıldığı gün (v1 verisinde bilinmiyor → null) */
    function lvlDate(id) {
      var b = lvlMap[id];
      return (b && typeof b === 'object' && b.t) ? b.t : null;
    }
    function phaseItems(pid) { return items.filter(function (i) { return i.p === pid; }); }

    function phasePct(pid) {
      var its = phaseItems(pid);
      if (!its.length) return 0;
      var s = 0;
      its.forEach(function (i) { s += Math.min(lvl(i.id), itemMax(i)) / itemMax(i); });
      return Math.round(100 * s / its.length);
    }

    function gate(pid) {
      var core = phaseItems(pid).filter(function (i) { return i.core; });
      if (!core.length) return 'off';
      var all = core.every(function (i) { return lvl(i.id) >= passLevel(i); });
      var one = core.some(function (i) { return lvl(i.id) >= itemMax(i); });
      if (all && one) return 'on';
      return phaseItems(pid).some(function (i) { return lvl(i.id) > 0; }) ? 'run' : 'off';
    }

    /* kapıya kalan çekirdek madde sayısı */
    function gateRemaining(pid) {
      return phaseItems(pid).filter(function (i) {
        return i.core && lvl(i.id) < passLevel(i);
      }).length;
    }

    var core = items.filter(function (i) { return i.core; });
    var overallPct = 0;
    if (core.length) {
      var s = 0;
      core.forEach(function (i) { s += Math.min(lvl(i.id), itemMax(i)) / itemMax(i); });
      overallPct = Math.round(100 * s / core.length);
    }

    /* sıradaki çekirdek madde: müfredat sırasına göre ilk eşik-altı */
    var nextItem = null;
    for (var n = 0; n < items.length; n++) {
      if (items[n].core && lvl(items[n].id) < passLevel(items[n])) { nextItem = items[n]; break; }
    }

    /* saatler */
    var totalHours = 0, byDay = {}, byWeek = {}, byWeekday = [0, 0, 0, 0, 0, 0, 0];
    journal.forEach(function (e) {
      var h = +e.hours || 0;
      totalHours += h;
      byDay[e.date] = (byDay[e.date] || 0) + h;
      var wk = isoWeekKey(e.date);
      if (wk) byWeek[wk] = (byWeek[wk] || 0) + h;
      var d = parseDate(e.date);
      if (d) byWeekday[(d.getDay() + 6) % 7] += h;
    });
    var thisWeekKey = isoWeekKey(SIMDI);
    var hoursThisWeek = byWeek[thisWeekKey] || 0;

    /* son N haftanın serisi (eskiden yeniye) */
    function weekSeries(count) {
      var out = [], base = weekStart(SIMDI);
      for (var i = count - 1; i >= 0; i--) {
        var w = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 7 * i);
        var k = todayLocal(w);
        out.push({ week: k, hours: byWeek[k] || 0 });
      }
      return out;
    }

    /* haftalık seri: hedefi tutturulan ARDIŞIK hafta sayısı.
       Günlük seri değil — dinlenme gününü cezalandırmasın diye. */
    function weekStreak() {
      var base = weekStart(SIMDI), n = 0;
      /* bu hafta henüz sürüyor: hedefi tutmuşsa sayılır, tutmamışsa seriyi bozmaz */
      if ((byWeek[todayLocal(base)] || 0) >= HAFTA_HEDEF) n++;
      for (var i = 1; i < 260; i++) {
        var w = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 7 * i);
        if ((byWeek[todayLocal(w)] || 0) >= HAFTA_HEDEF) n++; else break;
      }
      return n;
    }

    /* ısı haritası: son `weeks` haftanın günleri, sütun = hafta */
    function heatmap(weeks) {
      var today = SIMDI;
      var end = weekStart(today);
      var cols = [];
      for (var w = weeks - 1; w >= 0; w--) {
        var col = [];
        for (var dd = 0; dd < 7; dd++) {
          var day = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 7 * w + dd);
          var key = todayLocal(day);
          col.push({
            date: key,
            hours: byDay[key] || 0,
            future: day > today
          });
        }
        cols.push(col);
      }
      return cols;
    }

    /* Kullanıcının en son, bağlam sıcakken yazdığı "yarın ilk iş" notu.
       Sistemdeki en değerli sıradaki-adım verisi; günlük kartlarının içinde
       gömülü kalmasın diye ayrıca yüzeye çıkarılır. */
    var lastYarin = null;
    journal.slice().sort(function (a, b) {
      if (a.date === b.date) return a.id < b.id ? -1 : 1;
      return a.date < b.date ? -1 : 1;
    }).forEach(function (e) {
      if (e.yarin && e.yarin.trim()) lastYarin = { metin: e.yarin.trim(), date: e.date };
    });

    /* ---- geçmiş: olay günlüğünü yeniden oynat ----
       Çekirdek yüzdesinin zaman içindeki seyri. Kaynak `olaylar`; günlük
       yoksa geçmiş de YOKTUR — düz bir çizgi uydurmak yerine null döner. */
    var olaylar = (state && state.olaylar) || [];

    function ilerlemeSerisi(haftaSayisi) {
      if (!olaylar.length) return null;
      var coreItems = items.filter(function (i) { return i.core; });
      if (!coreItems.length) return null;
      var coreSet = {};
      coreItems.forEach(function (i) { coreSet[i.id] = i; });

      var base = weekStart(SIMDI);
      var sinirlar = [];
      for (var i = haftaSayisi - 1; i >= 0; i--) {
        sinirlar.push(new Date(base.getFullYear(), base.getMonth(), base.getDate() - 7 * i + 6));
      }

      var seviye = {}, oi = 0, cikti = [];
      sinirlar.forEach(function (son) {
        var sonKey = todayLocal(son);
        while (oi < olaylar.length && olaylar[oi].d <= sonKey) {
          var o = olaylar[oi];
          if (o.n > 0) seviye[o.id] = o.n; else delete seviye[o.id];
          oi++;
        }
        var s = 0;
        coreItems.forEach(function (it) {
          s += Math.min(seviye[it.id] || 0, itemMax(it)) / itemMax(it);
        });
        cikti.push({
          hafta: todayLocal(weekStart(son)),
          son: sonKey,
          pct: Math.round(100 * s / coreItems.length)
        });
      });
      return cikti;
    }

    /* Haftalık çekirdek-yüzde kazancı: kestirimin ham girdisi.
       Yalnızca GEÇMİŞ (tamamlanmış) haftalar sayılır; içinde bulunulan
       yarım hafta hızı olduğundan düşük gösterir. */
    function haftalikKazanc(haftaSayisi) {
      var seri = ilerlemeSerisi((haftaSayisi || 12) + 1);
      if (!seri || seri.length < 2) return null;
      var out = [];
      for (var i = 1; i < seri.length - 1; i++) {   /* son eleman = bu hafta, atlanır */
        out.push(Math.max(0, seri[i].pct - seri[i - 1].pct));
      }
      return out.length ? out : null;
    }

    var dates = journal.map(function (e) { return e.date; }).filter(Boolean).sort();
    var lastDate = dates.length ? dates[dates.length - 1] : null;
    var daysSince = null;
    if (lastDate) {
      var ld = parseDate(lastDate);
      if (ld) daysSince = dayDiff(ld, new Date(SIMDI.getFullYear(), SIMDI.getMonth(), SIMDI.getDate()));
    }

    return {
      lvl: lvl,
      lvlDate: lvlDate,
      phaseItems: phaseItems,
      phasePct: phasePct,
      gate: gate,
      gateRemaining: gateRemaining,
      overallPct: overallPct,
      nextItem: nextItem,
      totalHours: totalHours,
      hoursThisWeek: hoursThisWeek,
      weekTarget: HAFTA_HEDEF,
      weekSeries: weekSeries,
      weekStreak: weekStreak,
      heatmap: heatmap,
      byWeekday: byWeekday,
      ilerlemeSerisi: ilerlemeSerisi,
      haftalikKazanc: haftalikKazanc,
      byDay: byDay,
      sessions: journal.length,
      lastDate: lastDate,
      lastYarin: lastYarin,
      daysSinceLast: daysSince,
      phases: phases,
      items: items
    };
  }

  /* ---------- veri yükleme ---------- */
  /* Sıra: (1) sunucudan taze durum.json, (2) sayfaya gömülü anlık görüntü,
     (3) boş. Yerel taslak (localStorage) çağıran tarafından katmanlanır. */
  /* cache:'no-store' HTTP önbelleğini iki yönde de atlar (GitHub Pages
     max-age=600 gönderiyor). URL'e ?t= EKLEMİYORUZ: bayat veriyi zaten
     no-store çözüyor, ama değişen sorgu dizesi service worker'ın önbellek
     anahtarını her seferinde değiştirip çevrimdışı yedeği işe yaramaz kılardı. */
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return null; });
  }

  function embedded(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  function load(base) {
    base = base || '';
    return Promise.all([
      fetchJSON(base + 'mufredat.json'),
      fetchJSON(base + 'durum.json')
    ]).then(function (r) {
      var muf = r[0] || embedded('mufredat');
      var ham = r[1] || embedded('state');
      if (!muf) return null;
      var st = normalizeState(ham, muf) || defaultState();
      return { muf: muf, state: st, fromNetwork: !!r[1] };
    });
  }

  /* ---------- yardımcılar ---------- */
  function esc(x) {
    return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function phaseById(muf, pid) {
    var f = (muf.phases || []).filter(function (p) { return p.id === pid; });
    return f[0] || null;
  }
  /* faz kimliği → sayfa adı. Dosyalar faz0.html…faz5.html; kimlikler f0…f5.
     ('fazlar/' + pid) yazmak fazlar/f0.html üretir ve 404 olur. */
  function phasePage(pid) {
    return pid === 'z' ? 'fazlar/zemin.html' : 'fazlar/faz' + String(pid).slice(1) + '.html';
  }

  /* İlerleme çubuğu rengi: rozet rengiyle aynı değil.
     'var(--f3)' → 'var(--f3-bar)' — gerekçe stil.css'te. */
  function barColor(p) {
    var c = (p && p.color) || 'var(--accent)';
    return /^var\(--f[z0-5]\)$/.test(c) ? c.replace(/\)$/, '-bar)') : c;
  }
  function fmtHours(h) {
    var v = Math.round((+h || 0) * 10) / 10;
    return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1));
  }

  global.Atolye = {
    itemMax: itemMax,
    passLevel: passLevel,
    levelNames: levelNames,
    normalizeState: normalizeState,
    basamakAta: basamakAta,
    tazele: tazele,
    defaultState: defaultState,
    stats: makeStats,
    load: load,
    fetchJSON: fetchJSON,
    embedded: embedded,
    todayLocal: todayLocal,
    isoWeekKey: isoWeekKey,
    parseDate: parseDate,
    weekStart: weekStart,
    zamanMs: zamanMs,
    dahaYeni: dahaYeni,
    icerikImzasi: icerikImzasi,
    esc: esc,
    phaseById: phaseById,
    phasePage: phasePage,
    barColor: barColor,
    fmtHours: fmtHours,
    WEEK_TARGET: HAFTA_HEDEF
  };
})(window);
