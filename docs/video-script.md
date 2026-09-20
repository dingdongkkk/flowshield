# FlowShield — submission video script

**Target length: 3 min 40 s** (the brochure asks for 2–3 minutes, so cut marks `[CUT]`
bring it to 2 min 55 s — drop those lines if you want to stay strictly inside the range).

Structure: 3 slides (55 s) → live demo (2 min 25 s) → close (20 s).

Recording: 1440 × 900, Chrome, production build (`npm run build && npm run preview`) or the
live site. Do a warm-up run first so map tiles are cached. Speak at a calm pace; every number
below is a real result from the app, so nothing needs to be invented.

---

## SLIDE 1 — Title + problem (0:00–0:20)

**On screen**
> **FlowShield** — Predict the flood. Protect the future.
> Problem statement: FLOWSHIELD · Theme: VECTOR
> Team name · member names
> Live: flowshield-app.vercel.app · GitHub: github.com/dingdongkkk/flowshield
> *Photo or map of Bellandur flooding, Sept 2022*

**Say**
"On 5 September 2022, Bengaluru recorded its wettest September day in eight years. Bellandur,
Marathahalli and the Outer Ring Road went under water, and people were evacuated by boat.
We're team [name], and FlowShield answers three questions for that exact area: where does the
water go, how much warning would we get, and what actually helps."

---

## SLIDE 2 — What we built + how it meets the brief (0:20–0:45)

**On screen** (two columns, ticks)

| Brochure requirement | FlowShield |
| --- | --- |
| Configurable rainfall | Steady / heavy / cloudburst, 5–200 mm/h, or the real Sept 2022 storm |
| City as connected regions | 315 cells of 500 m on real terrain, open boundaries |
| Accumulation + movement | Mass-conserving storage network |
| Drainage + terrain | Per-cell drains; 90 m Copernicus elevation, 9 samples per cell |
| Water levels over time | Engine steps ≤ 1 s, played back on a 3D map |
| Safe / Warning / Critical | 10 cm / 30 cm thresholds |
| Time-based visualisation | 3D atlas + time slider + progression chart |
| Critical regions + time to critical | Warnings table with countdown and **lead time** |
| **All 7 bonus items** | normal + heavy rain · drainage failure · blocked channel · scenario comparison · affected buildings · time slider |

**Say**
"Everything in the problem statement is built, and all seven bonus items: normal and heavy
rainfall, drainage failure, a blocked channel, scenario comparison, exposure, and an
interactive time slider. The map is real: 6,839 mapped stormwater drains, 1,356 lakes, real
elevation, and 78,000 buildings from OpenStreetMap." `[CUT: the last sentence]`

---

## SLIDE 3 — What we added beyond the brief (0:45–1:05)

**On screen** (four boxes)
1. **AI surrogate** — neural network trained on 4,000 of our own engine runs; searches ~600 response plans instantly
2. **Response planning** — drain upgrades, upstream detention, pumps, drain clearing, compared on the same storm
3. **Verification** — 21 automated checks · water balance to 10⁻⁶ m³ · convergence · sensitivity
4. **Reality check** — replay of the real 4–5 Sept 2022 storm against reported flood locations

**Say**
"We added four things beyond the brief. A real AI component: a neural network trained on four
thousand runs of our own simulator, which lets us search hundreds of response plans in
milliseconds. Response planning, so you can test what would actually help. Verification, because
a model you can't check is just a nice animation. And a reality check against the real 2022
flood. Let me show you."

---

## DEMO (1:05–3:30)

> Have the app already open on the **Heavy storm** preset, time at T+0, dark basemap, 3D on.
> Numbers below are the real readings for this preset: at T+1:40 the map reads 29 critical,
> 5 warning, 5,955 buildings; over the whole run 29 cells go critical, the first at T+32 min.

### 1 · Rainfall and terrain input (1:05–1:25)
**Do:** point at the sidebar; nudge **Peak intensity**; point at the map.
**Say:** "This is Bellandur–Marathahalli: ten and a half by seven and a half kilometres of real
terrain, divided into 315 cells. On the left I set the storm — here a 90 mm/h peaked storm over
two hours — the drain capacity, and the condition of the drains in the low-lying district. The
cyan lines are the city's actual mapped stormwater drains."

### 2 · Water-level simulation + flood progression (1:25–1:55)
**Do:** press **play** at 4×; let it run; pause near **T+1:40** (the peak of the flooding).
**Say:** "Rain adds volume to every cell. Water moves from higher to lower water surfaces, drains
and pumps take it away, and it leaves across the boundary toward Varthur. Watch it collect along
the real valley into Bellandur. Each column's height and colour is the water depth at that
moment. The whole three-hour simulation takes about half a second; this is playback, not a video."

### 3 · Risk classification (1:55–2:10)
**Do:** click **Risk**; point at the HUD counters (at T+1:40 they read: critical 29, warning 5,
buildings in critical cells 5,955).
**Say:** "Switching to risk: green is safe, amber is warning at 10 cm, red is critical at 30 cm.
At this moment 29 cells are critical, and the panel counts 5,955 mapped buildings inside them —
that's the affected-exposure bonus, live as the storm plays."

### 4 · Early warning output (2:10–2:35)
**Do:** scroll to the **Early warnings** table.
**Say:** "This is the early-warning output. For each block: what it is now, when it becomes
critical, the lead time, and the buildings exposed. Block H17 crosses warning at T+16 minutes and
critical at T+31:43 — sixteen minutes of usable warning for 151 buildings. That's the number a
real warning system is judged on."

### 5 · Scenario comparison + response planning (2:35–3:00)
**Do:** click **Difference**; then scroll to **Response comparison**.
**Say:** "Now the same storm with a response plan: drains tripled in the low-lying cells, plus
detention holding runoff on higher ground. Teal is less water, orange is where detention holds it
back — an honest trade-off, not a free win. Peak depth drops 21 centimetres, there's nearly a
million cubic metres less standing water, sixteen blocks flood later and one is avoided entirely.
We also found that mobile pumps barely move the needle at catchment scale."

### 6 · The AI (3:00–3:15)
**Do:** scroll to the AI panel; click **Apply & verify** on a plan.
**Say:** "Our AI component: a neural network trained on four thousand engine runs. On runs it had
never seen it predicts peak depth within about six centimetres, so it can score six hundred
plans instantly and rank them by how much of the city they touch. And when I apply one, the real
engine re-runs and we show the estimate against the truth — the AI proposes, the physics decides."

### 7 · Verification + reality check (3:15–3:30)
**Do:** click **Run 5 engine variants**; then the **Replay Sep 2022** preset; point at the
reality-check panel.
**Say:** "Our parameters are assumptions, so we test them: halve or double them and the answer
holds at 29 to 31 critical cells. `[CUT]` And this is the real September 2022 storm, a hundred
millimetres overnight. Three of the five reported flood locations in our area do flood — but so
does half the grid, so we report plainly that this is not yet better than chance. Bellandur
flooded when its lake overflowed from a catchment outside our area, and that's exactly what we'd
model next."

---

## CLOSE (3:30–3:40)

**On screen:** final slide — live link, GitHub link, one line per pillar.

**Say**
"FlowShield: every requirement and every bonus, real Bengaluru data, a verified mass-conserving
engine, a genuine AI that makes planning interactive, and honesty about what it can't yet do.
It's live at flowshield-app.vercel.app. Thank you."

---

## Timing summary

| Section | Runtime |
| --- | --- |
| Slides 1–3 | 1:05 |
| Demo steps 1–7 | 2:25 |
| Close | 0:10 |
| **Total** | **3:40** (2:55 with `[CUT]` lines removed) |

## Checklist before recording

- Production build or the live site, warmed up once so tiles are cached
- Window 1440 × 900, browser zoom 100%, bookmarks bar hidden, notifications off
- Heavy storm preset selected, T+0, dark basemap, 3D on
- Record in one take per section; splice in the editor if a step misbehaves
- Say only numbers that appear on screen while you say them

## How the video covers the five judging criteria

| Criterion | Where it lands |
| --- | --- |
| **Real-World Impact** | Slide 1 (the 2022 flood), demo 4 (lead time + buildings), demo 5 (which measures actually help) |
| **Technical Execution** | Slide 2 (real data, 315 cells), demo 2 (half-second runs, 3D playback), demo 6 (AI + engine verification) |
| **Mathematical Modelling & Problem Solving** | Slide 3 box 3, demo 2 (the flow rule in one sentence), demo 7 (sensitivity, 21 checks, water balance) |
| **Innovation & Creativity** | Slide 3 (AI surrogate + response planning), demo 5 (difference view), demo 6 (plan search) |
| **Project Demonstration** | The whole demo follows the brochure's required order: rainfall & terrain input → water-level simulation → flood progression → risk classification → early warning output |

The brochure's required demo flow maps exactly to demo steps 1 → 2 → 3 → 4; steps 5–7 are the
extras, so if you need to cut for time, cut from step 7 backwards, never from steps 1–4.
