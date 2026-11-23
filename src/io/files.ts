import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project } from '../model/types';
import { exportCollada, importCollada, sanitizeProject } from './collada';
import { cutListCSV } from '../model/cutlist';

type DownloadsNS = { save: (r: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }) => Promise<unknown> };
type ClaudeWin = { claude?: { use?: (n: string) => Promise<unknown> } };

let downloadsPromise: Promise<DownloadsNS | null> | null = null;

/** inside the claude.ai viewer, files go through the `downloads` capability */
const downloads = (): Promise<DownloadsNS | null> => {
  if (!downloadsPromise) {
    const c = (window as unknown as ClaudeWin).claude;
    downloadsPromise = c?.use ? (c.use('downloads') as Promise<DownloadsNS | null>).catch(() => null) : Promise.resolve(null);
  }
  return downloadsPromise;
};

export const isHosted = () => !!(window as unknown as ClaudeWin).claude?.use;

export type SaveResult = 'saved' | 'declined' | 'failed';

const saveFile = async (filename: string, data: Uint8Array | string, mime: string): Promise<SaveResult> => {
  const dl = await downloads();
  if (dl) {
    try {
      await dl.save({ filename, data });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string })?.code;
      return code === 'declined' ? 'declined' : 'failed';
    }
  }
  // Chrome / Edge: native save dialog (keeps Hebrew file names, lets you pick the folder)
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (d: unknown) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  if (picker && window.self === window.top) {
    try {
      const ext = filename.slice(filename.lastIndexOf('.'));
      const handle = await picker.call(window, { suggestedName: filename, types: [{ description: ext.slice(1).toUpperCase(), accept: { [mime]: [ext] } }] });
      const w = await handle.createWritable();
      await w.write(data);
      await w.close();
      return 'saved';
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'declined';
    }
  }
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
};

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'project';

/**
 * Save the project as Collada. Offline: a plain .dae file. Inside claude.ai the viewer only
 * allows certain file types, so the same .dae goes inside a .zip (a zipped-Collada package that
 * Blender and SketchUp can read after unzipping, and that this app opens directly).
 */
export const saveProjectFile = async (p: Project): Promise<{ result: SaveResult; name: string }> => {
  const dae = exportCollada(p);
  const base = safeName(p.name);
  if (await downloads()) {
    const zip = zipSync({
      'project.dae': strToU8(dae),
      'manifest.xml': strToU8('<?xml version="1.0" encoding="utf-8"?>\n<dae_root>./project.dae</dae_root>\n'),
    });
    const name = `${base}.zip`;
    return { result: await saveFile(name, zip, 'application/zip'), name };
  }
  const name = `${base}.dae`;
  return { result: await saveFile(name, dae, 'model/vnd.collada+xml'), name };
};

export const saveCutList = (p: Project) => saveFile(`${safeName(p.name)} - רשימת חיתוך.csv`, cutListCSV(p), 'text/csv');

export const saveImage = async (p: Project, dataUrl: string) => {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return saveFile(`${safeName(p.name)}.png`, bytes, 'image/png');
};

export const openProjectFile = async (file: File): Promise<{ project: Project; native: boolean }> => {
  const name = file.name.toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith('.zip') || name.endsWith('.zae') || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const files = unzipSync(buf);
    const entry = Object.keys(files).find((k) => k.toLowerCase().endsWith('.dae'));
    if (!entry) {
      const json = Object.keys(files).find((k) => k.toLowerCase().endsWith('.json'));
      if (json) return { project: sanitizeProject(JSON.parse(strFromU8(files[json]))), native: true };
      throw new Error('no dae');
    }
    return importCollada(strFromU8(files[entry]), file.name);
  }
  const text = strFromU8(buf);
  if (name.endsWith('.json') || text.trimStart().startsWith('{')) return { project: sanitizeProject(JSON.parse(text)), native: true };
  return importCollada(text, file.name);
};
