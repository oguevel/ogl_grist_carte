/* ============================================================
   FILTERS.JS — Barre de filtres dynamiques et réactifs
============================================================ */

'use strict';

/**
 * Construit la barre de filtres.
 * Utilise getEffectiveColNames() pour obtenir les bons noms
 * de colonnes selon le mode (brut ou mappé).
 */
function buildFilterBar() {
  const bar = document.getElementById('filter-bar');
  bar.querySelectorAll('.filter-group').forEach(el => el.remove());

  // Résoudre les noms de colonnes effectifs selon le mode de données
  const effectiveCols = getEffectiveColNames();

  console.debug('[filters.js] buildFilterBar avec colonnes effectives :', effectiveCols);

  // Construire la liste des filtres avec les noms de colonnes effectifs
  const allFilters = [];
  if (effectiveCols.colRegion) {
    allFilters.push({ col: effectiveCols.colRegion, label: 'Région' });
  }
  if (effectiveCols.colDept) {
    allFilters.push({ col: effectiveCols.colDept, label: 'Département' });
  }

  // Filtres personnalisés : en mode mappé ils utilisent les vrais noms
  // car filterCols vient de config et les données brutes (fetchTable)
  // ou les colonnes non mappées conservent leurs noms d'origine
  config.filterCols.forEach(col => {
    if (col) allFilters.push({ col, label: col });
  });

  const noMsg    = document.getElementById('no-filter-msg');
  const btnReset = document.getElementById('btn-reset');

  if (allFilters.length === 0) {
    noMsg.style.display = 'inline';
    console.warn('[filters.js] Aucun filtre à afficher. Vérifiez la configuration.');
    return;
  }
  noMsg.style.display = 'none';

  allFilters.forEach(({ col, label }) => {
    const group       = document.createElement('div');
    group.className   = 'filter-group';
    group.dataset.col = col;

    const lbl       = document.createElement('label');
    lbl.textContent = label;

    const sel      = document.createElement('select');
    sel.multiple   = true;
    sel.dataset.col = col;

    sel.addEventListener('change', () => reactiveFilters(col));

    group.appendChild(lbl);
    group.appendChild(sel);
    bar.insertBefore(group, btnReset);
  });

  populateAllFilters(allRecords);

  // Log de vérification : inspecter les valeurs réelles du premier record
  if (allRecords.length > 0) {
    const firstRecord = allRecords[0];
    allFilters.forEach(({ col, label }) => {
      console.debug(
        `[filters.js] Colonne "${col}" (${label}) → valeur exemple :`,
        firstRecord[col] ?? '⚠️ UNDEFINED - colonne introuvable dans les records'
      );
    });
  }
}

/* Les fonctions populateAllFilters, reactiveFilters,
   getCurrentFilterSelections, applyCurrentFilters, resetFilters
   restent identiques à la version précédente.
   Elles utilisent data-col qui contient le nom effectif résolu
   par buildFilterBar() → elles fonctionnent sans modification. */

function populateAllFilters(records) {
  document.querySelectorAll('.filter-group select').forEach(sel => {
    const col      = sel.dataset.col;
    const selected = Array.from(sel.selectedOptions).map(o => o.value);

    const values = [
      ...new Set(
        records
          .map(r => r[col])
          .filter(v => v !== undefined && v !== null && v !== '')
          .map(v => String(v).trim())
      )
    ].sort((a, b) => a.localeCompare(b, 'fr'));

    sel.innerHTML = '';
    values.forEach(v => {
      const opt       = document.createElement('option');
      opt.value       = v;
      opt.textContent = v;
      if (selected.includes(v)) opt.selected = true;
      sel.appendChild(opt);
    });

    console.debug(`[filters.js] Filtre "${col}" → ${values.length} valeurs distinctes`);
  });
}

function reactiveFilters(changedCol) {
  const currentSelections = getCurrentFilterSelections();

  const compatibleRecords = allRecords.filter(record => {
    for (const [col, vals] of Object.entries(currentSelections)) {
      if (col === changedCol) continue;
      if (vals.length === 0)  continue;
      const recVal = record[col] !== undefined ? String(record[col]).trim() : '';
      if (!vals.includes(recVal)) return false;
    }
    return true;
  });

  document.querySelectorAll('.filter-group select').forEach(sel => {
    const col = sel.dataset.col;
    if (col === changedCol) return;

    const selected = Array.from(sel.selectedOptions).map(o => o.value);

    const values = [
      ...new Set(
        compatibleRecords
          .map(r => r[col])
          .filter(v => v !== undefined && v !== null && v !== '')
          .map(v => String(v).trim())
      )
    ].sort((a, b) => a.localeCompare(b, 'fr'));

    sel.innerHTML = '';
    values.forEach(v => {
      const opt       = document.createElement('option');
      opt.value       = v;
      opt.textContent = v;
      if (selected.includes(v)) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

function getCurrentFilterSelections() {
  const selections = {};
  document.querySelectorAll('.filter-group select').forEach(sel => {
    selections[sel.dataset.col] = Array.from(sel.selectedOptions).map(o => o.value);
  });
  return selections;
}

function applyCurrentFilters() {
  const selections = getCurrentFilterSelections();
  return allRecords.filter(record => {
    for (const [col, vals] of Object.entries(selections)) {
      if (vals.length === 0) continue;
      const recVal = record[col] !== undefined ? String(record[col]).trim() : '';
      if (!vals.includes(recVal)) return false;
    }
    return true;
  });
}

function resetFilters() {
  document.querySelectorAll('.filter-group select').forEach(sel => {
    Array.from(sel.options).forEach(opt => opt.selected = false);
  });
  populateAllFilters(allRecords);
  hideInfoCard();
}
