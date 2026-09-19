/** Model time is simulation seconds from t=0; never a wall-clock date. */
export function formatModelTime(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Human duration such as "1 h 05 min" or "12 min". */
export function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? "−" : "";
  const abs = Math.abs(Math.round(seconds));
  if (abs < 60) return `${sign}${abs} s`;
  const h = Math.floor(abs / 3600);
  const m = Math.round((abs % 3600) / 60);
  if (h === 0) return `${sign}${m} min`;
  return `${sign}${h} h ${String(m).padStart(2, "0")} min`;
}

export function formatDepth(m: number): string {
  return Math.abs(m) < 1 ? `${(m * 100).toFixed(1)} cm` : `${m.toFixed(2)} m`;
}

export function formatSigned(value: number, unit: string, digits = 2): string {
  const rounded = value.toFixed(digits);
  if (Number(rounded) === 0) return `0 ${unit}`;
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)} ${unit}`;
}

export function formatVolume(m3: number): string {
  const abs = Math.abs(m3);
  if (abs >= 1e6) return `${(m3 / 1e6).toFixed(2)} million m³`;
  if (abs >= 1000) return `${(m3 / 1000).toFixed(2)} ML`; // 1 ML = 1000 m³
  return `${m3.toFixed(abs < 1 ? 4 : 1)} m³`;
}

export function formatSci(value: number): string {
  return value === 0 ? "0" : value.toExponential(2);
}
