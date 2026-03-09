/**
 * solver.js — Minesweeper constraint propagation solver
 *
 * Given a parsed board state, calculates the mine probability for each
 * unrevealed cell using constraint propagation and subset elimination.
 */

'use strict';

/**
 * Returns the string key for a cell position.
 * @param {number} row
 * @param {number} col
 * @returns {string}
 */
function cellKey(row, col) {
  return `${row},${col}`;
}

/**
 * Returns the 8 (or fewer) neighbor keys for a given cell within grid bounds.
 * @param {number} row
 * @param {number} col
 * @param {number} rows - total grid rows
 * @param {number} cols - total grid columns
 * @returns {string[]}
 */
function getNeighborKeys(row, col, rows, cols) {
  const keys = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        keys.push(cellKey(nr, nc));
      }
    }
  }
  return keys;
}

/**
 * Checks if setA is a proper subset of setB.
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {boolean}
 */
function isProperSubset(setA, setB) {
  if (setA.size >= setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
}

/**
 * Returns setB minus setA as a new Set.
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {Set<string>}
 */
function setDifference(setA, setB) {
  const result = new Set(setB);
  for (const item of setA) result.delete(item);
  return result;
}

/**
 * Produces a canonical string key for a constraint (for deduplication).
 * @param {{ cells: Set<string>, mines: number }} constraint
 * @returns {string}
 */
function constraintKey(constraint) {
  const sorted = [...constraint.cells].sort().join(';');
  return `${constraint.mines}|${sorted}`;
}

/**
 * Builds initial constraints from numbered cells.
 * @param {Map<string, {type: string, value: number|null}>} cellMap
 * @param {number} rows
 * @param {number} cols
 * @returns {{ constraints: Array<{cells: Set<string>, mines: number}>, safeCells: Set<string> }}
 */
function buildConstraints(cellMap, rows, cols) {
  const constraints = [];
  const safeCells = new Set();

  for (const [key, cell] of cellMap) {
    if (cell.type !== 'number' && cell.type !== 'empty') continue;

    const [rowStr, colStr] = key.split(',');
    const row = parseInt(rowStr, 10);
    const col = parseInt(colStr, 10);
    const value = cell.value ?? 0;

    const neighbors = getNeighborKeys(row, col, rows, cols);
    let flaggedCount = 0;
    const unrevealedNeighbors = [];

    for (const nKey of neighbors) {
      const nCell = cellMap.get(nKey);
      if (!nCell) continue; // off-grid neighbor (partial board edge)
      if (nCell.type === 'flag') {
        flaggedCount++;
      } else if (nCell.type === 'unrevealed') {
        unrevealedNeighbors.push(nKey);
      }
    }

    const effectiveMines = value - flaggedCount;

    if (effectiveMines < 0) continue; // inconsistent data, skip
    if (unrevealedNeighbors.length === 0) continue; // fully resolved

    if (effectiveMines > unrevealedNeighbors.length) continue; // impossible, skip

    if (effectiveMines === 0) {
      // All unrevealed neighbors are safe
      for (const nKey of unrevealedNeighbors) safeCells.add(nKey);
    } else {
      constraints.push({
        cells: new Set(unrevealedNeighbors),
        mines: effectiveMines,
      });
    }
  }

  return { constraints, safeCells };
}

/**
 * Applies one round of subset-difference simplification to constraints.
 * Adds new derived constraints; returns true if any were added.
 * @param {Array<{cells: Set<string>, mines: number}>} constraints
 * @param {Set<string>} seenKeys - set of constraintKey strings already present
 * @returns {boolean}
 */
function simplifyOnce(constraints, seenKeys) {
  let changed = false;
  const newConstraints = [];

  for (let i = 0; i < constraints.length; i++) {
    for (let j = 0; j < constraints.length; j++) {
      if (i === j) continue;
      const A = constraints[i];
      const B = constraints[j];
      if (!isProperSubset(A.cells, B.cells)) continue;

      const diffCells = setDifference(A.cells, B.cells);
      const diffMines = B.mines - A.mines;

      if (diffMines < 0 || diffMines > diffCells.size) continue; // impossible

      const derived = { cells: diffCells, mines: diffMines };
      const dKey = constraintKey(derived);
      if (!seenKeys.has(dKey)) {
        seenKeys.add(dKey);
        newConstraints.push(derived);
        changed = true;
      }
    }
  }

  for (const c of newConstraints) constraints.push(c);
  return changed;
}

/**
 * Applies deterministic deductions: mines==0 → all safe, mines==size → all mines.
 * Propagates results into remaining constraints.
 * @param {Array<{cells: Set<string>, mines: number}>} constraints
 * @param {Set<string>} safeSet
 * @param {Set<string>} mineSet
 * @returns {boolean} true if anything changed
 */
function deduceOnce(constraints, safeSet, mineSet) {
  let changed = false;
  const toRemove = new Set();

  for (let i = 0; i < constraints.length; i++) {
    const c = constraints[i];
    if (c.cells.size === 0) {
      toRemove.add(i);
      continue;
    }
    if (c.mines === 0) {
      for (const key of c.cells) safeSet.add(key);
      toRemove.add(i);
      changed = true;
    } else if (c.mines === c.cells.size) {
      for (const key of c.cells) mineSet.add(key);
      toRemove.add(i);
      changed = true;
    }
  }

  // Remove resolved constraints
  for (let i = constraints.length - 1; i >= 0; i--) {
    if (toRemove.has(i)) constraints.splice(i, 1);
  }

  // Propagate known cells into remaining constraints
  for (const c of constraints) {
    const prevSize = c.cells.size;
    let minesRemoved = 0;
    for (const key of [...c.cells]) {
      if (safeSet.has(key)) {
        c.cells.delete(key);
      } else if (mineSet.has(key)) {
        c.cells.delete(key);
        minesRemoved++;
      }
    }
    c.mines -= minesRemoved;
    if (c.cells.size !== prevSize) changed = true;
  }

  return changed;
}

/**
 * Main solver entry point.
 *
 * @param {AnalysisResult} analysisResult
 * @returns {Map<string, {probability: number, certain: boolean} | null>}
 *   Maps "row,col" keys of unrevealed cells to their result.
 *   null means no information (render as '?').
 */
function solve(analysisResult) {
  const { grid, gridBounds: _bounds } = analysisResult;
  const { cells, rows, cols } = grid;

  // Build a fast lookup map
  /** @type {Map<string, {type: string, value: number|null}>} */
  const cellMap = new Map();
  for (const cell of cells) {
    cellMap.set(cellKey(cell.row, cell.col), { type: cell.type, value: cell.value });
  }

  // Collect all unrevealed cell keys
  const unrevealedKeys = new Set();
  for (const [key, cell] of cellMap) {
    if (cell.type === 'unrevealed') unrevealedKeys.add(key);
  }

  if (unrevealedKeys.size === 0) {
    return new Map();
  }

  // Step 1: Build initial constraints
  const { constraints, safeCells: initialSafe } = buildConstraints(cellMap, rows, cols);
  const safeSet = new Set(initialSafe);
  const mineSet = new Set();

  // Step 2 & 3: Iteratively simplify + deduce until stable
  const seenKeys = new Set(constraints.map(constraintKey));
  let maxIter = 200;
  let anyChange = true;
  while (anyChange && maxIter-- > 0) {
    anyChange = false;
    if (deduceOnce(constraints, safeSet, mineSet)) anyChange = true;
    if (simplifyOnce(constraints, seenKeys)) anyChange = true;
    if (deduceOnce(constraints, safeSet, mineSet)) anyChange = true;
  }

  // Step 4: Build the set of "constrained" cells — those that appear in at least one constraint
  const constrainedKeys = new Set();
  for (const c of constraints) {
    for (const key of c.cells) constrainedKeys.add(key);
  }

  // Step 5: Produce probability map
  const result = new Map();

  for (const key of unrevealedKeys) {
    if (safeSet.has(key)) {
      result.set(key, { probability: 0, certain: true });
    } else if (mineSet.has(key)) {
      result.set(key, { probability: 1, certain: true });
    } else if (constrainedKeys.has(key)) {
      // Use the constraint with the HIGHEST mines/cells density for this cell.
      // Highest density gives the most conservative (worst-case) probability and
      // correctly detects cases where one constraint fully determines the cell
      // (e.g. {A,B,mines=2} → 100%) even when other larger constraints exist.
      let bestProb = -1;
      for (const c of constraints) {
        if (c.cells.has(key)) {
          const p = c.cells.size > 0 ? c.mines / c.cells.size : 0;
          if (p > bestProb) bestProb = p;
        }
      }
      if (bestProb >= 0) {
        result.set(key, { probability: Math.min(1, Math.max(0, bestProb)), certain: false });
      } else {
        result.set(key, null);
      }
    } else {
      // No constraint info — too far from any revealed cell
      result.set(key, null);
    }
  }

  return result;
}
