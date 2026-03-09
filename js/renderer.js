/**
 * renderer.js — Canvas overlay drawing
 *
 * Draws the original minesweeper screenshot onto a canvas, then overlays
 * probability information on each unrevealed cell.
 */

'use strict';

/**
 * Computes pixel bounding box for a cell in original image coordinates.
 * @param {number} row
 * @param {number} col
 * @param {{ topLeft: {x:number,y:number}, cellSize: {width:number,height:number} }} gridBounds
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function getCellPixelBounds(row, col, gridBounds) {
  return {
    x: gridBounds.topLeft.x + col * gridBounds.cellSize.width,
    y: gridBounds.topLeft.y + row * gridBounds.cellSize.height,
    width: gridBounds.cellSize.width,
    height: gridBounds.cellSize.height,
  };
}

/**
 * Interpolates between two RGB values.
 * @param {[number,number,number]} a
 * @param {[number,number,number]} b
 * @param {number} t - 0 to 1
 * @returns {[number,number,number]}
 */
function lerpRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Returns an rgba color string for a mine probability.
 * 0.0 → green, 0.5 → amber, 1.0 → red
 * @param {number} probability - 0 to 1
 * @param {number} [alpha=0.65] - opacity
 * @returns {string} e.g. 'rgba(255, 170, 0, 0.65)'
 */
function probabilityToColor(probability, alpha = 0.65) {
  const green = [34, 197, 94];   // #22c55e
  const amber = [251, 191, 36];  // #fbbf24
  const red   = [239, 68, 68];   // #ef4444

  let rgb;
  if (probability <= 0.5) {
    rgb = lerpRgb(green, amber, probability * 2);
  } else {
    rgb = lerpRgb(amber, red, (probability - 0.5) * 2);
  }
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * Draws a rounded rectangle path.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r - corner radius
 */
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Draws the cell overlay for a single unrevealed cell.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,width:number,height:number}} bounds - in canvas scale
 * @param {{probability:number, certain:boolean} | null} result
 */
function drawCellOverlay(ctx, bounds, result) {
  const { x, y, width: w, height: h } = bounds;
  const padding = Math.max(1, w * 0.04);
  const rx = x + padding;
  const ry = y + padding;
  const rw = w - padding * 2;
  const rh = h - padding * 2;
  const cornerRadius = Math.max(2, w * 0.12);

  if (result === null) {
    // Unknown — draw subtle '?' indicator
    const fontSize = Math.max(10, Math.min(w * 0.38, h * 0.38));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('?', x + w / 2, y + h / 2);
    return;
  }

  const { probability, certain } = result;
  const alpha = certain ? 0.80 : 0.65;
  const fillColor = probabilityToColor(probability, alpha);

  // Fill
  roundRect(ctx, rx, ry, rw, rh, cornerRadius);
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Border for certain cells
  if (certain) {
    roundRect(ctx, rx, ry, rw, rh, cornerRadius);
    ctx.strokeStyle = probability === 0
      ? 'rgba(34, 197, 94, 0.95)'
      : 'rgba(239, 68, 68, 0.95)';
    ctx.lineWidth = Math.max(1.5, w * 0.05);
    ctx.stroke();
  }

  // Text label
  const pct = Math.round(probability * 100);
  let label;
  if (certain && pct === 0) {
    label = '✓';
  } else if (certain && pct === 100) {
    label = '✕';
  } else {
    label = `${pct}%`;
  }

  const fontSize = Math.max(8, Math.min(w * 0.32, h * 0.32, 22));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Text shadow for readability
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = Math.max(2, fontSize * 0.3);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.shadowBlur = 0;
}

const APP_VERSION = 'v8';

/**
 * Draws a small version stamp on the canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
function drawVersionStamp(ctx, canvasWidth, canvasHeight) {
  const fontSize = Math.max(9, Math.min(canvasWidth * 0.022, 13));
  ctx.font = `${fontSize}px monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 3;
  ctx.fillText(APP_VERSION, canvasWidth - 6, canvasHeight - 4);
  ctx.shadowBlur = 0;
}

/**
 * Draws a debug outline on a classified (non-unrevealed) cell so the user can
 * see what the analyzer detected and whether it was correct.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,width:number,height:number}} bounds
 * @param {{ type: string, value: number|null }} cell
 */
function drawClassifiedCellDebug(ctx, bounds, cell) {
  const { x, y, width: w, height: h } = bounds;
  const inset = Math.max(1, Math.round(Math.min(w, h) * 0.06));

  // Color and label per cell type
  let strokeColor, bgColor, label;
  if (cell.type === 'number') {
    strokeColor = 'rgba(96,165,250,0.9)';  // blue
    bgColor     = 'rgba(96,165,250,0.10)';
    label       = String(cell.value);
  } else if (cell.type === 'flag') {
    strokeColor = 'rgba(249,115,22,0.9)';  // orange
    bgColor     = 'rgba(249,115,22,0.10)';
    label       = 'F';
  } else if (cell.type === 'empty') {
    strokeColor = 'rgba(163,230,53,0.7)';  // lime
    bgColor     = 'rgba(163,230,53,0.06)';
    label       = null;
  } else {
    return; // unrevealed — handled separately
  }

  // Background tint
  ctx.fillStyle = bgColor;
  ctx.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);

  // Border
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.07);
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);

  // Small label in top-left corner for numbers / flags
  if (label) {
    const fontSize = Math.max(7, Math.min(w * 0.30, h * 0.30, 14));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 3;
    ctx.fillStyle = strokeColor;
    ctx.fillText(label, x + inset + 2, y + inset + 1);
    ctx.shadowBlur = 0;
  }
}

/**
 * Main render function. Draws image onto canvas then overlays probability info.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement | ImageBitmap} image
 * @param {AnalysisResult} analysisResult
 * @param {Map<string, {probability:number, certain:boolean} | null>} probMap
 */
function renderResult(canvas, image, analysisResult, probMap) {
  const imgWidth = image.naturalWidth ?? image.width;
  const imgHeight = image.naturalHeight ?? image.height;

  canvas.width = imgWidth;
  canvas.height = imgHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  // Draw original image
  ctx.drawImage(image, 0, 0, imgWidth, imgHeight);

  const { grid, gridBounds } = analysisResult;

  for (const cell of grid.cells) {
    const rawBounds = getCellPixelBounds(cell.row, cell.col, gridBounds);
    const clampedX = Math.max(0, Math.min(rawBounds.x, imgWidth - 1));
    const clampedY = Math.max(0, Math.min(rawBounds.y, imgHeight - 1));
    const clampedW = Math.min(rawBounds.width, imgWidth - clampedX);
    const clampedH = Math.min(rawBounds.height, imgHeight - clampedY);
    if (clampedW <= 0 || clampedH <= 0) continue;

    const bounds = { x: clampedX, y: clampedY, width: clampedW, height: clampedH };

    if (cell.type === 'unrevealed') {
      const key = `${cell.row},${cell.col}`;
      const solverResult = probMap.has(key) ? probMap.get(key) : null;
      drawCellOverlay(ctx, bounds, solverResult);
    } else {
      // Draw debug outline showing what was detected
      drawClassifiedCellDebug(ctx, bounds, cell);
    }
  }

  // Version stamp
  drawVersionStamp(ctx, imgWidth, imgHeight);
}
