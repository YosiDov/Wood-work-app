import { useEffect, useRef, useState } from 'react';
import { Viewport } from '../engine/Viewport';
import { useStore } from '../model/store';
import { openProjectFile } from '../io/files';
import { setViewport } from './viewportRef';
import { Inspector } from './Inspector';
import { BottomBar, CutListPanel, EmptyState, HelpPanel, StrengthLegend, TemplateGallery, ToastView, ToolRail, TopBar, doSave } from './Chrome';

const VIEW_KEYS = ['persp', 'front', 'side', 'top'] as const;

export const App = () => {
  const host = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [glFailed, setGlFailed] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    let v: Viewport | null = null;
    try {
      v = new Viewport(host.current);
      setViewport(v);
    } catch {
      setGlFailed(true);
    }
    return () => {
      setViewport(null);
      v?.dispose();
    };
  }, []);

  const openFile = async (file: File) => {
    const st = useStore.getState();
    try {
      const { project, native } = await openProjectFile(file);
      st.loadProject(project);
      st.toastMsg(native ? `נפתח: ${project.name}` : `יובאו ${project.parts.length} חלקים כקרשים מ-${file.name}`, 'ok', { label: 'בטל', run: () => useStore.getState().undo() });
    } catch {
      st.toastMsg('לא הצלחתי לקרוא את הקובץ. אפשר לפתוח ‎.dae, ‎.zip או ‎.json', 'bad');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const code = e.code;
      if (mod && (k === 'z' || code === 'KeyZ')) {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && (k === 'y' || code === 'KeyY')) {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && code === 'KeyS') {
        e.preventDefault();
        void doSave();
        return;
      }
      if (mod && code === 'KeyO') {
        e.preventDefault();
        fileInput.current?.click();
        return;
      }
      if (mod && code === 'KeyD') {
        e.preventDefault();
        st.duplicateSelection();
        return;
      }
      if (mod && code === 'KeyA') {
        e.preventDefault();
        st.selectAll();
        return;
      }
      if (mod && code === 'KeyG') {
        e.preventDefault();
        st.groupSelection();
        return;
      }
      if (mod) return;
      if (e.key === 'Escape') {
        if (st.panel) st.set({ panel: null });
        else st.select({ kind: 'none' });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        st.deleteSelection();
        return;
      }
      const step = e.shiftKey ? 1 : 10;
      const arrows: Record<string, [number, number, number]> = {
        ArrowLeft: [-step, 0, 0],
        ArrowRight: [step, 0, 0],
        ArrowUp: [0, 0, -step],
        ArrowDown: [0, 0, step],
        PageUp: [0, step, 0],
        PageDown: [0, -step, 0],
      };
      if (arrows[e.key] && st.selection.kind !== 'none') {
        e.preventDefault();
        st.nudgeSelection(arrows[e.key]);
        return;
      }
      switch (code) {
        case 'KeyG':
          st.set({ tool: 'move' });
          break;
        case 'KeyS':
          st.set({ tool: 'resize' });
          break;
        case 'KeyR':
          // first press picks the rotate tool, the next ones turn 90°
          if (st.tool !== 'rotate') st.set({ tool: 'rotate' });
          else st.rotateSelection(1, e.shiftKey ? -90 : 90);
          break;
        case 'KeyB':
          st.set({ strength: !st.strength });
          break;
        case 'KeyM':
          st.set({ dims: !st.dims });
          break;
        case 'KeyF':
          st.set({ frameTick: st.frameTick + 1 });
          break;
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
        case 'Digit4':
          st.set({ view: VIEW_KEYS[Number(code.slice(-1)) - 1] });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app" dir="rtl" lang="he">
      <TopBar onOpen={() => fileInput.current?.click()} />
      <main className="stage">
        <ToolRail />
        <div
          className={`view ${dragOver ? 'drag' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void openFile(f);
          }}
        >
          <div className="gl-host" ref={host} />
          {glFailed && <p className="gl-fail">הדפדפן לא תומך בתלת־ממד (WebGL). נסו Chrome, Edge או Safari עדכניים.</p>}
          <EmptyState />
          <StrengthLegend />
          <BottomBar />
          <ToastView />
          {dragOver && <div className="drop">שחררו כאן כדי לפתוח</div>}
        </div>
        <Inspector />
      </main>
      <TemplateGallery />
      <CutListPanel />
      <HelpPanel />
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".dae,.zae,.zip,.json,model/vnd.collada+xml"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
};
