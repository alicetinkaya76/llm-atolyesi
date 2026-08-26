#!/bin/sh
# Çapraz test: defter.py (Python) ile atolye.js (JS) aynı ilerleme
# matematiğini uygulamak zorunda. Ayrışırlarsa site ile terminal farklı
# şeyler söyler ve hangisinin doğru olduğu belli olmaz.
#
# "Bugün" SABİTLENİR (BUGUN değişkeni): hafta/seri/kestirim hesapları gerçek
# saate bağlı olduğundan, sabitlemeden test zamanla kendiliğinden kayar.
#
# Yakaladığı gerçek hatalar (gerileme testi olarak duruyorlar):
#  · Python round() bankacı yuvarlaması yapar (12.5→12), JS Math.round yukarı
#    (→13). Yüzdeler bu yüzden ayrışıyordu; defter.py artık yuvarla() kullanır.
#  · kapiEsikleri "en az biri tavanda" şartı için EN UCUZ maddeyi almalı;
#    max kullanmak son kapıyı %84.2 yerine %88.3 gösteriyordu.
#  · Kestirim hedefi %100 değil SON KAPI. Test iki tarafa da elle
#    '100 - overallPct' verdiği için üretimdeki ayrışmayı göremiyordu.
#  · SINIR'a çarpan yüzdelik (p85==520) tarih basıyordu; artık null.
#  · Gelecek tarihli/sırasız olay: son kova kalan her şeyi yutar, böylece
#    serinin son değeri her zaman overallPct'e eşittir.
set -eu
KOK="$(cd "$(dirname "$0")" && pwd)"
cd "$KOK"

BUGUN="2026-08-27"

ORNEK="$(mktemp -t atolye-test)"
trap 'rm -f "$ORNEK" "$ORNEK.py" "$ORNEK.js"' EXIT

# v1 (eski, zamansız) ve v2 (zamanlı) kayıtlar KARIŞIK: göç yolu da sınanır.
cat > "$ORNEK" <<'EOF'
{"v":2,
 "items":{"z1":{"n":3,"t":"2026-07-06"},
          "z2":{"n":2,"t":"2026-07-15"},
          "z3":1,
          "z4":{"n":2,"t":"2026-08-01"},
          "f0a":{"n":4,"t":"2026-08-03"},
          "f0b":{"n":3,"t":"2026-08-18"},
          "f0c":3, "f0d":4, "f0e":3,
          "f1a":{"n":2,"t":"2026-08-24"},
          "f1d":1, "f2c":3,
          "gecersizMadde":7,
          "z1x":{"n":"abc"}},
 "olaylar":[{"d":"2026-07-06","id":"z1","n":3},
            {"d":"2026-07-15","id":"z2","n":2},
            {"d":"2026-08-01","id":"z4","n":2},
            {"d":"2026-08-03","id":"f0a","n":4},
            {"d":"2026-08-18","id":"f0b","n":3},
            {"d":"2026-08-24","id":"f1a","n":2},
            {"d":"BOZUK","id":"f0c","n":3},
            {"d":"2026-08-25","id":"yokBoyleMadde","n":2},
            {"d":"2027-03-01","id":"f2a","n":3},
            {"d":"2026-07-20","id":"f0e","n":3}],
 "journal":[{"id":"a","date":"2026-08-10","hours":2,"phase":"z"},
            {"id":"b","date":"2026-08-24","hours":3,"phase":"z"},
            {"id":"c","date":"2026-08-25","hours":4,"phase":"f0"},
            {"id":"d","date":"2026-08-26","hours":2.5,"phase":"f0"},
            {"id":"bozuk","date":"OLMAZ","hours":99},
            {"id":"eksi","date":"2026-08-26","hours":-5}],
 "updated":"2026-08-26T10:00:00+03:00"}
EOF

python3 - "$ORNEK" "$BUGUN" > "$ORNEK.py" <<'EOF'
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location('defter', 'defter.py')
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
m = mod.mufredat_yukle()
d = mod.normallestir(json.load(open(sys.argv[1])), m)
bugun = sys.argv[2]
print('cekirdek', mod.genel_yuzde(m, d))
for p in m['phases']:
    print(p['id'], mod.faz_yuzdesi(m, d, p['id']), mod.kapi_durumu(m, d, p['id']))
print('madde', len(d['items']), 'olay', len(d['olaylar']), 'seans', len(d['journal']))
nx = mod.sonraki_madde(m, d)
print('sonraki', nx['id'] if nx else '-')
print('z1tarih', mod.sev_tarih(d, 'z1') or '-', 'z3tarih', mod.sev_tarih(d, 'z3') or '-')
seri = mod.ilerleme_serisi(m, d, 6, bugun) or []
print('seri', ' '.join(f"{x['son']}:{x['pct']}" for x in seri))
print('kazanc', ' '.join(str(v) for v in (mod.haftalik_kazanc(m, d, 5, bugun) or [])))
tz = mod.tazelik(m, d, 'z1', bugun)
print('tazelik-z1', tz['durum'], tz['gun'], round(tz['R'], 4))
print('tazelik-z3', str((mod.tazelik(m, d, 'z3', bugun) or {}).get('bilinmiyor')).lower())
print('kuyruk', ' '.join(i['id'] for i, _ in mod.tazeleme_kuyrugu(m, d, 3, bugun)))
kk = mod.kestirim(m, d, 100 - mod.genel_yuzde(m, d), bugun)
print('kestirim', str(kk.get('yeterli')).lower(), kk.get('gozlem'), kk.get('p50', '-'), kk.get('p85', '-'), kk.get('p95', '-'))
print('kapiya-f1', round(mod.kapiya_kalan_yuzde(m, d, 'f1'), 4))
kg = mod.kapi_gecmisi(m, d) or {}
print('kapilar', ' '.join(f"{k}:{v['tarih']}:{v['pct']}" for k, v in sorted(kg.items())))
print('esikler', ' '.join(f"{e['id']}:{e['pct']:.2f}" for e in mod.kapi_esikleri(m)))
# ÜRETİMDEKİ çağrının aynısı: hedef son kapı, %100 değil
hedef = max(0, mod.son_kapi_yuzdesi(m) - mod.genel_yuzde(m, d))
kk2 = mod.kestirim(m, d, hedef, bugun)
print('kestirim-gercek', kk2.get('p50', '-'), kk2.get('p85', '-'),
      kk2.get('tarih85') or '-')
seri2 = mod.ilerleme_serisi(m, d, 8, bugun) or []
print('degismez-son', seri2[-1]['pct'] if seri2 else '-', mod.genel_yuzde(m, d))
print('gunluksuz', mod.gunluksuz_sayisi(d))
EOF

node - "$ORNEK" "$BUGUN" > "$ORNEK.js" <<'EOF'
global.window = {}; global.document = { getElementById: () => null };
global.fetch = () => Promise.reject(new Error('offline'));
require('./atolye.js');
const A = global.window.Atolye, fs = require('fs');
const muf = JSON.parse(fs.readFileSync('mufredat.json', 'utf8'));
const st = A.normalizeState(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), muf);
const bugun = process.argv[3];
const s = A.stats(muf, st, bugun);
const ad = { on: 'GEÇİLDİ', run: 'sürüyor', off: 'başlamadı' };
console.log('cekirdek', s.overallPct);
muf.phases.forEach(p => console.log(p.id, s.phasePct(p.id), ad[s.gate(p.id)]));
console.log('madde', Object.keys(st.items).length, 'olay', st.olaylar.length, 'seans', s.sessions);
console.log('sonraki', s.nextItem ? s.nextItem.id : '-');
console.log('z1tarih', s.lvlDate('z1') || '-', 'z3tarih', s.lvlDate('z3') || '-');
const seri = s.ilerlemeSerisi(6) || [];
console.log('seri', seri.map(x => x.son + ':' + x.pct).join(' '));
console.log('kazanc', (s.haftalikKazanc(5) || []).join(' '));
const tz = s.tazelik('z1');
console.log('tazelik-z1', tz.durum, tz.gun, tz.R.toFixed(4));
console.log('tazelik-z3', (s.tazelik('z3') || {}).bilinmiyor);
console.log('kuyruk', s.tazelemeKuyrugu(3).map(x => x.it.id).join(' '));
const kk = s.kestirim(100 - s.overallPct);
console.log('kestirim', kk.yeterli, kk.gozlem, kk.p50 !== undefined ? kk.p50 : '-',
            kk.p85 !== undefined ? kk.p85 : '-', kk.p95 !== undefined ? kk.p95 : '-');
console.log('kapiya-f1', s.kapiyaKalanYuzde('f1').toFixed(4));
const kg = s.kapiGecmisi() || {};
console.log('kapilar', Object.keys(kg).sort().map(k => k + ':' + kg[k].tarih + ':' + kg[k].pct).join(' '));
console.log('esikler', s.kapiEsikleri().map(e => e.id + ':' + e.pct.toFixed(2)).join(' '));
const sonKapi = (s.kapiEsikleri().slice(-1)[0] || { pct: 100 }).pct;
const kk2 = s.kestirim(Math.max(0, sonKapi - s.overallPct));
console.log('kestirim-gercek', kk2.p50 !== undefined ? kk2.p50 : '-',
            kk2.p85 !== undefined ? kk2.p85 : '-', kk2.tarih85 || '-');
const seri2 = s.ilerlemeSerisi(8) || [];
console.log('degismez-son', seri2.length ? seri2[seri2.length - 1].pct : '-', s.overallPct);
console.log('gunluksuz', s.gunluksuz);
EOF

if diff -u "$ORNEK.py" "$ORNEK.js" > /dev/null; then
  echo "✓ Python ve JS aynı sonucu veriyor (bugün=$BUGUN):"
  sed 's/^/    /' "$ORNEK.py"
else
  echo "✗ AYRIŞMA VAR (- Python, + JS):" >&2
  diff -u "$ORNEK.py" "$ORNEK.js" >&2 || true
  exit 1
fi
