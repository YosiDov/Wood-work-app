import type { PartKind, TemplateId } from '../model/types';

type P = { size?: number; className?: string };

const S = ({ size = 24, className, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
);

/** log end-grain mark used as the app logo */
export const Logo = ({ size = 34 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="18.5" fill="#b9874f" />
    <circle cx="20" cy="20" r="15.5" fill="#e9c58f" />
    <path d="M20 7.5a12.5 12.5 0 1 1-12.4 14.2" fill="none" stroke="#c8965d" strokeWidth="1.6" />
    <path d="M20 11a9 9 0 1 1-8.7 11.2" fill="none" stroke="#c8965d" strokeWidth="1.5" />
    <path d="M20 14.6a5.4 5.4 0 1 1-5.2 6.9" fill="none" stroke="#c8965d" strokeWidth="1.4" />
    <circle cx="20" cy="20" r="1.9" fill="#a8743f" />
    <path d="M20 20 31 9" stroke="#1b2621" strokeWidth="1.2" opacity=".35" />
    <rect x="26" y="25.5" width="13" height="5" rx="1" fill="#f3c623" transform="rotate(-35 32.5 28)" />
    <path d="M28.2 29.6l.9 1.3M30.3 28.2l.9 1.3M32.4 26.7l.9 1.3M34.5 25.2l.9 1.3" stroke="#191710" strokeWidth=".8" />
  </svg>
);

export const PartIcon = ({ kind, ...p }: P & { kind: PartKind }) => {
  switch (kind) {
    case 'board':
      return (
        <S {...p}>
          <path d="M2.5 14.5 15 8l6.5 2.5L9 17z" />
          <path d="M2.5 14.5v1.8L9 18.8V17M9 18.8l12.5-6.5v-1.8" />
          <path d="M6.5 13.6l9-4.6" opacity=".45" />
        </S>
      );
    case 'sheet':
      return (
        <S {...p}>
          <path d="M3 13 13 6.5l8 3.5-10 6.5z" />
          <path d="M3 13v1.6l8 3.6V16.5M11 18.2l10-6.6V10" />
        </S>
      );
    case 'beam':
      return (
        <S {...p}>
          <path d="M9 4.5 12 3l3 1.5L12 6z" />
          <path d="M9 4.5v15L12 21l3-1.5v-15M12 6v15" />
        </S>
      );
    case 'rod':
      return (
        <S {...p}>
          <ellipse cx="5.5" cy="12" rx="2" ry="3.4" />
          <path d="M5.5 8.6h13M5.5 15.4h13" />
          <path d="M18.5 8.6a2 3.4 0 0 1 0 6.8" />
        </S>
      );
  }
};

export const TemplateIcon = ({ id, ...p }: P & { id: TemplateId }) => {
  switch (id) {
    case 'bookcase':
      return (
        <S {...p}>
          <rect x="5" y="2.5" width="14" height="19" rx=".5" />
          <path d="M5 7.5h14M5 12h14M5 16.5h14" />
          <path d="M7.5 7.5V4.6M9 7.5V5M10.2 7.5V4.8M14 12V9.5l1.6-.4.6 2.9" opacity=".6" />
        </S>
      );
    case 'xshelf':
      return (
        <S {...p}>
          <path d="M5 2.5v19M8 2.5v19M16 2.5v19M19 2.5v19" />
          <path d="M3 7h18M3 13h18M3 19h18" />
          <path d="M16 7.6l3 4.8M19 7.6l-3 4.8M16 13.6l3 4.8M19 13.6l-3 4.8" opacity=".7" />
        </S>
      );
    case 'wardrobe':
      return (
        <S {...p}>
          <rect x="4.5" y="2" width="15" height="19" rx=".5" />
          <path d="M12 2v19M10.4 10.5v2.5M13.6 10.5v2.5M4.5 21v1M19.5 21v1" />
        </S>
      );
    case 'kitchenBase':
      return (
        <S {...p}>
          <path d="M2.5 9.5h19v2h-19z" />
          <rect x="3.5" y="11.5" width="17" height="9" />
          <path d="M12 11.5v9M10.2 14v2M13.8 14v2M3.5 20.5h17" />
        </S>
      );
    case 'kitchenWall':
      return (
        <S {...p}>
          <path d="M2.5 3.5h19" opacity=".5" />
          <rect x="4" y="5" width="16" height="11" />
          <path d="M12 5v11M10.4 13v1.8M13.6 13v1.8" />
          <path d="M3 20h18" strokeDasharray="1.6 2" opacity=".5" />
        </S>
      );
    case 'table':
      return (
        <S {...p}>
          <path d="M2.5 8.5h19v2h-19z" />
          <path d="M5 10.5V20M19 10.5V20M5 13h14" />
        </S>
      );
    case 'bench':
      return (
        <S {...p}>
          <path d="M2.5 11h19v2.2h-19z" />
          <path d="M5.2 13.2v6.3h2v-6.3M16.8 13.2v6.3h2v-6.3M7.2 16.5h9.6" />
        </S>
      );
    case 'drawer':
      return (
        <S {...p}>
          <path d="M3 10.5 8 7h13l-5 3.5z" />
          <path d="M3 10.5v7h13v-7M16 17.5l5-3.5V7" />
          <path d="M7.5 14h4" />
        </S>
      );
    case 'box':
      return (
        <S {...p}>
          <path d="M3.5 8.5h17v12h-17z" />
          <path d="M3 6h18v2.5H3z" />
          <path d="M10 11.5h4" />
        </S>
      );
  }
};

export const ResizeIcon = (p: P) => (
  <S {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1" strokeDasharray="2 2" />
    <path d="M3 12h3M18 12h3M12 3v3M12 18v3" />
    <circle cx="21" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="3" r="1.4" fill="currentColor" />
  </S>
);

export const StrengthIcon = (p: P) => (
  <S {...p}>
    <path d="M2.5 9.5h19" />
    <path d="M3.5 9.5c3 4 14 4 17 0" opacity=".55" />
    <path d="M4 9.5v10M20 9.5v10" />
    <path d="M10 4.5h4l1 3h-6z" />
  </S>
);

export const ExplodeIcon = (p: P) => (
  <S {...p}>
    <rect x="8" y="8" width="8" height="8" rx="1" />
    <path d="M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4" />
  </S>
);

export const TipIcon = (p: P) => (
  <S {...p}>
    <rect x="4" y="13" width="16" height="5" rx=".6" />
    <path d="M8.5 3.5v6.5h5" opacity=".5" />
    <path d="M11 8.5l2.5 1.5-2.5 1.5" opacity=".5" />
  </S>
);
