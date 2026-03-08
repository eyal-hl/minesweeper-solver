/**
 * app.js — Main entry point and pipeline orchestrator
 *
 * Uses local pixel analysis (no API calls) to detect and solve minesweeper boards.
 */

'use strict';

const MAX_FILE_SIZE_MB = 20;

// ─── DOM references ──────────────────────────────────────────────────────────
const dropZone      = document.getElementById('drop-zone');
const fileInput     = document.getElementById('file-input');
const statusDiv     = document.getElementById('status');
const statusMsg     = document.getElementById('status-message');
const errorBanner   = document.getElementById('error-banner');
const resultSection = document.getElementById('result-section');
const resultSummary = document.getElementById('result-summary');
const resultCanvas  = document.getElementById('result-canvas');
const downloadBtn   = document.getElementById('download-btn');
const resetBtn      = document.getElementById('reset-btn');
const uploadSection = document.getElementById('upload-section');

// ─── Error display ────────────────────────────────────────────────────────────

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
  hideStatus();
}

function clearError() {
  errorBanner.hidden = true;
  errorBanner.textContent = '';
}

// ─── Status / spinner ─────────────────────────────────────────────────────────

function showStatus(message) {
  statusMsg.textContent = message;
  statusDiv.hidden = false;
}

function hideStatus() {
  statusDiv.hidden = true;
}

// ─── File handling ────────────────────────────────────────────────────────────

/**
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

// ─── Result summary ───────────────────────────────────────────────────────────

/**
 * @param {Map<string, {probability:number, certain:boolean} | null>} probMap
 */
function buildSummary(probMap) {
  let safe = 0, mine = 0, uncertain = 0, unknown = 0;
  for (const result of probMap.values()) {
    if (result === null) {
      unknown++;
    } else if (result.certain && result.probability === 0) {
      safe++;
    } else if (result.certain && result.probability === 1) {
      mine++;
    } else {
      uncertain++;
    }
  }

  const parts = [];
  if (safe > 0)      parts.push(`<span class="stat"><span class="stat-value stat-safe">${safe}</span> certain safe</span>`);
  if (mine > 0)      parts.push(`<span class="stat"><span class="stat-value stat-mine">${mine}</span> certain mine${mine !== 1 ? 's' : ''}</span>`);
  if (uncertain > 0) parts.push(`<span class="stat"><span class="stat-value stat-uncertain">${uncertain}</span> uncertain</span>`);
  if (unknown > 0)   parts.push(`<span class="stat"><span class="stat-value stat-unknown">${unknown}</span> no info (?)</span>`);

  resultSummary.innerHTML = parts.length ? parts.join(' &nbsp;·&nbsp; ') : 'No unrevealed cells found.';
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

/**
 * @param {File} file
 */
async function processImage(file) {
  clearError();
  resultSection.hidden = true;
  showStatus('Loading image…');

  let image;
  try {
    image = await loadImage(file);
  } catch (err) {
    showError('Could not read the image file: ' + err.message);
    return;
  }

  showStatus('Detecting grid and reading cells…');

  // Let the status message render before heavy computation
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));

  let analysisResult;
  try {
    analysisResult = window.LocalAnalyzer.analyzeLocal(image);
  } catch (err) {
    showError('Board detection error: ' + err.message);
    return;
  }

  if (!analysisResult.grid.cells.length) {
    showError('Could not detect a minesweeper board in this image. Make sure the screenshot shows the game grid clearly.');
    return;
  }

  showStatus('Solving constraints…');
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 10)));

  let probMap;
  try {
    probMap = solve(analysisResult);
  } catch (err) {
    showError('Solver error: ' + err.message);
    return;
  }

  showStatus('Rendering result…');

  try {
    renderResult(resultCanvas, image, analysisResult, probMap);
  } catch (err) {
    showError('Rendering error: ' + err.message);
    return;
  }

  buildSummary(probMap);
  hideStatus();
  resultSection.hidden = false;
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * @param {File} file
 */
function handleFileSelected(file) {
  clearError();

  if (!file.type.startsWith('image/')) {
    showError('Please upload an image file (JPEG, PNG, WebP, etc.).');
    return;
  }

  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > MAX_FILE_SIZE_MB) {
    showError(`File is too large (${sizeMB.toFixed(1)} MB). Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
    return;
  }

  processImage(file);
}

// ─── Download ─────────────────────────────────────────────────────────────────

function downloadResult() {
  resultCanvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'minesweeper-analysis.png';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  // Click on drop zone triggers hidden file input
  dropZone.addEventListener('click', (e) => {
    if (e.target === dropZone || e.target.classList.contains('drop-text') ||
        e.target.classList.contains('drop-subtext') || e.target.classList.contains('drop-icon')) {
      fileInput.click();
    }
  });

  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSelected(file);
  });

  // File input change
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      handleFileSelected(file);
      fileInput.value = ''; // Reset so same file can be re-selected
    }
  });

  // Buttons
  downloadBtn.addEventListener('click', downloadResult);

  resetBtn.addEventListener('click', () => {
    resultSection.hidden = true;
    clearError();
    hideStatus();
    uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

document.addEventListener('DOMContentLoaded', init);
