# Demo video script (about 2 min 45 s)

Record at 1440 × 900 with the dark basemap. Run `npm run build && npm run preview`.
Times are targets. Values below describe the default heavy-storm simulation, not
observed Bengaluru flood depths. Read current engine results if changing a plan.

| Time | Screen | Say |
| --- | --- | --- |
| 0:00 | Map opens over Bellandur | "FlowShield explores flood scenarios and compares responses for part of Bengaluru. Terrain is sampled from real elevation data; mapped drains and lakes provide context. Hydraulic capacities remain assumptions." |
| 0:15 | Heavy storm, play at 4× | "Rain adds water to 500 m cells. Flow depends on water-surface elevation. This scenario peaks at 90 mm per hour." |
| 0:40 | Pause near T+35 min; show warning table | "In this scenario, 29 cells eventually become critical. The first crossing is around 32 minutes. The table shows simulated timing and buildings in critical cells, not measured damage or affected population." |
| 1:00 | Difference view | "Under the same storm, larger drains and reduced surface outflow lower peak depth from 1.58 to 1.36 metres. About 0.86 million cubic metres less water remains at the end. All 29 cells still become critical; the plan reduces severity and buys time." |
| 1:20 | AI panel | "A small neural network trained on 3,428 simulated runs helps search response plans. On 572 held-out engine runs its average peak-depth error is about 6 cm. That measures agreement with the engine, not real-world accuracy. Unique cell footprint measures land coverage, not project cost." |
| 1:35 | Apply & verify | "Every selected plan can be checked by the simulation engine. The AI estimate and computed result appear together." |
| 1:50 | Run 5 engine variants | "Conductance and drainage are uncalibrated. These variants show how outcomes depend on those assumptions." |
| 2:05 | Replay Sep 2022 | "This exploratory replay scales ERA5 timing to an illustrative 100 mm based on contemporary reporting. It is not a local measured hourly record. Yellow points mark reported flooded places." |
| 2:20 | Exploratory replay panel | "We show overlap with those reports alongside neighbourhood coverage across the grid. This small, selective set cannot establish forecasting accuracy. Lake storage and external inflow are important missing processes." |
| 2:35 | How the model works | "The engine checks mass balance against explicit absolute and relative tolerances. Twenty-one automated checks cover core physics and integration. Our goal is an explainable comparison tool; field calibration is future work." |
