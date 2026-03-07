/**
 * analyzer.js — Claude Vision API integration
 *
 * Sends a minesweeper screenshot to Claude and returns a structured board state.
 */

'use strict';

class AnalyzerError extends Error {
  /**
   * @param {string} message
   * @param {'auth'|'rate_limit'|'overloaded'|'invalid_response'|'no_board'|'network'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'AnalyzerError';
    this.code = code;
  }
}

const ANALYSIS_PROMPT = `You are analyzing a Minesweeper screenshot. Return the board state as JSON.

CELL TYPES:
- "number": revealed cell showing digit 1-8, set "value" to that integer
- "empty": revealed cell with 0 nearby mines (blank/flat appearance), set "value" to 0
- "flag": cell marked with a flag icon, set "value" to null
- "unrevealed": unclicked cell with a raised/3D appearance, set "value" to null

PIXEL COORDINATES:
- "topLeft" is the pixel position (x, y) of the TOP-LEFT CORNER of cell at row=0, col=0 in the ORIGINAL image resolution.
- "cellSize" is the pixel width and height of a single cell in the ORIGINAL image resolution.
- These coordinates must match the original uploaded image dimensions, not any scaled version.

PARTIAL BOARDS: If the screenshot does not show the full board, only include the VISIBLE cells. Set rows/cols to the visible grid dimensions only. Do NOT hallucinate off-screen cells.

IMPORTANT: Return ONLY the JSON object below — no markdown code fences, no explanation, no other text whatsoever:

{"grid":{"rows":<integer>,"cols":<integer>,"cells":[{"row":0,"col":0,"type":"unrevealed","value":null}]},"gridBounds":{"topLeft":{"x":<integer>,"y":<integer>},"cellSize":{"width":<integer>,"height":<integer>}}}

Each cell object must have: "row" (0-indexed), "col" (0-indexed), "type" (one of the 4 types above), "value" (integer or null). Include one object per visible cell in row-major order.`;

/**
 * Constructs the messages array sent to the Claude API.
 * @param {string} base64Image - base64 encoded image (no data URI prefix)
 * @param {string} mediaType - 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
 * @returns {object[]}
 */
function buildAnalysisMessages(base64Image, mediaType) {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Image,
          },
        },
        {
          type: 'text',
          text: ANALYSIS_PROMPT,
        },
      ],
    },
  ];
}

/**
 * Extracts JSON from Claude's response text, handling markdown fences and leading text.
 * @param {string} text
 * @returns {string} cleaned JSON string
 */
function extractJson(text) {
  // Strip markdown fences
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Find outermost { ... }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new AnalyzerError(
      'Claude did not return a valid JSON object. Response: ' + text.slice(0, 200),
      'invalid_response'
    );
  }
  return cleaned.slice(start, end + 1);
}

/**
 * Validates and normalises the raw parsed JSON from Claude.
 * @param {unknown} raw
 * @returns {AnalysisResult}
 * @throws {AnalyzerError}
 */
function parseAnalysisResult(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new AnalyzerError('Response is not an object', 'invalid_response');
  }

  const { grid, gridBounds } = raw;

  if (!grid || typeof grid !== 'object') {
    throw new AnalyzerError('Missing "grid" field', 'invalid_response');
  }
  if (!Array.isArray(grid.cells)) {
    throw new AnalyzerError('grid.cells must be an array', 'invalid_response');
  }
  if (grid.cells.length === 0) {
    throw new AnalyzerError(
      'No cells found. Claude could not detect a minesweeper board in this image.',
      'no_board'
    );
  }
  if (!gridBounds || typeof gridBounds !== 'object') {
    throw new AnalyzerError('Missing "gridBounds" field', 'invalid_response');
  }

  const { topLeft, cellSize } = gridBounds;
  if (!topLeft || typeof topLeft.x !== 'number' || typeof topLeft.y !== 'number') {
    throw new AnalyzerError('Invalid gridBounds.topLeft', 'invalid_response');
  }
  if (!cellSize || typeof cellSize.width !== 'number' || typeof cellSize.height !== 'number') {
    throw new AnalyzerError('Invalid gridBounds.cellSize', 'invalid_response');
  }
  if (cellSize.width <= 0 || cellSize.height <= 0) {
    throw new AnalyzerError('cellSize must be positive', 'invalid_response');
  }

  // Normalise cells
  const validTypes = new Set(['number', 'empty', 'flag', 'unrevealed']);
  const cells = grid.cells.map((cell, i) => {
    if (typeof cell.row !== 'number' || typeof cell.col !== 'number') {
      throw new AnalyzerError(`Cell ${i} missing row/col`, 'invalid_response');
    }
    if (!validTypes.has(cell.type)) {
      // Tolerate unknown types by treating as unrevealed
      return { row: cell.row, col: cell.col, type: 'unrevealed', value: null };
    }
    const value = (cell.type === 'number' || cell.type === 'empty')
      ? (typeof cell.value === 'number' ? cell.value : 0)
      : null;
    return { row: cell.row, col: cell.col, type: cell.type, value };
  });

  return {
    grid: {
      rows: typeof grid.rows === 'number' ? grid.rows : 0,
      cols: typeof grid.cols === 'number' ? grid.cols : 0,
      cells,
    },
    gridBounds: {
      topLeft: { x: Math.round(topLeft.x), y: Math.round(topLeft.y) },
      cellSize: { width: Math.round(cellSize.width), height: Math.round(cellSize.height) },
    },
  };
}

/**
 * Calls the Claude Vision API and returns a parsed board state.
 * @param {string} base64Image
 * @param {string} mediaType
 * @param {string} apiKey
 * @returns {Promise<AnalysisResult>}
 * @throws {AnalyzerError}
 */
async function analyzeBoard(base64Image, mediaType, apiKey) {
  const messages = buildAnalysisMessages(base64Image, mediaType);

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages,
      }),
    });
  } catch (err) {
    throw new AnalyzerError(
      'Network error: ' + err.message + '. Check your internet connection.',
      'network'
    );
  }

  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch (_) {}
    if (response.status === 401) {
      throw new AnalyzerError(
        'Invalid API key. Please check your Claude API key and try again.',
        'auth'
      );
    }
    if (response.status === 429) {
      throw new AnalyzerError(
        'Rate limit reached. Please wait a moment and try again.',
        'rate_limit'
      );
    }
    if (response.status === 529 || response.status === 503) {
      throw new AnalyzerError(
        'Claude API is temporarily overloaded. Please try again in a few seconds.',
        'overloaded'
      );
    }
    throw new AnalyzerError(
      `API error ${response.status}: ${body.slice(0, 200)}`,
      'network'
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new AnalyzerError('Could not parse API response as JSON', 'invalid_response');
  }

  const text =
    data?.content?.[0]?.text ||
    data?.content?.find?.(c => c.type === 'text')?.text;

  if (!text) {
    throw new AnalyzerError('Empty response from Claude', 'invalid_response');
  }

  let raw;
  try {
    const jsonStr = extractJson(text);
    raw = JSON.parse(jsonStr);
  } catch (err) {
    if (err instanceof AnalyzerError) throw err;
    throw new AnalyzerError(
      'Could not parse board JSON from Claude response: ' + err.message,
      'invalid_response'
    );
  }

  return parseAnalysisResult(raw);
}
