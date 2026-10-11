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
const APP_VERSION = '1.12.0';
// Dépôt modèle officiel pour la vérification automatique des mises à jour
const UPSTREAM_TEMPLATE_REPO = 'pidgey56/handball-bot-template';

// Logo de secours (Handball SVG moderne généré dynamiquement selon la couleur principale)
function genererLogoDefaut(couleur) {
  const c = couleur || '#f97316';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="' + c + '"><circle cx="12" cy="12" r="10" stroke="#cbd5e1" stroke-width="1.5" fill="#1e293b"/><path d="M12 2a10 10 0 0 0 0 20M2 12a10 10 0 0 0 20 0M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14" stroke="#cbd5e1" stroke-width="1.2" fill="none"/></svg>';
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
  const rowsEq = shCfg.getRange('B4:F6').getValues();
  const equipes = [];
  rowsEq.forEach(function(r, idx) {
    const code = String(r[0] || '').trim();
    const motCle = String(r[1] || '').trim();
    const labelSondage = String(r[2] || code || ('Équipe ' + (idx + 1))).trim();
    const delaiRdv = Number(r[3]) || 1;
    const urlPoule = String(r[4] || '').trim();
    if (code && (urlPoule || motCle || labelSondage)) {
      equipes.push({ code: code, motCle: motCle, labelSondage: labelSondage, delaiRdv: delaiRdv, urlPoule: urlPoule });
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
    equipes.push({ code: 'Équipe ' + idx, motCle: 'MON CLUB', labelSondage: 'Équipe ' + idx, delaiRdv: 1, urlPoule: '' });
  }
  const equipesActives = equipes.slice(0, nbEquipesCfg);
  const nbEquipes = nbEquipesCfg;

  // Lecture des entraînements configurés (ScriptProperties ou feuille Configuration B9:D14)
  const extraireHoraire = function(str) {
    const m = String(str || '').match(/(\d{1,2}[h:]\d{0,2})/i);
    return m ? m[1].replace(':', 'h') : '20h30';
  };

  let seancesTrain = [];
  try {
    const rawProp = PropertiesService.getScriptProperties().getProperty('CONFIG_SEANCES_TRAIN');
    if (rawProp) {
      const parsed = JSON.parse(rawProp);
      if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 5) {
        seancesTrain = parsed.map(function(s, idx) {
          const j = String(s.jour || ('Séance ' + (idx + 1))).trim();
          const h = extraireHoraire(s.horaire || '20h30');
          return {
            id: s.id || ('s' + (idx + 1)),
            jour: j,
            horaire: h,
            label: s.label || ('Entraînement ' + j + ' ' + h),
            actif: s.actif !== false
          };
        });
      }
    }
  } catch (e) {
    Logger.log('Erreur lecture CONFIG_SEANCES_TRAIN : ' + e.message);
  }

  if (!seancesTrain.length) {
    const rowsTrain = shCfg.getRange('B9:D14').getValues();
    seancesTrain = [
      {
        id: 'lun',
        jour: 'Lundi',
        label: (rowsTrain[0] && rowsTrain[0][1]) ? String(rowsTrain[0][1]).trim() : 'Entraînement Lundi 20h30',
        horaire: extraireHoraire(rowsTrain[0] ? rowsTrain[0][1] : ''),
        actif: (rowsTrain[0] && String(rowsTrain[0][2]).toUpperCase() === 'OUI')
      },
      {
        id: 'mer',
        jour: 'Mercredi',
        label: (rowsTrain[2] && rowsTrain[2][1]) ? String(rowsTrain[2][1]).trim() : 'Entraînement Mercredi 20h30',
        horaire: extraireHoraire(rowsTrain[2] ? rowsTrain[2][1] : ''),
        actif: (rowsTrain[2] && String(rowsTrain[2][2]).toUpperCase() === 'OUI')
      },
      {
        id: 'jeu',
        jour: 'Jeudi',
        label: (rowsTrain[4] && rowsTrain[4][1]) ? String(rowsTrain[4][1]).trim() : 'Entraînement Jeudi 20h30',
        horaire: extraireHoraire(rowsTrain[4] ? rowsTrain[4][1] : ''),
        actif: (rowsTrain[4] && String(rowsTrain[4][2]).toUpperCase() === 'OUI')
      }
    ];
  }

  const entrainements = [];
  seancesTrain.forEach(function(s) {
    if (s.label) {
      entrainements.push({ label: s.label, actif: s.actif });
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
  const adminPhones = String(adminPhonesRaw || '').split(',').map(function(t) { return normaliserNumero(dechiffrerNumero(t.trim())); }).filter(Boolean);

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

  const logoFinal = (logoUrlRaw && logoUrlRaw !== LOGO_DEFAULT && !logoUrlRaw.includes('data:image/svg+xml')) ? convertirUrlPhoto(logoUrlRaw) : genererLogoDefaut(couleurPrimaire);

  const labelEq1 = (equipesActives[0] && equipesActives[0].labelSondage) ? equipesActives[0].labelSondage : 'Équipe 1';
  const labelEq2 = (equipesActives[1] && equipesActives[1].labelSondage) ? equipesActives[1].labelSondage : 'Équipe 2';
  const labelEq3 = (equipesActives[2] && equipesActives[2].labelSondage) ? equipesActives[2].labelSondage : 'Équipe 3';

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
    chouchou: (function(){ try { return PropertiesService.getScriptProperties().getProperty('CHOUCHOU_NOM') || ''; } catch(e){ return ''; } })()
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
      { code: 'Équipe 1', motCle: 'MON CLUB', labelSondage: 'Équipe 1', delaiRdv: 1, urlPoule: '' },
      { code: 'Équipe 2', motCle: 'MON CLUB', labelSondage: 'Équipe 2', delaiRdv: 1, urlPoule: '' },
      { code: 'Équipe 3', motCle: 'MON CLUB', labelSondage: 'Équipe 3', delaiRdv: 1, urlPoule: '' }
    ].slice(0, nbDef),
    nbEquipes: nbDef,
    entrainements: [],
    nomEquipe1: 'Équipe 1',
    nomEquipe2: 'Équipe 2',
    nomEquipe3: 'Équipe 3',
    chouchou: (function(){ try { return PropertiesService.getScriptProperties().getProperty('CHOUCHOU_NOM') || ''; } catch(e){ return ''; } })()
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

  const optionsMatchs = [];
  const lignesDetectees = [];

  cfg.equipes.forEach(function(eq, index) {
    if (!eq.urlPoule) {
      lignesDetectees.push(['', dateLundiComplet, eq.labelSondage, 'URL de poule FFHB non renseignée', '-', '-', '-', '-', '-', '-', 'Configuration manquante']);
      return;
    }

    const motCle = eq.motCle || cfg.nomClub.toUpperCase();
    const resultat = extraireMatchFFHB(eq.urlPoule, motCle, lundiEnCours, dimancheSemaine);

    if (resultat && resultat.found) {
      const heureRdv = calculerHeureRdv(resultat.heure, eq.delaiRdv);
      const texteRdv = resultat.estDomicile ? '(rdv ' + heureRdv + ')' : '(rdv ' + heureRdv + ' sur place)';
      const lieuTexte = resultat.estDomicile ? 'à domicile' : 'à l’extérieur';
      const salle = resultat.salle || (resultat.estDomicile ? (cfg.salleDefaut || 'Gymnase Domicile') : ('Gymnase ' + (resultat.adversaireCourt || 'Extérieur')));
      const optionTexte = 'Dispo match ' + eq.labelSondage + ' ' + resultat.jourCourt + ' ' + lieuTexte + ' ' + resultat.heure + ' vs ' + resultat.adversaireCourt + ' ' + texteRdv;
      optionsMatchs.push(optionTexte);
      lignesDetectees.push(['', dateLundiComplet, eq.labelSondage, resultat.dateTexte, resultat.heure, heureRdv, lieuTexte, resultat.adversaire, salle, optionTexte, resultat.statut]);
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
    if (tr.actif && tr.label) optionsFinales.push(tr.label);
  });
  optionsMatchs.forEach(function(opt) { optionsFinales.push(opt); });

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

  let shEff = ss.getSheetByName('Effectif');
  if (!shEff) {
    shEff = ss.insertSheet('Effectif');
    shEff.getRange('A1:H1').setValues([['Nom / Surnom', 'Téléphone (format 336...)', 'Poste', 'Équipe habituelle', 'Photo (URL ou lien Drive)', 'Code PIN (Auto)', 'Notes Coach', 'Trésorier']]).setFontWeight('bold');
  } else {
    try {
      const hVal = shEff.getRange('H1').getValue();
      if (!hVal) {
        shEff.getRange('H1').setValue('Trésorier').setFontWeight('bold');
      }
    } catch (e) {}
  }

  let shVotes = ss.getSheetByName('Votes_Semaine');
  const seances = (cfg.seancesTrain && cfg.seancesTrain.length) ? cfg.seancesTrain : [
    { jour: 'Lundi' }, { jour: 'Mercredi' }, { jour: 'Jeudi' }
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
  }
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
  shCfg.getRange('B3:F3').setValues([['Code Équipe', 'Nom recherché (Mot-clé FFHB)', 'Libellé dans le sondage', 'Délai RDV avant match (heures)', 'URL de la poule FFHB']]).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  shCfg.getRange('B4:F6').setValues([
    ['Équipe 1', 'MON CLUB', 'Équipe 1', 1.0, 'https://www.ffhandball.fr/competitions/...'],
    ['Équipe 2', 'MON CLUB', 'Équipe 2', 1.0, 'https://www.ffhandball.fr/competitions/...'],
    ['Équipe 3', 'MON CLUB', 'Équipe 3', 1.0, 'https://www.ffhandball.fr/competitions/...']
  ]);

  shCfg.getRange('B8:D8').setValues([['Ordre', "Intitulé de l'option dans le sondage", 'Actif (OUI/NON)']]).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  shCfg.getRange('B9:D14').setValues([
    [1, 'Entraînement Lundi 20h30', 'OUI'],
    [2, 'ABS Lundi', 'OUI'],
    [3, 'Entraînement Mercredi 20h30', 'OUI'],
    [4, 'ABS Mercredi', 'OUI'],
    [5, 'Entraînement Jeudi 20h30', 'NON'],
    [6, 'ABS Jeudi', 'NON']
  ]);

  shCfg.getRange('B17:D17').setValues([['Paramètre', 'Valeur', 'Aperçu / Description']]).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  shCfg.getRange('B18:D32').setValues([
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
    ['Page FFHB du Club (URL)', '', 'Lien vers monclub.ffhandball.fr (logo et couleurs auto)']
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
  if (!str) throw new Error('Veuillez saisir l\'adresse de la page FFHB de votre club.');
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
 * Met à jour les aperçus et styles de couleurs dans le classeur Google Sheets
 */
function actualiserCouleursClasseur() {
  const ss = getSpreadsheet();
  const cfg = getClubConfig(ss);
  const shCfg = ss.getSheetByName('Configuration');
  if (shCfg) {
    try {
      shCfg.getRange('D26').setBackground(cfg.couleurPrimaire).setFontColor(getContrastColor(cfg.couleurPrimaire)).setValue('Aperçu');
      shCfg.getRange('D27').setBackground(cfg.couleurSecondaire).setFontColor(getContrastColor(cfg.couleurSecondaire)).setValue('Aperçu');
      shCfg.getRange('D28').setBackground(cfg.couleurEquipe1).setFontColor(getContrastColor(cfg.couleurEquipe1)).setValue('Aperçu');
      shCfg.getRange('D29').setBackground(cfg.couleurEquipe2).setFontColor(getContrastColor(cfg.couleurEquipe2)).setValue('Aperçu');
      shCfg.getRange('D30').setBackground(cfg.couleurEquipe3).setFontColor(getContrastColor(cfg.couleurEquipe3)).setValue('Aperçu');
    } catch (e) {}

    try {
      shCfg.setTabColor(cfg.couleurPrimaire);
      const shEff = ss.getSheetByName('Effectif');
      if (shEff) shEff.setTabColor(cfg.couleurPrimaire);
      const shVotes = ss.getSheetByName('Votes_Semaine');
      if (shVotes) shVotes.setTabColor(cfg.couleurSecondaire);
      const shComp = ss.getSheetByName('Compositions');
      if (shComp) shComp.setTabColor(cfg.couleurEquipe1);
    } catch (e) {}
  }
  ss.toast('Couleurs appliquées avec succès (' + cfg.couleurPrimaire + ', ' + cfg.couleurSecondaire + ') !', 'Handball Bot');
}

function convertirUrlPhoto(urlBrute) {
  const url = String(urlBrute || '').trim();
  if (!url) return '';
  if (url.indexOf('data:image/') === 0) return url;
  const mDriveFile = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (mDriveFile) return 'https://drive.google.com/thumbnail?id=' + mDriveFile[1] + '&sz=w800';
  const mDriveId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (url.indexOf('drive.google.com') !== -1 && mDriveId) return 'https://drive.google.com/thumbnail?id=' + mDriveId[1] + '&sz=w800';
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

function authentifierUtilisateur(telephoneSaisi, pinSaisi) {
  initialiserOngletsWebApp();
  const tel = normaliserNumero(telephoneSaisi);
  const pin = String(pinSaisi || '').trim();

  if (!tel || tel.length < 10) throw new Error('Veuillez saisir un numéro de téléphone valide (ex : 06 12 34 56 78).');
  if (!/^\d{4,8}$/.test(pin)) throw new Error('Le code PIN doit contenir entre 4 et 8 chiffres.');

  const ss = getSpreadsheet();
  const cfg = getClubConfig(ss);
  const shEff = ss.getSheetByName('Effectif');
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

  return {
    ok: true,
    telephone: tel,
    pin: pin,
    nom: nomJoueur,
    poste: posteJoueur,
    photo: photoJoueur,
    estCoach: estCoach,
    estTresorier: estTresorier
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
  let nouvellePhoto = String(joueurCible.photo || '').trim();
  const nouvelleNote = String(joueurCible.note || '').trim();
  const nouveauTel = joueurCible.tel ? normaliserNumero(joueurCible.tel) : '';
  const nouvelleEquipe = String(joueurCible.equipe || '').trim();

  for (let i = 1; i < rows.length; i++) {
    const nomExistant = String(rows[i][0] || '').trim();
    const nomPropre = nomExistant.replace(/\s*\([^)]*\)\s*/g, '').trim();
    if (nomExistant.toLowerCase() === nomCible.toLowerCase() || nomPropre.toLowerCase() === nomCible.toLowerCase()) {
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

      if (nouveauTel) shEff.getRange(i + 1, 2).setValue(chiffrerNumero(nouveauTel));
      if (nouveauPoste) shEff.getRange(i + 1, 3).setValue(nouveauPoste);
      if (nouvelleEquipe) shEff.getRange(i + 1, 4).setValue(nouvelleEquipe);
      if (nouvellePhoto) shEff.getRange(i + 1, 5).setValue(nouvellePhoto);
      shEff.getRange(i + 1, 7).setValue(nouvelleNote);
      if (estVraiCoach && joueurCible.estTresorier !== undefined) {
        shEff.getRange(i + 1, 8).setValue(joueurCible.estTresorier ? 'OUI' : 'NON');
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

      return {
        ok: true,
        joueur: {
          nom: nomPropre,
          tel: nouveauTel || dechiffrerNumero(rows[i][1]),
          poste: nouveauPoste || String(rows[i][2] || 'Demi-Centre'),
          equipe: nouvelleEquipe || String(rows[i][3] || ''),
          photo: convertirUrlPhoto(nouvellePhoto || rows[i][4]),
          note: nouvelleNote,
          estTresorier: valTresorierActuel
        }
      };
    }
  }

  throw new Error('Joueur non trouvé dans l\'effectif.');
}

/**
 * Enregistre ou retire le chouchou du coach (Easter egg)
 */
function enregistrerChouchou(telCoach, pinCoach, nomJoueur) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  const cleanNom = String(nomJoueur || '').trim();
  PropertiesService.getScriptProperties().setProperty('CHOUCHOU_NOM', cleanNom);
  return { succes: true, chouchou: cleanNom };
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
  const props = PropertiesService.getScriptProperties();
  let covoit = {};
  try {
    const raw = props.getProperty('COVOITURAGE_DATA');
    if (raw) covoit = JSON.parse(raw);
  } catch (e) { covoit = {}; }

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

  props.setProperty('COVOITURAGE_DATA', JSON.stringify(covoit));
  return { ok: true, covoiturage: covoit };
}

/**
 * Récupère les données de covoiturage
 */
function getCovoiturageData() {
  const props = PropertiesService.getScriptProperties();
  try {
    const raw = props.getProperty('COVOITURAGE_DATA');
    if (raw) return JSON.parse(raw);
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
  PropertiesService.getScriptProperties().setProperty('COVOITURAGE_DATA', JSON.stringify(clean));
  return { ok: true, covoiturage: clean };
}

/**
 * Enregistre le vote MVP & Chèvre d'un joueur
 */
function voterMvpChevre(tel, pin, nomMvp, nomChevre) {
  const auth = authentifierUtilisateur(tel, pin);
  const props = PropertiesService.getScriptProperties();
  let votes = {};
  try {
    const raw = props.getProperty('VOTES_MVP_DATA');
    if (raw) votes = JSON.parse(raw);
  } catch (e) { votes = {}; }

  if (!votes.liste) votes.liste = {};

  votes.liste[auth.telephone] = {
    votant: auth.nom,
    mvp: String(nomMvp || '').trim(),
    chevre: String(nomChevre || '').trim(),
    date: new Date().toISOString()
  };

  props.setProperty('VOTES_MVP_DATA', JSON.stringify(votes));
  const res = calculerResultatsVotesMvp(votes);
  return { ok: true, votesMvp: res, ...res };
}

/**
 * Calcule le podium des votes MVP et Chèvre
 */
function calculerResultatsVotesMvp(votesData) {
  const decompteMvp = {};
  const decompteChevre = {};
  const liste = (votesData && votesData.liste) ? votesData.liste : {};
  let totalVotes = 0;

  Object.values(liste).forEach(function(v) {
    totalVotes++;
    if (v.mvp) decompteMvp[v.mvp] = (decompteMvp[v.mvp] || 0) + 1;
    if (v.chevre) decompteChevre[v.chevre] = (decompteChevre[v.chevre] || 0) + 1;
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
    podiumChevre: trier(decompteChevre)
  };
}

/**
 * Récupère les votes MVP et le podium actuel
 */
function getVotesMvpData() {
  const props = PropertiesService.getScriptProperties();
  let votes = {};
  try {
    const raw = props.getProperty('VOTES_MVP_DATA');
    if (raw) votes = JSON.parse(raw);
  } catch (e) {}
  return calculerResultatsVotesMvp(votes);
}

/**
 * Réinitialise les votes MVP pour le prochain match
 */
function reinitialiserVotesMvp(telCoach, pinCoach) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  const clean = { liste: {} };
  PropertiesService.getScriptProperties().setProperty('VOTES_MVP_DATA', JSON.stringify(clean));
  return calculerResultatsVotesMvp(clean);
}

/**
 * Déclare une absence à l'avance pour le joueur
 */
function declarerAbsenceJoueur(tel, pin, dateDebut, dateFin, motif, idAbsence) {
  const auth = authentifierUtilisateur(tel, pin);
  const ss = getSpreadsheet();
  const shEff = ss.getSheetByName('Effectif');
  const dDeb = String(dateDebut || '').trim();
  const dFin = String(dateFin || '').trim();
  const rMotif = String(motif || 'Non renseigné').trim();

  if (!dDeb) throw new Error('Veuillez indiquer au moins une date de début.');

  const props = PropertiesService.getScriptProperties();
  let absences = [];
  try {
    const raw = props.getProperty('ABSENCES_JOUEURS');
    if (raw) absences = JSON.parse(raw);
  } catch (e) { absences = []; }

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

  props.setProperty('ABSENCES_JOUEURS', JSON.stringify(absences));

  if (shEff) {
    const rows = shEff.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (normaliserNumero(dechiffrerNumero(rows[i][1])) === auth.telephone) {
        const noteActuelle = String(rows[i][6] || '').trim();
        const noteAbsence = 'Absent ' + (dDeb === dFin || !dFin ? dDeb : ('du ' + dDeb + ' au ' + dFin)) + ' (' + rMotif + ')';
        const nouvelleNote = noteActuelle ? (noteActuelle + ' • ' + noteAbsence) : noteAbsence;
        shEff.getRange(i + 1, 7).setValue(nouvelleNote);
        break;
      }
    }
  }

  return { ok: true, absences: absences };
}

function supprimerAbsenceJoueur(tel, pin, idAbsence) {
  const auth = authentifierUtilisateur(tel, pin);
  const props = PropertiesService.getScriptProperties();
  let absences = [];
  try {
    const raw = props.getProperty('ABSENCES_JOUEURS');
    if (raw) absences = JSON.parse(raw);
  } catch (e) { absences = []; }

  absences = absences.filter(function(a) {
    if (a.id) return a.id !== idAbsence;
    return true;
  });

  props.setProperty('ABSENCES_JOUEURS', JSON.stringify(absences));
  return { ok: true, absences: absences };
}

/**
 * Récupère les absences des joueurs
 */
function getAbsencesJoueurs() {
  const props = PropertiesService.getScriptProperties();
  try {
    const raw = props.getProperty('ABSENCES_JOUEURS');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
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
 * Récupère les données complètes de la Caisse Noire (amendes, cagnotte, dépenses, statistiques)
 */
function getCaisseNoireData() {
  const props = PropertiesService.getScriptProperties();
  let rawData = null;
  try {
    const raw = props.getProperty('CAISSE_NOIRE_DATA');
    if (raw) rawData = JSON.parse(raw);
  } catch (e) {}

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
  if (!Array.isArray(rawData.amendes)) rawData.amendes = [];
  if (!Array.isArray(rawData.depenses)) rawData.depenses = [];

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
  const cleanCoupable = String(nomCoupable || '').trim();
  const cleanMotif = String(motif || 'Non renseigné').trim();
  const valMontant = Math.max(0.5, Number(montant) || 1);
  const cleanCommentaire = String(commentaire || '').trim();

  if (!cleanCoupable) throw new Error('Veuillez indiquer le joueur concerné.');

  const props = PropertiesService.getScriptProperties();
  let currentData = {};
  try {
    const raw = props.getProperty('CAISSE_NOIRE_DATA');
    if (raw) currentData = JSON.parse(raw);
  } catch (e) {}

  if (!currentData || typeof currentData !== 'object') currentData = {};
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
  props.setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));

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

  const props = PropertiesService.getScriptProperties();
  let currentData = {};
  try {
    const raw = props.getProperty('CAISSE_NOIRE_DATA');
    if (raw) currentData = JSON.parse(raw);
  } catch (e) {}

  if (!currentData || typeof currentData !== 'object') currentData = {};
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

  props.setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
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

  const props = PropertiesService.getScriptProperties();
  let currentData = {};
  try {
    const raw = props.getProperty('CAISSE_NOIRE_DATA');
    if (raw) currentData = JSON.parse(raw);
  } catch (e) {}

  if (!currentData || !Array.isArray(currentData.amendes)) throw new Error('Aucune donnée trouvée.');

  const idx = currentData.amendes.findIndex(function(a) { return a.id === amendeId; });
  if (idx === -1) throw new Error('Amende introuvable.');

  if (action === 'valider') {
    currentData.amendes[idx].statut = 'impaye';
  } else if (action === 'rejeter') {
    currentData.amendes.splice(idx, 1);
  }

  props.setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
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

  const props = PropertiesService.getScriptProperties();
  let currentData = {};
  try {
    const raw = props.getProperty('CAISSE_NOIRE_DATA');
    if (raw) currentData = JSON.parse(raw);
  } catch (e) {}

  if (!currentData || !Array.isArray(currentData.amendes)) throw new Error('Aucune donnée trouvée.');

  currentData.amendes.forEach(function(a) {
    if (ids.indexOf(a.id) !== -1) {
      a.statut = 'paye';
      a.payeLe = dateStr;
      a.modePaiement = mode;
    }
  });

  props.setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
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

  const props = PropertiesService.getScriptProperties();
  let currentData = {};
  try {
    const raw = props.getProperty('CAISSE_NOIRE_DATA');
    if (raw) currentData = JSON.parse(raw);
  } catch (e) {}

  if (!currentData || typeof currentData !== 'object') currentData = {};
  if (!Array.isArray(currentData.depenses)) currentData.depenses = [];

  currentData.depenses.unshift({
    id: 'dep_' + new Date().getTime(),
    motif: cleanMotif,
    montant: valMontant,
    date: new Date().toISOString().split('T')[0],
    enregistrePar: 'Coach / Trésorier'
  });

  props.setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
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

  const props = PropertiesService.getScriptProperties();
  let currentData = {};
  try {
    const raw = props.getProperty('CAISSE_NOIRE_DATA');
    if (raw) currentData = JSON.parse(raw);
  } catch (e) {}

  if (!currentData || !Array.isArray(currentData.amendes)) throw new Error('Aucune donnée trouvée.');

  currentData.amendes = currentData.amendes.filter(function(a) { return a.id !== amendeId; });
  props.setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
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

  const props = PropertiesService.getScriptProperties();
  let currentData = {};
  try {
    const raw = props.getProperty('CAISSE_NOIRE_DATA');
    if (raw) currentData = JSON.parse(raw);
  } catch (e) {}

  if (!currentData || typeof currentData !== 'object') currentData = {};
  currentData.config = nouvelleConfig;

  props.setProperty('CAISSE_NOIRE_DATA', JSON.stringify(currentData));
  return { ok: true, data: getCaisseNoireData() };
}

/**
 * Réinitialise ou clôture la Caisse Noire pour une nouvelle saison / période
 */
function reinitialiserCaisseNoire(telCoach, pinCoach) {
  const ss = getSpreadsheet();
  if (!verifierDroitsCoachOuTresorier(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs / trésoriers autorisés.');
  }

  const props = PropertiesService.getScriptProperties();
  let currentData = {};
  try {
    const raw = props.getProperty('CAISSE_NOIRE_DATA');
    if (raw) currentData = JSON.parse(raw);
  } catch (e) {}

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

  props.setProperty('CAISSE_NOIRE_DATA', JSON.stringify(clean));
  return { ok: true, data: getCaisseNoireData() };
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
  const photo = String(joueurData.photo || '').trim();
  const pin = String(joueurData.pin || ('0000' + Math.floor(Math.random() * 9000 + 1000)).slice(-4));
  const note = String(joueurData.note || '').trim();
  const estTresorier = (joueurData.estTresorier && estVraiCoach) ? 'OUI' : 'NON';

  shEff.appendRow([nomNettoye, telNormalise ? chiffrerNumero(telNormalise) : '', poste, equipe, photo, pin, note, estTresorier]);

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
      estTresorier: (estTresorier === 'OUI')
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

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'sync') {
    const nb = synchroniserDepuisGitHub();
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', count: nb })).setMimeType(ContentService.MimeType.JSON);
  }
  const cfg = getClubConfig();
  const html = construireHtmlWebApp();
  return HtmlService.createHtmlOutput(html)
    .setTitle((cfg.nomClub || 'Handball') + ' - Espace Coach')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'save_votes' && Array.isArray(data.votes)) {
      const nb = enregistrerVotesDansSheet(data.votes);
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', count: nb })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message })).setMimeType(ContentService.MimeType.JSON);
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

  const seances = (cfg.seancesTrain && cfg.seancesTrain.length) ? cfg.seancesTrain : [
    { jour: 'Lundi' }, { jour: 'Mercredi' }, { jour: 'Jeudi' }
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
      if (v[propDay] !== undefined) {
        dispoSeance = !!v[propDay];
      } else if (selOpts.length > 0 && jourUp) {
        dispoSeance = selOpts.some(function(opt){
          return opt.includes(jourUp) && (opt.includes('ENTRAÎNEMENT') || opt.includes('ENTRAINEMENT') || opt.includes('TRAINING'));
        });
      } else {
        dispoSeance = (ancienVal === 'OUI');
      }
      ligne.push(dispoSeance ? 'OUI' : 'NON');
    });

    dictionnaireJoueurs[fiche.nom.toLowerCase()] = ligne;
  });

  const lignesFinales = Object.values(dictionnaireJoueurs).sort(function(a, b) {
    return String(a[0] || '').localeCompare(String(b[0] || ''), 'fr', { sensitivity: 'base' });
  });

  if (shVotes.getLastRow() > 1) shVotes.getRange(2, 1, shVotes.getLastRow() - 1, nbCols).clearContent();
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

function getDonneesCoach() {
  synchroniserDepuisGitHub();
  return lireDonneesCoach();
}

/**
 * Prépare les données pour la WebApp coach
 */
function lireDonneesCoach() {
  const ss = getSpreadsheet();
  const cfg = getClubConfig(ss);
  const shVotes = ss.getSheetByName('Votes_Semaine');
  const shEff = ss.getSheetByName('Effectif');
  const shMatchs = ss.getSheetByName('Matchs FFHB Détectés');

  const mapPhotos = {};
  const mapPostes = {};
  const mapNotes = {};
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
      effectifComplet.push({ nom: nomPropre, tel: dechiffrerNumero(r[1]), poste: posteEff, equipe: equipeEff, photo: photo, note: note, entrainements: nbTr, estTresorier: estTresorier });
    });
  }
  const joueurs = [];

  const seances = (cfg.seancesTrain && cfg.seancesTrain.length) ? cfg.seancesTrain : [
    { id: 'lun', jour: 'Lundi', horaire: '20h30', label: 'Entraînement Lundi 20h30', actif: true },
    { id: 'mer', jour: 'Mercredi', horaire: '20h30', label: 'Entraînement Mercredi 20h30', actif: true },
    { id: 'jeu', jour: 'Jeudi', horaire: '20h30', label: 'Entraînement Jeudi 20h30', actif: true }
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

    const fichePresence = { nom: nomJoueur, poste: posteJoueur, entrainements: Number(r[2]) || 0, photo: photoJoueur, note: noteJoueur };

    seances.forEach(function(s) {
      const col = mapColSeance[s.id];
      if (col !== undefined && r[col] !== undefined && String(r[col]).trim().toUpperCase() === 'OUI') {
        entrainements[s.id].push(fichePresence);
      }
    });

    if (d1B || d1C || d1D) {
      joueurs.push({ id: 'j_' + idx, nom: nomJoueur, poste: posteJoueur, entrainements: Number(r[2]) || 0, dispo1B: d1B, dispo1C: d1C, dispo1D: d1D, photo: photoJoueur, note: noteJoueur });
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
    if (!row || !row[0]) return { label: nomDefaut, aMatch: false, adversaire: '', salle: '', date: '', dateMatch: '', heure: '', heureMatch: '', rdv: '', heureRdv: '', lieu: '' };
    const dateM = formaterDateMatchFr(row[2]);
    let heureM = String(row[3] || '').trim().replace(/^à\s*/i, '');
    let heureRdv = String(row[4] || '').trim().replace(/^à\s*/i, '');
    const lieu = String(row[5] || '').trim();
    const adv = String(row[6] || '').trim();
    const salle = String(row[7] || '').trim();
    const libelle = String(row[8] || '').trim();
    const aMatch = Boolean(adv && adv !== '-' && !/pas de match/i.test(adv));
    return {
      label: (libelle && libelle !== '-') ? libelle : nomDefaut,
      aMatch: aMatch,
      date: dateM,
      dateMatch: dateM,
      heure: heureM,
      heureMatch: heureM,
      rdv: heureRdv,
      heureRdv: heureRdv,
      lieu: lieu,
      adversaire: adv,
      salle: salle
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
    if (cfg.nbEquipes === 1) {
      derniereCompo = {
        date: dateCompo,
        equipe1B: separerNoms(lastRowVals[1]),
        equipe1C: [],
        equipe1D: [],
        nonRetenus: separerNoms(lastRowVals[2])
      };
    } else if (cfg.nbEquipes === 3) {
      derniereCompo = {
        date: dateCompo,
        equipe1B: separerNoms(lastRowVals[1]),
        equipe1C: separerNoms(lastRowVals[2]),
        equipe1D: separerNoms(lastRowVals[3]),
        nonRetenus: separerNoms(lastRowVals[4])
      };
    } else {
      derniereCompo = {
        date: dateCompo,
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
    absences: getAbsencesJoueurs(),
    caisseNoire: getCaisseNoireData(),
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
      couleurEquipe3: cfg.couleurEquipe3
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

  if (envoyerWhatsApp) {
    declencherActionGitHub('send_whatsapp_text', { text_message: messageWhatsApp });
  }

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

  if (envoyerWhatsApp) {
    declencherActionGitHub('send_whatsapp_text', { text_message: messageWhatsApp });
  }

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
    return {
      id: c.id || ('s' + (i + 1)),
      jour: j,
      horaire: h,
      label: 'Entraînement ' + j + ' ' + h,
      actif: (c.actif === true || c.actif === 'OUI')
    };
  });

  // Sauvegarder dans ScriptProperties (source de vérité 1 à 5 séances)
  try {
    PropertiesService.getScriptProperties().setProperty('CONFIG_SEANCES_TRAIN', JSON.stringify(cList));
    PropertiesService.getScriptProperties().setProperty('NB_SEANCES_TRAIN', String(cList.length));
  } catch (e) {
    Logger.log('Erreur PropertiesService: ' + e.message);
  }

  // Mettre à jour la feuille Configuration (B9:D14) pour les 3 premières séances
  const ss = getSpreadsheet();
  const shCfg = ss.getSheetByName('Configuration');
  if (shCfg) {
    for (let i = 0; i < 3; i++) {
      const rowIdx = 9 + (i * 2);
      if (i < cList.length) {
        const c = cList[i];
        const labelEnt = c.label;
        const labelAbs = 'ABS ' + c.jour;
        const actifStr = c.actif ? 'OUI' : 'NON';
        shCfg.getRange(rowIdx, 3, 1, 2).setValues([[labelEnt, actifStr]]);
        shCfg.getRange(rowIdx + 1, 3, 1, 2).setValues([[labelAbs, actifStr]]);
      } else {
        shCfg.getRange(rowIdx, 3, 1, 2).setValues([['Désactivé', 'NON']]);
        shCfg.getRange(rowIdx + 1, 3, 1, 2).setValues([['Désactivé', 'NON']]);
      }
    }
  }

  return { ok: true, count: cList.length, seances: cList };
}

/**
 * Sauvegarde et récupération de brouillon dans PropertiesService
 */
function enregistrerBrouillonCompo(brouillon) {
  try {
    PropertiesService.getScriptProperties().setProperty('BROUILLON_COMPO', JSON.stringify(brouillon));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function recupererBrouillonCompo() {
  try {
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
  if (sheetConfig && webappUrl) sheetConfig.getRange('C21').setValue(webappUrl);
  declencherActionGitHub('sync_whatsapp_votes', { webapp_url: webappUrl });
  synchroniserDepuisGitHub();
  return { launched: true };
}

/**
 * Interface WebApp pour mobile et desktop
 */
function construireHtmlWebApp() {
  const cfg = getClubConfig();
  const manifestObj = {
    name: (cfg.nomClub || 'Handball') + ' - Espace Coach',
    short_name: 'Handball Coach',
    start_url: '.',
    display: 'standalone',
    background_color: '#090d16',
    theme_color: cfg.couleurPrimaire || '#1e293b'
  };
  const manifestDataUri = 'data:application/manifest+json;charset=utf-8,' + encodeURIComponent(JSON.stringify(manifestObj));
  const tpl = [
    '[[!DOCTYPE html]][[html]][[head]][[meta charset="utf-8"]]',
    '[[meta name="mobile-web-app-capable" content="yes"]]',
    '[[meta name="apple-mobile-web-app-capable" content="yes"]]',
    '[[meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"]]',
    '[[meta name="apple-mobile-web-app-title" content="' + (cfg.nomClub || 'Handball') + ' Coach"]]',
    '[[meta name="theme-color" content="' + (cfg.couleurPrimaire || '#1e293b') + '"]]',
    '[[link rel="manifest" href="' + manifestDataUri + '"]]',
    '[[link rel="apple-touch-icon" href="' + cfg.logoUrl + '"]]',
    '[[link rel="preconnect" href="https://fonts.googleapis.com"]]',
    '[[link rel="preconnect" href="https://fonts.gstatic.com" crossorigin]]',
    '[[link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"]]',
    '[[style]]',
    ':root{',
      '--color-primary:' + cfg.couleurPrimaire + ';',
      '--color-primary-text:' + getContrastColor(cfg.couleurPrimaire) + ';',
      '--color-secondary:' + cfg.couleurSecondaire + ';',
      '--color-secondary-text:' + getContrastColor(cfg.couleurSecondaire) + ';',
      '--color-team1:' + cfg.couleurEquipe1 + ';',
      '--color-team1-text:' + getContrastColor(cfg.couleurEquipe1) + ';',
      '--color-team2:' + cfg.couleurEquipe2 + ';',
      '--color-team2-text:' + getContrastColor(cfg.couleurEquipe2) + ';',
      '--color-team3:' + (cfg.couleurEquipe3 || '#10b981') + ';',
      '--color-team3-text:' + getContrastColor(cfg.couleurEquipe3 || '#10b981') + ';',
    '}',
    'body{font-family:"Plus Jakarta Sans",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:radial-gradient(ellipse at 50% 0%,#172554 0%,#05070d 75%);color:#f8fafc;margin:0;padding:0;user-select:none;overflow-x:hidden;min-height:100vh;}',
    '*{scrollbar-width:thin;scrollbar-color:rgba(148,163,184,0.35) transparent;}',
    '::-webkit-scrollbar{width:8px;height:8px;}',
    '::-webkit-scrollbar-track{background:rgba(15,23,42,0.35);border-radius:999px;}',
    '::-webkit-scrollbar-thumb{background:rgba(148,163,184,0.35);border-radius:999px;border:2px solid transparent;background-clip:padding-box;transition:all 0.2s ease;}',
    '::-webkit-scrollbar-thumb:hover{background:var(--color-primary);border:2px solid transparent;background-clip:padding-box;}',
    '::-webkit-scrollbar-corner{background:transparent;}',
    'header{background:rgba(15,23,42,0.8);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);padding:10px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.08);position:sticky;top:0;z-index:30;flex-wrap:wrap;gap:8px;box-shadow:0 8px 30px rgba(0,0,0,0.5);}',
    '.logo{font-weight:900;font-size:1.05rem;cursor:pointer;display:flex;align-items:center;gap:8px;letter-spacing:0.3px;}',
    '.header-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap;}',
    '.header-actions button{background:rgba(30,41,59,0.7);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.08);color:#e2e8f0;padding:6px 12px;border-radius:10px;font-size:0.78rem;font-weight:700;transition:all 0.18s ease;}',
    '.header-actions button:hover{background:rgba(51,65,85,0.85);border-color:rgba(255,255,255,0.2);color:#fff;transform:translateY(-1px);}',
    '@media(max-width:768px){',
      'header{padding:6px 10px;gap:5px;}',
      '.logo{font-size:0.88rem;max-width:180px;}',
      '.logo-img{width:26px;height:26px;}',
      '.logo span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;max-width:140px;}',
      '.header-actions{gap:4px;width:100%;overflow-x:auto;flex-wrap:nowrap;padding-bottom:2px;-webkit-overflow-scrolling:touch;scrollbar-width:none;}',
      '.header-actions::-webkit-scrollbar{display:none;}',
      '.header-actions button, .header-actions .badge-mode{flex-shrink:0;padding:5px 9px;font-size:0.72rem;border-radius:8px;}',
    '}',
    '.badge-mode{font-size:0.75rem;background:rgba(30,41,59,0.8);border:1px solid rgba(255,255,255,0.1);padding:5px 12px;border-radius:99px;color:#cbd5e1;font-weight:700;}',
    '.board{display:grid;grid-template-columns:repeat(auto-fit, minmax(250px, 1fr));gap:16px;padding:16px;max-width:1400px;margin:0 auto;}',
    '.board-2{grid-template-columns:1fr 1fr;}',
    '@media(max-width:800px){.board{grid-template-columns:1fr;}.coach-dashboard-grid{grid-template-columns:1fr!important;}}',
    '.col{background:rgba(15,23,42,0.75);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:22px;padding:16px;display:flex;flex-direction:column;min-height:340px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 12px 35px -8px rgba(0,0,0,0.5);transition:border-color 0.2s ease;}',
    '.col:hover{border-color:rgba(255,255,255,0.14);}',
    '.col-1b{border-top:4px solid var(--color-team1);}.col-pool{border-top:4px solid #64748b;}.col-1c{border-top:4px solid var(--color-team2);}.col-1d{border-top:4px solid var(--color-team3);}.col-repos{border-top:4px solid #ef4444;background:rgba(23,17,28,0.85);}.col-retenu{border-top:4px solid var(--color-primary);}',
    '.col-title{font-weight:800;font-size:0.96rem;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;color:#f8fafc;}',
    '.team-dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:middle;box-shadow:0 0 8px rgba(0,0,0,0.5);}',
    '.team-dot-1{background:var(--color-team1);}.team-dot-2{background:var(--color-team2);}.team-dot-3{background:var(--color-team3);}.team-dot-repos{background:#ef4444;}',
    '.col-sub{font-size:0.75rem;color:#94a3b8;margin-bottom:12px;}',
    '.dropzone{flex:1;min-height:250px;display:flex;flex-direction:column;gap:9px;}',
    '.pcard{background:rgba(30,41,59,0.55);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:10px 14px;cursor:grab;display:flex;justify-content:space-between;align-items:center;transition:all 0.22s cubic-bezier(0.16,1,0.3,1);box-shadow:0 4px 14px rgba(0,0,0,0.3);}',
    '.pcard:hover{background:rgba(30,41,59,0.85);border-color:rgba(255,255,255,0.18);transform:translateY(-2px);box-shadow:0 10px 25px -5px rgba(0,0,0,0.55);}',
    '.pcard:active{cursor:grabbing;transform:scale(0.98);}',
    '.pleft{display:flex;align-items:center;gap:10px;min-width:0;}',
    '.pmini{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));color:#fff;font-weight:900;font-size:1rem;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;border:2px solid rgba(255,255,255,0.18);box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;transition:transform 0.2s cubic-bezier(0.16,1,0.3,1),box-shadow 0.2s ease;}',
    '.pmini:hover{transform:scale(1.15);box-shadow:0 0 14px var(--color-primary);}',
    '.pmini img{width:100%;height:100%;object-fit:cover;}',
    '.pmini.is-chouchou, .court-player-avatar.is-chouchou, .modal-avatar-heart.is-chouchou{clip-path:url(#svgHeartClip)!important;-webkit-clip-path:url(#svgHeartClip)!important;border-radius:0!important;background:linear-gradient(135deg,#e11d48,#fb7185)!important;border:none!important;box-shadow:none!important;transform:scale(1.12);filter:drop-shadow(0 4px 12px rgba(225,29,72,0.75));animation:chouchouPulse 1.8s infinite ease-in-out;}',
    '.pmini.is-chouchou img, .court-player-avatar.is-chouchou img, .modal-avatar-heart.is-chouchou img{clip-path:url(#svgHeartClip)!important;-webkit-clip-path:url(#svgHeartClip)!important;border-radius:0!important;}',
    '@keyframes chouchouPulse{0%,100%{transform:scale(1.12);}50%{transform:scale(1.24);}}',
    '@keyframes floatHeartUp{0%{transform:translateY(0) scale(0.6) rotate(0deg);opacity:0;}15%{opacity:1;}85%{opacity:1;}100%{transform:translateY(-110vh) scale(1.3) rotate(45deg);opacity:0;}}',
    '@keyframes viewFadeIn{0%{opacity:0;transform:translateY(12px) scale(0.99);}100%{opacity:1;transform:translateY(0) scale(1);}}',
    '.view-animate-in{animation:viewFadeIn 0.32s cubic-bezier(0.16,1,0.3,1) forwards;}',
    '@keyframes modalBgIn{from{opacity:0;}to{opacity:1;}}',
    '@keyframes modalBoxIn{0%{opacity:0;transform:scale(0.94) translateY(14px);}100%{opacity:1;transform:scale(1) translateY(0);}}',
    '.chouchou-badge{display:inline-flex;align-items:center;gap:3px;background:linear-gradient(135deg,rgba(244,63,94,0.25),rgba(225,29,72,0.15));border:1px solid rgba(244,63,94,0.5);color:#fda4af;font-size:0.68rem;font-weight:800;padding:1px 6px;border-radius:999px;margin-left:6px;}',
    '.pname{font-weight:800;font-size:0.95rem;display:flex;align-items:center;gap:6px;}',
    '.pmeta{font-size:0.75rem;color:#94a3b8;margin-top:2px;font-weight:500;}',
    '.pnote-sub{font-size:0.72rem;color:var(--color-secondary);margin-top:3px;font-style:italic;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.ptags{display:flex;gap:5px;align-items:center;flex-shrink:0;}',
    '.tag{font-size:0.68rem;padding:3px 8px;border-radius:6px;font-weight:700;}',
    '.tag-1b{background:var(--color-team1);color:var(--color-team1-text);}.tag-1c{background:var(--color-team2);color:var(--color-team2-text);}.tag-1d{background:var(--color-team3);color:var(--color-team3-text);}.tag-tr{background:#1e293b;color:var(--color-secondary);border:1px solid rgba(148,163,184,0.15);}',
    '.btn-mini-edit{background:rgba(30,41,59,0.8);border:1px solid rgba(255,255,255,0.12);color:#cbd5e1;padding:3px 7px;border-radius:6px;font-size:0.72rem;cursor:pointer;transition:all 0.15s;}',
    '.btn-mini-edit:hover{border-color:var(--color-primary);color:#fff;}',
    '.btn-mini-restore{background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);color:#fca5a5;padding:3px 7px;border-radius:6px;font-size:0.72rem;cursor:pointer;}',
    '.btn-mini-restore:hover{background:#ef4444;color:#fff;}',
    '.tactical-preview-wrap{background:rgba(11,15,25,0.85);border:1px solid rgba(255,255,255,0.1);border-radius:18px;padding:16px;margin-bottom:20px;}',
    '.tactical-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;}',
    '.tactical-team-tabs{display:flex;gap:6px;}',
    '.tactical-team-tab{padding:6px 14px;border-radius:10px;font-size:0.8rem;font-weight:800;border:1px solid rgba(255,255,255,0.1);background:rgba(30,41,59,0.7);color:#cbd5e1;cursor:pointer;}',
    '.tactical-team-tab.active{background:var(--color-primary);color:var(--color-primary-text);border-color:var(--color-primary);box-shadow:0 3px 12px rgba(0,0,0,0.35);}',
    '.handball-field-wrapper{position:relative;width:100%;max-width:540px;aspect-ratio:500/420;margin:0 auto;background:radial-gradient(ellipse at 50% 90%,#1e3a5f 0%,#061324 85%);border-radius:20px;border:2px solid rgba(255,255,255,0.15);box-shadow:0 16px 40px rgba(0,0,0,0.7);overflow:hidden;}',
    '.court-nodes-container{position:absolute;inset:0;pointer-events:none;}',
    '.court-node{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center;transition:transform 0.15s ease;}',
    '.court-node:hover{transform:translate(-50%,-50%) scale(1.08);z-index:20;}',
    '.court-player-chip{background:rgba(15,23,42,0.94);backdrop-filter:blur(10px);border:2px solid var(--color-primary);border-radius:12px;padding:4px 9px;font-size:0.72rem;font-weight:800;color:#f8fafc;box-shadow:0 6px 16px rgba(0,0,0,0.6);text-align:center;max-width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:grab;user-select:none;touch-action:manipulation;transition:transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;}',
    '.court-player-chip.tactical-dragging{opacity:0.35;cursor:grabbing;transform:scale(0.92);}',
    '.court-node.tactical-drop-hover{transform:translate(-50%,-50%) scale(1.15)!important;z-index:30;}',
    '.court-node.tactical-drop-hover .court-player-chip{border-color:#38bdf8!important;box-shadow:0 0 22px #38bdf8!important;}',
    '.court-player-chip.tactical-selected,.bench-chip.tactical-selected{border-color:#38bdf8!important;box-shadow:0 0 16px rgba(56,189,248,0.95), inset 0 0 6px rgba(56,189,248,0.4)!important;}',
    '.court-post-badge{font-size:0.64rem;font-weight:900;letter-spacing:0.5px;color:var(--color-secondary);margin-bottom:2px;text-shadow:0 1px 3px rgba(0,0,0,0.8);}',
    '.court-player-avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));color:#fff;font-weight:900;font-size:0.85rem;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,0.4);border:2px solid rgba(255,255,255,0.2);overflow:hidden;margin-bottom:2px;cursor:pointer;transition:transform 0.2s cubic-bezier(0.16,1,0.3,1),box-shadow 0.2s ease;}',
    '.court-player-avatar:hover{transform:scale(1.18);box-shadow:0 0 12px var(--color-primary);}',
    '.court-player-avatar img{width:100%;height:100%;object-fit:cover;}',
    '.tactical-bench-wrap{background:rgba(15,23,42,0.7);padding:10px 14px;border-radius:14px;border:1px solid rgba(255,255,255,0.08);margin-top:12px;transition:border-color 0.2s ease, box-shadow 0.2s ease;}',
    '.tactical-bench-wrap.tactical-drop-hover{border-color:#38bdf8!important;box-shadow:0 0 16px rgba(56,189,248,0.3);}',
    '.bench-chips-list{display:flex;gap:8px;flex-wrap:wrap;}',
    '.bench-chip{background:rgba(30,41,59,0.8);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:5px 11px;font-size:0.76rem;font-weight:700;color:#cbd5e1;cursor:grab;display:flex;align-items:center;gap:6px;transition:all 0.15s;user-select:none;touch-action:manipulation;}',
    '.bench-chip:hover{border-color:var(--color-primary);color:#fff;background:rgba(51,65,85,0.9);}',
    '.bench-chip.tactical-dragging{opacity:0.35;cursor:grabbing;}',
    '.bench-chip.tactical-drop-hover{border-color:#38bdf8!important;background:rgba(51,65,85,0.9);transform:scale(1.08);}',
    'footer{position:sticky;bottom:0;background:rgba(15,23,42,0.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);padding:12px 18px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:10px;justify-content:center;flex-wrap:wrap;z-index:30;box-shadow:0 -8px 30px rgba(0,0,0,0.5);}',
    'button{border:none;border-radius:12px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:0.85rem;transition:all 0.18s cubic-bezier(0.16,1,0.3,1);display:inline-flex;align-items:center;justify-content:center;gap:6px;}',
    'button:active{transform:scale(0.96);}button:disabled{opacity:0.65;cursor:wait;}',
    '.btn-enter{background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));color:var(--color-primary-text);font-weight:800;box-shadow:0 4px 16px rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.15);}',
    '.btn-enter:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,0.45);}',
    '.btn-enter-tinder{background:linear-gradient(135deg,#f43f5e,#e11d48)!important;color:#ffffff!important;box-shadow:0 4px 16px rgba(244,63,94,0.35)!important;border:1px solid rgba(255,255,255,0.15)!important;}',
    '.btn-enter-alt{background:rgba(30,41,59,0.8)!important;border:1px solid rgba(255,255,255,0.1)!important;color:#f8fafc!important;}',
    '.btn-enter-alt:hover{border-color:var(--color-primary)!important;background:rgba(51,65,85,0.9)!important;}',
    '.btn-reset{background:rgba(30,41,59,0.7);border:1px solid rgba(255,255,255,0.08);color:#e2e8f0;}',
    '.btn-reset:hover{background:rgba(51,65,85,0.9);color:#fff;border-color:rgba(255,255,255,0.18);}',
    '.btn-save{background:linear-gradient(135deg,var(--color-primary),#2563eb);color:#fff;box-shadow:0 4px 16px rgba(37,99,235,0.35);border:1px solid rgba(255,255,255,0.15);}',
    '.btn-save:hover{box-shadow:0 6px 20px rgba(37,99,235,0.5);transform:translateY(-1px);}',
    '.btn-wa{background:linear-gradient(135deg,#10b981,#059669);color:#fff;box-shadow:0 4px 16px rgba(16,185,129,0.35);border:1px solid rgba(255,255,255,0.15);}',
    '.btn-wa:hover{box-shadow:0 6px 20px rgba(16,185,129,0.5);transform:translateY(-1px);}',
    '.btn-sync{background:rgba(30,41,59,0.8);border:1px solid rgba(16,185,129,0.4);color:#6ee7b7;}',
    '.btn-tinder{background:linear-gradient(135deg,#f43f5e,#e11d48);color:#fff;box-shadow:0 4px 16px rgba(244,63,94,0.35);font-weight:800;border:1px solid rgba(255,255,255,0.15);}',
    '.view-mode-tabs{display:flex;background:rgba(15,23,42,0.8);padding:4px;border-radius:16px;margin:10px 14px 16px 14px;gap:6px;border:1px solid rgba(255,255,255,0.08);box-shadow:inset 0 2px 4px rgba(0,0,0,0.3);}',
    '.view-mode-tab{flex:1;padding:10px 14px;border-radius:12px;border:none;background:transparent;color:#94a3b8;font-weight:700;font-size:0.86rem;cursor:pointer;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;gap:6px;}',
    '.view-mode-tab.active{background:var(--color-primary);color:var(--color-primary-text);box-shadow:0 3px 12px rgba(0,0,0,0.35);font-weight:800;}',
    '.view-mode-tab:not(.active):hover{background:rgba(255,255,255,0.05);color:#f8fafc;}',
    '#tinderView,#trainTinderView{display:none;max-width:440px;margin:8px auto 20px auto;padding:10px;text-align:center;box-sizing:border-box;}',
    '.tdeck{position:relative;height:420px;width:100%;perspective:1000px;margin:10px auto;}',
    '.tcard{position:absolute;top:0;left:0;right:0;height:390px;background:rgba(15,23,42,0.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.12);border-radius:26px;padding:20px 18px;display:flex;flex-direction:column;justify-content:space-between;align-items:center;box-shadow:0 25px 60px -10px rgba(0,0,0,0.75);touch-action:none;will-change:transform;cursor:grab;overflow:hidden;box-sizing:border-box;}',
    '.tcard:hover{border-color:rgba(255,255,255,0.2);}',
    '.tcard:active{cursor:grabbing;}',
    '.tcard-next{transform:scale(0.92) translateY(18px);opacity:0.55;pointer-events:none;z-index:1;border-color:rgba(255,255,255,0.08);transition:transform 0.3s ease,opacity 0.3s ease;}',
    '.tcard-top{z-index:5;}',
    '.train-tstamp{position:absolute;z-index:10;opacity:0;padding:7px 12px;border:3px solid;border-radius:10px;font-size:0.95rem;font-weight:900;text-transform:uppercase;pointer-events:none;}',
    '.train-tstamp-left{top:24px;left:14px;color:var(--color-team1);border-color:var(--color-team1);transform:rotate(-12deg);}',
    '.train-tstamp-right{top:24px;right:14px;color:var(--color-team2);border-color:var(--color-team2);transform:rotate(12deg);}',
    '.train-tstamp-down{bottom:36px;left:50%;color:#cbd5e1;border-color:#64748b;transform:translateX(-50%) rotate(-4deg);}',
    '.tcard-spring{transition:transform 0.4s cubic-bezier(0.175,0.885,0.32,1.275),box-shadow 0.3s ease;}',
    '.tcard-fly{transition:transform 0.42s cubic-bezier(0.25,1,0.5,1),opacity 0.35s ease;}',
    '.tbg-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;}',
    '.tbg-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(11,15,25,0.98) 0%,rgba(11,15,25,0.8) 42%,rgba(11,15,25,0.12) 74%,rgba(11,15,25,0.3) 100%);z-index:1;pointer-events:none;}',
    '.tcontent{position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;justify-content:space-between;align-items:center;}',
    '.tavatar{width:84px;height:84px;border-radius:24px;background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));color:#fff;font-size:2.2rem;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:2px solid rgba(255,255,255,0.25);margin-top:10px;cursor:pointer;transition:transform 0.2s cubic-bezier(0.16,1,0.3,1);}',
    '.tavatar:hover{transform:scale(1.08);}',
    '.tnote-box{background:rgba(15,23,42,0.9);border:1px solid var(--color-secondary);color:var(--color-secondary);padding:6px 14px;border-radius:12px;font-size:0.78rem;max-width:92%;line-height:1.3;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.4);max-height:48px;overflow:hidden;}',
    '.tbtn-edit-card{position:absolute;top:12px;right:12px;z-index:12;background:rgba(15,23,42,0.85);backdrop-filter:blur(6px);color:#f8fafc;border:1px solid rgba(255,255,255,0.2);border-radius:99px;padding:5px 12px;font-size:0.74rem;font-weight:700;cursor:pointer;}',
    '.tbar-bg{width:85%;height:8px;background:rgba(46,46,46,0.85);border-radius:99px;overflow:hidden;margin:4px 0;}',
    '.tbar-fill{height:100%;background:linear-gradient(90deg,var(--color-primary),var(--color-secondary));border-radius:99px;transition:width 0.4s ease;}',
    '.stamp{position:absolute;padding:6px 14px;border-radius:10px;font-weight:900;font-size:1.35rem;letter-spacing:1.5px;text-transform:uppercase;opacity:0;pointer-events:none;z-index:10;border:4px solid;}',
    '.stamp-left{top:26px;left:20px;transform:rotate(-14deg);}',
    '.stamp-right{top:26px;right:20px;transform:rotate(14deg);}',
    '.stamp-up{top:22px;left:50%;transform:translateX(-50%) rotate(0deg);}',
    '.stamp-down{bottom:30px;left:50%;transform:translateX(-50%) rotate(-4deg);}',
    '.stamp-1b{color:var(--color-team1);border-color:var(--color-team1);background:rgba(0,0,0,0.7);box-shadow:0 0 18px var(--color-team1);}',
    '.stamp-1c{color:var(--color-team2);border-color:var(--color-team2);background:rgba(0,0,0,0.7);box-shadow:0 0 18px var(--color-team2);}',
    '.stamp-1d{color:var(--color-team3);border-color:var(--color-team3);background:rgba(0,0,0,0.7);box-shadow:0 0 18px var(--color-team3);}',
    '.stamp-out{color:#f87171;border-color:#ef4444;background:rgba(185,28,28,0.5);box-shadow:0 0 18px rgba(239,68,68,0.6);}',
    '.stamp-retenu{color:#34d399;border-color:#10b981;background:rgba(6,78,59,0.5);box-shadow:0 0 18px rgba(16,185,129,0.6);}',
    '.tcontrols{display:flex;justify-content:center;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap;}',
    '.tbtn-circle{width:64px;height:64px;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.2);cursor:pointer;transition:all 0.18s cubic-bezier(0.16,1,0.3,1);}',
    '.tbtn-circle:hover{transform:scale(1.06);}',
    '.tbtn-circle:active{transform:scale(0.92);}',
    '.tbtn-circle span{font-size:1.3rem;line-height:1.1;}',
    '.tbtn-1b{background:var(--color-team1);color:var(--color-team1-text);}.tbtn-1c{background:var(--color-team2);color:var(--color-team2-text);}.tbtn-1d{background:var(--color-team3);color:var(--color-team3-text);}',
    '.tbtn-out{width:54px;height:54px;background:linear-gradient(145deg,#334155,#1e293b);border-radius:18px;}',
    '.tbtn-retenu{background:linear-gradient(145deg,#10b981,#059669);color:#fff;}',
    '.tbtn-undo{width:42px;height:42px;background:rgba(30,41,59,0.8);color:#cbd5e1;border:1px solid rgba(255,255,255,0.15);border-radius:50%;font-size:1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.15s ease;}',
    '.tbtn-undo:hover{background:rgba(51,65,85,0.9);color:#fff;}',
    '.tscore-bar{display:flex;justify-content:space-around;background:rgba(15,23,42,0.8);backdrop-filter:blur(14px);padding:10px 16px;border-radius:16px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);font-size:0.84rem;font-weight:800;flex-wrap:wrap;gap:8px;box-shadow:0 8px 24px rgba(0,0,0,0.3);}',
    '@media(max-width:640px){',
      '#tinderView,#trainTinderView{padding:2px 4px;margin:0 auto 10px auto;max-width:100%;}',
      '.tdeck{height:330px;margin:2px auto 6px auto;max-width:320px;}',
      '.tcard{height:330px;padding:12px 10px 8px 10px;border-radius:20px;}',
      '.tcard .tavatar{width:60px;height:60px;font-size:1.6rem;margin-top:2px;border-radius:18px;}',
      '.tcard .pname{font-size:1.18rem!important;}',
      '.tcard .pmeta{font-size:0.78rem!important;}',
      '.tcard .tnote-box{max-height:34px;font-size:0.7rem;padding:3px 6px;}',
      '.tcard .tbtn-edit-card{padding:3px 8px;font-size:0.68rem;top:8px;right:8px;}',
      '.tscore-bar{padding:5px 8px;font-size:0.72rem;gap:4px;margin-bottom:4px;border-radius:10px;}',
      '.tcontrols{gap:6px;margin-top:4px;}',
      '.tbtn-circle{width:50px;height:50px;font-size:0.62rem;border-radius:16px;}',
      '.tbtn-circle span{font-size:1.05rem;}',
      '.tbtn-out{width:44px;height:44px;border-radius:14px;}',
      '.tbtn-undo{width:34px;height:34px;font-size:0.85rem;}',
      '.tinder-header-title{font-size:0.76rem!important;margin-bottom:2px!important;}',
      '.tinder-btn-renfort{font-size:0.72rem!important;padding:3px 8px!important;margin:0 auto 4px auto!important;}',
      '.tinder-actions-bar{margin-top:6px!important;gap:4px!important;}',
      '.tinder-actions-bar button{padding:5px 8px!important;font-size:0.72rem!important;}',
      '.tinder-kbd-hint{display:none!important;}',
      'body.tinder-mode-active #appFooter, body.train-tinder-mode-active #trainFooter{display:none!important;}',
      'body.tinder-mode-active .view-mode-tabs, body.train-tinder-mode-active .view-mode-tabs{display:none!important;}',
      'body.tinder-mode-active #btnCollectifsAppHeader, body.tinder-mode-active button[onclick="ouvrirModalCouleurs()"], body.tinder-mode-active button[onclick="ouvrirModalGuideCoach()"], body.tinder-mode-active .js-sync-wa{display:none!important;}',
      'body.train-tinder-mode-active button[onclick="ouvrirModalCollectifs()"], body.train-tinder-mode-active button[onclick="ouvrirModalConfigEntrainements()"], body.train-tinder-mode-active button[onclick="ouvrirModalGuideCoach()"], body.train-tinder-mode-active .js-sync-wa{display:none!important;}',
      'footer{padding:6px 8px;gap:4px;}',
      'footer button{padding:5px 8px;font-size:0.72rem;border-radius:8px;}',
    '}',
    '.preview-page{max-width:780px;margin:20px auto;padding:18px;background:rgba(15,23,42,0.85);backdrop-filter:blur(20px);border-radius:20px;border:1px solid rgba(255,255,255,0.1);box-shadow:0 16px 45px rgba(0,0,0,0.5);}',
    '.preview-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:12px;}',
    '.preview-header h1{font-size:1.25rem;margin:0;font-weight:900;}',
    '.preview-text{width:100%;min-height:220px;box-sizing:border-box;resize:vertical;background:#05070d;color:#f8fafc;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:14px;font:inherit;line-height:1.55;white-space:pre-wrap;user-select:text;-webkit-user-select:text;}',
    '.preview-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px;}',
    '.preview-status{min-height:1.4em;color:#cbd5e1;font-size:0.9rem;margin-top:10px;}',
    '.home-logo-wrap{position:relative;display:inline-block;margin:0 auto 10px auto;}',
    '.home-logo img{width:100px;height:100px;object-fit:contain;filter:drop-shadow(0 8px 18px rgba(0,0,0,0.5));}',
    '.logo-img{width:36px;height:36px;object-fit:contain;}',
    '.btn-logo-edit-badge{position:absolute;bottom:0px;right:-4px;width:32px;height:32px;border-radius:50%;background:#1e293b;border:2px solid var(--color-primary);color:#fff;font-size:0.85rem;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,0.4);}',
    '#appView,#trainView,#rosterView,#previewView{display:none;}',
    '.tabs{display:flex;gap:8px;padding:12px 14px 0 14px;max-width:1200px;margin:0 auto;}',
    '.tab-btn{flex:1;background:rgba(30,41,59,0.7);backdrop-filter:blur(8px);color:#94a3b8;border:1px solid rgba(255,255,255,0.08);padding:12px;font-size:0.95rem;font-weight:700;border-radius:14px;transition:all 0.2s;}',
    '.tab-btn:hover{color:#fff;background:rgba(51,65,85,0.85);}',
    '.tab-active{background:var(--color-primary);color:var(--color-primary-text);border-color:var(--color-primary);box-shadow:0 4px 14px rgba(0,0,0,0.35);font-weight:800;}',
    '.train-config-bar{max-width:1200px;margin:10px auto 12px auto;padding:12px 18px;background:rgba(15,23,42,0.8);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.08);border-radius:18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;}',
    '.train-type-pills{display:inline-flex;background:rgba(5,7,13,0.8);padding:3px;border-radius:99px;border:1px solid rgba(255,255,255,0.08);gap:3px;}',
    '.train-type-pill{padding:5px 14px;border-radius:99px;font-size:0.75rem;font-weight:700;background:transparent;color:#94a3b8;border:none;cursor:pointer;transition:all 0.15s;}',
    '.train-type-pill.active{background:var(--color-primary);color:var(--color-primary-text);box-shadow:0 2px 8px rgba(0,0,0,0.3);font-weight:800;}',
    '.train-info input{width:60px;margin-left:6px;padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:#05070d;color:#f8fafc;}',
    '#homeView{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box;}',
    '.home-card{background:rgba(15,23,42,0.82);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.1);border-top:4px solid var(--color-primary);border-radius:28px;padding:34px 28px;max-width:460px;width:100%;text-align:center;box-shadow:0 30px 70px -15px rgba(0,0,0,0.8);transition:max-width 0.3s ease;}',
    'body.user-logged-in .home-card{max-width:540px;}',
    '@keyframes spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}',
    '@media(min-width:1024px){',
      'body.user-logged-in .home-card{max-width:1120px!important;padding:36px 44px;}',
      '#playerBox{display:grid!important;grid-template-columns:360px 1fr;gap:24px;align-items:start;}',
      '.player-box-left{display:flex;flex-direction:column;gap:12px;width:100%;}',
      '.player-box-right{display:flex;flex-direction:column;gap:14px;width:100%;}',
      '#coachMenuBox{grid-column:1/-1;}',
    '}',
    '.home-logo{font-size:3.2rem;line-height:1;margin-bottom:8px;}',
    '.home-card h1{margin:0 0 4px 0;font-size:1.6rem;letter-spacing:-0.4px;font-weight:900;}',
    '.home-sub{color:#94a3b8;font-size:0.85rem;margin:0 0 18px 0;}',
    '.home-status{font-size:0.85rem;color:#cbd5e1;margin-bottom:6px;min-height:1.2em;}',
    '.inp-field{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(5,7,13,0.8);color:#fff;font-size:0.92rem;user-select:text;-webkit-user-select:text;transition:border-color 0.18s;}',
    '.inp-field option{background:#090d16;color:#fff;}',
    '.inp-field:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px rgba(59,130,246,0.25);}',
    '.coach-dashboard-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}',
    '.dash-tile{background:rgba(30,41,59,0.55);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:14px;display:flex;flex-direction:column;justify-content:space-between;text-align:left;transition:all 0.22s cubic-bezier(0.16,1,0.3,1);}',
    '.dash-tile:hover{background:rgba(30,41,59,0.85);border-color:rgba(255,255,255,0.2);transform:translateY(-2px);box-shadow:0 12px 28px -6px rgba(0,0,0,0.6);}',
    '.dash-tile-title{font-weight:800;font-size:0.88rem;color:#f8fafc;display:flex;align-items:center;gap:6px;}',
    '.dash-tile-desc{font-size:0.72rem;color:#94a3b8;margin-top:3px;line-height:1.3;}',
    '.player-athlete-card{width:260px;height:310px;position:relative;border-radius:24px;overflow:hidden;border:2px solid var(--color-primary);background:#05070d;display:flex;flex-direction:column;justify-content:flex-end;padding:16px;box-sizing:border-box;box-shadow:0 16px 40px rgba(0,0,0,0.65);margin:0 auto;transition:all 0.25s ease;}',
    '.player-athlete-card:hover{transform:translateY(-3px) scale(1.02);box-shadow:0 22px 45px rgba(0,0,0,0.8);border-color:var(--color-secondary);}',
    '.player-athlete-card .card-logo-watermark{position:absolute;top:10px;left:10px;width:38px;height:38px;opacity:0.65;object-fit:contain;z-index:2;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5));}',
    '.player-hub-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;margin-top:6px;}',
    '.player-tile{background:rgba(30,41,59,0.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:12px;text-align:left;cursor:pointer;transition:all 0.22s cubic-bezier(0.16,1,0.3,1);display:flex;flex-direction:column;justify-content:space-between;min-height:86px;}',
    '.player-tile:hover{background:rgba(30,41,59,0.9);border-color:var(--color-secondary);transform:translateY(-2px);box-shadow:0 10px 24px -4px rgba(0,0,0,0.5);}',
    '.player-tile-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}',
    '.player-tile-icon{font-size:1.35rem;line-height:1;}',
    '.player-tile-badge{font-size:0.66rem;padding:2px 7px;border-radius:99px;font-weight:800;background:rgba(99,102,241,0.2);color:#c7d2fe;border:1px solid rgba(99,102,241,0.3);}',
    '.player-tile-title{font-size:0.86rem;font-weight:800;color:#f8fafc;}',
    '.player-tile-sub{font-size:0.72rem;color:#94a3b8;margin-top:2px;line-height:1.25;}',
    '.match-hub-banner{background:linear-gradient(145deg,rgba(15,23,42,0.9),rgba(30,41,59,0.7));border:1px solid rgba(255,255,255,0.1);border-radius:18px;padding:14px;width:100%;box-sizing:border-box;text-align:left;transition:all 0.2s cubic-bezier(0.16,1,0.3,1);cursor:pointer;}',
    '.match-hub-banner:hover{border-color:var(--color-secondary);box-shadow:0 12px 28px rgba(0,0,0,0.5);transform:translateY(-2px);}',
    '.podium-wrap{display:flex;align-items:flex-end;justify-content:center;gap:10px;margin:16px 0;height:140px;}',
    '.podium-step{flex:1;max-width:110px;background:rgba(30,41,59,0.8);border-radius:14px 14px 0 0;padding:10px 6px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative;border:1px solid rgba(255,255,255,0.1);transition:transform 0.2s;}',
    '.podium-step:hover{transform:translateY(-3px);}',
    '.podium-1{height:100%;border-top:3px solid #fbbf24;background:linear-gradient(to top,rgba(30,41,59,0.9),rgba(245,158,11,0.2));}',
    '.podium-2{height:80%;border-top:3px solid #cbd5e1;background:linear-gradient(to top,rgba(30,41,59,0.9),rgba(148,163,184,0.2));}',
    '.podium-3{height:65%;border-top:3px solid #f97316;background:linear-gradient(to top,rgba(30,41,59,0.9),rgba(234,88,12,0.2));}',
    '.covoit-card{background:rgba(15,23,42,0.7);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:10px 12px;margin-bottom:8px;text-align:left;}',
    '.absence-chip{background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#fca5a5;padding:8px 10px;border-radius:10px;font-size:0.78rem;margin-bottom:6px;text-align:left;}',
    '.roster-wrap{max-width:1200px;margin:16px auto 30px;padding:0 16px;}',
    '.roster-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:14px;}',
    '.rcard{background:rgba(30,41,59,0.55);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:12px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:all 0.22s cubic-bezier(0.16,1,0.3,1);box-shadow:0 6px 18px rgba(0,0,0,0.35);}',
    '.rcard:hover{background:rgba(30,41,59,0.85);border-color:var(--color-primary);transform:translateY(-2px);box-shadow:0 12px 28px -6px rgba(0,0,0,0.55);}',
    '.rnote{font-size:0.75rem;color:var(--color-secondary);margin-top:4px;font-style:italic;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
    '.modal-bg{position:fixed;inset:0;background:rgba(3,7,18,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:100;display:none;align-items:center;justify-content:center;padding:16px;animation:modalBgIn 0.25s ease;}',
    '.modal-box{background:rgba(15,23,42,0.92);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.12);border-top:4px solid var(--color-primary);border-radius:24px;max-width:450px;width:100%;padding:24px;max-height:92vh;overflow-y:auto;box-sizing:border-box;box-shadow:0 30px 70px -10px rgba(0,0,0,0.8);animation:modalBoxIn 0.28s cubic-bezier(0.16,1,0.3,1) forwards;}',
    '#toastContainer{position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:380px;pointer-events:none;}',
    '.toast-item{color:#ffffff;padding:12px 18px;border-radius:14px;font-size:0.86rem;font-weight:700;box-shadow:0 12px 35px rgba(0,0,0,0.6);display:flex;align-items:center;gap:10px;pointer-events:auto;animation:toastIn 0.25s ease;border:1px solid rgba(255,255,255,0.15);}',
    '.toast-succes{background:#15803d;}',
    '.toast-erreur{background:#b91c1c;}',
    '.toast-info{background:#0369a1;}',
    '@keyframes toastIn{from{opacity:0;transform:translateY(12px) scale(0.96);}to{opacity:1;transform:translateY(0) scale(1);}}',
    '.badge-renfort{background:rgba(234,179,8,0.2);color:#facc15;border:1px solid rgba(234,179,8,0.35);font-size:0.68rem;padding:2px 6px;border-radius:6px;font-weight:800;}',
    '[[/style]]',
    '[[script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js"]][[/script]]',
    '[[script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"]][[/script]]',
    '[[/head]][[body]]',
    '[[div id="globalLoadingScreen" style="position:fixed;inset:0;background:rgba(5,7,13,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity 0.3s ease,visibility 0.3s ease;"]]',
      '[[div style="position:relative;width:80px;height:80px;display:flex;align-items:center;justify-content:center;margin-bottom:20px;"]]',
        '[[div style="position:absolute;inset:0;border:3px solid rgba(255,255,255,0.08);border-top:3px solid var(--color-primary);border-radius:50%;animation:spin 0.9s linear infinite;"]][[/div]]',
        '[[span style="font-size:2rem;animation:bounce 1.2s infinite;"]]🤾[[/span]]',
      '[[/div]]',
      '[[div id="loadingScreenTitle" style="font-size:1.05rem;font-weight:900;color:#fff;letter-spacing:0.2px;margin-bottom:6px;"]]Chargement du club...[[/div]]',
      '[[div id="loadingScreenSub" style="font-size:0.78rem;color:#94a3b8;"]]Synchronisation FFHB & WhatsApp[[/div]]',
    '[[/div]]',
    '[[svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;" aria-hidden="true"]][[defs]][[clipPath id="svgHeartClip" clipPathUnits="objectBoundingBox"]][[path d="M 0.5, 0.90 C 0.25, 0.70, 0, 0.48, 0, 0.26 C 0, 0.10, 0.12, 0, 0.30, 0 C 0.42, 0, 0.48, 0.06, 0.5, 0.14 C 0.52, 0.06, 0.58, 0, 0.70, 0 C 0.88, 0, 1, 0.10, 1, 0.26 C 1, 0.48, 0.75, 0.70, 0.5, 0.90 Z" /]][[/clipPath]][[/defs]][[/svg]]',
    '[[div id="homeView"]]',
      '[[div class="home-card"]]',
        '[[div id="badgeStatusWhatsApp" style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#86efac;font-size:0.72rem;font-weight:700;padding:4px 10px;border-radius:99px;margin-bottom:12px;"]]',
          '[[span style="width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;display:inline-block;"]][[/span]]',
          '[[span id="txtStatusWhatsApp"]]🟢 WhatsApp Connecté • Synchronisé[[/span]]',
        '[[/div]]',
        '[[div class="home-logo-wrap"]]',
          '[[div class="home-logo"]][[img id="homeLogoImg" src="' + cfg.logoUrl + '" alt="Club"]][[/div]]',
          '[[button type="button" id="btnEditClubLogoBadge" class="btn-logo-edit-badge" title="Changer le blason du club" onclick="ouvrirModalCouleurs()" style="display:none;"]]Logo[[/button]]',
        '[[/div]]',
        '[[h1 id="homeClubName"]]' + cfg.nomClub + '[[/h1]]',
        '[[p class="home-sub" id="subPortail"]]Portail Joueurs & Coachs[[/p]]',
        '[[div id="loginBox" style="display:flex;flex-direction:column;gap:12px;text-align:left;"]]',
          '[[label style="font-size:0.8rem;color:#94a3b8;font-weight:600;"]]Votre numéro de téléphone :[[/label]]',
          '[[input id="inpTel" class="inp-field" type="tel" placeholder="Ex : 06 12 34 56 78"]]',
          '[[label style="font-size:0.8rem;color:#94a3b8;font-weight:600;"]]Code PIN personnel (4 à 8 chiffres) :[[/label]]',
          '[[input id="inpPin" class="inp-field" type="password" inputmode="numeric" maxlength="8" placeholder="Choisissez votre PIN à la 1re connexion"]]',
          '[[div class="home-status" id="loginError" style="color:#f87171;text-align:center;"]][[/div]]',
          '[[button class="btn-enter" id="btnLogin" onclick="seConnecter()"]]Se connecter[[/button]]',
        '[[/div]]',
        '[[div id="playerBox" style="display:none;flex-direction:column;align-items:center;gap:12px;width:100%;"]]',
          '[[div class="player-box-left"]]',
            '[[div id="playerPreviewCard" class="player-athlete-card"]]',
              '[[img id="playerCardLogo" class="card-logo-watermark" src="' + cfg.logoUrl + '" alt="Club"]]',
              '[[img id="playerImgPreview" class="tbg-photo" style="display:none;"]]',
              '[[div class="tbg-overlay"]][[/div]]',
              '[[div id="playerInitialPreview" class="tavatar" style="position:absolute;top:38px;left:50%;transform:translateX(-50%);margin:0;"]]J[[/div]]',
              '[[div style="position:relative;z-index:2;text-align:center;width:100%;"]]',
                '[[div id="playerChouchouBadgeCard" style="display:none;margin-bottom:4px;"]][[span class="chouchou-badge" style="font-size:0.75rem;padding:3px 10px;"]]❤️ Chouchou du coach[[/span]][[/div]]',
                '[[div id="playerNomPreview" style="font-weight:900;font-size:1.35rem;letter-spacing:0.3px;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,0.8);"]]Joueur[[/div]]',
                '[[div id="playerPostePreview" style="font-size:0.84rem;color:var(--color-secondary);font-weight:700;margin-top:2px;text-shadow:0 2px 4px rgba(0,0,0,0.8);"]]Poste[[/div]]',
                '[[div style="display:flex;justify-content:center;gap:6px;margin-top:8px;flex-wrap:wrap;"]]',
                  '[[span id="playerAssiduiteBadge" style="font-size:0.7rem;background:rgba(15,23,42,0.75);backdrop-filter:blur(6px);padding:3px 8px;border-radius:99px;border:1px solid rgba(255,255,255,0.15);color:#e2e8f0;font-weight:700;"]]⚡ Assiduité : --[[/span]]',
                  '[[span id="playerStatutPresenceBadge" style="font-size:0.7rem;background:rgba(34,197,94,0.2);backdrop-filter:blur(6px);padding:3px 8px;border-radius:99px;border:1px solid rgba(34,197,94,0.4);color:#86efac;font-weight:700;"]]✓ Actif[[/span]]',
                '[[/div]]',
              '[[/div]]',
            '[[/div]]',
            '[[div style="display:flex;gap:6px;width:100%;margin-top:2px;"]]',
              '[[button type="button" class="btn-reset" style="flex:1;padding:7px 10px;font-size:0.78rem;background:rgba(30,41,59,0.8);" onclick="ouvrirSelecteurPhotoJoueur()"]]📸 Photo[[/button]]',
              '[[button type="button" class="btn-reset" style="flex:1;padding:7px 10px;font-size:0.78rem;background:rgba(30,41,59,0.8);" onclick="togglePosteSelect()"]]🎯 Poste ▾[[/button]]',
              '[[button type="button" class="btn-reset" style="flex:1;padding:7px 10px;font-size:0.78rem;background:rgba(99,102,241,0.25);border-color:#6366f1;color:#e0e7ff;" onclick="partagerMaCarteJoueur()"]]📲 Partager[[/button]]',
            '[[/div]]',
            '[[div id="posteSelectBox" style="width:100%;text-align:left;display:none;background:rgba(15,23,42,0.7);padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);"]]',
              '[[label style="font-size:0.78rem;color:#94a3b8;font-weight:600;display:block;margin-bottom:6px;"]]Mon poste préféré sur le terrain :[[/label]]',
              '[[select id="selPosteJoueur" class="inp-field" onchange="changerMonPoste()"]]',
                '[[option value="Gardien"]]Gardien[[/option]]',
                '[[option value="Ailier Gauche"]]Ailier Gauche[[/option]]',
                '[[option value="Arrière Gauche"]]Arrière Gauche[[/option]]',
                '[[option value="Demi-Centre"]]Demi-Centre[[/option]]',
                '[[option value="Pivot"]]Pivot[[/option]]',
                '[[option value="Arrière Droit"]]Arrière Droit[[/option]]',
                '[[option value="Ailier Droit"]]Ailier Droit[[/option]]',
              '[[/select]]',
            '[[/div]]',
            '[[input type="file" id="filePhoto" accept="image/*" style="display:none;" onchange="chargerFichierPhoto(event)"]]',
            '[[div class="home-status" id="photoStatus"]][[/div]]',
          '[[/div]]',
          '[[div class="player-box-right"]]',
            '[[div id="matchHubBanner" class="match-hub-banner" onclick="ouvrirApercuCompoJoueur()"]]',
              '[[div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;"]]',
                '[[span id="matchHubStatutBadge" style="font-size:0.76rem;font-weight:800;padding:3px 9px;border-radius:99px;background:rgba(234,179,8,0.2);color:#facc15;border:1px solid rgba(234,179,8,0.3);"]]⏳ MATCH DU WEEK-END[[/span]]',
                '[[span id="matchHubEquipeBadge" style="font-size:0.75rem;font-weight:700;color:#94a3b8;"]][[/span]]',
              '[[/div]]',
              '[[div id="matchHubAdversaire" style="font-weight:900;font-size:1.05rem;color:#fff;margin-bottom:3px;"]]Consultez vos convocations[[/div]]',
              '[[div id="matchHubDetails" style="font-size:0.8rem;color:#cbd5e1;line-height:1.4;margin-bottom:8px;"]]Détails des matchs et convocations officiels du club.[[/div]]',
              '[[div id="matchHubActions" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;"]]',
                '[[button type="button" class="btn-reset" style="padding:6px 10px;font-size:0.76rem;background:rgba(30,41,59,0.8);" onclick="event.stopPropagation();ouvrirGpsGymnase(\'waze\')"]]🚗 Waze[[/button]]',
                '[[button type="button" class="btn-reset" style="padding:6px 10px;font-size:0.76rem;background:rgba(30,41,59,0.8);" onclick="event.stopPropagation();ouvrirGpsGymnase(\'maps\')"]]📍 Maps[[/button]]',
                '[[button type="button" class="btn-wa" style="padding:6px 12px;font-size:0.76rem;flex:1;" onclick="event.stopPropagation();ouvrirApercuCompoJoueur()"]]📐 Voir Terrain Tactique[[/button]]',
              '[[/div]]',
              '[[div style="font-size:0.72rem;color:#38bdf8;font-weight:700;display:flex;align-items:center;gap:4px;"]]📐 Toucher pour ouvrir le terrain tactique & compositions →[[/div]]',
            '[[/div]]',
            '[[div class="player-hub-grid"]]',
              '[[div class="player-tile" onclick="ouvrirModalMvpChevre()"]]',
                '[[div class="player-tile-top"]][[span class="player-tile-icon"]]🏆[[/span]][[span id="tileBadgeMvp" class="player-tile-badge"]]Vote ouvert[[/span]][[/div]]',
                '[[div]][[div class="player-tile-title"]]MVP & Chèvre 🐐[[/div]][[div id="tileSubMvp" class="player-tile-sub"]]Élisez le joueur du match[[/div]][[/div]]',
              '[[/div]]',
              '[[div class="player-tile" onclick="ouvrirModalCovoiturage()"]]',
                '[[div class="player-tile-top"]][[span class="player-tile-icon"]]🚗[[/span]][[span id="tileBadgeCovoit" class="player-tile-badge"]]Trajets[[/span]][[/div]]',
                '[[div]][[div class="player-tile-title"]]Covoiturage[[/div]][[div id="tileSubCovoit" class="player-tile-sub"]]Proposer ou trouver 1 place[[/div]][[/div]]',
              '[[/div]]',
              '[[div class="player-tile" onclick="ouvrirModalAbsence()"]]',
                '[[div class="player-tile-top"]][[span class="player-tile-icon"]]📅[[/span]][[span id="tileBadgeAbsence" class="player-tile-badge"]]Prévenir[[/span]][[/div]]',
                '[[div]][[div class="player-tile-title"]]Déclarer Absence[[/div]][[div id="tileSubAbsence" class="player-tile-sub"]]Indiquer vos indispos[[/div]][[/div]]',
              '[[/div]]',
              '[[div class="player-tile" style="grid-column:1/-1;" onclick="ouvrirModalCaisseNoire()"]]',
                '[[div class="player-tile-top"]][[span class="player-tile-icon"]]💰[[/span]][[span id="tileBadgeCaisse" class="player-tile-badge" style="background:rgba(234,179,8,0.2);color:#fef08a;border-color:rgba(234,179,8,0.35);"]]Cagnotte[[/span]][[/div]]',
                '[[div]][[div class="player-tile-title"]]Caisse Noire & Amendes[[/div]][[div id="tileSubCaisse" class="player-tile-sub"]]Consultez la cagnotte, votre ardoise et le barème[[/div]][[/div]]',
              '[[/div]]',
            '[[/div]]',
          '[[/div]]',
          '[[div id="coachMenuBox" style="display:none;width:100%;border-top:1px solid rgba(148,163,184,0.18);padding-top:14px;margin-top:6px;"]]',
            '[[div id="updateBannerBox" style="display:none;background:linear-gradient(135deg,#1e1b4b,#312e81);border:1px solid #6366f1;border-radius:14px;padding:12px;margin-bottom:12px;text-align:left;box-shadow:0 4px 14px rgba(0,0,0,0.35);"]]',
              '[[div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;"]]',
                '[[span style="font-weight:900;color:#c7d2fe;font-size:0.85rem;display:flex;align-items:center;gap:6px;"]]MISE À JOUR DISPONIBLE[[/span]]',
                '[[span id="updateBadgeVer" style="background:#4338ca;color:#fff;padding:2px 8px;border-radius:99px;font-size:0.75rem;font-weight:800;"]]v1.4.0[[/span]]',
              '[[/div]]',
              '[[div id="updateBannerTitle" style="font-size:0.8rem;color:#e0e7ff;margin-bottom:8px;"]]Nouvelles fonctionnalités pour votre club ![[/div]]',
              '[[div style="display:flex;gap:6px;"]]',
                '[[button type="button" class="btn-reset" style="padding:6px 10px;font-size:0.75rem;background:#4f46e5;color:#fff;flex:1;" onclick="ouvrirModalMiseAJour()"]]Voir les nouveautés & MàJ[[/button]]',
                '[[button type="button" class="btn-reset" style="padding:6px 8px;font-size:0.75rem;background:transparent;border:1px solid #6366f1;color:#c7d2fe;" onclick="masquerBanniereUpdate()"]]Ignorer[[/button]]',
              '[[/div]]',
            '[[/div]]',
            '[[div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;"]]',
              '[[span style="font-size:0.85rem;color:var(--color-secondary);font-weight:900;letter-spacing:0.5px;display:flex;align-items:center;gap:6px;"]]ESPACE COACH[[/span]]',
              '[[span class="badge-mode" style="background:rgba(148,163,184,0.15);color:#94a3b8;"]]Tableau de bord[[/span]]',
            '[[/div]]',
            '[[div class="coach-dashboard-grid"]]',
              '[[div class="dash-tile" onclick="gererClicDashCompo(event)" style="cursor:pointer;" title="Entrer dans la composition"]]',
                '[[div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;"]]',
                  '[[div class="dash-tile-title"]]Convocations Matchs[[/div]]',
                  '[[span id="badgeModeDefautCompo" style="font-size:0.68rem;padding:2px 7px;border-radius:99px;background:rgba(255,255,255,0.08);color:#94a3b8;font-weight:700;"]]Mode auto[[/span]]',
                '[[/div]]',
                '[[div class="dash-tile-desc"]]Feuilles de matchs 1 à 3 équipes[[/div]]',
                '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;" onclick="event.stopPropagation()"]]',
                  '[[button type="button" class="btn-enter" style="margin:0;padding:8px 4px;font-size:0.78rem;" id="btnEnterClassic" onclick="entrer(false)"]]Mode Tactique[[/button]]',
                  '[[button type="button" class="btn-enter btn-enter-tinder" style="margin:0;padding:8px 4px;font-size:0.78rem;" id="btnEnterTinder" onclick="entrer(true)"]]Mode Tinder[[/button]]',
                '[[/div]]',
              '[[/div]]',
              '[[div class="dash-tile" onclick="gererClicDashTrain(event)" style="cursor:pointer;" title="Entrer dans les entraînements"]]',
                '[[div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;"]]',
                  '[[div class="dash-tile-title"]]Séances Entraînement[[/div]]',
                  '[[span id="badgeModeDefautTrain" style="font-size:0.68rem;padding:2px 7px;border-radius:99px;background:rgba(255,255,255,0.08);color:#94a3b8;font-weight:700;"]]Mode auto[[/span]]',
                '[[/div]]',
                '[[div class="dash-tile-desc"]]Séparé / Réduit / Complet[[/div]]',
                '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;" onclick="event.stopPropagation()"]]',
                  '[[button type="button" class="btn-enter" style="margin:0;padding:8px 4px;font-size:0.78rem;" id="btnEnterTr" onclick="entrerEntrainement(false)"]]Mode Tactique[[/button]]',
                  '[[button type="button" class="btn-enter btn-enter-tinder" style="margin:0;padding:8px 4px;font-size:0.78rem;" id="btnEnterTrTinder" onclick="entrerEntrainement(true)"]]Mode Tinder[[/button]]',
                '[[/div]]',
                '[[button type="button" class="btn-enter btn-enter-alt" style="margin-top:6px;padding:6px;font-size:0.75rem;width:100%;" onclick="event.stopPropagation();ouvrirModalConfigEntrainements()"]]Configurer créneaux[[/button]]',
              '[[/div]]',
              '[[div class="dash-tile"]]',
                '[[div class="dash-tile-title"]]Effectif du Club[[/div]]',
                '[[div class="dash-tile-desc"]]Photos, postes et notes privées coach[[/div]]',
                '[[button type="button" class="btn-enter btn-enter-alt" style="margin:6px 0 0 0;padding:8px;font-size:0.8rem;width:100%;" onclick="entrerEffectif()"]]Ouvrir l\'effectif[[/button]]',
              '[[/div]]',
              '[[div class="dash-tile"]]',
                '[[div class="dash-tile-title"]]Identité & Blason[[/div]]',
                '[[div class="dash-tile-desc"]]Photo de blason, couleurs & thèmes[[/div]]',
                '[[button type="button" class="btn-enter btn-enter-alt" style="margin:6px 0 0 0;padding:8px;font-size:0.8rem;width:100%;" onclick="ouvrirModalCouleurs()"]]Personnaliser[[/button]]',
              '[[/div]]',
              '[[div class="dash-tile" style="grid-column:1/-1;background:linear-gradient(135deg,rgba(30,41,59,0.9),rgba(15,23,42,0.95));border:1px solid rgba(234,179,8,0.3);"]]',
                '[[div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;"]]',
                  '[[div class="dash-tile-title" style="color:#fde047;"]]💰 Caisse Noire & Amendes[[/div]]',
                  '[[span id="badgeCoachCaisseStats" style="font-size:0.75rem;padding:2px 8px;border-radius:99px;background:rgba(234,179,8,0.2);color:#fef08a;font-weight:800;"]]0 € en caisse[[/span]]',
                '[[/div]]',
                '[[div class="dash-tile-desc"]]Gérer les amendes, encaissements, dépenses d\'équipe et barème[[/div]]',
                '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;"]]',
                  '[[button type="button" class="btn-enter" style="margin:0;padding:8px 4px;font-size:0.78rem;background:rgba(234,179,8,0.25);border:1px solid #eab308;color:#fef08a;font-weight:700;" onclick="ouvrirModalAdminCaisseNoire()"]]⚙️ Administrer[[/button]]',
                  '[[button type="button" class="btn-enter btn-enter-alt" style="margin:0;padding:8px 4px;font-size:0.78rem;" onclick="ouvrirModalCaisseNoire()"]]👀 Vue Joueurs[[/button]]',
                '[[/div]]',
              '[[/div]]',
            '[[/div]]',
            '[[button type="button" class="btn-enter btn-enter-alt" id="btnCheckUpdateCoach" onclick="verifierMiseAJourManuelle()" style="font-size:0.76rem;padding:8px;color:#94a3b8;border-color:rgba(148,163,184,0.2);width:100%;margin-top:8px;"]]Vérifier les mises à jour du Bot[[/button]]',
            '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;"]]',
              '[[button type="button" class="btn-enter btn-enter-alt" onclick="ouvrirModalCollectifs()" style="font-size:0.75rem;padding:7px;margin:0;"]]👥 Multi-Collectifs[[/button]]',
              '[[button type="button" class="btn-enter btn-enter-alt" onclick="ouvrirModalPwa()" style="font-size:0.75rem;padding:7px;margin:0;"]]📲 Installer App[[/button]]',
            '[[/div]]',
            '[[button type="button" class="btn-enter" onclick="ouvrirModalGuideCoach()" style="font-size:0.78rem;padding:8px;margin-top:6px;background:rgba(99,102,241,0.22);border:1px solid #6366f1;color:#e0e7ff;font-weight:700;width:100%;"]]📖 Guide des Fonctionnalités Coach[[/button]]',
          '[[/div]]',
          '[[button class="btn-reset" style="width:100%;margin-top:6px;" onclick="seDeconnecter()"]]Déconnexion[[/button]]',
        '[[/div]]',
        '[[button type="button" class="btn-reset" style="font-size:0.74rem;color:#94a3b8;margin-top:12px;width:100%;" onclick="ouvrirModalPwa()"]]📲 Ajouter sur l\'écran d\'accueil mobile (PWA)[[/button]]',
      '[[/div]]',
    '[[/div]]',
    '[[div id="appView"]]',
    '[[header]]',
      '[[div class="logo" id="headerLogo"]][[img class="logo-img" id="appHeaderLogoImg" src="' + cfg.logoUrl + '" alt="Logo"]] <span id="headerClubTitle">' + cfg.nomClub + ' - Compo Coach</span>[[/div]]',
      '[[div class="header-actions"]]',
        '[[button class="btn-reset" onclick="retourAccueil()"]]Accueil[[/button]]',
        '[[button class="btn-reset" id="btnCollectifsAppHeader" onclick="ouvrirModalCollectifs()"]]Collectifs ▾[[/button]]',
        '[[button class="btn-reset" onclick="entrerEffectif()"]]Effectif & Notes[[/button]]',
        '[[button class="btn-reset" onclick="ouvrirModalCouleurs()"]]Couleurs & Équipes[[/button]]',
        '[[button class="btn-reset" onclick="ouvrirModalAdminCaisseNoire()" title="Caisse Noire & Amendes"]]💰 Caisse Noire[[/button]]',
        '[[button class="btn-reset" onclick="ouvrirModalGuideCoach()" title="Guide des fonctionnalités coach"]]📖 Guide[[/button]]',
        '[[button class="btn-sync js-sync-wa" onclick="forcerActualisationWhatsApp()"]]Actualiser WhatsApp[[/button]]',
        '[[button class="btn-tinder" id="btnSwitchMode" onclick="basculerMode()"]]Mode Tinder[[/button]]',
        '[[span class="badge-mode js-statut" id="statutChargement"]]Chargement...[[/span]]',
      '[[/div]]',
    '[[/header]]',
    '[[div class="view-mode-tabs"]]',
      '[[button type="button" class="view-mode-tab active" id="tabClassicMode" onclick="choisirMode(false)"]]Mode Tactique[[/button]]',
      '[[button type="button" class="view-mode-tab" id="tabTinderMode" onclick="choisirMode(true)"]]Mode Tinder[[/button]]',
    '[[/div]]',
    '[[div id="banniereBrouillon" style="display:none;background:rgba(2,132,199,0.18);border:1px solid #0284c7;border-radius:12px;padding:9px 14px;max-width:1400px;margin:8px auto;align-items:center;justify-content:space-between;font-size:0.83rem;"]]',
      '[[span style="color:#e0f2fe;font-weight:600;"]]Brouillon de sélection détecté pour ce week-end[[/span]]',
      '[[div style="display:flex;gap:8px;"]]',
        '[[button type="button" class="btn-save" style="padding:5px 12px;font-size:0.75rem;" onclick="restaurerBrouillon()"]]Reprendre ma sélection[[/button]]',
        '[[button type="button" class="btn-reset" style="padding:5px 10px;font-size:0.75rem;color:#f87171;" onclick="effacerBrouillon()"]]Ignorer[[/button]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="board" id="classicView"]]',
      '[[div class="col col-1b" id="colBox1B"]]',
        '[[div class="col-title"]][[span]][[span class="team-dot team-dot-1"]][[/span]]<span id="labelCol1B">' + cfg.nomEquipe1 + '</span>[[/span]][[span id="count1B"]]0/12[[/span]][[/div]]',
        '[[div class="col-sub" id="sub1B"]]Match ' + cfg.nomEquipe1 + '[[/div]]',
        '[[div class="dropzone" id="zone1B"]][[/div]]',
      '[[/div]]',
      '[[div class="col col-pool" id="colBoxPool"]]',
        '[[div class="col-title"]][[span]]Joueurs Disponibles[[/span]][[span id="countPool"]]0[[/span]][[/div]]',
        '[[div class="col-sub" style="display:flex;justify-content:space-between;align-items:center;gap:6px;"]]',
          '[[span]]Glissez les joueurs vers vos équipes[[/span]]',
          '[[button type="button" class="btn-mini-edit" style="color:var(--color-secondary);border-color:var(--color-secondary);font-weight:700;" onclick="ouvrirModalRenfort(false)"]]+ Renfort[[/button]]',
        '[[/div]]',
        '[[div class="dropzone" id="zonePool"]][[/div]]',
      '[[/div]]',
      '[[div class="col col-1c" id="colBox1C"]]',
        '[[div class="col-title"]][[span]][[span class="team-dot team-dot-2"]][[/span]]<span id="labelCol1C">' + cfg.nomEquipe2 + '</span>[[/span]][[span id="count1C"]]0/12[[/span]][[/div]]',
        '[[div class="col-sub" id="sub1C"]]Match ' + cfg.nomEquipe2 + '[[/div]]',
        '[[div class="dropzone" id="zone1C"]][[/div]]',
      '[[/div]]',
      '[[div class="col col-1d" id="colBox1D" style="display:none;"]]',
        '[[div class="col-title"]][[span]][[span class="team-dot team-dot-3"]][[/span]]<span id="labelCol1D">' + (cfg.nomEquipe3 || 'Équipe 3') + '</span>[[/span]][[span id="count1D"]]0/12[[/span]][[/div]]',
        '[[div class="col-sub" id="sub1D"]]Match ' + (cfg.nomEquipe3 || 'Équipe 3') + '[[/div]]',
        '[[div class="dropzone" id="zone1D"]][[/div]]',
      '[[/div]]',
      '[[div class="col col-repos" id="colBoxRepos"]]',
        '[[div class="col-title"]][[span]][[span class="team-dot team-dot-repos"]][[/span]]Au Repos / Non retenus[[/span]][[span id="countRepos"]]0[[/span]][[/div]]',
        '[[div class="col-sub" id="subRepos"]]Joueurs non convoqués ce week-end[[/div]]',
        '[[div class="dropzone" id="zoneRepos"]][[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div id="tinderView"]]',
      '[[div class="tinder-header-title" style="margin-bottom:6px;color:var(--color-secondary);font-weight:800;letter-spacing:0.5px;"]]MODE SÉLECTION TINDER[[/div]]',
      '[[button type="button" class="btn-mini-edit tinder-btn-renfort" style="color:var(--color-secondary);border-color:var(--color-secondary);font-weight:700;margin:0 auto 8px auto;display:block;" onclick="ouvrirModalRenfort(false)"]]+ Ajouter un renfort dans la sélection[[/button]]',
      '[[div class="tscore-bar" id="tscoreBar"]]',
        '[[span id="tBox1B"]][[span class="team-dot team-dot-1"]][[/span]]<span id="labelTinder1B">' + cfg.nomEquipe1 + '</span> : [[b id="tCount1B"]]0[[/b]]/12[[/span]]',
        '[[span id="tBoxPool" style="color:#d4d4d4;"]]Restants : [[b id="tCountPool"]]0[[/b]][[/span]]',
        '[[span id="tBox1C"]][[span class="team-dot team-dot-2"]][[/span]]<span id="labelTinder1C">' + cfg.nomEquipe2 + '</span> : [[b id="tCount1C"]]0[[/b]]/12[[/span]]',
        '[[span id="tBox1D" style="display:none;"]][[span class="team-dot team-dot-3"]][[/span]]<span id="labelTinder1D">' + (cfg.nomEquipe3 || 'Équipe 3') + '</span> : [[b id="tCount1D"]]0[[/b]]/12[[/span]]',
        '[[span id="tBoxRepos" style="color:#f87171;"]][[span class="team-dot team-dot-repos"]][[/span]]Repos : [[b id="tCountRepos"]]0[[/b]][[/span]]',
      '[[/div]]',
      '[[div id="tinderReposBar" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:10px;padding:6px 10px;margin-bottom:8px;font-size:0.76rem;text-align:left;"]][[span style="color:#fca5a5;font-weight:700;margin-right:6px;"]]Au Repos (clic pour rétablir) :[[/span]][[span id="tinderReposChips" style="display:inline-flex;gap:4px;flex-wrap:wrap;"]][[/span]][[/div]]',
      '[[div class="tdeck" id="tinderContainer"]][[/div]]',
      '[[div class="tcontrols" id="tControlsContainer"]][[/div]]',
      '[[div class="tinder-actions-bar" style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap;"]]',
        '[[button type="button" class="btn-reset" style="font-size:0.8rem;padding:7px 12px;" onclick="choisirMode(false)"]]Revenir au Mode Tactique[[/button]]',
        '[[button type="button" class="btn-save" style="font-size:0.8rem;padding:7px 12px;background:#0284c7;" onclick="sauvegarderBrouillonLocal(true)"]]Sauvegarder Brouillon[[/button]]',
        '[[button type="button" class="btn-wa" style="font-size:0.8rem;padding:7px 12px;" onclick="ouvrirApercuMatch()"]]Aperçu & Terrain tactique[[/button]]',
      '[[/div]]',
      '[[div class="tinder-kbd-hint" style="font-size:0.75rem;color:#94a3b8;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;"]][[span]]⌨️ <b>Clavier :</b> Flèches ← ↓ → ↑ ou 1 / 2 / 3 / Espace[[/span]][[span]]↺ <b>Retour</b> pour annuler[[/span]][[/div]]',
    '[[/div]]',
    '[[footer id="appFooter"]]',
      '[[button class="btn-reset" onclick="recommencerSelection()"]]Réinitialiser[[/button]]',
      '[[button class="btn-save" style="background:#0284c7;" onclick="sauvegarderBrouillonLocal(true)"]]Sauvegarder Brouillon[[/button]]',
      '[[button class="btn-reset" id="btnChargerCompoPrec" onclick="rechargerCompoPrecedente()"]]↺ Charger compo précédente[[/button]]',
      '[[button class="btn-save" onclick="sauvegarder(false)"]]Sauvegarder[[/button]]',
      '[[button class="btn-wa" onclick="ouvrirApercuMatch()"]]Aperçu & Terrain tactique[[/button]]',
    '[[/footer]]',
    '[[/div]]',
    '[[div id="trainView"]]',
    '[[header]]',
      '[[div class="logo"]][[img class="logo-img" id="trainHeaderLogoImg" src="' + cfg.logoUrl + '" alt="Logo"]] Entraînements[[/div]]',
      '[[div class="header-actions"]]',
        '[[button class="btn-reset" onclick="retourAccueil()"]]Accueil[[/button]]',
        '[[button class="btn-reset" onclick="ouvrirModalCollectifs()"]]Collectifs ▾[[/button]]',
        '[[button class="btn-reset" onclick="entrerEffectif()"]]Effectif[[/button]]',
        '[[button class="btn-reset" onclick="ouvrirModalConfigEntrainements()"]]Créneaux & Horaires[[/button]]',
        '[[button class="btn-reset" onclick="ouvrirModalGuideCoach()" title="Guide des fonctionnalités coach"]]📖 Guide[[/button]]',
        '[[button class="btn-sync js-sync-wa" onclick="forcerActualisationWhatsApp()"]]Actualiser WA[[/button]]',
        '[[button class="btn-tinder" id="btnSwitchModeTrain" onclick="basculerModeTrain()"]]Mode Tinder[[/button]]',
        '[[span class="badge-mode js-statut" id="statutTrain"]][[/span]]',
      '[[/div]]',
    '[[/header]]',
    '[[div class="tabs" id="trainTabsContainer"]][[/div]]',
    '[[div class="train-config-bar"]]',
      '[[div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"]]',
        '[[span style="font-size:0.8rem;color:#94a3b8;font-weight:700;"]]Séance :[[/span]]',
        '[[div class="train-type-pills"]]',
          '[[button type="button" class="train-type-pill active" id="pillSepare" onclick="changerTypeSeance(\'separe\')"]]2 Groupes[[/button]]',
          '[[button type="button" class="train-type-pill" id="pillReduit" onclick="changerTypeSeance(\'reduit\')"]]Effectif réduit[[/button]]',
          '[[button type="button" class="train-type-pill" id="pillComplet" onclick="changerTypeSeance(\'complet\')"]]Effectif complet[[/button]]',
        '[[/div]]',
      '[[/div]]',
      '[[div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"]]',
        '[[span id="trainExplication" style="font-size:0.8rem;color:#94a3b8;"]]Répartissez les joueurs disponibles[[/span]]',
        '[[label id="lblMaxJoueurs" style="font-size:0.8rem;color:#cbd5e1;display:none;"]]Max retenus : [[input type="number" id="inpMaxJoueurs" value="20" min="5" max="35" onchange="majMaxRetenus(this.value)"]][[/label]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="view-mode-tabs" style="max-width:1200px;margin:8px auto;"]]',
      '[[button type="button" class="view-mode-tab active" id="tabTrainClassicMode" onclick="choisirModeTrain(false)"]]Mode Tactique[[/button]]',
      '[[button type="button" class="view-mode-tab" id="tabTrainTinderMode" onclick="choisirModeTrain(true)"]]Mode Tinder[[/button]]',
    '[[/div]]',
    '[[div class="board" id="trainBoardClassic"]]',
      '[[div class="col col-pool" id="trColPool"]]',
        '[[div class="col-title"]][[span id="trTitlePool"]]Dispos à répartir[[/span]][[span id="trCountPool"]]0[[/span]][[/div]]',
        '[[div class="col-sub" style="display:flex;justify-content:space-between;align-items:center;gap:6px;"]]',
          '[[span id="trSubPool"]]Glissez les joueurs vers les groupes[[/span]]',
          '[[button type="button" class="btn-mini-edit" style="color:var(--color-secondary);border-color:var(--color-secondary);font-weight:700;" onclick="ouvrirModalRenfort(true)"]]+ Renfort[[/button]]',
        '[[/div]]',
        '[[div class="dropzone" id="trZonePool"]][[/div]]',
      '[[/div]]',
      '[[div id="trDynamicZones" style="display:contents;"]][[/div]]',
    '[[/div]]',
    '[[div id="trainTinderView" style="display:none;max-width:420px;margin:10px auto 30px auto;padding:12px;text-align:center;"]]',
      '[[div class="tinder-header-title" style="margin-bottom:6px;color:var(--color-secondary);font-weight:800;letter-spacing:0.5px;"]]MODE ENTRAÎNEMENT TINDER[[/div]]',
      '[[button type="button" class="btn-mini-edit tinder-btn-renfort" style="color:var(--color-secondary);border-color:var(--color-secondary);font-weight:700;margin:0 auto 8px auto;display:block;" onclick="ouvrirModalRenfort(true)"]]+ Ajouter un renfort / hors sondage[[/button]]',
      '[[div class="tscore-bar" id="trainTscoreBar"]][[/div]]',
      '[[div class="tdeck" id="trainTinderContainer"]][[/div]]',
      '[[div class="tcontrols" id="trainTControlsContainer"]][[/div]]',
      '[[div class="tinder-actions-bar" style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap;"]]',
        '[[button type="button" class="btn-reset" style="font-size:0.8rem;padding:7px 12px;" onclick="choisirModeTrain(false)"]]Revenir au Mode Tactique[[/button]]',
        '[[button type="button" class="btn-save" style="font-size:0.8rem;padding:7px 12px;" onclick="sauvegarderEntrainement(false)"]]Sauvegarder la Séance[[/button]]',
        '[[button type="button" class="btn-wa" style="font-size:0.8rem;padding:7px 12px;" onclick="ouvrirApercuEntrainement()"]]Aperçu WhatsApp[[/button]]',
      '[[/div]]',
      '[[div class="tinder-kbd-hint" style="font-size:0.75rem;color:#94a3b8;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;"]][[span]]⌨️ <b>Clavier :</b> Flèches ← ↓ → ou 1 / 2 / Espace[[/span]][[span]]↺ <b>Retour</b> pour annuler[[/span]][[/div]]',
    '[[/div]]',
    '[[footer id="trainFooter"]]',
      '[[button class="btn-reset" onclick="reinitialiserSeance()"]]Réinitialiser[[/button]]',
      '[[button class="btn-save" onclick="sauvegarderEntrainement(false)"]]Sauvegarder[[/button]]',
      '[[button class="btn-wa" onclick="ouvrirApercuEntrainement()"]]Aperçu WhatsApp[[/button]]',
    '[[/footer]]',
    '[[/div]]',
    '[[div id="rosterView"]]',
    '[[header]]',
      '[[div class="logo"]][[img class="logo-img" id="rosterHeaderLogoImg" src="' + cfg.logoUrl + '" alt="Logo"]] Effectif - Photos & Notes Coach[[/div]]',
      '[[div class="header-actions"]]',
        '[[button class="btn-reset" onclick="retourAccueil()"]]Accueil[[/button]]',
        '[[button class="btn-reset" onclick="entrer()"]]← Retour Compo[[/button]]',
        '[[button type="button" class="btn-save" style="background:#16a34a;padding:5px 12px;font-size:0.78rem;" onclick="ouvrirModalNouveauJoueur()"]]+ Ajouter un joueur[[/button]]',
        '[[span class="badge-mode" id="rosterCount"]]0 joueurs[[/span]]',
      '[[/div]]',
    '[[/header]]',
    '[[main class="roster-wrap"]]',
      '[[div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;"]]',
        '[[input id="inpSearchRoster" class="inp-field" style="max-width:320px;" type="text" placeholder="Rechercher un joueur..." oninput="filtrerRoster(this.value)"]]',
        '[[div style="font-size:0.8rem;color:#a3a3a3;"]]Cliquez sur une fiche pour modifier la photo, le poste, l\'équipe ou la note coach[[/div]]',
      '[[/div]]',
      '[[div class="roster-grid" id="rosterGrid"]][[/div]]',
    '[[/main]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalJoueurBg" onclick="fermerModalSurBg(event)"]]',
      '[[div class="modal-box" style="position:relative;overflow-y:auto;overflow-x:hidden;"]]',
        '[[div id="modalJoueurBackdrop" style="position:absolute;inset:-30px;background-size:cover;background-position:center;filter:blur(30px) saturate(1.3) brightness(0.38);opacity:0;pointer-events:none;transition:opacity 0.4s ease;z-index:0;"]][[/div]]',
        '[[div style="position:relative;z-index:1;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;"]]',
          '[[h2 id="modalJoueurNom" style="margin:0;font-size:1.2rem;"]]Fiche Joueur[[/h2]]',
          '[[button class="btn-reset" style="padding:4px 10px;" onclick="fermerModalJoueur()"]]✕[[/button]]',
        '[[/div]]',
        '[[div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:14px;"]]',
          '[[div id="modalJoueurAvatarWrap" class="modal-avatar-heart" style="width:110px;height:110px;border-radius:50%;overflow:hidden;border:3px solid var(--color-primary);position:relative;background:#0a0a0a;display:flex;align-items:center;justify-content:center;transition:all 0.3s;"]]',
            '[[img id="modalJoueurImg" style="width:100%;height:100%;object-fit:cover;display:none;"]]',
            '[[div id="modalJoueurInitiale" style="font-size:2.4rem;font-weight:900;color:var(--color-primary);"]]J[[/div]]',
          '[[/div]]',
          '[[input type="file" id="fileCoachPhoto" accept="image/*" style="display:none;" onchange="chargerPhotoDepuisModal(event)"]]',
          '[[div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;"]]',
            '[[button class="btn-enter" style="font-size:0.8rem;padding:7px 14px;width:auto;" onclick="ouvrirSelecteurPhotoCoach()"]]Modifier la photo[[/button]]',
            '[[button type="button" id="btnModalChouchou" class="btn-reset" style="font-size:0.8rem;padding:7px 12px;border-radius:8px;border:1px solid #f43f5e;color:#fda4af;background:rgba(244,63,94,0.12);display:inline-flex;align-items:center;gap:6px;cursor:pointer;transition:all 0.2s;" onclick="toggleChouchouCourant()"]]❤️ Chouchou[[/button]]',
          '[[/div]]',
        '[[/div]]',
        '[[div style="display:flex;flex-direction:column;gap:10px;text-align:left;"]]',
          '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"]]',
            '[[div]][[label style="font-size:0.75rem;color:#d4d4d4;display:block;margin-bottom:3px;"]]Téléphone :[[/label]][[input type="tel" id="modalJoueurTel" class="inp-field" placeholder="06..."]][[/div]]',
            '[[div]][[label style="font-size:0.75rem;color:#d4d4d4;display:block;margin-bottom:3px;"]]Équipe :[[/label]][[select id="modalJoueurEquipe" class="inp-field"]][[/select]][[/div]]',
          '[[/div]]',
          '[[label style="font-size:0.8rem;color:#d4d4d4;"]]Poste sur le terrain :[[/label]]',
          '[[select id="modalJoueurPoste" class="inp-field"]]',
            '[[option value="Gardien"]]Gardien[[/option]]',
            '[[option value="Ailier Gauche"]]Ailier Gauche[[/option]]',
            '[[option value="Arrière Gauche"]]Arrière Gauche[[/option]]',
            '[[option value="Demi-Centre"]]Demi-Centre[[/option]]',
            '[[option value="Pivot"]]Pivot[[/option]]',
            '[[option value="Arrière Droit"]]Arrière Droit[[/option]]',
            '[[option value="Ailier Droit"]]Ailier Droit[[/option]]',
          '[[/select]]',
          '[[label style="font-size:0.8rem;color:#d4d4d4;"]]Notes du Coach (privé) :[[/label]]',
          '[[textarea id="modalJoueurNote" class="inp-field" rows="3" placeholder="Ex : Blessé au genou, revient semaine prochaine..."]][[/textarea]]',
          '[[div id="boxModalJoueurTresorier" style="display:flex;align-items:center;gap:8px;background:rgba(234,179,8,0.12);padding:8px 12px;border-radius:10px;border:1px solid rgba(234,179,8,0.25);margin-top:2px;"]]',
            '[[input type="checkbox" id="modalJoueurTresorier" style="width:18px;height:18px;accent-color:#eab308;cursor:pointer;"]]',
            '[[label for="modalJoueurTresorier" style="font-size:0.78rem;font-weight:700;color:#fef08a;cursor:pointer;margin:0;"]]⭐ Trésorier de la Caisse Noire (gestion & effectif)[[/label]]',
          '[[/div]]',
          '[[div id="modalJoueurStatus" style="font-size:0.8rem;color:var(--color-secondary);min-height:1.2em;text-align:center;"]][[/div]]',
          '[[div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:8px;"]]',
            '[[button type="button" class="btn-reset" style="color:#f87171;border-color:rgba(239,68,68,0.3);font-size:0.75rem;padding:5px 8px;" onclick="supprimerJoueurCourant()"]]Supprimer de l\'effectif[[/button]]',
            '[[div style="display:flex;gap:6px;"]]',
              '[[button type="button" class="btn-reset" onclick="fermerModalJoueur()"]]Annuler[[/button]]',
              '[[button type="button" class="btn-save" onclick="sauvegarderFicheDepuisModal()"]]Enregistrer[[/button]]',
            '[[/div]]',
          '[[/div]]',
        '[[/div]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalNouveauJoueurBg" onclick="fermerModalNouveauJoueurSurBg(event)"]]',
      '[[div class="modal-box" style="max-width:440px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[h2 style="margin:0;font-size:1.15rem;color:#f8fafc;"]]Ajouter un Nouveau Joueur[[/h2]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;" onclick="fermerModalNouveauJoueur()"]]✕[[/button]]',
        '[[/div]]',
        '[[div style="display:flex;flex-direction:column;gap:10px;text-align:left;"]]',
          '[[div]][[label style="font-size:0.75rem;color:#94a3b8;display:block;margin-bottom:4px;"]]Nom et Prénom * :[[/label]][[input type="text" id="inpNouvNom" class="inp-field" placeholder="Ex : Thomas Dubois" required]][[/div]]',
          '[[div]][[label style="font-size:0.75rem;color:#94a3b8;display:block;margin-bottom:4px;"]]Numéro de téléphone (optionnel) :[[/label]][[input type="tel" id="inpNouvTel" class="inp-field" placeholder="Ex : 06 12 34 56 78"]][[/div]]',
          '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"]]',
            '[[div]][[label style="font-size:0.75rem;color:#94a3b8;display:block;margin-bottom:4px;"]]Poste :[[/label]][[select id="selNouvPoste" class="inp-field"]][[option value="Gardien"]]Gardien[[/option]][[option value="Ailier Gauche"]]Ailier Gauche[[/option]][[option value="Arrière Gauche"]]Arrière Gauche[[/option]][[option value="Demi-Centre" selected]]Demi-Centre[[/option]][[option value="Pivot"]]Pivot[[/option]][[option value="Arrière Droit"]]Arrière Droit[[/option]][[option value="Ailier Droit"]]Ailier Droit[[/option]][[/select]][[/div]]',
            '[[div]][[label style="font-size:0.75rem;color:#94a3b8;display:block;margin-bottom:4px;"]]Équipe :[[/label]][[select id="selNouvEquipe" class="inp-field"]][[/select]][[/div]]',
          '[[/div]]',
          '[[div]][[label style="font-size:0.75rem;color:#94a3b8;display:block;margin-bottom:4px;"]]Notes Coach (confidentiel) :[[/label]][[textarea id="inpNouvNote" class="inp-field" rows="2" placeholder="Ex : Joue aussi arrière, retour blessure..."]][[/textarea]][[/div]]',
          '[[div id="boxNouvJoueurTresorier" style="display:flex;align-items:center;gap:8px;background:rgba(234,179,8,0.12);padding:8px 12px;border-radius:10px;border:1px solid rgba(234,179,8,0.25);margin-top:2px;"]]',
            '[[input type="checkbox" id="inpNouvTresorier" style="width:18px;height:18px;accent-color:#eab308;cursor:pointer;"]]',
            '[[label for="inpNouvTresorier" style="font-size:0.78rem;font-weight:700;color:#fef08a;cursor:pointer;margin:0;"]]⭐ Trésorier de la Caisse Noire[[/label]]',
          '[[/div]]',
          '[[div id="statusNouvJoueur" style="font-size:0.8rem;color:var(--color-secondary);min-height:1.2em;text-align:center;"]][[/div]]',
          '[[div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;"]]',
            '[[button type="button" class="btn-reset" onclick="fermerModalNouveauJoueur()"]]Annuler[[/button]]',
            '[[button type="button" class="btn-save" style="background:#16a34a;" onclick="creerNouveauJoueurClient()"]]Créer le Joueur[[/button]]',
          '[[/div]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalRenfortBg" onclick="fermerModalRenfortSurBg(event)"]]',
      '[[div class="modal-box" style="max-width:480px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[h2 style="margin:0;font-size:1.15rem;color:#f8fafc;"]]Ajouter un Renfort / Hors sondage[[/h2]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;" onclick="fermerModalRenfort()"]]✕[[/button]]',
        '[[/div]]',
        '[[p style="font-size:0.78rem;color:#94a3b8;margin:0 0 10px 0;text-align:left;"]]Sélectionnez un joueur de l\'effectif absent du sondage (descente d\'équipe, retardataire) ou ajoutez un joueur invité.[[/p]]',
        '[[div style="margin-bottom:10px;"]][[input type="text" id="inpFiltreRenfort" class="inp-field" placeholder="Rechercher dans l\'effectif..." oninput="filtrerListeRenforts(this.value)"]][[/div]]',
        '[[div id="listeRenfortsDispos" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:14px;text-align:left;"]][[/div]]',
        '[[div style="border-top:1px solid rgba(148,163,184,0.15);padding-top:10px;text-align:left;"]]',
          '[[div style="font-size:0.8rem;font-weight:700;color:#cbd5e1;margin-bottom:6px;"]]Ou ajouter un joueur invité / extérieur :[[/div]]',
          '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;"]]',
            '[[input type="text" id="inpInviteNom" class="inp-field" placeholder="Nom Prénom"]]',
            '[[select id="selInvitePoste" class="inp-field"]][[option value="Gardien"]]Gardien[[/option]][[option value="Ailier Gauche"]]Ailier Gauche[[/option]][[option value="Arrière Gauche"]]Arrière Gauche[[/option]][[option value="Demi-Centre" selected]]Demi-Centre[[/option]][[option value="Pivot"]]Pivot[[/option]][[option value="Arrière Droit"]]Arrière Droit[[/option]][[option value="Ailier Droit"]]Ailier Droit[[/option]][[/select]]',
          '[[/div]]',
          '[[button type="button" class="btn-enter" style="width:100%;font-size:0.78rem;padding:7px;" onclick="ajouterInviteClient()"]]Ajouter cet invité dans les disponibles[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalCollectifsBg" onclick="fermerModalCollectifsSurBg(event)"]]',
      '[[div class="modal-box" style="max-width:480px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[h2 style="margin:0;font-size:1.15rem;color:#f8fafc;"]]Collectifs & Multi-Groupes[[/h2]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;" onclick="fermerModalCollectifs()"]]✕[[/button]]',
        '[[/div]]',
        '[[p style="font-size:0.78rem;color:#94a3b8;margin:0 0 12px 0;text-align:left;"]]Gérez plusieurs collectifs (ex: SG1-SG2 et -15 Filles) et basculez instantanément de l\'un à l\'autre sans vous reconnecter.[[/p]]',
        '[[div style="font-size:0.8rem;font-weight:700;color:#cbd5e1;margin-bottom:6px;text-align:left;"]]Collectifs enregistrés :[[/div]]',
        '[[div id="listeCollectifs" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;text-align:left;"]][[/div]]',
        '[[div style="background:#0b1120;border:1px solid rgba(148,163,184,0.18);border-radius:12px;padding:12px;text-align:left;"]]',
          '[[div style="font-size:0.8rem;font-weight:800;color:#f8fafc;margin-bottom:6px;"]]Lier un autre collectif / catégorie :[[/div]]',
          '[[div style="display:flex;flex-direction:column;gap:8px;"]]',
            '[[input type="text" id="inpNouvCollectifNom" class="inp-field" placeholder="Nom du collectif (ex : -15 Filles)"]]',
            '[[input type="url" id="inpNouvCollectifUrl" class="inp-field" placeholder="URL de la WebApp Google Apps Script"]]',
            '[[button type="button" class="btn-enter" style="font-size:0.78rem;padding:7px;" onclick="ajouterCollectifLie()"]]Enregistrer ce collectif[[/button]]',
          '[[/div]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalPwaInstallBg" onclick="fermerModalPwaSurBg(event)"]]',
      '[[div class="modal-box" style="max-width:440px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[h2 style="margin:0;font-size:1.15rem;color:#f8fafc;"]]Installer sur votre smartphone[[/h2]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;" onclick="fermerModalPwa()"]]✕[[/button]]',
        '[[/div]]',
        '[[p style="font-size:0.8rem;color:#94a3b8;margin:0 0 12px 0;text-align:left;"]]Installez Handball Bot sur votre écran d\'accueil pour l\'utiliser en plein écran sans barre d\'adresse, comme une application native.[[/p]]',
        '[[div id="pwaIosGuide" style="display:none;background:#0e1626;padding:14px;border-radius:14px;border:1px solid rgba(148,163,184,0.18);text-align:left;font-size:0.82rem;line-height:1.45;color:#e2e8f0;"]]',
          '[[div style="font-weight:800;color:var(--color-primary);margin-bottom:8px;"]]Sur iPhone / iPad (Safari) :[[/div]]',
          '[[div style="margin-bottom:6px;"]]1. Touchez l\'icône Partager (carré avec flèche vers le haut ⎋) en bas de Safari.[[/div]]',
          '[[div style="margin-bottom:6px;"]]2. Faites défiler et choisissez « Sur l\'écran d\'accueil » ➕.[[/div]]',
          '[[div]]3. Appuyez sur « Ajouter » en haut à droite. L\'application est installée ![[/div]]',
        '[[/div]]',
        '[[div id="pwaAndroidGuide" style="display:none;background:#0e1626;padding:14px;border-radius:14px;border:1px solid rgba(148,163,184,0.18);text-align:left;font-size:0.82rem;line-height:1.45;color:#e2e8f0;"]]',
          '[[div style="font-weight:800;color:var(--color-primary);margin-bottom:8px;"]]Sur Android (Chrome) :[[/div]]',
          '[[div style="margin-bottom:8px;"]]1. Appuyez sur le menu des 3 points verticaux ⋮ en haut à droite.[[/div]]',
          '[[div style="margin-bottom:8px;"]]2. Sélectionnez « Ajouter à l\'écran d\'accueil » ou « Installer l\'application ».[[/div]]',
          '[[div]]3. Validez l\'installation.[[/div]]',
          '[[button type="button" id="btnPwaNativeInstall" class="btn-enter" style="width:100%;margin-top:10px;display:none;" onclick="declencherPwaNative()"]]Installer maintenant[[/button]]',
        '[[/div]]',
        '[[div style="margin-top:14px;display:flex;justify-content:flex-end;"]]',
          '[[button type="button" class="btn-reset" onclick="fermerModalPwa()"]]Fermer[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalCouleursBg" onclick="fermerModalCouleursSurBg(event)"]]',
      '[[div class="modal-box" style="max-width:450px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[h2 style="margin:0;font-size:1.25rem;display:flex;align-items:center;gap:8px;"]]Identité & Couleurs du Club[[/h2]]',
          '[[button class="btn-reset" style="padding:4px 10px;" onclick="fermerModalCouleurs()"]]✕[[/button]]',
        '[[/div]]',
        '[[p style="font-size:0.8rem;color:#94a3b8;margin:0 0 14px 0;text-align:left;"]]Personnalisez l\'identité visuelle et le blason de votre club. Ces éléments s\'appliquent immédiatement et sont enregistrés dans Google Sheets.[[/p]]',
        '[[div style="background:#0e1726;border:1px solid rgba(249,115,22,0.4);border-radius:14px;padding:12px;margin-bottom:14px;text-align:left;box-shadow:0 4px 14px rgba(0,0,0,0.25);"]]',
          '[[div style="font-weight:800;font-size:0.88rem;color:#fb923c;display:flex;align-items:center;gap:6px;margin-bottom:4px;"]]⚡ Synchronisation Page Club FFHB[[/div]]',
          '[[div style="font-size:0.74rem;color:#cbd5e1;margin-bottom:8px;line-height:1.35;"]]Renseignez l\'URL de votre club sur monclub.ffhandball.fr pour importer automatiquement son blason officiel et extraire la charte graphique de l\'application.[[/div]]',
          '[[div style="display:flex;gap:6px;align-items:center;"]]',
            '[[input type="url" id="inpFfhbClubUrl" class="inp-field" placeholder="https://monclub.ffhandball.fr/clubs/..." style="font-size:0.76rem;padding:7px 10px;flex:1;min-width:0;"]]',
            '[[button type="button" id="btnImportFfhb" class="btn-enter" style="font-size:0.76rem;padding:7px 12px;white-space:nowrap;margin:0;width:auto;" onclick="importerDepuisFfhbClient()"]]⚡ Importer[[/button]]',
          '[[/div]]',
          '[[div id="ffhbImportStatus" style="font-size:0.73rem;color:var(--color-secondary);min-height:1.2em;margin-top:6px;line-height:1.3;"]][[/div]]',
        '[[/div]]',
        '[[div style="background:#0b1120;border:1px solid rgba(148,163,184,0.18);border-radius:14px;padding:12px;margin-bottom:14px;text-align:left;"]]',
          '[[div style="font-weight:800;font-size:0.88rem;margin-bottom:4px;display:flex;align-items:center;gap:6px;color:#f8fafc;"]]Blason & Photo du Club[[/div]]',
          '[[div style="font-size:0.75rem;color:#94a3b8;margin-bottom:10px;"]]Téléversez le logo du club ou collez un lien URL direct.[[/div]]',
          '[[div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;"]]',
            '[[div style="width:68px;height:68px;border-radius:12px;background:#030712;border:1px solid rgba(148,163,184,0.25);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:4px;flex-shrink:0;"]]',
              '[[img id="modalClubLogoPreview" src="' + cfg.logoUrl + '" style="max-width:100%;max-height:100%;object-fit:contain;"]]',
            '[[/div]]',
            '[[div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;"]]',
              '[[input type="file" id="fileClubLogo" accept="image/*" style="display:none;" onchange="chargerFichierLogoClub(event)"]]',
              '[[button type="button" class="btn-enter" style="font-size:0.78rem;padding:7px 10px;margin:0;width:100%;" onclick="ouvrirSelecteurLogoClub()"]]Téléverser une photo / blason[[/button]]',
              '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:5px 8px;color:#94a3b8;width:100%;" onclick="reinitialiserLogoClubClient()"]]↺ Rétablir le logo dynamique officiel[[/button]]',
            '[[/div]]',
          '[[/div]]',
          '[[div style="display:flex;gap:6px;align-items:center;"]]',
            '[[input type="url" id="inpClubLogoUrl" class="inp-field" placeholder="Ou collez un lien URL d\'image..." style="font-size:0.78rem;padding:6px 10px;"]]',
            '[[button type="button" class="btn-save" style="font-size:0.76rem;padding:6px 12px;white-space:nowrap;" onclick="sauvegarderLogoUrlClient()"]]Appliquer URL[[/button]]',
          '[[/div]]',
          '[[div id="modalLogoStatus" style="font-size:0.75rem;color:var(--color-secondary);min-height:1.2em;margin-top:6px;text-align:center;"]][[/div]]',
        '[[/div]]',
        '[[div style="background:#0b1120;border:1px solid rgba(148,163,184,0.18);border-radius:14px;padding:12px;margin-bottom:14px;text-align:left;"]]',
          '[[div style="font-weight:800;font-size:0.88rem;margin-bottom:4px;display:flex;align-items:center;gap:6px;color:#f8fafc;"]]Nombre d\'Équipes dans le groupe WhatsApp[[/div]]',
          '[[div style="font-size:0.75rem;color:#94a3b8;margin-bottom:10px;"]]Adapte les colonnes de présence, les compositions et les sélections (1, 2 ou 3 équipes).[[/div]]',
          '[[div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;"]]',
            '[[button type="button" class="btn-reset" id="btnNbEq1" style="padding:8px 4px;font-size:0.8rem;border:1px solid #334155;border-radius:8px;" onclick="choisirNbEquipesModal(1)"]]1 Équipe[[/button]]',
            '[[button type="button" class="btn-reset" id="btnNbEq2" style="padding:8px 4px;font-size:0.8rem;border:1px solid #334155;border-radius:8px;" onclick="choisirNbEquipesModal(2)"]]2 Équipes[[/button]]',
            '[[button type="button" class="btn-reset" id="btnNbEq3" style="padding:8px 4px;font-size:0.8rem;border:1px solid #334155;border-radius:8px;" onclick="choisirNbEquipesModal(3)"]]3 Équipes[[/button]]',
          '[[/div]]',
          '[[input type="hidden" id="inpNbEquipesModal" value="3"]]',
          '[[div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;"]]',
            '[[div id="boxCfgEq1" style="background:#090d16;padding:10px;border-radius:10px;border:1px solid rgba(148,163,184,0.15);"]]',
              '[[div style="font-weight:700;font-size:0.8rem;color:var(--color-team1);margin-bottom:6px;"]]Équipe 1[[/div]]',
              '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;"]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Code :[[/label]][[input type="text" id="cfgEqCode1" class="inp-field" placeholder="SG1" style="font-size:0.75rem;padding:5px;"]][[/div]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Libellé :[[/label]][[input type="text" id="cfgEqLabel1" class="inp-field" placeholder="Équipe 1" style="font-size:0.75rem;padding:5px;"]][[/div]]',
              '[[/div]]',
              '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Mot-clé FFHB :[[/label]][[input type="text" id="cfgEqMotCle1" class="inp-field" placeholder="MON CLUB" style="font-size:0.75rem;padding:5px;"]][[/div]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Délai RDV (h) :[[/label]][[input type="number" id="cfgEqDelai1" class="inp-field" value="1" min="0" max="5" step="0.5" style="font-size:0.75rem;padding:5px;"]][[/div]]',
              '[[/div]]',
              '[[div style="margin-top:4px;"]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]URL Poule FFHB :[[/label]][[input type="url" id="cfgEqUrl1" class="inp-field" placeholder="https://www.ffhandball.fr/..." style="font-size:0.72rem;padding:5px;"]][[/div]]',
            '[[/div]]',
            '[[div id="boxCfgEq2" style="background:#090d16;padding:10px;border-radius:10px;border:1px solid rgba(148,163,184,0.15);"]]',
              '[[div style="font-weight:700;font-size:0.8rem;color:var(--color-team2);margin-bottom:6px;"]]Équipe 2[[/div]]',
              '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;"]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Code :[[/label]][[input type="text" id="cfgEqCode2" class="inp-field" placeholder="SG2" style="font-size:0.75rem;padding:5px;"]][[/div]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Libellé :[[/label]][[input type="text" id="cfgEqLabel2" class="inp-field" placeholder="Équipe 2" style="font-size:0.75rem;padding:5px;"]][[/div]]',
              '[[/div]]',
              '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Mot-clé FFHB :[[/label]][[input type="text" id="cfgEqMotCle2" class="inp-field" placeholder="MON CLUB 2" style="font-size:0.75rem;padding:5px;"]][[/div]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Délai RDV (h) :[[/label]][[input type="number" id="cfgEqDelai2" class="inp-field" value="1" min="0" max="5" step="0.5" style="font-size:0.75rem;padding:5px;"]][[/div]]',
              '[[/div]]',
              '[[div style="margin-top:4px;"]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]URL Poule FFHB :[[/label]][[input type="url" id="cfgEqUrl2" class="inp-field" placeholder="https://www.ffhandball.fr/..." style="font-size:0.72rem;padding:5px;"]][[/div]]',
            '[[/div]]',
            '[[div id="boxCfgEq3" style="background:#090d16;padding:10px;border-radius:10px;border:1px solid rgba(148,163,184,0.15);"]]',
              '[[div style="font-weight:700;font-size:0.8rem;color:var(--color-team3);margin-bottom:6px;"]]Équipe 3[[/div]]',
              '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;"]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Code :[[/label]][[input type="text" id="cfgEqCode3" class="inp-field" placeholder="SG3" style="font-size:0.75rem;padding:5px;"]][[/div]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Libellé :[[/label]][[input type="text" id="cfgEqLabel3" class="inp-field" placeholder="Équipe 3" style="font-size:0.75rem;padding:5px;"]][[/div]]',
              '[[/div]]',
              '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Mot-clé FFHB :[[/label]][[input type="text" id="cfgEqMotCle3" class="inp-field" placeholder="MON CLUB 3" style="font-size:0.75rem;padding:5px;"]][[/div]]',
                '[[div]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]Délai RDV (h) :[[/label]][[input type="number" id="cfgEqDelai3" class="inp-field" value="1" min="0" max="5" step="0.5" style="font-size:0.75rem;padding:5px;"]][[/div]]',
              '[[/div]]',
              '[[div style="margin-top:4px;"]][[label style="font-size:0.7rem;color:#94a3b8;display:block;"]]URL Poule FFHB :[[/label]][[input type="url" id="cfgEqUrl3" class="inp-field" placeholder="https://www.ffhandball.fr/..." style="font-size:0.72rem;padding:5px;"]][[/div]]',
            '[[/div]]',
          '[[/div]]',
        '[[/div]]',
        '[[div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;"]]',
          '[[div style="display:flex;align-items:center;justify-content:space-between;background:#0a0a0a;padding:8px 12px;border-radius:10px;border:1px solid #2e2e2e;"]]',
            '[[div style="text-align:left;"]][[div style="font-size:0.85rem;font-weight:700;"]]Couleur Principale[[/div]][[div style="font-size:0.72rem;color:#a3a3a3;"]]Boutons, en-têtes, navigation[[/div]][[/div]]',
            '[[div style="display:flex;align-items:center;gap:8px;"]][[input type="color" id="inpColPrimaire" style="width:38px;height:34px;border:none;border-radius:6px;cursor:pointer;background:transparent;" onchange="majCouleursLive()"]][[input type="text" id="txtColPrimaire" class="inp-field" style="width:78px;padding:5px;text-align:center;font-size:0.8rem;text-transform:uppercase;" maxlength="7" oninput="synchroColorInput(\'Primaire\')"]][[/div]]',
          '[[/div]]',
          '[[div style="display:flex;align-items:center;justify-content:space-between;background:#0a0a0a;padding:8px 12px;border-radius:10px;border:1px solid #2e2e2e;"]]',
            '[[div style="text-align:left;"]][[div style="font-size:0.85rem;font-weight:700;"]]Couleur Secondaire[[/div]][[div style="font-size:0.72rem;color:#a3a3a3;"]]Dégradés, badges, notes coach[[/div]][[/div]]',
            '[[div style="display:flex;align-items:center;gap:8px;"]][[input type="color" id="inpColSecondaire" style="width:38px;height:34px;border:none;border-radius:6px;cursor:pointer;background:transparent;" onchange="majCouleursLive()"]][[input type="text" id="txtColSecondaire" class="inp-field" style="width:78px;padding:5px;text-align:center;font-size:0.8rem;text-transform:uppercase;" maxlength="7" oninput="synchroColorInput(\'Secondaire\')"]][[/div]]',
          '[[/div]]',
          '[[div id="rowColEq1" style="display:flex;align-items:center;justify-content:space-between;background:#0a0a0a;padding:8px 12px;border-radius:10px;border:1px solid #2e2e2e;"]]',
            '[[div style="text-align:left;"]][[div style="font-size:0.85rem;font-weight:700;"]]Couleur Équipe 1[[/div]][[div style="font-size:0.72rem;color:#a3a3a3;"]]Colonne & badges Équipe 1[[/div]][[/div]]',
            '[[div style="display:flex;align-items:center;gap:8px;"]][[input type="color" id="inpColEq1" style="width:38px;height:34px;border:none;border-radius:6px;cursor:pointer;background:transparent;" onchange="majCouleursLive()"]][[input type="text" id="txtColEq1" class="inp-field" style="width:78px;padding:5px;text-align:center;font-size:0.8rem;text-transform:uppercase;" maxlength="7" oninput="synchroColorInput(\'Eq1\')"]][[/div]]',
          '[[/div]]',
          '[[div id="rowColEq2" style="display:flex;align-items:center;justify-content:space-between;background:#0a0a0a;padding:8px 12px;border-radius:10px;border:1px solid #2e2e2e;"]]',
            '[[div style="text-align:left;"]][[div style="font-size:0.85rem;font-weight:700;"]]Couleur Équipe 2[[/div]][[div style="font-size:0.72rem;color:#a3a3a3;"]]Colonne & badges Équipe 2[[/div]][[/div]]',
            '[[div style="display:flex;align-items:center;gap:8px;"]][[input type="color" id="inpColEq2" style="width:38px;height:34px;border:none;border-radius:6px;cursor:pointer;background:transparent;" onchange="majCouleursLive()"]][[input type="text" id="txtColEq2" class="inp-field" style="width:78px;padding:5px;text-align:center;font-size:0.8rem;text-transform:uppercase;" maxlength="7" oninput="synchroColorInput(\'Eq2\')"]][[/div]]',
          '[[/div]]',
          '[[div id="rowColEq3" style="display:flex;align-items:center;justify-content:space-between;background:#0a0a0a;padding:8px 12px;border-radius:10px;border:1px solid #2e2e2e;"]]',
            '[[div style="text-align:left;"]][[div style="font-size:0.85rem;font-weight:700;"]]Couleur Équipe 3[[/div]][[div style="font-size:0.72rem;color:#a3a3a3;"]]Colonne & badges Équipe 3[[/div]][[/div]]',
            '[[div style="display:flex;align-items:center;gap:8px;"]][[input type="color" id="inpColEq3" style="width:38px;height:34px;border:none;border-radius:6px;cursor:pointer;background:transparent;" onchange="majCouleursLive()"]][[input type="text" id="txtColEq3" class="inp-field" style="width:78px;padding:5px;text-align:center;font-size:0.8rem;text-transform:uppercase;" maxlength="7" oninput="synchroColorInput(\'Eq3\')"]][[/div]]',
          '[[/div]]',
        '[[/div]]',
        '[[div style="text-align:left;margin-bottom:12px;"]]',
          '[[div style="font-size:0.78rem;font-weight:700;color:#d4d4d4;margin-bottom:6px;"]]Palettes rapides (Clubs de Handball) :[[/div]]',
          '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#f97316\',\'#fbbf24\',\'#3b82f6\',\'#f97316\',\'#10b981\')"]]Orange & Ambre[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#6b21a8\',\'#eab308\',\'#6b21a8\',\'#eab308\',\'#3b82f6\')"]]Violet & Or (Nantes)[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#1d4ed8\',\'#dc2626\',\'#1d4ed8\',\'#dc2626\',\'#10b981\')"]]Bleu & Rouge (PSG)[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#0284c7\',\'#0f172a\',\'#0284c7\',\'#1e293b\',\'#06b6d4\')"]]Ciel & Nuit (MHB)[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#16a34a\',\'#f8fafc\',\'#16a34a\',\'#22c55e\',\'#15803d\')"]]Vert & Blanc (USAM)[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#dc2626\',\'#18181b\',\'#dc2626\',\'#450a0a\',\'#f59e0b\')"]]Rouge & Noir[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#eab308\',\'#18181b\',\'#eab308\',\'#713f12\',\'#0284c7\')"]]Jaune & Noir (Chambéry)[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#1e3a8a\',\'#f59e0b\',\'#2563eb\',\'#f59e0b\',\'#10b981\')"]]Bleu Nuit & Or[[/button]]',
          '[[/div]]',
        '[[/div]]',
        '[[div id="previewBanniereCouleurs" style="padding:10px;border-radius:10px;background:#0a0a0a;border:1px solid #2e2e2e;display:flex;justify-content:space-around;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:4px;"]]',
          '[[span style="font-size:0.78rem;font-weight:700;"]]Aperçu :[[/span]]',
          '[[span id="prevBadgeP" style="font-size:0.72rem;padding:4px 8px;border-radius:6px;font-weight:700;"]]Principal[[/span]]',
          '[[span id="prevBadgeS" style="font-size:0.72rem;padding:4px 8px;border-radius:6px;font-weight:700;"]]Secondaire[[/span]]',
          '[[span id="prevBadgeE1" style="font-size:0.72rem;padding:4px 8px;border-radius:6px;font-weight:700;"]]Équipe 1[[/span]]',
          '[[span id="prevBadgeE2" style="font-size:0.72rem;padding:4px 8px;border-radius:6px;font-weight:700;"]]Équipe 2[[/span]]',
          '[[span id="prevBadgeE3" style="font-size:0.72rem;padding:4px 8px;border-radius:6px;font-weight:700;"]]Équipe 3[[/span]]',
        '[[/div]]',
        '[[div id="statusModalCouleurs" style="font-size:0.8rem;color:var(--color-secondary);min-height:1.2em;text-align:center;margin-bottom:10px;"]][[/div]]',
        '[[div style="display:flex;gap:8px;justify-content:flex-end;"]]',
          '[[button class="btn-reset" onclick="fermerModalCouleurs()"]]Annuler[[/button]]',
          '[[button class="btn-save" id="btnSaveCouleurs" onclick="sauvegarderCouleursDepuisModal()"]]Enregistrer les modifications[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalConfigEntrainementsBg" onclick="fermerModalConfigEntrainementsSurBg(event)"]]',
      '[[div class="modal-box" style="max-width:480px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid rgba(148,163,184,0.15);padding-bottom:10px;"]]',
          '[[h2 style="margin:0;font-size:1.15rem;color:#f8fafc;"]]Horaires des Entraînements[[/h2]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;font-size:0.85rem;" onclick="fermerModalConfigEntrainements()"]]✕[[/button]]',
        '[[/div]]',
        '[[p style="font-size:0.8rem;color:#94a3b8;margin:0 0 14px 0;text-align:left;"]]Configurez les jours et horaires des créneaux d\'entraînement (1 à 5 séances par semaine). Ils s\'appliqueront aux sondages et aux convocations WhatsApp.[[/p]]',
        '[[div style="background:#0e1626;padding:12px;border-radius:12px;border:1px solid rgba(148,163,184,0.18);margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;"]]',
          '[[div]]',
            '[[div style="font-weight:800;font-size:0.88rem;color:#f8fafc;"]]Nombre d\'entraînements par semaine[[/div]]',
            '[[div style="font-size:0.75rem;color:#94a3b8;"]]Choisissez entre 1 et 5 créneaux hebdomadaires[[/div]]',
          '[[/div]]',
          '[[select id="cfgNbSeancesTrain" class="inp-field" style="width:auto;padding:6px 12px;font-size:0.9rem;font-weight:700;border-color:var(--color-primary);" onchange="ajusterAffichageNombreSeances()"]]',
            '[[option value="1"]]1 entraînement[[/option]]',
            '[[option value="2"]]2 entraînements[[/option]]',
            '[[option value="3" selected]]3 entraînements[[/option]]',
            '[[option value="4"]]4 entraînements[[/option]]',
            '[[option value="5"]]5 entraînements[[/option]]',
          '[[/select]]',
        '[[/div]]',
        '[[div id="cfgListeBoxesTrain" style="display:flex;flex-direction:column;gap:10px;text-align:left;max-height:50vh;overflow-y:auto;padding-right:4px;"]]',
          '[[div id="boxCfgTrain1" style="background:#0e1626;padding:12px;border-radius:12px;border:1px solid rgba(148,163,184,0.18);"]]',
            '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"]]',
              '[[span style="font-weight:800;font-size:0.85rem;color:var(--color-primary);"]]Séance 1[[/span]]',
              '[[label style="font-size:0.75rem;display:flex;align-items:center;gap:6px;cursor:pointer;color:#cbd5e1;"]][[input type="checkbox" id="cfgTrActif1" checked]] Actif sondage[[/label]]',
            '[[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Jour :[[/label]][[select id="cfgTrJour1" class="inp-field" style="padding:6px 10px;font-size:0.85rem;"]][[option value="Lundi" selected]]Lundi[[/option]][[option value="Mardi"]]Mardi[[/option]][[option value="Mercredi"]]Mercredi[[/option]][[option value="Jeudi"]]Jeudi[[/option]][[option value="Vendredi"]]Vendredi[[/option]][[option value="Samedi"]]Samedi[[/option]][[option value="Dimanche"]]Dimanche[[/option]][[/select]][[/div]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Horaire :[[/label]][[input type="text" id="cfgTrHoraire1" class="inp-field" value="20h30" placeholder="ex: 20h30" style="padding:6px 10px;font-size:0.85rem;"]][[/div]]',
            '[[/div]]',
          '[[/div]]',
          '[[div id="boxCfgTrain2" style="background:#0e1626;padding:12px;border-radius:12px;border:1px solid rgba(148,163,184,0.18);"]]',
            '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"]]',
              '[[span style="font-weight:800;font-size:0.85rem;color:var(--color-primary);"]]Séance 2[[/span]]',
              '[[label style="font-size:0.75rem;display:flex;align-items:center;gap:6px;cursor:pointer;color:#cbd5e1;"]][[input type="checkbox" id="cfgTrActif2" checked]] Actif sondage[[/label]]',
            '[[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Jour :[[/label]][[select id="cfgTrJour2" class="inp-field" style="padding:6px 10px;font-size:0.85rem;"]][[option value="Lundi"]]Lundi[[/option]][[option value="Mardi"]]Mardi[[/option]][[option value="Mercredi" selected]]Mercredi[[/option]][[option value="Jeudi"]]Jeudi[[/option]][[option value="Vendredi"]]Vendredi[[/option]][[option value="Samedi"]]Samedi[[/option]][[option value="Dimanche"]]Dimanche[[/option]][[/select]][[/div]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Horaire :[[/label]][[input type="text" id="cfgTrHoraire2" class="inp-field" value="20h30" placeholder="ex: 20h30" style="padding:6px 10px;font-size:0.85rem;"]][[/div]]',
            '[[/div]]',
          '[[/div]]',
          '[[div id="boxCfgTrain3" style="background:#0e1626;padding:12px;border-radius:12px;border:1px solid rgba(148,163,184,0.18);"]]',
            '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"]]',
              '[[span style="font-weight:800;font-size:0.85rem;color:var(--color-primary);"]]Séance 3[[/span]]',
              '[[label style="font-size:0.75rem;display:flex;align-items:center;gap:6px;cursor:pointer;color:#cbd5e1;"]][[input type="checkbox" id="cfgTrActif3"]] Actif sondage[[/label]]',
            '[[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Jour :[[/label]][[select id="cfgTrJour3" class="inp-field" style="padding:6px 10px;font-size:0.85rem;"]][[option value="Lundi"]]Lundi[[/option]][[option value="Mardi"]]Mardi[[/option]][[option value="Mercredi"]]Mercredi[[/option]][[option value="Jeudi" selected]]Jeudi[[/option]][[option value="Vendredi"]]Vendredi[[/option]][[option value="Samedi"]]Samedi[[/option]][[option value="Dimanche"]]Dimanche[[/option]][[/select]][[/div]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Horaire :[[/label]][[input type="text" id="cfgTrHoraire3" class="inp-field" value="20h30" placeholder="ex: 20h30" style="padding:6px 10px;font-size:0.85rem;"]][[/div]]',
            '[[/div]]',
          '[[/div]]',
          '[[div id="boxCfgTrain4" style="background:#0e1626;padding:12px;border-radius:12px;border:1px solid rgba(148,163,184,0.18);display:none;"]]',
            '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"]]',
              '[[span style="font-weight:800;font-size:0.85rem;color:var(--color-primary);"]]Séance 4[[/span]]',
              '[[label style="font-size:0.75rem;display:flex;align-items:center;gap:6px;cursor:pointer;color:#cbd5e1;"]][[input type="checkbox" id="cfgTrActif4"]] Actif sondage[[/label]]',
            '[[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Jour :[[/label]][[select id="cfgTrJour4" class="inp-field" style="padding:6px 10px;font-size:0.85rem;"]][[option value="Lundi"]]Lundi[[/option]][[option value="Mardi"]]Mardi[[/option]][[option value="Mercredi"]]Mercredi[[/option]][[option value="Jeudi"]]Jeudi[[/option]][[option value="Vendredi" selected]]Vendredi[[/option]][[option value="Samedi"]]Samedi[[/option]][[option value="Dimanche"]]Dimanche[[/option]][[/select]][[/div]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Horaire :[[/label]][[input type="text" id="cfgTrHoraire4" class="inp-field" value="20h00" placeholder="ex: 20h00" style="padding:6px 10px;font-size:0.85rem;"]][[/div]]',
            '[[/div]]',
          '[[/div]]',
          '[[div id="boxCfgTrain5" style="background:#0e1626;padding:12px;border-radius:12px;border:1px solid rgba(148,163,184,0.18);display:none;"]]',
            '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"]]',
              '[[span style="font-weight:800;font-size:0.85rem;color:var(--color-primary);"]]Séance 5[[/span]]',
              '[[label style="font-size:0.75rem;display:flex;align-items:center;gap:6px;cursor:pointer;color:#cbd5e1;"]][[input type="checkbox" id="cfgTrActif5"]] Actif sondage[[/label]]',
            '[[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Jour :[[/label]][[select id="cfgTrJour5" class="inp-field" style="padding:6px 10px;font-size:0.85rem;"]][[option value="Lundi"]]Lundi[[/option]][[option value="Mardi"]]Mardi[[/option]][[option value="Mercredi"]]Mercredi[[/option]][[option value="Jeudi"]]Jeudi[[/option]][[option value="Vendredi"]]Vendredi[[/option]][[option value="Samedi" selected]]Samedi[[/option]][[option value="Dimanche"]]Dimanche[[/option]][[/select]][[/div]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Horaire :[[/label]][[input type="text" id="cfgTrHoraire5" class="inp-field" value="10h00" placeholder="ex: 10h00" style="padding:6px 10px;font-size:0.85rem;"]][[/div]]',
            '[[/div]]',
          '[[/div]]',
        '[[/div]]',
        '[[div id="statusConfigEntrainements" style="font-size:0.8rem;color:var(--color-secondary);min-height:1.2em;text-align:center;margin-top:10px;"]][[/div]]',
        '[[div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;"]]',
          '[[button type="button" class="btn-reset" onclick="fermerModalConfigEntrainements()"]]Annuler[[/button]]',
          '[[button type="button" class="btn-save" id="btnSaveConfigTrain" onclick="sauvegarderConfigEntrainements()"]]Enregistrer les horaires[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalMiseAJourBg" onclick="fermerModalMiseAJourSurBg(event)"]]',
      '[[div class="modal-box" style="border-top:4px solid #6366f1;max-width:440px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[div style="font-weight:900;font-size:1.15rem;color:#c7d2fe;display:flex;align-items:center;gap:6px;"]]Mise à jour disponible[[/div]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;font-size:0.8rem;" onclick="fermerModalMiseAJour()"]]✕[[/button]]',
        '[[/div]]',
        '[[div id="modalUpdateContent" style="font-size:0.85rem;color:#d4d4d4;line-height:1.45;"]]',
          '[[div style="background:#1e1e24;border:1px solid #312e81;padding:10px 12px;border-radius:10px;margin-bottom:12px;"]]',
            '[[div style="font-weight:800;color:#e0e7ff;margin-bottom:4px;" id="modalUpdateTitle"]]Version v1.7.1[[/div]]',
            '[[div style="font-size:0.75rem;color:#a5b4fc;" id="modalUpdateMeta"]]Publiée récemment[[/div]]',
            '[[ul id="modalUpdateChangelog" style="margin:8px 0 0 16px;padding:0;color:#cbd5e1;font-size:0.8rem;line-height:1.4;"]][[/ul]]',
          '[[/div]]',
          '[[div style="font-weight:800;color:var(--color-secondary);margin-bottom:6px;"]]Comment mettre à jour en 1 minute ?[[/div]]',
          '[[div style="margin-bottom:10px;font-size:0.8rem;background:#171717;border-left:3px solid #6366f1;padding:8px 10px;border-radius:0 8px 8px 0;"]]',
            '[[b style="color:#fff;"]]1. Google Sheet (code.gs) :[[/b]]<br>Vos effectifs et couleurs sont conservés intacts. Il suffit de copier le code mis à jour et de le coller dans <i>Extensions > Apps Script</i>.<br>',
            '[[button type="button" id="btnCopierCodeGs" class="btn-enter" style="margin-top:6px;font-size:0.78rem;padding:7px;background:#4f46e5;color:#fff;" onclick="copierLienCodeGs()"]]Copier le lien du code.gs mis à jour[[/button]]',
          '[[/div]]',
          '[[div style="margin-bottom:12px;font-size:0.8rem;background:#171717;border-left:3px solid var(--color-primary);padding:8px 10px;border-radius:0 8px 8px 0;"]]',
            '[[b style="color:#fff;"]]2. Robot WhatsApp (GitHub) :[[/b]]<br>Allez dans votre dépôt privé sur GitHub :<br><i>Actions > Sync with Handball Bot Template > Run workflow</i>.<br>',
            '[[button type="button" class="btn-enter btn-enter-alt" style="margin-top:6px;font-size:0.78rem;padding:7px;" onclick="ouvrirRepoGithub()"]]Ouvrir mon dépôt GitHub Actions[[/button]]',
          '[[/div]]',
        '[[/div]]',
        '[[button type="button" class="btn-reset" style="width:100%;margin-top:8px;" onclick="fermerModalMiseAJour()"]]Fermer[[/button]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalGuideCoachBg" onclick="fermerModalGuideCoachSurBg(event)"]]',
      '[[div class="modal-box" style="border-top:4px solid #6366f1;max-width:540px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[div style="font-weight:900;font-size:1.15rem;color:#c7d2fe;display:flex;align-items:center;gap:8px;"]]📖 Guide des Fonctionnalités Coach[[/div]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;font-size:0.8rem;" onclick="fermerModalGuideCoach()"]]✕[[/button]]',
        '[[/div]]',
        '[[div style="font-size:0.83rem;color:#cbd5e1;line-height:1.5;display:flex;flex-direction:column;gap:12px;"]]',
          '[[div style="background:#171d2b;border:1px solid rgba(99,102,241,0.25);border-radius:12px;padding:12px;"]]',
            '[[div style="font-weight:800;color:#818cf8;margin-bottom:6px;font-size:0.9rem;"]]🤾 1. Compositions de Matchs (1 à 3 équipes)[[/div]]',
            '[[ul style="margin:0 0 0 16px;padding:0;display:flex;flex-direction:column;gap:4px;"]]',
              '[[li]][[b style="color:#fff;"]]2 Modes de composition :[[/b]] Mode Tactique (glisser-déposer sur PC) ou Mode Tinder (cartes à swiper d\'une main sur smartphone). Détection automatique selon votre appareil ![[/li]]',
              '[[li]][[b style="color:#f87171;"]]Joueurs au Repos :[[/b]] Visibles dans la colonne rouge, ils ne disparaissent jamais et peuvent être réassignés en un clic.[[/li]]',
              '[[li]][[b style="color:#38bdf8;"]]+ Renfort :[[/b]] Ajoutez un joueur joker ou descendant d\'une équipe supérieure non inscrit au sondage initial.[[/li]]',
              '[[li]][[b style="color:#fbbf24;"]]Mémoire & Brouillon :[[/b]] Sauvegardez pour reprendre plus tard, ou rechargez la composition du week-end dernier d\'un clic.[[/li]]',
              '[[li]][[b style="color:#34d399;"]]Terrain tactique 2D :[[/b]] Visualisez votre 7 d\'attaque + Gardien sur demi-terrain et permutez avec les remplaçants du banc.[[/li]]',
              '[[li]][[b style="color:#22c55e;"]]Convocation WhatsApp :[[/b]] Générée avec adversaire FFHB, gymnase, heure de RDV calculée et liste complète prête à publier.[[/li]]',
            '[[/ul]]',
          '[[/div]]',
          '[[div style="background:#171d2b;border:1px solid rgba(16,185,129,0.25);border-radius:12px;padding:12px;"]]',
            '[[div style="font-weight:800;color:#34d399;margin-bottom:6px;font-size:0.9rem;"]]🏋️ 2. Gestion des Entraînements (1 à 5 séances / semaine)[[/div]]',
            '[[ul style="margin:0 0 0 16px;padding:0;display:flex;flex-direction:column;gap:4px;"]]',
              '[[li]][[b style="color:#fff;"]]1 à 5 séances par semaine :[[/b]] Choisissez le volume hebdomadaire de votre collectif (1 à 5 séances) avec onglets dynamiques.[[/li]]',
              '[[li]][[b style="color:#fff;"]]3 Formats adaptés :[[/b]] Séparé (2 groupes), Effectif Réduit (quota max) ou Effectif Complet.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Créneaux personnalisables :[[/b]] Modifiez les jours et horaires via <i>Créneaux & Horaires</i> sans ouvrir Excel.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Option avec/sans emojis :[[/b]] Activez ou masquez les pictogrammes pour des messages plus sobres.[[/li]]',
            '[[/ul]]',
          '[[/div]]',
          '[[div style="background:#171d2b;border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:12px;"]]',
            '[[div style="font-weight:800;color:#fbbf24;margin-bottom:6px;font-size:0.9rem;"]]👥 3. Effectifs, Trombinoscope & Multi-Collectifs[[/div]]',
            '[[ul style="margin:0 0 0 16px;padding:0;display:flex;flex-direction:column;gap:4px;"]]',
              '[[li]][[b style="color:#fff;"]]Gestion autonome :[[/b]] Ajoutez, modifiez ou supprimez des joueurs et des équipes directement depuis la WebApp.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Trombinoscope & Notes secrètes :[[/b]] Photos de profil et notes tactiques visibles uniquement par le coach.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Multi-Collectifs :[[/b]] Basculez d\'une catégorie à l\'autre (ex: Séniors Garçons et -15 Filles) depuis la même page.[[/li]]',
            '[[/ul]]',
          '[[/div]]',
          '[[div style="background:#171d2b;border:1px solid rgba(239,68,68,0.25);border-radius:12px;padding:12px;"]]',
            '[[div style="font-weight:800;color:#f87171;margin-bottom:6px;font-size:0.9rem;"]]🔒 4. Sécurité & Protection des Données (Ados / RGPD)[[/div]]',
            '[[ul style="margin:0 0 0 16px;padding:0;display:flex;flex-direction:column;gap:4px;"]]',
              '[[li]][[b style="color:#fff;"]]Chiffrement au repos :[[/b]] Numéros des joueurs et ados chiffrés (format enc:...) dans Google Sheets pour garantir la confidentialité totale.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Code PIN secret :[[/b]] Accès protégé individuellement pour chaque joueur et entraîneur.[[/li]]',
              '[[li]][[b style="color:#fff;"]]0 € & Souveraineté :[[/b]] Zéro serveur tiers, zéro publicité, hébergé à 100% sur votre Google Drive.[[/li]]',
            '[[/ul]]',
          '[[/div]]',
          '[[div style="background:#171d2b;border:1px solid rgba(56,189,248,0.25);border-radius:12px;padding:12px;"]]',
            '[[div style="font-weight:800;color:#38bdf8;margin-bottom:6px;font-size:0.9rem;"]]📲 5. Application Mobile PWA & Personnalisation[[/div]]',
            '[[ul style="margin:0 0 0 16px;padding:0;display:flex;flex-direction:column;gap:4px;"]]',
              '[[li]][[b style="color:#fff;"]]Écran d\'accueil :[[/b]] Installez l\'icône sur iPhone (Partager > Sur l\'écran d\'accueil) ou Android (⋮ > Installer l\'application).[[/li]]',
              '[[li]][[b style="color:#fff;"]]Identité du Club :[[/b]] Importez le blason officiel et appliquez les couleurs des maillots en 1 clic.[[/li]]',
            '[[/ul]]',
          '[[/div]]',
          '[[div style="background:#171d2b;border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:12px;"]]',
            '[[div style="font-weight:800;color:#fbbf24;margin-bottom:6px;font-size:0.9rem;"]]🏆 6. Espace & Vie du Joueur (MVP, Covoiturage, Absences)[[/div]]',
            '[[ul style="margin:0 0 0 16px;padding:0;display:flex;flex-direction:column;gap:4px;"]]',
              '[[li]][[b style="color:#fff;"]]Fiche Athlète FUT :[[/b]] Chaque joueur a sa carte personnalisée avec photo, assiduité aux séances et blason du club.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Vote MVP & Chèvre 🐐 :[[/b]] Élection du match avec podium en direct et pluie de confettis.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Covoiturage :[[/b]] Organisation autonome des voitures et passagers pour les déplacements extérieurs.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Déclaration d\'absence :[[/b]] Les joueurs préviennent à l\'avance, visible directement dans l\'espace coach.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Le Vestiaire :[[/b]] Trombinoscope interactif avec recherche rapide par nom et poste.[[/li]]',
            '[[/ul]]',
          '[[/div]]',
          '[[div style="background:#171d2b;border:1px solid rgba(234,179,8,0.3);border-radius:12px;padding:12px;"]]',
            '[[div style="font-weight:800;color:#fde047;margin-bottom:6px;font-size:0.9rem;"]]💰 7. Caisse Noire & Administration des Amendes[[/div]]',
            '[[ul style="margin:0 0 0 16px;padding:0;display:flex;flex-direction:column;gap:4px;"]]',
              '[[li]][[b style="color:#fff;"]]Barème & Amendes :[[/b]] Barème officiel personnalisable (retards, oublis, cartons, pigeons) avec sanctions immédiates en 1 clic.[[/li]]',
              '[[li]][[b style="color:#fff;"]]La Balance (Dénonciations) :[[/b]] Les joueurs peuvent signaler une amende, en attente de validation ou rejet par le coach/trésorier.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Suivi & Encaissements :[[/b]] Ardoises individuelles, encaissement rapide (Lydia/espèces) et suivi du solde net en caisse.[[/li]]',
              '[[li]][[b style="color:#fff;"]]Bilan WhatsApp 1-Clic :[[/b]] Partagez le récapitulatif fun de la cagnotte et le classement des mauvais payeurs sur le groupe.[[/li]]',
            '[[/ul]]',
          '[[/div]]',
        '[[/div]]',
        '[[button type="button" class="btn-reset" style="width:100%;margin-top:14px;background:#1e293b;padding:9px;" onclick="fermerModalGuideCoach()"]]Fermer le guide[[/button]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalMvpChevreBg" onclick="fermerModalMvpChevreSurBg(event)"]]',
      '[[div class="modal-box" style="border-top:4px solid #f59e0b;max-width:480px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[div style="font-weight:900;font-size:1.15rem;color:#fde68a;display:flex;align-items:center;gap:8px;"]]🏆 MVP & Chèvre du Match 🐐[[/div]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;font-size:0.8rem;" onclick="fermerModalMvpChevre()"]]✕[[/button]]',
        '[[/div]]',
        '[[p style="font-size:0.8rem;color:#cbd5e1;margin:0 0 14px 0;line-height:1.4;"]]Votez pour le meilleur joueur du week-end (MVP) et pour le bêtisier / trophée casserole (Chèvre du match) ![[/p]]',
        '[[div id="mvpFormBox" style="background:#0e1626;border:1px solid rgba(245,158,11,0.25);border-radius:14px;padding:14px;margin-bottom:14px;"]]',
          '[[div style="font-weight:800;font-size:0.86rem;color:#fcd34d;margin-bottom:10px;"]]🗳️ Déposer mon vote :[[/div]]',
          '[[div style="margin-bottom:10px;"]]',
            '[[label style="font-size:0.75rem;color:#94a3b8;display:block;margin-bottom:4px;"]]⭐ Élu MVP (Meilleur Joueur) :[[/label]]',
            '[[select id="selVoteMvp" class="inp-field" style="padding:8px 12px;font-size:0.88rem;"]][[/select]]',
          '[[/div]]',
          '[[div style="margin-bottom:12px;"]]',
            '[[label style="font-size:0.75rem;color:#94a3b8;display:block;margin-bottom:4px;"]]🐐 Élu Chèvre (Le bêtisier sympa) :[[/label]]',
            '[[select id="selVoteChevre" class="inp-field" style="padding:8px 12px;font-size:0.88rem;"]][[/select]]',
          '[[/div]]',
          '[[button type="button" class="btn-enter" id="btnSubmitVoteMvp" style="margin:0;width:100%;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;" onclick="enregistrerVoteMvp()"]]Enregistrer mon vote ![[/button]]',
          '[[div id="statusVoteMvp" style="font-size:0.78rem;color:var(--color-secondary);min-height:1.2em;text-align:center;margin-top:6px;"]][[/div]]',
        '[[/div]]',
        '[[div style="font-weight:800;font-size:0.88rem;color:#e2e8f0;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;"]]',
          '[[span]]📊 Podium & Résultats en direct[[/span]]',
          '[[span id="mvpTotalVotesCount" style="font-size:0.72rem;color:#94a3b8;font-weight:600;"]]0 vote(s)[[/span]]',
        '[[/div]]',
        '[[div id="mvpPodiumContainer"]][[/div]]',
        '[[div id="coachMvpResetBox" style="display:none;margin-top:14px;border-top:1px solid rgba(148,163,184,0.15);padding-top:10px;text-align:center;"]]',
          '[[button type="button" class="btn-reset" style="font-size:0.72rem;color:#f87171;" onclick="reinitialiserVotesMvpParCoach()"]]🔄 Réinitialiser les votes pour le prochain match (Coach)[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalCovoiturageBg" onclick="fermerModalCovoiturageSurBg(event)"]]',
      '[[div class="modal-box" style="border-top:4px solid #0284c7;max-width:480px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[div style="font-weight:900;font-size:1.15rem;color:#7dd3fc;display:flex;align-items:center;gap:8px;"]]🚗 Covoiturage Match[[/div]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;font-size:0.8rem;" onclick="fermerModalCovoiturage()"]]✕[[/button]]',
        '[[/div]]',
        '[[p style="font-size:0.8rem;color:#cbd5e1;margin:0 0 14px 0;line-height:1.4;"]]Organisez les trajets pour les matchs à l\'extérieur en quelques secondes.[[/p]]',
        '[[div id="covoitFormBox" style="background:#0e1626;border:1px solid rgba(2,132,199,0.25);border-radius:14px;padding:14px;margin-bottom:14px;"]]',
          '[[div style="font-weight:800;font-size:0.86rem;color:#38bdf8;margin-bottom:10px;"]]Mon statut pour le déplacement :[[/div]]',
          '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;"]]',
            '[[button type="button" id="btnCovoitConduis" class="btn-reset" style="padding:8px 6px;font-size:0.78rem;font-weight:700;background:rgba(2,132,199,0.3);border-color:#0284c7;color:#fff;" onclick="selectionnerStatutCovoit(\'conduis\')"]]🚙 Je conduis[[/button]]',
            '[[button type="button" id="btnCovoitCherche" class="btn-reset" style="padding:8px 6px;font-size:0.78rem;font-weight:700;" onclick="selectionnerStatutCovoit(\'cherche\')"]]🙋 Je cherche 1 place[[/button]]',
          '[[/div]]',
          '[[div id="boxCovoitNbPlaces" style="display:block;margin-bottom:10px;"]]',
            '[[label style="font-size:0.75rem;color:#94a3b8;display:block;margin-bottom:4px;"]]Nombre total de places libres dans ma voiture :[[/label]]',
            '[[select id="selCovoitNbPlaces" class="inp-field" style="padding:8px 12px;font-size:0.88rem;"]]',
              '[[option value="1"]]1 place libre[[/option]]',
              '[[option value="2"]]2 places libres[[/option]]',
              '[[option value="3" selected]]3 places libres[[/option]]',
              '[[option value="4"]]4 places libres[[/option]]',
              '[[option value="5"]]5 places libres[[/option]]',
            '[[/select]]',
          '[[/div]]',
          '[[div style="display:flex;gap:6px;"]]',
            '[[button type="button" class="btn-enter" id="btnSubmitCovoit" style="margin:0;flex:1;background:#0284c7;color:#fff;" onclick="enregistrerMonCovoiturage()"]]Enregistrer mon statut[[/button]]',
            '[[button type="button" class="btn-reset" style="padding:8px 10px;font-size:0.75rem;" onclick="annulerMonCovoiturage()"]]Retirer[[/button]]',
          '[[/div]]',
          '[[div id="statusCovoit" style="font-size:0.78rem;color:var(--color-secondary);min-height:1.2em;text-align:center;margin-top:6px;"]][[/div]]',
        '[[/div]]',
        '[[div style="font-weight:800;font-size:0.88rem;color:#e2e8f0;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;"]]',
          '[[span]]🚘 Voitures & Places disponibles[[/span]]',
          '[[span id="covoitStatsSummary" style="font-size:0.72rem;color:#38bdf8;font-weight:700;"]][[/span]]',
        '[[/div]]',
        '[[div id="covoitListContainer" style="max-height:220px;overflow-y:auto;"]][[/div]]',
        '[[div id="coachCovoitResetBox" style="display:none;margin-top:14px;border-top:1px solid rgba(148,163,184,0.15);padding-top:10px;text-align:center;"]]',
          '[[button type="button" class="btn-reset" style="font-size:0.72rem;color:#f87171;" onclick="reinitialiserCovoiturageParCoach()"]]🔄 Réinitialiser le covoiturage pour ce match (Coach)[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalAbsenceBg" onclick="fermerModalAbsenceSurBg(event)"]]',
      '[[div class="modal-box" style="border-top:4px solid #ef4444;max-width:480px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[div style="font-weight:900;font-size:1.15rem;color:#fca5a5;display:flex;align-items:center;gap:8px;"]]📅 Déclarer une Absence[[/div]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;font-size:0.8rem;" onclick="fermerModalAbsence()"]]✕[[/button]]',
        '[[/div]]',
        '[[p style="font-size:0.8rem;color:#cbd5e1;margin:0 0 14px 0;line-height:1.4;"]]Prévenez l\'entraîneur de vos futures indisponibilités pour lui faciliter la planification des compositions.[[/p]]',
        '[[div style="background:#0e1626;border:1px solid rgba(239,68,68,0.25);border-radius:14px;padding:14px;margin-bottom:14px;"]]',
          '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;"]]',
            '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Du (début) :[[/label]][[input type="date" id="inpAbsenceDebut" class="inp-field" style="padding:8px 10px;font-size:0.82rem;"]][[/div]]',
            '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Au (inclus) :[[/label]][[input type="date" id="inpAbsenceFin" class="inp-field" style="padding:8px 10px;font-size:0.82rem;"]][[/div]]',
          '[[/div]]',
          '[[div style="margin-bottom:12px;"]]',
            '[[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Motif :[[/label]]',
            '[[select id="selAbsenceMotif" class="inp-field" style="padding:8px 12px;font-size:0.85rem;"]]',
              '[[option value="Vacances / Voyage"]]Vacances / Voyage[[/option]]',
              '[[option value="Blessure / Santé"]]Blessure / Santé[[/option]]',
              '[[option value="Travail / Études"]]Travail / Études[[/option]]',
              '[[option value="Raison personnelle / Famille"]]Raison personnelle / Famille[[/option]]',
              '[[option value="Autre"]]Autre indisponibilité[[/option]]',
            '[[/select]]',
          '[[/div]]',
          '[[div style="display:flex;gap:6px;"]]',
            '[[button type="button" class="btn-enter" id="btnSubmitAbsence" style="margin:0;flex:1;background:#ef4444;color:#fff;" onclick="declarerNouvelleAbsence()"]]Transmettre mon absence au coach[[/button]]',
            '[[button type="button" class="btn-reset" id="btnAnnulerEditAbsence" style="display:none;padding:8px 12px;font-size:0.8rem;" onclick="reinitialiserFormAbsence()"]]Annuler[[/button]]',
          '[[/div]]',
          '[[div id="statusAbsence" style="font-size:0.78rem;color:var(--color-secondary);min-height:1.2em;text-align:center;margin-top:6px;"]][[/div]]',
        '[[/div]]',
        '[[div style="font-weight:800;font-size:0.88rem;color:#e2e8f0;margin-bottom:8px;"]][[span id="titreListeAbsences"]]📋 Mes déclarations en cours[[/span]][[/div]]',
        '[[div id="mesAbsencesList" style="max-height:180px;overflow-y:auto;"]][[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalProfilJoueurPublicBg" onclick="fermerProfilJoueurPublicSurBg(event)"]]',
      '[[div class="modal-box" style="border-top:4px solid var(--color-primary);max-width:440px;position:relative;overflow:hidden;text-align:center;"]]',
        '[[div id="profilPublicBackdrop" style="position:absolute;inset:-30px;background-size:cover;background-position:center;filter:blur(30px) brightness(0.28);z-index:0;pointer-events:none;"]][[/div]]',
        '[[div style="position:relative;z-index:1;"]]',
          '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;"]]',
            '[[div style="font-weight:900;font-size:1.1rem;color:#f8fafc;display:flex;align-items:center;gap:8px;"]]👤 Fiche Joueur[[/div]]',
            '[[button type="button" class="btn-reset" style="padding:4px 8px;font-size:0.8rem;" onclick="fermerProfilJoueurPublic()"]]✕[[/button]]',
          '[[/div]]',
          '[[div style="display:flex;flex-direction:column;align-items:center;margin-bottom:14px;"]]',
            '[[div id="profilPublicAvatarWrap" style="width:110px;height:110px;border-radius:50%;overflow:hidden;background:#1e293b;border:3px solid var(--color-primary);box-shadow:0 10px 25px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;margin-bottom:12px;position:relative;"]]',
              '[[img id="profilPublicImg" style="width:100%;height:100%;object-fit:cover;display:none;"]]',
              '[[div id="profilPublicInitiale" style="font-size:2.8rem;font-weight:900;color:var(--color-primary);"]]?[[/div]]',
            '[[/div]]',
            '[[h2 id="profilPublicNom" style="margin:0 0 6px 0;font-size:1.35rem;font-weight:900;color:#fff;"]]-[[/h2]]',
            '[[div id="profilPublicPosteBadge" style="display:inline-block;padding:4px 12px;background:rgba(249,115,22,0.18);color:var(--color-secondary);border:1px solid rgba(249,115,22,0.4);border-radius:99px;font-weight:800;font-size:0.82rem;margin-bottom:8px;"]]-[[/div]]',
            '[[div id="profilPublicEquipeBadge" style="font-size:0.75rem;color:#94a3b8;font-weight:600;margin-bottom:6px;"]][[/div]]',
            '[[div id="profilPublicAssiduiteBadge" style="font-size:0.78rem;color:#38bdf8;font-weight:700;margin-bottom:12px;"]][[/div]]',
          '[[/div]]',
          '[[div id="profilPublicCaisseBox" style="background:#090d16;border:1px solid rgba(234,179,8,0.3);border-radius:12px;padding:12px;margin-bottom:14px;text-align:left;"]]',
            '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"]]',
              '[[span style="font-weight:800;font-size:0.82rem;color:#fde047;"]]💰 Bilan Caisse Noire[[/span]]',
              '[[span id="profilPublicCaisseStatut" style="font-size:0.75rem;font-weight:800;padding:2px 8px;border-radius:99px;"]][[/span]]',
            '[[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center;margin-bottom:8px;"]]',
              '[[div style="background:rgba(255,255,255,0.03);padding:6px;border-radius:8px;"]][[div style="font-size:0.7rem;color:#94a3b8;"]]Amendes[[/div]][[div id="profilPublicTotalAmendes" style="font-weight:900;color:#f8fafc;font-size:0.95rem;"]]0 €[[/div]][[/div]]',
              '[[div style="background:rgba(255,255,255,0.03);padding:6px;border-radius:8px;"]][[div style="font-size:0.7rem;color:#94a3b8;"]]Reste dû[[/div]][[div id="profilPublicResteDu" style="font-weight:900;color:#f87171;font-size:0.95rem;"]]0 €[[/div]][[/div]]',
            '[[/div]]',
            '[[div id="profilPublicAmendesList" style="max-height:120px;overflow-y:auto;font-size:0.72rem;color:#cbd5e1;"]][[/div]]',
          '[[/div]]',
          '[[button type="button" class="btn-reset" style="width:100%;padding:9px;font-size:0.82rem;" onclick="fermerProfilJoueurPublic()"]]Fermer[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalCaisseNoireBg" onclick="fermerModalCaisseNoireSurBg(event)"]]',
      '[[div class="modal-box" style="border-top:4px solid #eab308;max-width:540px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[div style="font-weight:900;font-size:1.18rem;color:#fef08a;display:flex;align-items:center;gap:8px;"]]💰 Caisse Noire & Amendes[[/div]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;font-size:0.8rem;" onclick="fermerModalCaisseNoire()"]]✕[[/button]]',
        '[[/div]]',
        '[[div style="display:flex;gap:4px;background:#090d16;padding:4px;border-radius:12px;margin-bottom:14px;border:1px solid rgba(255,255,255,0.08);"]]',
          '[[button type="button" id="tabCaisseCagnotte" class="train-type-pill active" style="flex:1;" onclick="basculerTabCaisse(\'cagnotte\')"]]📊 Cagnotte[[/button]]',
          '[[button type="button" id="tabCaisseArdoise" class="train-type-pill" style="flex:1;" onclick="basculerTabCaisse(\'ardoise\')"]]🧾 Mon Ardoise[[/button]]',
          '[[button type="button" id="tabCaisseBareme" class="train-type-pill" style="flex:1;" onclick="basculerTabCaisse(\'bareme\')"]]📜 Barème[[/button]]',
          '[[button type="button" id="tabCaisseClassement" class="train-type-pill" style="flex:1;" onclick="basculerTabCaisse(\'classement\')"]]🏆 Palmarès[[/button]]',
        '[[/div]]',
        '[[div id="vueCaisseCagnotte"]]',
          '[[div style="background:linear-gradient(135deg,rgba(30,41,59,0.9),rgba(15,23,42,0.95));border:1px solid rgba(234,179,8,0.3);border-radius:18px;padding:16px;text-align:center;margin-bottom:12px;box-shadow:0 8px 24px rgba(0,0,0,0.4);"]]',
            '[[div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:800;"]]Solde Actuel en Caisse[[/div]]',
            '[[div id="caisseSoldeMontant" style="font-size:2.4rem;font-weight:900;color:#fef08a;margin:4px 0;letter-spacing:-0.5px;text-shadow:0 2px 10px rgba(234,179,8,0.3);"]]0 €[[/div]]',
            '[[div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:8px;"]]',
              '[[span id="caisseTotalCollecte" style="font-size:0.72rem;background:rgba(34,197,94,0.18);border:1px solid rgba(34,197,94,0.3);color:#86efac;padding:3px 8px;border-radius:99px;font-weight:700;"]]Encaissé : 0 €[[/span]]',
              '[[span id="caisseTotalImpaye" style="font-size:0.72rem;background:rgba(239,68,68,0.18);border:1px solid rgba(239,68,68,0.3);color:#fca5a5;padding:3px 8px;border-radius:99px;font-weight:700;"]]Restant dû : 0 €[[/span]]',
              '[[span id="caisseTotalDepenses" style="font-size:0.72rem;background:rgba(148,163,184,0.18);border:1px solid rgba(148,163,184,0.3);color:#cbd5e1;padding:3px 8px;border-radius:99px;font-weight:700;"]]Dépenses : 0 €[[/span]]',
            '[[/div]]',
          '[[/div]]',
          '[[div style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px;margin-bottom:12px;text-align:left;"]]',
            '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"]]',
              '[[span id="caisseObjectifLabel" style="font-size:0.8rem;font-weight:800;color:#e2e8f0;"]]🎯 Objectif de la cagnotte[[/span]]',
              '[[span id="caisseObjectifRatio" style="font-size:0.75rem;font-weight:800;color:#fef08a;"]]0 / 300 € (0%)[[/span]]',
            '[[/div]]',
            '[[div style="width:100%;height:8px;background:#1e293b;border-radius:99px;overflow:hidden;margin-bottom:6px;"]]',
              '[[div id="caisseObjectifBarre" style="height:100%;width:0%;background:linear-gradient(90deg,#eab308,#f59e0b);border-radius:99px;transition:width 0.4s ease;"]][[/div]]',
            '[[/div]]',
            '[[div id="caisseObjectifDesc" style="font-size:0.73rem;color:#94a3b8;line-height:1.3;"]]Pour financer la tournée et le restaurant de fin d\'année.[[/div]]',
          '[[/div]]',
          '[[div style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px;margin-bottom:12px;text-align:left;"]]',
            '[[div style="font-weight:800;font-size:0.8rem;color:#38bdf8;margin-bottom:4px;display:flex;align-items:center;gap:6px;"]]💳 Modalités de règlement :[[/div]]',
            '[[div id="caisseMoyenPaiement" style="font-size:0.78rem;color:#cbd5e1;line-height:1.4;margin-bottom:8px;"]]Lydia / Espèces au vestiaire[[/div]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:5px 10px;background:rgba(56,189,248,0.15);color:#7dd3fc;border-color:rgba(56,189,248,0.3);" onclick="copierInfosPaiementCaisse()"]]📋 Copier les informations de paiement[[/button]]',
          '[[/div]]',
        '[[/div]]',
        '[[div id="vueCaisseArdoise" style="display:none;"]]',
          '[[div id="caisseArdoiseCard" style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px;margin-bottom:12px;text-align:center;"]]',
            '[[div id="caisseMonStatutDette" style="font-size:0.85rem;font-weight:800;color:#94a3b8;"]]Mon ardoise personnelle[[/div]]',
            '[[div id="caisseMonMontantDu" style="font-size:2rem;font-weight:900;color:#f87171;margin:4px 0;"]]0 €[[/div]]',
            '[[div id="caisseMonMessageArdoise" style="font-size:0.75rem;color:#cbd5e1;margin-bottom:10px;"]]Vous êtes à jour de vos amendes ! Bravo 🟢[[/div]]',
            '[[button type="button" class="btn-enter" style="margin:0;font-size:0.78rem;padding:7px 12px;background:#eab308;color:#000;font-weight:800;" onclick="ouvrirFormulaireBalance()"]]🚨 Signaler une amende (La Balance)[[/button]]',
          '[[/div]]',
          '[[div id="boxFormulaireBalance" style="display:none;background:rgba(15,23,42,0.95);border:1px solid #eab308;border-radius:14px;padding:12px;margin-bottom:12px;text-align:left;"]]',
            '[[div style="font-weight:800;font-size:0.82rem;color:#fde047;margin-bottom:8px;"]]🕵️‍♂️ Dénoncer un coéquipier (ou s\'auto-déclarer) :[[/div]]',
            '[[div style="margin-bottom:8px;"]]',
              '[[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Joueur fautif :[[/label]]',
              '[[select id="selBalanceJoueur" class="inp-field" style="padding:7px 10px;font-size:0.8rem;"]][[/select]]',
            '[[/div]]',
            '[[div style="margin-bottom:8px;"]]',
              '[[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Motif :[[/label]]',
              '[[select id="selBalanceBareme" class="inp-field" style="padding:7px 10px;font-size:0.8rem;" onchange="ajusterMontantBalance()"]][[/select]]',
            '[[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-bottom:8px;"]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Montant (€) :[[/label]][[input type="number" id="inpBalanceMontant" class="inp-field" step="0.5" min="0.5" style="padding:7px 10px;font-size:0.8rem;"]][[/div]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Commentaire (optionnel) :[[/label]][[input type="text" id="inpBalanceCommentaire" class="inp-field" placeholder="Ex: Arrivé à 20h45" style="padding:7px 10px;font-size:0.8rem;"]][[/div]]',
            '[[/div]]',
            '[[div style="display:flex;gap:6px;"]]',
              '[[button type="button" class="btn-enter" style="flex:1;margin:0;padding:7px;font-size:0.78rem;background:#eab308;color:#000;font-weight:800;" onclick="soumettreSignalementBalance()"]]Transmettre au trésorier[[/button]]',
              '[[button type="button" class="btn-reset" style="padding:7px 10px;font-size:0.78rem;" onclick="fermerFormulaireBalance()"]]Annuler[[/button]]',
            '[[/div]]',
            '[[div id="statusBalance" style="font-size:0.75rem;color:var(--color-secondary);margin-top:4px;text-align:center;min-height:1.2em;"]][[/div]]',
          '[[/div]]',
          '[[div style="font-weight:800;font-size:0.82rem;color:#cbd5e1;margin-bottom:6px;text-align:left;"]]Historique de mes amendes :[[/div]]',
          '[[div id="caisseMesAmendesList" style="max-height:220px;overflow-y:auto;"]][[/div]]',
        '[[/div]]',
        '[[div id="vueCaisseBareme" style="display:none;"]]',
          '[[input type="text" id="inpFiltreBareme" class="inp-field" placeholder="🔍 Rechercher une amende..." style="padding:8px 12px;font-size:0.82rem;margin-bottom:10px;" oninput="filtrerBaremeCaisse(this.value)"]]',
          '[[div id="caisseBaremeList" style="max-height:300px;overflow-y:auto;text-align:left;"]][[/div]]',
        '[[/div]]',
        '[[div id="vueCaisseClassement" style="display:none;"]]',
          '[[div style="font-size:0.78rem;color:#94a3b8;margin-bottom:8px;text-align:left;"]]Classement des plus gros contributeurs de l\'équipe :[[/div]]',
          '[[div id="caisseLeaderboardList" style="max-height:300px;overflow-y:auto;"]][[/div]]',
        '[[/div]]',
        '[[div style="margin-top:14px;border-top:1px solid rgba(148,163,184,0.15);padding-top:10px;display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;"]]',
          '[[button type="button" id="btnAccesAdminCaisse" class="btn-enter" style="flex:1;margin:0;padding:8px 12px;font-size:0.78rem;background:rgba(234,179,8,0.22);border:1px solid #eab308;color:#fef08a;font-weight:700;" onclick="ouvrirModalAdminCaisseNoire()"]]⚙️ Page Administrateur Caisse Noire[[/button]]',
          '[[button type="button" class="btn-reset" style="padding:8px 12px;font-size:0.78rem;" onclick="fermerModalCaisseNoire()"]]Fermer[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalAdminCaisseNoireBg" onclick="fermerModalAdminCaisseNoireSurBg(event)"]]',
      '[[div class="modal-box" style="border-top:4px solid #eab308;max-width:580px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[div style="display:flex;align-items:center;gap:8px;"]]',
            '[[span style="font-weight:900;font-size:1.15rem;color:#fef08a;"]]⚙️ Administration Caisse Noire[[/span]]',
            '[[span class="badge-mode" style="background:rgba(234,179,8,0.2);color:#fef08a;border:1px solid rgba(234,179,8,0.35);font-size:0.72rem;"]]Trésorier[[/span]]',
          '[[/div]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;font-size:0.8rem;" onclick="fermerModalAdminCaisseNoire()"]]✕[[/button]]',
        '[[/div]]',
        '[[div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px;text-align:center;"]]',
          '[[div style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px;"]][[div style="font-size:0.65rem;color:#94a3b8;font-weight:700;"]]EN CAISSE[[/div]][[div id="admStatEnCaisse" style="font-size:1.05rem;font-weight:900;color:#fef08a;"]]0 €[[/div]][[/div]]',
          '[[div style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px;"]][[div style="font-size:0.65rem;color:#94a3b8;font-weight:700;"]]ENCAISSÉ[[/div]][[div id="admStatEncaisse" style="font-size:1.05rem;font-weight:900;color:#86efac;"]]0 €[[/div]][[/div]]',
          '[[div style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px;"]][[div style="font-size:0.65rem;color:#94a3b8;font-weight:700;"]]IMPAYÉ[[/div]][[div id="admStatImpaye" style="font-size:1.05rem;font-weight:900;color:#fca5a5;"]]0 €[[/div]][[/div]]',
          '[[div style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px;"]][[div style="font-size:0.65rem;color:#94a3b8;font-weight:700;"]]EN ATTENTE[[/div]][[div id="admStatEnAttente" style="font-size:1.05rem;font-weight:900;color:#fcd34d;"]]0[[/div]][[/div]]',
        '[[/div]]',
        '[[div style="display:flex;gap:4px;background:#090d16;padding:4px;border-radius:12px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);flex-wrap:wrap;"]]',
          '[[button type="button" id="tabAdmInfliger" class="train-type-pill active" style="flex:1;min-width:75px;" onclick="basculerTabAdminCaisse(\'infliger\')"]]⚡ Infliger[[/button]]',
          '[[button type="button" id="tabAdmAttente" class="train-type-pill" style="flex:1;min-width:75px;" onclick="basculerTabAdminCaisse(\'attente\')"]]⚖️ En Attente <span id="badgeNbEnAttente" style="display:none;background:#ef4444;color:#fff;border-radius:99px;padding:1px 5px;font-size:0.65rem;">0</span>[[/button]]',
          '[[button type="button" id="tabAdmEncaissements" class="train-type-pill" style="flex:1;min-width:75px;" onclick="basculerTabAdminCaisse(\'encaissements\')"]]💵 Règlements[[/button]]',
          '[[button type="button" id="tabAdmDepenses" class="train-type-pill" style="flex:1;min-width:75px;" onclick="basculerTabAdminCaisse(\'depenses\')"]]💸 Dépenses[[/button]]',
          '[[button type="button" id="tabAdmBareme" class="train-type-pill" style="flex:1;min-width:75px;" onclick="basculerTabAdminCaisse(\'bareme\')"]]⚙️ Paramètres[[/button]]',
          '[[button type="button" id="tabAdmWhatsapp" class="train-type-pill" style="flex:1;min-width:75px;" onclick="basculerTabAdminCaisse(\'whatsapp\')"]]📢 Bilan WA[[/button]]',
        '[[/div]]',
        '[[div id="vueAdmInfliger"]]',
          '[[div style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px;text-align:left;"]]',
            '[[div style="font-weight:800;font-size:0.85rem;color:#fef08a;margin-bottom:10px;"]]⚡ Infliger une amende immédiate :[[/div]]',
            '[[div style="margin-bottom:10px;"]]',
              '[[label style="font-size:0.75rem;color:#cbd5e1;display:block;margin-bottom:4px;"]]Joueur(s) sanctionné(s) :[[/label]]',
              '[[select id="selAdmJoueurs" class="inp-field" style="padding:8px 10px;font-size:0.84rem;"]][[/select]]',
            '[[/div]]',
            '[[div style="margin-bottom:10px;"]]',
              '[[label style="font-size:0.75rem;color:#cbd5e1;display:block;margin-bottom:4px;"]]Motif du barème :[[/label]]',
              '[[select id="selAdmBareme" class="inp-field" style="padding:8px 10px;font-size:0.84rem;" onchange="ajusterMontantAdmin()"]][[/select]]',
            '[[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;"]]',
              '[[div]][[label style="font-size:0.75rem;color:#cbd5e1;display:block;margin-bottom:4px;"]]Montant (€) :[[/label]][[input type="number" id="inpAdmMontant" class="inp-field" step="0.5" min="0.5" style="padding:8px 10px;font-size:0.84rem;"]][[/div]]',
              '[[div]][[label style="font-size:0.75rem;color:#cbd5e1;display:block;margin-bottom:4px;"]]Statut immédiat :[[/label]]',
                '[[select id="selAdmStatut" class="inp-field" style="padding:8px 10px;font-size:0.84rem;" onchange="basculerModePaiementAdmin()"]]',
                  '[[option value="impaye"]]⏳ À régler (Impayé)[[/option]]',
                  '[[option value="paye"]]✅ Déjà payé (Encaissé)[[/option]]',
                '[[/select]]',
              '[[/div]]',
            '[[/div]]',
            '[[div id="boxAdmModePaiement" style="display:none;margin-bottom:10px;"]]',
              '[[label style="font-size:0.75rem;color:#cbd5e1;display:block;margin-bottom:4px;"]]Moyen de règlement :[[/label]]',
              '[[select id="selAdmModePaiement" class="inp-field" style="padding:8px 10px;font-size:0.84rem;"]]',
                '[[option value="Espèces"]]💵 Espèces[[/option]]',
                '[[option value="Lydia"]]📱 Lydia / Paylib[[/option]]',
                '[[option value="Virement"]]🏦 Virement bancaire[[/option]]',
              '[[/select]]',
            '[[/div]]',
            '[[div style="margin-bottom:12px;"]]',
              '[[label style="font-size:0.75rem;color:#cbd5e1;display:block;margin-bottom:4px;"]]Note / Contexte :[[/label]]',
              '[[input type="text" id="inpAdmCommentaire" class="inp-field" placeholder="Ex: 15 min de retard au match contre ACBB" style="padding:8px 10px;font-size:0.84rem;"]]',
            '[[/div]]',
            '[[button type="button" class="btn-enter" id="btnSubmitAdmAmende" style="margin:0;width:100%;padding:9px;background:#eab308;color:#000;font-weight:900;font-size:0.84rem;" onclick="infligerAmendeParAdmin()"]]⚡ Appliquer l\'amende[[/button]]',
            '[[div id="statusAdmAmende" style="font-size:0.76rem;color:var(--color-secondary);margin-top:6px;text-align:center;min-height:1.2em;"]][[/div]]',
          '[[/div]]',
        '[[/div]]',
        '[[div id="vueAdmAttente" style="display:none;"]]',
          '[[div style="font-size:0.8rem;color:#cbd5e1;margin-bottom:8px;text-align:left;"]]Amendes signalées par les joueurs en attente de décision :[[/div]]',
          '[[div id="admListeEnAttente" style="max-height:280px;overflow-y:auto;text-align:left;"]][[/div]]',
        '[[/div]]',
        '[[div id="vueAdmEncaissements" style="display:none;"]]',
          '[[div style="font-size:0.8rem;color:#cbd5e1;margin-bottom:8px;text-align:left;"]]Joueurs avec ardoise en cours (impayés) :[[/div]]',
          '[[div id="admListeDebiteurs" style="max-height:280px;overflow-y:auto;text-align:left;"]][[/div]]',
        '[[/div]]',
        '[[div id="vueAdmDepenses" style="display:none;"]]',
          '[[div style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px;margin-bottom:12px;text-align:left;"]]',
            '[[div style="font-weight:800;font-size:0.82rem;color:#cbd5e1;margin-bottom:8px;"]]Enregistrer un achat / sortie d\'argent :[[/div]]',
            '[[div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-bottom:8px;"]]',
              '[[input type="text" id="inpAdmDepenseMotif" class="inp-field" placeholder="Ex: Packs de bières + pizzas" style="padding:7px 10px;font-size:0.8rem;"]]',
              '[[input type="number" id="inpAdmDepenseMontant" class="inp-field" placeholder="Montant €" step="0.5" style="padding:7px 10px;font-size:0.8rem;"]]',
            '[[/div]]',
            '[[button type="button" class="btn-enter" style="margin:0;width:100%;padding:7px;font-size:0.78rem;" onclick="enregistrerDepenseParAdmin()"]]Déduire de la caisse[[/button]]',
            '[[div id="statusAdmDepense" style="font-size:0.75rem;color:var(--color-secondary);margin-top:4px;text-align:center;min-height:1.2em;"]][[/div]]',
          '[[/div]]',
          '[[div style="font-size:0.78rem;font-weight:800;color:#94a3b8;margin-bottom:6px;text-align:left;"]]Historique des dépenses :[[/div]]',
          '[[div id="admListeDepenses" style="max-height:180px;overflow-y:auto;text-align:left;"]][[/div]]',
        '[[/div]]',
        '[[div id="vueAdmBareme" style="display:none;"]]',
          '[[div style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px;margin-bottom:12px;text-align:left;"]]',
            '[[div style="font-weight:800;font-size:0.82rem;color:#cbd5e1;margin-bottom:8px;"]]Objectif & Paiement :[[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-bottom:8px;"]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Cagnotte cible (€) :[[/label]][[input type="number" id="inpAdmCagnotteCible" class="inp-field" style="padding:7px 10px;font-size:0.8rem;"]][[/div]]',
              '[[div]][[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Description objectif :[[/label]][[input type="text" id="inpAdmObjectifDesc" class="inp-field" style="padding:7px 10px;font-size:0.8rem;"]][[/div]]',
            '[[/div]]',
            '[[div style="margin-bottom:8px;"]]',
              '[[label style="font-size:0.72rem;color:#94a3b8;display:block;margin-bottom:3px;"]]Instructions / Lien Lydia :[[/label]]',
              '[[input type="text" id="inpAdmMoyenPaiement" class="inp-field" style="padding:7px 10px;font-size:0.8rem;"]]',
            '[[/div]]',
            '[[button type="button" class="btn-reset" style="width:100%;font-size:0.78rem;padding:6px;border-color:var(--color-primary);color:#fff;" onclick="sauvegarderConfigCaisse()"]]Enregistrer les paramètres de cagnotte[[/button]]',
          '[[/div]]',
          '[[div style="background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px;margin-bottom:12px;text-align:left;"]]',
            '[[div style="font-weight:800;font-size:0.82rem;color:#cbd5e1;margin-bottom:8px;"]]Ajouter une règle au barème :[[/div]]',
            '[[div style="margin-bottom:8px;"]][[input type="text" id="inpAdmNouveauTitreBareme" class="inp-field" placeholder="Titre (ex: 🍕 Oubli des pizzas après match)" style="padding:7px 10px;font-size:0.8rem;"]][[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;"]]',
              '[[input type="number" id="inpAdmNouveauMontantBareme" class="inp-field" placeholder="Tarif (€)" step="0.5" style="padding:7px 10px;font-size:0.8rem;"]]',
              '[[select id="selAdmNouvelleCatBareme" class="inp-field" style="padding:7px 10px;font-size:0.8rem;"]]',
                '[[option value="Retard"]]Retard[[/option]]',
                '[[option value="Matériel"]]Matériel[[/option]]',
                '[[option value="Discipline"]]Discipline[[/option]]',
                '[[option value="Match"]]Match[[/option]]',
                '[[option value="Convivialité"]]Convivialité[[/option]]',
              '[[/select]]',
            '[[/div]]',
            '[[button type="button" class="btn-enter" style="margin:0;width:100%;padding:7px;font-size:0.78rem;" onclick="ajouterLigneBaremeAdmin()"]]Ajouter au barème officiel[[/button]]',
          '[[/div]]',
          '[[div style="font-size:0.78rem;font-weight:800;color:#94a3b8;margin-bottom:6px;text-align:left;"]]Barème officiel actuel :[[/div]]',
          '[[div id="admListeBaremeEditer" style="max-height:180px;overflow-y:auto;text-align:left;"]][[/div]]',
        '[[/div]]',
        '[[div id="vueAdmWhatsapp" style="display:none;text-align:left;"]]',
          '[[div style="font-size:0.8rem;color:#cbd5e1;margin-bottom:8px;"]]Générez et partagez le récapitulatif de la caisse noire sur le groupe WhatsApp :[[/div]]',
          '[[textarea id="txtAdmBilanWa" class="inp-field" rows="8" style="font-size:0.8rem;line-height:1.4;margin-bottom:10px;resize:vertical;" readonly]][[/textarea]]',
          '[[div style="display:flex;gap:6px;margin-bottom:14px;"]]',
            '[[button type="button" class="btn-wa" style="flex:1;padding:8px 12px;font-size:0.8rem;" onclick="ouvrirBilanCaisseSurWhatsApp()"]]📱 Partager sur WhatsApp[[/button]]',
            '[[button type="button" class="btn-reset" style="padding:8px 12px;font-size:0.8rem;" onclick="copierBilanCaissePressePapier()"]]📋 Copier[[/button]]',
          '[[/div]]',
          '[[div style="border-top:1px solid rgba(239,68,68,0.25);padding-top:12px;text-align:center;"]]',
            '[[button type="button" class="btn-reset" style="color:#f87171;font-size:0.74rem;" onclick="reinitialiserCaisseNoireParAdmin()"]]🔄 Clôturer et remettre la caisse noire à zéro[[/button]]',
          '[[/div]]',
        '[[/div]]',
        '[[div style="margin-top:14px;border-top:1px solid rgba(148,163,184,0.15);padding-top:10px;display:flex;justify-content:space-between;align-items:center;"]]',
          '[[button type="button" class="btn-reset" style="font-size:0.75rem;" onclick="fermerModalAdminCaisseNoire(); ouvrirModalCaisseNoire();"]]👀 Voir la vue Joueurs[[/button]]',
          '[[button type="button" class="btn-reset" style="padding:6px 14px;font-size:0.78rem;" onclick="fermerModalAdminCaisseNoire()"]]Fermer[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div id="previewView" style="display:none;"]]',
      '[[main class="preview-page"]]',
        '[[div class="preview-header"]][[button class="btn-reset" onclick="retourApercu()"]]← Retour[[/button]][[h1 id="previewTitle"]]Aperçu Convocations & Terrain Tactique[[/h1]][[/div]]',
        '[[div id="tacticalPreviewWrap" class="tactical-preview-wrap" style="display:none;"]]',
          '[[div class="tactical-header"]]',
            '[[div style="font-weight:800;font-size:0.95rem;color:var(--color-secondary);"]]Terrain Tactique - Attaque Placée & Gardien[[/div]]',
            '[[div class="tactical-team-tabs" id="tacticalTeamTabs"]][[/div]]',
          '[[/div]]',
          '[[div id="tacticalSwapHint" style="font-size:0.78rem;color:#38bdf8;margin:6px 0 10px 0;text-align:center;font-weight:700;min-height:1.2em;"]][[span style="color:#94a3b8;font-weight:500;"]]Astuce : Glissez-déposez ou cliquez sur deux joueurs pour échanger leurs postes.[[/span]][[/div]]',
          '[[div class="handball-field-wrapper"]]',
            '[[svg viewBox="0 0 500 420" class="handball-court-svg" style="width:100%;height:100%;display:block;"]]',
              '[[rect x="15" y="15" width="470" height="375" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2"/]]',
              '[[line x1="15" y1="15" x2="485" y2="15" stroke="rgba(255,255,255,0.6)" stroke-width="2.5"/]]',
              '[[path d="M 112 390 A 138 138 0 0 1 215 252 L 285 252 A 138 138 0 0 1 388 390 Z" fill="rgba(37, 99, 235, 0.22)" stroke="#ffffff" stroke-width="2.5"/]]',
              '[[path d="M 43 390 A 207 207 0 0 1 215 183 L 285 183 A 207 207 0 0 1 457 390" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="8 8"/]]',
              '[[line x1="235" y1="229" x2="265" y2="229" stroke="#ffffff" stroke-width="3"/]]',
              '[[line x1="242" y1="298" x2="258" y2="298" stroke="#ffffff" stroke-width="2.5"/]]',
              '[[rect x="215" y="390" width="70" height="18" fill="none" stroke="#f43f5e" stroke-width="3"/]]',
              '[[line x1="225" y1="390" x2="225" y2="408" stroke="rgba(255,255,255,0.4)" stroke-width="1"/]]',
              '[[line x1="235" y1="390" x2="235" y2="408" stroke="rgba(255,255,255,0.4)" stroke-width="1"/]]',
              '[[line x1="245" y1="390" x2="245" y2="408" stroke="rgba(255,255,255,0.4)" stroke-width="1"/]]',
              '[[line x1="255" y1="390" x2="255" y2="408" stroke="rgba(255,255,255,0.4)" stroke-width="1"/]]',
              '[[line x1="265" y1="390" x2="265" y2="408" stroke="rgba(255,255,255,0.4)" stroke-width="1"/]]',
              '[[line x1="275" y1="390" x2="275" y2="408" stroke="rgba(255,255,255,0.4)" stroke-width="1"/]]',
            '[[/svg]]',
            '[[div id="tacticalCourtNodes" class="court-nodes-container"]][[/div]]',
          '[[/div]]',
          '[[div class="tactical-bench-wrap"]]',
            '[[div style="font-size:0.78rem;font-weight:700;color:#94a3b8;margin-bottom:6px;"]]Remplaçants & Rotation (glissez-déposez ou cliquez sur deux joueurs pour permuter) :[[/div]]',
            '[[div id="tacticalBenchList" class="bench-chips-list"]][[/div]]',
          '[[/div]]',
        '[[/div]]',
        '[[div id="previewWhatsAppBlock"]]',
          '[[div style="font-weight:800;font-size:0.88rem;color:#cbd5e1;margin:14px 0 6px 0;text-align:left;"]]Message de convocation WhatsApp (modifiable) :[[/div]]',
          '[[div id="previewMessages"]][[/div]]',
          '[[div class="preview-status" id="previewStatus"]][[/div]]',
          '[[div class="preview-actions"]][[button class="btn-reset" onclick="retourApercu()"]]Retour[[/button]][[button type="button" class="btn-enter" id="btnSavePreview" style="background:#2563eb;color:#fff;font-weight:700;padding:8px 14px;font-size:0.82rem;width:auto;margin:0;" onclick="sauvegarderApercuDepuisTerrain()"]]💾 Sauvegarder la composition[[/button]][[button class="btn-wa" id="btnPublishPreview" onclick="publierApercu()"]]Publier sur WhatsApp[[/button]][[/div]]',
        '[[/div]]',
        '[[div class="preview-actions" id="previewPlayerBottomActions" style="display:none;margin-top:14px;"]][[button class="btn-reset" onclick="retourApercu()"]]← Retour à l\'accueil[[/button]][[/div]]',
      '[[/main]]',
    '[[/div]]',
    '[[script]]',
    'var CLUB_CONFIG = { nomClub: "' + cfg.nomClub + '", githubRepo: "' + (cfg.githubRepo || '') + '", chouchou: "' + (cfg.chouchou || '') + '", nbEquipes: ' + (cfg.nbEquipes || 2) + ', equipes: ' + JSON.stringify(cfg.equipes || []) + ', nomEquipe1: "' + cfg.nomEquipe1 + '", nomEquipe2: "' + cfg.nomEquipe2 + '", nomEquipe3: "' + (cfg.nomEquipe3 || 'Équipe 3') + '", couleurPrimaire: "' + cfg.couleurPrimaire + '", couleurSecondaire: "' + cfg.couleurSecondaire + '", couleurEquipe1: "' + cfg.couleurEquipe1 + '", couleurEquipe2: "' + cfg.couleurEquipe2 + '", couleurEquipe3: "' + (cfg.couleurEquipe3 || '#10b981') + '", logoUrl: "' + cfg.logoUrl + '", urlFfhbClub: "' + (cfg.urlFfhbClub || '') + '" };',
    'var NOUVEAU_LOGO_IMPORTE = ""; var NOUVEAU_NOM_CLUB_IMPORTE = ""; var NOUVEAU_SALLE_IMPORTEE = "";',
    'var SEANCES_TRAIN = ' + JSON.stringify(cfg.seancesTrain || [{ id: "lun", jour: "Lundi", horaire: "20h30", label: "Lundi (20h30)", actif: true }, { id: "mer", jour: "Mercredi", horaire: "20h30", label: "Mercredi (20h30)", actif: true }, { id: "jeu", jour: "Jeudi", horaire: "20h30", label: "Jeudi (20h30)", actif: false }]) + ';',
    'var DERNIERE_COMPO = null;',
    'var EQUIPE_TACTIQUE_COURANTE = "1B";',
    'var COMPOSITIONS_TACTIQUES = { "1B": {}, "1C": {}, "1D": {} };',
    'var POSITIONS_HANDBALL = [',
    '  { code: "GB", label: "Gardien", x: 50, y: 82 },',
    '  { code: "PVT", label: "Pivot", x: 50, y: 62 },',
    '  { code: "ALG", label: "Ailier G.", x: 18, y: 56 },',
    '  { code: "ARG", label: "Arrière G.", x: 18, y: 20 },',
    '  { code: "DC", label: "Demi-Centre", x: 50, y: 22 },',
    '  { code: "ARD", label: "Arrière D.", x: 82, y: 20 },',
    '  { code: "ALD", label: "Ailier D.", x: 82, y: 56 }',
    '];',
    'var SEANCE_COURANTE = (SEANCES_TRAIN && SEANCES_TRAIN[0] && SEANCES_TRAIN[0].id) || "lun";',
    'var ENTRAINEMENTS = {};',
    'if(SEANCES_TRAIN && SEANCES_TRAIN.length){',
    '  SEANCES_TRAIN.forEach(function(s){ ENTRAINEMENTS[s.id] = []; });',
    '}',
    'var TRAIN_CONFIG = {};',
    'if(SEANCES_TRAIN && SEANCES_TRAIN.length){',
    '  SEANCES_TRAIN.forEach(function(s, idx){',
    '    TRAIN_CONFIG[s.id] = { label: s.label || (s.jour + " " + (s.horaire || "")), type: (idx === 0 ? "separe" : (idx === 1 ? "complet" : "reduit")), max: 20 };',
    '  });',
    '}',
    'var TRAIN_MODE_TINDER = false; var TRAIN_SWIPE_HISTORIQUE = []; var TRAIN_ANIM_EN_COURS = false;',
    'var JOUEURS = []; var EFFECTIF_COMPLET = []; var MODE_TINDER = false; var HISTORIQUE_SWIPE = []; var ANIM_EN_COURS = false; var CONTEXTE_APERCU = null; var VUE_PRECEDENTE_APERCU = "appView";',
    'var SESSION_TEL = ""; var SESSION_PIN = ""; var SESSION_NOM = ""; var EST_COACH = false; var EST_TRESORIER = false; var ID_ABSENCE_EN_COURS = null; var CURRENT_MATCH_SALLE = "";',
    'var INFOS_MATCHS = null; var COVOITURAGE_DATA = { conducteurs: [], passagers: [] }; var VOTES_MVP_DATA = { totalVotes: 0, podiumMvp: [], podiumChevre: [] }; var MES_ABSENCES = []; var STATUT_COVOIT_CHOISI = "conduis";',
    'var CAISSE_NOIRE_DATA = { config: { devise: "€", objectifCagnotte: 300, objectifDescription: "Resto & Tournée de fin d\'année", moyenPaiement: "Lydia / Espèces au vestiaire", bareme: [] }, amendes: [], depenses: [], stats: { totalCollecte: 0, totalDu: 0, soldeCaisse: 0, totalDepenses: 0 } };',
    'var JOUEUR_MODAL_COURANT = null; var POSTE_MODAL_COURANT = ""; var PHOTO_MODAL_DATA = undefined;',
    'function afficherLoading(titre, sousTitre){',
      'var el = document.getElementById("globalLoadingScreen"); if(!el) return;',
      'if(titre) document.getElementById("loadingScreenTitle").textContent = titre;',
      'if(sousTitre) document.getElementById("loadingScreenSub").textContent = sousTitre;',
      'el.style.opacity = "1"; el.style.visibility = "visible"; el.style.display = "flex";',
    '}',
    'function masquerLoading(){',
      'var el = document.getElementById("globalLoadingScreen"); if(!el) return;',
      'el.style.opacity = "0";',
      'setTimeout(function(){ if(el.style.opacity === "0"){ el.style.visibility = "hidden"; el.style.display = "none"; } }, 320);',
    '}',
    'function initialiserColonnes(){',
      'var pool = document.getElementById("zonePool"); if(!pool || !JOUEURS) return;',
      'var deja1B = extraireListeNoms("zone1B");',
      'var deja1C = document.getElementById("zone1C") ? extraireListeNoms("zone1C") : [];',
      'var deja1D = document.getElementById("zone1D") ? extraireListeNoms("zone1D") : [];',
      'var dejaRepos = document.getElementById("zoneRepos") ? extraireListeNoms("zoneRepos") : [];',
      'var z1B = document.getElementById("zone1B"), z1C = document.getElementById("zone1C"), z1D = document.getElementById("zone1D"), zRepos = document.getElementById("zoneRepos");',
      'if(z1B) z1B.innerHTML = ""; if(z1C) z1C.innerHTML = ""; if(z1D) z1D.innerHTML = ""; if(zRepos) zRepos.innerHTML = ""; pool.innerHTML = "";',
      'JOUEURS.forEach(function(j){',
        'var c = creerCarte(j);',
        'if(deja1B.indexOf(j.nom) !== -1 && z1B) z1B.appendChild(c);',
        'else if(deja1C.indexOf(j.nom) !== -1 && z1C) z1C.appendChild(c);',
        'else if(deja1D.indexOf(j.nom) !== -1 && z1D) z1D.appendChild(c);',
        'else if(dejaRepos.indexOf(j.nom) !== -1 && zRepos) zRepos.appendChild(c);',
        'else pool.appendChild(c);',
      '});',
      'majCompteurs();',
    '}',
    'function getContrastColor(hexColor){',
      'if(!hexColor) return "#ffffff";',
      'var str = String(hexColor).trim();',
      'if(str.charAt(0) !== "#") return "#ffffff";',
      'var hex = str.substring(1);',
      'if(hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);',
      'if(hex.length !== 6) return "#ffffff";',
      'var r = parseInt(hex.substring(0, 2), 16) || 0, g = parseInt(hex.substring(2, 4), 16) || 0, b = parseInt(hex.substring(4, 6), 16) || 0;',
      'var yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;',
      'return (yiq >= 150) ? "#111827" : "#ffffff";',
    '}',
    'function appliquerVariablesCss(cp, cs, c1, c2, c3){',
      'var r = document.documentElement;',
      'r.style.setProperty("--color-primary", cp);',
      'r.style.setProperty("--color-primary-text", getContrastColor(cp));',
      'r.style.setProperty("--color-secondary", cs);',
      'r.style.setProperty("--color-secondary-text", getContrastColor(cs));',
      'r.style.setProperty("--color-team1", c1);',
      'r.style.setProperty("--color-team1-text", getContrastColor(c1));',
      'r.style.setProperty("--color-team2", c2);',
      'r.style.setProperty("--color-team2-text", getContrastColor(c2));',
      'r.style.setProperty("--color-team3", c3 || "#10b981");',
      'r.style.setProperty("--color-team3-text", getContrastColor(c3 || "#10b981"));',
    '}',
    'function ouvrirSelecteurLogoClub(){ document.getElementById("fileClubLogo").click(); }',
    'function chargerFichierLogoClub(e){',
      'var f = e.target.files[0]; if(!f) return;',
      'var r = new FileReader();',
      'r.onload = function(evt){',
        'var b64 = evt.target.result;',
        'document.getElementById("modalLogoStatus").textContent = "Téléversement du blason sur Google Drive...";',
        'google.script.run.withSuccessHandler(function(res){',
          'document.getElementById("modalLogoStatus").textContent = "Blason du club mis à jour !";',
          'majClubLogoClient(res.logoUrl);',
          'if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });',
        '}).withFailureHandler(function(err){',
          'document.getElementById("modalLogoStatus").textContent = "Erreur : " + err.message;',
        '}).enregistrerLogoClub(SESSION_TEL, SESSION_PIN, b64);',
      '};',
      'r.readAsDataURL(f);',
    '}',
    'function sauvegarderLogoUrlClient(){',
      'var url = document.getElementById("inpClubLogoUrl").value.trim();',
      'if(!url) return;',
      'document.getElementById("modalLogoStatus").textContent = "Enregistrement du logo...";',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("modalLogoStatus").textContent = "Blason du club mis à jour !";',
        'majClubLogoClient(res.logoUrl);',
        'if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });',
      '}).withFailureHandler(function(err){',
        'document.getElementById("modalLogoStatus").textContent = "Erreur : " + err.message;',
      '}).enregistrerLogoClub(SESSION_TEL, SESSION_PIN, url);',
    '}',
    'function reinitialiserLogoClubClient(){',
      'if(!confirm("Rétablir le blason vectoriel officiel dynamique du club ?")) return;',
      'document.getElementById("modalLogoStatus").textContent = "Rétablissement du blason officiel...";',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("modalLogoStatus").textContent = "Blason officiel rétabli !";',
        'majClubLogoClient(res.logoUrl);',
      '}).withFailureHandler(function(err){',
        'document.getElementById("modalLogoStatus").textContent = "Erreur : " + err.message;',
      '}).reinitialiserLogoClub(SESSION_TEL, SESSION_PIN);',
    '}',
    'function majClubLogoClient(nouvelleUrl){',
    '  CLUB_CONFIG.logoUrl = nouvelleUrl;',
    '  ["homeLogoImg", "appHeaderLogoImg", "trainHeaderLogoImg", "rosterHeaderLogoImg", "modalClubLogoPreview"].forEach(function(id){',
    '    var img = document.getElementById(id);',
    '    if(img) img.src = nouvelleUrl;',
    '  });',
    '}',
    'function extraireCouleursImageCanvas(imgElement, callback){',
    '  try {',
    '    var canvas = document.createElement("canvas");',
    '    var ctx = canvas.getContext("2d");',
    '    var w = 80, h = 80;',
    '    canvas.width = w; canvas.height = h;',
    '    ctx.drawImage(imgElement, 0, 0, w, h);',
    '    var imgData = ctx.getImageData(0, 0, w, h).data;',
    '    var buckets = {}, countDark = 0, countTotal = 0;',
    '    for(var i = 0; i < imgData.length; i += 4){',
    '      var r = imgData[i], g = imgData[i + 1], b = imgData[i + 2], a = imgData[i + 3];',
    '      if(a < 128) continue;',
    '      if(r > 235 && g > 235 && b > 235) continue;',
    '      if(r < 30 && g < 30 && b < 30){ countDark++; continue; }',
    '      countTotal++;',
    '      var qr = Math.floor(r / 16) * 16, qg = Math.floor(g / 16) * 16, qb = Math.floor(b / 16) * 16;',
    '      var key = qr + "," + qg + "," + qb;',
    '      if(!buckets[key]) buckets[key] = { r: qr, g: qg, b: qb, count: 0 };',
    '      buckets[key].count++;',
    '    }',
    '    var list = Object.values(buckets);',
    '    if(!list.length){ callback({ primaire: "#f97316", secondaire: "#fbbf24", equipe1: "#f97316", equipe2: "#fbbf24", equipe3: "#10b981" }); return; }',
    '    list.forEach(function(item){',
    '      var max = Math.max(item.r, item.g, item.b), min = Math.min(item.r, item.g, item.b);',
    '      var sat = max === 0 ? 0 : (max - min) / max;',
    '      item.score = item.count * (1 + sat * 3);',
    '    });',
    '    list.sort(function(a, b){ return b.score - a.score; });',
    '    function toHex(r, g, b){ return "#" + ("0" + r.toString(16)).slice(-2) + ("0" + g.toString(16)).slice(-2) + ("0" + b.toString(16)).slice(-2); }',
    '    function colDist(c1, c2){ var dr = c1.r - c2.r, dg = c1.g - c2.g, db = c1.b - c2.b; return Math.sqrt(dr * dr + dg * dg + db * db); }',
    '    var prim = list[0];',
    '    var hexP = toHex(prim.r, prim.g, prim.b);',
    '    var sec = null;',
    '    for(var k = 1; k < list.length; k++){ if(colDist(prim, list[k]) > 75){ sec = list[k]; break; } }',
    '    var hexS = "";',
    '    if(sec){ hexS = toHex(sec.r, sec.g, sec.b); }',
    '    else { hexS = (countDark > countTotal * 0.15) ? "#1e293b" : "#fbbf24"; }',
    '    var hexE3 = "#10b981";',
    '    for(var m = 2; m < list.length; m++){',
    '      if(colDist(prim, list[m]) > 60 && (!sec || colDist(sec, list[m]) > 60)){ hexE3 = toHex(list[m].r, list[m].g, list[m].b); break; }',
    '    }',
    '    callback({ primaire: hexP, secondaire: hexS, equipe1: hexP, equipe2: hexS, equipe3: hexE3 });',
    '  } catch(e){ console.error("Erreur extraction couleurs:", e); callback(null); }',
    '}',
    'function importerDepuisFfhbClient(){',
    '  var inp = document.getElementById("inpFfhbClubUrl");',
    '  var url = inp ? inp.value.trim() : "";',
    '  if(!url){ afficherToast("Veuillez saisir l\'adresse de votre club sur monclub.ffhandball.fr", "erreur"); return; }',
    '  var btn = document.getElementById("btnImportFfhb");',
    '  var status = document.getElementById("ffhbImportStatus");',
    '  if(btn) btn.disabled = true;',
    '  if(status) status.innerHTML = "<span style=\'color:#38bdf8;\'>⏳ Connexion à FFHB et récupération des données...</span>";',
    '  google.script.run.withSuccessHandler(function(res){',
    '    if(btn) btn.disabled = false;',
    '    if(!res || !res.ok){ if(status) status.innerHTML = "<span style=\'color:#f87171;\'>Erreur lors de l\'importation.</span>"; return; }',
    '    NOUVEAU_NOM_CLUB_IMPORTE = res.nomClub || "";',
    '    NOUVEAU_LOGO_IMPORTE = res.logoUrl || "";',
    '    NOUVEAU_SALLE_IMPORTEE = res.salleDefaut || "";',
    '    if(document.getElementById("inpClubLogoUrl")) document.getElementById("inpClubLogoUrl").value = res.logoUrl;',
    '    if(document.getElementById("modalClubLogoPreview")) document.getElementById("modalClubLogoPreview").src = res.logoDataUri || res.logoUrl;',
    '    if(status) status.innerHTML = "<span style=\'color:#38bdf8;\'>🎨 Détection des couleurs du blason...</span>";',
    '    var imgTemp = new Image();',
    '    imgTemp.crossOrigin = "Anonymous";',
    '    imgTemp.onload = function(){',
    '      extraireCouleursImageCanvas(imgTemp, function(pal){',
    '        if(pal){',
    '          document.getElementById("inpColPrimaire").value = pal.primaire;',
    '          document.getElementById("txtColPrimaire").value = pal.primaire.toUpperCase();',
    '          document.getElementById("inpColSecondaire").value = pal.secondaire;',
    '          document.getElementById("txtColSecondaire").value = pal.secondaire.toUpperCase();',
    '          document.getElementById("inpColEq1").value = pal.equipe1;',
    '          document.getElementById("txtColEq1").value = pal.equipe1.toUpperCase();',
    '          document.getElementById("inpColEq2").value = pal.equipe2;',
    '          document.getElementById("txtColEq2").value = pal.equipe2.toUpperCase();',
    '          if(document.getElementById("inpColEq3")){',
    '            document.getElementById("inpColEq3").value = pal.equipe3;',
    '            document.getElementById("txtColEq3").value = pal.equipe3.toUpperCase();',
    '          }',
    '          majCouleursLive();',
    '        }',
    '        majClubLogoClient(res.logoUrl);',
    '        var nomAff = res.nomClub ? (" : " + res.nomClub) : "";',
    '        if(status) status.innerHTML = "<span style=\'color:#22c55e;font-weight:800;\'>✓ Club importé" + nomAff + "</span><br><span style=\'color:#cbd5e1;font-size:0.7rem;\'>Logo et couleurs synchronisés ! Cliquez ci-dessous sur « Enregistrer les modifications » pour valider.</span>";',
    '        afficherToast("Club " + (res.nomClub || "") + " importé avec succès !", "succes");',
    '        if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });',
    '      });',
    '    };',
    '    imgTemp.onerror = function(){',
    '      majClubLogoClient(res.logoUrl);',
    '      if(status) status.innerHTML = "<span style=\'color:#22c55e;font-weight:800;\'>✓ Logo FFHB importé" + (res.nomClub ? (" : " + res.nomClub) : "") + "</span>";',
    '      afficherToast("Logo FFHB récupéré !", "succes");',
    '    };',
    '    imgTemp.src = res.logoDataUri || res.logoUrl;',
    '  }).withFailureHandler(function(err){',
    '    if(btn) btn.disabled = false;',
    '    if(status) status.innerHTML = "<span style=\'color:#f87171;\'>Erreur : " + err.message + "</span>";',
    '    afficherToast(err.message, "erreur");',
    '  }).importerInfosClubFFHB(SESSION_TEL, SESSION_PIN, url);',
    '}',
    'function choisirNbEquipesModal(n){',
      'var num = parseInt(n, 10) || 3;',
      'var inp = document.getElementById("inpNbEquipesModal"); if(inp) inp.value = num;',
      '[1, 2, 3].forEach(function(i){',
        'var b = document.getElementById("btnNbEq" + i); if(!b) return;',
        'if(i === num){',
          'b.style.background = "var(--color-primary)"; b.style.borderColor = "var(--color-primary)"; b.style.color = "#ffffff"; b.style.fontWeight = "800";',
        '} else {',
          'b.style.background = "#0f172a"; b.style.borderColor = "#334155"; b.style.color = "#94a3b8"; b.style.fontWeight = "500";',
        '}',
      '});',
      'var rowEq3 = document.getElementById("rowColEq3"); if(rowEq3) rowEq3.style.display = (num >= 3) ? "flex" : "none";',
      'var rowEq2 = document.getElementById("rowColEq2"); if(rowEq2) rowEq2.style.display = (num >= 2) ? "flex" : "none";',
      'var boxEq3 = document.getElementById("boxCfgEq3"); if(boxEq3) boxEq3.style.display = (num >= 3) ? "block" : "none";',
      'var boxEq2 = document.getElementById("boxCfgEq2"); if(boxEq2) boxEq2.style.display = (num >= 2) ? "block" : "none";',
      'var prevE3 = document.getElementById("prevBadgeE3"); if(prevE3) prevE3.style.display = (num >= 3) ? "inline-block" : "none";',
      'var prevE2 = document.getElementById("prevBadgeE2"); if(prevE2) prevE2.style.display = (num >= 2) ? "inline-block" : "none";',
    '}',
    'function ouvrirModalCouleurs(){',
      'var cp = CLUB_CONFIG.couleurPrimaire || "' + cfg.couleurPrimaire + '";',
      'var cs = CLUB_CONFIG.couleurSecondaire || "' + cfg.couleurSecondaire + '";',
      'var c1 = CLUB_CONFIG.couleurEquipe1 || "' + cfg.couleurEquipe1 + '";',
      'var c2 = CLUB_CONFIG.couleurEquipe2 || "' + cfg.couleurEquipe2 + '";',
      'var c3 = CLUB_CONFIG.couleurEquipe3 || "' + (cfg.couleurEquipe3 || '#10b981') + '";',
      'document.getElementById("inpColPrimaire").value = cp;',
      'document.getElementById("txtColPrimaire").value = cp.toUpperCase();',
      'document.getElementById("inpColSecondaire").value = cs;',
      'document.getElementById("txtColSecondaire").value = cs.toUpperCase();',
      'document.getElementById("inpColEq1").value = c1;',
      'document.getElementById("txtColEq1").value = c1.toUpperCase();',
      'document.getElementById("inpColEq2").value = c2;',
      'document.getElementById("txtColEq2").value = c2.toUpperCase();',
      'if(document.getElementById("inpColEq3")){ document.getElementById("inpColEq3").value = c3; document.getElementById("txtColEq3").value = c3.toUpperCase(); }',
      'document.getElementById("statusModalCouleurs").textContent = "";',
      'document.getElementById("modalLogoStatus").textContent = "";',
      'if(document.getElementById("inpFfhbClubUrl")) document.getElementById("inpFfhbClubUrl").value = CLUB_CONFIG.urlFfhbClub || "";',
      'if(document.getElementById("ffhbImportStatus")) document.getElementById("ffhbImportStatus").innerHTML = "";',
      'if(document.getElementById("modalClubLogoPreview")) document.getElementById("modalClubLogoPreview").src = CLUB_CONFIG.logoUrl || "' + cfg.logoUrl + '";',
      'if(document.getElementById("inpClubLogoUrl")) document.getElementById("inpClubLogoUrl").value = "";',
      'var curNb = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 3;',
      'var cEqs = (CLUB_CONFIG && CLUB_CONFIG.equipes) || [];',
      '[1, 2, 3].forEach(function(i){',
        'var eq = cEqs[i - 1] || {};',
        'var defC = (i === 1 ? "SG1" : (i === 2 ? "SG2" : "SG3"));',
        'var defL = (i === 1 ? "Équipe 1" : (i === 2 ? "Équipe 2" : "Équipe 3"));',
        'var defM = (CLUB_CONFIG.nomClub || "MON CLUB") + (i > 1 ? (" " + i) : "");',
        'if(document.getElementById("cfgEqCode" + i)) document.getElementById("cfgEqCode" + i).value = eq.code || defC;',
        'if(document.getElementById("cfgEqLabel" + i)) document.getElementById("cfgEqLabel" + i).value = eq.nomSondage || defL;',
        'if(document.getElementById("cfgEqMotCle" + i)) document.getElementById("cfgEqMotCle" + i).value = eq.motCleFfhb || defM;',
        'if(document.getElementById("cfgEqDelai" + i)) document.getElementById("cfgEqDelai" + i).value = (eq.delaiRdvHeures !== undefined ? eq.delaiRdvHeures : 1);',
        'if(document.getElementById("cfgEqUrl" + i)) document.getElementById("cfgEqUrl" + i).value = eq.urlPoule || "";',
      '});',
      'choisirNbEquipesModal(curNb);',
      'majApercuModalCouleurs(cp, cs, c1, c2, c3);',
      'document.getElementById("modalCouleursBg").style.display = "flex";',
    '}',
    'function fermerModalCouleurs(){ document.getElementById("modalCouleursBg").style.display = "none"; }',
    'function fermerModalCouleursSurBg(e){ if(e.target.id === "modalCouleursBg") fermerModalCouleurs(); }',
    'function synchroColorInput(cle){',
      'var txt = document.getElementById("txtCol" + cle).value.trim();',
      'if(/^#[0-9A-Fa-f]{6}$/.test(txt)){',
        'document.getElementById("inpCol" + cle).value = txt;',
        'majCouleursLive();',
      '}',
    '}',
    'function appliquerPresetCouleurs(cp, cs, c1, c2, c3){',
      'c3 = c3 || "#10b981";',
      'document.getElementById("inpColPrimaire").value = cp; document.getElementById("txtColPrimaire").value = cp.toUpperCase();',
      'document.getElementById("inpColSecondaire").value = cs; document.getElementById("txtColSecondaire").value = cs.toUpperCase();',
      'document.getElementById("inpColEq1").value = c1; document.getElementById("txtColEq1").value = c1.toUpperCase();',
      'document.getElementById("inpColEq2").value = c2; document.getElementById("txtColEq2").value = c2.toUpperCase();',
      'if(document.getElementById("inpColEq3")){ document.getElementById("inpColEq3").value = c3; document.getElementById("txtColEq3").value = c3.toUpperCase(); }',
      'majCouleursLive();',
    '}',
    'function majCouleursLive(){',
      'var cp = document.getElementById("inpColPrimaire").value;',
      'var cs = document.getElementById("inpColSecondaire").value;',
      'var c1 = document.getElementById("inpColEq1").value;',
      'var c2 = document.getElementById("inpColEq2").value;',
      'var c3 = document.getElementById("inpColEq3") ? document.getElementById("inpColEq3").value : "#10b981";',
      'document.getElementById("txtColPrimaire").value = cp.toUpperCase();',
      'document.getElementById("txtColSecondaire").value = cs.toUpperCase();',
      'document.getElementById("txtColEq1").value = c1.toUpperCase();',
      'document.getElementById("txtColEq2").value = c2.toUpperCase();',
      'if(document.getElementById("txtColEq3")) document.getElementById("txtColEq3").value = c3.toUpperCase();',
      'majApercuModalCouleurs(cp, cs, c1, c2, c3);',
      'appliquerVariablesCss(cp, cs, c1, c2, c3);',
    '}',
    'function majApercuModalCouleurs(cp, cs, c1, c2, c3){',
      'var bp = document.getElementById("prevBadgeP"); if(bp){ bp.style.background = cp; bp.style.color = getContrastColor(cp); }',
      'var bs = document.getElementById("prevBadgeS"); if(bs){ bs.style.background = cs; bs.style.color = getContrastColor(cs); }',
      'var b1 = document.getElementById("prevBadgeE1"); if(b1){ b1.style.background = c1; b1.style.color = getContrastColor(c1); }',
      'var b2 = document.getElementById("prevBadgeE2"); if(b2){ b2.style.background = c2; b2.style.color = getContrastColor(c2); }',
      'var b3 = document.getElementById("prevBadgeE3"); if(b3){ b3.style.background = c3 || "#10b981"; b3.style.color = getContrastColor(c3 || "#10b981"); }',
    '}',
    'function sauvegarderCouleursDepuisModal(){',
      'var cp = document.getElementById("inpColPrimaire").value;',
      'var cs = document.getElementById("inpColSecondaire").value;',
      'var c1 = document.getElementById("inpColEq1").value;',
      'var c2 = document.getElementById("inpColEq2").value;',
      'var c3 = document.getElementById("inpColEq3") ? document.getElementById("inpColEq3").value : "#10b981";',
      'var nbEq = parseInt(document.getElementById("inpNbEquipesModal") ? document.getElementById("inpNbEquipesModal").value : 3, 10) || 3;',
      'var eqList = [];',
      'for(var i = 1; i <= nbEq; i++){',
        'var cCode = (document.getElementById("cfgEqCode" + i) ? document.getElementById("cfgEqCode" + i).value.trim() : "") || ("E" + i);',
        'var cLabel = (document.getElementById("cfgEqLabel" + i) ? document.getElementById("cfgEqLabel" + i).value.trim() : "") || ("Équipe " + i);',
        'var cMotCle = (document.getElementById("cfgEqMotCle" + i) ? document.getElementById("cfgEqMotCle" + i).value.trim() : "") || cLabel;',
        'var cDelai = parseFloat(document.getElementById("cfgEqDelai" + i) ? document.getElementById("cfgEqDelai" + i).value : "1") || 1;',
        'var cUrl = (document.getElementById("cfgEqUrl" + i) ? document.getElementById("cfgEqUrl" + i).value.trim() : "");',
        'eqList.push({ num: i, code: cCode, nomSondage: cLabel, motCleFfhb: cMotCle, motCle: cMotCle, labelSondage: cLabel, delaiRdvHeures: cDelai, delaiRdv: cDelai, urlPoule: cUrl });',
      '}',
      'var urlFfhb = (document.getElementById("inpFfhbClubUrl") ? document.getElementById("inpFfhbClubUrl").value.trim() : "") || (CLUB_CONFIG.urlFfhbClub || "");',
      'var logoAEnregistrer = (document.getElementById("inpClubLogoUrl") ? document.getElementById("inpClubLogoUrl").value.trim() : "") || (NOUVEAU_LOGO_IMPORTE || "");',
      'var payloadCouleurs = {',
        'primaire: cp,',
        'secondaire: cs,',
        'equipe1: c1,',
        'equipe2: c2,',
        'equipe3: c3,',
        'nbEquipes: nbEq,',
        'equipes: eqList,',
        'logoUrl: logoAEnregistrer,',
        'nomClub: NOUVEAU_NOM_CLUB_IMPORTE || "",',
        'urlFfhbClub: urlFfhb',
      '};',
      'document.getElementById("statusModalCouleurs").textContent = "Enregistrement dans Google Sheet...";',
      'document.getElementById("btnSaveCouleurs").disabled = true;',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("btnSaveCouleurs").disabled = false;',
        'document.getElementById("statusModalCouleurs").textContent = "Paramètres enregistrés avec succès !";',
        'CLUB_CONFIG.couleurPrimaire = cp;',
        'CLUB_CONFIG.couleurSecondaire = cs;',
        'CLUB_CONFIG.couleurEquipe1 = c1;',
        'CLUB_CONFIG.couleurEquipe2 = c2;',
        'CLUB_CONFIG.couleurEquipe3 = c3;',
        'CLUB_CONFIG.equipes = eqList;',
        'var ancienNb = CLUB_CONFIG.nbEquipes;',
        'CLUB_CONFIG.nbEquipes = nbEq;',
        'if(res && res.logoUrl){',
        '  CLUB_CONFIG.logoUrl = res.logoUrl;',
        '  majClubLogoClient(res.logoUrl);',
        '}',
        'if(res && res.nomClub){',
        '  CLUB_CONFIG.nomClub = res.nomClub;',
        '  if(document.getElementById("homeClubName")) document.getElementById("homeClubName").textContent = res.nomClub;',
        '  if(document.getElementById("headerClubTitle")) document.getElementById("headerClubTitle").textContent = res.nomClub + " - Compo Coach";',
        '}',
        'if(res && res.urlFfhbClub){',
        '  CLUB_CONFIG.urlFfhbClub = res.urlFfhbClub;',
        '}',
        'afficherToast("Configuration des équipes et couleurs enregistrée !", "succes");',
        'if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });',
        'setTimeout(function(){',
          'fermerModalCouleurs();',
          'chargerDonneesCoach();',
        '}, 900);',
      '}).withFailureHandler(function(err){',
        'document.getElementById("btnSaveCouleurs").disabled = false;',
        'document.getElementById("statusModalCouleurs").textContent = err.message;',
        'afficherToast(err.message, "erreur");',
      '}).enregistrerCouleursClub(SESSION_TEL, SESSION_PIN, payloadCouleurs);',
    '}',
    'function ouvrirSelecteurPhotoJoueur(){ document.getElementById("filePhoto").click(); }',
    'function ouvrirSelecteurPhotoCoach(){ document.getElementById("fileCoachPhoto").click(); }',
    'function comparerJoueursAlpha(a, b){ return String(a.nom || "").localeCompare(String(b.nom || ""), "fr", { sensitivity: "base" }); }',
    'function trierZoneHtml(zoneId){',
      'var z = document.getElementById(zoneId); if(!z) return;',
      'var cartes = Array.from(z.children);',
      'cartes.sort(function(a, b){ return String(a.getAttribute("data-nom") || "").localeCompare(String(b.getAttribute("data-nom") || ""), "fr", { sensitivity: "base" }); });',
      'cartes.forEach(function(c){ z.appendChild(c); });',
    '}',
    'function animerVoteBouton(choix){',
      'if(MODE_TINDER) swiperVers(choix);',
    '}',
    'function majCompteurs(){',
      'var zPool = document.getElementById("zonePool");',
      'var nPool = zPool ? zPool.children.length : 0;',
      'var cPool = document.getElementById("countPool"); if(cPool) cPool.textContent = nPool;',
      'var tPool = document.getElementById("tCountPool"); if(tPool) tPool.textContent = nPool;',
      'var z1B = document.getElementById("zone1B");',
      'var n1B = z1B ? z1B.children.length : 0;',
      'var c1B = document.getElementById("count1B"); if(c1B) c1B.textContent = n1B + "/12";',
      'var t1B = document.getElementById("tCount1B"); if(t1B) t1B.textContent = n1B;',
      'var z1C = document.getElementById("zone1C");',
      'var n1C = z1C ? z1C.children.length : 0;',
      'var c1C = document.getElementById("count1C"); if(c1C) c1C.textContent = n1C + "/12";',
      'var t1C = document.getElementById("tCount1C"); if(t1C) t1C.textContent = n1C;',
      'var z1D = document.getElementById("zone1D");',
      'var n1D = z1D ? z1D.children.length : 0;',
      'var c1D = document.getElementById("count1D"); if(c1D) c1D.textContent = n1D + "/12";',
      'var t1D = document.getElementById("tCount1D"); if(t1D) t1D.textContent = n1D;',
      'var zRepos = document.getElementById("zoneRepos");',
      'var nRepos = zRepos ? zRepos.children.length : 0;',
      'var cRepos = document.getElementById("countRepos"); if(cRepos) cRepos.textContent = nRepos;',
      'var tRepos = document.getElementById("tCountRepos"); if(tRepos) tRepos.textContent = nRepos;',
      'majTinderReposChips();',
    '}',
    'function majTinderReposChips(){',
      'var cont = document.getElementById("tinderReposChips");',
      'var bar = document.getElementById("tinderReposBar");',
      'var zRepos = document.getElementById("zoneRepos");',
      'if(!cont || !zRepos) return;',
      'var noms = Array.from(zRepos.children).map(function(card){ return card.getAttribute("data-nom"); });',
      'if(bar) bar.style.display = (noms.length > 0 && MODE_TINDER) ? "block" : "none";',
      'cont.innerHTML = "";',
      'noms.forEach(function(nom){',
        'var chip = document.createElement("span");',
        'chip.className = "tinder-repos-chip";',
        'chip.textContent = nom + " ↺";',
        'chip.title = "Cliquez pour rétablir dans les joueurs disponibles";',
        'chip.onclick = function(){ restaurerJoueurDepuisRepos(nom); };',
        'cont.appendChild(chip);',
      '});',
    '}',
    'function restaurerJoueurDepuisRepos(nom){',
      'var zRepos = document.getElementById("zoneRepos");',
      'var pool = document.getElementById("zonePool");',
      'if(!zRepos || !pool) return;',
      'var el = Array.from(zRepos.children).find(function(card){ return card.getAttribute("data-nom") === nom; });',
      'if(el){',
        'pool.appendChild(el);',
        'majCompteurs();',
        'sauvegarderBrouillonLocal(false);',
        'if(MODE_TINDER) afficherCarteTinder();',
      '}',
    '}',
    'function rendreControlesTinder(nbEq){',
      'var c = document.getElementById("tControlsContainer");',
      'if(!c) return;',
      'var eq1 = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe1) || "Équipe 1";',
      'var eq2 = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe2) || "Équipe 2";',
      'var eq3 = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe3) || "Équipe 3";',
      'var html = \'<button type="button" class="tbtn-undo" title="Annuler le dernier choix" onclick="annulerDernierSwipe()">↩</button>\';',
      'if(nbEq === 1){',
        'html += \'<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBouton(\\\'OUT\\\')"><span>←</span>Repos</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1b" data-choix="1B" onclick="animerVoteBouton(\\\'1B\\\')"><span>→</span>\' + eq1 + \'</button>\';',
      '} else if(nbEq === 2){',
        'html += \'<button type="button" class="tbtn-circle tbtn-1b" data-choix="1B" onclick="animerVoteBouton(\\\'1B\\\')"><span>←</span>\' + eq1 + \'</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBouton(\\\'OUT\\\')"><span>↓</span>Repos</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1c" data-choix="1C" onclick="animerVoteBouton(\\\'1C\\\')"><span>→</span>\' + eq2 + \'</button>\';',
      '} else {',
        'html += \'<button type="button" class="tbtn-circle tbtn-1b" data-choix="1B" onclick="animerVoteBouton(\\\'1B\\\')"><span>↑</span>\' + eq1 + \'</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1c" data-choix="1C" onclick="animerVoteBouton(\\\'1C\\\')"><span>←</span>\' + eq2 + \'</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBouton(\\\'OUT\\\')"><span>↓</span>Repos</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1d" data-choix="1D" onclick="animerVoteBouton(\\\'1D\\\')"><span>→</span>\' + eq3 + \'</button>\';',
      '}',
      'html += \'<button type="button" class="tbtn-undo" title="Recommencer à zéro" onclick="recommencerSelection()">Réinit</button>\';',
      'c.innerHTML = html;',
    '}',
    'function appliquerDonneesRecues(data, conserverSelection){',
      'if(data.clubConfig){',
        'CLUB_CONFIG = data.clubConfig;',
        'var nbEq = Math.min(3, Math.max(1, CLUB_CONFIG.nbEquipes || 2));',
        'CLUB_CONFIG.nbEquipes = nbEq;',
        'appliquerVariablesCss(',
          'CLUB_CONFIG.couleurPrimaire,',
          'CLUB_CONFIG.couleurSecondaire,',
          'CLUB_CONFIG.couleurEquipe1 || CLUB_CONFIG.couleurPrimaire,',
          'CLUB_CONFIG.couleurEquipe2 || CLUB_CONFIG.couleurSecondaire,',
          'CLUB_CONFIG.couleurEquipe3 || "#10b981"',
        ');',
        'if(CLUB_CONFIG.nomClub){',
          'document.getElementById("homeClubName").textContent = CLUB_CONFIG.nomClub;',
          'document.getElementById("headerClubTitle").textContent = CLUB_CONFIG.nomClub + " - Compo Coach";',
        '}',
        'if(CLUB_CONFIG.nomEquipe1){',
          'document.getElementById("labelCol1B").textContent = CLUB_CONFIG.nomEquipe1;',
          'document.getElementById("labelTinder1B").textContent = CLUB_CONFIG.nomEquipe1;',
        '}',
        'if(CLUB_CONFIG.nomEquipe2){',
          'document.getElementById("labelCol1C").textContent = CLUB_CONFIG.nomEquipe2;',
          'document.getElementById("labelTinder1C").textContent = CLUB_CONFIG.nomEquipe2;',
        '}',
        'if(CLUB_CONFIG.nomEquipe3){',
          'var lCol3 = document.getElementById("labelCol1D"); if(lCol3) lCol3.textContent = CLUB_CONFIG.nomEquipe3;',
          'var lTind3 = document.getElementById("labelTinder1D"); if(lTind3) lTind3.textContent = CLUB_CONFIG.nomEquipe3;',
        '}',
        'var col1C = document.getElementById("colBox1C"), col1D = document.getElementById("colBox1D");',
        'var tBox1C = document.getElementById("tBox1C"), tBox1D = document.getElementById("tBox1D");',
        'if(nbEq === 1){',
          'if(col1C) col1C.style.display = "none"; if(col1D) col1D.style.display = "none";',
          'if(tBox1C) tBox1C.style.display = "none"; if(tBox1D) tBox1D.style.display = "none";',
        '} else if(nbEq === 2){',
          'if(col1C) col1C.style.display = "flex"; if(col1D) col1D.style.display = "none";',
          'if(tBox1C) tBox1C.style.display = "inline"; if(tBox1D) tBox1D.style.display = "none";',
        '} else {',
          'if(col1C) col1C.style.display = "flex"; if(col1D) col1D.style.display = "flex";',
          'if(tBox1C) tBox1C.style.display = "inline"; if(tBox1D) tBox1D.style.display = "inline";',
        '}',
        'rendreControlesTinder(nbEq);',
        'majOptionsEquipesSelects();',
      '}',
      'if(data.seancesTrain){',
        'SEANCES_TRAIN = data.seancesTrain;',
        'majLibellesOngletsTrain();',
      '}',
      'if(data.derniereCompo){',
        'DERNIERE_COMPO = data.derniereCompo;',
        'var btnPrec = document.getElementById("btnChargerCompoPrec");',
        'if(btnPrec){',
          'btnPrec.style.display = "inline-flex";',
          'if(DERNIERE_COMPO.date) btnPrec.title = "Charger la composition du " + DERNIERE_COMPO.date;',
        '}',
      '}',
      'JOUEURS = data.joueurs || []; EFFECTIF_COMPLET = data.effectif || []; ENTRAINEMENTS = data.entrainements || {};',
      'if(data.matchs){',
        'if(document.getElementById("sub1B")) document.getElementById("sub1B").textContent = data.matchs.label1B || "";',
        'if(document.getElementById("sub1C")) document.getElementById("sub1C").textContent = data.matchs.label1C || "";',
        'if(document.getElementById("sub1D")) document.getElementById("sub1D").textContent = data.matchs.label1D || "";',
      '}',
      'var deja1B = conserverSelection ? extraireListeNoms("zone1B") : [];',
      'var deja1C = (conserverSelection && document.getElementById("zone1C")) ? extraireListeNoms("zone1C") : [];',
      'var deja1D = (conserverSelection && document.getElementById("zone1D")) ? extraireListeNoms("zone1D") : [];',
      'var dejaRepos = (conserverSelection && document.getElementById("zoneRepos")) ? extraireListeNoms("zoneRepos") : [];',
      'var z1B = document.getElementById("zone1B"), z1C = document.getElementById("zone1C"), z1D = document.getElementById("zone1D"), zRepos = document.getElementById("zoneRepos");',
      'var pool = document.getElementById("zonePool");',
      'z1B.innerHTML = ""; if(z1C) z1C.innerHTML = ""; if(z1D) z1D.innerHTML = ""; if(zRepos) zRepos.innerHTML = ""; pool.innerHTML = "";',
      'JOUEURS.forEach(function(j){',
        'var c = creerCarte(j);',
        'if(deja1B.indexOf(j.nom) !== -1) z1B.appendChild(c);',
        'else if(deja1C.indexOf(j.nom) !== -1 && z1C) z1C.appendChild(c);',
        'else if(deja1D.indexOf(j.nom) !== -1 && z1D) z1D.appendChild(c);',
        'else if(dejaRepos.indexOf(j.nom) !== -1 && zRepos) zRepos.appendChild(c);',
        'else pool.appendChild(c);',
      '});',
      'majCompteurs();',
      'document.getElementById("statutChargement").textContent = JOUEURS.length + " disponible(s)";',
      'if(document.getElementById("btnSwitchMode").style.display !== "inline-block") document.getElementById("btnSwitchMode").style.display = "inline-block";',
      'if(data.covoiturage) COVOITURAGE_DATA = data.covoiturage;',
      'if(data.votesMvp) VOTES_MVP_DATA = data.votesMvp;',
      'if(data.absences) MES_ABSENCES = data.absences;',
      'if(data.matchs) INFOS_MATCHS = data.matchs;',
      'if(data.caisseNoire) CAISSE_NOIRE_DATA = data.caisseNoire;',
      'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
      'rendreRosterGrid(); majVueEntrainement();',
      'verifierBrouillonExistant();',
      'var bWa = document.getElementById("txtStatusWhatsApp");',
      'if(bWa) bWa.textContent = "🟢 WhatsApp Connecté • Synchronisé";',
      'masquerLoading();',
    '}',
    'function creerCarte(j){',
      'var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;',
      'var card = document.createElement("div"); card.className = "pcard"; card.setAttribute("data-nom", j.nom);',
      'card.onclick = function(e){',
        'if(card.parentNode && card.parentNode.id === "zoneRepos"){',
          'var pool = document.getElementById("zonePool");',
          'if(pool){',
            'pool.appendChild(card);',
            'majCompteurs();',
            'sauvegarderBrouillonLocal(false);',
            'if(MODE_TINDER) afficherCarteTinder();',
          '}',
        '}',
      '};',
      'var pleft = document.createElement("div"); pleft.className = "pleft";',
      'var pmini = document.createElement("div"); pmini.className = "pmini";',
      'var isChou = (CLUB_CONFIG && CLUB_CONFIG.chouchou && String(j.nom || "").trim().toLowerCase() === String(CLUB_CONFIG.chouchou).trim().toLowerCase());',
      'if(isChou) pmini.classList.add("is-chouchou");',
      'var initMini = (j.nom || "").trim().charAt(0).toUpperCase();',
      'if(j.photo){ var img = document.createElement("img"); img.src = j.photo; img.onerror = function(){ this.remove(); pmini.textContent = initMini; }; pmini.appendChild(img); }',
      'else { pmini.textContent = initMini; }',
      'pmini.style.cursor = "pointer"; pmini.title = "Fiche de " + j.nom; pmini.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); };',
      'pleft.appendChild(pmini);',
      'var pinfo = document.createElement("div");',
      'var pname = document.createElement("div"); pname.className = "pname"; pname.textContent = j.nom;',
      'if(isChou){ var cBadge = document.createElement("span"); cBadge.className = "chouchou-badge"; cBadge.textContent = "❤️ Chouchou"; pname.appendChild(cBadge); }',
      'if(j.renfort){ var rB = document.createElement("span"); rB.className = "badge-renfort"; rB.textContent = "Renfort"; pname.appendChild(rB); }',
      'pinfo.appendChild(pname);',
      'var pmeta = document.createElement("div"); pmeta.className = "pmeta"; pmeta.textContent = (j.poste || "Demi-Centre") + " • " + (j.entrainements || 0) + " tr";',
      'pinfo.appendChild(pmeta);',
      'if(j.note){ var pnote = document.createElement("div"); pnote.className = "pnote-sub"; pnote.textContent = "Note : " + j.note; pinfo.appendChild(pnote); }',
      'pleft.appendChild(pinfo); card.appendChild(pleft);',
      'var ptags = document.createElement("div"); ptags.className = "ptags";',
      'if(j.dispo1B){ var t1 = document.createElement("span"); t1.className = "tag tag-1b"; t1.textContent = CLUB_CONFIG.nomEquipe1 || "Éq 1"; ptags.appendChild(t1); }',
      'if(j.dispo1C && nbEq >= 2){ var t2 = document.createElement("span"); t2.className = "tag tag-1c"; t2.textContent = CLUB_CONFIG.nomEquipe2 || "Éq 2"; ptags.appendChild(t2); }',
      'if(j.dispo1D && nbEq >= 3){ var t3 = document.createElement("span"); t3.className = "tag tag-1d"; t3.textContent = CLUB_CONFIG.nomEquipe3 || "Éq 3"; ptags.appendChild(t3); }',
      'var bEdit = document.createElement("button"); bEdit.className = "btn-mini-edit"; bEdit.textContent = "Fiche"; bEdit.title = "Modifier la photo ou note";',
      'bEdit.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); };',
      'ptags.appendChild(bEdit); card.appendChild(ptags);',
      'return card;',
    '}',
    'function forcerActualisationWhatsApp(){',
      'document.getElementById("statutChargement").textContent = "Lecture WhatsApp...";',
      'google.script.run.withSuccessHandler(function(res){',
        'google.script.run.withSuccessHandler(function(data){ appliquerDonneesRecues(data, true); }).getDonneesCoach();',
      '}).declencherLectureVotes();',
    '}',
    'function choisirMode(isTinder){',
      'MODE_TINDER = !!isTinder;',
      'document.body.classList.toggle("tinder-mode-active", MODE_TINDER);',
      'var classic = document.getElementById("classicView");',
      'var tinder = document.getElementById("tinderView");',
      'var footer = document.getElementById("appFooter");',
      'if(classic){ classic.style.display = MODE_TINDER ? "none" : "grid"; if(!MODE_TINDER){ classic.classList.remove("view-animate-in"); void classic.offsetWidth; classic.classList.add("view-animate-in"); } }',
      'if(tinder){ tinder.style.display = MODE_TINDER ? "block" : "none"; if(MODE_TINDER){ tinder.classList.remove("view-animate-in"); void tinder.offsetWidth; tinder.classList.add("view-animate-in"); } }',
      'if(footer) footer.style.display = MODE_TINDER ? "none" : "flex";',
      'var tabC = document.getElementById("tabClassicMode");',
      'var tabT = document.getElementById("tabTinderMode");',
      'if(tabC) tabC.className = "view-mode-tab" + (MODE_TINDER ? "" : " active");',
      'if(tabT) tabT.className = "view-mode-tab" + (MODE_TINDER ? " active" : "");',
      'var btnSwitch = document.getElementById("btnSwitchMode");',
      'if(btnSwitch) btnSwitch.textContent = MODE_TINDER ? "Mode Tactique" : "Mode Tinder";',
      'if(MODE_TINDER) afficherCarteTinder();',
    '}',
    'function basculerMode(){ choisirMode(!MODE_TINDER); }',
    'function afficherCarteTinder(){',
      'var cont = document.getElementById("tinderContainer"); cont.innerHTML = "";',
      'var pool = document.getElementById("zonePool");',
      'if(!pool || pool.children.length === 0){',
        'cont.innerHTML = "<div style=\'padding:60px 20px;color:#a3a3a3;font-size:1.1rem;\'>Tous les joueurs ont été répartis !<br><br><small>Basculez en mode tactique pour affiner ou sauvegarder.</small></div>";',
        'majCompteurs(); return;',
      '}',
      'var premier = pool.children[0];',
      'var nom = premier.getAttribute("data-nom");',
      'var j = JOUEURS.find(function(x){ return x.nom === nom; }) || { nom: nom, poste: "Demi-Centre", entrainements: 0 };',
      'var topCard = creerCarteTinderHtml(j, true);',
      'cont.appendChild(topCard);',
      'if(pool.children.length > 1){',
        'var nom2 = pool.children[1].getAttribute("data-nom");',
        'var j2 = JOUEURS.find(function(x){ return x.nom === nom2; }) || { nom: nom2, poste: "Demi-Centre", entrainements: 0 };',
        'var nextCard = creerCarteTinderHtml(j2, false); nextCard.classList.add("tcard-next");',
        'cont.appendChild(nextCard);',
      '}',
      'attacherGestesTinder(topCard); majCompteurs();',
    '}',
    'function creerCarteTinderHtml(j, isTop){',
      'var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;',
      'var eq1 = ((CLUB_CONFIG && CLUB_CONFIG.nomEquipe1) || "ÉQUIPE 1").toUpperCase();',
      'var eq2 = ((CLUB_CONFIG && CLUB_CONFIG.nomEquipe2) || "ÉQUIPE 2").toUpperCase();',
      'var eq3 = ((CLUB_CONFIG && CLUB_CONFIG.nomEquipe3) || "ÉQUIPE 3").toUpperCase();',
      'var card = document.createElement("div"); card.className = "tcard" + (isTop ? " tcard-top" : "");',
      'card.setAttribute("data-nom", j.nom);',
      'var tInit = (j.nom || "").trim().charAt(0).toUpperCase();',
      'var av = document.createElement("div"); av.className = "tavatar"; av.textContent = tInit; av.style.cursor = "pointer"; av.title = "Fiche de " + j.nom; av.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); };',
      'if(j.photo){ var bg = document.createElement("img"); bg.className = "tbg-photo"; bg.src = j.photo; bg.onerror = function(){ this.remove(); if(av) av.style.display = "flex"; }; card.appendChild(bg); }',
      'var ov = document.createElement("div"); ov.className = "tbg-overlay"; card.appendChild(ov);',
      'function addStamp(clsPos, clsCol, txt){ var s = document.createElement("div"); s.className = "stamp " + clsPos + " " + clsCol; s.textContent = txt; card.appendChild(s); }',
      'if(nbEq === 1){',
        'addStamp("stamp-left", "stamp-out", "REPOS");',
        'addStamp("stamp-right", "stamp-1b", eq1);',
      '} else if(nbEq === 2){',
        'addStamp("stamp-left", "stamp-1b", eq1);',
        'addStamp("stamp-right", "stamp-1c", eq2);',
        'addStamp("stamp-down", "stamp-out", "REPOS");',
      '} else {',
        'addStamp("stamp-up", "stamp-1b", eq1);',
        'addStamp("stamp-left", "stamp-1c", eq2);',
        'addStamp("stamp-right", "stamp-1d", eq3);',
        'addStamp("stamp-down", "stamp-out", "REPOS");',
      '}',
      'var bEd = document.createElement("button"); bEd.className = "tbtn-edit-card"; bEd.textContent = "Fiche";',
      'bEd.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); }; card.appendChild(bEd);',
      'var tc = document.createElement("div"); tc.className = "tcontent";',
      'if(!j.photo){ tc.appendChild(av); }',
      'else { av.style.display = "none"; tc.appendChild(av); var sp = document.createElement("div"); sp.style.height = "20px"; tc.appendChild(sp); }',
      'var bot = document.createElement("div"); bot.style.width = "100%"; bot.style.display = "flex"; bot.style.flexDirection = "column"; bot.style.alignItems = "center"; bot.style.gap = "6px";',
      'var nomEl = document.createElement("div"); nomEl.style.fontSize = "1.5rem"; nomEl.style.fontWeight = "900"; nomEl.textContent = j.nom; bot.appendChild(nomEl);',
      'var postEl = document.createElement("div"); postEl.style.fontSize = "0.95rem"; postEl.style.color = "var(--color-secondary)"; postEl.style.fontWeight = "700"; postEl.textContent = j.poste || "Demi-Centre"; bot.appendChild(postEl);',
      'var tags = document.createElement("div"); tags.style.display = "flex"; tags.style.gap = "6px"; tags.style.margin = "4px 0";',
      'var sp1 = document.createElement("span"); sp1.className = j.dispo1B ? "tag tag-1b" : "tag"; sp1.textContent = (CLUB_CONFIG.nomEquipe1 || "Éq 1") + " " + (j.dispo1B ? "✓" : "✗"); tags.appendChild(sp1);',
      'if(nbEq >= 2){ var sp2 = document.createElement("span"); sp2.className = j.dispo1C ? "tag tag-1c" : "tag"; sp2.textContent = (CLUB_CONFIG.nomEquipe2 || "Éq 2") + " " + (j.dispo1C ? "✓" : "✗"); tags.appendChild(sp2); }',
      'if(nbEq >= 3){ var sp3 = document.createElement("span"); sp3.className = j.dispo1D ? "tag tag-1d" : "tag"; sp3.textContent = (CLUB_CONFIG.nomEquipe3 || "Éq 3") + " " + (j.dispo1D ? "✓" : "✗"); tags.appendChild(sp3); }',
      'bot.appendChild(tags);',
      'if(j.note){ var nt = document.createElement("div"); nt.className = "tnote-box"; nt.textContent = "Note : " + j.note; bot.appendChild(nt); }',
      'tc.appendChild(bot); card.appendChild(tc);',
      'return card;',
    '}',
    'function attacherGestesTinder(card){',
      'var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;',
      'var startX = 0, startY = 0, currentX = 0, currentY = 0, isDragging = false;',
      'var s1B = card.querySelector(".stamp-1b"), s1C = card.querySelector(".stamp-1c"), s1D = card.querySelector(".stamp-1d"), sOut = card.querySelector(".stamp-out");',
      'function resetStamps(){ if(s1B) s1B.style.opacity = 0; if(s1C) s1C.style.opacity = 0; if(s1D) s1D.style.opacity = 0; if(sOut) sOut.style.opacity = 0; }',
      'function onStart(e){ isDragging = true; startX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX; startY = e.type.includes("mouse") ? e.clientY : e.touches[0].clientY; card.classList.remove("tcard-spring"); }',
      'function onMove(e){',
        'if(!isDragging) return;',
        'var clientX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX;',
        'var clientY = e.type.includes("mouse") ? e.clientY : e.touches[0].clientY;',
        'currentX = clientX - startX; currentY = clientY - startY;',
        'var rot = currentX * 0.08;',
        'card.style.transform = "translate3d(" + currentX + "px," + currentY + "px,0) rotate(" + rot + "deg)";',
        'resetStamps();',
        'if(nbEq === 1){',
          'if(currentX < -20 && sOut) sOut.style.opacity = Math.min(1, Math.abs(currentX) / 95);',
          'else if(currentX > 20 && s1B) s1B.style.opacity = Math.min(1, currentX / 95);',
        '} else if(nbEq === 2){',
          'if(currentY > 40 && Math.abs(currentY) > Math.abs(currentX)){ if(sOut) sOut.style.opacity = Math.min(1, currentY / 95); }',
          'else if(currentX < -20 && s1B){ s1B.style.opacity = Math.min(1, Math.abs(currentX) / 95); }',
          'else if(currentX > 20 && s1C){ s1C.style.opacity = Math.min(1, currentX / 95); }',
        '} else {',
          'if(currentY < -30 && Math.abs(currentY) > Math.abs(currentX)){ if(s1B) s1B.style.opacity = Math.min(1, Math.abs(currentY) / 95); }',
          'else if(currentY > 30 && Math.abs(currentY) > Math.abs(currentX)){ if(sOut) sOut.style.opacity = Math.min(1, currentY / 95); }',
          'else if(currentX < -20 && s1C){ s1C.style.opacity = Math.min(1, Math.abs(currentX) / 95); }',
          'else if(currentX > 20 && s1D){ s1D.style.opacity = Math.min(1, currentX / 95); }',
        '}',
      '}',
      'function onEnd(){',
        'if(!isDragging) return; isDragging = false;',
        'var dest = null;',
        'if(nbEq === 1){',
          'if(currentX < -90) dest = "OUT";',
          'else if(currentX > 90) dest = "1B";',
        '} else if(nbEq === 2){',
          'if(currentY > 90 && Math.abs(currentY) > Math.abs(currentX)) dest = "OUT";',
          'else if(currentX < -90 && Math.abs(currentX) > Math.abs(currentY)) dest = "1B";',
          'else if(currentX > 90 && Math.abs(currentX) > Math.abs(currentY)) dest = "1C";',
        '} else {',
          'if(currentY < -90 && Math.abs(currentY) > Math.abs(currentX)) dest = "1B";',
          'else if(currentY > 90 && Math.abs(currentY) > Math.abs(currentX)) dest = "OUT";',
          'else if(currentX < -90 && Math.abs(currentX) > Math.abs(currentY)) dest = "1C";',
          'else if(currentX > 90 && Math.abs(currentX) > Math.abs(currentY)) dest = "1D";',
        '}',
        'if(dest) ejecterCarte(card, dest);',
        'else { card.classList.add("tcard-spring"); card.style.transform = "translate3d(0px,0px,0) rotate(0deg)"; resetStamps(); }',
      '}',
      'card.addEventListener("mousedown", onStart); window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onEnd);',
      'card.addEventListener("touchstart", onStart, { passive: true }); window.addEventListener("touchmove", onMove, { passive: true }); window.addEventListener("touchend", onEnd);',
    '}',
    'function swiperVers(choix){',
      'if(ANIM_EN_COURS) return;',
      'var topCard = document.querySelector("#tinderContainer .tcard-top");',
      'if(!topCard) return;',
      'var s = topCard.querySelector(".stamp-" + choix.toLowerCase());',
      'if(s) s.style.opacity = 1;',
      'ejecterCarte(topCard, choix);',
    '}',
    'function ejecterCarte(card, choix){',
      'ANIM_EN_COURS = true; card.classList.add("tcard-fly");',
      'var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;',
      'if(nbEq === 1){',
        'if(choix === "OUT") card.style.transform = "translate3d(-460px, 20px, 0) rotate(-28deg)";',
        'else if(choix === "1B") card.style.transform = "translate3d(460px, 20px, 0) rotate(28deg)";',
      '} else if(nbEq === 2){',
        'if(choix === "1B") card.style.transform = "translate3d(-460px, 20px, 0) rotate(-28deg)";',
        'else if(choix === "1C") card.style.transform = "translate3d(460px, 20px, 0) rotate(28deg)";',
        'else if(choix === "OUT") card.style.transform = "translate3d(0, 460px, 0) rotate(6deg)";',
      '} else {',
        'if(choix === "1B") card.style.transform = "translate3d(0, -460px, 0) rotate(6deg)";',
        'else if(choix === "1C") card.style.transform = "translate3d(-460px, 20px, 0) rotate(-28deg)";',
        'else if(choix === "1D") card.style.transform = "translate3d(460px, 20px, 0) rotate(28deg)";',
        'else if(choix === "OUT") card.style.transform = "translate3d(0, 460px, 0) rotate(6deg)";',
      '}',
      'setTimeout(function(){',
        'var nom = card.getAttribute("data-nom");',
        'var pool = document.getElementById("zonePool");',
        'var el = Array.from(pool.children).find(function(c){ return c.getAttribute("data-nom") === nom; });',
        'if(el){',
          'HISTORIQUE_SWIPE.push({ element: el, nom: nom, choix: choix });',
          'if(choix === "1B") document.getElementById("zone1B").appendChild(el);',
          'else if(choix === "1C" && document.getElementById("zone1C")) document.getElementById("zone1C").appendChild(el);',
          'else if(choix === "1D" && document.getElementById("zone1D")) document.getElementById("zone1D").appendChild(el);',
          'else if(choix === "OUT"){',
            'var zR = document.getElementById("zoneRepos");',
            'if(zR) zR.appendChild(el); else pool.removeChild(el);',
          '} else pool.removeChild(el);',
          'if(choix === "1B" || choix === "1C" || choix === "1D") verifierChouchouSelectionne(nom);',
        '}',
        'ANIM_EN_COURS = false;',
        'majCompteurs();',
        'sauvegarderBrouillonLocal(false);',
        'afficherCarteTinder();',
      '}, 240);',
    '}',
    'function annulerDernierSwipe(){',
      'if(!HISTORIQUE_SWIPE.length) return;',
      'var dernier = HISTORIQUE_SWIPE.pop();',
      'var pool = document.getElementById("zonePool");',
      'if(dernier.element && dernier.element.parentNode){',
        'dernier.element.parentNode.removeChild(dernier.element);',
      '}',
      'pool.insertBefore(dernier.element, pool.firstChild);',
      'majCompteurs();',
      'sauvegarderBrouillonLocal(false);',
      'afficherCarteTinder();',
    '}',
    'function recommencerSelection(){',
      'document.getElementById("zone1B").innerHTML = "";',
      'if(document.getElementById("zone1C")) document.getElementById("zone1C").innerHTML = "";',
      'if(document.getElementById("zone1D")) document.getElementById("zone1D").innerHTML = "";',
      'if(document.getElementById("zoneRepos")) document.getElementById("zoneRepos").innerHTML = "";',
      'var pool = document.getElementById("zonePool"); pool.innerHTML = "";',
      'JOUEURS.forEach(function(j){ pool.appendChild(creerCarte(j)); });',
      'HISTORIQUE_SWIPE = [];',
      'majCompteurs();',
      'sauvegarderBrouillonLocal(false);',
      'if(MODE_TINDER) afficherCarteTinder();',
    '}',
    'function extraireListeNoms(zoneId){ var el = document.getElementById(zoneId); return el ? Array.from(el.children).map(function(c){ return c.getAttribute("data-nom"); }) : []; }',
    'function sauvegarderBrouillonLocal(explicite){',
      'var draft = {',
        'date: new Date().toISOString(),',
        'equipe1B: extraireListeNoms("zone1B"),',
        'equipe1C: document.getElementById("zone1C") ? extraireListeNoms("zone1C") : [],',
        'equipe1D: document.getElementById("zone1D") ? extraireListeNoms("zone1D") : [],',
        'repos: document.getElementById("zoneRepos") ? extraireListeNoms("zoneRepos") : []',
      '};',
      'try { localStorage.setItem("hb_draft_compo", JSON.stringify(draft)); } catch(e){}',
      'if(explicite){',
        'document.getElementById("statutChargement").textContent = "Brouillon sauvegardé !";',
        'google.script.run.enregistrerBrouillonCompo(draft);',
        'var ban = document.getElementById("banniereBrouillon"); if(ban) ban.style.display = "none";',
        'setTimeout(function(){ document.getElementById("statutChargement").textContent = "Prêt"; }, 2000);',
      '}',
    '}',
    'function verifierBrouillonExistant(){',
      'try {',
        'var raw = localStorage.getItem("hb_draft_compo"); if(!raw) return;',
        'var d = JSON.parse(raw);',
        'var totalAffectes = (d.equipe1B ? d.equipe1B.length : 0) + (d.equipe1C ? d.equipe1C.length : 0) + (d.equipe1D ? d.equipe1D.length : 0) + (d.repos ? d.repos.length : 0);',
        'var ban = document.getElementById("banniereBrouillon");',
        'var txt = document.getElementById("txtBanniereBrouillon");',
        'if(totalAffectes > 0 && ban && txt){',
          'var nCourant = extraireListeNoms("zone1B").length + extraireListeNoms("zone1C").length + extraireListeNoms("zone1D").length + extraireListeNoms("zoneRepos").length;',
          'if(nCourant === 0){',
            'txt.textContent = "Un brouillon a été retrouvé (" + totalAffectes + " joueur(s) affecté(s)).";',
            'ban.style.display = "flex";',
          '}',
        '}',
      '} catch(e){}',
    '}',
    'function restaurerBrouillon(){',
      'try {',
        'var raw = localStorage.getItem("hb_draft_compo"); if(!raw) return;',
        'var d = JSON.parse(raw);',
        'appliquerRepartitionsCompo(d);',
        'var ban = document.getElementById("banniereBrouillon"); if(ban) ban.style.display = "none";',
        'document.getElementById("statutChargement").textContent = "Brouillon restauré !";',
      '} catch(e){',
        'afficherToast("Impossible de restaurer le brouillon : " + e.message, "erreur");',
      '}',
    '}',
    'function effacerBrouillon(){',
      'try { localStorage.removeItem("hb_draft_compo"); } catch(e){}',
      'var ban = document.getElementById("banniereBrouillon"); if(ban) ban.style.display = "none";',
    '}',
    'function rechargerCompoPrecedente(){',
      'if(!DERNIERE_COMPO){ afficherToast("Aucune composition précédente enregistrée.", "info"); return; }',
      'var dateStr = DERNIERE_COMPO.date ? (" du " + DERNIERE_COMPO.date) : "";',
      'if(!confirm("Recharger la composition précédente" + dateStr + " ?")) return;',
      'appliquerRepartitionsCompo(DERNIERE_COMPO);',
      'document.getElementById("statutChargement").textContent = "Compo précédente rechargée !";',
    '}',
    'function appliquerRepartitionsCompo(source){',
      'if(!source) return;',
      'var z1B = document.getElementById("zone1B"), z1C = document.getElementById("zone1C"), z1D = document.getElementById("zone1D"), zRepos = document.getElementById("zoneRepos"), pool = document.getElementById("zonePool");',
      'z1B.innerHTML = ""; if(z1C) z1C.innerHTML = ""; if(z1D) z1D.innerHTML = ""; if(zRepos) zRepos.innerHTML = ""; pool.innerHTML = "";',
      'var mapCartes = {};',
      'JOUEURS.forEach(function(j){ mapCartes[j.nom] = creerCarte(j); });',
      'var list1B = source.equipe1B || [], list1C = source.equipe1C || [], list1D = source.equipe1D || [], listRepos = source.repos || [];',
      'list1B.forEach(function(nom){ if(mapCartes[nom]){ z1B.appendChild(mapCartes[nom]); delete mapCartes[nom]; } });',
      'if(z1C){ list1C.forEach(function(nom){ if(mapCartes[nom]){ z1C.appendChild(mapCartes[nom]); delete mapCartes[nom]; } }); }',
      'if(z1D){ list1D.forEach(function(nom){ if(mapCartes[nom]){ z1D.appendChild(mapCartes[nom]); delete mapCartes[nom]; } }); }',
      'if(zRepos){ listRepos.forEach(function(nom){ if(mapCartes[nom]){ zRepos.appendChild(mapCartes[nom]); delete mapCartes[nom]; } }); }',
      'Object.keys(mapCartes).forEach(function(nom){ pool.appendChild(mapCartes[nom]); });',
      'majCompteurs();',
      'sauvegarderBrouillonLocal(false);',
      'if(MODE_TINDER) afficherCarteTinder();',
    '}',
    'function classifierPosteHandball(p){',
      'var str = String(p || "").toLowerCase().replace(/[^a-z]/g, "");',
      'if(str.indexOf("gard") !== -1 || str === "gb") return "GB";',
      'if(str.indexOf("piv") !== -1 || str === "pvt") return "PVT";',
      'if((str.indexOf("ail") !== -1 && str.indexOf("g") !== -1) || str === "alg") return "ALG";',
      'if((str.indexOf("ail") !== -1 && str.indexOf("d") !== -1) || str === "ald") return "ALD";',
      'if((str.indexOf("arr") !== -1 && str.indexOf("g") !== -1) || str === "arg") return "ARG";',
      'if((str.indexOf("arr") !== -1 && str.indexOf("d") !== -1) || str === "ard") return "ARD";',
      'if(str.indexOf("demi") !== -1 || str === "dc" || str.indexOf("centre") !== -1) return "DC";',
      'return "DC";',
    '}',
    'function initialiserTactiquePourEquipe(eqKey, listeNoms){',
      'if(!COMPOSITIONS_TACTIQUES[eqKey]) COMPOSITIONS_TACTIQUES[eqKey] = {};',
      'var compoT = COMPOSITIONS_TACTIQUES[eqKey];',
      'var dispoObjs = listeNoms.map(function(nom){',
        'return EFFECTIF_COMPLET.find(function(x){ return x.nom === nom; }) || JOUEURS.find(function(x){ return x.nom === nom; }) || { nom: nom, poste: "Demi-Centre" };',
      '});',
      'var assignes = {}, prisNoms = {};',
      'POSITIONS_HANDBALL.forEach(function(pos){',
        'var nomEx = compoT[pos.code];',
        'if(nomEx && listeNoms.indexOf(nomEx) !== -1){ assignes[pos.code] = nomEx; prisNoms[nomEx] = true; }',
      '});',
      'POSITIONS_HANDBALL.forEach(function(pos){',
        'if(!assignes[pos.code]){',
          'var cand = dispoObjs.find(function(j){ return !prisNoms[j.nom] && classifierPosteHandball(j.poste) === pos.code; });',
          'if(cand){ assignes[pos.code] = cand.nom; prisNoms[cand.nom] = true; }',
        '}',
      '});',
      'POSITIONS_HANDBALL.forEach(function(pos){',
        'if(!assignes[pos.code]){',
          'var cand = dispoObjs.find(function(j){ return !prisNoms[j.nom]; });',
          'if(cand){ assignes[pos.code] = cand.nom; prisNoms[cand.nom] = true; }',
        '}',
      '});',
      'COMPOSITIONS_TACTIQUES[eqKey] = assignes;',
    '}',
    'function rendreTabsTactique(){',
      'var c = document.getElementById("tacticalTeamTabs"); if(!c) return; c.innerHTML = "";',
      'var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;',
      'var eqDefs = [{ key: "1B", label: CLUB_CONFIG.nomEquipe1 || "Équipe 1" }];',
      'if(nbEq >= 2) eqDefs.push({ key: "1C", label: CLUB_CONFIG.nomEquipe2 || "Équipe 2" });',
      'if(nbEq >= 3) eqDefs.push({ key: "1D", label: CLUB_CONFIG.nomEquipe3 || "Équipe 3" });',
      'eqDefs.forEach(function(eq){',
        'var tab = document.createElement("button"); tab.type = "button";',
        'tab.className = "tactical-team-tab" + (eq.key === EQUIPE_TACTIQUE_COURANTE ? " active" : "");',
        'tab.textContent = eq.label;',
        'tab.onclick = function(){ EQUIPE_TACTIQUE_COURANTE = eq.key; rendreTabsTactique(); afficherApercuTactique(eq.key); };',
        'c.appendChild(tab);',
      '});',
    '}',
    'var TACTICAL_DRAGGED = null;',
    'var TACTICAL_SELECTED = null;',
    'function mettreAJourHintTactique(eqKey){',
      'var hintEl = document.getElementById("tacticalSwapHint"); if(!hintEl) return;',
      'if(TACTICAL_SELECTED){',
        'var label = TACTICAL_SELECTED.nom || TACTICAL_SELECTED.posCode;',
        'hintEl.innerHTML = "<span style=\'color:#38bdf8;font-weight:800;\'>👉 " + label + " sélectionné — touchez/cliquez sur un autre poste ou remplaçant pour échanger (ou re-cliquez pour annuler).</span>";',
      '} else {',
        'hintEl.innerHTML = "<span style=\'color:#94a3b8;font-weight:500;\'>Astuce : Glissez-déposez ou cliquez sur deux joueurs pour échanger leurs postes.</span>";',
      '}',
    '}',
    'function surlignerSelectionTactique(){',
      'document.querySelectorAll(".court-player-chip").forEach(function(el){ el.classList.remove("tactical-selected"); });',
      'document.querySelectorAll(".bench-chip").forEach(function(el){ el.classList.remove("tactical-selected"); });',
      'if(!TACTICAL_SELECTED) return;',
      'if(TACTICAL_SELECTED.source === "court"){',
        'var node = document.querySelector(\'.court-node[data-pos="\' + TACTICAL_SELECTED.posCode + \'"] .court-player-chip\');',
        'if(node) node.classList.add("tactical-selected");',
      '} else if(TACTICAL_SELECTED.source === "bench"){',
        'document.querySelectorAll(".bench-chip").forEach(function(b){',
          'if(b.getAttribute("data-nom") === TACTICAL_SELECTED.nom) b.classList.add("tactical-selected");',
        '});',
      '}',
    '}',
    'function executerPermutationTactique(eqKey, itemA, itemB){',
      'if(!COMPOSITIONS_TACTIQUES[eqKey]) COMPOSITIONS_TACTIQUES[eqKey] = {};',
      'var compoT = COMPOSITIONS_TACTIQUES[eqKey];',
      'if(itemA.source === "court" && itemB.source === "court"){',
        'var pA = compoT[itemA.posCode]; var pB = compoT[itemB.posCode];',
        'compoT[itemA.posCode] = pB; compoT[itemB.posCode] = pA;',
        'afficherToast("Permuté : " + (pA || itemA.posCode) + " ⇄ " + (pB || itemB.posCode), "succes", 1800);',
      '} else if(itemA.source === "court" && itemB.source === "bench"){',
        'var oldC = compoT[itemA.posCode]; compoT[itemA.posCode] = itemB.nom;',
        'afficherToast(itemB.nom + " placé en " + itemA.posCode + (oldC ? " (remplace " + oldC + ")" : ""), "succes", 1800);',
      '} else if(itemA.source === "bench" && itemB.source === "court"){',
        'var oldC = compoT[itemB.posCode]; compoT[itemB.posCode] = itemA.nom;',
        'afficherToast(itemA.nom + " placé en " + itemB.posCode + (oldC ? " (remplace " + oldC + ")" : ""), "succes", 1800);',
      '} else if(itemA.source === "bench" && itemB.source === "bench"){',
        'return;',
      '}',
      'if(itemA && itemA.nom) verifierChouchouSelectionne(itemA.nom);',
      'if(itemB && itemB.nom) verifierChouchouSelectionne(itemB.nom);',
      'TACTICAL_SELECTED = null;',
      'afficherApercuTactique(eqKey);',
    '}',
    'function gererClicTactique(eqKey, item){',
      'if(item && item.nom) verifierChouchouSelectionne(item.nom);',
      'if(!TACTICAL_SELECTED){',
        'TACTICAL_SELECTED = item;',
        'mettreAJourHintTactique(eqKey);',
        'surlignerSelectionTactique();',
      '} else {',
        'var meme = false;',
        'if(TACTICAL_SELECTED.source === item.source){',
          'if(item.source === "court" && TACTICAL_SELECTED.posCode === item.posCode) meme = true;',
          'if(item.source === "bench" && TACTICAL_SELECTED.nom === item.nom) meme = true;',
        '}',
        'if(meme){',
          'TACTICAL_SELECTED = null;',
          'mettreAJourHintTactique(eqKey);',
          'surlignerSelectionTactique();',
        '} else {',
          'var premier = TACTICAL_SELECTED;',
          'TACTICAL_SELECTED = null;',
          'executerPermutationTactique(eqKey, premier, item);',
        '}',
      '}',
    '}',
    'function afficherApercuTactique(eqKey){',
      'var zoneId = "zone" + eqKey; var listeNoms = extraireListeNoms(zoneId);',
      'if(!listeNoms || listeNoms.length === 0){',
        'if(CONTEXTE_APERCU && CONTEXTE_APERCU.compo && Array.isArray(CONTEXTE_APERCU.compo["equipe" + eqKey]) && CONTEXTE_APERCU.compo["equipe" + eqKey].length > 0){',
          'listeNoms = CONTEXTE_APERCU.compo["equipe" + eqKey];',
        '} else if(DERNIERE_COMPO && Array.isArray(DERNIERE_COMPO["equipe" + eqKey]) && DERNIERE_COMPO["equipe" + eqKey].length > 0){',
          'listeNoms = DERNIERE_COMPO["equipe" + eqKey];',
        '}',
      '}',
      'if(!listeNoms) listeNoms = [];',
      'initialiserTactiquePourEquipe(eqKey, listeNoms);',
      'var compoT = COMPOSITIONS_TACTIQUES[eqKey] || {};',
      'var nodesCont = document.getElementById("tacticalCourtNodes");',
      'mettreAJourHintTactique(eqKey);',
      'if(nodesCont){',
        'nodesCont.innerHTML = "";',
        'POSITIONS_HANDBALL.forEach(function(pos){',
          'var nomJ = compoT[pos.code];',
          'var jObj = nomJ ? (EFFECTIF_COMPLET.find(function(x){ return x.nom === nomJ; }) || { nom: nomJ }) : null;',
          'var node = document.createElement("div"); node.className = "court-node";',
          'node.style.left = pos.x + "%"; node.style.top = pos.y + "%"; node.setAttribute("data-pos", pos.code);',
          'var chip = document.createElement("div"); chip.className = "court-player-chip" + (jObj ? " filled" : " empty");',
          'chip.title = pos.label + " : " + (jObj ? jObj.nom : "Poste vacant");',
          'chip.draggable = true;',
          'chip.ondragstart = function(e){ TACTICAL_DRAGGED = { source: "court", posCode: pos.code, nom: nomJ, eqKey: eqKey }; chip.classList.add("tactical-dragging"); e.dataTransfer.setData("text/plain", pos.code); };',
          'chip.ondragend = function(e){ chip.classList.remove("tactical-dragging"); TACTICAL_DRAGGED = null; };',
          'node.ondragover = function(e){ e.preventDefault(); e.dataTransfer.dropEffect = "move"; };',
          'node.ondragenter = function(e){ e.preventDefault(); node.classList.add("tactical-drop-hover"); };',
          'node.ondragleave = function(e){ node.classList.remove("tactical-drop-hover"); };',
          'node.ondrop = function(e){',
            'e.preventDefault(); node.classList.remove("tactical-drop-hover");',
            'if(!TACTICAL_DRAGGED) return;',
            'var d = TACTICAL_DRAGGED; TACTICAL_DRAGGED = null;',
            'if(d.source === "court" && d.posCode === pos.code) return;',
            'executerPermutationTactique(eqKey, d, { source: "court", posCode: pos.code, nom: nomJ });',
          '};',
          'var av = document.createElement("div"); av.className = "court-player-avatar";',
          'if(jObj && CLUB_CONFIG && CLUB_CONFIG.chouchou && String(jObj.nom || "").trim().toLowerCase() === String(CLUB_CONFIG.chouchou).trim().toLowerCase()){ av.classList.add("is-chouchou"); }',
          'var initLtr = jObj ? (jObj.nom || "").trim().charAt(0).toUpperCase() : "-";',
          'if(jObj && jObj.photo){',
            'var img = document.createElement("img"); img.src = jObj.photo; img.alt = jObj.nom;',
            'img.onerror = function(){ this.remove(); av.textContent = initLtr; };',
            'av.appendChild(img);',
          '} else {',
            'av.textContent = initLtr;',
          '}',
          'if(jObj && jObj.nom){ av.style.cursor = "pointer"; av.title = "Fiche de " + jObj.nom; av.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(jObj.nom); }; }',
          'chip.appendChild(av);',
          'var lbl = document.createElement("div"); lbl.className = "court-pos-label"; lbl.textContent = pos.code; chip.appendChild(lbl);',
          'var nameEl = document.createElement("div"); nameEl.className = "court-player-name"; nameEl.textContent = jObj ? jObj.nom : pos.label; chip.appendChild(nameEl);',
          'chip.onclick = function(e){ e.stopPropagation(); gererClicTactique(eqKey, { source: "court", posCode: pos.code, nom: nomJ }); };',
          'node.appendChild(chip); nodesCont.appendChild(node);',
        '});',
      '}',
      'var benchCont = document.getElementById("tacticalBenchList");',
      'var benchWrap = document.querySelector(".tactical-bench-wrap");',
      'if(benchWrap){',
        'benchWrap.ondragover = function(e){ e.preventDefault(); };',
        'benchWrap.ondrop = function(e){',
          'e.preventDefault();',
          'if(!TACTICAL_DRAGGED || TACTICAL_DRAGGED.source !== "court") return;',
          'var d = TACTICAL_DRAGGED; TACTICAL_DRAGGED = null;',
          'var courtNom = compoT[d.posCode]; delete compoT[d.posCode];',
          'afficherToast(courtNom + " envoyé sur le banc.", "info", 1800);',
          'afficherApercuTactique(eqKey);',
        '};',
      '}',
      'if(benchCont){',
        'benchCont.innerHTML = "";',
        'var surTerrainNoms = Object.values(compoT);',
        'var remps = listeNoms.filter(function(n){ return surTerrainNoms.indexOf(n) === -1; });',
        'if(remps.length === 0){ benchCont.innerHTML = "<span style=\'font-size:0.75rem;color:#64748b;font-style:italic;\'>Aucun remplaçant (tous sur le terrain).</span>"; }',
        'else {',
          'remps.forEach(function(nom){',
            'var jObj = EFFECTIF_COMPLET.find(function(x){ return x.nom === nom; }) || { nom: nom, poste: "Demi-Centre" };',
            'var bChip = document.createElement("span"); bChip.className = "bench-chip";',
            'bChip.setAttribute("data-nom", nom);',
            'bChip.draggable = true;',
            'bChip.ondragstart = function(e){ TACTICAL_DRAGGED = { source: "bench", nom: nom, eqKey: eqKey }; bChip.classList.add("tactical-dragging"); e.dataTransfer.setData("text/plain", nom); };',
            'bChip.ondragend = function(e){ bChip.classList.remove("tactical-dragging"); TACTICAL_DRAGGED = null; };',
            'bChip.ondragover = function(e){ e.preventDefault(); e.dataTransfer.dropEffect = "move"; };',
            'bChip.ondragenter = function(e){ e.preventDefault(); bChip.classList.add("tactical-drop-hover"); };',
            'bChip.ondragleave = function(e){ bChip.classList.remove("tactical-drop-hover"); };',
            'bChip.ondrop = function(e){',
              'e.preventDefault(); e.stopPropagation(); bChip.classList.remove("tactical-drop-hover");',
              'if(!TACTICAL_DRAGGED) return;',
              'var d = TACTICAL_DRAGGED; TACTICAL_DRAGGED = null;',
              'if(d.source === "bench" && d.nom === nom) return;',
              'executerPermutationTactique(eqKey, d, { source: "bench", nom: nom });',
            '};',
            'var chouMark = (CLUB_CONFIG && CLUB_CONFIG.chouchou && String(jObj.nom || "").trim().toLowerCase() === String(CLUB_CONFIG.chouchou).trim().toLowerCase()) ? "❤️ " : "";',
            'bChip.textContent = chouMark + jObj.nom + " (" + (jObj.poste || "Demi-Centre") + ")";',
            'bChip.title = "Glissez ou cliquez pour placer " + jObj.nom + " sur le terrain";',
            'bChip.onclick = function(e){ e.stopPropagation(); gererClicTactique(eqKey, { source: "bench", nom: jObj.nom }); };',
            'benchCont.appendChild(bChip);',
          '});',
        '}',
      '}',
      'surlignerSelectionTactique();',
    '}',
    'function ajusterAffichageNombreSeances(){',
    '  var sel = document.getElementById("cfgNbSeancesTrain");',
    '  var nb = sel ? parseInt(sel.value, 10) : 3;',
    '  if(isNaN(nb) || nb < 1) nb = 1;',
    '  if(nb > 5) nb = 5;',
    '  for(var i = 1; i <= 5; i++){',
    '    var box = document.getElementById("boxCfgTrain" + i);',
    '    if(box) box.style.display = (i <= nb) ? "block" : "none";',
    '  }',
    '}',
    'function ouvrirModalConfigEntrainements(){',
    '  var nb = (SEANCES_TRAIN && SEANCES_TRAIN.length) ? SEANCES_TRAIN.length : 3;',
    '  if(nb < 1) nb = 1;',
    '  if(nb > 5) nb = 5;',
    '  var sel = document.getElementById("cfgNbSeancesTrain");',
    '  if(sel) sel.value = String(nb);',
    '  var defJours = ["Lundi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];',
    '  var defHoraires = ["20h30", "20h30", "20h30", "20h00", "10h00"];',
    '  for(var i = 1; i <= 5; i++){',
    '    var s = (SEANCES_TRAIN && SEANCES_TRAIN[i - 1]) ? SEANCES_TRAIN[i - 1] : null;',
    '    var jInp = document.getElementById("cfgTrJour" + i);',
    '    var hInp = document.getElementById("cfgTrHoraire" + i);',
    '    var aInp = document.getElementById("cfgTrActif" + i);',
    '    var jVal = s ? (s.jour || defJours[i - 1]) : defJours[i - 1];',
    '    if(jInp) {',
    '      var found = false;',
    '      for(var oi = 0; oi < jInp.options.length; oi++){',
    '        if(jInp.options[oi].value.toLowerCase() === String(jVal || "").trim().toLowerCase()){',
    '          jInp.selectedIndex = oi;',
    '          found = true;',
    '          break;',
    '        }',
    '      }',
    '      if(!found && jVal) {',
    '        var opt = document.createElement("option");',
    '        opt.value = jVal;',
    '        opt.textContent = jVal;',
    '        opt.selected = true;',
    '        jInp.appendChild(opt);',
    '      }',
    '    }',
    '    if(hInp) hInp.value = s ? (s.horaire || defHoraires[i - 1]) : defHoraires[i - 1];',
    '    if(aInp) aInp.checked = s ? (s.actif !== false) : (i <= 2);',
    '  }',
    '  ajusterAffichageNombreSeances();',
    '  document.getElementById("statusConfigEntrainements").textContent = "";',
    '  document.getElementById("modalConfigEntrainementsBg").style.display = "flex";',
    '}',
    'function fermerModalConfigEntrainements(){ document.getElementById("modalConfigEntrainementsBg").style.display = "none"; }',
    'function fermerModalConfigEntrainementsSurBg(e){ if(e.target.id === "modalConfigEntrainementsBg") fermerModalConfigEntrainements(); }',
    'function sauvegarderConfigEntrainements(){',
    '  var sel = document.getElementById("cfgNbSeancesTrain");',
    '  var nb = sel ? parseInt(sel.value, 10) : 3;',
    '  if(isNaN(nb) || nb < 1) nb = 1;',
    '  if(nb > 5) nb = 5;',
    '  var creneaux = [];',
    '  var mapJourId = {',
    '    "lundi": "lun", "mardi": "mar", "mercredi": "mer",',
    '    "jeudi": "jeu", "vendredi": "ven", "samedi": "sam", "dimanche": "dim"',
    '  };',
    '  for(var i = 1; i <= nb; i++){',
    '    var jVal = (document.getElementById("cfgTrJour" + i) && document.getElementById("cfgTrJour" + i).value.trim()) || ("Séance " + i);',
    '    var hVal = (document.getElementById("cfgTrHoraire" + i) && document.getElementById("cfgTrHoraire" + i).value.trim()) || "20h30";',
    '    var aVal = document.getElementById("cfgTrActif" + i) ? document.getElementById("cfgTrActif" + i).checked : true;',
    '    var baseId = mapJourId[jVal.toLowerCase()] || ("s" + i);',
    '    var idVal = baseId;',
    '    if(creneaux.some(function(c){ return c.id === idVal; })){',
    '      idVal = baseId + "_" + i;',
    '    }',
    '    var labelVal = "Entraînement " + jVal + " " + hVal;',
    '    creneaux.push({ id: idVal, jour: jVal, horaire: hVal, label: labelVal, actif: aVal });',
    '  }',
    '  document.getElementById("statusConfigEntrainements").textContent = "Enregistrement des " + nb + " séances...";',
    '  document.getElementById("btnSaveConfigTrain").disabled = true;',
    '  google.script.run.withSuccessHandler(function(res){',
    '    document.getElementById("btnSaveConfigTrain").disabled = false;',
    '    document.getElementById("statusConfigEntrainements").textContent = "Horaires enregistrés avec succès !";',
    '    SEANCES_TRAIN = creneaux;',
    '    majLibellesOngletsTrain();',
    '    majVueEntrainement();',
    '    if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });',
    '    setTimeout(function(){ fermerModalConfigEntrainements(); }, 800);',
    '  }).withFailureHandler(function(err){',
    '    document.getElementById("btnSaveConfigTrain").disabled = false;',
    '    document.getElementById("statusConfigEntrainements").textContent = "Erreur : " + err.message;',
    '  }).enregistrerConfigEntrainements(SESSION_TEL, SESSION_PIN, creneaux, nb);',
    '}',
    'function rendreOngletsTrain(){',
    '  var cont = document.getElementById("trainTabsContainer");',
    '  if(!cont) return;',
    '  cont.innerHTML = "";',
    '  if(!SEANCES_TRAIN || !SEANCES_TRAIN.length){',
    '    SEANCES_TRAIN = [',
    '      { id: "lun", jour: "Lundi", horaire: "20h30", label: "Lundi 20h30", actif: true },',
    '      { id: "mer", jour: "Mercredi", horaire: "20h30", label: "Mercredi 20h30", actif: true },',
    '      { id: "jeu", jour: "Jeudi", horaire: "20h30", label: "Jeudi 20h30", actif: false }',
    '    ];',
    '  }',
    '  var activeExists = SEANCES_TRAIN.some(function(s){ return s.id === SEANCE_COURANTE; });',
    '  if(!activeExists && SEANCES_TRAIN.length > 0){',
    '    SEANCE_COURANTE = SEANCES_TRAIN[0].id;',
    '  }',
    '  SEANCES_TRAIN.forEach(function(s, idx){',
    '    var btn = document.createElement("button");',
    '    btn.type = "button";',
    '    btn.className = "tab-btn" + (s.id === SEANCE_COURANTE ? " tab-active" : "");',
    '    btn.id = "tab_" + s.id;',
    '    btn.textContent = (s.jour || ("Séance " + (idx + 1))) + (s.horaire ? (" " + s.horaire) : "");',
    '    btn.onclick = function(){ changerSeance(s.id); };',
    '    cont.appendChild(btn);',
    '  });',
    '}',
    'function majLibellesOngletsTrain(){',
    '  if(!SEANCES_TRAIN || !SEANCES_TRAIN.length) return;',
    '  SEANCES_TRAIN.forEach(function(s, idx){',
    '    if(!TRAIN_CONFIG[s.id]){',
    '      TRAIN_CONFIG[s.id] = { label: s.label || (s.jour + " " + (s.horaire || "")), type: (idx === 0 ? "separe" : (idx === 1 ? "complet" : "reduit")), max: 20 };',
    '    } else {',
    '      TRAIN_CONFIG[s.id].label = s.label || (s.jour + " " + (s.horaire || ""));',
    '    }',
    '  });',
    '  rendreOngletsTrain();',
    '}',
    'function creerMessageMatch(compo){',
      'var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;',
      'var lignes = ["*LISTE POUR CE WEEK-END*", ""];',
      'var raw1B = (document.getElementById("sub1B") && document.getElementById("sub1B").textContent) || ("Match " + (CLUB_CONFIG.nomEquipe1 || "Équipe 1"));',
      'var titre1B = raw1B.replace(/^Dispo\\s+match/i, "Match");',
      'var l1B = (compo.equipe1B && compo.equipe1B.length) ? compo.equipe1B.map(function(n){ return "- " + n; }).join("\\n") : "Aucun joueur sélectionné";',
      'lignes.push(" *" + titre1B + "* :"); lignes.push(l1B);',
      'if(nbEq >= 2){',
        'var raw1C = (document.getElementById("sub1C") && document.getElementById("sub1C").textContent) || ("Match " + (CLUB_CONFIG.nomEquipe2 || "Équipe 2"));',
        'var titre1C = raw1C.replace(/^Dispo\\s+match/i, "Match");',
        'var l1C = (compo.equipe1C && compo.equipe1C.length) ? compo.equipe1C.map(function(n){ return "- " + n; }).join("\\n") : "Aucun joueur sélectionné";',
        'lignes.push(""); lignes.push(" *" + titre1C + "* :"); lignes.push(l1C);',
      '}',
      'if(nbEq >= 3){',
        'var raw1D = (document.getElementById("sub1D") && document.getElementById("sub1D").textContent) || ("Match " + (CLUB_CONFIG.nomEquipe3 || "Équipe 3"));',
        'var titre1D = raw1D.replace(/^Dispo\\s+match/i, "Match");',
        'var l1D = (compo.equipe1D && compo.equipe1D.length) ? compo.equipe1D.map(function(n){ return "- " + n; }).join("\\n") : "Aucun joueur sélectionné";',
        'lignes.push(""); lignes.push(" *" + titre1D + "* :"); lignes.push(l1D);',
      '}',
      'if(compo.repos && compo.repos.length){',
        'lignes.push(""); lignes.push(" *Au repos / Non retenus* :");',
        'lignes.push(compo.repos.map(function(n){ return "- " + n; }).join("\\n"));',
      '}',
      'return lignes.join("\\n");',
    '}',
    'function sauvegarder(envoyerWhatsApp){',
      'var compo = {',
        'equipe1B: extraireListeNoms("zone1B"),',
        'equipe1C: document.getElementById("zone1C") ? extraireListeNoms("zone1C") : [],',
        'equipe1D: document.getElementById("zone1D") ? extraireListeNoms("zone1D") : [],',
        'repos: document.getElementById("zoneRepos") ? extraireListeNoms("zoneRepos") : [],',
        'nonRetenus: extraireListeNoms("zonePool")',
      '};',
      'document.getElementById("statutChargement").textContent = "Sauvegarde...";',
      'var msg = creerMessageMatch(compo);',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("statutChargement").textContent = "Sauvegardé (" + res.date + ")";',
        'if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });',
      '}).enregistrerCompoEtPublier(compo, envoyerWhatsApp, msg);',
    '}',
    'function ouvrirApercuMatch(){',
      'var compo = {',
        'equipe1B: extraireListeNoms("zone1B"),',
        'equipe1C: document.getElementById("zone1C") ? extraireListeNoms("zone1C") : [],',
        'equipe1D: document.getElementById("zone1D") ? extraireListeNoms("zone1D") : [],',
        'repos: document.getElementById("zoneRepos") ? extraireListeNoms("zoneRepos") : [],',
        'nonRetenus: extraireListeNoms("zonePool")',
      '};',
      'if(compo.equipe1B.length === 0 && compo.equipe1C.length === 0 && compo.equipe1D.length === 0 && DERNIERE_COMPO){',
        'compo.equipe1B = DERNIERE_COMPO.equipe1B || [];',
        'compo.equipe1C = DERNIERE_COMPO.equipe1C || [];',
        'compo.equipe1D = DERNIERE_COMPO.equipe1D || [];',
        'compo.repos = DERNIERE_COMPO.repos || [];',
        'compo.nonRetenus = DERNIERE_COMPO.nonRetenus || [];',
      '}',
      'CONTEXTE_APERCU = { type: "match", compo: compo };',
      'document.getElementById("previewTitle").textContent = "Aperçu Convocations & Terrain";',
      'var bWaBlock = document.getElementById("previewWhatsAppBlock");',
      'var bPlBottom = document.getElementById("previewPlayerBottomActions");',
      'if(bWaBlock) bWaBlock.style.display = EST_COACH ? "block" : "none";',
      'if(bPlBottom) bPlBottom.style.display = EST_COACH ? "none" : "flex";',
      'var bSav = document.getElementById("btnSavePreview");',
      'if(bSav) bSav.style.display = EST_COACH ? "inline-block" : "none";',
      'var eqCible = "1B";',
      'if(SESSION_NOM){',
        'var sNom = String(SESSION_NOM).toLowerCase().trim();',
        'if(compo.equipe1C && compo.equipe1C.some(function(n){ return String(n).toLowerCase().trim() === sNom; })) eqCible = "1C";',
        'else if(compo.equipe1D && compo.equipe1D.some(function(n){ return String(n).toLowerCase().trim() === sNom; })) eqCible = "1D";',
      '}',
      'EQUIPE_TACTIQUE_COURANTE = eqCible;',
      'var tWrap = document.getElementById("tacticalPreviewWrap");',
      'if(tWrap){',
        'tWrap.style.display = "block";',
        'rendreTabsTactique();',
        'afficherApercuTactique(eqCible);',
      '}',
      'var div = document.getElementById("previewMessages"); div.innerHTML = "";',
      'var txt = document.createElement("textarea"); txt.className = "preview-text"; txt.id = "txtPreviewMatch"; txt.value = creerMessageMatch(compo); div.appendChild(txt);',
      'basculerVue("previewView");',
    '}',
    'function sauvegarderApercuDepuisTerrain(){',
      'if(!CONTEXTE_APERCU) return;',
      'var btnSave = document.getElementById("btnSavePreview");',
      'if(btnSave){ btnSave.disabled = true; btnSave.textContent = "💾 Enregistrement..."; }',
      'document.getElementById("previewStatus").textContent = "Enregistrement de la composition...";',
      'if(CONTEXTE_APERCU.type === "match"){',
        'var txt = document.getElementById("txtPreviewMatch") ? document.getElementById("txtPreviewMatch").value : "";',
        'google.script.run.withSuccessHandler(function(res){',
          'if(btnSave){ btnSave.disabled = false; btnSave.textContent = "💾 Sauvegarder la composition"; }',
          'document.getElementById("previewStatus").textContent = "Composition sauvegardée avec succès !";',
          'afficherToast("Composition sauvegardée avec succès !", "succes");',
          'if(typeof confetti === "function") confetti({ particleCount: 60, spread: 50 });',
        '}).withFailureHandler(function(err){',
          'if(btnSave){ btnSave.disabled = false; btnSave.textContent = "💾 Sauvegarder la composition"; }',
          'document.getElementById("previewStatus").textContent = "Erreur : " + err.message;',
          'afficherToast(err.message, "erreur");',
        '}).enregistrerCompoEtPublier(CONTEXTE_APERCU.compo, false, txt);',
      '} else {',
        'var txtTr = document.getElementById("txtPreviewTrain") ? document.getElementById("txtPreviewTrain").value : "";',
        'google.script.run.withSuccessHandler(function(res){',
          'if(btnSave){ btnSave.disabled = false; btnSave.textContent = "💾 Sauvegarder l\'entraînement"; }',
          'document.getElementById("previewStatus").textContent = "Entraînement sauvegardé avec succès !";',
          'afficherToast("Entraînement sauvegardé avec succès !", "succes");',
        '}).withFailureHandler(function(err){',
          'if(btnSave){ btnSave.disabled = false; btnSave.textContent = "💾 Sauvegarder l\'entraînement"; }',
          'document.getElementById("previewStatus").textContent = "Erreur : " + err.message;',
          'afficherToast(err.message, "erreur");',
        '}).enregistrerEntrainementEtPublier(CONTEXTE_APERCU.donnees.seance, CONTEXTE_APERCU.donnees.typeSeance, CONTEXTE_APERCU.donnees.groupes, CONTEXTE_APERCU.donnees.nonRetenus, false, txtTr);',
      '}',
    '}',
    'function publierApercu(){',
      'if(!CONTEXTE_APERCU) return;',
      'document.getElementById("btnPublishPreview").disabled = true;',
      'document.getElementById("previewStatus").textContent = "Publication en cours sur WhatsApp...";',
      'if(CONTEXTE_APERCU.type === "match"){',
        'var txt = document.getElementById("txtPreviewMatch").value;',
        'google.script.run.withSuccessHandler(function(res){',
          'document.getElementById("btnPublishPreview").disabled = false;',
          'document.getElementById("previewStatus").textContent = "Publié avec succès (" + res.date + ") !";',
          'if(typeof confetti === "function") confetti({ particleCount: 90, spread: 70 });',
          'setTimeout(function(){ retourApercu(); }, 1800);',
        '}).withFailureHandler(function(err){',
          'document.getElementById("btnPublishPreview").disabled = false;',
          'document.getElementById("previewStatus").textContent = "Erreur : " + err.message;',
          'afficherToast(err.message, "erreur");',
        '}).enregistrerCompoEtPublier(CONTEXTE_APERCU.compo, true, txt);',
      '} else {',
        'var txtTr = document.getElementById("txtPreviewTrain").value;',
        'google.script.run.withSuccessHandler(function(res){',
          'document.getElementById("btnPublishPreview").disabled = false;',
          'document.getElementById("previewStatus").textContent = "Entraînement publié avec succès !";',
          'if(typeof confetti === "function") confetti({ particleCount: 90, spread: 70 });',
          'setTimeout(function(){ retourApercu(); }, 1800);',
        '}).withFailureHandler(function(err){',
          'document.getElementById("btnPublishPreview").disabled = false;',
          'document.getElementById("previewStatus").textContent = "Erreur : " + err.message;',
          'afficherToast(err.message, "erreur");',
        '}).enregistrerEntrainementEtPublier(CONTEXTE_APERCU.donnees.seance, CONTEXTE_APERCU.donnees.typeSeance, CONTEXTE_APERCU.donnees.groupes, CONTEXTE_APERCU.donnees.nonRetenus, true, txtTr);',
      '}',
    '}',
    'function retourApercu(){ basculerVue(EST_COACH ? VUE_PRECEDENTE_APERCU : "homeView"); }',
    'function basculerVue(nomVue){',
      'if(nomVue !== "previewView") VUE_PRECEDENTE_APERCU = nomVue;',
      '["homeView","appView","trainView","rosterView","previewView"].forEach(function(v){',
        'var el = document.getElementById(v); if(!el) return;',
        'var estActif = (v === nomVue);',
        'el.style.display = estActif ? (v === "homeView" ? "flex" : "block") : "none";',
        'if(estActif){ el.classList.remove("view-animate-in"); void el.offsetWidth; el.classList.add("view-animate-in"); }',
      '});',
      'document.body.classList.toggle("tinder-mode-active", nomVue === "appView" && !!window.MODE_TINDER);',
      'document.body.classList.toggle("train-tinder-mode-active", nomVue === "trainView" && !!window.TRAIN_MODE_TINDER);',
    '}',
    'function estAppareilMobile(){',
    '  try {',
    '    return (window.innerWidth < 768) || (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);',
    '  } catch(e){ return (window.innerWidth < 768); }',
    '}',
    'function gererClicDashCompo(e){ entrer(); }',
    'function gererClicDashTrain(e){ entrerEntrainement(); }',
    'function majAffichageModesParDefaut(){',
    '  var mobile = estAppareilMobile();',
    '  var bCompo = document.getElementById("badgeModeDefautCompo");',
    '  var bTrain = document.getElementById("badgeModeDefautTrain");',
    '  var btnCClassic = document.getElementById("btnEnterClassic");',
    '  var btnCTinder = document.getElementById("btnEnterTinder");',
    '  var btnTrClassic = document.getElementById("btnEnterTr");',
    '  var btnTrTinder = document.getElementById("btnEnterTrTinder");',
    '  if(bCompo) bCompo.textContent = mobile ? "📱 Tinder par défaut" : "💻 Tactique par défaut";',
    '  if(bTrain) bTrain.textContent = mobile ? "📱 Tinder par défaut" : "💻 Tactique par défaut";',
    '  if(btnCTinder && btnCClassic){',
    '    if(mobile){',
    '      btnCTinder.style.border = "1.5px solid #ec4899"; btnCTinder.style.boxShadow = "0 0 10px rgba(236,72,153,0.35)"; btnCTinder.style.fontWeight = "800";',
    '      btnCClassic.style.border = ""; btnCClassic.style.boxShadow = ""; btnCClassic.style.fontWeight = "600";',
    '    } else {',
    '      btnCClassic.style.border = "1.5px solid #0284c7"; btnCClassic.style.boxShadow = "0 0 10px rgba(2,132,199,0.35)"; btnCClassic.style.fontWeight = "800";',
    '      btnCTinder.style.border = ""; btnCTinder.style.boxShadow = ""; btnCTinder.style.fontWeight = "600";',
    '    }',
    '  }',
    '  if(btnTrTinder && btnTrClassic){',
    '    if(mobile){',
    '      btnTrTinder.style.border = "1.5px solid #ec4899"; btnTrTinder.style.boxShadow = "0 0 10px rgba(236,72,153,0.35)"; btnTrTinder.style.fontWeight = "800";',
    '      btnTrClassic.style.border = ""; btnTrClassic.style.boxShadow = ""; btnTrClassic.style.fontWeight = "600";',
    '    } else {',
    '      btnTrClassic.style.border = "1.5px solid #0284c7"; btnTrClassic.style.boxShadow = "0 0 10px rgba(2,132,199,0.35)"; btnTrClassic.style.fontWeight = "800";',
    '      btnTrTinder.style.border = ""; btnTrTinder.style.boxShadow = ""; btnTrTinder.style.fontWeight = "600";',
    '    }',
    '  }',
    '}',
    'function retourAccueil(){ basculerVue("homeView"); }',
    'function entrer(demarrerEnTinder){',
    '  basculerVue("appView");',
    '  var tinder = (demarrerEnTinder !== undefined && demarrerEnTinder !== null) ? !!demarrerEnTinder : estAppareilMobile();',
    '  choisirMode(tinder);',
    '}',
    'function entrerEntrainement(demarrerEnTinder){',
      'rendreOngletsTrain();',
      'majVueEntrainement();',
      'basculerVue("trainView");',
      'var tinder = (demarrerEnTinder !== undefined && demarrerEnTinder !== null) ? !!demarrerEnTinder : estAppareilMobile();',
      'choisirModeTrain(tinder);',
    '}',
    'function entrerEffectif(){ basculerVue("rosterView"); }',
    'var UPDATE_INFO = null;',
    'function verifierMiseAJourAutomatique(){',
      'google.script.run.withSuccessHandler(function(res){',
        'if(res && res.disponible){',
          'UPDATE_INFO = res;',
          'var b = document.getElementById("updateBannerBox"); if(b) b.style.display = "block";',
          'var badge = document.getElementById("updateBadgeVer"); if(badge) badge.textContent = "v" + res.versionDistante;',
          'var title = document.getElementById("updateBannerTitle"); if(title && res.titre) title.textContent = res.titre;',
        '}',
      '}).verifierMiseAJour();',
    '}',
    'function verifierMiseAJourManuelle(){',
      'var btn = document.getElementById("btnCheckUpdateCoach");',
      'if(btn) btn.textContent = "Vérification en cours...";',
      'google.script.run.withSuccessHandler(function(res){',
        'if(btn) btn.textContent = "Vérifier les mises à jour";',
        'if(res && res.disponible){',
          'UPDATE_INFO = res;',
          'ouvrirModalMiseAJour();',
        '} else {',
          'afficherToast("Votre Handball Bot est parfaitement à jour (Version v" + (res ? res.versionActuelle : "' + APP_VERSION + '") + ") !", "succes");',
        '}',
      '}).withFailureHandler(function(err){',
        'if(btn) btn.textContent = "Vérifier les mises à jour";',
        'afficherToast("Impossible de vérifier les mises à jour : " + err.message, "erreur");',
      '}).verifierMiseAJour();',
    '}',
    'function ouvrirModalMiseAJour(){',
      'if(!UPDATE_INFO) return;',
      'var titleEl = document.getElementById("modalUpdateTitle"); if(titleEl) titleEl.textContent = (UPDATE_INFO.titre || "Mise à jour disponible") + " (v" + UPDATE_INFO.versionDistante + ")";',
      'var metaEl = document.getElementById("modalUpdateMeta"); if(metaEl) metaEl.textContent = "Version actuelle : v" + UPDATE_INFO.versionActuelle + (UPDATE_INFO.date ? " • Publiée le " + UPDATE_INFO.date : "");',
      'var ul = document.getElementById("modalUpdateChangelog");',
      'if(ul){',
        'ul.innerHTML = "";',
        '(UPDATE_INFO.changelog || []).forEach(function(item){',
          'var li = document.createElement("li"); li.textContent = item; ul.appendChild(li);',
        '});',
      '}',
      'document.getElementById("modalMiseAJourBg").style.display = "flex";',
    '}',
    'function fermerModalMiseAJour(){ document.getElementById("modalMiseAJourBg").style.display = "none"; }',
    'function fermerModalMiseAJourSurBg(e){ if(e.target.id === "modalMiseAJourBg") fermerModalMiseAJour(); }',
    'function masquerBanniereUpdate(){ var b = document.getElementById("updateBannerBox"); if(b) b.style.display = "none"; }',
    'function copierLienCodeGs(){',
      'var url = (UPDATE_INFO && UPDATE_INFO.codeGsUrl) ? UPDATE_INFO.codeGsUrl : "https://raw.githubusercontent.com/' + UPSTREAM_TEMPLATE_REPO + '/main/code.gs";',
      'if(navigator.clipboard && navigator.clipboard.writeText){',
        'navigator.clipboard.writeText(url).then(function(){',
          'var b = document.getElementById("btnCopierCodeGs");',
          'if(b){ b.textContent = "Lien copié dans le presse-papier !"; setTimeout(function(){ b.textContent = "Copier le lien du code.gs mis à jour"; }, 2500); }',
        '});',
      '} else {',
        'window.open(url, "_blank");',
      '}',
    '}',
    'function ouvrirRepoGithub(){',
      'var repo = String((CLUB_CONFIG && CLUB_CONFIG.githubRepo) || "").replace(/^https?:\\/\\/github\\.com\\//i, "").replace(/^\\/+|\\/+$/g, "").trim();',
      'var url = (repo && repo.indexOf("/") !== -1) ? ("https://github.com/" + repo + "/actions") : ((UPDATE_INFO && UPDATE_INFO.repoUrl) ? UPDATE_INFO.repoUrl : "https://github.com");',
      'window.open(url, "_blank");',
    '}',
    'function seConnecter(){',
      'var tel = document.getElementById("inpTel").value, pin = document.getElementById("inpPin").value;',
      'document.getElementById("loginError").textContent = "Connexion...";',
      'document.getElementById("btnLogin").disabled = true;',
      'afficherLoading("Connexion en cours...", "Vérification de vos identifiants...");',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("btnLogin").disabled = false;',
        'SESSION_TEL = res.telephone; SESSION_PIN = res.pin; SESSION_NOM = res.nom; EST_COACH = !!res.estCoach; EST_TRESORIER = !!res.estTresorier;',
        'document.body.classList.add("user-logged-in");',
        'document.getElementById("loginBox").style.display = "none";',
        'document.getElementById("playerBox").style.display = "flex";',
        'majEspaceJoueur(res.nom);',
        'if(EST_COACH || EST_TRESORIER){',
          'document.getElementById("coachMenuBox").style.display = "block";',
        '} else {',
          'document.getElementById("coachMenuBox").style.display = "none";',
        '}',
        'if(EST_COACH){',
          'var bLogo = document.getElementById("btnEditClubLogoBadge"); if(bLogo) bLogo.style.display = "flex";',
          'verifierMiseAJourAutomatique();',
          'majAffichageModesParDefaut();',
        '}',
        'try { localStorage.setItem("hb_tel", tel); localStorage.setItem("hb_pin", pin); } catch(e){}',
        'google.script.run.withSuccessHandler(function(data){ appliquerDonneesRecues(data, false); }).getDonneesCoach();',
      '}).withFailureHandler(function(err){',
        'masquerLoading();',
        'document.getElementById("btnLogin").disabled = false;',
        'document.getElementById("loginError").textContent = err.message;',
      '}).authentifierUtilisateur(tel, pin);',
    '}',
    'function seDeconnecter(){',
      'try { localStorage.removeItem("hb_pin"); } catch(e){}',
      'SESSION_TEL = ""; SESSION_PIN = ""; SESSION_NOM = ""; EST_COACH = false; EST_TRESORIER = false;',
      'document.body.classList.remove("user-logged-in");',
      'var bLogo = document.getElementById("btnEditClubLogoBadge"); if(bLogo) bLogo.style.display = "none";',
      'document.getElementById("coachMenuBox").style.display = "none";',
      'document.getElementById("playerBox").style.display = "none";',
      'document.getElementById("loginBox").style.display = "flex";',
      'document.getElementById("inpPin").value = "";',
      'retourAccueil();',
    '}',
    'function changerMonPoste(){',
      'var np = document.getElementById("selPosteJoueur").value;',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("playerPostePreview").textContent = res.poste;',
        'afficherToast("Poste mis à jour : " + res.poste, "succes");',
        'majEspaceJoueur(SESSION_NOM);',
      '}).enregistrerMonPoste(SESSION_TEL, SESSION_PIN, np);',
    '}',
    'function chargerFichierPhoto(e){',
      'var f = e.target.files[0]; if(!f) return;',
      'var r = new FileReader();',
      'r.onload = function(evt){',
        'var b64 = evt.target.result;',
        'document.getElementById("photoStatus").textContent = "Envoi photo...";',
        'google.script.run.withSuccessHandler(function(res){',
          'document.getElementById("photoStatus").textContent = "Photo enregistrée !";',
          'document.getElementById("playerImgPreview").src = res.photo;',
          'document.getElementById("playerImgPreview").style.display = "block";',
          'document.getElementById("playerInitialPreview").style.display = "none";',
          'afficherToast("Photo de profil mise à jour !", "succes");',
          'majEspaceJoueur(SESSION_NOM);',
        '}).enregistrerMaPhoto(SESSION_TEL, SESSION_PIN, b64);',
      '};',
      'r.readAsDataURL(f);',
    '}',
    'function togglePosteSelect(){',
      'var b = document.getElementById("posteSelectBox");',
      'if(b) b.style.display = (b.style.display === "none" || !b.style.display) ? "block" : "none";',
    '}',
    'function partagerMaCarteJoueur(){',
      'var clubNom = (CLUB_CONFIG && CLUB_CONFIG.nomClub) || "Mon Club de Handball";',
      'var txt = "Retrouve ma carte de joueur sur le portail " + clubNom + " ! 🤾‍♂️";',
      'if(navigator.share){',
        'navigator.share({ title: clubNom + " - Joueur", text: txt, url: window.location.href }).catch(function(){});',
      '} else if(navigator.clipboard && navigator.clipboard.writeText){',
        'navigator.clipboard.writeText(window.location.href).then(function(){',
          'afficherToast("Lien de l\'application copié dans le presse-papier !", "succes");',
        '});',
      '} else {',
        'afficherToast("Partagez l\'adresse de l\'application avec votre équipe !", "info");',
      '}',
    '}',
    'function ouvrirGpsGymnase(type){',
      'var salle = CURRENT_MATCH_SALLE || "";',
      'if(!salle && INFOS_MATCHS){',
        'var d = INFOS_MATCHS.details1B || INFOS_MATCHS.details1C || INFOS_MATCHS.details1D;',
        'if(d && d.salle) salle = d.salle;',
      '}',
      'if(!salle && CLUB_CONFIG && CLUB_CONFIG.nomClub) salle = CLUB_CONFIG.nomClub;',
      'var q = encodeURIComponent(salle + " Gymnase");',
      'var url = (type === "waze") ? ("https://waze.com/ul?q=" + q) : ("https://www.google.com/maps/search/?api=1&query=" + q);',
      'window.open(url, "_blank");',
    '}',
    'function ouvrirApercuCompoJoueur(){',
      'ouvrirApercuMatch();',
      'if(!EST_COACH){',
        'var bWa = document.getElementById("previewWhatsAppBlock"); if(bWa) bWa.style.display = "none";',
        'var bPl = document.getElementById("previewPlayerBottomActions"); if(bPl) bPl.style.display = "flex";',
        'var bSav = document.getElementById("btnSavePreview"); if(bSav) bSav.style.display = "none";',
        'var bPub = document.getElementById("btnPublishPreview"); if(bPub) bPub.style.display = "none";',
        'var txtM = document.getElementById("txtPreviewMatch"); if(txtM) txtM.readOnly = true;',
        'var hSwap = document.getElementById("tacticalSwapHint"); if(hSwap) hSwap.innerHTML = "<span style=\'color:#38bdf8;\'>Mode consultation joueur : visualisez les postes et remplaçants du match.</span>";',
      '}',
    '}',
    'function majEspaceJoueur(nom){',
      'if(!nom) nom = SESSION_NOM;',
      'if(!nom) return;',
      'var nClean = String(nom).trim();',
      'var nLow = nClean.toLowerCase();',
      'var nSimple = nLow.replace(/\\s*\\([^)]*\\)\\s*/g, "").trim();',
      'var pInVotes = (JOUEURS || []).find(function(x){',
        'var xL = String(x.nom || "").trim().toLowerCase();',
        'return xL === nLow || xL.replace(/\\s*\\([^)]*\\)\\s*/g, "").trim() === nSimple;',
      '});',
      'var pInEff = (EFFECTIF_COMPLET || []).find(function(x){',
        'var xL = String(x.nom || "").trim().toLowerCase();',
        'return xL === nLow || xL.replace(/\\s*\\([^)]*\\)\\s*/g, "").trim() === nSimple;',
      '});',
      'var pObj = pInEff || pInVotes || { nom: nClean, poste: "Demi-Centre", entrainements: 0 };',
      'document.getElementById("playerNomPreview").textContent = pObj.nom;',
      'document.getElementById("playerPostePreview").textContent = pObj.poste || "Demi-Centre";',
      'if(document.getElementById("selPosteJoueur")) document.getElementById("selPosteJoueur").value = pObj.poste || "Demi-Centre";',
      'var pImg = document.getElementById("playerImgPreview"), pInit = document.getElementById("playerInitialPreview");',
      'var pLtr = (pObj.nom || "").trim().charAt(0).toUpperCase();',
      'if(pInit) pInit.textContent = pLtr;',
      'if(pObj.photo){',
        'if(pImg){ pImg.src = pObj.photo; pImg.style.display = "block"; }',
        'if(pInit) pInit.style.display = "none";',
      '} else {',
        'if(pInit) pInit.style.display = "flex";',
        'if(pImg) pImg.style.display = "none";',
      '}',
      'var isChou = (CLUB_CONFIG && CLUB_CONFIG.chouchou && String(nom).trim().toLowerCase() === String(CLUB_CONFIG.chouchou).trim().toLowerCase());',
      'var chouBadge = document.getElementById("playerChouchouBadgeCard");',
      'if(chouBadge) chouBadge.style.display = isChou ? "block" : "none";',
      'var nbTr = 0;',
      'if(pInVotes && pInVotes.entrainements !== undefined && pInVotes.entrainements !== null && Number(pInVotes.entrainements) > 0){',
        'nbTr = Number(pInVotes.entrainements);',
      '} else if(pInEff && pInEff.entrainements !== undefined && pInEff.entrainements !== null && Number(pInEff.entrainements) > 0){',
        'nbTr = Number(pInEff.entrainements);',
      '} else if(pObj && pObj.entrainements){',
        'nbTr = Number(pObj.entrainements);',
      '}',
      'if(nbTr === 0 && typeof ENTRAINEMENTS === "object" && ENTRAINEMENTS){',
        'Object.keys(ENTRAINEMENTS).forEach(function(sId){',
          'var listS = ENTRAINEMENTS[sId] || [];',
          'if(listS.some(function(j){',
            'var jNom = String(j.nom || "").trim().toLowerCase().replace(/\\s*\\([^)]*\\)\\s*/g, "").trim();',
            'return jNom === nSimple;',
          '})){ nbTr++; }',
        '});',
      '}',
      'var bTr = document.getElementById("playerAssiduiteBadge");',
      'if(bTr) bTr.textContent = "⚡ Assiduité : " + nbTr + " séance" + (nbTr > 1 ? "s" : "");',
      'var statutBadge = document.getElementById("matchHubStatutBadge");',
      'var equipeBadge = document.getElementById("matchHubEquipeBadge");',
      'var advEl = document.getElementById("matchHubAdversaire");',
      'var detEl = document.getElementById("matchHubDetails");',
      'var actBox = document.getElementById("matchHubActions");',
      'var eqNomConvoque = ""; var detailsEquipe = null;',
      'function nomDans(liste, n){',
        'if(!liste || !Array.isArray(liste)) return false;',
        'var t = String(n || "").trim().toLowerCase().replace(/\\s*\\([^)]*\\)\\s*/g, "").trim();',
        'return liste.some(function(item){',
          'var iClean = String(item || "").trim().toLowerCase().replace(/\\s*\\([^)]*\\)\\s*/g, "").trim();',
          'return iClean === t;',
        '});',
      '}',
      'if(DERNIERE_COMPO){',
        'if(nomDans(DERNIERE_COMPO.equipe1B, nom)){',
          'eqNomConvoque = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe1) || "Équipe 1";',
          'if(INFOS_MATCHS) detailsEquipe = INFOS_MATCHS.details1B || INFOS_MATCHS.eq1;',
        '} else if(nomDans(DERNIERE_COMPO.equipe1C, nom)){',
          'eqNomConvoque = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe2) || "Équipe 2";',
          'if(INFOS_MATCHS) detailsEquipe = INFOS_MATCHS.details1C || INFOS_MATCHS.eq2;',
        '} else if(nomDans(DERNIERE_COMPO.equipe1D, nom)){',
          'eqNomConvoque = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe3) || "Équipe 3";',
          'if(INFOS_MATCHS) detailsEquipe = INFOS_MATCHS.details1D || INFOS_MATCHS.eq3;',
        '} else if(nomDans(DERNIERE_COMPO.nonRetenus, nom) || nomDans(DERNIERE_COMPO.repos, nom)){',
          'eqNomConvoque = "REPOS";',
        '}',
      '}',
      'if(detailsEquipe && detailsEquipe.salle) CURRENT_MATCH_SALLE = detailsEquipe.salle;',
      'if(eqNomConvoque === "REPOS"){',
        'if(statutBadge){ statutBadge.textContent = "🛌 AU REPOS"; statutBadge.style.background = "rgba(239,68,68,0.2)"; statutBadge.style.color = "#fca5a5"; }',
        'if(equipeBadge) equipeBadge.textContent = "Non retenu ce week-end";',
        'if(advEl) advEl.textContent = "Repos ce week-end";',
        'if(detEl) detEl.textContent = "Profitez de votre week-end pour recharger les batteries ! Rendez-vous au prochain entraînement.";',
        'if(actBox) actBox.style.display = "none";',
      '} else if(eqNomConvoque){',
        'if(statutBadge){ statutBadge.textContent = "🔥 CONVOQUÉ"; statutBadge.style.background = "rgba(34,197,94,0.25)"; statutBadge.style.color = "#86efac"; }',
        'if(equipeBadge) equipeBadge.textContent = eqNomConvoque;',
        'var advTxt = (detailsEquipe && detailsEquipe.adversaire) ? detailsEquipe.adversaire : "Match à venir";',
        'if(advEl) advEl.textContent = "⚔️ Contre " + advTxt;',
        'var detLignes = [];',
        'if(detailsEquipe && detailsEquipe.dateMatch) detLignes.push("📅 " + detailsEquipe.dateMatch + (detailsEquipe.heureMatch ? (" à " + detailsEquipe.heureMatch) : ""));',
        'if(detailsEquipe && detailsEquipe.salle) detLignes.push("📍 Salle : " + detailsEquipe.salle);',
        'if(detailsEquipe && detailsEquipe.heureRdv) detLignes.push("⏱️ Rendez-vous : " + detailsEquipe.heureRdv);',
        'if(detEl) detEl.textContent = detLignes.length ? detLignes.join(" • ") : "Consultez les horaires et le gymnase ci-dessous.";',
        'if(actBox) actBox.style.display = "flex";',
      '} else {',
        'var eqHab = (pObj.equipe || "").toLowerCase();',
        'var matchAvenir = null;',
        'var nomEqAvenir = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe1) || "Équipe 1";',
        'if(eqHab.includes("2") || eqHab.includes("1c")){',
          'matchAvenir = INFOS_MATCHS ? (INFOS_MATCHS.details1C || INFOS_MATCHS.eq2) : null;',
          'nomEqAvenir = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe2) || "Équipe 2";',
        '} else if(eqHab.includes("3") || eqHab.includes("1d")){',
          'matchAvenir = INFOS_MATCHS ? (INFOS_MATCHS.details1D || INFOS_MATCHS.eq3) : null;',
          'nomEqAvenir = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe3) || "Équipe 3";',
        '} else {',
          'matchAvenir = INFOS_MATCHS ? (INFOS_MATCHS.details1B || INFOS_MATCHS.eq1) : null;',
        '}',
        'if(!matchAvenir || !matchAvenir.aMatch){',
          'matchAvenir = INFOS_MATCHS ? (INFOS_MATCHS.details1B || INFOS_MATCHS.eq1) : null;',
        '}',
        'if(matchAvenir && matchAvenir.aMatch){',
          'if(matchAvenir.salle) CURRENT_MATCH_SALLE = matchAvenir.salle;',
          'if(statutBadge){ statutBadge.textContent = "⏳ SÉLECTION EN COURS"; statutBadge.style.background = "rgba(234,179,8,0.2)"; statutBadge.style.color = "#facc15"; }',
          'if(equipeBadge) equipeBadge.textContent = nomEqAvenir + " (Match à venir)";',
          'if(advEl) advEl.textContent = "⚔️ Contre " + (matchAvenir.adversaire || "Adversaire FFHB");',
          'var detLignes = [];',
          'if(matchAvenir.dateMatch) detLignes.push("📅 " + matchAvenir.dateMatch + (matchAvenir.heureMatch ? (" à " + matchAvenir.heureMatch) : ""));',
          'if(matchAvenir.salle) detLignes.push("📍 " + matchAvenir.salle);',
          'if(matchAvenir.heureRdv) detLignes.push("⏱️ Rendez-vous : " + matchAvenir.heureRdv);',
          'if(detEl) detEl.textContent = (detLignes.length ? detLignes.join(" • ") + " • " : "") + "Sélection finale en cours par le coach.";',
          'if(actBox) actBox.style.display = "flex";',
        '} else {',
          'if(statutBadge){ statutBadge.textContent = "⏳ MATCH DU WEEK-END"; statutBadge.style.background = "rgba(234,179,8,0.2)"; statutBadge.style.color = "#facc15"; }',
          'if(equipeBadge) equipeBadge.textContent = "Sélection en préparation";',
          'if(advEl) advEl.textContent = "Convocations en cours...";',
          'if(detEl) detEl.textContent = "Les feuilles de match seront publiées très prochainement par l\'entraîneur.";',
          'if(actBox) actBox.style.display = "none";',
        '}',
      '}',
      'var tBadgeMvp = document.getElementById("tileBadgeMvp");',
      'var tSubMvp = document.getElementById("tileSubMvp");',
      'if(VOTES_MVP_DATA && VOTES_MVP_DATA.podiumMvp && VOTES_MVP_DATA.podiumMvp.length > 0){',
        'if(tBadgeMvp) tBadgeMvp.textContent = VOTES_MVP_DATA.totalVotes + " vote(s)";',
        'if(tSubMvp) tSubMvp.textContent = "1er : " + VOTES_MVP_DATA.podiumMvp[0].nom;',
      '} else {',
        'if(tBadgeMvp) tBadgeMvp.textContent = "Vote ouvert";',
        'if(tSubMvp) tSubMvp.textContent = "Élisez le joueur du match";',
      '}',
      'var tBadgeCov = document.getElementById("tileBadgeCovoit");',
      'var tSubCov = document.getElementById("tileSubCovoit");',
      'var nbPlacesDispos = 0;',
      'if(COVOITURAGE_DATA && COVOITURAGE_DATA.conducteurs){',
        'COVOITURAGE_DATA.conducteurs.forEach(function(c){ nbPlacesDispos += (c.nbPlaces || 0); });',
      '}',
      'if(tBadgeCov) tBadgeCov.textContent = nbPlacesDispos > 0 ? (nbPlacesDispos + " place(s)") : "Trajets";',
      'if(tSubCov) tSubCov.textContent = (COVOITURAGE_DATA && COVOITURAGE_DATA.conducteurs && COVOITURAGE_DATA.conducteurs.length > 0) ? (COVOITURAGE_DATA.conducteurs.length + " voiture(s) prête(s)") : "Proposer ou trouver 1 place";',
      'var tBadgeAbs = document.getElementById("tileBadgeAbsence");',
      'var tSubAbs = document.getElementById("tileSubAbsence");',
      'var mesAbs = (MES_ABSENCES || []).filter(function(a){ return String(a.nom || "").toLowerCase() === nom.toLowerCase(); });',
      'if(tBadgeAbs) tBadgeAbs.textContent = mesAbs.length > 0 ? (mesAbs.length + " déclarée(s)") : "Prévenir";',
      'if(tSubAbs) tSubAbs.textContent = mesAbs.length > 0 ? "Absence enregistrée" : "Indiquer vos indispos";',
      'var tBadgeCaisse = document.getElementById("tileBadgeCaisse");',
      'var tSubCaisse = document.getElementById("tileSubCaisse");',
      'var mesAmendesImpayees = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.amendes) ? CAISSE_NOIRE_DATA.amendes.filter(function(a){ return String(a.nomJoueur || "").toLowerCase() === nom.toLowerCase() && a.statut === "impaye"; }) : [];',
      'var monTotalDu = 0;',
      'mesAmendesImpayees.forEach(function(a){ monTotalDu += (Number(a.montant) || 0); });',
      'if(tBadgeCaisse){',
        'if(monTotalDu > 0){',
          'tBadgeCaisse.textContent = "Dû : " + monTotalDu + " €";',
          'tBadgeCaisse.style.background = "rgba(239,68,68,0.25)";',
          'tBadgeCaisse.style.color = "#fca5a5";',
          'tBadgeCaisse.style.borderColor = "rgba(239,68,68,0.35)";',
        '} else {',
          'tBadgeCaisse.textContent = "À jour 🟢";',
          'tBadgeCaisse.style.background = "rgba(34,197,94,0.2)";',
          'tBadgeCaisse.style.color = "#86efac";',
          'tBadgeCaisse.style.borderColor = "rgba(34,197,94,0.35)";',
        '}',
      '}',
      'if(tSubCaisse){',
        'var soldeC = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats) ? CAISSE_NOIRE_DATA.stats.soldeCaisse : 0;',
        'tSubCaisse.textContent = "Cagnotte : " + soldeC + " € en caisse • Barème & Palmarès";',
      '}',
      'var badgeCoachCaisse = document.getElementById("badgeCoachCaisseStats");',
      'if(badgeCoachCaisse && CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats){',
        'badgeCoachCaisse.textContent = (CAISSE_NOIRE_DATA.stats.soldeCaisse || 0) + " € en caisse • " + (CAISSE_NOIRE_DATA.stats.totalDu || 0) + " € impayés";',
      '}',
    '}',
    'function ouvrirModalMvpChevre(){',
      'remplirSelectsMvp();',
      'rendrePodiumMvp();',
      'var cBox = document.getElementById("coachMvpResetBox"); if(cBox) cBox.style.display = EST_COACH ? "block" : "none";',
      'document.getElementById("modalMvpChevreBg").style.display = "flex";',
    '}',
    'function fermerModalMvpChevre(){ document.getElementById("modalMvpChevreBg").style.display = "none"; }',
    'function fermerModalMvpChevreSurBg(e){ if(e.target.id === "modalMvpChevreBg") fermerModalMvpChevre(); }',
    'function remplirSelectsMvp(){',
      'var selM = document.getElementById("selVoteMvp"), selC = document.getElementById("selVoteChevre");',
      'if(!selM || !selC) return;',
      'selM.innerHTML = "<option value=\'\'>-- Choisir un coéquipier --</option>";',
      'selC.innerHTML = "<option value=\'\'>-- Choisir un coéquipier --</option>";',
      'var effectifTrie = (EFFECTIF_COMPLET || []).slice().sort(function(a,b){ return String(a.nom||"").localeCompare(String(b.nom||"")); });',
      'effectifTrie.forEach(function(j){',
        'var o1 = document.createElement("option"); o1.value = j.nom; o1.textContent = j.nom + " (" + (j.poste || "Demi-Centre") + ")"; selM.appendChild(o1);',
        'var o2 = document.createElement("option"); o2.value = j.nom; o2.textContent = j.nom + " (" + (j.poste || "Demi-Centre") + ")"; selC.appendChild(o2);',
      '});',
    '}',
    'function enregistrerVoteMvp(){',
      'var nomMvp = document.getElementById("selVoteMvp").value;',
      'var nomChevre = document.getElementById("selVoteChevre").value;',
      'if(!nomMvp && !nomChevre){ afficherToast("Veuillez choisir un joueur pour au moins une des catégories.", "erreur"); return; }',
      'var status = document.getElementById("statusVoteMvp");',
      'var btn = document.getElementById("btnSubmitVoteMvp");',
      'if(status) status.textContent = "Enregistrement de votre vote...";',
      'if(btn){ btn.disabled = true; btn.textContent = "⏳ Enregistrement..."; }',
      'google.script.run.withSuccessHandler(function(res){',
        'if(btn){ btn.disabled = false; btn.textContent = "Enregistrer mon vote !"; }',
        'if(status) status.textContent = "Vote pris en compte ! Merci pour votre participation.";',
        'VOTES_MVP_DATA = res.votesMvp || res || VOTES_MVP_DATA;',
        'rendrePodiumMvp();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Vote MVP & Chèvre enregistré !", "succes");',
        'if(typeof confetti === "function") confetti({ particleCount: 75, spread: 65 });',
      '}).withFailureHandler(function(err){',
        'if(btn){ btn.disabled = false; btn.textContent = "Enregistrer mon vote !"; }',
        'if(status) status.textContent = "Erreur : " + err.message;',
        'afficherToast(err.message, "erreur");',
      '}).voterMvpChevre(SESSION_TEL, SESSION_PIN, nomMvp, nomChevre);',
    '}',
    'function rendrePodiumMvp(){',
      'var cont = document.getElementById("mvpPodiumContainer"); if(!cont) return;',
      'var totEl = document.getElementById("mvpTotalVotesCount");',
      'if(totEl) totEl.textContent = (VOTES_MVP_DATA.totalVotes || 0) + " vote(s)";',
      'var podMvp = (VOTES_MVP_DATA && VOTES_MVP_DATA.podiumMvp) || [];',
      'var podChv = (VOTES_MVP_DATA && VOTES_MVP_DATA.podiumChevre) || [];',
      'var html = "<div style=\'display:grid;grid-template-columns:1fr 1fr;gap:12px;\'>";',
      'html += "<div><div style=\'font-weight:800;font-size:0.8rem;color:#fcd34d;margin-bottom:6px;text-align:center;\'>⭐ Podium MVP</div>";',
      'if(podMvp.length === 0){ html += "<div style=\'font-size:0.75rem;color:#64748b;text-align:center;padding:12px;\'>Aucun vote pour le moment</div>"; }',
      'else {',
        'podMvp.forEach(function(item, idx){',
          'var medal = idx === 0 ? "🥇" : (idx === 1 ? "🥈" : "🥉");',
          'var vCount = (item.votes !== undefined && item.votes !== null) ? item.votes : ((item.voix !== undefined && item.voix !== null) ? item.voix : 0);',
          'html += "<div style=\'background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px 10px;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;font-size:0.78rem;\'><span>" + medal + " <b>" + item.nom + "</b></span><span style=\'color:#fcd34d;font-weight:800;\'>" + vCount + " v</span></div>";',
        '});',
      '}',
      'html += "</div>";',
      'html += "<div><div style=\'font-weight:800;font-size:0.8rem;color:#fca5a5;margin-bottom:6px;text-align:center;\'>🐐 Podium Chèvre</div>";',
      'if(podChv.length === 0){ html += "<div style=\'font-size:0.75rem;color:#64748b;text-align:center;padding:12px;\'>Aucun vote pour le moment</div>"; }',
      'else {',
        'podChv.forEach(function(item, idx){',
          'var badge = idx === 0 ? "👑" : (idx === 1 ? "🥈" : "🥉");',
          'var vCount = (item.votes !== undefined && item.votes !== null) ? item.votes : ((item.voix !== undefined && item.voix !== null) ? item.voix : 0);',
          'html += "<div style=\'background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px 10px;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;font-size:0.78rem;\'><span>" + badge + " <b>" + item.nom + "</b></span><span style=\'color:#fca5a5;font-weight:800;\'>" + vCount + " v</span></div>";',
        '});',
      '}',
      'html += "</div></div>";',
      'cont.innerHTML = html;',
    '}',
    'function reinitialiserVotesMvpParCoach(){',
      'if(!confirm("Réinitialiser tous les votes MVP et Chèvre pour le prochain match ?")) return;',
      'google.script.run.withSuccessHandler(function(res){',
        'VOTES_MVP_DATA = { totalVotes: 0, podiumMvp: [], podiumChevre: [] };',
        'rendrePodiumMvp();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Votes MVP & Chèvre remis à zéro pour ce match.", "info");',
      '}).reinitialiserVotesMvp(SESSION_TEL, SESSION_PIN);',
    '}',
    'function selectionnerStatutCovoit(statut){',
      'STATUT_COVOIT_CHOISI = statut;',
      'var btnCond = document.getElementById("btnCovoitConduis");',
      'var btnCher = document.getElementById("btnCovoitCherche");',
      'var boxPl = document.getElementById("boxCovoitNbPlaces");',
      'if(statut === "conduis"){',
        'if(btnCond){ btnCond.style.background = "rgba(2,132,199,0.3)"; btnCond.style.borderColor = "#0284c7"; btnCond.style.color = "#fff"; }',
        'if(btnCher){ btnCher.style.background = "transparent"; btnCher.style.borderColor = "rgba(255,255,255,0.15)"; btnCher.style.color = "#94a3b8"; }',
        'if(boxPl) boxPl.style.display = "block";',
      '} else {',
        'if(btnCher){ btnCher.style.background = "rgba(2,132,199,0.3)"; btnCher.style.borderColor = "#0284c7"; btnCher.style.color = "#fff"; }',
        'if(btnCond){ btnCond.style.background = "transparent"; btnCond.style.borderColor = "rgba(255,255,255,0.15)"; btnCond.style.color = "#94a3b8"; }',
        'if(boxPl) boxPl.style.display = "none";',
      '}',
    '}',
    'function ouvrirModalCovoiturage(){',
      'selectionnerStatutCovoit("conduis");',
      'rendreCovoiturageList();',
      'var cBox = document.getElementById("coachCovoitResetBox"); if(cBox) cBox.style.display = EST_COACH ? "block" : "none";',
      'document.getElementById("modalCovoiturageBg").style.display = "flex";',
    '}',
    'function fermerModalCovoiturage(){ document.getElementById("modalCovoiturageBg").style.display = "none"; }',
    'function fermerModalCovoiturageSurBg(e){ if(e.target.id === "modalCovoiturageBg") fermerModalCovoiturage(); }',
    'function enregistrerMonCovoiturage(){',
      'var status = document.getElementById("statusCovoit");',
      'var btn = document.getElementById("btnSubmitCovoit");',
      'var nb = parseInt(document.getElementById("selCovoitNbPlaces").value, 10) || 3;',
      'if(status) status.textContent = "Enregistrement de votre statut...";',
      'if(btn){ btn.disabled = true; btn.textContent = "⏳ Enregistrement..."; }',
      'google.script.run.withSuccessHandler(function(res){',
        'if(btn){ btn.disabled = false; btn.textContent = "Enregistrer mon statut"; }',
        'if(status) status.textContent = "Statut enregistré !";',
        'COVOITURAGE_DATA = res.covoiturage || COVOITURAGE_DATA;',
        'rendreCovoiturageList();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Covoiturage mis à jour !", "succes");',
      '}).withFailureHandler(function(err){',
        'if(btn){ btn.disabled = false; btn.textContent = "Enregistrer mon statut"; }',
        'if(status) status.textContent = "Erreur : " + err.message;',
        'afficherToast(err.message, "erreur");',
      '}).enregistrerCovoiturage(SESSION_TEL, SESSION_PIN, STATUT_COVOIT_CHOISI, nb, "");',
    '}',
    'function annulerMonCovoiturage(){',
      'var status = document.getElementById("statusCovoit");',
      'if(status) status.textContent = "Suppression de votre statut...";',
      'google.script.run.withSuccessHandler(function(res){',
        'if(status) status.textContent = "Statut retiré.";',
        'COVOITURAGE_DATA = res.covoiturage || COVOITURAGE_DATA;',
        'rendreCovoiturageList();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Statut de covoiturage retiré.", "info");',
      '}).enregistrerCovoiturage(SESSION_TEL, SESSION_PIN, "aucun", 0, "");',
    '}',
    'function rendreCovoiturageList(){',
      'var cont = document.getElementById("covoitListContainer"); if(!cont) return;',
      'var sum = document.getElementById("covoitStatsSummary");',
      'var conds = (COVOITURAGE_DATA && COVOITURAGE_DATA.conducteurs) || [];',
      'var pass = (COVOITURAGE_DATA && COVOITURAGE_DATA.passagers) || [];',
      'var totPlaces = 0;',
      'conds.forEach(function(c){',
        'var places = (c.nbPlaces !== undefined && c.nbPlaces !== null) ? c.nbPlaces : (c.places || 0);',
        'totPlaces += places;',
      '});',
      'if(sum) sum.textContent = conds.length + " voiture(s) • " + totPlaces + " place(s) dispo";',
      'if(conds.length === 0 && pass.length === 0){',
        'cont.innerHTML = "<div style=\'font-size:0.75rem;color:#64748b;text-align:center;padding:16px;\'>Aucun trajet proposé pour le moment.<br>Soyez le premier à proposer votre voiture !</div>";',
        'return;',
      '}',
      'var html = "";',
      'if(conds.length > 0){',
        'html += "<div style=\'font-size:0.75rem;font-weight:700;color:#38bdf8;margin-bottom:6px;\'>🚙 Conducteurs :</div>";',
        'conds.forEach(function(c){',
          'var pDispo = (c.nbPlaces !== undefined && c.nbPlaces !== null) ? c.nbPlaces : (c.places || 0);',
          'html += "<div class=\'covoit-card\'><div style=\'display:flex;justify-content:space-between;align-items:center;\'><span style=\'font-weight:800;font-size:0.84rem;color:#f8fafc;\'>🚘 " + c.nom + "</span><span style=\'font-size:0.72rem;background:rgba(2,132,199,0.25);color:#7dd3fc;padding:2px 8px;border-radius:99px;font-weight:700;\'>" + pDispo + " place(s) dispo</span></div>";',
          'if(c.passagers && c.passagers.length > 0){',
            'html += "<div style=\'font-size:0.7rem;color:#94a3b8;margin-top:4px;\'>Passagers à bord : " + c.passagers.join(", ") + "</div>";',
          '}',
          'html += "</div>";',
        '});',
      '}',
      'if(pass.length > 0){',
        'html += "<div style=\'font-size:0.75rem;font-weight:700;color:#fcd34d;margin:10px 0 6px 0;\'>🙋 Cherchent une place :</div>";',
        'html += "<div style=\'display:flex;gap:4px;flex-wrap:wrap;\'>";',
        'pass.forEach(function(p){',
          'html += "<span style=\'font-size:0.72rem;background:#0e1626;border:1px solid rgba(255,255,255,0.1);padding:4px 8px;border-radius:8px;color:#e2e8f0;\'>👤 " + p.nom + "</span>";',
        '});',
        'html += "</div>";',
      '}',
      'cont.innerHTML = html;',
    '}',
    'function reinitialiserCovoiturageParCoach(){',
      'if(!confirm("Réinitialiser l\'organisation du covoiturage pour ce match ?")) return;',
      'google.script.run.withSuccessHandler(function(res){',
        'COVOITURAGE_DATA = { conducteurs: [], passagers: [] };',
        'rendreCovoiturageList();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Covoiturage réinitialisé.", "info");',
      '}).reinitialiserCovoiturage(SESSION_TEL, SESSION_PIN);',
    '}',
    'function reinitialiserFormAbsence(){',
      'ID_ABSENCE_EN_COURS = null;',
      'var bSub = document.getElementById("btnSubmitAbsence");',
      'if(bSub){ bSub.textContent = "Transmettre mon absence au coach"; bSub.style.background = "#ef4444"; bSub.disabled = false; }',
      'var bAnn = document.getElementById("btnAnnulerEditAbsence");',
      'if(bAnn) bAnn.style.display = "none";',
      'var st = document.getElementById("statusAbsence"); if(st) st.textContent = "";',
    '}',
    'function ouvrirModalAbsence(){',
      'reinitialiserFormAbsence();',
      'var dDeb = document.getElementById("inpAbsenceDebut");',
      'var dFin = document.getElementById("inpAbsenceFin");',
      'var now = new Date();',
      'var sDate = now.toISOString().split("T")[0];',
      'if(dDeb && !dDeb.value) dDeb.value = sDate;',
      'if(dFin && !dFin.value) dFin.value = sDate;',
      'document.getElementById("statusAbsence").textContent = "";',
      'rendreMesAbsences();',
      'document.getElementById("modalAbsenceBg").style.display = "flex";',
    '}',
    'function fermerModalAbsence(){ document.getElementById("modalAbsenceBg").style.display = "none"; reinitialiserFormAbsence(); }',
    'function fermerModalAbsenceSurBg(e){ if(e.target.id === "modalAbsenceBg") fermerModalAbsence(); }',
    'function editerAbsenceClient(id){',
      'var a = (MES_ABSENCES || []).find(function(x){ return String(x.id) === String(id); });',
      'if(!a) return;',
      'ID_ABSENCE_EN_COURS = a.id;',
      'if(document.getElementById("inpAbsenceDebut")) document.getElementById("inpAbsenceDebut").value = a.dateDebut;',
      'if(document.getElementById("inpAbsenceFin")) document.getElementById("inpAbsenceFin").value = a.dateFin;',
      'if(document.getElementById("selAbsenceMotif")) document.getElementById("selAbsenceMotif").value = a.motif;',
      'var bSub = document.getElementById("btnSubmitAbsence");',
      'if(bSub){ bSub.textContent = "💾 Enregistrer la modification"; bSub.style.background = "#0284c7"; }',
      'var bAnn = document.getElementById("btnAnnulerEditAbsence");',
      'if(bAnn) bAnn.style.display = "inline-block";',
      'afficherToast("Modifiez les dates ou le motif puis enregistrez.", "info", 2000);',
    '}',
    'function supprimerAbsenceClient(id){',
      'if(!id){ afficherToast("Identifiant d\'absence introuvable.", "erreur"); return; }',
      'if(!confirm("Voulez-vous vraiment supprimer cette déclaration d\'absence ?")) return;',
      'afficherLoading("Suppression...", "Mise à jour de vos absences...");',
      'google.script.run.withSuccessHandler(function(res){',
        'masquerLoading();',
        'MES_ABSENCES = res.absences || MES_ABSENCES;',
        'reinitialiserFormAbsence();',
        'rendreMesAbsences();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Déclaration d\'absence supprimée avec succès.", "succes");',
      '}).withFailureHandler(function(err){',
        'masquerLoading();',
        'afficherToast("Erreur suppression : " + err.message, "erreur");',
      '}).supprimerAbsenceJoueur(SESSION_TEL, SESSION_PIN, id);',
    '}',
    'function declarerNouvelleAbsence(){',
      'var deb = document.getElementById("inpAbsenceDebut").value;',
      'var fin = document.getElementById("inpAbsenceFin").value;',
      'var motif = document.getElementById("selAbsenceMotif").value;',
      'if(!deb || !fin){ afficherToast("Veuillez renseigner les dates de début et de fin.", "erreur"); return; }',
      'var status = document.getElementById("statusAbsence");',
      'var bSub = document.getElementById("btnSubmitAbsence");',
      'if(status) status.textContent = "Enregistrement de votre absence...";',
      'if(bSub){ bSub.disabled = true; bSub.textContent = "⏳ Enregistrement..."; }',
      'google.script.run.withSuccessHandler(function(res){',
        'if(bSub) bSub.disabled = false;',
        'reinitialiserFormAbsence();',
        'if(status) status.textContent = "Absence enregistrée avec succès !";',
        'MES_ABSENCES = res.absences || MES_ABSENCES;',
        'rendreMesAbsences();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Absence déclarée et enregistrée !", "succes");',
      '}).withFailureHandler(function(err){',
        'if(bSub) bSub.disabled = false;',
        'if(status) status.textContent = "Erreur : " + err.message;',
        'afficherToast(err.message, "erreur");',
      '}).declarerAbsenceJoueur(SESSION_TEL, SESSION_PIN, deb, fin, motif, ID_ABSENCE_EN_COURS);',
    '}',
    'function rendreMesAbsences(){',
      'var cont = document.getElementById("mesAbsencesList"); if(!cont) return;',
      'var titre = document.getElementById("titreListeAbsences");',
      'var listeAffichee = [];',
      'if(EST_COACH){',
        'if(titre) titre.textContent = "📋 Absences déclarées par les joueurs";',
        'listeAffichee = MES_ABSENCES || [];',
      '} else {',
        'if(titre) titre.textContent = "📋 Mes déclarations en cours";',
        'listeAffichee = (MES_ABSENCES || []).filter(function(a){ return String(a.nom || "").toLowerCase() === String(SESSION_NOM || "").toLowerCase(); });',
      '}',
      'if(listeAffichee.length === 0){',
        'cont.innerHTML = "<div style=\'font-size:0.75rem;color:#64748b;text-align:center;padding:12px;\'>Aucune absence enregistrée.</div>";',
        'return;',
      '}',
      'var html = "";',
      'listeAffichee.forEach(function(a){',
        'var dStr = (a.dateDebut === a.dateFin) ? ("Le " + a.dateDebut) : ("Du " + a.dateDebut + " au " + a.dateFin);',
        'var nomTxt = EST_COACH ? ("<b>" + a.nom + "</b> • ") : "";',
        'var estMoi = String(a.nom || "").toLowerCase() === String(SESSION_NOM || "").toLowerCase();',
        'html += "<div class=\'absence-chip\' style=\'display:flex;justify-content:space-between;align-items:center;\'>";',
        'html += "<div><div>" + nomTxt + dStr + "</div><div style=\'font-size:0.72rem;color:#fecaca;margin-top:2px;\'>Motif : " + a.motif + "</div></div>";',
        'if(estMoi || EST_COACH){',
          'html += "<div style=\'display:flex;gap:4px;flex-shrink:0;margin-left:8px;\'>";',
          'html += "<button type=\'button\' class=\'btn-reset\' style=\'padding:3px 7px;font-size:0.75rem;color:#38bdf8;border-color:rgba(56,189,248,0.3);\' onclick=\'editerAbsenceClient(\\\"" + (a.id || "") + "\\\")\' title=\'Modifier\'>✏️</button>";',
          'html += "<button type=\'button\' class=\'btn-reset\' style=\'padding:3px 7px;font-size:0.75rem;color:#f87171;border-color:rgba(239,68,68,0.3);\' onclick=\'supprimerAbsenceClient(\\\"" + (a.id || "") + "\\\")\' title=\'Supprimer\'>🗑️</button>";',
          'html += "</div>";',
        '}',
        'html += "</div>";',
      '});',
      'cont.innerHTML = html;',
    '}',
    'function ouvrirProfilJoueurPublic(nomBrut){',
      'if(!nomBrut) return;',
      'var nom = decodeURIComponent(nomBrut);',
      'var nClean = String(nom).trim();',
      'var nLow = nClean.toLowerCase();',
      'var nSimple = nLow.replace(/\\s*\\([^)]*\\)\\s*/g, "").trim();',
      'var jObj = (EFFECTIF_COMPLET || []).find(function(x){',
        'var xL = String(x.nom || "").trim().toLowerCase();',
        'return xL === nLow || xL.replace(/\\s*\\([^)]*\\)\\s*/g, "").trim() === nSimple;',
      '}) || (JOUEURS || []).find(function(x){',
        'var xL = String(x.nom || "").trim().toLowerCase();',
        'return xL === nLow || xL.replace(/\\s*\\([^)]*\\)\\s*/g, "").trim() === nSimple;',
      '}) || { nom: nClean, poste: "Demi-Centre", photo: "", entrainements: 0 };',
      'var elNom = document.getElementById("profilPublicNom");',
      'var elPoste = document.getElementById("profilPublicPosteBadge");',
      'var elEq = document.getElementById("profilPublicEquipeBadge");',
      'var elAssid = document.getElementById("profilPublicAssiduiteBadge");',
      'var elImg = document.getElementById("profilPublicImg");',
      'var elInit = document.getElementById("profilPublicInitiale");',
      'var elBdrop = document.getElementById("profilPublicBackdrop");',
      'if(elNom) elNom.textContent = jObj.nom;',
      'if(elPoste) elPoste.textContent = "📍 " + (jObj.poste || "Demi-Centre");',
      'if(elEq) elEq.textContent = jObj.equipe ? ("Équipe : " + jObj.equipe) : "";',
      'var nbTr = (jObj.entrainements !== undefined && jObj.entrainements !== null) ? Number(jObj.entrainements) : 0;',
      'if(elAssid) elAssid.textContent = "⚡ " + nbTr + " séance" + (nbTr > 1 ? "s" : "") + " cette semaine";',
      'var jInitial = (jObj.nom || "").trim().charAt(0).toUpperCase() || "?";',
      'if(elInit) elInit.textContent = jInitial;',
      'if(jObj.photo){',
        'if(elImg){ elImg.src = jObj.photo; elImg.style.display = "block"; }',
        'if(elInit) elInit.style.display = "none";',
        'if(elBdrop){ elBdrop.style.backgroundImage = "url(\'" + jObj.photo + "\')"; elBdrop.style.display = "block"; }',
      '} else {',
        'if(elImg) elImg.style.display = "none";',
        'if(elInit) elInit.style.display = "flex";',
        'if(elBdrop) elBdrop.style.display = "none";',
      '}',
      'var cData = CAISSE_NOIRE_DATA || {};',
      'var allAmendes = (cData.amendes || []).filter(function(a){',
        'var aNom = String(a.nomJoueur || "").trim().toLowerCase();',
        'return aNom === nLow || aNom.replace(/\\s*\\([^)]*\\)\\s*/g, "").trim() === nSimple;',
      '});',
      'var totalAm = 0, totalDu = 0;',
      'allAmendes.forEach(function(a){',
        'var mnt = Number(a.montant) || 0;',
        'totalAm += mnt;',
        'if(a.statut === "impaye") totalDu += mnt;',
      '});',
      'var elTotAm = document.getElementById("profilPublicTotalAmendes");',
      'var elResteDu = document.getElementById("profilPublicResteDu");',
      'var elSt = document.getElementById("profilPublicCaisseStatut");',
      'var elList = document.getElementById("profilPublicAmendesList");',
      'if(elTotAm) elTotAm.textContent = totalAm + " €";',
      'if(elResteDu) elResteDu.textContent = totalDu + " €";',
      'if(elSt){',
        'if(totalDu === 0){',
          'elSt.textContent = "À jour ✅";',
          'elSt.style.background = "rgba(34,197,94,0.2)";',
          'elSt.style.color = "#86efac";',
        '} else {',
          'elSt.textContent = "Dû : " + totalDu + " € 🚨";',
          'elSt.style.background = "rgba(239,68,68,0.2)";',
          'elSt.style.color = "#fca5a5";',
        '}',
      '}',
      'if(elList){',
        'if(allAmendes.length === 0){',
          'elList.innerHTML = "<div style=\'color:#64748b;font-style:italic;padding:6px 0;text-align:center;\'>Aucune amende enregistrée. Joueur exemplaire !</div>";',
        '} else {',
          'var html = "";',
          'allAmendes.forEach(function(a){',
            'var isPaye = a.statut === "paye";',
            'var isAttente = a.statut === "en_attente";',
            'var bIcon = isPaye ? "✅" : (isAttente ? "⏳" : "🚨");',
            'var cClr = isPaye ? "#86efac" : (isAttente ? "#fde047" : "#fca5a5");',
            'html += "<div style=\'display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);\'>" +',
                    '"<span>" + a.motif + " <span style=\'color:#94a3b8;font-size:0.68rem;\'>(" + (a.date || "") + ")</span></span>" +',
                    '"<span style=\'font-weight:700;color:" + cClr + ";\'>" + a.montant + " € " + bIcon + "</span>" +',
                    '"</div>";',
          '});',
          'elList.innerHTML = html;',
        '}',
      '}',
      'var bg = document.getElementById("modalProfilJoueurPublicBg");',
      'if(bg) bg.style.display = "flex";',
    '}',
    'function fermerProfilJoueurPublic(){',
      'var bg = document.getElementById("modalProfilJoueurPublicBg");',
      'if(bg) bg.style.display = "none";',
    '}',
    'function fermerProfilJoueurPublicSurBg(e){',
      'if(e.target.id === "modalProfilJoueurPublicBg") fermerProfilJoueurPublic();',
    '}',
    'function ouvrirModalCaisseNoire(){',
      'remplirSelectsCaisse();',
      'rendreCaisseNoireVues();',
      'var bAdm = document.getElementById("btnAccesAdminCaisse");',
      'if(bAdm) bAdm.style.display = (EST_COACH || EST_TRESORIER) ? "block" : "none";',
      'document.getElementById("modalCaisseNoireBg").style.display = "flex";',
    '}',
    'function fermerModalCaisseNoire(){ document.getElementById("modalCaisseNoireBg").style.display = "none"; }',
    'function fermerModalCaisseNoireSurBg(e){ if(e.target.id === "modalCaisseNoireBg") fermerModalCaisseNoire(); }',
    'function basculerTabCaisse(tabKey){',
      'var tabs = ["cagnotte", "ardoise", "bareme", "classement"];',
      'tabs.forEach(function(t){',
        'var btn = document.getElementById("tabCaisse" + t.charAt(0).toUpperCase() + t.slice(1));',
        'var v = document.getElementById("vueCaisse" + t.charAt(0).toUpperCase() + t.slice(1));',
        'if(btn) btn.className = (t === tabKey) ? "train-type-pill active" : "train-type-pill";',
        'if(v) v.style.display = (t === tabKey) ? "block" : "none";',
      '});',
      'if(tabKey === "bareme") filtrerBaremeCaisse("");',
    '}',
    'function remplirSelectsCaisse(){',
      'var selBalJ = document.getElementById("selBalanceJoueur");',
      'var selBalB = document.getElementById("selBalanceBareme");',
      'if(selBalJ){',
        'selBalJ.innerHTML = "<option value=\'\'>-- Choisir un coéquipier --</option>";',
        '(EFFECTIF_COMPLET || []).slice().sort(function(a,b){ return String(a.nom||"").localeCompare(String(b.nom||"")); }).forEach(function(j){',
          'var opt = document.createElement("option"); opt.value = j.nom; opt.textContent = j.nom + " (" + (j.poste||"Demi-Centre") + ")"; selBalJ.appendChild(opt);',
        '});',
      '}',
      'if(selBalB){',
        'selBalB.innerHTML = "<option value=\'\'>-- Choisir un motif du barème --</option>";',
        'var bareme = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config && CAISSE_NOIRE_DATA.config.bareme) || [];',
        'bareme.forEach(function(b){',
          'var opt = document.createElement("option"); opt.value = b.titre; opt.setAttribute("data-montant", b.montant); opt.textContent = b.titre + " (" + b.montant + " €)"; selBalB.appendChild(opt);',
        '});',
      '}',
    '}',
    'function rendreCaisseNoireVues(){',
      'var stats = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats) || { soldeCaisse: 0, totalCollecte: 0, totalDu: 0, totalDepenses: 0 };',
      'var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) || { objectifCagnotte: 300, objectifDescription: "", moyenPaiement: "Lydia / Espèces" };',
      'var sM = document.getElementById("caisseSoldeMontant"); if(sM) sM.textContent = stats.soldeCaisse + " €";',
      'var tC = document.getElementById("caisseTotalCollecte"); if(tC) tC.textContent = "Encaissé : " + stats.totalCollecte + " €";',
      'var tI = document.getElementById("caisseTotalImpaye"); if(tI) tI.textContent = "Restant dû : " + stats.totalDu + " €";',
      'var tD = document.getElementById("caisseTotalDepenses"); if(tD) tD.textContent = "Dépenses : " + stats.totalDepenses + " €";',
      'var objC = Number(cfg.objectifCagnotte) || 300;',
      'var ratio = Math.min(100, Math.max(0, Math.round((stats.soldeCaisse / objC) * 100)));',
      'var ratEl = document.getElementById("caisseObjectifRatio"); if(ratEl) ratEl.textContent = stats.soldeCaisse + " / " + objC + " € (" + ratio + "%)";',
      'var barEl = document.getElementById("caisseObjectifBarre"); if(barEl) barEl.style.width = ratio + "%";',
      'var descEl = document.getElementById("caisseObjectifDesc"); if(descEl) descEl.textContent = cfg.objectifDescription || "Objectif cagnotte pour les événements et repas de l\'équipe.";',
      'var mpEl = document.getElementById("caisseMoyenPaiement"); if(mpEl) mpEl.textContent = cfg.moyenPaiement || "Lydia / Espèces au vestiaire auprès du trésorier.";',
      'var mesAmendes = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.amendes) ? CAISSE_NOIRE_DATA.amendes.filter(function(a){ return String(a.nomJoueur || "").toLowerCase() === (SESSION_NOM || "").toLowerCase(); }) : [];',
      'var totalDuMoi = 0;',
      'mesAmendes.filter(function(a){ return a.statut === "impaye"; }).forEach(function(a){ totalDuMoi += (Number(a.montant) || 0); });',
      'var monDuEl = document.getElementById("caisseMonMontantDu"); if(monDuEl) monDuEl.textContent = totalDuMoi + " €";',
      'var monMsgEl = document.getElementById("caisseMonMessageArdoise");',
      'if(monMsgEl){',
        'if(totalDuMoi > 0){ monMsgEl.textContent = "Vous avez " + totalDuMoi + " € à régler à la caisse noire. Pensez à payer par Lydia ou en espèces !"; monMsgEl.style.color = "#fca5a5"; }',
        'else { monMsgEl.textContent = "Vous êtes à jour de vos amendes ! Bravo 🟢"; monMsgEl.style.color = "#86efac"; }',
      '}',
      'var mesList = document.getElementById("caisseMesAmendesList");',
      'if(mesList){',
        'if(mesAmendes.length === 0){',
          'mesList.innerHTML = "<div style=\'text-align:center;color:#64748b;font-size:0.75rem;padding:14px;\'>Aucune amende enregistrée à votre nom pour le moment. Félicitations !</div>";',
        '} else {',
          'var htmlA = "";',
          'mesAmendes.forEach(function(a){',
            'var isPaye = a.statut === "paye";',
            'var isAttente = a.statut === "en_attente";',
            'var stBadge = isPaye ? "<span style=\'font-size:0.68rem;background:rgba(34,197,94,0.2);color:#86efac;padding:2px 7px;border-radius:99px;font-weight:700;\'>Payé ✅</span>" : (isAttente ? "<span style=\'font-size:0.68rem;background:rgba(234,179,8,0.2);color:#fde047;padding:2px 7px;border-radius:99px;font-weight:700;\'>En attente ⏳</span>" : "<span style=\'font-size:0.68rem;background:rgba(239,68,68,0.2);color:#fca5a5;padding:2px 7px;border-radius:99px;font-weight:700;\'>À régler 🚨</span>");',
            'htmlA += "<div style=\'background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;text-align:left;\'>";',
            'htmlA += "<div><div style=\'font-weight:700;font-size:0.8rem;color:#f8fafc;\'>" + a.motif + "</div><div style=\'font-size:0.7rem;color:#94a3b8;\'>" + (a.date || "") + (a.commentaire ? (" • " + a.commentaire) : "") + "</div></div>";',
            'htmlA += "<div style=\'text-align:right;\'><div style=\'font-weight:800;font-size:0.9rem;color:#fde047;\'>" + a.montant + " €</div>" + stBadge + "</div>";',
            'htmlA += "</div>";',
          '});',
          'mesList.innerHTML = htmlA;',
        '}',
      '}',
      'var lList = document.getElementById("caisseLeaderboardList");',
      'if(lList){',
        'var lead = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.leaderboard) || [];',
        'if(lead.length === 0){',
          'lList.innerHTML = "<div style=\'text-align:center;color:#64748b;font-size:0.75rem;padding:16px;\'>Aucune amende validée pour le moment. L\'équipe est sage !</div>";',
        '} else {',
          'var htmlL = "";',
          'lead.forEach(function(j, idx){',
            'var med = idx === 0 ? "🥇" : (idx === 1 ? "🥈" : (idx === 2 ? "🥉" : ("#" + (idx + 1))));',
            'var isMoi = String(j.nom || "").toLowerCase() === (SESSION_NOM || "").toLowerCase();',
            'htmlL += "<div onclick=\\"ouvrirProfilJoueurPublic(\'" + encodeURIComponent(j.nom).replace(/\'/g, "%27") + "\')\\" title=\\"Cliquer pour voir le profil\\" style=\'cursor:pointer;background:" + (isMoi ? "rgba(234,179,8,0.12)" : "#090d16") + ";border:1px solid " + (isMoi ? "#eab308" : "rgba(255,255,255,0.08)") + ";border-radius:12px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;text-align:left;transition:transform 0.15s,border-color 0.15s;\' onmouseenter=\\"this.style.borderColor=\'var(--color-primary)\';\\" onmouseleave=\\"this.style.borderColor=\'" + (isMoi ? "#eab308" : "rgba(255,255,255,0.08)") + "\';\\">";',
            'htmlL += "<div style=\'display:flex;align-items:center;gap:8px;\'><span style=\'font-size:1.1rem;\'>" + med + "</span><div><div style=\'font-weight:800;font-size:0.84rem;color:#f8fafc;\'>" + j.nom + (isMoi ? " <span style=\'color:#fde047;font-size:0.7rem;\'>[Moi]</span>" : "") + " <span style=\'font-size:0.7rem;color:var(--color-secondary);opacity:0.85;\'>👁️ Profil</span></div><div style=\'font-size:0.7rem;color:#94a3b8;\'>" + j.nbAmendes + " amende(s) • " + (j.totalPaye || 0) + " € réglés</div></div></div>";',
            'htmlL += "<div style=\'text-align:right;\'><div style=\'font-weight:900;font-size:0.95rem;color:#fde047;\'>" + j.totalAmendes + " €</div><div style=\'font-size:0.68rem;color:" + (j.totalDu > 0 ? "#f87171" : "#86efac") + ";\'>" + (j.totalDu > 0 ? ("Dû : " + j.totalDu + " €") : "À jour ✅") + "</div></div>";',
            'htmlL += "</div>";',
          '});',
          'lList.innerHTML = htmlL;',
        '}',
      '}',
    '}',
    'function copierInfosPaiementCaisse(){',
      'var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) || {};',
      'var txt = "💰 Règlement Caisse Noire : " + (cfg.moyenPaiement || "Lydia / Espèces au vestiaire");',
      'if(navigator.clipboard && navigator.clipboard.writeText){',
        'navigator.clipboard.writeText(txt).then(function(){ afficherToast("Coordonnées de paiement copiées !", "succes"); });',
      '} else { afficherToast("Coordonnées : " + txt, "info"); }',
    '}',
    'function filtrerBaremeCaisse(q){',
      'var cont = document.getElementById("caisseBaremeList"); if(!cont) return;',
      'var bareme = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config && CAISSE_NOIRE_DATA.config.bareme) || [];',
      'var qLow = String(q || "").toLowerCase().trim();',
      'var filtres = bareme.filter(function(b){ return !qLow || String(b.titre || "").toLowerCase().includes(qLow) || String(b.categorie || "").toLowerCase().includes(qLow); });',
      'if(filtres.length === 0){',
        'cont.innerHTML = "<div style=\'text-align:center;color:#64748b;font-size:0.75rem;padding:14px;\'>Aucune règle correspondante trouvée.</div>";',
        'return;',
      '}',
      'var html = "";',
      'filtres.forEach(function(b){',
        'html += "<div style=\'background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;\'>";',
        'html += "<div><div style=\'font-weight:700;font-size:0.82rem;color:#f8fafc;\'>" + b.titre + "</div><div style=\'font-size:0.68rem;color:var(--color-secondary);\'>" + (b.categorie || "Amende") + "</div></div>";',
        'html += "<div style=\'font-weight:900;font-size:0.95rem;color:#fde047;background:rgba(234,179,8,0.15);padding:3px 9px;border-radius:99px;border:1px solid rgba(234,179,8,0.3);\'>" + b.montant + " €</div>";',
        'html += "</div>";',
      '});',
      'cont.innerHTML = html;',
    '}',
    'function ouvrirFormulaireBalance(){',
      'var box = document.getElementById("boxFormulaireBalance"); if(box) box.style.display = "block";',
      'var sJ = document.getElementById("selBalanceJoueur"); if(sJ && SESSION_NOM) sJ.value = SESSION_NOM;',
      'ajusterMontantBalance();',
    '}',
    'function fermerFormulaireBalance(){ var box = document.getElementById("boxFormulaireBalance"); if(box) box.style.display = "none"; }',
    'function ajusterMontantBalance(){',
      'var sel = document.getElementById("selBalanceBareme"); var inp = document.getElementById("inpBalanceMontant");',
      'if(!sel || !inp) return;',
      'var opt = sel.options[sel.selectedIndex];',
      'var mnt = opt ? opt.getAttribute("data-montant") : 1;',
      'if(mnt) inp.value = mnt;',
    '}',
    'function soumettreSignalementBalance(){',
      'var j = document.getElementById("selBalanceJoueur").value;',
      'var b = document.getElementById("selBalanceBareme").value;',
      'var m = parseFloat(document.getElementById("inpBalanceMontant").value) || 1;',
      'var c = document.getElementById("inpBalanceCommentaire").value;',
      'if(!j){ afficherToast("Veuillez sélectionner le joueur concerné.", "erreur"); return; }',
      'if(!b){ afficherToast("Veuillez choisir un motif du barème.", "erreur"); return; }',
      'var st = document.getElementById("statusBalance"); if(st) st.textContent = "Envoi du signalement...";',
      'google.script.run.withSuccessHandler(function(res){',
        'if(st) st.textContent = "";',
        'CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;',
        'fermerFormulaireBalance();',
        'rendreCaisseNoireVues();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Amende signalée au trésorier avec succès !", "succes");',
      '}).withFailureHandler(function(err){',
        'if(st) st.textContent = "Erreur : " + err.message;',
        'afficherToast(err.message, "erreur");',
      '  }).signalerAmendeJoueur(SESSION_TEL, SESSION_PIN, j, b, m, c);',
    '}',
    'function ouvrirModalAdminCaisseNoire(){',
      'if(!EST_COACH && !EST_TRESORIER){',
        'afficherToast("Accès réservé au coach et aux trésoriers désignés.", "erreur");',
        'return;',
      '}',
      'remplirSelectsAdminCaisse();',
      'rendreAdminCaisseVues();',
      'document.getElementById("modalAdminCaisseNoireBg").style.display = "flex";',
    '}',
    'function fermerModalAdminCaisseNoire(){ document.getElementById("modalAdminCaisseNoireBg").style.display = "none"; }',
    'function fermerModalAdminCaisseNoireSurBg(e){ if(e.target.id === "modalAdminCaisseNoireBg") fermerModalAdminCaisseNoire(); }',
    'function basculerTabAdminCaisse(tabKey){',
      'var tabs = ["infliger", "attente", "encaissements", "depenses", "bareme", "whatsapp"];',
      'tabs.forEach(function(t){',
        'var btn = document.getElementById("tabAdm" + t.charAt(0).toUpperCase() + t.slice(1));',
        'var v = document.getElementById("vueAdm" + t.charAt(0).toUpperCase() + t.slice(1));',
        'if(btn) btn.className = (t === tabKey) ? "train-type-pill active" : "train-type-pill";',
        'if(v) v.style.display = (t === tabKey) ? "block" : "none";',
      '});',
      'if(tabKey === "whatsapp") actualiserBilanTexteWhatsApp();',
    '}',
    'function remplirSelectsAdminCaisse(){',
      'var selJ = document.getElementById("selAdmJoueurs");',
      'var selB = document.getElementById("selAdmBareme");',
      'if(selJ){',
        'selJ.innerHTML = "<option value=\'\'>-- Choisir un joueur --</option>";',
        '(EFFECTIF_COMPLET || []).slice().sort(function(a,b){ return String(a.nom||"").localeCompare(String(b.nom||"")); }).forEach(function(j){',
          'var opt = document.createElement("option"); opt.value = j.nom; opt.textContent = j.nom + " (" + (j.poste||"Demi-Centre") + ")"; selJ.appendChild(opt);',
        '});',
      '}',
      'if(selB){',
        'selB.innerHTML = "<option value=\'\'>-- Choisir un motif du barème --</option>";',
        'var bareme = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config && CAISSE_NOIRE_DATA.config.bareme) || [];',
        'bareme.forEach(function(b){',
          'var opt = document.createElement("option"); opt.value = b.titre; opt.setAttribute("data-montant", b.montant); opt.textContent = b.titre + " (" + b.montant + " €)"; selB.appendChild(opt);',
        '});',
      '}',
      'var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) || {};',
      'var inpC = document.getElementById("inpAdmCagnotteCible"); if(inpC) inpC.value = cfg.objectifCagnotte || 300;',
      'var inpD = document.getElementById("inpAdmObjectifDesc"); if(inpD) inpD.value = cfg.objectifDescription || "Resto & Tournée de fin d\'année";',
      'var inpM = document.getElementById("inpAdmMoyenPaiement"); if(inpM) inpM.value = cfg.moyenPaiement || "Lydia / Espèces au vestiaire";',
    '}',
    'function ajusterMontantAdmin(){',
      'var sel = document.getElementById("selAdmBareme"); var inp = document.getElementById("inpAdmMontant");',
      'if(!sel || !inp) return;',
      'var opt = sel.options[sel.selectedIndex];',
      'var mnt = opt ? opt.getAttribute("data-montant") : 1;',
      'if(mnt) inp.value = mnt;',
    '}',
    'function basculerModePaiementAdmin(){',
      'var st = document.getElementById("selAdmStatut").value;',
      'var box = document.getElementById("boxAdmModePaiement");',
      'if(box) box.style.display = (st === "paye") ? "block" : "none";',
    '}',
    'function rendreAdminCaisseVues(){',
      'var stats = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats) || { soldeCaisse: 0, totalCollecte: 0, totalDu: 0, totalEnAttente: 0 };',
      'var elS = document.getElementById("admStatEnCaisse"); if(elS) elS.textContent = stats.soldeCaisse + " €";',
      'var elC = document.getElementById("admStatEncaisse"); if(elC) elC.textContent = stats.totalCollecte + " €";',
      'var elI = document.getElementById("admStatImpaye"); if(elI) elI.textContent = stats.totalDu + " €";',
      'var elA = document.getElementById("admStatEnAttente"); if(elA) elA.textContent = stats.totalEnAttente || 0;',
      'var bAtt = document.getElementById("badgeNbEnAttente");',
      'if(bAtt){',
        'if(stats.totalEnAttente > 0){ bAtt.textContent = stats.totalEnAttente; bAtt.style.display = "inline"; }',
        'else { bAtt.style.display = "none"; }',
      '}',
      'var attList = document.getElementById("admListeEnAttente");',
      'if(attList){',
        'var enAtt = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.amendes) ? CAISSE_NOIRE_DATA.amendes.filter(function(a){ return a.statut === "en_attente"; }) : [];',
        'if(enAtt.length === 0){',
          'attList.innerHTML = "<div style=\'text-align:center;color:#64748b;font-size:0.75rem;padding:16px;\'>Aucune amende en attente de validation. Tout est à jour !</div>";',
        '} else {',
          'var htmlAtt = "";',
          'enAtt.forEach(function(a){',
            'htmlAtt += "<div style=\'background:#090d16;border:1px solid rgba(245,158,11,0.3);border-radius:12px;padding:10px;margin-bottom:8px;\'>";',
            'htmlAtt += "<div style=\'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;\'><div><b style=\'color:#fde047;font-size:0.88rem;\'>" + a.nomJoueur + "</b> <span style=\'color:#94a3b8;font-size:0.7rem;\'>(" + (a.date||"") + ")</span></div><span style=\'font-weight:900;font-size:1rem;color:#fde047;\'>" + a.montant + " €</span></div>";',
            'htmlAtt += "<div style=\'font-size:0.78rem;color:#e2e8f0;margin-bottom:2px;\'>" + a.motif + "</div>";',
            'if(a.commentaire) htmlAtt += "<div style=\'font-size:0.72rem;color:#cbd5e1;font-style:italic;margin-bottom:4px;\'>« " + a.commentaire + " »</div>";',
            'htmlAtt += "<div style=\'font-size:0.68rem;color:#94a3b8;margin-bottom:8px;\'>Signalé par : " + (a.signalePar || "Coéquipier") + "</div>";',
            'htmlAtt += "<div style=\'display:flex;gap:6px;\'><button type=\'button\' class=\'btn-save\' style=\'flex:1;padding:5px 8px;font-size:0.75rem;background:#15803d;\' onclick=\'validerSignalementAdmin(\\\"" + a.id + "\\\", \\\"valider\\\")\'>✅ Valider (Ajouter dette)</button><button type=\'button\' class=\'btn-reset\' style=\'padding:5px 8px;font-size:0.75rem;color:#f87171;\' onclick=\'validerSignalementAdmin(\\\"" + a.id + "\\\", \\\"rejeter\\\")\'>❌ Rejeter</button></div>";',
            'htmlAtt += "</div>";',
          '});',
          'attList.innerHTML = htmlAtt;',
        '}',
      '}',
      'var debList = document.getElementById("admListeDebiteurs");',
      'if(debList){',
        'var lead = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.leaderboard) ? CAISSE_NOIRE_DATA.leaderboard.filter(function(j){ return j.totalDu > 0; }) : [];',
        'if(lead.length === 0){',
          'debList.innerHTML = "<div style=\'text-align:center;color:#64748b;font-size:0.75rem;padding:16px;\'>Aucun impayé ! Tous les joueurs sont à jour de leur ardoise. 🟢</div>";',
        '} else {',
          'var htmlDeb = "";',
          'lead.forEach(function(j){',
            'htmlDeb += "<div style=\'background:#090d16;border:1px solid rgba(239,68,68,0.25);border-radius:12px;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;\'>";',
            'htmlDeb += "<div><div style=\'font-weight:800;font-size:0.86rem;color:#f8fafc;\'>" + j.nom + "</div><div style=\'font-size:0.72rem;color:#f87171;\'>Dette en cours : <b>" + j.totalDu + " €</b> (" + j.nbAmendes + " amende(s))</div></div>";',
            'htmlDeb += "<button type=\'button\' class=\'btn-enter\' style=\'margin:0;padding:6px 10px;font-size:0.75rem;background:#16a34a;color:#fff;font-weight:800;\' onclick=\'encaisserToutPourJoueur(\\\"" + j.nom + "\\\")\'>💵 Encaisser " + j.totalDu + " €</button>";',
            'htmlDeb += "</div>";',
          '});',
          'debList.innerHTML = htmlDeb;',
        '}',
      '}',
      'var depList = document.getElementById("admListeDepenses");',
      'if(depList){',
        'var deps = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.depenses) || [];',
        'if(deps.length === 0){',
          'depList.innerHTML = "<div style=\'text-align:center;color:#64748b;font-size:0.75rem;padding:12px;\'>Aucune dépense enregistrée.</div>";',
        '} else {',
          'var htmlDep = "";',
          'deps.forEach(function(d){',
            'htmlDep += "<div style=\'background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px 10px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;\'>";',
            'htmlDep += "<div><span style=\'font-weight:700;font-size:0.8rem;color:#f8fafc;\'>" + d.motif + "</span> <span style=\'color:#94a3b8;font-size:0.68rem;\'>(" + (d.date||"") + ")</span></div>";',
            'htmlDep += "<span style=\'font-weight:800;font-size:0.85rem;color:#f87171;\'>-" + d.montant + " €</span>";',
            'htmlDep += "</div>";',
          '});',
          'depList.innerHTML = htmlDep;',
        '}',
      '}',
      'var barEditList = document.getElementById("admListeBaremeEditer");',
      'if(barEditList){',
        'var bar = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config && CAISSE_NOIRE_DATA.config.bareme) || [];',
        'var htmlB = "";',
        'bar.forEach(function(b){',
          'htmlB += "<div style=\'background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:6px 10px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;\'>";',
          'htmlB += "<div><span style=\'font-size:0.78rem;color:#f8fafc;\'>" + b.titre + "</span> <span style=\'color:var(--color-secondary);font-size:0.68rem;\'>[" + (b.categorie||"") + "]</span></div>";',
          'htmlB += "<div style=\'display:flex;align-items:center;gap:8px;\'><b style=\'color:#fde047;font-size:0.82rem;\'>" + b.montant + " €</b><button type=\'button\' class=\'btn-reset\' style=\'padding:2px 6px;font-size:0.7rem;color:#f87171;\' onclick=\'supprimerLigneBaremeAdmin(\\\"" + b.id + "\\\")\'>✕</button></div>";',
          'htmlB += "</div>";',
        '});',
        'barEditList.innerHTML = htmlB;',
      '}',
      'actualiserBilanTexteWhatsApp();',
    '}',
    'function infligerAmendeParAdmin(){',
      'var j = document.getElementById("selAdmJoueurs").value;',
      'var b = document.getElementById("selAdmBareme").value;',
      'var m = parseFloat(document.getElementById("inpAdmMontant").value) || 1;',
      'var st = document.getElementById("selAdmStatut").value;',
      'var mode = document.getElementById("selAdmModePaiement").value;',
      'var c = document.getElementById("inpAdmCommentaire").value;',
      'if(!j){ afficherToast("Veuillez sélectionner un joueur.", "erreur"); return; }',
      'if(!b){ afficherToast("Veuillez choisir ou saisir un motif.", "erreur"); return; }',
      'var stEl = document.getElementById("statusAdmAmende"); if(stEl) stEl.textContent = "Application de l\'amende...";',
      'document.getElementById("btnSubmitAdmAmende").disabled = true;',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("btnSubmitAdmAmende").disabled = false;',
        'if(stEl) stEl.textContent = "";',
        'CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;',
        'document.getElementById("inpAdmCommentaire").value = "";',
        'rendreAdminCaisseVues();',
        'rendreCaisseNoireVues();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Amende appliquée à " + j + " !", "succes");',
      '}).withFailureHandler(function(err){',
        'document.getElementById("btnSubmitAdmAmende").disabled = false;',
        'if(stEl) stEl.textContent = "Erreur : " + err.message;',
        'afficherToast(err.message, "erreur");',
      '}).infligerAmendeAdmin(SESSION_TEL, SESSION_PIN, [j], b, m, st === "paye", mode, c);',
    '}',
    'function validerSignalementAdmin(id, action){',
      'google.script.run.withSuccessHandler(function(res){',
        'CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;',
        'rendreAdminCaisseVues();',
        'rendreCaisseNoireVues();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast(action === "valider" ? "Amende validée et ajoutée aux impayés !" : "Signalement rejeté.", "info");',
      '}).withFailureHandler(function(err){ afficherToast(err.message, "erreur"); }).validerAmendeSignalee(SESSION_TEL, SESSION_PIN, id, action);',
    '}',
    'function encaisserToutPourJoueur(nom){',
      'var mode = prompt("Règlement des amendes de " + nom + " :\\nChoisissez le mode de paiement (Espèces / Lydia / Virement) :", "Lydia");',
      'if(!mode) return;',
      'var ids = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.amendes) ? CAISSE_NOIRE_DATA.amendes.filter(function(a){ return String(a.nomJoueur || "").toLowerCase() === nom.toLowerCase() && a.statut === "impaye"; }).map(function(a){ return a.id; }) : [];',
      'if(ids.length === 0){ afficherToast("Aucune amende impayée pour ce joueur.", "info"); return; }',
      'google.script.run.withSuccessHandler(function(res){',
        'CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;',
        'rendreAdminCaisseVues();',
        'rendreCaisseNoireVues();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Paiement enregistré pour " + nom + " !", "succes");',
      '}).withFailureHandler(function(err){ afficherToast(err.message, "erreur"); }).encaisserAmendesAdmin(SESSION_TEL, SESSION_PIN, ids, mode);',
    '}',
    'function enregistrerDepenseParAdmin(){',
      'var m = document.getElementById("inpAdmDepenseMotif").value;',
      'var mnt = parseFloat(document.getElementById("inpAdmDepenseMontant").value) || 0;',
      'if(!m || mnt <= 0){ afficherToast("Veuillez indiquer le motif et le montant.", "erreur"); return; }',
      'var st = document.getElementById("statusAdmDepense"); if(st) st.textContent = "Enregistrement de la dépense...";',
      'google.script.run.withSuccessHandler(function(res){',
        'if(st) st.textContent = "";',
        'document.getElementById("inpAdmDepenseMotif").value = "";',
        'document.getElementById("inpAdmDepenseMontant").value = "";',
        'CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;',
        'rendreAdminCaisseVues();',
        'rendreCaisseNoireVues();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Dépense enregistrée et déduite de la caisse !", "succes");',
      '}).withFailureHandler(function(err){',
        'if(st) st.textContent = "Erreur : " + err.message;',
        'afficherToast(err.message, "erreur");',
      '  }).enregistrerDepenseCaisse(SESSION_TEL, SESSION_PIN, m, mnt);',
    '}',
    'function sauvegarderConfigCaisse(){',
      'var obj = parseFloat(document.getElementById("inpAdmCagnotteCible").value) || 300;',
      'var desc = document.getElementById("inpAdmObjectifDesc").value;',
      'var mp = document.getElementById("inpAdmMoyenPaiement").value;',
      'var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) ? Object.assign({}, CAISSE_NOIRE_DATA.config) : {};',
      'cfg.objectifCagnotte = obj;',
      'cfg.objectifDescription = desc;',
      'cfg.moyenPaiement = mp;',
      'google.script.run.withSuccessHandler(function(res){',
        'CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;',
        'rendreAdminCaisseVues();',
        'rendreCaisseNoireVues();',
        'afficherToast("Paramètres de la caisse mis à jour !", "succes");',
      '}).withFailureHandler(function(err){ afficherToast(err.message, "erreur"); }).enregistrerConfigCaisseNoire(SESSION_TEL, SESSION_PIN, cfg);',
    '}',
    'function ajouterLigneBaremeAdmin(){',
      'var tit = document.getElementById("inpAdmNouveauTitreBareme").value;',
      'var mnt = parseFloat(document.getElementById("inpAdmNouveauMontantBareme").value) || 1;',
      'var cat = document.getElementById("selAdmNouvelleCatBareme").value;',
      'if(!tit){ afficherToast("Veuillez saisir un intitulé pour la nouvelle règle.", "erreur"); return; }',
      'var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) ? Object.assign({}, CAISSE_NOIRE_DATA.config) : {};',
      'if(!Array.isArray(cfg.bareme)) cfg.bareme = [];',
      'cfg.bareme.push({ id: "b_" + new Date().getTime(), titre: tit, montant: mnt, categorie: cat });',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("inpAdmNouveauTitreBareme").value = "";',
        'document.getElementById("inpAdmNouveauMontantBareme").value = "";',
        'CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;',
        'remplirSelectsAdminCaisse(); remplirSelectsCaisse();',
        'rendreAdminCaisseVues(); rendreCaisseNoireVues();',
        'afficherToast("Règle ajoutée au barème !", "succes");',
      '}).withFailureHandler(function(err){ afficherToast(err.message, "erreur"); }).enregistrerConfigCaisseNoire(SESSION_TEL, SESSION_PIN, cfg);',
    '}',
    'function supprimerLigneBaremeAdmin(id){',
      'var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) ? Object.assign({}, CAISSE_NOIRE_DATA.config) : {};',
      'if(!Array.isArray(cfg.bareme)) return;',
      'cfg.bareme = cfg.bareme.filter(function(b){ return b.id !== id; });',
      'google.script.run.withSuccessHandler(function(res){',
        'CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;',
        'remplirSelectsAdminCaisse(); remplirSelectsCaisse();',
        'rendreAdminCaisseVues(); rendreCaisseNoireVues();',
        'afficherToast("Règle supprimée du barème.", "info");',
      '}).withFailureHandler(function(err){ afficherToast(err.message, "erreur"); }).enregistrerConfigCaisseNoire(SESSION_TEL, SESSION_PIN, cfg);',
    '}',
    'function actualiserBilanTexteWhatsApp(){',
      'var txtEl = document.getElementById("txtAdmBilanWa"); if(!txtEl) return;',
      'var nomClub = (CLUB_CONFIG && CLUB_CONFIG.nomClub) || "Handball";',
      'var stats = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats) || { soldeCaisse: 0, totalCollecte: 0, totalDu: 0 };',
      'var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) || {};',
      'var obj = cfg.objectifCagnotte || 300;',
      'var desc = cfg.objectifDescription || "Fin de saison";',
      'var mp = cfg.moyenPaiement || "Lydia / Espèces";',
      'var lead = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.leaderboard) || [];',
      'var txt = "💰 *BILAN DE LA CAISSE NOIRE - " + nomClub.toUpperCase() + "* 💰\\n\\n";',
      'txt += "🏦 *Solde en caisse :* " + stats.soldeCaisse + " €\\n";',
      'txt += "🎯 *Objectif :* " + obj + " € (" + desc + ")\\n";',
      'txt += "⏳ *Total restant dû (impayés) :* " + stats.totalDu + " €\\n\\n";',
      'if(lead.length > 0){',
        'txt += "🏆 *Palmarès des contributeurs :*\\n";',
        'lead.slice(0, 5).forEach(function(j, idx){',
          'var med = idx === 0 ? "🥇" : (idx === 1 ? "🥈" : (idx === 2 ? "🥉" : "▪️"));',
          'txt += med + " " + j.nom + " : " + j.totalAmendes + " € (dont " + j.totalDu + " € à régler)\\n";',
        '});',
        'txt += "\\n";',
      '}',
      'txt += "💳 *Règlement de vos ardoises :* " + mp + "\\n";',
      'txt += "👉 Retrouvez votre ardoise complète et le barème sur l\'application du club ! 🤾‍♂️";',
      'txtEl.value = txt;',
    '}',
    'function ouvrirBilanCaisseSurWhatsApp(){',
      'actualiserBilanTexteWhatsApp();',
      'var txt = document.getElementById("txtAdmBilanWa").value;',
      'window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(txt), "_blank");',
    '}',
    'function copierBilanCaissePressePapier(){',
      'actualiserBilanTexteWhatsApp();',
      'var txt = document.getElementById("txtAdmBilanWa").value;',
      'if(navigator.clipboard && navigator.clipboard.writeText){',
        'navigator.clipboard.writeText(txt).then(function(){ afficherToast("Bilan copié dans le presse-papier !", "succes"); });',
      '} else { afficherToast("Texte prêt à être copié.", "info"); }',
    '}',
    'function reinitialiserCaisseNoireParAdmin(){',
      'if(!confirm("ATTENTION : Voulez-vous vraiment clôturer et remettre la caisse noire à zéro ?\\nToutes les amendes et dépenses seront archivées.")) return;',
      'google.script.run.withSuccessHandler(function(res){',
        'CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;',
        'rendreAdminCaisseVues(); rendreCaisseNoireVues();',
        'if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);',
        'afficherToast("Caisse noire réinitialisée pour la nouvelle période.", "info");',
      '}).withFailureHandler(function(err){ afficherToast(err.message, "erreur"); }).reinitialiserCaisseNoire(SESSION_TEL, SESSION_PIN);',
    '}',
    'function majVueEntrainement(){',
      'if(!TRAIN_CONFIG[SEANCE_COURANTE]){',
        'var curS = (SEANCES_TRAIN || []).find(function(x){ return x.id === SEANCE_COURANTE; });',
        'var curLbl = curS ? (curS.jour + " " + (curS.horaire || "")) : "Séance";',
        'TRAIN_CONFIG[SEANCE_COURANTE] = { label: curLbl, type: "separe", max: 20 };',
      '}',
      'var cfgS = TRAIN_CONFIG[SEANCE_COURANTE];',
      'majPillsTypeSeance(cfgS.type);',
      'var explEl = document.getElementById("trainExplication");',
      'var lblMax = document.getElementById("lblMaxJoueurs");',
      'var inpMax = document.getElementById("inpMaxJoueurs");',
      'if(inpMax) inpMax.value = cfgS.max || 20;',
      'if(lblMax) lblMax.style.display = (cfgS.type === "reduit") ? "inline-flex" : "none";',
      'if(explEl){',
        'if(cfgS.type === "separe") explEl.textContent = "Séance séparée : 2 groupes de travail + repos";',
        'else if(cfgS.type === "reduit") explEl.textContent = "Séance réduite : sélection limitée à " + (cfgS.max || 20) + " joueurs max";',
        'else explEl.textContent = "Séance complète : tout le monde est accepté (ménagés à part)";',
      '}',
      'var zDyn = document.getElementById("trDynamicZones"); if(zDyn) zDyn.innerHTML = "";',
      'if(cfgS.type === "separe"){',
        'zDyn.innerHTML = \'<div class="col col-1b"><div class="col-title"><span><span class="team-dot team-dot-1"></span>Groupe 1</span><span id="trCount_g1">0</span></div><div class="col-sub">Travail spécifique 1</div><div class="dropzone" id="trZone_g1"></div></div>\' +',
          '\'<div class="col col-1c"><div class="col-title"><span><span class="team-dot team-dot-2"></span>Groupe 2</span><span id="trCount_g2">0</span></div><div class="col-sub">Travail spécifique 2</div><div class="dropzone" id="trZone_g2"></div></div>\';',
      '} else if(cfgS.type === "reduit"){',
        'zDyn.innerHTML = \'<div class="col col-retenu"><div class="col-title"><span>Joueurs Retenus</span><span id="trCount_retenus">0/\' + (cfgS.max || 20) + \'</span></div><div class="col-sub">Sélection retenue pour la séance</div><div class="dropzone" id="trZone_retenus"></div></div>\';',
      '} else {',
        'zDyn.innerHTML = \'<div class="col col-1b"><div class="col-title"><span>Plein Entraînement</span><span id="trCount_actifs">0</span></div><div class="col-sub">Séance à 100%</div><div class="dropzone" id="trZone_actifs"></div></div>\' +',
          '\'<div class="col col-pool"><div class="col-title"><span>Ménagés / Adaptés</span><span id="trCount_menages">0</span></div><div class="col-sub">Blessés légers, reprise en douceur</div><div class="dropzone" id="trZone_menages"></div></div>\';',
      '}',
      'var trPool = document.getElementById("trZonePool"); if(trPool) trPool.innerHTML = "";',
      'var listeDispos = ENTRAINEMENTS[SEANCE_COURANTE] || [];',
      'listeDispos.forEach(function(j){ if(trPool) trPool.appendChild(creerCarte(j)); });',
      'TRAIN_SWIPE_HISTORIQUE = [];',
      'majCompteursTrain();',
      'initSortables();',
      'if(TRAIN_MODE_TINDER){ rendreControlesTrainTinder(); afficherCarteTrainTinder(); }',
    '}',
    'function changerSeance(seanceKey){',
      'SEANCE_COURANTE = seanceKey;',
      'if(SEANCES_TRAIN && SEANCES_TRAIN.length){',
        'SEANCES_TRAIN.forEach(function(s){',
          'var btn = document.getElementById("tab_" + s.id);',
          'if(btn){ btn.className = (s.id === seanceKey) ? "tab-btn tab-active" : "tab-btn"; }',
        '});',
      '}',
      'majVueEntrainement();',
    '}',
    'function changerTypeSeance(nouveauType){',
      'if(!TRAIN_CONFIG[SEANCE_COURANTE]) TRAIN_CONFIG[SEANCE_COURANTE] = { label: "Séance", type: nouveauType, max: 20 };',
      'TRAIN_CONFIG[SEANCE_COURANTE].type = nouveauType;',
      'majVueEntrainement();',
    '}',
    'function majPillsTypeSeance(typeActif){',
      'var pSep = document.getElementById("pillSepare"), pRed = document.getElementById("pillReduit"), pComp = document.getElementById("pillComplet");',
      'if(pSep) pSep.className = "train-type-pill" + (typeActif === "separe" ? " active" : "");',
      'if(pRed) pRed.className = "train-type-pill" + (typeActif === "reduit" ? " active" : "");',
      'if(pComp) pComp.className = "train-type-pill" + (typeActif === "complet" ? " active" : "");',
    '}',
    'function majMaxRetenus(val){',
      'var n = parseInt(val, 10); if(isNaN(n) || n < 1) n = 20;',
      'if(TRAIN_CONFIG[SEANCE_COURANTE]) TRAIN_CONFIG[SEANCE_COURANTE].max = n;',
      'majVueEntrainement();',
    '}',
    'function majCompteursTrain(){',
      'var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { type: "separe", max: 20 };',
      'var trPool = document.getElementById("trZonePool");',
      'var nPool = trPool ? trPool.children.length : 0;',
      'var cPool = document.getElementById("trCountPool"); if(cPool) cPool.textContent = nPool;',
      'var scoreBar = document.getElementById("trainTscoreBar");',
      'if(cfgS.type === "separe"){',
        'var zG1 = document.getElementById("trZone_g1"), zG2 = document.getElementById("trZone_g2");',
        'var nG1 = zG1 ? zG1.children.length : 0, nG2 = zG2 ? zG2.children.length : 0;',
        'var cG1 = document.getElementById("trCount_g1"); if(cG1) cG1.textContent = nG1;',
        'var cG2 = document.getElementById("trCount_g2"); if(cG2) cG2.textContent = nG2;',
        'if(scoreBar) scoreBar.innerHTML = \'<span><span class="team-dot team-dot-1"></span>Groupe 1 : <b>\' + nG1 + \'</b></span><span style="color:#cbd5e1;">Restants : <b>\' + nPool + \'</b></span><span><span class="team-dot team-dot-2"></span>Groupe 2 : <b>\' + nG2 + \'</b></span>\';',
      '} else if(cfgS.type === "reduit"){',
        'var zRet = document.getElementById("trZone_retenus");',
        'var nRet = zRet ? zRet.children.length : 0;',
        'var cRet = document.getElementById("trCount_retenus"); if(cRet) cRet.textContent = nRet + "/" + (cfgS.max || 20);',
        'if(scoreBar) scoreBar.innerHTML = \'<span>Retenus : <b>\' + nRet + \'</b>/\' + (cfgS.max || 20) + \'</span><span style="color:#cbd5e1;">Restants : <b>\' + nPool + \'</b></span>\';',
      '} else {',
        'var zAct = document.getElementById("trZone_actifs"), zMen = document.getElementById("trZone_menages");',
        'var nAct = zAct ? zAct.children.length : 0, nMen = zMen ? zMen.children.length : 0;',
        'var cAct = document.getElementById("trCount_actifs"); if(cAct) cAct.textContent = nAct;',
        'var cMen = document.getElementById("trCount_menages"); if(cMen) cMen.textContent = nMen;',
        'if(scoreBar) scoreBar.innerHTML = \'<span>Plein entraînement : <b>\' + nAct + \'</b></span><span style="color:#cbd5e1;">Restants : <b>\' + nPool + \'</b></span><span>Ménagés : <b>\' + nMen + \'</b></span>\';',
      '}',
    '}',
    'function choisirModeTrain(isTinder){',
      'TRAIN_MODE_TINDER = !!isTinder;',
      'document.body.classList.toggle("train-tinder-mode-active", TRAIN_MODE_TINDER);',
      'var classic = document.getElementById("trainBoardClassic");',
      'var tinder = document.getElementById("trainTinderView");',
      'var footer = document.getElementById("trainFooter");',
      'if(classic){ classic.style.display = TRAIN_MODE_TINDER ? "none" : "grid"; if(!TRAIN_MODE_TINDER){ classic.classList.remove("view-animate-in"); void classic.offsetWidth; classic.classList.add("view-animate-in"); } }',
      'if(tinder){ tinder.style.display = TRAIN_MODE_TINDER ? "block" : "none"; if(TRAIN_MODE_TINDER){ tinder.classList.remove("view-animate-in"); void tinder.offsetWidth; tinder.classList.add("view-animate-in"); } }',
      'if(footer) footer.style.display = TRAIN_MODE_TINDER ? "none" : "flex";',
      'var tabC = document.getElementById("tabTrainClassicMode");',
      'var tabT = document.getElementById("tabTrainTinderMode");',
      'if(tabC) tabC.className = "view-mode-tab" + (TRAIN_MODE_TINDER ? "" : " active");',
      'if(tabT) tabT.className = "view-mode-tab" + (TRAIN_MODE_TINDER ? " active" : "");',
      'var btnSwitch = document.getElementById("btnSwitchModeTrain");',
      'if(btnSwitch) btnSwitch.textContent = TRAIN_MODE_TINDER ? "Mode Tactique" : "Mode Tinder";',
      'if(TRAIN_MODE_TINDER){ rendreControlesTrainTinder(); afficherCarteTrainTinder(); }',
    '}',
    'function basculerModeTrain(){ choisirModeTrain(!TRAIN_MODE_TINDER); }',
    'function rendreControlesTrainTinder(){',
      'var c = document.getElementById("trainTControlsContainer"); if(!c) return;',
      'var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { type: "separe" };',
      'var html = \'<button type="button" class="tbtn-undo" title="Annuler le dernier choix" onclick="annulerDernierSwipeTrain()">↩</button>\';',
      'if(cfgS.type === "separe"){',
        'html += \'<button type="button" class="tbtn-circle tbtn-1b" data-choix="G1" onclick="animerVoteBoutonTrain(\\\'G1\\\')"><span>←</span>Groupe 1</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBoutonTrain(\\\'OUT\\\')"><span>↓</span>Repos</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1c" data-choix="G2" onclick="animerVoteBoutonTrain(\\\'G2\\\')"><span>→</span>Groupe 2</button>\';',
      '} else if(cfgS.type === "reduit"){',
        'html += \'<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBoutonTrain(\\\'OUT\\\')"><span>←</span>Repos</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1b" data-choix="RETENU" onclick="animerVoteBoutonTrain(\\\'RETENU\\\')"><span>→</span>Retenu</button>\';',
      '} else {',
        'html += \'<button type="button" class="tbtn-circle tbtn-out" data-choix="MENAGE" onclick="animerVoteBoutonTrain(\\\'MENAGE\\\')"><span>←</span>Ménagé</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1b" data-choix="ACTIF" onclick="animerVoteBoutonTrain(\\\'ACTIF\\\')"><span>→</span>Présent</button>\';',
      '}',
      'html += \'<button type="button" class="tbtn-undo" title="Recommencer la séance" onclick="recommencerTrainSelection()">Réinit</button>\';',
      'c.innerHTML = html;',
    '}',
    'function afficherCarteTrainTinder(){',
      'var cont = document.getElementById("trainTinderContainer"); if(!cont) return;',
      'cont.innerHTML = "";',
      'var pool = document.getElementById("trZonePool");',
      'if(!pool || pool.children.length === 0){',
        'cont.innerHTML = "<div style=\'padding:60px 20px;color:#a3a3a3;font-size:1.1rem;\'>Tous les joueurs sont répartis pour cette séance !<br><br><small>Basculez en mode tactique pour affiner ou sauvegarder.</small></div>";',
        'majCompteursTrain(); return;',
      '}',
      'var listeDispos = ENTRAINEMENTS[SEANCE_COURANTE] || [];',
      'var nomTop = pool.children[0].getAttribute("data-nom");',
      'var jTop = listeDispos.find(function(x){ return x.nom === nomTop; }) || { nom: nomTop, poste: "Demi-Centre" };',
      'var topCard = creerCarteTrainTinderHtml(jTop, true);',
      'cont.appendChild(topCard);',
      'if(pool.children.length > 1){',
        'var nomNext = pool.children[1].getAttribute("data-nom");',
        'var jNext = listeDispos.find(function(x){ return x.nom === nomNext; }) || { nom: nomNext, poste: "Demi-Centre" };',
        'var nextCard = creerCarteTrainTinderHtml(jNext, false); nextCard.classList.add("tcard-next");',
        'cont.appendChild(nextCard);',
      '}',
      'attacherGestesTrainTinder(topCard); majCompteursTrain();',
    '}',
    'function creerCarteTrainTinderHtml(j, isTop){',
      'var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { type: "separe" };',
      'var card = document.createElement("div"); card.className = "tcard" + (isTop ? " tcard-top" : "");',
      'card.setAttribute("data-nom", j.nom);',
      'var trInit = (j.nom || "").trim().charAt(0).toUpperCase();',
      'var avTr = document.createElement("div"); avTr.className = "tavatar"; avTr.textContent = trInit; avTr.style.cursor = "pointer"; avTr.title = "Fiche de " + j.nom; avTr.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); };',
      'if(j.photo){ var bg = document.createElement("img"); bg.className = "tbg-photo"; bg.src = j.photo; bg.onerror = function(){ this.remove(); if(avTr) avTr.style.display = "flex"; }; card.appendChild(bg); }',
      'var ov = document.createElement("div"); ov.className = "tbg-overlay"; card.appendChild(ov);',
      'function addStamp(clsPos, clsCol, txt){ var s = document.createElement("div"); s.className = "stamp " + clsPos + " " + clsCol; s.textContent = txt; card.appendChild(s); }',
      'if(cfgS.type === "separe"){',
        'addStamp("stamp-left", "stamp-1b", "GROUPE 1");',
        'addStamp("stamp-right", "stamp-1c", "GROUPE 2");',
        'addStamp("stamp-down", "stamp-out", "REPOS");',
      '} else if(cfgS.type === "reduit"){',
        'addStamp("stamp-left", "stamp-out", "NON RETENU");',
        'addStamp("stamp-right", "stamp-1b", "RETENU");',
      '} else {',
        'addStamp("stamp-left", "stamp-out", "MÉNAGÉ");',
        'addStamp("stamp-right", "stamp-1b", "PRÉSENT");',
      '}',
      'var bEd = document.createElement("button"); bEd.className = "tbtn-edit-card"; bEd.textContent = "Fiche";',
      'bEd.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); }; card.appendChild(bEd);',
      'var tc = document.createElement("div"); tc.className = "tcontent";',
      'if(!j.photo){ tc.appendChild(avTr); }',
      'else { avTr.style.display = "none"; tc.appendChild(avTr); var sp = document.createElement("div"); sp.style.height = "20px"; tc.appendChild(sp); }',
      'var bot = document.createElement("div"); bot.style.width = "100%"; bot.style.display = "flex"; bot.style.flexDirection = "column"; bot.style.alignItems = "center"; bot.style.gap = "6px";',
      'var nomEl = document.createElement("div"); nomEl.style.fontSize = "1.5rem"; nomEl.style.fontWeight = "900"; nomEl.textContent = j.nom; bot.appendChild(nomEl);',
      'var postEl = document.createElement("div"); postEl.style.fontSize = "0.95rem"; postEl.style.color = "var(--color-secondary)"; postEl.style.fontWeight = "700"; postEl.textContent = (j.poste || "Demi-Centre") + " • " + (j.entrainements || 0) + " tr"; bot.appendChild(postEl);',
      'if(j.note){ var nt = document.createElement("div"); nt.className = "tnote-box"; nt.textContent = "Note : " + j.note; bot.appendChild(nt); }',
      'tc.appendChild(bot); card.appendChild(tc);',
      'return card;',
    '}',
    'function attacherGestesTrainTinder(card){',
      'var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { type: "separe" };',
      'var startX = 0, startY = 0, currentX = 0, currentY = 0, isDragging = false;',
      'var sLeft = card.querySelector(".stamp-left"), sRight = card.querySelector(".stamp-right"), sDown = card.querySelector(".stamp-down");',
      'function resetStamps(){ if(sLeft) sLeft.style.opacity = 0; if(sRight) sRight.style.opacity = 0; if(sDown) sDown.style.opacity = 0; }',
      'function onStart(e){ isDragging = true; startX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX; startY = e.type.includes("mouse") ? e.clientY : e.touches[0].clientY; card.classList.remove("tcard-spring"); }',
      'function onMove(e){',
        'if(!isDragging) return;',
        'var clientX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX;',
        'var clientY = e.type.includes("mouse") ? e.clientY : e.touches[0].clientY;',
        'currentX = clientX - startX; currentY = clientY - startY;',
        'var rot = currentX * 0.08;',
        'card.style.transform = "translate3d(" + currentX + "px," + currentY + "px,0) rotate(" + rot + "deg)";',
        'resetStamps();',
        'if(cfgS.type === "separe"){',
          'if(currentY > 40 && Math.abs(currentY) > Math.abs(currentX)){ if(sDown) sDown.style.opacity = Math.min(1, currentY / 95); }',
          'else if(currentX < -20 && sLeft){ sLeft.style.opacity = Math.min(1, Math.abs(currentX) / 95); }',
          'else if(currentX > 20 && sRight){ sRight.style.opacity = Math.min(1, currentX / 95); }',
        '} else {',
          'if(currentX < -20 && sLeft){ sLeft.style.opacity = Math.min(1, Math.abs(currentX) / 95); }',
          'else if(currentX > 20 && sRight){ sRight.style.opacity = Math.min(1, currentX / 95); }',
        '}',
      '}',
      'function onEnd(){',
        'if(!isDragging) return; isDragging = false;',
        'var dest = null;',
        'if(cfgS.type === "separe"){',
          'if(currentY > 90 && Math.abs(currentY) > Math.abs(currentX)) dest = "OUT";',
          'else if(currentX < -90 && Math.abs(currentX) > Math.abs(currentY)) dest = "G1";',
          'else if(currentX > 90 && Math.abs(currentX) > Math.abs(currentY)) dest = "G2";',
        '} else if(cfgS.type === "reduit"){',
          'if(currentX < -90) dest = "OUT";',
          'else if(currentX > 90) dest = "RETENU";',
        '} else {',
          'if(currentX < -90) dest = "MENAGE";',
          'else if(currentX > 90) dest = "ACTIF";',
        '}',
        'if(dest) ejecterCarteTrain(card, dest);',
        'else { card.classList.add("tcard-spring"); card.style.transform = "translate3d(0px,0px,0) rotate(0deg)"; resetStamps(); }',
      '}',
      'card.addEventListener("mousedown", onStart); window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onEnd);',
      'card.addEventListener("touchstart", onStart, { passive: true }); window.addEventListener("touchmove", onMove, { passive: true }); window.addEventListener("touchend", onEnd);',
    '}',
    'function animerVoteBoutonTrain(choix){ if(TRAIN_MODE_TINDER) swiperTrainVers(choix); }',
    'function swiperTrainVers(choix){',
      'if(TRAIN_ANIM_EN_COURS) return;',
      'var topCard = document.querySelector("#trainTinderContainer .tcard-top");',
      'if(!topCard) return;',
      'var s = null;',
      'if(choix === "G1" || (choix === "OUT" && TRAIN_CONFIG[SEANCE_COURANTE].type === "reduit") || choix === "MENAGE") s = topCard.querySelector(".stamp-left");',
      'else if(choix === "G2" || choix === "RETENU" || choix === "ACTIF") s = topCard.querySelector(".stamp-right");',
      'else if(choix === "OUT") s = topCard.querySelector(".stamp-down");',
      'if(s) s.style.opacity = 1;',
      'ejecterCarteTrain(topCard, choix);',
    '}',
    'function ejecterCarteTrain(card, choix){',
      'TRAIN_ANIM_EN_COURS = true; card.classList.add("tcard-fly");',
      'var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { type: "separe" };',
      'if(cfgS.type === "separe"){',
        'if(choix === "G1") card.style.transform = "translate3d(-460px, 20px, 0) rotate(-28deg)";',
        'else if(choix === "G2") card.style.transform = "translate3d(460px, 20px, 0) rotate(28deg)";',
        'else if(choix === "OUT") card.style.transform = "translate3d(0, 460px, 0) rotate(6deg)";',
      '} else {',
        'if(choix === "OUT" || choix === "MENAGE") card.style.transform = "translate3d(-460px, 20px, 0) rotate(-28deg)";',
        'else card.style.transform = "translate3d(460px, 20px, 0) rotate(28deg)";',
      '}',
      'setTimeout(function(){',
        'var nom = card.getAttribute("data-nom");',
        'var pool = document.getElementById("trZonePool");',
        'var el = Array.from(pool.children).find(function(c){ return c.getAttribute("data-nom") === nom; });',
        'if(el){',
          'TRAIN_SWIPE_HISTORIQUE.push({ element: el, nom: nom, choix: choix });',
          'if(choix === "G1" && document.getElementById("trZone_g1")) document.getElementById("trZone_g1").appendChild(el);',
          'else if(choix === "G2" && document.getElementById("trZone_g2")) document.getElementById("trZone_g2").appendChild(el);',
          'else if(choix === "RETENU" && document.getElementById("trZone_retenus")) document.getElementById("trZone_retenus").appendChild(el);',
          'else if(choix === "ACTIF" && document.getElementById("trZone_actifs")) document.getElementById("trZone_actifs").appendChild(el);',
          'else if(choix === "MENAGE" && document.getElementById("trZone_menages")) document.getElementById("trZone_menages").appendChild(el);',
          'else pool.removeChild(el);',
        '}',
        'TRAIN_ANIM_EN_COURS = false; afficherCarteTrainTinder();',
      '}, 240);',
    '}',
    'function annulerDernierSwipeTrain(){',
      'if(!TRAIN_SWIPE_HISTORIQUE.length) return;',
      'var dernier = TRAIN_SWIPE_HISTORIQUE.pop();',
      'var pool = document.getElementById("trZonePool");',
      'if(pool){ pool.insertBefore(dernier.element, pool.firstChild); majCompteursTrain(); afficherCarteTrainTinder(); }',
    '}',
    'function recommencerTrainSelection(){',
      'var zG1 = document.getElementById("trZone_g1"); if(zG1) zG1.innerHTML = "";',
      'var zG2 = document.getElementById("trZone_g2"); if(zG2) zG2.innerHTML = "";',
      'var zRet = document.getElementById("trZone_retenus"); if(zRet) zRet.innerHTML = "";',
      'var zAct = document.getElementById("trZone_actifs"); if(zAct) zAct.innerHTML = "";',
      'var zMen = document.getElementById("trZone_menages"); if(zMen) zMen.innerHTML = "";',
      'var pool = document.getElementById("trZonePool"); if(pool) pool.innerHTML = "";',
      'var dispos = ENTRAINEMENTS[SEANCE_COURANTE] || [];',
      'dispos.forEach(function(j){ if(pool) pool.appendChild(creerCarte(j)); });',
      'TRAIN_SWIPE_HISTORIQUE = []; majCompteursTrain(); if(TRAIN_MODE_TINDER) afficherCarteTrainTinder();',
    '}',
    'function reinitialiserSeance(){ majVueEntrainement(); }',
    'function preparerDonneesEntrainement(){',
      'var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { label: "Séance", type: "separe" };',
      'var groupes = [];',
      'if(cfgS.type === "separe"){',
        'groupes.push({ nom: "Groupe 1", joueurs: extraireListeNoms("trZone_g1") });',
        'groupes.push({ nom: "Groupe 2", joueurs: extraireListeNoms("trZone_g2") });',
      '} else if(cfgS.type === "reduit"){',
        'groupes.push({ nom: "Joueurs Retenus", joueurs: extraireListeNoms("trZone_retenus") });',
      '} else {',
        'groupes.push({ nom: "Plein Entraînement", joueurs: extraireListeNoms("trZone_actifs") });',
        'groupes.push({ nom: "Ménagés / Adaptés", joueurs: extraireListeNoms("trZone_menages") });',
      '}',
      'return { seance: cfgS.label, typeSeance: cfgS.type, groupes: groupes, nonRetenus: extraireListeNoms("trZonePool") };',
    '}',
    'function creerMessageEntrainement(d){',
      'var typeLabel = (d.typeSeance === "separe") ? "2 Groupes" : ((d.typeSeance === "reduit") ? "Effectif Réduit" : "Effectif Complet");',
      'var lignes = ["*ENTRAÎNEMENT " + String(d.seance).toUpperCase() + " (" + typeLabel + ")*", ""];',
      'd.groupes.forEach(function(g){',
        'lignes.push("• *" + g.nom + "* (" + g.joueurs.length + ") :");',
        'lignes.push(g.joueurs.length ? g.joueurs.map(function(n){ return "- " + n; }).join("\\n") : "Aucun");',
        'lignes.push("");',
      '});',
      'if(d.nonRetenus && d.nonRetenus.length){',
        'lignes.push("• *Repos / Non retenus* (" + d.nonRetenus.length + ") :");',
        'lignes.push(d.nonRetenus.map(function(n){ return "- " + n; }).join("\\n"));',
        'lignes.push("");',
      '}',
      'return lignes.join("\\n");',
    '}',
    'function sauvegarderEntrainement(publierWa){',
      'var d = preparerDonneesEntrainement();',
      'var msg = creerMessageEntrainement(d);',
      'document.getElementById("statutTrain").textContent = "Sauvegarde...";',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("statutTrain").textContent = "Sauvegardé (" + res.date + ")";',
        'if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });',
      '}).enregistrerEntrainementEtPublier(d.seance, d.typeSeance, d.groupes, d.nonRetenus, publierWa, msg);',
    '}',
    'function ouvrirApercuEntrainement(){',
      'var d = preparerDonneesEntrainement();',
      'CONTEXTE_APERCU = { type: "train", donnees: d };',
      'document.getElementById("previewTitle").textContent = "Aperçu - Entraînement " + d.seance;',
      'var tWrap = document.getElementById("tacticalPreviewWrap"); if(tWrap) tWrap.style.display = "none";',
      'var div = document.getElementById("previewMessages"); div.innerHTML = "";',
      'var txt = document.createElement("textarea"); txt.className = "preview-text"; txt.id = "txtPreviewTrain"; txt.value = creerMessageEntrainement(d); div.appendChild(txt);',
      'basculerVue("previewView");',
    '}',
    'function initSortables(){',
      '["zonePool","zone1B","zone1C","zone1D","zoneRepos"].forEach(function(id){',
        'var el = document.getElementById(id);',
        'if(el) new Sortable(el, { group: "shared", animation: 180, onSort: function(){ majCompteurs(); sauvegarderBrouillonLocal(false); }, onAdd: function(evt){',
        '  if(id === "zone1B" || id === "zone1C" || id === "zone1D"){',
        '    var dNom = evt.item ? evt.item.getAttribute("data-nom") : null;',
        '    if(dNom) verifierChouchouSelectionne(dNom);',
        '  }',
        '} });',
      '});',
      'var trPool = document.getElementById("trZonePool");',
      'if(trPool) new Sortable(trPool, { group: "trShared", animation: 180, onSort: majCompteursTrain });',
      '["trZone_g1","trZone_g2","trZone_retenus","trZone_actifs","trZone_menages"].forEach(function(id){',
        'var el = document.getElementById(id);',
        'if(el) new Sortable(el, { group: "trShared", animation: 180, onSort: majCompteursTrain });',
      '});',
    '}',
    'function rendreRosterGrid(){',
      'var grid = document.getElementById("rosterGrid"); if(!grid) return; grid.innerHTML = "";',
      'document.getElementById("rosterCount").textContent = EFFECTIF_COMPLET.length + " joueurs";',
      'EFFECTIF_COMPLET.forEach(function(p){',
        'var card = document.createElement("div"); card.className = "rcard"; card.onclick = function(){ ouvrirModalJoueur(p.nom); };',
        'var isChou = (CLUB_CONFIG && CLUB_CONFIG.chouchou && String(p.nom || "").trim().toLowerCase() === String(CLUB_CONFIG.chouchou).trim().toLowerCase());',
        'var av = document.createElement("div"); av.className = "pmini" + (isChou ? " is-chouchou" : "");',
        'var rInit = (p.nom || "").trim().charAt(0).toUpperCase();',
        'if(p.photo){ var img = document.createElement("img"); img.src = p.photo; img.onerror = function(){ this.remove(); av.textContent = rInit; }; av.appendChild(img); }',
        'else { av.textContent = rInit; }',
        'card.appendChild(av);',
        'var inf = document.createElement("div"); inf.style.flex = "1"; inf.style.minWidth = "0";',
        'var nm = document.createElement("div"); nm.style.fontWeight = "700"; nm.textContent = p.nom;',
        'if(isChou){ var cB = document.createElement("span"); cB.className = "chouchou-badge"; cB.textContent = "❤️ Chouchou"; nm.appendChild(cB); }',
        'inf.appendChild(nm);',
        'var pst = document.createElement("div"); pst.style.fontSize = "0.78rem"; pst.style.color = "#d4d4d4"; pst.style.display = "flex"; pst.style.alignItems = "center"; pst.style.gap = "6px"; pst.style.flexWrap = "wrap";',
        'var pstTxt = document.createElement("span"); pstTxt.textContent = p.poste || "Demi-Centre"; pst.appendChild(pstTxt);',
        'if(p.equipe){',
        '  var eqTag = document.createElement("span"); eqTag.style.fontSize = "0.7rem"; eqTag.style.padding = "2px 6px"; eqTag.style.borderRadius = "4px"; eqTag.style.background = "rgba(148,163,184,0.18)"; eqTag.style.color = "var(--color-primary)"; eqTag.style.fontWeight = "700"; eqTag.textContent = p.equipe; pst.appendChild(eqTag);',
        '}',
        'inf.appendChild(pst);',
        'if(p.note){ var nt = document.createElement("div"); nt.className = "rnote"; nt.textContent = "Note : " + p.note; inf.appendChild(nt); }',
        'card.appendChild(inf); grid.appendChild(card);',
      '});',
    '}',
    'function formaterNumeroAffichage(t){',
      'if(!t) return "";',
      'var s = String(t).replace(/[^0-9]/g, "");',
      'if(s.indexOf("33") === 0 && s.length === 11) s = "0" + s.substring(2);',
      'if(s.length === 10) return s.slice(0,2) + " " + s.slice(2,4) + " " + s.slice(4,6) + " " + s.slice(6,8) + " " + s.slice(8,10);',
      'return t;',
    '}',
    'function filtrerRoster(q){',
      'var val = String(q || "").toLowerCase().trim();',
      'Array.from(document.getElementById("rosterGrid").children).forEach(function(c){',
        'c.style.display = c.textContent.toLowerCase().includes(val) ? "flex" : "none";',
      '});',
    '}',
    'function majOptionsEquipesSelects(){',
    '  var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;',
    '  var cEqs = (CLUB_CONFIG && CLUB_CONFIG.equipes) || [];',
    '  var selects = ["modalJoueurEquipe", "selNouvEquipe"];',
    '  selects.forEach(function(selId){',
    '    var sel = document.getElementById(selId);',
    '    if(!sel) return;',
    '    var curVal = sel.value;',
    '    sel.innerHTML = "";',
    '    for(var i = 1; i <= nbEq; i++){',
    '      var eq = cEqs[i - 1] || {};',
    '      var code = eq.code || ("Équipe " + i);',
    '      var label = eq.nomSondage || eq.labelSondage || (CLUB_CONFIG && CLUB_CONFIG["nomEquipe" + i]) || ("Équipe " + i);',
    '      var opt = document.createElement("option");',
    '      opt.value = label;',
    '      opt.setAttribute("data-code", code);',
    '      opt.textContent = (code && code !== label) ? (code + " — " + label) : label;',
    '      sel.appendChild(opt);',
    '    }',
    '    if(curVal) sel.value = curVal;',
    '  });',
    '}',
    'function ouvrirModalJoueur(nom){',
    '  JOUEUR_MODAL_COURANT = nom;',
    '  var p = EFFECTIF_COMPLET.find(function(x){ return x.nom.toLowerCase() === nom.toLowerCase(); }) || { nom: nom, poste: "Demi-Centre", photo: "", note: "", tel: "", equipe: "Équipe 1", estTresorier: false };',
    '  document.getElementById("modalJoueurNom").textContent = p.nom;',
    '  document.getElementById("modalJoueurPoste").value = p.poste || "Demi-Centre";',
    '  document.getElementById("modalJoueurNote").value = p.note || "";',
    '  if(document.getElementById("modalJoueurTel")) document.getElementById("modalJoueurTel").value = formaterNumeroAffichage(p.tel) || "";',
    '  var boxTres = document.getElementById("boxModalJoueurTresorier");',
    '  var chkTres = document.getElementById("modalJoueurTresorier");',
    '  if(boxTres) boxTres.style.display = (EST_COACH || EST_TRESORIER) ? "flex" : "none";',
    '  if(chkTres){ chkTres.checked = !!p.estTresorier; chkTres.disabled = !EST_COACH; }',
    '  majOptionsEquipesSelects();',
    '  var selEq = document.getElementById("modalJoueurEquipe");',
    '  if(selEq){',
    '    var eqCherchee = String(p.equipe || "").trim().toLowerCase();',
    '    var matchOk = false;',
    '    for(var oi = 0; oi < selEq.options.length; oi++){',
    '      var opt = selEq.options[oi];',
    '      var oVal = opt.value.toLowerCase();',
    '      var oCode = (opt.getAttribute("data-code") || "").toLowerCase();',
    '      if(oVal === eqCherchee || oCode === eqCherchee || eqCherchee.indexOf(oVal) !== -1 || eqCherchee.indexOf(oCode) !== -1 || oVal.indexOf(eqCherchee) !== -1){',
    '        selEq.selectedIndex = oi;',
    '        matchOk = true;',
    '        break;',
    '      }',
    '    }',
    '    if(!matchOk && selEq.options.length > 0) selEq.selectedIndex = 0;',
    '  }',
    '  document.getElementById("modalJoueurStatus").textContent = "";',
    '  PHOTO_MODAL_DATA = undefined;',
    '  var mImg = document.getElementById("modalJoueurImg"), mInit = document.getElementById("modalJoueurInitiale");',
    '  var bdrop = document.getElementById("modalJoueurBackdrop");',
    '  if(bdrop) bdrop.style.opacity = "0";',
    '  var pInit = (p.nom || "").trim().charAt(0).toUpperCase();',
    '  mInit.textContent = pInit;',
    '  if(p.photo){',
    '    mImg.src = p.photo; mImg.style.display = "block"; mInit.style.display = "none";',
    '    if(bdrop){ bdrop.style.backgroundImage = "url(\'" + p.photo + "\')"; setTimeout(function(){ if(bdrop) bdrop.style.opacity = "0.55"; }, 50); }',
    '    mImg.onerror = function(){ mImg.style.display = "none"; mInit.style.display = "flex"; if(bdrop){ bdrop.style.opacity = "0"; bdrop.style.backgroundImage = "none"; } };',
    '  } else {',
    '    mImg.style.display = "none"; mInit.style.display = "flex";',
    '    if(bdrop){ bdrop.style.opacity = "0"; bdrop.style.backgroundImage = "none"; }',
    '  }',
    '  var isChou = (CLUB_CONFIG && CLUB_CONFIG.chouchou && String(nom).trim().toLowerCase() === String(CLUB_CONFIG.chouchou).trim().toLowerCase());',
    '  majBoutonChouchouModal(isChou);',
    '  document.getElementById("modalJoueurBg").style.display = "flex";',
    '}',
    'function fermerModalJoueur(){ var bdrop = document.getElementById("modalJoueurBackdrop"); if(bdrop) bdrop.style.opacity = "0"; document.getElementById("modalJoueurBg").style.display = "none"; }',
    'function fermerModalSurBg(e){ if(e.target.id === "modalJoueurBg") fermerModalJoueur(); }',
    'var DERNIERE_INONDATION_COEURS = 0;',
    'function declencherInondationCoeurs(nomJoueur){',
    '  var now = Date.now();',
    '  if(now - DERNIERE_INONDATION_COEURS < 2200) return;',
    '  DERNIERE_INONDATION_COEURS = now;',
    '  var cont = document.createElement("div"); cont.id = "chouchouHeartRain";',
    '  cont.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999999;overflow:hidden;box-shadow:inset 0 0 100px rgba(244,63,94,0.35);transition:opacity 0.4s ease;";',
    '  var banner = document.createElement("div");',
    '  banner.style.cssText = "position:absolute;top:18%;left:50%;transform:translate(-50%,-50%);background:linear-gradient(135deg,#e11d48,#be123c);color:#fff;padding:12px 24px;border-radius:999px;font-size:1.1rem;font-weight:900;letter-spacing:0.5px;box-shadow:0 8px 30px rgba(225,29,72,0.6);border:2px solid #fda4af;text-shadow:0 2px 4px rgba(0,0,0,0.4);display:flex;align-items:center;gap:10px;animation:chouchouPulse 1.2s infinite ease-in-out;";',
    '  var txtNom = nomJoueur ? (nomJoueur + " — Le Chouchou en jeu !") : "Le Chouchou du coach est en jeu !";',
    '  banner.innerHTML = "<span>💖</span> <span>" + txtNom + "</span> <span>❤️</span>";',
    '  cont.appendChild(banner);',
    '  var emojis = ["❤️", "💖", "💕", "💓", "💗", "💘", "🥰", "😍"];',
    '  for(var i = 0; i < 48; i++){',
    '    var p = document.createElement("div");',
    '    p.textContent = emojis[Math.floor(Math.random() * emojis.length)];',
    '    var size = 20 + Math.random() * 32;',
    '    var left = Math.random() * 96;',
    '    var dur = 1.2 + Math.random() * 0.8;',
    '    var del = Math.random() * 0.4;',
    '    p.style.cssText = "position:absolute;bottom:-40px;left:" + left + "%;font-size:" + size + "px;opacity:0;animation:floatHeartUp " + dur + "s ease-out " + del + "s forwards;text-shadow:0 0 10px rgba(244,63,94,0.6);";',
    '    cont.appendChild(p);',
    '  }',
    '  document.body.appendChild(cont);',
    '  if(typeof confetti === "function"){',
    '    try { confetti({ particleCount: 45, spread: 80, origin: { y: 0.65 }, colors: ["#ff1493", "#e11d48", "#fda4af", "#fb7185", "#ffffff"] }); } catch(e){}',
    '  }',
    '  setTimeout(function(){',
    '    cont.style.opacity = "0";',
    '    setTimeout(function(){ if(cont.parentNode) cont.parentNode.removeChild(cont); }, 400);',
    '  }, 2000);',
    '}',
    'function verifierChouchouSelectionne(nomJoueur){',
    '  if(!nomJoueur || !CLUB_CONFIG || !CLUB_CONFIG.chouchou) return;',
    '  if(String(nomJoueur).trim().toLowerCase() === String(CLUB_CONFIG.chouchou).trim().toLowerCase()){',
    '    declencherInondationCoeurs(nomJoueur);',
    '  }',
    '}',
    'function majBoutonChouchouModal(isChou){',
    '  var btn = document.getElementById("btnModalChouchou");',
    '  var wrap = document.getElementById("modalJoueurAvatarWrap");',
    '  if(wrap){',
    '    if(isChou) wrap.classList.add("is-chouchou");',
    '    else wrap.classList.remove("is-chouchou");',
    '  }',
    '  if(!btn) return;',
    '  if(isChou){',
    '    btn.innerHTML = "❤️ Mon Chouchou (Actif)";',
    '    btn.style.background = "linear-gradient(135deg, #e11d48, #be123c)";',
    '    btn.style.color = "#ffffff";',
    '    btn.style.borderColor = "#fda4af";',
    '    btn.style.boxShadow = "0 0 12px rgba(225,29,72,0.6)";',
    '  } else {',
    '    btn.innerHTML = "🤍 Choisir comme Chouchou";',
    '    btn.style.background = "rgba(244,63,94,0.12)";',
    '    btn.style.color = "#fda4af";',
    '    btn.style.borderColor = "#f43f5e";',
    '    btn.style.boxShadow = "none";',
    '  }',
    '}',
    'function toggleChouchouCourant(){',
    '  if(!JOUEUR_MODAL_COURANT) return;',
    '  var nomActuel = (CLUB_CONFIG && CLUB_CONFIG.chouchou) ? String(CLUB_CONFIG.chouchou).trim().toLowerCase() : "";',
    '  var cibleNom = String(JOUEUR_MODAL_COURANT).trim();',
    '  var devientChouchou = (nomActuel !== cibleNom.toLowerCase());',
    '  var nouveauChouchou = devientChouchou ? cibleNom : "";',
    '  if(!CLUB_CONFIG) CLUB_CONFIG = {};',
    '  CLUB_CONFIG.chouchou = nouveauChouchou;',
    '  majBoutonChouchouModal(devientChouchou);',
    '  rendreRosterGrid();',
    '  initialiserColonnes();',
    '  if(MODE_TINDER) afficherCarteTinder();',
    '  if(typeof afficherApercuTactique === "function" && typeof EQUIPE_TACTIQUE_COURANTE !== "undefined" && EQUIPE_TACTIQUE_COURANTE){ afficherApercuTactique(EQUIPE_TACTIQUE_COURANTE); }',
    '  if(devientChouchou){',
    '    declencherInondationCoeurs(cibleNom);',
    '    afficherToast(cibleNom + " est désormais le Chouchou du coach ! ❤️", "succes");',
    '  } else {',
    '    afficherToast("Chouchou retiré.", "info");',
    '  }',
    '  google.script.run.withSuccessHandler(function(res){',
    '    if(res && res.chouchou !== undefined) CLUB_CONFIG.chouchou = res.chouchou;',
    '  }).withFailureHandler(function(err){',
    '    afficherToast("Erreur enregistrement chouchou : " + err.message, "erreur");',
    '  }).enregistrerChouchou(SESSION_TEL, SESSION_PIN, nouveauChouchou);',
    '}',
    'function chargerPhotoDepuisModal(e){',
      'var f = e.target.files[0]; if(!f) return;',
      'var r = new FileReader();',
      'r.onload = function(evt){',
        'PHOTO_MODAL_DATA = evt.target.result;',
        'document.getElementById("modalJoueurImg").src = PHOTO_MODAL_DATA;',
        'document.getElementById("modalJoueurImg").style.display = "block";',
        'document.getElementById("modalJoueurInitiale").style.display = "none";',
        'var bdrop = document.getElementById("modalJoueurBackdrop");',
        'if(bdrop){ bdrop.style.backgroundImage = "url(\'" + PHOTO_MODAL_DATA + "\')"; bdrop.style.opacity = "0.55"; }',
        'document.getElementById("modalJoueurStatus").textContent = "Photo prête à être enregistrée.";',
      '};',
      'r.readAsDataURL(f);',
    '}',
    'function sauvegarderFicheDepuisModal(){',
      'if(!JOUEUR_MODAL_COURANT) return;',
      'document.getElementById("modalJoueurStatus").textContent = "Enregistrement...";',
      'var np = document.getElementById("modalJoueurPoste").value, nn = document.getElementById("modalJoueurNote").value;',
      'var nTel = document.getElementById("modalJoueurTel") ? document.getElementById("modalJoueurTel").value.trim() : "";',
      'var nEq = document.getElementById("modalJoueurEquipe") ? document.getElementById("modalJoueurEquipe").value : "Équipe 1";',
      'var chkTres = document.getElementById("modalJoueurTresorier");',
      'var estTres = chkTres ? chkTres.checked : false;',
      'var jCible = { nom: JOUEUR_MODAL_COURANT, poste: np, photo: PHOTO_MODAL_DATA || "", note: nn, tel: nTel, equipe: nEq, estTresorier: estTres };',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("modalJoueurStatus").textContent = "Enregistré avec succès !";',
        'afficherToast("Fiche de " + res.joueur.nom + " mise à jour !", "succes");',
        'var idx = EFFECTIF_COMPLET.findIndex(function(x){ return x.nom.toLowerCase() === res.joueur.nom.toLowerCase(); });',
        'if(idx !== -1) EFFECTIF_COMPLET[idx] = res.joueur;',
        'var jObj = JOUEURS.find(function(x){ return x.nom.toLowerCase() === res.joueur.nom.toLowerCase(); });',
        'if(jObj){ jObj.poste = res.joueur.poste; jObj.photo = res.joueur.photo; jObj.note = res.joueur.note; }',
        'rendreRosterGrid(); initialiserColonnes();',
        'setTimeout(function(){ fermerModalJoueur(); }, 800);',
      '}).withFailureHandler(function(err){',
        'document.getElementById("modalJoueurStatus").textContent = err.message;',
        'afficherToast(err.message, "erreur");',
      '}).enregistrerFicheJoueurParCoach(SESSION_TEL, SESSION_PIN, jCible);',
    '}',
    'function supprimerJoueurCourant(){',
      'if(!JOUEUR_MODAL_COURANT) return;',
      'if(!confirm("Voulez-vous vraiment supprimer " + JOUEUR_MODAL_COURANT + " de l\'effectif du club ?")) return;',
      'document.getElementById("modalJoueurStatus").textContent = "Suppression en cours...";',
      'google.script.run.withSuccessHandler(function(res){',
        'afficherToast("Joueur " + JOUEUR_MODAL_COURANT + " supprimé de l\'effectif.", "info");',
        'EFFECTIF_COMPLET = EFFECTIF_COMPLET.filter(function(x){ return x.nom.toLowerCase() !== JOUEUR_MODAL_COURANT.toLowerCase(); });',
        'JOUEURS = JOUEURS.filter(function(x){ return x.nom.toLowerCase() !== JOUEUR_MODAL_COURANT.toLowerCase(); });',
        'rendreRosterGrid(); initialiserColonnes();',
        'fermerModalJoueur();',
      '}).withFailureHandler(function(err){',
        'document.getElementById("modalJoueurStatus").textContent = err.message;',
        'afficherToast(err.message, "erreur");',
      '}).supprimerJoueurParCoach(SESSION_TEL, SESSION_PIN, JOUEUR_MODAL_COURANT);',
    '}',
    'function ouvrirModalNouveauJoueur(){',
      'document.getElementById("inpNouvNom").value = "";',
      'document.getElementById("inpNouvTel").value = "";',
      'document.getElementById("inpNouvNote").value = "";',
      'document.getElementById("selNouvPoste").value = "Demi-Centre";',
      'var boxNTres = document.getElementById("boxNouvJoueurTresorier");',
      'var chkNTres = document.getElementById("inpNouvTresorier");',
      'if(boxNTres) boxNTres.style.display = (EST_COACH || EST_TRESORIER) ? "flex" : "none";',
      'if(chkNTres){ chkNTres.checked = false; chkNTres.disabled = !EST_COACH; }',
      'majOptionsEquipesSelects();',
      'if(document.getElementById("selNouvEquipe") && document.getElementById("selNouvEquipe").options.length > 0){',
        'document.getElementById("selNouvEquipe").selectedIndex = 0;',
      '}',
      'document.getElementById("statusNouvJoueur").textContent = "";',
      'document.getElementById("modalNouveauJoueurBg").style.display = "flex";',
    '}',
    'function fermerModalNouveauJoueur(){ document.getElementById("modalNouveauJoueurBg").style.display = "none"; }',
    'function fermerModalNouveauJoueurSurBg(e){ if(e.target.id === "modalNouveauJoueurBg") fermerModalNouveauJoueur(); }',
    'function creerNouveauJoueurClient(){',
      'var nom = document.getElementById("inpNouvNom").value.trim();',
      'if(!nom){ document.getElementById("statusNouvJoueur").textContent = "Le nom est obligatoire."; return; }',
      'var tel = document.getElementById("inpNouvTel").value.trim();',
      'var poste = document.getElementById("selNouvPoste").value;',
      'var eq = document.getElementById("selNouvEquipe").value;',
      'var note = document.getElementById("inpNouvNote").value.trim();',
      'var chkNTres = document.getElementById("inpNouvTresorier");',
      'var estNTres = (chkNTres && EST_COACH) ? chkNTres.checked : false;',
      'document.getElementById("statusNouvJoueur").textContent = "Création du joueur...";',
      'google.script.run.withSuccessHandler(function(res){',
        'afficherToast("Joueur " + res.joueur.nom + " ajouté à l\'effectif !", "succes");',
        'EFFECTIF_COMPLET.push(res.joueur);',
        'rendreRosterGrid();',
        'fermerModalNouveauJoueur();',
      '}).withFailureHandler(function(err){',
        'document.getElementById("statusNouvJoueur").textContent = err.message;',
        'afficherToast(err.message, "erreur");',
      '}).ajouterJoueurParCoach(SESSION_TEL, SESSION_PIN, { nom: nom, tel: tel, poste: poste, equipe: eq, note: note, estTresorier: estNTres });',
    '}',
    'var MODAL_RENFORT_IS_TRAIN = false;',
    'function ouvrirModalRenfort(estTrain){',
      'MODAL_RENFORT_IS_TRAIN = !!estTrain;',
      'document.getElementById("inpFiltreRenfort").value = "";',
      'if(document.getElementById("inpInviteNom")) document.getElementById("inpInviteNom").value = "";',
      'rendreListeRenforts("");',
      'document.getElementById("modalRenfortBg").style.display = "flex";',
    '}',
    'function fermerModalRenfort(){ document.getElementById("modalRenfortBg").style.display = "none"; }',
    'function fermerModalRenfortSurBg(e){ if(e.target.id === "modalRenfortBg") fermerModalRenfort(); }',
    'function filtrerListeRenforts(filtre){ rendreListeRenforts(filtre); }',
    'function rendreListeRenforts(filtre){',
      'var container = document.getElementById("listeRenfortsDispos"); if(!container) return;',
      'container.innerHTML = "";',
      'var q = String(filtre || "").toLowerCase().trim();',
      'var dejaNoms = [];',
      'if(MODAL_RENFORT_IS_TRAIN){',
        'dejaNoms = (ENTRAINEMENTS[SEANCE_COURANTE] || []).map(function(x){ return x.nom.toLowerCase(); });',
      '} else {',
        'dejaNoms = (JOUEURS || []).map(function(x){ return x.nom.toLowerCase(); });',
      '}',
      'var dispoAjout = EFFECTIF_COMPLET.filter(function(x){',
        'if(dejaNoms.indexOf(x.nom.toLowerCase()) !== -1) return false;',
        'if(q && !x.nom.toLowerCase().includes(q)) return false;',
        'return true;',
      '});',
      'if(dispoAjout.length === 0){',
        'container.innerHTML = "<div style=\'color:#94a3b8;font-size:0.75rem;padding:8px;text-align:center;\'>Aucun autre joueur disponible dans l\'effectif.</div>";',
        'return;',
      '}',
      'dispoAjout.forEach(function(j){',
        'var row = document.createElement("div");',
        'row.style.display = "flex"; row.style.alignItems = "center"; row.style.justifyContent = "space-between";',
        'row.style.background = "#090d16"; row.style.padding = "8px 10px"; row.style.borderRadius = "8px"; row.style.border = "1px solid rgba(148,163,184,0.12)";',
        'var info = document.createElement("div");',
        'info.innerHTML = "<div style=\'font-weight:700;font-size:0.82rem;color:#f8fafc;\'>" + j.nom + "</div><div style=\'font-size:0.7rem;color:#94a3b8;\'>" + (j.poste || "Demi-Centre") + (j.equipe ? (" • " + j.equipe) : "") + "</div>";',
        'var btn = document.createElement("button");',
        'btn.className = "btn-enter"; btn.style.padding = "5px 10px"; btn.style.fontSize = "0.75rem"; btn.style.width = "auto"; btn.style.margin = "0";',
        'btn.textContent = "+ Sélectionner";',
        'btn.onclick = function(){ ajouterRenfortClient(j.nom); };',
        'row.appendChild(info); row.appendChild(btn); container.appendChild(row);',
      '});',
    '}',
    'function ajouterRenfortClient(nomJoueur){',
      'var p = EFFECTIF_COMPLET.find(function(x){ return x.nom.toLowerCase() === nomJoueur.toLowerCase(); });',
      'if(!p) return;',
      'var rj = { nom: p.nom, poste: p.poste || "Demi-Centre", photo: p.photo || "", note: p.note || "", entrainements: 0, dispo1B: true, dispo1C: true, dispo1D: true, renfort: true };',
      'if(MODAL_RENFORT_IS_TRAIN){',
        'if(!ENTRAINEMENTS[SEANCE_COURANTE]) ENTRAINEMENTS[SEANCE_COURANTE] = [];',
        'ENTRAINEMENTS[SEANCE_COURANTE].push(rj);',
        'var trPool = document.getElementById("trZonePool");',
        'if(trPool) trPool.appendChild(creerCarte(rj));',
        'majCompteursTrain(); initSortables();',
      '} else {',
        'JOUEURS.push(rj);',
        'var pool = document.getElementById("zonePool");',
        'if(pool) pool.appendChild(creerCarte(rj));',
        'majCompteurs(); initSortables(); sauvegarderBrouillonLocal(false);',
        'if(MODE_TINDER) afficherCarteTinder();',
      '}',
      'afficherToast("Renfort " + p.nom + " ajouté !", "succes");',
      'fermerModalRenfort();',
    '}',
    'function ajouterInviteClient(){',
      'var nom = document.getElementById("inpInviteNom").value.trim();',
      'if(!nom){ afficherToast("Veuillez saisir le nom de l\'invité.", "erreur"); return; }',
      'var poste = document.getElementById("selInvitePoste").value;',
      'var rj = { nom: nom, poste: poste, photo: "", note: "Invité extérieur", entrainements: 0, dispo1B: true, dispo1C: true, dispo1D: true, renfort: true };',
      'if(MODAL_RENFORT_IS_TRAIN){',
        'if(!ENTRAINEMENTS[SEANCE_COURANTE]) ENTRAINEMENTS[SEANCE_COURANTE] = [];',
        'ENTRAINEMENTS[SEANCE_COURANTE].push(rj);',
        'var trPool = document.getElementById("trZonePool");',
        'if(trPool) trPool.appendChild(creerCarte(rj));',
        'majCompteursTrain(); initSortables();',
      '} else {',
        'JOUEURS.push(rj);',
        'var pool = document.getElementById("zonePool");',
        'if(pool) pool.appendChild(creerCarte(rj));',
        'majCompteurs(); initSortables(); sauvegarderBrouillonLocal(false);',
        'if(MODE_TINDER) afficherCarteTinder();',
      '}',
      'afficherToast("Invité " + nom + " ajouté !", "succes");',
      'fermerModalRenfort();',
    '}',
    'function getCollectifsSauvegardes(){',
      'try {',
        'var s = localStorage.getItem("hb_multi_collectifs");',
        'if(s) return JSON.parse(s);',
      '} catch(e){}',
      'return [];',
    '}',
    'function sauvegarderCollectifsLocal(liste){',
      'try { localStorage.setItem("hb_multi_collectifs", JSON.stringify(liste)); } catch(e){}',
    '}',
    'function ouvrirModalCollectifs(){',
      'rendreListeCollectifs();',
      'document.getElementById("modalCollectifsBg").style.display = "flex";',
    '}',
    'function fermerModalCollectifs(){ document.getElementById("modalCollectifsBg").style.display = "none"; }',
    'function fermerModalCollectifsSurBg(e){ if(e.target.id === "modalCollectifsBg") fermerModalCollectifs(); }',
    'function rendreListeCollectifs(){',
      'var container = document.getElementById("listeCollectifs"); if(!container) return;',
      'container.innerHTML = "";',
      'var colls = getCollectifsSauvegardes();',
      'var itemCur = document.createElement("div");',
      'itemCur.style.display = "flex"; itemCur.style.alignItems = "center"; itemCur.style.justifyContent = "space-between"; itemCur.style.background = "#0e1626"; itemCur.style.padding = "10px 12px"; itemCur.style.borderRadius = "10px"; itemCur.style.border = "1px solid var(--color-primary)";',
      'itemCur.innerHTML = "<div><div style=\'font-weight:800;font-size:0.85rem;color:#f8fafc;\'>" + (CLUB_CONFIG.nomClub || "Collectif Actuel") + "</div><div style=\'font-size:0.7rem;color:#94a3b8;\'>Collectif en cours d\'utilisation</div></div><span style=\'font-size:0.72rem;background:var(--color-primary);color:#fff;padding:3px 8px;border-radius:12px;font-weight:700;\'>Actif</span>";',
      'container.appendChild(itemCur);',
      'colls.forEach(function(c, idx){',
        'var row = document.createElement("div");',
        'row.style.display = "flex"; row.style.alignItems = "center"; row.style.justifyContent = "space-between"; row.style.background = "#090d16"; row.style.padding = "10px 12px"; row.style.borderRadius = "10px"; row.style.border = "1px solid rgba(148,163,184,0.15)";',
        'var info = document.createElement("div");',
        'info.innerHTML = "<div style=\'font-weight:700;font-size:0.85rem;color:#e2e8f0;\'>" + c.nom + "</div><div style=\'font-size:0.68rem;color:#94a3b8;word-break:break-all;\'>" + c.url.substring(0, 40) + "...</div>";',
        'var acts = document.createElement("div"); acts.style.display = "flex"; acts.style.gap = "6px";',
        'var btnGo = document.createElement("button"); btnGo.className = "btn-enter"; btnGo.style.padding = "5px 10px"; btnGo.style.fontSize = "0.75rem"; btnGo.style.width = "auto"; btnGo.style.margin = "0"; btnGo.textContent = "Basculer";',
        'btnGo.onclick = function(){ window.location.href = c.url; };',
        'var btnDel = document.createElement("button"); btnDel.className = "btn-reset"; btnDel.style.padding = "4px 8px"; btnDel.style.fontSize = "0.75rem"; btnDel.textContent = "✕";',
        'btnDel.onclick = function(){ colls.splice(idx, 1); sauvegarderCollectifsLocal(colls); rendreListeCollectifs(); };',
        'acts.appendChild(btnGo); acts.appendChild(btnDel); row.appendChild(info); row.appendChild(acts); container.appendChild(row);',
      '});',
    '}',
    'function ajouterCollectifLie(){',
      'var nom = document.getElementById("inpNouvCollectifNom").value.trim();',
      'var url = document.getElementById("inpNouvCollectifUrl").value.trim();',
      'if(!nom || !url){ afficherToast("Veuillez saisir un nom et une URL valide.", "erreur"); return; }',
      'if(!url.startsWith("http://") && !url.startsWith("https://")){ afficherToast("L\'URL doit commencer par https://", "erreur"); return; }',
      'var colls = getCollectifsSauvegardes();',
      'colls.push({ nom: nom, url: url });',
      'sauvegarderCollectifsLocal(colls);',
      'document.getElementById("inpNouvCollectifNom").value = "";',
      'document.getElementById("inpNouvCollectifUrl").value = "";',
      'afficherToast("Collectif " + nom + " lié avec succès !", "succes");',
      'rendreListeCollectifs();',
    '}',
    'var DEFERRED_PWA_PROMPT = null;',
    'window.addEventListener("beforeinstallprompt", function(e){',
      'e.preventDefault();',
      'DEFERRED_PWA_PROMPT = e;',
      'var b = document.getElementById("btnPwaNativeInstall");',
      'if(b) b.style.display = "block";',
    '});',
    'function gererToucheClavier(e){',
      'var k = e.key || ""; var code = e.code || "";',
      'if(k === "Escape"){',
        'if(typeof fermerModalJoueur === "function") fermerModalJoueur();',
        'if(typeof fermerModalRenfort === "function") fermerModalRenfort();',
        'if(typeof fermerModalCollectifs === "function") fermerModalCollectifs();',
        'if(typeof fermerModalConfigEntrainements === "function") fermerModalConfigEntrainements();',
        'if(typeof fermerModalGuideCoach === "function") fermerModalGuideCoach();',
        'if(typeof fermerModalNouveauJoueur === "function") fermerModalNouveauJoueur();',
        'if(typeof fermerModalMvpChevre === "function") fermerModalMvpChevre();',
        'if(typeof fermerModalCovoiturage === "function") fermerModalCovoiturage();',
        'if(typeof fermerModalAbsence === "function") fermerModalAbsence();',
        'if(typeof fermerProfilJoueurPublic === "function") fermerProfilJoueurPublic();',
        'if(typeof fermerModalCaisseNoire === "function") fermerModalCaisseNoire();',
        'if(typeof fermerModalAdminCaisseNoire === "function") fermerModalAdminCaisseNoire();',
        'return;',
      '}',
      'var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : "";',
      'if(tag === "input" || tag === "textarea" || tag === "select" || (document.activeElement && document.activeElement.isContentEditable)) return;',
      'var modales = document.querySelectorAll(".modal-bg");',
      'for(var mi = 0; mi < modales.length; mi++){',
        'var m = modales[mi];',
        'if(m && (m.style.display === "flex" || m.style.display === "block")) return;',
      '}',
      'var ctrl = e.ctrlKey || e.metaKey;',
      'var isLeft = (k === "ArrowLeft" || code === "ArrowLeft" || code === "KeyA" || code === "KeyQ");',
      'var isRight = (k === "ArrowRight" || code === "ArrowRight" || code === "KeyD");',
      'var isDown = (k === "ArrowDown" || code === "ArrowDown" || code === "KeyS");',
      'var isUp = (k === "ArrowUp" || code === "ArrowUp" || code === "KeyW" || code === "KeyZ");',
      'var is1 = (k === "1" || k === "&" || code === "Digit1" || code === "Numpad1");',
      'var is2 = (k === "2" || k === "é" || code === "Digit2" || code === "Numpad2");',
      'var is3 = (k === "3" || k === "\\"" || code === "Digit3" || code === "Numpad3");',
      'var is0orSpace = (k === "0" || k === "à" || code === "Digit0" || code === "Numpad0" || k === " " || code === "Space");',
      'var isUndo = (k === "Backspace" || code === "Backspace" || (ctrl && (code === "KeyZ" || k === "z" || k === "Z")) || k === "u" || k === "U");',
      'if(is0orSpace && document.activeElement && document.activeElement.tagName === "BUTTON"){',
        'document.activeElement.blur();',
      '}',
      'var tView = document.getElementById("tinderView");',
      'var isMatchTinder = MODE_TINDER && tView && (tView.style.display === "block" || getComputedStyle(tView).display !== "none");',
      'if(isMatchTinder){',
        'var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;',
        'if(isUndo){ e.preventDefault(); annulerDernierSwipe(); return; }',
        'if(nbEq === 1){',
          'if(isLeft || isDown || is0orSpace){ e.preventDefault(); animerVoteBouton("OUT"); }',
          'else if(isRight || isUp || is1){ e.preventDefault(); animerVoteBouton("1B"); }',
        '} else if(nbEq === 2){',
          'if(isLeft || is1){ e.preventDefault(); animerVoteBouton("1B"); }',
          'else if(isRight || is2){ e.preventDefault(); animerVoteBouton("1C"); }',
          'else if(isDown || is0orSpace){ e.preventDefault(); animerVoteBouton("OUT"); }',
        '} else {',
          'if(isUp || is1){ e.preventDefault(); animerVoteBouton("1B"); }',
          'else if(isLeft || is2){ e.preventDefault(); animerVoteBouton("1C"); }',
          'else if(isRight || is3){ e.preventDefault(); animerVoteBouton("1D"); }',
          'else if(isDown || is0orSpace){ e.preventDefault(); animerVoteBouton("OUT"); }',
        '}',
        'return;',
      '}',
      'var trView = document.getElementById("trainTinderView");',
      'var isTrainTinder = TRAIN_MODE_TINDER && trView && (trView.style.display === "block" || getComputedStyle(trView).display !== "none");',
      'if(isTrainTinder){',
        'var cfgS = (TRAIN_CONFIG && TRAIN_CONFIG[SEANCE_COURANTE]) ? TRAIN_CONFIG[SEANCE_COURANTE] : { type: "separe" };',
        'if(isUndo){ e.preventDefault(); annulerDernierSwipeTrain(); return; }',
        'if(cfgS.type === "separe"){',
          'if(isLeft || is1){ e.preventDefault(); animerVoteBoutonTrain("G1"); }',
          'else if(isRight || is2){ e.preventDefault(); animerVoteBoutonTrain("G2"); }',
          'else if(isDown || is0orSpace){ e.preventDefault(); animerVoteBoutonTrain("OUT"); }',
        '} else if(cfgS.type === "reduit"){',
          'if(isLeft || isDown || is0orSpace){ e.preventDefault(); animerVoteBoutonTrain("OUT"); }',
          'else if(isRight || isUp || is1){ e.preventDefault(); animerVoteBoutonTrain("RETENU"); }',
        '} else {',
          'if(isLeft || isDown || is0orSpace){ e.preventDefault(); animerVoteBoutonTrain("MENAGE"); }',
          'else if(isRight || isUp || is1){ e.preventDefault(); animerVoteBoutonTrain("ACTIF"); }',
        '}',
        'return;',
      '}',
    '}',
    'window.addEventListener("keydown", gererToucheClavier);',
    'function ouvrirModalPwa(){',
      'var isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;',
      'var iosG = document.getElementById("pwaIosGuide"), andG = document.getElementById("pwaAndroidGuide");',
      'if(isIos){',
        'if(iosG) iosG.style.display = "block";',
        'if(andG) andG.style.display = "none";',
      '} else {',
        'if(iosG) iosG.style.display = "none";',
        'if(andG) andG.style.display = "block";',
      '}',
      'document.getElementById("modalPwaInstallBg").style.display = "flex";',
    '}',
    'function fermerModalPwa(){ document.getElementById("modalPwaInstallBg").style.display = "none"; }',
    'function fermerModalPwaSurBg(e){ if(e.target.id === "modalPwaInstallBg") fermerModalPwa(); }',
    'function ouvrirModalGuideCoach(){ document.getElementById("modalGuideCoachBg").style.display = "flex"; }',
    'function fermerModalGuideCoach(){ document.getElementById("modalGuideCoachBg").style.display = "none"; }',
    'function fermerModalGuideCoachSurBg(e){ if(e.target.id === "modalGuideCoachBg") fermerModalGuideCoach(); }',
    'function declencherPwaNative(){',
      'if(DEFERRED_PWA_PROMPT){',
        'DEFERRED_PWA_PROMPT.prompt();',
        'DEFERRED_PWA_PROMPT.userChoice.then(function(choice){',
          'if(choice.outcome === "accepted"){ afficherToast("Application installée avec succès !", "succes"); fermerModalPwa(); }',
          'DEFERRED_PWA_PROMPT = null;',
        '});',
      '} else {',
        'afficherToast("Suivez les indications de votre navigateur pour installer l\'icône.", "info");',
      '}',
    '}',
    'function afficherToast(msg, type, duree){',
      'type = type || "info"; duree = duree || 3500;',
      'var c = document.getElementById("toastContainer");',
      'if(!c){',
        'c = document.createElement("div"); c.id = "toastContainer"; document.body.appendChild(c);',
      '}',
      'var item = document.createElement("div");',
      'item.className = "toast-item toast-" + type;',
      'item.textContent = msg;',
      'c.appendChild(item);',
      'setTimeout(function(){',
        'item.style.opacity = "0"; item.style.transform = "translateY(10px)"; item.style.transition = "all 0.3s ease";',
        'setTimeout(function(){ if(item.parentNode) item.parentNode.removeChild(item); }, 300);',
      '}, duree);',
    '}',
    'window.onload = function(){',
    '  initSortables();',
    '  rendreOngletsTrain();',
    '  majAffichageModesParDefaut();',
    '  window.addEventListener("resize", majAffichageModesParDefaut);',
    '  try {',
    '    var t = localStorage.getItem("hb_tel"), p = localStorage.getItem("hb_pin");',
    '    if(t) document.getElementById("inpTel").value = t;',
    '    if(t && p){ document.getElementById("inpPin").value = p; seConnecter(); }',
    '    else { masquerLoading(); }',
    '  } catch(e){ masquerLoading(); }',
    '};',
    '[[/script]][[/body]][[/html]]'
  ].join('\n');

  return tpl.split('[[').join(String.fromCharCode(60)).split(']]').join(String.fromCharCode(62));
}

function executionAutoLundiMatin() {
  genererSondageHebdo();
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

function extraireMatchFFHB(urlPoule, motCleClub, dateDebutSemaine, dateFinSemaine) {
  try {
    let urlPropre = String(urlPoule || '').trim();
    if (!urlPropre.startsWith('http://') && !urlPropre.startsWith('https://')) {
      if (urlPropre.startsWith('/competitions/')) {
        urlPropre = 'https://www.ffhandball.fr' + urlPropre;
      } else if (urlPropre.startsWith('competitions/')) {
        urlPropre = 'https://www.ffhandball.fr/' + urlPropre;
      } else {
        urlPropre = 'https://www.ffhandball.fr/competitions/' + urlPropre;
      }
    }
    const motCle = String(motCleClub || '').toUpperCase().trim();
    const urlBase = urlPropre.replace(/\/journee-\d+\/?\(/i, '/').replace(/\/?\)/, '/');

    function scannerUrl(urlCible) {
      const resp = UrlFetchApp.fetch(urlCible, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9' }
      });
      const htmlBrut = resp.getContentText('UTF-8');
      const matchsTrouves = [];
      let mAttr;
      const regexAttrDouble = /attributes="([^"]+)"/gi;
      while ((mAttr = regexAttrDouble.exec(htmlBrut)) !== null) chercherMatchsDansJson(decoderEntites(mAttr[1]), motCle, matchsTrouves, null);
      const regexAttrSingle = /attributes='([^']+)'/gi;
      while ((mAttr = regexAttrSingle.exec(htmlBrut)) !== null) chercherMatchsDansJson(decoderEntites(mAttr[1]), motCle, matchsTrouves, null);

      const htmlDecode = decoderEntites(htmlBrut).replace(/\\"/g, '"').replace(/\\\//g, '/');
      if (matchsTrouves.length === 0) {
        const regexObjJson = /\{[^{}]{15,1500}\}/g;
        let mObj;
        while ((mObj = regexObjJson.exec(htmlDecode)) !== null) {
          if (mObj[0].toUpperCase().indexOf(motCle) !== -1) chercherMatchsDansJson(mObj[0], motCle, matchsTrouves, null);
        }
      }
      return { matchs: matchsTrouves };
    }

    const scanInitial = scannerUrl(urlBase);
    const tousLesMatchs = scanInitial.matchs;

    function chercherDansSemaine(liste) {
      for (let i = 0; i < liste.length; i++) {
        const m = liste[i];
        if (m.dateObj >= dateDebutSemaine && m.dateObj <= dateFinSemaine) {
          m.found = true; m.statut = 'Détecté (Semaine en cours)'; return m;
        }
      }
      return null;
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

    let matchSemaine = chercherDansSemaine(tousLesMatchs);
    if (matchSemaine) return enrichirSalleMatch(matchSemaine);

    for (let numJ = 1; numJ <= 22; numJ++) {
      const scanJ = scannerUrl(urlBase + 'journee-' + numJ + '/');
      if (scanJ.matchs.length === 0) continue;
      for (let k = 0; k < scanJ.matchs.length; k++) tousLesMatchs.push(scanJ.matchs[k]);
      matchSemaine = chercherDansSemaine(scanJ.matchs);
      if (matchSemaine) { matchSemaine.statut = 'Détecté (Journée ' + numJ + ')'; return enrichirSalleMatch(matchSemaine); }
      if (scanJ.matchs[0].dateObj > dateFinSemaine) break;
    }

    if (tousLesMatchs.length > 0) {
      tousLesMatchs.sort(function(a, b) { return a.dateObj.getTime() - b.dateObj.getTime(); });
      const prochain = tousLesMatchs.find(function(m) { return m.dateObj > dateFinSemaine; }) || tousLesMatchs[tousLesMatchs.length - 1];
      return { found: false, statut: 'Exempt / Repos cette semaine (prochain match : ' + prochain.dateTexte + ')' };
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

function declencherEnvoiWhatsApp() {
  let sondageJson = PropertiesService.getScriptProperties().getProperty('DERNIER_SONDAGE_JSON');
  if (!sondageJson) {
    genererSondageHebdo();
    sondageJson = PropertiesService.getScriptProperties().getProperty('DERNIER_SONDAGE_JSON');
  }
  const donnees = JSON.parse(sondageJson);
  declencherActionGitHub('send_whatsapp_poll', { poll_title: donnees.titre, poll_options: donnees.options });
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
function verifierMiseAJour() {
  try {
    const url = 'https://raw.githubusercontent.com/' + UPSTREAM_TEMPLATE_REPO + '/main/version.json?t=' + new Date().getTime();
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const data = JSON.parse(res.getContentText('UTF-8'));
      const estPlusRecent = comparerVersionsSemver(data.version, APP_VERSION) > 0;
      return {
        disponible: estPlusRecent,
        versionActuelle: APP_VERSION,
        versionDistante: String(data.version || ''),
        titre: String(data.title || ''),
        date: String(data.releaseDate || ''),
        changelog: Array.isArray(data.changelog) ? data.changelog : [],
        repoUrl: data.repoUrl || ('https://github.com/' + UPSTREAM_TEMPLATE_REPO),
        codeGsUrl: data.codeGsRawUrl || ('https://raw.githubusercontent.com/' + UPSTREAM_TEMPLATE_REPO + '/main/code.gs')
      };
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
      .addItem('🎨 7. Actualiser les couleurs et styles', 'actualiserCouleursClasseur')
      .addItem('🔄 8. Vérifier les mises à jour du modèle', 'menuVerifierMiseAJour')
      .addSeparator()
      .addItem('🔐 9. Chiffrer tous les numéros de l\'effectif (RGPD)', 'menuChiffrerNumerosEffectif')
      .addItem('🔓 10. Déchiffrer tous les numéros de l\'effectif', 'menuDechiffrerNumerosEffectif')
      .addSeparator()
      .addItem('🚀 Tout exécuter (Mise à jour + Envoi)', 'executionAutoLundiMatin')
      .addToUi();
  } catch (e) {}
}

