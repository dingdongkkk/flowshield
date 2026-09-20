/** The model in four equations, plus the checks that back the numbers. */
export function HowItWorks() {
  return (
    <details className="panel how">
      <summary><h2>How the model works</h2><span className="muted">Equations, checks and limits</span></summary>
      <div className="how-grid">
        <div>
          <h3>1 · Storage</h3>
          <p>Each 500 m cell stores a volume V. Depth is h = V / A, and the water surface is H = z + h, where z is the mean ground elevation from 9 DEM samples.</p>
          <p className="eq">dV/dt = rain + inflow − outflow − drains − pumps − edge outflow</p>
        </div>
        <div>
          <h3>2 · Flow between cells</h3>
          <p>Water moves down the water-surface difference between neighbours:</p>
          <p className="eq">q = G · (H<sub>i</sub> − H<sub>j</sub>) · f<sub>donor</sub></p>
          <p>G is a conductance (m²/s). f is 1, or lower where detention holds runoff back.</p>
        </div>
        <div>
          <h3>3 · Sharing scarce water</h3>
          <p>If a cell is asked for more water than it holds, every outflow (lateral, drains, pumps, edges) is scaled by the same factor:</p>
          <p className="eq">α = min(1, available / requested)</p>
        </div>
        <div>
          <h3>4 · Warnings</h3>
          <p>A cell is at warning at 10 cm and critical at 30 cm. The early warning is the first time a cell crosses each level. Lead time is the gap between the two.</p>
          <p className="eq">lead time = t<sub>critical</sub> − t<sub>warning</sub></p>
        </div>
      </div>
      <h3>Why you can trust the arithmetic</h3>
      <ul>
        <li><strong>Water balance:</strong> every step checks that storage = rain − drained − pumped − outflow. It fails loudly if the error exceeds 10⁻⁶ m³ plus a relative tolerance. The panel below shows the residual.</li>
        <li><strong>Stability:</strong> the time step stays below 0.45 · A / ΣG, and halving it gives the same peak depths.</li>
        <li><strong>Engine checks:</strong> 21 engine and integration checks (conservation, event timing, detention, upgrades, horizon changes, and AI limits) run with <code>npm test</code>.</li>
        <li><strong>AI surrogate:</strong> scored on hundreds of held-out engine runs it never saw during training.</li>
      </ul>
      <h3>What it does not model</h3>
      <p className="muted">Momentum and flow velocity, infiltration, the sewer network's real geometry, lakes as storage, inflow from beyond the area, and street-scale depth. Conductance, drain capacity and thresholds are assumptions, not calibrated values. Use it to compare scenarios, not as an operational forecast.</p>
    </details>
  );
}
