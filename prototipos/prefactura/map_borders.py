# -*- coding: utf-8 -*-
import pdfplumber
REF = r"C:/Users/chave/Downloads/A1945_UUM2204064I7_2483f0f1-8f4a-45f8-b843-046cd6214992.pdf"
p = pdfplumber.open(REF).pages[0]
words = p.extract_words()

def near_text(y, side, x0=None, x1=None):
    # texto mas cercano por arriba (side='up') o por abajo ('down') de la linea horizontal y (top-coord)
    best=None; bestd=1e9
    for w in words:
        wy = w["top"] if side=="down" else w["bottom"]
        d = (wy - y) if side=="down" else (y - wy)
        if d < 0 or d > bestd: continue
        if x0 is not None and (w["x1"]<x0 or w["x0"]>x1): continue
        bestd=d; best=w["text"]
    return best

def col(c):
    if c is None: return "none"
    if isinstance(c,(list,tuple)):
        v=round(sum(c)/len(c),3)
        return "NEGRO" if v<0.05 else ("GRIS%.2f"%v if v<0.9 else "blanco")
    return str(c)

print("=== HORIZONTALES (agrupadas por y) ===")
H=[l for l in p.lines if abs(l["y0"]-l["y1"])<0.5]
from collections import defaultdict
g=defaultdict(list)
for l in H: g[round(l["top"],1)].append(l)
for y in sorted(g):
    segs=g[y]; x0=min(s["x0"] for s in segs); x1=max(s["x1"] for s in segs)
    w=segs[0].get("linewidth",0); c=col(segs[0].get("stroking_color"))
    up=near_text(y,"up",x0,x1); dn=near_text(y,"down",x0,x1)
    full = "FULL" if (x0<20 and x1>575) else "x[%.0f-%.0f]"%(x0,x1)
    print(f"y_top={y:6.1f}  {full:14s} w={w:.3f} {c:8s} nsegs={len(segs):2d} | arriba='{up}' abajo='{dn}'")

print("\n=== VERTICALES (agrupadas por x) ===")
V=[l for l in p.lines if abs(l["x0"]-l["x1"])<0.5]
gv=defaultdict(list)
for l in V: gv[round(l["x0"],1)].append(l)
for x in sorted(gv):
    segs=gv[x]; top=min(s["top"] for s in segs); bot=max(s["bottom"] for s in segs)
    w=segs[0].get("linewidth",0); c=col(segs[0].get("stroking_color"))
    print(f"x={x:6.1f}  top=[{top:.0f}-{bot:.0f}] w={w:.3f} {c:8s} nsegs={len(segs)}")

# rects grandes (no los del QR): area > 2000 pt2
print("\n=== RECTS GRANDES (posibles cajas de seccion) ===")
for r in p.rects:
    area=(r["x1"]-r["x0"])*(r["bottom"]-r["top"])
    if area>3000:
        print(f"top={r['top']:.1f} x[{r['x0']:.0f}-{r['x1']:.0f}] h={r['bottom']-r['top']:.0f} fill={col(r.get('non_stroking_color'))} stroke={col(r.get('stroking_color'))} w={r.get('linewidth',0):.3f}")
