/* ============================================================
   MAP.JS — Carte Leaflet et rendu des données
   
   Responsabilités :
   - Initialiser la carte Leaflet avec le fond IGN
   - Charger le GeoJSON des départements (une seule fois)
   - Mettre à jour la carte selon les filtres (updateMap)
   - Dessiner les contours de départements colorés
   - Gérer les marqueurs (épingles) et le cartouche info
   - Gérer la légende Leaflet
   
   Dépend de :
   - config.js   → objet `config` (colCoords, colTitle, etc.)
   - filters.js  → applyCurrentFilters()
   - app.js      → showLoader(), showStatus()
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
 * Propriétés utilisées :
 *   feature.properties.code → code du département (ex: "01", "75")
 *   feature.properties.nom  → nom complet (ex: "Ain", "Paris")
 */
const GEOJSON_DEPT_URL =
  'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/' +
  'departements-version-simplifiee.geojson';

/* ------------------------------------------------------------
   ÉTAT DE LA CARTE (variables de module)
   
   Ces variables sont privées à ce module.
   Elles sont initialisées par initMap() au démarrage
   et mises à jour par updateMap() à chaque rafraîchissement.
------------------------------------------------------------ */
let map           = null;  // Instance L.Map Leaflet
let markersLayer  = null;  // L.LayerGroup des marqueurs (épingles)
let deptLayer     = null;  // L.LayerGroup des contours de départements
let legendControl = null;  // Contrôle Leaflet personnalisé pour la légende

let deptGeoJSON   = null;  // GeoJSON des départements (chargé une seule fois)
let deptColorMap  = {};    // { normDeptName: couleur } — construit par updateMap()

/* ============================================================
   INITIALISATION DE LA CARTE LEAFLET
   
   Appelée une seule fois au démarrage depuis app.js.
   Crée la carte, ajoute le fond IGN et prépare les couches vides.
============================================================ */
function initMap() {
  // Centrage initial sur le centre géographique de la France métropolitaine
  map = L.map('map', {
    center     : [46.5, 2.5],
    zoom       : 6,
    zoomControl: true
  });

  // --- Fond de carte IGN Géoportail (Plan IGN v2) ---
  // Service WMTS public IGN, couche plan sans clé API.
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

  showStatus('Sélectionnez des filtres puis cliquez sur "Mettre à jour la carte".');
}

/* ============================================================
   CHARGEMENT DU GEOJSON DES DÉPARTEMENTS
   
   Effectue un fetch unique au premier appel.
   Les appels suivants utilisent le cache `deptGeoJSON`
   sans re-télécharger (guard clause en début de fonction).
   
   Appelée :
   - Au démarrage depuis app.js (en arrière-plan, pré-chargement)
   - Dans updateMap() si pas encore chargé
============================================================ */
async function loadDeptGeoJSON() {
  // Guard : déjà en mémoire, pas besoin de re-télécharger
  if (deptGeoJSON) return;

  showLoader(true);
  try {
    const resp = await fetch(GEOJSON_DEPT_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${resp.statusText}`);
    deptGeoJSON = await resp.json();
    console.debug(`[map.js] GeoJSON chargé : ${deptGeoJSON.features.length} départements`);
  } catch (e) {
    console.error('[map.js] Erreur chargement GeoJSON départements :', e);
    showStatus('Erreur : impossible de charger les contours des départements.');
  } finally {
    showLoader(false);
  }
}

/* ============================================================
   MISE À JOUR PRINCIPALE DE LA CARTE
   
   Point d'entrée principal après interaction utilisateur.
   Appelée au clic sur #btn-update (câblé dans app.js).
   
   Flux d'exécution :
   1. Appliquer les filtres actifs → filteredRecords
   2. S'assurer que le GeoJSON est chargé
   3. Vider les couches existantes
   4. Identifier les départements concernés par les données
   5. Dessiner les contours colorés des départements
   6. Placer les marqueurs sur la carte
   7. Recentrer la vue sur l'étendue des données
   8. Mettre à jour la légende
   
   Dépend de :
   - applyCurrentFilters() dans filters.js
   - config (objet global de config.js)
   - allRecords (variable globale de app.js)
============================================================ */
async function updateMap() {
  showLoader(true);
  hideInfoCard();

  // --- Étape 1 : Filtrage des données ---
  // applyCurrentFilters() lit les <select> actifs et retourne
  // le sous-ensemble de allRecords qui passe tous les filtres.
  const filteredRecords = applyCurrentFilters();

  console.debug(`[map.js] updateMap() → ${filteredRecords.length} enregistrements filtrés`);

  // Cas : aucun enregistrement après filtrage
  if (filteredRecords.length === 0) {
    showLoader(false);
    showStatus('Aucune donnée pour les filtres sélectionnés.');
    markersLayer.clearLayers();
    deptLayer.clearLayers();
    return;
  }

  // --- Étape 2 : Chargement GeoJSON (si nécessaire) ---
  await loadDeptGeoJSON();

  // --- Étape 3 : Nettoyage des couches précédentes ---
  markersLayer.clearLayers();
  deptLayer.clearLayers();
  deptColorMap = {}; // Réinitialiser les couleurs assignées

  // --- Étape 4 : Collecter les noms de départements ---
  // Extrait les valeurs distinctes de la colonne département
  // parmi les enregistrements filtrés.
  const deptNames = collectDeptNames(filteredRecords);
  console.debug(`[map.js] Départements concernés :`, [...deptNames]);

  // --- Étape 5 : Dessiner les contours des départements ---
  drawDepartements(deptNames);

  // --- Étape 6 : Placer les marqueurs ---
  const boundsPoints = []; // Accumuler les coordonnées pour le recentrage

  filteredRecords.forEach(record => {
    // Parser les coordonnées depuis la colonne configurée
    const coords = parseCoords(record[config.colCoords]);

    // Ignorer silencieusement les enregistrements sans coordonnées valides
    if (!coords) {
      console.debug(
        `[map.js] Coordonnées invalides pour "${record[config.colTitle]}" :`,
        record[config.colCoords]
      );
      return;
    }

    boundsPoints.push([coords.lat, coords.lon]);

    // Titre affiché dans le tooltip au survol du marqueur
    const title = record[config.colTitle] || 'Sans titre';

    // Marqueur circulaire Leaflet
    // Le popup complet est délégué au cartouche #info-card (overlay fixe)
    const marker = L.circleMarker([coords.lat, coords.lon], {
      radius      : 7,
      fillColor   : '#4a90d9',
      color       : '#1a5a9a',
      weight      : 2,
      opacity     : 1,
      fillOpacity : 0.85
    });

    // Tooltip léger (survol) → juste le titre
    marker.bindTooltip(title, {
      permanent : false,
      direction : 'top'
    });

    // Clic sur le marqueur → afficher le cartouche d'information complet
    marker.on('click', () => showInfoCard(record));

    markersLayer.addLayer(marker);
  });

  console.debug(`[map.js] ${boundsPoints.length} marqueurs placés`);

  // --- Étape 7 : Recentrer la carte sur l'étendue des données ---
  if (boundsPoints.length > 0) {
    map.fitBounds(
      L.latLngBounds(boundsPoints),
      { padding: [30, 30] }
    );
  }

  // --- Étape 8 : Mettre à jour la légende ---
  updateLegend();

  showLoader(false);
  showStatus(`${filteredRecords.length} point(s) affiché(s).`);
}

/* ============================================================
   DESSIN DES CONTOURS DE DÉPARTEMENTS
   
   Pour chaque département présent dans les données filtrées :
   - Attribue une couleur pastel (rotation sur PASTEL_COLORS)
   - Affiche le polygone avec fond coloré semi-transparent
   
   Pour les autres départements (non concernés) :
   - Affiche uniquement un contour léger sans fond
   
   @param {Set<string>} deptNamesSet
          Set des noms/codes de départements issus des données.
          Ex: Set { "Ain", "Isère", "01", "38" }
============================================================ */
function drawDepartements(deptNamesSet) {
  // Guard : GeoJSON pas encore chargé (ne devrait pas arriver
  // car updateMap() appelle loadDeptGeoJSON() avant)
  if (!deptGeoJSON) {
    console.warn('[map.js] drawDepartements() appelé sans deptGeoJSON');
    return;
  }

  // --- Attribution des couleurs pastel ---
  // Chaque nom de département normalisé reçoit une couleur
  // de la palette en rotation circulaire.
  let colorIndex = 0;
  deptNamesSet.forEach(name => {
    const normName = normalizeDeptName(name);
    deptColorMap[normName] = PASTEL_COLORS[colorIndex % PASTEL_COLORS.length];
    colorIndex++;
  });

  console.debug('[map.js] deptColorMap :', deptColorMap);

  // --- Rendu GeoJSON ---
  L.geoJSON(deptGeoJSON, {

    /**
     * Fonction de style appliquée à chaque feature (département).
     * Cherche si le département est dans deptColorMap en testant
     * à la fois le nom normalisé et le code du département.
     */
    style: (feature) => {
      const nom  = feature.properties.nom  || '';
      const code = feature.properties.code || '';

      // Tester nom ET code pour maximiser les correspondances
      // (les données GRIST peuvent contenir "Ain" ou "01")
      const color = deptColorMap[normalizeDeptName(nom)]
                 || deptColorMap[normalizeDeptName(code)]
                 || null;

      if (color) {
        // Département présent dans les données → fond coloré
        return {
          fillColor   : color,
          fillOpacity : 0.45,
          color       : '#555',
          weight      : 1.5,
          opacity     : 0.8
        };
      } else {
        // Département sans données → contour léger, pas de fond
        return {
          fillColor   : 'transparent',
          fillOpacity : 0,
          color       : '#bbb',
          weight      : 0.5,
          opacity     : 0.4
        };
      }
    },

    /**
     * Callback appliqué à chaque feature après sa création.
     * Ajoute un tooltip au survol affichant nom et code.
     */
    onEachFeature: (feature, layer) => {
      const nom  = feature.properties.nom  || '';
      const code = feature.properties.code || '';
      layer.bindTooltip(`${nom} (${code})`, { sticky: true });
    }

  }).addTo(deptLayer);
}

/* ============================================================
   COLLECTE DES NOMS DE DÉPARTEMENTS DANS LES DONNÉES
   
   Parcourt les enregistrements filtrés et extrait les valeurs
   distinctes de la colonne département configurée.
   
   @param  {Array}      records - Enregistrements filtrés
   @return {Set<string>}        - Valeurs distinctes de config.colDept
============================================================ */
function collectDeptNames(records) {
  const names = new Set();

  // Si aucune colonne département configurée → retourner un Set vide
  if (!config.colDept) {
    console.debug('[map.js] collectDeptNames : config.colDept non défini');
    return names;
  }

  records.forEach(r => {
    const val = r[config.colDept];
    if (val !== undefined && val !== null && val !== '') {
      names.add(String(val).trim());
    }
  });

  return names;
}

/* ============================================================
   NORMALISATION DES NOMS DE DÉPARTEMENT
   
   Transforme un nom ou code de département en forme normalisée
   pour faciliter la correspondance entre les données GRIST
   et les propriétés du GeoJSON.
   
   Transformations appliquées :
   - Passage en minuscules
   - Suppression des diacritiques (accents)
   - Remplacement des tirets, underscores, espaces multiples
   - Suppression des espaces en début/fin
   
   Exemples :
     "Ain"            → "ain"
     "Isère"          → "isere"
     "Côte-d'Or"      → "cote d'or"
     "Bouches-du-Rhône" → "bouches du rhone"
     "01"             → "01"
   
   @param  {string} str - Nom ou code brut
   @return {string}     - Chaîne normalisée
============================================================ */
function normalizeDeptName(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')                    // Décomposer les caractères accentués
    .replace(/[\u0300-\u036f]/g, '')     // Supprimer les diacritiques
    .replace(/[-_\s]+/g, ' ')           // Normaliser les séparateurs
    .trim();
}

/* ============================================================
   PARSING DES COORDONNÉES GÉOGRAPHIQUES
   
   Accepte plusieurs formats de saisie :
   - "48.8566, 2.3522"   (virgule + espace)
   - "48.8566,2.3522"    (virgule seule)
   - "48.8566;2.3522"    (point-virgule)
   - "48.8566 2.3522"    (espace seul)
   - "48.8566|2.3522"    (pipe)
   
   Valide les plages géographiques :
   - latitude  : [-90,  +90]
   - longitude : [-180, +180]
   
   @param  {string|number|null} value - Valeur brute de la colonne coords
   @return {{ lat: number, lon: number }|null}
           Objet coordonnées ou null si invalide/manquant
============================================================ */
function parseCoords(value) {
  if (value === null || value === undefined || value === '') return null;

  // Découper sur les séparateurs reconnus
  const parts = String(value)
    .trim()
    .split(/[,;|\s]+/)
    .filter(Boolean);

  if (parts.length < 2) return null;

  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);

  // Vérifier que les valeurs sont des nombres
  if (isNaN(lat) || isNaN(lon)) return null;

  // Vérifier les plages géographiques valides
  if (lat < -90  || lat > 90)  return null;
  if (lon < -180 || lon > 180) return null;

  return { lat, lon };
}

/* ============================================================
   AFFICHAGE DU CARTOUCHE D'INFORMATION
   
   Affiche le panneau overlay #info-card avec :
   - Le titre du point (config.colTitle)
   - Les variables configurées dans config.infoCols
   
   Appelée au clic sur un marqueur Leaflet dans updateMap().
   
   @param {Object} record - Enregistrement GRIST du point cliqué
============================================================ */
function showInfoCard(record) {
  const card      = document.getElementById('info-card');
  const titleEl   = document.getElementById('info-card-title');
  const bodyEl    = document.getElementById('info-card-body');

  // --- Titre du cartouche ---
  titleEl.textContent = record[config.colTitle] || 'Information';

  // --- Corps du cartouche ---
  bodyEl.innerHTML = '';

  if (config.infoCols.length === 0) {
    // Aucune variable configurée → message d'aide
    bodyEl.innerHTML =
      '<p style="color:#8a9ab0;font-size:12px">Aucune variable configurée.</p>';
  } else {
    // Afficher chaque variable configurée dans infoCols
    config.infoCols.forEach(col => {
      if (!col) return; // Ignorer les entrées vides

      // Valeur de la colonne dans l'enregistrement, '—' si absente
      const val = (record[col] !== undefined && record[col] !== null)
        ? record[col]
        : '—';

      const row       = document.createElement('div');
      row.className   = 'info-row';
      row.innerHTML   = `
        <span class="info-label">${col}</span>
        <span class="info-value">${val}</span>
      `;
      bodyEl.appendChild(row);
    });
  }

  // Rendre le cartouche visible (overlay haut-droit de la carte)
  card.style.display = 'block';
}

/* ============================================================
   MASQUAGE DU CARTOUCHE D'INFORMATION
   
   Appelée par :
   - Le bouton #info-card-close (câblé dans app.js)
   - updateMap() au début de chaque rafraîchissement
   - resetFilters() dans filters.js
============================================================ */
function hideInfoCard() {
  document.getElementById('info-card').style.display = 'none';
}

/* ============================================================
   MISE À JOUR DE LA LÉGENDE DES DÉPARTEMENTS
   
   Crée ou recrée le contrôle Leaflet de légende (coin bas-gauche).
   Liste les départements colorés avec leur couleur pastel.
   
   Appelée par updateMap() après drawDepartements().
   
   Le contrôle précédent est supprimé avant d'en créer un nouveau
   pour éviter les doublons sur la carte.
============================================================ */
function updateLegend() {
  // Supprimer l'ancienne légende si elle existe
  if (legendControl) {
    map.removeControl(legendControl);
    legendControl = null;
  }

  // Pas de légende si aucun département n'est coloré
  if (Object.keys(deptColorMap).length === 0) return;

  // Créer un contrôle Leaflet personnalisé positionné en bas à gauche
  legendControl = L.control({ position: 'bottomleft' });

  legendControl.onAdd = function () {
    const div     = L.DomUtil.create('div', 'legend-control');
    div.innerHTML = '<h4>Départements</h4>';

    // Parcourir le GeoJSON pour retrouver les noms complets des
    // départements colorés (au lieu d'afficher les noms normalisés)
    if (deptGeoJSON) {
      deptGeoJSON.features.forEach(feature => {
        const nom   = feature.properties.nom  || '';
        const code  = feature.properties.code || '';

        // Chercher la couleur par nom normalisé puis par code
        const color = deptColorMap[normalizeDeptName(nom)]
                   || deptColorMap[normalizeDeptName(code)]
                   || null;

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
