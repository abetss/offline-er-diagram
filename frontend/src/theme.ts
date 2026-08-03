// All layout/render constants — single source of truth (docs/layout-and-render.md §1).

export const FONT = '-apple-system, "Helvetica Neue", Arial, sans-serif';

export const headerH = 36;
export const rowH = 28;
export const padX = 12;
export const cardRadius = 8;
export const cardWidthMin = 200;
export const cardWidthMax = 360;
export const commentGap = 20; // gap between the type column and the inline comment column
export const commentColMax = 260; // max width of the inline comment column (comments truncate with …)

export const gapX = 120;
export const gapY = 40;
export const groupPad = 16;
export const groupTransitionGap = 24;

export const zoomMin = 0.1;
export const zoomMax = 4;
export const fitPadding = 40;
export const dragThreshold = 3; // px
export const wheelZoomK = 0.005;

export const edgeStroke = '#64748B';
export const edgeWidth = 1.5;
export const fromNoteDash = '6 4';
export const sideGapMin = 16;
export const ctrlOffMin = 40;
export const ctrlOffMax = 160;
export const sameSideOff = 60;

export const PALETTE = [
  '#2563EB',
  '#DC2626',
  '#059669',
  '#D97706',
  '#7C3AED',
  '#DB2777',
  '#0D9488',
  '#EA580C',
];

export const canvasBg = '#F8FAFC';
export const cardFill = '#FFFFFF';
export const cardStroke = '#D1D5DB';
export const nameColor = '#111827';
export const typeColor = '#6B7280';
export const noteColor = '#6B7280';

// Font strings used by measure (docs §2).
export const headerFont = `600 13px ${FONT}`;
export const nameFontPk = `600 13px ${FONT}`;
export const nameFontPlain = `400 13px ${FONT}`;
export const typeFont = `400 12px ${FONT}`;
export const noteFont = `italic 400 11px ${FONT}`;
export const groupLabelFont = `600 12px ${FONT}`;
export const edgeLabelFont = `italic 400 10px ${FONT}`;
