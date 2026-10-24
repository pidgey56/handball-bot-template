/**
 * ==============================================================================
 * HANDBALL BOT - MODÈLE UNIVERSEL POUR CLUBS DE HANDBALL
 * ==============================================================================
 * Solution complète et automatisée pour la gestion hebdomadaire :
 * - Détection automatique des matchs FFHB (scraped depuis ffhandball.fr)
 * - Génération et envoi de sondages de disponibilités sur WhatsApp
 * - Synchronisation bidirectionnelle des votes via GitHub Actions & Baileys
 * - WebApp mobile-first pour les coachs (Compo des matchs en glisser-déposer
 *   ou mode Tinder à cartes swipables, convocations WhatsApp en 1 clic)
 * - Portail Joueurs (code PIN personnel, choix du poste, photo de profil)
 * ==============================================================================
 */

// Laissez vide si le script est lié au classeur Google Sheets (recommandé via Extensions > Apps Script)
const SPREADSHEET_ID_DEFAULT = '';

// Version actuelle de Handball Bot
const APP_VERSION = '2.2.23';
// Dépôt modèle officiel pour la vérification automatique des mises à jour
const UPSTREAM_TEMPLATE_REPO = 'pidgey56/handball-bot-template';
const LOGO_OFFICIEL_ACBB = 'https://media-logos-clubs.ffhandball.fr/256/2023-06-03-e7b37b0d-abbc-4623-9d38-ce7840be40f7.webp';

// Logo de secours (Handball SVG moderne généré dynamiquement selon la couleur principale)
function genererLogoDefaut(couleur) {
  const c = couleur || '#f97316';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const LOGO_DEFAULT = genererLogoDefaut('#f97316');

/**
 * Normalise un code couleur hexadécimal (#ffffff ou ffffff)
 */
function normaliserCouleurHex(valeur, defaut) {
  if (!valeur) return defaut;
  let str = String(valeur).trim();
  if (!str) return defaut;
  if (/^[0-9A-Fa-f]{6}$/.test(str)) return '#' + str;
  if (/^[0-9A-Fa-f]{3}$/.test(str)) return '#' + str;
  if (/^#[0-9A-Fa-f]{6}$/.test(str) || /^#[0-9A-Fa-f]{3}$/.test(str)) return str;
  if (/^(rgb|hsl|[a-zA-Z]+)/.test(str)) return str;
  return defaut;
}

/**
 * Détermine la couleur de texte optimale (#ffffff ou #111827) pour assurer un contraste lisible
 */
function getContrastColor(hexColor) {
  if (!hexColor) return '#ffffff';
  let str = String(hexColor).trim();
  if (str.charAt(0) !== '#') {
    const darkNames = ['black', 'navy', 'darkblue', 'blue', 'indigo', 'purple', 'maroon', 'brown', 'darkgreen'];
    if (darkNames.indexOf(str.toLowerCase()) !== -1) return '#ffffff';
    return '#111827';
  }
  let hex = str.substring(1);
  if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
  if (hex.length !== 6) return '#ffffff';
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 150) ? '#111827' : '#ffffff';
}

const POSTES_TERRAIN = [
  'Gardien',
  'Ailier Gauche',
  'Arrière Gauche',
  'Demi-Centre',
  'Pivot',
  'Arrière Droit',
  'Ailier Droit'
];

/**
 * Récupère le classeur actif ou l'ID enregistré
 */
function getSpreadsheet() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) {
    try {
      PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
    } catch (e) {}
    return ss;
  }
  const propId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || SPREADSHEET_ID_DEFAULT;
  if (propId) {
    return SpreadsheetApp.openById(propId);
  }
  throw new Error('Classeur Google Sheets introuvable. Veuillez exécuter le script depuis votre classeur via Extensions > Apps Script.');
}

/**
 * Lit le statut configuré pour la Caisse Noire (ouverte, fermee, desactivee) depuis l'onglet Configuration
 */
function lireStatutCaisseDepuisSheet(ss) {
  try {
    const classeur = ss || getSpreadsheet();
    if (!classeur) return null;
    const shCfg = classeur.getSheetByName('Configuration');
    if (!shCfg) return null;
    const rows = shCfg.getRange('B18:D36').getValues();
    for (let i = 0; i < rows.length; i++) {
      const lbl = String(rows[i][0] || '').toLowerCase();
      if (lbl.indexOf('caisse') !== -1 && (lbl.indexOf('statut') !== -1 || lbl.indexOf('active') !== -1 || lbl.indexOf('amende') !== -1)) {
        const val = String(rows[i][1] || '').trim().toLowerCase();
        if (/non|d[eé]sactiv[eé]e?|off|false|0/i.test(val)) return 'desactivee';
        if (/ferm[eé]e?|cl[oô]tur[eé]e?|close|bloqu[eé]e?/i.test(val)) return 'fermee';
        if (/oui|ouverte?|active?|open|true|1/i.test(val)) return 'ouverte';
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Enregistre le statut de la Caisse Noire dans l'onglet Configuration
 */
function synchroniserStatutCaisseSheet(ss, statut) {
  try {
    const classeur = ss || getSpreadsheet();
    if (!classeur) return;
    const shCfg = classeur.getSheetByName('Configuration');
    if (!shCfg) return;
    const valSheet = statut === 'desactivee' ? 'DÉSACTIVÉE' : (statut === 'fermee' ? 'FERMÉE' : 'OUVERTE');
    const rows = shCfg.getRange('B18:B36').getValues();
    let rowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const lbl = String(rows[i][0] || '').toLowerCase();
      if (lbl.indexOf('caisse') !== -1 && (lbl.indexOf('statut') !== -1 || lbl.indexOf('active') !== -1 || lbl.indexOf('amende') !== -1)) {
        rowIdx = 18 + i;
        break;
      }
    }
    if (rowIdx !== -1) {
      shCfg.getRange('C' + rowIdx).setValue(valSheet);
    } else {
      for (let r = 33; r <= 37; r++) {
        const vB = String(shCfg.getRange('B' + r).getValue() || '').trim();
        if (!vB || vB.toLowerCase().indexOf('caisse') !== -1) {
          shCfg.getRange('B' + r + ':D' + r).setValues([
            ['Caisse Noire & Amendes (Statut)', valSheet, 'Statut de la caisse : OUVERTE, FERMÉE ou DÉSACTIVÉE (ex: équipe jeune)']
          ]);
          break;
        }
      }
    }
  } catch (e) {}
}

/**
 * Récupère la configuration complète du club depuis l'onglet "Configuration"
 */
function getClubConfig(ss) {
  let classeur = null;
  try {
    classeur = ss || getSpreadsheet();
  } catch (err) {
    return getDefaultConfig();
  }
  if (!classeur) return getDefaultConfig();
  const shCfg = classeur.getSheetByName('Configuration');
  if (!shCfg) return getDefaultConfig();

  const getVal = function(cellRef, def) {
    const v = shCfg.getRange(cellRef).getValue();
    return (v !== null && v !== undefined && String(v).trim() !== '') ? String(v).trim() : def;
  };

  // Lecture des équipes configurées (Lignes 4 à 6 : max 3 équipes pour préserver le Mode Tinder)
  const rowsEq = shCfg.getRange('B4:G6').getValues();
  const equipes = [];
  rowsEq.forEach(function(r, idx) {
    const code = String(r[0] || '').trim();
    const motCle = String(r[1] || '').trim();
    const labelSondage = String(r[2] || code || ('Équipe ' + (idx + 1))).trim();
    const delaiRdv = Number(r[3]) || 1;
    const urlPoule = String(r[4] || '').trim();
    const urlCoupe = String(r[5] || '').trim();
    if (code && (urlPoule || urlCoupe || motCle || labelSondage)) {
      equipes.push({ code: code, motCle: motCle, labelSondage: labelSondage, delaiRdv: delaiRdv, urlPoule: urlPoule, urlCoupe: urlCoupe });
    }
  });

  // Lecture du nombre d'équipes configuré dans les paramètres (C31, D31, scan étendu ou ScriptProperties)
  let nbEquipesCfg = 0;

  // 1. Essai direct cellule C31
  const valC31 = parseInt(getVal('C31', ''), 10);
  if ([1, 2, 3].includes(valC31)) {
    nbEquipesCfg = valC31;
  }

  // 2. Essai cellule D31 ou B31 si décalage de colonne
  if (!nbEquipesCfg) {
    const valD31 = parseInt(getVal('D31', ''), 10);
    if ([1, 2, 3].includes(valD31)) nbEquipesCfg = valD31;
  }

  // 3. Scan étendu de toute la zone de configuration (lignes 18 à 36, colonnes A à F)
  if (!nbEquipesCfg) {
    try {
      const rowsParam = shCfg.getRange('A18:F36').getValues();
      for (let i = 0; i < rowsParam.length; i++) {
        const row = rowsParam[i];
        let foundLabel = false;
        let colLabel = -1;
        for (let c = 0; c < row.length; c++) {
          const pLabel = String(row[c] || '').toLowerCase();
          if (pLabel.indexOf("nombre d'équipe") !== -1 || pLabel.indexOf("nombre d'equipe") !== -1 || pLabel.indexOf("nb equipe") !== -1) {
            foundLabel = true;
            colLabel = c;
            break;
          }
        }
        if (foundLabel) {
          for (let c2 = colLabel + 1; c2 < row.length; c2++) {
            const v = parseInt(row[c2], 10);
            if ([1, 2, 3].includes(v)) {
              nbEquipesCfg = v;
              break;
            }
          }
        }
        if (nbEquipesCfg) break;
      }
    } catch (e) {}
  }

  // 4. Propriété de script en cache
  if (!nbEquipesCfg) {
    try {
      const propNb = parseInt(PropertiesService.getScriptProperties().getProperty('NB_EQUIPES'), 10);
      if ([1, 2, 3].includes(propNb)) {
        nbEquipesCfg = propNb;
      }
    } catch (e) {}
  }

  // 5. Déduction : nombre d'équipes définies en lignes 4-6 ou défaut 2
  if (!nbEquipesCfg) {
    nbEquipesCfg = (equipes.length > 0 && equipes.length <= 3) ? equipes.length : 2;
  }

  // Sauvegarder dans ScriptProperties pour les accès rapides
  try {
    PropertiesService.getScriptProperties().setProperty('NB_EQUIPES', String(nbEquipesCfg));
  } catch (e) {}

  // Compléter ou ajuster la liste des équipes actives
  while (equipes.length < nbEquipesCfg) {
    const idx = equipes.length + 1;
    equipes.push({ code: 'Équipe ' + idx, motCle: 'MON CLUB', labelSondage: 'Équipe ' + idx, delaiRdv: 1, urlPoule: '', urlCoupe: '' });
  }
  const equipesActives = equipes.slice(0, nbEquipesCfg);
  const nbEquipes = nbEquipesCfg;

  // Lecture des entraînements configurés (Feuille Configuration B9:D18 ou ScriptProperties)
  const extraireHoraire = function(str) {
    const m = String(str || '').match(/(\d{1,2}[h:]\d{0,2})/i);
    return m ? m[1].replace(':', 'h') : '20h30';
  };

  const extraireJour = function(str) {
    const s = String(str || '').toUpperCase();
    const jours = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE'];
    for (let i = 0; i < jours.length; i++) {
      if (s.includes(jours[i])) {
        return jours[i].charAt(0) + jours[i].slice(1).toLowerCase();
      }
    }
    return '';
  };

  const mapJourId = {
    'lundi': 'lun', 'mardi': 'mar', 'mercredi': 'mer',
    'jeudi': 'jeu', 'vendredi': 'ven', 'samedi': 'sam', 'dimanche': 'dim'
  };
  const defJours = ['Lundi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const defHoraires = ['20h30', '20h30', '20h30', '20h00', '10h00'];

  let seancesTrain = [];

  // 1. Lire depuis la feuille Configuration (B9:D16) si elle contient des créneaux (la ligne 17 étant l'en-tête Paramètres)
  if (shCfg) {
    try {
      const rowsTrain = shCfg.getRange('B9:D16').getValues();
      for (let i = 0; i < Math.min(4, Math.floor(rowsTrain.length / 2)); i++) {
        const rEnt = rowsTrain[i * 2];
        const rAbs = rowsTrain[i * 2 + 1];
        if (!rEnt || !rEnt[1]) continue;
        const colB = String(rEnt[0] || '').trim().toLowerCase();
        const rawLabelEnt = String(rEnt[1]).trim();
        if (!rawLabelEnt || rawLabelEnt.toLowerCase() === 'désactivé' || rawLabelEnt.toLowerCase() === 'desactive') continue;
        if (rawLabelEnt.toLowerCase() === 'valeur' || colB === 'paramètre' || /paramètre|valeur/i.test(rawLabelEnt)) continue;
        // Si le libellé mentionne un match ou une poule, ce n'est PAS un entraînement
        if (/match|poule|coupe|championnat/i.test(rawLabelEnt)) continue;

        const j = extraireJour(rawLabelEnt) || defJours[i] || ('Séance ' + (i + 1));
        const h = extraireHoraire(rawLabelEnt) || defHoraires[i] || '20h30';
        const baseId = mapJourId[j.toLowerCase()] || ('s' + (i + 1));
        const id = seancesTrain.some(function(x){ return x.id === baseId; }) ? (baseId + '_' + (i + 1)) : baseId;
        const actifEnt = (String(rEnt[2] || '').trim().toUpperCase() === 'OUI');
        // Seules les séances actives (OUI) sont retenues comme entraînements de la semaine
        if (!actifEnt) continue;

        let rawLabelAbs = (rAbs && rAbs[1]) ? String(rAbs[1]).trim() : '';
        if (rawLabelAbs.toLowerCase() === 'désactivé' || rawLabelAbs.toLowerCase() === 'desactive') rawLabelAbs = '';
        const labelAbs = rawLabelAbs || ('Absent ' + j);
        const actifAbs = (rAbs && rAbs[2]) ? (String(rAbs[2] || '').trim().toUpperCase() === 'OUI') : true;

        seancesTrain.push({
          id: id,
          jour: j,
          horaire: h,
          label: rawLabelEnt,
          labelAbsent: labelAbs,
          actif: true,
          actifAbsent: actifAbs
        });
      }
    } catch (e) {
      Logger.log('Erreur lecture B9:D16 shCfg : ' + e.message);
    }
  }

  // 2. Si la feuille est vide, tenter depuis ScriptProperties
  if (!seancesTrain.length) {
    try {
      const rawProp = PropertiesService.getScriptProperties().getProperty('CONFIG_SEANCES_TRAIN');
      if (rawProp) {
        const parsed = JSON.parse(rawProp);
        if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 5) {
          seancesTrain = parsed.filter(function(s) {
            return s.actif !== false && s.actif !== 'NON' && !/match|poule|coupe|championnat/i.test(s.label || '');
          }).map(function(s, idx) {
            const j = String(s.jour || ('Séance ' + (idx + 1))).trim();
            const h = extraireHoraire(s.horaire || '20h30');
            return {
              id: s.id || ('s' + (idx + 1)),
              jour: j,
              horaire: h,
              label: s.label || ('Entraînement ' + j + ' ' + h),
              labelAbsent: s.labelAbsent || ('Absent ' + j),
              actif: true,
              actifAbsent: s.actifAbsent !== false
            };
          });
        }
      }
    } catch (e) {
      Logger.log('Erreur lecture CONFIG_SEANCES_TRAIN : ' + e.message);
    }
  }

  // 3. Fallback par défaut (2 séances actives : Lundi et Mercredi)
  if (!seancesTrain.length) {
    seancesTrain = [
      { id: 'lun', jour: 'Lundi', horaire: '20h30', label: 'Entraînement Lundi 20h30', labelAbsent: 'Absent Lundi', actif: true, actifAbsent: true },
      { id: 'mer', jour: 'Mercredi', horaire: '20h30', label: 'Entraînement Mercredi 20h30', labelAbsent: 'Absent Mercredi', actif: true, actifAbsent: true }
    ];
  }

  const entrainements = [];
  seancesTrain.forEach(function(s) {
    if (s.label) {
      entrainements.push({
        label: s.label,
        actif: s.actif,
        labelAbsent: s.labelAbsent || ('Absent ' + (s.jour || '')),
        actifAbsent: (s.actifAbsent !== false && s.actif)
      });
    }
  });

  const groupId = getVal('C18', '');
  const githubRepo = getVal('C19', '');
  const githubToken = getVal('C20', '');
  const webappUrl = getVal('C21', '');
  const nomClub = getVal('C22', 'Mon Club Handball');
  const logoUrlRaw = getVal('C23', '');
  let salleDefaut = getVal('C24', '');
  if (!salleDefaut) {
    try { salleDefaut = PropertiesService.getScriptProperties().getProperty('SALLE_DEFAUT_CLUB') || 'Domicile'; } catch (e) { salleDefaut = 'Domicile'; }
  }
  let adminPhonesRaw = getVal('C25', '');
  if (!adminPhonesRaw) {
    try {
      const rowsParam = shCfg.getRange('A18:F36').getValues();
      for (let i = 0; i < rowsParam.length; i++) {
        const row = rowsParam[i];
        let foundLbl = false;
        let cLbl = -1;
        for (let c = 0; c < row.length; c++) {
          const lbl = String(row[c] || '').toLowerCase();
          if (lbl.indexOf('coach') !== -1 || lbl.indexOf('admin') !== -1) {
            foundLbl = true;
            cLbl = c;
            break;
          }
        }
        if (foundLbl) {
          for (let c2 = cLbl + 1; c2 < row.length; c2++) {
            const v = String(row[c2] || '').trim();
            if (v && /\d{9,}/.test(v.replace(/[^0-9]/g, ''))) {
              adminPhonesRaw = v;
              break;
            }
          }
        }
        if (adminPhonesRaw) break;
      }
    } catch (e) {}
  }
  const adminPhones = String(adminPhonesRaw || '').split(/[,;]/).map(function(t) { return normaliserNumero(dechiffrerNumero(t.trim())); }).filter(Boolean);

  let urlFfhbClub = getVal('C32', '');
  if (!urlFfhbClub) {
    try { urlFfhbClub = PropertiesService.getScriptProperties().getProperty('URL_PAGE_FFHB_CLUB') || ''; } catch (e) {}
  }

  const cpDef = '#f97316';
  const csDef = '#fbbf24';
  const c1Def = '#3b82f6';
  const c2Def = '#f97316';
  const c3Def = '#10b981';

  const couleurPrimaire = normaliserCouleurHex(getVal('C26', cpDef), cpDef);
  const couleurSecondaire = normaliserCouleurHex(getVal('C27', csDef), csDef);
  const couleurEquipe1 = normaliserCouleurHex(getVal('C28', c1Def), c1Def);
  const couleurEquipe2 = normaliserCouleurHex(getVal('C29', c2Def), c2Def);
  const couleurEquipe3 = normaliserCouleurHex(getVal('C30', c3Def), c3Def);

  const logoFinal = logoUrlRaw ? convertirUrlPhoto(logoUrlRaw) : genererLogoDefaut(couleurPrimaire);

  const labelEq1 = (equipesActives[0] && equipesActives[0].labelSondage) ? equipesActives[0].labelSondage : 'Équipe 1';
  const labelEq2 = (equipesActives[1] && equipesActives[1].labelSondage) ? equipesActives[1].labelSondage : 'Équipe 2';
  const labelEq3 = (equipesActives[2] && equipesActives[2].labelSondage) ? equipesActives[2].labelSondage : 'Équipe 3';

  // Lecture ou déduction des trésoriers et chouchou(x)
  let chouchouConfig = '';
  let tresoriersConfig = '';
  const tresorierPhones = [];

  if (shCfg) {
    try {
      const rowsCfg = shCfg.getRange('B18:C38').getValues();
      for (let i = 0; i < rowsCfg.length; i++) {
        const lbl = String(rowsCfg[i][0] || '').toLowerCase();
        if (lbl.indexOf('chouchou') !== -1) {
          const val = String(rowsCfg[i][1] || '').trim();
          if (val) chouchouConfig = val;
        }
        if (lbl.indexOf('trésorier') !== -1 || lbl.indexOf('tresorier') !== -1) {
          const val = String(rowsCfg[i][1] || '').trim();
          if (val) {
            tresoriersConfig = val;
            val.split(',').forEach(function(item) {
              const cleaned = normaliserNumero(item.trim());
              if (cleaned && cleaned.length >= 10 && !tresorierPhones.includes(cleaned)) {
                tresorierPhones.push(cleaned);
              }
            });
          }
        }
      }
    } catch (e) {}
  }

  try {
    const shEff = classeur.getSheetByName('Effectif');
    if (shEff && shEff.getLastRow() > 1) {
      const maxCols = Math.max(shEff.getLastColumn(), 9);
      const rowsEff = shEff.getRange(2, 1, shEff.getLastRow() - 1, maxCols).getValues();
      const chous = [];
      const tres = [];
      for (let i = 0; i < rowsEff.length; i++) {
        const nom = String(rowsEff[i][0] || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
        if (!nom) continue;
        const valH = rowsEff[i][7];
        if (valH === true || /oui|true|tr[eé]sorier/i.test(String(valH || '').trim())) {
          tres.push(nom);
          const tPhone = normaliserNumero(dechiffrerNumero(rowsEff[i][1]));
          if (tPhone && !tresorierPhones.includes(tPhone)) tresorierPhones.push(tPhone);
        }
        const valI = rowsEff[i][8];
        if (valI === true || /oui|true|chouchou/i.test(String(valI || '').trim())) {
          chous.push(nom);
        }
      }
      if (!chouchouConfig && chous.length > 0) chouchouConfig = chous.join(', ');
      if (!tresoriersConfig && tres.length > 0) tresoriersConfig = tres.join(', ');
    }
  } catch (e) {}

  if (!chouchouConfig) {
    try { chouchouConfig = PropertiesService.getScriptProperties().getProperty('CHOUCHOU_NOM') || ''; } catch (e) {}
  }

  let mvpConfig = getVal('C37', '');
  if (!mvpConfig) {
    try { mvpConfig = PropertiesService.getScriptProperties().getProperty('MVP_NOM') || ''; } catch (e) {}
  }

  let chevreConfig = getVal('C38', '');
  if (!chevreConfig) {
    try { chevreConfig = PropertiesService.getScriptProperties().getProperty('CHEVRE_NOM') || ''; } catch (e) {}
  }

    let modeFonctionnement = '';
  try {
    modeFonctionnement = PropertiesService.getScriptProperties().getProperty('MODE_FONCTIONNEMENT') || '';
  } catch (eProp) {}
  if (!modeFonctionnement && classeur) {
    try {
      const shCfg = classeur.getSheetByName('Configuration');
      if (shCfg) {
        const rows = shCfg.getRange('B18:B45').getValues();
        for (let i = 0; i < rows.length; i++) {
          const lbl = String(rows[i][0] || '').toLowerCase();
          if (lbl.includes('mode') && (lbl.includes('fonctionnement') || lbl.includes('bot'))) {
            modeFonctionnement = String(shCfg.getRange('C' + (18 + i)).getValue() || '').toUpperCase().trim();
            break;
          }
        }
      }
    } catch (eSh) {}
  }
  if (!['COMPLET', 'FFHB_ONLY', 'PRESENCES_ONLY'].includes(modeFonctionnement)) {
    if (!githubRepo && !githubToken) {
      modeFonctionnement = urlFfhbClub ? 'FFHB_ONLY' : 'PRESENCES_ONLY';
    } else {
      modeFonctionnement = 'COMPLET';
    }
  }

  let caisseStatut = 'ouverte';
  const statutSheet = lireStatutCaisseDepuisSheet(classeur);
  if (statutSheet) {
    caisseStatut = statutSheet;
  } else {
    try {
      const propSt = PropertiesService.getScriptProperties().getProperty('CAISSE_NOIRE_STATUT');
      if (propSt && ['ouverte', 'fermee', 'desactivee'].includes(propSt.toLowerCase())) {
        caisseStatut = propSt.toLowerCase();
      }
    } catch (e) {}
  }

  return {
    nomClub: nomClub,
    logoUrl: logoFinal,
    salleDefaut: salleDefaut,
    adminPhones: adminPhones,
    groupId: groupId,
    githubRepo: githubRepo,
    githubToken: githubToken,
    webappUrl: webappUrl,
    equipes: equipesActives,
    nbEquipes: nbEquipes,
    entrainements: entrainements,
    seancesTrain: seancesTrain,
    nomEquipe1: labelEq1,
    nomEquipe2: labelEq2,
    nomEquipe3: labelEq3,
    couleurPrimaire: couleurPrimaire,
    couleurSecondaire: couleurSecondaire,
    couleurEquipe1: couleurEquipe1,
    couleurEquipe2: couleurEquipe2,
    couleurEquipe3: couleurEquipe3,
    urlFfhbClub: urlFfhbClub,
    tresoriers: tresoriersConfig,
    tresorierPhones: tresorierPhones,
    caisseStatut: caisseStatut,
    chouchou: chouchouConfig,
    mvp: mvpConfig,
    chevre: chevreConfig,
    modeFonctionnement: modeFonctionnement
  };
}

function getDefaultConfig() {
  let nbDef = 2;
  try {
    const propNb = parseInt(PropertiesService.getScriptProperties().getProperty('NB_EQUIPES'), 10);
    if ([1, 2, 3].includes(propNb)) nbDef = propNb;
  } catch (e) {}
  return {
    nomClub: 'Mon Club Handball',
    logoUrl: genererLogoDefaut('#f97316'),
    salleDefaut: 'Domicile',
    adminPhones: [],
    groupId: '',
    githubRepo: '',
    githubToken: '',
    webappUrl: '',
    couleurPrimaire: '#f97316',
    couleurSecondaire: '#fbbf24',
    couleurEquipe1: '#3b82f6',
    couleurEquipe2: '#f97316',
    couleurEquipe3: '#10b981',
    equipes: [
      { code: 'Équipe 1', motCle: 'MON CLUB', labelSondage: 'Équipe 1', delaiRdv: 1, urlPoule: '', urlCoupe: '' },
      { code: 'Équipe 2', motCle: 'MON CLUB', labelSondage: 'Équipe 2', delaiRdv: 1, urlPoule: '', urlCoupe: '' },
      { code: 'Équipe 3', motCle: 'MON CLUB', labelSondage: 'Équipe 3', delaiRdv: 1, urlPoule: '', urlCoupe: '' }
    ].slice(0, nbDef),
    nbEquipes: nbDef,
    entrainements: [],
    nomEquipe1: 'Équipe 1',
    nomEquipe2: 'Équipe 2',
    nomEquipe3: 'Équipe 3',
    tresoriers: '',
    tresorierPhones: [],
    caisseStatut: (function(){ try { return PropertiesService.getScriptProperties().getProperty('CAISSE_NOIRE_STATUT') || 'ouverte'; } catch(e){ return 'ouverte'; } })(),
    chouchou: (function(){ try { return PropertiesService.getScriptProperties().getProperty('CHOUCHOU_NOM') || ''; } catch(e){ return ''; } })(),
    mvp: (function(){ try { return PropertiesService.getScriptProperties().getProperty('MVP_NOM') || ''; } catch(e){ return ''; } })(),
    chevre: (function(){ try { return PropertiesService.getScriptProperties().getProperty('CHEVRE_NOM') || ''; } catch(e){ return ''; } })()
  };
}

/**
 * Génère le sondage de la semaine (Matchs FFHB détectés + Créneaux d'entraînement)
 */
function genererSondageHebdo() {
  const ss = getSpreadsheet();
  const cfg = getClubConfig(ss);
  const sheetConfig = ss.getSheetByName('Configuration');
  const sheetMatchs = ss.getSheetByName('Matchs FFHB Détectés');
  const sheetApercu = ss.getSheetByName('Aperçu Sondage WhatsApp');

  const lundiEnCours = getLundiSemaineEnCours(new Date());
  const dimancheSemaine = new Date(lundiEnCours);
  dimancheSemaine.setDate(lundiEnCours.getDate() + 6);
  dimancheSemaine.setHours(23, 59, 59, 999);

  const dateLundiCourt = Utilities.formatDate(lundiEnCours, 'Europe/Paris', 'dd/MM');
  const dateLundiComplet = Utilities.formatDate(lundiEnCours, 'Europe/Paris', 'dd/MM/yyyy');
  const titreSondage = 'Disponibilités semaine du ' + dateLundiCourt;

  // 1. Détection des périodes de vacances & trêves sportives
  const infoVac = getInfoVacancesSemaine(lundiEnCours, dimancheSemaine, ss);
  if (infoVac && infoVac.enVacances) {
    if (sheetMatchs) {
      const nbLignesAClean = Math.max(sheetMatchs.getLastRow() - 3, 2);
      if (nbLignesAClean > 0) sheetMatchs.getRange(4, 1, nbLignesAClean, 11).clearContent();
      const lignesVac = [
        ['', dateLundiComplet, 'Toutes Équipes', '🏖️ Période de vacances : ' + infoVac.nom, '-', '-', '-', '-', '-', 'Pas de match', 'Vacances (' + infoVac.debutTexte + ' au ' + infoVac.finTexte + ')']
      ];
      sheetMatchs.getRange(4, 1, 1, 11).setValues(lignesVac);
    }
    if (sheetApercu) {
      sheetApercu.getRange('B3').setValue('Titre du sondage : [VACANCES] Aucun sondage cette semaine');
      sheetApercu.getRange('B4').setValue('🏖️ ' + infoVac.nom + ' (du ' + infoVac.debutTexte + ' au ' + infoVac.finTexte + ')');
      sheetApercu.getRange('B5').setValue('Pas d\'entraînement ni match programmé. L\'envoi automatique WhatsApp est suspendu.');
      sheetApercu.getRange('B6:B25').clearContent();
    }
    PropertiesService.getScriptProperties().setProperty('DERNIER_SONDAGE_JSON', JSON.stringify({
      titre: '',
      options: [],
      enVacances: true,
      nomVacances: infoVac.nom,
      vacances: infoVac
    }));
    return {
      titre: '',
      options: [],
      enVacances: true,
      nomVacances: infoVac.nom,
      vacances: infoVac
    };
  }

  const optionsMatchs = [];
  const lignesDetectees = [];

  cfg.equipes.forEach(function(eq, index) {
    const urlsAAnalyser = [];
    if (eq.urlPoule) {
      const partsP = String(eq.urlPoule).split(/[\n,;|\s]+/).map(function(u) { return u.trim(); }).filter(function(u) { return u.startsWith('http'); });
      if (partsP.length > 0) {
        partsP.forEach(function(u) { if (!urlsAAnalyser.includes(u)) urlsAAnalyser.push(u); });
      } else {
        urlsAAnalyser.push(eq.urlPoule);
      }
    }
    if (eq.urlCoupe) {
      const partsC = String(eq.urlCoupe).split(/[\n,;|\s]+/).map(function(u) { return u.trim(); }).filter(function(u) { return u.startsWith('http'); });
      if (partsC.length > 0) {
        partsC.forEach(function(u) { if (!urlsAAnalyser.includes(u)) urlsAAnalyser.push(u); });
      } else if (!urlsAAnalyser.includes(eq.urlCoupe)) {
        urlsAAnalyser.push(eq.urlCoupe);
      }
    }

    if (urlsAAnalyser.length === 0) {
      lignesDetectees.push(['', dateLundiComplet, eq.labelSondage, 'URL de poule FFHB non renseignée', '-', '-', '-', '-', '-', '-', 'Configuration manquante']);
      return;
    }

    const motCle = eq.motCle || cfg.nomClub.toUpperCase();
    const resultat = extraireMatchFFHB(urlsAAnalyser, motCle, lundiEnCours, dimancheSemaine);

    if (resultat && resultat.found) {
      const heureRdv = calculerHeureRdv(resultat.heure, eq.delaiRdv);
      const texteRdv = resultat.estDomicile ? '(rdv ' + heureRdv + ')' : '(rdv ' + heureRdv + ' sur place)';
      const lieuTexte = resultat.estDomicile ? 'à domicile' : 'à l’extérieur';
      const salle = resultat.salle || (resultat.estDomicile ? (cfg.salleDefaut || 'Gymnase Domicile') : ('Gymnase ' + (resultat.adversaireCourt || 'Extérieur')));
      const badgeCoupe = resultat.isCoupe ? ' [Coupe]' : '';
      const optionTexte = 'Dispo match ' + eq.labelSondage + badgeCoupe + ' ' + resultat.jourCourt + ' ' + lieuTexte + ' ' + resultat.heure + ' vs ' + resultat.adversaireCourt + ' ' + texteRdv;
      optionsMatchs.push(optionTexte);
      const labelAffiche = eq.labelSondage + (resultat.isCoupe ? ' (Coupe de France)' : '');
      lignesDetectees.push(['', dateLundiComplet, labelAffiche, resultat.dateTexte, resultat.heure, heureRdv, lieuTexte, resultat.adversaire, salle, optionTexte, resultat.statut]);
    } else {
      lignesDetectees.push(['', dateLundiComplet, eq.labelSondage, 'Pas de match trouvé', '-', '-', '-', '-', '-', '-', resultat ? resultat.statut : 'Exempt / Horaire non publié']);
    }
  });

  if (sheetMatchs && lignesDetectees.length > 0) {
    const nbLignesAClean = Math.max(sheetMatchs.getLastRow() - 3, 2);
    if (nbLignesAClean > 0) sheetMatchs.getRange(4, 1, nbLignesAClean, 11).clearContent();
    sheetMatchs.getRange(4, 1, lignesDetectees.length, 11).setValues(lignesDetectees);
  }

  const optionsFinales = [];
  cfg.entrainements.forEach(function(tr) {
    if (tr.actif && tr.label) {
      optionsFinales.push(tr.label);
      if (tr.actifAbsent && tr.labelAbsent) {
        optionsFinales.push(tr.labelAbsent);
      }
    }
  });
  optionsMatchs.forEach(function(opt) { optionsFinales.push(opt); });

  // Sécurité : WhatsApp limite les sondages à 12 options maximum
  if (optionsFinales.length > 12) {
    Logger.log('Tronquage du sondage à 12 options (WhatsApp limite)');
    optionsFinales = optionsFinales.slice(0, 12);
  }

  if (sheetApercu) {
    sheetApercu.getRange('B3').setValue('Titre du sondage : ' + titreSondage);
    sheetApercu.getRange('B4').setValue('Choix multiples : OUI (selectableCount = 0)');
    sheetApercu.getRange('B5:B25').clearContent();
    optionsFinales.forEach(function(opt, idx) {
      sheetApercu.getRange(5 + idx, 2).setValue((idx + 1) + '. ' + opt);
    });
  }

  PropertiesService.getScriptProperties().setProperty('DERNIER_SONDAGE_JSON', JSON.stringify({ titre: titreSondage, options: optionsFinales }));
  return { titre: titreSondage, options: optionsFinales };
}

/**
 * Initialise ou met à jour les en-têtes des onglets essentiels
 */
function initialiserOngletsWebApp(nbEquipesForce) {
  const ss = getSpreadsheet();
  let cfg = getClubConfig(ss);

  if (nbEquipesForce && [1, 2, 3].includes(nbEquipesForce)) {
    cfg.nbEquipes = nbEquipesForce;
    const shCfg = ss.getSheetByName('Configuration');
    if (shCfg) {
      shCfg.getRange('B31:D31').setValues([
        ['Nombre d\'Équipes dans le groupe', nbEquipesForce, 'Nombre d\'équipes gérées (1, 2 ou 3 - défaut : 3)']
      ]);
    }
  } else {
    const shCfg = ss.getSheetByName('Configuration');
    if (shCfg) {
      const vC31 = shCfg.getRange('C31').getValue();
      if (!vC31 || ![1, 2, 3].includes(parseInt(vC31, 10))) {
        shCfg.getRange('B31:D31').setValues([
          ['Nombre d\'Équipes dans le groupe', cfg.nbEquipes || 3, 'Nombre d\'équipes gérées (1, 2 ou 3 - défaut : 3)']
        ]);
      }
    }
  }

  const shCfgHeader = ss.getSheetByName('Configuration');
  if (shCfgHeader) {
    try {
      const g3Val = shCfgHeader.getRange('G3').getValue();
      if (!g3Val) {
        shCfgHeader.getRange('G3').setValue('URL Coupe de France FFHB (optionnel)').setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
      }
    } catch (e) {}
  }

  let shEff = ss.getSheetByName('Effectif');
  if (!shEff) {
    shEff = ss.insertSheet('Effectif');
    shEff.getRange('A1:J1').setValues([['Nom / Surnom', 'Téléphone (format 336...)', 'Poste', 'Équipe habituelle', 'Photo (URL ou lien Drive)', 'Code PIN (Auto)', 'Notes Coach', 'Trésorier', 'Chouchou', 'ID Spakta']]).setFontWeight('bold');
  } else {
    try {
      const hVal = shEff.getRange('H1').getValue();
      if (!hVal) {
        shEff.getRange('H1').setValue('Trésorier').setFontWeight('bold');
      }
      const iVal = shEff.getRange('I1').getValue();
      if (!iVal) {
        shEff.getRange('I1').setValue('Chouchou').setFontWeight('bold');
      }
      const jVal = shEff.getRange('J1').getValue();
      if (!jVal) {
        shEff.getRange('J1').setValue('ID Spakta').setFontWeight('bold');
      }
    } catch (e) {}
  }

  let shVotes = ss.getSheetByName('Votes_Semaine');
  const seances = (cfg.seancesTrain && cfg.seancesTrain.length) ? cfg.seancesTrain.filter(function(s) {
    return s.actif !== false && s.actif !== 'NON' && !/match|poule|coupe|championnat/i.test(s.label || '');
  }) : [
    { jour: 'Lundi' }, { jour: 'Mercredi' }
  ];
  const maxTrainStr = 'Nb Entraînements (0-' + seances.length + ')';
  const entetesVotes = ['Joueur', 'Poste', maxTrainStr, 'Dispo ' + cfg.nomEquipe1];
  if (cfg.nbEquipes >= 2) entetesVotes.push('Dispo ' + cfg.nomEquipe2);
  if (cfg.nbEquipes >= 3) entetesVotes.push('Dispo ' + cfg.nomEquipe3);
  seances.forEach(function(s) {
    entetesVotes.push('Dispo ' + (s.jour || 'Entraînement'));
  });
  if (!shVotes) {
    shVotes = ss.insertSheet('Votes_Semaine');
    shVotes.getRange(1, 1, 1, entetesVotes.length).setValues([entetesVotes]).setFontWeight('bold');
  } else {
    const colMax = Math.max(shVotes.getLastColumn(), entetesVotes.length + 5);
    if (colMax > entetesVotes.length) {
      shVotes.getRange(1, entetesVotes.length + 1, Math.max(shVotes.getLastRow(), 1), colMax - entetesVotes.length).clear();
    }
    shVotes.getRange(1, 1, 1, entetesVotes.length).setValues([entetesVotes]).setFontWeight('bold');
  }

  let shComp = ss.getSheetByName('Compositions');
  let entetesComp;
  if (cfg.nbEquipes === 1) {
    entetesComp = ['Date validation', 'Équipe ' + cfg.nomEquipe1, 'Non convoqués'];
  } else if (cfg.nbEquipes === 3) {
    entetesComp = ['Date validation', 'Équipe ' + cfg.nomEquipe1, 'Équipe ' + cfg.nomEquipe2, 'Équipe ' + cfg.nomEquipe3, 'Non convoqués'];
  } else {
    entetesComp = ['Date validation', 'Équipe ' + cfg.nomEquipe1, 'Équipe ' + cfg.nomEquipe2, 'Non convoqués'];
  }
  if (!shComp) {
    shComp = ss.insertSheet('Compositions');
    shComp.getRange(1, 1, 1, entetesComp.length).setValues([entetesComp]).setFontWeight('bold');
  } else {
    shComp.getRange(1, 1, 1, entetesComp.length).setValues([entetesComp]).setFontWeight('bold');
  }

  let shEnt = ss.getSheetByName('Entrainements');
  if (!shEnt) {
    shEnt = ss.insertSheet('Entrainements');
    shEnt.getRange('A1:E1').setValues([['Date validation', 'Séance', 'Groupe 1 / Effectif retenu', 'Groupe 2', 'Non retenus']]).setFontWeight('bold');
  }

  let shMatchs = ss.getSheetByName('Matchs FFHB Détectés');
  if (!shMatchs) {
    shMatchs = ss.insertSheet('Matchs FFHB Détectés');
    shMatchs.getRange('A1').setValue('Matchs Détectés par le Script FFHB').setFontWeight('bold');
    shMatchs.getRange('B3:K3').setValues([['Semaine du (Lundi)', 'Équipe', 'Date du match', 'Heure match', 'Heure RDV', 'Lieu (Domicile / Extérieur)', 'Adversaire', 'Salle / Gymnase', 'Option générée pour WhatsApp', 'Statut']]).setFontWeight('bold');
  }

  let shApercu = ss.getSheetByName('Aperçu Sondage WhatsApp');
  if (!shApercu) {
    shApercu = ss.insertSheet('Aperçu Sondage WhatsApp');
    shApercu.getRange('A1').setValue('Aperçu du prochain sondage WhatsApp').setFontWeight('bold');
    shApercu.getRange('B3').setValue('Titre du sondage : Disponibilités');
    shApercu.getRange('B4').setValue('Choix multiples : OUI (selectableCount = 0)');
  }

  let shTrophees = ss.getSheetByName('Trophées & Bêtisier');
  if (!shTrophees) {
    try { synchroniserOngletTropheesSheet(ss); } catch (e) {}
  }

  let shAbsences = ss.getSheetByName('Absences');
  if (!shAbsences) {
    try { synchroniserOngletAbsencesSheet(ss); } catch (e) {}
  }

  let shVac = ss.getSheetByName('Vacances');
  if (!shVac) {
    try { synchroniserOngletVacancesSheet(ss); } catch (e) {}
  }

  let shCaisse = ss.getSheetByName('Caisse Noire');
  if (!shCaisse) {
    try { synchroniserOngletCaisseNoireSheet(ss); } catch (e) {}
  }

  let shCovoit = ss.getSheetByName('Covoiturage');
  if (!shCovoit) {
    try { synchroniserOngletCovoiturageSheet(ss); } catch (e) {}
  }

  let shBrouillon = ss.getSheetByName('Brouillon_Compo');
  if (!shBrouillon) {
    try { initialiserOngletBrouillonCompoSheet(ss); } catch (e) {}
  }

  // Vérifier et ajouter les paramètres de couleurs dans Configuration si absents
  const shCfg = ss.getSheetByName('Configuration');
  if (shCfg) {
    const valB26 = String(shCfg.getRange('B26').getValue() || '').trim();
    if (!valB26) {
      shCfg.getRange('B26:D30').setValues([
        ['Couleur Principale Club (Hex)', '#f97316', 'Couleur majeure (en-têtes, boutons, accents)'],
        ['Couleur Secondaire Club (Hex)', '#fbbf24', 'Couleur d\'accent (dégradés, badges, notes)'],
        ['Couleur Équipe 1 (Hex)', '#3b82f6', 'Couleur des maillots / colonne Équipe 1'],
        ['Couleur Équipe 2 (Hex)', '#f97316', 'Couleur des maillots / colonne Équipe 2'],
        ['Couleur Équipe 3 (Hex)', '#10b981', 'Couleur des maillots / colonne Équipe 3']
      ]);
      try {
        shCfg.getRange('D26').setBackground('#f97316').setFontColor('#ffffff').setValue('Aperçu');
        shCfg.getRange('D27').setBackground('#fbbf24').setFontColor('#111827').setValue('Aperçu');
        shCfg.getRange('D28').setBackground('#3b82f6').setFontColor('#ffffff').setValue('Aperçu');
        shCfg.getRange('D29').setBackground('#f97316').setFontColor('#ffffff').setValue('Aperçu');
        shCfg.getRange('D30').setBackground('#10b981').setFontColor('#ffffff').setValue('Aperçu');
      } catch (e) {}
    } else {
      const valB30 = String(shCfg.getRange('B30').getValue() || '').trim();
      if (!valB30) {
        shCfg.getRange('B30:D30').setValues([['Couleur Équipe 3 (Hex)', '#10b981', 'Couleur des maillots / colonne Équipe 3']]);
        try {
          shCfg.getRange('D30').setBackground('#10b981').setFontColor('#ffffff').setValue('Aperçu');
        } catch (e) {}
      }
      const valB31 = String(shCfg.getRange('B31').getValue() || '').trim();
      if (!valB31) {
        shCfg.getRange('B31:D31').setValues([['Nombre d\'Équipes dans le groupe', 3, 'Nombre d\'équipes gérées (1, 2 ou 3 - défaut : 3)']]);
      }
      const valB32 = String(shCfg.getRange('B32').getValue() || '').trim();
      if (!valB32) {
        shCfg.getRange('B32:D32').setValues([['Page FFHB du Club (URL)', '', 'Lien vers monclub.ffhandball.fr (logo et couleurs auto)']]);
      }
      const valB33 = String(shCfg.getRange('B33').getValue() || '').trim();
      if (!valB33) {
        shCfg.getRange('B33:D33').setValues([['Trésoriers Caisse Noire', '', 'Liste des trésoriers autorisés (synchronisé avec l\'onglet Effectif)']]);
      }
      const valB34 = String(shCfg.getRange('B34').getValue() || '').trim();
      if (!valB34) {
        shCfg.getRange('B34:D34').setValues([['Chouchou(x) du Coach', '', 'Nom(s) du ou des chouchoux du coach (synchronisé avec l\'onglet Effectif)']]);
      }
      const valB35 = String(shCfg.getRange('B35').getValue() || '').trim();
      if (!valB35) {
        shCfg.getRange('B35:D35').setValues([['Caisse Noire & Amendes (Statut)', 'OUVERTE', 'Statut de la caisse : OUVERTE, FERMÉE ou DÉSACTIVÉE (ex: équipe jeune)']]);
      }
      const valB36 = String(shCfg.getRange('B36').getValue() || '').trim();
      if (!valB36) {
        shCfg.getRange('B36:D36').setValues([['Périodes de Vacances & Trêves', 'Voir onglet Vacances', 'Périodes sans entraînements, sans matchs et sans sondages WhatsApp']]);
      }
      const valB37 = String(shCfg.getRange('B37').getValue() || '').trim();
      if (!valB37) {
        shCfg.getRange('B37:D37').setValues([['MVP Actuel (Dernier match)', '', 'Joueur désigné MVP du dernier match (synchronisé avec l\'onglet Trophées)']]);
      }
      const valB38 = String(shCfg.getRange('B38').getValue() || '').trim();
      if (!valB38) {
        shCfg.getRange('B38:D38').setValues([['Chèvre Actuelle (Dernier match)', '', 'Joueur désigné Chèvre du dernier match (synchronisé avec l\'onglet Trophées)']]);
      }
    }

    // Restaurer les libellés B22 à B25 s'ils ont été effacés ou modifiés par erreur (sans toucher aux valeurs de C22:C25)
    try {
      const vB22 = String(shCfg.getRange('B22').getValue() || '').trim();
      if (!vB22 || vB22.toLowerCase() === 'url_final') shCfg.getRange('B22').setValue('Nom du Club');

      const vB23 = String(shCfg.getRange('B23').getValue() || '').trim();
      if (!vB23) shCfg.getRange('B23').setValue('Logo du Club (URL)');

      const vB24 = String(shCfg.getRange('B24').getValue() || '').trim();
      if (!vB24) {
        shCfg.getRange('B24').setValue('Gymnase / Ville Domicile');
        shCfg.getRange('D24').setValue('Nom de votre salle pour les matchs à domicile');
      }

      const vB25 = String(shCfg.getRange('B25').getValue() || '').trim();
      if (!vB25) {
        shCfg.getRange('B25').setValue('Numéros Coachs (ex: 336...)');
        shCfg.getRange('D25').setValue('Numéros des coachs autorisés (séparés par virgules)');
      }
    } catch (e) {}

    try {
      synchroniserTresoriersEtChouchouxSheet(ss);
    } catch (e) {}
  }
}

/**
 * Synchronise bidirectionnellement les Trésoriers et Chouchoux entre
 * l'onglet "Effectif" (cols H & I) et l'onglet "Configuration" (lignes Trésoriers / Chouchou).
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - Le classeur Google Sheets (optionnel)
 * @param {string} source - 'effectif' | 'configuration' | 'auto' (défaut: 'auto')
 * @return {Object} { tresoriers: string[], chouchoux: string[] }
 */
function synchroniserTresoriersEtChouchouxSheet(ss, source) {
  if (!ss) ss = getSpreadsheet();
  source = String(source || 'auto').toLowerCase();

  const shEff = ss.getSheetByName('Effectif');
  const shCfg = ss.getSheetByName('Configuration');
  if (!shEff) return { tresoriers: [], chouchoux: [] };

  // Vérifier et initialiser les en-têtes colonnes H et I dans Effectif si absents
  try {
    const h1 = shEff.getRange('H1').getValue();
    if (!h1) shEff.getRange('H1').setValue('Trésorier').setFontWeight('bold');
    const i1 = shEff.getRange('I1').getValue();
    if (!i1) shEff.getRange('I1').setValue('Chouchou').setFontWeight('bold');
  } catch (e) {}

  // Trouver les lignes Trésoriers et Chouchoux dans Configuration
  let rowTresCfg = -1;
  let rowChouCfg = -1;
  let valTresCfg = '';
  let valChouCfg = '';

  if (shCfg) {
    try {
      const cfgRange = shCfg.getRange('B18:D38').getValues();
      for (let r = 0; r < cfgRange.length; r++) {
        const lbl = String(cfgRange[r][0] || '').toLowerCase();
        if (lbl.indexOf('trésorier') !== -1 || lbl.indexOf('tresorier') !== -1) {
          rowTresCfg = 18 + r;
          valTresCfg = String(cfgRange[r][1] || '').trim();
        } else if (lbl.indexOf('chouchou') !== -1) {
          rowChouCfg = 18 + r;
          valChouCfg = String(cfgRange[r][1] || '').trim();
        }
      }

      // Si non trouvés, créer les lignes B33 / B34
      if (rowTresCfg === -1) {
        rowTresCfg = 33;
        shCfg.getRange('B33:D33').setValues([['Trésoriers Caisse Noire', '', 'Liste des trésoriers autorisés (synchronisé avec l\'onglet Effectif)']]);
      }
      if (rowChouCfg === -1) {
        rowChouCfg = 34;
        shCfg.getRange('B34:D34').setValues([['Chouchou(x) du Coach', '', 'Nom(s) du ou des chouchoux du coach (synchronisé avec l\'onglet Effectif)']]);
      }
    } catch (e) {}
  }

  // Lecture des joueurs de l'onglet Effectif
  const lastRowEff = shEff.getLastRow();
  const maxColsEff = Math.max(shEff.getLastColumn(), 9);
  let rowsEff = [];
  if (lastRowEff > 1) {
    rowsEff = shEff.getRange(2, 1, lastRowEff - 1, maxColsEff).getValues();
  }

  const nomsEff = [];
  const tresoriersEff = [];
  const chouchouxEff = [];

  for (let i = 0; i < rowsEff.length; i++) {
    const rawNom = String(rowsEff[i][0] || '').trim();
    const nom = rawNom.replace(/\s*\([^)]*\)\s*/g, '').trim();
    if (!nom) continue;
    nomsEff.push({ index: i, nom: nom, rawNom: rawNom });

    const valH = rowsEff[i][7];
    if (valH === true || /oui|true|tr[eé]sorier/i.test(String(valH || '').trim())) {
      tresoriersEff.push(nom);
    }

    const valI = rowsEff[i][8];
    if (valI === true || /oui|true|chouchou/i.test(String(valI || '').trim())) {
      chouchouxEff.push(nom);
    }
  }

  let tresoriersFinaux = [];
  let chouchouxFinaux = [];

  if (source === 'configuration') {
    // La feuille Configuration fait foi : propager vers Effectif
    const listeNomsTresCfg = valTresCfg.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
    const listeNomsChouCfg = valChouCfg.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);

    for (let k = 0; k < nomsEff.length; k++) {
      const nom = nomsEff[k].nom;
      const rowIndex = nomsEff[k].index + 2;

      const isTres = (listeNomsTresCfg.indexOf(nom.toLowerCase()) !== -1);
      shEff.getRange(rowIndex, 8).setValue(isTres ? 'OUI' : 'NON');
      if (isTres) tresoriersFinaux.push(nom);

      const isChou = (listeNomsChouCfg.indexOf(nom.toLowerCase()) !== -1);
      shEff.getRange(rowIndex, 9).setValue(isChou ? 'OUI' : 'NON');
      if (isChou) chouchouxFinaux.push(nom);
    }
  } else if (source === 'effectif') {
    // La feuille Effectif fait foi : propager vers Configuration
    tresoriersFinaux = tresoriersEff;
    chouchouxFinaux = chouchouxEff;

    if (shCfg) {
      if (rowTresCfg > 0) shCfg.getRange(rowTresCfg, 3).setValue(tresoriersFinaux.join(', '));
      if (rowChouCfg > 0) shCfg.getRange(rowChouCfg, 3).setValue(chouchouxFinaux.join(', '));
    }
  } else {
    // Mode 'auto' : réconciliation intelligente
    // 1. Trésoriers
    if (tresoriersEff.length > 0) {
      tresoriersFinaux = tresoriersEff;
      if (shCfg && rowTresCfg > 0) {
        shCfg.getRange(rowTresCfg, 3).setValue(tresoriersFinaux.join(', '));
      }
    } else if (valTresCfg) {
      const listeTresCfg = valTresCfg.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
      for (let k = 0; k < nomsEff.length; k++) {
        const nom = nomsEff[k].nom;
        const rowIndex = nomsEff[k].index + 2;
        const isTres = (listeTresCfg.indexOf(nom.toLowerCase()) !== -1);
        if (isTres) {
          shEff.getRange(rowIndex, 8).setValue('OUI');
          tresoriersFinaux.push(nom);
        } else {
          shEff.getRange(rowIndex, 8).setValue('NON');
        }
      }
    }

    // 2. Chouchoux
    if (chouchouxEff.length > 0) {
      chouchouxFinaux = chouchouxEff;
      if (shCfg && rowChouCfg > 0) {
        shCfg.getRange(rowChouCfg, 3).setValue(chouchouxFinaux.join(', '));
      }
    } else if (valChouCfg) {
      const listeChouCfg = valChouCfg.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
      for (let k = 0; k < nomsEff.length; k++) {
        const nom = nomsEff[k].nom;
        const rowIndex = nomsEff[k].index + 2;
        const isChou = (listeChouCfg.indexOf(nom.toLowerCase()) !== -1);
        if (isChou) {
          shEff.getRange(rowIndex, 9).setValue('OUI');
          chouchouxFinaux.push(nom);
        } else {
          shEff.getRange(rowIndex, 9).setValue('NON');
        }
      }
    } else {
      let propChou = '';
      try { propChou = PropertiesService.getScriptProperties().getProperty('CHOUCHOU_NOM') || ''; } catch (e) {}
      if (propChou) {
        const listePropChou = propChou.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
        for (let k = 0; k < nomsEff.length; k++) {
          const nom = nomsEff[k].nom;
          const rowIndex = nomsEff[k].index + 2;
          const isChou = (listePropChou.indexOf(nom.toLowerCase()) !== -1);
          if (isChou) {
            shEff.getRange(rowIndex, 9).setValue('OUI');
            chouchouxFinaux.push(nom);
          }
        }
        if (shCfg && rowChouCfg > 0) shCfg.getRange(rowChouCfg, 3).setValue(chouchouxFinaux.join(', '));
      }
    }
  }

  // Synchroniser ScriptProperties avec le ou les chouchou(x) finaux
  try {
    PropertiesService.getScriptProperties().setProperty('CHOUCHOU_NOM', chouchouxFinaux.join(', '));
  } catch (e) {}

  return {
    tresoriers: tresoriersFinaux,
    chouchoux: chouchouxFinaux
  };
}

/**
 * Initialise l'intégralité du classeur avec onglets, exemples et mise en page (1 clic pour démarrer)
 */
function initialiserClasseurComplet() {
  const ss = getSpreadsheet();

  // Sécurité anti-écrasement : vérifier si la configuration contient déjà des données réelles du club
  const shCfgCheck = ss.getSheetByName('Configuration');
  if (shCfgCheck) {
    const idExistant = String(shCfgCheck.getRange('C18').getValue() || '').trim();
    const repoExistant = String(shCfgCheck.getRange('C19').getValue() || '').trim();
    const eq1Existant = String(shCfgCheck.getRange('B4').getValue() || '').trim();
    const hasData = (idExistant && idExistant !== '120363xxxxxxxxx@g.us') || 
                    (repoExistant && repoExistant !== 'votre-pseudo/handball-bot') ||
                    (eq1Existant && eq1Existant !== 'Équipe 1');
    if (hasData) {
      try {
        const ui = SpreadsheetApp.getUi();
        const conf = ui.alert(
          '⚠️ Configuration personnalisée détectée',
          'Votre feuille "Configuration" contient déjà des paramètres enregistrés (ID WhatsApp, équipes, créneaux...).\n\n' +
          '• Cliquez sur OUI pour mettre à jour la structure et les onglets SANS écraser vos données.\n' +
          '• Cliquez sur NON pour annuler.',
          ui.ButtonSet.YES_NO
        );
        if (conf === ui.Button.YES) {
          initialiserOngletsWebApp();
          SpreadsheetApp.getActiveSpreadsheet().toast('Onglets et structure mis à jour avec succès (vos paramètres ont été conservés).', 'Handball Bot');
        }
        return;
      } catch (e) {}
    }
  }

  let nbEquipesChoisi = 3;
  try {
    const ui = SpreadsheetApp.getUi();
    const rep = ui.prompt(
      '🏉 Handball Bot - Initialisation',
      'Combien d\'équipes séniors sont gérées dans ce groupe WhatsApp ?\n\n' +
      'Entrez 1, 2 ou 3 (par défaut : 3) :',
      ui.ButtonSet.OK_CANCEL
    );
    if (rep.getSelectedButton() === ui.Button.OK) {
      const saisie = parseInt(rep.getResponseText().trim(), 10);
      if ([1, 2, 3].includes(saisie)) {
        nbEquipesChoisi = saisie;
      }
    }
  } catch (e) {
    nbEquipesChoisi = 3;
  }

  let shCfg = ss.getSheetByName('Configuration');
  if (!shCfg) {
    shCfg = ss.insertSheet('Configuration', 0);
  }

  shCfg.getRange('A1').setValue("Paramètres d'Automatisation - Handball Bot").setFontWeight('bold').setFontSize(13);
  shCfg.getRange('B3:G3').setValues([['Code Équipe', 'Nom recherché (Mot-clé FFHB)', 'Libellé dans le sondage', 'Délai RDV avant match (heures)', 'URL de la poule FFHB', 'URL Coupe de France FFHB (optionnel)']]).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  shCfg.getRange('B4:G6').setValues([
    ['Équipe 1', 'MON CLUB', 'Équipe 1', 1.0, 'https://www.ffhandball.fr/competitions/...', ''],
    ['Équipe 2', 'MON CLUB', 'Équipe 2', 1.0, 'https://www.ffhandball.fr/competitions/...', ''],
    ['Équipe 3', 'MON CLUB', 'Équipe 3', 1.0, 'https://www.ffhandball.fr/competitions/...', '']
  ]);

  shCfg.getRange('B8:D8').setValues([['Ordre', "Intitulé de l'option dans le sondage", 'Actif (OUI/NON)']]).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  shCfg.getRange('B9:D16').setValues([
    [1, 'Entraînement Lundi 20h30', 'OUI'],
    [2, 'Absent Lundi', 'OUI'],
    [3, 'Entraînement Mercredi 20h30', 'OUI'],
    [4, 'Absent Mercredi', 'OUI'],
    [5, 'Entraînement Jeudi 20h30', 'NON'],
    [6, 'Absent Jeudi', 'NON'],
    [7, 'Désactivé', 'NON'],
    [8, 'Désactivé', 'NON']
  ]);

  shCfg.getRange('B17:D17').setValues([['Paramètre', 'Valeur', 'Aperçu / Description']]).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  shCfg.getRange('B18:D34').setValues([
    ['ID du Groupe WhatsApp', '120363xxxxxxxxx@g.us', 'Identifiant du groupe WhatsApp (...@g.us)'],
    ['Dépôt GitHub (owner/repo)', 'votre-pseudo/handball-bot', 'Format: utilisateur/depot'],
    ['Token GitHub (PAT)', 'ghp_VOTRE_TOKEN_ICI', 'Token GitHub classic avec droit repo'],
    ['URL WebApp (Auto)', '', 'URL de votre déploiement WebApp Apps Script'],
    ['Nom du Club', 'Mon Club Handball', 'Nom officiel affiché sur l\'application'],
    ['Logo du Club (URL)', '', 'Lien direct vers le blason (ou vide pour logo auto)'],
    ['Gymnase / Ville Domicile', 'Gymnase Municipal', 'Nom de votre salle pour les matchs à domicile'],
    ['Numéros Coachs (ex: 336...)', '33600000000', 'Numéros des coachs autorisés (séparés par virgules)'],
    ['Couleur Principale Club (Hex)', '#f97316', 'Couleur majeure (en-têtes, boutons, accents)'],
    ['Couleur Secondaire Club (Hex)', '#fbbf24', 'Couleur d\'accent (dégradés, badges, notes)'],
    ['Couleur Équipe 1 (Hex)', '#3b82f6', 'Couleur des maillots / colonne Équipe 1'],
    ['Couleur Équipe 2 (Hex)', '#f97316', 'Couleur des maillots / colonne Équipe 2'],
    ['Couleur Équipe 3 (Hex)', '#10b981', 'Couleur des maillots / colonne Équipe 3'],
    ['Nombre d\'Équipes dans le groupe', nbEquipesChoisi, 'Nombre d\'équipes gérées (1, 2 ou 3 - défaut : 3)'],
    ['Page FFHB du Club (URL)', '', 'Lien vers monclub.ffhandball.fr (logo et couleurs auto)'],
    ['Trésoriers Caisse Noire', '', 'Liste des trésoriers autorisés (synchronisé avec l\'onglet Effectif)'],
    ['Chouchou(x) du Coach', '', 'Nom(s) du ou des chouchoux du coach (synchronisé avec l\'onglet Effectif)']
  ]);

  try {
    shCfg.getRange('D26').setBackground('#f97316').setFontColor('#ffffff').setValue('Aperçu');
    shCfg.getRange('D27').setBackground('#fbbf24').setFontColor('#111827').setValue('Aperçu');
    shCfg.getRange('D28').setBackground('#3b82f6').setFontColor('#ffffff').setValue('Aperçu');
    shCfg.getRange('D29').setBackground('#f97316').setFontColor('#ffffff').setValue('Aperçu');
    shCfg.getRange('D30').setBackground('#10b981').setFontColor('#ffffff').setValue('Aperçu');
  } catch (e) {}

  initialiserOngletsWebApp(nbEquipesChoisi);

  const shEff = ss.getSheetByName('Effectif');
  if (shEff && shEff.getLastRow() <= 1) {
    shEff.getRange(2, 1, 6, 7).setValues([
      ['Lucas Martin', chiffrerNumero('33601020304'), 'Gardien', 'Équipe 1', '', '', 'Exemple note coach'],
      ['Thomas Dupont', chiffrerNumero('33602030405'), 'Demi-Centre', 'Équipe 1', '', '', 'Capitaine'],
      ['Maxime Bernard', chiffrerNumero('33603040506'), 'Pivot', 'Équipe 2', '', '', ''],
      ['Julien Robert', chiffrerNumero('33604050607'), 'Ailier Gauche', 'Équipe 2', '', '', ''],
      ['Alexandre Petit', chiffrerNumero('33605060708'), 'Arrière Droit', 'Équipe 1', '', '', ''],
      ['Romain Laurent', chiffrerNumero('33606070809'), 'Arrière Gauche', 'Équipe 1', '', '', '']
    ]);
  }

  actualiserCouleursClasseur();
  SpreadsheetApp.getActiveSpreadsheet().toast('Classeur initialisé avec succès ! Configurez vos équipes et vos couleurs dans l\'onglet Configuration.', 'Handball Bot');
}

/**
 * Permet au coach d'enregistrer les couleurs du club directement depuis la WebApp
 */
function enregistrerCouleursClub(telCoach, pinCoach, nouvellesCouleurs) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }

  const shCfg = ss.getSheetByName('Configuration');
  if (!shCfg) throw new Error('Onglet Configuration introuvable.');

  const cp = normaliserCouleurHex(nouvellesCouleurs.primaire, '#f97316');
  const cs = normaliserCouleurHex(nouvellesCouleurs.secondaire, '#fbbf24');
  const c1 = normaliserCouleurHex(nouvellesCouleurs.equipe1, cp);
  const c2 = normaliserCouleurHex(nouvellesCouleurs.equipe2, cs);
  const c3 = normaliserCouleurHex(nouvellesCouleurs.equipe3, '#10b981');
  const nbEq = parseInt(nouvellesCouleurs.nbEquipes, 10);

  shCfg.getRange('B26:C30').setValues([
    ['Couleur Principale Club (Hex)', cp],
    ['Couleur Secondaire Club (Hex)', cs],
    ['Couleur Équipe 1 (Hex)', c1],
    ['Couleur Équipe 2 (Hex)', c2],
    ['Couleur Équipe 3 (Hex)', c3]
  ]);

  if ([1, 2, 3].includes(nbEq)) {
    shCfg.getRange('B31:D31').setValues([
      ['Nombre d\'Équipes dans le groupe', nbEq, 'Nombre d\'équipes gérées (1, 2 ou 3 - défaut : 3)']
    ]);
    try {
      PropertiesService.getScriptProperties().setProperty('NB_EQUIPES', String(nbEq));
    } catch (e) {}
  }

  if (Array.isArray(nouvellesCouleurs.equipes)) {
    for (let idx = 0; idx < 3; idx++) {
      const eq = nouvellesCouleurs.equipes[idx];
      const rowNum = 4 + idx;
      if (eq) {
        if (eq.code !== undefined) shCfg.getRange('B' + rowNum).setValue(eq.code);
        if (eq.motCle !== undefined) shCfg.getRange('C' + rowNum).setValue(eq.motCle);
        if (eq.labelSondage !== undefined) shCfg.getRange('D' + rowNum).setValue(eq.labelSondage);
        if (eq.delaiRdv !== undefined) shCfg.getRange('E' + rowNum).setValue(Number(eq.delaiRdv) || 1);
        if (eq.urlPoule !== undefined) shCfg.getRange('F' + rowNum).setValue(eq.urlPoule);
        if (eq.urlCoupe !== undefined) shCfg.getRange('G' + rowNum).setValue(eq.urlCoupe);
      }
    }
  }

  try {
    shCfg.getRange('D26').setBackground(cp).setFontColor(getContrastColor(cp)).setValue('Aperçu');
    shCfg.getRange('D27').setBackground(cs).setFontColor(getContrastColor(cs)).setValue('Aperçu');
    shCfg.getRange('D28').setBackground(c1).setFontColor(getContrastColor(c1)).setValue('Aperçu');
    shCfg.getRange('D29').setBackground(c2).setFontColor(getContrastColor(c2)).setValue('Aperçu');
    shCfg.getRange('D30').setBackground(c3).setFontColor(getContrastColor(c3)).setValue('Aperçu');
  } catch (e) {}

  try {
    shCfg.setTabColor(cp);
    const shEff = ss.getSheetByName('Effectif');
    if (shEff) shEff.setTabColor(cp);
    const shVotes = ss.getSheetByName('Votes_Semaine');
    if (shVotes) shVotes.setTabColor(cs);
    const shComp = ss.getSheetByName('Compositions');
    if (shComp) shComp.setTabColor(c1);
  } catch (e) {}

  if ([1, 2, 3].includes(nbEq)) {
    initialiserOngletsWebApp(nbEq);
  }

  if (nouvellesCouleurs.logoUrl) {
    shCfg.getRange('C23').setValue(nouvellesCouleurs.logoUrl);
  }
  if (nouvellesCouleurs.nomClub) {
    shCfg.getRange('C22').setValue(nouvellesCouleurs.nomClub);
  }
  if (nouvellesCouleurs.urlFfhbClub) {
    shCfg.getRange('B32:D32').setValues([['Page FFHB du Club (URL)', nouvellesCouleurs.urlFfhbClub, 'Lien vers monclub.ffhandball.fr']]);
    try {
      PropertiesService.getScriptProperties().setProperty('URL_PAGE_FFHB_CLUB', nouvellesCouleurs.urlFfhbClub);
    } catch (eProp) {}
  }

  const cfgActuelle = getClubConfig(ss);

  return {
    ok: true,
    couleurs: {
      primaire: cp,
      secondaire: cs,
      equipe1: c1,
      equipe2: c2,
      equipe3: c3
    },
    nbEquipes: [1, 2, 3].includes(nbEq) ? nbEq : undefined,
    logoUrl: cfgActuelle.logoUrl,
    nomClub: cfgActuelle.nomClub,
    urlFfhbClub: cfgActuelle.urlFfhbClub
  };
}

/**
 * Enregistre un nouveau logo/blason pour le club (URL ou fichier image en base64)
 */
function enregistrerLogoClub(telCoach, pinCoach, nouveauLogoDataOuUrl) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  const shCfg = ss.getSheetByName('Configuration');
  if (!shCfg) throw new Error('Onglet Configuration introuvable.');

  let urlStockee = String(nouveauLogoDataOuUrl || '').trim();
  if (urlStockee.indexOf('data:image/') === 0) {
    try {
      const parts = urlStockee.split(',');
      const mime = parts[0].match(/:(.*?);/)[1];
      const decoded = Utilities.base64Decode(parts[1]);
      const nomFichier = 'logo_club_' + new Date().getTime();
      const blob = Utilities.newBlob(decoded, mime, nomFichier);
      const fichier = DriveApp.createFile(blob);
      fichier.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urlStockee = fichier.getUrl();
    } catch (e) {
      throw new Error('Erreur lors du téléversement du logo sur Drive : ' + e.message);
    }
  }

  shCfg.getRange('C23').setValue(urlStockee);
  const cfg = getClubConfig(ss);
  return { ok: true, logoUrl: cfg.logoUrl };
}

/**
 * Réinitialise le blason du club vers le logo vectoriel dynamique officiel
 */
function reinitialiserLogoClub(telCoach, pinCoach) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  const shCfg = ss.getSheetByName('Configuration');
  if (!shCfg) throw new Error('Onglet Configuration introuvable.');

  shCfg.getRange('C23').setValue('');
  const cfg = getClubConfig(ss);
  return { ok: true, logoUrl: cfg.logoUrl };
}

/**
 * Normalise l'URL d'une page club FFHB
 */
function normaliserUrlClubFFHB(urlBrute) {
  let str = String(urlBrute || '').trim();
  if (!str || str.toLowerCase() === 'acbb' || str.toLowerCase() === 'boulogne' || str.toLowerCase() === 'athletic') {
    return 'https://monclub.ffhandball.fr/clubs/athletic-club-boulogne-billancourt/';
  }
  if (!str.includes('/') && !str.includes('.')) {
    return 'https://monclub.ffhandball.fr/clubs/' + str + '/';
  }
  if (!/^https?:\/\//i.test(str)) {
    str = 'https://' + str;
  }
  if (!str.endsWith('/')) {
    str += '/';
  }
  str = str.replace(/https?:\/\/(?:www\.)?ffhandball\.fr\/clubs\//i, 'https://monclub.ffhandball.fr/clubs/');
  return str;
}

/**
 * Récupère le nom du club, son logo officiel et ses informations depuis sa page monclub.ffhandball.fr
 */
function importerInfosClubFFHB(telCoach, pinCoach, urlClub) {
  let urlCible = urlClub;
  if (!urlCible && typeof telCoach === 'string' && (telCoach.includes('http') || telCoach.includes('club'))) {
    urlCible = telCoach;
  }

  if (pinCoach && typeof pinCoach === 'string' && /^\d{4,8}$/.test(pinCoach)) {
    const ss = getSpreadsheet();
    if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach).trim())) {
      throw new Error('Action réservée aux coachs autorisés.');
    }
  }

  const urlPropre = normaliserUrlClubFFHB(urlCible);
  let html = '';
  try {
    const res = UrlFetchApp.fetch(urlPropre, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('Impossible d\'accéder à la page FFHB (Code HTTP ' + res.getResponseCode() + ')');
    }
    html = res.getContentText('UTF-8');
  } catch (e) {
    throw new Error('Erreur de connexion à FFHB : ' + e.message);
  }

  let nomClub = '';
  let logoFile = '';
  let salleDefaut = '';

  const matchHero = html.match(/<smartfire-component[^>]+name=['"]single-club---home-hero-club['"][^>]+attributes=['"]([^'"]+)['"]/i);
  if (matchHero) {
    try {
      let rawJson = matchHero[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'");
      const data = JSON.parse(rawJson);
      const post = data.post || {};
      nomClub = String(post.post_title || '').trim();
      const acf = post.acf || {};
      logoFile = String(acf.logo_club || '').trim();
      if (Array.isArray(acf.gyms_club) && acf.gyms_club.length > 0) {
        salleDefaut = String(acf.gyms_club[0].name_gym || '').trim();
      }
    } catch (e) {
      Logger.log('Erreur parsing JSON smartfire: ' + e.message);
    }
  }

  // Fallbacks si le format a varié
  if (!logoFile) {
    const matchLogoRaw = html.match(/(?:&quot;|")logo_club(?:&quot;|")\s*:\s*(?:&quot;|")([^"&]+)(?:&quot;|")/i);
    if (matchLogoRaw) logoFile = matchLogoRaw[1].trim();
  }
  if (!nomClub) {
    const matchTitle = html.match(/<title>([^<]+?)(?:\s*-\s*Mon Club|\s*-\s*FFHandball|\s*-\s*Fédération)?<\/title>/i);
    if (matchTitle) nomClub = matchTitle[1].trim();
  }

  if (!logoFile) {
    throw new Error('Logo introuvable sur cette page FFHB. Vérifiez l\'URL du club.');
  }

  const logoClean = logoFile.replace(/\.[^.]+$/, '');
  const logoUrl = 'https://media-logos-clubs.ffhandball.fr/256/' + logoClean + '.webp';

  // Récupération de l'image en Base64 pour permettre à l'élément canvas côté client d'analyser les pixels sans restriction CORS
  let logoDataUri = '';
  try {
    const imgRes = UrlFetchApp.fetch(logoUrl, { muteHttpExceptions: true });
    if (imgRes.getResponseCode() === 200) {
      const blob = imgRes.getBlob();
      logoDataUri = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
    }
  } catch (errImg) {
    Logger.log('Erreur fetch image base64: ' + errImg.message);
  }

  return {
    ok: true,
    urlClub: urlPropre,
    nomClub: nomClub || 'Club FFHB',
    logoUrl: logoUrl,
    logoDataUri: logoDataUri,
    salleDefaut: salleDefaut
  };
}

/**
 * Réorganise et embellit l'intégralité du classeur Google Sheets :
 * 1. Restructure et esthétise la feuille 'Configuration' (Bannière moderne, badges, alignements, largeur colonnes, corrections décalages)
 * 2. Réorganise l'ordre des onglets dans un flux logique opérationnel
 * 3. Harmonise les couleurs d'onglets (Tab Colors) selon la charte du club
 * 4. Met en forme les onglets clés (Effectif, Compositions, Entrainements, Votes, Matchs FFHB, etc.)
 */
function embellirEtReorganiserClasseur(ss) {
  if (!ss) ss = getSpreadsheet();
  if (!ss) return { ok: false, error: 'Classeur introuvable' };

  const cfg = getClubConfig(ss);

  // ========================================================
  // 1. RÉORGANISATION LOGIQUE DE L'ORDRE DES ONGLETS
  // ========================================================
  const ordreSouhaite = [
    'Configuration',
    'Effectif',
    'Compositions',
    'Entrainements',
    'Votes_Semaine',
    'Trophées & Bêtisier',
    'Caisse Noire',
    'Covoiturage',
    'Absences',
    'Vacances',
    'Brouillon_Compo',
    'Matchs FFHB Détectés',
    'Aperçu Sondage WhatsApp'
  ];

  try {
    let pos = 1;
    ordreSouhaite.forEach(function(nom) {
      const sh = ss.getSheetByName(nom);
      if (sh) {
        ss.setActiveSheet(sh);
        ss.moveActiveSheet(pos);
        pos++;
      }
    });
  } catch (errOrdre) {}

  // ========================================================
  // 2. EMBELLISSEMENT ET RESTRUCTURATION DE 'CONFIGURATION'
  // ========================================================
  const shCfg = ss.getSheetByName('Configuration');
  if (shCfg) {
    try {
      // 2.a Correction des décalages éventuels
      // Fix coach numbers : si C25 est vide et que D25 contient des numéros
      const valC25 = String(shCfg.getRange('C25').getValue() || '').trim();
      const valD25 = String(shCfg.getRange('D25').getValue() || '').trim();
      if (!valC25 && valD25 && /\d{9,}/.test(valD25.replace(/[^0-9]/g, ''))) {
        shCfg.getRange('C25').setValue(valD25);
        shCfg.getRange('D25').setValue('Numéros des coachs autorisés (séparés par virgules)');
      }

      // Fix en-tête D17
      const valD17 = String(shCfg.getRange('D17').getValue() || '').trim().toLowerCase();
      if (valD17 === 'version prod' || !valD17) {
        shCfg.getRange('D17').setValue('Aperçu / Description');
      }

      // 2.b Dimensions des colonnes pour éviter toute troncature
      shCfg.setColumnWidth(1, 25);   // Marge gauche élégante
      shCfg.setColumnWidth(2, 260);  // Paramètre / Intitulé
      shCfg.setColumnWidth(3, 340);  // Valeur
      shCfg.setColumnWidth(4, 300);  // Aperçu / Description
      shCfg.setColumnWidth(5, 110);  // Délai / Ordre
      shCfg.setColumnWidth(6, 320);  // URL Poule
      shCfg.setColumnWidth(7, 260);  // URL Coupe

      // Nettoyage fond colonne A
      shCfg.getRange('A1:A45').setBackground('#f8fafc');

      // 2.c Bannière Header (Lignes 1 & 2)
      shCfg.getRange('B1:G1').merge()
        .setValue('⚡ HANDBALL BOT — CONFIGURATION & AUTOMATISATION DU CLUB')
        .setBackground(cfg.couleurPrimaire || '#0f172a')
        .setFontColor(getContrastColor(cfg.couleurPrimaire || '#0f172a'))
        .setFontWeight('bold')
        .setFontSize(13)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      shCfg.setRowHeight(1, 42);

      const nomClubAffiche = cfg.nomClub || 'Handball Club';
      shCfg.getRange('B2:G2').merge()
        .setValue('🏉 ' + nomClubAffiche + ' • Synchronisation FFHB, Sondage WhatsApp & WebApp Coach • Modèle v' + APP_VERSION)
        .setBackground('#1e293b')
        .setFontColor('#cbd5e1')
        .setFontWeight('normal')
        .setFontStyle('italic')
        .setFontSize(9.5)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      shCfg.setRowHeight(2, 24);

      // 2.d Bloc 1 : Équipes & Compétitions (Lignes 3 à 6)
      shCfg.getRange('B3:G3').setValues([[
        'Code Équipe', 'Nom recherché (Mot-clé FFHB)', 'Libellé dans le sondage', 'Délai RDV (heures)', 'URL de la poule FFHB', 'URL Coupe de France (optionnel)'
      ]])
      .setBackground('#0f172a')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setFontSize(10)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
      shCfg.setRowHeight(3, 28);

      for (let r = 4; r <= 6; r++) {
        shCfg.setRowHeight(r, 26);
        const bg = (r % 2 === 0) ? '#ffffff' : '#f8fafc';
        shCfg.getRange(r, 2, 1, 6).setBackground(bg).setVerticalAlignment('middle');
        shCfg.getRange(r, 2).setFontWeight('bold').setHorizontalAlignment('center'); // Code
        shCfg.getRange(r, 4).setHorizontalAlignment('center'); // Libellé
        shCfg.getRange(r, 5).setHorizontalAlignment('center'); // Délai
      }
      shCfg.getRange('B3:G6').setBorder(true, true, true, true, true, true, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);

      // 2.e Bloc 2 : Créneaux d'Entraînement (Lignes 7 à 14)
      shCfg.getRange('B7:G7').merge()
        .setValue('🏋️ CRÉNEAUX D\'ENTRAÎNEMENT HEBDOMADAIRES (Options incluses dans le sondage WhatsApp du lundi matin)')
        .setBackground('#334155')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(10)
        .setHorizontalAlignment('left')
        .setVerticalAlignment('middle');
      shCfg.setRowHeight(7, 28);

      shCfg.getRange('B8:D8').setValues([['Ordre', "Intitulé de l'option dans le sondage", 'Actif (OUI/NON)']])
        .setBackground('#1e293b')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(9)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      
      const rHelpTrain = shCfg.getRange('E8:G8');
      if (!rHelpTrain.isPartOfMerge()) rHelpTrain.merge();
      rHelpTrain.setValue('💡 Conseil : Vous pouvez aussi activer/désactiver les créneaux dans la WebApp Coach')
        .setBackground('#1e293b')
        .setFontColor('#94a3b8')
        .setFontSize(9)
        .setFontStyle('italic')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      shCfg.setRowHeight(8, 24);

      const ruleOuiNon = SpreadsheetApp.newDataValidation()
        .requireValueInList(['OUI', 'NON'], true)
        .setAllowInvalid(false)
        .build();

      for (let r = 9; r <= 14; r++) {
        shCfg.setRowHeight(r, 25);
        const bg = (r % 2 === 1) ? '#ffffff' : '#f8fafc';
        shCfg.getRange(r, 2, 1, 6).setBackground(bg).setVerticalAlignment('middle');
        shCfg.getRange(r, 2).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#f1f5f9');
        
        const cellActif = shCfg.getRange(r, 4);
        cellActif.setDataValidation(ruleOuiNon).setHorizontalAlignment('center').setFontWeight('bold');
        const valActif = String(cellActif.getValue() || '').trim().toUpperCase();
        if (valActif === 'OUI') {
          cellActif.setBackground('#dcfce7').setFontColor('#15803d');
        } else if (valActif === 'NON') {
          cellActif.setBackground('#f1f5f9').setFontColor('#64748b');
        }

        const infoRange = shCfg.getRange(r, 5, 1, 3);
        if (!infoRange.isPartOfMerge()) infoRange.merge();
        let descSeance = 'Option du sondage';
        if (r === 9) descSeance = 'Séance d\'entraînement principale 1';
        else if (r === 10) descSeance = 'Déclaration d\'absence associée séance 1';
        else if (r === 11) descSeance = 'Séance d\'entraînement principale 2';
        else if (r === 12) descSeance = 'Déclaration d\'absence associée séance 2';
        else if (r === 13) descSeance = 'Séance d\'entraînement optionnelle 3';
        else if (r === 14) descSeance = 'Déclaration d\'absence associée séance 3';
        infoRange.setValue(descSeance).setFontColor('#64748b').setFontSize(9).setFontStyle('italic').setVerticalAlignment('middle');
      }
      shCfg.getRange('B7:G14').setBorder(true, true, true, true, true, true, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);

      // 2.f Bloc 3 : Paramètres Généraux, Charte & Administration (Lignes 16 à 38)
      shCfg.getRange('B16:G16').merge()
        .setValue('⚙️ PARAMÈTRES D\'AUTOMATISATION, CHARTE GRAPHIQUE DU CLUB & ADMINISTRATEURS')
        .setBackground('#0f172a')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(10)
        .setHorizontalAlignment('left')
        .setVerticalAlignment('middle');
      shCfg.setRowHeight(16, 28);

      shCfg.getRange('B17:D17').setValues([['Paramètre', 'Valeur', 'Aperçu / Description']])
        .setBackground('#1e293b')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(9)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');

      const rHelpParam = shCfg.getRange('E17:G17');
      if (!rHelpParam.isPartOfMerge()) rHelpParam.merge();
      rHelpParam.setValue('Guide d\'aide & Synchronisation temps réel')
        .setBackground('#1e293b')
        .setFontColor('#94a3b8')
        .setFontSize(9)
        .setFontStyle('italic')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      shCfg.setRowHeight(17, 24);

      const ruleNbEq = SpreadsheetApp.newDataValidation()
        .requireValueInList(['1', '2', '3'], true)
        .setAllowInvalid(false)
        .build();

      const ruleCaisseStatut = SpreadsheetApp.newDataValidation()
        .requireValueInList(['OUVERTE', 'FERMÉE', 'DÉSACTIVÉE'], true)
        .setAllowInvalid(false)
        .build();

      const guidesMap = {
        18: 'Identifiant du groupe WhatsApp du club',
        19: 'Dépôt GitHub hébergeant le bot Baileys',
        20: 'Token d\'accès GitHub pour déclencher l\'envoi',
        21: 'Généré automatiquement par le déploiement WebApp',
        22: 'Nom officiel affiché sur l\'application web',
        23: 'Blason officiel du club (PNG, SVG ou WebP)',
        24: 'Nom de votre gymnase pour les matchs à domicile',
        25: 'Numéros autorisés à administrer et convoquer (séparés par virgules)',
        26: 'Couleur primaire du club (boutons, en-têtes)',
        27: 'Couleur d\'accentuation secondaire (badges, reflets)',
        28: 'Couleur du maillot Équipe 1',
        29: 'Couleur du maillot Équipe 2',
        30: 'Couleur du maillot Équipe 3',
        31: 'Nombre d\'équipes séniors gérées dans ce groupe',
        32: 'Lien FFHB officiel (logo et couleurs auto)',
        33: 'Trésoriers autorisés (synchronisé avec l\'onglet Effectif)',
        34: 'Chouchou(x) du coach (synchronisé avec l\'onglet Effectif)',
        35: '🟢 OUVERTE / 🔒 FERMÉE / ⚪ DÉSACTIVÉE (équipes jeunes)',
        36: 'Calendrier des trêves (géré dans l\'onglet Vacances)',
        37: 'Joueur MVP du match (synchronisé avec Trophées)',
        38: 'Casserole du match (synchronisée avec Trophées)'
      };

      for (let r = 18; r <= 38; r++) {
        shCfg.setRowHeight(r, 25);
        const bg = (r % 2 === 0) ? '#ffffff' : '#f8fafc';
        shCfg.getRange(r, 2, 1, 6).setBackground(bg).setVerticalAlignment('middle');
        shCfg.getRange(r, 2).setFontWeight('bold');

        const gCell = shCfg.getRange(r, 5, 1, 3);
        if (!gCell.isPartOfMerge()) gCell.merge();
        gCell.setValue(guidesMap[r] || 'Paramètre du club')
          .setFontColor('#64748b')
          .setFontSize(8.5)
          .setFontStyle('italic')
          .setVerticalAlignment('middle');

        if (r === 31) {
          shCfg.getRange('C31').setDataValidation(ruleNbEq).setHorizontalAlignment('center').setFontWeight('bold');
        } else if (r === 35) {
          const c35 = shCfg.getRange('C35');
          c35.setDataValidation(ruleCaisseStatut).setHorizontalAlignment('center').setFontWeight('bold');
          const st = String(c35.getValue() || '').toUpperCase();
          if (st.includes('OUV')) c35.setBackground('#dcfce7').setFontColor('#15803d');
          else if (st.includes('FERM')) c35.setBackground('#fee2e2').setFontColor('#b91c1c');
          else if (st.includes('DES')) c35.setBackground('#f1f5f9').setFontColor('#64748b');
        }
      }

      // Boîtes de prévisualisation des couleurs D26:D30
      shCfg.getRange('D26').setBackground(cfg.couleurPrimaire).setFontColor(getContrastColor(cfg.couleurPrimaire)).setValue('Aperçu ' + cfg.couleurPrimaire).setFontWeight('bold').setHorizontalAlignment('center');
      shCfg.getRange('D27').setBackground(cfg.couleurSecondaire).setFontColor(getContrastColor(cfg.couleurSecondaire)).setValue('Aperçu ' + cfg.couleurSecondaire).setFontWeight('bold').setHorizontalAlignment('center');
      shCfg.getRange('D28').setBackground(cfg.couleurEquipe1).setFontColor(getContrastColor(cfg.couleurEquipe1)).setValue('Aperçu ' + cfg.couleurEquipe1).setFontWeight('bold').setHorizontalAlignment('center');
      shCfg.getRange('D29').setBackground(cfg.couleurEquipe2).setFontColor(getContrastColor(cfg.couleurEquipe2)).setValue('Aperçu ' + cfg.couleurEquipe2).setFontWeight('bold').setHorizontalAlignment('center');
      shCfg.getRange('D30').setBackground(cfg.couleurEquipe3).setFontColor(getContrastColor(cfg.couleurEquipe3)).setValue('Aperçu ' + cfg.couleurEquipe3).setFontWeight('bold').setHorizontalAlignment('center');

      shCfg.getRange('B16:G38').setBorder(true, true, true, true, true, true, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);
      shCfg.setHiddenGridlines(false);
    } catch (eCfg) {
      Logger.log('Erreur formatage shCfg: ' + eCfg.message);
    }
  }

  // ========================================================
  // 3. EMBELLISSEMENT DE LA FEUILLE 'EFFECTIF'
  // ========================================================
  const shEff = ss.getSheetByName('Effectif');
  if (shEff) {
    try {
      shEff.getRange('A1:J1').setValues([[
        'Nom et Prénom', 'Téléphone (format 336...)', 'Poste', 'Équipe habituelle', 'Photo (URL ou lien Drive)', 'Code PIN (Auto)', 'Notes du Coach (Privé)', 'Trésorier', 'Chouchou', 'ID Spakta'
      ]])
      .setBackground('#0f172a')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setFontSize(10)
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('center');
      shEff.setRowHeight(1, 32);

      shEff.setColumnWidth(1, 200); // Nom
      shEff.setColumnWidth(2, 160); // Téléphone
      shEff.setColumnWidth(3, 140); // Poste
      shEff.setColumnWidth(4, 130); // Équipe
      shEff.setColumnWidth(5, 180); // Photo
      shEff.setColumnWidth(6, 110); // PIN
      shEff.setColumnWidth(7, 260); // Notes
      shEff.setColumnWidth(8, 100); // Trésorier
      shEff.setColumnWidth(9, 100); // Chouchou
      shEff.setColumnWidth(10, 240); // ID Spakta

      const lastRowEff = shEff.getLastRow();
      if (lastRowEff >= 2) {
        const nbLignes = lastRowEff - 1;
        shEff.getRange(2, 1, nbLignes, 10).setVerticalAlignment('middle');

        // Validation Postes
        const rulePostes = SpreadsheetApp.newDataValidation()
          .requireValueInList(['Gardien', 'Ailier Gauche', 'Arrière Gauche', 'Demi-Centre', 'Pivot', 'Arrière Droit', 'Ailier Droit'], true)
          .setAllowInvalid(false)
          .build();
        shEff.getRange(2, 3, nbLignes, 1).setDataValidation(rulePostes);

        // Validation Équipes
        const ruleEquipes = SpreadsheetApp.newDataValidation()
          .requireValueInList(['Équipe 1', 'Équipe 2', 'Équipe 3'], true)
          .setAllowInvalid(false)
          .build();
        shEff.getRange(2, 4, nbLignes, 1).setDataValidation(ruleEquipes);

        // Validation Trésorier & Chouchou
        const ruleOuiNon = SpreadsheetApp.newDataValidation()
          .requireValueInList(['OUI', 'NON'], true)
          .setAllowInvalid(false)
          .build();
        shEff.getRange(2, 8, nbLignes, 2).setDataValidation(ruleOuiNon).setHorizontalAlignment('center');

        for (let r = 2; r <= lastRowEff; r++) {
          shEff.setRowHeight(r, 26);
          const bg = (r % 2 === 0) ? '#ffffff' : '#f8fafc';
          shEff.getRange(r, 1, 1, 10).setBackground(bg);
          shEff.getRange(r, 1).setFontWeight('bold');

          // Badges Trésorier et Chouchou
          const cTres = shEff.getRange(r, 8);
          if (String(cTres.getValue() || '').toUpperCase() === 'OUI') {
            cTres.setBackground('#fef9c3').setFontColor('#854d0e').setFontWeight('bold');
          }
          const cChou = shEff.getRange(r, 9);
          if (String(cChou.getValue() || '').toUpperCase() === 'OUI') {
            cChou.setBackground('#ffe4e6').setFontColor('#be123c').setFontWeight('bold');
          }
          const cSpakta = shEff.getRange(r, 10);
          cSpakta.setFontFamily('Roboto Mono, Consolas, monospace').setFontSize(9).setHorizontalAlignment('center');
        }
        shEff.getRange(1, 1, lastRowEff, 10).setBorder(true, true, true, true, true, true, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);

        // Auto-préremplissage des IDs Spakta si la colonne est vide
        try { preRemplirIdsSpaktaEffectif(ss, false); } catch (ePre) {}
      }
      shEff.setHiddenGridlines(false);
    } catch (eEff) {}
  }

  // ========================================================
  // 4. EMBELLISSEMENT DES FEUILLES COMPOSITIONS & ENTRAINEMENTS
  // ========================================================
  const shComp = ss.getSheetByName('Compositions');
  if (shComp) {
    try {
      const lastC = Math.max(shComp.getLastColumn(), 4);
      shComp.getRange(1, 1, 1, lastC)
        .setBackground(cfg.couleurEquipe1 || '#0f172a')
        .setFontColor(getContrastColor(cfg.couleurEquipe1 || '#0f172a'))
        .setFontWeight('bold')
        .setFontSize(10)
        .setVerticalAlignment('middle')
        .setHorizontalAlignment('center');
      shComp.setRowHeight(1, 30);
      shComp.setColumnWidth(1, 140);
      for (let c = 2; c <= lastC; c++) shComp.setColumnWidth(c, 240);
      shComp.setHiddenGridlines(false);
    } catch (eComp) {}
  }

  const shEnt = ss.getSheetByName('Entrainements');
  if (shEnt) {
    try {
      const lastC = Math.max(shEnt.getLastColumn(), 5);
      shEnt.getRange(1, 1, 1, lastC)
        .setBackground('#1e293b')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(10)
        .setVerticalAlignment('middle')
        .setHorizontalAlignment('center');
      shEnt.setRowHeight(1, 30);
      shEnt.setColumnWidth(1, 140);
      shEnt.setColumnWidth(2, 160);
      shEnt.setColumnWidth(3, 260);
      shEnt.setColumnWidth(4, 260);
      shEnt.setColumnWidth(5, 200);
      shEnt.setHiddenGridlines(false);
    } catch (eEnt) {}
  }

  const shVotes = ss.getSheetByName('Votes_Semaine');
  if (shVotes) {
    try {
      const lastC = Math.max(shVotes.getLastColumn(), 4);
      shVotes.getRange(1, 1, 1, lastC)
        .setBackground(cfg.couleurSecondaire || '#334155')
        .setFontColor(getContrastColor(cfg.couleurSecondaire || '#334155'))
        .setFontWeight('bold')
        .setFontSize(10)
        .setVerticalAlignment('middle')
        .setHorizontalAlignment('center');
      shVotes.setRowHeight(1, 30);
      shVotes.setColumnWidth(1, 180);
      shVotes.setColumnWidth(2, 130);
      shVotes.setColumnWidth(3, 140);
      for (let c = 4; c <= lastC; c++) shVotes.setColumnWidth(c, 130);
      shVotes.setHiddenGridlines(false);
    } catch (eVotes) {}
  }

  // ========================================================
  // 5. APPLICATION DES COULEURS DES ONGLETS (TAB COLORS)
  // ========================================================
  try {
    if (shCfg) shCfg.setTabColor(cfg.couleurPrimaire);
    if (shEff) shEff.setTabColor(cfg.couleurPrimaire);
    if (shComp) shComp.setTabColor(cfg.couleurEquipe1);
    if (shEnt) shEnt.setTabColor(cfg.couleurEquipe2 || cfg.couleurPrimaire);
    if (shVotes) shVotes.setTabColor(cfg.couleurSecondaire);

    const shTrop = ss.getSheetByName('Trophées & Bêtisier');
    if (shTrop) shTrop.setTabColor('#f59e0b');

    const shCaisse = ss.getSheetByName('Caisse Noire');
    if (shCaisse) shCaisse.setTabColor('#10b981');

    const shCovoit = ss.getSheetByName('Covoiturage');
    if (shCovoit) shCovoit.setTabColor('#6366f1');

    const shAbs = ss.getSheetByName('Absences');
    if (shAbs) shAbs.setTabColor('#38bdf8');

    const shVac = ss.getSheetByName('Vacances');
    if (shVac) shVac.setTabColor('#0ea5e9');

    const shBrouillon = ss.getSheetByName('Brouillon_Compo');
    if (shBrouillon) shBrouillon.setTabColor('#64748b');

    const shMatchs = ss.getSheetByName('Matchs FFHB Détectés');
    if (shMatchs) shMatchs.setTabColor('#1e293b');

    const shApercu = ss.getSheetByName('Aperçu Sondage WhatsApp');
    if (shApercu) shApercu.setTabColor('#22c55e');
  } catch (eTabs) {}

  // Replacer l'utilisateur sur la feuille Configuration
  if (shCfg) {
    try { ss.setActiveSheet(shCfg); } catch (eAct) {}
  }

  return { ok: true };
}

/**
 * Met à jour les aperçus et styles de couleurs dans le classeur Google Sheets
 */
function actualiserCouleursClasseur() {
  const ss = getSpreadsheet();
  const res = embellirEtReorganiserClasseur(ss);
  const cfg = getClubConfig(ss);
  ss.toast('Classeur réorganisé et embelli avec succès (' + cfg.couleurPrimaire + ', ' + cfg.couleurSecondaire + ') !', '✨ Handball Bot', 5);
}

/**
 * Déclencheur menu pour embellir et réorganiser l'intégralité du classeur
 */
function menuEmbellirClasseurComplet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const res = embellirEtReorganiserClasseur(ss);
    if (res && res.ok) {
      ss.toast('Classeur réorganisé et embelli avec succès !', '✨ Handball Bot', 5);
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur lors de l\'embellissement du classeur : ' + e.message);
  }
}

function convertirUrlPhoto(urlBrute) {
  let url = String(urlBrute || '').trim();
  if (!url) return '';
  if (url.indexOf('data:image/') === 0) return url;
  const mDriveFile = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (mDriveFile) return 'https://drive.google.com/thumbnail?id=' + mDriveFile[1] + '&sz=w800';
  const mDriveId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (url.indexOf('drive.google.com') !== -1 && mDriveId) return 'https://drive.google.com/thumbnail?id=' + mDriveId[1] + '&sz=w800';
  if (url.indexOf('dropbox.com') !== -1) {
    return url.replace(/[?&]dl=[01]/, '').concat(url.indexOf('?') === -1 ? '?raw=1' : '&raw=1');
  }
  return url;
}

function normaliserNumero(t) {
  let chiffres = String(t || '').replace(/[^0-9]/g, '');
  if (chiffres.length === 10 && chiffres.charAt(0) === '0') chiffres = '33' + chiffres.substring(1);
  return chiffres;
}

/**
 * Gestion du chiffrement des numéros de téléphone pour la protection des données (RGPD / Mineurs)
 */
function getCleSecreteClub() {
  const props = PropertiesService.getScriptProperties();
  let cle = props.getProperty('HB_ENCRYPTION_KEY');
  if (!cle) {
    cle = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('HB_ENCRYPTION_KEY', cle);
  }
  return cle;
}

function chiffrerNumero(texteClair) {
  if (!texteClair) return '';
  const str = String(texteClair).trim();
  if (!str) return '';
  if (str.indexOf('enc:') === 0) return str; // Déjà chiffré

  try {
    const cle = getCleSecreteClub();
    const iv = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    const textBytes = Utilities.newBlob(str).getBytes();
    const stream = Utilities.computeHmacSha256Signature(iv, cle);

    const cipherBytes = [];
    for (let i = 0; i < textBytes.length; i++) {
      cipherBytes.push(textBytes[i] ^ stream[i % stream.length]);
    }
    const cipherHex = cipherBytes.map(function(b) {
      return ('0' + (b & 0xFF).toString(16)).slice(-2);
    }).join('');

    const macBytes = Utilities.computeHmacSha256Signature(iv + ':' + cipherHex, cle);
    const macHex = macBytes.slice(0, 8).map(function(b) {
      return ('0' + (b & 0xFF).toString(16)).slice(-2);
    }).join('');

    return 'enc:' + iv + ':' + cipherHex + ':' + macHex;
  } catch (e) {
    return str;
  }
}

function dechiffrerNumero(texteChiffre) {
  if (!texteChiffre) return '';
  const str = String(texteChiffre).trim();
  if (str.indexOf('enc:') !== 0) return str; // Rétrocompatibilité : retourne le numéro en clair s'il n'est pas chiffré

  try {
    const parts = str.split(':');
    if (parts.length !== 4) return str;
    const iv = parts[1];
    const cipherHex = parts[2];
    const macHex = parts[3];

    const cle = getCleSecreteClub();
    const macBytes = Utilities.computeHmacSha256Signature(iv + ':' + cipherHex, cle);
    const verifMac = macBytes.slice(0, 8).map(function(b) {
      return ('0' + (b & 0xFF).toString(16)).slice(-2);
    }).join('');

    if (verifMac !== macHex) return '';

    const cipherBytes = [];
    for (let i = 0; i < cipherHex.length; i += 2) {
      cipherBytes.push(parseInt(cipherHex.substr(i, 2), 16));
    }
    const stream = Utilities.computeHmacSha256Signature(iv, cle);
    const plainBytes = [];
    for (let i = 0; i < cipherBytes.length; i++) {
      plainBytes.push(cipherBytes[i] ^ stream[i % stream.length]);
    }
    return Utilities.newBlob(plainBytes).getDataAsString();
  } catch (e) {
    return str;
  }
}

/**
 * Chiffre tous les numéros en clair dans l'onglet Effectif
 */
function chiffrerTousLesNumerosEffectif() {
  const ss = getSpreadsheet();
  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) throw new Error('Onglet Effectif introuvable.');

  const lastRow = shEff.getLastRow();
  if (lastRow <= 1) return { total: 0, chiffrés: 0 };

  const range = shEff.getRange(2, 2, lastRow - 1, 1);
  const values = range.getValues();
  let count = 0;

  for (let i = 0; i < values.length; i++) {
    const rawVal = String(values[i][0] || '').trim();
    if (rawVal && rawVal.indexOf('enc:') !== 0) {
      const norm = normaliserNumero(rawVal);
      if (norm) {
        values[i][0] = chiffrerNumero(norm);
        count++;
      }
    }
  }

  if (count > 0) {
    range.setValues(values);
  }
  return { total: values.length, chiffrés: count };
}

/**
 * Déchiffre tous les numéros de l'onglet Effectif
 */
function dechiffrerTousLesNumerosEffectif() {
  const ss = getSpreadsheet();
  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) throw new Error('Onglet Effectif introuvable.');

  const lastRow = shEff.getLastRow();
  if (lastRow <= 1) return { total: 0, déchiffrés: 0 };

  const range = shEff.getRange(2, 2, lastRow - 1, 1);
  const values = range.getValues();
  let count = 0;

  for (let i = 0; i < values.length; i++) {
    const rawVal = String(values[i][0] || '').trim();
    if (rawVal && rawVal.indexOf('enc:') === 0) {
      const dec = dechiffrerNumero(rawVal);
      if (dec) {
        values[i][0] = dec;
        count++;
      }
    }
  }

  if (count > 0) {
    range.setValues(values);
  }
  return { total: values.length, déchiffrés: count };
}

function menuChiffrerNumerosEffectif() {
  const ui = SpreadsheetApp.getUi();
  const rep = ui.alert(
    '🔐 Chiffrement de l\'Effectif (Protection RGPD / Mineurs)',
    'Voulez-vous chiffrer tous les numéros de téléphone dans l\'onglet Effectif ?\n\n' +
    'Les numéros deviendront illisibles dans Google Sheets (format enc:...) et ne pourront être gérés que depuis la WebApp.\n' +
    'La synchronisation WhatsApp continuera de fonctionner parfaitement.',
    ui.ButtonSet.YES_NO
  );
  if (rep === ui.Button.YES) {
    const res = chiffrerTousLesNumerosEffectif();
    ui.alert(
      '✅ Chiffrement terminé',
      res.chiffrés + ' numéro(s) de téléphone ont été chiffrés avec succès.\nVos données sont désormais protégées contre toute fuite.',
      ui.ButtonSet.OK
    );
  }
}

function menuDechiffrerNumerosEffectif() {
  const ui = SpreadsheetApp.getUi();
  const rep = ui.alert(
    '🔓 Déchiffrement de l\'Effectif',
    'Voulez-vous rétablir les numéros de téléphone en clair dans l\'onglet Effectif ?',
    ui.ButtonSet.YES_NO
  );
  if (rep === ui.Button.YES) {
    const res = dechiffrerTousLesNumerosEffectif();
    ui.alert(
      'Déchiffrement terminé',
      res.déchiffrés + ' numéro(s) rétabli(s) en clair.',
      ui.ButtonSet.OK
    );
  }
}

function verifierDroitsCoachOuDev(ss, tel, pin) {
  if (!tel) return false;
  const cfg = getClubConfig(ss);
  if (cfg.adminPhones && cfg.adminPhones.indexOf(tel) !== -1) return true;

  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) return false;
  const rows = shEff.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (normaliserNumero(dechiffrerNumero(r[1])) === tel) {
      const pinEnregistre = String(r[5] || '').trim();
      if (pinEnregistre && pinEnregistre !== pin) return false;
      const poste = String(r[2] || '').trim();
      if (/coach|entraineur|entraîneur|responsable/i.test(poste)) return true;
    }
  }
  return false;
}

function verifierDroitsCoachOuTresorier(ss, tel, pin) {
  if (!tel) return false;
  if (verifierDroitsCoachOuDev(ss, tel, pin)) return true;
  const cfg = getClubConfig(ss);
  if (cfg.tresorierPhones && cfg.tresorierPhones.indexOf(tel) !== -1) return true;
  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) return false;
  const rows = shEff.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (normaliserNumero(dechiffrerNumero(r[1])) === tel) {
      const pinEnregistre = String(r[5] || '').trim();
      if (pinEnregistre && pinEnregistre !== pin) return false;
      const tVal = r[7];
      if (tVal === true || /oui|true|tr[eé]sorier/i.test(String(tVal || '').trim())) {
        return true;
      }
    }
  }
  return false;
}

function authentifierUtilisateur(telephoneSaisi, pinSaisi, inclureDonnees) {
  const tel = normaliserNumero(telephoneSaisi);
  const pin = String(pinSaisi || '').trim();

  if (!tel || tel.length < 10) throw new Error('Veuillez saisir un numéro de téléphone valide (ex : 06 12 34 56 78).');
  if (!/^\d{4,8}$/.test(pin)) throw new Error('Le code PIN doit contenir entre 4 et 8 chiffres.');

  const ss = getSpreadsheet();
  const cfg = getClubConfig(ss);
  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) throw new Error('Onglet Effectif introuvable dans le classeur.');
  const rows = shEff.getDataRange().getValues();

  let joueurIndex = -1;
  let joueurRow = null;

  for (let i = 1; i < rows.length; i++) {
    if (normaliserNumero(dechiffrerNumero(rows[i][1])) === tel) {
      joueurIndex = i + 1;
      joueurRow = rows[i];
      break;
    }
  }

  const estAdmin = cfg.adminPhones.indexOf(tel) !== -1;

  if (joueurIndex === -1 && !estAdmin) {
    throw new Error('Votre numéro n\'est pas encore répertorié dans l\'effectif. Demandez à votre coach de vous ajouter.');
  }

  let pinEnregistre = joueurRow ? String(joueurRow[5] || '').trim() : '';

  if (joueurIndex !== -1 && !pinEnregistre) {
    shEff.getRange(joueurIndex, 6).setValue(pin);
    pinEnregistre = pin;
  } else if (pinEnregistre && pinEnregistre !== pin) {
    throw new Error('Code PIN incorrect.');
  }

  const nomJoueur = joueurRow ? String(joueurRow[0] || '').trim() : 'Coach / Admin';
  const posteJoueur = joueurRow ? String(joueurRow[2] || 'Demi-Centre').trim() : 'Coach';
  const photoJoueur = joueurRow ? convertirUrlPhoto(joueurRow[4]) : '';
  const valTresorier = joueurRow ? joueurRow[7] : false;
  const estTresorier = Boolean(valTresorier === true || /oui|true|tr[eé]sorier/i.test(String(valTresorier || '').trim()));
  const estCoach = estAdmin || /coach|entraineur|entraîneur|responsable/i.test(posteJoueur);
  const idSpaktaJoueur = joueurRow ? String(joueurRow[9] || '').trim() : '';

  let donneesInitiales = null;
  if (inclureDonnees) {
    try {
      donneesInitiales = lireDonneesCoach(ss, cfg);
    } catch (errData) {
      Logger.log('Erreur préchargement données dans authentifierUtilisateur : ' + errData.message);
    }
  }

  return {
    ok: true,
    telephone: tel,
    pin: pin,
    nom: nomJoueur,
    poste: posteJoueur,
    photo: photoJoueur,
    idSpakta: idSpaktaJoueur,
    estCoach: estCoach,
    estTresorier: estTresorier,
    donnees: donneesInitiales
  };
}

function enregistrerMaPhoto(telephoneSaisi, pinSaisi, nouvellePhotoDataOuUrl) {
  const auth = authentifierUtilisateur(telephoneSaisi, pinSaisi);
  const ss = getSpreadsheet();
  const shEff = ss.getSheetByName('Effectif');
  const rows = shEff.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (normaliserNumero(dechiffrerNumero(rows[i][1])) === auth.telephone) {
      let urlStockee = String(nouvellePhotoDataOuUrl || '').trim();
      if (urlStockee.indexOf('data:image/') === 0) {
        try {
          const parts = urlStockee.split(',');
          const mime = parts[0].match(/:(.*?);/)[1];
          const decoded = Utilities.base64Decode(parts[1]);
          const nomFichier = 'photo_' + auth.telephone + '_' + new Date().getTime();
          const blob = Utilities.newBlob(decoded, mime, nomFichier);
          const fichier = DriveApp.createFile(blob);
          fichier.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          urlStockee = fichier.getUrl();
        } catch (e) {}
      }
      shEff.getRange(i + 1, 5).setValue(urlStockee);
      return { ok: true, photo: convertirUrlPhoto(urlStockee) };
    }
  }
  throw new Error('Joueur introuvable dans l\'effectif.');
}

function enregistrerMonPoste(telephoneSaisi, pinSaisi, nouveauPoste) {
  const auth = authentifierUtilisateur(telephoneSaisi, pinSaisi);
  const ss = getSpreadsheet();
  const shEff = ss.getSheetByName('Effectif');
  const rows = shEff.getDataRange().getValues();
  const postePropre = String(nouveauPoste || 'Demi-Centre').trim();

  for (let i = 1; i < rows.length; i++) {
    if (normaliserNumero(dechiffrerNumero(rows[i][1])) === auth.telephone) {
      shEff.getRange(i + 1, 3).setValue(postePropre);
      const shVotes = ss.getSheetByName('Votes_Semaine');
      if (shVotes && shVotes.getLastRow() > 1) {
        const rowsV = shVotes.getRange(2, 1, shVotes.getLastRow() - 1, 2).getValues();
        for (let k = 0; k < rowsV.length; k++) {
          if (String(rowsV[k][0]).trim().toLowerCase() === auth.nom.toLowerCase()) {
            shVotes.getRange(k + 2, 2).setValue(postePropre);
            break;
          }
        }
      }
      return { ok: true, poste: postePropre };
    }
  }
  throw new Error('Joueur introuvable dans l\'effectif.');
}

function enregistrerFicheJoueurParCoach(telCoach, pinCoach, joueurCible) {
  const ss = getSpreadsheet();
  const telNorm = normaliserNumero(telCoach);
  const pinNorm = String(pinCoach || '').trim();
  if (!verifierDroitsCoachOuTresorier(ss, telNorm, pinNorm)) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }
  const estVraiCoach = verifierDroitsCoachOuDev(ss, telNorm, pinNorm);
  if (!joueurCible || !joueurCible.nom) throw new Error('Données du joueur incomplètes.');

  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) throw new Error('Onglet Effectif introuvable.');
  const rows = shEff.getDataRange().getValues();

  const nomCible = String(joueurCible.nom || '').trim();
  const nouveauPoste = String(joueurCible.poste || '').trim();
  let nouvellePhoto = (joueurCible.photo !== undefined) ? String(joueurCible.photo || '').trim() : undefined;
  const nouvelleNote = String(joueurCible.note || '').trim();
  const nouveauTel = joueurCible.tel ? normaliserNumero(joueurCible.tel) : '';
  const nouvelleEquipe = String(joueurCible.equipe || '').trim();

  for (let i = 1; i < rows.length; i++) {
    const nomExistant = String(rows[i][0] || '').trim();
    const nomPropre = nomExistant.replace(/\s*\([^)]*\)\s*/g, '').trim();
    if (nomExistant.toLowerCase() === nomCible.toLowerCase() || nomPropre.toLowerCase() === nomCible.toLowerCase()) {
      if (nouvellePhoto !== undefined) {
        if (nouvellePhoto.indexOf('data:image/') === 0) {
          try {
            const parts = nouvellePhoto.split(',');
            const mime = parts[0].match(/:(.*?);/)[1];
            const decoded = Utilities.base64Decode(parts[1]);
            const nomFichier = 'photo_' + nomPropre.replace(/\s+/g, '_') + '_' + new Date().getTime();
            const blob = Utilities.newBlob(decoded, mime, nomFichier);
            const fichier = DriveApp.createFile(blob);
            fichier.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            nouvellePhoto = fichier.getUrl();
          } catch (e) {}
        }
        shEff.getRange(i + 1, 5).setValue(nouvellePhoto);
      }

      if (nouveauTel) shEff.getRange(i + 1, 2).setValue(chiffrerNumero(nouveauTel));
      if (nouveauPoste) shEff.getRange(i + 1, 3).setValue(nouveauPoste);
      if (nouvelleEquipe) shEff.getRange(i + 1, 4).setValue(nouvelleEquipe);
      shEff.getRange(i + 1, 7).setValue(nouvelleNote);
      if (estVraiCoach && joueurCible.estTresorier !== undefined) {
        shEff.getRange(i + 1, 8).setValue(joueurCible.estTresorier ? 'OUI' : 'NON');
        try { synchroniserTresoriersEtChouchouxSheet(ss, 'effectif'); } catch (e) {}
      }
      if (joueurCible.idSpakta !== undefined) {
        try {
          if (!shEff.getRange('J1').getValue()) {
            shEff.getRange('J1').setValue('ID Spakta').setFontWeight('bold');
          }
        } catch (eH) {}
        shEff.getRange(i + 1, 10).setValue(String(joueurCible.idSpakta || '').trim());
      }

      if (nouveauPoste) {
        const shVotes = ss.getSheetByName('Votes_Semaine');
        if (shVotes && shVotes.getLastRow() > 1) {
          const rowsV = shVotes.getRange(2, 1, shVotes.getLastRow() - 1, 2).getValues();
          for (let k = 0; k < rowsV.length; k++) {
            if (String(rowsV[k][0]).trim().toLowerCase() === nomPropre.toLowerCase()) {
              shVotes.getRange(k + 2, 2).setValue(nouveauPoste);
              break;
            }
          }
        }
      }

      const valTresorierActuel = (estVraiCoach && joueurCible.estTresorier !== undefined) ? Boolean(joueurCible.estTresorier) : Boolean(rows[i][7] === true || /oui|true|tr[eé]sorier/i.test(String(rows[i][7] || '')));

      const photoStockeeFinale = (nouvellePhoto !== undefined) ? nouvellePhoto : rows[i][4];
      const idSpaktaFinal = (joueurCible.idSpakta !== undefined) ? String(joueurCible.idSpakta || '').trim() : String(rows[i][9] || '').trim();

      return {
        ok: true,
        joueur: {
          nom: nomPropre,
          tel: nouveauTel || dechiffrerNumero(rows[i][1]),
          poste: nouveauPoste || String(rows[i][2] || 'Demi-Centre'),
          equipe: nouvelleEquipe || String(rows[i][3] || ''),
          photo: convertirUrlPhoto(photoStockeeFinale),
          note: nouvelleNote,
          estTresorier: valTresorierActuel,
          idSpakta: idSpaktaFinal
        }
      };
    }
  }

  throw new Error('Joueur non trouvé dans l\'effectif.');
}

/**
 * Enregistre ou retire le ou les chouchou(x) du coach (Easter egg)
 */
function enregistrerChouchou(telCoach, pinCoach, nomJoueur) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  const cleanNom = String(nomJoueur || '').trim();
  PropertiesService.getScriptProperties().setProperty('CHOUCHOU_NOM', cleanNom);

  const shEff = ss.getSheetByName('Effectif');
  if (shEff && shEff.getLastRow() > 1) {
    const rows = shEff.getRange(2, 1, shEff.getLastRow() - 1, 1).getValues();
    const listeNoms = cleanNom.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
    for (let i = 0; i < rows.length; i++) {
      const nomP = String(rows[i][0] || '').replace(/\s*\([^)]*\)\s*/g, '').trim().toLowerCase();
      const isChou = (listeNoms.indexOf(nomP) !== -1);
      shEff.getRange(i + 2, 9).setValue(isChou ? 'OUI' : 'NON');
    }
  }

  const shCfg = ss.getSheetByName('Configuration');
  if (shCfg) {
    try {
      const cfgRange = shCfg.getRange('B18:B38').getValues();
      for (let r = 0; r < cfgRange.length; r++) {
        if (String(cfgRange[r][0] || '').toLowerCase().indexOf('chouchou') !== -1) {
          shCfg.getRange(18 + r, 3).setValue(cleanNom);
          break;
        }
      }
    } catch (e) {}
  }

  return { succes: true, chouchou: cleanNom };
}

/**
 * Enregistre ou retire la désignation du MVP du match
 */
function enregistrerMvpDesignation(telCoach, pinCoach, nomJoueur) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  const cleanNom = String(nomJoueur || '').trim();
  PropertiesService.getScriptProperties().setProperty('MVP_NOM', cleanNom);
  try {
    const shCfg = ss.getSheetByName('Configuration');
    if (shCfg) shCfg.getRange('C37').setValue(cleanNom);
  } catch (e) {}
  try { synchroniserOngletTropheesSheet(ss); } catch (e) {}
  return { succes: true, mvp: cleanNom };
}

/**
 * Enregistre ou retire la désignation de la Chèvre du match
 */
function enregistrerChevreDesignation(telCoach, pinCoach, nomJoueur) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  const cleanNom = String(nomJoueur || '').trim();
  PropertiesService.getScriptProperties().setProperty('CHEVRE_NOM', cleanNom);
  try {
    const shCfg = ss.getSheetByName('Configuration');
    if (shCfg) shCfg.getRange('C38').setValue(cleanNom);
  } catch (e) {}
  try { synchroniserOngletTropheesSheet(ss); } catch (e) {}
  return { succes: true, chevre: cleanNom };
}

/**
 * -------------------------------------------------------------
 * FONCTIONNALITÉS JOUEURS (ESPACE JOUEUR, VOTE MVP, COVOITURAGE, ABSENCES)
 * -------------------------------------------------------------
 */

/**
 * Enregistre ou met à jour le covoiturage d'un joueur
 */
function enregistrerCovoiturage(tel, pin, actionType, nbPlaces, conducteurNom) {
  const auth = authentifierUtilisateur(tel, pin);
  const ss = getSpreadsheet();
  let covoit = getCovoiturageData();

  if (!covoit || typeof covoit !== 'object') covoit = {};
  if (!covoit.conducteurs) covoit.conducteurs = [];
  if (!covoit.passagers) covoit.passagers = [];

  // Retirer le joueur des listes existantes
  covoit.conducteurs = covoit.conducteurs.filter(function(c) { return c.nom !== auth.nom; });
  covoit.passagers = covoit.passagers.filter(function(p) { return p.nom !== auth.nom; });

  const isConducteur = (actionType === 'conducteur' || actionType === 'conduis');
  const isPassager = (actionType === 'passager' || actionType === 'cherche');

  if (isConducteur) {
    const places = parseInt(nbPlaces, 10) || 3;
    covoit.conducteurs.push({ nom: auth.nom, tel: auth.telephone, places: places, nbPlaces: places, passagers: [] });
  } else if (isPassager) {
    covoit.passagers.push({ nom: auth.nom, tel: auth.telephone, avec: String(conducteurNom || '').trim() });
    if (conducteurNom) {
      covoit.conducteurs.forEach(function(c) {
        if (c.nom.toLowerCase() === String(conducteurNom).toLowerCase().trim()) {
          if (!c.passagers) c.passagers = [];
          if (c.passagers.indexOf(auth.nom) === -1) c.passagers.push(auth.nom);
        }
      });
    }
  }

  try {
    PropertiesService.getScriptProperties().setProperty('COVOITURAGE_DATA', JSON.stringify(covoit));
  } catch (e) {}

  if (ss) {
    try { synchroniserOngletCovoiturageSheet(ss, covoit); } catch (e) {}
  }

  return { ok: true, covoiturage: covoit };
}

/**
 * Récupère les données de covoiturage (Priorité : feuille Google Sheets "Covoiturage")
 */
function getCovoiturageData() {
  const ss = getSpreadsheet();
  if (ss) {
    const fromSheet = lireCovoiturageDepuisSheet(ss);
    if (fromSheet && (fromSheet.conducteurs.length > 0 || fromSheet.passagers.length > 0)) {
      try {
        PropertiesService.getScriptProperties().setProperty('COVOITURAGE_DATA', JSON.stringify(fromSheet));
      } catch (e) {}
      return fromSheet;
    }
  }

  const props = PropertiesService.getScriptProperties();
  try {
    const raw = props.getProperty('COVOITURAGE_DATA');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (Array.isArray(parsed.conducteurs) || Array.isArray(parsed.passagers))) {
        if (ss) {
          try { synchroniserOngletCovoiturageSheet(ss, parsed); } catch (e) {}
        }
        return parsed;
      }
    }
  } catch (e) {}

  return { conducteurs: [], passagers: [] };
}

/**
 * Réinitialise le covoiturage pour un nouveau match
 */
function reinitialiserCovoiturage(telCoach, pinCoach) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  const clean = { conducteurs: [], passagers: [] };
  try {
    PropertiesService.getScriptProperties().setProperty('COVOITURAGE_DATA', JSON.stringify(clean));
  } catch (e) {}
  if (ss) {
    try { synchroniserOngletCovoiturageSheet(ss, clean); } catch (e) {}
  }
  return { ok: true, covoiturage: clean };
}

/**
 * Synchronise et met en forme l'onglet "Covoiturage" dans Google Sheets
 */
function synchroniserOngletCovoiturageSheet(ss, covoitOpt) {
  if (!ss) ss = getSpreadsheet();
  if (!ss) return { ok: false, error: 'Classeur introuvable' };

  let sh = ss.getSheetByName('Covoiturage');
  if (!sh) {
    sh = ss.insertSheet('Covoiturage');
  }
  try {
    sh.setTabColor('#6366f1');
  } catch (e) {}

  sh.clear();

  let covoit = covoitOpt;
  if (!covoit) {
    covoit = getCovoiturageData();
  }
  if (!covoit || typeof covoit !== 'object') covoit = { conducteurs: [], passagers: [] };
  const conds = Array.isArray(covoit.conducteurs) ? covoit.conducteurs : [];
  const pass = Array.isArray(covoit.passagers) ? covoit.passagers : [];

  let totalPlacesProposees = 0;
  conds.forEach(function(c) {
    totalPlacesProposees += (parseInt(c.nbPlaces || c.places, 10) || 0);
  });

  const horodatage = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'dd/MM/yyyy HH:mm');

  // Lignes 1-2 : Bannière Titre
  sh.getRange('A1:F1').merge()
    .setValue('🚗 COVOITURAGE & DÉPLACEMENTS MATCH')
    .setBackground('#0f172a')
    .setFontColor('#f8fafc')
    .setFontWeight('bold')
    .setFontSize(13)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);

  sh.getRange('A2:F2').merge()
    .setValue('Dernière synchronisation : ' + horodatage + ' • Conducteurs : ' + conds.length + ' • Places proposées : ' + totalPlacesProposees + ' • Passagers inscrits : ' + pass.length)
    .setBackground('#1e293b')
    .setFontColor('#94a3b8')
    .setFontStyle('italic')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(2, 22);

  const entetes = ['Rôle', 'Joueur', 'Téléphone', 'Places (Offertes / Demandées)', 'Passagers Assignés / Conducteur Choisi', 'Statut / Note'];
  sh.getRange(4, 1, 1, 6).setValues([entetes])
    .setBackground('#4f46e5')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10);
  sh.setRowHeight(4, 26);

  let curRow = 5;

  if (conds.length === 0 && pass.length === 0) {
    sh.getRange(curRow, 1, 1, 6).merge()
      .setValue('Aucun covoiturage enregistré pour le moment. (Inscriptions disponibles dans le Hub Joueur WebApp)')
      .setFontColor('#64748b')
      .setFontStyle('italic')
      .setHorizontalAlignment('center');
    sh.setRowHeight(curRow, 24);
    curRow++;
  } else {
    // 1. Conducteurs
    conds.forEach(function(c) {
      const pl = parseInt(c.nbPlaces || c.places, 10) || 3;
      const listePass = (Array.isArray(c.passagers) && c.passagers.length > 0) ? c.passagers.join(', ') : 'Aucun passager pour l\'instant';
      const plRestantes = Math.max(0, pl - ((c.passagers && c.passagers.length) || 0));
      const note = plRestantes > 0 ? (plRestantes + ' place(s) libre(s)') : 'Complet';

      sh.getRange(curRow, 1, 1, 6).setValues([[
        '🚗 Conducteur',
        c.nom || '',
        c.tel || '',
        pl + ' places',
        listePass,
        note
      ]]);
      sh.getRange(curRow, 1, 1, 6).setBackground('#e0e7ff');
      sh.setRowHeight(curRow, 22);
      curRow++;
    });

    // 2. Passagers
    pass.forEach(function(p) {
      const avec = p.avec ? ('Avec ' + p.avec) : 'Cherche un conducteur';
      sh.getRange(curRow, 1, 1, 6).setValues([[
        '🚶 Passager',
        p.nom || '',
        p.tel || '',
        '1 place',
        avec,
        p.avec ? 'Attribué' : 'En recherche'
      ]]);
      sh.getRange(curRow, 1, 1, 6).setBackground('#f8fafc');
      sh.setRowHeight(curRow, 22);
      curRow++;
    });

    sh.getRange(curRow, 1, 1, 6).merge()
      .setValue('Total : ' + conds.length + ' véhicule(s) • ' + totalPlacesProposees + ' places offertes • ' + pass.length + ' passager(s)')
      .setFontSize(9)
      .setFontColor('#64748b')
      .setFontStyle('italic');
    curRow++;
  }

  try {
    sh.setColumnWidth(1, 120);
    sh.setColumnWidth(2, 160);
    sh.setColumnWidth(3, 130);
    sh.setColumnWidth(4, 150);
    sh.setColumnWidth(5, 250);
    sh.setColumnWidth(6, 140);
  } catch (e) {}

  return { ok: true, maj: horodatage, total: conds.length + pass.length };
}

/**
 * Lit les données de covoiturage depuis l'onglet Covoiturage
 */
function lireCovoiturageDepuisSheet(ss) {
  try {
    const classeur = ss || getSpreadsheet();
    if (!classeur) return null;
    const sh = classeur.getSheetByName('Covoiturage');
    if (!sh || sh.getLastRow() < 5) return null;

    const rows = sh.getRange(5, 1, sh.getLastRow() - 4, 6).getValues();
    const conducteurs = [];
    const passagers = [];

    rows.forEach(function(r) {
      const role = String(r[0] || '').toLowerCase();
      const nom = String(r[1] || '').trim();
      const tel = String(r[2] || '').trim();
      if (!nom || role.indexOf('total') !== -1 || role.indexOf('aucun') !== -1) return;

      if (role.indexOf('conducteur') !== -1) {
        const rawPl = parseInt(String(r[3] || '').replace(/[^0-9]/g, ''), 10) || 3;
        const rawPass = String(r[4] || '').trim();
        const passList = (rawPass && rawPass.toLowerCase().indexOf('aucun') === -1)
          ? rawPass.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
          : [];
        conducteurs.push({
          nom: nom,
          tel: tel,
          places: rawPl,
          nbPlaces: rawPl,
          passagers: passList
        });
      } else if (role.indexOf('passager') !== -1) {
        let avec = String(r[4] || '').trim();
        if (avec.toLowerCase().indexOf('avec ') === 0) avec = avec.substring(5).trim();
        if (avec.toLowerCase().indexOf('cherche') !== -1) avec = '';
        passagers.push({
          nom: nom,
          tel: tel,
          avec: avec
        });
      }
    });

    return { conducteurs: conducteurs, passagers: passagers };
  } catch (e) {
    Logger.log('Erreur lireCovoiturageDepuisSheet: ' + e.message);
    return null;
  }
}

/**
 * Enregistre le vote d'un joueur pour le MVP du match
 */
function voterMvp(tel, pin, nomMvp) {
  const auth = authentifierUtilisateur(tel, pin);
  const props = PropertiesService.getScriptProperties();
  let votes = {};
  try {
    const raw = props.getProperty('VOTES_MVP_DATA');
    if (raw) votes = JSON.parse(raw);
  } catch (e) { votes = {}; }

  if (!votes.liste) votes.liste = {};

  const mMvp = String(nomMvp || '').trim();
  if (!mMvp) throw new Error('Veuillez sélectionner un joueur pour le titre de MVP.');

  votes.liste[auth.telephone] = {
    votant: auth.nom,
    mvp: mMvp,
    date: new Date().toISOString()
  };

  props.setProperty('VOTES_MVP_DATA', JSON.stringify(votes));
  try { synchroniserOngletTropheesSheet(); } catch (e) {}
  const res = calculerResultatsVotesMvp(votes, auth.telephone);
  return { ok: true, votesMvp: res, ...res };
}

/**
 * Rétro-compatibilité vote MVP & Chèvre
 */
function voterMvpChevre(tel, pin, nomMvp, nomChevre) {
  return voterMvp(tel, pin, nomMvp);
}

/**
 * Calcule le classement des votes MVP
 */
function calculerResultatsVotesMvp(votesData, telUtilisateur) {
  const decompteMvp = {};
  const liste = (votesData && votesData.liste) ? votesData.liste : {};
  let totalVotes = 0;
  let monVoteMvp = '';
  const telNorm = telUtilisateur ? normaliserNumero(telUtilisateur) : '';

  Object.keys(liste).forEach(function(t) {
    const v = liste[t];
    if (v && v.mvp) {
      totalVotes++;
      decompteMvp[v.mvp] = (decompteMvp[v.mvp] || 0) + 1;
      if (telNorm && normaliserNumero(t) === telNorm) {
        monVoteMvp = v.mvp;
      }
    }
  });

  const trier = function(obj) {
    return Object.keys(obj).map(function(nom) {
      return { nom: nom, voix: obj[nom], votes: obj[nom] };
    }).sort(function(a, b) { return b.voix - a.voix; });
  };

  return {
    ok: true,
    totalVotes: totalVotes,
    podiumMvp: trier(decompteMvp),
    monVoteMvp: monVoteMvp
  };
}

/**
 * Récupère les votes MVP et le podium actuel (Priorité : feuille Trophées & Bêtisier)
 */
function getVotesMvpData(telUtilisateur, ssOpt) {
  const ss = ssOpt || getSpreadsheet();
  let votes = null;
  if (ss) {
    try { votes = lireVotesMvpDepuisSheet(ss); } catch (e) {}
  }
  if (!votes) {
    const props = PropertiesService.getScriptProperties();
    try {
      const raw = props.getProperty('VOTES_MVP_DATA');
      if (raw) votes = JSON.parse(raw);
    } catch (e) {}
  }
  if (!votes || typeof votes !== 'object') votes = { liste: {} };
  const res = calculerResultatsVotesMvp(votes, telUtilisateur);
  res.rawVotes = votes;
  return res;
}

/**
 * Réinitialise les votes MVP pour le prochain match (Coach)
 */
function reinitialiserVotesMvp(telCoach, pinCoach) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  const clean = { liste: {} };
  PropertiesService.getScriptProperties().setProperty('VOTES_MVP_DATA', JSON.stringify(clean));
  try { synchroniserOngletTropheesSheet(ss); } catch (e) {}
  return calculerResultatsVotesMvp(clean);
}

/**
 * -------------------------------------------------------------
 * TROPHÉE CHÈVRE DU MATCH (BÊTISIER D'ACTIONS PROPOSÉES & VOTÉES)
 * -------------------------------------------------------------
 */

/**
 * Récupère les actions du bêtisier et les résultats de votes Chèvre (Priorité : feuille Trophées & Bêtisier)
 */
function getChevreData(telUtilisateur, ssOpt) {
  const ss = ssOpt || getSpreadsheet();
  let rawData = null;
  if (ss) {
    try { rawData = lireChevreDepuisSheet(ss); } catch (e) {}
  }
  if (!rawData) {
    const props = PropertiesService.getScriptProperties();
    try {
      const raw = props.getProperty('ACTIONS_CHEVRE_DATA');
      if (raw) rawData = JSON.parse(raw);
    } catch (e) {}
  }
  if (!rawData || typeof rawData !== 'object') rawData = { actions: [], votes: {} };
  const res = calculerResultatsChevre(rawData, telUtilisateur);
  res.rawChevre = rawData;
  return res;
}

/**
 * Calcule les résultats et le classement des actions Chèvre
 */
function calculerResultatsChevre(rawData, telUtilisateur) {
  const actions = (rawData && Array.isArray(rawData.actions)) ? rawData.actions : [];
  const votes = (rawData && rawData.votes) ? rawData.votes : {};

  const decompteVoix = {};
  let totalVotes = 0;
  let monVoteActionId = '';
  const telNorm = telUtilisateur ? normaliserNumero(telUtilisateur) : '';

  Object.keys(votes).forEach(function(t) {
    const v = votes[t];
    if (v && v.actionId) {
      totalVotes++;
      decompteVoix[v.actionId] = (decompteVoix[v.actionId] || 0) + 1;
      if (telNorm && normaliserNumero(t) === telNorm) {
        monVoteActionId = v.actionId;
      }
    }
  });

  const actionsEnrichies = actions.map(function(act) {
    const nbVoix = decompteVoix[act.id] || 0;
    return {
      id: act.id,
      description: act.description,
      joueur: act.joueur || '',
      auteur: act.auteur || '',
      auteurTel: act.auteurTel || '',
      date: act.date || '',
      voix: nbVoix,
      estMonVote: (act.id === monVoteActionId)
    };
  }).sort(function(a, b) {
    if (b.voix !== a.voix) return b.voix - a.voix;
    return String(b.date || '').localeCompare(String(a.date || ''));
  });

  return {
    ok: true,
    totalActions: actions.length,
    totalVotes: totalVotes,
    actions: actionsEnrichies,
    podiumChevre: actionsEnrichies.slice(0, 3),
    monVoteActionId: monVoteActionId
  };
}

/**
 * Propose une nouvelle action du match éligible au vote de la Chèvre
 */
function proposerActionChevre(tel, pin, description, joueurConcerne) {
  const auth = authentifierUtilisateur(tel, pin);
  const desc = String(description || '').trim();
  const joueur = String(joueurConcerne || '').trim();

  if (!desc) throw new Error('Veuillez décrire l\'action pour le bêtisier.');

  const props = PropertiesService.getScriptProperties();
  let rawData = {};
  try {
    const raw = props.getProperty('ACTIONS_CHEVRE_DATA');
    if (raw) rawData = JSON.parse(raw);
  } catch (e) { rawData = {}; }

  if (!Array.isArray(rawData.actions)) rawData.actions = [];
  if (!rawData.votes) rawData.votes = {};

  const actionId = 'chv_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000);
  rawData.actions.push({
    id: actionId,
    description: desc,
    joueur: joueur,
    auteur: auth.nom,
    auteurTel: auth.telephone,
    date: new Date().toISOString()
  });

  props.setProperty('ACTIONS_CHEVRE_DATA', JSON.stringify(rawData));
  try { synchroniserOngletTropheesSheet(); } catch (e) {}
  const res = calculerResultatsChevre(rawData, auth.telephone);
  return { ok: true, chevreData: res, ...res };
}

/**
 * Supprime une action du bêtisier (par son auteur ou un coach)
 */
function supprimerActionChevre(tel, pin, idAction) {
  const auth = authentifierUtilisateur(tel, pin);
  const ss = getSpreadsheet();
  const estCoach = verifierDroitsCoachOuDev(ss, normaliserNumero(tel), String(pin || '').trim());

  const props = PropertiesService.getScriptProperties();
  let rawData = {};
  try {
    const raw = props.getProperty('ACTIONS_CHEVRE_DATA');
    if (raw) rawData = JSON.parse(raw);
  } catch (e) { rawData = {}; }

  if (!Array.isArray(rawData.actions)) rawData.actions = [];
  if (!rawData.votes) rawData.votes = {};

  const act = rawData.actions.find(function(a) { return a.id === idAction; });
  if (!act) throw new Error('Action introuvable.');

  if (!estCoach && normaliserNumero(act.auteurTel) !== normaliserNumero(auth.telephone)) {
    throw new Error('Vous ne pouvez supprimer que les actions que vous avez créées.');
  }

  rawData.actions = rawData.actions.filter(function(a) { return a.id !== idAction; });
  Object.keys(rawData.votes).forEach(function(t) {
    if (rawData.votes[t] && rawData.votes[t].actionId === idAction) {
      delete rawData.votes[t];
    }
  });

  props.setProperty('ACTIONS_CHEVRE_DATA', JSON.stringify(rawData));
  try { synchroniserOngletTropheesSheet(ss); } catch (e) {}
  const res = calculerResultatsChevre(rawData, auth.telephone);
  return { ok: true, chevreData: res, ...res };
}

/**
 * Enregistre ou bascule le vote d'un joueur pour une action Chèvre
 */
function voterActionChevre(tel, pin, idAction) {
  const auth = authentifierUtilisateur(tel, pin);
  const props = PropertiesService.getScriptProperties();
  let rawData = {};
  try {
    const raw = props.getProperty('ACTIONS_CHEVRE_DATA');
    if (raw) rawData = JSON.parse(raw);
  } catch (e) { rawData = {}; }

  if (!Array.isArray(rawData.actions)) rawData.actions = [];
  if (!rawData.votes) rawData.votes = {};

  const act = rawData.actions.find(function(a) { return a.id === idAction; });
  if (!act) throw new Error('Cette action n\'existe plus.');

  const telNorm = normaliserNumero(auth.telephone);
  if (rawData.votes[telNorm] && rawData.votes[telNorm].actionId === idAction) {
    delete rawData.votes[telNorm];
  } else {
    rawData.votes[telNorm] = {
      votant: auth.nom,
      actionId: idAction,
      date: new Date().toISOString()
    };
  }

  props.setProperty('ACTIONS_CHEVRE_DATA', JSON.stringify(rawData));
  try { synchroniserOngletTropheesSheet(); } catch (e) {}
  const res = calculerResultatsChevre(rawData, auth.telephone);
  return { ok: true, chevreData: res, ...res };
}

/**
 * Réinitialise les actions et votes Chèvre pour le prochain match (Coach)
 */
function reinitialiserVotesChevre(telCoach, pinCoach) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  const clean = { actions: [], votes: {} };
  PropertiesService.getScriptProperties().setProperty('ACTIONS_CHEVRE_DATA', JSON.stringify(clean));
  try { synchroniserOngletTropheesSheet(ss); } catch (e) {}
  return calculerResultatsChevre(clean);
}

/**
 * Synchronise et met en forme l'onglet "Trophées & Bêtisier" dans Google Sheets
 * Présente le classement de l'élection du MVP et le bêtisier de la Chèvre du match
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - Le classeur Google Sheets (optionnel)
 * @return {Object} Résumé de la synchronisation
 */
function synchroniserOngletTropheesSheet(ss) {
  if (!ss) ss = getSpreadsheet();
  if (!ss) return { ok: false, error: 'Classeur introuvable' };

  let sh = ss.getSheetByName('Trophées & Bêtisier');
  if (!sh) {
    sh = ss.insertSheet('Trophées & Bêtisier');
  }
  try {
    sh.setTabColor('#f59e0b');
  } catch (e) {}

  sh.clear();

  const props = PropertiesService.getScriptProperties();
  const mvpDesignation = props.getProperty('MVP_NOM') || '';
  const chevreDesignation = props.getProperty('CHEVRE_NOM') || '';
  const resMvp = getVotesMvpData();
  const resChevre = getChevreData();

  const totalVotesMvp = resMvp.totalVotes || 0;
  const podiumMvp = resMvp.podiumMvp || [];

  const totalActionsChevre = resChevre.totalActions || 0;
  const totalVotesChevre = resChevre.totalVotes || 0;
  const actionsChevre = resChevre.actions || [];

  const horodatage = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'dd/MM/yyyy HH:mm');

  // Lignes 1-2 : Bannière Titre
  sh.getRange('A1:F1').merge()
    .setValue('🏆 PALMARÈS DU MATCH : ÉLECTION MVP & 🐐 TROPHÉE CHÈVRE')
    .setBackground('#0f172a')
    .setFontColor('#f8fafc')
    .setFontWeight('bold')
    .setFontSize(13)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);

  sh.getRange('A2:F2').merge()
    .setValue('Dernière synchronisation : ' + horodatage + ' • Synchronisé automatiquement depuis la WebApp')
    .setBackground('#1e293b')
    .setFontColor('#94a3b8')
    .setFontStyle('italic')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(2, 22);

  let curRow = 4;

  // ==========================================
  // BLOC 1 : ÉLECTION MVP DU MATCH
  // ==========================================
  sh.getRange(curRow, 1, 1, 5).merge()
    .setValue('🏆 1. ÉLECTION DU JOUEUR DU MATCH (MVP)')
    .setBackground('#f59e0b')
    .setFontColor('#111827')
    .setFontWeight('bold')
    .setFontSize(11)
    .setVerticalAlignment('middle');
  sh.setRowHeight(curRow, 28);
  curRow++;

  const entetesMvp = ['Rang', 'Joueur', 'Nombre de votes', '% des voix', 'Statut / Élection'];
  sh.getRange(curRow, 1, 1, 5).setValues([entetesMvp])
    .setBackground('#1e293b')
    .setFontColor('#f1f5f9')
    .setFontWeight('bold')
    .setFontSize(10);
  sh.setRowHeight(curRow, 24);
  curRow++;

  if (podiumMvp.length === 0 && !mvpDesignation) {
    sh.getRange(curRow, 1, 1, 5).merge()
      .setValue('Aucun vote MVP enregistré pour le moment. (Vote ouvert dans la WebApp)')
      .setFontColor('#64748b')
      .setFontStyle('italic')
      .setHorizontalAlignment('center');
    curRow++;
  } else {
    const listeAffichee = podiumMvp.slice();
    if (mvpDesignation && !listeAffichee.some(function(x) { return String(x.nom || '').toLowerCase() === mvpDesignation.toLowerCase(); })) {
      listeAffichee.unshift({ nom: mvpDesignation, voix: 0, votes: 0, estCoachMvp: true });
    }

    listeAffichee.forEach(function(item, idx) {
      let medaille = '•';
      if (idx === 0) medaille = '🥇 1er';
      else if (idx === 1) medaille = '🥈 2e';
      else if (idx === 2) medaille = '🥉 3e';
      else medaille = (idx + 1) + 'e';

      const pct = totalVotesMvp > 0 ? Math.round((item.voix / totalVotesMvp) * 100) + '%' : (item.estCoachMvp ? '-' : '0%');
      let statut = '';
      if (idx === 0 && item.voix > 0) statut = '🏆 Élu MVP du match';
      if (mvpDesignation && String(item.nom || '').toLowerCase() === mvpDesignation.toLowerCase()) {
        statut = (statut ? statut + ' • ' : '') + '⭐ Choix Coach';
      }

      sh.getRange(curRow, 1, 1, 5).setValues([[medaille, item.nom, item.voix, pct, statut]]);
      if (idx === 0 && (item.voix > 0 || item.estCoachMvp)) {
        sh.getRange(curRow, 1, 1, 5).setBackground('#fef3c7').setFontWeight('bold');
      }
      curRow++;
    });

    sh.getRange(curRow, 1, 1, 5).merge()
      .setValue('Total des votes exprimés : ' + totalVotesMvp + ' vote(s)')
      .setFontSize(9)
      .setFontColor('#64748b')
      .setFontStyle('italic');
    curRow++;
  }

  curRow += 2; // Espace entre blocs

  // ==========================================
  // BLOC 2 : TROPHÉE CHÈVRE & BÊTISIER
  // ==========================================
  sh.getRange(curRow, 1, 1, 6).merge()
    .setValue('🐐 2. TROPHÉE CHÈVRE & BÊTISIER D\'ÉQUIPE')
    .setBackground('#ea580c')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setVerticalAlignment('middle');
  sh.setRowHeight(curRow, 28);
  curRow++;

  const entetesChevre = ['Rang', 'Joueur concerné', 'Casserole / Action proposée', 'Proposé par', 'Votes', 'Statut'];
  sh.getRange(curRow, 1, 1, 6).setValues([entetesChevre])
    .setBackground('#1e293b')
    .setFontColor('#f1f5f9')
    .setFontWeight('bold')
    .setFontSize(10);
  sh.setRowHeight(curRow, 24);
  curRow++;

  if (actionsChevre.length === 0 && !chevreDesignation) {
    sh.getRange(curRow, 1, 1, 6).merge()
      .setValue('Aucune casserole proposée pour le moment. (Propositions & votes ouverts dans la WebApp)')
      .setFontColor('#64748b')
      .setFontStyle('italic')
      .setHorizontalAlignment('center');
    curRow++;
  } else {
    actionsChevre.forEach(function(act, idx) {
      let rang = (idx + 1) + 'e';
      let statut = '';
      if (idx === 0 && act.voix > 0) {
        rang = '👑 #1';
        statut = '🐐 Élu Chèvre du match';
      }
      if (chevreDesignation && act.joueur && act.joueur.toLowerCase() === chevreDesignation.toLowerCase()) {
        statut = (statut ? statut + ' • ' : '') + '🎯 Cible Coach';
      }

      sh.getRange(curRow, 1, 1, 6).setValues([[
        rang,
        act.joueur || 'Collectif',
        '« ' + act.description + ' »',
        act.auteur || 'Un coéquipier',
        act.voix,
        statut
      ]]);

      if (idx === 0 && act.voix > 0) {
        sh.getRange(curRow, 1, 1, 6).setBackground('#ffedd5').setFontWeight('bold');
      }
      curRow++;
    });

    sh.getRange(curRow, 1, 1, 6).merge()
      .setValue('Total du bêtisier : ' + totalActionsChevre + ' proposition(s) • ' + totalVotesChevre + ' vote(s)')
      .setFontSize(9)
      .setFontColor('#64748b')
      .setFontStyle('italic');
    curRow++;
  }

  // ==========================================
  // BLOC 3 : DONNÉES ENREGISTRÉES (VOTES & BÊTISIER)
  // ==========================================
  sh.getRange(4, 8, 1, 7).merge()
    .setValue('💾 DONNÉES ENREGISTRÉES (VOTES & BÊTISIER)')
    .setBackground('#334155')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10)
    .setVerticalAlignment('middle');

  const entetesBruts = ['Type Donnée', 'ID / Réf', 'Joueur Concerné / Choisi', 'Votant / Auteur', 'Téléphone', 'Description', 'Horodatage'];
  sh.getRange(5, 8, 1, 7).setValues([entetesBruts])
    .setBackground('#1e293b')
    .setFontColor('#94a3b8')
    .setFontWeight('bold')
    .setFontSize(9);

  let rawRow = 6;
  const rawVotesMvpObj = (resMvp && resMvp.rawVotes && resMvp.rawVotes.liste) ? resMvp.rawVotes.liste : (function(){
    try { const raw = props.getProperty('VOTES_MVP_DATA'); return raw ? (JSON.parse(raw).liste || {}) : {}; } catch(e){ return {}; }
  })();
  Object.keys(rawVotesMvpObj).forEach(function(t) {
    const v = rawVotesMvpObj[t];
    if (v && v.mvp) {
      sh.getRange(rawRow, 8, 1, 7).setValues([['MVP_VOTE', '', v.mvp, v.votant || '', t, '', v.date || '']]);
      rawRow++;
    }
  });

  const rawChevreActions = (resChevre && resChevre.rawChevre && Array.isArray(resChevre.rawChevre.actions)) ? resChevre.rawChevre.actions : (function(){
    try { const raw = props.getProperty('ACTIONS_CHEVRE_DATA'); return raw ? (JSON.parse(raw).actions || []) : []; } catch(e){ return []; }
  })();
  rawChevreActions.forEach(function(act) {
    sh.getRange(rawRow, 8, 1, 7).setValues([['CHEVRE_ACTION', act.id || '', act.joueur || '', act.auteur || '', act.auteurTel || '', act.description || '', act.date || '']]);
    rawRow++;
  });

  const rawChevreVotes = (resChevre && resChevre.rawChevre && resChevre.rawChevre.votes) ? resChevre.rawChevre.votes : (function(){
    try { const raw = props.getProperty('ACTIONS_CHEVRE_DATA'); return raw ? (JSON.parse(raw).votes || {}) : {}; } catch(e){ return {}; }
  })();
  Object.keys(rawChevreVotes).forEach(function(t) {
    const v = rawChevreVotes[t];
    if (v && v.actionId) {
      sh.getRange(rawRow, 8, 1, 7).setValues([['CHEVRE_VOTE', v.actionId || '', '', v.votant || '', t, '', v.date || '']]);
      rawRow++;
    }
  });

  // Ajustement des largeurs de colonnes
  try {
    sh.setColumnWidth(1, 80);   // Rang
    sh.setColumnWidth(2, 160);  // Joueur
    sh.setColumnWidth(3, 340);  // Description / Casserole
    sh.setColumnWidth(4, 150);  // Proposé par
    sh.setColumnWidth(5, 110);  // Votes
    sh.setColumnWidth(6, 170);  // Statut
    sh.setColumnWidth(7, 20);   // Séparateur
    sh.setColumnWidth(8, 110);  // Type
    sh.setColumnWidth(9, 120);  // ID
    sh.setColumnWidth(10, 150); // Joueur
    sh.setColumnWidth(11, 140); // Votant
    sh.setColumnWidth(12, 120); // Tel
    sh.setColumnWidth(13, 200); // Desc
    sh.setColumnWidth(14, 140); // Date
  } catch (e) {}

  return { ok: true, maj: horodatage };
}

/**
 * Lit les votes MVP depuis l'onglet Trophées & Bêtisier
 */
function lireVotesMvpDepuisSheet(ss) {
  try {
    const classeur = ss || getSpreadsheet();
    if (!classeur) return null;
    const sh = classeur.getSheetByName('Trophées & Bêtisier');
    if (!sh || sh.getLastRow() < 6) return null;

    const lastRow = sh.getLastRow();
    const rows = sh.getRange(6, 8, lastRow - 5, 7).getValues();
    const votes = { liste: {} };
    let hasData = false;

    rows.forEach(function(r) {
      if (String(r[0] || '').trim() === 'MVP_VOTE') {
        const mvp = String(r[2] || '').trim();
        const votant = String(r[3] || '').trim();
        const tel = String(r[4] || '').trim();
        const date = String(r[6] || '').trim();
        if (tel && mvp) {
          votes.liste[tel] = { votant: votant, mvp: mvp, date: date };
          hasData = true;
        }
      }
    });

    return hasData ? votes : null;
  } catch (e) {
    return null;
  }
}

/**
 * Lit les actions et votes Chèvre depuis l'onglet Trophées & Bêtisier
 */
function lireChevreDepuisSheet(ss) {
  try {
    const classeur = ss || getSpreadsheet();
    if (!classeur) return null;
    const sh = classeur.getSheetByName('Trophées & Bêtisier');
    if (!sh || sh.getLastRow() < 6) return null;

    const lastRow = sh.getLastRow();
    const rows = sh.getRange(6, 8, lastRow - 5, 7).getValues();
    const actions = [];
    const votes = {};
    let hasData = false;

    rows.forEach(function(r) {
      const type = String(r[0] || '').trim();
      if (type === 'CHEVRE_ACTION') {
        const id = String(r[1] || '').trim();
        const joueur = String(r[2] || '').trim();
        const auteur = String(r[3] || '').trim();
        const auteurTel = String(r[4] || '').trim();
        const desc = String(r[5] || '').trim();
        const date = String(r[6] || '').trim();
        if (id && desc) {
          actions.push({ id: id, joueur: joueur, auteur: auteur, auteurTel: auteurTel, description: desc, date: date });
          hasData = true;
        }
      } else if (type === 'CHEVRE_VOTE') {
        const actionId = String(r[1] || '').trim();
        const votant = String(r[3] || '').trim();
        const tel = String(r[4] || '').trim();
        const date = String(r[6] || '').trim();
        if (tel && actionId) {
          votes[tel] = { votant: votant, actionId: actionId, date: date };
          hasData = true;
        }
      }
    });

    return hasData ? { actions: actions, votes: votes } : null;
  } catch (e) {
    return null;
  }
}

/**
 * Normalise une chaîne ou un objet Date au format YYYY-MM-DD
 */
function normaliserDateIsoAbsence(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    try {
      return Utilities.formatDate(val, Session.getScriptTimeZone() || 'Europe/Paris', 'yyyy-MM-dd');
    } catch (e) {
      return '';
    }
  }
  const s = String(val).trim();
  const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mIso) {
    const mm = mIso[2].length === 1 ? '0' + mIso[2] : mIso[2];
    const jj = mIso[3].length === 1 ? '0' + mIso[3] : mIso[3];
    return mIso[1] + '-' + mm + '-' + jj;
  }
  const mFr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mFr) {
    const jj = mFr[1].length === 1 ? '0' + mFr[1] : mFr[1];
    const mm = mFr[2].length === 1 ? '0' + mFr[2] : mFr[2];
    return mFr[3] + '-' + mm + '-' + jj;
  }
  return '';
}

/**
 * Extrait la date de fin (format YYYY-MM-DD) depuis un texte de mention d'absence
 */
function extraireDateFinDepuisTexteAbsence(texte) {
  if (!texte) return '';
  const mAuIso = texte.match(/\bau\s+(\d{4}-\d{1,2}-\d{1,2})\b/i);
  if (mAuIso) return normaliserDateIsoAbsence(mAuIso[1]);
  const mAuFr = texte.match(/\bau\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i);
  if (mAuFr) return normaliserDateIsoAbsence(mAuFr[1]);

  const mDateIso = texte.match(/(\d{4}-\d{1,2}-\d{1,2})/);
  if (mDateIso) return normaliserDateIsoAbsence(mDateIso[1]);
  const mDateFr = texte.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (mDateFr) return normaliserDateIsoAbsence(mDateFr[1]);

  return '';
}

/**
 * Nettoie une chaîne de notes en retirant les mentions d'absences terminées
 * tout en conservant scrupuleusement les notes saisies par le coach.
 */
function nettoyerNoteJoueurAbsences(noteBrute, aujourdhuiIso) {
  if (!noteBrute) return '';
  const str = String(noteBrute).trim();
  if (!str) return '';

  const morceaux = str.split(/\s*(?:•|\n)\s*/);
  const morceauxGardes = [];

  for (let i = 0; i < morceaux.length; i++) {
    const morceau = morceaux[i].trim();
    if (!morceau) continue;

    const estMentionAbsence = /^(?:absent\b|absence\b|indisponible\b)/i.test(morceau);
    if (estMentionAbsence) {
      const dateFinIso = extraireDateFinDepuisTexteAbsence(morceau);
      if (dateFinIso && dateFinIso < aujourdhuiIso) {
        continue;
      }
    }
    morceauxGardes.push(morceau);
  }

  return morceauxGardes.join(' • ');
}

/**
 * Synchronise les notes d'un joueur dans la colonne 7 d'Effectif :
 * Préserve les notes coach manuelles et intègre uniquement les absences encore actives.
 */
function synchroniserNotesAbsenceJoueur(noteActuelle, absencesJoueur, aujourdhuiIso) {
  const noteNettoyee = nettoyerNoteJoueurAbsences(noteActuelle, aujourdhuiIso);

  const notesCoach = noteNettoyee.split(/\s*(?:•|\n)\s*/).filter(function(m) {
    const clean = m.trim();
    if (!clean) return false;
    if (/^(?:absent\b|absence\b|indisponible\b)/i.test(clean) && extraireDateFinDepuisTexteAbsence(clean)) {
      return false;
    }
    return true;
  });

  (absencesJoueur || []).forEach(function(a) {
    const dDeb = String(a.dateDebut || '').trim();
    const dFin = String(a.dateFin || dDeb).trim();
    const rMotif = String(a.motif || 'Non renseigné').trim();
    if (!dDeb) return;
    const noteAbs = 'Absent ' + (dDeb === dFin || !dFin ? dDeb : ('du ' + dDeb + ' au ' + dFin)) + ' (' + rMotif + ')';
    if (notesCoach.indexOf(noteAbs) === -1) {
      notesCoach.push(noteAbs);
    }
  });

  return notesCoach.join(' • ');
}

/**
 * Purge toutes les absences dont la date de fin est strictement passée (< aujourd'hui).
 * Met à jour 'ABSENCES_JOUEURS' dans ScriptProperties et synchronise la colonne 7 d'Effectif.
 */
function purgerAbsencesTerminees(ssOpt) {
  const props = PropertiesService.getScriptProperties();
  const aujourdhuiIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'yyyy-MM-dd');

  let absences = [];
  try {
    const raw = props.getProperty('ABSENCES_JOUEURS');
    if (raw) absences = JSON.parse(raw);
  } catch (e) { absences = []; }

  let modifie = false;
  // Assurer que CHAQUE absence possède un ID unique (migration automatique des absences legacy)
  absences.forEach(function(a, idx) {
    if (!a.id) {
      a.id = 'abs_' + (a.nom ? String(a.nom).replace(/[^a-zA-Z0-9]/g, '_') : 'j') + '_' + (a.dateDebut || '').replace(/[^0-9]/g, '') + '_' + idx;
      modifie = true;
    }
  });

  const absencesActives = absences.filter(function(a) {
    const dFin = normaliserDateIsoAbsence(a.dateFin) || normaliserDateIsoAbsence(a.dateDebut);
    if (dFin && dFin < aujourdhuiIso) {
      modifie = true;
      return false;
    }
    return true;
  });

  if (modifie) {
    props.setProperty('ABSENCES_JOUEURS', JSON.stringify(absencesActives));
  }

  // Purger et synchroniser la feuille Effectif
  try {
    const ss = ssOpt || getSpreadsheet();
    const shEff = ss ? ss.getSheetByName('Effectif') : null;
    if (shEff && shEff.getLastRow() >= 2) {
      const nbLignes = shEff.getLastRow() - 1;
      const rangeNotes = shEff.getRange(2, 7, nbLignes, 1);
      const valsNotes = rangeNotes.getValues();
      const rangeIdent = shEff.getRange(2, 1, nbLignes, 2).getValues();
      let changementFeuille = false;

      const mapAbsParTel = {};
      const mapAbsParNom = {};
      absencesActives.forEach(function(a) {
        if (a.tel) {
          const tNorm = normaliserNumero(a.tel);
          if (!mapAbsParTel[tNorm]) mapAbsParTel[tNorm] = [];
          mapAbsParTel[tNorm].push(a);
        }
        if (a.nom) {
          const nClean = String(a.nom).toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();
          if (!mapAbsParNom[nClean]) mapAbsParNom[nClean] = [];
          mapAbsParNom[nClean].push(a);
        }
      });

      for (let i = 0; i < nbLignes; i++) {
        const noteActuelle = String(valsNotes[i][0] || '').trim();
        const nomLigne = String(rangeIdent[i][0] || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();
        const telLigne = normaliserNumero(dechiffrerNumero(rangeIdent[i][1]));

        const absJoueur = mapAbsParTel[telLigne] || mapAbsParNom[nomLigne] || [];
        const nouvelleNote = synchroniserNotesAbsenceJoueur(noteActuelle, absJoueur, aujourdhuiIso);

        if (nouvelleNote !== noteActuelle) {
          valsNotes[i][0] = nouvelleNote;
          changementFeuille = true;
        }
      }

      if (changementFeuille) {
        rangeNotes.setValues(valsNotes);
      }
    }
    if (ss) synchroniserOngletAbsencesSheet(ss);
  } catch (err) {
    Logger.log('Purge Effectif absences notice: ' + err.message);
  }

  return absencesActives;
}

/**
 * Déclare une absence à l'avance pour le joueur
 */
function declarerAbsenceJoueur(tel, pin, dateDebut, dateFin, motif, idAbsence) {
  const auth = authentifierUtilisateur(tel, pin);
  const ss = getSpreadsheet();
  const dDeb = String(dateDebut || '').trim();
  const dFin = String(dateFin || '').trim();
  const rMotif = String(motif || 'Non renseigné').trim();

  if (!dDeb) throw new Error('Veuillez indiquer au moins une date de début.');

  // Purge préalable des absences terminées
  let absences = purgerAbsencesTerminees(ss);

  const absId = idAbsence || ('abs_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000));
  let existante = false;
  for (let i = 0; i < absences.length; i++) {
    if (absences[i].id === absId) {
      absences[i].dateDebut = dDeb;
      absences[i].dateFin = dFin || dDeb;
      absences[i].motif = rMotif;
      existante = true;
      break;
    }
  }

  if (!existante) {
    absences.push({
      id: absId,
      nom: auth.nom,
      tel: auth.telephone,
      dateDebut: dDeb,
      dateFin: dFin || dDeb,
      motif: rMotif,
      creeLe: new Date().toISOString()
    });
  }

  PropertiesService.getScriptProperties().setProperty('ABSENCES_JOUEURS', JSON.stringify(absences));

  // Mettre à jour immédiatement la feuille Effectif
  const shEff = ss.getSheetByName('Effectif');
  if (shEff) {
    const aujourdhuiIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'yyyy-MM-dd');
    const rows = shEff.getDataRange().getValues();
    const telAuthNorm = normaliserNumero(auth.telephone);
    const nomAuthClean = String(auth.nom || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();

    for (let i = 1; i < rows.length; i++) {
      const telRow = normaliserNumero(dechiffrerNumero(rows[i][1]));
      const nomRow = String(rows[i][0] || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();

      if (telRow === telAuthNorm || (nomAuthClean && nomRow === nomAuthClean)) {
        const noteActuelle = String(rows[i][6] || '').trim();
        const absCeJoueur = absences.filter(function(a) {
          const tA = normaliserNumero(a.tel);
          const nA = String(a.nom || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();
          return (tA && tA === telAuthNorm) || (nA && nA === nomAuthClean);
        });
        const nouvelleNote = synchroniserNotesAbsenceJoueur(noteActuelle, absCeJoueur, aujourdhuiIso);
        shEff.getRange(i + 1, 7).setValue(nouvelleNote);
        break;
      }
    }
  }

  try { synchroniserOngletAbsencesSheet(ss); } catch (e) {}

  return { ok: true, absences: absences };
}

function supprimerAbsenceJoueur(tel, pin, idAbsence, fallbackNom, fallbackDebut, fallbackFin) {
  const auth = authentifierUtilisateur(tel, pin);
  const ss = getSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  let absences = [];
  try {
    const raw = props.getProperty('ABSENCES_JOUEURS');
    if (raw) absences = JSON.parse(raw);
  } catch (e) { absences = []; }

  const idCible = String(idAbsence || '').trim();
  const fNom = String(fallbackNom || '').trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, '');
  const fDeb = String(fallbackDebut || '').trim();
  const fFin = String(fallbackFin || '').trim();

  absences = absences.filter(function(a) {
    if (idCible && a.id && String(a.id) === idCible) return false;
    const aNomClean = String(a.nom || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();
    if (fNom && aNomClean === fNom) {
      if (fDeb && String(a.dateDebut || '').trim() === fDeb) return false;
      if (!fDeb && (idCible.indexOf(aNomClean) !== -1 || !a.id)) return false;
    }
    if (idCible && a.nom && idCible.indexOf(encodeURIComponent(String(a.nom).trim())) !== -1 && a.dateDebut && idCible.indexOf(String(a.dateDebut).trim()) !== -1) {
      return false;
    }
    return true;
  });

  props.setProperty('ABSENCES_JOUEURS', JSON.stringify(absences));

  // Mettre à jour immédiatement la feuille Effectif pour retirer l'absence
  const shEff = ss.getSheetByName('Effectif');
  if (shEff) {
    const aujourdhuiIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'yyyy-MM-dd');
    const rows = shEff.getDataRange().getValues();
    const telAuthNorm = normaliserNumero(auth.telephone);
    const nomAuthClean = String(auth.nom || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();

    for (let i = 1; i < rows.length; i++) {
      const telRow = normaliserNumero(dechiffrerNumero(rows[i][1]));
      const nomRow = String(rows[i][0] || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();

      if (telRow === telAuthNorm || (nomAuthClean && nomRow === nomAuthClean) || (fNom && nomRow === fNom)) {
        const noteActuelle = String(rows[i][6] || '').trim();
        const absCeJoueur = absences.filter(function(a) {
          const tA = normaliserNumero(a.tel);
          const nA = String(a.nom || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();
          return (tA && tA === telAuthNorm) || (nA && (nA === nomAuthClean || nA === fNom));
        });
        const nouvelleNote = synchroniserNotesAbsenceJoueur(noteActuelle, absCeJoueur, aujourdhuiIso);
        shEff.getRange(i + 1, 7).setValue(nouvelleNote);
        if (!fNom || nomRow === fNom) break;
      }
    }
  }

  try { synchroniserOngletAbsencesSheet(ss); } catch (e) {}

  return { ok: true, absences: absences };
}

/**
 * Récupère les absences des joueurs avec purge automatique des absences terminées
 * (Priorité : feuille Google Sheets "Absences")
 */
function getAbsencesJoueurs(ssOpt) {
  const ss = ssOpt || getSpreadsheet();
  if (ss) {
    try {
      const aSheet = lireAbsencesDepuisSheet(ss);
      if (aSheet && aSheet.length > 0) {
        // Associer les téléphones depuis Effectif si nécessaire
        try {
          const shEff = ss.getSheetByName('Effectif');
          if (shEff && shEff.getLastRow() >= 2) {
            const effRows = shEff.getRange(2, 1, shEff.getLastRow() - 1, 2).getValues();
            const mapTel = {};
            effRows.forEach(function(r) {
              const n = String(r[0] || '').toLowerCase().trim();
              const t = normaliserNumero(dechiffrerNumero(r[1]));
              if (n && t) mapTel[n] = t;
            });
            aSheet.forEach(function(a) {
              const nLow = String(a.nom || '').toLowerCase().trim();
              if (!a.tel && mapTel[nLow]) a.tel = mapTel[nLow];
            });
          }
        } catch (errEff) {}
        try {
          PropertiesService.getScriptProperties().setProperty('ABSENCES_JOUEURS', JSON.stringify(aSheet));
        } catch (e) {}
        return aSheet;
      }
    } catch (e) {}
  }

  const props = PropertiesService.getScriptProperties();
  try {
    const raw = props.getProperty('ABSENCES_JOUEURS');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(function(a, idx) {
          if (!a.id) a.id = 'abs_' + (a.nom ? String(a.nom).replace(/[^a-zA-Z0-9]/g, '_') : 'j') + '_' + (a.dateDebut || '').replace(/[^0-9]/g, '') + '_' + idx;
        });
        if (ss) {
          try { synchroniserOngletAbsencesSheet(ss, parsed); } catch (e) {}
        }
        return parsed;
      }
    }
  } catch (err) {}
  return [];
}

/**
 * Lit l'intégralité des absences directement depuis la feuille Google Sheets "Absences"
 */
function lireAbsencesDepuisSheet(ss) {
  try {
    const classeur = ss || getSpreadsheet();
    if (!classeur) return null;
    const sh = classeur.getSheetByName('Absences');
    if (!sh || sh.getLastRow() < 5) return null;

    const lastRow = sh.getLastRow();
    const rows = sh.getRange(5, 1, lastRow - 4, 8).getValues();
    const absences = [];

    rows.forEach(function(r) {
      const statut = String(r[0] || '').trim();
      const nom = String(r[1] || '').trim();
      const dDeb = normaliserDateIsoAbsence(r[2]);
      const dFin = normaliserDateIsoAbsence(r[3]) || dDeb;
      const motif = String(r[5] || '').trim();
      const creeLe = String(r[6] || '').trim();
      const id = String(r[7] || '').trim() || ('abs_' + (nom ? nom.replace(/[^a-zA-Z0-9]/g, '_') : 'j') + '_' + (dDeb || '').replace(/[^0-9]/g, ''));

      if (nom && dDeb && nom.toLowerCase().indexOf('aucune absence') === -1 && nom.toLowerCase().indexOf('total') === -1) {
        absences.push({
          id: id,
          nom: nom,
          tel: '',
          dateDebut: dDeb,
          dateFin: dFin,
          motif: motif || 'Non renseigné',
          creeLe: creeLe
        });
      }
    });

    return absences.length > 0 ? absences : null;
  } catch (e) {
    Logger.log('Erreur lireAbsencesDepuisSheet: ' + e.message);
    return null;
  }
}

/**
 * Synchronise et met en forme l'onglet "Absences" dans Google Sheets
 * Présente le tableau de toutes les indisponibilités déclarées par les joueurs
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - Le classeur Google Sheets (optionnel)
 * @param {Array} absencesOpt - Liste d'absences optionnelle à injecter
 * @return {Object} Résumé de la synchronisation
 */
function synchroniserOngletAbsencesSheet(ss, absencesOpt) {
  if (!ss) ss = getSpreadsheet();
  if (!ss) return { ok: false, error: 'Classeur introuvable' };

  let sh = ss.getSheetByName('Absences');
  if (!sh) {
    sh = ss.insertSheet('Absences');
  }
  try {
    sh.setTabColor('#38bdf8');
  } catch (e) {}

  sh.clear();

  let absences = absencesOpt;
  if (!absences) {
    absences = getAbsencesJoueurs(ss);
  }
  const horodatage = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'dd/MM/yyyy HH:mm');
  const aujourdhuiIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'yyyy-MM-dd');

  // Lignes 1-2 : Bannière Titre
  sh.getRange('A1:H1').merge()
    .setValue('📅 GESTION DES ABSENCES & INDISPONIBILITÉS DU CLUB')
    .setBackground('#0f172a')
    .setFontColor('#f8fafc')
    .setFontWeight('bold')
    .setFontSize(13)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);

  sh.getRange('A2:H2').merge()
    .setValue('Dernière synchronisation : ' + horodatage + ' • Synchronisé automatiquement depuis le Hub Joueur WebApp')
    .setBackground('#1e293b')
    .setFontColor('#94a3b8')
    .setFontStyle('italic')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(2, 22);

  const entetes = ['Statut', 'Joueur', 'Date Début', 'Date Fin', 'Période / Durée', 'Motif', 'Déclaré le', 'ID'];
  sh.getRange(4, 1, 1, 8).setValues([entetes])
    .setBackground('#0284c7')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10);
  sh.setRowHeight(4, 26);

  let curRow = 5;

  if (!absences || absences.length === 0) {
    sh.getRange(curRow, 1, 1, 8).merge()
      .setValue('Aucune absence déclarée pour le moment. (Déclaration disponible depuis le Hub Joueur de la WebApp)')
      .setFontColor('#64748b')
      .setFontStyle('italic')
      .setHorizontalAlignment('center');
    sh.setRowHeight(curRow, 24);
    curRow++;
  } else {
    const triees = absences.slice().sort(function(a, b) {
      return String(a.dateDebut || '').localeCompare(String(b.dateDebut || ''));
    });

    triees.forEach(function(a) {
      const dDeb = String(a.dateDebut || '').trim();
      const dFin = String(a.dateFin || dDeb).trim();
      const motif = String(a.motif || 'Non renseigné').trim();
      const nom = String(a.nom || 'Joueur').trim();

      let statut = '⏳ À venir';
      if (dDeb <= aujourdhuiIso && dFin >= aujourdhuiIso) {
        statut = '🔴 En cours';
      }

      let periode = (dDeb === dFin) ? ('Le ' + dDeb) : ('Du ' + dDeb + ' au ' + dFin);

      let dateCreation = '';
      if (a.creeLe) {
        try {
          const dC = new Date(a.creeLe);
          dateCreation = Utilities.formatDate(dC, Session.getScriptTimeZone() || 'Europe/Paris', 'dd/MM/yyyy HH:mm');
        } catch (e) {
          dateCreation = String(a.creeLe).split('T')[0];
        }
      }

      sh.getRange(curRow, 1, 1, 8).setValues([[
        statut,
        nom,
        dDeb,
        dFin,
        periode,
        motif,
        dateCreation,
        a.id || ''
      ]]);

      if (statut.indexOf('En cours') !== -1) {
        sh.getRange(curRow, 1, 1, 8).setBackground('#fef2f2');
      }
      sh.setRowHeight(curRow, 22);
      curRow++;
    });

    sh.getRange(curRow, 1, 1, 8).merge()
      .setValue('Total : ' + triees.length + ' absence(s) enregistrée(s)')
      .setFontSize(9)
      .setFontColor('#64748b')
      .setFontStyle('italic');
    curRow++;
  }

  try {
    sh.setColumnWidth(1, 110);
    sh.setColumnWidth(2, 160);
    sh.setColumnWidth(3, 110);
    sh.setColumnWidth(4, 110);
    sh.setColumnWidth(5, 180);
    sh.setColumnWidth(6, 200);
    sh.setColumnWidth(7, 140);
    sh.setColumnWidth(8, 120);
  } catch (e) {}

  return { ok: true, maj: horodatage, total: absences.length };
}

/**
 * =============================================================
 * PÉRIODES DE VACANCES & TRÊVES SPORTIVES
 * =============================================================
 */

/**
 * Retourne le calendrier standard des vacances scolaires de la saison (2026-2027)
 */
function getVacancesDefautSaison() {
  return [
    {
      id: 'vac_toussaint',
      nom: 'Vacances de la Toussaint',
      dateDebut: '2026-10-17',
      dateFin: '2026-11-02',
      actif: true,
      commentaire: 'Trêve automnale • Reprise le lundi 2 novembre'
    },
    {
      id: 'vac_noel',
      nom: 'Trêve de Noël & Nouvel An',
      dateDebut: '2026-12-19',
      dateFin: '2027-01-04',
      actif: true,
      commentaire: 'Fêtes de fin d\'année • Reprise début janvier'
    },
    {
      id: 'vac_hiver',
      nom: 'Vacances d\'Hiver (Février)',
      dateDebut: '2027-02-06',
      dateFin: '2027-02-22',
      actif: true,
      commentaire: 'Trêve hivernale'
    },
    {
      id: 'vac_printemps',
      nom: 'Vacances de Printemps (Pâques)',
      dateDebut: '2027-04-03',
      dateFin: '2027-04-19',
      actif: true,
      commentaire: 'Trêve printanière'
    },
    {
      id: 'vac_ete',
      nom: 'Trêve Estivale (Fin de Saison)',
      dateDebut: '2027-06-20',
      dateFin: '2027-08-31',
      actif: true,
      commentaire: 'Fin de saison officielle'
    }
  ];
}

/**
 * Formate une date au format français JJ/MM/AAAA
 */
function formaterDateFr(val) {
  const iso = normaliserDateIsoAbsence(val);
  if (!iso) return '';
  const parts = iso.split('-');
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

/**
 * Récupère la liste des périodes de vacances (Priorité : feuille Google Sheets "Vacances")
 */
function getVacancesClub(ss) {
  try {
    const classeur = ss || getSpreadsheet();
    if (classeur) {
      const vFromSheet = lireVacancesDepuisSheet(classeur);
      if (vFromSheet && vFromSheet.length > 0) {
        try {
          PropertiesService.getScriptProperties().setProperty('VACANCES_CONFIG_JSON', JSON.stringify(vFromSheet));
        } catch (e) {}
        return vFromSheet;
      }
    }
  } catch (e) {}

  const props = PropertiesService.getScriptProperties();
  try {
    const raw = props.getProperty('VACANCES_CONFIG_JSON');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {}

  const defVac = getVacancesDefautSaison();
  try {
    props.setProperty('VACANCES_CONFIG_JSON', JSON.stringify(defVac));
    const classeur = ss || getSpreadsheet();
    if (classeur) synchroniserOngletVacancesSheet(classeur, defVac);
  } catch (e) {}
  return defVac;
}

/**
 * Vérifie si une date précise tombe dans une période de vacances active
 */
function estDateEnVacances(date, ss) {
  try {
    const vacances = getVacancesClub(ss);
    if (!vacances || vacances.length === 0) return { enVacances: false };
    const iso = normaliserDateIsoAbsence(date);
    if (!iso) return { enVacances: false };

    for (let i = 0; i < vacances.length; i++) {
      const v = vacances[i];
      if (v.actif === false) continue;
      const deb = normaliserDateIsoAbsence(v.dateDebut);
      const fin = normaliserDateIsoAbsence(v.dateFin);
      if (deb && fin && iso >= deb && iso <= fin) {
        return {
          enVacances: true,
          nom: v.nom || 'Vacances',
          dateDebut: deb,
          dateFin: fin,
          debutTexte: formaterDateFr(deb),
          finTexte: formaterDateFr(fin),
          commentaire: v.commentaire || '',
          vacance: v
        };
      }
    }
  } catch (e) {}
  return { enVacances: false };
}

/**
 * Analyse une semaine complète (lundi à dimanche) pour déterminer si elle est en vacances
 */
function getInfoVacancesSemaine(lundi, dimanche, ss) {
  try {
    const vacances = getVacancesClub(ss);
    if (!vacances || vacances.length === 0) return { enVacances: false };

    const dLundi = new Date(lundi);
    dLundi.setHours(0, 0, 0, 0);
    const dDimanche = new Date(dimanche);
    dDimanche.setHours(23, 59, 59, 999);

    for (let i = 0; i < vacances.length; i++) {
      const v = vacances[i];
      if (v.actif === false) continue;
      const isoDeb = normaliserDateIsoAbsence(v.dateDebut);
      const isoFin = normaliserDateIsoAbsence(v.dateFin);
      if (!isoDeb || !isoFin) continue;

      const pD = isoDeb.split('-');
      const pF = isoFin.split('-');
      const dDeb = new Date(parseInt(pD[0], 10), parseInt(pD[1], 10) - 1, parseInt(pD[2], 10), 0, 0, 0);
      const dFin = new Date(parseInt(pF[0], 10), parseInt(pF[1], 10) - 1, parseInt(pF[2], 10), 23, 59, 59);

      if (dDimanche.getTime() >= dDeb.getTime() && dLundi.getTime() <= dFin.getTime()) {
        const debutOverlap = Math.max(dLundi.getTime(), dDeb.getTime());
        const finOverlap = Math.min(dDimanche.getTime(), dFin.getTime());
        const nbJours = Math.round((finOverlap - debutOverlap) / (1000 * 60 * 60 * 24)) + 1;

        if (nbJours >= 2 || dDeb.getTime() <= dLundi.getTime()) {
          return {
            enVacances: true,
            nom: v.nom || 'Vacances',
            dateDebut: isoDeb,
            dateFin: isoFin,
            debutTexte: formaterDateFr(isoDeb),
            finTexte: formaterDateFr(isoFin),
            commentaire: v.commentaire || '',
            vacance: v
          };
        }
      }
    }
  } catch (e) {
    Logger.log('Erreur getInfoVacancesSemaine : ' + e.message);
  }
  return { enVacances: false };
}

/**
 * Récupère le modèle de données complet pour la WebApp
 */
function getVacancesData(ss) {
  const classeur = ss || getSpreadsheet();
  const list = getVacancesClub(classeur);
  const now = new Date();
  const lundiEnCours = getLundiSemaineEnCours(now);
  const dimancheSemaine = new Date(lundiEnCours);
  dimancheSemaine.setDate(lundiEnCours.getDate() + 6);
  dimancheSemaine.setHours(23, 59, 59, 999);

  const infoSemaine = getInfoVacancesSemaine(lundiEnCours, dimancheSemaine, classeur);
  const infoAujourdhui = estDateEnVacances(now, classeur);

  return {
    periodes: list,
    enVacancesCetteSemaine: Boolean(infoSemaine && infoSemaine.enVacances),
    infoSemaine: infoSemaine,
    enVacancesAujourdhui: Boolean(infoAujourdhui && infoAujourdhui.enVacances),
    infoAujourdhui: infoAujourdhui
  };
}

/**
 * Synchronise et stylise l'onglet "Vacances" dans Google Sheets
 */
function synchroniserOngletVacancesSheet(ss, listeVacances) {
  if (!ss) ss = getSpreadsheet();
  if (!ss) return { ok: false, error: 'Classeur introuvable' };

  let sh = ss.getSheetByName('Vacances');
  if (!sh) {
    sh = ss.insertSheet('Vacances');
  }
  try {
    sh.setTabColor('#0ea5e9');
  } catch (e) {}

  sh.clear();

  const vacances = Array.isArray(listeVacances) ? listeVacances : getVacancesClub(ss);
  const horodatage = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'dd/MM/yyyy HH:mm');
  const aujourdhuiIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'yyyy-MM-dd');

  sh.getRange('A1:F1').merge()
    .setValue('🏖️ PÉRIODES DE VACANCES & TRÊVES SPORTIVES (Suspension auto des sondages & entraînements)')
    .setFontWeight('bold')
    .setFontSize(12)
    .setBackground('#0369a1')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);

  sh.getRange('A2:F2').merge()
    .setValue('Dernière synchronisation : ' + horodatage + ' • Les périodes cochées "OUI" suspendent automatiquement les entraînements, la recherche de matchs FFHB et l\'envoi du sondage WhatsApp.')
    .setFontSize(9)
    .setFontStyle('italic')
    .setBackground('#f0f9ff')
    .setFontColor('#0369a1')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(2, 24);

  const headers = ['Période / Intitulé', 'Date Début (JJ/MM/AAAA)', 'Date Fin (JJ/MM/AAAA)', 'Actif (OUI/NON)', 'Statut Actuel', 'Commentaire / Consignes'];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setFontSize(10)
    .setBackground('#1e293b')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(3, 28);

  if (vacances.length > 0) {
    const rows = vacances.map(function(v) {
      const dDebIso = normaliserDateIsoAbsence(v.dateDebut);
      const dFinIso = normaliserDateIsoAbsence(v.dateFin);
      const debFr = formaterDateFr(dDebIso);
      const finFr = formaterDateFr(dFinIso);
      const actifStr = (v.actif !== false) ? 'OUI' : 'NON';

      let statutStr = '⏳ À VENIR';
      if (v.actif === false) {
        statutStr = '⚪ DÉSACTIVÉE';
      } else if (aujourdhuiIso >= dDebIso && aujourdhuiIso <= dFinIso) {
        statutStr = '🏖️ EN COURS';
      } else if (aujourdhuiIso > dFinIso) {
        statutStr = '✔️ PASSÉE';
      }

      return [v.nom || 'Vacances', debFr, finFr, actifStr, statutStr, v.commentaire || ''];
    });

    sh.getRange(4, 1, rows.length, 6)
      .setValues(rows)
      .setFontSize(10)
      .setVerticalAlignment('middle');

    sh.getRange(4, 1, rows.length, 1).setHorizontalAlignment('left').setFontWeight('bold');
    sh.getRange(4, 2, rows.length, 2).setHorizontalAlignment('center');
    sh.getRange(4, 4, rows.length, 2).setHorizontalAlignment('center');
    sh.getRange(4, 6, rows.length, 1).setHorizontalAlignment('left');

    for (let r = 0; r < rows.length; r++) {
      const rowNum = 4 + r;
      sh.setRowHeight(rowNum, 26);
      const st = rows[r][4];
      if (st.indexOf('EN COURS') !== -1) {
        sh.getRange(rowNum, 1, 1, 6).setBackground('#ecfdf5');
      } else if (st.indexOf('DÉSACTIVÉE') !== -1) {
        sh.getRange(rowNum, 1, 1, 6).setFontColor('#94a3b8');
      }
    }

    const ruleOuiNon = SpreadsheetApp.newDataValidation()
      .requireValueInList(['OUI', 'NON'], true)
      .setAllowInvalid(false)
      .build();
    sh.getRange(4, 4, rows.length, 1).setDataValidation(ruleOuiNon);
  }

  sh.setColumnWidth(1, 240);
  sh.setColumnWidth(2, 140);
  sh.setColumnWidth(3, 140);
  sh.setColumnWidth(4, 110);
  sh.setColumnWidth(5, 130);
  sh.setColumnWidth(6, 260);

  return { ok: true, total: vacances.length };
}

/**
 * Lit les périodes de vacances directement depuis l'onglet "Vacances"
 */
function lireVacancesDepuisSheet(classeur) {
  try {
    const ss = classeur || getSpreadsheet();
    if (!ss) return [];
    const sh = ss.getSheetByName('Vacances');
    if (!sh || sh.getLastRow() < 4) return [];

    const values = sh.getRange(4, 1, sh.getLastRow() - 3, 6).getValues();
    const vacances = [];

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const nom = String(row[0] || '').trim();
      if (!nom) continue;
      const debIso = normaliserDateIsoAbsence(row[1]);
      const finIso = normaliserDateIsoAbsence(row[2]);
      if (!debIso || !finIso) continue;

      const actif = (String(row[3] || '').trim().toUpperCase() !== 'NON');
      const com = String(row[5] || '').trim();

      vacances.push({
        id: 'vac_' + i + '_' + debIso.replace(/[^0-9]/g, ''),
        nom: nom,
        dateDebut: debIso,
        dateFin: finIso,
        actif: actif,
        commentaire: com
      });
    }

    return vacances;
  } catch (e) {
    Logger.log('Erreur lireVacancesDepuisSheet : ' + e.message);
    return [];
  }
}

/**
 * Enregistre les périodes de vacances (RPC appelé depuis la WebApp coach)
 */
function enregistrerVacancesClub(telCoach, pinCoach, nouvellesVacances) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }

  if (!Array.isArray(nouvellesVacances)) {
    throw new Error('Format de données invalide pour les périodes de vacances.');
  }

  const valides = nouvellesVacances.map(function(v, idx) {
    const nom = String(v.nom || ('Période ' + (idx + 1))).trim();
    const debIso = normaliserDateIsoAbsence(v.dateDebut);
    const finIso = normaliserDateIsoAbsence(v.dateFin);
    if (!debIso || !finIso) {
      throw new Error('Dates invalides pour la période "' + nom + '".');
    }
    return {
      id: v.id || ('vac_' + Date.now() + '_' + idx),
      nom: nom,
      dateDebut: debIso,
      dateFin: finIso,
      actif: (v.actif !== false),
      commentaire: String(v.commentaire || '').trim()
    };
  });

  valides.sort(function(a, b) {
    return a.dateDebut.localeCompare(b.dateDebut);
  });

  PropertiesService.getScriptProperties().setProperty('VACANCES_CONFIG_JSON', JSON.stringify(valides));

  try {
    synchroniserOngletVacancesSheet(ss, valides);
  } catch (e) {
    Logger.log('Erreur synchronisation onglet Vacances : ' + e.message);
  }

  try {
    genererSondageHebdo();
  } catch (e) {}

  return { ok: true, count: valides.length, data: getVacancesData(ss) };
}

/**
 * Réinitialise les vacances avec le calendrier scolaire officiel
 */
function reinitialiserVacancesDefaut(telCoach, pinCoach) {
  const def = getVacancesDefautSaison();
  return enregistrerVacancesClub(telCoach, pinCoach, def);
}

/**
 * -------------------------------------------------------------
 * CAISSE NOIRE & AMENDES DE L'ÉQUIPE (GESTION & ADMINISTRATION)
 * -------------------------------------------------------------
 */

function getBaremeDefautCaisseNoire() {
  return [
    { id: 'b_retard_court', titre: '⏰ Retard entraînement (< 15 min)', montant: 1, categorie: 'Retard' },
    { id: 'b_retard_long', titre: '⏰ Retard entraînement (> 15 min)', montant: 2, categorie: 'Retard' },
    { id: 'b_retard_match', titre: '🚨 Retard match ou RDV d\'équipe', montant: 3, categorie: 'Retard' },
    { id: 'b_oubli_matos', titre: '🧦 Oubli équipement (maillot, gourde, serviette)', montant: 2, categorie: 'Matériel' },
    { id: 'b_telephone', titre: '📱 Téléphone qui sonne en causerie / vestiaire', montant: 2, categorie: 'Discipline' },
    { id: 'b_chevre', titre: '🐐 Élu Chèvre du match', montant: 2, categorie: 'Match' },
    { id: 'b_rouge', titre: '🟥 Carton rouge direct', montant: 5, categorie: 'Match' },
    { id: 'b_deux_min', titre: '✌️ Exclusion 2 min pour contestation', montant: 2, categorie: 'Match' },
    { id: 'b_pigeon', titre: '🕊️ Pigeon tiré (plafond / nuages)', montant: 1, categorie: 'Match' },
    { id: 'b_anniv', titre: '🎂 Oubli du pack ou gâteau d\'anniversaire', montant: 5, categorie: 'Convivialité' },
    { id: 'b_rangement', titre: '🧹 Oubli de rangement / tour de vestiaire', montant: 3, categorie: 'Discipline' },
    { id: 'b_troisieme_mt', titre: '🍻 Départ sans payer sa tournée / 3ème MT', montant: 2, categorie: 'Convivialité' }
  ];
}

/**
 * Récupère les données complètes de la Caisse Noire (Priorité : feuille Google Sheets "Caisse Noire")
 */
function getCaisseNoireData() {
  const ss = getSpreadsheet();
  let rawData = null;
  if (ss) {
    try {
      rawData = lireCaisseNoireDepuisSheet(ss);
    } catch (e) {}
  }

  if (!rawData) {
    const props = PropertiesService.getScriptProperties();
    try {
      const raw = props.getProperty('CAISSE_NOIRE_DATA');
      if (raw) rawData = JSON.parse(raw);
    } catch (e) {}
  }

  if (!rawData || typeof rawData !== 'object') {
    rawData = {
      config: {
        devise: '€',
        objectifCagnotte: 300,
        objectifDescription: 'Resto & Tournée de fin d\'année',
        moyenPaiement: 'Lydia / Espèces au vestiaire',
        bareme: getBaremeDefautCaisseNoire()
      },
      amendes: [],
      depenses: []
    };
  }

  if (!rawData.config) {
    rawData.config = {
      devise: '€',
      objectifCagnotte: 300,
      objectifDescription: 'Resto & Tournée de fin d\'année',
      moyenPaiement: 'Lydia / Espèces au vestiaire',
      bareme: getBaremeDefautCaisseNoire()
    };
  }
  if (!Array.isArray(rawData.config.bareme) || rawData.config.bareme.length === 0) {
    rawData.config.bareme = getBaremeDefautCaisseNoire();
  }

  let statutActuel = 'ouverte';
  try {
    const propSt = PropertiesService.getScriptProperties().getProperty('CAISSE_NOIRE_STATUT');
    if (propSt && ['ouverte', 'fermee', 'desactivee'].includes(propSt.toLowerCase())) {
      statutActuel = propSt.toLowerCase();
    } else {
      const stSheet = lireStatutCaisseDepuisSheet(ss);
      if (stSheet) statutActuel = stSheet;
    }
  } catch (e) {}

  if (!rawData.config.statut) {
    rawData.config.statut = statutActuel;
  }
  rawData.config.active = (rawData.config.statut !== 'desactivee');
  rawData.config.fermee = (rawData.config.statut === 'fermee');

  if (!Array.isArray(rawData.amendes)) rawData.amendes = [];
  if (!Array.isArray(rawData.depenses)) rawData.depenses = [];

  // Mettre à jour la feuille Caisse Noire si elle n'existe pas encore
  if (ss) {
    try {
      const sh = ss.getSheetByName('Caisse Noire');
      if (!sh || sh.getLastRow() < 5) {
        synchroniserOngletCaisseNoireSheet(ss, rawData);
      }
    } catch (e) {}
  }

  // Calcul des statistiques en temps réel
  let totalCollecte = 0;
  let totalDu = 0;
  let totalDepenses = 0;
  let totalEnAttente = 0;
  let nbAmendesValidees = 0;
  const dicoJoueurs = {};

  rawData.amendes.forEach(function(a) {
    const mnt = Number(a.montant) || 0;
    const nom = String(a.nomJoueur || '').trim();
    if (!dicoJoueurs[nom]) {
      dicoJoueurs[nom] = { nom: nom, totalAmendes: 0, totalPaye: 0, totalDu: 0, nbAmendes: 0 };
    }

    if (a.statut === 'paye') {
      totalCollecte += mnt;
      nbAmendesValidees++;
      dicoJoueurs[nom].totalAmendes += mnt;
      dicoJoueurs[nom].totalPaye += mnt;
      dicoJoueurs[nom].nbAmendes++;
    } else if (a.statut === 'impaye') {
      totalDu += mnt;
      nbAmendesValidees++;
      dicoJoueurs[nom].totalAmendes += mnt;
      dicoJoueurs[nom].totalDu += mnt;
      dicoJoueurs[nom].nbAmendes++;
    } else if (a.statut === 'en_attente') {
      totalEnAttente++;
    }
  });

  rawData.depenses.forEach(function(d) {
    totalDepenses += (Number(d.montant) || 0);
  });

  const soldeCaisse = totalCollecte - totalDepenses;

  const leaderboard = Object.values(dicoJoueurs).sort(function(x, y) {
    return (y.totalAmendes - x.totalAmendes) || (y.totalDu - x.totalDu);
  });

  return {
    config: rawData.config,
    amendes: rawData.amendes,
    depenses: rawData.depenses,
    stats: {
      totalCollecte: Math.round(totalCollecte * 100) / 100,
      totalDu: Math.round(totalDu * 100) / 100,
      totalDepenses: Math.round(totalDepenses * 100) / 100,
      soldeCaisse: Math.round(soldeCaisse * 100) / 100,
      totalEnAttente: totalEnAttente,
      nbAmendes: nbAmendesValidees
    },
    leaderboard: leaderboard
  };
}

/**
 * Permet à un joueur de s'auto-déclarer ou de signaler un coéquipier (La Balance)
 */
function signalerAmendeJoueur(tel, pin, nomCoupable, motif, montant, commentaire) {
  const auth = authentifierUtilisateur(tel, pin);
  const ss = getSpreadsheet();
  const dataCaisse = getCaisseNoireData();
  const cfgCaisse = (dataCaisse && dataCaisse.config) || {};
  const statutCaisse = cfgCaisse.statut || (cfgCaisse.active === false ? 'desactivee' : (cfgCaisse.fermee ? 'fermee' : 'ouverte'));
  if (statutCaisse === 'desactivee') {
    throw new Error('La Caisse Noire n\'est pas activée pour cette équipe.');
  }
  if (statutCaisse === 'fermee' && !auth.estCoach && !auth.estTresorier) {
    throw new Error('La Caisse Noire est actuellement fermée par le coach. Les nouveaux signalements sont suspendus.');
  }
  const cleanCoupable = String(nomCoupable || '').trim();
  const cleanMotif = String(motif || 'Non renseigné').trim();
  const valMontant = Math.max(0.5, Number(montant) || 1);
  const cleanCommentaire = String(commentaire || '').trim();

  if (!cleanCoupable) throw new Error('Veuillez indiquer le joueur concerné.');

  let currentData = dataCaisse || {};
  if (!Array.isArray(currentData.amendes)) currentData.amendes = [];

  const nouvelleAmende = {
    id: 'am_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000),
    nomJoueur: cleanCoupable,
    motif: cleanMotif,
    montant: valMontant,
    date: new Date().toISOString().split('T')[0],
    statut: auth.estCoach ? 'impaye' : 'en_attente',
    signalePar: auth.nom,
    commentaire: cleanCommentaire,
    payeLe: null,
    modePaiement: null
  };

  currentData.amendes.unshift(nouvelleAmende);

  try {
    PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
  } catch (e) {}

  if (ss) {
    try { synchroniserOngletCaisseNoireSheet(ss, currentData); } catch (e) {}
  }

  return { ok: true, amende: nouvelleAmende, data: getCaisseNoireData() };
}

/**
 * Permet au coach/trésorier d'infliger une amende directement à un ou plusieurs joueurs
 */
function infligerAmendeAdmin(telCoach, pinCoach, nomsJoueurs, motif, montant, estPaye, modePaiement, commentaire) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuTresorier(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }

  const listeNoms = Array.isArray(nomsJoueurs) ? nomsJoueurs : [nomsJoueurs];
  const cleanNoms = listeNoms.map(function(n) { return String(n || '').trim(); }).filter(Boolean);
  if (cleanNoms.length === 0) throw new Error('Veuillez sélectionner au moins un joueur.');

  const cleanMotif = String(motif || 'Amende').trim();
  const valMontant = Math.max(0.5, Number(montant) || 1);
  const paye = Boolean(estPaye);
  const mode = paye ? String(modePaiement || 'Espèces').trim() : null;
  const dateStr = new Date().toISOString().split('T')[0];

  let currentData = getCaisseNoireData() || {};
  if (!Array.isArray(currentData.amendes)) currentData.amendes = [];

  cleanNoms.forEach(function(nom) {
    currentData.amendes.unshift({
      id: 'am_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000),
      nomJoueur: nom,
      motif: cleanMotif,
      montant: valMontant,
      date: dateStr,
      statut: paye ? 'paye' : 'impaye',
      signalePar: 'Coach / Trésorier',
      commentaire: String(commentaire || '').trim(),
      payeLe: paye ? dateStr : null,
      modePaiement: mode
    });
  });

  try {
    PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
  } catch (e) {}

  if (ss) {
    try { synchroniserOngletCaisseNoireSheet(ss, currentData); } catch (e) {}
  }

  return { ok: true, data: getCaisseNoireData() };
}

/**
 * Permet au coach/trésorier de valider ou refuser une amende signalée par un joueur
 */
function validerAmendeSignalee(telCoach, pinCoach, amendeId, action) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuTresorier(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }

  let currentData = getCaisseNoireData() || {};
  if (!currentData || !Array.isArray(currentData.amendes)) throw new Error('Aucune donnée trouvée.');

  const idx = currentData.amendes.findIndex(function(a) { return a.id === amendeId; });
  if (idx === -1) throw new Error('Amende introuvable.');

  if (action === 'valider') {
    currentData.amendes[idx].statut = 'impaye';
  } else if (action === 'rejeter') {
    currentData.amendes.splice(idx, 1);
  }

  try {
    PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
  } catch (e) {}

  if (ss) {
    try { synchroniserOngletCaisseNoireSheet(ss, currentData); } catch (e) {}
  }

  return { ok: true, data: getCaisseNoireData() };
}

/**
 * Permet au coach/trésorier d'enregistrer le paiement / encaissement d'amendes
 */
function encaisserAmendesAdmin(telCoach, pinCoach, amendeIds, modePaiement) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuTresorier(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }

  const ids = Array.isArray(amendeIds) ? amendeIds : [amendeIds];
  const mode = String(modePaiement || 'Espèces').trim();
  const dateStr = new Date().toISOString().split('T')[0];

  let currentData = getCaisseNoireData() || {};
  if (!currentData || !Array.isArray(currentData.amendes)) throw new Error('Aucune donnée trouvée.');

  currentData.amendes.forEach(function(a) {
    if (ids.indexOf(a.id) !== -1) {
      a.statut = 'paye';
      a.payeLe = dateStr;
      a.modePaiement = mode;
    }
  });

  try {
    PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
  } catch (e) {}

  if (ss) {
    try { synchroniserOngletCaisseNoireSheet(ss, currentData); } catch (e) {}
  }

  return { ok: true, data: getCaisseNoireData() };
}

/**
 * Permet d'enregistrer une dépense de la caisse (ex: tournées, bières, pizzas)
 */
function enregistrerDepenseCaisse(telCoach, pinCoach, motif, montant) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuTresorier(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }

  const cleanMotif = String(motif || 'Dépense équipe').trim();
  const valMontant = Math.max(0.5, Number(montant) || 0);

  let currentData = getCaisseNoireData() || {};
  if (!Array.isArray(currentData.depenses)) currentData.depenses = [];

  currentData.depenses.unshift({
    id: 'dep_' + new Date().getTime(),
    motif: cleanMotif,
    montant: valMontant,
    date: new Date().toISOString().split('T')[0],
    enregistrePar: 'Coach / Trésorier'
  });

  try {
    PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
  } catch (e) {}

  if (ss) {
    try { synchroniserOngletCaisseNoireSheet(ss, currentData); } catch (e) {}
  }

  return { ok: true, data: getCaisseNoireData() };
}

/**
 * Permet de supprimer une amende définitivement
 */
function supprimerAmendeAdmin(telCoach, pinCoach, amendeId) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuTresorier(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }

  let currentData = getCaisseNoireData() || {};
  if (!currentData || !Array.isArray(currentData.amendes)) throw new Error('Aucune donnée trouvée.');

  currentData.amendes = currentData.amendes.filter(function(a) { return a.id !== amendeId; });

  try {
    PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
  } catch (e) {}

  if (ss) {
    try { synchroniserOngletCaisseNoireSheet(ss, currentData); } catch (e) {}
  }

  return { ok: true, data: getCaisseNoireData() };
}

/**
 * Permet de mettre à jour la configuration de la Caisse Noire (barème, objectif, instructions de paiement)
 */
function enregistrerConfigCaisseNoire(telCoach, pinCoach, nouvelleConfig) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuTresorier(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }

  let currentData = getCaisseNoireData() || {};

  if (nouvelleConfig && nouvelleConfig.statut) {
    const stValide = ['ouverte', 'fermee', 'desactivee'].includes(nouvelleConfig.statut) ? nouvelleConfig.statut : 'ouverte';
    try {
      PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_STATUT', stValide);
    } catch (e) {}
    nouvelleConfig.statut = stValide;
    nouvelleConfig.active = (stValide !== 'desactivee');
    nouvelleConfig.fermee = (stValide === 'fermee');
    try {
      synchroniserStatutCaisseSheet(ss, stValide);
    } catch (e) {}
  }

  currentData.config = nouvelleConfig;

  try {
    PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
  } catch (e) {}

  if (ss) {
    try { synchroniserOngletCaisseNoireSheet(ss, currentData); } catch (e) {}
  }

  return { ok: true, data: getCaisseNoireData() };
}

/**
 * Modifie directement le statut de la Caisse Noire ('ouverte', 'fermee', 'desactivee')
 */
function changerStatutCaisseNoire(telCoach, pinCoach, nouveauStatut) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuTresorier(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }
  const statutValide = ['ouverte', 'fermee', 'desactivee'].includes(nouveauStatut) ? nouveauStatut : 'ouverte';

  try {
    PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_STATUT', statutValide);
  } catch (e) {}

  let currentData = getCaisseNoireData() || {};
  if (!currentData.config) {
    currentData.config = {
      devise: '€',
      objectifCagnotte: 300,
      objectifDescription: 'Resto & Tournée de fin d\'année',
      moyenPaiement: 'Lydia / Espèces au vestiaire',
      bareme: getBaremeDefautCaisseNoire()
    };
  }
  currentData.config.statut = statutValide;
  currentData.config.active = (statutValide !== 'desactivee');
  currentData.config.fermee = (statutValide === 'fermee');

  try {
    PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
  } catch (e) {}

  try {
    synchroniserStatutCaisseSheet(ss, statutValide);
  } catch (e) {}

  if (ss) {
    try { synchroniserOngletCaisseNoireSheet(ss, currentData); } catch (e) {}
  }

  return { ok: true, statut: statutValide, data: getCaisseNoireData() };
}

/**
 * Réinitialise ou clôture la Caisse Noire pour une nouvelle saison / période
 */
function reinitialiserCaisseNoire(telCoach, pinCoach) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuTresorier(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }

  let currentData = getCaisseNoireData() || {};
  const configActuelle = (currentData && currentData.config) ? currentData.config : {
    devise: '€',
    objectifCagnotte: 300,
    objectifDescription: 'Resto & Tournée de fin d\'année',
    moyenPaiement: 'Lydia / Espèces au vestiaire',
    bareme: getBaremeDefautCaisseNoire()
  };

  const clean = {
    config: configActuelle,
    amendes: [],
    depenses: []
  };

  try {
    PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_DATA', JSON.stringify(clean));
  } catch (e) {}

  if (ss) {
    try { synchroniserOngletCaisseNoireSheet(ss, clean); } catch (e) {}
  }

  return { ok: true, data: getCaisseNoireData() };
}

/**
 * Synchronise et met en forme l'onglet "Caisse Noire" dans Google Sheets
 */
function synchroniserOngletCaisseNoireSheet(ss, rawDataOpt) {
  if (!ss) ss = getSpreadsheet();
  if (!ss) return { ok: false, error: 'Classeur introuvable' };

  let sh = ss.getSheetByName('Caisse Noire');
  if (!sh) {
    sh = ss.insertSheet('Caisse Noire');
  }
  try {
    sh.setTabColor('#10b981');
  } catch (e) {}

  sh.clear();

  let rawData = rawDataOpt;
  if (!rawData) {
    rawData = getCaisseNoireData();
  }
  if (!rawData || typeof rawData !== 'object') {
    rawData = { config: {}, amendes: [], depenses: [] };
  }

  const amendes = Array.isArray(rawData.amendes) ? rawData.amendes : [];
  const depenses = Array.isArray(rawData.depenses) ? rawData.depenses : [];
  const bareme = (rawData.config && Array.isArray(rawData.config.bareme) && rawData.config.bareme.length > 0)
    ? rawData.config.bareme
    : getBaremeDefautCaisseNoire();

  const cfg = rawData.config || {};
  let statut = cfg.statut || (cfg.active === false ? 'desactivee' : (cfg.fermee ? 'fermee' : 'ouverte'));

  let totalCollecte = 0;
  let totalDu = 0;
  let totalDepenses = 0;
  amendes.forEach(function(a) {
    const m = Number(a.montant) || 0;
    if (a.statut === 'paye') totalCollecte += m;
    else if (a.statut === 'impaye') totalDu += m;
  });
  depenses.forEach(function(d) {
    totalDepenses += (Number(d.montant) || 0);
  });
  const solde = totalCollecte - totalDepenses;
  const obj = cfg.objectifCagnotte || 300;
  const objDesc = cfg.objectifDescription || 'Resto & Tournée de fin d\'année';

  const horodatage = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'dd/MM/yyyy HH:mm');

  // Ligne 1 : Bannière Titre (A1:U1)
  sh.getRange('A1:U1').merge()
    .setValue('💰 CAISSE NOIRE & GESTION DES AMENDES DU CLUB')
    .setBackground('#0f172a')
    .setFontColor('#f8fafc')
    .setFontWeight('bold')
    .setFontSize(13)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);

  // Ligne 2 : KPI Bar (A2:U2)
  const statutLabel = statut === 'desactivee' ? '⚪ DÉSACTIVÉE' : (statut === 'fermee' ? '🔒 FERMÉE' : '🟢 OUVERTE');
  const kpiText = 'Statut : ' + statutLabel + ' • Total collecté : ' + totalCollecte.toFixed(2) + ' € • Reste dû : ' + totalDu.toFixed(2) + ' € • Dépenses : ' + totalDepenses.toFixed(2) + ' € • Solde caisse : ' + solde.toFixed(2) + ' € • Objectif : ' + obj + ' € (' + objDesc + ') • Maj : ' + horodatage;
  sh.getRange('A2:U2').merge()
    .setValue(kpiText)
    .setBackground('#1e293b')
    .setFontColor('#94a3b8')
    .setFontStyle('italic')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(2, 22);

  // Ligne 4 : En-têtes de sections
  sh.getRange('A4:J4').merge()
    .setValue('📋 1. HISTORIQUE DES AMENDES & SIGNALEMENTS')
    .setBackground('#059669')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setVerticalAlignment('middle');
  sh.setRowHeight(4, 28);

  sh.getRange('L4:O4').merge()
    .setValue('⚖️ 2. BARÈME OFFICIEL DES AMENDES')
    .setBackground('#0f766e')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setVerticalAlignment('middle');

  sh.getRange('Q4:U4').merge()
    .setValue('🧾 3. DÉPENSES DE LA CAGNOTTE')
    .setBackground('#b45309')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setVerticalAlignment('middle');

  // Ligne 5 : Colonnes
  const entetesAm = ['ID Amende', 'Date', 'Joueur', 'Motif', 'Montant (€)', 'Statut', 'Signalé par', 'Mode Paiement', 'Date Paiement', 'Commentaire'];
  sh.getRange(5, 1, 1, 10).setValues([entetesAm])
    .setBackground('#047857')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10);

  const entetesBar = ['ID Barème', 'Titre / Motif', 'Montant (€)', 'Catégorie'];
  sh.getRange(5, 12, 1, 4).setValues([entetesBar])
    .setBackground('#115e59')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10);

  const entetesDep = ['ID Dépense', 'Date', 'Description / Motif', 'Montant (€)', 'Enregistré par'];
  sh.getRange(5, 17, 1, 5).setValues([entetesDep])
    .setBackground('#92400e')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10);
  sh.setRowHeight(5, 24);

  // Écriture des données
  // 1. Amendes (Lignes 6+)
  if (amendes.length === 0) {
    sh.getRange(6, 1, 1, 10).merge()
      .setValue('Aucune amende enregistrée pour le moment.')
      .setFontColor('#64748b')
      .setFontStyle('italic')
      .setHorizontalAlignment('center');
  } else {
    const lignesAm = amendes.map(function(a) {
      let stBadge = '⏳ En attente';
      if (a.statut === 'paye') stBadge = '🟢 Payé';
      else if (a.statut === 'impaye') stBadge = '🔴 Impayé';
      return [
        a.id || '',
        a.date || '',
        a.nomJoueur || '',
        a.motif || '',
        Number(a.montant) || 0,
        stBadge,
        a.signalePar || '',
        a.modePaiement || '',
        a.payeLe || '',
        a.commentaire || ''
      ];
    });
    sh.getRange(6, 1, lignesAm.length, 10).setValues(lignesAm);
    for (let r = 0; r < lignesAm.length; r++) {
      sh.setRowHeight(6 + r, 22);
      const st = amendes[r].statut;
      if (st === 'paye') sh.getRange(6 + r, 1, 1, 10).setBackground('#f0fdf4');
      else if (st === 'impaye') sh.getRange(6 + r, 1, 1, 10).setBackground('#fef2f2');
      else sh.getRange(6 + r, 1, 1, 10).setBackground('#fffbeb');
    }
  }

  // 2. Barème (Lignes 6+, Cols L à O = 12 à 15)
  if (bareme.length > 0) {
    const lignesBar = bareme.map(function(b) {
      return [b.id || '', b.titre || '', Number(b.montant) || 0, b.categorie || ''];
    });
    sh.getRange(6, 12, lignesBar.length, 4).setValues(lignesBar);
    for (let r = 0; r < lignesBar.length; r++) {
      sh.getRange(6 + r, 12, 1, 4).setBackground('#f0fdfa');
    }
  }

  // 3. Dépenses (Lignes 6+, Cols Q à U = 17 à 21)
  if (depenses.length > 0) {
    const lignesDep = depenses.map(function(d) {
      return [d.id || '', d.date || '', d.motif || '', Number(d.montant) || 0, d.enregistrePar || ''];
    });
    sh.getRange(6, 17, lignesDep.length, 5).setValues(lignesDep);
    for (let r = 0; r < lignesDep.length; r++) {
      sh.getRange(6 + r, 17, 1, 5).setBackground('#fffbeb');
    }
  }

  try {
    sh.setColumnWidth(1, 110); // ID
    sh.setColumnWidth(2, 90);  // Date
    sh.setColumnWidth(3, 140); // Joueur
    sh.setColumnWidth(4, 200); // Motif
    sh.setColumnWidth(5, 90);  // Montant
    sh.setColumnWidth(6, 110); // Statut
    sh.setColumnWidth(7, 130); // Signalé par
    sh.setColumnWidth(8, 110); // Mode
    sh.setColumnWidth(9, 100); // Date payé
    sh.setColumnWidth(10, 180); // Commentaire
    sh.setColumnWidth(11, 20); // Séparateur
    sh.setColumnWidth(12, 110); // ID Barème
    sh.setColumnWidth(13, 230); // Titre
    sh.setColumnWidth(14, 90);  // Montant
    sh.setColumnWidth(15, 120); // Catégorie
    sh.setColumnWidth(16, 20); // Séparateur
    sh.setColumnWidth(17, 100); // ID Dépense
    sh.setColumnWidth(18, 90);  // Date
    sh.setColumnWidth(19, 200); // Motif
    sh.setColumnWidth(20, 90);  // Montant
    sh.setColumnWidth(21, 130); // Enregistré par
  } catch (e) {}

  return { ok: true, maj: horodatage, nbAmendes: amendes.length };
}

/**
 * Lit l'intégralité des données de Caisse Noire depuis l'onglet Caisse Noire
 */
function lireCaisseNoireDepuisSheet(ss) {
  try {
    const classeur = ss || getSpreadsheet();
    if (!classeur) return null;
    const sh = classeur.getSheetByName('Caisse Noire');
    if (!sh || sh.getLastRow() < 5) return null;

    const maxRow = sh.getLastRow();
    const nbLignes = maxRow - 5;
    if (nbLignes <= 0) return null;

    // Statut depuis ligne 2 ou Configuration
    let statut = lireStatutCaisseDepuisSheet(classeur) || 'ouverte';

    // 1. Amendes (Cols A à J = 1 à 10)
    const amendes = [];
    const valsAm = sh.getRange(6, 1, nbLignes, 10).getValues();
    valsAm.forEach(function(r) {
      const id = String(r[0] || '').trim();
      const nom = String(r[2] || '').trim();
      const motif = String(r[3] || '').trim();
      if (!nom || id.toLowerCase().indexOf('aucune') !== -1) return;

      const mnt = parseFloat(r[4]) || 1;
      const stRaw = String(r[5] || '').toLowerCase();
      let st = 'impaye';
      if (stRaw.indexOf('🟢') !== -1 || stRaw.indexOf('payé') !== -1 || stRaw.indexOf('paye') !== -1) st = 'paye';
      else if (stRaw.indexOf('⏳') !== -1 || stRaw.indexOf('attente') !== -1) st = 'en_attente';

      amendes.push({
        id: id || ('am_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000)),
        date: normaliserDateIsoAbsence(r[1]) || new Date().toISOString().split('T')[0],
        nomJoueur: nom,
        motif: motif || 'Amende',
        montant: mnt,
        statut: st,
        signalePar: String(r[6] || 'Coach').trim(),
        modePaiement: String(r[7] || '').trim() || null,
        payeLe: normaliserDateIsoAbsence(r[8]) || null,
        commentaire: String(r[9] || '').trim()
      });
    });

    // 2. Barème (Cols L à O = 12 à 15)
    const bareme = [];
    const valsBar = sh.getRange(6, 12, nbLignes, 4).getValues();
    valsBar.forEach(function(r) {
      const id = String(r[0] || '').trim();
      const tit = String(r[1] || '').trim();
      if (!tit) return;
      bareme.push({
        id: id || ('b_' + tit.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()),
        titre: tit,
        montant: parseFloat(r[2]) || 1,
        categorie: String(r[3] || 'Général').trim()
      });
    });

    // 3. Dépenses (Cols Q à U = 17 à 21)
    const depenses = [];
    const valsDep = sh.getRange(6, 17, nbLignes, 5).getValues();
    valsDep.forEach(function(r) {
      const id = String(r[0] || '').trim();
      const mot = String(r[2] || '').trim();
      if (!mot) return;
      depenses.push({
        id: id || ('dep_' + new Date().getTime()),
        date: normaliserDateIsoAbsence(r[1]) || new Date().toISOString().split('T')[0],
        motif: mot,
        montant: parseFloat(r[3]) || 0,
        enregistrePar: String(r[4] || 'Coach').trim()
      });
    });

    return {
      config: {
        devise: '€',
        objectifCagnotte: 300,
        objectifDescription: 'Resto & Tournée de fin d\'année',
        moyenPaiement: 'Lydia / Espèces au vestiaire',
        bareme: bareme.length > 0 ? bareme : getBaremeDefautCaisseNoire(),
        statut: statut,
        active: (statut !== 'desactivee'),
        fermee: (statut === 'fermee')
      },
      amendes: amendes,
      depenses: depenses
    };
  } catch (e) {
    Logger.log('Erreur lireCaisseNoireDepuisSheet: ' + e.message);
    return null;
  }
}

/**
 * Permet au coach ou trésorier d'ajouter un nouveau joueur dans l'onglet Effectif
 */
function ajouterJoueurParCoach(telCoach, pinCoach, joueurData) {
  const ss = getSpreadsheet();
  const telNorm = normaliserNumero(telCoach);
  const pinNorm = String(pinCoach || '').trim();
  if (!verifierDroitsCoachOuTresorier(ss, telNorm, pinNorm)) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }
  const estVraiCoach = verifierDroitsCoachOuDev(ss, telNorm, pinNorm);
  if (!joueurData || !joueurData.nom) throw new Error('Veuillez renseigner le nom du joueur.');

  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) throw new Error('Onglet Effectif introuvable.');

  const nomNettoye = String(joueurData.nom).replace(/\s*\([^)]*\)\s*/g, '').trim();
  if (!nomNettoye) throw new Error('Nom de joueur invalide.');

  const rows = shEff.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const nomExistant = String(rows[i][0] || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
    if (nomExistant.toLowerCase() === nomNettoye.toLowerCase()) {
      throw new Error('Un joueur avec le nom "' + nomNettoye + '" existe déjà dans l\'effectif.');
    }
  }

  const telNormalise = normaliserNumero(joueurData.tel || '');
  const poste = String(joueurData.poste || 'Demi-Centre').trim();
  const equipe = String(joueurData.equipe || 'Équipe 1').trim();
  let photo = String(joueurData.photo || '').trim();
  if (photo.indexOf('data:image/') === 0) {
    try {
      const parts = photo.split(',');
      const mime = parts[0].match(/:(.*?);/)[1];
      const decoded = Utilities.base64Decode(parts[1]);
      const nomFichier = 'photo_' + nomNettoye.replace(/\s+/g, '_') + '_' + new Date().getTime();
      const blob = Utilities.newBlob(decoded, mime, nomFichier);
      const fichier = DriveApp.createFile(blob);
      fichier.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photo = fichier.getUrl();
    } catch (e) {}
  }
  const pin = String(joueurData.pin || ('0000' + Math.floor(Math.random() * 9000 + 1000)).slice(-4));
  const note = String(joueurData.note || '').trim();
  const estTresorier = (joueurData.estTresorier && estVraiCoach) ? 'OUI' : 'NON';
  const estChouchou = (joueurData.estChouchou && estVraiCoach) ? 'OUI' : 'NON';
  const idSpakta = String(joueurData.idSpakta || '').trim();

  try {
    if (!shEff.getRange('J1').getValue()) {
      shEff.getRange('J1').setValue('ID Spakta').setFontWeight('bold');
    }
  } catch (eH) {}

  shEff.appendRow([nomNettoye, telNormalise ? chiffrerNumero(telNormalise) : '', poste, equipe, photo, pin, note, estTresorier, estChouchou, idSpakta]);
  try { synchroniserTresoriersEtChouchouxSheet(ss, 'effectif'); } catch (e) {}

  // Ajouter également dans Votes_Semaine pour qu'il apparaisse dans les disponibilités
  const cfg = getClubConfig(ss);
  const shVotes = ss.getSheetByName('Votes_Semaine');
  if (shVotes) {
    if (cfg.nbEquipes === 1) {
      shVotes.appendRow([nomNettoye, poste, 0, 'NON', 'NON', 'NON', 'NON']);
    } else if (cfg.nbEquipes === 3) {
      shVotes.appendRow([nomNettoye, poste, 0, 'NON', 'NON', 'NON', 'NON', 'NON', 'NON']);
    } else {
      shVotes.appendRow([nomNettoye, poste, 0, 'NON', 'NON', 'NON', 'NON', 'NON']);
    }
  }

  return {
    ok: true,
    joueur: {
      nom: nomNettoye,
      tel: telNormalise,
      poste: poste,
      equipe: equipe,
      photo: convertirUrlPhoto(photo),
      pin: pin,
      note: note,
      estTresorier: (estTresorier === 'OUI'),
      estChouchou: (estChouchou === 'OUI'),
      idSpakta: idSpakta
    }
  };
}

/**
 * Permet au coach ou trésorier de supprimer un joueur de l'effectif
 */
function supprimerJoueurParCoach(telCoach, pinCoach, nomJoueur) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuTresorier(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }
  const nomCible = String(nomJoueur || '').replace(/\s*\([^)]*\)\s*/g, '').trim().toLowerCase();
  if (!nomCible) throw new Error('Nom de joueur non spécifié.');

  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) throw new Error('Onglet Effectif introuvable.');

  const rows = shEff.getDataRange().getValues();
  let trouve = false;
  for (let i = rows.length - 1; i >= 1; i--) {
    const nomExistant = String(rows[i][0] || '').replace(/\s*\([^)]*\)\s*/g, '').trim().toLowerCase();
    if (nomExistant === nomCible) {
      shEff.deleteRow(i + 1);
      trouve = true;
      try { synchroniserTresoriersEtChouchouxSheet(ss, 'effectif'); } catch (e) {}
      break;
    }
  }

  const shVotes = ss.getSheetByName('Votes_Semaine');
  if (shVotes && shVotes.getLastRow() > 1) {
    const rowsV = shVotes.getDataRange().getValues();
    for (let k = rowsV.length - 1; k >= 1; k--) {
      const nomV = String(rowsV[k][0] || '').trim().toLowerCase();
      if (nomV === nomCible) {
        shVotes.deleteRow(k + 1);
        break;
      }
    }
  }

  if (!trouve) throw new Error('Joueur introuvable dans l\'effectif.');
  return { ok: true, nom: nomJoueur };
}

/**
 * Permet au coach de modifier la configuration des équipes (1 à 3 équipes)
 */
function enregistrerConfigEquipes(telCoach, pinCoach, configEquipes) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  if (!configEquipes || !configEquipes.nbEquipes) {
    throw new Error('Configuration des équipes invalide.');
  }

  const shCfg = ss.getSheetByName('Configuration');
  if (!shCfg) throw new Error('Onglet Configuration introuvable.');

  const nbEq = Math.max(1, Math.min(3, parseInt(configEquipes.nbEquipes, 10) || 3));
  shCfg.getRange('C31').setValue(nbEq);
  try {
    shCfg.getRange('B31:D31').setValues([['Nombre d\'Équipes dans le groupe', nbEq, 'Nombre d\'équipes gérées (1, 2 ou 3 - défaut : 3)']]);
    PropertiesService.getScriptProperties().setProperty('NB_EQUIPES', String(nbEq));
  } catch (e) {}

  if (Array.isArray(configEquipes.equipes)) {
    for (let idx = 0; idx < 3; idx++) {
      const eq = configEquipes.equipes[idx];
      const rowNum = 4 + idx;
      if (eq) {
        if (eq.code !== undefined) shCfg.getRange('B' + rowNum).setValue(eq.code);
        if (eq.motCle !== undefined) shCfg.getRange('C' + rowNum).setValue(eq.motCle);
        if (eq.labelSondage !== undefined) shCfg.getRange('D' + rowNum).setValue(eq.labelSondage);
        if (eq.delaiRdv !== undefined) shCfg.getRange('E' + rowNum).setValue(Number(eq.delaiRdv) || 1);
        if (eq.urlPoule !== undefined) shCfg.getRange('F' + rowNum).setValue(eq.urlPoule);
        if (eq.urlCoupe !== undefined) shCfg.getRange('G' + rowNum).setValue(eq.urlCoupe);
      }
    }
  }

  initialiserOngletsWebApp();

  const nouvelleCfg = getClubConfig(ss);
  return {
    ok: true,
    nbEquipes: nouvelleCfg.nbEquipes,
    equipes: nouvelleCfg.equipes,
    nomEquipe1: nouvelleCfg.nomEquipe1,
    nomEquipe2: nouvelleCfg.nomEquipe2,
    nomEquipe3: nouvelleCfg.nomEquipe3
  };
}

/**
 * HANDBALL BOT 2.0 - ROUTEUR API HTTP (doGet)
 */
function doGet(e) {
  if (e && e.parameter) {
    if (e.parameter.action === 'sync') {
      const nb = synchroniserDepuisGitHub();
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', count: nb }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.action === 'ping') {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', version: '2.2.23' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.action === 'getDonneesCoach') {
      const data = getDonneesCoach();
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: data }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.action === 'getStatsSpakta') {
      const stats = recupererStatsSpaktaClub();
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: stats }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  const cfg = getClubConfig();
  const html = construireHtmlWebApp();
  return HtmlService.createHtmlOutput(html)
    .setTitle((cfg.nomClub || 'Handball') + ' - Espace Coach')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * HANDBALL BOT 2.0 - ROUTEUR UNIVERSEL API (doPost)
 * Exécute les méthodes du backend appelées par la WebApp PWA
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No post data' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const args = payload.args || [];

    // Support rétrocompatible pour la synchro des votes WhatsApp
    if (action === 'save_votes' && Array.isArray(payload.votes)) {
      const nb = enregistrerVotesDansSheet(payload.votes);
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', count: nb }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Table de routage universelle des méthodes backend
    const router = {
      'getConfig': function() {
        const cfg = getClubConfig();
        return {
          nomClub: cfg.nomClub || 'Handball Club',
          logoUrl: cfg.logoUrl || '',
          couleurPrimaire: cfg.couleurPrimaire || '#f97316',
          couleurSecondaire: cfg.couleurSecondaire || '#d0d0d0'
        };
      },
      'getDonneesCoach': getDonneesCoach,
      'authentifierUtilisateur': authentifierUtilisateur,
      'enregistrerCompoEtPublier': enregistrerCompoEtPublier,
      'enregistrerBrouillonCompo': enregistrerBrouillonCompo,
      'recupererBrouillonCompo': recupererBrouillonCompo,
      'enregistrerEntrainementEtPublier': enregistrerEntrainementEtPublier,
      'enregistrerConfigEntrainements': enregistrerConfigEntrainements,
      'enregistrerMonPoste': enregistrerMonPoste,
      'enregistrerMaPhoto': enregistrerMaPhoto,
      'enregistrerFicheJoueurParCoach': enregistrerFicheJoueurParCoach,
      'ajouterJoueurParCoach': ajouterJoueurParCoach,
      'supprimerJoueurParCoach': supprimerJoueurParCoach,
      'enregistrerLogoClub': enregistrerLogoClub,
      'reinitialiserLogoClub': reinitialiserLogoClub,
      'enregistrerCouleursClub': enregistrerCouleursClub,
      'enregistrerConfigEquipes': enregistrerConfigEquipes,
      'enregistrerChouchou': enregistrerChouchou,
      'enregistrerMvpDesignation': enregistrerMvpDesignation,
      'reinitialiserVotesMvp': reinitialiserVotesMvp,
      'voterMvp': voterMvp,
      'enregistrerChevreDesignation': enregistrerChevreDesignation,
      'reinitialiserVotesChevre': reinitialiserVotesChevre,
      'proposerActionChevre': proposerActionChevre,
      'supprimerActionChevre': supprimerActionChevre,
      'voterActionChevre': voterActionChevre,
      'enregistrerCovoiturage': enregistrerCovoiturage,
      'reinitialiserCovoiturage': reinitialiserCovoiturage,
      'declarerAbsenceJoueur': declarerAbsenceJoueur,
      'supprimerAbsenceJoueur': supprimerAbsenceJoueur,
      'enregistrerVacancesClub': enregistrerVacancesClub,
      'reinitialiserVacancesDefaut': reinitialiserVacancesDefaut,
      'signalerAmendeJoueur': signalerAmendeJoueur,
      'infligerAmendeAdmin': infligerAmendeAdmin,
      'validerAmendeSignalee': validerAmendeSignalee,
      'encaisserAmendesAdmin': encaisserAmendesAdmin,
      'enregistrerDepenseCaisse': enregistrerDepenseCaisse,
      'supprimerAmendeAdmin': supprimerAmendeAdmin,
      'enregistrerConfigCaisseNoire': enregistrerConfigCaisseNoire,
      'changerStatutCaisseNoire': changerStatutCaisseNoire,
      'reinitialiserCaisseNoire': reinitialiserCaisseNoire,
      'importerInfosClubFFHB': importerInfosClubFFHB,
      'extraireMatchFFHB': extraireMatchFFHB,
      'verifierMiseAJour': verifierMiseAJour,
      'enregistrerModeFonctionnement': enregistrerModeFonctionnement,
      'recupererStatsSpaktaClub': recupererStatsSpaktaClub,
      'associerIdsSpakta': function(forcer) { return preRemplirIdsSpaktaEffectif(null, forcer); },
      'declencherLectureVotes': declencherLectureVotes
    };

    if (typeof router[action] === 'function') {
      const result = router[action].apply(null, args);
      // Invalidation automatique du cache si c'est une écriture
      if (action.indexOf('enregistrer') === 0 || action.indexOf('supprimer') === 0 || action.indexOf('reinitialiser') === 0 || action.indexOf('ajouter') === 0 || action.indexOf('associer') === 0) {
        try { CacheService.getScriptCache().remove('COACH_DATA_CACHE'); } catch (ce) {}
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: result }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Action inconnue : ' + action }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Enregistre les votes reçus dans l'onglet "Votes_Semaine"
 */
function enregistrerVotesDansSheet(votes) {
  if (!Array.isArray(votes)) return 0;
  const ss = getSpreadsheet();
  const cfg = getClubConfig(ss);
  const shEff = ss.getSheetByName('Effectif');
  const shVotes = ss.getSheetByName('Votes_Semaine');

  const effectif = shEff ? shEff.getDataRange().getValues().slice(1) : [];
  const mapTel = {};
  const mapNom = {};

  effectif.forEach(function(r) {
    const caseNom = String(r[0] || '').trim();
    const nomPropre = caseNom.replace(/\s*\([^)]*\)\s*/g, '').trim();
    const matchAlias = caseNom.match(/\(([^)]+)\)/);
    const alias = matchAlias ? matchAlias[1].trim().toLowerCase() : '';
    const tel = normaliserNumero(dechiffrerNumero(r[1]));
    let poste = String(r[2] || 'Demi-Centre').trim();
    if (/polyvalent|joueur/i.test(poste)) poste = 'Demi-Centre';
    if (tel) mapTel[tel] = { nom: nomPropre, poste: poste };
    if (nomPropre) mapNom[nomPropre.toLowerCase()] = { nom: nomPropre, poste: poste };
    if (alias) mapNom[alias] = { nom: nomPropre, poste: poste };
  });

  const seances = (cfg.seancesTrain && cfg.seancesTrain.length) ? cfg.seancesTrain.filter(function(s) {
    return s.actif !== false && s.actif !== 'NON' && !/match|poule|coupe|championnat/i.test(s.label || '');
  }) : [
    { jour: 'Lundi' }, { jour: 'Mercredi' }
  ];
  const nbCols = 3 + cfg.nbEquipes + seances.length;
  const dictionnaireJoueurs = {};
  if (shVotes.getLastRow() > 1) {
    const colCount = Math.max(shVotes.getLastColumn(), nbCols);
    const lignesExistantes = shVotes.getRange(2, 1, shVotes.getLastRow() - 1, colCount).getValues();
    lignesExistantes.forEach(function(r) {
      const nomExistant = String(r[0] || '').trim();
      if (nomExistant) {
        const ficheEff = mapNom[nomExistant.toLowerCase()];
        let posteExistant = ficheEff ? ficheEff.poste : String(r[1] || 'Demi-Centre').trim();
        if (/polyvalent|joueur/i.test(posteExistant)) posteExistant = 'Demi-Centre';
        let ligneJoueur = [
          nomExistant,
          posteExistant,
          Number(r[2]) || 0,
          String(r[3] || 'NON').trim().toUpperCase()
        ];
        if (cfg.nbEquipes >= 2) ligneJoueur.push(String(r[4] || 'NON').trim().toUpperCase());
        if (cfg.nbEquipes >= 3) ligneJoueur.push(String(r[5] || 'NON').trim().toUpperCase());
        for (let sIdx = 0; sIdx < seances.length; sIdx++) {
          const colR = 3 + cfg.nbEquipes + sIdx;
          ligneJoueur.push(String(r[colR] || 'NON').trim().toUpperCase());
        }
        dictionnaireJoueurs[nomExistant.toLowerCase()] = ligneJoueur;
      }
    });
  }

  votes.forEach(function(v) {
    const telPropre = normaliserNumero(v.phone);
    const pushPropre = String(v.pushName || '').trim();
    const fiche = mapTel[telPropre] || mapNom[pushPropre.toLowerCase()] || { nom: pushPropre || telPropre, poste: 'Demi-Centre' };
    const ancien = dictionnaireJoueurs[fiche.nom.toLowerCase()] || [];

    const selOpts = Array.isArray(v.selectedOptions) ? v.selectedOptions.map(function(s){ return String(s).toUpperCase(); }) : [];
    const eq1Dispo = v.dispoEquipe1 || v.dispo1B || selOpts.some(function(s){ return s.includes(cfg.nomEquipe1.toUpperCase()); });
    const eq2Dispo = v.dispoEquipe2 || v.dispo1C || (cfg.nomEquipe2 ? selOpts.some(function(s){ return s.includes(cfg.nomEquipe2.toUpperCase()); }) : false);
    const eq3Dispo = v.dispoEquipe3 || v.dispo1D || (cfg.nomEquipe3 ? selOpts.some(function(s){ return s.includes(cfg.nomEquipe3.toUpperCase()); }) : false);

    const ligne = [
      fiche.nom,
      fiche.poste,
      Number(v.nbTrainings) || 0,
      eq1Dispo ? 'OUI' : 'NON'
    ];
    if (cfg.nbEquipes >= 2) ligne.push(eq2Dispo ? 'OUI' : 'NON');
    if (cfg.nbEquipes >= 3) ligne.push(eq3Dispo ? 'OUI' : 'NON');

    seances.forEach(function(s, sIdx) {
      const colIdxInRow = 3 + cfg.nbEquipes + sIdx;
      const ancienVal = ancien[colIdxInRow] || 'NON';
      const jourUp = (s.jour || '').toUpperCase();
      let dispoSeance = false;
      const propDay = 'dispo' + (s.jour || '').charAt(0).toUpperCase() + (s.jour || '').slice(1).toLowerCase();
      const propAbs = 'absent' + (s.jour || '').charAt(0).toUpperCase() + (s.jour || '').slice(1).toLowerCase();

      const aVoteAbsent = (v[propAbs] === true) || (selOpts.length > 0 && jourUp && selOpts.some(function(opt){
        return opt.includes(jourUp) && (opt.includes('ABS') || opt.includes('ABSENT') || opt.includes('INDISPO')) && !opt.includes('DISPO');
      }));

      if (aVoteAbsent) {
        dispoSeance = false;
      } else if (v[propDay] !== undefined) {
        dispoSeance = !!v[propDay];
      } else if (selOpts.length > 0 && jourUp) {
        dispoSeance = selOpts.some(function(opt){
          return opt.includes(jourUp) && (opt.includes('ENTRAÎNEMENT') || opt.includes('ENTRAINEMENT') || opt.includes('TRAINING')) && !opt.includes('ABS');
        });
      } else {
        dispoSeance = (ancienVal === 'OUI');
      }
      ligne.push(dispoSeance ? 'OUI' : 'NON');
    });

    let nbTrReel = 0;
    for (let c = 3 + cfg.nbEquipes; c < ligne.length; c++) {
      if (ligne[c] === 'OUI') nbTrReel++;
    }
    ligne[2] = nbTrReel;

    dictionnaireJoueurs[fiche.nom.toLowerCase()] = ligne;
  });

  const lignesFinales = Object.values(dictionnaireJoueurs).sort(function(a, b) {
    return String(a[0] || '').localeCompare(String(b[0] || ''), 'fr', { sensitivity: 'base' });
  });

  const colMax = Math.max(shVotes.getLastColumn(), nbCols + 5);
  if (shVotes.getLastRow() > 1) shVotes.getRange(2, 1, shVotes.getLastRow() - 1, colMax).clearContent();
  if (lignesFinales.length > 0) shVotes.getRange(2, 1, lignesFinales.length, nbCols).setValues(lignesFinales);
  return lignesFinales.length;
}

/**
 * Récupère le fichier votes_semaine.json depuis le dépôt GitHub et met à jour le Sheet
 */
function synchroniserDepuisGitHub() {
  try {
    const ss = getSpreadsheet();
    const cfg = getClubConfig(ss);
    if (!cfg.githubRepo || !cfg.githubToken) return 0;

    const url = 'https://api.github.com/repos/' + cfg.githubRepo + '/contents/votes_semaine.json?t=' + new Date().getTime();
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'Authorization': 'Bearer ' + cfg.githubToken, 'Accept': 'application/vnd.github.v3.raw', 'Cache-Control': 'no-cache' }
    });
    if (res.getResponseCode() !== 200) return 0;
    return enregistrerVotesDansSheet(JSON.parse(res.getContentText('UTF-8')));
  } catch (e) {
    return 0;
  }
}

function getDonneesCoach(forceSync) {
  const cache = CacheService.getScriptCache();
  if (!forceSync) {
    try {
      const cached = cache.get('COACH_DATA_CACHE');
      if (cached) return JSON.parse(cached);
    } catch (ce) {}
  }
  if (forceSync) {
    synchroniserDepuisGitHub();
  } else {
    try {
      const cache = CacheService.getScriptCache();
      if (!cache.get('DERNIERE_SYNC_GH')) {
        synchroniserDepuisGitHub();
        cache.put('DERNIERE_SYNC_GH', '1', 300);
      }
    } catch (e) {
      synchroniserDepuisGitHub();
    }
  }
  return lireDonneesCoach();
}

/**
 * Prépare les données pour la WebApp coach
 */
function lireDonneesCoach(ssOpt, cfgOpt) {
  const ss = ssOpt || getSpreadsheet();
  try {
    const cache = CacheService.getScriptCache();
    if (!cache.get('DERNIERE_PURGE_ABS')) {
      purgerAbsencesTerminees(ss);
      cache.put('DERNIERE_PURGE_ABS', '1', 3600);
    }
  } catch (e) {
    Logger.log('Purge automatique absences au chargement coach : ' + e.message);
  }
  const cfg = cfgOpt || getClubConfig(ss);
  const shVotes = ss.getSheetByName('Votes_Semaine');
  const shEff = ss.getSheetByName('Effectif');
  const shMatchs = ss.getSheetByName('Matchs FFHB Détectés');

  const mapPhotos = {};
  const mapPostes = {};
  const mapNotes = {};
  const mapIdSpakta = {};
  const effectifComplet = [];

  const rowsVotes = shVotes ? shVotes.getDataRange().getValues().slice(1) : [];
  const headersVotes = (shVotes && shVotes.getLastRow() >= 1) ? shVotes.getRange(1, 1, 1, shVotes.getLastColumn() || 1).getValues()[0] : [];
  const mapEntrainements = {};
  rowsVotes.forEach(function(r) {
    if (!r[0]) return;
    const n = String(r[0]).trim().toLowerCase();
    mapEntrainements[n] = Number(r[2]) || 0;
  });

  if (shEff) {
    const rowsEff = shEff.getDataRange().getValues().slice(1);
    rowsEff.forEach(function(r) {
      const nomBrut = String(r[0] || '').trim();
      if (!nomBrut) return;
      const nomPropre = nomBrut.replace(/\s*\([^)]*\)\s*/g, '').trim();
      const cle = nomPropre.toLowerCase();
      let posteEff = String(r[2] || 'Demi-Centre').trim();
      if (/polyvalent|joueur/i.test(posteEff)) posteEff = 'Demi-Centre';
      const equipeEff = String(r[3] || cfg.nomEquipe1).trim();
      const photo = convertirUrlPhoto(r[4]);
      const note = String(r[6] || '').trim();

      if (photo) mapPhotos[cle] = photo;
      if (posteEff) mapPostes[cle] = posteEff;
      if (note) mapNotes[cle] = note;
      const nbTr = (mapEntrainements[cle] !== undefined) ? mapEntrainements[cle] : 0;
      const estTresorier = Boolean(r[7] === true || String(r[7] || '').toLowerCase() === 'oui' || String(r[7] || '').toLowerCase() === 'true' || /tr[eé]sorier/i.test(String(r[7] || '')));
      const estChouchou = Boolean(r[8] === true || String(r[8] || '').toLowerCase() === 'oui' || String(r[8] || '').toLowerCase() === 'true' || /chouchou/i.test(String(r[8] || '')));
      const idSpakta = String(r[9] || '').trim();
      if (idSpakta) mapIdSpakta[cle] = idSpakta;
      effectifComplet.push({ nom: nomPropre, tel: dechiffrerNumero(r[1]), poste: posteEff, equipe: equipeEff, photo: photo, note: note, entrainements: nbTr, estTresorier: estTresorier, estChouchou: estChouchou, idSpakta: idSpakta });
    });
  }
  const joueurs = [];

  const seances = (cfg.seancesTrain && cfg.seancesTrain.length) ? cfg.seancesTrain.filter(function(s) {
    return s.actif !== false && s.actif !== 'NON' && !/match|poule|coupe|championnat/i.test(s.label || '');
  }) : [
    { id: 'lun', jour: 'Lundi', horaire: '20h30', label: 'Entraînement Lundi 20h30', actif: true },
    { id: 'mer', jour: 'Mercredi', horaire: '20h30', label: 'Entraînement Mercredi 20h30', actif: true }
  ];

  const entrainements = {};
  seances.forEach(function(s) {
    entrainements[s.id] = [];
  });
  if (!entrainements.lun) entrainements.lun = [];
  if (!entrainements.mer) entrainements.mer = [];
  if (!entrainements.jeu) entrainements.jeu = [];

  const mapColSeance = {};
  seances.forEach(function(s, sIdx) {
    let colIdx = -1;
    const jourNorm = (s.jour || '').toLowerCase().trim();
    if (headersVotes && headersVotes.length) {
      for (let c = 0; c < headersVotes.length; c++) {
        const h = String(headersVotes[c] || '').toLowerCase();
        if (jourNorm && h.includes(jourNorm)) {
          colIdx = c;
          break;
        }
      }
    }
    if (colIdx === -1) {
      const offset = 3 + (cfg.nbEquipes || 1);
      colIdx = offset + sIdx;
    }
    mapColSeance[s.id] = colIdx;
  });

  rowsVotes.forEach(function(r, idx) {
    if (!r[0]) return;
    const nomJoueur = String(r[0]).trim();
    const cleNom = nomJoueur.toLowerCase();
    let posteJoueur = mapPostes[cleNom] || String(r[1] || 'Demi-Centre').trim();
    if (/polyvalent|joueur/i.test(posteJoueur)) posteJoueur = 'Demi-Centre';
    const photoJoueur = mapPhotos[cleNom] || '';
    const noteJoueur = mapNotes[cleNom] || '';

    const d1B = String(r[3]).trim().toUpperCase() === 'OUI';
    const d1C = (cfg.nbEquipes >= 2 && r[4] !== undefined) ? (String(r[4]).trim().toUpperCase() === 'OUI') : false;
    const d1D = (cfg.nbEquipes >= 3 && r[5] !== undefined) ? (String(r[5]).trim().toUpperCase() === 'OUI') : false;

    const idSpaktaJoueur = mapIdSpakta[cleNom] || '';
    const fichePresence = { nom: nomJoueur, poste: posteJoueur, entrainements: Number(r[2]) || 0, photo: photoJoueur, note: noteJoueur, idSpakta: idSpaktaJoueur };

    seances.forEach(function(s) {
      const col = mapColSeance[s.id];
      if (col !== undefined && r[col] !== undefined && String(r[col]).trim().toUpperCase() === 'OUI') {
        entrainements[s.id].push(fichePresence);
      }
    });

    if (d1B || d1C || d1D) {
      joueurs.push({ id: 'j_' + idx, nom: nomJoueur, poste: posteJoueur, entrainements: Number(r[2]) || 0, dispo1B: d1B, dispo1C: d1C, dispo1D: d1D, photo: photoJoueur, note: noteJoueur, idSpakta: idSpaktaJoueur });
    }
  });

  const trierParNom = function(a, b) { return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { sensitivity: 'base' }); };
  joueurs.sort(trierParNom);
  Object.keys(entrainements).forEach(function(k) {
    entrainements[k].sort(trierParNom);
  });
  effectifComplet.sort(trierParNom);

  const formaterDateMatchFr = function(dateVal) {
    if (!dateVal) return '';
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
      const moisFr = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
      return dateVal.getDate() + ' ' + moisFr[dateVal.getMonth()];
    }
    const s = String(dateVal).trim();
    const dParsed = new Date(s);
    if (!isNaN(dParsed.getTime()) && (s.includes('GMT') || s.includes('00:00:00') || /^\d{4}-\d{2}-\d{2}/.test(s))) {
      const moisFr = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
      return dParsed.getDate() + ' ' + moisFr[dParsed.getMonth()];
    }
    const matchFr = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?$/);
    if (matchFr) {
      const j = parseInt(matchFr[1], 10);
      const m = parseInt(matchFr[2], 10) - 1;
      const moisFr = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
      if (m >= 0 && m < 12) return j + ' ' + moisFr[m];
    }
    return s;
  };

  const rowsMatchs = shMatchs ? shMatchs.getRange('B4:K6').getValues() : [];
  const extraireDetailMatch = function(row, nomDefaut) {
    if (!row || !row[0]) return { label: nomDefaut, aMatch: false, adversaire: '', salle: '', date: '', dateMatch: '', heure: '', heureMatch: '', rdv: '', heureRdv: '', lieu: '', statut: '' };
    const dateBrute = String(row[2] || '').trim();
    const dateM = formaterDateMatchFr(dateBrute);
    let heureM = String(row[3] || '').trim().replace(/^à\s*/i, '');
    let heureRdv = String(row[4] || '').trim().replace(/^à\s*/i, '');
    const lieu = String(row[5] || '').trim();
    const adv = String(row[6] || '').trim();
    const salle = String(row[7] || '').trim();
    const libelle = String(row[8] || '').trim();
    const statut = String(row[9] || '').trim();
    const pasDeMatch = !adv || adv === '-' || /pas de match/i.test(adv) || /exempt/i.test(adv) || /aucun/i.test(adv) || /pas de match/i.test(dateBrute) || /exempt/i.test(statut);
    const aMatch = !pasDeMatch;
    return {
      label: (libelle && libelle !== '-') ? libelle : nomDefaut,
      aMatch: aMatch,
      date: (aMatch && dateM !== '-') ? dateM : '',
      dateMatch: (aMatch && dateM !== '-') ? dateM : '',
      heure: (aMatch && heureM !== '-') ? heureM : '',
      heureMatch: (aMatch && heureM !== '-') ? heureM : '',
      rdv: (aMatch && heureRdv !== '-') ? heureRdv : '',
      heureRdv: (aMatch && heureRdv !== '-') ? heureRdv : '',
      lieu: (aMatch && lieu !== '-') ? lieu : '',
      adversaire: aMatch ? adv : '',
      salle: (aMatch && salle !== '-') ? salle : '',
      statut: statut
    };
  };

  const det1B = extraireDetailMatch(rowsMatchs[0], 'Équipe ' + cfg.nomEquipe1);
  const det1C = extraireDetailMatch(rowsMatchs[1], 'Équipe ' + cfg.nomEquipe2);
  const det1D = extraireDetailMatch(rowsMatchs[2], 'Équipe ' + (cfg.nomEquipe3 || 'Équipe 3'));

  const infosMatchs = {
    eq1: det1B,
    eq2: det1C,
    eq3: det1D,
    details1B: det1B,
    details1C: det1C,
    details1D: det1D,
    label1B: (rowsMatchs[0] && rowsMatchs[0][8] && rowsMatchs[0][8] !== '-') ? rowsMatchs[0][8] : ('Équipe ' + cfg.nomEquipe1),
    label1C: (rowsMatchs[1] && rowsMatchs[1][8] && rowsMatchs[1][8] !== '-') ? rowsMatchs[1][8] : ('Équipe ' + cfg.nomEquipe2),
    label1D: (rowsMatchs[2] && rowsMatchs[2][8] && rowsMatchs[2][8] !== '-') ? rowsMatchs[2][8] : ('Équipe ' + (cfg.nomEquipe3 || 'Équipe 3'))
  };

  // Récupération de la dernière composition enregistrée pour rechargement express
  let derniereCompo = null;
  const shComp = ss.getSheetByName('Compositions');
  if (shComp && shComp.getLastRow() > 1) {
    const lastRowIdx = shComp.getLastRow();
    const lastRowVals = shComp.getRange(lastRowIdx, 1, 1, shComp.getLastColumn()).getValues()[0];
    const dateCompo = String(lastRowVals[0] || '');
    const separerNoms = function(str) {
      return String(str || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    };
    let estCompoSemainePassee = false;
    try {
      const parts = dateCompo.replace(/\[pr[ée]c[ée]dente\]\s*/i, '').trim().split(/[\s/:]+/);
      if (parts.length >= 3) {
        const j = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const a = parseInt(parts[2], 10);
        const dObj = new Date(a, m, j);
        const now = new Date();
        const jourSem = (now.getDay() + 6) % 7; // 0 = lundi
        const lundiActuel = new Date(now.getFullYear(), now.getMonth(), now.getDate() - jourSem, 0, 0, 0);
        if (dObj < lundiActuel) {
          estCompoSemainePassee = true;
        }
      }
    } catch (e) {}
    const estPrecedente = /\[pr[ée]c[ée]dente\]/i.test(dateCompo) || estCompoSemainePassee;
    const datePropre = dateCompo.replace(/\[pr[ée]c[ée]dente\]\s*/i, '').trim();
    if (cfg.nbEquipes === 1) {
      derniereCompo = {
        date: datePropre,
        estActive: !estPrecedente,
        estPrecedente: estPrecedente,
        equipe1B: separerNoms(lastRowVals[1]),
        equipe1C: [],
        equipe1D: [],
        nonRetenus: separerNoms(lastRowVals[2])
      };
    } else if (cfg.nbEquipes === 3) {
      derniereCompo = {
        date: datePropre,
        estActive: !estPrecedente,
        estPrecedente: estPrecedente,
        equipe1B: separerNoms(lastRowVals[1]),
        equipe1C: separerNoms(lastRowVals[2]),
        equipe1D: separerNoms(lastRowVals[3]),
        nonRetenus: separerNoms(lastRowVals[4])
      };
    } else {
      derniereCompo = {
        date: datePropre,
        estActive: !estPrecedente,
        estPrecedente: estPrecedente,
        equipe1B: separerNoms(lastRowVals[1]),
        equipe1C: separerNoms(lastRowVals[2]),
        equipe1D: [],
        nonRetenus: separerNoms(lastRowVals[3])
      };
    }
  }

  return {
    joueurs: joueurs,
    matchs: infosMatchs,
    entrainements: entrainements,
    seancesTrain: cfg.seancesTrain,
    effectif: effectifComplet,
    derniereCompo: derniereCompo,
    covoiturage: getCovoiturageData(),
    votesMvp: getVotesMvpData(),
    chevreData: getChevreData(),
    absences: getAbsencesJoueurs(),
    caisseNoire: getCaisseNoireData(),
    vacances: getVacancesData(ss),
    statsSpakta: recupererStatsSpaktaClub(),
    clubConfig: {
      nomClub: cfg.nomClub,
      logoUrl: cfg.logoUrl,
      githubRepo: cfg.githubRepo,
      groupId: cfg.groupId,
      nbEquipes: cfg.nbEquipes,
      equipes: cfg.equipes,
      nomEquipe1: cfg.nomEquipe1,
      nomEquipe2: cfg.nomEquipe2,
      nomEquipe3: cfg.nomEquipe3,
      couleurPrimaire: cfg.couleurPrimaire,
      couleurSecondaire: cfg.couleurSecondaire,
      couleurEquipe1: cfg.couleurEquipe1,
      couleurEquipe2: cfg.couleurEquipe2,
      couleurEquipe3: cfg.couleurEquipe3,
      chouchou: cfg.chouchou || '',
      tresoriers: cfg.tresoriers || '',
      mvp: cfg.mvp || '',
      chevre: cfg.chevre || ''
    }
  };
}

function enregistrerCompoEtPublier(compo, envoyerWhatsApp, messageWhatsApp) {
  const ss = getSpreadsheet();
  const cfg = getClubConfig(ss);
  const shComp = ss.getSheetByName('Compositions');
  const horodatage = Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm');
  if (shComp) {
    if (cfg.nbEquipes === 1) {
      shComp.appendRow([horodatage, (compo.equipe1B || []).join(', '), (compo.nonRetenus || []).join(', ')]);
    } else if (cfg.nbEquipes === 3) {
      shComp.appendRow([horodatage, (compo.equipe1B || []).join(', '), (compo.equipe1C || []).join(', '), (compo.equipe1D || []).join(', '), (compo.nonRetenus || []).join(', ')]);
    } else {
      shComp.appendRow([horodatage, (compo.equipe1B || []).join(', '), (compo.equipe1C || []).join(', '), (compo.nonRetenus || []).join(', ')]);
    }
  }

  // Note : La diffusion automatique via bot WhatsApp a été remplacée par la copie instantanée presse-papier / partage natif
  return { ok: true, date: horodatage };
}

function enregistrerEntrainementEtPublier(seance, typeSeance, groupes, nonRetenus, envoyerWhatsApp, messageWhatsApp) {
  const ss = getSpreadsheet();
  const shTrain = ss.getSheetByName('Entrainements');
  const horodatage = Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm');

  const labelSeance = seance + (typeSeance ? ' (' + typeSeance + ')' : '');
  const g1 = (groupes && groupes[0] && groupes[0].joueurs) ? groupes[0].joueurs.join(', ') : '';
  const g2 = (groupes && groupes[1] && groupes[1].joueurs) ? groupes[1].joueurs.join(', ') : '';
  const nr = (nonRetenus || []).join(', ');

  if (shTrain) {
    shTrain.appendRow([horodatage, labelSeance, g1, g2, nr]);
  }

  // Note : La diffusion automatique via bot WhatsApp a été remplacée par la copie instantanée presse-papier / partage natif
  return { ok: true, date: horodatage };
}

/**
 * Enregistre les créneaux d'entraînement personnalisés dans la feuille Configuration (B9:D14)
 */
function enregistrerConfigEntrainements(telCoach, pinCoach, creneaux, nbSeances) {
  let cList = creneaux;
  if (!Array.isArray(creneaux) && Array.isArray(telCoach)) {
    cList = telCoach;
  }
  if (!Array.isArray(cList) || cList.length === 0) {
    return { ok: false, error: 'Liste de séances invalide' };
  }

  // Limiter entre 1 et 5 séances
  cList = cList.slice(0, 5);

  // Normaliser les objets
  cList = cList.map(function(c, i) {
    const j = String(c.jour || ('Séance ' + (i + 1))).trim();
    const h = String(c.horaire || '20h30').trim();
    const lEnt = c.label ? String(c.label).trim() : ('Entraînement ' + j + ' ' + h);
    const lAbs = c.labelAbsent ? String(c.labelAbsent).trim() : ('Absent ' + j);
    return {
      id: c.id || ('s' + (i + 1)),
      jour: j,
      horaire: h,
      label: lEnt,
      labelAbsent: lAbs,
      actif: (c.actif === true || c.actif === 'OUI'),
      actifAbsent: (c.actifAbsent !== false && c.actifAbsent !== 'NON')
    };
  });

  // Sauvegarder dans ScriptProperties (source de vérité 1 à 5 séances)
  try {
    PropertiesService.getScriptProperties().setProperty('CONFIG_SEANCES_TRAIN', JSON.stringify(cList));
    PropertiesService.getScriptProperties().setProperty('NB_SEANCES_TRAIN', String(cList.length));
  } catch (e) {
    Logger.log('Erreur PropertiesService: ' + e.message);
  }

  // Mettre à jour la feuille Configuration (B9:D18) pour les 5 créneaux possibles
  const ss = getSpreadsheet();
  const shCfg = ss.getSheetByName('Configuration');
  if (shCfg) {
    for (let i = 0; i < 4; i++) {
      const rowIdx = 9 + (i * 2);
      if (i < cList.length && cList[i].actif) {
        const c = cList[i];
        const labelEnt = c.label;
        const labelAbs = c.labelAbsent || ('Absent ' + c.jour);
        const actifStr = 'OUI';
        const actifAbsStr = (c.actifAbsent !== false) ? 'OUI' : 'NON';
        shCfg.getRange(rowIdx, 3, 1, 2).setValues([[labelEnt, actifStr]]);
        shCfg.getRange(rowIdx + 1, 3, 1, 2).setValues([[labelAbs, actifAbsStr]]);
      } else {
        shCfg.getRange(rowIdx, 3, 1, 2).setValues([['Désactivé', 'NON']]);
        shCfg.getRange(rowIdx + 1, 3, 1, 2).setValues([['Désactivé', 'NON']]);
      }
    }
  }

  try {
    initialiserOngletsWebApp();
  } catch (e) {}

  try {
    genererSondageHebdo();
  } catch (e) {}

  return { ok: true, count: cList.length, seances: cList };
}

/**
 * Initialise l'onglet "Brouillon_Compo" pour sauvegarder les compositions tactiques non publiées
 */
function initialiserOngletBrouillonCompoSheet(ss) {
  if (!ss) ss = getSpreadsheet();
  if (!ss) return;
  let sh = ss.getSheetByName('Brouillon_Compo');
  if (!sh) {
    sh = ss.insertSheet('Brouillon_Compo');
  }
  try {
    sh.setTabColor('#64748b');
  } catch (e) {}

  const horodatage = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'dd/MM/yyyy HH:mm');
  if (sh.getLastRow() < 4) {
    sh.clear();
    sh.getRange('A1:D1').merge()
      .setValue('📋 BROUILLON DE COMPOSITION TACTIQUE (SAUVEGARDE WEBAPP)')
      .setBackground('#0f172a')
      .setFontColor('#f8fafc')
      .setFontWeight('bold')
      .setFontSize(12)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sh.setRowHeight(1, 34);

    sh.getRange('A2:D2').merge()
      .setValue('Dernière sauvegarde : ' + horodatage + ' • Brouillon automatique conservé tant que la composition n\'est pas publiée')
      .setBackground('#1e293b')
      .setFontColor('#94a3b8')
      .setFontStyle('italic')
      .setFontSize(9)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sh.setRowHeight(2, 20);

    sh.getRange(4, 1, 1, 2).setValues([['Clé', 'Valeur']])
      .setBackground('#475569')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sh.getRange(5, 1, 1, 2).setValues([['BROUILLON_JSON', '']]);
    try {
      sh.setColumnWidth(1, 150);
      sh.setColumnWidth(2, 500);
    } catch (e) {}
  }
}

/**
 * Sauvegarde de brouillon (Priorité : feuille Google Sheets "Brouillon_Compo")
 */
function enregistrerBrouillonCompo(brouillon) {
  try {
    const ss = getSpreadsheet();
    if (ss) {
      let sh = ss.getSheetByName('Brouillon_Compo');
      if (!sh) {
        initialiserOngletBrouillonCompoSheet(ss);
        sh = ss.getSheetByName('Brouillon_Compo');
      }
      if (sh) {
        const horodatage = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'dd/MM/yyyy HH:mm');
        sh.getRange('A2').setValue('Dernière sauvegarde : ' + horodatage + ' • Brouillon automatique conservé');
        sh.getRange('B5').setValue(JSON.stringify(brouillon));
      }
    }
    try {
      PropertiesService.getScriptProperties().setProperty('BROUILLON_COMPO', JSON.stringify(brouillon));
    } catch (e) {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Récupération du brouillon tactique (Priorité : feuille Google Sheets "Brouillon_Compo")
 */
function recupererBrouillonCompo() {
  try {
    const ss = getSpreadsheet();
    if (ss) {
      const sh = ss.getSheetByName('Brouillon_Compo');
      if (sh && sh.getLastRow() >= 5) {
        const val = sh.getRange('B5').getValue();
        if (val) return JSON.parse(val);
      }
    }
    const raw = PropertiesService.getScriptProperties().getProperty('BROUILLON_COMPO');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function declencherLectureVotes() {
  const ss = getSpreadsheet();
  const cfg = getClubConfig(ss);
  const sheetConfig = ss.getSheetByName('Configuration');
  let webappUrl = cfg.webappUrl;
  if (!webappUrl) {
    try { webappUrl = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  }
  if (sheetConfig && webappUrl) {
    try { sheetConfig.getRange('C21').setValue(webappUrl); } catch (e) {}
  }

  let ghTriggered = false;
  try {
    if (cfg.githubRepo && cfg.githubToken) {
      declencherActionGitHub('sync_whatsapp_votes', { webapp_url: webappUrl });
      ghTriggered = true;
    }
  } catch (ge) {
    console.warn('Dispatch GitHub non exécuté : ' + ge.message);
  }

  try {
    synchroniserDepuisGitHub();
  } catch (se) {}

  try {
    CacheService.getScriptCache().remove('COACH_DATA_CACHE');
  } catch (ce) {}

  return { launched: true, githubTriggered: ghTriggered };
}

/**
 * Interface WebApp pour mobile et desktop
 */
/**
 * HANDBALL BOT 2.0 - PASSERELLE WEBAPP PWA
 * Redirige instantanément vers l'application PWA ultra-rapide sur GitHub Pages
 */
function construireHtmlWebApp() {
  const cfg = getClubConfig();
  const defaultPwa = 'https://pidgey56.github.io/handball-bot-template/';
  const basePwa = (cfg && cfg.webappUrl && cfg.webappUrl.indexOf('http') === 0 && cfg.webappUrl.indexOf('script.google.com') === -1) ? cfg.webappUrl : defaultPwa;
  const cleanBase = basePwa.split('?')[0].replace(/\/+$/, '') + '/';
  let serviceUrl = '';
  try {
    serviceUrl = ScriptApp.getService().getUrl();
  } catch (e) {}

  const webAppUrl = cleanBase + '?api=' + encodeURIComponent(serviceUrl) + '&reset=1';
  const nomClub = cfg.nomClub || 'Handball Club';
  const logoUrl = cfg.logoUrl || genererLogoDefaut(cfg.couleurPrimaire);
  const couleur = cfg.couleurPrimaire || '#f97316';

  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + nomClub + ' - Portail</title>' +
    '<style>' +
    '* { box-sizing: border-box; }' +
    'body { margin: 0; min-height: 100vh; background: #090d16; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; padding: 20px; text-align: center; cursor: pointer; }' +
    '.launch-card { background: #111827; border: 1px solid #1f2937; border-radius: 24px; padding: 36px 28px; max-width: 420px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); }' +
    '.logo-wrap { width: 96px; height: 96px; margin: 0 auto 20px; border-radius: 50%; background: #1e293b; display: flex; align-items: center; justify-content: center; border: 3px solid ' + couleur + '; overflow: hidden; }' +
    '.logo-wrap img { width: 80px; height: 80px; object-fit: contain; }' +
    'h1 { font-size: 1.25rem; font-weight: 800; margin: 0 0 8px; color: #fff; line-height: 1.3; }' +
    'p { font-size: 0.88rem; color: #94a3b8; line-height: 1.5; margin: 0 0 24px; }' +
    '.btn-launch { display: block; width: 100%; background: ' + couleur + '; color: #fff; padding: 15px 20px; border-radius: 12px; font-weight: 800; font-size: 1.05rem; text-decoration: none; box-shadow: 0 10px 25px rgba(0,0,0,0.4); }' +
    '.hint { font-size: 0.75rem; color: #64748b; margin-top: 16px; }' +
    '</style>' +
    '</head><body onclick="ouvrirApp()">' +
    '<div class="launch-card">' +
    '<div class="logo-wrap"><img src="' + logoUrl + '" alt="Logo Club"></div>' +
    '<h1>' + nomClub + '</h1>' +
    '<p>Portail Joueurs & Coachs (Application Web PWA 2.0)</p>' +
    '<a id="btnLaunch" class="btn-launch" href="' + webAppUrl + '" target="_top">🤾 Entrer sur l\'application</a>' +
    '<div class="hint">Touchez ou cliquez n\'importe où pour lancer l\'application plein écran</div>' +
    '</div>' +
    '<script>' +
    'function ouvrirApp() { try { if (window.top) { window.top.location.href = "' + webAppUrl + '"; } else { window.location.href = "' + webAppUrl + '"; } } catch(e) { window.open("' + webAppUrl + '", "_top"); } }' +
    'document.getElementById("btnLaunch").addEventListener("click", function(e) { e.stopPropagation(); ouvrirApp(); });' +
    '</script>' +
    '</body></html>';
}

function executionAutoLundiMatin() {
  try {
    purgerAbsencesTerminees();
  } catch (e) {
    Logger.log('Purge automatique absences lundi matin : ' + e.message);
  }
  const sondage = genererSondageHebdo();
  if (sondage && sondage.enVacances) {
    Logger.log('[Auto Lundi] Semaine en période de vacances scolaires ("' + (sondage.nomVacances || 'Vacances') + '"). Envoi du sondage WhatsApp annulé.');
    return;
  }
  declencherEnvoiWhatsApp();
}

function decoderEntites(texte) {
  if (!texte) return '';
  const E = '&';
  let s = texte
    .split(E + 'quot;').join('"').split(E + '#034;').join('"').split(E + '#34;').join('"')
    .split(E + '#039;').join("'").split(E + '#39;').join("'").split(E + 'apos;').join("'")
    .split(E + 'nbsp;').join(' ').split(E + 'agrave;').join('à').split(E + 'Agrave;').join('À')
    .split(E + 'eacute;').join('é').split(E + 'Eacute;').join('É').split(E + 'egrave;').join('è')
    .split(E + 'Egrave;').join('È').split(E + 'ecirc;').join('ê').split(E + 'Ecirc;').join('Ê')
    .split(E + 'ocirc;').join('ô').split(E + 'ugrave;').join('ù').split(E + 'ccedil;').join('ç')
    .split(E + 'amp;').join('&');
  return s;
}

function estNombrePur(str) { return !isNaN(Number(str)) && str.trim() !== ''; }

function chercherMatchsDansJson(noeud, motCle, listeMatchs, dateContexte) {
  if (!noeud) return;
  if (typeof noeud === 'string') {
    const str = noeud.trim();
    if ((str.charAt(0) === '{' && str.charAt(str.length - 1) === '}') || (str.charAt(0) === '[' && str.charAt(str.length - 1) === ']')) {
      try { chercherMatchsDansJson(JSON.parse(str), motCle, listeMatchs, dateContexte); } catch (e) {}
    }
    return;
  }
  if (Array.isArray(noeud)) {
    for (let i = 0; i < noeud.length; i++) chercherMatchsDansJson(noeud[i], motCle, listeMatchs, dateContexte);
    return;
  }
  if (typeof noeud === 'object') {
    let eqDom = null, eqExt = null, datePrioritaire = null, dateSecondaire = null, heureRaw = null, salleRaw = '', urlMatchRaw = '', nouveauContexteDate = dateContexte || null;
    const cles = Object.keys(noeud);
    for (let i = 0; i < cles.length; i++) {
      const k = cles[i], kl = k.toLowerCase(), v = noeud[k];
      if (typeof v === 'string' || typeof v === 'number') {
        const vt = String(v).trim();
        if (!vt) continue;
        if ((kl.indexOf('equipe1') !== -1 || kl.indexOf('equipe_1') !== -1 || kl.indexOf('team1') !== -1 || kl.indexOf('domicile') !== -1 || kl.indexOf('recevant') !== -1 || kl === 'nomequipe1' || kl === 'equipe_domicile') && !estNombrePur(vt) && !/logo|url|img|id|code|score|couleur|num/i.test(kl)) {
          eqDom = vt;
        } else if ((kl.indexOf('equipe2') !== -1 || kl.indexOf('equipe_2') !== -1 || kl.indexOf('team2') !== -1 || kl.indexOf('exterieur') !== -1 || kl.indexOf('visiteur') !== -1 || kl === 'nomequipe2' || kl === 'equipe_exterieur') && !estNombrePur(vt) && !/logo|url|img|id|code|score|couleur|num/i.test(kl)) {
          eqExt = vt;
        } else if (kl.indexOf('date') !== -1 && /\d/.test(vt) && !/crea|modif|maj|update|saisie|homolog|tirage|naissance|affil|cloture|ouverture|ancien|init/i.test(kl)) {
          if (kl === 'date' || kl === 'daterencontre' || kl === 'date_rencontre' || kl === 'datematch' || kl === 'date_match' || kl === 'dateheure' || kl === 'date_heure') datePrioritaire = vt;
          else if (!dateSecondaire) dateSecondaire = vt;
          if (/debut|journee|rencontre|match/i.test(kl) || kl === 'date') nouveauContexteDate = vt;
        } else if ((kl.indexOf('heure') !== -1 || kl.indexOf('horaire') !== -1 || kl === 'time') && /\d/.test(vt) && !/date/i.test(kl)) {
          heureRaw = vt;
        } else if ((kl.indexOf('salle') !== -1 || kl.indexOf('gymnase') !== -1 || kl.indexOf('equipement') !== -1) && !estNombrePur(vt) && !/id|code|url/i.test(kl)) {
          salleRaw = vt;
        } else if ((kl === 'url' || kl === 'link' || kl === 'slug' || kl === 'href' || kl === 'path' || kl === 'rencontre_url' || kl === 'matchurl') && typeof vt === 'string') {
          if (vt.includes('match') || vt.includes('rencontre')) urlMatchRaw = vt;
        }
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (kl === 'equipe1' || kl === 'team1' || kl === 'domicile' || kl === 'recevant' || kl === 'equipe_1') eqDom = v.libelle || v.nom || v.name || v.title || eqDom;
        else if (kl === 'equipe2' || kl === 'team2' || kl === 'exterieur' || kl === 'visiteur' || kl === 'equipe_2') eqExt = v.libelle || v.nom || v.name || v.title || eqExt;
        else if (kl === 'journee' || kl === 'phase' || kl === 'poule') { const dJ = v.date_debut || v.dateDebut || v.date || null; if (dJ) nouveauContexteDate = String(dJ); }
        else if (kl === 'salle' || kl === 'equipement' || kl === 'gymnase') salleRaw = v.libelle || v.nom || v.ville || salleRaw;
        else if (kl === 'url' || kl === 'link' || kl === 'lien') { const u = v.url || v.href || v.link || ''; if (typeof u === 'string' && (u.includes('match') || u.includes('rencontre'))) urlMatchRaw = u; }
      }
    }
    const dateRetenue = datePrioritaire || dateSecondaire || nouveauContexteDate;
    if (eqDom && eqExt) {
      const domUp = String(eqDom).toUpperCase(), extUp = String(eqExt).toUpperCase();
      if (domUp.indexOf(motCle) !== -1 || extUp.indexOf(motCle) !== -1) {
        let infosDate = interpreterDateHeure(dateRetenue, heureRaw);
        if ((!infosDate || infosDate.dateObj.getFullYear() < 2024) && nouveauContexteDate && nouveauContexteDate !== dateRetenue) {
          infosDate = interpreterDateHeure(nouveauContexteDate, heureRaw);
        }
        if (infosDate && infosDate.dateObj.getFullYear() >= 2024) {
          const estDom = domUp.indexOf(motCle) !== -1;
          const adv = estDom ? String(eqExt) : String(eqDom);
          listeMatchs.push({
            dateObj: infosDate.dateObj,
            dateTexte: infosDate.jourCourt + '. ' + Utilities.formatDate(infosDate.dateObj, 'Europe/Paris', 'dd/MM/yyyy'),
            jourCourt: infosDate.jourCourt,
            heure: infosDate.heureFormat,
            estDomicile: estDom,
            adversaire: adv,
            adversaireCourt: nettoyerNomClub(adv),
            salle: salleRaw,
            urlMatch: urlMatchRaw
          });
        }
      }
    }
    for (let i = 0; i < cles.length; i++) chercherMatchsDansJson(noeud[cles[i]], motCle, listeMatchs, nouveauContexteDate);
  }
}

function interpreterDateHeure(dateStr, heureStr) {
  let annee = null, mois = null, jour = null, heure = 14, minute = 0;
  if (dateStr !== null && dateStr !== undefined) {
    const s = String(dateStr).trim();
    if (estNombrePur(s) && s.length >= 10 && s.length <= 13) {
      const dTs = new Date(s.length === 10 ? parseInt(s, 10) * 1000 : parseInt(s, 10));
      if (dTs.getFullYear() >= 2024 && dTs.getFullYear() <= 2035) {
        annee = dTs.getFullYear(); mois = dTs.getMonth(); jour = dTs.getDate(); heure = dTs.getHours(); minute = dTs.getMinutes();
      }
    } else {
      const mIso = s.match(/(20[23]\d)-(\d{2})-(\d{2})(?:[T\s]+(\d{1,2})[:hH](\d{2}))?/);
      const mSlash = s.match(/(\d{1,2})\/(\d{1,2})\/(20[23]\d)(?:\s+(\d{1,2})[:hH](\d{2}))?/);
      const mTexte = s.match(/(\d{1,2})\s+([a-zéûäëïöüçA-ZÉÛ]+)\s+(20[23]\d)(?:.*?(?:à|a|À)\s*(\d{1,2})\s*[hH:]\s*(\d{2}))?/i);
      if (mIso) {
        annee = parseInt(mIso[1], 10); mois = parseInt(mIso[2], 10) - 1; jour = parseInt(mIso[3], 10);
        if (mIso[4]) { heure = parseInt(mIso[4], 10); minute = parseInt(mIso[5], 10); }
      } else if (mSlash) {
        jour = parseInt(mSlash[1], 10); mois = parseInt(mSlash[2], 10) - 1; annee = parseInt(mSlash[3], 10);
        if (mSlash[4]) { heure = parseInt(mSlash[4], 10); minute = parseInt(mSlash[5], 10); }
      } else if (mTexte) {
        jour = parseInt(mTexte[1], 10);
        const dTemp = convertirDateFr(jour, mTexte[2].toLowerCase(), parseInt(mTexte[3], 10));
        annee = dTemp.getFullYear(); mois = dTemp.getMonth();
        if (mTexte[4]) { heure = parseInt(mTexte[4], 10); minute = parseInt(mTexte[5], 10); }
      }
    }
  }
  if (heureStr) {
    const mh = String(heureStr).match(/(\d{1,2})\s*[hH:]\s*(\d{2})?/);
    if (mh) { heure = parseInt(mh[1], 10); minute = mh[2] ? parseInt(mh[2], 10) : 0; }
  }
  if (annee === null || mois === null || jour === null) return null;
  const dateObj = new Date(annee, mois, jour, heure, minute, 0);
  const joursNoms = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  return {
    dateObj: dateObj,
    jourCourt: joursNoms[dateObj.getDay()],
    heureFormat: (minute === 0) ? (heure + 'h') : (heure + 'h' + (minute < 10 ? '0' + minute : minute))
  };
}

function extraireMatchFFHB(urlPouleOuListe, motCleClub, dateDebutSemaine, dateFinSemaine) {
  try {
    const motCle = String(motCleClub || '').toUpperCase().trim();
    let urlsBrutes = [];
    if (Array.isArray(urlPouleOuListe)) {
      urlsBrutes = urlPouleOuListe;
    } else if (typeof urlPouleOuListe === 'string') {
      urlsBrutes = urlPouleOuListe.split(/[\n,;|\s]+/).map(function(u) { return u.trim(); }).filter(Boolean);
    }
    if (urlsBrutes.length === 0) {
      return { found: false, statut: 'Aucune URL renseignée' };
    }

    function normaliserUrlFFHB(u) {
      let url = String(u || '').trim();
      if (!url) return '';
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.startsWith('/competitions/')) {
          url = 'https://www.ffhandball.fr' + url;
        } else if (url.startsWith('competitions/')) {
          url = 'https://www.ffhandball.fr/' + url;
        } else {
          url = 'https://www.ffhandball.fr/competitions/' + url;
        }
      }
      if (url.startsWith('http://')) {
        url = 'https://' + url.substring(7);
      }
      return url;
    }

    function enrichirSalleMatch(m) {
      if (!m) return m;
      if (m.salle && m.salle !== '' && m.salle !== 'Extérieur' && !/a confirmer/i.test(m.salle)) {
        return m;
      }
      if (m.urlMatch) {
        let uDetail = m.urlMatch;
        if (!uDetail.startsWith('http://') && !uDetail.startsWith('https://')) {
          uDetail = 'https://www.ffhandball.fr' + (uDetail.startsWith('/') ? '' : '/') + uDetail;
        }
        const sDynamique = extraireSalleDepuisPageFFHB(uDetail);
        if (sDynamique) {
          m.salle = sDynamique;
          return m;
        }
      }
      if (m.estDomicile) {
        const cfgClub = (typeof getSpreadsheet === 'function') ? getClubConfig(getSpreadsheet()) : null;
        m.salle = (cfgClub && cfgClub.salleDefaut) ? cfgClub.salleDefaut : 'Gymnase Domicile';
      } else {
        m.salle = 'Gymnase ' + (m.adversaireCourt || m.adversaire || 'Extérieur');
      }
      return m;
    }

    function chercherDansSemaine(liste) {
      for (let i = 0; i < liste.length; i++) {
        const m = liste[i];
        if (m.dateObj >= dateDebutSemaine && m.dateObj <= dateFinSemaine) {
          m.found = true;
          if (!m.statut) m.statut = m.isCoupe ? 'Détecté (Coupe de France)' : 'Détecté (Semaine en cours)';
          return m;
        }
      }
      return null;
    }

    const tousLesMatchsGlobaux = [];
    const urlsVisitees = {};

    function scannerUrl(urlCible, estCoupe) {
      if (urlsVisitees[urlCible]) return { matchs: [], poulesAnnexes: [] };
      urlsVisitees[urlCible] = true;
      let resp;
      try {
        resp = UrlFetchApp.fetch(urlCible, {
          muteHttpExceptions: true,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9' }
        });
      } catch (errFetch) {
        return { matchs: [], poulesAnnexes: [] };
      }
      const htmlBrut = resp.getContentText('UTF-8');
      const matchsTrouves = [];
      const poulesAnnexes = [];
      let mAttr;

      const traiterJsonStr = function(jsonStr) {
        try {
          const obj = JSON.parse(jsonStr);
          chercherMatchsDansJson(obj, motCle, matchsTrouves, null);
          if (obj && Array.isArray(obj.poules)) {
            obj.poules.forEach(function(po) {
              if (po && po.ext_pouleId) poulesAnnexes.push(String(po.ext_pouleId));
            });
          }
        } catch (e) {
          chercherMatchsDansJson(jsonStr, motCle, matchsTrouves, null);
        }
      };

      const regexAttrDouble = /attributes="([^"]+)"/gi;
      while ((mAttr = regexAttrDouble.exec(htmlBrut)) !== null) traiterJsonStr(decoderEntites(mAttr[1]));
      const regexAttrSingle = /attributes='([^']+)'/gi;
      while ((mAttr = regexAttrSingle.exec(htmlBrut)) !== null) traiterJsonStr(decoderEntites(mAttr[1]));

      const htmlDecode = decoderEntites(htmlBrut).replace(/\\"/g, '"').replace(/\\\//g, '/');
      if (matchsTrouves.length === 0) {
        const regexObjJson = /\{[^{}]{15,1500}\}/g;
        let mObj;
        while ((mObj = regexObjJson.exec(htmlDecode)) !== null) {
          if (mObj[0].toUpperCase().indexOf(motCle) !== -1) chercherMatchsDansJson(mObj[0], motCle, matchsTrouves, null);
        }
      }

      matchsTrouves.forEach(function(m) {
        if (estCoupe) {
          m.isCoupe = true;
          m.statut = 'Détecté (Coupe de France)';
        }
      });

      return { matchs: matchsTrouves, poulesAnnexes: poulesAnnexes };
    }

    for (let uIdx = 0; uIdx < urlsBrutes.length; uIdx++) {
      const uNorm = normaliserUrlFFHB(urlsBrutes[uIdx]);
      if (!uNorm) continue;
      const estCoupe = /coupe-de-france|coupe/i.test(uNorm);
      let urlBase = uNorm.replace(/\/journee-\d+.*$/i, '').replace(/\/+$/, '') + '/';

      const scanInit = scannerUrl(urlBase, estCoupe);
      scanInit.matchs.forEach(function(m) { tousLesMatchsGlobaux.push(m); });

      let matchSemaine = chercherDansSemaine(scanInit.matchs);
      if (matchSemaine) return enrichirSalleMatch(matchSemaine);

      if (estCoupe && scanInit.poulesAnnexes && scanInit.poulesAnnexes.length > 0) {
        for (let pIdx = 0; pIdx < scanInit.poulesAnnexes.length; pIdx++) {
          const pId = scanInit.poulesAnnexes[pIdx];
          const urlSubPoule = urlBase + 'poule-' + pId + '/';
          const scanSub = scannerUrl(urlSubPoule, true);
          scanSub.matchs.forEach(function(m) { tousLesMatchsGlobaux.push(m); });
          matchSemaine = chercherDansSemaine(scanSub.matchs);
          if (matchSemaine) return enrichirSalleMatch(matchSemaine);
        }
      }

      if (!estCoupe) {
        for (let numJ = 1; numJ <= 22; numJ++) {
          const scanJ = scannerUrl(urlBase + 'journee-' + numJ + '/', false);
          if (scanJ.matchs.length === 0) continue;
          scanJ.matchs.forEach(function(m) { tousLesMatchsGlobaux.push(m); });
          matchSemaine = chercherDansSemaine(scanJ.matchs);
          if (matchSemaine) {
            matchSemaine.statut = 'Détecté (Journée ' + numJ + ')';
            return enrichirSalleMatch(matchSemaine);
          }
          if (scanJ.matchs[0].dateObj > dateFinSemaine) break;
        }
      }
    }

    if (tousLesMatchsGlobaux.length > 0) {
      tousLesMatchsGlobaux.sort(function(a, b) { return a.dateObj.getTime() - b.dateObj.getTime(); });
      const prochain = tousLesMatchsGlobaux.find(function(m) { return m.dateObj > dateFinSemaine; }) || tousLesMatchsGlobaux[tousLesMatchsGlobaux.length - 1];
      const detailProchain = (prochain.isCoupe ? ' [Coupe] ' : ' ') + prochain.dateTexte;
      return { found: false, statut: 'Exempt / Repos cette semaine (prochain match :' + detailProchain + ')' };
    }

    return { found: false, statut: 'Aucun match trouvé sur FFHB' };
  } catch (e) {
    return { found: false, statut: 'Erreur script : ' + e.message };
  }
}

function extraireSalleDepuisPageFFHB(urlMatch) {
  try {
    const resp = UrlFetchApp.fetch(urlMatch, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9'
      }
    });
    const html = resp.getContentText('UTF-8');
    const regexAttr = /attributes=["']([^"']+)["']/gi;
    let mAttr;
    while ((mAttr = regexAttr.exec(html)) !== null) {
      try {
        const jsonStr = decoderEntites(mAttr[1]);
        const obj = JSON.parse(jsonStr);
        const s = chercherChampSalleRecursif(obj);
        if (s) return s;
      } catch (e) {}
    }
    const regexSalle = /(?:Gymnase|Salle|Complexe|Palais des sports|Halle)\s+[^<"\n\r]{3,60}/i;
    const mSalle = html.match(regexSalle);
    if (mSalle) {
      const propre = decoderEntites(mSalle[0]).replace(/\s+/g, ' ').trim();
      if (propre.length > 5) return propre;
    }
  } catch (e) {
    Logger.log('Erreur extraction salle FFHB: ' + e.message);
  }
  return '';
}

function chercherChampSalleRecursif(noeud) {
  if (!noeud) return '';
  if (typeof noeud === 'object') {
    if (noeud.equipement) {
      const eq = noeud.equipement;
      const nom = eq.libelle || eq.nom || eq.name || '';
      const ville = eq.ville || eq.commune || eq.city || '';
      if (nom) return ville ? (nom + ' (' + ville + ')') : nom;
    }
    if (noeud.salle) {
      const sal = noeud.salle;
      if (typeof sal === 'string' && sal.length > 3 && !estNombrePur(sal)) return sal;
      if (typeof sal === 'object') {
        const nomS = sal.libelle || sal.nom || sal.name || '';
        if (nomS) return nomS;
      }
    }
    if (noeud.gymnase) {
      const gym = noeud.gymnase;
      if (typeof gym === 'string' && gym.length > 3 && !estNombrePur(gym)) return gym;
      if (typeof gym === 'object') {
        const nomG = gym.libelle || gym.nom || gym.name || '';
        if (nomG) return nomG;
      }
    }
    const cles = Object.keys(noeud);
    for (let i = 0; i < cles.length; i++) {
      const k = cles[i].toLowerCase();
      if (k.indexOf('equipement') !== -1 || k.indexOf('salle') !== -1 || k.indexOf('lieu') !== -1) {
        const val = noeud[cles[i]];
        if (typeof val === 'string' && val.length > 3 && !estNombrePur(val) && !/url|id|code|date/i.test(k)) {
          return val;
        }
      }
      if (typeof noeud[cles[i]] === 'object') {
        const res = chercherChampSalleRecursif(noeud[cles[i]]);
        if (res) return res;
      }
    }
  }
  return '';
}

function nettoyerNomClub(nom) {
  const FIN = String.fromCharCode(36);
  const propre = nom
    .replace(/^(CS|COM|AS|ES|US|HBC|HB|ENT\.|STADE DE|ATHLETIC CLUB|CLUB OLYMPIQUE MULTISPORT DE)\s+/i, '')
    .replace(new RegExp('\\s+HANDBALL.*' + FIN, 'i'), '')
    .replace(new RegExp('\\s+\\d+[A-Z]?' + FIN, 'i'), '')
    .trim();
  return propre.charAt(0).toUpperCase() + propre.slice(1).toLowerCase();
}

function calculerHeureRdv(heureStr, delaiHeures) {
  const parts = heureStr.toLowerCase().split('h');
  const totalMinutes = (parseInt(parts[0], 10) * 60 + (parts[1] ? parseInt(parts[1], 10) : 0)) - Math.round(delaiHeures * 60);
  const rdvH = Math.floor(totalMinutes / 60), rdvM = totalMinutes % 60;
  return rdvM === 0 ? (rdvH + 'h') : (rdvH + 'h' + (rdvM < 10 ? '0' + rdvM : rdvM));
}

function convertirDateFr(jour, moisNom, annee) {
  const moisMap = { 'janvier': 0, 'février': 1, 'fevrier': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5, 'juillet': 6, 'août': 7, 'aout': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11, 'decembre': 11 };
  return new Date(annee, moisMap[moisNom] || 0, jour, 12, 0, 0);
}

function getLundiSemaineEnCours(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function declencherActionGitHub(eventType, extraPayload) {
  const ss = getSpreadsheet();
  const cfg = getClubConfig(ss);
  if (!cfg.githubRepo || !cfg.githubToken) {
    throw new Error('Dépôt ou Token GitHub non configuré dans l\'onglet Configuration.');
  }
  const clientPayload = extraPayload || {};
  clientPayload.group_id = cfg.groupId;

  UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.githubRepo + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + cfg.githubToken, 'Accept': 'application/vnd.github+json' },
    payload: JSON.stringify({ event_type: eventType, client_payload: clientPayload })
  });
}

/**
 * Réinitialise les disponibilités, entraînements et compositions lors de l'envoi d'un nouveau sondage :
 * 1. Votes_Semaine : réinitialise tous les joueurs de l'Effectif à 0 entraînement et 'NON' pour la nouvelle semaine
 * 2. Entrainements : purge les séances d'entraînement de la semaine précédente
 * 3. Compositions : purge l'historique et ne conserve UNIQUEMENT que la dernière composition validée (la précédente)
 * 4. Brouillon_Compo : réinitialise le terrain tactique pour repartir sur une nouvelle feuille de match
 */
function reinitialiserPourNouvelleSemaine(ss) {
  if (!ss) ss = getSpreadsheet();
  if (!ss) return { ok: false, error: 'Classeur introuvable' };

  const cfg = getClubConfig(ss);

  // 1. Réinitialisation de l'onglet 'Votes_Semaine'
  try {
    let shVotes = ss.getSheetByName('Votes_Semaine');
    if (!shVotes) {
      shVotes = ss.insertSheet('Votes_Semaine');
    }
    const shEff = ss.getSheetByName('Effectif');
    if (shVotes) {
      const seances = (cfg.seancesTrain && cfg.seancesTrain.length) ? cfg.seancesTrain.filter(function(s) {
        return s.actif !== false && s.actif !== 'NON' && !/match|poule|coupe|championnat/i.test(s.label || '');
      }) : [
        { jour: 'Lundi' }, { jour: 'Mercredi' }
      ];
      const nbCols = 3 + cfg.nbEquipes + seances.length;

      // Réécriture des en-têtes
      const maxTrainStr = 'Nb Entraînements (0-' + seances.length + ')';
      const entetesVotes = ['Joueur', 'Poste', maxTrainStr, 'Dispo ' + cfg.nomEquipe1];
      if (cfg.nbEquipes >= 2) entetesVotes.push('Dispo ' + cfg.nomEquipe2);
      if (cfg.nbEquipes >= 3) entetesVotes.push('Dispo ' + cfg.nomEquipe3);
      seances.forEach(function(s) {
        entetesVotes.push('Dispo ' + (s.jour || 'Entraînement'));
      });

      const colMax = Math.max(shVotes.getLastColumn(), entetesVotes.length + 5);
      if (colMax > entetesVotes.length) {
        shVotes.getRange(1, entetesVotes.length + 1, Math.max(shVotes.getLastRow(), 1), colMax - entetesVotes.length).clear();
      }

      shVotes.getRange(1, 1, 1, entetesVotes.length).setValues([entetesVotes])
        .setBackground(cfg.couleurSecondaire || '#334155')
        .setFontColor(getContrastColor(cfg.couleurSecondaire || '#334155'))
        .setFontWeight('bold')
        .setFontSize(10)
        .setVerticalAlignment('middle')
        .setHorizontalAlignment('center');
      shVotes.setRowHeight(1, 30);

      // Vider tout le contenu sous la ligne 1
      const lastRowVotes = shVotes.getLastRow();
      if (lastRowVotes > 1) {
        shVotes.getRange(2, 1, lastRowVotes - 1, colMax).clearContent();
      }

      // Remplir avec tous les joueurs de l'Effectif
      if (shEff && shEff.getLastRow() > 1) {
        const rowsEff = shEff.getRange(2, 1, shEff.getLastRow() - 1, Math.max(shEff.getLastColumn(), 3)).getValues();
        const lignesInitiales = [];
        rowsEff.forEach(function(r) {
          const rawNom = String(r[0] || '').trim();
          const nom = rawNom.replace(/\s*\([^)]*\)\s*/g, '').trim();
          if (!nom) return;
          let poste = String(r[2] || 'Demi-Centre').trim();
          if (/polyvalent|joueur/i.test(poste)) poste = 'Demi-Centre';

          const ligne = [nom, poste, 0, 'NON'];
          if (cfg.nbEquipes >= 2) ligne.push('NON');
          if (cfg.nbEquipes >= 3) ligne.push('NON');
          for (let s = 0; s < seances.length; s++) {
            ligne.push('NON');
          }
          lignesInitiales.push(ligne);
        });

        lignesInitiales.sort(function(a, b) {
          return String(a[0]).localeCompare(String(b[0]), 'fr', { sensitivity: 'base' });
        });

        if (lignesInitiales.length > 0) {
          shVotes.getRange(2, 1, lignesInitiales.length, nbCols).setValues(lignesInitiales);
          for (let r = 2; r <= lignesInitiales.length + 1; r++) {
            shVotes.setRowHeight(r, 24);
            shVotes.getRange(r, 1, 1, nbCols).setVerticalAlignment('middle');
          }
        }
      }
      shVotes.setHiddenGridlines(false);
    }
  } catch (errVotes) {
    Logger.log('Erreur reinitialiserPourNouvelleSemaine (Votes_Semaine): ' + errVotes.message);
  }

  // 2. Purge de l'onglet 'Entrainements'
  try {
    const shEnt = ss.getSheetByName('Entrainements');
    if (shEnt && shEnt.getLastRow() > 1) {
      shEnt.getRange(2, 1, shEnt.getLastRow() - 1, shEnt.getLastColumn()).clearContent();
    }
  } catch (errEnt) {
    Logger.log('Erreur reinitialiserPourNouvelleSemaine (Entrainements): ' + errEnt.message);
  }

  // 3. Purge de l'onglet 'Compositions' en conservant UNIQUEMENT la composition précédente
  try {
    const shComp = ss.getSheetByName('Compositions');
    if (shComp && shComp.getLastRow() > 1) {
      const lastRow = shComp.getLastRow();
      const lastCol = shComp.getLastColumn();
      if (lastRow > 2) {
        // Récupérer la dernière composition validée (la précédente)
        const derniereCompoVals = shComp.getRange(lastRow, 1, 1, lastCol).getValues();
        // Vider tout le tableau sous l'en-tête
        shComp.getRange(2, 1, lastRow - 1, lastCol).clearContent();
        let dStr = String(derniereCompoVals[0][0] || '');
        if (!/\[pr[ée]c[ée]dente\]/i.test(dStr)) {
          derniereCompoVals[0][0] = '[Précédente] ' + dStr;
        }
        // Réinsérer uniquement la composition précédente en ligne 2
        shComp.getRange(2, 1, 1, lastCol).setValues(derniereCompoVals);
      } else if (lastRow === 2) {
        let dStr = String(shComp.getRange(2, 1).getValue() || '');
        if (dStr && !/\[pr[ée]c[ée]dente\]/i.test(dStr)) {
          shComp.getRange(2, 1).setValue('[Précédente] ' + dStr);
        }
      }
    }
  } catch (errComp) {
    Logger.log('Erreur reinitialiserPourNouvelleSemaine (Compositions): ' + errComp.message);
  }

  // 4. Réinitialisation du Brouillon de Compo pour repartir d'un terrain tactique frais
  try {
    const shBrouillon = ss.getSheetByName('Brouillon_Compo');
    if (shBrouillon && shBrouillon.getLastRow() >= 2) {
      shBrouillon.getRange(2, 1, Math.max(shBrouillon.getLastRow() - 1, 1), 2).clearContent();
    }
    PropertiesService.getScriptProperties().deleteProperty('TACTIQUE_BROUILLON_JSON');
  } catch (errBrouillon) {}

  return { ok: true };
}

/**
 * Menu interactif pour réinitialiser la semaine manuellement
 */
function menuReinitialiserPourNouvelleSemaine() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();
    const rep = ui.alert(
      '🧹 Réinitialiser la semaine',
      'Cette action va :\n' +
      '1. Remettre à zéro les disponibilités (Votes_Semaine) pour tous les joueurs\n' +
      '2. Purger les présences aux entraînements de la semaine précédente\n' +
      '3. Purger les anciennes compositions pour ne conserver que la dernière (la précédente)\n' +
      '4. Réinitialiser le brouillon tactique\n\n' +
      'Confirmez-vous la réinitialisation ?',
      ui.ButtonSet.YES_NO
    );
    if (rep === ui.Button.YES) {
      reinitialiserPourNouvelleSemaine(ss);
      ss.toast('Semaine réinitialisée : disponibilités à zéro, entraînements purgés et composition précédente conservée !', '🧹 Handball Bot', 6);
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur : ' + e.message);
  }
}

function declencherEnvoiWhatsApp(force) {
  const ss = getSpreadsheet();
  const donnees = genererSondageHebdo();
  if (donnees && donnees.enVacances && !force) {
    Logger.log('[Vacances] Envoi WhatsApp ignoré car nous sommes en vacances : ' + donnees.nomVacances);
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast('🏖️ Période de vacances : pas d\'entraînement ni match cette semaine. Aucun sondage envoyé.', '⚡ Handball Bot', 6);
    } catch (e) {}
    return { ok: true, ignoreVacances: true, nomVacances: donnees.nomVacances };
  }
  if (!donnees || !donnees.options || donnees.options.length === 0) {
    Logger.log('Aucune option de sondage disponible. Envoi annulé.');
    return { ok: false, message: 'Aucune option de sondage disponible.' };
  }

  // Réinitialisation automatique pour la nouvelle semaine :
  // Disponibilités remises à zéro, entraînements purgés, seule la composition précédente conservée
  try {
    reinitialiserPourNouvelleSemaine(ss);
  } catch (errReinit) {
    Logger.log('Erreur reinitialiserPourNouvelleSemaine : ' + errReinit.message);
  }

  declencherActionGitHub('send_whatsapp_poll', { poll_title: donnees.titre, poll_options: donnees.options });

  try {
    if (ss) ss.toast('Nouveau sondage envoyé ! Disponibilités et entraînements réinitialisés, composition précédente conservée.', '⚡ Handball Bot', 6);
  } catch (e) {}

  return { ok: true };
}

/**
 * Compare deux versions sémantiques (ex: '1.2.0' et '1.1.0')
 * Renvoie 1 si v1 > v2, -1 si v1 < v2, 0 si égal
 */
function comparerVersionsSemver(v1, v2) {
  const p1 = String(v1 || '0').split('.').map(function(n) { return parseInt(n, 10) || 0; });
  const p2 = String(v2 || '0').split('.').map(function(n) { return parseInt(n, 10) || 0; });
  const maxLen = Math.max(p1.length, p2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Vérifie si une nouvelle version de Handball Bot est disponible sur GitHub
 */
function enregistrerModeFonctionnement(mode) {
  const ss = getSpreadsheet();
  const shCfg = ss ? ss.getSheetByName('Configuration') : null;
  const m = String(mode || 'COMPLET').toUpperCase().trim();
  if (shCfg) {
    try {
      const rows = shCfg.getRange('B18:B45').getValues();
      let rowMode = -1;
      for (let i = 0; i < rows.length; i++) {
        const lbl = String(rows[i][0] || '').toLowerCase();
        if (lbl.includes('mode') && (lbl.includes('fonctionnement') || lbl.includes('bot'))) {
          rowMode = 18 + i;
          break;
        }
      }
      if (rowMode === -1) {
        rowMode = 39;
        shCfg.getRange('B39:D39').setValues([['Mode de Fonctionnement', m, 'Mode actif : COMPLET, FFHB_ONLY ou PRESENCES_ONLY']]);
      } else {
        shCfg.getRange('C' + rowMode).setValue(m);
      }
    } catch (eSheet) {
      Logger.log('Erreur écriture mode dans feuille : ' + eSheet.message);
    }
  }
  try {
    PropertiesService.getScriptProperties().setProperty('MODE_FONCTIONNEMENT', m);
    CacheService.getScriptCache().remove('COACH_DATA_CACHE');
    CacheService.getScriptCache().remove('CLUB_CONFIG_CACHE');
  } catch (e) {}
  return { status: 'success', mode: m };
}

function verifierMiseAJour(force) {
  try {
    const cache = CacheService.getScriptCache();
    if (!force) {
      const cached = cache.get('CACHE_VERIF_MAJ');
      if (cached) {
        return JSON.parse(cached);
      }
    }
    const url = 'https://raw.githubusercontent.com/' + UPSTREAM_TEMPLATE_REPO + '/main/version.json?t=' + new Date().getTime();
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const data = JSON.parse(res.getContentText('UTF-8'));
      const estPlusRecent = comparerVersionsSemver(data.version, APP_VERSION) > 0;
      const majResult = {
        disponible: estPlusRecent,
        versionActuelle: APP_VERSION,
        versionDistante: String(data.version || ''),
        titre: String(data.title || ''),
        date: String(data.releaseDate || ''),
        changelog: Array.isArray(data.changelog) ? data.changelog : [],
        repoUrl: data.repoUrl || ('https://github.com/' + UPSTREAM_TEMPLATE_REPO),
        codeGsUrl: data.codeGsRawUrl || ('https://raw.githubusercontent.com/' + UPSTREAM_TEMPLATE_REPO + '/main/code.gs')
      };
      try {
        cache.put('CACHE_VERIF_MAJ', JSON.stringify(majResult), 1800);
      } catch (eC) {}
      return majResult;
    }
  } catch (e) {}
  return { disponible: false, versionActuelle: APP_VERSION };
}

/**
 * Boîte de dialogue dans Google Sheets pour vérifier les mises à jour
 */
function menuVerifierMiseAJour() {
  const maj = verifierMiseAJour();
  const ui = SpreadsheetApp.getUi();
  if (maj.disponible) {
    const changelogTexte = (maj.changelog && maj.changelog.length > 0) ? ('\n\nNouveautés dans cette version :\n• ' + maj.changelog.join('\n• ')) : '';
    ui.alert(
      '🚀 Nouvelle version disponible : v' + maj.versionDistante,
      'Votre version actuelle : v' + maj.versionActuelle +
      '\nTitre : ' + (maj.titre || 'Mise à jour disponible') +
      (maj.date ? ' (' + maj.date + ')' : '') +
      changelogTexte +
      '\n\n--------------------------------------------' +
      '\nCOMMENT METTRE À JOUR :' +
      '\n1. Google Sheets (code.gs) : Copiez le code mis à jour et collez-le dans Extensions > Apps Script :' +
      '\n' + (maj.codeGsUrl || 'https://github.com/' + UPSTREAM_TEMPLATE_REPO) +
      '\n(Toutes vos données de club, effectif et couleurs sont préservées !)' +
      '\n\n2. Robot WhatsApp (GitHub) : Rendez-vous dans votre dépôt GitHub > Actions > "Sync with Handball Bot Template" > Run workflow.',
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      '✅ Votre Handball Bot est à jour',
      'Vous utilisez la dernière version (v' + maj.versionActuelle + '). Aucune mise à jour requise !',
      ui.ButtonSet.OK
    );
  }
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('⚡ Handball Bot')
      .addItem('🔄 1. Mettre à jour les matchs FFHB et l\'aperçu', 'genererSondageHebdo')
      .addItem('📤 2. Envoyer le sondage sur WhatsApp (GitHub)', 'declencherEnvoiWhatsApp')
      .addSeparator()
      .addItem('📥 3. Récupérer les votes WhatsApp (Pipeline)', 'declencherLectureVotes')
      .addItem('⚡ 4. Importer les votes depuis GitHub (1 sec)', 'synchroniserDepuisGitHub')
      .addItem('🛠️ 5. Mettre à jour les onglets (Conserver mes données)', 'initialiserOngletsWebApp')
      .addItem('⚠️ 6. Réinitialiser à zéro (Nouveau club vierge uniquement)', 'initialiserClasseurComplet')
      .addItem('✨ 7. Réorganiser et embellir tout le classeur', 'menuEmbellirClasseurComplet')
      .addItem('🔄 8. Vérifier les mises à jour du modèle', 'menuVerifierMiseAJour')
      .addSeparator()
      .addItem('🔐 9. Chiffrer tous les numéros de l\'effectif (RGPD)', 'menuChiffrerNumerosEffectif')
      .addItem('🔓 10. Déchiffrer tous les numéros de l\'effectif', 'menuDechiffrerNumerosEffectif')
      .addItem('🧹 11. Purger les absences terminées (Notes & WebApp)', 'menuPurgerAbsencesTerminees')
      .addItem('📋 12. Lister Trésoriers & Chouchoux', 'menuListerTresoriersEtChouchoux')
      .addItem('🏆 13. Actualiser l\'onglet Trophées & Bêtisier', 'menuActualiserTropheesSheet')
      .addItem('📅 14. Actualiser l\'onglet Absences', 'menuActualiserAbsencesSheet')
      .addItem('💰 15. Statut Caisse Noire (Ouvrir / Fermer / Désactiver)', 'menuChangerStatutCaisseNoire')
      .addItem('🏖️ 16. Gérer les Vacances & Trêves', 'menuGererVacances')
      .addItem('💰 17. Actualiser l\'onglet Caisse Noire', 'menuActualiserCaisseNoireSheet')
      .addItem('🚗 18. Actualiser l\'onglet Covoiturage', 'menuActualiserCovoiturageSheet')
      .addItem('🧹 19. Réinitialiser la semaine (Dispos, Entraînements, Compo)', 'menuReinitialiserPourNouvelleSemaine')
      .addItem('📊 20. Associer automatiquement les IDs Spakta à l\'Effectif', 'menuAssocierIdsSpakta')
      .addSeparator()
      .addItem('🚀 Tout exécuter (Mise à jour + Envoi)', 'executionAutoLundiMatin')
      .addToUi();
  } catch (e) {}
}

/**
 * Permet au coach de changer le statut de la Caisse Noire depuis Google Sheets :
 * 1 = OUVERTE (Opérationnelle avec amendes)
 * 2 = FERMÉE (Consultation & soldes uniquement, nouveaux signalements suspendus)
 * 3 = DÉSACTIVÉE (Complètement masquée pour les équipes jeunes)
 */
function menuChangerStatutCaisseNoire() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();
    const props = PropertiesService.getScriptProperties();

    let statutActuel = props.getProperty('CAISSE_NOIRE_STATUT') || '';
    if (!statutActuel) {
      statutActuel = lireStatutCaisseDepuisSheet(ss) || 'ouverte';
    }

    const labels = {
      ouverte: '🟢 OUVERTE (Amendes actives & signalements autorisés)',
      fermee: '🔒 FERMÉE (Consultation & soldes autorisés, nouveaux signalements suspendus)',
      desactivee: '⚪ DÉSACTIVÉE (Entièrement masquée aux joueurs - Recommandé équipes jeunes)'
    };

    const promptText = 
      'Statut actuel de la Caisse Noire : ' + (labels[statutActuel] || statutActuel) + '\n\n' +
      'Entrez le chiffre de votre choix pour modifier le statut :\n' +
      '  1 = 🟢 OUVERTE (Amendes et signalements actifs)\n' +
      '  2 = 🔒 FERMÉE (Soldes et règlements visibles, nouveaux signalements bloqués)\n' +
      '  3 = ⚪ DÉSACTIVÉE (Invisible pour les joueurs / Idéal équipes jeunes)\n\n' +
      'Votre choix (1, 2 ou 3) :';

    const resp = ui.prompt('💰 Gestion du Statut de la Caisse Noire', promptText, ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;

    const saisie = String(resp.getResponseText() || '').trim().toLowerCase();
    let nouveauStatut = null;

    if (saisie === '1' || saisie === 'ouverte' || saisie === 'ouvert' || saisie === 'open') {
      nouveauStatut = 'ouverte';
    } else if (saisie === '2' || saisie === 'fermee' || saisie === 'fermé' || saisie === 'fermee' || saisie === 'fermer' || saisie === 'close') {
      nouveauStatut = 'fermee';
    } else if (saisie === '3' || saisie === 'desactivee' || saisie === 'desactiver' || saisie === 'désactivée' || saisie === 'off') {
      nouveauStatut = 'desactivee';
    } else {
      ui.alert('⚠️ Choix non reconnu. Veuillez saisir 1, 2 ou 3.');
      return;
    }

    // Mise à jour ScriptProperties
    props.setProperty('CAISSE_NOIRE_STATUT', nouveauStatut);

    // Mise à jour de l'objet de config JSON si présent
    try {
      const rawCaisse = props.getProperty('CAISSE_NOIRE_DATA');
      if (rawCaisse) {
        const cData = JSON.parse(rawCaisse);
        if (cData && cData.config) {
          cData.config.statut = nouveauStatut;
          cData.config.active = (nouveauStatut !== 'desactivee');
          cData.config.fermee = (nouveauStatut === 'fermee');
          props.setProperty('CAISSE_NOIRE_DATA', JSON.stringify(cData));
        }
      }
    } catch (e) {}

    // Mise à jour de la feuille Configuration
    synchroniserStatutCaisseSheet(ss, nouveauStatut);

    ui.alert(
      '✅ Statut de la Caisse Noire mis à jour !',
      'Le nouveau statut est : ' + labels[nouveauStatut] + '\n\nCe réglage est immédiatement pris en compte dans la WebApp et l\'onglet Configuration.',
      ui.ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur : ' + e.message);
  }
}

/**
 * Affiche la liste des périodes de vacances et l'état actuel de la semaine dans Google Sheets
 */
function menuGererVacances() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();
    const dataVac = getVacancesData(ss);

    let msg = '';
    if (dataVac.enVacancesCetteSemaine) {
      msg += '🏖️ SEMAINE EN COURS EN VACANCES / TRÊVE !\n';
      msg += '• Période : ' + (dataVac.infoSemaine ? dataVac.infoSemaine.nom : 'En cours') + '\n';
      msg += '• Conséquence : Entraînements suspendus, pas de match officiel, PAS de sondage WhatsApp ce lundi.\n\n';
    } else {
      msg += '🟢 SEMAINE NORMALE (Pas de vacances cette semaine)\n';
      msg += '• Les entraînements, convocations et sondages WhatsApp sont actifs.\n\n';
    }

    msg += '📅 CALENDRIER DES VACANCES CONFIGURÉES (' + (dataVac.periodes ? dataVac.periodes.length : 0) + ') :\n';
    if (dataVac.periodes && dataVac.periodes.length > 0) {
      dataVac.periodes.forEach(function(v) {
        const statut = v.actif ? '🟢 Actif' : '⚪ Désactivé';
        const dDeb = v.dateDebut ? formaterDateFr(v.dateDebut) : '-';
        const dFin = v.dateFin ? formaterDateFr(v.dateFin) : '-';
        msg += '  • ' + (v.nom || 'Période') + ' : ' + dDeb + ' ➔ ' + dFin + ' (' + statut + ')\n';
        if (v.commentaire) {
          msg += '    Note : ' + v.commentaire + '\n';
        }
      });
    } else {
      msg += '  (Aucune période de vacances configurée)\n';
    }

    msg += '\n💡 Pour ajouter, modifier ou désactiver une période :\n';
    msg += '  1. Rendez-vous dans l\'onglet "Vacances" du tableur\n';
    msg += '  2. Ou ouvrez la WebApp Coach ➔ Tuile "Vacances & Trêves"\n';
    msg += 'Toute modification est synchronisée instantanément !';

    ui.alert('🏖️ Gestion des Vacances & Trêves', msg, ui.ButtonSet.OK);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur : ' + e.message);
  }
}

function menuActualiserTropheesSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const res = synchroniserOngletTropheesSheet(ss);
    if (res && res.ok) {
      ss.toast('Onglet "Trophées & Bêtisier" synchronisé avec succès !', '🏆 Handball Bot', 5);
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur lors de la synchronisation : ' + e.message);
  }
}

function menuActualiserAbsencesSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const res = synchroniserOngletAbsencesSheet(ss);
    if (res && res.ok) {
      ss.toast('Onglet "Absences" synchronisé avec succès ! (' + (res.total || 0) + ' absence(s))', '📅 Handball Bot', 5);
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur lors de la synchronisation des absences : ' + e.message);
  }
}

/**
 * Actualise l'onglet "Caisse Noire" depuis le menu Google Sheets
 */
function menuActualiserCaisseNoireSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const res = synchroniserOngletCaisseNoireSheet(ss);
    if (res && res.ok) {
      ss.toast('Onglet "Caisse Noire" synchronisé avec succès ! (' + (res.nbAmendes || 0) + ' amende(s))', '💰 Handball Bot', 5);
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur lors de la synchronisation de la Caisse Noire : ' + e.message);
  }
}

/**
 * Actualise l'onglet "Covoiturage" depuis le menu Google Sheets
 */
function menuActualiserCovoiturageSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const res = synchroniserOngletCovoiturageSheet(ss);
    if (res && res.ok) {
      ss.toast('Onglet "Covoiturage" synchronisé avec succès ! (' + (res.total || 0) + ' participant(s))', '🚗 Handball Bot', 5);
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur lors de la synchronisation du covoiturage : ' + e.message);
  }
}

function menuPurgerAbsencesTerminees() {
  try {
    const actives = purgerAbsencesTerminees();
    const nbActives = actives ? actives.length : 0;
    SpreadsheetApp.getActiveSpreadsheet().toast('Purge terminée avec succès ! ' + nbActives + ' absence(s) active(s) restante(s).', '🧹 Purge Absences', 5);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur lors de la purge : ' + e.message);
  }
}

/**
 * Affiche la liste des Trésoriers et Chouchoux dans une boîte de dialogue Google Sheets
 */
function menuListerTresoriersEtChouchoux() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const res = synchroniserTresoriersEtChouchouxSheet(ss, 'auto');
    const ui = SpreadsheetApp.getUi();

    let msg = '';
    msg += '💰 TRÉSORIERS CAISSE NOIRE (' + (res.tresoriers ? res.tresoriers.length : 0) + ') :\n';
    if (res.tresoriers && res.tresoriers.length > 0) {
      res.tresoriers.forEach(function(nom) {
        msg += '  • ' + nom + '\n';
      });
    } else {
      msg += '  (Aucun trésorier configuré)\n';
    }

    msg += '\n❤️ CHOUCHOU(X) DU COACH (' + (res.chouchoux ? res.chouchoux.length : 0) + ') :\n';
    if (res.chouchoux && res.chouchoux.length > 0) {
      res.chouchoux.forEach(function(nom) {
        msg += '  • ' + nom + '\n';
      });
    } else {
      msg += '  (Aucun chouchou configuré)\n';
    }

    msg += '\n💡 Astuce : Vous pouvez modifier les trésoriers et chouchoux :\n';
    msg += '  1. Dans l\'onglet "Effectif" (Colonnes H "Trésorier" & I "Chouchou" avec OUI/NON)\n';
    msg += '  2. Dans l\'onglet "Configuration" (Lignes Trésoriers & Chouchou)\n';
    msg += '  3. Directement depuis la WebApp (Espace Coach / Fiche joueur)\n';
    msg += 'Toutes les modifications sont synchronisées automatiquement !';

    ui.alert('📋 Trésoriers & Chouchoux du Club', msg, ui.ButtonSet.OK);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur : ' + e.message);
  }
}

/**
 * Déclencheur automatique lors de modifications manuelles dans les onglets Google Sheets
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (!sheet) return;
    const sheetName = sheet.getName();
    const row = e.range.getRow();
    const col = e.range.getColumn();

    // 1. Modification dans l'onglet Effectif sur colonnes Trésorier (Col H = 8) ou Chouchou (Col I = 9)
    if (sheetName === 'Effectif' && row > 1 && (col === 8 || col === 9)) {
      const ss = e.source || sheet.getParent();
      synchroniserTresoriersEtChouchouxSheet(ss, 'effectif');
      try {
        ss.toast('Trésoriers et Chouchoux synchronisés !', '⚡ Handball Bot', 3);
      } catch (err) {}
    }

    // 2. Modification dans l'onglet Configuration sur la colonne C (valeurs)
    if (sheetName === 'Configuration' && col === 3 && row >= 18 && row <= 38) {
      const label = String(sheet.getRange(row, 2).getValue() || '').toLowerCase();
      if (label.indexOf('trésorier') !== -1 || label.indexOf('tresorier') !== -1 || label.indexOf('chouchou') !== -1) {
        const ss = e.source || sheet.getParent();
        synchroniserTresoriersEtChouchouxSheet(ss, 'configuration');
        try {
          ss.toast('Effectif synchronisé avec la Configuration !', '⚡ Handball Bot', 3);
        } catch (err) {}
      } else if (label.indexOf('caisse') !== -1) {
        const valStr = String(sheet.getRange(row, 3).getValue() || '').trim().toLowerCase();
        let st = 'ouverte';
        if (/non|d[eé]sactiv[eé]e?|off|false|0/i.test(valStr)) st = 'desactivee';
        else if (/ferm[eé]e?|cl[oô]tur[eé]e?|close|bloqu[eé]e?/i.test(valStr)) st = 'fermee';
        
        const props = PropertiesService.getScriptProperties();
        props.setProperty('CAISSE_NOIRE_STATUT', st);
        try {
          const rawCaisse = props.getProperty('CAISSE_NOIRE_DATA');
          if (rawCaisse) {
            const cData = JSON.parse(rawCaisse);
            if (cData && cData.config) {
              cData.config.statut = st;
              cData.config.active = (st !== 'desactivee');
              cData.config.fermee = (st === 'fermee');
              props.setProperty('CAISSE_NOIRE_DATA', JSON.stringify(cData));
            }
          }
        } catch (errJson) {}
        try {
          const ss = e.source || sheet.getParent();
          ss.toast('Statut Caisse Noire synchronisé : ' + st.toUpperCase() + ' !', '⚡ Handball Bot', 3);
        } catch (errToast) {}
      } else if (label.indexOf('mvp') !== -1 || row === 37) {
        const valStr = String(sheet.getRange(row, 3).getValue() || '').trim();
        const props = PropertiesService.getScriptProperties();
        props.setProperty('MVP_NOM', valStr);
        const ss = e.source || sheet.getParent();
        try { synchroniserOngletTropheesSheet(ss); } catch (errSync) {}
        try {
          ss.toast('MVP du match mis à jour : ' + (valStr || 'Aucun') + ' !', '🏆 Handball Bot', 3);
        } catch (errToast) {}
      } else if (label.indexOf('chèvre') !== -1 || label.indexOf('chevre') !== -1 || row === 38) {
        const valStr = String(sheet.getRange(row, 3).getValue() || '').trim();
        const props = PropertiesService.getScriptProperties();
        props.setProperty('CHEVRE_NOM', valStr);
        const ss = e.source || sheet.getParent();
        try { synchroniserOngletTropheesSheet(ss); } catch (errSync) {}
        try {
          ss.toast('Chèvre du match mise à jour : ' + (valStr || 'Aucune') + ' !', '🐐 Handball Bot', 3);
        } catch (errToast) {}
      }
    }

    // 3. Modification dans l'onglet Vacances sur les lignes de données (Row >= 4)
    if (sheetName === 'Vacances' && row >= 4) {
      const ss = e.source || sheet.getParent();
      const vacs = lireVacancesDepuisSheet(ss);
      PropertiesService.getScriptProperties().setProperty('VACANCES_CONFIG_JSON', JSON.stringify(vacs));
      try {
        ss.toast('Périodes de vacances synchronisées (' + vacs.length + ' période(s)) !', '🏖️ Handball Bot', 3);
      } catch (err) {}
    }

    // 4. Modification dans l'onglet Caisse Noire sur les lignes de données (Row >= 6)
    if (sheetName === 'Caisse Noire' && row >= 6) {
      const ss = e.source || sheet.getParent();
      const caisseObj = lireCaisseNoireDepuisSheet(ss);
      if (caisseObj) {
        PropertiesService.getScriptProperties().setProperty('CAISSE_NOIRE_DATA', JSON.stringify(caisseObj));
        try {
          ss.toast('Caisse Noire synchronisée (' + (caisseObj.amendes ? caisseObj.amendes.length : 0) + ' amende(s)) !', '💰 Handball Bot', 3);
        } catch (err) {}
      }
    }

    // 5. Modification dans l'onglet Covoiturage sur les lignes de données (Row >= 5)
    if (sheetName === 'Covoiturage' && row >= 5) {
      const ss = e.source || sheet.getParent();
      const covObj = lireCovoiturageDepuisSheet(ss);
      if (covObj) {
        PropertiesService.getScriptProperties().setProperty('COVOITURAGE_DATA', JSON.stringify(covObj));
        const total = (covObj.conducteurs ? covObj.conducteurs.length : 0) + (covObj.passagers ? covObj.passagers.length : 0);
        try {
          ss.toast('Covoiturage synchronisé (' + total + ' participant(s)) !', '🚗 Handball Bot', 3);
        } catch (err) {}
      }
    }

    // 6. Modification dans l'onglet Absences sur les lignes de données (Row >= 5)
    if (sheetName === 'Absences' && row >= 5) {
      const ss = e.source || sheet.getParent();
      const absList = lireAbsencesDepuisSheet(ss) || [];
      PropertiesService.getScriptProperties().setProperty('ABSENCES_JOUEURS', JSON.stringify(absList));
      try {
        ss.toast('Absences synchronisées (' + absList.length + ' absence(s)) !', '📅 Handball Bot', 3);
      } catch (err) {}
    }

    // 7. Modification dans l'onglet Trophées & Bêtisier sur les colonnes de données brutes (Cols H à N = 8 à 14, Row >= 6)
    if (sheetName === 'Trophées & Bêtisier' && row >= 6 && col >= 8) {
      const ss = e.source || sheet.getParent();
      const mvpVotes = lireVotesMvpDepuisSheet(ss);
      if (mvpVotes) {
        PropertiesService.getScriptProperties().setProperty('VOTES_MVP_DATA', JSON.stringify(mvpVotes));
      }
      const chData = lireChevreDepuisSheet(ss);
      if (chData) {
        PropertiesService.getScriptProperties().setProperty('CHEVRE_DATA', JSON.stringify(chData));
      }
      try {
        ss.toast('Votes & Bêtisier synchronisés depuis le tableau !', '🏆 Handball Bot', 3);
      } catch (err) {}
    }
  } catch (err) {}
}



/**
 * HANDBALL BOT 2.0 - INTEGRATION STATS OFFICIELLES SPAKTA (ÉQUIPES 1B & 1C)
 * Interroge l'API Spakta pour la saison 2026-2027 et met en cache pour 2 heures
 */
function recupererStatsSpaktaClub() {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('SPAKTA_STATS_26_27_V2');
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }
  } catch (eCacheRead) {}

  const token = 'XgcvHwmAkI62FOcPJRY3n5LRe_P-86a89Q1_5d7fbUM';
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/json'
  };

  const teams = [
    { code: '1C', slug: '01M2MNTEEPCGH2QK1ZWVJE451C', nom: 'Seniors M 1C' },
    { code: '1B', slug: '01M2MNRJ49XV8NFGDJTTF8QD1G', nom: 'Seniors M 1B' }
  ];

  const joueursMap = {};

  teams.forEach(function(t) {
    try {
      const url = 'https://scout.spakta.com/api/v1/teams/' + t.slug + '/stats?season=2026-2027';
      const resp = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: headers,
        muteHttpExceptions: true
      });
      if (resp && resp.getResponseCode() === 200) {
        const data = JSON.parse(resp.getContentText());
        (data.players || []).forEach(function(p) {
          const pid = p.id || p.name;
          if (!joueursMap[pid]) {
            joueursMap[pid] = {
              id: p.id,
              name: p.name,
              position: p.position || '',
              is_goalkeeper: Boolean(p.is_goalkeeper),
              jersey_numbers: p.jersey_numbers || [],
              teams: [t.code],
              sheets: Number(p.sheets || 0),
              totals: {
                goals: Number((p.totals && p.totals.goals) || 0),
                goals_7m: Number((p.totals && p.totals.goals_7m) || 0),
                shots: Number((p.totals && p.totals.shots) || 0),
                attempts: Number((p.totals && p.totals.attempts) || 0),
                saves: Number((p.totals && p.totals.saves) || 0),
                two_minutes: Number((p.totals && p.totals.two_minutes) || 0),
                yellow_cards: Number((p.totals && p.totals.yellow_cards) || 0)
              },
              matches: []
            };
          } else {
            if (joueursMap[pid].teams.indexOf(t.code) === -1) {
              joueursMap[pid].teams.push(t.code);
            }
            (p.jersey_numbers || []).forEach(function(num) {
              if (joueursMap[pid].jersey_numbers.indexOf(num) === -1) {
                joueursMap[pid].jersey_numbers.push(num);
              }
            });
            joueursMap[pid].sheets += Number(p.sheets || 0);
            joueursMap[pid].totals.goals += Number((p.totals && p.totals.goals) || 0);
            joueursMap[pid].totals.goals_7m += Number((p.totals && p.totals.goals_7m) || 0);
            joueursMap[pid].totals.shots += Number((p.totals && p.totals.shots) || 0);
            joueursMap[pid].totals.attempts += Number((p.totals && p.totals.attempts) || 0);
            joueursMap[pid].totals.saves += Number((p.totals && p.totals.saves) || 0);
            joueursMap[pid].totals.two_minutes += Number((p.totals && p.totals.two_minutes) || 0);
            joueursMap[pid].totals.yellow_cards += Number((p.totals && p.totals.yellow_cards) || 0);
          }

          (p.matches || []).forEach(function(m) {
            joueursMap[pid].matches.push({
              teamCode: t.code,
              date: m.date || '',
              opponent: m.opponent || '',
              side: m.side || 'HOME',
              score_for: Number(m.score_for || 0),
              score_against: Number(m.score_against || 0),
              jersey_number: m.jersey_number || 0,
              goals: Number(m.goals || 0),
              goals_7m: Number(m.goals_7m || 0),
              shots: Number(m.shots || 0),
              attempts: Number(m.attempts || 0),
              saves: Number(m.saves || 0),
              two_minutes: Number(m.two_minutes || 0)
            });
          });
        });
      }
    } catch (errFetch) {
      Logger.log('Erreur fetch Spakta ' + t.code + ' : ' + errFetch.message);
    }
  });

  const joueursList = Object.keys(joueursMap).map(function(k) {
    const j = joueursMap[k];
    j.matches.sort(function(a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    const nbS = j.sheets > 0 ? j.sheets : 1;
    j.per_sheet = {
      goals: Math.round((j.totals.goals / nbS) * 10) / 10,
      saves: Math.round((j.totals.saves / nbS) * 10) / 10,
      two_minutes: Math.round((j.totals.two_minutes / nbS) * 10) / 10
    };
    if (j.totals.attempts > 0) {
      j.efficiency = Math.round((j.totals.goals / j.totals.attempts) * 1000) / 1000;
    } else {
      j.efficiency = 0;
    }
    return j;
  });

  const payload = {
    saison: '2026-2027',
    equipes: ['1B', '1C'],
    joueurs: joueursList,
    misAJourLe: new Date().toISOString()
  };

  try {
    const str = JSON.stringify(payload);
    if (str.length < 99000) {
      CacheService.getScriptCache().put('SPAKTA_STATS_26_27_V2', str, 7200);
    }
  } catch (eC) {}

  return payload;
}

/**
 * HANDBALL BOT 2.0 - LIAISON AUTOMATIQUE DES IDS SPAKTA AVEC L'EFFECTIF
 * Dictionnaire de référence des identifiants officiels Spakta Scout (ACBB 2026-2027)
 */
const ACBB_SPAKTA_MAPPING_DEFAUT = {
  // Gardiens
  'pierre j': '01M2MP32GTE7FZ5WRG62DR4ZF2',
  'pierre jouanno': '01M2MP32GTE7FZ5WRG62DR4ZF2',
  'jouanno pierre': '01M2MP32GTE7FZ5WRG62DR4ZF2',
  'arnaud a': '01M2MNT8ETPF2DEPH8QPADVDXW',
  'arnaud arches': '01M2MNT8ETPF2DEPH8QPADVDXW',
  'arches arnaud': '01M2MNT8ETPF2DEPH8QPADVDXW',
  'gaetan p': '01M2X7716Q9TA0RZH9SVNWKVD4',
  'gaetan pagnat': '01M2X7716Q9TA0RZH9SVNWKVD4',
  'pagnat gaetan': '01M2X7716Q9TA0RZH9SVNWKVD4',
  'louis j': '01M2K0C3XQN84E2FRDH0PMGQ4Q',
  'louis jeissou': '01M2K0C3XQN84E2FRDH0PMGQ4Q',
  'jeissou louis': '01M2K0C3XQN84E2FRDH0PMGQ4Q',

  // Buteurs & Joueurs de champ
  'thomas b': '01M2MP32G366W0BN0HFYG0R9H6',
  'thomas buccellato': '01M2MP32G366W0BN0HFYG0R9H6',
  'buccellato thomas': '01M2MP32G366W0BN0HFYG0R9H6',
  'david d': '01M2MP32GF39WYTEGQX0GD60QA',
  'david di giovani': '01M2MP32GF39WYTEGQX0GD60QA',
  'di giovani david': '01M2MP32GF39WYTEGQX0GD60QA',
  'thomas m': '01M2MP32H1JJ33WT7JHEXKCJX4',
  'thomas mercier': '01M2MP32H1JJ33WT7JHEXKCJX4',
  'mercier thomas-yves-roger': '01M2MP32H1JJ33WT7JHEXKCJX4',
  'clement p': '01M2MP32HFCXDY6XC3Z8BPGVQH',
  'clement paret': '01M2MP32HFCXDY6XC3Z8BPGVQH',
  'paret clement': '01M2MP32HFCXDY6XC3Z8BPGVQH',
  'paul-henri': '01M3HTE6FYSEPYR2PA46VZVVQ6',
  'paul henri': '01M3HTE6FYSEPYR2PA46VZVVQ6',
  'paul-henri v': '01M3HTE6FYSEPYR2PA46VZVVQ6',
  'paul-henri van leeuwen': '01M3HTE6FYSEPYR2PA46VZVVQ6',
  'van leeuwen paul-henri': '01M3HTE6FYSEPYR2PA46VZVVQ6',
  'kevin': '01M2ZSMVKCABV0WA3NG8FD1V86',
  'kevin l': '01M2ZSMVKCABV0WA3NG8FD1V86',
  'kevin le bihan': '01M2ZSMVKCABV0WA3NG8FD1V86',
  'le bihan kevin': '01M2ZSMVKCABV0WA3NG8FD1V86',
  'corentin': '01M2ZSMVJP0M9HYZPGNF77TTT0',
  'corentin d': '01M2ZSMVJP0M9HYZPGNF77TTT0',
  'corentin denant': '01M2ZSMVJP0M9HYZPGNF77TTT0',
  'denant corentin': '01M2ZSMVJP0M9HYZPGNF77TTT0',
  'clement d': '01M2MNT8FR8YW3RMC0TRKA49Y9',
  'clement deniaux': '01M2MNT8FR8YW3RMC0TRKA49Y9',
  'deniaux clement': '01M2MNT8FR8YW3RMC0TRKA49Y9',
  'killian': '01M2MP32GNDFQ9P8CFMAMHCB13',
  'killian h': '01M2MP32GNDFQ9P8CFMAMHCB13',
  'killian henry': '01M2MP32GNDFQ9P8CFMAMHCB13',
  'henry killian': '01M2MP32GNDFQ9P8CFMAMHCB13',
  'gabriel s': '01M43VYNXT6ZN1XF962WZB5N5H',
  'gabriel seijas': '01M43VYNXT6ZN1XF962WZB5N5H',
  'seijas gabriel': '01M43VYNXT6ZN1XF962WZB5N5H',
  'matthieu': '01M2ZSMVM7CNQFSS2SHST692Q5',
  'matthieu y': '01M2ZSMVM7CNQFSS2SHST692Q5',
  'matthieu yaghi': '01M2ZSMVM7CNQFSS2SHST692Q5',
  'yaghi matthieu': '01M2ZSMVM7CNQFSS2SHST692Q5',
  'arnaud p': '01M2MP32H7BF0M0RVM78YGKCMS',
  'arnaud paitier': '01M2MP32H7BF0M0RVM78YGKCMS',
  'paitier arnaud': '01M2MP32H7BF0M0RVM78YGKCMS',
  'francois v': '01M2ZSMVM13KAY4VAM0CEEACW1',
  'francois vivier': '01M2ZSMVM13KAY4VAM0CEEACW1',
  'vivier francois': '01M2ZSMVM13KAY4VAM0CEEACW1',
  'benjamin d': '01M2MP32G9GP6AX7ETHXT3RZYK',
  'benjamin deshayes': '01M2MP32G9GP6AX7ETHXT3RZYK',
  'deshayes benjamin': '01M2MP32G9GP6AX7ETHXT3RZYK',
  'docteur louis m': '01M4KR31SKSQVWSS56PTSFR3Q9',
  'louis m': '01M4KR31SKSQVWSS56PTSFR3Q9',
  'louis mazaud': '01M4KR31SKSQVWSS56PTSFR3Q9',
  'mazaud louis': '01M4KR31SKSQVWSS56PTSFR3Q9',
  'eliott': '01M4KR31TC64EP5906A1259DN8',
  'eliott s': '01M4KR31TC64EP5906A1259DN8',
  'eliott settelen': '01M4KR31TC64EP5906A1259DN8',
  'settelen eliott': '01M4KR31TC64EP5906A1259DN8',
  'ethan': '01M2MNT8GX6WXSW291TZZVHFCP',
  'ethan l': '01M2MNT8GX6WXSW291TZZVHFCP',
  'ethan legay': '01M2MNT8GX6WXSW291TZZVHFCP',
  'legay ethan': '01M2MNT8GX6WXSW291TZZVHFCP',
  'remy p': '01M2MNT8HEPWB4GAHNPA3RXC8P',
  'remy pichery': '01M2MNT8HEPWB4GAHNPA3RXC8P',
  'pichery remy': '01M2MNT8HEPWB4GAHNPA3RXC8P',
  'francois b': '01M2MNT8FAVVTZMD5GK8C4K3WP',
  'francois bastard': '01M2MNT8FAVVTZMD5GK8C4K3WP',
  'bastard francois': '01M2MNT8FAVVTZMD5GK8C4K3WP',
  'zine': '01M2XVVGHYH37MAMHJWW8GRJ0K',
  'zine b': '01M2XVVGHYH37MAMHJWW8GRJ0K',
  'zine eddine': '01M2XVVGHYH37MAMHJWW8GRJ0K',
  'zine eddine bouhadda': '01M2XVVGHYH37MAMHJWW8GRJ0K',
  'bouhadda zine eddine': '01M2XVVGHYH37MAMHJWW8GRJ0K',
  'theotime': '01M2KJ820MVH1DDK9CX6901ZYM',
  'theotime d': '01M2KJ820MVH1DDK9CX6901ZYM',
  'theotime delpeyrat': '01M2KJ820MVH1DDK9CX6901ZYM',
  'delpeyrat theotime': '01M2KJ820MVH1DDK9CX6901ZYM',
  'emilien': '01M2MNT8H3FG7VB5YHR2F82FR2',
  'emilien l': '01M2MNT8H3FG7VB5YHR2F82FR2',
  'emilien lemonnier': '01M2MNT8H3FG7VB5YHR2F82FR2',
  'lemonnier emilien': '01M2MNT8H3FG7VB5YHR2F82FR2',
  'tom c': '01M2MNT8FHVZ8V8DHJ0QBQTBGM',
  'tom chardon': '01M2MNT8FHVZ8V8DHJ0QBQTBGM',
  'chardon tom': '01M2MNT8FHVZ8V8DHJ0QBQTBGM',
  'evra': '01M2MNT8G7Z8QKD25M6PEK61G3',
  'evra i': '01M2MNT8G7Z8QKD25M6PEK61G3',
  'evra igouwe': '01M2MNT8G7Z8QKD25M6PEK61G3',
  'igouwe evra': '01M2MNT8G7Z8QKD25M6PEK61G3',
  'noha k': '01M2KJ821BN9KFK61N532F0F0Z',
  'noha kolivai': '01M2KJ821BN9KFK61N532F0F0Z',
  'kolivai noha': '01M2KJ821BN9KFK61N532F0F0Z',
  'clement l': '01M2MNT8GP8WWQ49ZHHD8DW3AJ',
  'clement lecoq': '01M2MNT8GP8WWQ49ZHHD8DW3AJ',
  'lecoq clement': '01M2MNT8GP8WWQ49ZHHD8DW3AJ',
  'stephane m': '01M2K9PQ6S2J5G86AY21SC84N6',
  'stephane miezin': '01M2K9PQ6S2J5G86AY21SC84N6',
  'miezin stephane': '01M2K9PQ6S2J5G86AY21SC84N6',
  'gaspard d': '01M2MNT8FZGA3M505EK5TPFDJ1',
  'gaspard dreano': '01M2MNT8FZGA3M505EK5TPFDJ1',
  'dreano--hohman gaspard': '01M2MNT8FZGA3M505EK5TPFDJ1'
};

/**
 * Normalise une chaîne de caractères pour faciliter la comparaison de noms
 */
function normaliserChaineComparaison(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Associe et préremplit automatiquement les IDs Spakta pour tous les joueurs de l'onglet Effectif
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ssOpt]
 * @param {boolean} [forcer] - Si true, réécrase même si déjà renseigné
 */
function preRemplirIdsSpaktaEffectif(ssOpt, forcer) {
  const ss = ssOpt || getSpreadsheet();
  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) return { ok: false, message: 'Onglet Effectif introuvable' };

  // S'assurer de la présence de l'en-tête Colonne J
  try {
    const j1 = shEff.getRange('J1').getValue();
    if (!j1) {
      shEff.getRange('J1').setValue('ID Spakta')
        .setBackground('#0f172a')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(10)
        .setVerticalAlignment('middle')
        .setHorizontalAlignment('center');
      shEff.setColumnWidth(10, 240);
    }
  } catch (eH) {}

  const lastRow = shEff.getLastRow();
  if (lastRow < 2) return { ok: true, total: 0, associes: 0, dejaRenseignes: 0, nonTrouves: 0, nonTrouvesNoms: [] };

  const spaktaData = recupererStatsSpaktaClub();
  const spaktaJoueurs = (spaktaData && Array.isArray(spaktaData.joueurs)) ? spaktaData.joueurs : [];

  // Lecture de toutes les lignes de l'effectif (cols A à J)
  const range = shEff.getRange(2, 1, lastRow - 1, 10);
  const rows = range.getValues();

  let associes = 0;
  let dejaRenseignes = 0;
  let nonTrouves = 0;
  const nonTrouvesNoms = [];
  const idsCol = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nomBrut = String(row[0] || '').trim();
    const idExistant = String(row[9] || '').trim();

    if (!nomBrut) {
      idsCol.push([idExistant]);
      continue;
    }

    if (idExistant && !forcer) {
      dejaRenseignes++;
      idsCol.push([idExistant]);
      continue;
    }

    let idTrouve = '';
    const nomPropre = nomBrut.replace(/\s*\([^)]*\)\s*/g, '').trim();
    const nomNorm = normaliserChaineComparaison(nomPropre);
    const nomMots = String(nomPropre).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().split(/\s+/).filter(Boolean);

    // 1. Dictionnaire ACBB direct
    const nomCle = String(nomPropre).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (ACBB_SPAKTA_MAPPING_DEFAUT[nomCle]) {
      idTrouve = ACBB_SPAKTA_MAPPING_DEFAUT[nomCle];
    }

    // 2. Recherche directe dans la liste Spakta
    if (!idTrouve && spaktaJoueurs.length > 0) {
      // 2a. Match exact ou inversé ("NOM Prénom" vs "Prénom Nom")
      for (let j = 0; j < spaktaJoueurs.length; j++) {
        const pj = spaktaJoueurs[j];
        const pjNorm = normaliserChaineComparaison(pj.name);
        const pjMots = String(pj.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().split(/\s+/).filter(Boolean);
        const pjInverse = normaliserChaineComparaison(pjMots.slice().reverse().join(''));
        if (nomNorm === pjNorm || nomNorm === pjInverse) {
          idTrouve = pj.id;
          break;
        }
      }

      // 2b. Match prénom + initiale (ex: "Clément D" vs "DENIAUX Clement")
      if (!idTrouve && nomMots.length >= 2) {
        const prenom = nomMots[0].replace(/^docteur/i, '').trim();
        const init = nomMots[nomMots.length - 1];
        for (let j = 0; j < spaktaJoueurs.length; j++) {
          const pj = spaktaJoueurs[j];
          const pjMots = String(pj.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().split(/\s+/).filter(Boolean);
          const pNom = pjMots[0];
          const pPrenom = pjMots[1] || '';
          if (normaliserChaineComparaison(pPrenom).startsWith(prenom) && normaliserChaineComparaison(pNom).startsWith(init.charAt(0))) {
            idTrouve = pj.id;
            break;
          }
          if (normaliserChaineComparaison(pNom).startsWith(prenom) && normaliserChaineComparaison(pPrenom).startsWith(init.charAt(0))) {
            idTrouve = pj.id;
            break;
          }
        }
      }

      // 2c. Match prénom unique (si un seul joueur porte ce prénom)
      if (!idTrouve && nomMots.length === 1) {
        const prenomSeul = nomMots[0];
        const candidats = spaktaJoueurs.filter(function(pj) {
          const pjMots = String(pj.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().split(/\s+/).filter(Boolean);
          return pjMots.some(function(w) { return normaliserChaineComparaison(w) === prenomSeul; });
        });
        if (candidats.length === 1) {
          idTrouve = candidats[0].id;
        }
      }
    }

    if (idTrouve) {
      associes++;
      idsCol.push([idTrouve]);
    } else {
      nonTrouves++;
      nonTrouvesNoms.push(nomPropre);
      idsCol.push([idExistant || '']);
    }
  }

  // Écriture par lot dans la colonne J
  shEff.getRange(2, 10, idsCol.length, 1).setValues(idsCol)
    .setFontFamily('Roboto Mono, Consolas, monospace')
    .setFontSize(9)
    .setHorizontalAlignment('center');

  try { CacheService.getScriptCache().remove('COACH_DATA_CACHE'); } catch (ce) {}

  return {
    ok: true,
    total: rows.length,
    associes: associes,
    dejaRenseignes: dejaRenseignes,
    nonTrouves: nonTrouves,
    nonTrouvesNoms: nonTrouvesNoms
  };
}

/**
 * Menu UI Google Sheets pour lancer l'association Spakta
 */
function menuAssocierIdsSpakta() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();
    const rep = ui.alert(
      '📊 Association automatique des IDs Spakta (Scout 2026-2027)',
      'Handball Bot va analyser les joueurs de l\'onglet Effectif et associer automatiquement leurs identifiants officiels Spakta Scout en colonne J.\n\n' +
      'Voulez-vous aussi mettre à jour les joueurs qui ont déjà un ID renseigné ?\n' +
      '• OUI : Tout recalculer et écraser.\n' +
      '• NON : Préremplir uniquement les cases vides.',
      ui.ButtonSet.YES_NO_CANCEL
    );
    if (rep === ui.Button.CANCEL) return;
    const forcer = (rep === ui.Button.YES);
    const res = preRemplirIdsSpaktaEffectif(ss, forcer);
    ui.alert(
      '✅ Association Spakta terminée !',
      'Résultat :\n' +
      '• Joueurs analysés : ' + res.total + '\n' +
      '• Joueurs associés : ' + res.associes + '\n' +
      '• Déjà renseignés (conservés) : ' + res.dejaRenseignes + '\n' +
      '• Non trouvés dans Spakta : ' + res.nonTrouves + '\n\n' +
      (res.nonTrouvesNoms.length > 0 ? 'Joueurs sans correspondance Spakta :\n' + res.nonTrouvesNoms.join(', ') : 'Tous les joueurs sont parfaitement associés !'),
      ui.ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur lors de l\'association Spakta : ' + e.message);
  }
}
