"""Build the implementation-grounded mathematical report from a recorded engine run.
Requires reportlab. Run from the repository root. No simulation code is modified.
"""
from pathlib import Path
import json, math, re
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether, Flowable
from reportlab.graphics.shapes import Drawing, Rect, Line, String, Polygon
from reportlab.graphics.charts.lineplots import LinePlot

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT/'docs/model-report-results.json').read_text())
MODEL = json.loads((ROOT/'src/data/surrogate-model.json').read_text())
OUT = ROOT/'output/pdf'; OUT.mkdir(parents=True,exist_ok=True)
FONT_DIR = Path('/Users/onlyanubhav/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype')
# Set FLOW_REPORT_FONT_DIR when using another runtime with DejaVu fonts.
import os
FONT_DIR = Path(os.environ.get('FLOW_REPORT_FONT_DIR',str(FONT_DIR)))
for name,file in [('Body','DejaVuSans.ttf'),('Bold','DejaVuSans-Bold.ttf'),('Italic','DejaVuSans-Oblique.ttf'),('Mono','DejaVuSansMono.ttf')]:
 pdfmetrics.registerFont(TTFont(name,str(FONT_DIR/file)))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Italic',boldItalic='Bold')
NAVY=colors.HexColor('#142C42'); TEAL=colors.HexColor('#087E8B'); BLUE=colors.HexColor('#2869B3'); INK=colors.HexColor('#23384A'); MUTED=colors.HexColor('#596D7F'); LIGHT=colors.HexColor('#EDF4F7'); LINE=colors.HexColor('#D7E2E9')
W,H=A4; WIDTH=W-92
styles={
 'body':ParagraphStyle('BodyText',fontName='Body',fontSize=9.6,leading=14.2,textColor=INK,spaceAfter=8),
 'small':ParagraphStyle('Small',fontName='Body',fontSize=8,leading=11.5,textColor=MUTED,spaceAfter=6),
 'h1':ParagraphStyle('H1',fontName='Bold',fontSize=24,leading=29,textColor=NAVY,spaceAfter=15),
 'h2':ParagraphStyle('H2',fontName='Bold',fontSize=12.3,leading=17,textColor=TEAL,spaceBefore=10,spaceAfter=6),
 'eq':ParagraphStyle('Equation',fontName='Body',fontSize=11,leading=18,textColor=NAVY),
 'eqnum':ParagraphStyle('EquationNumber',fontName='Body',fontSize=8,leading=11.5,textColor=MUTED,alignment=TA_RIGHT),
 'cell':ParagraphStyle('Cell',fontName='Body',fontSize=8.5,leading=12,textColor=INK),
 'head':ParagraphStyle('TableHead',fontName='Bold',fontSize=8.3,leading=11,textColor=colors.white),
 'code':ParagraphStyle('Code',fontName='Mono',fontSize=8.1,leading=12,textColor=NAVY,spaceAfter=7),
 'kicker':ParagraphStyle('Kicker',fontName='Bold',fontSize=9,leading=14,textColor=TEAL,spaceAfter=8),
}
story=[]; page_titles=[]
def p(text,style='body'): return Paragraph(text,styles[style])
def add(text,style='body'): story.append(p(text,style))
def sub(title,text=None): add(title,'h2'); text is not None and add(text)
def eq(text,n):
 t=Table([[p(text,'eq'),p(f'({n})','eqnum')]],colWidths=[WIDTH-48,48]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT),('BOX',(0,0),(-1,-1),.4,LINE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(1,0),(1,0),4),('RIGHTPADDING',(1,0),(1,0),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]));story.extend([t,Spacer(1,9)])
def table(headers,rows,widths=None,size=8.5):
 if widths is None: widths=[WIDTH/len(headers)]*len(headers)
 data=[[p(x,'head') for x in headers]]+[[p(str(x),'cell') for x in row] for row in rows]
 t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,LIGHT]),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,0),.6,NAVY),('LINEBELOW',(0,1),(-1,-1),.3,LINE),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8)]));story.extend([t,Spacer(1,8)])
def callout(title,text):
 t=Table([[p(title,'h2')],[p(text)]],colWidths=[WIDTH],splitByRow=0);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT),('LINEBEFORE',(0,0),(0,-1),3,TEAL),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]));story.extend([t,Spacer(1,8)])
def page(kicker,title):
 if story:story.append(PageBreak())
 page_titles.append(title);add(kicker.upper(),'kicker');add(title,'h1')
def footer(c,doc):
 c.saveState();c.setStrokeColor(LINE);c.line(46,43,W-46,43)
 c.setFont('Body',7.5);c.setFillColor(MUTED);c.drawString(46,29,'FLOWSHIELD  |  linear-storage-v1  |  20 September 2026')
 c.drawRightString(W-46,29,f'{doc.page:02d}')
 if doc.page>1:
  c.setFont('Bold',8);c.setFillColor(TEAL);c.drawString(46,H-30,'FLOWSHIELD / MATHEMATICAL REPORT')
 c.restoreState()

def network():
 d=Drawing(WIDTH,108)
 labels=[('Rainfall','mm/hour'),('Region storage','V = A × h'),('Surface exchange','q = G × head difference'),('External sinks','drains / pumps / edges')]
 xs=[0,126,252,378]
 for x,(a,b) in zip(xs,labels):
  d.add(Rect(x,34,117,58,fillColor=LIGHT,strokeColor=LINE,rx=6,ry=6));d.add(String(x+8,72,a,fontName='Bold',fontSize=8.6,fillColor=NAVY));d.add(String(x+8,53,b,fontName='Body',fontSize=6.6,fillColor=MUTED))
 for x in [117,243,369]:
  d.add(Line(x,63,x+8,63,strokeColor=TEAL));d.add(Polygon([x+9,63,x+5,66,x+5,60],fillColor=TEAL,strokeColor=TEAL))
 d.add(String(0,12,'Conceptual dependencies; actual flux requests are evaluated together.',fontName='Body',fontSize=8,fillColor=MUTED))
 return d

def chart():
 d=Drawing(WIDTH,208); plot=LinePlot();plot.x=43;plot.y=36;plot.width=WIDTH-58;plot.height=145
 plot.data=[[(x['timeMin'],x['baselineCritical']) for x in DATA['series']],[(x['timeMin'],x['responseCritical']) for x in DATA['series']]]
 plot.lines[0].strokeColor=BLUE;plot.lines[0].strokeWidth=1.7;plot.lines[1].strokeColor=TEAL;plot.lines[1].strokeWidth=1.7;plot.lines[1].strokeDashArray=[5,3]
 plot.xValueAxis.valueMin=0;plot.xValueAxis.valueMax=180;plot.xValueAxis.valueSteps=[0,30,60,90,120,150,180]
 plot.yValueAxis.valueMin=0;plot.yValueAxis.valueMax=35;plot.yValueAxis.valueSteps=[0,10,20,30]
 for ax in [plot.xValueAxis,plot.yValueAxis]:
  ax.labels.fontName='Body';ax.labels.fontSize=7;ax.strokeColor=LINE
 plot.yValueAxis.visibleGrid=True;plot.yValueAxis.gridStrokeColor=LINE
 d.add(plot);d.add(String(43,194,'Cells critical at each saved frame',fontName='Bold',fontSize=9,fillColor=NAVY))
 d.add(Line(292,198,310,198,strokeColor=BLUE,strokeWidth=2));d.add(String(315,194,'Baseline',fontName='Body',fontSize=8,fillColor=MUTED))
 d.add(Line(380,198,398,198,strokeColor=TEAL,strokeWidth=2));d.add(String(403,194,'Response',fontName='Body',fontSize=8,fillColor=MUTED))
 d.add(String(190,8,'Simulation time (minutes)',fontName='Body',fontSize=8,fillColor=MUTED))
 return d

page('Implementation-grounded technical report','FLOWSHIELD')
add('Mathematics, numerical method<br/>and verification','h1')
add('A conservative region-based flood scenario simulator<br/>Bellandur-Marathahalli, Bengaluru','h2')
add('Hack-a-Matics 2026  |  Report date: 20 September 2026','small')
story.append(Spacer(1,16))
add('How do rainfall, terrain and drainage interact, and what changes when a response plan is applied to the same storm? FLOWSHIELD answers that question with connected water-storage cells, an explicit numerical engine and synchronized scenario comparisons.')
story.append(network())
callout('What this report establishes','The implemented model uses consistent physical units, conservative inter-region transfers, limited withdrawals and observable water-balance errors. The report explains these choices directly from the current code; it does not invent a development history or claim field validation.')
table(['Model domain','Default scenario','Verified implementation'],[['315 cells / 78.75 km²','Peak depth: 1.577 → 1.363 m','21 automated checks pass'],['500 m cells / 594 connections','Cells ever critical: 29 → 29','Contract 1.0 / TypeScript engine']],[157,184,WIDTH-341])
sub('Reading guide by section','01 Variables and assumptions · 02 Head and flow · 03 Sources and controls · 04 Conservative update · 05 Time and stability · 06 Risk and comparison · 07 Bengaluru data · 08 Computed results · 09 Verification · 10 Numerical evidence · 11 AI surrogate · 12 Limits and defence · 13 Sources and reproducibility.')
add('Interpretation: this is an exploratory scenario simulator, not a validated flood forecast, street-scale inundation model, or evacuation system. All numerical results identified as computed were produced from the recorded implementation snapshot.','small')

page('01 / Representation','State, variables and units')
add('The city area is represented as a graph. Each node is a non-overlapping region with fixed area, one terrain elevation and one average water depth. Each undirected edge permits bidirectional surface exchange. The engine accepts arbitrary valid graphs; the Bengaluru application supplies a regular grid. [S1-S3]')
table(['Symbol','Meaning','Unit'],[
 ['i, j; e; b','Region indices; an internal edge; an external outlet','-'],['t, Δt, T','Simulation time, integration step, run horizon','s'],['A<sub>i</sub>','Planar area of a storage region','m²'],['z<sub>i</sub>','Fixed terrain elevation relative to a common datum','m'],['V<sub>i</sub>, h<sub>i</sub>','Stored volume; mean depth above local terrain','m³; m'],['H<sub>i</sub>','Water-surface elevation: z<sub>i</sub> + h<sub>i</sub>','m'],['G<sub>ij</sub>, G<sub>b</sub>','Internal and boundary conductance','m²/s'],['r(t)','Piecewise-constant rainfall intensity','mm/hour'],['D<sub>i</sub>, P<sub>i</sub>','Design drain capacity; active pump capacity','m³/s'],['o<sub>i</sub>, f<sub>i</sub>','Drain opening and surface-outflow factors','0 to 1'],['α<sub>i</sub>','Available-water scaling factor, recomputed per step','0 to 1'],['w, c','Warning and critical depth thresholds','m']],[88,WIDTH-160,72])
eq('V<sub>i</sub>(0) = A<sub>i</sub> h<sub>i</sub>(0);   h<sub>i</sub>(t) = V<sub>i</sub>(t) / A<sub>i</sub>','1')
sub('Explicit assumptions','All rain becomes surface storage. There is no infiltration, evaporation, soil moisture or subsurface exchange. Within each cell, depth is spatially uniform. Terrain and area remain fixed. The default Bengaluru scenario begins dry; the engine contract supports nonzero initial depths.')
add('A region\'s planar area is not a culvert cross-section. This implementation does not claim to know channel cross-sections: pathway effects are represented by an uncalibrated conductance.','small')

page('02 / Physical hypothesis','Water moves down surface head')
add('The modelling hypothesis is that connected regions exchange water from higher water-surface elevation to lower water-surface elevation. Terrain alone is insufficient: a lower-lying cell with enough stored water can have the higher water surface.')
eq('H<sub>i</sub> = z<sub>i</sub> + V<sub>i</sub>/A<sub>i</sub>;   ΔH<sub>ij</sub> = H<sub>i</sub> - H<sub>j</sub>','2')
sub('The chosen constitutive law','For an edge oriented from i to j, the unthrottled signed rate is proportional to the head difference. A negative sign reverses the donor and recipient; an edge is stored once, so the reverse direction is not counted a second time.')
eq('q<sub>ij</sub> = G<sub>ij</sub> (H<sub>i</sub> - H<sub>j</sub>)','3')
add('Dimensional check: (m²/s) × m = m³/s. Equal water surfaces produce zero exchange, even when terrain elevations differ. If G = 0, the edge carries no water. Doubling the head difference doubles the requested rate, before availability limiting.')
sub('Why a linear law?','It is a deliberately simple storage-network approximation: transparent, unit-consistent and easy to test within a 24-hour prototype. It is not derived here as a universal law for open channels, weirs or culverts. A nonlinear law could be added if its geometry, coefficients and numerical treatment were justified; nonlinearity alone would not establish accuracy.')
eq('q<sub>ij</sub><super>requested</super> = f<sub>d</sub> G<sub>ij</sub> (H<sub>i</sub> - H<sub>j</sub>),   d = donor','4')
add('The surface-outflow factor f belongs to the higher-head donor. It reduces both lateral export and boundary discharge, but does not reduce drainage or pumping. This is the implemented approximation for upstream detention, not a reservoir with a surveyed storage capacity.')
callout('Illustrative head example - not a Bengaluru result','Region A: z = 10 m, h = 0.1 m, so H = 10.1 m. Region B: z = 9 m, h = 1.5 m, so H = 10.5 m. Water is requested from B to A, uphill relative to ground but downhill relative to the water surface. Actual transfer also depends on available volume.')

page('03 / Forcing and interventions','Rainfall, drains, pumps and edges')
sub('Rainfall conversion','One millimetre is 0.001 m and one hour is 3,600 s. The global rainfall schedule supplies intensity r(t) uniformly to all cells. Its intervals exactly partition the simulation horizon.')
eq('R<sub>i</sub> = A<sub>i</sub> r(t) / 3,600,000;   ΔV<sub>rain,i</sub> = R<sub>i</sub> Δt','5')
add('Example: 36 mm/hour over 100 m² for 100 s adds 0.1 m³, or 0.001 m depth. This analytical value is verified by the automated suite.')
sub('External withdrawals','A drain requests D<sub>i</sub> o<sub>i</sub> m³/s, where o = 0 is closed and o = 1 fully open. Pumps request P<sub>i</sub> m³/s. Both remove water from the modelled domain; neither deposits it in another simulated cell.')
eq('B<sub>b</sub> = f<sub>i</sub> G<sub>b</sub> max(H<sub>i</sub> - H<sub>ext,b</sub>, 0)','6')
add('An outlet exports to a fixed external reference head. It never imports water. There is no flow across an unlisted external boundary. Bengaluru outlet references come from adjacent terrain samples, not measured lake or river water levels.')
table(['Intervention','What changes at its event time'],[
 ['Drain clearing / failure','Set o between 0 and 1. This changes the requested fraction of drain capacity.'],['Pumping','Set the absolute capacity P in m³/s, not an incremental addition.'],['Drain upgrade','Set the absolute capacity D. Blockage still acts through o.'],['Detention proxy','Set f between 0 and 1. Retained water stays in cell storage and may increase local risk.']],[140,WIDTH-140])
callout('No hidden priority','Rain is added first. Drainage, pumping, internal export and boundary discharge then share the donor\'s available water through the same proportional limiter. Drains are not allowed to consume all the water before neighbours are considered.')

page('04 / Conservative discretisation','One limiter, one simultaneous update')
add('At time t<sub>n</sub>, add the step\'s rainfall to form available volume U. Requested fluxes use the resulting water surface H*. This is a source-first, first-order explicit update. Incoming transfers cannot be passed on again during the same step. [S1]')
eq('U<sub>i</sub> = V<sub>i</sub><super>n</super> + ΔV<sub>rain,i</sub>;   H*<sub>i</sub> = z<sub>i</sub> + U<sub>i</sub>/A<sub>i</sub>','7')
add('Compute all outgoing requests in <b>m³</b>: internal transfers |q|Δt, drain D o Δt, pump P Δt and outlet B Δt. Let S<sub>i</sub> be their sum for donor i.')
eq('α<sub>i</sub> = 1 if S<sub>i</sub> = 0; otherwise α<sub>i</sub> = min(1, U<sub>i</sub>/S<sub>i</sub>)','8')
add('Each request is multiplied by its donor\'s α. An internal actual transfer T<sub>ij</sub> is debited from one cell and credited to the other using exactly the same value.')
eq('V<sub>i</sub><super>n+1</super> = U<sub>i</sub> - α<sub>i</sub>S<sub>i</sub> + Σ<sub>j</sub> T<sub>ji</sub>','9')
sub('Nonnegativity','Since α<sub>i</sub>S<sub>i</sub> ≤ U<sub>i</sub> and incoming transfers are nonnegative, the update is nonnegative in exact arithmetic. The state vector is replaced only after all transfers have been accumulated. This avoids giving an earlier edge first access to a donor\'s water.')
sub('Conservation','Summing equation (9) cancels every internal debit against its matching credit. Only rainfall and explicitly tracked external sinks change total domain storage.')
eq('Σ V<super>n+1</super> = Σ V<super>n</super> + rainfall - drained - pumped - boundary export','10')
callout('Hand-worked illustration - not a computed scenario','Available water: 10 m³. Requests: transfer 8 m³, drainage 6 m³, pumping 6 m³. Total request is 20 m³, so α = 0.5. Actual amounts are 4, 3 and 3 m³. The donor ends empty, the neighbour gains 4 m³, and 6 m³ leaves the model. Nothing is lost or created by the transfer.')

page('05 / Time integration','Stability, events and diagnostics')
add('Define K<sub>i</sub> as the sum of incident internal conductances plus outlet conductances. For the unconstrained linear exchange problem, Δt ≤ A<sub>i</sub>/K<sub>i</sub> keeps the own-cell coefficient nonnegative. The implementation uses a more conservative factor s, default 0.45, with 0 &lt; s ≤ 0.5.')
eq('Δt<sub>transfer</sub> = min<sub>i: Kᵢ&gt;0</sub>(s A<sub>i</sub>/K<sub>i</sub>)','11')
eq('Δt = min(Δt<sub>max</sub>, Δt<sub>transfer</sub>, time to next boundary)','12')
add('A boundary is the next rainfall change, intervention, saved frame or final time. Cells with K = 0 impose no transfer-step restriction. Surface factors cannot exceed 1, so unmodified conductances remain a conservative bound. The limiter guarantees availability; the step bound alone is not an accuracy guarantee for the full constrained model.')
sub('Exact update order')
add('1. Validate and canonicalize inputs; initialize volumes; apply time-zero controls.<br/>2. Save the initial frame and classify initial risk.<br/>3. Choose a step ending no later than the next schedule/output boundary.<br/>4. Add rainfall, compute H*, then all sink and transfer requests.<br/>5. Compute donor factors; accumulate actual exports and incoming transfers.<br/>6. Form the next volumes and check finite values and water balance.<br/>7. Advance simulation time; sample peaks and critical crossings.<br/>8. Apply controls at this new time; save a frame if scheduled. Repeat.')
add('Schedules use [start, end) semantics. An intervention at time τ affects subsequent evolution, not the preceding step; a frame at τ shows the new control values without an instantaneous water-volume jump. Interventions at or beyond T are rejected. Initial and final frames are always saved.')
eq('ε<sub>allowed</sub> = 10<super>-6</super> m³ + 10<super>-9</super> max(1 m³, V<sub>0</sub> + rain<sub>cum</sub>)','13')
add('Cumulative ledgers use compensated summation. Tiny negative round-off may be clamped only within 10<super>-12</super> × max(1 m³, available volume), and the added water is logged. Larger negatives, nonfinite states, excess mass residual, time-step underflow or exhausted step budgets return a structured failure, never a successful partial forecast.','small')

page('06 / Interpretation','Risk, timing and fair comparisons')
eq('Safe: h &lt; w;   Warning: w ≤ h &lt; c;   Critical: h ≥ c','14')
add('The default demonstration thresholds are w = 0.10 m and c = 0.30 m. They are configurable assumptions, not verified safety limits. The current contract uses one threshold pair for all regions.')
eq('t<sub>crit,i</sub> = min { t<sub>n</sub> : h<sub>i</sub><super>n</super> ≥ c }','15')
table(['Crossing state','Meaning'],[['Already critical','The initial state is at or above c; record time 0.'],['Reached during the run','Record the first accepted state at or above c and its previous sample time.'],['Not reached within horizon','No accepted state reaches c through T. This does not mean it will never flood.']],[155,WIDTH-155])
add('Crossings and peaks are sampled at every integration step, not only at display frames. Times are discrete model results, not interpolated continuous roots. The default run steps at 1 s and saves frames every 60 s. Presentation playback seeks to the first saved frame at or after a selected crossing.')
sub('Warning lead time','The application derives first-warning time from saved frames and subtracts it from the step-resolved critical crossing. This has coarser resolution; brief warning states can be missed. Where the interval cannot be resolved, the app uses a within-frame category. This quantity is not a guaranteed evacuation window.')
eq('Δh<sub>peak</sub> = h<sub>peak,response</sub> - h<sub>peak,baseline</sub>;   Δt<sub>i</sub> = t<sub>crit,response</sub> - t<sub>crit,baseline</sub>','16')
add('A delay is defined numerically only when both crossings exist. Other categories are baseline-only, response-only or neither within the common horizon. Comparisons require identical underlying physics, rainfall, timing and region sets except for allowed scenario metadata and interventions. [S4]')
callout('Full-run summaries versus playback','Peak depth means the largest depth at any cell and accepted time. Cells ever critical counts distinct cells, not the maximum critical count in a single frame. Presentation cards summarize the full run; each map shows conditions at its shared playback time. Stale or incomplete current comparisons are hidden.')

page('07 / Bengaluru instantiation','Real terrain, declared hydraulic assumptions')
table(['Item','Current implementation'],[['Extent','10.5 × 7.5 km in Bellandur-Marathahalli; 78.75 km², not all Bengaluru.'],['Storage cells','21 columns × 15 rows = 315 cells, each 500 m × 500 m = 250,000 m².'],['Elevation','Mean of nine Copernicus GLO-90 samples per cell, obtained through Open-Meteo.'],['Connectivity','594 undirected four-neighbour connections; no diagonal exchange.'],['Conductance','40 m²/s per connection before the user multiplier; uncalibrated.'],['Boundary','72 outflow-only outlets; reference heads from virtual cells outside the grid.'],['Drainage','Uniform assumed design removal of 20 mm/hour; capacity per cell = 1.388889 m³/s after rounding.'],['Low-lying district','Lowest 15% of cells by mean terrain = 47 cells; used for drain interventions and pump placement.'],['Detention placement','Highest cells by mean terrain; ties resolved deterministically by region ID.']],[122,WIDTH-122])
sub('What the downloaded layers actually contribute','The source snapshot contains 6,839 mapped drain features (163 primary, 870 secondary, 5,806 tertiary) and 1,356 lake features. These counts cover the source datasets, not just the simulation rectangle. Mapped geometry is displayed as context; it does not determine the engine\'s capacities or connection topology. [D1-D2]')
add('The building layer contains 78,375 OpenStreetMap buildings counted by model cell. Counts in critical cells are a coarse exposure proxy, not confirmed building damage, occupancy or affected population. [S5]')
callout('Data honesty','Terrain is sampled from a DEM rather than a street-level survey. Published drains are not a complete, current, measured hydraulic inventory. The model has no dynamic lake storage, lake overflow or catchment inflow from outside the grid. There is no coastal sink in this Bengaluru scenario.')

page('08 / Recomputed demonstration','What the default comparison shows')
add('Computed from the current engine snapshot for this report: heavy rainfall profile with a 90 mm/hour peak over 120 minutes, followed by 60 dry minutes. The eight equal-duration intensity factors are 0.2, 0.4, 0.7, 1, 0.8, 0.5, 0.3 and 0.1. Total rainfall is 90 mm, not 180 mm. Both runs start dry.')
add('Response: 3× drain capacity in the 47 low cells; surface-outflow factor 0.15 on the highest 60% of cells (189 cells); three 0.4 m³/s pumps deployed at 30 minutes. Baseline has no response measures. [S3, R1]')
b=DATA['baseline'];r=DATA['response'];bb=b['finalBalance'];rb=r['finalBalance']
table(['Computed quantity','Baseline','Response'],[
 ['Peak depth anywhere',f"{b['peakWaterDepthM']:.6f} m",f"{r['peakWaterDepthM']:.6f} m"],['Cells ever critical',b['everCriticalRegionCount'],r['everCriticalRegionCount']],
 ['Rain input','7,087,500 m³','7,087,500 m³'],['Drained',f"{bb['drainedM3']:,.1f} m³",f"{rb['drainedM3']:,.1f} m³"],['Pumped',f"{bb['pumpedM3']:,.1f} m³",f"{rb['pumpedM3']:,.1f} m³"],['Boundary export',f"{bb['boundaryDischargeM3']:,.1f} m³",f"{rb['boundaryDischargeM3']:,.1f} m³"],['Final stored volume',f"{bb['storageM3']:,.1f} m³",f"{rb['storageM3']:,.1f} m³"],['Block H17 first critical','31 min 43 s','35 min 53 s']],[WIDTH-230,115,115])
story.append(chart())
add(f"Peak depth decreases by {(b['peakWaterDepthM']-r['peakWaterDepthM'])*100:.2f} cm ({100*(1-r['peakWaterDepthM']/b['peakWaterDepthM']):.1f}%). Final storage decreases by {bb['storageM3']-rb['storageM3']:,.0f} m³. The selected earliest-baseline cell gains 4 min 10 s, but the count ever critical remains 29. These are simulated reductions in severity and timing, not evidence that flooding is prevented.",'small')

page('09 / Implementation verification','Analytical checks and regressions')
add('The current <font name="Mono">npm test</font> suite passed all 21 checks when preparing this report. It compiles the TypeScript modules into a temporary directory and exercises the actual engine, validation and integration helpers. No independent field observations are used by these tests. [S6]')
checks=[
('01','Rainfall units','36 mm/hour × 100 s × 100 m² = 0.1 m³.'),('02','Closed exchange','Two-cell volume is conserved; flow follows surface head.'),('03','Equilibrium','Equal heads on different terrain remain unchanged.'),('04','Scarce donor','Drains, pumps, boundary and lateral requests share water.'),('05','Event timing','Rain changes and pumps are not applied retroactively.'),('06','Threshold states','Initial, between-frame, equality and not-reached cases.'),('07','Convergence','Smaller steps approach the two-cell analytical solution.'),('08','Determinism','Canonical order, reversed edges, repeats, immutable input.'),('09','Boundary','An outflow-only outlet never imports water.'),('10','Final frame','Exact final time included when output intervals do not divide T.'),('11','Validation','Invalid values, topology, schedules and conflicts are rejected.'),('12','Numerical failure','Overflow and exhausted step budgets fail explicitly.'),('13','Application pair','Default runs satisfy transport and comparison contracts.'),('14','Horizon changes','Action timing stays valid; valid failure/clearing order persists.'),('15','AI support','Unsupported settings, counts and times hide estimates.'),('16','Plan footprint','Overlapping structural measures count each cell once.'),('17','Drain upgrade','Timed replacement respects blockage and water accounting.'),('18','Full detention','Surface export stops while drains and pumps remain active.'),('19','Release','Detention changes act only after their event boundary.'),('20','Joint controls','Detention and upgrades still share scarce donor volume.'),('21','Invalid controls','Out-of-range factors and capacities are rejected.')]
table(['#','Check','What it exercises'],checks,[27,112,WIDTH-139])
add('Verification checks the implementation against its mathematical specification. It does not establish hydraulic calibration, model completeness, or forecast skill.','small')

page('10 / Numerical evidence','Residuals and time-step sensitivity')
add('The default baseline and response each accepted 10,800 one-second steps. The engine checks the ledger after each step, even though saved display frames are less frequent.')
table(['Diagnostic','Baseline','Response'],[
 ['Maximum absolute physical residual',f"{DATA['diagnostics']['baseline']['maxAbsolutePhysicalResidualM3']:.3e} m³",f"{DATA['diagnostics']['response']['maxAbsolutePhysicalResidualM3']:.3e} m³"],
 ['Final allowed residual',f"{bb['allowedErrorM3']:.7f} m³",f"{rb['allowedErrorM3']:.7f} m³"],['Cumulative round-off added',f"{bb['roundoffAddedM3']:.3e} m³",f"{rb['roundoffAddedM3']:.3e} m³"],['Donor-limited region-steps',f"{DATA['diagnostics']['baseline']['donorLimitedRegionSteps']:,}",f"{DATA['diagnostics']['response']['donorLimitedRegionSteps']:,}"]],[WIDTH-220,110,110])
sub('Two residuals, not one hidden correction')
eq('ε<sub>physical</sub> = V<sub>stored</sub> - (V<sub>0</sub> + rain - drains - pumps - boundaries)','17')
eq('ε<sub>numerical</sub> = ε<sub>physical</sub> - roundoff<sub>added</sub>','18')
add('Both absolute residuals and the accumulated round-off addition must stay within the configured tolerance. A small residual establishes arithmetic water accounting; it cannot establish realistic rainfall, geometry or drainage behaviour.')
sub('A fresh baseline refinement check')
table(['Quantity','1.0 s maximum step','0.5 s maximum step'],[['Peak depth',f"{b['peakWaterDepthM']:.9f} m",f"{DATA['convergence']['peakDepthM']:.9f} m"],['Cells ever critical','29','29'],['Block H17 first critical','1,903 s','1,901.5 s']],[WIDTH-246,123,123])
add(f"Halving the maximum step changes peak depth by {abs(DATA['convergence']['peakDepthM']-b['peakWaterDepthM'])*1000:.5f} mm and the selected crossing by 1.5 s. This is evidence of local time-step insensitivity for this baseline, not a universal convergence proof or a bound for every scenario.")
callout('Why report donor limiting?','A donor-limited region-step means requested exports exceeded the water available in that cell. The large counts show that availability constraints strongly shape this scenario. Reported timing should therefore be checked under smaller steps and parameter variations rather than justified by conservation alone.')

page('11 / AI component','A surrogate of the simulator')
add('The AI component approximates engine outcomes so the interface can preview inputs and search response plans. It does not supply the simulated water levels on the map. The engine verifies chosen plans. The shipped model uses 21 engineered features, two 48-unit tanh layers and five linear outputs. [S7]')
eq('x̃ = (x - μ<sub>x</sub>)/σ<sub>x</sub>;   a<sub>1</sub> = tanh(W<sub>1</sub>x̃ + b<sub>1</sub>)','19')
eq('a<sub>2</sub> = tanh(W<sub>2</sub>a<sub>1</sub> + b<sub>2</sub>);   ŷ = μ<sub>y</sub> + σ<sub>y</sub> ⊙ (W<sub>3</sub>a<sub>2</sub> + b<sub>3</sub>)','20')
add('Means and standard deviations are calculated from training rows only. The dataset contains 4,000 simulated runs: 3,428 training and 572 held out. Training uses Adam on squared normalized error. The runtime clamps predicted shares to [0, 1] and peak depth to nonnegative values.')
m=MODEL['metrics']
table(['Output','Held-out mean absolute error','R²'],[
 ['Peak depth',f"{100*m['peakDepthM']['mae']:.2f} cm",f"{m['peakDepthM']['r2']:.3f}"],['Share of cells ever critical',f"{315*m['criticalShare']['mae']:.3f} cells equivalent",f"{m['criticalShare']['r2']:.3f}"],['Earliest critical time / horizon',f"{m['earliestCriticalShare']['mae']:.4f} of horizon",f"{m['earliestCriticalShare']['r2']:.3f}"],['End-storage / rainfall share',f"{100*m['storedShare']['mae']:.3f} percentage points",f"{m['storedShare']['r2']:.3f}"],['Building-exposure share',f"{100*m['buildingsCriticalShare']['mae']:.3f} percentage points",f"{m['buildingsCriticalShare']['r2']:.3f}"]],[173,WIDTH-222,49])
add('These are the metrics recorded during training, not a fresh retraining in this report. They evaluate raw network outputs before the runtime clamps and saved-weight rounding. They measure agreement with engine labels, not real floods; MAE is not an uncertainty interval or worst-case bound. A time target of 1 also represents no crossing, so near-horizon estimates need engine verification.','small')
sub('Support and plan search','Estimates are disabled outside the shipped generator bounds, including more than 10 pumps, replay rainfall, changed thresholds or conductance, unsupported horizons and step settings. Up to 609 structural candidates are scored, with the same support checks. Unique modified cells measure footprint, not money, feasibility or a globally optimal plan.')
add('Total pump capacity is encoded as one feature. Different pump layouts can therefore share a feature vector and still produce different engine results. Supported ranges do not mean every parameter combination was represented in training.','small')

page('12 / Scope and human defence','What the team can responsibly claim')
table(['Claim','Defensible wording'],[['Conservation','Every transfer has an equal debit and credit; external sources and sinks are tracked.'],['Bengaluru relevance','The demo uses sampled local terrain and mapped context over part of Bengaluru.'],['Early warning','The model reports threshold-crossing times under specified scenario assumptions.'],['Intervention value','Paired runs isolate changes caused by specified response controls within this model.'],['AI accuracy','Held-out error measures how closely the surrogate reproduces the engine.']],[116,WIDTH-116])
sub('Important omissions','No momentum or velocity, channel geometry, infiltration, soil saturation, lake storage, lake overflow, incoming external catchment flow or downstream backwater. Cells use average depth at 500 m scale. Conductance, drain capacity and thresholds are uncalibrated. Detention is an outflow reduction without a finite storage limit.')
sub('The September 2022 replay','The application uses ERA5 hourly timing rescaled from a 21.4 mm total to an illustrative 100 mm informed by contemporary news reporting. It is not a measured local hourly rainfall series. Reported flooded places are compared with the containing cell and its eight neighbours. The overlap and grid-wide neighbourhood coverage are descriptive, not a statistical significance test or validated forecasting accuracy. [S8, D3]')
sub('High-value next steps','1. Obtain defensible lake stage-storage curves, outlet levels and upstream inflow schedules.<br/>2. Add rainfall losses with bounded infiltration/runoff terms and explicit ledgers.<br/>3. Calibrate parameters on measured events, then assess separate held-out events.<br/>4. Study mesh and time-step sensitivity and obtain appropriate exposure data.')
callout('A concise explanation for judges','We store water as volume in connected regions. Rain adds volume; surface-head differences request transfers. All outgoing processes share the available water through one limiter, so volume cannot be spent twice. We compare the same storm with different interventions, verify numerical accounting, and clearly separate those calculations from unvalidated real-world predictions.')

page('13 / Audit trail','Sources and reproducibility')
add('Equations and implementation claims are traced to the repository sources below, inspected on 20 September 2026. Recorded engine outputs and source hashes identify the computation used for the results tables and chart.')
refs=[
 ('S1','src/simulation/index.ts','Implemented update, limiter, time stepping, event order and diagnostics.'),
 ('S2','src/shared/simulation.ts; src/simulation/validation.ts','Contract, units, ranges, canonical copies and structured errors.'),
 ('S3','src/app/scenarios.ts; src/app/bengaluru.ts','Default forcing, interventions, graph and domain.'),
 ('S4','src/app/comparison.ts; src/app/insights.ts','Comparable-run checks, timing categories and exposure.'),
 ('S5','public/data/bengaluru/manifest.json; src/data/bengaluru-exposure.ts','Downloaded-layer provenance and building counts.'),
 ('S6','src/simulation/verify.mjs','21 executable engine and integration checks.'),
 ('S7','src/app/surrogate.ts; scripts/train-surrogate.mjs; src/data/surrogate-model.json','AI support checks, trainer, stored weights and metrics.'),
 ('S8','src/data/event-2022.ts; data/bengaluru/fetch_event_2022.py','Replay rainfall assumptions and reported locations.'),
 ('R1','docs/model-report-results.json','Report-specific engine outputs, time series and source hashes.')]
for key,path,desc in refs:add(f'<b>[{key}]</b> {escape(path)}<br/>{desc}','small')
sub('External data provenance')
for key,label,url in [
 ('D1','KSRSAC drain map via OpenCity','https://data.opencity.in/dataset/bengaluru-stormwater-drains-maps'),
 ('D2','Bengaluru district lakes via OpenCity','https://data.opencity.in/dataset/lakes-and-ponds-in-bengaluru-district'),
 ('D3','Replay reporting: The Quint, 5 September 2022','https://www.thequint.com/south-india/rains-in-bengaluru-continue-to-wreak-havoc-three-lakes-overflow-into-homes'),
 ('D4','Open-Meteo elevation API / Copernicus GLO-90','https://open-meteo.com/en/docs/elevation-api')]:
 add(f'<b>[{key}]</b> <link href="{url}" color="#087E8B">{label}</link>','small')
add('Source dataset versions and retrieval timestamps are preserved in the manifest. Full-dataset counts are not completeness guarantees for current infrastructure. OSM building data remains subject to its contributor attribution and ODbL terms.','small')
sub('Reproduce and inspect')
add('npm test<br/>npm run build<br/>python3 scripts/build-mathematical-report.py','code')
add('The PDF builder reads the recorded results in R1; it does not rerun or retrain the model. Install ReportLab and set FLOW_REPORT_FONT_DIR to a directory containing the DejaVu Sans family when building elsewhere. R1 contains full SHA-256 hashes for the engine, validator, contract, scenario builder, surrogate and model weights.','small')
add(f"Recorded computation: {escape(DATA['generatedAt'])}<br/>Engine SHA-256 prefix: <font name=\"Mono\">{DATA['sourceHashes']['src/simulation/index.ts'][:24]}</font>",'small')

class CheckedDoc(SimpleDocTemplate):
 def afterFlowable(self,flow):
  if isinstance(flow,Paragraph) and flow.style.name=='H1':
   self.canv.bookmarkPage('section-'+str(self.page));self.canv.addOutlineEntry(flow.getPlainText(),'section-'+str(self.page),0,False)

doc=CheckedDoc(str(OUT/'FLOWSHIELD_Mathematical_Report.pdf'),pagesize=A4,rightMargin=46,leftMargin=46,topMargin=54,bottomMargin=56,title='FLOWSHIELD - Mathematics, Numerical Method and Verification',author='FLOWSHIELD project',subject='Implementation-grounded mathematical report; linear-storage-v1')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print('Built',OUT/'FLOWSHIELD_Mathematical_Report.pdf')
