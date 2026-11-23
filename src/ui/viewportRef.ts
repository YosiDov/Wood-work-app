import type { Viewport } from '../engine/Viewport';

let current: Viewport | null = null;

export const setViewport = (v: Viewport | null) => {
  current = v;
};

export const getViewport = () => current;
