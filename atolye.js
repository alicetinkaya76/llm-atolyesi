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
    var siraliItems = {};
    Object.keys(st.items || {}).sort().forEach(function (k) { siraliItems[k] = st.items[k]; });
    var siraliJournal = (st.journal || []).slice().sort(function (a, b) {
      return a.id === b.id ? 0 : (a.id < b.id ? -1 : 1);
    });
    return JSON.stringify({ items: siraliItems, journal: siraliJournal });
  }

  /* ---------- durum doğrulama ---------- */
  function defaultState() { return { v: 1, items: {}, journal: [], updated: null }; }

  function normalizeState(s, muf) {
    if (!s || typeof s !== 'object') return null;
    var byId = {};
    (muf && muf.items ? muf.items : []).forEach(function (i) { byId[i.id] = i; });
    var out = defaultState();
    out.updated = (typeof s.updated === 'string') ? s.updated : null;
    if (s.items && typeof s.items === 'object') {
      Object.keys(s.items).forEach(function (k) {
        var it = byId[k]; if (!it) return;
        var v = parseInt(s.items[k], 10);
        if (isNaN(v) || v <= 0) return;
        out.items[k] = Math.min(v, itemMax(it));
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

  /* ---------- istatistik ---------- */
  function makeStats(muf, state) {
    var items = (muf && muf.items) || [];
    var phases = (muf && muf.phases) || [];
    var lvlMap = (state && state.items) || {};
    var journal = (state && state.journal) || [];

    function lvl(id) { var v = lvlMap[id]; return (v > 0) ? v : 0; }
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
    var thisWeekKey = isoWeekKey(new Date());
    var hoursThisWeek = byWeek[thisWeekKey] || 0;

    /* son N haftanın serisi (eskiden yeniye) */
    function weekSeries(count) {
      var out = [], base = weekStart(new Date());
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
      var base = weekStart(new Date()), n = 0;
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
      var today = new Date();
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

    var dates = journal.map(function (e) { return e.date; }).filter(Boolean).sort();
    var lastDate = dates.length ? dates[dates.length - 1] : null;
    var daysSince = null;
    if (lastDate) {
      var ld = parseDate(lastDate);
      if (ld) daysSince = dayDiff(ld, new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
    }

    return {
      lvl: lvl,
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
