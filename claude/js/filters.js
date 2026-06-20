/* ============================================================
   FILTERS.JS — Barre de filtres dynamiques et réactifs
   
   Responsabilités :
   - Construire la barre de filtres à partir de `config`
   - Peupler les <select multiple> avec les valeurs distinctes
   - Implémenter le filtrage en cascade (reactiveFilters)
   - Fournir applyCurrentFilters() pour updateMap() dans map.js
   - Réinitialiser les filtres
   
   Dépend de : config.js (objet `config`, `allRecords`)
============================================================ */

'use strict';

/* ============================================================
   CONSTRUCTION DE LA BARRE DE FILTRES
   
   Génère un .filter-group (label + select multiple) pour :
     1. La colonne région  (si configurée)
     2. La colonne département (si configurée)
     3. Chaque colonne de filterCols (dans l'ordre de config)
   
   Les groupes sont insérés AVANT le bouton Reset dans le DOM.
============================================================ */
function buildFilterBar() {
  const bar = document.getElementById('filter-bar');

  // Supprimer les anciens groupes de filtres (évite les doublons)
  bar.querySelectorAll('.filter-group').forEach(el => el.remove());

  // Construire la liste ordonnée des filtres à afficher
  // Région et département sont toujours en tête si configurés
  const allFilters = [];
  if (config.colRegion) allFilters.push({ col: config.colRegion, label: 'Région' });
  if (config.colDept)   allFilters.push({ col: config.colDept,   label: 'Département' });

  // Filtres personnalisés (libellé = nom de colonne)
  config.filterCols.forEach(col => {
    if (col) allFilters.push({ col, label: col });
  });

  const noMsg    = document.getElementById('no-filter-msg');
  const btnReset = document.getElementById('btn-reset');

  // Cas : aucun filtre configuré
  if (allFilters.length === 0) {
    noMsg.style.display = 'inline';
    return;
  }
  noMsg.style.display = 'none';

  // Créer et insérer chaque groupe de filtre
  allFilters.forEach(({ col, label }) => {
    const group = document.createElement('div');
    group.className  = 'filter-group';
    group.dataset.col = col; // Attribut utile pour cibler le groupe par colonne

    const lbl       = document.createElement('label');
    lbl.textContent = label;

    const sel      = document.createElement('select');
    sel.multiple   = true;
    sel.dataset.col = col;

    // Déclencher le filtrage en cascade à chaque changement de sélection
    sel.addEventListener('change', () => reactiveFilters(col));

    group.appendChild(lbl);
    group.appendChild(sel);

    // Insérer avant le bouton Reset pour respecter l'ordre visuel
    bar.insertBefore(group, btnReset);
  });

  // Peupler les selects avec toutes les valeurs disponibles
  populateAllFilters(allRecords);
}

/* ============================================================
   PEUPLEMENT DE TOUS LES FILTRES
   Remplit chaque <select> avec les valeurs distinctes triées.
   Conserve les sélections existantes si les valeurs sont
   toujours présentes dans le nouveau jeu de données.
   
   @param {Array} records - Tableau d'enregistrements à analyser
============================================================ */
function populateAllFilters(records) {
  document.querySelectorAll('.filter-group select').forEach(sel => {
    const col = sel.dataset.col;

    // Mémoriser les valeurs déjà sélectionnées
    const selected = Array.from(sel.selectedOptions).map(o => o.value);

    // Extraire les valeurs distinctes triées alphabétiquement (français)
    const values = [
      ...new Set(
        records
          .map(r => r[col])
          .filter(v => v !== undefined && v !== null && v !== '')
          .map(v => String(v).trim())
      )
    ].sort((a, b) => a.localeCompare(b, 'fr'));

    // Reconstruire les options
    sel.innerHTML = '';
    values.forEach(v => {
      const opt     = document.createElement('option');
      opt.value     = v;
      opt.textContent = v;
      // Rétablir la sélection si la valeur existe toujours
      if (selected.includes(v)) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

/* ============================================================
   FILTRAGE RÉACTIF EN CASCADE
   
   Quand l'utilisateur modifie un filtre (changedCol), on
   recalcule les valeurs disponibles dans TOUS les autres
   filtres en tenant compte des sélections actives, sauf
   celle du filtre en cours de modification.
   
   Cela évite les combinaisons impossibles (ex : choisir un
   département qui n'existe pas dans la région sélectionnée).
   
   @param {string} changedCol - Colonne dont le filtre a changé
============================================================ */
function reactiveFilters(changedCol) {
  // Snapshot des sélections actuelles sur tous les filtres
  const currentSelections = getCurrentFilterSelections();

  // Calculer les enregistrements compatibles avec TOUS les
  // filtres SAUF celui qui vient d'être modifié
  const compatibleRecords = allRecords.filter(record => {
    for (const [col, vals] of Object.entries(currentSelections)) {
      if (col === changedCol) continue; // Ignorer le filtre modifié
      if (vals.length === 0)  continue; // Filtre vide = pas de contrainte

      const recVal = record[col] !== undefined
        ? String(record[col]).trim()
        : '';

      if (!vals.includes(recVal)) return false;
    }
    return true;
  });

  // Mettre à jour les options de chaque filtre sauf celui modifié
  document.querySelectorAll('.filter-group select').forEach(sel => {
    const col = sel.dataset.col;
    if (col === changedCol) return; // Ne pas toucher au filtre source

    // Conserver la sélection courante de ce filtre
    const selected = Array.from(sel.selectedOptions).map(o => o.value);

    // Recalculer les valeurs disponibles avec les enregistrements compatibles
    const values = [
      ...new Set(
        compatibleRecords
          .map(r => r[col])
          .filter(v => v !== undefined && v !== null && v !== '')
          .map(v => String(v).trim())
      )
    ].sort((a, b) => a.localeCompare(b, 'fr'));

    // Reconstruire les options en conservant la sélection valide
    sel.innerHTML = '';
    values.forEach(v => {
      const opt       = document.createElement('option');
      opt.value       = v;
      opt.textContent = v;
      // Ne conserver que les sélections encore compatibles
      if (selected.includes(v)) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

/* ============================================================
   LECTURE DES SÉLECTIONS ACTUELLES
   
   @return {Object} - { colonne: [valeurs sélectionnées], … }
============================================================ */
function getCurrentFilterSelections() {
  const selections = {};
  document.querySelectorAll('.filter-group select').forEach(sel => {
    selections[sel.dataset.col] = Array.from(sel.selectedOptions).map(o => o.value);
  });
  return selections;
}

/* ============================================================
   APPLICATION DES FILTRES SUR allRecords
   
   Un enregistrement est retenu si, pour chaque filtre ayant
   au moins une valeur sélectionnée, sa valeur de colonne
   figure dans la sélection.
   
   @return {Array} - Sous-ensemble filtré de allRecords
============================================================ */
function applyCurrentFilters() {
  const selections = getCurrentFilterSelections();

  return allRecords.filter(record => {
    for (const [col, vals] of Object.entries(selections)) {
      if (vals.length === 0) continue; // Filtre vide = pas de restriction

      const recVal = record[col] !== undefined
        ? String(record[col]).trim()
        : '';

      if (!vals.includes(recVal)) return false;
    }
    return true;
  });
}

/* ============================================================
   RÉINITIALISATION DE TOUS LES FILTRES
   Désélectionne toutes les options et rétablit
   l'ensemble des valeurs disponibles.
============================================================ */
function resetFilters() {
  document.querySelectorAll('.filter-group select').forEach(sel => {
    Array.from(sel.options).forEach(opt => opt.selected = false);
  });

  // Recharger toutes les valeurs disponibles sans contrainte
  populateAllFilters(allRecords);

  // Masquer le cartouche info si ouvert
  hideInfoCard();
}
