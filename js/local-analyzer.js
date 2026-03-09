/**
 * local-analyzer.js — Client-side minesweeper board detection
 *
 * Detects grid, classifies cells, and reads numbers from a minesweeper
 * screenshot using only canvas pixel analysis. No external libraries.
 */

'use strict';

// ─── Grid Detection ──────────────────────────────────────────────────────────

/**
 * Computes a 1D brightness profile by averaging pixel brightness along an axis.
 * @param {ImageData} imageData
 * @param {'row'|'col'} axis - 'row' sums across columns, 'col' sums across rows
 * @returns {Float32Array} profile of average brightness values
 */
function computeProfile(imageData, axis) {
  const { data, width, height } = imageData;
  const len = axis === 'row' ? height : width;
  const profile = new Float32Array(len);

  if (axis === 'row') {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      profile[y] = sum / width;
    }
  } else {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      profile[x] = sum / height;
    }
  }

  return profile;
}

/**
 * Computes the gradient (absolute difference between consecutive values) of a profile.
 * @param {Float32Array} profile
 * @returns {Float32Array}
 */
function computeGradient(profile) {
  const grad = new Float32Array(profile.length);
  for (let i = 1; i < profile.length; i++) {
    grad[i] = Math.abs(profile[i] - profile[i - 1]);
  }
  return grad;
}

/**
 * Finds the dominant period in a profile using autocorrelation.
 * @param {Float32Array} profile - brightness profile
 * @param {number} minPeriod - minimum expected cell size in pixels
 * @param {number} maxPeriod - maximum expected cell size in pixels
 * @returns {number} detected period (cell size in pixels)
 */
function findPeriod(profile, minPeriod, maxPeriod) {
  const grad = computeGradient(profile);
  const len = grad.length;

  // Compute mean of gradient to normalize
  let mean = 0;
  for (let i = 0; i < len; i++) mean += grad[i];
  mean /= len;

  let bestLag = minPeriod;
  let bestScore = -Infinity;

  for (let lag = minPeriod; lag <= maxPeriod; lag++) {
    let score = 0;
    let count = 0;
    for (let i = 0; i < len - lag; i++) {
      score += (grad[i] - mean) * (grad[i + lag] - mean);
      count++;
    }
    score /= count;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return bestLag;
}

/**
 * Given a period and a profile, finds the grid lines (positions where cells start).
 * Looks for the offset that best aligns with edges in the gradient.
 * @param {Float32Array} profile
 * @param {number} period
 * @returns {{ origin: number, lines: number[] }}
 */
function findGridLines(profile, period) {
  const grad = computeGradient(profile);

  // Try each offset 0..period-1, score by total gradient at grid line positions
  let bestOffset = 0;
  let bestScore = -Infinity;

  for (let offset = 0; offset < period; offset++) {
    let score = 0;
    for (let pos = offset; pos < profile.length; pos += period) {
      // Sum gradient in a small window around pos
      for (let d = -2; d <= 2; d++) {
        const idx = pos + d;
        if (idx >= 0 && idx < grad.length) {
          score += grad[idx];
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  // Only include a line if the gradient at that position is significant.
  // Lines extrapolated past the board edge land on flat/frame areas with weaker
  // gradients, so they get filtered out here instead of generating phantom cells.
  // Use 1.2x the mean gradient as threshold (stronger than the average edge).
  const gradMean = grad.reduce((a, b) => a + b, 0) / grad.length;
  const gradThreshold = Math.max(gradMean * 1.2, 2);

  const lines = [];
  for (let pos = bestOffset; pos < profile.length; pos += period) {
    let localGrad = 0;
    for (let d = -3; d <= 3; d++) {
      const idx = pos + d;
      if (idx >= 0 && idx < grad.length) localGrad = Math.max(localGrad, grad[idx]);
    }
    if (localGrad >= gradThreshold) {
      lines.push(Math.round(pos));
    }
  }

  // Trim trailing phantom lines. A real cell [L, L+period] must have a boundary
  // (gradient) on its RIGHT side too. The game frame adds a line for its left edge
  // but the phantom "cell" inside the frame has no right boundary — just flat gray.
  while (lines.length > 0) {
    const L = lines[lines.length - 1];
    const rightPos = L + period;
    if (rightPos >= profile.length) { lines.pop(); continue; }
    let rightGrad = 0;
    for (let d = -3; d <= 3; d++) {
      const idx = rightPos + d;
      if (idx >= 0 && idx < grad.length) rightGrad = Math.max(rightGrad, grad[idx]);
    }
    if (rightGrad < gradThreshold) { lines.pop(); } else { break; }
  }

  return { origin: bestOffset, lines };
}

/**
 * Detects the minesweeper grid in the image.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @returns {{ originX: number, originY: number, cellW: number, cellH: number, cols: number, rows: number }}
 */
function detectGrid(ctx, imgWidth, imgHeight) {
  const imageData = ctx.getImageData(0, 0, imgWidth, imgHeight);

  // Min/max cell size heuristic: cells are typically 2-8% of the smaller dimension
  const minDim = Math.min(imgWidth, imgHeight);
  const minPeriod = Math.max(10, Math.floor(minDim * 0.02));
  const maxPeriod = Math.floor(minDim * 0.12);

  const colProfile = computeProfile(imageData, 'col');
  const rowProfile = computeProfile(imageData, 'row');

  const cellW = findPeriod(colProfile, minPeriod, maxPeriod);
  const cellH = findPeriod(rowProfile, minPeriod, maxPeriod);

  const colGrid = findGridLines(colProfile, cellW);
  const rowGrid = findGridLines(rowProfile, cellH);

  // Trim grid lines that fall outside the board area
  // Use the gradient to find where the board actually starts/ends
  const { startLine: colStart, endLine: colEnd } = trimGridLines(colProfile, colGrid.lines, cellW);
  const { startLine: rowStart, endLine: rowEnd } = trimGridLines(rowProfile, rowGrid.lines, cellH);

  const trimmedColLines = colGrid.lines.filter(l => l >= colStart && l <= colEnd);
  const trimmedRowLines = rowGrid.lines.filter(l => l >= rowStart && l <= rowEnd);

  return {
    originX: trimmedColLines[0] || colGrid.origin,
    originY: trimmedRowLines[0] || rowGrid.origin,
    cellW,
    cellH,
    cols: Math.max(1, trimmedColLines.length),
    rows: Math.max(1, trimmedRowLines.length),
  };
}

/**
 * Trims grid lines to only include those within the actual board region.
 * Looks for a contiguous region of lines with similar brightness patterns.
 * @param {Float32Array} profile
 * @param {number[]} lines
 * @param {number} period
 * @returns {{ startLine: number, endLine: number }}
 */
function trimGridLines(profile, lines, period) {
  if (lines.length < 2) return { startLine: 0, endLine: profile.length };

  // Compute average brightness in each cell slot (between consecutive grid lines)
  const cellBrightness = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const from = lines[i];
    const to = Math.min(lines[i] + period, lines[i + 1] || profile.length);
    let sum = 0, count = 0;
    for (let p = from; p < to && p < profile.length; p++) {
      sum += profile[p];
      count++;
    }
    cellBrightness.push(count > 0 ? sum / count : 0);
  }

  if (cellBrightness.length === 0) return { startLine: 0, endLine: profile.length };

  // Use the median brightness as the reference for "typical game cell".
  // Median is more robust than mean when there are outlier cells (header, frame).
  const sorted = [...cellBrightness].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // A cell is "valid" if its brightness is within 40% of the median.
  // The game header (LCD display) is much darker than game cells, so it fails.
  // Cells within the game board should all be close to the same gray.
  const tolerance = median * 0.40;
  const valid = cellBrightness.map(b => Math.abs(b - median) < tolerance);

  // Find the LONGEST contiguous run of valid cells.
  // This identifies the actual game board region, naturally excluding the header
  // row(s) at the top and any phantom frame cells at the edges.
  let bestStart = 0, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < valid.length; i++) {
    if (valid[i]) {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen === 0) {
    // Fallback: return full range
    return { startLine: lines[0], endLine: lines[lines.length - 1] + period };
  }

  return {
    startLine: lines[bestStart],
    endLine: lines[Math.min(bestStart + bestLen, lines.length - 1)] + period,
  };
}

// Export for use by other modules
window.LocalAnalyzer = window.LocalAnalyzer || {};
window.LocalAnalyzer.detectGrid = detectGrid;
window.LocalAnalyzer.computeProfile = computeProfile;
window.LocalAnalyzer.findPeriod = findPeriod;
window.LocalAnalyzer.findGridLines = findGridLines;
