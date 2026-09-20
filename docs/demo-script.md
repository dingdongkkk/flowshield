# Brochure-aligned demo video script (about 2 min 50 s)

Record the default heavy-storm comparison with Block H17 selected. Keep
“Simulated scenario” visible. Numerical claims below belong to
that configuration; read new engine results if changing a plan. Rehearse against
the three-minute limit. Timings are targets.

## 0:00-0:20 / Problem statement and hook

Show both maps with H17 selected and its crossing times readable.

“The FLOWSHIELD challenge asks us to simulate how rainfall, terrain and drainage
produce flooding, and identify where and when conditions become critical.
Here is our answer: the same Bengaluru block reaches critical conditions four
minutes and ten seconds later under our response plan, in this simulation.”

## 0:20-0:45 / Core requirements

Show rainfall controls, terrain, the shared timeline, risk colours and crossing
output. Use short requirement labels over actual application footage.

“We represent part of Bengaluru as 315 connected regions. Users configure
rainfall and drainage, simulate water accumulation and movement, and inspect
Safe, Warning and Critical classifications.
The interactive timeline shows flood progression, while each region reports its
first critical crossing, including cases where it never crosses within the
simulation horizon.”

## 0:45-1:05 / Bonus coverage

Show normal and heavy presets, failure and blockage controls, comparison mode,
the slider and building exposure. Brief clips demonstrate controls; do not imply
every scenario was run during this segment.

“We also support normal and heavy rainfall, timed drainage failure, simplified
drain blockage, scenario comparison and an interactive time slider.
For exposure, we report mapped buildings in critical cells. We do not yet
estimate affected population, because building counts alone do not establish
how many people are exposed.”

## 1:05-1:30 / Computed comparison

Return to the unchanged default heavy scenario. Advance both maps together and
show H17's 31:43 and 35:53 crossings, then the full-run result cards.

“Under the same storm, our combined drainage upgrades, pumps and detention
approximation reduce peak depth from 1.58 to 1.36 metres.
Block H17 crosses the threshold at 35 minutes and 53 seconds, compared with
31 minutes and 43 seconds in the baseline.
All 29 critical cells still cross eventually: this plan reduces severity and
delays this block's crossing, but does not eliminate flooding.”

## 1:30-1:55 / Mathematical modelling

Show a storage-and-flow diagram with water surface = terrain + depth and
new storage = old storage + inputs - outputs.

“Our model stores water as volume. Rain adds water; differences in water-surface
elevation drive transfers. Drains, pumps and outgoing flows share the available
water through one proportional limiter.
Transfers are debited from one region and credited to another. The engine checks
water balance every step, and 21 automated checks exercise the implementation.”

## 1:55-2:25 / Innovation and technical execution

Show AI plan search, Apply & verify, then the estimate and engine result. A new
plan can change the headline numbers: do not attribute default results to it.
Label any shortened computation wait.

“Beyond the listed features, an AI surrogate helps explore response plans.
It learned from simulated scenarios, with an average peak-depth error of about
six centimetres on 572 held-out engine runs.
We verify selected plans with the numerical engine, which runs in a Web Worker
to keep interaction responsive. The AI assists exploration; the engine computes
the water levels on the map.”

## 2:25-2:50 / Scope and close

Return to synchronized maps, retaining the correct scenario and scope labels.

“Local elevation and mapped infrastructure give our prototype Bengaluru context.
Hydraulic capacities remain assumptions, so this is a scenario-comparison tool,
not a validated forecast.
FLOWSHIELD makes response choices testable: the same storm, different
interventions, and an explainable comparison of what changes.”

## Brochure coverage and evidence

Source: Hack-a-Matics Brochure (1).pdf, FLOWSHIELD pages 6-7; evaluation and
submission rules page 11. These are project reference requirements.

| Brochure requirement | Current evidence / scope |
| --- | --- |
| Configurable rainfall intensity | Rainfall controls and schedules |
| Connected grid or regions | 315 cells and 594 undirected connections |
| Water accumulation and movement | Stored volumes and conservative transfers |
| Drainage and terrain | Drain capacity/opening and sampled terrain |
| Water levels over time | Time-stepped engine and saved frames |
| Safe / Warning / Critical | Configurable demonstration thresholds |
| Time-based visualization | Shared playback and risk timeline |
| Identify critical regions | Per-region classifications and summaries |
| Estimated time to critical | Step-resolved crossing, including initial and not-reached states |
| Bonus: normal rainfall | Normal-rain preset |
| Bonus: heavy rainfall | Heavy-storm preset |
| Bonus: drainage failure | Timed failure control |
| Bonus: blocked drainage channel | Simplified regional drainage restriction, not explicit channel hydraulics |
| Bonus: scenario comparison | Synchronized maps and comparison metrics |
| Bonus: affected population | Not implemented; building exposure is a distinct proxy |
| Bonus: interactive time slider | Playback slider |

Safe summary: “All nine core requirements, six listed bonus items at prototype
scope, and additional AI-assisted response exploration.” Do not claim all bonus
features or population estimates. Core coverage is not a claim of field accuracy.
Initial depths are supported by the engine contract; the current Bengaluru
scenario starts dry. Mapped drain geometry is contextual and does not determine
the simulated topology or measured drain capacities.

## Evaluation alignment

- Real-world impact: compare response choices and show residual risk.
- Technical execution: working controls, synchronized playback, worker execution
  and automated verification.
- Mathematical modelling: surface head, storage, simultaneous transfers,
  proportional availability limiting and water balance.
- Innovation: AI-assisted exploration plus numerical verification.
- Demonstration: actual input/output workflow and readable comparison results.
