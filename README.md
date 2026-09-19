# FlowShield

**Predict the flood. Protect the future.** A flood simulation and early-warning dashboard for
Bellandur–Marathahalli, Bengaluru, built for Hack-a-Matics 2026 (problem statement FLOWSHIELD, theme VECTOR).

FlowShield simulates how rain turns into standing water across 315 real-terrain cells. It warns when and
where each cell becomes critical, and compares response plans (drain upgrades, upstream detention, pumps,
drain clearing) on the same storm. A neural-network surrogate trained on the engine previews outcomes
instantly and searches for good plans. It also replays the real flood of 4–5 September 2022.

## What it does

| Brochure requirement | FlowShield |
| --- | --- |
| Configurable rainfall intensity | Steady / heavy / cloudburst storms (5–200 mm/h, 15–240 min), or the Sep 2022 replay |
| City as connected regions | 21 × 15 grid of 500 m cells, 4-neighbour connections, open edges |
| Water accumulation and movement | Mass-conserving storage network: water flows down the water-surface gradient |
| Drainage capacity and terrain | Per-cell drain capacity; elevation = mean of 9 Copernicus GLO-90 samples |
| Water levels over time | Engine steps ≤ 1 s, saved every 1–2 min, played back on a 3D map |
| Safe / Warning / Critical | 10 cm / 30 cm depth thresholds (adjustable) |
| Time-based visualisation | 3D MapLibre atlas with a time slider, a flood-progression chart and per-cell depth charts |
| Critical regions and time to critical | Early-warnings table: countdown to critical, **warning lead time**, buildings exposed |
| **Bonus:** normal / heavy rain, drain failure, blocked channel | One-click presets; drains can be partly or fully blocked, or fail mid-storm |
| **Bonus:** compare scenarios | Baseline vs response: side-by-side maps, a difference view, and per-cell timing categories |
| **Bonus:** affected population | 78,375 OpenStreetMap buildings counted per cell (buildings, not people) |
| **Bonus:** interactive time slider | Yes, shared across both scenarios |

## AI component

**Neural-network surrogate model** ([src/app/surrogate.ts](src/app/surrogate.ts), trained by
[scripts/train-surrogate.mjs](scripts/train-surrogate.mjs)).

- **What it is.** A multilayer perceptron (21 inputs, two hidden layers of 48 tanh units, 5 outputs). We wrote
  it and its Adam optimiser from scratch in JavaScript. It is trained on **4,000 real engine runs** covering
  random storms, drain conditions and response plans.
- **What it predicts.** Peak depth, the share of cells that become critical, the earliest critical time,
  the water still stored at the end, and the share of buildings in critical cells.
- **How well.** On 572 held-out runs it never saw: peak depth ±5.6 cm (R² 0.995), critical cells ±0.9
  (R² 0.995), first-critical time R² 0.96. These metrics ship with the model and are shown in the app.
- **What it is used for.** (1) Instant estimates as you move sliders. (2) **Plan search:** the app scores
  about 600 candidate response plans in milliseconds and shows the best plan for each plan size.
  "Apply & verify" then runs the real engine and shows the estimate next to the engine result.
- **What it is not.** It never replaces the engine. Every number on the map and in the tables comes from
  the engine. The surrogate is disabled for inputs outside its training range, including the 2022 replay
  and non-default thresholds.

Retrain with `npm run train` (about 4 minutes on 9 CPU cores).

AI coding assistants were also used to write code, as the rules allow. The modelling choices, integration
and verification are the team's own work.

## The model

For every cell *i* with area *A*, ground elevation *z* and stored volume *V*:

- depth *h = V / A*, water surface *H = z + h*
- flow to neighbour *j*: *q = G (Hᵢ − Hⱼ) · f_donor*. Here *G* is conductance and *f* < 1 where detention holds runoff back
- *dV/dt* = rain + inflow − outflow − drains − pumps − edge outflow
- if a cell is asked for more water than it holds, all its outflows are scaled by the same factor *α = min(1, available / requested)*

Each run checks the water balance at every step, fails loudly rather than drifting, and passes 13
analytical checks (`npm test`). The design is in [docs/simulation-design.md](docs/simulation-design.md), and
the choice of model area is explained in [docs/model-area.md](docs/model-area.md).

**Checks shown in the app**

- *Sensitivity:* one click reruns the baseline with conductance halved or doubled and drain capacity ±25%.
  For the default storm, 29–31 cells go critical and the first critical time falls between T+31 and T+36 min.
- *Reality check (2022 replay):* 3 of the 5 places reported flooded inside the area have a critical cell
  within about 750 m. But 51% of all neighbourhoods do, so this is **no better than chance**. We show this
  openly. The main gap: Bellandur flooded when its lake overflowed with water from a catchment mostly outside
  the model area, and the model has no lakes and no inflow from outside.

**Limits:** no momentum or velocity, no infiltration, no real sewer geometry, no lakes as storage, no inflow
from beyond the area, and 500 m cells rather than street scale. Conductance, drain capacity and thresholds are
uncalibrated assumptions. Use FlowShield to compare scenarios, not as an operational forecast.

## Key findings (default heavy storm, 90 mm/h peak, engine results)

- About 7.1 million m³ of rain falls. Only about 1.5 million m³ leaves through drains and the edges. The rest
  runs into about 29 low cells, which reach critical depth in about 32 minutes.
- **Mobile pumps barely matter** at catchment scale.
- **Structural measures work:** 3× drains in the low-lying cells plus detention on higher ground cut peak
  depth by about 20 cm and leave about 0.9 million m³ less standing water. They delay critical flooding, but
  in a storm this extreme they mostly buy minutes. Detention can raise risk in the cells that hold water.
- **Early warning:** cells typically pass the warning depth about 15–20 minutes before becoming critical.

## Data sources

| Data | Source |
| --- | --- |
| Elevation | Copernicus DEM GLO-90 via the [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api) |
| Stormwater drains and lakes | [KSRSAC via OpenCity](https://data.opencity.in/dataset/bengaluru-stormwater-drains-maps) |
| Buildings | © OpenStreetMap contributors (ODbL), via the Overpass API |
| Sep 2022 rain timing | ERA5 reanalysis via the [Open-Meteo archive](https://open-meteo.com/en/docs/historical-weather-api) |
| Sep 2022 rain total and flooded places | [The Quint, 5 Sep 2022](https://www.thequint.com/south-india/rains-in-bengaluru-continue-to-wreak-havoc-three-lakes-overflow-into-homes), citing IMD |
| Geocoding | OpenStreetMap Nominatim |
| Basemaps | CARTO, OpenFreeMap, Esri World Imagery, AWS Terrain Tiles |

All services are free and need no API keys. Rebuild the data with `npm run data`. The raw KML downloads are
not committed.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine checks
npm run build      # production build in dist/
```

Stack: TypeScript, React 19, Vite 8, MapLibre GL 6, Web Workers. The engine runs off the main thread, so
the UI stays responsive, and a 3-hour, 315-cell storm takes about 0.5 s.

## Project layout

```
src/simulation/   engine + validation (contract in src/shared/simulation.ts)
src/app/          scenarios, worker client, comparison, surrogate, insights
src/components/   atlas, panels, charts
src/workers/      simulation worker
src/data/         generated terrain, exposure, event and surrogate data
data/bengaluru/   reproducible data pipeline
scripts/          surrogate training
docs/             design, model area, demo script
```
