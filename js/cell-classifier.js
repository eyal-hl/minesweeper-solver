/**
 * cell-classifier.js — Classifies each cell in a detected minesweeper grid
 *
 * Determines if each cell is: 'unrevealed', 'flag', 'empty', or 'number' (1-8)
 * Uses pixel analysis only — no external libraries.
 */

'use strict';

// ─── Pixel Utilities ─────────────────────────────────────────────────────────

/**
 * Extracts pixel data for a single cell from the canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {ImageData}
 */
function getCellImageData(ctx, x, y, w, h) {
  // Clamp to canvas bounds
  const cx = Math.max(0, Math.round(x));
  const cy = Math.max(0, Math.round(y));
  const cw = Math.min(Math.round(w), ctx.canvas.width - cx);
  const ch = Math.min(Math.round(h), ctx.canvas.height - cy);
  if (cw <= 0 || ch <= 0) return null;
  return ctx.getImageData(cx, cy, cw, ch);
}

/**
 * Computes average brightness of an ImageData region.
 * @param {ImageData} imageData
 * @returns {number} 0-255
 */
function avgBrightness(imageData) {
  const d = imageData.data;
  let sum = 0;
  const count = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  return sum / count;
}

/**
 * Computes the standard deviation of brightness in an ImageData.
 * @param {ImageData} imageData
 * @returns {number}
 */
function brightnessStdDev(imageData) {
  const d = imageData.data;
  const count = d.length / 4;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < d.length; i += 4) {
    const b = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    sum += b;
    sum2 += b * b;
  }
  const mean = sum / count;
  return Math.sqrt(sum2 / count - mean * mean);
}

/**
 * Counts pixels with high saturation (chromatic / colorful pixels).
 * @param {ImageData} imageData
 * @param {number} threshold - saturation threshold 0-255
 * @returns {{ count: number, total: number, ratio: number }}
 */
function countSaturatedPixels(imageData, threshold = 40) {
  const d = imageData.data;
  let count = 0;
  const total = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : ((max - min) / max) * 255;
    if (sat > threshold) count++;
  }
  return { count, total, ratio: count / total };
}

/**
 * Counts red-ish pixels (for flag detection).
 * @param {ImageData} imageData
 * @returns {number} ratio of red pixels
 */
function countRedPixels(imageData) {
  const d = imageData.data;
  let count = 0;
  const total = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    // Red-ish: R is dominant, and significantly higher than G and B
    if (r > 120 && r > g * 1.5 && r > b * 1.5) count++;
  }
  return count / total;
}

/**
 * Analyzes the inner portion of a cell (excluding borders).
 * Returns pixel stats for the center 60% of the cell.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {{ brightness: number, stdDev: number, satRatio: number, redRatio: number, innerData: ImageData }}
 */
function analyzeCellInner(ctx, x, y, w, h) {
  // Use the center 60% to avoid borders
  const margin = 0.2;
  const ix = x + w * margin;
  const iy = y + h * margin;
  const iw = w * (1 - 2 * margin);
  const ih = h * (1 - 2 * margin);

  const innerData = getCellImageData(ctx, ix, iy, iw, ih);
  if (!innerData) {
    return { brightness: 0, stdDev: 0, satRatio: 0, redRatio: 0, innerData: null };
  }

  return {
    brightness: avgBrightness(innerData),
    stdDev: brightnessStdDev(innerData),
    satRatio: countSaturatedPixels(innerData).ratio,
    redRatio: countRedPixels(innerData),
    innerData,
  };
}

// ─── Number Recognition ──────────────────────────────────────────────────────

/**
 * Classic minesweeper digit color table (approximate).
 * @type {Object<number, [number,number,number]>}
 */
const CLASSIC_DIGIT_COLORS = {
  1: [0, 0, 255],      // blue
  2: [0, 128, 0],      // green
  3: [255, 0, 0],      // red
  4: [0, 0, 128],      // dark blue / navy
  5: [128, 0, 0],      // maroon
  6: [0, 128, 128],    // teal
  7: [0, 0, 0],        // black
  8: [128, 128, 128],  // gray
};

/**
 * Tries to identify the digit by matching pixel colors against classic minesweeper palette.
 * @param {ImageData} imageData
 * @returns {number|null} digit 1-8 or null if no match
 */
function matchClassicDigitColor(imageData) {
  const d = imageData.data;
  const counts = {};
  for (let digit = 1; digit <= 8; digit++) counts[digit] = 0;

  const tolerance = 60;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    for (let digit = 1; digit <= 8; digit++) {
      const [er, eg, eb] = CLASSIC_DIGIT_COLORS[digit];
      if (Math.abs(r - er) < tolerance && Math.abs(g - eg) < tolerance && Math.abs(b - eb) < tolerance) {
        counts[digit]++;
      }
    }
  }

  let bestDigit = null;
  let bestCount = 5; // minimum pixel threshold
  for (let digit = 1; digit <= 8; digit++) {
    if (counts[digit] > bestCount) {
      bestCount = counts[digit];
      bestDigit = digit;
    }
  }

  return bestDigit;
}

/**
 * Binarizes cell image: pixels brighter than threshold become 1, else 0.
 * Returns a 2D binary array and statistics.
 * @param {ImageData} imageData
 * @param {number} threshold - brightness threshold (0-255)
 * @returns {{ binary: Uint8Array[], brightCount: number, total: number, width: number, height: number }}
 */
function binarizeCell(imageData, threshold) {
  const { data, width, height } = imageData;
  const binary = [];
  let brightCount = 0;

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      row[x] = brightness > threshold ? 1 : 0;
      if (row[x]) brightCount++;
    }
    binary.push(row);
  }

  return { binary, brightCount, total: width * height, width, height };
}

/**
 * Identifies a digit (1-8) from a binarized cell using shape heuristics.
 *
 * Features used:
 * - Bright pixel ratio (how much of cell is "ink")
 * - Bounding box aspect ratio of the bright region
 * - Horizontal crossing counts at 25%, 50%, 75% of height
 * - Vertical crossing counts at 25%, 50%, 75% of width
 * - Whether the center column has a gap (hole detection)
 *
 * @param {Uint8Array[]} binary - 2D binary image
 * @param {number} width
 * @param {number} height
 * @returns {number} digit 1-8, or 0 if can't determine
 */
function recognizeDigitFromBinary(binary, width, height) {
  // Find bounding box of bright pixels
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let brightCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (binary[y][x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        brightCount++;
      }
    }
  }

  if (brightCount < 3) return 0; // No digit visible

  const bbW = maxX - minX + 1;
  const bbH = maxY - minY + 1;
  const aspect = bbW / bbH;
  const fillRatio = brightCount / (bbW * bbH);

  // Count horizontal crossings (transitions from 0→1 or 1→0) at different heights
  function hCrossings(yRatio) {
    const y = Math.min(maxY, Math.max(minY, Math.round(minY + bbH * yRatio)));
    if (y < 0 || y >= height) return 0;
    let crossings = 0;
    for (let x = minX + 1; x <= maxX; x++) {
      if (binary[y][x] !== binary[y][x - 1]) crossings++;
    }
    return Math.floor(crossings / 2); // pairs of transitions = segments
  }

  // Count vertical crossings at different widths
  function vCrossings(xRatio) {
    const x = Math.min(maxX, Math.max(minX, Math.round(minX + bbW * xRatio)));
    if (x < 0 || x >= width) return 0;
    let crossings = 0;
    for (let y = minY + 1; y <= maxY; y++) {
      if (binary[y][x] !== binary[y - 1][x]) crossings++;
    }
    return Math.floor(crossings / 2);
  }

  const hTop = hCrossings(0.25);
  const hMid = hCrossings(0.5);
  const hBot = hCrossings(0.75);
  const vLeft = vCrossings(0.25);
  const vMid = vCrossings(0.5);
  const vRight = vCrossings(0.75);

  // Check if the center has a hole (for 0, 4, 6, 8)
  function hasCenterHole() {
    const cy = Math.round(minY + bbH * 0.5);
    const cx = Math.round(minX + bbW * 0.5);
    if (cy < 0 || cy >= height || cx < 0 || cx >= width) return false;
    return binary[cy][cx] === 0;
  }

  // Decision tree based on shape features
  // "1" - very narrow
  if (aspect < 0.35) return 1;

  // "1" - single stroke in the middle
  if (hMid === 1 && hTop <= 1 && hBot <= 1 && aspect < 0.5) return 1;

  // Use crossing patterns to distinguish digits
  // "8" has holes in top and bottom halves, high fill ratio in bounding box is paradoxically low
  if (hMid >= 2 && hTop >= 2 && hBot >= 2 && vMid >= 2) return 8;

  // "0" or empty with hole — shouldn't appear in minesweeper (0 = empty cell)

  // "4" — has a horizontal bar in the middle, open at bottom
  if (hMid >= 2 && hBot === 1 && vRight >= 1 && aspect > 0.4) return 4;

  // "6" — closed bottom, open or small top
  if (hBot >= 2 && hTop === 1 && vMid >= 2) return 6;

  // "3" — open left side
  if (hTop >= 1 && hMid >= 1 && hBot >= 1 && vLeft <= 1 && vRight >= 2) return 3;

  // "5" — similar to 3 but reversed pattern at top
  if (hTop >= 1 && hMid >= 1 && hBot >= 1 && aspect > 0.4) {
    // Check if top-right is empty (5 has top bar going left)
    const topRightY = Math.round(minY + bbH * 0.15);
    const topRightX = Math.round(minX + bbW * 0.8);
    if (topRightX < width && topRightY < height && binary[topRightY][topRightX] === 0) return 5;
  }

  // "2" — has a diagonal, bottom bar
  if (hBot >= 1 && hTop >= 1 && vMid >= 2) return 2;

  // "7" — single stroke from top-right to bottom-left
  if (hTop >= 1 && hMid === 1 && hBot === 1 && vMid <= 2) return 7;

  // "9" — closed top, open bottom
  if (hTop >= 2 && hBot === 1) return 9; // shouldn't appear in minesweeper but just in case

  // Fallback: estimate from fill ratio and aspect
  if (aspect < 0.4) return 1;
  if (fillRatio > 0.55) return 8;
  if (fillRatio < 0.3) return 7;

  return 0; // Unknown
}

// ─── Main Cell Classifier ────────────────────────────────────────────────────

/**
 * Determines the adaptive brightness threshold for number detection.
 * Uses the cell's own brightness distribution.
 * @param {ImageData} imageData
 * @returns {number} threshold value 0-255
 */
function adaptiveThreshold(imageData) {
  const d = imageData.data;
  // Build brightness histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const b = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    hist[Math.min(255, b)]++;
  }

  // Otsu's method - find threshold that minimizes intra-class variance
  const total = d.length / 4;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumBg = 0, wBg = 0;
  let bestThresh = 128, bestVar = 0;

  for (let t = 0; t < 256; t++) {
    wBg += hist[t];
    if (wBg === 0) continue;
    const wFg = total - wBg;
    if (wFg === 0) break;
    sumBg += t * hist[t];
    const meanBg = sumBg / wBg;
    const meanFg = (sumAll - sumBg) / wFg;
    const variance = wBg * wFg * (meanBg - meanFg) * (meanBg - meanFg);
    if (variance > bestVar) {
      bestVar = variance;
      bestThresh = t;
    }
  }

  return bestThresh;
}

/**
 * Classifies a single cell.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x - cell x position in image
 * @param {number} y - cell y position in image
 * @param {number} w - cell width
 * @param {number} h - cell height
 * @param {number} boardAvgBrightness - average brightness of the whole board
 * @returns {{ type: 'number'|'empty'|'flag'|'unrevealed', value: number|null }}
 */
function classifyCell(ctx, x, y, w, h, boardAvgBrightness) {
  const stats = analyzeCellInner(ctx, x, y, w, h);
  if (!stats.innerData) {
    return { type: 'unrevealed', value: null };
  }

  const { brightness, stdDev, satRatio, redRatio, innerData } = stats;

  // Flag detection: significant amount of red pixels
  if (redRatio > 0.03) {
    return { type: 'flag', value: null };
  }

  // Try classic color-based digit recognition first (for colorful minesweeper styles)
  if (satRatio > 0.08) {
    const digit = matchClassicDigitColor(innerData);
    if (digit) {
      return { type: 'number', value: digit };
    }
  }

  // For modern styles: binarize and check for number glyphs
  const threshold = adaptiveThreshold(innerData);
  const { binary, brightCount, total, width: bw, height: bh } = binarizeCell(innerData, threshold);
  const brightRatio = brightCount / total;

  // Determine if this cell has visible text/number by checking contrast
  // A cell with a number will have a bimodal brightness distribution (background + text)
  // An empty revealed cell or unrevealed cell will be more uniform

  // Check if the cell has a clearly visible glyph
  // For dark backgrounds with light numbers: bright pixels are the number
  // For light backgrounds with dark numbers: dark pixels are the number
  // Use stdDev as a proxy - numbered cells have higher stdDev than plain cells
  if (stdDev < 12) {
    // Very uniform cell - either empty revealed or unrevealed
    // Distinguish by comparing to board average
    // Unrevealed cells in most games have a distinct appearance (often darker or have a pattern)
    // For now, use brightness relative to board average
    return { type: 'unrevealed', value: null };
  }

  // Check if there's enough "ink" to be a number
  // Numbers typically occupy 10-50% of the cell's center area
  if (brightRatio > 0.02 && brightRatio < 0.60 && stdDev > 15) {
    // Try to recognize the digit
    const digit = recognizeDigitFromBinary(binary, bw, bh);
    if (digit >= 1 && digit <= 8) {
      return { type: 'number', value: digit };
    }
  }

  // If we couldn't find a number but the cell has some features, check if it might be
  // a revealed empty cell (low brightness variation, flat look) or unrevealed
  if (stdDev < 25 && brightRatio < 0.05) {
    // Likely empty revealed cell (flat, no number)
    return { type: 'empty', value: 0 };
  }

  // Default: unrevealed
  return { type: 'unrevealed', value: null };
}

// ─── Board Analysis ──────────────────────────────────────────────────────────

/**
 * Analyzes the full board: detects grid, classifies all cells.
 * This replaces the Claude API-based analyzeBoard function.
 *
 * @param {HTMLImageElement} image
 * @returns {AnalysisResult} same format as the API-based analyzer
 */
function analyzeLocal(image) {
  const imgWidth = image.naturalWidth || image.width;
  const imgHeight = image.naturalHeight || image.height;

  // Create an off-screen canvas
  const offCanvas = document.createElement('canvas');
  offCanvas.width = imgWidth;
  offCanvas.height = imgHeight;
  const ctx = offCanvas.getContext('2d');
  ctx.drawImage(image, 0, 0, imgWidth, imgHeight);

  // Step 1: Detect grid
  const grid = window.LocalAnalyzer.detectGrid(ctx, imgWidth, imgHeight);

  // Step 2: Compute board average brightness for reference
  const boardData = getCellImageData(ctx, grid.originX, grid.originY,
    grid.cellW * grid.cols, grid.cellH * grid.rows);
  const boardBrightness = boardData ? avgBrightness(boardData) : 128;

  // Step 3: Classify each cell
  const cells = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cx = grid.originX + col * grid.cellW;
      const cy = grid.originY + row * grid.cellH;

      // Skip cells that are mostly outside the image
      if (cx + grid.cellW * 0.5 > imgWidth || cy + grid.cellH * 0.5 > imgHeight) continue;

      const result = classifyCell(ctx, cx, cy, grid.cellW, grid.cellH, boardBrightness);
      cells.push({
        row,
        col,
        type: result.type,
        value: result.value,
      });
    }
  }

  return {
    grid: {
      rows: grid.rows,
      cols: grid.cols,
      cells,
    },
    gridBounds: {
      topLeft: { x: grid.originX, y: grid.originY },
      cellSize: { width: grid.cellW, height: grid.cellH },
    },
  };
}

// Export
window.LocalAnalyzer = window.LocalAnalyzer || {};
window.LocalAnalyzer.analyzeLocal = analyzeLocal;
window.LocalAnalyzer.classifyCell = classifyCell;
window.LocalAnalyzer.recognizeDigitFromBinary = recognizeDigitFromBinary;
window.LocalAnalyzer.binarizeCell = binarizeCell;
window.LocalAnalyzer.adaptiveThreshold = adaptiveThreshold;
