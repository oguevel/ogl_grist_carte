/* ============================================================
   APP.JS — Point d'entrée, intégration GRIST API, événements
============================================================ */

'use strict';

/* ------------------------------------------------------------
   DONNÉES GLOBALES PARTAGÉES
------------------------------------------------------------ */
let allRecords = [];

/* ------------------------------------------------------------
   FLAGS DE SYNCHRONISATION
   Attendre que options ET données soient disponibles
   avant de construire la barre de filtres.
------------------------------------------------------------ */
let _optionsReady = false;
let _recordsReady = false;

/* ------------------------------------------------------------
   MODE DE DONNÉES
   Indique si les données proviennent de fetchTable (mode brut)
   ou de onRecords avec columnsMapping (mode mappé).
   Influe sur les noms de colonnes utilisés dans les records.
------------------------------------------------------------ */
let _dataMode = 'raw'; // 'raw' | 'mapped'

/* ------------------------------------------------------------
   MAPPINGS DE COLONNES GRIST
   Quand GRIST utilise columnsMapping, les colonnes reçues
   via onRecords sont renommées selon les clés du mapping.
   
   Exemple :
     columnsMapping = { colRegion: 35, colDept: 37 }
     → dans les records, la colonne région s'appelle "colRegion"
       et NON plus config.colRegion ("region")
   
   Ce dictionnaire stocke la correspondance :
     { "colRegion": "region", "colDept": "uai_departement", ... }
   pour pouvoir retrouver la vraie colonne de config.
   
   En mode 'mapped', on l'utilise à l'envers :
     config.colRegion → chercher quelle clé de mapping pointe
                        vers l'id de colonne correspondant
------------------------------------------------------------ */
let _columnMappings = null; // null = pas de mapping actif

/**
 * Résout le nom de colonne effectif dans un record selon le mode.
 *
 * En mode 'raw'   : retourne directement config.colXxx
 * En mode 'mapped': retourne la clé de mapping correspondante
 *                   (ex: "colRegion" au lieu de "region")
 *
 * @param  {string} configColName - Valeur de config (ex: "region")
 * @param  {string} mappingKey    - Clé dans columnsMapping (ex: "colRegion")
 * @return {string}               - Nom de colonne à utiliser dans les records
 */
function resolveColName(configColName, mappingKey) {
  if (_dataMode === 'mapped' && _columnMappings && _columnMappings[mappingKey]) {
    // En mode mappé, la colonne s'appelle par la clé de mapping
    return mappingKey;
  }
  // En mode brut, on utilise le nom de colonne configuré
  return configColName;
}

/**
 * Tente de construire la barre de filtres.
 * N'exécute buildFilterBar() que si les deux conditions sont réunies.
 */
function tryBuildFilterBar() {
  if (!_optionsReady || !_recordsReady) {
    console.debug(
      '[app.js] tryBuildFilterBar() en attente —',
      `options:${_optionsReady} records:${_recordsReady}`
    );
    return;
  }

  console.debug('[app.js] Les deux sources prêtes → buildFilterBar()');
  console.debug('[app.js] Mode données :', _dataMode);
  console.debug('[app.js] config.colRegion :', config.colRegion);
  console.debug('[app.js] config.colDept :', config.colDept);
  console.debug('[app.js] Exemple premier record :', allRecords[0]);

  buildFilterBar();
  showStatus('Données chargées. Sélectionnez des filtres puis mettez à jour la carte.');
}

/* ============================================================
   UTILITAIRES UI PARTAGÉS
============================================================ */

function showLoader(visible) {
  document.getElementById('loader').classList.toggle('visible', visible);
}

let _statusTimer = null;

function showStatus(msg, duration = 4000) {
  const el       = document.getElementById('status-msg');
  el.textContent = msg;
  el.style.display = 'block';

  if (_statusTimer) clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => { el.style.display = 'none'; }, duration);
}

/* ============================================================
   CONVERSION DU FORMAT DE TABLE GRIST (mode fetchTable)
   
   Convertit le format columnar :
     { col1: [v1,v2,...], col2: [v1,v2,...] }
   en tableau row-oriented :
     [{ col1:v1, col2:v1 }, ...]
============================================================ */
function gristTableToRecords(tableData) {
  if (!tableData) return [];
  const columns = Object.keys(tableData);
  if (columns.length === 0) return [];

  const rowCount = tableData[columns[0]].length;
  const records  = [];

  for (let i = 0; i < rowCount; i++) {
    const record = {};
    columns.forEach(col => { record[col] = tableData[col][i]; });
    records.push(record);
  }
  return records;
}

/* ============================================================
   RÉSOLUTION DES COLONNES EFFECTIVES POUR LES FILTRES
   
   Retourne la configuration de colonnes adaptée au mode actuel.
   Appelée par buildFilterBar() et updateMap() via filters.js.
   
   En mode 'raw'   : retourne les noms de config directement
   En mode 'mapped': retourne les clés de mapping
   
   @return {Object} - { colCoords, colTitle, colRegion, colDept }
============================================================ */
function getEffectiveColNames() {
  if (_dataMode === 'raw' || !_columnMappings) {
    // Mode brut : les records ont les vrais noms de colonnes
    return {
      colCoords : config.colCoords,
      colTitle  : config.colTitle,
      colRegion : config.colRegion,
      colDept   : config.colDept
    };
  }

  // Mode mappé : les records ont les clés de mapping comme noms de colonnes
  // On vérifie quelles clés sont définies dans columnsMapping
  return {
    // Si la clé de mapping existe → utiliser la clé, sinon fallback sur config
    colCoords : _columnMappings.colLatLng  ? 'colLatLng'  : config.colCoords,
    colTitle  : _columnMappings.colTitle   ? 'colTitle'   : config.colTitle,
    colRegion : _columnMappings.colRegion  ? 'colRegion'  : config.colRegion,
    colDept   : _columnMappings.colDept    ? 'colDept'    : config.colDept
  };
}

/* ============================================================
   INTÉGRATION GRIST API
============================================================ */

/**
 * Callback onOptions : reçoit la configuration sauvegardée.
 * 
 * Stratégie de chargement :
 * - Si columnsMapping présent → mode 'mapped', attendre onRecords
 * - Sinon → mode 'raw', charger via fetchTable
 */
function onGristOptions(options) {
  if (!options) {
    console.warn('[app.js] onGristOptions : aucune option reçue');
    return;
  }

  // Mettre à jour config
  Object.assign(config, {
    tableId    : '',
    colCoords  : '',
    colTitle   : '',
    colRegion  : '',
    colDept    : '',
    infoCols   : [],
    filterCols : []
  }, options);

  _optionsReady = true;

  console.debug('[app.js] onGristOptions → config :', JSON.stringify(config));

  // Récupérer les mappings de colonnes depuis GRIST
  // columnsMapping indique que GRIST renomme les colonnes dans onRecords
  grist.api.getMappings()
    .then(mappings => {
      if (mappings && Object.keys(mappings).length > 0) {
        // Mode mappé : GRIST renomme les colonnes
        _columnMappings = mappings;
        _dataMode       = 'mapped';
        console.debug('[app.js] columnsMapping détecté → mode mappé :', mappings);
        // Les données arriveront via onRecords avec les colonnes renommées
        // tryBuildFilterBar() sera appelé depuis onRecords
        tryBuildFilterBar();
      } else {
        // Mode brut : pas de mapping, charger via fetchTable
        _columnMappings = null;
        _dataMode       = 'raw';
        console.debug('[app.js] Pas de columnsMapping → mode brut, fetchTable');

        if (config.tableId) {
          showLoader(true);
          grist.docApi.fetchTable(config.tableId)
            .then(tableData => {
              allRecords    = gristTableToRecords(tableData);
              _recordsReady = true;
              console.debug(`[app.js] fetchTable OK → ${allRecords.length} enregistrements`);
              tryBuildFilterBar();
            })
            .catch(err => {
              console.error('[app.js] Erreur fetchTable :', err);
              showStatus(`Erreur chargement table "${config.tableId}".`);
            })
            .finally(() => showLoader(false));
        }
      }
    })
    .catch(err => {
      // getMappings() non supporté sur certaines versions → fallback fetchTable
      console.warn('[app.js] getMappings() non disponible, fallback fetchTable :', err);
      _columnMappings = null;
      _dataMode       = 'raw';

      if (config.tableId) {
        showLoader(true);
        grist.docApi.fetchTable(config.tableId)
          .then(tableData => {
            allRecords    = gristTableToRecords(tableData);
            _recordsReady = true;
            tryBuildFilterBar();
          })
          .catch(e => {
            console.error('[app.js] Erreur fetchTable :', e);
            showStatus(`Erreur chargement table "${config.tableId}".`);
          })
          .finally(() => showLoader(false));
      }
    });
}

/**
 * onRecords : GRIST pousse les données (mode linked widget ou mappé).
 * En mode mappé, les noms de colonnes correspondent aux clés de mapping.
 */
grist.onRecords(records => {
  if (!records || records.length === 0) {
    console.debug('[app.js] onRecords : aucun enregistrement');
    return;
  }

  allRecords    = records;
  _recordsReady = true;

  console.debug(`[app.js] onRecords → ${records.length} enregistrements`);
  console.debug('[app.js] Clés du premier record :', Object.keys(records[0]));

  tryBuildFilterBar();
});

/**
 * onOptions : réinitialise et relance le cycle de chargement.
 */
grist.onOptions(options => {
  console.debug('[app.js] onOptions appelé');
  _optionsReady   = false;
  _recordsReady   = false;
  _columnMappings = null;
  _dataMode       = 'raw';
  onGristOptions(options);
});

grist.ready({
  requiredAccess: 'read table',
  onEditOptions : () => { openConfigPanel(); }
});

/* ============================================================
   CÂBLAGE DES ÉVÉNEMENTS BOUTONS
============================================================ */
document.getElementById('btn-update')
  .addEventListener('click', updateMap);

document.getElementById('btn-reset')
  .addEventListener('click', resetFilters);

document.getElementById('info-card-close')
  .addEventListener('click', hideInfoCard);

document.getElementById('btn-config-save')
  .addEventListener('click', saveConfig);

document.getElementById('btn-config-cancel')
  .addEventListener('click', closeConfigPanel);

document.getElementById('btn-add-info')
  .addEventListener('click', () => addDynamicItem('list-info-cols', 'info'));

document.getElementById('btn-add-filter')
  .addEventListener('click', () => addDynamicItem('list-filter-cols', 'filter'));

/* ============================================================
   DÉMARRAGE
============================================================ */
initMap();
loadDeptGeoJSON();
