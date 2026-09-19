# FlowShield model area

## Why Bellandur–Marathahalli

The model covers 10.5 × 7.5 km of south-east Bengaluru, from 77.615° E / 12.986° N
(north-west corner) across Bellandur, Marathahalli and the Outer Ring Road.

- **It floods.** The Bellandur, Marathahalli, Outer Ring Road and Sarjapur Road
  areas were among the worst hit in the September 2022 Bengaluru floods.
- **It is a real drainage valley.** The Koramangala–Challaghatta valley drains past
  Bellandur Lake toward Varthur. The sampled terrain shows this: ground falls from
  about 916 m in the north-west to about 866 m around Bellandur, and most outward
  boundary flow leaves through the east and south edges, toward Varthur.
- **Its drains are mapped.** The KSRSAC / OpenCity stormwater-drain layer is dense
  here, so the map shows the real network next to the simulation.

## How the grid is built (`data/bengaluru/fetch.py`)

| Item | Value | Why |
| --- | --- | --- |
| Cells | 21 × 15 = 315, 500 m square | Finest uniform grid over this extent within the engine's 400-region guardrail |
| Cell elevation | Mean of 3 × 3 Copernicus GLO-90 samples (Open-Meteo) | Averages the ground in the cell instead of trusting one point |
| Boundary | 72 outflow-only edge outlets | Water can leave toward lower ground outside the area |
| Outlet level | Mean elevation of a virtual 500 m cell just outside the edge (same 3 × 3 sampling) | Uses measured terrain; no river or lake level is invented |
| Connections | 4-neighbour, conductance 40 m²/s | An uncalibrated assumption. Square cells make it independent of cell size |
| "Low-lying district" | The lowest 15% of cells by mean elevation (47 cells) | Where drain blockage and response actions apply in scenarios |

## Limits to state in the demo

- The model does not simulate inflow from beyond the area. Water enters only as rain, and edges only let water out.
- Drain lines are shown as context. The simulation uses an assumed per-cell drain
  capacity (mm/h), not the geometry or capacity of the mapped channels.
- A 500 m cell has one uniform water depth. It cannot show street-scale flooding.
- Conductance, drain capacity, pump capacity and thresholds are scenario assumptions,
  not calibrated values.

## What the default heavy storm shows (engine run, 3 h, 90 mm/h peak)

Of about 7.1 million m³ of rain, about 0.7 million m³ leaves through drains and about
0.8 million m³ leaves across the edges. The rest concentrates in about 29 low cells,
which reach critical depth. Halving the maximum time step gives the same peak depth.

Response measures compared on the same storm (results from the engine):

| Response | Peak depth | Stored after 3 h | Cells ever critical |
| --- | --- | --- | --- |
| None | 1.58 m | 5.60 M m³ | 29 |
| 3 mobile pumps, 0.4 m³/s | ≈1.58 m | ≈5.60 M m³ | 29 |
| District drains upgraded 3× | 1.41 m | 4.98 M m³ | 29 (16 later) |
| Detention in highest 70% of cells, 90% held back | 1.55 m | 5.21 M m³ | 28 + 1 avoided |
| Drains 4× + detention (60% of cells, 85% held back) | 1.26 m | 4.46 M m³ | 28 later, 1 avoided |
| Same plan with drains 3×, steady 30 mm/h storm | 1.23 → 0.97 m | 3.64 → 2.92 M m³ | 23 → 19 |

What this means: mobile pumps are too small to matter at catchment scale. Structural
measures (bigger drains where water collects, and holding runoff upstream) reduce
peak depth and stored volume substantially. For extreme storms they mostly delay
critical flooding by minutes rather than prevent it. Detention can raise risk in
the cells that hold the water back.
