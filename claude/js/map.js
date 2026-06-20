/* ============================================================
   MAP.JS — Carte Leaflet et rendu des données
   
   Responsabilités :
   - Initialiser la carte Leaflet avec le fond IGN
   - Charger le GeoJSON des départements (une seule fois)
   - Mettre à jour la carte selon les filtres (updateMap)
   - Dessiner les contours de départements colorés
   - Gérer les marqueurs (épingles) et le cartouche info
   - Gérer la légende Leaflet
   
   Dépend de : config.js, filters.js
============================================================ */

'use strict';

/* ------------------------------------------------------------
   CONSTANTES
------------------------------------------------------------ */

/**
 * Palette de 20 couleurs pastel en rotation.
 * Utilisée pour colorer les départements présents dans les données.
 * Si plus de 20 départements, les couleurs sont réutilisées (modulo).
 */
const PASTEL_COLORS = [
  '#FFB3BA','#FFDFBA','#FFFFBA','#BAFFC9','#BAE1FF',
  '#E8BAFF','#FFD9BA','#BAFFEE','#FFE4BA','#D4BAFF',
  '#C9F0FF','#FFC9E3','#D4FFD4','#FFE8C9','#C9D4FF',
  '#FFF0C9','#C9FFE5','#FFD4D4','#D4F0FF','#F0D4FF'
];

/**
 * URL du GeoJSON des départements français simplifié.
 * Source : gregoiredavid/france-geojson (MIT License)
 * Propriétés utilisées : code (ex: "75"), nom (ex: "Paris")
 */
const GEOJSON_DEPT_URL =
  'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/' +
  'departements-version-simplifiee.geojson';

/* ------------------------------------------------------------
   ÉTAT DE LA CARTE (variables de module)
------------------------------------------------------------ */
let map           = null;  // Instance L.Map Leaflet
let markersLayer  = null;  // L.LayerGroup des marqueurs (épingles)
let deptLayer     = null;  // L.LayerGroup des contours de départements
let legendControl = null;  // Contrôle Leaflet de la légende

let deptGeoJSON   = null;  // GeoJSON des départements (chargé une fois)
let deptColorMap  = {};    // { normDeptName: couleur } assigné à la volée

/* ============================================================
   INITIALISATION DE LA CARTE LEAFLET
   
   Crée la carte centrée sur la France métropolitaine,
   ajoute le fond IGN Géoportail (WMTS Plan IGN v2)
   et prépare les couches vides.
============================================================ */
function initMap() {
  // Centrage initial sur le centre géographique de la France
  map = L.map('map', {
    center     : [46.5, 2.5],
    zoom       : 6,
    zoomControl: true
  });

  // --- Fond de carte IGN Géoportail (Plan IGN v2) ---
  // Service WMTS public IGN, accès sans clé pour la couche plan.
  // Conforme aux CGU IGN pour usage développement / non commercial.
  L.tileLayer(
    'https://wxs.ign.fr/essentiels/geoportail/wmts?' +
    'SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2' +
    '&STYLE=normal&FORMAT=image/png' +
    '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    {
      attribution: '© <a href="https://www.ign.fr">IGN</a> — Géoportail',
      minZoom: 2,
      maxZoom: 18
    }
  ).addTo(map);

  // Couches vides — alimentées lors de chaque updateMap()
  markersLayer = L.layerGroup().addTo(map);
  deptLayer    = L.layerGroup().addTo(map);

  showStatus('Sélectionnez des filtres puis cliquez sur "Mettre à jour la carte"');
}

/* ============================================================
   CHARGEMENT DU GEOJSON DES DÉPARTEMENTS
   
   Effectue un fetch unique ; les appels suivants utilisent
   le cache `deptGeoJSON` sans re-télécharger.
============================================================ */
async function loadDeptGeoJSON() {
  if (deptGeoJSON) return; // Déjà en mémoire

  showLoader(true);
  try {
    const resp = await fetch(GEOJSON_DEPT_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    deptGeoJSON = await resp.json();
  } catch (e) {
    console.error('[map.js] Erreur chargement GeoJSON départements :', e);
    showStatus('Erreur : impossible de charger les contours des départements.');
  } finally {
    showLoader(false);
  }
}

/* ============================================================
   MISE À JOUR PRINCIPALE DE LA CARTE
   
   Flux :
   1. Appliquer les filtres actifs → filteredRecords
   2. S'assurer que le GeoJSON est chargé
   3. Vider les couches existantes
   4. Identifier les départements concernés
   5. Dessiner les contours des départements
   6. Placer les marqueurs
   7. Recentrer la vue sur les données
   8. Mettre à jour la légende
============================================================ */
async function updateMap() {
  showLoader(true);
  hideInfoCard();

  // Étape 1 — Filtrage des données
  const filteredRecords = applyCurrentFilters();

  if (filteredRecords.length === 0) {
    showLoader(false);
    showStatus('Aucune donnée pour les filtres sélectionnés.');
    markersLayer.clearLayers();
    deptLayer.clearLayers();
    return;
  }

  // Étape 2 — Chargement GeoJSON (si nécessaire)
  await loadDeptGeoJSON();

  // Étape 3 — Nettoyage des couches précédentes
  markersLayer.clearLayers();
  deptLayer.clearLayers();
  deptColorMap = {};

  // Étape 4 — Collecter les noms de départements présents
  const deptNames = collectDeptNames(filteredRecords);

  // Étape 5 — Dessiner les contours
  drawDepartements(deptNames);

  // Étape 6 — Placer les marqueurs
  const boundsPoints = [];

  filteredRecords.forEach(record => {
    const coords = parseCoords(record[config.colCoords]);
    if (!coords) return; // Ignorer les enregistrements sans coordonnées valides

    boundsPoints.push([coords.lat, coords.lon]);

    const title = record[config.colTitle] || 'Sans titre';

    // Marqueur circulaire avec tooltip (titre) et clic → cartouche info
    const marker = L.circleMarker([coords.lat, coords.lon], {
      radius      : 7,
      fillColor   : '#4a90d9',
      color       : '#1a5a9a',
      weight      : 2,
      opacity     : 1,
      fillOpacity : 0.85
    });

    marker.bindTooltip(title, { permanent: false, direction: 'top' });
    marker.on('click', () => showInfoCard(record));

    markersLayer.addLayer(marker);
  });

  // Étape 7 — Recentrer sur l'étendue des données
  if (boundsPoints.length > 0) {
    map.fitBounds(L.latLngBounds(boundsPoints), { padding: [30, 30] });
  }

  // Étape 8 — Légende
  updateLegend();

  showLoader(false);
  showStatus(`${filteredRecords.length} point(s) affiché(s).`);
}

/* ============================================================
   DESSIN DES CONTOURS DE DÉPARTEMENTS
   
   Attribue une couleur pastel à chaque département présent
   dans les données, puis affiche une couche GeoJSON :
   - Département concerné  → fond coloré semi-transparent
   - Département sans données → contour léger, pas de fond
   
   @param {Set<string>} deptNamesSet - Noms/codes de départements
============================================================ */
function drawDepartements(deptNamesSet) {
  if (!deptGeoJSON) return;

  // Attribuer une couleur à chaque département (rotation sur la palette)
  let colorIndex = 0;
  deptNamesSet.forEach(name => {
    deptColorMap[normalizeDeptName(name)] =
      PASTEL_COLORS[colorIndex % PASTEL_COLORS.length];
    colorIndex++;
  });

  L.geoJSON(deptGeoJSON, {
    // Style conditionnel selon la présence du département dans les données
    style: (feature) => {
      const nom  = feature.properties.nom  || '';
      const code = feature.properties.code || '';

      // Test sur le nom normalisé ET le code pour maximiser les correspondances
      const color = deptColorMap[normalizeDeptName(nom)]
                 || deptColorMap[normalizeDeptName(code)]
                 || null;

      return color
        ? { fillColor: color, fillOpacity: 0.45, color: '#555', weight: 1.5, opacity: 0.8 }
        : { fillColor: 'transparent', fillOpacity: 0, color: '#bbb', weight: 0.5, opacity: 0.4 };
    },

    // Tooltip au survol affichant nom et code du département
    onEachFeature: (feature, layer) => {
      const nom  = feature.properties.nom  || '';
      const code = feature.properties.code || '';
      layer.bindTooltip(`${nom} (${code})`, { sticky: true });
    }
  }).addTo(deptLayer);
}

/* ============================================================
   COLLECTE DES NOMS DE DÉPARTEMENTS DANS LES DONNÉES
   
   @param  {Array}     records - Enregistrements filtrés
   @return {Set<string>}       - Valeurs distinctes de colDept
============================================================ */
function collectDeptNames(records) {
  const names = new Set();
  if (!config.colDept) return names;

  records.forEach(r => {
    const val = r[config.colDept];
    if (val) names.add(String(val).trim());
  });
  return names;
}

/* ============================================================
   NORMALISATION DES NOMS DE DÉPARTEMENT
   Supprime accents, tirets, espaces superflus, met en minuscules.
   Permet la correspondance entre données GRIST et GeoJSON.
   
   @param  {string} str - Nom ou code brut
   @return {string}     - Chaîne normalisée
============================================================ */
function normalizeDeptName(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Supprimer les diacritiques
    .replace(/[-_\s]+/g, ' ')
    .trim();
}

/* ============================================================
   PARSING DES COORDONNÉES
   Accepte les formats : "lat,lon" / "lat;lon" / "lat lon"
   
   @param  {string|number} value - Valeur brute de la colonne coords
   @return {{ lat, lon }|null}   - Objet coordonnées ou null si invalide
============================================================ */
function parseCoords(value) {
  if (!value) return null;

  const parts = String(value).trim().split(/[,;|\s]+/).filter(Boolean);
  if (parts.length < 2) return null;

  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);

  // Validation des plages géographiques
  if (isNaN(lat) || isNaN(lon))             return null;
  if (lat < -90  || lat > 90)               return null;
  if (lon < -180 || lon > 180)              return null;

  return { lat, lon };
}

/* ============================================================
   AFFICHAGE DU CARTOUCHE D'INFORMATION
   
   Affiche le panneau latéral #info-card avec le titre et
   les variables configurées dans config.infoCols.
   
   @param {Object} record - Enregistrement GRIST sélectionné
============================================================ */
function showInfoCard(record) {
  const card  = document.getElementById('info-card');
  const title = document.getElementById('info-card-title');
  const body  = document.getElementById('info-card-body');

  title.textContent = record[config.colTitle] || 'Information';
  body.innerHTML    = '';

  if (config.infoCols.length === 0) {
    body.innerHTML = '<p style="color:#8a9ab0;font-size:12px">Aucune variable configurée.</p>';
  } else {
    config.infoCols.forEach(col => {
      if (!col) return;
      const val = record[col] !== undefined ? record[col] : '—';

      const row       = document.createElement('div');
      row.className   = 'info-row';
      row.innerHTML   = `
        <span class="info-label">${col}</span>
        <span class="info-value">${val}</span>
      `;
      body.appendChild(row);
    });
  }

  card.style.display = 'block';
}

/* ============================================================
   MASQUAGE DU CARTOUCHE D'INFORMATION
============================================================ */
function hideInfoCard() {
  document.getElementById('info-card').style.display = 'none';
}

/* ============================================================
   MISE À JOUR DE LA LÉGENDE DES DÉPARTEMENTS
   
   Supprime l'ancienne légende Leaflet et en crée une nouvelle
   listant les départements colorés avec leur couleur.
============================================================ */
function updateLegend() {
  // Retirer l'ancienne légende de la carte
  if (legendControl) {
    map.removeControl(legendControl);
    legendControl = null;
  }

  // Pas de légende si aucun département n'est coloré
  if (Object.keys(deptColorMap).length === 0) return;

  legendControl = L.control({ position: 'bottomleft' });

  legendControl.onAdd = function () {
    const div     = L.DomUtil.create('div', 'legend-control');
    div.innerHTML = '<h4>Départements</h4>';

    // Retrouver les noms complets via le GeoJSON pour un affichage lisible
    if (deptGeoJSON) {
      deptGeoJSON.features.forEach(f => {
        const nom   = f.properties.nom  || '';
        const code  = f.properties.code || '';
        const color = deptColorMap[normalizeDeptName(nom)]
                   || deptColorMap[normalizeDeptName(code)];

        if (color) {
          div.innerHTML += `
            <div class="legend-item">
              <div class="legend-color" style="background:${color}"></div>
              <span>${nom} (${code})</span>
            </div>`;
        }
      });
    }

    return div;
  };

  legendControl.addTo(map);
}
