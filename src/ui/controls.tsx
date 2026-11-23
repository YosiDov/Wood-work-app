import { useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { WoodId } from '../model/types';
import { WOODS, wood } from '../model/woods';
import { evalNumber } from '../model/geometry';
import { woodSwatch } from '../engine/textures';

const fmt = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

export const NumField = ({
  label,
  value,
  onCommit,
  unit = 'מ״מ',
  min = 0,
  max = 100000,
  step = 1,
  stepper = false,
  id,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  stepper?: boolean;
  id?: string;
}) => {
  const auto = useId();
  const fid = id ?? auto;
  const [text, setText] = useState(fmt(value));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);
  const commit = (t = text) => {
    const v = evalNumber(t);
    if (v === null) {
      setBad(true);
      return;
    }
    setBad(false);
    const c = Math.min(max, Math.max(min, v));
    setText(fmt(c));
    if (Math.abs(c - value) > 1e-6) onCommit(c);
  };
  const bump = (d: number) => {
    const c = Math.min(max, Math.max(min, value + d));
    onCommit(c);
  };
  return (
    <label className={`num ${bad ? 'bad' : ''}`} htmlFor={fid}>
      <span className="num-label">{label}</span>
      <span className="num-box">
        {stepper && (
          <button type="button" className="num-step" aria-label={`הוסף ${label}`} onClick={() => bump(step)}>
            <Plus size={14} />
          </button>
        )}
        <input
          id={fid}
          dir="ltr"
          inputMode="decimal"
          value={text}
          onFocus={(e) => {
            focused.current = true;
            e.target.select();
          }}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).select();
            } else if (e.key === 'Escape') {
              setText(fmt(value));
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              const c = Math.min(max, Math.max(min, value + d));
              setText(fmt(c));
              onCommit(c);
            }
          }}
        />
        {stepper && (
          <button type="button" className="num-step" aria-label={`הפחת ${label}`} onClick={() => bump(-step)}>
            <Minus size={14} />
          </button>
        )}
        {unit && <span className="num-unit">{unit}</span>}
      </span>
    </label>
  );
};

/** range slider that edits live and commits one undo step per gesture */
export const Slider = ({
  label,
  value,
  min,
  max,
  step,
  onStart,
  onLive,
  unit = 'מ״מ',
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onStart: () => void;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
  unit?: string;
}) => {
  const started = useRef(false);
  return (
    <div className="slider-row">
      <NumField label={label} value={value} min={min} max={max} step={step} unit={unit} onCommit={onCommit} />
      <input
        type="range"
        className="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => {
          started.current = true;
          onStart();
        }}
        onKeyDown={() => {
          if (!started.current) {
            started.current = true;
            onStart();
          }
        }}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={() => (started.current = false)}
        onBlur={() => (started.current = false)}
      />
    </div>
  );
};

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  small,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={`seg ${small ? 'seg-sm' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          title={o.title ?? o.label}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export const Toggle = ({ on, onChange, label, icon }: { on: boolean; onChange: (v: boolean) => void; label: string; icon?: React.ReactNode }) => (
  <button type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)}>
    {icon}
    <span>{label}</span>
  </button>
);

export const WoodSwatch = ({ id, size = 28 }: { id: WoodId; size?: number }) => (
  <span className="swatch" style={{ width: size, height: size, backgroundImage: `url(${woodSwatch(id)})` }} aria-hidden="true" />
);

export const WoodPicker = ({ value, onChange, label }: { value: WoodId; onChange: (w: WoodId) => void; label?: string }) => {
  const [open, setOpen] = useState(false);
  const w = wood(value);
  return (
    <div className={`woodpick ${open ? 'open' : ''}`}>
      <button type="button" className="woodpick-current" aria-expanded={open} onClick={() => setOpen(!open)}>
        <WoodSwatch id={value} size={30} />
        <span className="woodpick-name">
          {label && <small>{label}</small>}
          <b>{w.name}</b>
        </span>
        <span className="woodpick-grade" dir="ltr">
          {w.grade}
        </span>
      </button>
      {open && (
        <div className="woodgrid" role="listbox" aria-label="סוג עץ">
          {WOODS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              className={o.id === value ? 'on' : ''}
              title={`${o.name} · ${o.latin} · ${o.density} ק״ג/מ״ק · E ${o.E.toLocaleString()} MPa`}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              <WoodSwatch id={o.id} size={34} />
              <span>{o.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
