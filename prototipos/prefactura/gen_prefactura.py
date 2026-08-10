# -*- coding: utf-8 -*-
import json, os, base64, random, io
import qrcode
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, Image)
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

SCRATCH = os.environ.get("SCRATCH", ".")
ROOT = "C:/Users/chave/OneDrive/Documents/_Claude/cotizador"
LOGO = ROOT + "/public/logo_pn.png"
OUT = os.path.join(SCRATCH, "Prefactura_Pedido-7486_Motoblock.pdf")

# ===== GEOMETRIA CALCADA DE LA REFERENCIA (pdfplumber) =====
PAGE_W, PAGE_H = 595.28, 841.89          # A4
MARGIN = 14.2                             # pt por lado
W = PAGE_W - 2*MARGIN                     # 566.88 pt ancho util
LW = 0.5                                  # grosor de linea estandar
# limites de columna X de la tabla de conceptos (absolutos en pagina)
COLX = [14.2, 65.2, 240.9, 292.0, 337.3, 405.4, 462.0, 507.4, 581.1]
ITEM_CW = [COLX[i+1]-COLX[i] for i in range(len(COLX)-1)]   # 8 anchos

ped = json.load(open(os.path.join(SCRATCH, "pedido-7486.json"), encoding="utf-8"))
deb = ped["debtor"]; det = ped["detalles"]

# ---------- helpers ----------
def money(v): return "$ {:,.2f}".format(float(v))
def qty6(v):  return "{:,.6f}".format(float(v))
def price6(v):return "$ {:,.6f}".format(float(v))

UNI = {0:"",1:"UN ",2:"DOS ",3:"TRES ",4:"CUATRO ",5:"CINCO ",6:"SEIS ",7:"SIETE ",
       8:"OCHO ",9:"NUEVE ",10:"DIEZ ",11:"ONCE ",12:"DOCE ",13:"TRECE ",14:"CATORCE ",
       15:"QUINCE ",16:"DIECISEIS ",17:"DIECISIETE ",18:"DIECIOCHO ",19:"DIECINUEVE ",20:"VEINTE "}
DEC = {3:"TREINTA",4:"CUARENTA",5:"CINCUENTA",6:"SESENTA",7:"SETENTA",8:"OCHENTA",9:"NOVENTA"}
CEN = {1:"CIENTO ",2:"DOSCIENTOS ",3:"TRESCIENTOS ",4:"CUATROCIENTOS ",5:"QUINIENTOS ",
       6:"SEISCIENTOS ",7:"SETECIENTOS ",8:"OCHOCIENTOS ",9:"NOVECIENTOS "}
def _cientos(n):
    if n == 0: return ""
    if n == 100: return "CIEN "
    r=""; c=n//100; resto=n%100
    if c: r+=CEN[c]
    if resto<=20: r+=UNI[resto]
    else:
        d=resto//10; u=resto%10
        if d==2: r+="VEINTI"+(UNI[u].strip()+" " if u else "")
        else: r+=DEC[d]+(" Y "+UNI[u] if u else " ")
    return r
def num_letras(n):
    n=int(n)
    if n==0: return "CERO "
    r=""; mill=n//1000000; miles=(n%1000000)//1000; resto=n%1000
    if mill: r+=("UN MILLON " if mill==1 else _cientos(mill)+"MILLONES ")
    if miles: r+=("MIL " if miles==1 else _cientos(miles)+"MIL ")
    if resto: r+=_cientos(resto)
    return r
def importe_letra(total):
    e=int(total); c=int(round((total-e)*100))
    return "(*** {} PESOS {:02d}/100 MXN ***)".format(num_letras(e).strip(), c)

def clave_sat(stk, desc):
    d=desc.lower()
    if stk.startswith("PL") or stk.startswith("PH") or "plato" in d: return "52152004"
    if stk.startswith("TA") or stk.startswith("SA") or "tazon" in d or "salsera" in d: return "52152007"
    return "52152102"

subtotal = round(sum(float(l["unit_price"])*float(l["quantity"]) for l in det),2)
iva = round(subtotal*0.16,2); total = round(subtotal+iva,2)

def fake_b64(n): return base64.b64encode(bytes(random.getrandbits(8) for _ in range(n))).decode()
sello_emisor=fake_b64(256); sello_sat=fake_b64(256)
folio_fiscal="SIMULADO-0000-0000-0000-000000000000"
qr_img=qrcode.make("PREFACTURA DE MUESTRA - PELTRE NACIONAL - PEDIDO 7486 - SIN VALIDEZ FISCAL")
qr_buf=io.BytesIO(); qr_img.save(qr_buf,format="PNG"); qr_buf.seek(0)

# ---------- estilos (tamanos calcados: 7.5 / 7.3 / 7.0 / 6.0) ----------
BLACK=colors.black; GRIS=colors.HexColor("#c9c9c9"); ROJO=colors.HexColor("#c0202a")
styles=getSampleStyleSheet()
def mk(name,**kw):
    kw.setdefault("fontName","Helvetica"); kw.setdefault("fontSize",7.5); kw.setdefault("leading",9.3)
    return ParagraphStyle(name,parent=styles["Normal"],**kw)
S=mk("S"); Sb=mk("Sb",fontName="Helvetica-Bold")
Ssm=mk("Ssm",fontSize=7.3,leading=9.0); Ssmb=mk("Ssmb",fontSize=7.3,leading=9.0,fontName="Helvetica-Bold")
lblR=mk("lblR",fontSize=7.5)
right=mk("right",alignment=TA_RIGHT); rightb=mk("rightb",alignment=TA_RIGHT,fontName="Helvetica-Bold")
rsm=mk("rsm",fontSize=7.3,leading=9,alignment=TA_RIGHT); rsmb=mk("rsmb",fontSize=7.3,leading=9,alignment=TA_RIGHT,fontName="Helvetica-Bold")
center=mk("center",alignment=TA_CENTER); csm=mk("csm",fontSize=7.3,leading=9,alignment=TA_CENTER)
titred=mk("titred",fontSize=10,fontName="Helvetica-Bold",textColor=ROJO)
sellofont=mk("sf",fontSize=6.0,leading=7.0,wordWrap="CJK")

def P(t,st=S): return Paragraph(t,st)
story=[]

# ===================== ENCABEZADO (sin marco) =====================
try: logo=Image(LOGO,width=50*mm,height=21.25*mm,kind="proportional")  # 25% mas grande
except Exception: logo=P("")
emisor=[P("PELTRE NACIONAL",S),P("PNA170810CF1",S),Spacer(1,5),
        P("Tel. (55)43976785",S),P("Domicilio: 01.Tlapacoya",S),
        P("Código Postal 56577 Roberto Fierro Mz 42 Lt 13",S),
        P("Alfredo del Mazo Ixtapaluca México México",S)]
def rg(label,value,vstyle=lblR): return [P(label,lblR),P(value,vstyle)]
meta_grid=Table([
    rg("Nº Prefactura","<font color='#c0202a'>P-7486</font>"),
    rg("Fecha y Hora de<br/>Emisión.",ped["ord_date"]+"T12:00:00"),
    rg("No. Certificado.","00001000000725038303"),
    rg("Lugar<br/>expedición.","56577"),
    rg("Régimen Fiscal.","601 (General de Ley Personas Morales)"),
], colWidths=[70,110])
meta_grid.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),
    ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),2),
    ("TOPPADDING",(0,0),(-1,-1),1),("BOTTOMPADDING",(0,0),(-1,-1),1)]))
pagina=Table([[P("Página 1 De 2",mk("pg",fontSize=7,alignment=TA_RIGHT))]],colWidths=[180])
pagina.setStyle(TableStyle([("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
    ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),2)]))
head=Table([[logo,emisor,[pagina,meta_grid]]],colWidths=[189,170,207.88])  # x calcadas: emisor@203, rejilla@373
head.setStyle(TableStyle([("VALIGN",(0,0),(0,0),"MIDDLE"),("VALIGN",(1,0),(-1,0),"TOP"),
    ("LEFTPADDING",(0,0),(-1,-1),2),("RIGHTPADDING",(0,0),(-1,-1),2),
    ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),0)]))
story.append(head); story.append(Spacer(1,5))

# ===================== BLOQUE ENMARCADO =====================
dir_cli="%s, num ex %s,%s, C.P. %s,%s,%s"%(deb["cfdi_street"],deb["cfdi_street_number"],
    deb["cfdi_district"],deb["cfdi_postal_code"],deb["cfdi_city"],deb["cfdi_state"])
dir_ent=ped["delivery_address"].replace("\n"," "); tel_ent=ped["contact_phone"].strip("\u202a\u202c ")
# cliente/entrega: divisor vertical en x=292 (calcado ~ media pagina) -> col izq 277.8, col der 289.1
wl,wv=74,(W/2-74); wl2,wv2=74,(W/2-74)
ce_rows=[
    [P("<b>Datos del Cliente</b>",Sb),"",P("<b>Datos de Entrega</b>",Sb),""],
    [P("Nombre:",S),P(deb["name"],S),P("Nombre:",S),P(ped["deliver_to"],S)],
    [P("RFC:",S),P(deb["tax_id"],S),P("Dirección:",S),P(dir_ent,S)],
    [P("Dirección:",S),P(dir_cli,S),P("Teléfono:",S),P(tel_ent,S)],
    [P("Código Postal:",S),P(deb["cfdi_postal_code"],S),P("Correo:",S),P(ped["contact_email"],S)],
    [P("Régimen Fiscal:",S),P("<b>601 (General de Ley Personas Morales)</b>",S),"",""],
]
# Esquema de bordes calcado del original:
#  - divisores de seccion: reglas horizontales NEGRAS 0.57 a todo el ancho, SIN lados.
#  - de "Forma de Pago" hacia abajo: caja de borde GRIS claro (0.87).
#  - tabla: columnas negras 0.5, renglones gris, encabezado inferior negro.
SEC=0.57; G87=colors.Color(0.87,0.87,0.87); G345=colors.Color(0.345,0.345,0.345)
ce=Table(ce_rows,colWidths=[wl,wv,wl2,wv2])
ce.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),
    ("SPAN",(0,0),(1,0)),("SPAN",(2,0),(3,0)),("SPAN",(1,5),(3,5)),
    ("LINEABOVE",(0,0),(-1,0),SEC,BLACK),   # regla negra; sin lados ni divisor cliente|entrega
    ("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4),
    ("TOPPADDING",(0,0),(-1,-1),1.0),("BOTTOMPADDING",(0,0),(-1,-1),1.0)]))  # renglon compacto ~11pt (calcado)
story.append(ce)

def meta_cell(label,value,vb=False): return [P(label,lblR),P(("<b>%s</b>"%value) if vb else value,S)]
third=W/3.0; quarter=W/4.0
m1=Table([[meta_cell("Num. Orden de Compra:",ped["customer_ref"]),
           meta_cell("Fecha de Pedido:",ped["ord_date"]),
           meta_cell("Vendedor:",ped["user"]["real_name"])]],colWidths=[third]*3)
m2=Table([[meta_cell("Moneda:","MXN TC 1",True),
           meta_cell("Método de Pago:","PPD (Pago en parcialidades o diferido)",True),
           meta_cell("Uso del CFDI:","G01 (Adquisición de mercancías.)",True),
           meta_cell("Tipo Comprobante:","I (Ingreso)",True)]],colWidths=[quarter]*4)
m3=Table([[P("<b>Forma de Pago:</b> 99 (Por definir)",S),
           P("<b>Condiciones de Pago:</b> 50% de anticipo para iniciar producción; saldo previo a la entrega.",S)]],
         colWidths=[W/2,W/2])
# m1, m2: solo regla negra superior, SIN lados ni verticales
common=[("LINEABOVE",(0,0),(-1,0),SEC,BLACK),("VALIGN",(0,0),(-1,-1),"TOP"),
    ("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4),
    ("TOPPADDING",(0,0),(-1,-1),3.2),("BOTTOMPADDING",(0,0),(-1,-1),3.2)]
m1.setStyle(TableStyle(common)); m2.setStyle(TableStyle(common))
# m3 (Forma/Condiciones): abre la CAJA GRIS -> regla negra arriba + lados y divisor gris
m3.setStyle(TableStyle(common+[
    ("LINEBEFORE",(0,0),(0,-1),LW,G87),("LINEAFTER",(-1,0),(-1,-1),LW,G87),
    ("LINEAFTER",(0,0),(0,0),LW,G87)]))
story.append(m1); story.append(m2); story.append(m3)

# --- Partidas (con divisores verticales finos, como el original) ---
hdr=[P("<b>Código</b>",csm),P("<b>Descripción</b>",Ssmb),P("<b>Cantidad</b>",csm),
     P("<b>Unidad</b>",csm),P("<b>Precio Unitario</b>",csm),P("<b>Descuento</b>",csm),
     P("<b>Obj.<br/>Impuesto</b>",csm),P("<b>Importe</b>",rsmb)]
rows=[hdr]
for l in det:
    imp=float(l["unit_price"])*float(l["quantity"])
    desc="[%s] %s"%(clave_sat(l["stk_code"],l["description"]),l["description"])
    rows.append([P(l["stk_code"],Ssm),P(desc,Ssm),P(qty6(l["quantity"]),csm),
                 P("H87 - pza",csm),P(price6(l["unit_price"]),csm),P("$ 0.00",csm),
                 P("02",csm),P(money(imp),rsm)])
n_items=len(det)
def tot_row(lbl,val,bold=False):
    st=rsmb if bold else rsm
    return ["","","","","",P("<b>%s</b>"%lbl if bold else lbl,st),"",P("<b>%s</b>"%val if bold else val,st)]
rows.append(tot_row("SubTotal:",money(subtotal),True))
rows.append(tot_row("Descuento:","$ 0.00"))
rows.append(tot_row("IVA 16%:",money(iva)))
rows.append(tot_row("TOTAL:",money(total),True))
tbl=Table(rows,colWidths=ITEM_CW)
r_item=n_items; r_t0=n_items+1; r_tN=n_items+4
ts=[("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    # marco: izquierda GRIS 0.87, derecha NEGRO 0.5 (asi lo dibuja el original)
    ("LINEBEFORE",(0,0),(0,-1),LW,G87),("LINEAFTER",(-1,0),(-1,-1),LW,BLACK),
    # encabezado de columnas: arriba gris, abajo NEGRO
    ("LINEABOVE",(0,0),(-1,0),LW,G87),("LINEBELOW",(0,0),(-1,0),LW,BLACK),
    # separadores GRIS entre articulos
    ("LINEBELOW",(0,1),(-1,r_item),LW,G87),
    # divisores de columna NEGROS solo en el CUERPO (el encabezado no los lleva)
    ("LINEBEFORE",(1,1),(1,r_item),LW,BLACK),("LINEBEFORE",(2,1),(2,r_item),LW,BLACK),
    ("LINEBEFORE",(3,1),(3,r_item),LW,BLACK),("LINEBEFORE",(4,1),(4,r_item),LW,BLACK),
    ("LINEBEFORE",(5,1),(5,r_item),LW,BLACK),("LINEBEFORE",(6,1),(6,r_item),LW,BLACK),
    # divisor de la columna Importe: baja hasta los totales (x=507.4)
    ("LINEBEFORE",(7,1),(7,r_tN),LW,BLACK),
    # totales: separadores y cierre en GRIS
    ("LINEBELOW",(0,r_t0),(-1,r_tN-1),LW,G87),
    ("LINEBELOW",(0,r_tN),(-1,r_tN),LW,G87),
    ("LEFTPADDING",(0,0),(-1,-1),3),("RIGHTPADDING",(0,0),(-1,-1),3),
    ("TOPPADDING",(0,0),(-1,0),3.5),("BOTTOMPADDING",(0,0),(-1,0),3.5),
    ("TOPPADDING",(0,1),(-1,r_item),3.2),("BOTTOMPADDING",(0,1),(-1,r_item),3.2),
    ("TOPPADDING",(0,r_t0),(-1,r_tN),3.5),("BOTTOMPADDING",(0,r_t0),(-1,r_tN),3.5)]
for r in range(r_t0,r_tN+1):
    ts.append(("SPAN",(5,r),(6,r))); ts.append(("SPAN",(0,r),(4,r)))
tbl.setStyle(TableStyle(ts)); story.append(tbl)

# ===================== IMPORTE CON LETRA + LEYENDA =====================
story.append(Spacer(1,9))
story.append(P("<b>Importe con letra:</b>",S)); story.append(Spacer(1,2))
story.append(P(importe_letra(total),S)); story.append(Spacer(1,6))
story.append(P("<b>PREFACTURA — Representación de muestra. Este documento NO es un CFDI válido.</b> "
    "Los datos de timbrado (folio fiscal, certificados y sellos digitales) son simulados y no tienen "
    "validez fiscal; sirve únicamente para mostrar cómo se verá la factura final.",Ssm))
story.append(Spacer(1,4))
GRIS15=colors.Color(0.345,0.345,0.345)
story.append(Table([[""]],colWidths=[W],style=[("LINEABOVE",(0,0),(-1,0),1.5,GRIS15)]))
story.append(Spacer(1,4))

# ===================== BLOQUE FISCAL (SIMULADO) + QR =====================
fisc=Table([
    [P("<b>Versión</b>",csm),P("<b>Folio Fiscal (simulado)</b>",csm),
     P("<b>No. Certificado SAT (simulado)</b>",csm),P("<b>Fecha y Hora Certificación</b>",csm)],
    [P("4.0",csm),P(folio_fiscal,csm),P("00000000000000000000",csm),P("(no timbrado)",csm)],
], colWidths=[46,160,125,85])
fisc.setStyle(TableStyle([("LINEBELOW",(0,0),(-1,0),LW,BLACK),("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ("LEFTPADDING",(0,0),(-1,-1),2),("RIGHTPADDING",(0,0),(-1,-1),2),
    ("TOPPADDING",(0,0),(-1,-1),2),("BOTTOMPADDING",(0,0),(-1,-1),3)]))
sellos=[fisc,Spacer(1,3),P("<b>Sello Digital del Emisor (simulado):</b>",Ssmb),P(sello_emisor,sellofont),
        Spacer(1,2),P("<b>Sello Digital del SAT (simulado):</b>",Ssmb),P(sello_sat,sellofont)]
qr=Image(qr_buf,width=95,height=95)
fiscal=Table([[qr,sellos]],colWidths=[110,W-110])
fiscal.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),
    ("LEFTPADDING",(0,0),(0,0),0),("RIGHTPADDING",(0,0),(-1,-1),0),
    ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),0)]))
story.append(fiscal)

def watermark(canvas,doc):
    canvas.saveState()
    canvas.translate(PAGE_W/2,PAGE_H/2); canvas.rotate(38)
    canvas.setFillColor(colors.Color(0.80,0.18,0.18,alpha=0.13))
    canvas.setFont("Helvetica-Bold",88)
    canvas.drawCentredString(0,0,"PREFACTURA")
    canvas.restoreState()
    pg=canvas.getPageNumber()
    if pg>=2:  # el encabezado flotante solo sale en pag 1; numerar las siguientes
        canvas.setFont("Helvetica",7); canvas.setFillColor(colors.black)
        canvas.drawRightString(PAGE_W-MARGIN, PAGE_H-24, "Nº Prefactura P-7486        Página %d De 2"%pg)
    canvas.setFont("Helvetica",6); canvas.setFillColor(colors.grey)
    canvas.drawCentredString(PAGE_W/2,14,"Prefactura de muestra — Peltre Nacional — Pedido 7486 — Documento sin validez fiscal")

doc=SimpleDocTemplate(OUT,pagesize=(PAGE_W,PAGE_H),
    leftMargin=MARGIN,rightMargin=MARGIN,topMargin=16,bottomMargin=24,
    title="Prefactura Pedido 7486 - Motoblock")
doc.build(story,onFirstPage=watermark,onLaterPages=watermark)
print("OK ->",OUT,"| total",total)
