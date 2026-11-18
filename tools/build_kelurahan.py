#!/usr/bin/env python3
"""Membuat data kelurahan/desa offline dari cahyadsn/wilayah_boundaries (MIT).

Unduh db/kel/<prov>/wilayah_boundaries_kel_<kodekab>.sql ke satu folder SQL_DIR (nama file dipertahankan).
Pakai:  python3 build_kelurahan.py <SQL_DIR> <OUT_DIR> [eps_derajat=0.0003]
Hasil:  OUT_DIR/kelurahan/<kodekab>.json (mis. 13.77.json) berisi semua kelurahan/desa di kab/kota itu.
Batas disederhanakan (Douglas-Peucker, eps ≈ 33 m untuk 0.0003) dan dibulatkan 4 desimal agar ukuran kecil.
"""
import json, os, re, sys, glob, math
from multiprocessing import Pool

SQL_DIR, OUT = sys.argv[1], sys.argv[2]
EPS = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0003
sys.setrecursionlimit(100000)
NUM = r"-?[\d.]+(?:[eE][-+]?\d+)?"
ROW = re.compile(r"\('([^']+)'\s*,\s*'((?:[^']|'')*)'\s*,\s*(" + NUM + r")\s*,\s*(" + NUM + r")\s*,\s*'([\[\]\d.,\-+eE\s]+)'\)")

def rings_of(n):
    if n and isinstance(n[0], list) and n[0] and isinstance(n[0][0], (int, float)): yield n
    else:
        for c in n: yield from rings_of(c)

def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy)
    best, idx = -1.0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = math.hypot(x - x1, y - y1) if L == 0 else abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L
        if d > best: best, idx = d, i
    if best <= eps: return [pts[0], pts[-1]]
    return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)

def clean(pts):
    q = []
    for x, y in pts:
        p = [round(x, 4), round(y, 4)]
        if not q or q[-1] != p: q.append(p)
    if q and q[0] != q[-1]: q.append(q[0])
    return q

def geom(path):
    polys = []
    for r in rings_of(json.loads(path)):
        pts = [[lng, lat] for lat, lng in r]
        q = clean(rdp(pts, EPS))
        if len(q) < 4: q = clean(pts)            # jangan buang desa kecil: pakai ring asli bila hasil sederhana runtuh
        if len(q) >= 4: polys.append([q])
    if not polys: return None
    return {'type': 'Polygon', 'coordinates': polys[0]} if len(polys) == 1 else {'type': 'MultiPolygon', 'coordinates': polys}

def work(fn):
    kab = os.path.basename(fn).replace('wilayah_boundaries_kel_', '').replace('.sql', '')
    feats, seen, total = [], set(), 0
    for code, name, _la, _lo, path in ROW.findall(open(fn, encoding='utf-8').read()):
        total += 1
        if code in seen: continue
        seen.add(code)
        g = geom(path)
        if g: feats.append({'type': 'Feature', 'properties': {'code': code, 'name': name.replace("''", "'")}, 'geometry': g})
    feats.sort(key=lambda f: f['properties']['code'])
    os.makedirs(os.path.join(OUT, 'kelurahan'), exist_ok=True)
    open(os.path.join(OUT, 'kelurahan', kab + '.json'), 'w', encoding='utf-8').write(
        json.dumps({'type': 'FeatureCollection', 'features': feats}, ensure_ascii=False, separators=(',', ':')))
    return kab, total, len(feats)

if __name__ == '__main__':
    files = sorted(glob.glob(os.path.join(SQL_DIR, 'wilayah_boundaries_kel_*.sql')))
    with Pool() as pool: res = pool.map(work, files, chunksize=4)
    print('file:', len(res), '| kelurahan/desa:', sum(r[2] for r in res), '| baris terbaca:', sum(r[1] for r in res))
    json.dump({k: n for k, _, n in res}, open(os.path.join(SQL_DIR, 'kel_stats.json'), 'w'))
