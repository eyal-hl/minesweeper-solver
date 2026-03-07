/**
 * app.js — Main entry point and pipeline orchestrator
 */

'use strict';

const API_KEY_STORAGE_KEY = 'minesweeper_solver_api_key';
const MAX_FILE_SIZE_MB = 20;

// ─── DOM references ──────────────────────────────────────────────────────────
const apiKeyInput   = document.getElementById('api-key');
const toggleKeyBtn  = document.getElementById('toggle-key');
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

// ─── API key persistence ──────────────────────────────────────────────────────

function initApiKeyStorage() {
  const saved = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (saved) apiKeyInput.value = saved;

  apiKeyInput.addEventListener('input', () => {
    const val = apiKeyInput.value.trim();
    if (val) {
      localStorage.setItem(API_KEY_STORAGE_KEY, val);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  });

  toggleKeyBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyBtn.textContent = isPassword ? '🙈' : '👁';
  });
}

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
 * Converts a File to a base64 string and media type.
 * @param {File} file
 * @returns {Promise<{base64: string, mediaType: string}>}
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      // dataUrl = "data:<mediaType>;base64,<data>"
      const commaIdx = dataUrl.indexOf(',');
      const meta = dataUrl.slice(5, commaIdx); // strip "data:"
      const mediaType = meta.replace(';base64', '');
      const base64 = dataUrl.slice(commaIdx + 1);
      resolve({ base64, mediaType });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

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

/**
 * Returns a friendly error message from an AnalyzerError or generic Error.
 * @param {Error} err
 * @returns {string}
 */
function friendlyError(err) {
  if (err.name === 'AnalyzerError') {
    switch (err.code) {
      case 'auth':
        return '🔑 Invalid API key. Please check your Claude API key and try again.';
      case 'rate_limit':
        return '⏱ Rate limit hit. Please wait a moment and try again.';
      case 'overloaded':
        return '🔄 Claude API is temporarily overloaded. Please try again in a few seconds.';
      case 'no_board':
        return '🔍 No minesweeper board detected in this image. Make sure the screenshot shows the game grid clearly.';
      case 'invalid_response':
        return '⚠️ Claude returned an unexpected response. Try again, or try a different screenshot.';
      case 'network':
        return '🌐 Network error: ' + err.message;
      default:
        return err.message;
    }
  }
  return err.message || 'An unexpected error occurred.';
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
 * @param {string} apiKey
 */
async function processImage(file, apiKey) {
  clearError();
  resultSection.hidden = true;
  showStatus('Reading image…');

  let base64, mediaType, image;

  try {
    [{ base64, mediaType }, image] = await Promise.all([
      fileToBase64(file),
      loadImage(file),
    ]);
  } catch (err) {
    showError('Could not read the image file: ' + err.message);
    return;
  }

  showStatus('Sending to Claude for board analysis…');

  let analysisResult;
  try {
    analysisResult = await analyzeBoard(base64, mediaType, apiKey);
  } catch (err) {
    showError(friendlyError(err));
    return;
  }

  showStatus('Solving constraints…');

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

  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    apiKeyInput.classList.add('error');
    apiKeyInput.focus();
    showError('Please enter your Claude API key first.');
    return;
  }
  apiKeyInput.classList.remove('error');

  processImage(file, apiKey);
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
  initApiKeyStorage();

  // Click on drop zone triggers hidden file input
  dropZone.addEventListener('click', (e) => {
    // The file input is absolutely positioned over the drop zone and handles its own clicks
    // But we need to handle keyboard activation
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

  // Clear error when user types in API key
  apiKeyInput.addEventListener('input', () => {
    if (apiKeyInput.classList.contains('error') && apiKeyInput.value.trim()) {
      apiKeyInput.classList.remove('error');
      clearError();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
