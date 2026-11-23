import { useEffect, useRef, useState } from 'react';
import {
  CircleHelp,
  ClipboardList,
  Crosshair,
  FilePlus2,
  FolderOpen,
  ImageDown,
  LayoutGrid,
  Minus,
  Move,
  Plus,
  Redo2,
  Ruler,
  Save,
  Sheet,
  Undo2,
  X,
} from 'lucide-react';
import { useStore } from '../model/store';
import type { PartKind, ViewMode } from '../model/types';
import { TEMPLATES } from '../model/templates';
import { cutList } from '../model/cutlist';
import { SHEET_AREA_M2, wood } from '../model/woods';
import { ExplodeIcon, Logo, PartIcon, ResizeIcon, StrengthIcon, TemplateIcon } from './icons';
import { WoodSwatch } from './controls';
import { getViewport } from './viewportRef';
import { saveCutList, saveImage, saveProjectFile } from '../io/files';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export const doSave = async () => {
  const st = useStore.getState();
  const { result, name } = await saveProjectFile(st.project);
  if (result === 'saved') st.toastMsg(`נשמר: ${name}`);
  else if (result === 'failed') st.toastMsg('השמירה לא הצליחה. נסו שוב.', 'bad');
};

export const doNew = () => {
  const st = useStore.getState();
  st.newProject();
  st.toastMsg('פרויקט חדש', 'ok', { label: 'בטל', run: () => useStore.getState().undo() });
};

// ───────────────────────────────────────────────── top bar

export const TopBar = ({ onOpen }: { onOpen: () => void }) => {
  const name = useStore((s) => s.project.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const st = useStore.getState();
  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <h1>עבודות עץ של מושקי</h1>
      </div>
      <input
        className="project-name"
        value={name}
        aria-label="שם הפרויקט"
        onFocus={() => st.beginTransient()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onChange={(e) => st.transient((p) => ({ ...p, name: e.target.value }))}
      />
      <div className="top-actions">
        <button type="button" className="icon-btn" onClick={st.undo} disabled={!canUndo} title="בטל (Ctrl+Z)" aria-label="בטל">
          <Undo2 size={19} />
        </button>
        <button type="button" className="icon-btn hide-phone" onClick={st.redo} disabled={!canRedo} title="שחזר (Ctrl+Y)" aria-label="שחזר">
          <Redo2 size={19} />
        </button>
        <span className="sep" />
        <button type="button" className="icon-btn" onClick={doNew} title="פרויקט חדש" aria-label="פרויקט חדש">
          <FilePlus2 size={19} />
        </button>
        <button type="button" className="icon-btn" onClick={onOpen} title="פתח קובץ (Ctrl+O)" aria-label="פתח קובץ">
          <FolderOpen size={19} />
        </button>
        <button
          type="button"
          className="icon-btn hide-phone"
          title="שמור תמונה"
          aria-label="שמור תמונה"
          onClick={async () => {
            const v = getViewport();
            if (!v) return;
            const r = await saveImage(useStore.getState().project, v.snapshot());
            if (r === 'saved') useStore.getState().toastMsg('התמונה נשמרה');
          }}
        >
          <ImageDown size={19} />
        </button>
        <button type="button" className="btn-tape" onClick={doSave} title="שמור קובץ Collada (Ctrl+S)">
          <Save size={18} />
          <span>שמירה</span>
        </button>
        <button type="button" className="icon-btn" onClick={() => st.set({ panel: 'help' })} title="עזרה" aria-label="עזרה">
          <CircleHelp size={19} />
        </button>
      </div>
    </header>
  );
};

// ───────────────────────────────────────────────── tool rail

const PARTS: { kind: PartKind; label: string; hint: string }[] = [
  { kind: 'board', label: 'קרש', hint: 'קרש 800×150×20' },
  { kind: 'sheet', label: 'לוח', hint: 'לוח 600×400×18' },
  { kind: 'beam', label: 'קורה', hint: 'קורה / רגל 45×45×720' },
  { kind: 'rod', label: 'מוט', hint: 'מוט עגול Ø28' },
];

export const ToolRail = () => {
  const panel = useStore((s) => s.panel);
  const st = useStore.getState();
  return (
    <nav className="rail" aria-label="הוספה">
      <button type="button" className={`rail-btn primary ${panel === 'templates' ? 'on' : ''}`} onClick={() => st.set({ panel: panel === 'templates' ? null : 'templates' })} title="תבניות רהיטים">
        <LayoutGrid size={22} />
        <span>תבניות</span>
      </button>
      <span className="rail-sep" />
      {PARTS.map((p) => (
        <button key={p.kind} type="button" className="rail-btn" onClick={() => st.addPart(p.kind)} title={`הוסף ${p.hint}`}>
          <PartIcon kind={p.kind} size={24} />
          <span>{p.label}</span>
        </button>
      ))}
      <span className="rail-grow" />
      <div className="rail-zoom">
        <button type="button" className="icon-btn" onClick={() => getViewport()?.zoomBy(1.25)} aria-label="התקרב" title="התקרב">
          <Plus size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={() => getViewport()?.zoomBy(0.8)} aria-label="התרחק" title="התרחק">
          <Minus size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={() => getViewport()?.frame(true, false)} aria-label="הצג הכל" title="הצג הכל (F)">
          <Crosshair size={18} />
        </button>
      </div>
    </nav>
  );
};

// ───────────────────────────────────────────────── bottom toolbar

const VIEWS: { v: ViewMode; label: string }[] = [
  { v: 'persp', label: '3D' },
  { v: 'front', label: 'חזית' },
  { v: 'side', label: 'צד' },
  { v: 'top', label: 'על' },
];

export const BottomBar = () => {
  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const strength = useStore((s) => s.strength);
  const dims = useStore((s) => s.dims);
  const explode = useStore((s) => s.explode);
  const panel = useStore((s) => s.panel);
  const st = useStore.getState();
  const [showExplode, setShowExplode] = useState(false);
  return (
    <div className="dock" role="toolbar" aria-label="כלים">
      <div className="dock-group" role="radiogroup" aria-label="כלי">
        <button type="button" role="radio" aria-checked={tool === 'move'} className={`dock-btn ${tool === 'move' ? 'on' : ''}`} onClick={() => st.set({ tool: 'move' })} title="הזזה (G)">
          <Move size={19} />
          <span>הזזה</span>
        </button>
        <button type="button" role="radio" aria-checked={tool === 'resize'} className={`dock-btn ${tool === 'resize' ? 'on' : ''}`} onClick={() => st.set({ tool: 'resize' })} title="מתיחה (S)">
          <ResizeIcon size={19} />
          <span>מתיחה</span>
        </button>
      </div>
      <div className="dock-group views" role="radiogroup" aria-label="מבט">
        {VIEWS.map((x, i) => (
          <button key={x.v} type="button" role="radio" aria-checked={view === x.v} className={`dock-btn txt ${view === x.v ? 'on' : ''}`} onClick={() => st.set({ view: x.v })} title={`${x.label} (${i + 1})`}>
            <span>{x.label}</span>
          </button>
        ))}
      </div>
      <div className="dock-group">
        <button type="button" aria-pressed={strength} className={`dock-btn strength-btn ${strength ? 'on' : ''}`} onClick={() => st.set({ strength: !strength })} title="בדיקת חוזק (B)">
          <StrengthIcon size={19} />
          <span>חוזק</span>
        </button>
        <button type="button" aria-pressed={dims} className={`dock-btn ${dims ? 'on' : ''}`} onClick={() => st.set({ dims: !dims })} title="מידות (M)">
          <Ruler size={19} />
          <span>מידות</span>
        </button>
        <div className="explode-wrap">
          <button
            type="button"
            aria-pressed={explode > 0}
            aria-expanded={showExplode}
            className={`dock-btn ${explode > 0 ? 'on' : ''}`}
            onClick={() => {
              if (!showExplode && explode === 0) st.set({ explode: 0.5 });
              setShowExplode(!showExplode);
            }}
            title="פירוק לחלקים"
          >
            <ExplodeIcon size={19} />
            <span>פירוק</span>
          </button>
          {showExplode && (
            <div className="pop explode-pop">
              <input type="range" min={0} max={1.5} step={0.01} value={explode} aria-label="מרחק פירוק" onChange={(e) => st.set({ explode: Number(e.target.value) })} />
              <button
                type="button"
                className="icon-btn"
                aria-label="סגור פירוק"
                onClick={() => {
                  st.set({ explode: 0 });
                  setShowExplode(false);
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
        </div>
        <button type="button" className={`dock-btn ${panel === 'cutlist' ? 'on' : ''}`} onClick={() => st.set({ panel: panel === 'cutlist' ? null : 'cutlist' })} title="רשימת חיתוך">
          <ClipboardList size={19} />
          <span>חיתוך</span>
        </button>
      </div>
    </div>
  );
};

export const StrengthLegend = () => {
  const on = useStore((s) => s.strength);
  if (!on) return null;
  return (
    <div className="legend" aria-label="מקרא חוזק">
      <div className="legend-bar" />
      <div className="legend-labels">
        <span>חזק</span>
        <span>גבולי</span>
        <span>חלש</span>
      </div>
      <p>
        המספר על כל מדף = כמה ק״ג הוא מחזיק. השקיעה מוצגת מוגדלת <b dir="ltr">×10</b>
      </p>
    </div>
  );
};

// ───────────────────────────────────────────────── template gallery

const tplDims = (d: Record<string, unknown>) => `${Number(d.W) / 10}×${Number(d.H) / 10}×${Number(d.D) / 10}`;

export const TemplateGallery = () => {
  const panel = useStore((s) => s.panel);
  const st = useStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panel === 'templates') ref.current?.querySelector('button')?.focus();
  }, [panel]);
  if (panel !== 'templates') return null;
  return (
    <div className="sheet-back" onClick={() => st.set({ panel: null })}>
      <div className="sheet templates" role="dialog" aria-label="תבניות" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>תבניות</h2>
          <button type="button" className="icon-btn" onClick={() => st.set({ panel: null })} aria-label="סגור">
            <X size={18} />
          </button>
        </div>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="tpl" onClick={() => st.addTemplate(t.id)}>
              <span className="tpl-art">
                <TemplateIcon id={t.id} size={44} />
              </span>
              <b>{t.name}</b>
              <small dir="ltr">{tplDims(t.defaults)} ס״מ</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────── cut list

export const CutListPanel = () => {
  const panel = useStore((s) => s.panel);
  const project = useStore((s) => s.project);
  const st = useStore.getState();
  if (panel !== 'cutlist') return null;
  const { rows, totals } = cutList(project);
  const weight = totals.reduce((s, t) => s + t.weight, 0);
  const cost = totals.reduce((s, t) => s + t.cost, 0);
  return (
    <div className="sheet-back" onClick={() => st.set({ panel: null })}>
      <div className="sheet cutlist" role="dialog" aria-label="רשימת חיתוך" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>רשימת חיתוך</h2>
          <span className="sheet-sub">
            {rows.reduce((s, r) => s + r.qty, 0)} חלקים · {Math.round(weight * 10) / 10} ק״ג · ₪{Math.round(cost).toLocaleString('he-IL')}
          </span>
          <button
            type="button"
            className="btn-tape small"
            onClick={async () => {
              const r = await saveCutList(project);
              if (r === 'saved') st.toastMsg('רשימת החיתוך נשמרה');
            }}
          >
            <Sheet size={16} />
            <span>CSV</span>
          </button>
          <button type="button" className="icon-btn" onClick={() => st.set({ panel: null })} aria-label="סגור">
            <X size={18} />
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>כמות</th>
                <th>חלק</th>
                <th>אורך</th>
                <th>רוחב</th>
                <th>עובי</th>
                <th>חומר</th>
                <th>ק״ג</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} onClick={() => st.select({ kind: 'parts', ids: r.ids })}>
                  <td className="qty">×{r.qty}</td>
                  <td className="names">{r.names.join(' · ')}</td>
                  <td className="n">{Math.round(r.L * 10) / 10}</td>
                  <td className="n">{r.round ? `Ø${Math.round(r.W * 10) / 10}` : Math.round(r.W * 10) / 10}</td>
                  <td className="n">{r.round ? '' : Math.round(r.T * 10) / 10}</td>
                  <td>
                    <span className="mat-cell">
                      <WoodSwatch id={r.wood} size={18} />
                      {wood(r.wood).name}
                    </span>
                  </td>
                  <td className="n">{Math.round(r.weight * 10) / 10}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="totals">
          {totals.map((t) => (
            <div key={t.wood} className="total">
              <WoodSwatch id={t.wood} size={26} />
              <div>
                <b>{wood(t.wood).name}</b>
                <span>
                  {plural(t.pieces, 'חלק אחד', 'חלקים')} · {t.sheets ? plural(t.sheets, 'גיליון אחד', 'גיליונות') : `${(t.volume * 1000).toFixed(1)} ליטר עץ`}
                </span>
              </div>
              <PriceField woodId={t.wood} />
            </div>
          ))}
        </div>
        <p className="hint">מידות במ״מ. גיליון = 244×122 ס״מ ({Math.round(SHEET_AREA_M2 * 100) / 100} מ״ר), כולל 15% פחת. המחירים הם הערכה; אפשר לעדכן מחיר למ״ק.</p>
      </div>
    </div>
  );
};

const PriceField = ({ woodId }: { woodId: ReturnType<typeof wood>['id'] }) => {
  const price = useStore((s) => s.project.prices[woodId] ?? wood(woodId).price);
  const [text, setText] = useState(String(price));
  useEffect(() => setText(String(price)), [price]);
  return (
    <label className="price">
      <span>₪ למ״ק</span>
      <input
        dir="ltr"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => {
          const v = Number(text);
          if (Number.isFinite(v) && v >= 0) useStore.getState().commit((p) => ({ ...p, prices: { ...p.prices, [woodId]: v } }));
          else setText(String(price));
        }}
      />
    </label>
  );
};

// ───────────────────────────────────────────────── help

export const HelpPanel = () => {
  const panel = useStore((s) => s.panel);
  const hosted = useStore((s) => s.hosted);
  const st = useStore.getState();
  if (panel !== 'help') return null;
  const rows: [string, string][] = [
    ['לחיצה', 'בחירת רהיט. לחיצה נוספת: חלק בודד'],
    ['גרירה על הרקע', 'סיבוב המבט · ימני / שתי אצבעות: הזזה · גלגלת / צביטה: זום'],
    ['חיצים צבעוניים', 'הזזה. נצמד אוטומטית לחלקים הסמוכים'],
    ['עיגולים צהובים', 'במצב מתיחה: גוררים כדי לשנות מידה'],
    ['סרט מדידה צהוב', 'לוחצים על המספר כדי להקליד מידה'],
    ['שדות מספר', 'אפשר לכתוב חשבון, למשל 900-2*18'],
    ['G / S', 'הזזה / מתיחה'],
    ['R', 'סיבוב 90°'],
    ['Ctrl+D · Delete', 'שכפול · מחיקה'],
    ['Ctrl+Z · Ctrl+Y', 'ביטול · שחזור'],
    ['חיצים · PageUp/Down', 'הזזה של 10 מ״מ (Shift: 1 מ״מ)'],
    ['1 2 3 4', 'מבט 3D · חזית · צד · על'],
    ['B · M · F', 'חוזק · מידות · התמקדות'],
    ['Ctrl+S · Ctrl+O', 'שמירה · פתיחה'],
  ];
  return (
    <div className="sheet-back" onClick={() => st.set({ panel: null })}>
      <div className="sheet help" role="dialog" aria-label="עזרה" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>איך עובדים</h2>
          <button type="button" className="icon-btn" onClick={() => st.set({ panel: null })} aria-label="סגור">
            <X size={18} />
          </button>
        </div>
        <dl className="keys">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <h3>קבצים</h3>
        <p>
          השמירה יוצרת קובץ Collada (<span dir="ltr">.dae</span>) שנפתח גם ב-Blender, SketchUp ו-FreeCAD. בתוך הקובץ נשמר גם הפרויקט המלא, כך שכשפותחים אותו כאן חוזרים
          סוגי העץ, התבניות והעומסים.
          {hosted && ' בגרסת הקישור הקובץ נשמר בתוך ‎.zip; האפליקציה פותחת אותו ישירות.'} אפשר גם לגרור לכאן קובץ <span dir="ltr">.dae</span> מתוכנה אחרת: כל אובייקט יהפוך לקרש.
        </p>
        <h3>חישוב החוזק</h3>
        <p>
          כל חלק נבדק כקורה או כעמוד לפי EN 1995 (אירוקוד 5): כפיפה, שקיעה לטווח ארוך כולל זחילה (מגבלה L/300), וקריסה של רגליים ודפנות. העומס עובר מלמעלה למטה דרך
          החלקים שנוגעים זה בזה. זה כלי תכנון; לרהיט שאנשים עומדים או נתלים עליו כדאי לבקש אישור מהנדס.
        </p>
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────── toast

export const ToastView = () => {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`toast t-${toast.kind}`} role="status">
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.run();
            useStore.getState().set({ toast: null });
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
};

export const EmptyState = () => {
  const empty = useStore((s) => s.project.parts.length === 0);
  const st = useStore.getState();
  if (!empty) return null;
  return (
    <div className="empty">
      <Logo size={56} />
      <div className="empty-actions">
        <button type="button" className="btn-tape" onClick={() => st.set({ panel: 'templates' })}>
          <LayoutGrid size={18} />
          <span>בחרו תבנית</span>
        </button>
        <button type="button" className="btn-ghost" onClick={() => st.addPart('board')}>
          <PartIcon kind="board" size={20} />
          <span>או התחילו מקרש</span>
        </button>
      </div>
    </div>
  );
};
