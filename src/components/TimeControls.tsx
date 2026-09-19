import { useEffect } from "react";
import { formatModelTime } from "../app/format";

interface Props {
  readonly times: readonly number[];
  readonly index: number;
  readonly onIndex: (index: number) => void;
  readonly playing: boolean;
  readonly onPlaying: (playing: boolean) => void;
  readonly speed: number;
  readonly onSpeed: (speed: number) => void;
  readonly rainAtTime: number | null;
}

const SPEEDS = [1, 2, 4, 8] as const;

export function TimeControls(props: Props) {
  const { times, index, onIndex, playing, onPlaying, speed } = props;
  const last = times.length - 1;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      onIndex(Math.min(last, index + 1));
      if (index + 1 >= last) onPlaying(false);
    }, 120 / speed);
    return () => window.clearInterval(id);
  }, [playing, index, last, speed, onIndex, onPlaying]);

  const time = times[index] ?? 0;
  return (
    <div className="time-controls">
      <button
        type="button"
        className="btn btn-icon"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => {
          if (!playing && index >= last) onIndex(0);
          onPlaying(!playing);
        }}
        disabled={last < 1}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="time-readout">
        <span className="time-label">Model time</span>
        <span className="time-value">T+{formatModelTime(time)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, last)}
        value={index}
        onChange={(e) => {
          onPlaying(false);
          onIndex(Number(e.target.value));
        }}
        aria-label="Playback time"
        className="time-slider"
      />
      <div className="time-readout">
        <span className="time-label">Rain now</span>
        <span className="time-value">{props.rainAtTime === null ? "—" : `${props.rainAtTime} mm/h`}</span>
      </div>
      <div className="speed" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip${s === speed ? " is-on" : ""}`}
            onClick={() => props.onSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
