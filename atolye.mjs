/* LLM Atölyesi — ilerleme matematiğinin TEK uygulaması.
   Tarayıcı da node da bunu çalıştırır: tarayıcı Python koşamaz ama terminal
   Node koşar, dolayısıyla ikizi olmayan tek dil JavaScript'tir.

   Burada yalnız KARAR DEĞİŞTİREN hesap var. Eskiden bu dosyada Monte Carlo
   kestirimi, FSRS çürüme modeli ve ısı haritası da vardı; hiçbiri "bugün ne
   açacağım" sorusunun cevabını değiştirmiyordu, çıkarıldılar (git geçmişinde
   duruyorlar). Kalan tek soru şu: bir sonraki fazın kapısını geçtim mi? */

export const KAPI_KURALI =
  'Çekirdek (Ç) maddelerin tümü eşikte VE en az biri tavanda.';

/* ---------- madde semantiği ---------- */
export function tavan(it) {
  return it && it.max != null ? it.max : (it && it.t === 'yap' ? 4 : 2);
}
export function esik(it) {
  return Math.min(it && it.t === 'yap' ? 3 : 2, tavan(it));
}
export function basamakAdlari(muf, it) {
  return ((muf.levels && muf.levels[it.t]) || []).slice(0, tavan(it) + 1);
}
export function fazSayfasi(pid) {
  return pid === 'z' ? 'fazlar/zemin.html' : 'fazlar/faz' + String(pid).slice(1) + '.html';
}

/* ---------- tarih ---------- */
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
export function bugunIso(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
}
function tarihCoz(s) {
  if (typeof s !== 'string' || !TARIH.test(s)) return null;
  const p = s.split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  return isNaN(d.getTime()) ? null : d;
}
function haftaBasi(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));   /* Pazartesi */
  return x;
}

/* ---------- durum ----------
   Şema: { items: { "z1": {n, t} }, journal: [ {date, hours, ...} ] }
   Tolerant okuyucu: bilinmeyen madde, bozuk tarih, negatif saat sessizce
   ayıklanır — elle düzenlenen bir JSON dosyası bunu er ya da geç görür. */
export function bosDurum() {
  return { items: {}, journal: [] };
}

export function durumOku(ham, muf) {
  const byId = new Map((muf.items || []).map(i => [i.id, i]));
  const out = bosDurum();
  if (!ham || typeof ham !== 'object') return out;

  for (const [k, v] of Object.entries(ham.items || {})) {
    const it = byId.get(k);
    if (!it) continue;
    const n = parseInt(v && typeof v === 'object' ? v.n : v, 10);
    if (!(n > 0)) continue;
    const t = (v && typeof v === 'object' && TARIH.test(String(v.t))) ? v.t : null;
    out.items[k] = { n: Math.min(n, tavan(it)), t };
  }

  for (const e of (Array.isArray(ham.journal) ? ham.journal : [])) {
    if (!e || !TARIH.test(String(e.date))) continue;
    const h = parseFloat(e.hours);
    out.journal.push({
      date: e.date,
      hours: h > 0 && isFinite(h) ? h : 0,
      yaptim: String(e.yaptim || ''),
      ogrendim: String(e.ogrendim || ''),
      anlamadim: String(e.anlamadim || ''),
      yarin: String(e.yarin || '')
    });
  }
  out.journal.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/* ---------- tek yazıcı ---------- */
export function basamakAta(durum, it, n, gun) {
  n = Math.max(0, Math.min(n, tavan(it)));
  const onceki = durum.items[it.id] ? durum.items[it.id].n : 0;
  if (n === onceki) return false;
  if (n === 0) delete durum.items[it.id];
  else durum.items[it.id] = { n, t: gun || bugunIso() };
  return true;
}

/* ---------- hesaplar ---------- */
export function hesap(muf, durum, bugun) {
  const items = muf.items || [];
  const phases = muf.phases || [];
  const cekirdek = items.filter(i => i.core);
  const simdi = bugun ? tarihCoz(bugun) : new Date();

  const n = id => (durum.items[id] ? durum.items[id].n : 0);
  const fazMaddeleri = pid => items.filter(i => i.p === pid);

  /* Yüzdeler her yerde AYNI biçimde yuvarlanır: Math.round.
     (Tek uygulama olduğu için artık iki dilin yuvarlama farkı diye bir
     hata sınıfı yok — eskiden Python'un bankacı yuvarlaması ayrışıyordu.) */
  const yuzde = (küme) => {
    if (!küme.length) return 0;
    let s = 0;
    for (const i of küme) s += Math.min(n(i.id), tavan(i)) / tavan(i);
    return Math.round(100 * s / küme.length);
  };

  const genel = yuzde(cekirdek);

  function kapi(pid) {
    const core = fazMaddeleri(pid).filter(i => i.core);
    if (!core.length) return 'yok';
    const hepsi = core.every(i => n(i.id) >= esik(i));
    const biri = core.some(i => n(i.id) >= tavan(i));
    if (hepsi && biri) return 'gecildi';
    return fazMaddeleri(pid).some(i => n(i.id) > 0) ? 'suruyor' : 'baslamadi';
  }

  /* Kapının SAĞLANABİLECEĞİ en düşük çekirdek yüzdesi. Fazlar sırayla
     tamamlandığı varsayımıyla kümülatif; elle yazılmaz, müfredattan çıkar.
     "En az biri tavanda" için EN UCUZ maddeyi tavana çıkarmak yeter. */
  function esikler() {
    if (!cekirdek.length) return [];
    let toplam = 0;
    const out = [];
    for (const p of phases) {
      const fc = cekirdek.filter(i => i.p === p.id);
      if (!fc.length) continue;
      let pay = 0, enUcuz = Infinity;
      for (const i of fc) {
        pay += esik(i) / tavan(i);
        enUcuz = Math.min(enUcuz, 1 - esik(i) / tavan(i));
      }
      toplam += pay + (isFinite(enUcuz) ? enUcuz : 0);
      out.push({ id: p.id, tag: p.tag, pct: 100 * toplam / cekirdek.length });
    }
    return out;
  }

  /* Sıradaki iş: müfredat sırasındaki ilk eşik-altı çekirdek madde. */
  const sonraki = items.find(i => i.core && n(i.id) < esik(i)) || null;

  /* Bir önceki seansın "yarın ilk iş" notu — sistemdeki tek gerçekten
     ileriye dönük veri; kullanıcı bağlam sıcakken kendi yazmış. */
  let sonYarin = null;
  for (const e of durum.journal) if (e.yarin) sonYarin = e;

  /* Saatler: bu hafta ve son N hafta. Hedef yok, seri yok — yalnız sayı. */
  const gunler = new Map();
  let toplamSaat = 0;
  for (const e of durum.journal) {
    toplamSaat += e.hours;
    gunler.set(e.date, (gunler.get(e.date) || 0) + e.hours);
  }
  function haftaSaatleri(kac) {
    const bas = haftaBasi(simdi);
    const out = [];
    for (let i = kac - 1; i >= 0; i--) {
      const h = new Date(bas.getFullYear(), bas.getMonth(), bas.getDate() - 7 * i);
      const son = new Date(h.getFullYear(), h.getMonth(), h.getDate() + 6);
      let s = 0;
      for (const [g, v] of gunler) {
        const d = tarihCoz(g);
        if (d && d >= h && d <= son) s += v;
      }
      out.push({ hafta: bugunIso(h), saat: s });
    }
    return out;
  }
  const buHafta = haftaSaatleri(1)[0].saat;

  const sonTarih = durum.journal.length ? durum.journal[durum.journal.length - 1].date : null;
  let gunOldu = null;
  if (sonTarih) {
    const d = tarihCoz(sonTarih);
    if (d) gunOldu = Math.round(
      (new Date(simdi.getFullYear(), simdi.getMonth(), simdi.getDate()) - d) / 86400000);
  }

  return {
    n, fazMaddeleri, kapi, esikler, haftaSaatleri,
    genel,
    fazYuzdesi: pid => yuzde(fazMaddeleri(pid)),
    kapiyaKalan: pid => fazMaddeleri(pid).filter(i => i.core && n(i.id) < esik(i)),
    sonraki, sonYarin,
    buHafta, toplamSaat,
    seans: durum.journal.length,
    sonTarih, gunOldu
  };
}
