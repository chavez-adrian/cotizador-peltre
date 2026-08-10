# -*- coding: utf-8 -*-
import pdfplumber, collections
REF = r"C:/Users/chave/Downloads/A1945_UUM2204064I7_2483f0f1-8f4a-45f8-b843-046cd6214992.pdf"

pdf = pdfplumber.open(REF)
p = pdf.pages[0]
print("=== PAGE SIZE ===")
print("width", round(p.width,2), "height", round(p.height,2))

print("\n=== FONTS (name -> sizes usados) ===")
fonts = collections.defaultdict(set)
for ch in p.chars:
    fonts[ch["fontname"]].add(round(ch["size"],1))
for f, sizes in sorted(fonts.items()):
    print(f"{f:40s} sizes={sorted(sizes)}")

print("\n=== LINEAS HORIZONTALES (y, x0->x1, grosor) ===")
hlines = [l for l in p.lines if abs(l["y0"]-l["y1"]) < 0.5]
hlines.sort(key=lambda l: -l["top"])
for l in hlines:
    print(f"top={l['top']:.1f}  x0={l['x0']:.1f} x1={l['x1']:.1f}  w={l.get('linewidth',0):.3f}  color={l.get('stroking_color')}")
print(f"total h-lines: {len(hlines)}")

print("\n=== LINEAS VERTICALES (x, y0->y1, grosor) ===")
vlines = [l for l in p.lines if abs(l["x0"]-l["x1"]) < 0.5]
vlines.sort(key=lambda l: l["x0"])
for l in vlines:
    print(f"x={l['x0']:.1f}  top={l['top']:.1f} bottom={l['bottom']:.1f}  w={l.get('linewidth',0):.3f}")
print(f"total v-lines: {len(vlines)}")

print("\n=== RECTS (posibles fondos/lineas gruesas) ===")
for r in sorted(p.rects, key=lambda r:-r["top"])[:40]:
    print(f"top={r['top']:.1f} x0={r['x0']:.1f} x1={r['x1']:.1f} bottom={r['bottom']:.1f}  fill={r.get('non_stroking_color')} stroke={r.get('stroking_color')} w={r.get('linewidth',0):.3f}")
print(f"total rects: {len(p.rects)}")

pdf.close()
