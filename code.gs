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
const APP_VERSION = '1.3.0';
// Dépôt modèle officiel pour la vérification automatique des mises à jour
const UPSTREAM_TEMPLATE_REPO = 'pidgey56/handball-bot-template';

// Logo de secours (Handball SVG moderne généré dynamiquement selon la couleur principale)
function genererLogoDefaut(couleur) {
  const hex = encodeURIComponent(couleur || '#f97316');
  return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="' + hex + '"><circle cx="12" cy="12" r="10" stroke="%23cbd5e1" stroke-width="1.5" fill="%231e293b"/><path d="M12 2a10 10 0 0 0 0 20M2 12a10 10 0 0 0 20 0M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14" stroke="%23cbd5e1" stroke-width="1.2" fill="none"/></svg>';
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
  const classeur = ss || getSpreadsheet();
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

  const nbEquipes = Math.min(3, Math.max(1, equipes.length));

  // Lecture des entraînements configurés (Lignes 9 à 14)
  const rowsTrain = shCfg.getRange('B9:D14').getValues();
  const entrainements = [];
  rowsTrain.forEach(function(r) {
    const intitule = String(r[1] || '').trim();
    const actif = String(r[2] || 'NON').trim().toUpperCase() === 'OUI';
    if (intitule) {
      entrainements.push({ label: intitule, actif: actif });
    }
  });

  const groupId = getVal('C18', '');
  const githubRepo = getVal('C19', '');
  const githubToken = getVal('C20', '');
  const webappUrl = getVal('C21', '');
  const nomClub = getVal('C22', 'Mon Club Handball');
  const logoUrlRaw = getVal('C23', '');
  const salleDefaut = getVal('C24', 'Domicile');
  const adminPhonesRaw = getVal('C25', '');
  const adminPhones = adminPhonesRaw.split(',').map(function(t) { return normaliserNumero(t.trim()); }).filter(Boolean);

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

  const logoFinal = (logoUrlRaw && logoUrlRaw !== LOGO_DEFAULT && !logoUrlRaw.includes('data:image/svg+xml')) ? logoUrlRaw : genererLogoDefaut(couleurPrimaire);

  const labelEq1 = (equipes[0] && equipes[0].labelSondage) ? equipes[0].labelSondage : 'Équipe 1';
  const labelEq2 = (equipes[1] && equipes[1].labelSondage) ? equipes[1].labelSondage : 'Équipe 2';
  const labelEq3 = (equipes[2] && equipes[2].labelSondage) ? equipes[2].labelSondage : 'Équipe 3';

  return {
    nomClub: nomClub,
    logoUrl: logoFinal,
    salleDefaut: salleDefaut,
    adminPhones: adminPhones,
    groupId: groupId,
    githubRepo: githubRepo,
    githubToken: githubToken,
    webappUrl: webappUrl,
    equipes: equipes,
    nbEquipes: nbEquipes,
    entrainements: entrainements,
    nomEquipe1: labelEq1,
    nomEquipe2: labelEq2,
    nomEquipe3: labelEq3,
    couleurPrimaire: couleurPrimaire,
    couleurSecondaire: couleurSecondaire,
    couleurEquipe1: couleurEquipe1,
    couleurEquipe2: couleurEquipe2,
    couleurEquipe3: couleurEquipe3
  };
}

function getDefaultConfig() {
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
      { code: 'Équipe 2', motCle: 'MON CLUB', labelSondage: 'Équipe 2', delaiRdv: 1, urlPoule: '' }
    ],
    nbEquipes: 2,
    entrainements: [],
    nomEquipe1: 'Équipe 1',
    nomEquipe2: 'Équipe 2',
    nomEquipe3: 'Équipe 3'
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
      const salle = resultat.salle || (resultat.estDomicile ? cfg.salleDefaut : 'Extérieur');
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
function initialiserOngletsWebApp() {
  const ss = getSpreadsheet();
  const cfg = getClubConfig(ss);

  let shEff = ss.getSheetByName('Effectif');
  if (!shEff) {
    shEff = ss.insertSheet('Effectif');
    shEff.getRange('A1:G1').setValues([['Nom / Surnom', 'Téléphone (format 336...)', 'Poste', 'Équipe habituelle', 'Photo (URL ou lien Drive)', 'Code PIN (Auto)', 'Notes Coach']]).setFontWeight('bold');
  }

  let shVotes = ss.getSheetByName('Votes_Semaine');
  let entetesVotes;
  if (cfg.nbEquipes === 1) {
    entetesVotes = ['Joueur', 'Poste', 'Nb Entraînements (0-3)', 'Dispo ' + cfg.nomEquipe1, 'Dispo Lundi', 'Dispo Mercredi', 'Dispo Jeudi'];
  } else if (cfg.nbEquipes === 3) {
    entetesVotes = ['Joueur', 'Poste', 'Nb Entraînements (0-3)', 'Dispo ' + cfg.nomEquipe1, 'Dispo ' + cfg.nomEquipe2, 'Dispo ' + cfg.nomEquipe3, 'Dispo Lundi', 'Dispo Mercredi', 'Dispo Jeudi'];
  } else {
    entetesVotes = ['Joueur', 'Poste', 'Nb Entraînements (0-3)', 'Dispo ' + cfg.nomEquipe1, 'Dispo ' + cfg.nomEquipe2, 'Dispo Lundi', 'Dispo Mercredi', 'Dispo Jeudi'];
  }
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
    }
  }
}

/**
 * Initialise l'intégralité du classeur avec onglets, exemples et mise en page (1 clic pour démarrer)
 */
function initialiserClasseurComplet() {
  const ss = getSpreadsheet();

  let shCfg = ss.getSheetByName('Configuration');
  if (!shCfg) {
    shCfg = ss.insertSheet('Configuration', 0);
  }

  shCfg.getRange('A1').setValue("Paramètres d'Automatisation - Handball Bot").setFontWeight('bold').setFontSize(13);
  shCfg.getRange('B3:F3').setValues([['Code Équipe', 'Nom recherché (Mot-clé FFHB)', 'Libellé dans le sondage', 'Délai RDV avant match (heures)', 'URL de la poule FFHB']]).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  shCfg.getRange('B4:F5').setValues([
    ['Équipe 1', 'MON CLUB', 'Équipe 1', 1.0, 'https://www.ffhandball.fr/competitions/...'],
    ['Équipe 2', 'MON CLUB', 'Équipe 2', 1.0, 'https://www.ffhandball.fr/competitions/...']
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
  shCfg.getRange('B18:D29').setValues([
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
    ['Couleur Équipe 2 (Hex)', '#f97316', 'Couleur des maillots / colonne Équipe 2']
  ]);

  try {
    shCfg.getRange('D26').setBackground('#f97316').setFontColor('#ffffff').setValue('Aperçu');
    shCfg.getRange('D27').setBackground('#fbbf24').setFontColor('#111827').setValue('Aperçu');
    shCfg.getRange('D28').setBackground('#3b82f6').setFontColor('#ffffff').setValue('Aperçu');
    shCfg.getRange('D29').setBackground('#f97316').setFontColor('#ffffff').setValue('Aperçu');
  } catch (e) {}

  initialiserOngletsWebApp();

  const shEff = ss.getSheetByName('Effectif');
  if (shEff && shEff.getLastRow() <= 1) {
    shEff.getRange(2, 1, 6, 7).setValues([
      ['Lucas Martin', '33601020304', 'Gardien', 'Équipe 1', '', '', 'Exemple note coach'],
      ['Thomas Dupont', '33602030405', 'Demi-Centre', 'Équipe 1', '', '', 'Capitaine'],
      ['Maxime Bernard', '33603040506', 'Pivot', 'Équipe 2', '', '', ''],
      ['Julien Robert', '33604050607', 'Ailier Gauche', 'Équipe 2', '', '', ''],
      ['Alexandre Petit', '33605060708', 'Arrière Droit', 'Équipe 1', '', '', ''],
      ['Romain Laurent', '33606070809', 'Arrière Gauche', 'Équipe 1', '', '', '']
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

  shCfg.getRange('B26:C30').setValues([
    ['Couleur Principale Club (Hex)', cp],
    ['Couleur Secondaire Club (Hex)', cs],
    ['Couleur Équipe 1 (Hex)', c1],
    ['Couleur Équipe 2 (Hex)', c2],
    ['Couleur Équipe 3 (Hex)', c3]
  ]);

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

  return {
    ok: true,
    couleurs: {
      primaire: cp,
      secondaire: cs,
      equipe1: c1,
      equipe2: c2,
      equipe3: c3
    }
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

function verifierDroitsCoachOuDev(ss, tel, pin) {
  if (!tel) return false;
  const cfg = getClubConfig(ss);
  if (cfg.adminPhones && cfg.adminPhones.indexOf(tel) !== -1) return true;

  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) return false;
  const rows = shEff.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (normaliserNumero(r[1]) === tel) {
      const pinEnregistre = String(r[5] || '').trim();
      if (pinEnregistre && pinEnregistre !== pin) return false;
      const poste = String(r[2] || '').trim();
      if (/coach|entraineur|entraîneur|responsable/i.test(poste)) return true;
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
    if (normaliserNumero(rows[i][1]) === tel) {
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
  const estCoach = estAdmin || /coach|entraineur|entraîneur|responsable/i.test(posteJoueur);

  return {
    ok: true,
    telephone: tel,
    pin: pin,
    nom: nomJoueur,
    poste: posteJoueur,
    photo: photoJoueur,
    estCoach: estCoach
  };
}

function enregistrerMaPhoto(telephoneSaisi, pinSaisi, nouvellePhotoDataOuUrl) {
  const auth = authentifierUtilisateur(telephoneSaisi, pinSaisi);
  const ss = getSpreadsheet();
  const shEff = ss.getSheetByName('Effectif');
  const rows = shEff.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (normaliserNumero(rows[i][1]) === auth.telephone) {
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
    if (normaliserNumero(rows[i][1]) === auth.telephone) {
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
  if (!verifierDroitsCoachOuDev(ss, normaliserNumero(telCoach), String(pinCoach || '').trim())) {
    throw new Error('Action réservée aux coachs autorisés.');
  }
  if (!joueurCible || !joueurCible.nom) throw new Error('Données du joueur incomplètes.');

  const shEff = ss.getSheetByName('Effectif');
  if (!shEff) throw new Error('Onglet Effectif introuvable.');
  const rows = shEff.getDataRange().getValues();

  const nomCible = String(joueurCible.nom || '').trim();
  const nouveauPoste = String(joueurCible.poste || '').trim();
  let nouvellePhoto = String(joueurCible.photo || '').trim();
  const nouvelleNote = String(joueurCible.note || '').trim();

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

      if (nouveauPoste) shEff.getRange(i + 1, 3).setValue(nouveauPoste);
      if (nouvellePhoto) shEff.getRange(i + 1, 5).setValue(nouvellePhoto);
      shEff.getRange(i + 1, 7).setValue(nouvelleNote);

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

      return {
        ok: true,
        joueur: {
          nom: nomPropre,
          poste: nouveauPoste || String(rows[i][2] || 'Demi-Centre'),
          photo: convertirUrlPhoto(nouvellePhoto || rows[i][4]),
          note: nouvelleNote
        }
      };
    }
  }

  throw new Error('Joueur non trouvé dans l\'effectif.');
}

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'sync') {
    const nb = synchroniserDepuisGitHub();
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', count: nb })).setMimeType(ContentService.MimeType.JSON);
  }
  const html = construireHtmlWebApp();
  return HtmlService.createHtmlOutput(html)
    .setTitle((getClubConfig().nomClub || 'Handball') + ' - Compo Coach')
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
    const tel = normaliserNumero(r[1]);
    let poste = String(r[2] || 'Demi-Centre').trim();
    if (/polyvalent|joueur/i.test(poste)) poste = 'Demi-Centre';
    if (tel) mapTel[tel] = { nom: nomPropre, poste: poste };
    if (nomPropre) mapNom[nomPropre.toLowerCase()] = { nom: nomPropre, poste: poste };
    if (alias) mapNom[alias] = { nom: nomPropre, poste: poste };
  });

  const nbCols = cfg.nbEquipes === 1 ? 7 : (cfg.nbEquipes === 3 ? 9 : 8);
  const dictionnaireJoueurs = {};
  if (shVotes.getLastRow() > 1) {
    const lignesExistantes = shVotes.getRange(2, 1, shVotes.getLastRow() - 1, nbCols).getValues();
    lignesExistantes.forEach(function(r) {
      const nomExistant = String(r[0] || '').trim();
      if (nomExistant) {
        const ficheEff = mapNom[nomExistant.toLowerCase()];
        let posteExistant = ficheEff ? ficheEff.poste : String(r[1] || 'Demi-Centre').trim();
        if (/polyvalent|joueur/i.test(posteExistant)) posteExistant = 'Demi-Centre';
        let ligneJoueur;
        if (cfg.nbEquipes === 1) {
          ligneJoueur = [
            nomExistant,
            posteExistant,
            Number(r[2]) || 0,
            String(r[3] || 'NON').trim().toUpperCase(),
            String(r[4] || 'NON').trim().toUpperCase(),
            String(r[5] || 'NON').trim().toUpperCase(),
            String(r[6] || 'NON').trim().toUpperCase()
          ];
        } else if (cfg.nbEquipes === 3) {
          ligneJoueur = [
            nomExistant,
            posteExistant,
            Number(r[2]) || 0,
            String(r[3] || 'NON').trim().toUpperCase(),
            String(r[4] || 'NON').trim().toUpperCase(),
            String(r[5] || 'NON').trim().toUpperCase(),
            String(r[6] || 'NON').trim().toUpperCase(),
            String(r[7] || 'NON').trim().toUpperCase(),
            String(r[8] || 'NON').trim().toUpperCase()
          ];
        } else {
          ligneJoueur = [
            nomExistant,
            posteExistant,
            Number(r[2]) || 0,
            String(r[3] || 'NON').trim().toUpperCase(),
            String(r[4] || 'NON').trim().toUpperCase(),
            String(r[5] || 'NON').trim().toUpperCase(),
            String(r[6] || 'NON').trim().toUpperCase(),
            String(r[7] || 'NON').trim().toUpperCase()
          ];
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
    const oui = function(val, idx) { return val === undefined ? (ancien[idx] || 'NON') : (val ? 'OUI' : 'NON'); };

    const selOpts = Array.isArray(v.selectedOptions) ? v.selectedOptions.map(function(s){ return String(s).toUpperCase(); }) : [];
    const eq1Dispo = v.dispoEquipe1 || v.dispo1B || selOpts.some(function(s){ return s.includes(cfg.nomEquipe1.toUpperCase()); });
    const eq2Dispo = v.dispoEquipe2 || v.dispo1C || (cfg.nomEquipe2 ? selOpts.some(function(s){ return s.includes(cfg.nomEquipe2.toUpperCase()); }) : false);
    const eq3Dispo = v.dispoEquipe3 || v.dispo1D || (cfg.nomEquipe3 ? selOpts.some(function(s){ return s.includes(cfg.nomEquipe3.toUpperCase()); }) : false);

    if (cfg.nbEquipes === 1) {
      dictionnaireJoueurs[fiche.nom.toLowerCase()] = [
        fiche.nom,
        fiche.poste,
        Number(v.nbTrainings) || 0,
        eq1Dispo ? 'OUI' : 'NON',
        oui(v.dispoLundi, 4),
        oui(v.dispoMercredi, 5),
        oui(v.dispoJeudi, 6)
      ];
    } else if (cfg.nbEquipes === 3) {
      dictionnaireJoueurs[fiche.nom.toLowerCase()] = [
        fiche.nom,
        fiche.poste,
        Number(v.nbTrainings) || 0,
        eq1Dispo ? 'OUI' : 'NON',
        eq2Dispo ? 'OUI' : 'NON',
        eq3Dispo ? 'OUI' : 'NON',
        oui(v.dispoLundi, 6),
        oui(v.dispoMercredi, 7),
        oui(v.dispoJeudi, 8)
      ];
    } else {
      dictionnaireJoueurs[fiche.nom.toLowerCase()] = [
        fiche.nom,
        fiche.poste,
        Number(v.nbTrainings) || 0,
        eq1Dispo ? 'OUI' : 'NON',
        eq2Dispo ? 'OUI' : 'NON',
        oui(v.dispoLundi, 5),
        oui(v.dispoMercredi, 6),
        oui(v.dispoJeudi, 7)
      ];
    }
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
      effectifComplet.push({ nom: nomPropre, poste: posteEff, equipe: equipeEff, photo: photo, note: note });
    });
  }

  const rowsVotes = shVotes ? shVotes.getDataRange().getValues().slice(1) : [];
  const joueurs = [];
  const entrainements = { lun: [], jeu: [] };

  rowsVotes.forEach(function(r, idx) {
    if (!r[0]) return;
    const nomJoueur = String(r[0]).trim();
    const cleNom = nomJoueur.toLowerCase();
    let posteJoueur = mapPostes[cleNom] || String(r[1] || 'Demi-Centre').trim();
    if (/polyvalent|joueur/i.test(posteJoueur)) posteJoueur = 'Demi-Centre';
    const photoJoueur = mapPhotos[cleNom] || '';
    const noteJoueur = mapNotes[cleNom] || '';
    const d1B = String(r[3]).trim().toUpperCase() === 'OUI';
    let d1C = false;
    let d1D = false;
    let idxLun = 4;
    let idxJeu = 6;
    if (cfg.nbEquipes === 1) {
      idxLun = 4;
      idxJeu = 6;
    } else if (cfg.nbEquipes === 3) {
      d1C = String(r[4]).trim().toUpperCase() === 'OUI';
      d1D = String(r[5]).trim().toUpperCase() === 'OUI';
      idxLun = 6;
      idxJeu = 8;
    } else {
      d1C = String(r[4]).trim().toUpperCase() === 'OUI';
      idxLun = 5;
      idxJeu = 7;
    }

    const fichePresence = { nom: nomJoueur, poste: posteJoueur, entrainements: Number(r[2]) || 0, photo: photoJoueur, note: noteJoueur };
    if (String(r[idxLun]).trim().toUpperCase() === 'OUI') entrainements.lun.push(fichePresence);
    if (String(r[idxJeu]).trim().toUpperCase() === 'OUI') entrainements.jeu.push(fichePresence);

    if (d1B || d1C || d1D) {
      joueurs.push({ id: 'j_' + idx, nom: nomJoueur, poste: posteJoueur, entrainements: Number(r[2]) || 0, dispo1B: d1B, dispo1C: d1C, dispo1D: d1D, photo: photoJoueur, note: noteJoueur });
    }
  });

  const trierParNom = function(a, b) { return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { sensitivity: 'base' }); };
  joueurs.sort(trierParNom);
  entrainements.lun.sort(trierParNom);
  entrainements.jeu.sort(trierParNom);
  effectifComplet.sort(trierParNom);

  const rowsMatchs = shMatchs ? shMatchs.getRange('B4:K6').getValues() : [];
  const infosMatchs = {
    label1B: (rowsMatchs[0] && rowsMatchs[0][8] && rowsMatchs[0][8] !== '-') ? rowsMatchs[0][8] : ('Équipe ' + cfg.nomEquipe1),
    label1C: (rowsMatchs[1] && rowsMatchs[1][8] && rowsMatchs[1][8] !== '-') ? rowsMatchs[1][8] : ('Équipe ' + cfg.nomEquipe2),
    label1D: (rowsMatchs[2] && rowsMatchs[2][8] && rowsMatchs[2][8] !== '-') ? rowsMatchs[2][8] : ('Équipe ' + cfg.nomEquipe3)
  };

  return {
    joueurs: joueurs,
    matchs: infosMatchs,
    entrainements: entrainements,
    effectif: effectifComplet,
    clubConfig: {
      nomClub: cfg.nomClub,
      logoUrl: cfg.logoUrl,
      nbEquipes: cfg.nbEquipes,
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

function enregistrerEntrainementEtPublier(seance, groupes, nonRetenus, envoyerWhatsApp, messageWhatsApp) {
  const ss = getSpreadsheet();
  const shTrain = ss.getSheetByName('Entrainements');
  const horodatage = Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm');

  const g1 = (groupes && groupes[0] && groupes[0].joueurs) ? groupes[0].joueurs.join(', ') : '';
  const g2 = (groupes && groupes[1] && groupes[1].joueurs) ? groupes[1].joueurs.join(', ') : '';
  const nr = (nonRetenus || []).join(', ');

  if (shTrain) {
    shTrain.appendRow([horodatage, seance, g1, g2, nr]);
  }

  if (envoyerWhatsApp) {
    declencherActionGitHub('send_whatsapp_text', { text_message: messageWhatsApp });
  }

  return { ok: true, date: horodatage };
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
  const tpl = [
    '[[!DOCTYPE html]][[html]][[head]][[meta charset="utf-8"]]',
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
    'body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#f8fafc;margin:0;padding:0;user-select:none;overflow-x:hidden;}',
    'header{background:#171717;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--color-primary);position:relative;z-index:20;flex-wrap:wrap;gap:8px;}',
    '.logo{font-weight:800;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;gap:8px;}',
    '.badge-mode{font-size:0.75rem;background:#2e2e2e;padding:5px 10px;border-radius:99px;color:#d4d4d4;font-weight:600;}',
    '.board{display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:14px;padding:14px;max-width:1300px;margin:0 auto;}',
    '.board-2{grid-template-columns:1fr 1fr;}',
    '@media(max-width:800px){.board{grid-template-columns:1fr;}}',
    '.col{background:#171717;border-radius:12px;padding:12px;display:flex;flex-direction:column;min-height:320px;border:1px solid #2e2e2e;}',
    '.col-1b{border-top:4px solid var(--color-team1);}.col-pool{border-top:4px solid #737373;}.col-1c{border-top:4px solid var(--color-team2);}.col-1d{border-top:4px solid var(--color-team3);}',
    '.col-title{font-weight:700;font-size:0.95rem;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;}',
    '.team-dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:middle;box-shadow:0 0 6px rgba(0,0,0,0.4);}',
    '.team-dot-1{background:var(--color-team1);}.team-dot-2{background:var(--color-team2);}.team-dot-3{background:var(--color-team3);}',
    '.col-sub{font-size:0.75rem;color:#a3a3a3;margin-bottom:10px;}',
    '.dropzone{flex:1;min-height:240px;display:flex;flex-direction:column;gap:8px;}',
    '.pcard{background:#0a0a0a;border:1px solid #2e2e2e;border-radius:8px;padding:8px 12px;cursor:grab;display:flex;justify-content:space-between;align-items:center;transition:transform 0.15s;}',
    '.pcard:hover{border-color:#404040;}',
    '.pleft{display:flex;align-items:center;gap:10px;min-width:0;}',
    '.pmini{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));color:#fff;font-weight:800;font-size:0.95rem;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;border:1px solid rgba(255,255,255,0.2);}',
    '.pmini img{width:100%;height:100%;object-fit:cover;}',
    '.pname{font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:6px;}',
    '.pmeta{font-size:0.75rem;color:#a3a3a3;margin-top:2px;}',
    '.pnote-sub{font-size:0.72rem;color:var(--color-secondary);margin-top:2px;font-style:italic;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.ptags{display:flex;gap:4px;align-items:center;flex-shrink:0;}',
    '.tag{font-size:0.68rem;padding:3px 8px;border-radius:6px;font-weight:700;}',
    '.tag-1b{background:var(--color-team1);color:var(--color-team1-text);}.tag-1c{background:var(--color-team2);color:var(--color-team2-text);}.tag-1d{background:var(--color-team3);color:var(--color-team3-text);}.tag-tr{background:#262626;color:var(--color-secondary);}',
    '.btn-mini-edit{background:transparent;border:1px solid #404040;color:#d4d4d4;padding:3px 6px;border-radius:6px;font-size:0.72rem;cursor:pointer;}',
    '.btn-mini-edit:hover{border-color:var(--color-primary);color:#fff;}',
    'footer{position:sticky;bottom:0;background:#171717;padding:12px 18px;border-top:1px solid #2e2e2e;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;z-index:20;}',
    'button{border:none;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;font-size:0.85rem;transition:transform 0.12s,filter 0.12s,opacity 0.2s;}',
    'button:active{transform:scale(0.94);}button:disabled{opacity:0.65;cursor:wait;}',
    '.btn-tinder{background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));color:var(--color-primary-contrast);box-shadow:0 4px 14px rgba(0,0,0,0.3);font-weight:800;}',
    '.btn-enter-tinder{background:linear-gradient(135deg,#ef4444,var(--color-primary))!important;color:#ffffff!important;box-shadow:0 4px 14px rgba(239,68,68,0.35)!important;}',
    '.view-mode-tabs{display:flex;background:#262626;padding:4px;border-radius:12px;margin:8px 12px 14px 12px;gap:4px;box-shadow:inset 0 2px 4px rgba(0,0,0,0.3);}',
    '.view-mode-tab{flex:1;padding:10px 12px;border-radius:9px;border:none;background:transparent;color:#a3a3a3;font-weight:700;font-size:0.86rem;cursor:pointer;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;gap:6px;}',
    '.view-mode-tab.active{background:var(--color-primary);color:var(--color-primary-text);box-shadow:0 2px 8px rgba(0,0,0,0.4);font-weight:800;}',
    '.view-mode-tab:not(.active):hover{background:#333333;color:#f8fafc;}',
    '#tinderView{display:none;max-width:400px;margin:10px auto 30px auto;padding:12px;text-align:center;}',
    '.tdeck{position:relative;height:440px;width:100%;perspective:1000px;margin:10px 0;}',
    '.tcard{position:absolute;top:0;left:0;right:0;height:400px;background:linear-gradient(160deg,#171717 0%,#0a0a0a 100%);border:2px solid #404040;border-radius:24px;padding:20px 18px;display:flex;flex-direction:column;justify-content:space-between;align-items:center;box-shadow:0 18px 40px rgba(0,0,0,0.55);touch-action:none;will-change:transform;cursor:grab;overflow:hidden;}',
    '.tcard:active{cursor:grabbing;}',
    '.tcard-next{transform:scale(0.92) translateY(18px);opacity:0.55;pointer-events:none;z-index:1;border-color:#2e2e2e;transition:transform 0.3s ease,opacity 0.3s ease;}',
    '.tcard-top{z-index:5;}',
    '.train-tstamp{position:absolute;z-index:10;opacity:0;padding:7px 12px;border:3px solid;border-radius:8px;font-size:0.95rem;font-weight:900;text-transform:uppercase;pointer-events:none;}',
    '.train-tstamp-left{top:24px;left:14px;color:var(--color-team1);border-color:var(--color-team1);transform:rotate(-12deg);}',
    '.train-tstamp-right{top:24px;right:14px;color:var(--color-team2);border-color:var(--color-team2);transform:rotate(12deg);}',
    '.train-tstamp-down{bottom:36px;left:50%;color:#d4d4d4;border-color:#737373;transform:translateX(-50%) rotate(-4deg);}',
    '.tcard-spring{transition:transform 0.4s cubic-bezier(0.175,0.885,0.32,1.275),box-shadow 0.3s ease;}',
    '.tcard-fly{transition:transform 0.42s cubic-bezier(0.25,1,0.5,1),opacity 0.35s ease;}',
    '.tbg-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;}',
    '.tbg-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(10,10,10,0.98) 0%,rgba(10,10,10,0.8) 42%,rgba(10,10,10,0.12) 74%,rgba(10,10,10,0.3) 100%);z-index:1;pointer-events:none;}',
    '.tcontent{position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;justify-content:space-between;align-items:center;}',
    '.tavatar{width:88px;height:88px;border-radius:50%;background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));color:#111;font-size:2.4rem;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(0,0,0,0.35);border:3px solid rgba(255,255,255,0.15);margin-top:12px;}',
    '.tnote-box{background:rgba(10,10,10,0.88);border:1px solid var(--color-secondary);color:var(--color-secondary);padding:6px 11px;border-radius:10px;font-size:0.78rem;max-width:92%;line-height:1.3;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.4);max-height:48px;overflow:hidden;}',
    '.tbtn-edit-card{position:absolute;top:12px;right:12px;z-index:12;background:rgba(10,10,10,0.78);color:#f8fafc;border:1px solid #737373;border-radius:99px;padding:5px 10px;font-size:0.74rem;font-weight:700;cursor:pointer;}',
    '.tbar-bg{width:85%;height:8px;background:rgba(46,46,46,0.85);border-radius:99px;overflow:hidden;margin:4px 0;}',
    '.tbar-fill{height:100%;background:linear-gradient(90deg,var(--color-primary),var(--color-secondary));border-radius:99px;transition:width 0.4s ease;}',
    '.stamp{position:absolute;padding:6px 14px;border-radius:10px;font-weight:900;font-size:1.35rem;letter-spacing:1.5px;text-transform:uppercase;opacity:0;pointer-events:none;z-index:10;border:4px solid;}',
    '.stamp-left{top:26px;left:20px;transform:rotate(-14deg);}',
    '.stamp-right{top:26px;right:20px;transform:rotate(14deg);}',
    '.stamp-up{top:22px;left:50%;transform:translateX(-50%) rotate(0deg);}',
    '.stamp-down{bottom:30px;left:50%;transform:translateX(-50%) rotate(-4deg);}',
    '.stamp-1b{color:var(--color-team1);border-color:var(--color-team1);background:rgba(0,0,0,0.65);box-shadow:0 0 18px var(--color-team1);}',
    '.stamp-1c{color:var(--color-team2);border-color:var(--color-team2);background:rgba(0,0,0,0.65);box-shadow:0 0 18px var(--color-team2);}',
    '.stamp-1d{color:var(--color-team3);border-color:var(--color-team3);background:rgba(0,0,0,0.65);box-shadow:0 0 18px var(--color-team3);}',
    '.stamp-out{color:#f87171;border-color:#ef4444;background:rgba(185,28,28,0.4);box-shadow:0 0 18px rgba(239,68,68,0.6);}',
    '.tcontrols{display:flex;justify-content:center;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap;}',
    '.tbtn-circle{width:64px;height:64px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800;color:#fff;box-shadow:0 8px 20px rgba(0,0,0,0.4);border:2px solid rgba(255,255,255,0.12);cursor:pointer;}',
    '.tbtn-circle span{font-size:1.3rem;line-height:1.1;}',
    '.tbtn-1b{background:var(--color-team1);color:var(--color-team1-text);}.tbtn-1c{background:var(--color-team2);color:var(--color-team2-text);}.tbtn-1d{background:var(--color-team3);color:var(--color-team3-text);}.tbtn-out{width:54px;height:54px;background:linear-gradient(145deg,#404040,#2e2e2e);}',
    '.tbtn-undo{width:42px;height:42px;background:#171717;color:#d4d4d4;border:1px solid #404040;border-radius:50%;font-size:1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;}',
    '.tscore-bar{display:flex;justify-content:space-around;background:#171717;padding:8px 12px;border-radius:12px;margin-bottom:10px;border:1px solid #2e2e2e;font-size:0.82rem;font-weight:700;flex-wrap:wrap;gap:6px;}',
    '.preview-page{max-width:760px;margin:20px auto;padding:16px;background:#171717;border-radius:12px;border:1px solid #2e2e2e;}',
    '.preview-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:1px solid #2e2e2e;padding-bottom:12px;}',
    '.preview-header h1{font-size:1.25rem;margin:0;}',
    '.preview-text{width:100%;min-height:200px;box-sizing:border-box;resize:vertical;background:#0a0a0a;color:#f8fafc;border:1px solid #404040;border-radius:8px;padding:12px;font:inherit;line-height:1.5;white-space:pre-wrap;user-select:text;-webkit-user-select:text;}',
    '.preview-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px;}',
    '.preview-status{min-height:1.4em;color:#d4d4d4;font-size:0.9rem;margin-top:10px;}',
    '.home-logo img{width:100px;height:100px;object-fit:contain;}.logo-img{width:36px;height:36px;object-fit:contain;}',
    '#appView,#trainView,#rosterView,#previewView{display:none;}',
    '.tabs{display:flex;gap:8px;padding:12px 14px 0 14px;max-width:1200px;margin:0 auto;}',
    '.tab-btn{flex:1;background:#171717;color:#d4d4d4;border:1px solid #2e2e2e;padding:12px;font-size:0.95rem;font-weight:700;}',
    '.tab-active{background:var(--color-primary);color:var(--color-primary-text);border-color:var(--color-primary);}',
    '.train-info{max-width:1200px;margin:10px auto 0 auto;padding:0 16px;font-size:0.82rem;color:#a3a3a3;display:flex;gap:14px;align-items:center;flex-wrap:wrap;}',
    '.train-info input{width:60px;margin-left:6px;padding:5px 8px;border-radius:6px;border:1px solid #2e2e2e;background:#0a0a0a;color:#f8fafc;}',
    '.btn-enter + .btn-enter{margin-top:10px;}.btn-enter-alt{background:#262626;border:1px solid var(--color-primary);color:#f8fafc;}',
    '#homeView{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;}',
    '.home-card{background:#171717;border:1px solid #2e2e2e;border-top:4px solid var(--color-primary);border-radius:20px;padding:32px 28px;max-width:390px;width:100%;text-align:center;box-shadow:0 18px 40px rgba(0,0,0,0.45);}',
    '.home-logo{font-size:3.2rem;line-height:1;margin-bottom:8px;}.home-card h1{margin:0 0 4px 0;font-size:1.5rem;}.home-sub{color:#a3a3a3;font-size:0.85rem;margin:0 0 18px 0;}.home-status{font-size:0.85rem;color:#d4d4d4;margin-bottom:6px;min-height:1.2em;}',
    '.btn-enter{background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));color:#111827;font-weight:800;font-size:1rem;padding:12px 28px;width:100%;}',
    '.inp-field{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #404040;background:#0a0a0a;color:#fff;font-size:0.92rem;user-select:text;-webkit-user-select:text;}',
    '.roster-wrap{max-width:1200px;margin:14px auto 30px;padding:0 14px;}',
    '.roster-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:12px;}',
    '.rcard{background:#171717;border:1px solid #2e2e2e;border-radius:12px;padding:12px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:border-color 0.15s,transform 0.12s;}',
    '.rcard:hover{border-color:var(--color-primary);transform:translateY(-2px);}',
    '.rnote{font-size:0.75rem;color:var(--color-secondary);margin-top:4px;font-style:italic;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
    '.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:100;display:none;align-items:center;justify-content:center;padding:16px;}',
    '.modal-box{background:#171717;border:1px solid #404040;border-top:4px solid var(--color-primary);border-radius:18px;max-width:410px;width:100%;padding:20px;max-height:92vh;overflow-y:auto;box-sizing:border-box;}',
    '[[/style]]',
    '[[script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js"]][[/script]]',
    '[[script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"]][[/script]]',
    '[[/head]][[body]]',
    '[[div id="homeView"]]',
      '[[div class="home-card"]]',
        '[[div class="home-logo"]][[img id="homeLogoImg" src="' + cfg.logoUrl + '" alt="Club"]][[/div]]',
        '[[h1 id="homeClubName"]]' + cfg.nomClub + '[[/h1]]',
        '[[p class="home-sub" id="subPortail"]]Portail Joueurs & Coachs[[/p]]',
        '[[div id="loginBox" style="display:flex;flex-direction:column;gap:10px;text-align:left;"]]',
          '[[label style="font-size:0.8rem;color:#d4d4d4;"]]Votre numéro de téléphone :[[/label]]',
          '[[input id="inpTel" class="inp-field" type="tel" placeholder="Ex : 06 12 34 56 78"]]',
          '[[label style="font-size:0.8rem;color:#d4d4d4;"]]Code PIN personnel (4 à 8 chiffres) :[[/label]]',
          '[[input id="inpPin" class="inp-field" type="password" inputmode="numeric" maxlength="8" placeholder="Choisissez votre PIN à la 1re connexion"]]',
          '[[div class="home-status" id="loginError" style="color:#f87171;text-align:center;"]][[/div]]',
          '[[button class="btn-enter" id="btnLogin" onclick="seConnecter()"]]🔐 Se connecter[[/button]]',
        '[[/div]]',
        '[[div id="playerBox" style="display:none;flex-direction:column;align-items:center;gap:12px;"]]',
          '[[div id="playerPreviewCard" style="width:220px;height:260px;position:relative;border-radius:18px;overflow:hidden;border:2px solid var(--color-primary);background:#0a0a0a;display:flex;flex-direction:column;justify-content:flex-end;padding:14px;box-sizing:border-box;"]]',
            '[[img id="playerImgPreview" class="tbg-photo" style="display:none;"]]',
            '[[div class="tbg-overlay"]][[/div]]',
            '[[div id="playerInitialPreview" class="tavatar" style="position:absolute;top:35px;left:50%;transform:translateX(-50%);margin:0;"]]J[[/div]]',
            '[[div style="position:relative;z-index:2;text-align:center;"]]',
              '[[div id="playerNomPreview" style="font-weight:900;font-size:1.3rem;"]]Joueur[[/div]]',
              '[[div id="playerPostePreview" style="font-size:0.8rem;color:#d4d4d4;"]]Poste[[/div]]',
            '[[/div]]',
          '[[/div]]',
          '[[div id="posteSelectBox" style="width:100%;text-align:left;"]]',
            '[[label style="font-size:0.8rem;color:#d4d4d4;display:block;margin-bottom:4px;"]]🤾 Mon poste sur le terrain :[[/label]]',
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
          '[[button class="btn-enter" onclick="ouvrirSelecteurPhotoJoueur()"]]📷 Choisir une photo sur mon téléphone[[/button]]',
          '[[div class="home-status" id="photoStatus"]][[/div]]',
          '[[div id="coachMenuBox" style="display:none;width:100%;border-top:1px solid #2e2e2e;padding-top:12px;margin-top:4px;"]]',
            '[[div id="updateBannerBox" style="display:none;background:linear-gradient(135deg,#1e1b4b,#312e81);border:1px solid #6366f1;border-radius:12px;padding:12px;margin-bottom:12px;text-align:left;box-shadow:0 4px 12px rgba(0,0,0,0.3);"]]',
              '[[div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;"]]',
                '[[span style="font-weight:900;color:#c7d2fe;font-size:0.85rem;display:flex;align-items:center;gap:6px;"]]🚀 MISE À JOUR DISPONIBLE[[/span]]',
                '[[span id="updateBadgeVer" style="background:#4338ca;color:#fff;padding:2px 8px;border-radius:99px;font-size:0.75rem;font-weight:800;"]]v1.2.0[[/span]]',
              '[[/div]]',
              '[[div id="updateBannerTitle" style="font-size:0.8rem;color:#e0e7ff;margin-bottom:8px;"]]Nouvelles fonctionnalités pour votre club ![[/div]]',
              '[[div style="display:flex;gap:6px;"]]',
                '[[button type="button" class="btn-reset" style="padding:6px 10px;font-size:0.75rem;background:#4f46e5;color:#fff;flex:1;" onclick="ouvrirModalMiseAJour()"]]✨ Voir les nouveautés & MàJ[[/button]]',
                '[[button type="button" class="btn-reset" style="padding:6px 8px;font-size:0.75rem;background:transparent;border:1px solid #6366f1;color:#c7d2fe;" onclick="masquerBanniereUpdate()"]]Ignorer[[/button]]',
              '[[/div]]',
            '[[/div]]',
            '[[div style="font-size:0.8rem;color:var(--color-secondary);font-weight:800;margin-bottom:8px;"]]👑 ESPACE COACH DÉVERROUILLÉ[[/div]]',
            '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;"]]',
              '[[button class="btn-enter" style="margin:0;padding:11px 6px;font-size:0.84rem;" id="btnEnterClassic" onclick="entrer(false)"]]📋 Mode Tableau[[span style="display:block;font-size:0.68rem;font-weight:normal;opacity:0.85;margin-top:2px;"]]Glisser-Déposer[[/span]][[/button]]',
              '[[button class="btn-enter btn-enter-tinder" style="margin:0;padding:11px 6px;font-size:0.84rem;" id="btnEnterTinder" onclick="entrer(true)"]]🔥 Mode Tinder[[span style="display:block;font-size:0.68rem;font-weight:normal;opacity:0.85;margin-top:2px;"]]Swipe Cartes[[/span]][[/button]]',
            '[[/div]]',
            '[[button class="btn-enter btn-enter-alt" id="btnEnterTr" onclick="entrerEntrainement()"]]🏋️ Groupes d\'entraînement[[/button]]',
            '[[button class="btn-enter btn-enter-alt" onclick="entrerEffectif()"]]👥 Gérer l\'Effectif (Photos & Notes)[[/button]]',
            '[[button class="btn-enter btn-enter-alt" onclick="ouvrirModalCouleurs()"]]🎨 Couleurs & Identité du Club[[/button]]',
            '[[button type="button" class="btn-enter btn-enter-alt" id="btnCheckUpdateCoach" onclick="verifierMiseAJourManuelle()" style="font-size:0.78rem;padding:9px;color:#a3a3a3;border-color:#333;"]]🔄 Vérifier les mises à jour du Bot[[/button]]',
          '[[/div]]',
          '[[button class="btn-reset" style="width:100%;margin-top:6px;" onclick="seDeconnecter()"]]Déconnexion[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div id="appView"]]',
    '[[header]]',
      '[[div class="logo" id="headerLogo"]][[img class="logo-img" id="appHeaderLogoImg" src="' + cfg.logoUrl + '" alt="Logo"]] <span id="headerClubTitle">' + cfg.nomClub + ' - Compo Coach</span>[[/div]]',
      '[[div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"]]',
        '[[button class="btn-reset" onclick="retourAccueil()"]]Accueil[[/button]]',
        '[[button class="btn-reset" onclick="entrerEffectif()"]]👥 Effectif & Notes[[/button]]',
        '[[button class="btn-reset" onclick="ouvrirModalCouleurs()"]]🎨 Couleurs[[/button]]',
        '[[button class="btn-sync js-sync-wa" onclick="forcerActualisationWhatsApp()"]]📥 Actualiser WhatsApp[[/button]]',
        '[[button class="btn-tinder" id="btnSwitchMode" onclick="basculerMode()"]]🔥 Mode Tinder[[/button]]',
        '[[span class="badge-mode js-statut" id="statutChargement"]]Chargement...[[/span]]',
      '[[/div]]',
    '[[/header]]',
    '[[div class="view-mode-tabs"]]',
      '[[button type="button" class="view-mode-tab active" id="tabClassicMode" onclick="choisirMode(false)"]]📋 Mode Tableau (Glisser-Déposer)[[/button]]',
      '[[button type="button" class="view-mode-tab" id="tabTinderMode" onclick="choisirMode(true)"]]🔥 Mode Tinder (Swipe Cartes)[[/button]]',
    '[[/div]]',
    '[[div class="board" id="classicView"]]',
      '[[div class="col col-1b" id="colBox1B"]]',
        '[[div class="col-title"]][[span]][[span class="team-dot team-dot-1"]][[/span]]<span id="labelCol1B">' + cfg.nomEquipe1 + '</span>[[/span]][[span id="count1B"]]0/12[[/span]][[/div]]',
        '[[div class="col-sub" id="sub1B"]]Match ' + cfg.nomEquipe1 + '[[/div]]',
        '[[div class="dropzone" id="zone1B"]][[/div]]',
      '[[/div]]',
      '[[div class="col col-pool" id="colBoxPool"]]',
        '[[div class="col-title"]][[span]]📋 Joueurs Disponibles[[/span]][[span id="countPool"]]0[[/span]][[/div]]',
        '[[div class="col-sub"]]Glissez les joueurs vers vos équipes (✏️ pour noter/photo)[[/div]]',
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
    '[[/div]]',
    '[[div id="tinderView"]]',
      '[[div style="margin-bottom:6px;color:var(--color-secondary);font-weight:800;letter-spacing:0.5px;"]]🔥 MODE COACH TINDER 🔥[[/div]]',
      '[[div class="tscore-bar" id="tscoreBar"]]',
        '[[span id="tBox1B"]][[span class="team-dot team-dot-1"]][[/span]]<span id="labelTinder1B">' + cfg.nomEquipe1 + '</span> : [[b id="tCount1B"]]0[[/b]]/12[[/span]]',
        '[[span id="tBoxPool" style="color:#d4d4d4;"]]Restants : [[b id="tCountPool"]]0[[/b]][[/span]]',
        '[[span id="tBox1C"]][[span class="team-dot team-dot-2"]][[/span]]<span id="labelTinder1C">' + cfg.nomEquipe2 + '</span> : [[b id="tCount1C"]]0[[/b]]/12[[/span]]',
        '[[span id="tBox1D" style="display:none;"]][[span class="team-dot team-dot-3"]][[/span]]<span id="labelTinder1D">' + (cfg.nomEquipe3 || 'Équipe 3') + '</span> : [[b id="tCount1D"]]0[[/b]]/12[[/span]]',
      '[[/div]]',
      '[[div class="tdeck" id="tinderContainer"]][[/div]]',
      '[[div class="tcontrols" id="tControlsContainer"]][[/div]]',
      '[[div style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap;"]]',
        '[[button type="button" class="btn-reset" style="font-size:0.8rem;padding:7px 12px;" onclick="choisirMode(false)"]]📋 Revenir au Tableau[[/button]]',
        '[[button type="button" class="btn-save" style="font-size:0.8rem;padding:7px 12px;" onclick="sauvegarder(false)"]]💾 Sauvegarder la Compo[[/button]]',
        '[[button type="button" class="btn-wa" style="font-size:0.8rem;padding:7px 12px;" onclick="ouvrirApercuMatch()"]]👁 Aperçu WhatsApp[[/button]]',
      '[[/div]]',
      '[[div style="font-size:0.72rem;color:#737373;margin-top:10px;"]]Astuce : Cliquez sur ✏️ en haut de la carte pour modifier la note ou la photo du joueur[[/div]]',
    '[[/div]]',
    '[[footer]]',
      '[[button class="btn-reset" onclick="recommencerSelection()"]]🔄 Recommencer[[/button]]',
      '[[button class="btn-save" onclick="sauvegarder(false)"]]💾 Sauvegarder[[/button]]',
      '[[button class="btn-wa" onclick="ouvrirApercuMatch()"]]👁 Preview du message[[/button]]',
    '[[/footer]]',
    '[[/div]]',
    '[[div id="trainView"]]',
    '[[header]]',
      '[[div class="logo"]][[img class="logo-img" id="trainHeaderLogoImg" src="' + cfg.logoUrl + '" alt="Logo"]] Entraînements[[/div]]',
      '[[div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"]]',
        '[[button class="btn-reset" onclick="retourAccueil()"]]Accueil[[/button]]',
        '[[button class="btn-reset" onclick="entrerEffectif()"]]👥 Effectif & Notes[[/button]]',
        '[[button class="btn-sync js-sync-wa" onclick="forcerActualisationWhatsApp()"]]📥 Actualiser WhatsApp[[/button]]',
        '[[span class="badge-mode js-statut" id="statutTrain"]][[/span]]',
      '[[/div]]',
    '[[/header]]',
    '[[div class="tabs"]]',
      '[[button class="tab-btn tab-active" id="tabLun" onclick="changerSeance(\'lun\')"]]Lundi[[/button]]',
      '[[button class="tab-btn" id="tabJeu" onclick="changerSeance(\'jeu\')"]]Jeudi[[/button]]',
    '[[/div]]',
    '[[div class="train-info"]]',
      '[[span id="trainExplication"]]Répartissez les joueurs disponibles[[/span]]',
      '[[label id="lblMaxJoueurs" style="display:none;"]]Max retenus : [[input type="number" id="inpMaxJoueurs" value="20" min="5" max="35" onchange="majMaxRetenus(this.value)"]][[/label]]',
    '[[/div]]',
    '[[div class="board" id="trainBoardClassic"]]',
      '[[div class="col col-pool"]]',
        '[[div class="col-title"]][[span]]📋 Dispos à répartir[[/span]][[span id="trCountPool"]]0[[/span]][[/div]]',
        '[[div class="dropzone" id="trZonePool"]][[/div]]',
      '[[/div]]',
      '[[div id="trDynamicZones" style="display:contents;"]][[/div]]',
    '[[/div]]',
    '[[footer]]',
      '[[button class="btn-reset" onclick="reinitialiserSeance()"]]🔄 Recommencer[[/button]]',
      '[[button class="btn-save" onclick="sauvegarderEntrainement(false)"]]💾 Sauvegarder[[/button]]',
      '[[button class="btn-wa" onclick="ouvrirApercuEntrainement()"]]👁 Preview WhatsApp[[/button]]',
    '[[/footer]]',
    '[[/div]]',
    '[[div id="rosterView"]]',
    '[[header]]',
      '[[div class="logo"]][[img class="logo-img" id="rosterHeaderLogoImg" src="' + cfg.logoUrl + '" alt="Logo"]] Effectif - Photos & Notes Coach[[/div]]',
      '[[div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"]]',
        '[[button class="btn-reset" onclick="retourAccueil()"]]Accueil[[/button]]',
        '[[button class="btn-reset" onclick="entrer()"]]🤾 Retour Compo[[/button]]',
        '[[span class="badge-mode" id="rosterCount"]]0 joueurs[[/span]]',
      '[[/div]]',
    '[[/header]]',
    '[[main class="roster-wrap"]]',
      '[[div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;"]]',
        '[[input id="inpSearchRoster" class="inp-field" style="max-width:320px;" type="text" placeholder="🔍 Rechercher un joueur..." oninput="filtrerRoster(this.value)"]]',
        '[[div style="font-size:0.8rem;color:#a3a3a3;"]]Cliquez sur une fiche pour modifier la photo, le poste ou la note coach[[/div]]',
      '[[/div]]',
      '[[div class="roster-grid" id="rosterGrid"]][[/div]]',
    '[[/main]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalJoueurBg" onclick="fermerModalSurBg(event)"]]',
      '[[div class="modal-box"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;"]]',
          '[[h2 id="modalJoueurNom" style="margin:0;font-size:1.2rem;"]]Fiche Joueur[[/h2]]',
          '[[button class="btn-reset" style="padding:4px 10px;" onclick="fermerModalJoueur()"]]✕[[/button]]',
        '[[/div]]',
        '[[div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:14px;"]]',
          '[[div style="width:110px;height:110px;border-radius:50%;overflow:hidden;border:3px solid var(--color-primary);position:relative;background:#0a0a0a;display:flex;align-items:center;justify-content:center;"]]',
            '[[img id="modalJoueurImg" style="width:100%;height:100%;object-fit:cover;display:none;"]]',
            '[[div id="modalJoueurInitiale" style="font-size:2.4rem;font-weight:900;color:var(--color-primary);"]]J[[/div]]',
          '[[/div]]',
          '[[input type="file" id="fileCoachPhoto" accept="image/*" style="display:none;" onchange="chargerPhotoDepuisModal(event)"]]',
          '[[button class="btn-enter" style="font-size:0.8rem;padding:7px 14px;width:auto;" onclick="ouvrirSelecteurPhotoCoach()"]]📷 Modifier la photo[[/button]]',
        '[[/div]]',
        '[[div style="display:flex;flex-direction:column;gap:10px;text-align:left;"]]',
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
          '[[div id="modalJoueurStatus" style="font-size:0.8rem;color:var(--color-secondary);min-height:1.2em;text-align:center;"]][[/div]]',
          '[[div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;"]]',
            '[[button class="btn-reset" onclick="fermerModalJoueur()"]]Annuler[[/button]]',
            '[[button class="btn-save" onclick="sauvegarderFicheDepuisModal()"]]Enregistrer[[/button]]',
          '[[/div]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalCouleursBg" onclick="fermerModalCouleursSurBg(event)"]]',
      '[[div class="modal-box" style="max-width:440px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[h2 style="margin:0;font-size:1.2rem;display:flex;align-items:center;gap:8px;"]]🎨 Couleurs du Club[[/h2]]',
          '[[button class="btn-reset" style="padding:4px 10px;" onclick="fermerModalCouleurs()"]]✕[[/button]]',
        '[[/div]]',
        '[[p style="font-size:0.8rem;color:#a3a3a3;margin:0 0 14px 0;text-align:left;"]]Personnalisez l\'identité visuelle de votre club. Ces couleurs s\'appliquent immédiatement à la WebApp et sont sauvegardées dans votre Google Sheet.[[/p]]',
        '[[div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;"]]',
          '[[div style="display:flex;align-items:center;justify-content:space-between;background:#0a0a0a;padding:8px 12px;border-radius:10px;border:1px solid #2e2e2e;"]]',
            '[[div style="text-align:left;"]][[div style="font-size:0.85rem;font-weight:700;"]]Couleur Principale[[/div]][[div style="font-size:0.72rem;color:#a3a3a3;"]]Boutons, en-têtes, navigation[[/div]][[/div]]',
            '[[div style="display:flex;align-items:center;gap:8px;"]][[input type="color" id="inpColPrimaire" style="width:38px;height:34px;border:none;border-radius:6px;cursor:pointer;background:transparent;" onchange="majCouleursLive()"]][[input type="text" id="txtColPrimaire" class="inp-field" style="width:78px;padding:5px;text-align:center;font-size:0.8rem;text-transform:uppercase;" maxlength="7" oninput="synchroColorInput(\'Primaire\')"]][[/div]]',
          '[[/div]]',
          '[[div style="display:flex;align-items:center;justify-content:space-between;background:#0a0a0a;padding:8px 12px;border-radius:10px;border:1px solid #2e2e2e;"]]',
            '[[div style="text-align:left;"]][[div style="font-size:0.85rem;font-weight:700;"]]Couleur Secondaire[[/div]][[div style="font-size:0.72rem;color:#a3a3a3;"]]Dégradés, badges, notes coach[[/div]][[/div]]',
            '[[div style="display:flex;align-items:center;gap:8px;"]][[input type="color" id="inpColSecondaire" style="width:38px;height:34px;border:none;border-radius:6px;cursor:pointer;background:transparent;" onchange="majCouleursLive()"]][[input type="text" id="txtColSecondaire" class="inp-field" style="width:78px;padding:5px;text-align:center;font-size:0.8rem;text-transform:uppercase;" maxlength="7" oninput="synchroColorInput(\'Secondaire\')"]][[/div]]',
          '[[/div]]',
          '[[div style="display:flex;align-items:center;justify-content:space-between;background:#0a0a0a;padding:8px 12px;border-radius:10px;border:1px solid #2e2e2e;"]]',
            '[[div style="text-align:left;"]][[div style="font-size:0.85rem;font-weight:700;"]]Couleur Équipe 1[[/div]][[div style="font-size:0.72rem;color:#a3a3a3;"]]Colonne & badges Équipe 1[[/div]][[/div]]',
            '[[div style="display:flex;align-items:center;gap:8px;"]][[input type="color" id="inpColEq1" style="width:38px;height:34px;border:none;border-radius:6px;cursor:pointer;background:transparent;" onchange="majCouleursLive()"]][[input type="text" id="txtColEq1" class="inp-field" style="width:78px;padding:5px;text-align:center;font-size:0.8rem;text-transform:uppercase;" maxlength="7" oninput="synchroColorInput(\'Eq1\')"]][[/div]]',
          '[[/div]]',
          '[[div style="display:flex;align-items:center;justify-content:space-between;background:#0a0a0a;padding:8px 12px;border-radius:10px;border:1px solid #2e2e2e;"]]',
            '[[div style="text-align:left;"]][[div style="font-size:0.85rem;font-weight:700;"]]Couleur Équipe 2[[/div]][[div style="font-size:0.72rem;color:#a3a3a3;"]]Colonne & badges Équipe 2[[/div]][[/div]]',
            '[[div style="display:flex;align-items:center;gap:8px;"]][[input type="color" id="inpColEq2" style="width:38px;height:34px;border:none;border-radius:6px;cursor:pointer;background:transparent;" onchange="majCouleursLive()"]][[input type="text" id="txtColEq2" class="inp-field" style="width:78px;padding:5px;text-align:center;font-size:0.8rem;text-transform:uppercase;" maxlength="7" oninput="synchroColorInput(\'Eq2\')"]][[/div]]',
          '[[/div]]',
          '[[div style="display:flex;align-items:center;justify-content:space-between;background:#0a0a0a;padding:8px 12px;border-radius:10px;border:1px solid #2e2e2e;"]]',
            '[[div style="text-align:left;"]][[div style="font-size:0.85rem;font-weight:700;"]]Couleur Équipe 3[[/div]][[div style="font-size:0.72rem;color:#a3a3a3;"]]Colonne & badges Équipe 3[[/div]][[/div]]',
            '[[div style="display:flex;align-items:center;gap:8px;"]][[input type="color" id="inpColEq3" style="width:38px;height:34px;border:none;border-radius:6px;cursor:pointer;background:transparent;" onchange="majCouleursLive()"]][[input type="text" id="txtColEq3" class="inp-field" style="width:78px;padding:5px;text-align:center;font-size:0.8rem;text-transform:uppercase;" maxlength="7" oninput="synchroColorInput(\'Eq3\')"]][[/div]]',
          '[[/div]]',
        '[[/div]]',
        '[[div style="text-align:left;margin-bottom:12px;"]]',
          '[[div style="font-size:0.78rem;font-weight:700;color:#d4d4d4;margin-bottom:6px;"]]Palettes rapides (Clubs de Handball) :[[/div]]',
          '[[div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#f97316\',\'#fbbf24\',\'#3b82f6\',\'#f97316\',\'#10b981\')"]]🟠 Orange & Ambre[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#6b21a8\',\'#eab308\',\'#6b21a8\',\'#eab308\',\'#3b82f6\')"]]🟣 Violet & Or (Nantes)[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#1d4ed8\',\'#dc2626\',\'#1d4ed8\',\'#dc2626\',\'#10b981\')"]]🔵 Bleu & Rouge (PSG)[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#0284c7\',\'#0f172a\',\'#0284c7\',\'#1e293b\',\'#06b6d4\')"]]🌊 Ciel & Nuit (MHB)[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#16a34a\',\'#f8fafc\',\'#16a34a\',\'#22c55e\',\'#15803d\')"]]🟢 Vert & Blanc (USAM)[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#dc2626\',\'#18181b\',\'#dc2626\',\'#450a0a\',\'#f59e0b\')"]]🔴 Rouge & Noir[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#eab308\',\'#18181b\',\'#eab308\',\'#713f12\',\'#0284c7\')"]]🟡 Jaune & Noir (Chambéry)[[/button]]',
            '[[button type="button" class="btn-reset" style="font-size:0.72rem;padding:6px;text-align:left;" onclick="appliquerPresetCouleurs(\'#1e3a8a\',\'#f59e0b\',\'#2563eb\',\'#f59e0b\',\'#10b981\')"]]🤾 Bleu Nuit & Or[[/button]]',
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
          '[[button class="btn-save" id="btnSaveCouleurs" onclick="sauvegarderCouleursDepuisModal()"]]💾 Enregistrer les couleurs[[/button]]',
        '[[/div]]',
      '[[/div]]',
    '[[/div]]',
    '[[div class="modal-bg" id="modalMiseAJourBg" onclick="fermerModalMiseAJourSurBg(event)"]]',
      '[[div class="modal-box" style="border-top:4px solid #6366f1;max-width:440px;"]]',
        '[[div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"]]',
          '[[div style="font-weight:900;font-size:1.15rem;color:#c7d2fe;display:flex;align-items:center;gap:6px;"]]🚀 Mise à jour disponible[[/div]]',
          '[[button type="button" class="btn-reset" style="padding:4px 8px;font-size:0.8rem;" onclick="fermerModalMiseAJour()"]]✕[[/button]]',
        '[[/div]]',
        '[[div id="modalUpdateContent" style="font-size:0.85rem;color:#d4d4d4;line-height:1.45;"]]',
          '[[div style="background:#1e1e24;border:1px solid #312e81;padding:10px 12px;border-radius:10px;margin-bottom:12px;"]]',
            '[[div style="font-weight:800;color:#e0e7ff;margin-bottom:4px;" id="modalUpdateTitle"]]Version v1.2.0[[/div]]',
            '[[div style="font-size:0.75rem;color:#a5b4fc;" id="modalUpdateMeta"]]Publiée récemment[[/div]]',
            '[[ul id="modalUpdateChangelog" style="margin:8px 0 0 16px;padding:0;color:#cbd5e1;font-size:0.8rem;line-height:1.4;"]][[/ul]]',
          '[[/div]]',
          '[[div style="font-weight:800;color:var(--color-secondary);margin-bottom:6px;"]]Comment mettre à jour en 1 minute ?[[/div]]',
          '[[div style="margin-bottom:10px;font-size:0.8rem;background:#171717;border-left:3px solid #6366f1;padding:8px 10px;border-radius:0 8px 8px 0;"]]',
            '[[b style="color:#fff;"]]1. Google Sheet (code.gs) :[[/b]]<br>Vos effectifs et couleurs sont conservés intacts. Il suffit de copier le code mis à jour et de le coller dans <i>Extensions > Apps Script</i>.<br>',
            '[[button type="button" id="btnCopierCodeGs" class="btn-enter" style="margin-top:6px;font-size:0.78rem;padding:7px;background:#4f46e5;color:#fff;" onclick="copierLienCodeGs()"]]📋 Copier le lien du code.gs mis à jour[[/button]]',
          '[[/div]]',
          '[[div style="margin-bottom:12px;font-size:0.8rem;background:#171717;border-left:3px solid var(--color-primary);padding:8px 10px;border-radius:0 8px 8px 0;"]]',
            '[[b style="color:#fff;"]]2. Robot WhatsApp (GitHub) :[[/b]]<br>Allez dans votre dépôt privé sur GitHub :<br><i>Actions > Sync with Handball Bot Template > Run workflow</i>.<br>',
            '[[button type="button" class="btn-enter btn-enter-alt" style="margin-top:6px;font-size:0.78rem;padding:7px;" onclick="ouvrirRepoGithub()"]]🐙 Ouvrir mon dépôt GitHub Actions[[/button]]',
          '[[/div]]',
        '[[/div]]',
        '[[button type="button" class="btn-reset" style="width:100%;margin-top:8px;" onclick="fermerModalMiseAJour()"]]Fermer[[/button]]',
      '[[/div]]',
    '[[/div]]',
    '[[div id="previewView" style="display:none;"]]',
      '[[main class="preview-page"]]',
        '[[div class="preview-header"]][[button class="btn-reset" onclick="retourApercu()"]]← Retour[[/button]][[h1 id="previewTitle"]]Preview du message[[/h1]][[/div]]',
        '[[div id="previewMessages"]][[/div]]',
        '[[div class="preview-status" id="previewStatus"]][[/div]]',
        '[[div class="preview-actions"]][[button class="btn-reset" onclick="retourApercu()"]]Retour[[/button]][[button class="btn-wa" id="btnPublishPreview" onclick="publierApercu()"]]📤 Publier sur WhatsApp[[/button]][[/div]]',
      '[[/main]]',
    '[[/div]]',
    '[[script]]',
    'var CLUB_CONFIG = { nomClub: "' + cfg.nomClub + '", nbEquipes: ' + (cfg.nbEquipes || 2) + ', nomEquipe1: "' + cfg.nomEquipe1 + '", nomEquipe2: "' + cfg.nomEquipe2 + '", nomEquipe3: "' + (cfg.nomEquipe3 || 'Équipe 3') + '", couleurPrimaire: "' + cfg.couleurPrimaire + '", couleurSecondaire: "' + cfg.couleurSecondaire + '", couleurEquipe1: "' + cfg.couleurEquipe1 + '", couleurEquipe2: "' + cfg.couleurEquipe2 + '", couleurEquipe3: "' + (cfg.couleurEquipe3 || '#10b981') + '" };',
    'var ENTRAINEMENTS = { lun: [], jeu: [] }; var SEANCE_COURANTE = "lun"; var TRAIN_STATE = { lun: {}, jeu: {} };',
    'var TRAIN_TINDER_ACTIVE = false; var TRAIN_TINDER_QUEUE = { lun: [], jeu: [] }; var TRAIN_TINDER_INDEX = { lun: 0, jeu: 0 }; var TRAIN_TINDER_HISTORY = { lun: [], jeu: [] };',
    'var SEANCES = {',
      'lun: { label: "Lundi", zones: [{ id: "A", label: "Groupe 1", css: "col-1b" }, { id: "B", label: "Groupe 2", css: "col-1c" }], info: "Répartissez les joueurs disponibles en 2 groupes d\'entraînement." },',
      'jeu: { label: "Jeudi", zones: [{ id: "R", label: "Effectif retenu", css: "col-1c" }], info: "Séance à effectif réduit : choisissez les joueurs retenus.", max: 20 }',
    '};',
    'var JOUEURS = []; var EFFECTIF_COMPLET = []; var MODE_TINDER = false; var HISTORIQUE_SWIPE = []; var ANIM_EN_COURS = false; var CONTEXTE_APERCU = null; var VUE_PRECEDENTE_APERCU = "appView";',
    'var SESSION_TEL = ""; var SESSION_PIN = ""; var SESSION_NOM = ""; var EST_COACH = false;',
    'var JOUEUR_MODAL_COURANT = null; var POSTE_MODAL_COURANT = ""; var PHOTO_MODAL_DATA = undefined;',
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
      'document.getElementById("statusModalCouleurs").textContent = "Enregistrement dans Google Sheet...";',
      'document.getElementById("btnSaveCouleurs").disabled = true;',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("btnSaveCouleurs").disabled = false;',
        'document.getElementById("statusModalCouleurs").textContent = "Couleurs enregistrées avec succès !";',
        'CLUB_CONFIG.couleurPrimaire = cp;',
        'CLUB_CONFIG.couleurSecondaire = cs;',
        'CLUB_CONFIG.couleurEquipe1 = c1;',
        'CLUB_CONFIG.couleurEquipe2 = c2;',
        'CLUB_CONFIG.couleurEquipe3 = c3;',
        'if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });',
        'setTimeout(function(){ fermerModalCouleurs(); }, 900);',
      '}).withFailureHandler(function(err){',
        'document.getElementById("btnSaveCouleurs").disabled = false;',
        'document.getElementById("statusModalCouleurs").textContent = err.message;',
      '}).enregistrerCouleursClub(SESSION_TEL, SESSION_PIN, { primaire: cp, secondaire: cs, equipe1: c1, equipe2: c2, equipe3: c3 });',
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
    '}',
    'function rendreControlesTinder(nbEq){',
      'var c = document.getElementById("tControlsContainer");',
      'if(!c) return;',
      'var eq1 = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe1) || "Équipe 1";',
      'var eq2 = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe2) || "Équipe 2";',
      'var eq3 = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe3) || "Équipe 3";',
      'var html = \'<button type="button" class="tbtn-undo" title="Annuler le dernier choix" onclick="annulerDernierSwipe()">↩️</button>\';',
      'if(nbEq === 1){',
        'html += \'<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBouton(\\\'OUT\\\')"><span>👈</span>Repos</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1b" data-choix="1B" onclick="animerVoteBouton(\\\'1B\\\')"><span>👉</span>\' + eq1 + \'</button>\';',
      '} else if(nbEq === 2){',
        'html += \'<button type="button" class="tbtn-circle tbtn-1b" data-choix="1B" onclick="animerVoteBouton(\\\'1B\\\')"><span>👈</span>\' + eq1 + \'</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBouton(\\\'OUT\\\')"><span>👇</span>Repos</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1c" data-choix="1C" onclick="animerVoteBouton(\\\'1C\\\')"><span>👉</span>\' + eq2 + \'</button>\';',
      '} else {',
        'html += \'<button type="button" class="tbtn-circle tbtn-1b" data-choix="1B" onclick="animerVoteBouton(\\\'1B\\\')"><span>👆</span>\' + eq1 + \'</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1c" data-choix="1C" onclick="animerVoteBouton(\\\'1C\\\')"><span>👈</span>\' + eq2 + \'</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBouton(\\\'OUT\\\')"><span>👇</span>Repos</button>\';',
        'html += \'<button type="button" class="tbtn-circle tbtn-1d" data-choix="1D" onclick="animerVoteBouton(\\\'1D\\\')"><span>👉</span>\' + eq3 + \'</button>\';',
      '}',
      'html += \'<button type="button" class="tbtn-undo" title="Recommencer à zéro" onclick="recommencerSelection()">🔄</button>\';',
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
      '}',
      'JOUEURS = data.joueurs || []; EFFECTIF_COMPLET = data.effectif || []; ENTRAINEMENTS = data.entrainements || { lun: [], jeu: [] };',
      'if(data.matchs){',
        'if(document.getElementById("sub1B")) document.getElementById("sub1B").textContent = data.matchs.label1B || "";',
        'if(document.getElementById("sub1C")) document.getElementById("sub1C").textContent = data.matchs.label1C || "";',
        'if(document.getElementById("sub1D")) document.getElementById("sub1D").textContent = data.matchs.label1D || "";',
      '}',
      'var deja1B = conserverSelection ? extraireListeNoms("zone1B") : [];',
      'var deja1C = (conserverSelection && document.getElementById("zone1C")) ? extraireListeNoms("zone1C") : [];',
      'var deja1D = (conserverSelection && document.getElementById("zone1D")) ? extraireListeNoms("zone1D") : [];',
      'var z1B = document.getElementById("zone1B"), z1C = document.getElementById("zone1C"), z1D = document.getElementById("zone1D");',
      'var pool = document.getElementById("zonePool");',
      'z1B.innerHTML = ""; if(z1C) z1C.innerHTML = ""; if(z1D) z1D.innerHTML = ""; pool.innerHTML = "";',
      'JOUEURS.forEach(function(j){',
        'var c = creerCarte(j);',
        'if(deja1B.indexOf(j.nom) !== -1) z1B.appendChild(c);',
        'else if(deja1C.indexOf(j.nom) !== -1 && z1C) z1C.appendChild(c);',
        'else if(deja1D.indexOf(j.nom) !== -1 && z1D) z1D.appendChild(c);',
        'else pool.appendChild(c);',
      '});',
      'majCompteurs();',
      'document.getElementById("statutChargement").textContent = JOUEURS.length + " dispo(s)";',
      'if(document.getElementById("btnSwitchMode").style.display !== "inline-block") document.getElementById("btnSwitchMode").style.display = "inline-block";',
      'rendreRosterGrid(); majVueEntrainement();',
    '}',
    'function creerCarte(j){',
      'var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;',
      'var card = document.createElement("div"); card.className = "pcard"; card.setAttribute("data-nom", j.nom);',
      'var pleft = document.createElement("div"); pleft.className = "pleft";',
      'var pmini = document.createElement("div"); pmini.className = "pmini";',
      'if(j.photo){ var img = document.createElement("img"); img.src = j.photo; pmini.appendChild(img); }',
      'else { pmini.textContent = j.nom.charAt(0).toUpperCase(); }',
      'pleft.appendChild(pmini);',
      'var pinfo = document.createElement("div");',
      'var pname = document.createElement("div"); pname.className = "pname"; pname.textContent = j.nom;',
      'pinfo.appendChild(pname);',
      'var pmeta = document.createElement("div"); pmeta.className = "pmeta"; pmeta.textContent = (j.poste || "Demi-Centre") + " • " + (j.entrainements || 0) + " tr";',
      'pinfo.appendChild(pmeta);',
      'if(j.note){ var pnote = document.createElement("div"); pnote.className = "pnote-sub"; pnote.textContent = "💬 " + j.note; pinfo.appendChild(pnote); }',
      'pleft.appendChild(pinfo); card.appendChild(pleft);',
      'var ptags = document.createElement("div"); ptags.className = "ptags";',
      'if(j.dispo1B){ var t1 = document.createElement("span"); t1.className = "tag tag-1b"; t1.textContent = CLUB_CONFIG.nomEquipe1 || "Éq 1"; ptags.appendChild(t1); }',
      'if(j.dispo1C && nbEq >= 2){ var t2 = document.createElement("span"); t2.className = "tag tag-1c"; t2.textContent = CLUB_CONFIG.nomEquipe2 || "Éq 2"; ptags.appendChild(t2); }',
      'if(j.dispo1D && nbEq >= 3){ var t3 = document.createElement("span"); t3.className = "tag tag-1d"; t3.textContent = CLUB_CONFIG.nomEquipe3 || "Éq 3"; ptags.appendChild(t3); }',
      'var bEdit = document.createElement("button"); bEdit.className = "btn-mini-edit"; bEdit.textContent = "✏️"; bEdit.title = "Modifier la photo ou note";',
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
      'var classic = document.getElementById("classicView");',
      'var tinder = document.getElementById("tinderView");',
      'if(classic) classic.style.display = MODE_TINDER ? "none" : "grid";',
      'if(tinder) tinder.style.display = MODE_TINDER ? "block" : "none";',
      'var tabC = document.getElementById("tabClassicMode");',
      'var tabT = document.getElementById("tabTinderMode");',
      'if(tabC) tabC.className = "view-mode-tab" + (MODE_TINDER ? "" : " active");',
      'if(tabT) tabT.className = "view-mode-tab" + (MODE_TINDER ? " active" : "");',
      'var btnSwitch = document.getElementById("btnSwitchMode");',
      'if(btnSwitch) btnSwitch.textContent = MODE_TINDER ? "📋 Mode Tableau" : "🔥 Mode Tinder";',
      'if(MODE_TINDER) afficherCarteTinder();',
    '}',
    'function basculerMode(){ choisirMode(!MODE_TINDER); }',
    'function afficherCarteTinder(){',
      'var cont = document.getElementById("tinderContainer"); cont.innerHTML = "";',
      'var pool = document.getElementById("zonePool");',
      'if(!pool || pool.children.length === 0){',
        'cont.innerHTML = "<div style=\'padding:60px 20px;color:#a3a3a3;font-size:1.1rem;\'>🎉 Tous les joueurs ont été répartis !<br><br><small>Basculez en mode classique pour affiner ou sauvegarder.</small></div>";',
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
      'if(j.photo){ var bg = document.createElement("img"); bg.className = "tbg-photo"; bg.src = j.photo; card.appendChild(bg); }',
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
      'var bEd = document.createElement("button"); bEd.className = "tbtn-edit-card"; bEd.textContent = "✏️ Modifier";',
      'bEd.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); }; card.appendChild(bEd);',
      'var tc = document.createElement("div"); tc.className = "tcontent";',
      'if(!j.photo){ var av = document.createElement("div"); av.className = "tavatar"; av.textContent = j.nom.charAt(0).toUpperCase(); tc.appendChild(av); }',
      'else { var sp = document.createElement("div"); sp.style.height = "20px"; tc.appendChild(sp); }',
      'var bot = document.createElement("div"); bot.style.width = "100%"; bot.style.display = "flex"; bot.style.flexDirection = "column"; bot.style.alignItems = "center"; bot.style.gap = "6px";',
      'var nomEl = document.createElement("div"); nomEl.style.fontSize = "1.5rem"; nomEl.style.fontWeight = "900"; nomEl.textContent = j.nom; bot.appendChild(nomEl);',
      'var postEl = document.createElement("div"); postEl.style.fontSize = "0.95rem"; postEl.style.color = "var(--color-secondary)"; postEl.style.fontWeight = "700"; postEl.textContent = j.poste || "Demi-Centre"; bot.appendChild(postEl);',
      'var tags = document.createElement("div"); tags.style.display = "flex"; tags.style.gap = "6px"; tags.style.margin = "4px 0";',
      'var sp1 = document.createElement("span"); sp1.className = j.dispo1B ? "tag tag-1b" : "tag"; sp1.textContent = (CLUB_CONFIG.nomEquipe1 || "Éq 1") + " " + (j.dispo1B ? "✓" : "✗"); tags.appendChild(sp1);',
      'if(nbEq >= 2){ var sp2 = document.createElement("span"); sp2.className = j.dispo1C ? "tag tag-1c" : "tag"; sp2.textContent = (CLUB_CONFIG.nomEquipe2 || "Éq 2") + " " + (j.dispo1C ? "✓" : "✗"); tags.appendChild(sp2); }',
      'if(nbEq >= 3){ var sp3 = document.createElement("span"); sp3.className = j.dispo1D ? "tag tag-1d" : "tag"; sp3.textContent = (CLUB_CONFIG.nomEquipe3 || "Éq 3") + " " + (j.dispo1D ? "✓" : "✗"); tags.appendChild(sp3); }',
      'bot.appendChild(tags);',
      'if(j.note){ var nt = document.createElement("div"); nt.className = "tnote-box"; nt.textContent = "💬 " + j.note; bot.appendChild(nt); }',
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
          'else pool.removeChild(el);',
        '}',
        'ANIM_EN_COURS = false; afficherCarteTinder();',
      '}, 240);',
    '}',
    'function annulerDernierSwipe(){',
      'if(!HISTORIQUE_SWIPE.length) return;',
      'var dernier = HISTORIQUE_SWIPE.pop();',
      'var pool = document.getElementById("zonePool");',
      'pool.insertBefore(dernier.element, pool.firstChild); majCompteurs(); afficherCarteTinder();',
    '}',
    'function recommencerSelection(){',
      'document.getElementById("zone1B").innerHTML = "";',
      'if(document.getElementById("zone1C")) document.getElementById("zone1C").innerHTML = "";',
      'if(document.getElementById("zone1D")) document.getElementById("zone1D").innerHTML = "";',
      'var pool = document.getElementById("zonePool"); pool.innerHTML = "";',
      'JOUEURS.forEach(function(j){ pool.appendChild(creerCarte(j)); });',
      'HISTORIQUE_SWIPE = []; majCompteurs(); if(MODE_TINDER) afficherCarteTinder();',
    '}',
    'function extraireListeNoms(zoneId){ var el = document.getElementById(zoneId); return el ? Array.from(el.children).map(function(c){ return c.getAttribute("data-nom"); }) : []; }',
    'function creerMessageMatch(compo){',
      'var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;',
      'var lignes = ["***LISTE POUR CE WEEK-END***", ""];',
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
      'return lignes.join("\\n");',
    '}',
    'function sauvegarder(envoyerWhatsApp){',
      'var compo = {',
        'equipe1B: extraireListeNoms("zone1B"),',
        'equipe1C: document.getElementById("zone1C") ? extraireListeNoms("zone1C") : [],',
        'equipe1D: document.getElementById("zone1D") ? extraireListeNoms("zone1D") : [],',
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
        'nonRetenus: extraireListeNoms("zonePool")',
      '};',
      'CONTEXTE_APERCU = { type: "match", compo: compo };',
      'document.getElementById("previewTitle").textContent = "Preview - Convocations Matchs";',
      'var div = document.getElementById("previewMessages"); div.innerHTML = "";',
      'var txt = document.createElement("textarea"); txt.className = "preview-text"; txt.id = "txtPreviewMatch"; txt.value = creerMessageMatch(compo); div.appendChild(txt);',
      'basculerVue("previewView");',
    '}',
    'function publierApercu(){',
      'if(!CONTEXTE_APERCU) return;',
      'document.getElementById("btnPublishPreview").disabled = true;',
      'document.getElementById("previewStatus").textContent = "Publication en cours sur WhatsApp...";',
      'if(CONTEXTE_APERCU.type === "match"){',
        'var txt = document.getElementById("txtPreviewMatch").value;',
        'google.script.run.withSuccessHandler(function(res){',
          'document.getElementById("previewStatus").textContent = "Publié avec succès (" + res.date + ") !";',
          'if(typeof confetti === "function") confetti({ particleCount: 90, spread: 70 });',
          'setTimeout(function(){ retourApercu(); }, 1800);',
        '}).enregistrerCompoEtPublier(CONTEXTE_APERCU.compo, true, txt);',
      '} else {',
        'var txtTr = document.getElementById("txtPreviewTrain").value;',
        'google.script.run.withSuccessHandler(function(res){',
          'document.getElementById("previewStatus").textContent = "Entraînement publié avec succès !";',
          'if(typeof confetti === "function") confetti({ particleCount: 90, spread: 70 });',
          'setTimeout(function(){ retourApercu(); }, 1800);',
        '}).enregistrerEntrainementEtPublier(CONTEXTE_APERCU.donnees.seance, CONTEXTE_APERCU.donnees.groupes, CONTEXTE_APERCU.donnees.nonRetenus, true, txtTr);',
      '}',
    '}',
    'function retourApercu(){ basculerVue(VUE_PRECEDENTE_APERCU); }',
    'function basculerVue(nomVue){',
      'if(nomVue !== "previewView") VUE_PRECEDENTE_APERCU = nomVue;',
      '["homeView","appView","trainView","rosterView","previewView"].forEach(function(v){',
        'document.getElementById(v).style.display = (v === nomVue) ? (v === "homeView" ? "flex" : "block") : "none";',
      '});',
    '}',
    'function retourAccueil(){ basculerVue("homeView"); }',
    'function entrer(demarrerEnTinder){',
      'basculerVue("appView");',
      'if(demarrerEnTinder !== undefined) choisirMode(demarrerEnTinder);',
    '}',
    'function entrerEntrainement(){ basculerVue("trainView"); }',
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
        'if(btn) btn.textContent = "🔄 Vérifier les mises à jour du Bot";',
        'if(res && res.disponible){',
          'UPDATE_INFO = res;',
          'ouvrirModalMiseAJour();',
        '} else {',
          'alert("✅ Votre Handball Bot est parfaitement à jour (Version v" + (res ? res.versionActuelle : "' + APP_VERSION + '") + ") !");',
        '}',
      '}).withFailureHandler(function(err){',
        'if(btn) btn.textContent = "🔄 Vérifier les mises à jour du Bot";',
        'alert("Impossible de vérifier les mises à jour : " + err.message);',
      }).verifierMiseAJour();',
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
          'if(b){ b.textContent = "✅ Lien copié dans le presse-papier !"; setTimeout(function(){ b.textContent = "📋 Copier le lien du code.gs mis à jour"; }, 2500); }',
        '});',
      '} else {',
        'window.open(url, "_blank");',
      '}',
    '}',
    'function ouvrirRepoGithub(){',
      'var repo = CLUB_CONFIG.githubRepo;',
      'var url = repo ? ("https://github.com/" + repo + "/actions") : (UPDATE_INFO ? UPDATE_INFO.repoUrl : "https://github.com");',
      'window.open(url, "_blank");',
    '}',
    'function seConnecter(){',
      'var tel = document.getElementById("inpTel").value, pin = document.getElementById("inpPin").value;',
      'document.getElementById("loginError").textContent = "Connexion...";',
      'document.getElementById("btnLogin").disabled = true;',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("btnLogin").disabled = false;',
        'SESSION_TEL = res.telephone; SESSION_PIN = res.pin; SESSION_NOM = res.nom; EST_COACH = res.estCoach;',
        'document.getElementById("loginBox").style.display = "none";',
        'document.getElementById("playerBox").style.display = "flex";',
        'document.getElementById("playerNomPreview").textContent = res.nom;',
        'document.getElementById("playerPostePreview").textContent = res.poste;',
        'document.getElementById("selPosteJoueur").value = res.poste;',
        'if(res.photo){ document.getElementById("playerImgPreview").src = res.photo; document.getElementById("playerImgPreview").style.display = "block"; document.getElementById("playerInitialPreview").style.display = "none"; }',
        'else { document.getElementById("playerInitialPreview").textContent = res.nom.charAt(0).toUpperCase(); document.getElementById("playerInitialPreview").style.display = "flex"; document.getElementById("playerImgPreview").style.display = "none"; }',
        'if(EST_COACH){',
          'document.getElementById("coachMenuBox").style.display = "block";',
          'verifierMiseAJourAutomatique();',
        '}',
        'try { localStorage.setItem("hb_tel", tel); localStorage.setItem("hb_pin", pin); } catch(e){}',
        'google.script.run.withSuccessHandler(function(data){ appliquerDonneesRecues(data, false); }).getDonneesCoach();',
      '}).withFailureHandler(function(err){',
        'document.getElementById("btnLogin").disabled = false;',
        'document.getElementById("loginError").textContent = err.message;',
      '}).authentifierUtilisateur(tel, pin);',
    '}',
    'function seDeconnecter(){',
      'try { localStorage.removeItem("hb_pin"); } catch(e){}',
      'SESSION_TEL = ""; SESSION_PIN = ""; SESSION_NOM = ""; EST_COACH = false;',
      'document.getElementById("playerBox").style.display = "none";',
      'document.getElementById("loginBox").style.display = "flex";',
      'document.getElementById("inpPin").value = "";',
      'retourAccueil();',
    '}',
    'function changerMonPoste(){',
      'var np = document.getElementById("selPosteJoueur").value;',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("playerPostePreview").textContent = res.poste;',
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
        '}).enregistrerMaPhoto(SESSION_TEL, SESSION_PIN, b64);',
      '};',
      'r.readAsDataURL(f);',
    '}',
    'function majVueEntrainement(){',
      'var s = SEANCES[SEANCE_COURANTE];',
      'document.getElementById("trainExplication").textContent = s.info;',
      'var zDyn = document.getElementById("trDynamicZones"); zDyn.innerHTML = "";',
      's.zones.forEach(function(z){',
        'var col = document.createElement("div"); col.className = "col " + z.css;',
        'var ct = document.createElement("div"); ct.className = "col-title"; ct.innerHTML = "<span>" + z.label + "</span><span id=\'trCount_" + z.id + "\'>0</span>"; col.appendChild(ct);',
        'var dz = document.createElement("div"); dz.className = "dropzone"; dz.id = "trZone_" + z.id; col.appendChild(dz);',
        'zDyn.appendChild(col);',
      '});',
      'var trPool = document.getElementById("trZonePool"); trPool.innerHTML = "";',
      'var listeDispos = ENTRAINEMENTS[SEANCE_COURANTE] || [];',
      'listeDispos.forEach(function(j){ trPool.appendChild(creerCarte(j)); });',
      'document.getElementById("trCountPool").textContent = listeDispos.length;',
      'initSortables();',
    '}',
    'function changerSeance(seanceKey){',
      'SEANCE_COURANTE = seanceKey;',
      'document.getElementById("tabLun").className = "tab-btn" + (seanceKey === "lun" ? " tab-active" : "");',
      'document.getElementById("tabJeu").className = "tab-btn" + (seanceKey === "jeu" ? " tab-active" : "");',
      'majVueEntrainement();',
    '}',
    'function reinitialiserSeance(){ majVueEntrainement(); }',
    'function preparerDonneesEntrainement(){',
      'var s = SEANCES[SEANCE_COURANTE];',
      'var groupes = s.zones.map(function(z){ return { nom: z.label, joueurs: extraireListeNoms("trZone_" + z.id) }; });',
      'return { seance: s.label, groupes: groupes, nonRetenus: extraireListeNoms("trZonePool") };',
    '}',
    'function creerMessageEntrainement(d){',
      'var lignes = ["🏋️ *ENTRAÎNEMENT " + String(d.seance).toUpperCase() + "*", ""];',
      'd.groupes.forEach(function(g){',
        'lignes.push("• *" + g.nom + "* (" + g.joueurs.length + ") :");',
        'lignes.push(g.joueurs.length ? g.joueurs.map(function(n){ return "- " + n; }).join("\\n") : "Aucun");',
        'lignes.push("");',
      '});',
      'return lignes.join("\\n");',
    '}',
    'function sauvegarderEntrainement(publierWa){',
      'var d = preparerDonneesEntrainement();',
      'var msg = creerMessageEntrainement(d);',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("statutTrain").textContent = "Sauvegardé (" + res.date + ")";',
        'if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });',
      '}).enregistrerEntrainementEtPublier(d.seance, d.groupes, d.nonRetenus, publierWa, msg);',
    '}',
    'function ouvrirApercuEntrainement(){',
      'var d = preparerDonneesEntrainement();',
      'CONTEXTE_APERCU = { type: "train", donnees: d };',
      'document.getElementById("previewTitle").textContent = "Preview - Entraînement " + d.seance;',
      'var div = document.getElementById("previewMessages"); div.innerHTML = "";',
      'var txt = document.createElement("textarea"); txt.className = "preview-text"; txt.id = "txtPreviewTrain"; txt.value = creerMessageEntrainement(d); div.appendChild(txt);',
      'basculerVue("previewView");',
    '}',
    'function initSortables(){',
      '["zonePool","zone1B","zone1C","zone1D"].forEach(function(id){',
        'var el = document.getElementById(id);',
        'if(el) new Sortable(el, { group: "shared", animation: 180, onSort: majCompteurs });',
      '});',
      'var trPool = document.getElementById("trZonePool");',
      'if(trPool) new Sortable(trPool, { group: "trShared", animation: 180 });',
      'var s = SEANCES[SEANCE_COURANTE];',
      'if(s){',
        's.zones.forEach(function(z){',
          'var el = document.getElementById("trZone_" + z.id);',
          'if(el) new Sortable(el, { group: "trShared", animation: 180 });',
        '});',
      '}',
    '}',
    'function rendreRosterGrid(){',
      'var grid = document.getElementById("rosterGrid"); if(!grid) return; grid.innerHTML = "";',
      'document.getElementById("rosterCount").textContent = EFFECTIF_COMPLET.length + " joueurs";',
      'EFFECTIF_COMPLET.forEach(function(p){',
        'var card = document.createElement("div"); card.className = "rcard"; card.onclick = function(){ ouvrirModalJoueur(p.nom); };',
        'var av = document.createElement("div"); av.className = "pmini";',
        'if(p.photo){ var img = document.createElement("img"); img.src = p.photo; av.appendChild(img); }',
        'else { av.textContent = p.nom.charAt(0).toUpperCase(); }',
        'card.appendChild(av);',
        'var inf = document.createElement("div"); inf.style.flex = "1"; inf.style.minWidth = "0";',
        'var nm = document.createElement("div"); nm.style.fontWeight = "700"; nm.textContent = p.nom; inf.appendChild(nm);',
        'var pst = document.createElement("div"); pst.style.fontSize = "0.78rem"; pst.style.color = "#d4d4d4"; pst.textContent = p.poste || "Demi-Centre"; inf.appendChild(pst);',
        'if(p.note){ var nt = document.createElement("div"); nt.className = "rnote"; nt.textContent = "💬 " + p.note; inf.appendChild(nt); }',
        'card.appendChild(inf); grid.appendChild(card);',
      '});',
    '}',
    'function filtrerRoster(q){',
      'var val = String(q || "").toLowerCase().trim();',
      'Array.from(document.getElementById("rosterGrid").children).forEach(function(c){',
        'c.style.display = c.textContent.toLowerCase().includes(val) ? "flex" : "none";',
      '});',
    '}',
    'function ouvrirModalJoueur(nom){',
      'JOUEUR_MODAL_COURANT = nom;',
      'var p = EFFECTIF_COMPLET.find(function(x){ return x.nom.toLowerCase() === nom.toLowerCase(); }) || { nom: nom, poste: "Demi-Centre", photo: "", note: "" };',
      'document.getElementById("modalJoueurNom").textContent = p.nom;',
      'document.getElementById("modalJoueurPoste").value = p.poste || "Demi-Centre";',
      'document.getElementById("modalJoueurNote").value = p.note || "";',
      'document.getElementById("modalJoueurStatus").textContent = "";',
      'PHOTO_MODAL_DATA = undefined;',
      'if(p.photo){ document.getElementById("modalJoueurImg").src = p.photo; document.getElementById("modalJoueurImg").style.display = "block"; document.getElementById("modalJoueurInitiale").style.display = "none"; }',
      'else { document.getElementById("modalJoueurInitiale").textContent = p.nom.charAt(0).toUpperCase(); document.getElementById("modalJoueurInitiale").style.display = "flex"; document.getElementById("modalJoueurImg").style.display = "none"; }',
      'document.getElementById("modalJoueurBg").style.display = "flex";',
    '}',
    'function fermerModalJoueur(){ document.getElementById("modalJoueurBg").style.display = "none"; }',
    'function fermerModalSurBg(e){ if(e.target.id === "modalJoueurBg") fermerModalJoueur(); }',
    'function chargerPhotoDepuisModal(e){',
      'var f = e.target.files[0]; if(!f) return;',
      'var r = new FileReader();',
      'r.onload = function(evt){',
        'PHOTO_MODAL_DATA = evt.target.result;',
        'document.getElementById("modalJoueurImg").src = PHOTO_MODAL_DATA;',
        'document.getElementById("modalJoueurImg").style.display = "block";',
        'document.getElementById("modalJoueurInitiale").style.display = "none";',
        'document.getElementById("modalJoueurStatus").textContent = "Photo prête à être enregistrée.";',
      '};',
      'r.readAsDataURL(f);',
    '}',
    'function sauvegarderFicheDepuisModal(){',
      'if(!JOUEUR_MODAL_COURANT) return;',
      'document.getElementById("modalJoueurStatus").textContent = "Enregistrement...";',
      'var np = document.getElementById("modalJoueurPoste").value, nn = document.getElementById("modalJoueurNote").value;',
      'var jCible = { nom: JOUEUR_MODAL_COURANT, poste: np, photo: PHOTO_MODAL_DATA || "", note: nn };',
      'google.script.run.withSuccessHandler(function(res){',
        'document.getElementById("modalJoueurStatus").textContent = "Enregistré avec succès !";',
        'var idx = EFFECTIF_COMPLET.findIndex(function(x){ return x.nom.toLowerCase() === res.joueur.nom.toLowerCase(); });',
        'if(idx !== -1) EFFECTIF_COMPLET[idx] = res.joueur;',
        'rendreRosterGrid();',
        'setTimeout(function(){ fermerModalJoueur(); }, 800);',
      '}).withFailureHandler(function(err){',
        'document.getElementById("modalJoueurStatus").textContent = err.message;',
      '}).enregistrerFicheJoueurParCoach(SESSION_TEL, SESSION_PIN, jCible);',
    '}',
    'window.onload = function(){',
      'initSortables();',
      'try {',
        'var t = localStorage.getItem("hb_tel"), p = localStorage.getItem("hb_pin");',
        'if(t) document.getElementById("inpTel").value = t;',
        'if(t && p){ document.getElementById("inpPin").value = p; seConnecter(); }',
      '} catch(e){}',
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
    let eqDom = null, eqExt = null, datePrioritaire = null, dateSecondaire = null, heureRaw = null, salleRaw = '', nouveauContexteDate = dateContexte || null;
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
        }
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (kl === 'equipe1' || kl === 'team1' || kl === 'domicile' || kl === 'recevant' || kl === 'equipe_1') eqDom = v.libelle || v.nom || v.name || v.title || eqDom;
        else if (kl === 'equipe2' || kl === 'team2' || kl === 'exterieur' || kl === 'visiteur' || kl === 'equipe_2') eqExt = v.libelle || v.nom || v.name || v.title || eqExt;
        else if (kl === 'journee' || kl === 'phase' || kl === 'poule') { const dJ = v.date_debut || v.dateDebut || v.date || null; if (dJ) nouveauContexteDate = String(dJ); }
        else if (kl === 'salle' || kl === 'equipement' || kl === 'gymnase') salleRaw = v.libelle || v.nom || v.ville || salleRaw;
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
            salle: salleRaw
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
    const motCle = motCleClub.toUpperCase();
    const urlBase = urlPoule.replace(/\/journee-\d+\/?\(/i, '/').replace(/\/?\)/, '/');

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

    let matchSemaine = chercherDansSemaine(tousLesMatchs);
    if (matchSemaine) return matchSemaine;

    for (let numJ = 1; numJ <= 22; numJ++) {
      const scanJ = scannerUrl(urlBase + 'journee-' + numJ + '/');
      if (scanJ.matchs.length === 0) continue;
      for (let k = 0; k < scanJ.matchs.length; k++) tousLesMatchs.push(scanJ.matchs[k]);
      matchSemaine = chercherDansSemaine(scanJ.matchs);
      if (matchSemaine) { matchSemaine.statut = 'Détecté (Journée ' + numJ + ')'; return matchSemaine; }
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
      .addItem('🛠️ 5. Initialiser / Mettre à jour les onglets', 'initialiserOngletsWebApp')
      .addItem('✨ 6. Initialiser le classeur complet (Nouveau club)', 'initialiserClasseurComplet')
      .addItem('🎨 7. Actualiser les couleurs et styles', 'actualiserCouleursClasseur')
      .addItem('🔄 8. Vérifier les mises à jour du modèle', 'menuVerifierMiseAJour')
      .addSeparator()
      .addItem('🚀 Tout exécuter (Mise à jour + Envoi)', 'executionAutoLundiMatin')
      .addToUi();
  } catch (e) {}
}

