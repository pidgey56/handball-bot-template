/**
 * ============================================================================
 * HANDBALL BOT 2.0 - MICRO-BACKEND API GOOGLE SHEETS (`api.gs`)
 * ============================================================================
 * Ce script transforme votre Google Sheet en API JSON haute performance
 * pour alimenter l'application Web / PWA hébergée sur GitHub Pages.
 *
 * Fonctionnalités intégrées :
 * - Routeur universel JSON (doGet et doPost)
 * - Cache serveur haute vitesse (CacheService) pour des temps de réponse < 50ms
 * - Support officiel du scraping FFHB (sans restriction CORS)
 * - Persistance automatique dans les onglets du Google Sheet
 * ============================================================================
 */

/**
 * Routeur HTTP GET (doGet)
 */
function doGet(e) {
  if (e && e.parameter) {
    if (e.parameter.action === 'sync') {
      const nb = typeof synchroniserDepuisGitHub === 'function' ? synchroniserDepuisGitHub() : 0;
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', count: nb }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.action === 'ping') {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', version: '2.0.0', time: new Date().toISOString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.action === 'getDonneesCoach') {
      const data = getDonneesCoach();
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: data }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Redirection automatique vers la WebApp PWA sur GitHub Pages avec le lien API prÃ©-configurÃ©
  const cfg = getClubConfig();
  const defaultPwa = 'https://pidgey56.github.io/handball-bot-template/';
  const basePwa = (cfg && cfg.webappUrl && cfg.webappUrl.indexOf('http') === 0 && cfg.webappUrl.indexOf('script.google.com') === -1) ? cfg.webappUrl : defaultPwa;
  const cleanBase = basePwa.split('?')[0].replace(/\/+$/, '') + '/';
  let serviceUrl = '';
  try { serviceUrl = ScriptApp.getService().getUrl(); } catch (err) {}
  const webAppUrl = cleanBase + '?api=' + encodeURIComponent(serviceUrl);

  const htmlRedirect = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + (cfg.nomClub || 'Handball') + ' - Espace Coach</title>' +
    '<meta http-equiv="refresh" content="0;url=' + webAppUrl + '">' +
    '<style>' +
    'body{font-family:sans-serif;background:#090d16;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}' +
    '.card{background:#111827;padding:32px;border-radius:16px;border:1px solid #1f2937;max-width:440px;box-shadow:0 10px 30px rgba(0,0,0,0.5);}' +
    'h2{margin-top:0;font-size:1.35rem;color:#f8fafc;}' +
    'p{color:#94a3b8;font-size:0.9rem;line-height:1.5;}' +
    'a.btn{display:inline-block;margin-top:16px;background:#3b82f6;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;}' +
    '</style></head><body>' +
    '<div class="card">' +
    '<h2>🤾 ' + (cfg.nomClub || 'Handball') + ' Manager 2.0</h2>' +
    '<p>Redirection vers la WebApp PWA haute vitesse...</p>' +
    '<a class="btn" href="' + webAppUrl + '">Ouvrir l\'application</a>' +
    '</div>' +
    '<script>window.location.replace("' + webAppUrl + '");</script>' +
    '</body></html>';

  return HtmlService.createHtmlOutput(htmlRedirect)
    .setTitle((cfg.nomClub || 'Handball') + ' - Espace Coach')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Routeur universel HTTP POST (doPost)
 * Exécute les requêtes de l'application WebApp / PWA
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Aucune donnée POST reçue' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const args = payload.args || [];

    // Support des votes WhatsApp (GitHub Actions)
    if (action === 'save_votes' && Array.isArray(payload.votes)) {
      const nb = typeof enregistrerVotesDansSheet === 'function' ? enregistrerVotesDansSheet(payload.votes) : 0;
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', count: nb }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Table de routage dynamique
    const router = {
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
      'enregistrerModeFonctionnement': enregistrerModeFonctionnement
    };

    if (typeof router[action] === 'function') {
      const result = router[action].apply(null, args);

      // Invalidation automatique du cache serveur en cas d'écriture
      if (action.indexOf('enregistrer') === 0 || action.indexOf('supprimer') === 0 || action.indexOf('reinitialiser') === 0 || action.indexOf('ajouter') === 0) {
        try { CacheService.getScriptCache().remove('COACH_DATA_CACHE'); } catch (ce) {}
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: result }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Action API non reconnue : ' + action }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

