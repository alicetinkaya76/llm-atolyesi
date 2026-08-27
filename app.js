/* LLM Atölyesi — sayfaların tek betiği. SALT OKUNUR.
   Yazan tek şey terminaldir (`atolye`), dolayısıyla burada ne taslak, ne
   senkron, ne geri-al, ne token var. Bu dosyanın tüm işi: iki JSON'u
   okuyup ne durumda olduğunu göstermek.

   İki iş yapar:
   · index.html'de panoyu çizer (sıradaki iş + kendine not + kapı merdiveni)
   · fazlar/*.html'de madde rozetlerinin yanına güncel basamağı yazar,
     böylece haftalık plan sayfası aynı zamanda takip görünümü olur. */
import { hesap, durumOku, basamakAdlari, tavan, esik, fazSayfasi }
  from './atolye.mjs';

const kok = document.querySelector('meta[name="atolye-kok"]')?.content || './';

async function veri() {
  const al = async (ad) => {
    const r = await fetch(kok + ad, { cache: 'no-store' });
    if (!r.ok) throw new Error(ad + ' okunamadı');
    return r.json();
  };
  const [muf, ham] = await Promise.all([al('mufredat.json'), al('durum.json')]);
  return { muf, durum: durumOku(ham, muf) };
}

const el = (t, c, h) => {
  const n = document.createElement(t);
  if (c) n.className = c;
  if (h != null) n.innerHTML = h;
  return n;
};
const esc = (x) => String(x)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sa = (v) => (Math.round(v * 10) / 10).toString();

/* ---------- pano (index.html) ---------- */
function pano(muf, durum) {
  const kap = document.getElementById('pano');
  if (!kap) return;
  const h = hesap(muf, durum);
  kap.innerHTML = '';

  /* 1) Kendine not — bağlam sıcakken yazılmış tek ileriye dönük veri. */
  if (h.sonYarin) {
    const k = el('div', 'not');
    k.appendChild(el('div', 'not-ust', 'kendine not · ' + esc(h.sonYarin.date)));
    k.appendChild(el('div', 'not-metin', esc(h.sonYarin.yarin)));
    kap.appendChild(k);
  }

  /* 2) Sıradaki iş. */
  const kutu = el('div', 'siradaki');
  if (h.sonraki) {
    const it = h.sonraki, ad = basamakAdlari(muf, it), n = h.n(it.id);
    const p = muf.phases.find(x => x.id === it.p);
    kutu.dataset.faz = it.p;          /* rengi stil.css'teki [data-faz] verir */
    kutu.appendChild(el('div', 'ust', 'sıradaki iş · ' + esc(p ? p.tag : it.p)));
    kutu.appendChild(el('div', 'baslik', esc(it.lbl)));
    kutu.appendChild(el('div', 'alt',
      esc(ad[n]) + ' → <b>' + esc(ad[esik(it)]) + '</b>'));
    if (it.hint) kutu.appendChild(el('div', 'alt', esc(it.hint)));
    const a = el('a', 'dugme', 'Haftalık plana git');
    a.href = kok + fazSayfasi(it.p);
    kutu.appendChild(a);
    kutu.appendChild(el('div', 'kod', 'atolye ' + esc(it.id) + ' ' +
      Math.min(n + 1, tavan(it)) + ' -y'));
  } else {
    kutu.appendChild(el('div', 'ust', 'durum'));
    kutu.appendChild(el('div', 'baslik', 'Tüm çekirdek maddeler eşiği geçti.'));
  }
  kap.appendChild(kutu);

  /* 3) Kapı merdiveni. Eşikler müfredattan türetilir; son kapı %100 değildir
     ve bu gizlenmez — kalan pay merdivenin 4. basamağıdır. */
  const esikler = h.esikler();
  const merdiven = el('div', 'merdiven');
  merdiven.appendChild(el('div', 'ust', 'kapı merdiveni · çekirdek %' + h.genel));
  for (const e of esikler) {
    const durumu = h.kapi(e.id);
    const satir = el('a', 'kapi ' + durumu);
    satir.href = kok + fazSayfasi(e.id);
    satir.dataset.faz = e.id;
    satir.appendChild(el('span', 'etiket', esc(e.tag)));
    const c = el('span', 'cubuk');
    const i = el('i');
    i.style.width = Math.min(100, h.fazYuzdesi(e.id)) + '%';
    c.appendChild(i);
    satir.appendChild(c);
    satir.appendChild(el('span', 'esik', '%' + e.pct.toFixed(0)));
    const kalan = h.kapiyaKalan(e.id).length;
    satir.appendChild(el('span', 'not-kucuk',
      durumu === 'gecildi' ? 'geçildi' : kalan ? kalan + ' madde' : ''));
    merdiven.appendChild(satir);
  }
  const son = esikler[esikler.length - 1];
  if (son) {
    merdiven.appendChild(el('p', 'small',
      'Son kapı %' + son.pct.toFixed(0) + '\'te — %100\'de değil. Kalan pay ' +
      'merdivenin 4. basamağıdır ("Türkçe büküm + defter") ve hiçbir kapının ' +
      'şartı değildir.'));
  }
  kap.appendChild(merdiven);

  /* 4) Saatler — hedef yok, seri yok, yalnız sayı. */
  kap.appendChild(el('p', 'sayilar',
    sa(h.buHafta) + ' sa bu hafta · ' + sa(h.toplamSaat) + ' sa toplam · ' +
    h.seans + ' seans' +
    (h.gunOldu == null ? '' :
      ' · son seans ' + (h.gunOldu === 0 ? 'bugün' : h.gunOldu === 1 ? 'dün' : h.gunOldu + ' gün önce'))));
}

/* ---------- faz sayfası: madde rozetlerine basamağı yaz ----------
   Haftalık plan sayfası böylece ayrıca bir takip görünümü olur; ayrı bir
   "defter" sayfası tutmaya gerek kalmaz. Rozetin kendisi tıklanabilir
   değildir — işaretleme terminalde yapılır, title o komutu gösterir. */
function fazSayfasiIsle(muf, durum) {
  const rozetler = document.querySelectorAll('.madde[id]');
  if (!rozetler.length) return;
  const h = hesap(muf, durum);
  for (const r of rozetler) {
    const it = muf.items.find(i => i.id === r.id);
    if (!it) continue;
    const n = h.n(it.id), ad = basamakAdlari(muf, it);
    r.classList.add(n >= esik(it) ? 'tamam' : n > 0 ? 'basladi' : 'bos');
    r.title = ad[n] + ' (' + n + '/' + tavan(it) + ')' +
      (n >= tavan(it) ? ' · tavanda'
        : ' · terminalde: atolye ' + it.id + ' ' + (n + 1));
    r.after(el('span', 'basamak', n + '/' + tavan(it)));
  }
}

veri().then(({ muf, durum }) => {
  pano(muf, durum);
  fazSayfasiIsle(muf, durum);
}).catch((e) => {
  const kap = document.getElementById('pano');
  if (kap) {
    kap.innerHTML = '<p class="uyari">Durum okunamadı (' + esc(e.message) +
      '). Sayfa bir sunucudan açılmalı: <code>atolye site</code>. ' +
      'Terminal her hâlükârda çalışır: <code>atolye</code></p>';
  }
});
