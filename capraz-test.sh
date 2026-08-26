#!/bin/sh
# Çapraz test: defter.py (Python) ile atolye.js (JS) aynı ilerleme matematiğini
# uygulamak zorunda. Ayrışırlarsa site ile terminal farklı şeyler söyler.
# Kullanım: ./capraz-test.sh
set -eu
KOK="$(cd "$(dirname "$0")" && pwd)"
cd "$KOK"

ORNEK="$(mktemp -t atolye-test)"
trap 'rm -f "$ORNEK" "$ORNEK.py" "$ORNEK.js"' EXIT

cat > "$ORNEK" <<'EOF'
{"v":1,"items":{"z1":3,"z2":2,"z3":1,"z4":2,"f0a":4,"f0b":3,"f0c":3,"f0d":4,"f0e":3,
                "f1a":2,"f1d":1,"f2c":3,"gecersiz":7},
 "journal":[{"id":"a","date":"2026-08-10","hours":2,"phase":"z"},
            {"id":"b","date":"2026-08-24","hours":3,"phase":"z"},
            {"id":"c","date":"2026-08-25","hours":4,"phase":"f0"},
            {"id":"d","date":"2026-08-26","hours":2.5,"phase":"f0"},
            {"id":"bozuk","date":"OLMAZ","hours":99},
            {"id":"eksi","date":"2026-08-26","hours":-5}],
 "updated":"2026-08-26T10:00:00+03:00"}
EOF

python3 - "$ORNEK" > "$ORNEK.py" <<'EOF'
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location('defter', 'defter.py')
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
m = mod.mufredat_yukle()
d = mod.normallestir(json.load(open(sys.argv[1])), m)
print('cekirdek', mod.genel_yuzde(m, d))
for p in m['phases']:
    print(p['id'], mod.faz_yuzdesi(m, d, p['id']), mod.kapi_durumu(m, d, p['id']))
print('hafta', f"{mod.bu_hafta_saat(d):g}", 'toplam', f"{mod.toplam_saat(d):g}")
print('seans', len(d['journal']))
nx = mod.sonraki_madde(m, d)
print('sonraki', nx['id'] if nx else '-')
EOF

node - "$ORNEK" > "$ORNEK.js" <<'EOF'
global.window = {}; global.document = { getElementById: () => null };
global.fetch = () => Promise.reject(new Error('offline'));
require('./atolye.js');
const A = global.window.Atolye, fs = require('fs');
const muf = JSON.parse(fs.readFileSync('mufredat.json', 'utf8'));
const st = A.normalizeState(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), muf);
const s = A.stats(muf, st);
const ad = { on: 'GEÇİLDİ', run: 'sürüyor', off: 'başlamadı' };
console.log('cekirdek', s.overallPct);
muf.phases.forEach(p => console.log(p.id, s.phasePct(p.id), ad[s.gate(p.id)]));
console.log('hafta', A.fmtHours(s.hoursThisWeek), 'toplam', A.fmtHours(s.totalHours));
console.log('seans', s.sessions);
console.log('sonraki', s.nextItem ? s.nextItem.id : '-');
EOF

if diff -u "$ORNEK.py" "$ORNEK.js" > /dev/null; then
  echo "✓ Python ve JS aynı sonucu veriyor:"
  sed 's/^/    /' "$ORNEK.py"
else
  echo "✗ AYRIŞMA VAR (sol: Python, sağ: JS):" >&2
  diff -u "$ORNEK.py" "$ORNEK.js" >&2 || true
  exit 1
fi
