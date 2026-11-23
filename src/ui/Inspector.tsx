import { useMemo } from 'react';
import {
  Anchor,
  ChevronLeft,
  Circle,
  Copy,
  Crosshair,
  Group as GroupIcon,
  RotateCcw,
  RotateCw,
  Square,
  Trash2,
  TriangleAlert,
  Ungroup,
  X,
} from 'lucide-react';
import { groupTotalQ, useStore } from '../model/store';
import { analyze, STATUS_LABEL, type Analysis, type PartResult } from '../model/analysis';
import { autoLoad } from '../model/analysis';
import type { Group, Part, Project, Vec3 } from '../model/types';
import { TEMPLATE_MAP } from '../model/templates';
import { boxOfParts, boxSize, hasCut, longestAxis, quatToAngles } from '../model/geometry';
import { fromQ } from '../model/geometry';
import { wood } from '../model/woods';
import { NumField, Segmented, Slider, Toggle, WoodPicker } from './controls';
import { PartIcon, TemplateIcon, TipIcon } from './icons';
import { getViewport } from './viewportRef';

const kg = (v: number) => (v >= 100 ? Math.round(v).toLocaleString('he-IL') : (Math.round(v * 10) / 10).toLocaleString('he-IL'));
const kgUnit = (v: number) => (!Number.isFinite(v) ? '∞ ק״ג' : v >= 1000 ? `${(v / 1000).toFixed(1)} טון` : `${kg(v)} ק״ג`);
const mm = (v: number) => (Math.round(v * 10) / 10).toLocaleString('he-IL');
const nis = (v: number) => `₪${Math.round(v).toLocaleString('he-IL')}`;

export const Inspector = () => {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const analysis = useMemo(() => analyze(project), [project]);
  const deselect = () => useStore.getState().select({ kind: 'none' });

  let body: React.ReactNode;
  let key = 'project';
  if (selection.kind === 'group') {
    const g = project.groups.find((x) => x.id === selection.id);
    if (g) {
      body = <GroupInspector g={g} project={project} analysis={analysis} />;
      key = g.id;
    }
  } else if (selection.kind === 'parts') {
    if (selection.ids.length === 1) {
      const p = project.parts.find((x) => x.id === selection.ids[0]);
      if (p) {
        body = <PartInspector p={p} project={project} res={analysis.parts.get(p.id)} />;
        key = p.id;
      }
    } else if (selection.ids.length > 1) {
      body = <MultiInspector ids={selection.ids} project={project} analysis={analysis} />;
      key = 'multi';
    }
  }
  if (!body) body = <ProjectInspector project={project} analysis={analysis} />;
  return (
    <aside className={`inspector ${selection.kind !== 'none' ? 'has-sel' : ''}`} aria-label="מאפיינים">
      {selection.kind !== 'none' && (
        <button type="button" className="icon-btn insp-close" onClick={deselect} aria-label="בטל בחירה" title="בטל בחירה (Esc)">
          <X size={18} />
        </button>
      )}
      <div className="insp-scroll" key={key}>
        {body}
      </div>
    </aside>
  );
};

// ───────────────────────────────────────────────── part

const PartInspector = ({ p, project, res }: { p: Part; project: Project; res?: PartResult }) => {
  const st = useStore.getState();
  const g = p.groupId ? project.groups.find((x) => x.id === p.groupId) : null;
  const set = (patch: Partial<Part>) => st.updatePart(p.id, patch);
  const len = longestAxis(p.size);
  const setSize = (k: number, v: number) => {
    const size = [...p.size] as Vec3;
    size[k] = v;
    set({ size });
  };
  const setDia = (v: number) => {
    const size = [...p.size] as Vec3;
    for (let k = 0; k < 3; k++) if (k !== len) size[k] = v;
    set({ size });
  };
  const setPos = (k: number, v: number) => {
    const pos = [...p.pos] as Vec3;
    pos[k] = v;
    set({ pos });
  };
  const slotLabel = g?.template && p.matRole ? TEMPLATE_MAP[g.template].materials[p.matRole] : null;
  return (
    <>
      <header className="insp-head">
        <span className="insp-icon">
          <PartIcon kind={p.kind} />
        </span>
        <div className="insp-title">
          {g && (
            <button type="button" className="crumb" onClick={() => st.select({ kind: 'group', id: g.id })}>
              {g.name}
              <ChevronLeft size={14} />
            </button>
          )}
          <input className="title-input" value={p.name} aria-label="שם החלק" onChange={(e) => st.transient((pr) => ({ ...pr, parts: pr.parts.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)) }))} onFocus={() => st.beginTransient()} onKeyDown={(e) => e.stopPropagation()} />
        </div>
      </header>

      <section className="insp-sec">
        <WoodPicker value={p.wood} onChange={(w) => st.setPartWood(p.id, w)} label={slotLabel ? `עץ · ${slotLabel}` : 'עץ'} />
        {slotLabel && <p className="hint">משנה את כל חלקי ה{slotLabel} ב{g!.name}</p>}
      </section>

      <section className="insp-sec">
        <div className="fields3">
          {p.shape === 'rod' ? (
            <>
              <NumField label="אורך" value={p.size[len]} min={5} onCommit={(v) => setSize(len, v)} />
              <NumField label="קוטר" value={Math.min(...p.size.filter((_, k) => k !== len))} min={3} onCommit={setDia} />
            </>
          ) : (
            <>
              <NumField label="רוחב" value={p.size[0]} min={1} onCommit={(v) => setSize(0, v)} />
              <NumField label="גובה" value={p.size[1]} min={1} onCommit={(v) => setSize(1, v)} />
              <NumField label="עומק" value={p.size[2]} min={1} onCommit={(v) => setSize(2, v)} />
            </>
          )}
        </div>
        <div className="actions">
          <button type="button" className="act" onClick={() => getViewport()?.frame(true)} title="התמקד (F)">
            <Crosshair size={18} />
            <span>התמקד</span>
          </button>
          <button type="button" className="act" onClick={() => st.duplicateSelection()} title="שכפל (Ctrl+D)">
            <Copy size={18} />
            <span>שכפל</span>
          </button>
          <button type="button" className="act danger" onClick={() => st.deleteSelection()} title="מחק (Delete)">
            <Trash2 size={18} />
            <span>מחק</span>
          </button>
        </div>
      </section>

      <RotationPanel angles={quatToAngles(p.q)} />

      {p.shape === 'box' && (
        <details className="insp-sec fold" open={hasCut(p)}>
          <summary>חיתוך בזווית בקצוות</summary>
          <div className="fields3 two">
            <NumField label="קצה א׳" unit="°" value={p.cut?.[0] ?? 0} min={-75} max={75} step={5} onCommit={(v) => set({ cut: [v, p.cut?.[1] ?? 0] })} />
            <NumField label="קצה ב׳" unit="°" value={p.cut?.[1] ?? 0} min={-75} max={75} step={5} onCommit={(v) => set({ cut: [p.cut?.[0] ?? 0, v] })} />
          </div>
          <p className="hint">0 = חיתוך ישר. אותה זווית בשני הקצוות = קצוות מקבילים (כמו באיקס); זוויות הפוכות = חיתוך מיטר. האורך נמדד מקצה לקצה הארוך.</p>
        </details>
      )}

      {res && <StrengthCard p={p} res={res} project={project} />}

      <details className="insp-sec fold">
        <summary>מיקום ואפשרויות</summary>
        <div className="fields3">
          <NumField label="X" value={p.pos[0]} min={-100000} onCommit={(v) => setPos(0, v)} />
          <NumField label="מהרצפה" value={p.pos[1]} min={0} onCommit={(v) => setPos(1, v)} />
          <NumField label="Z" value={p.pos[2]} min={-100000} onCommit={(v) => setPos(2, v)} />
        </div>
        <div className="chips">
          <Segmented
            small
            label="צורה"
            value={p.shape}
            onChange={(v) => set({ shape: v })}
            options={[
              { value: 'box', label: 'מלבני', icon: <Square size={14} /> },
              { value: 'rod', label: 'עגול', icon: <Circle size={14} /> },
            ]}
          />
          <Segmented
            small
            label="תפקיד"
            value={p.role}
            onChange={(v) => set({ role: v })}
            options={[
              { value: 'structure', label: 'נושא', title: 'חלק נושא עומס — נבדק' },
              { value: 'front', label: 'חזית', title: 'דלת, חזית או ידית — לא נבדק' },
            ]}
          />
          <Toggle on={p.anchored} onChange={(v) => set({ anchored: v })} label="מעוגן לקיר" icon={<Anchor size={14} />} />
        </div>
      </details>
    </>
  );
};

// ───────────────────────────────────────────────── strength

const Meter = ({ label, value, limit, unit }: { label: string; value: number; limit: number; unit: string }) => {
  const r = limit > 0 ? value / limit : 0;
  const cls = r > 1 ? 'bad' : r > 0.7 ? 'warn' : 'ok';
  return (
    <div className="meter">
      <div className="meter-top">
        <span>{label}</span>
        <span className="meter-val" dir="ltr">
          {value < 10 ? value.toFixed(1) : Math.round(value)} / {limit < 10 ? limit.toFixed(1) : Math.round(limit)} {unit}
        </span>
      </div>
      <div className={`meter-bar ${cls}`}>
        <i style={{ width: `${Math.min(100, r * 100)}%` }} />
        <b style={{ insetInlineStart: '100%' }} />
      </div>
    </div>
  );
};

const STATUS_HINT: Partial<Record<PartResult['status'], string>> = {
  front: 'דלת, חזית או ידית. לא נושא עומס, ולכן לא נבדק.',
  angled: 'חלק משופע (בזווית). החוזק שלו לא מחושב; בדקו אותו בנפרד.',
  attached: 'מחובר מהצד בברגים. אין עליו עומס כפיפה לבדוק.',
  supported: 'נשען לכל אורכו, כך שאינו מתכופף.',
  anchored: 'מעוגן לקיר ומעביר אליו את העומס.',
  floating: 'החלק לא נוגע באף חלק אחר. הזיזו אותו עד שייצמד, או סמנו ״מעוגן לקיר״.',
};

const StrengthCard = ({ p, res, project }: { p: Part; res: PartResult; project: Project }) => {
  const st = useStore.getState();
  const w = wood(p.wood);
  const hint = STATUS_HINT[res.status];
  const showLoad = res.member !== 'none' && !p.anchored;
  const auto = autoLoad(p, project.designLoad);
  return (
    <section className={`insp-sec strength s-${res.status}`} aria-label="חוזק">
      <div className="str-head">
        <span className={`pill s-${res.status}`}>
          <i />
          {STATUS_LABEL[res.status]}
        </span>
        {(res.status === 'ok' || res.status === 'warn' || res.status === 'bad') && (
          <span className="str-max">
            {res.member === 'column' ? 'נושא עד ' : 'מחזיק עד '}
            <b>{kgUnit(res.maxLive)}</b>
            {res.member === 'beam' && <small>{p.loadType === 'point' ? ' בנקודה' : ' פזור'}</small>}
          </span>
        )}
      </div>
      {hint && <p className="hint">{hint}</p>}
      {res.overlaps.length > 0 && (
        <p className="hint warn-text">
          <TriangleAlert size={14} /> חופף לחלק אחר ({res.overlaps.length}). שני חלקים לא יכולים לתפוס אותו מקום.
        </p>
      )}

      {showLoad && (
        <div className="load-row">
          <NumField
            label="עומס עליו"
            unit="ק״ג"
            value={res.live}
            min={0}
            max={5000}
            step={5}
            onCommit={(v) => st.updatePart(p.id, { load: v })}
          />
          {res.member === 'beam' && (
            <Segmented
              small
              label="סוג עומס"
              value={p.loadType}
              onChange={(v) => st.updatePart(p.id, { loadType: v })}
              options={[
                { value: 'udl', label: 'פזור', title: 'עומס לאורך כל החלק (ספרים, כלים) — לטווח ארוך' },
                { value: 'point', label: 'נקודתי', title: 'עומס באמצע (אדם עומד/יושב) — לטווח קצר' },
              ]}
            />
          )}
          <button
            type="button"
            className={`chip ${p.load == null ? 'on' : ''}`}
            onClick={() => st.updatePart(p.id, { load: p.load == null ? auto : null })}
            title={`אוטומטי: ${project.designLoad} ק״ג למ״ר לפי שטח החלק`}
          >
            אוטו׳
          </button>
        </div>
      )}

      {res.member === 'beam' && res.sag !== undefined && res.sagLimit !== undefined && (
        <>
          <Meter label="שקיעה (כולל זחילה)" value={res.sag} limit={res.sagLimit} unit="מ״מ" />
          <Meter label="מאמץ כפיפה" value={res.stress ?? 0} limit={res.stressAllow ?? 1} unit="MPa" />
        </>
      )}
      {res.member === 'column' && res.stressAllow !== undefined && (res.status === 'ok' || res.status === 'warn' || res.status === 'bad') && (
        <Meter label="לחיצה וקריסה" value={res.stress ?? 0} limit={res.stressAllow / 1.4} unit="MPa" />
      )}

      {(res.status === 'ok' || res.status === 'warn' || res.status === 'bad') && (
        <details className="calc">
          <summary>החישוב</summary>
          <dl dir="rtl">
            {res.member === 'beam' ? (
              <>
                <dt>מפתח</dt>
                <dd>{mm(res.span ?? 0)} מ״מ</dd>
                <dt>סוג</dt>
                <dd>{res.segments.find((s) => s.U === res.U)?.kind === 'cant' ? 'זיז (קורה בולטת)' : 'קורה על שתי תמיכות'}</dd>
                <dt>מומנט התמד I</dt>
                <dd dir="ltr">{Math.round(res.I ?? 0).toLocaleString()} mm⁴</dd>
                <dt>מודול חתך W</dt>
                <dd dir="ltr">{Math.round(res.W ?? 0).toLocaleString()} mm³</dd>
              </>
            ) : (
              <>
                <dt>כוח לחיצה</dt>
                <dd>{kg(res.N ?? 0)} ק״ג</dd>
                <dt>אורך קריסה</dt>
                <dd>{mm(res.Lef ?? 0)} מ״מ</dd>
                <dt>מקדם קריסה k_c</dt>
                <dd dir="ltr">{(res.kc ?? 1).toFixed(3)}</dd>
              </>
            )}
            <dt>מודול אלסטיות E</dt>
            <dd dir="ltr">{w.E.toLocaleString()} MPa</dd>
            <dt>חוזק אופייני</dt>
            <dd dir="ltr">
              {res.member === 'beam' ? `f_m,k ${w.fmk}` : `f_c,0,k ${w.fck}`} MPa ({w.grade})
            </dd>
            <dt>מקדמים</dt>
            <dd dir="ltr">
              k_mod {p.loadType === 'point' && res.member === 'beam' ? w.kmodShort : w.kmodLong} · γM {w.gammaM} · k_def {w.kdef}
            </dd>
            <dt>משקל עצמי</dt>
            <dd>{kg(res.selfKg)} ק״ג</dd>
            {res.received > 0.05 && (
              <>
                <dt>עומס מחלקים מעליו</dt>
                <dd>{kg(res.received)} ק״ג</dd>
              </>
            )}
          </dl>
          <p className="formula" dir="ltr">
            {res.member === 'beam'
              ? 'σ = (1.35·M_G + 1.5·M_Q)/W ≤ k_mod·f_m,k/γM   ·   δ_fin = δ_G(1+k_def) + δ_Q(1+ψ₂k_def) ≤ L/300'
              : 'N·1.4 ≤ k_c·k_mod·f_c,0,k·A/γM'}
          </p>
          <p className="hint">לפי עקרונות EN 1995 (אירוקוד 5) בגישה פשוטה. לפרויקט נושא אחריות בטיחותית כדאי אישור מהנדס.</p>
        </details>
      )}
    </section>
  );
};

// ───────────────────────────────────────────────── group

const GroupInspector = ({ g, project, analysis }: { g: Group; project: Project; analysis: Analysis }) => {
  const st = useStore.getState();
  const parts = project.parts.filter((x) => x.groupId === g.id);
  const def = g.template ? TEMPLATE_MAP[g.template] : null;
  const bb = boxOfParts(parts);
  const size = bb ? boxSize(bb) : [0, 0, 0];
  const results = parts.map((x) => analysis.parts.get(x.id)).filter(Boolean) as PartResult[];
  const checked = results.filter((r) => ['ok', 'warn', 'bad'].includes(r.status));
  const worst = checked.reduce<PartResult | null>((a, r) => (!a || r.U > a.U ? r : a), null);
  const weak = results.filter((r) => r.status === 'bad' || r.status === 'warn' || r.status === 'floating').sort((a, b) => b.U - a.U);
  const anchored = parts.some((x) => x.anchored);
  const tipping = analysis.tipping.includes(g.id);
  const weight = parts.reduce((s, x) => s + (x.size[0] * x.size[1] * x.size[2] * (x.shape === 'rod' ? Math.PI / 4 : 1) * wood(x.wood).density) / 1e9, 0);
  return (
    <>
      <header className="insp-head">
        <span className="insp-icon">{def ? <TemplateIcon id={def.id} /> : <GroupIcon size={22} />}</span>
        <div className="insp-title">
          <input
            className="title-input"
            value={g.name}
            aria-label="שם הרהיט"
            onFocus={() => st.beginTransient()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => st.transient((pr) => ({ ...pr, groups: pr.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) }))}
          />
          <span className="sub" dir="rtl">
            {parts.length} חלקים · {kg(weight)} ק״ג
          </span>
        </div>
      </header>

      {worst && (
        <section className={`insp-sec strength s-${worst.status}`}>
          <div className="str-head">
            <span className={`pill s-${worst.status}`}>
              <i />
              {STATUS_LABEL[worst.status]}
            </span>
            <span className="str-max">החלק החלש: {project.parts.find((x) => x.id === worst.id)?.name}</span>
          </div>
          {weak.length > 0 && (
            <ul className="weak-list">
              {weak.slice(0, 3).map((r) => {
                const part = project.parts.find((x) => x.id === r.id)!;
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => st.select({ kind: 'parts', ids: [r.id] })}>
                      <i className={`dot s-${r.status}`} />
                      <span>{part.name}</span>
                      <small>{r.status === 'floating' ? 'לא מחובר' : `עד ${kgUnit(r.maxLive)}`}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {tipping && (
            <p className="hint warn-text">
              <TriangleAlert size={14} /> גבוה וצר: עלול להתהפך. מומלץ לעגן לקיר.
            </p>
          )}
        </section>
      )}

      {def ? (
        <section className="insp-sec">
          {g.custom && <p className="hint warn-text">נערך ידנית. שינוי מידה כאן יבנה את הרהיט מחדש.</p>}
          {def.params.map((ps) => {
            const v = g.params[ps.key] ?? def.defaults[ps.key];
            if (ps.kind === 'bool') return null;
            if (ps.kind === 'int')
              return (
                <NumField key={ps.key} label={ps.label} unit="" stepper value={Number(v)} min={ps.min} max={ps.max} step={1} onCommit={(nv) => st.setGroupParam(g.id, ps.key, Math.round(nv))} />
              );
            if (['W', 'H', 'D'].includes(ps.key))
              return (
                <Slider
                  key={ps.key}
                  label={ps.label}
                  value={Number(v)}
                  min={ps.min ?? 0}
                  max={ps.max ?? 3000}
                  step={ps.step ?? 10}
                  onStart={() => st.beginTransient()}
                  onLive={(nv) => st.setGroupParam(g.id, ps.key, nv, true)}
                  onCommit={(nv) => st.setGroupParam(g.id, ps.key, nv)}
                />
              );
            return <NumField key={ps.key} label={ps.label} value={Number(v)} min={ps.min} max={ps.max} step={ps.step} onCommit={(nv) => st.setGroupParam(g.id, ps.key, nv)} />;
          })}
          {def.params.some((ps) => ps.kind === 'bool') && (
            <div className="chips">
              {def.params
                .filter((ps) => ps.kind === 'bool')
                .map((ps) => (
                  <Toggle key={ps.key} on={Boolean(g.params[ps.key] ?? def.defaults[ps.key])} label={ps.label} onChange={(nv) => st.setGroupParam(g.id, ps.key, nv)} />
                ))}
            </div>
          )}
        </section>
      ) : (
        <section className="insp-sec">
          <div className="dims-read" dir="rtl">
            <span>רוחב {mm(size[0])}</span>
            <span>גובה {mm(size[1])}</span>
            <span>עומק {mm(size[2])}</span>
          </div>
        </section>
      )}

      <section className="insp-sec">
        {def ? (
          (Object.entries(def.materials) as [keyof typeof def.materials, string][]).map(([role, label]) => (
            <WoodPicker key={role} label={label} value={(g.params[role] ?? def.defaults[role] ?? 'pine') as never} onChange={(w) => st.setGroupWood(g.id, role, w)} />
          ))
        ) : (
          <WoodPicker label="עץ לכל החלקים" value={parts[0]?.wood ?? 'pine'} onChange={(w) => st.setGroupWood(g.id, 'wood', w)} />
        )}
      </section>

      <RotationPanel angles={g.template && !g.custom ? quatToAngles(fromQ(groupTotalQ(g))) : null} />

      <section className="insp-sec">
        <div className="actions">
          <button type="button" className="act" onClick={() => st.duplicateSelection()} title="שכפל (Ctrl+D)">
            <Copy size={18} />
            <span>שכפל</span>
          </button>
          <button type="button" className="act" onClick={() => getViewport()?.frame(true)} title="התמקד (F)">
            <Crosshair size={18} />
            <span>התמקד</span>
          </button>
          <button type="button" className="act danger" onClick={() => st.deleteSelection()} title="מחק (Delete)">
            <Trash2 size={18} />
            <span>מחק</span>
          </button>
        </div>
        <div className="chips">
          <Toggle on={anchored} onChange={(v) => st.anchorGroup(g.id, v)} label="מעוגן לקיר" icon={<Anchor size={14} />} />
          <button type="button" className="chip" onClick={() => st.ungroup(g.id)}>
            <Ungroup size={14} />
            <span>פרק לחלקים</span>
          </button>
        </div>
      </section>
    </>
  );
};

// ───────────────────────────────────────────────── multi

const MultiInspector = ({ ids, project, analysis }: { ids: string[]; project: Project; analysis: Analysis }) => {
  const st = useStore.getState();
  const parts = project.parts.filter((x) => ids.includes(x.id));
  const bb = boxOfParts(parts);
  const size = bb ? boxSize(bb) : [0, 0, 0];
  const bad = parts.filter((x) => analysis.parts.get(x.id)?.status === 'bad').length;
  return (
    <>
      <header className="insp-head">
        <span className="insp-icon">
          <GroupIcon size={22} />
        </span>
        <div className="insp-title">
          <strong className="title-static">{parts.length} חלקים</strong>
          <span className="sub">
            {mm(size[0])} × {mm(size[1])} × {mm(size[2])} מ״מ{bad ? ` · ${bad} חלשים` : ''}
          </span>
        </div>
      </header>
      <section className="insp-sec">
        <WoodPicker
          label="עץ לכולם"
          value={parts[0]?.wood ?? 'pine'}
          onChange={(w) => st.commit((p) => ({ ...p, parts: p.parts.map((x) => (ids.includes(x.id) ? { ...x, wood: w } : x)) }))}
        />
      </section>
      <section className="insp-sec">
        <div className="actions">
          <button type="button" className="act" onClick={() => st.groupSelection()} title="קבץ לרהיט אחד (Ctrl+G)">
            <GroupIcon size={18} />
            <span>קבץ</span>
          </button>
          <button type="button" className="act" onClick={() => st.duplicateSelection()}>
            <Copy size={18} />
            <span>שכפל</span>
          </button>
          <button type="button" className="act danger" onClick={() => st.deleteSelection()}>
            <Trash2 size={18} />
            <span>מחק</span>
          </button>
        </div>
      </section>
      <RotationPanel angles={null} />
    </>
  );
};

// ───────────────────────────────────────────────── rotation

const RotationPanel = ({ angles }: { angles: Vec3 | null }) => {
  const st = useStore.getState();
  const tool = useStore((s) => s.tool);
  const set = (k: number, v: number) => {
    if (!angles) return;
    const a = [...angles] as Vec3;
    a[k] = v;
    st.setRotation(a);
  };
  return (
    <section className="insp-sec rot-sec" aria-label="סיבוב">
      <div className="rot-head">
        <h3>סיבוב</h3>
        <button
          type="button"
          className={`chip ${tool === 'rotate' ? 'on' : ''}`}
          aria-pressed={tool === 'rotate'}
          onClick={() => st.set({ tool: tool === 'rotate' ? 'move' : 'rotate' })}
          title="טבעות סיבוב בתלת־ממד (R)"
        >
          <RotateCw size={14} />
          <span>טבעות</span>
        </button>
      </div>
      <div className="rot-steps">
        <button type="button" className="act" onClick={() => st.rotateSelection(1, 90)} title="90° נגד כיוון השעון">
          <RotateCcw size={18} />
          <span>90°</span>
        </button>
        <button type="button" className="act" onClick={() => st.rotateSelection(1, -90)} title="90° עם כיוון השעון">
          <RotateCw size={18} />
          <span>90°</span>
        </button>
        <button type="button" className="act" onClick={() => st.rotateSelection(0, 90)} title="השכב קדימה / העמד">
          <TipIcon size={18} />
          <span>קדימה</span>
        </button>
        <button type="button" className="act" onClick={() => st.rotateSelection(2, 90)} title="השכב על הצד">
          <span className="tip-side">
            <TipIcon size={18} />
          </span>
          <span>לצד</span>
        </button>
      </div>
      {angles && (
        <div className="fields3">
          <NumField label="סיבוב" unit="°" value={angles[0]} min={-360} max={360} step={15} onCommit={(v) => set(0, v)} />
          <NumField label="הטיה קדימה" unit="°" value={angles[1]} min={-360} max={360} step={15} onCommit={(v) => set(1, v)} />
          <NumField label="הטיה לצד" unit="°" value={angles[2]} min={-360} max={360} step={15} onCommit={(v) => set(2, v)} />
        </div>
      )}
      {tool === 'rotate' && <p className="hint">גררו טבעת צבעונית כדי לסובב. הסיבוב נצמד כל 15°.</p>}
    </section>
  );
};

// ───────────────────────────────────────────────── project

const ProjectInspector = ({ project, analysis }: { project: Project; analysis: Analysis }) => {
  const st = useStore.getState();
  const defaultWood = useStore((s) => s.defaultWood);
  const bb = boxOfParts(project.parts);
  const size = bb ? boxSize(bb) : null;
  const loose = project.parts.filter((p) => !p.groupId);
  const issues: { id: string; cls: string; text: string; ids: string[] }[] = [];
  if (analysis.bad.length) issues.push({ id: 'bad', cls: 's-bad', text: `${analysis.bad.length} חלקים חלשים`, ids: analysis.bad });
  if (analysis.warn.length) issues.push({ id: 'warn', cls: 's-warn', text: `${analysis.warn.length} גבוליים`, ids: analysis.warn });
  if (analysis.floating.length) issues.push({ id: 'float', cls: 's-floating', text: `${analysis.floating.length} לא מחוברים`, ids: analysis.floating });
  if (analysis.overlaps.length) issues.push({ id: 'ov', cls: 's-warn', text: `${analysis.overlaps.length} חפיפות`, ids: analysis.overlaps.flat() });
  return (
    <>
      <header className="insp-head project">
        <div className="insp-title">
          <span className="sub">הפרויקט</span>
          <strong className="title-static">{project.name}</strong>
        </div>
      </header>
      <section className="insp-sec stats">
        <div>
          <b>{project.parts.length}</b>
          <span>חלקים</span>
        </div>
        <div>
          <b>{kg(analysis.weight)}</b>
          <span>ק״ג</span>
        </div>
        <div>
          <b>{nis(analysis.cost)}</b>
          <span>עץ, הערכה</span>
        </div>
      </section>
      {size && (
        <p className="overall" dir="rtl">
          מידות כוללות: {mm(size[0])} × {mm(size[1])} × {mm(size[2])} מ״מ
        </p>
      )}

      <section className="insp-sec">
        <h3>חוזק</h3>
        {issues.length === 0 && project.parts.length > 0 && (
          <p className="all-good">
            <i className="dot s-ok" /> כל החלקים עומדים בעומס
          </p>
        )}
        {project.parts.length === 0 && <p className="hint">הוסיפו תבנית או קרש כדי להתחיל.</p>}
        <div className="issue-chips">
          {issues.map((i) => (
            <button key={i.id} type="button" className={`chip issue ${i.cls}`} onClick={() => st.select({ kind: 'parts', ids: [...new Set(i.ids)] })}>
              <i className="dot" />
              {i.text}
            </button>
          ))}
          {analysis.tipping.map((gid) => (
            <button key={gid} type="button" className="chip issue s-warn" onClick={() => st.select({ kind: 'group', id: gid })}>
              <TriangleAlert size={14} />
              {project.groups.find((g) => g.id === gid)?.name}: לעגן לקיר
            </button>
          ))}
        </div>
        <NumField
          label="עומס תכנון למדפים"
          unit="ק״ג/מ״ר"
          value={project.designLoad}
          min={0}
          max={1000}
          step={10}
          onCommit={(v) => st.commit((p) => ({ ...p, designLoad: v }))}
        />
        <p className="hint">100 ק״ג למ״ר ≈ מדף מלא ספרים. משמש לכל מדף שלא קבעתם לו עומס.</p>
      </section>

      <section className="insp-sec">
        <WoodPicker label="עץ לקרשים חדשים" value={defaultWood} onChange={(w) => st.set({ defaultWood: w })} />
      </section>

      {(project.groups.length > 0 || loose.length > 0) && (
        <section className="insp-sec">
          <h3>בפרויקט</h3>
          <ul className="outline">
            {project.groups.map((g) => {
              const n = project.parts.filter((p) => p.groupId === g.id).length;
              return (
                <li key={g.id}>
                  <button type="button" onClick={() => st.select({ kind: 'group', id: g.id })}>
                    {g.template ? <TemplateIcon id={g.template} size={18} /> : <GroupIcon size={18} />}
                    <span>{g.name}</span>
                    <small>{n}</small>
                  </button>
                </li>
              );
            })}
            {loose.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => st.select({ kind: 'parts', ids: [p.id] })}>
                  <PartIcon kind={p.kind} size={18} />
                  <span>{p.name}</span>
                  <small>{wood(p.wood).name}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
};
