# Demo video script (about 2 min 45 s)

Record at 1440 × 900 with the dark basemap. Run `npm run build && npm run preview` for a smooth recording.
Time marks are targets.

| Time | Screen | Say |
| --- | --- | --- |
| 0:00 | Page loads; the map flies into Bellandur in 3D | "FlowShield predicts where Bengaluru floods, when, and what would help. This is Bellandur–Marathahalli: real terrain, 6,800 mapped drains, 1,300 lakes." |
| 0:15 | Click **Heavy storm**; press play at 4× | "A 90 mm/h storm. Rain adds volume to each 500 m cell, and water flows down the water-surface gradient. Water piles up in the low valley past Bellandur." |
| 0:40 | Pause at about T+35 min; point at the HUD and the early-warnings table | "29 cells go critical, the first at T+32 minutes. The HUD counts the buildings in critical cells live. Each cell passes its warning depth about 16 minutes earlier. That is the lead time a warning system gets." |
| 1:00 | Switch to **Difference** | "Same storm, with bigger drains in the low cells and detention on high ground. Teal is less water, orange is where detention holds it back. Peak depth falls by about 20 cm, 900,000 m³ less standing water." |
| 1:20 | Scroll to the AI panel | "Our AI component is a neural network trained on 4,000 engine runs. It predicts outcomes in microseconds, to within about 6 cm on runs it never saw, so it can search 600 response plans instantly." |
| 1:35 | Click **Apply & verify** on a plan | "The engine then checks the plan it picked. The estimate and the real result are shown side by side." |
| 1:50 | Click **Run 5 engine variants** | "Our parameters are uncalibrated, so we test them. Halving or doubling them keeps the answer at 29–31 critical cells." |
| 2:05 | Click **Replay Sep 2022** and play | "This is the real storm of 4–5 September 2022: 100 mm overnight. The yellow dots are places reported flooded." |
| 2:20 | Show the reality-check panel | "3 of 5 reported places flood nearby, but that is no better than chance. Bellandur's 2022 flood came from lake overflow fed from outside our area. That tells us exactly what to model next." |
| 2:35 | Open **How the model works** | "Every step conserves water to a millionth of a cubic metre, and 13 checks verify the engine. FlowShield: predict the flood, protect the future." |
