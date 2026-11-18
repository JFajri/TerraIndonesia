#!/usr/bin/env python3
"""Mengubah data SQL cahyadsn/wilayah_boundaries (MIT, Kepmendagri 2025) menjadi JSON offline per induk wilayah.

Unduh dulu db/kab/*.sql dan db/kec/*.sql dari https://github.com/cahyadsn/wilayah_boundaries
dan simpan dengan nama kab_<kodeprov>.sql / kec_<kodeprov>.sql di satu folder SQL_DIR.

Pakai:  python3 build_wilayah.py <SQL_DIR> <OUT_DIR>      (OUT_DIR = assets/data)
Hasil:  OUT_DIR/kabupaten/<kodeprov>.json   dan   OUT_DIR/kecamatan/<kodekab>.json   (mis. 13.77.json)
"""
import json, os, re, sys, glob, collections

SQL_DIR, OUT = sys.argv[1], sys.argv[2]
NUM = r"-?[\d.]+(?:[eE][-+]?\d+)?"   # termasuk notasi ilmiah, mis. 1.2e-05
ROW = re.compile(r"\('([^']+)'\s*,\s*'((?:[^']|'')*)'\s*,\s*(" + NUM + r")\s*,\s*(" + NUM + r")\s*,\s*'([\[\]\d.,\-+eE\s]+)'\)")

def rings_of(node):
    """Ratakan kedalaman bersarang yang bervariasi: ambil semua daftar titik [lat,lng]."""
    if node and isinstance(node[0], list) and node[0] and isinstance(node[0][0], (int, float)):
        yield node
    else:
        for child in node: yield from rings_of(child)

def geom(path):
    """path = [[ [lat,lng], ... ], ...] (tiap elemen = satu poligon luar) → GeoJSON [lng,lat], 4 desimal."""
    polys = []
    for ring in rings_of(json.loads(path)):
        pts = []
        for lat, lng in ring:
            q = [round(lng, 4), round(lat, 4)]
            if not pts or pts[-1] != q: pts.append(q)
        if pts and pts[0] != pts[-1]: pts.append(pts[0])
        if len(pts) >= 4: polys.append([pts])
    if not polys: return None
    return {'type': 'Polygon', 'coordinates': polys[0]} if len(polys) == 1 else {'type': 'MultiPolygon', 'coordinates': polys}

def rows(level):
    for fn in sorted(glob.glob(os.path.join(SQL_DIR, f'{level}_*.sql'))):
        for code, name, _lat, _lng, path in ROW.findall(open(fn, encoding='utf-8').read()):
            g = geom(path)
            if g: yield code, name.replace("''", "'"), g

def dump(o, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w', encoding='utf-8').write(json.dumps(o, ensure_ascii=False, separators=(',', ':')))

def label_kab(code, name):
    name = name.replace(' Administrasi ', ' ').replace('Administrasi ', '')
    if name.startswith(('Kabupaten ', 'Kota ')): return name
    return ('Kota ' if int(code.split('.')[1]) >= 71 else 'Kabupaten ') + name

stats = {}
for level, parent_len, folder in (('kab', 1, 'kabupaten'), ('kec', 2, 'kecamatan')):
    groups, seen = collections.defaultdict(list), set()
    for code, name, g in rows(level):
        if code in seen: continue
        seen.add(code)
        parent = '.'.join(code.split('.')[:parent_len])
        props = {'code': code, 'name': label_kab(code, name) if level == 'kab' else name,
                 ('province_code' if level == 'kab' else 'kab_code'): parent}
        groups[parent].append({'type': 'Feature', 'properties': props, 'geometry': g})
    for parent, feats in groups.items():
        feats.sort(key=lambda f: f['properties']['code'])
        dump({'type': 'FeatureCollection', 'features': feats}, os.path.join(OUT, folder, parent + '.json'))
    stats[level] = {p: len(v) for p, v in groups.items()}
    print(level, 'total:', sum(stats[level].values()), '| file:', len(groups))
json.dump(stats, open(os.path.join(SQL_DIR, 'stats.json'), 'w'))
