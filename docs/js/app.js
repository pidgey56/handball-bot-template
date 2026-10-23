// ============================================================================
// HANDBALL BOT 2.0 - APPLICATION FRONTEND
// ============================================================================
var APP_VERSION = '2.0.0';
var UPSTREAM_TEMPLATE_REPO = 'pidgey56/handball-bot-template';
var CLUB_CONFIG = window.CLUB_CONFIG || {
  nomClub: 'Mon Club Handball',
  githubRepo: '',
  chouchou: '',
  mvp: '',
  chevre: '',
  nbEquipes: 2,
  equipes: [],
  nomEquipe1: 'Équipe 1',
  nomEquipe2: 'Équipe 2',
  nomEquipe3: 'Équipe 3',
  couleurPrimaire: '#1e293b',
  couleurSecondaire: '#f59e0b',
  couleurEquipe1: '#3b82f6',
  couleurEquipe2: '#f59e0b',
  couleurEquipe3: '#10b981',
  logoUrl: 'images/logo.png',
  urlFfhbClub: ''
};
function estJoueurChouchou(nom){
  if(!nom || !CLUB_CONFIG || !CLUB_CONFIG.chouchou) return false;
  var cible = String(nom).trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
  var liste = String(CLUB_CONFIG.chouchou).split(",").map(function(s){ return s.trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim(); }).filter(Boolean);
  return liste.indexOf(cible) !== -1;
}
function estJoueurMvp(nom){
  if(!nom) return false;
  var cible = String(nom).replace(/[🏆🐐❤️]/g, "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
  if(CLUB_CONFIG && CLUB_CONFIG.mvp){
    var mvpNom = String(CLUB_CONFIG.mvp).replace(/[🏆🐐❤️]/g, "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
    if(mvpNom && mvpNom === cible) return true;
  }
  if(typeof VOTES_MVP_DATA !== "undefined" && VOTES_MVP_DATA && VOTES_MVP_DATA.podiumMvp && VOTES_MVP_DATA.podiumMvp.length > 0 && VOTES_MVP_DATA.podiumMvp[0].voix > 0){
    var topMvp = String(VOTES_MVP_DATA.podiumMvp[0].nom || "").replace(/[🏆🐐❤️]/g, "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
    if(topMvp && topMvp === cible) return true;
  }
  return false;
}
function estJoueurChevre(nom){
  if(!nom) return false;
  var cible = String(nom).replace(/[🏆🐐❤️]/g, "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
  if(CLUB_CONFIG && CLUB_CONFIG.chevre){
    var chNom = String(CLUB_CONFIG.chevre).replace(/[🏆🐐❤️]/g, "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
    if(chNom && chNom === cible) return true;
  }
  if(typeof CHEVRE_DATA !== "undefined" && CHEVRE_DATA && CHEVRE_DATA.actions && CHEVRE_DATA.actions.length > 0 && CHEVRE_DATA.actions[0].voix > 0 && CHEVRE_DATA.actions[0].joueur){
    var topCh = String(CHEVRE_DATA.actions[0].joueur || "").replace(/[🏆🐐❤️]/g, "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
    if(topCh && topCh === cible) return true;
  }
  return false;
}
function formaterNomPourMessage(nom){
  if(!nom) return "";
  var s = String(nom).trim();
  var clean = s.replace(/[🏆🐐❤️]/g, "").trim();
  var isM = (typeof estJoueurMvp === "function") && estJoueurMvp(clean);
  var isC = (typeof estJoueurChevre === "function") && estJoueurChevre(clean);
  var badges = [];
  if(isM && s.indexOf("🏆") === -1) badges.push("🏆");
  if(isC && s.indexOf("🐐") === -1) badges.push("🐐");
  if(badges.length > 0){
    return clean + " " + badges.join(" ");
  }
  return s;
}
var SEANCES_TRAIN = [{ id: "lun", jour: "Lundi", horaire: "20h30", label: "Lundi (20h30)", actif: true }, { id: "mer", jour: "Mercredi", horaire: "20h30", label: "Mercredi (20h30)", actif: true }];
var DERNIERE_COMPO = null;
var EQUIPE_TACTIQUE_COURANTE = "1B";
var COMPOSITIONS_TACTIQUES = { "1B": {}, "1C": {}, "1D": {} };
var POSITIONS_HANDBALL = [
  { code: "GB", label: "Gardien", x: 50, y: 82 },
  { code: "PVT", label: "Pivot", x: 50, y: 62 },
  { code: "ALG", label: "Ailier G.", x: 18, y: 56 },
  { code: "ARG", label: "Arrière G.", x: 18, y: 20 },
  { code: "DC", label: "Demi-Centre", x: 50, y: 22 },
  { code: "ARD", label: "Arrière D.", x: 82, y: 20 },
  { code: "ALD", label: "Ailier D.", x: 82, y: 56 }
];
var SEANCE_COURANTE = (SEANCES_TRAIN && SEANCES_TRAIN[0] && SEANCES_TRAIN[0].id) || "lun";
var ENTRAINEMENTS = {};
if(SEANCES_TRAIN && SEANCES_TRAIN.length){
  SEANCES_TRAIN.forEach(function(s){ ENTRAINEMENTS[s.id] = []; });
}
var TRAIN_CONFIG = {};
if(SEANCES_TRAIN && SEANCES_TRAIN.length){
  SEANCES_TRAIN.forEach(function(s, idx){
    TRAIN_CONFIG[s.id] = { label: s.label || (s.jour + " " + (s.horaire || "")), type: (idx === 0 ? "separe" : (idx === 1 ? "complet" : "reduit")), max: 20 };
  });
}
var TRAIN_MODE_TINDER = false; var TRAIN_SWIPE_HISTORIQUE = []; var TRAIN_ANIM_EN_COURS = false;
var JOUEURS = []; var EFFECTIF_COMPLET = []; var MODE_TINDER = false; var HISTORIQUE_SWIPE = []; var ANIM_EN_COURS = false; var CONTEXTE_APERCU = null; var VUE_PRECEDENTE_APERCU = "appView";
var SESSION_TEL = ""; var SESSION_PIN = ""; var SESSION_NOM = ""; var EST_COACH = false; var EST_TRESORIER = false; var ID_ABSENCE_EN_COURS = null; var CURRENT_MATCH_SALLE = "";
var INFOS_MATCHS = null; var COVOITURAGE_DATA = { conducteurs: [], passagers: [] }; var VOTES_MVP_DATA = { totalVotes: 0, podiumMvp: [], monVoteMvp: "" }; var CHEVRE_DATA = { totalActions: 0, totalVotes: 0, actions: [], podiumChevre: [], monVoteActionId: "" }; var MES_ABSENCES = []; var STATUT_COVOIT_CHOISI = "conduis";
var CAISSE_NOIRE_DATA = { config: { devise: "€", objectifCagnotte: 300, objectifDescription: "Resto & Tournée de fin d'année", moyenPaiement: "Lydia / Espèces au vestiaire", bareme: [] }, amendes: [], depenses: [], stats: { totalCollecte: 0, totalDu: 0, soldeCaisse: 0, totalDepenses: 0 } };
var VACANCES_DATA = { periodes: [], enVacancesCetteSemaine: false, infoSemaine: {}, enVacancesAujourdhui: false, infoAujourdhui: {} };
var JOUEUR_MODAL_COURANT = null; var POSTE_MODAL_COURANT = ""; var PHOTO_MODAL_DATA = undefined;
function afficherLoading(titre, sousTitre){
var el = document.getElementById("globalLoadingScreen"); if(!el) return;
if(titre) document.getElementById("loadingScreenTitle").textContent = titre;
if(sousTitre) document.getElementById("loadingScreenSub").textContent = sousTitre;
el.style.display = "flex";
void el.offsetWidth;
el.style.opacity = "1"; el.style.visibility = "visible";
clearTimeout(window._loadingSafetyTimer);
window._loadingSafetyTimer = setTimeout(masquerLoading, 3500);
}
function masquerLoading(){
var el = document.getElementById("globalLoadingScreen"); if(!el) return;
el.style.opacity = "0";
setTimeout(function(){ el.style.visibility = "hidden"; el.style.display = "none"; }, 320);
}
function chargerDonneesCoach(conserverSelection){
afficherLoading("Chargement...", "Actualisation des données de l'équipe...");
google.script.run.withSuccessHandler(function(data){
appliquerDonneesRecues(data, !!conserverSelection);
}).withFailureHandler(function(err){
masquerLoading();
afficherToast("Erreur de chargement : " + err.message, "erreur");
}).getDonneesCoach();
}
function initialiserColonnes(){
var pool = document.getElementById("zonePool"); if(!pool || !JOUEURS) return;
var deja1B = extraireListeNoms("zone1B");
var deja1C = document.getElementById("zone1C") ? extraireListeNoms("zone1C") : [];
var deja1D = document.getElementById("zone1D") ? extraireListeNoms("zone1D") : [];
var dejaRepos = document.getElementById("zoneRepos") ? extraireListeNoms("zoneRepos") : [];
var z1B = document.getElementById("zone1B"), z1C = document.getElementById("zone1C"), z1D = document.getElementById("zone1D"), zRepos = document.getElementById("zoneRepos");
if(z1B) z1B.innerHTML = ""; if(z1C) z1C.innerHTML = ""; if(z1D) z1D.innerHTML = ""; if(zRepos) zRepos.innerHTML = ""; pool.innerHTML = "";
JOUEURS.forEach(function(j){
var c = creerCarte(j);
if(deja1B.indexOf(j.nom) !== -1 && z1B) z1B.appendChild(c);
else if(deja1C.indexOf(j.nom) !== -1 && z1C) z1C.appendChild(c);
else if(deja1D.indexOf(j.nom) !== -1 && z1D) z1D.appendChild(c);
else if(dejaRepos.indexOf(j.nom) !== -1 && zRepos) zRepos.appendChild(c);
else pool.appendChild(c);
});
majCompteurs();
}
function getContrastColor(hexColor){
if(!hexColor) return "#ffffff";
var str = String(hexColor).trim();
if(str.charAt(0) !== "#") return "#ffffff";
var hex = str.substring(1);
if(hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
if(hex.length !== 6) return "#ffffff";
var r = parseInt(hex.substring(0, 2), 16) || 0, g = parseInt(hex.substring(2, 4), 16) || 0, b = parseInt(hex.substring(4, 6), 16) || 0;
var yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
return (yiq >= 150) ? "#111827" : "#ffffff";
}
function appliquerVariablesCss(cp, cs, c1, c2, c3){
var r = document.documentElement;
r.style.setProperty("--color-primary", cp);
r.style.setProperty("--color-primary-text", getContrastColor(cp));
r.style.setProperty("--color-secondary", cs);
r.style.setProperty("--color-secondary-text", getContrastColor(cs));
r.style.setProperty("--color-team1", c1);
r.style.setProperty("--color-team1-text", getContrastColor(c1));
r.style.setProperty("--color-team2", c2);
r.style.setProperty("--color-team2-text", getContrastColor(c2));
r.style.setProperty("--color-team3", c3 || "#10b981");
r.style.setProperty("--color-team3-text", getContrastColor(c3 || "#10b981"));
}
function ouvrirSelecteurLogoClub(){ document.getElementById("fileClubLogo").click(); }
function chargerFichierLogoClub(e){
var f = e.target.files[0]; if(!f) return;
var r = new FileReader();
r.onload = function(evt){
var b64 = evt.target.result;
document.getElementById("modalLogoStatus").innerHTML = "<span class='spinner-badge'></span>Téléversement du blason sur Google Drive...";
afficherLoading("Blason du club...", "Téléversement et enregistrement du logo...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
document.getElementById("modalLogoStatus").textContent = "Blason du club mis à jour !";
majClubLogoClient(res.logoUrl);
if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });
}).withFailureHandler(function(err){
masquerLoading();
document.getElementById("modalLogoStatus").textContent = "Erreur : " + err.message;
}).enregistrerLogoClub(SESSION_TEL, SESSION_PIN, b64);
};
r.readAsDataURL(f);
}
function sauvegarderLogoUrlClient(){
var url = document.getElementById("inpClubLogoUrl").value.trim();
if(!url) return;
document.getElementById("modalLogoStatus").innerHTML = "<span class='spinner-badge'></span>Enregistrement du logo...";
afficherLoading("Blason du club...", "Enregistrement de l'adresse du logo...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
document.getElementById("modalLogoStatus").textContent = "Blason du club mis à jour !";
majClubLogoClient(res.logoUrl);
if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });
}).withFailureHandler(function(err){
masquerLoading();
document.getElementById("modalLogoStatus").textContent = "Erreur : " + err.message;
}).enregistrerLogoClub(SESSION_TEL, SESSION_PIN, url);
}
function reinitialiserLogoClubClient(){
if(!confirm("Rétablir le blason vectoriel officiel dynamique du club ?")) return;
document.getElementById("modalLogoStatus").innerHTML = "<span class='spinner-badge'></span>Rétablissement du blason officiel...";
afficherLoading("Blason du club...", "Rétablissement du blason officiel...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
document.getElementById("modalLogoStatus").textContent = "Blason officiel rétabli !";
majClubLogoClient(res.logoUrl);
}).withFailureHandler(function(err){
masquerLoading();
document.getElementById("modalLogoStatus").textContent = "Erreur : " + err.message;
}).reinitialiserLogoClub(SESSION_TEL, SESSION_PIN);
}
function majClubLogoClient(nouvelleUrl){
  CLUB_CONFIG.logoUrl = nouvelleUrl;
  ["homeLogoImg", "appHeaderLogoImg", "trainHeaderLogoImg", "rosterHeaderLogoImg", "modalClubLogoPreview"].forEach(function(id){
    var img = document.getElementById(id);
    if(img) img.src = nouvelleUrl;
  });
}
function extraireCouleursImageCanvas(imgElement, callback){
  try {
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    var w = 80, h = 80;
    canvas.width = w; canvas.height = h;
    ctx.drawImage(imgElement, 0, 0, w, h);
    var imgData = ctx.getImageData(0, 0, w, h).data;
    var buckets = {}, countDark = 0, countTotal = 0;
    for(var i = 0; i < imgData.length; i += 4){
      var r = imgData[i], g = imgData[i + 1], b = imgData[i + 2], a = imgData[i + 3];
      if(a < 128) continue;
      if(r > 235 && g > 235 && b > 235) continue;
      if(r < 30 && g < 30 && b < 30){ countDark++; continue; }
      countTotal++;
      var qr = Math.floor(r / 16) * 16, qg = Math.floor(g / 16) * 16, qb = Math.floor(b / 16) * 16;
      var key = qr + "," + qg + "," + qb;
      if(!buckets[key]) buckets[key] = { r: qr, g: qg, b: qb, count: 0 };
      buckets[key].count++;
    }
    var list = Object.values(buckets);
    if(!list.length){ callback({ primaire: "#f97316", secondaire: "#fbbf24", equipe1: "#f97316", equipe2: "#fbbf24", equipe3: "#10b981" }); return; }
    list.forEach(function(item){
      var max = Math.max(item.r, item.g, item.b), min = Math.min(item.r, item.g, item.b);
      var sat = max === 0 ? 0 : (max - min) / max;
      item.score = item.count * (1 + sat * 3);
    });
    list.sort(function(a, b){ return b.score - a.score; });
    function toHex(r, g, b){ return "#" + ("0" + r.toString(16)).slice(-2) + ("0" + g.toString(16)).slice(-2) + ("0" + b.toString(16)).slice(-2); }
    function colDist(c1, c2){ var dr = c1.r - c2.r, dg = c1.g - c2.g, db = c1.b - c2.b; return Math.sqrt(dr * dr + dg * dg + db * db); }
    var prim = list[0];
    var hexP = toHex(prim.r, prim.g, prim.b);
    var sec = null;
    for(var k = 1; k < list.length; k++){ if(colDist(prim, list[k]) > 75){ sec = list[k]; break; } }
    var hexS = "";
    if(sec){ hexS = toHex(sec.r, sec.g, sec.b); }
    else { hexS = (countDark > countTotal * 0.15) ? "#1e293b" : "#fbbf24"; }
    var hexE3 = "#10b981";
    for(var m = 2; m < list.length; m++){
      if(colDist(prim, list[m]) > 60 && (!sec || colDist(sec, list[m]) > 60)){ hexE3 = toHex(list[m].r, list[m].g, list[m].b); break; }
    }
    callback({ primaire: hexP, secondaire: hexS, equipe1: hexP, equipe2: hexS, equipe3: hexE3 });
  } catch(e){ console.error("Erreur extraction couleurs:", e); callback(null); }
}
function importerDepuisFfhbClient(){
  var inp = document.getElementById("inpFfhbClubUrl");
  var url = inp ? inp.value.trim() : "";
  if(!url){ afficherToast("Veuillez saisir l'adresse de votre club sur monclub.ffhandball.fr", "erreur"); return; }
  var btn = document.getElementById("btnImportFfhb");
  var status = document.getElementById("ffhbImportStatus");
  if(btn) btn.disabled = true;
  if(status) status.innerHTML = "<span style='color:#38bdf8;'>⏳ Connexion à FFHB et récupération des données...</span>";
  google.script.run.withSuccessHandler(function(res){
    if(btn) btn.disabled = false;
    if(!res || !res.ok){ if(status) status.innerHTML = "<span style='color:#f87171;'>Erreur lors de l'importation.</span>"; return; }
    NOUVEAU_NOM_CLUB_IMPORTE = res.nomClub || "";
    NOUVEAU_LOGO_IMPORTE = res.logoUrl || "";
    NOUVEAU_SALLE_IMPORTEE = res.salleDefaut || "";
    if(document.getElementById("inpClubLogoUrl")) document.getElementById("inpClubLogoUrl").value = res.logoUrl;
    if(document.getElementById("modalClubLogoPreview")) document.getElementById("modalClubLogoPreview").src = res.logoDataUri || res.logoUrl;
    if(status) status.innerHTML = "<span style='color:#38bdf8;'>🎨 Détection des couleurs du blason...</span>";
    var imgTemp = new Image();
    imgTemp.crossOrigin = "Anonymous";
    imgTemp.onload = function(){
      extraireCouleursImageCanvas(imgTemp, function(pal){
        if(pal){
          document.getElementById("inpColPrimaire").value = pal.primaire;
          document.getElementById("txtColPrimaire").value = pal.primaire.toUpperCase();
          document.getElementById("inpColSecondaire").value = pal.secondaire;
          document.getElementById("txtColSecondaire").value = pal.secondaire.toUpperCase();
          document.getElementById("inpColEq1").value = pal.equipe1;
          document.getElementById("txtColEq1").value = pal.equipe1.toUpperCase();
          document.getElementById("inpColEq2").value = pal.equipe2;
          document.getElementById("txtColEq2").value = pal.equipe2.toUpperCase();
          if(document.getElementById("inpColEq3")){
            document.getElementById("inpColEq3").value = pal.equipe3;
            document.getElementById("txtColEq3").value = pal.equipe3.toUpperCase();
          }
          majCouleursLive();
        }
        majClubLogoClient(res.logoUrl);
        var nomAff = res.nomClub ? (" : " + res.nomClub) : "";
        if(status) status.innerHTML = "<span style='color:#22c55e;font-weight:800;'>✓ Club importé" + nomAff + "</span><br><span style='color:#cbd5e1;font-size:0.7rem;'>Logo et couleurs synchronisés ! Cliquez ci-dessous sur « Enregistrer les modifications » pour valider.</span>";
        afficherToast("Club " + (res.nomClub || "") + " importé avec succès !", "succes");
        if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });
      });
    };
    imgTemp.onerror = function(){
      majClubLogoClient(res.logoUrl);
      if(status) status.innerHTML = "<span style='color:#22c55e;font-weight:800;'>✓ Logo FFHB importé" + (res.nomClub ? (" : " + res.nomClub) : "") + "</span>";
      afficherToast("Logo FFHB récupéré !", "succes");
    };
    imgTemp.src = res.logoDataUri || res.logoUrl;
  }).withFailureHandler(function(err){
    if(btn) btn.disabled = false;
    if(status) status.innerHTML = "<span style='color:#f87171;'>Erreur : " + err.message + "</span>";
    afficherToast(err.message, "erreur");
  }).importerInfosClubFFHB(SESSION_TEL, SESSION_PIN, url);
}
function choisirNbEquipesModal(n){
var num = parseInt(n, 10) || 3;
var inp = document.getElementById("inpNbEquipesModal"); if(inp) inp.value = num;
[1, 2, 3].forEach(function(i){
var b = document.getElementById("btnNbEq" + i); if(!b) return;
if(i === num){
b.style.background = "var(--color-primary)"; b.style.borderColor = "var(--color-primary)"; b.style.color = "#ffffff"; b.style.fontWeight = "800";
} else {
b.style.background = "#0f172a"; b.style.borderColor = "#334155"; b.style.color = "#94a3b8"; b.style.fontWeight = "500";
}
});
var rowEq3 = document.getElementById("rowColEq3"); if(rowEq3) rowEq3.style.display = (num >= 3) ? "flex" : "none";
var rowEq2 = document.getElementById("rowColEq2"); if(rowEq2) rowEq2.style.display = (num >= 2) ? "flex" : "none";
var boxEq3 = document.getElementById("boxCfgEq3"); if(boxEq3) boxEq3.style.display = (num >= 3) ? "block" : "none";
var boxEq2 = document.getElementById("boxCfgEq2"); if(boxEq2) boxEq2.style.display = (num >= 2) ? "block" : "none";
var prevE3 = document.getElementById("prevBadgeE3"); if(prevE3) prevE3.style.display = (num >= 3) ? "inline-block" : "none";
var prevE2 = document.getElementById("prevBadgeE2"); if(prevE2) prevE2.style.display = (num >= 2) ? "inline-block" : "none";
}
function ouvrirModalCouleurs(){
var cp = (CLUB_CONFIG && CLUB_CONFIG.couleurPrimaire) || "#1e293b";
var cs = (CLUB_CONFIG && CLUB_CONFIG.couleurSecondaire) || "#f59e0b";
var c1 = (CLUB_CONFIG && CLUB_CONFIG.couleurEquipe1) || "#3b82f6";
var c2 = (CLUB_CONFIG && CLUB_CONFIG.couleurEquipe2) || "#f59e0b";
var c3 = (CLUB_CONFIG && CLUB_CONFIG.couleurEquipe3) || "#10b981";
document.getElementById("inpColPrimaire").value = cp;
document.getElementById("txtColPrimaire").value = cp.toUpperCase();
document.getElementById("inpColSecondaire").value = cs;
document.getElementById("txtColSecondaire").value = cs.toUpperCase();
document.getElementById("inpColEq1").value = c1;
document.getElementById("txtColEq1").value = c1.toUpperCase();
document.getElementById("inpColEq2").value = c2;
document.getElementById("txtColEq2").value = c2.toUpperCase();
if(document.getElementById("inpColEq3")){ document.getElementById("inpColEq3").value = c3; document.getElementById("txtColEq3").value = c3.toUpperCase(); }
document.getElementById("statusModalCouleurs").textContent = "";
document.getElementById("modalLogoStatus").textContent = "";
if(document.getElementById("inpFfhbClubUrl")) document.getElementById("inpFfhbClubUrl").value = CLUB_CONFIG.urlFfhbClub || "";
if(document.getElementById("ffhbImportStatus")) document.getElementById("ffhbImportStatus").innerHTML = "";
if(document.getElementById("modalClubLogoPreview")) document.getElementById("modalClubLogoPreview").src = (CLUB_CONFIG && CLUB_CONFIG.logoUrl) || "images/logo.png";
if(document.getElementById("inpClubLogoUrl")) document.getElementById("inpClubLogoUrl").value = "";
var curNb = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 3;
var cEqs = (CLUB_CONFIG && CLUB_CONFIG.equipes) || [];
[1, 2, 3].forEach(function(i){
var eq = cEqs[i - 1] || {};
var defC = (i === 1 ? "SG1" : (i === 2 ? "SG2" : "SG3"));
var defL = (i === 1 ? "Équipe 1" : (i === 2 ? "Équipe 2" : "Équipe 3"));
var defM = (CLUB_CONFIG.nomClub || "MON CLUB") + (i > 1 ? (" " + i) : "");
if(document.getElementById("cfgEqCode" + i)) document.getElementById("cfgEqCode" + i).value = eq.code || defC;
if(document.getElementById("cfgEqLabel" + i)) document.getElementById("cfgEqLabel" + i).value = eq.nomSondage || defL;
if(document.getElementById("cfgEqMotCle" + i)) document.getElementById("cfgEqMotCle" + i).value = eq.motCleFfhb || defM;
if(document.getElementById("cfgEqDelai" + i)) document.getElementById("cfgEqDelai" + i).value = (eq.delaiRdvHeures !== undefined ? eq.delaiRdvHeures : 1);
if(document.getElementById("cfgEqUrl" + i)) document.getElementById("cfgEqUrl" + i).value = eq.urlPoule || "";
if(document.getElementById("cfgEqUrlCoupe" + i)) document.getElementById("cfgEqUrlCoupe" + i).value = eq.urlCoupe || "";
});
choisirNbEquipesModal(curNb);
majApercuModalCouleurs(cp, cs, c1, c2, c3);
document.getElementById("modalCouleursBg").style.display = "flex";
}
function fermerModalCouleurs(){ document.getElementById("modalCouleursBg").style.display = "none"; }
function fermerModalCouleursSurBg(e){ if(e.target.id === "modalCouleursBg") fermerModalCouleurs(); }
function synchroColorInput(cle){
var txt = document.getElementById("txtCol" + cle).value.trim();
if(/^#[0-9A-Fa-f]{6}$/.test(txt)){
document.getElementById("inpCol" + cle).value = txt;
majCouleursLive();
}
}
function appliquerPresetCouleurs(cp, cs, c1, c2, c3){
c3 = c3 || "#10b981";
document.getElementById("inpColPrimaire").value = cp; document.getElementById("txtColPrimaire").value = cp.toUpperCase();
document.getElementById("inpColSecondaire").value = cs; document.getElementById("txtColSecondaire").value = cs.toUpperCase();
document.getElementById("inpColEq1").value = c1; document.getElementById("txtColEq1").value = c1.toUpperCase();
document.getElementById("inpColEq2").value = c2; document.getElementById("txtColEq2").value = c2.toUpperCase();
if(document.getElementById("inpColEq3")){ document.getElementById("inpColEq3").value = c3; document.getElementById("txtColEq3").value = c3.toUpperCase(); }
majCouleursLive();
}
function majCouleursLive(){
var cp = document.getElementById("inpColPrimaire").value;
var cs = document.getElementById("inpColSecondaire").value;
var c1 = document.getElementById("inpColEq1").value;
var c2 = document.getElementById("inpColEq2").value;
var c3 = document.getElementById("inpColEq3") ? document.getElementById("inpColEq3").value : "#10b981";
document.getElementById("txtColPrimaire").value = cp.toUpperCase();
document.getElementById("txtColSecondaire").value = cs.toUpperCase();
document.getElementById("txtColEq1").value = c1.toUpperCase();
document.getElementById("txtColEq2").value = c2.toUpperCase();
if(document.getElementById("txtColEq3")) document.getElementById("txtColEq3").value = c3.toUpperCase();
majApercuModalCouleurs(cp, cs, c1, c2, c3);
appliquerVariablesCss(cp, cs, c1, c2, c3);
}
function majApercuModalCouleurs(cp, cs, c1, c2, c3){
var bp = document.getElementById("prevBadgeP"); if(bp){ bp.style.background = cp; bp.style.color = getContrastColor(cp); }
var bs = document.getElementById("prevBadgeS"); if(bs){ bs.style.background = cs; bs.style.color = getContrastColor(cs); }
var b1 = document.getElementById("prevBadgeE1"); if(b1){ b1.style.background = c1; b1.style.color = getContrastColor(c1); }
var b2 = document.getElementById("prevBadgeE2"); if(b2){ b2.style.background = c2; b2.style.color = getContrastColor(c2); }
var b3 = document.getElementById("prevBadgeE3"); if(b3){ b3.style.background = c3 || "#10b981"; b3.style.color = getContrastColor(c3 || "#10b981"); }
}
function sauvegarderCouleursDepuisModal(){
var cp = document.getElementById("inpColPrimaire").value;
var cs = document.getElementById("inpColSecondaire").value;
var c1 = document.getElementById("inpColEq1").value;
var c2 = document.getElementById("inpColEq2").value;
var c3 = document.getElementById("inpColEq3") ? document.getElementById("inpColEq3").value : "#10b981";
var nbEq = parseInt(document.getElementById("inpNbEquipesModal") ? document.getElementById("inpNbEquipesModal").value : 3, 10) || 3;
var eqList = [];
for(var i = 1; i <= nbEq; i++){
var cCode = (document.getElementById("cfgEqCode" + i) ? document.getElementById("cfgEqCode" + i).value.trim() : "") || ("E" + i);
var cLabel = (document.getElementById("cfgEqLabel" + i) ? document.getElementById("cfgEqLabel" + i).value.trim() : "") || ("Équipe " + i);
var cMotCle = (document.getElementById("cfgEqMotCle" + i) ? document.getElementById("cfgEqMotCle" + i).value.trim() : "") || cLabel;
var cDelai = parseFloat(document.getElementById("cfgEqDelai" + i) ? document.getElementById("cfgEqDelai" + i).value : "1") || 1;
var cUrl = (document.getElementById("cfgEqUrl" + i) ? document.getElementById("cfgEqUrl" + i).value.trim() : "");
var cUrlCoupe = (document.getElementById("cfgEqUrlCoupe" + i) ? document.getElementById("cfgEqUrlCoupe" + i).value.trim() : "");
eqList.push({ num: i, code: cCode, nomSondage: cLabel, motCleFfhb: cMotCle, motCle: cMotCle, labelSondage: cLabel, delaiRdvHeures: cDelai, delaiRdv: cDelai, urlPoule: cUrl, urlCoupe: cUrlCoupe });
}
var urlFfhb = (document.getElementById("inpFfhbClubUrl") ? document.getElementById("inpFfhbClubUrl").value.trim() : "") || (CLUB_CONFIG.urlFfhbClub || "");
var logoAEnregistrer = (document.getElementById("inpClubLogoUrl") ? document.getElementById("inpClubLogoUrl").value.trim() : "") || (NOUVEAU_LOGO_IMPORTE || "");
var payloadCouleurs = {
primaire: cp,
secondaire: cs,
equipe1: c1,
equipe2: c2,
equipe3: c3,
nbEquipes: nbEq,
equipes: eqList,
logoUrl: logoAEnregistrer,
nomClub: NOUVEAU_NOM_CLUB_IMPORTE || "",
urlFfhbClub: urlFfhb
};
document.getElementById("statusModalCouleurs").innerHTML = "<span class='spinner-badge'></span>Enregistrement dans Google Sheet...";
var bSavCol = document.getElementById("btnSaveCouleurs");
if(bSavCol){ bSavCol.disabled = true; bSavCol.innerHTML = "<span class='spinner-inline'></span>Enregistrement..."; }
afficherLoading("Enregistrement du club...", "Sauvegarde des couleurs et de la configuration...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(bSavCol){ bSavCol.disabled = false; bSavCol.textContent = "Enregistrer"; }
document.getElementById("statusModalCouleurs").textContent = "Paramètres enregistrés avec succès !";
CLUB_CONFIG.couleurPrimaire = cp;
CLUB_CONFIG.couleurSecondaire = cs;
CLUB_CONFIG.couleurEquipe1 = c1;
CLUB_CONFIG.couleurEquipe2 = c2;
CLUB_CONFIG.couleurEquipe3 = c3;
CLUB_CONFIG.equipes = eqList;
var ancienNb = CLUB_CONFIG.nbEquipes;
CLUB_CONFIG.nbEquipes = nbEq;
if(res && res.logoUrl){
  CLUB_CONFIG.logoUrl = res.logoUrl;
  majClubLogoClient(res.logoUrl);
}
if(res && res.nomClub){
  CLUB_CONFIG.nomClub = res.nomClub;
  if(document.getElementById("homeClubName")) document.getElementById("homeClubName").textContent = res.nomClub;
  if(document.getElementById("headerClubTitle")) document.getElementById("headerClubTitle").textContent = res.nomClub + " - Compo Coach";
}
if(res && res.urlFfhbClub){
  CLUB_CONFIG.urlFfhbClub = res.urlFfhbClub;
}
afficherToast("Configuration des équipes et couleurs enregistrée !", "succes");
if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });
setTimeout(function(){
fermerModalCouleurs();
chargerDonneesCoach();
}, 900);
}).withFailureHandler(function(err){
masquerLoading();
if(bSavCol){ bSavCol.disabled = false; bSavCol.textContent = "Enregistrer"; }
document.getElementById("statusModalCouleurs").textContent = err.message;
afficherToast(err.message, "erreur");
}).enregistrerCouleursClub(SESSION_TEL, SESSION_PIN, payloadCouleurs);
}
function ajouterCacheBusterPhoto(url){
if(!url) return "";
if(url.indexOf("data:") === 0) return url;
var sep = url.indexOf("?") === -1 ? "?" : "&";
return url + sep + "_t=" + Date.now();
}
function actualiserPhotoDansMemoire(nom, nouvellePhoto){
if(!nom) return;
var nLow = String(nom).trim().toLowerCase();
var nSimple = nLow.replace(/\s*\([^)]*\)\s*/g, "").trim();
(EFFECTIF_COMPLET || []).forEach(function(x){
var xL = String(x.nom || "").trim().toLowerCase();
if(xL === nLow || xL.replace(/\s*\([^)]*\)\s*/g, "").trim() === nSimple){
x.photo = nouvellePhoto;
}
});
(JOUEURS || []).forEach(function(x){
var xL = String(x.nom || "").trim().toLowerCase();
if(xL === nLow || xL.replace(/\s*\([^)]*\)\s*/g, "").trim() === nSimple){
x.photo = nouvellePhoto;
}
});
}
function ouvrirSelecteurPhotoJoueur(){ document.getElementById("filePhoto").click(); }
function ouvrirSelecteurPhotoCoach(){ document.getElementById("fileCoachPhoto").click(); }
function comparerJoueursAlpha(a, b){ return String(a.nom || "").localeCompare(String(b.nom || ""), "fr", { sensitivity: "base" }); }
function trierZoneHtml(zoneId){
var z = document.getElementById(zoneId); if(!z) return;
var cartes = Array.from(z.children);
cartes.sort(function(a, b){ return String(a.getAttribute("data-nom") || "").localeCompare(String(b.getAttribute("data-nom") || ""), "fr", { sensitivity: "base" }); });
cartes.forEach(function(c){ z.appendChild(c); });
}
function animerVoteBouton(choix){
if(MODE_TINDER) swiperVers(choix);
}
function majCompteurs(){
var zPool = document.getElementById("zonePool");
var nPool = zPool ? zPool.children.length : 0;
var cPool = document.getElementById("countPool"); if(cPool) cPool.textContent = nPool;
var tPool = document.getElementById("tCountPool"); if(tPool) tPool.textContent = nPool;
var z1B = document.getElementById("zone1B");
var n1B = z1B ? z1B.children.length : 0;
var c1B = document.getElementById("count1B"); if(c1B) c1B.textContent = n1B + "/12";
var t1B = document.getElementById("tCount1B"); if(t1B) t1B.textContent = n1B;
var z1C = document.getElementById("zone1C");
var n1C = z1C ? z1C.children.length : 0;
var c1C = document.getElementById("count1C"); if(c1C) c1C.textContent = n1C + "/12";
var t1C = document.getElementById("tCount1C"); if(t1C) t1C.textContent = n1C;
var z1D = document.getElementById("zone1D");
var n1D = z1D ? z1D.children.length : 0;
var c1D = document.getElementById("count1D"); if(c1D) c1D.textContent = n1D + "/12";
var t1D = document.getElementById("tCount1D"); if(t1D) t1D.textContent = n1D;
var zRepos = document.getElementById("zoneRepos");
var nRepos = zRepos ? zRepos.children.length : 0;
var cRepos = document.getElementById("countRepos"); if(cRepos) cRepos.textContent = nRepos;
var tRepos = document.getElementById("tCountRepos"); if(tRepos) tRepos.textContent = nRepos;
majTinderReposChips();
}
function majTinderReposChips(){
var cont = document.getElementById("tinderReposChips");
var bar = document.getElementById("tinderReposBar");
var zRepos = document.getElementById("zoneRepos");
if(!cont || !zRepos) return;
var noms = Array.from(zRepos.children).map(function(card){ return card.getAttribute("data-nom"); });
if(bar) bar.style.display = (noms.length > 0 && MODE_TINDER) ? "block" : "none";
cont.innerHTML = "";
noms.forEach(function(nom){
var chip = document.createElement("span");
chip.className = "tinder-repos-chip";
chip.textContent = nom + " ↺";
chip.title = "Cliquez pour rétablir dans les joueurs disponibles";
chip.onclick = function(){ restaurerJoueurDepuisRepos(nom); };
cont.appendChild(chip);
});
}
function restaurerJoueurDepuisRepos(nom){
var zRepos = document.getElementById("zoneRepos");
var pool = document.getElementById("zonePool");
if(!zRepos || !pool) return;
var el = Array.from(zRepos.children).find(function(card){ return card.getAttribute("data-nom") === nom; });
if(el){
pool.appendChild(el);
majCompteurs();
sauvegarderBrouillonLocal(false);
if(MODE_TINDER) afficherCarteTinder();
}
}
function rendreControlesTinder(nbEq){
var c = document.getElementById("tControlsContainer");
if(!c) return;
var eq1 = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe1) || "Équipe 1";
var eq2 = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe2) || "Équipe 2";
var eq3 = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe3) || "Équipe 3";
var html = '<button type="button" class="tbtn-undo" title="Annuler le dernier choix" onclick="annulerDernierSwipe()">↩</button>';
if(nbEq === 1){
html += '<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBouton(\'OUT\')"><span>←</span>Repos</button>';
html += '<button type="button" class="tbtn-circle tbtn-1b" data-choix="1B" onclick="animerVoteBouton(\'1B\')"><span>→</span>' + eq1 + '</button>';
} else if(nbEq === 2){
html += '<button type="button" class="tbtn-circle tbtn-1b" data-choix="1B" onclick="animerVoteBouton(\'1B\')"><span>←</span>' + eq1 + '</button>';
html += '<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBouton(\'OUT\')"><span>↓</span>Repos</button>';
html += '<button type="button" class="tbtn-circle tbtn-1c" data-choix="1C" onclick="animerVoteBouton(\'1C\')"><span>→</span>' + eq2 + '</button>';
} else {
html += '<button type="button" class="tbtn-circle tbtn-1b" data-choix="1B" onclick="animerVoteBouton(\'1B\')"><span>↑</span>' + eq1 + '</button>';
html += '<button type="button" class="tbtn-circle tbtn-1c" data-choix="1C" onclick="animerVoteBouton(\'1C\')"><span>←</span>' + eq2 + '</button>';
html += '<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBouton(\'OUT\')"><span>↓</span>Repos</button>';
html += '<button type="button" class="tbtn-circle tbtn-1d" data-choix="1D" onclick="animerVoteBouton(\'1D\')"><span>→</span>' + eq3 + '</button>';
}
html += '<button type="button" class="tbtn-undo" title="Recommencer à zéro" onclick="recommencerSelection()">Réinit</button>';
c.innerHTML = html;
}
function appliquerDonneesRecues(data, conserverSelection){
  try {
    if(!data) return;
    try { localStorage.setItem("hb_cache_data", JSON.stringify(data)); } catch(e){}
    if(data.clubConfig){
CLUB_CONFIG = data.clubConfig;
if(CLUB_CONFIG.modeFonctionnement){
  MODE_FONCTIONNEMENT = CLUB_CONFIG.modeFonctionnement;
  try { localStorage.setItem("hb_mode", MODE_FONCTIONNEMENT); } catch(e){}
  try { appliquerModeFonctionnementVisuel(MODE_FONCTIONNEMENT); } catch(e){}
}
var nbEq = Math.min(3, Math.max(1, CLUB_CONFIG.nbEquipes || 2));
CLUB_CONFIG.nbEquipes = nbEq;
appliquerVariablesCss(
CLUB_CONFIG.couleurPrimaire,
CLUB_CONFIG.couleurSecondaire,
CLUB_CONFIG.couleurEquipe1 || CLUB_CONFIG.couleurPrimaire,
CLUB_CONFIG.couleurEquipe2 || CLUB_CONFIG.couleurSecondaire,
CLUB_CONFIG.couleurEquipe3 || "#10b981"
);
if(CLUB_CONFIG.nomClub){
document.getElementById("homeClubName").textContent = CLUB_CONFIG.nomClub;
document.getElementById("headerClubTitle").textContent = CLUB_CONFIG.nomClub + " - Compo Coach";
}
if(CLUB_CONFIG.nomEquipe1){
document.getElementById("labelCol1B").textContent = CLUB_CONFIG.nomEquipe1;
document.getElementById("labelTinder1B").textContent = CLUB_CONFIG.nomEquipe1;
}
if(CLUB_CONFIG.nomEquipe2){
document.getElementById("labelCol1C").textContent = CLUB_CONFIG.nomEquipe2;
document.getElementById("labelTinder1C").textContent = CLUB_CONFIG.nomEquipe2;
}
if(CLUB_CONFIG.nomEquipe3){
var lCol3 = document.getElementById("labelCol1D"); if(lCol3) lCol3.textContent = CLUB_CONFIG.nomEquipe3;
var lTind3 = document.getElementById("labelTinder1D"); if(lTind3) lTind3.textContent = CLUB_CONFIG.nomEquipe3;
}
var col1C = document.getElementById("colBox1C"), col1D = document.getElementById("colBox1D");
var tBox1C = document.getElementById("tBox1C"), tBox1D = document.getElementById("tBox1D");
if(nbEq === 1){
if(col1C) col1C.style.display = "none"; if(col1D) col1D.style.display = "none";
if(tBox1C) tBox1C.style.display = "none"; if(tBox1D) tBox1D.style.display = "none";
} else if(nbEq === 2){
if(col1C) col1C.style.display = "flex"; if(col1D) col1D.style.display = "none";
if(tBox1C) tBox1C.style.display = "inline"; if(tBox1D) tBox1D.style.display = "none";
} else {
if(col1C) col1C.style.display = "flex"; if(col1D) col1D.style.display = "flex";
if(tBox1C) tBox1C.style.display = "inline"; if(tBox1D) tBox1D.style.display = "inline";
}
rendreControlesTinder(nbEq);
majOptionsEquipesSelects();
}
if(data.seancesTrain){
SEANCES_TRAIN = data.seancesTrain;
majLibellesOngletsTrain();
}
if(data.derniereCompo){
DERNIERE_COMPO = data.derniereCompo;
var btnPrec = document.getElementById("btnChargerCompoPrec");
if(btnPrec){
btnPrec.style.display = "inline-flex";
if(DERNIERE_COMPO.date) btnPrec.title = "Charger la composition du " + DERNIERE_COMPO.date;
}
}
JOUEURS = data.joueurs || []; EFFECTIF_COMPLET = data.effectif || []; ENTRAINEMENTS = data.entrainements || {};
if(data.matchs){
if(document.getElementById("sub1B")) document.getElementById("sub1B").textContent = data.matchs.label1B || "";
if(document.getElementById("sub1C")) document.getElementById("sub1C").textContent = data.matchs.label1C || "";
if(document.getElementById("sub1D")) document.getElementById("sub1D").textContent = data.matchs.label1D || "";
}
var deja1B = conserverSelection ? extraireListeNoms("zone1B") : [];
var deja1C = (conserverSelection && document.getElementById("zone1C")) ? extraireListeNoms("zone1C") : [];
var deja1D = (conserverSelection && document.getElementById("zone1D")) ? extraireListeNoms("zone1D") : [];
var dejaRepos = (conserverSelection && document.getElementById("zoneRepos")) ? extraireListeNoms("zoneRepos") : [];
var z1B = document.getElementById("zone1B"), z1C = document.getElementById("zone1C"), z1D = document.getElementById("zone1D"), zRepos = document.getElementById("zoneRepos");
var pool = document.getElementById("zonePool");
z1B.innerHTML = ""; if(z1C) z1C.innerHTML = ""; if(z1D) z1D.innerHTML = ""; if(zRepos) zRepos.innerHTML = ""; pool.innerHTML = "";
JOUEURS.forEach(function(j){
var c = creerCarte(j);
if(deja1B.indexOf(j.nom) !== -1) z1B.appendChild(c);
else if(deja1C.indexOf(j.nom) !== -1 && z1C) z1C.appendChild(c);
else if(deja1D.indexOf(j.nom) !== -1 && z1D) z1D.appendChild(c);
else if(dejaRepos.indexOf(j.nom) !== -1 && zRepos) zRepos.appendChild(c);
else pool.appendChild(c);
});
majCompteurs();
document.getElementById("statutChargement").textContent = JOUEURS.length + " disponible(s)";
if(document.getElementById("btnSwitchMode").style.display !== "inline-block") document.getElementById("btnSwitchMode").style.display = "inline-block";
if(data.covoiturage) COVOITURAGE_DATA = data.covoiturage;
if(data.votesMvp) VOTES_MVP_DATA = data.votesMvp;
if(data.chevreData) CHEVRE_DATA = data.chevreData;
if(data.absences) MES_ABSENCES = data.absences;
if(data.matchs) INFOS_MATCHS = data.matchs;
if(data.caisseNoire) CAISSE_NOIRE_DATA = data.caisseNoire;
if(data.vacances){ VACANCES_DATA = data.vacances; majBannieresVacances(); }
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
rendreRosterGrid(); majVueEntrainement();
verifierBrouillonExistant();
var bWa = document.getElementById("txtStatusWhatsApp");
if(bWa) bWa.textContent = "WhatsApp Connecté • Synchronisé";
  } catch(err){ console.error("Erreur appliquerDonneesRecues:", err); }
  finally { masquerLoading(); }
}
function creerCarte(j){
var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;
var card = document.createElement("div"); card.className = "pcard"; card.setAttribute("data-nom", j.nom);
card.onclick = function(e){
if(card.parentNode && card.parentNode.id === "zoneRepos"){
var pool = document.getElementById("zonePool");
if(pool){
pool.appendChild(card);
majCompteurs();
sauvegarderBrouillonLocal(false);
if(MODE_TINDER) afficherCarteTinder();
}
}
};
var pleft = document.createElement("div"); pleft.className = "pleft";
var pmini = document.createElement("div"); pmini.className = "pmini";
var isChou = estJoueurChouchou(j.nom);
if(isChou) pmini.classList.add("is-chouchou");
var isMvp = estJoueurMvp(j.nom);
if(isMvp) pmini.classList.add("is-mvp");
var isChevre = estJoueurChevre(j.nom);
if(isChevre) pmini.classList.add("is-chevre");
var initMini = (j.nom || "").trim().charAt(0).toUpperCase();
if(j.photo){ var img = document.createElement("img"); img.src = j.photo; img.onerror = function(){ this.remove(); pmini.textContent = initMini; }; pmini.appendChild(img); }
else { pmini.textContent = initMini; }
pmini.style.cursor = "pointer"; pmini.title = "Fiche de " + j.nom; pmini.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); };
pleft.appendChild(pmini);
var pinfo = document.createElement("div");
var pname = document.createElement("div"); pname.className = "pname"; pname.textContent = j.nom;
if(isChou){ var cBadge = document.createElement("span"); cBadge.className = "chouchou-badge"; cBadge.textContent = "❤️ Chouchou"; pname.appendChild(cBadge); }
if(isMvp){ var mvpBadge = document.createElement("span"); mvpBadge.className = "mvp-badge"; mvpBadge.textContent = "🏆 MVP"; pname.appendChild(mvpBadge); }
if(isChevre){ var chevreBadge = document.createElement("span"); chevreBadge.className = "chevre-badge"; chevreBadge.textContent = "🐐 Chèvre"; pname.appendChild(chevreBadge); }
if(j.renfort){ var rB = document.createElement("span"); rB.className = "badge-renfort"; rB.textContent = "Renfort"; pname.appendChild(rB); }
pinfo.appendChild(pname);
var pmeta = document.createElement("div"); pmeta.className = "pmeta"; pmeta.textContent = (j.poste || "Demi-Centre") + " • " + (j.entrainements || 0) + " tr";
pinfo.appendChild(pmeta);
if(j.note){ var pnote = document.createElement("div"); pnote.className = "pnote-sub"; pnote.textContent = "Note : " + j.note; pinfo.appendChild(pnote); }
pleft.appendChild(pinfo); card.appendChild(pleft);
var ptags = document.createElement("div"); ptags.className = "ptags";
if(j.dispo1B){ var t1 = document.createElement("span"); t1.className = "tag tag-1b"; t1.textContent = CLUB_CONFIG.nomEquipe1 || "Éq 1"; ptags.appendChild(t1); }
if(j.dispo1C && nbEq >= 2){ var t2 = document.createElement("span"); t2.className = "tag tag-1c"; t2.textContent = CLUB_CONFIG.nomEquipe2 || "Éq 2"; ptags.appendChild(t2); }
if(j.dispo1D && nbEq >= 3){ var t3 = document.createElement("span"); t3.className = "tag tag-1d"; t3.textContent = CLUB_CONFIG.nomEquipe3 || "Éq 3"; ptags.appendChild(t3); }
var bEdit = document.createElement("button"); bEdit.className = "btn-mini-edit"; bEdit.textContent = "Fiche"; bEdit.title = "Modifier la photo ou note";
bEdit.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); };
ptags.appendChild(bEdit); card.appendChild(ptags);
return card;
}
function forcerActualisationWhatsApp(){
var stC = document.getElementById("statutChargement");
if(stC) stC.innerHTML = "<span class='spinner-badge'></span>Lecture WhatsApp...";
var stT = document.getElementById("statutTrain");
if(stT) stT.innerHTML = "<span class='spinner-badge'></span>Lecture WhatsApp...";
afficherLoading("Actualisation WhatsApp...", "Lecture des votes du sondage et synchronisation...");
google.script.run.withSuccessHandler(function(res){
google.script.run.withSuccessHandler(function(data){
appliquerDonneesRecues(data, true);
afficherToast("Synchronisation WhatsApp effectuée avec succès !", "succes");
}).withFailureHandler(function(err){
masquerLoading();
afficherToast("Erreur lors de la synchronisation : " + err.message, "erreur");
}).getDonneesCoach();
}).withFailureHandler(function(err){
masquerLoading();
if(stC) stC.textContent = "Erreur WhatsApp";
if(stT) stT.textContent = "Erreur WhatsApp";
afficherToast("Erreur WhatsApp : " + err.message, "erreur");
}).declencherLectureVotes();
}
function choisirMode(isTinder){
MODE_TINDER = !!isTinder;
document.body.classList.toggle("tinder-mode-active", MODE_TINDER);
var classic = document.getElementById("classicView");
var tinder = document.getElementById("tinderView");
var footer = document.getElementById("appFooter");
if(classic){ classic.style.display = MODE_TINDER ? "none" : "grid"; if(!MODE_TINDER){ classic.classList.remove("view-animate-in"); void classic.offsetWidth; classic.classList.add("view-animate-in"); } }
if(tinder){ tinder.style.display = MODE_TINDER ? "block" : "none"; if(MODE_TINDER){ tinder.classList.remove("view-animate-in"); void tinder.offsetWidth; tinder.classList.add("view-animate-in"); } }
if(footer) footer.style.display = MODE_TINDER ? "none" : "flex";
var tabC = document.getElementById("tabClassicMode");
var tabT = document.getElementById("tabTinderMode");
if(tabC) tabC.className = "view-mode-tab" + (MODE_TINDER ? "" : " active");
if(tabT) tabT.className = "view-mode-tab" + (MODE_TINDER ? " active" : "");
var btnSwitch = document.getElementById("btnSwitchMode");
if(btnSwitch) btnSwitch.textContent = MODE_TINDER ? "Mode Tactique" : "Mode Tinder";
if(MODE_TINDER) afficherCarteTinder();
}
function basculerMode(){ choisirMode(!MODE_TINDER); }
function afficherCarteTinder(){
var cont = document.getElementById("tinderContainer"); cont.innerHTML = "";
var pool = document.getElementById("zonePool");
if(!pool || pool.children.length === 0){
cont.innerHTML = "<div style='padding:60px 20px;color:#a3a3a3;font-size:1.1rem;'>Tous les joueurs ont été répartis !<br><br><small>Basculez en mode tactique pour affiner ou sauvegarder.</small></div>";
majCompteurs(); return;
}
var premier = pool.children[0];
var nom = premier.getAttribute("data-nom");
var j = JOUEURS.find(function(x){ return x.nom === nom; }) || { nom: nom, poste: "Demi-Centre", entrainements: 0 };
var topCard = creerCarteTinderHtml(j, true);
cont.appendChild(topCard);
if(pool.children.length > 1){
var nom2 = pool.children[1].getAttribute("data-nom");
var j2 = JOUEURS.find(function(x){ return x.nom === nom2; }) || { nom: nom2, poste: "Demi-Centre", entrainements: 0 };
var nextCard = creerCarteTinderHtml(j2, false); nextCard.classList.add("tcard-next");
cont.appendChild(nextCard);
}
attacherGestesTinder(topCard); majCompteurs();
}
function creerCarteTinderHtml(j, isTop){
var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;
var eq1 = ((CLUB_CONFIG && CLUB_CONFIG.nomEquipe1) || "ÉQUIPE 1").toUpperCase();
var eq2 = ((CLUB_CONFIG && CLUB_CONFIG.nomEquipe2) || "ÉQUIPE 2").toUpperCase();
var eq3 = ((CLUB_CONFIG && CLUB_CONFIG.nomEquipe3) || "ÉQUIPE 3").toUpperCase();
var card = document.createElement("div"); card.className = "tcard" + (isTop ? " tcard-top" : "");
card.setAttribute("data-nom", j.nom);
var tInit = (j.nom || "").trim().charAt(0).toUpperCase();
var av = document.createElement("div"); av.className = "tavatar"; av.textContent = tInit; av.style.cursor = "pointer"; av.title = "Fiche de " + j.nom; av.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); };
if(j.photo){ var bg = document.createElement("img"); bg.className = "tbg-photo"; bg.src = j.photo; bg.onerror = function(){ this.remove(); if(av) av.style.display = "flex"; }; card.appendChild(bg); }
var ov = document.createElement("div"); ov.className = "tbg-overlay"; card.appendChild(ov);
function addStamp(clsPos, clsCol, txt){ var s = document.createElement("div"); s.className = "stamp " + clsPos + " " + clsCol; s.textContent = txt; card.appendChild(s); }
if(nbEq === 1){
addStamp("stamp-left", "stamp-out", "REPOS");
addStamp("stamp-right", "stamp-1b", eq1);
} else if(nbEq === 2){
addStamp("stamp-left", "stamp-1b", eq1);
addStamp("stamp-right", "stamp-1c", eq2);
addStamp("stamp-down", "stamp-out", "REPOS");
} else {
addStamp("stamp-up", "stamp-1b", eq1);
addStamp("stamp-left", "stamp-1c", eq2);
addStamp("stamp-right", "stamp-1d", eq3);
addStamp("stamp-down", "stamp-out", "REPOS");
}
var bEd = document.createElement("button"); bEd.className = "tbtn-edit-card"; bEd.textContent = "Fiche";
bEd.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); }; card.appendChild(bEd);
var tc = document.createElement("div"); tc.className = "tcontent";
if(!j.photo){ tc.appendChild(av); }
else { av.style.display = "none"; tc.appendChild(av); var sp = document.createElement("div"); sp.style.height = "20px"; tc.appendChild(sp); }
var bot = document.createElement("div"); bot.style.width = "100%"; bot.style.display = "flex"; bot.style.flexDirection = "column"; bot.style.alignItems = "center"; bot.style.gap = "6px";
var nomEl = document.createElement("div"); nomEl.style.fontSize = "1.5rem"; nomEl.style.fontWeight = "900"; nomEl.textContent = j.nom; bot.appendChild(nomEl);
var postEl = document.createElement("div"); postEl.style.fontSize = "0.95rem"; postEl.style.color = "var(--color-secondary)"; postEl.style.fontWeight = "700"; postEl.textContent = j.poste || "Demi-Centre"; bot.appendChild(postEl);
var tags = document.createElement("div"); tags.style.display = "flex"; tags.style.gap = "6px"; tags.style.margin = "4px 0";
var sp1 = document.createElement("span"); sp1.className = j.dispo1B ? "tag tag-1b" : "tag"; sp1.textContent = (CLUB_CONFIG.nomEquipe1 || "Éq 1") + " " + (j.dispo1B ? "✓" : "✗"); tags.appendChild(sp1);
if(nbEq >= 2){ var sp2 = document.createElement("span"); sp2.className = j.dispo1C ? "tag tag-1c" : "tag"; sp2.textContent = (CLUB_CONFIG.nomEquipe2 || "Éq 2") + " " + (j.dispo1C ? "✓" : "✗"); tags.appendChild(sp2); }
if(nbEq >= 3){ var sp3 = document.createElement("span"); sp3.className = j.dispo1D ? "tag tag-1d" : "tag"; sp3.textContent = (CLUB_CONFIG.nomEquipe3 || "Éq 3") + " " + (j.dispo1D ? "✓" : "✗"); tags.appendChild(sp3); }
bot.appendChild(tags);
if(j.note){ var nt = document.createElement("div"); nt.className = "tnote-box"; nt.textContent = "Note : " + j.note; bot.appendChild(nt); }
tc.appendChild(bot); card.appendChild(tc);
return card;
}
function attacherGestesTinder(card){
var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;
var startX = 0, startY = 0, currentX = 0, currentY = 0, isDragging = false;
var s1B = card.querySelector(".stamp-1b"), s1C = card.querySelector(".stamp-1c"), s1D = card.querySelector(".stamp-1d"), sOut = card.querySelector(".stamp-out");
function resetStamps(){ if(s1B) s1B.style.opacity = 0; if(s1C) s1C.style.opacity = 0; if(s1D) s1D.style.opacity = 0; if(sOut) sOut.style.opacity = 0; }
function onStart(e){ isDragging = true; startX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX; startY = e.type.includes("mouse") ? e.clientY : e.touches[0].clientY; card.classList.remove("tcard-spring"); }
function onMove(e){
if(!isDragging) return;
var clientX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX;
var clientY = e.type.includes("mouse") ? e.clientY : e.touches[0].clientY;
currentX = clientX - startX; currentY = clientY - startY;
var rot = currentX * 0.08;
card.style.transform = "translate3d(" + currentX + "px," + currentY + "px,0) rotate(" + rot + "deg)";
resetStamps();
if(nbEq === 1){
if(currentX < -20 && sOut) sOut.style.opacity = Math.min(1, Math.abs(currentX) / 95);
else if(currentX > 20 && s1B) s1B.style.opacity = Math.min(1, currentX / 95);
} else if(nbEq === 2){
if(currentY > 40 && Math.abs(currentY) > Math.abs(currentX)){ if(sOut) sOut.style.opacity = Math.min(1, currentY / 95); }
else if(currentX < -20 && s1B){ s1B.style.opacity = Math.min(1, Math.abs(currentX) / 95); }
else if(currentX > 20 && s1C){ s1C.style.opacity = Math.min(1, currentX / 95); }
} else {
if(currentY < -30 && Math.abs(currentY) > Math.abs(currentX)){ if(s1B) s1B.style.opacity = Math.min(1, Math.abs(currentY) / 95); }
else if(currentY > 30 && Math.abs(currentY) > Math.abs(currentX)){ if(sOut) sOut.style.opacity = Math.min(1, currentY / 95); }
else if(currentX < -20 && s1C){ s1C.style.opacity = Math.min(1, Math.abs(currentX) / 95); }
else if(currentX > 20 && s1D){ s1D.style.opacity = Math.min(1, currentX / 95); }
}
}
function onEnd(){
if(!isDragging) return; isDragging = false;
var dest = null;
if(nbEq === 1){
if(currentX < -90) dest = "OUT";
else if(currentX > 90) dest = "1B";
} else if(nbEq === 2){
if(currentY > 90 && Math.abs(currentY) > Math.abs(currentX)) dest = "OUT";
else if(currentX < -90 && Math.abs(currentX) > Math.abs(currentY)) dest = "1B";
else if(currentX > 90 && Math.abs(currentX) > Math.abs(currentY)) dest = "1C";
} else {
if(currentY < -90 && Math.abs(currentY) > Math.abs(currentX)) dest = "1B";
else if(currentY > 90 && Math.abs(currentY) > Math.abs(currentX)) dest = "OUT";
else if(currentX < -90 && Math.abs(currentX) > Math.abs(currentY)) dest = "1C";
else if(currentX > 90 && Math.abs(currentX) > Math.abs(currentY)) dest = "1D";
}
if(dest) ejecterCarte(card, dest);
else { card.classList.add("tcard-spring"); card.style.transform = "translate3d(0px,0px,0) rotate(0deg)"; resetStamps(); }
}
card.addEventListener("mousedown", onStart); window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onEnd);
card.addEventListener("touchstart", onStart, { passive: true }); window.addEventListener("touchmove", onMove, { passive: true }); window.addEventListener("touchend", onEnd);
}
function swiperVers(choix){
if(ANIM_EN_COURS) return;
var topCard = document.querySelector("#tinderContainer .tcard-top");
if(!topCard) return;
var s = topCard.querySelector(".stamp-" + choix.toLowerCase());
if(s) s.style.opacity = 1;
ejecterCarte(topCard, choix);
}
function ejecterCarte(card, choix){
ANIM_EN_COURS = true; card.classList.add("tcard-fly");
var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;
if(nbEq === 1){
if(choix === "OUT") card.style.transform = "translate3d(-460px, 20px, 0) rotate(-28deg)";
else if(choix === "1B") card.style.transform = "translate3d(460px, 20px, 0) rotate(28deg)";
} else if(nbEq === 2){
if(choix === "1B") card.style.transform = "translate3d(-460px, 20px, 0) rotate(-28deg)";
else if(choix === "1C") card.style.transform = "translate3d(460px, 20px, 0) rotate(28deg)";
else if(choix === "OUT") card.style.transform = "translate3d(0, 460px, 0) rotate(6deg)";
} else {
if(choix === "1B") card.style.transform = "translate3d(0, -460px, 0) rotate(6deg)";
else if(choix === "1C") card.style.transform = "translate3d(-460px, 20px, 0) rotate(-28deg)";
else if(choix === "1D") card.style.transform = "translate3d(460px, 20px, 0) rotate(28deg)";
else if(choix === "OUT") card.style.transform = "translate3d(0, 460px, 0) rotate(6deg)";
}
setTimeout(function(){
var nom = card.getAttribute("data-nom");
var pool = document.getElementById("zonePool");
var el = Array.from(pool.children).find(function(c){ return c.getAttribute("data-nom") === nom; });
if(el){
HISTORIQUE_SWIPE.push({ element: el, nom: nom, choix: choix });
if(choix === "1B") document.getElementById("zone1B").appendChild(el);
else if(choix === "1C" && document.getElementById("zone1C")) document.getElementById("zone1C").appendChild(el);
else if(choix === "1D" && document.getElementById("zone1D")) document.getElementById("zone1D").appendChild(el);
else if(choix === "OUT"){
var zR = document.getElementById("zoneRepos");
if(zR) zR.appendChild(el); else pool.removeChild(el);
} else pool.removeChild(el);
if(choix === "1B" || choix === "1C" || choix === "1D"){ verifierChouchouSelectionne(nom); if(estJoueurMvp(nom)) declencherAnimationMvp(nom); if(estJoueurChevre(nom)) declencherAnimationChevre(nom); }
}
ANIM_EN_COURS = false;
majCompteurs();
sauvegarderBrouillonLocal(false);
afficherCarteTinder();
}, 240);
}
function annulerDernierSwipe(){
if(!HISTORIQUE_SWIPE.length) return;
var dernier = HISTORIQUE_SWIPE.pop();
var pool = document.getElementById("zonePool");
if(dernier.element && dernier.element.parentNode){
dernier.element.parentNode.removeChild(dernier.element);
}
pool.insertBefore(dernier.element, pool.firstChild);
majCompteurs();
sauvegarderBrouillonLocal(false);
afficherCarteTinder();
}
function recommencerSelection(){
document.getElementById("zone1B").innerHTML = "";
if(document.getElementById("zone1C")) document.getElementById("zone1C").innerHTML = "";
if(document.getElementById("zone1D")) document.getElementById("zone1D").innerHTML = "";
if(document.getElementById("zoneRepos")) document.getElementById("zoneRepos").innerHTML = "";
var pool = document.getElementById("zonePool"); pool.innerHTML = "";
JOUEURS.forEach(function(j){ pool.appendChild(creerCarte(j)); });
HISTORIQUE_SWIPE = [];
majCompteurs();
sauvegarderBrouillonLocal(false);
if(MODE_TINDER) afficherCarteTinder();
}
function extraireListeNoms(zoneId){ var el = document.getElementById(zoneId); return el ? Array.from(el.children).map(function(c){ return c.getAttribute("data-nom"); }) : []; }
function sauvegarderBrouillonLocal(explicite){
var draft = {
date: new Date().toISOString(),
equipe1B: extraireListeNoms("zone1B"),
equipe1C: document.getElementById("zone1C") ? extraireListeNoms("zone1C") : [],
equipe1D: document.getElementById("zone1D") ? extraireListeNoms("zone1D") : [],
repos: document.getElementById("zoneRepos") ? extraireListeNoms("zoneRepos") : []
};
try { localStorage.setItem("hb_draft_compo", JSON.stringify(draft)); } catch(e){}
if(explicite){
var stC = document.getElementById("statutChargement");
if(stC) stC.innerHTML = "<span class='spinner-badge'></span>Brouillon...";
google.script.run.withSuccessHandler(function(){
if(stC) stC.textContent = "Brouillon sauvegardé !";
afficherToast("Brouillon sauvegardé !", "succes");
var ban = document.getElementById("banniereBrouillon"); if(ban) ban.style.display = "none";
setTimeout(function(){ if(stC && JOUEURS) stC.textContent = JOUEURS.length + " disponible(s)"; }, 2000);
}).withFailureHandler(function(err){
if(stC) stC.textContent = "Erreur brouillon";
afficherToast("Erreur brouillon : " + err.message, "erreur");
}).enregistrerBrouillonCompo(draft);
}
}
function verifierBrouillonExistant(){
try {
var raw = localStorage.getItem("hb_draft_compo"); if(!raw) return;
var d = JSON.parse(raw);
var totalAffectes = (d.equipe1B ? d.equipe1B.length : 0) + (d.equipe1C ? d.equipe1C.length : 0) + (d.equipe1D ? d.equipe1D.length : 0) + (d.repos ? d.repos.length : 0);
var ban = document.getElementById("banniereBrouillon");
var txt = document.getElementById("txtBanniereBrouillon");
if(totalAffectes > 0 && ban && txt){
var nCourant = extraireListeNoms("zone1B").length + extraireListeNoms("zone1C").length + extraireListeNoms("zone1D").length + extraireListeNoms("zoneRepos").length;
if(nCourant === 0){
txt.textContent = "Un brouillon a été retrouvé (" + totalAffectes + " joueur(s) affecté(s)).";
ban.style.display = "flex";
}
}
} catch(e){}
}
function restaurerBrouillon(){
try {
var raw = localStorage.getItem("hb_draft_compo"); if(!raw) return;
var d = JSON.parse(raw);
appliquerRepartitionsCompo(d);
var ban = document.getElementById("banniereBrouillon"); if(ban) ban.style.display = "none";
document.getElementById("statutChargement").textContent = "Brouillon restauré !";
} catch(e){
afficherToast("Impossible de restaurer le brouillon : " + e.message, "erreur");
}
}
function effacerBrouillon(){
try { localStorage.removeItem("hb_draft_compo"); } catch(e){}
var ban = document.getElementById("banniereBrouillon"); if(ban) ban.style.display = "none";
}
function rechargerCompoPrecedente(){
if(!DERNIERE_COMPO){ afficherToast("Aucune composition précédente enregistrée.", "info"); return; }
var dateStr = DERNIERE_COMPO.date ? (" du " + DERNIERE_COMPO.date) : "";
if(!confirm("Recharger la composition précédente" + dateStr + " ?")) return;
afficherLoading("Rechargement...", "Restauration de la composition précédente...");
setTimeout(function(){
appliquerRepartitionsCompo(DERNIERE_COMPO);
masquerLoading();
document.getElementById("statutChargement").textContent = "Compo précédente rechargée !";
afficherToast("Composition précédente rechargée avec succès !", "succes");
}, 200);
}
function appliquerRepartitionsCompo(source){
if(!source) return;
var z1B = document.getElementById("zone1B"), z1C = document.getElementById("zone1C"), z1D = document.getElementById("zone1D"), zRepos = document.getElementById("zoneRepos"), pool = document.getElementById("zonePool");
z1B.innerHTML = ""; if(z1C) z1C.innerHTML = ""; if(z1D) z1D.innerHTML = ""; if(zRepos) zRepos.innerHTML = ""; pool.innerHTML = "";
var mapCartes = {};
JOUEURS.forEach(function(j){ mapCartes[j.nom] = creerCarte(j); });
var list1B = source.equipe1B || [], list1C = source.equipe1C || [], list1D = source.equipe1D || [], listRepos = source.repos || [];
list1B.forEach(function(nom){ if(mapCartes[nom]){ z1B.appendChild(mapCartes[nom]); delete mapCartes[nom]; } });
if(z1C){ list1C.forEach(function(nom){ if(mapCartes[nom]){ z1C.appendChild(mapCartes[nom]); delete mapCartes[nom]; } }); }
if(z1D){ list1D.forEach(function(nom){ if(mapCartes[nom]){ z1D.appendChild(mapCartes[nom]); delete mapCartes[nom]; } }); }
if(zRepos){ listRepos.forEach(function(nom){ if(mapCartes[nom]){ zRepos.appendChild(mapCartes[nom]); delete mapCartes[nom]; } }); }
Object.keys(mapCartes).forEach(function(nom){ pool.appendChild(mapCartes[nom]); });
majCompteurs();
sauvegarderBrouillonLocal(false);
if(MODE_TINDER) afficherCarteTinder();
}
function classifierPosteHandball(p){
var str = String(p || "").toLowerCase().replace(/[^a-z]/g, "");
if(str.indexOf("gard") !== -1 || str === "gb") return "GB";
if(str.indexOf("piv") !== -1 || str === "pvt") return "PVT";
if((str.indexOf("ail") !== -1 && str.indexOf("g") !== -1) || str === "alg") return "ALG";
if((str.indexOf("ail") !== -1 && str.indexOf("d") !== -1) || str === "ald") return "ALD";
if((str.indexOf("arr") !== -1 && str.indexOf("g") !== -1) || str === "arg") return "ARG";
if((str.indexOf("arr") !== -1 && str.indexOf("d") !== -1) || str === "ard") return "ARD";
if(str.indexOf("demi") !== -1 || str === "dc" || str.indexOf("centre") !== -1) return "DC";
return "DC";
}
function initialiserTactiquePourEquipe(eqKey, listeNoms){
if(!COMPOSITIONS_TACTIQUES[eqKey]) COMPOSITIONS_TACTIQUES[eqKey] = {};
var compoT = COMPOSITIONS_TACTIQUES[eqKey];
var dispoObjs = listeNoms.map(function(nom){
return EFFECTIF_COMPLET.find(function(x){ return x.nom === nom; }) || JOUEURS.find(function(x){ return x.nom === nom; }) || { nom: nom, poste: "Demi-Centre" };
});
var assignes = {}, prisNoms = {};
POSITIONS_HANDBALL.forEach(function(pos){
var nomEx = compoT[pos.code];
if(nomEx && listeNoms.indexOf(nomEx) !== -1){ assignes[pos.code] = nomEx; prisNoms[nomEx] = true; }
});
POSITIONS_HANDBALL.forEach(function(pos){
if(!assignes[pos.code]){
var cand = dispoObjs.find(function(j){ return !prisNoms[j.nom] && classifierPosteHandball(j.poste) === pos.code; });
if(cand){ assignes[pos.code] = cand.nom; prisNoms[cand.nom] = true; }
}
});
POSITIONS_HANDBALL.forEach(function(pos){
if(!assignes[pos.code]){
var cand = dispoObjs.find(function(j){ return !prisNoms[j.nom]; });
if(cand){ assignes[pos.code] = cand.nom; prisNoms[cand.nom] = true; }
}
});
COMPOSITIONS_TACTIQUES[eqKey] = assignes;
}
function rendreTabsTactique(){
var c = document.getElementById("tacticalTeamTabs"); if(!c) return; c.innerHTML = "";
var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;
var eqDefs = [{ key: "1B", label: CLUB_CONFIG.nomEquipe1 || "Équipe 1" }];
if(nbEq >= 2) eqDefs.push({ key: "1C", label: CLUB_CONFIG.nomEquipe2 || "Équipe 2" });
if(nbEq >= 3) eqDefs.push({ key: "1D", label: CLUB_CONFIG.nomEquipe3 || "Équipe 3" });
eqDefs.forEach(function(eq){
var tab = document.createElement("button"); tab.type = "button";
tab.className = "tactical-team-tab" + (eq.key === EQUIPE_TACTIQUE_COURANTE ? " active" : "");
tab.textContent = eq.label;
tab.onclick = function(){ EQUIPE_TACTIQUE_COURANTE = eq.key; rendreTabsTactique(); afficherApercuTactique(eq.key); };
c.appendChild(tab);
});
}
var TACTICAL_DRAGGED = null;
var TACTICAL_SELECTED = null;
function mettreAJourHintTactique(eqKey){
var hintEl = document.getElementById("tacticalSwapHint"); if(!hintEl) return;
if(TACTICAL_SELECTED){
var label = TACTICAL_SELECTED.nom || TACTICAL_SELECTED.posCode;
hintEl.innerHTML = "<span style='color:#38bdf8;font-weight:800;'>👉 " + label + " sélectionné — touchez/cliquez sur un autre poste ou remplaçant pour échanger (ou re-cliquez pour annuler).</span>";
} else {
hintEl.innerHTML = "<span style='color:#94a3b8;font-weight:500;'>Astuce : Glissez-déposez ou cliquez sur deux joueurs pour échanger leurs postes.</span>";
}
}
function surlignerSelectionTactique(){
document.querySelectorAll(".court-player-chip").forEach(function(el){ el.classList.remove("tactical-selected"); });
document.querySelectorAll(".bench-chip").forEach(function(el){ el.classList.remove("tactical-selected"); });
if(!TACTICAL_SELECTED) return;
if(TACTICAL_SELECTED.source === "court"){
var node = document.querySelector('.court-node[data-pos="' + TACTICAL_SELECTED.posCode + '"] .court-player-chip');
if(node) node.classList.add("tactical-selected");
} else if(TACTICAL_SELECTED.source === "bench"){
document.querySelectorAll(".bench-chip").forEach(function(b){
if(b.getAttribute("data-nom") === TACTICAL_SELECTED.nom) b.classList.add("tactical-selected");
});
}
}
function executerPermutationTactique(eqKey, itemA, itemB){
if(!COMPOSITIONS_TACTIQUES[eqKey]) COMPOSITIONS_TACTIQUES[eqKey] = {};
var compoT = COMPOSITIONS_TACTIQUES[eqKey];
if(itemA.source === "court" && itemB.source === "court"){
var pA = compoT[itemA.posCode]; var pB = compoT[itemB.posCode];
compoT[itemA.posCode] = pB; compoT[itemB.posCode] = pA;
afficherToast("Permuté : " + (pA || itemA.posCode) + " ⇄ " + (pB || itemB.posCode), "succes", 1800);
} else if(itemA.source === "court" && itemB.source === "bench"){
var oldC = compoT[itemA.posCode]; compoT[itemA.posCode] = itemB.nom;
afficherToast(itemB.nom + " placé en " + itemA.posCode + (oldC ? " (remplace " + oldC + ")" : ""), "succes", 1800);
} else if(itemA.source === "bench" && itemB.source === "court"){
var oldC = compoT[itemB.posCode]; compoT[itemB.posCode] = itemA.nom;
afficherToast(itemA.nom + " placé en " + itemB.posCode + (oldC ? " (remplace " + oldC + ")" : ""), "succes", 1800);
} else if(itemA.source === "bench" && itemB.source === "bench"){
return;
}
if(itemA && itemA.nom){ verifierChouchouSelectionne(itemA.nom); if(estJoueurMvp(itemA.nom)) declencherAnimationMvp(itemA.nom); if(estJoueurChevre(itemA.nom)) declencherAnimationChevre(itemA.nom); }
if(itemB && itemB.nom){ verifierChouchouSelectionne(itemB.nom); if(estJoueurMvp(itemB.nom)) declencherAnimationMvp(itemB.nom); if(estJoueurChevre(itemB.nom)) declencherAnimationChevre(itemB.nom); }
TACTICAL_SELECTED = null;
afficherApercuTactique(eqKey);
}
function gererClicTactique(eqKey, item){
if(item && item.nom){ verifierChouchouSelectionne(item.nom); if(estJoueurMvp(item.nom)) declencherAnimationMvp(item.nom); if(estJoueurChevre(item.nom)) declencherAnimationChevre(item.nom); }
if(!TACTICAL_SELECTED){
TACTICAL_SELECTED = item;
mettreAJourHintTactique(eqKey);
surlignerSelectionTactique();
} else {
var meme = false;
if(TACTICAL_SELECTED.source === item.source){
if(item.source === "court" && TACTICAL_SELECTED.posCode === item.posCode) meme = true;
if(item.source === "bench" && TACTICAL_SELECTED.nom === item.nom) meme = true;
}
if(meme){
TACTICAL_SELECTED = null;
mettreAJourHintTactique(eqKey);
surlignerSelectionTactique();
} else {
var premier = TACTICAL_SELECTED;
TACTICAL_SELECTED = null;
executerPermutationTactique(eqKey, premier, item);
}
}
}
function afficherApercuTactique(eqKey){
var zoneId = "zone" + eqKey; var listeNoms = extraireListeNoms(zoneId);
if(!listeNoms || listeNoms.length === 0){
if(CONTEXTE_APERCU && CONTEXTE_APERCU.compo && Array.isArray(CONTEXTE_APERCU.compo["equipe" + eqKey]) && CONTEXTE_APERCU.compo["equipe" + eqKey].length > 0){
listeNoms = CONTEXTE_APERCU.compo["equipe" + eqKey];
} else if(DERNIERE_COMPO && Array.isArray(DERNIERE_COMPO["equipe" + eqKey]) && DERNIERE_COMPO["equipe" + eqKey].length > 0){
listeNoms = DERNIERE_COMPO["equipe" + eqKey];
}
}
if(!listeNoms) listeNoms = [];
initialiserTactiquePourEquipe(eqKey, listeNoms);
var compoT = COMPOSITIONS_TACTIQUES[eqKey] || {};
var nodesCont = document.getElementById("tacticalCourtNodes");
mettreAJourHintTactique(eqKey);
if(nodesCont){
nodesCont.innerHTML = "";
POSITIONS_HANDBALL.forEach(function(pos){
var nomJ = compoT[pos.code];
var jObj = nomJ ? (EFFECTIF_COMPLET.find(function(x){ return x.nom === nomJ; }) || { nom: nomJ }) : null;
var node = document.createElement("div"); node.className = "court-node";
node.style.left = pos.x + "%"; node.style.top = pos.y + "%"; node.setAttribute("data-pos", pos.code);
var chip = document.createElement("div"); chip.className = "court-player-chip" + (jObj ? " filled" : " empty");
chip.title = pos.label + " : " + (jObj ? jObj.nom : "Poste vacant");
chip.draggable = true;
chip.ondragstart = function(e){ TACTICAL_DRAGGED = { source: "court", posCode: pos.code, nom: nomJ, eqKey: eqKey }; chip.classList.add("tactical-dragging"); e.dataTransfer.setData("text/plain", pos.code); };
chip.ondragend = function(e){ chip.classList.remove("tactical-dragging"); TACTICAL_DRAGGED = null; };
node.ondragover = function(e){ e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
node.ondragenter = function(e){ e.preventDefault(); node.classList.add("tactical-drop-hover"); };
node.ondragleave = function(e){ node.classList.remove("tactical-drop-hover"); };
node.ondrop = function(e){
e.preventDefault(); node.classList.remove("tactical-drop-hover");
if(!TACTICAL_DRAGGED) return;
var d = TACTICAL_DRAGGED; TACTICAL_DRAGGED = null;
if(d.source === "court" && d.posCode === pos.code) return;
executerPermutationTactique(eqKey, d, { source: "court", posCode: pos.code, nom: nomJ });
};
var av = document.createElement("div"); av.className = "court-player-avatar";
if(jObj && estJoueurChouchou(jObj.nom)){ av.classList.add("is-chouchou"); }
var initLtr = jObj ? (jObj.nom || "").trim().charAt(0).toUpperCase() : "-";
if(jObj && jObj.photo){
var img = document.createElement("img"); img.src = jObj.photo; img.alt = jObj.nom;
img.onerror = function(){ this.remove(); av.textContent = initLtr; };
av.appendChild(img);
} else {
av.textContent = initLtr;
}
if(jObj && jObj.nom){ av.style.cursor = "pointer"; av.title = "Fiche de " + jObj.nom; av.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(jObj.nom); }; }
chip.appendChild(av);
var lbl = document.createElement("div"); lbl.className = "court-pos-label"; lbl.textContent = pos.code; chip.appendChild(lbl);
var nameEl = document.createElement("div"); nameEl.className = "court-player-name"; nameEl.textContent = jObj ? jObj.nom : pos.label; chip.appendChild(nameEl);
chip.onclick = function(e){ e.stopPropagation(); gererClicTactique(eqKey, { source: "court", posCode: pos.code, nom: nomJ }); };
node.appendChild(chip); nodesCont.appendChild(node);
});
}
var benchCont = document.getElementById("tacticalBenchList");
var benchWrap = document.querySelector(".tactical-bench-wrap");
if(benchWrap){
benchWrap.ondragover = function(e){ e.preventDefault(); };
benchWrap.ondrop = function(e){
e.preventDefault();
if(!TACTICAL_DRAGGED || TACTICAL_DRAGGED.source !== "court") return;
var d = TACTICAL_DRAGGED; TACTICAL_DRAGGED = null;
var courtNom = compoT[d.posCode]; delete compoT[d.posCode];
afficherToast(courtNom + " envoyé sur le banc.", "info", 1800);
afficherApercuTactique(eqKey);
};
}
if(benchCont){
benchCont.innerHTML = "";
var surTerrainNoms = Object.values(compoT);
var remps = listeNoms.filter(function(n){ return surTerrainNoms.indexOf(n) === -1; });
if(remps.length === 0){ benchCont.innerHTML = "<span style='font-size:0.75rem;color:#64748b;font-style:italic;'>Aucun remplaçant (tous sur le terrain).</span>"; }
else {
remps.forEach(function(nom){
var jObj = EFFECTIF_COMPLET.find(function(x){ return x.nom === nom; }) || { nom: nom, poste: "Demi-Centre" };
var bChip = document.createElement("span"); bChip.className = "bench-chip";
bChip.setAttribute("data-nom", nom);
bChip.draggable = true;
bChip.ondragstart = function(e){ TACTICAL_DRAGGED = { source: "bench", nom: nom, eqKey: eqKey }; bChip.classList.add("tactical-dragging"); e.dataTransfer.setData("text/plain", nom); };
bChip.ondragend = function(e){ bChip.classList.remove("tactical-dragging"); TACTICAL_DRAGGED = null; };
bChip.ondragover = function(e){ e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
bChip.ondragenter = function(e){ e.preventDefault(); bChip.classList.add("tactical-drop-hover"); };
bChip.ondragleave = function(e){ bChip.classList.remove("tactical-drop-hover"); };
bChip.ondrop = function(e){
e.preventDefault(); e.stopPropagation(); bChip.classList.remove("tactical-drop-hover");
if(!TACTICAL_DRAGGED) return;
var d = TACTICAL_DRAGGED; TACTICAL_DRAGGED = null;
if(d.source === "bench" && d.nom === nom) return;
executerPermutationTactique(eqKey, d, { source: "bench", nom: nom });
};
var chouMark = (jObj && estJoueurChouchou(jObj.nom)) ? "❤️ " : "";
bChip.textContent = chouMark + jObj.nom + " (" + (jObj.poste || "Demi-Centre") + ")";
bChip.title = "Glissez ou cliquez pour placer " + jObj.nom + " sur le terrain";
bChip.onclick = function(e){ e.stopPropagation(); gererClicTactique(eqKey, { source: "bench", nom: jObj.nom }); };
benchCont.appendChild(bChip);
});
}
}
surlignerSelectionTactique();
}
function ajusterAffichageNombreSeances(){
  var sel = document.getElementById("cfgNbSeancesTrain");
  var nb = sel ? parseInt(sel.value, 10) : 3;
  if(isNaN(nb) || nb < 1) nb = 1;
  if(nb > 5) nb = 5;
  for(var i = 1; i <= 5; i++){
    var box = document.getElementById("boxCfgTrain" + i);
    if(box) box.style.display = (i <= nb) ? "block" : "none";
  }
}
function ouvrirModalConfigEntrainements(){
  var nb = (SEANCES_TRAIN && SEANCES_TRAIN.length) ? SEANCES_TRAIN.length : 3;
  if(nb < 1) nb = 1;
  if(nb > 5) nb = 5;
  var sel = document.getElementById("cfgNbSeancesTrain");
  if(sel) sel.value = String(nb);
  var defJours = ["Lundi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  var defHoraires = ["20h30", "20h30", "20h30", "20h00", "10h00"];
  for(var i = 1; i <= 5; i++){
    var s = (SEANCES_TRAIN && SEANCES_TRAIN[i - 1]) ? SEANCES_TRAIN[i - 1] : null;
    var jInp = document.getElementById("cfgTrJour" + i);
    var hInp = document.getElementById("cfgTrHoraire" + i);
    var aInp = document.getElementById("cfgTrActif" + i);
    var jVal = s ? (s.jour || defJours[i - 1]) : defJours[i - 1];
    if(jInp) {
      var found = false;
      for(var oi = 0; oi < jInp.options.length; oi++){
        if(jInp.options[oi].value.toLowerCase() === String(jVal || "").trim().toLowerCase()){
          jInp.selectedIndex = oi;
          found = true;
          break;
        }
      }
      if(!found && jVal) {
        var opt = document.createElement("option");
        opt.value = jVal;
        opt.textContent = jVal;
        opt.selected = true;
        jInp.appendChild(opt);
      }
    }
    if(hInp) hInp.value = s ? (s.horaire || defHoraires[i - 1]) : defHoraires[i - 1];
    if(aInp) aInp.checked = s ? (s.actif !== false) : (i <= 2);
    var aAbsInp = document.getElementById("cfgTrActifAbs" + i);
    if(aAbsInp) aAbsInp.checked = s ? (s.actifAbsent !== false) : true;
  }
  ajusterAffichageNombreSeances();
  document.getElementById("statusConfigEntrainements").textContent = "";
  document.getElementById("modalConfigEntrainementsBg").style.display = "flex";
}
function fermerModalConfigEntrainements(){ document.getElementById("modalConfigEntrainementsBg").style.display = "none"; }
function fermerModalConfigEntrainementsSurBg(e){ if(e.target.id === "modalConfigEntrainementsBg") fermerModalConfigEntrainements(); }
function sauvegarderConfigEntrainements(){
  var sel = document.getElementById("cfgNbSeancesTrain");
  var nb = sel ? parseInt(sel.value, 10) : 3;
  if(isNaN(nb) || nb < 1) nb = 1;
  if(nb > 5) nb = 5;
  var creneaux = [];
  var mapJourId = {
    "lundi": "lun", "mardi": "mar", "mercredi": "mer",
    "jeudi": "jeu", "vendredi": "ven", "samedi": "sam", "dimanche": "dim"
  };
  for(var i = 1; i <= nb; i++){
    var jVal = (document.getElementById("cfgTrJour" + i) && document.getElementById("cfgTrJour" + i).value.trim()) || ("Séance " + i);
    var hVal = (document.getElementById("cfgTrHoraire" + i) && document.getElementById("cfgTrHoraire" + i).value.trim()) || "20h30";
    var aVal = document.getElementById("cfgTrActif" + i) ? document.getElementById("cfgTrActif" + i).checked : true;
    var aAbsVal = document.getElementById("cfgTrActifAbs" + i) ? document.getElementById("cfgTrActifAbs" + i).checked : true;
    var baseId = mapJourId[jVal.toLowerCase()] || ("s" + i);
    var idVal = baseId;
    if(creneaux.some(function(c){ return c.id === idVal; })){
      idVal = baseId + "_" + i;
    }
    var labelVal = "Entraînement " + jVal + " " + hVal;
    var labelAbsVal = "Absent " + jVal;
    creneaux.push({ id: idVal, jour: jVal, horaire: hVal, label: labelVal, labelAbsent: labelAbsVal, actif: aVal, actifAbsent: aAbsVal });
  }
  document.getElementById("statusConfigEntrainements").innerHTML = "<span class='spinner-badge'></span>Enregistrement des " + nb + " séances...";
  var bSavTr = document.getElementById("btnSaveConfigTrain");
  if(bSavTr){ bSavTr.disabled = true; bSavTr.innerHTML = "<span class='spinner-inline'></span>Enregistrement..."; }
  afficherLoading("Enregistrement du planning...", "Sauvegarde des créneaux d'entraînement...");
  google.script.run.withSuccessHandler(function(res){
    masquerLoading();
    if(bSavTr){ bSavTr.disabled = false; bSavTr.textContent = "Enregistrer les horaires"; }
    document.getElementById("statusConfigEntrainements").textContent = "Horaires enregistrés avec succès !";
    SEANCES_TRAIN = creneaux;
    majLibellesOngletsTrain();
    majVueEntrainement();
    if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });
    setTimeout(function(){ fermerModalConfigEntrainements(); }, 800);
  }).withFailureHandler(function(err){
    masquerLoading();
    if(bSavTr){ bSavTr.disabled = false; bSavTr.textContent = "Enregistrer les horaires"; }
    document.getElementById("statusConfigEntrainements").textContent = "Erreur : " + err.message;
  }).enregistrerConfigEntrainements(SESSION_TEL, SESSION_PIN, creneaux, nb);
}
function rendreOngletsTrain(){
  var cont = document.getElementById("trainTabsContainer");
  if(!cont) return;
  cont.innerHTML = "";
  SEANCES_TRAIN = (SEANCES_TRAIN || []).filter(function(s){ return s && s.actif !== false && s.actif !== "NON" && !/match|poule|coupe|championnat/i.test(s.label || ""); });
  if(!SEANCES_TRAIN.length){
    SEANCES_TRAIN = [
      { id: "lun", jour: "Lundi", horaire: "20h30", label: "Lundi 20h30", actif: true },
      { id: "mer", jour: "Mercredi", horaire: "20h30", label: "Mercredi 20h30", actif: true }
    ];
  }
  var activeExists = SEANCES_TRAIN.some(function(s){ return s.id === SEANCE_COURANTE; });
  if(!activeExists && SEANCES_TRAIN.length > 0){
    SEANCE_COURANTE = SEANCES_TRAIN[0].id;
  }
  SEANCES_TRAIN.forEach(function(s, idx){
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab-btn" + (s.id === SEANCE_COURANTE ? " tab-active" : "");
    btn.id = "tab_" + s.id;
    btn.textContent = (s.jour || ("Séance " + (idx + 1))) + (s.horaire ? (" " + s.horaire) : "");
    btn.onclick = function(){ changerSeance(s.id); };
    cont.appendChild(btn);
  });
}
function majLibellesOngletsTrain(){
  if(!SEANCES_TRAIN || !SEANCES_TRAIN.length) return;
  SEANCES_TRAIN.forEach(function(s, idx){
    if(!TRAIN_CONFIG[s.id]){
      TRAIN_CONFIG[s.id] = { label: s.label || (s.jour + " " + (s.horaire || "")), type: (idx === 0 ? "separe" : (idx === 1 ? "complet" : "reduit")), max: 20 };
    } else {
      TRAIN_CONFIG[s.id].label = s.label || (s.jour + " " + (s.horaire || ""));
    }
  });
  rendreOngletsTrain();
}
function creerMessageMatch(compo){
var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;
var lignes = ["*LISTE POUR CE WEEK-END*", ""];
var raw1B = (document.getElementById("sub1B") && document.getElementById("sub1B").textContent) || ("Match " + (CLUB_CONFIG.nomEquipe1 || "Équipe 1"));
var titre1B = raw1B.replace(/^Dispo\s+match/i, "Match");
var l1B = (compo.equipe1B && compo.equipe1B.length) ? compo.equipe1B.map(function(n){ return "- " + formaterNomPourMessage(n); }).join("\n") : "Aucun joueur sélectionné";
lignes.push(" *" + titre1B + "* :"); lignes.push(l1B);
if(nbEq >= 2){
var raw1C = (document.getElementById("sub1C") && document.getElementById("sub1C").textContent) || ("Match " + (CLUB_CONFIG.nomEquipe2 || "Équipe 2"));
var titre1C = raw1C.replace(/^Dispo\s+match/i, "Match");
var l1C = (compo.equipe1C && compo.equipe1C.length) ? compo.equipe1C.map(function(n){ return "- " + formaterNomPourMessage(n); }).join("\n") : "Aucun joueur sélectionné";
lignes.push(""); lignes.push(" *" + titre1C + "* :"); lignes.push(l1C);
}
if(nbEq >= 3){
var raw1D = (document.getElementById("sub1D") && document.getElementById("sub1D").textContent) || ("Match " + (CLUB_CONFIG.nomEquipe3 || "Équipe 3"));
var titre1D = raw1D.replace(/^Dispo\s+match/i, "Match");
var l1D = (compo.equipe1D && compo.equipe1D.length) ? compo.equipe1D.map(function(n){ return "- " + formaterNomPourMessage(n); }).join("\n") : "Aucun joueur sélectionné";
lignes.push(""); lignes.push(" *" + titre1D + "* :"); lignes.push(l1D);
}
return lignes.join("\n");
}
function sauvegarder(envoyerWhatsApp){
var compo = {
equipe1B: extraireListeNoms("zone1B"),
equipe1C: document.getElementById("zone1C") ? extraireListeNoms("zone1C") : [],
equipe1D: document.getElementById("zone1D") ? extraireListeNoms("zone1D") : [],
repos: document.getElementById("zoneRepos") ? extraireListeNoms("zoneRepos") : [],
nonRetenus: extraireListeNoms("zonePool")
};
var stC = document.getElementById("statutChargement");
if(stC) stC.innerHTML = "<span class='spinner-badge'></span>Sauvegarde...";
afficherLoading("Enregistrement de la composition...", envoyerWhatsApp ? "Sauvegarde et publication sur WhatsApp..." : "Sauvegarde sur Google Sheets...");
var msg = creerMessageMatch(compo);
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(stC) stC.textContent = "Sauvegardé (" + res.date + ")";
afficherToast(envoyerWhatsApp ? "Composition sauvegardée et diffusée sur WhatsApp !" : "Composition sauvegardée avec succès !", "succes");
if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });
}).withFailureHandler(function(err){
masquerLoading();
if(stC) stC.textContent = "Erreur sauvegarde";
afficherToast("Erreur sauvegarde : " + err.message, "erreur");
}).enregistrerCompoEtPublier(compo, envoyerWhatsApp, msg);
}
function ouvrirApercuMatch(){
var compo = {
equipe1B: extraireListeNoms("zone1B"),
equipe1C: document.getElementById("zone1C") ? extraireListeNoms("zone1C") : [],
equipe1D: document.getElementById("zone1D") ? extraireListeNoms("zone1D") : [],
repos: document.getElementById("zoneRepos") ? extraireListeNoms("zoneRepos") : [],
nonRetenus: extraireListeNoms("zonePool")
};
if(compo.equipe1B.length === 0 && compo.equipe1C.length === 0 && compo.equipe1D.length === 0 && DERNIERE_COMPO){
compo.equipe1B = DERNIERE_COMPO.equipe1B || [];
compo.equipe1C = DERNIERE_COMPO.equipe1C || [];
compo.equipe1D = DERNIERE_COMPO.equipe1D || [];
compo.repos = DERNIERE_COMPO.repos || [];
compo.nonRetenus = DERNIERE_COMPO.nonRetenus || [];
}
CONTEXTE_APERCU = { type: "match", compo: compo };
document.getElementById("previewTitle").textContent = "Aperçu Convocations & Terrain";
var bWaBlock = document.getElementById("previewWhatsAppBlock");
var bPlBottom = document.getElementById("previewPlayerBottomActions");
if(bWaBlock) bWaBlock.style.display = EST_COACH ? "block" : "none";
if(bPlBottom) bPlBottom.style.display = EST_COACH ? "none" : "flex";
var bSav = document.getElementById("btnSavePreview");
if(bSav) bSav.style.display = EST_COACH ? "inline-block" : "none";
var eqCible = "1B";
if(SESSION_NOM){
var sNom = String(SESSION_NOM).toLowerCase().trim();
if(compo.equipe1C && compo.equipe1C.some(function(n){ return String(n).toLowerCase().trim() === sNom; })) eqCible = "1C";
else if(compo.equipe1D && compo.equipe1D.some(function(n){ return String(n).toLowerCase().trim() === sNom; })) eqCible = "1D";
}
EQUIPE_TACTIQUE_COURANTE = eqCible;
var tWrap = document.getElementById("tacticalPreviewWrap");
if(tWrap){
tWrap.style.display = "block";
rendreTabsTactique();
afficherApercuTactique(eqCible);
}
var div = document.getElementById("previewMessages"); div.innerHTML = "";
var txt = document.createElement("textarea"); txt.className = "preview-text"; txt.id = "txtPreviewMatch"; txt.value = creerMessageMatch(compo); div.appendChild(txt);
basculerVue("previewView");
}
function sauvegarderApercuDepuisTerrain(){
if(!CONTEXTE_APERCU) return;
var btnSave = document.getElementById("btnSavePreview");
if(btnSave){ btnSave.disabled = true; btnSave.innerHTML = "<span class='spinner-inline'></span>Enregistrement..."; }
document.getElementById("previewStatus").textContent = "Enregistrement de la composition...";
afficherLoading("Enregistrement...", "Sauvegarde sur Google Sheets...");
if(CONTEXTE_APERCU.type === "match"){
var txt = document.getElementById("txtPreviewMatch") ? document.getElementById("txtPreviewMatch").value : "";
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(btnSave){ btnSave.disabled = false; btnSave.textContent = "💾 Sauvegarder la composition"; }
document.getElementById("previewStatus").textContent = "Composition sauvegardée avec succès !";
afficherToast("Composition sauvegardée avec succès !", "succes");
if(typeof confetti === "function") confetti({ particleCount: 60, spread: 50 });
}).withFailureHandler(function(err){
masquerLoading();
if(btnSave){ btnSave.disabled = false; btnSave.textContent = "💾 Sauvegarder la composition"; }
document.getElementById("previewStatus").textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
}).enregistrerCompoEtPublier(CONTEXTE_APERCU.compo, false, txt);
} else {
var txtTr = document.getElementById("txtPreviewTrain") ? document.getElementById("txtPreviewTrain").value : "";
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(btnSave){ btnSave.disabled = false; btnSave.textContent = "💾 Sauvegarder l'entraînement"; }
document.getElementById("previewStatus").textContent = "Entraînement sauvegardé avec succès !";
afficherToast("Entraînement sauvegardé avec succès !", "succes");
}).withFailureHandler(function(err){
masquerLoading();
if(btnSave){ btnSave.disabled = false; btnSave.textContent = "💾 Sauvegarder l'entraînement"; }
document.getElementById("previewStatus").textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
}).enregistrerEntrainementEtPublier(CONTEXTE_APERCU.donnees.seance, CONTEXTE_APERCU.donnees.typeSeance, CONTEXTE_APERCU.donnees.groupes, CONTEXTE_APERCU.donnees.nonRetenus, false, txtTr);
}
}
function publierApercu(){
if(!CONTEXTE_APERCU) return;
var btnPub = document.getElementById("btnPublishPreview");
if(btnPub){ btnPub.disabled = true; btnPub.innerHTML = "<span class='spinner-inline'></span>Publication..."; }
document.getElementById("previewStatus").textContent = "Publication en cours sur WhatsApp...";
afficherLoading("Publication WhatsApp...", "Diffusion du message sur le groupe...");
if(CONTEXTE_APERCU.type === "match"){
var txt = document.getElementById("txtPreviewMatch").value;
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(btnPub){ btnPub.disabled = false; btnPub.textContent = "Publier sur WhatsApp"; }
document.getElementById("previewStatus").textContent = "Publié avec succès (" + res.date + ") !";
if(typeof confetti === "function") confetti({ particleCount: 90, spread: 70 });
setTimeout(function(){ retourApercu(); }, 1800);
}).withFailureHandler(function(err){
masquerLoading();
if(btnPub){ btnPub.disabled = false; btnPub.textContent = "Publier sur WhatsApp"; }
document.getElementById("previewStatus").textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
}).enregistrerCompoEtPublier(CONTEXTE_APERCU.compo, true, txt);
} else {
var txtTr = document.getElementById("txtPreviewTrain").value;
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(btnPub){ btnPub.disabled = false; btnPub.textContent = "Publier sur WhatsApp"; }
document.getElementById("previewStatus").textContent = "Entraînement publié avec succès !";
if(typeof confetti === "function") confetti({ particleCount: 90, spread: 70 });
setTimeout(function(){ retourApercu(); }, 1800);
}).withFailureHandler(function(err){
masquerLoading();
if(btnPub){ btnPub.disabled = false; btnPub.textContent = "Publier sur WhatsApp"; }
document.getElementById("previewStatus").textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
}).enregistrerEntrainementEtPublier(CONTEXTE_APERCU.donnees.seance, CONTEXTE_APERCU.donnees.typeSeance, CONTEXTE_APERCU.donnees.groupes, CONTEXTE_APERCU.donnees.nonRetenus, true, txtTr);
}
}
function retourApercu(){ basculerVue(EST_COACH ? VUE_PRECEDENTE_APERCU : "homeView"); }
function basculerVue(nomVue){
if(nomVue !== "previewView") VUE_PRECEDENTE_APERCU = nomVue;
["homeView","appView","trainView","rosterView","previewView"].forEach(function(v){
var el = document.getElementById(v); if(!el) return;
var estActif = (v === nomVue);
el.style.display = estActif ? (v === "homeView" ? "flex" : "block") : "none";
if(estActif){ el.classList.remove("view-animate-in"); void el.offsetWidth; el.classList.add("view-animate-in"); }
});
document.body.classList.toggle("tinder-mode-active", nomVue === "appView" && !!window.MODE_TINDER);
document.body.classList.toggle("train-tinder-mode-active", nomVue === "trainView" && !!window.TRAIN_MODE_TINDER);
}
function estAppareilMobile(){
  try {
    return (window.innerWidth < 768) || (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  } catch(e){ return (window.innerWidth < 768); }
}
function gererClicDashCompo(e){ entrer(); }
function gererClicDashTrain(e){ entrerEntrainement(); }
function majAffichageModesParDefaut(){
  var mobile = estAppareilMobile();
  var bCompo = document.getElementById("badgeModeDefautCompo");
  var bTrain = document.getElementById("badgeModeDefautTrain");
  var btnCClassic = document.getElementById("btnEnterClassic");
  var btnCTinder = document.getElementById("btnEnterTinder");
  var btnTrClassic = document.getElementById("btnEnterTr");
  var btnTrTinder = document.getElementById("btnEnterTrTinder");
  if(bCompo) bCompo.textContent = mobile ? "📱 Tinder par défaut" : "💻 Tactique par défaut";
  if(bTrain) bTrain.textContent = mobile ? "📱 Tinder par défaut" : "💻 Tactique par défaut";
  if(btnCTinder && btnCClassic){
    if(mobile){
      btnCTinder.style.border = "1.5px solid #ec4899"; btnCTinder.style.boxShadow = "0 0 10px rgba(236,72,153,0.35)"; btnCTinder.style.fontWeight = "800";
      btnCClassic.style.border = ""; btnCClassic.style.boxShadow = ""; btnCClassic.style.fontWeight = "600";
    } else {
      btnCClassic.style.border = "1.5px solid #0284c7"; btnCClassic.style.boxShadow = "0 0 10px rgba(2,132,199,0.35)"; btnCClassic.style.fontWeight = "800";
      btnCTinder.style.border = ""; btnCTinder.style.boxShadow = ""; btnCTinder.style.fontWeight = "600";
    }
  }
  if(btnTrTinder && btnTrClassic){
    if(mobile){
      btnTrTinder.style.border = "1.5px solid #ec4899"; btnTrTinder.style.boxShadow = "0 0 10px rgba(236,72,153,0.35)"; btnTrTinder.style.fontWeight = "800";
      btnTrClassic.style.border = ""; btnTrClassic.style.boxShadow = ""; btnTrClassic.style.fontWeight = "600";
    } else {
      btnTrClassic.style.border = "1.5px solid #0284c7"; btnTrClassic.style.boxShadow = "0 0 10px rgba(2,132,199,0.35)"; btnTrClassic.style.fontWeight = "800";
      btnTrTinder.style.border = ""; btnTrTinder.style.boxShadow = ""; btnTrTinder.style.fontWeight = "600";
    }
  }
}
function retourAccueil(){ basculerVue("homeView"); }
function entrer(demarrerEnTinder){
  basculerVue("appView");
  var tinder = (demarrerEnTinder !== undefined && demarrerEnTinder !== null) ? !!demarrerEnTinder : estAppareilMobile();
  choisirMode(tinder);
}
function entrerEntrainement(demarrerEnTinder){
rendreOngletsTrain();
majVueEntrainement();
basculerVue("trainView");
var tinder = (demarrerEnTinder !== undefined && demarrerEnTinder !== null) ? !!demarrerEnTinder : estAppareilMobile();
choisirModeTrain(tinder);
}
function entrerEffectif(){ basculerVue("rosterView"); }
var UPDATE_INFO = null;
function verifierMiseAJourAutomatique(){
google.script.run.withSuccessHandler(function(res){
if(res && res.disponible){
UPDATE_INFO = res;
var b = document.getElementById("updateBannerBox"); if(b) b.style.display = "block";
var badge = document.getElementById("updateBadgeVer"); if(badge) badge.textContent = "v" + res.versionDistante;
var title = document.getElementById("updateBannerTitle"); if(title && res.titre) title.textContent = res.titre;
}
}).verifierMiseAJour();
}
function verifierMiseAJourManuelle(){
var btn = document.getElementById("btnCheckUpdateCoach");
if(btn) btn.textContent = "Vérification en cours...";
google.script.run.withSuccessHandler(function(res){
if(btn) btn.textContent = "Vérifier les mises à jour";
if(res && res.disponible){
UPDATE_INFO = res;
ouvrirModalMiseAJour();
} else {
afficherToast("Votre Handball Bot est parfaitement à jour (Version v" + (res ? res.versionActuelle : APP_VERSION) + ") !", "succes");
}
}).withFailureHandler(function(err){
if(btn) btn.textContent = "Vérifier les mises à jour";
afficherToast("Impossible de vérifier les mises à jour : " + err.message, "erreur");
}).verifierMiseAJour(true);
}
function ouvrirModalMiseAJour(){
if(!UPDATE_INFO) return;
var titleEl = document.getElementById("modalUpdateTitle"); if(titleEl) titleEl.textContent = (UPDATE_INFO.titre || "Mise à jour disponible") + " (v" + UPDATE_INFO.versionDistante + ")";
var metaEl = document.getElementById("modalUpdateMeta"); if(metaEl) metaEl.textContent = "Version actuelle : v" + UPDATE_INFO.versionActuelle + (UPDATE_INFO.date ? " • Publiée le " + UPDATE_INFO.date : "");
var ul = document.getElementById("modalUpdateChangelog");
if(ul){
ul.innerHTML = "";
(UPDATE_INFO.changelog || []).forEach(function(item){
var li = document.createElement("li"); li.textContent = item; ul.appendChild(li);
});
}
document.getElementById("modalMiseAJourBg").style.display = "flex";
}
function fermerModalMiseAJour(){ document.getElementById("modalMiseAJourBg").style.display = "none"; }
function fermerModalMiseAJourSurBg(e){ if(e.target.id === "modalMiseAJourBg") fermerModalMiseAJour(); }
function masquerBanniereUpdate(){ var b = document.getElementById("updateBannerBox"); if(b) b.style.display = "none"; }
function copierLienCodeGs(){
var url = (UPDATE_INFO && UPDATE_INFO.codeGsUrl) ? UPDATE_INFO.codeGsUrl : "https://raw.githubusercontent.com/" + UPSTREAM_TEMPLATE_REPO + "/main/code.gs";
if(navigator.clipboard && navigator.clipboard.writeText){
navigator.clipboard.writeText(url).then(function(){
var b = document.getElementById("btnCopierCodeGs");
if(b){ b.textContent = "Lien copié dans le presse-papier !"; setTimeout(function(){ b.textContent = "Copier le lien du code.gs mis à jour"; }, 2500); }
});
} else {
window.open(url, "_blank");
}
}
function ouvrirRepoGithub(){
var repo = String((CLUB_CONFIG && CLUB_CONFIG.githubRepo) || "").replace(/^https?:\/\/github\.com\//i, "").replace(/^\/+|\/+$/g, "").trim();
var url = (repo && repo.indexOf("/") !== -1) ? ("https://github.com/" + repo + "/actions") : ((UPDATE_INFO && UPDATE_INFO.repoUrl) ? UPDATE_INFO.repoUrl : "https://github.com");
window.open(url, "_blank");
}
function seConnecter(silencieux){
var tel = document.getElementById("inpTel").value, pin = document.getElementById("inpPin").value;
if(!silencieux){
  document.getElementById("loginError").textContent = "Connexion en cours...";
  var btnLogin = document.getElementById("btnLogin");
  if(btnLogin) {
    btnLogin.disabled = true;
    btnLogin.textContent = "Vérification...";
  }
  afficherLoading("Connexion...", "Vérification de vos identifiants...");
  setTimeout(function(){
    if(btnLogin) { btnLogin.disabled = false; btnLogin.textContent = "Se connecter"; }
    masquerLoading();
  }, 4500);
}
google.script.run.withSuccessHandler(function(res){
if(!silencieux) document.getElementById("btnLogin").disabled = false;
SESSION_TEL = res.telephone; SESSION_PIN = res.pin; SESSION_NOM = res.nom; EST_COACH = !!res.estCoach; EST_TRESORIER = !!res.estTresorier;
document.body.classList.add("user-logged-in");
document.getElementById("loginBox").style.display = "none";
document.getElementById("playerBox").style.display = "flex";
majEspaceJoueur(res.nom);
if(EST_COACH || EST_TRESORIER){
document.getElementById("coachMenuBox").style.display = "block";
} else {
document.getElementById("coachMenuBox").style.display = "none";
}
if(EST_COACH){
var bLogo = document.getElementById("btnEditClubLogoBadge"); if(bLogo) bLogo.style.display = "flex";
verifierMiseAJourAutomatique();
majAffichageModesParDefaut();
}
try {
localStorage.setItem("hb_tel", tel);
localStorage.setItem("hb_pin", pin);
localStorage.setItem("hb_session", JSON.stringify({ telephone: res.telephone, pin: res.pin, nom: res.nom, estCoach: !!res.estCoach, estTresorier: !!res.estTresorier }));
} catch(e){}
if(res.donnees){
appliquerDonneesRecues(res.donnees, false);
masquerLoading();
} else {
google.script.run.withSuccessHandler(function(data){ appliquerDonneesRecues(data, false); }).withFailureHandler(function(err){ masquerLoading(); afficherToast("Erreur de synchronisation : " + err.message, "erreur"); }).getDonneesCoach();
}
}).withFailureHandler(function(err){
masquerLoading();
document.getElementById("btnLogin").disabled = false;
document.getElementById("loginError").textContent = err.message;
}).authentifierUtilisateur(tel, pin, true);
}
function seDeconnecter(){
try { localStorage.removeItem("hb_pin"); localStorage.removeItem("hb_session"); localStorage.removeItem("hb_cache_data"); } catch(e){}
SESSION_TEL = ""; SESSION_PIN = ""; SESSION_NOM = ""; EST_COACH = false; EST_TRESORIER = false;
document.body.classList.remove("user-logged-in");
var bLogo = document.getElementById("btnEditClubLogoBadge"); if(bLogo) bLogo.style.display = "none";
document.getElementById("coachMenuBox").style.display = "none";
document.getElementById("playerBox").style.display = "none";
document.getElementById("loginBox").style.display = "flex";
document.getElementById("inpPin").value = "";
retourAccueil();
}
function changerMonPoste(){
var np = document.getElementById("selPosteJoueur").value;
afficherLoading("Mise à jour du poste...", "Enregistrement de votre position préférée...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
document.getElementById("playerPostePreview").textContent = res.poste;
afficherToast("Poste mis à jour : " + res.poste, "succes");
majEspaceJoueur(SESSION_NOM);
}).withFailureHandler(function(err){
masquerLoading();
afficherToast("Erreur poste : " + err.message, "erreur");
}).enregistrerMonPoste(SESSION_TEL, SESSION_PIN, np);
}
function chargerFichierPhoto(e){
var f = e.target.files[0]; if(!f) return;
var r = new FileReader();
r.onload = function(evt){
var b64 = evt.target.result;
document.getElementById("photoStatus").innerHTML = "<span class='spinner-badge'></span>Envoi photo...";
afficherLoading("Photo de profil...", "Téléversement et enregistrement de votre photo...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
document.getElementById("photoStatus").textContent = "Photo enregistrée !";
var photoBusted = res.photo ? ajouterCacheBusterPhoto(res.photo) : "";
actualiserPhotoDansMemoire(SESSION_NOM, photoBusted);
majEspaceJoueur(SESSION_NOM);
rendreRosterGrid();
initialiserColonnes();
afficherToast("Photo de profil mise à jour !", "succes");
var b = document.getElementById("photoSelectBox");
if(b) b.style.display = "none";
}).withFailureHandler(function(err){
masquerLoading();
document.getElementById("photoStatus").textContent = "Erreur : " + err.message;
afficherToast("Erreur photo : " + err.message, "erreur");
}).enregistrerMaPhoto(SESSION_TEL, SESSION_PIN, b64);
};
r.readAsDataURL(f);
}
function togglePhotoSelect(){
var b = document.getElementById("photoSelectBox");
if(!b) return;
var ouv = (b.style.display === "none" || !b.style.display);
b.style.display = ouv ? "block" : "none";
if(ouv){
var pBox = document.getElementById("posteSelectBox");
if(pBox) pBox.style.display = "none";
var pObj = (EFFECTIF_COMPLET || []).find(function(x){ return x.nom.toLowerCase() === (SESSION_NOM || "").toLowerCase(); });
var inp = document.getElementById("inpPhotoUrlJoueur");
if(inp && pObj && pObj.photo && pObj.photo.indexOf("http") === 0) inp.value = pObj.photo;
}
}
function enregistrerPhotoUrlJoueur(){
var inp = document.getElementById("inpPhotoUrlJoueur");
if(!inp) return;
var url = inp.value.trim();
if(!url){
afficherToast("Veuillez saisir une URL valide (https://...)", "erreur");
return;
}
if(url.indexOf("http://") !== 0 && url.indexOf("https://") !== 0){
afficherToast("L'URL doit commencer par https:// ou http://", "erreur");
return;
}
document.getElementById("photoStatus").innerHTML = "<span class='spinner-badge'></span>Envoi photo...";
afficherLoading("Photo de profil...", "Enregistrement de votre photo externe...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
document.getElementById("photoStatus").textContent = "Photo enregistrée !";
var photoBusted = res.photo ? ajouterCacheBusterPhoto(res.photo) : "";
actualiserPhotoDansMemoire(SESSION_NOM, photoBusted);
majEspaceJoueur(SESSION_NOM);
rendreRosterGrid();
initialiserColonnes();
afficherToast("Photo de profil mise à jour !", "succes");
var b = document.getElementById("photoSelectBox");
if(b) b.style.display = "none";
}).withFailureHandler(function(err){
masquerLoading();
document.getElementById("photoStatus").textContent = "Erreur : " + err.message;
afficherToast("Erreur photo : " + err.message, "erreur");
}).enregistrerMaPhoto(SESSION_TEL, SESSION_PIN, url);
}
function supprimerMaPhotoJoueur(){
if(!confirm("Voulez-vous vraiment retirer votre photo de profil ?")) return;
document.getElementById("photoStatus").innerHTML = "<span class='spinner-badge'></span>Suppression...";
afficherLoading("Photo de profil...", "Suppression de votre photo...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
document.getElementById("photoStatus").textContent = "Photo supprimée.";
actualiserPhotoDansMemoire(SESSION_NOM, "");
majEspaceJoueur(SESSION_NOM);
rendreRosterGrid();
initialiserColonnes();
afficherToast("Photo de profil retirée.", "info");
var b = document.getElementById("photoSelectBox");
if(b) b.style.display = "none";
var inp = document.getElementById("inpPhotoUrlJoueur");
if(inp) inp.value = "";
}).withFailureHandler(function(err){
masquerLoading();
document.getElementById("photoStatus").textContent = "Erreur : " + err.message;
afficherToast("Erreur photo : " + err.message, "erreur");
}).enregistrerMaPhoto(SESSION_TEL, SESSION_PIN, "");
}
function togglePosteSelect(){
var b = document.getElementById("posteSelectBox");
if(!b) return;
var ouv = (b.style.display === "none" || !b.style.display);
b.style.display = ouv ? "block" : "none";
if(ouv){
var pB = document.getElementById("photoSelectBox");
if(pB) pB.style.display = "none";
}
}
function ouvrirGpsGymnase(type){
var salle = CURRENT_MATCH_SALLE || "";
if((!salle || salle === "-") && INFOS_MATCHS){
var d = INFOS_MATCHS.details1B || INFOS_MATCHS.details1C || INFOS_MATCHS.details1D;
if(d && d.salle && d.salle !== "-") salle = d.salle;
}
if((!salle || salle === "-") && CLUB_CONFIG && CLUB_CONFIG.nomClub) salle = CLUB_CONFIG.nomClub;
if(!salle || salle === "-"){ afficherToast("Aucune salle renseignée pour ce match.", "info"); return; }
var q = encodeURIComponent(salle + " Gymnase");
var url = (type === "waze") ? ("https://waze.com/ul?q=" + q) : ("https://www.google.com/maps/search/?api=1&query=" + q);
window.open(url, "_blank");
}
function ouvrirApercuCompoJoueur(){
ouvrirApercuMatch();
if(!EST_COACH){
var bWa = document.getElementById("previewWhatsAppBlock"); if(bWa) bWa.style.display = "none";
var bPl = document.getElementById("previewPlayerBottomActions"); if(bPl) bPl.style.display = "flex";
var bSav = document.getElementById("btnSavePreview"); if(bSav) bSav.style.display = "none";
var bPub = document.getElementById("btnPublishPreview"); if(bPub) bPub.style.display = "none";
var txtM = document.getElementById("txtPreviewMatch"); if(txtM) txtM.readOnly = true;
var hSwap = document.getElementById("tacticalSwapHint");
if(hSwap){
if(DERNIERE_COMPO && DERNIERE_COMPO.estActive === false){
hSwap.innerHTML = "<span style='color:#facc15;'>Mode consultation joueur : composition en préparation par le coach (composition précédente affichée).</span>";
} else {
hSwap.innerHTML = "<span style='color:#38bdf8;'>Mode consultation joueur : visualisez les postes et remplaçants du match.</span>";
}
}
}
}
function majEspaceJoueur(nom){
if(!nom) nom = SESSION_NOM;
if(!nom) return;
var nClean = String(nom).trim();
var nLow = nClean.toLowerCase();
var nSimple = nLow.replace(/\s*\([^)]*\)\s*/g, "").trim();
var pInVotes = (JOUEURS || []).find(function(x){
var xL = String(x.nom || "").trim().toLowerCase();
return xL === nLow || xL.replace(/\s*\([^)]*\)\s*/g, "").trim() === nSimple;
});
var pInEff = (EFFECTIF_COMPLET || []).find(function(x){
var xL = String(x.nom || "").trim().toLowerCase();
return xL === nLow || xL.replace(/\s*\([^)]*\)\s*/g, "").trim() === nSimple;
});
var pObj = pInEff || pInVotes || { nom: nClean, poste: "Demi-Centre", entrainements: 0 };
document.getElementById("playerNomPreview").textContent = pObj.nom;
document.getElementById("playerPostePreview").textContent = pObj.poste || "Demi-Centre";
if(document.getElementById("selPosteJoueur")) document.getElementById("selPosteJoueur").value = pObj.poste || "Demi-Centre";
var pImg = document.getElementById("playerImgPreview"), pInit = document.getElementById("playerInitialPreview");
var pLtr = (pObj.nom || "").trim().charAt(0).toUpperCase();
if(pInit) pInit.textContent = pLtr;
if(pObj.photo){
if(pImg){
pImg.src = pObj.photo;
pImg.style.display = "block";
pImg.onerror = function(){ pImg.style.display = "none"; if(pInit) pInit.style.display = "flex"; };
}
if(pInit) pInit.style.display = "none";
} else {
if(pInit) pInit.style.display = "flex";
if(pImg){ pImg.src = ""; pImg.style.display = "none"; }
}
var isChou = estJoueurChouchou(nom);
var chouBadge = document.getElementById("playerChouchouBadgeCard");
if(chouBadge) chouBadge.style.display = isChou ? "block" : "none";
var nbTr = 0;
if(pInVotes && pInVotes.entrainements !== undefined && pInVotes.entrainements !== null && Number(pInVotes.entrainements) > 0){
nbTr = Number(pInVotes.entrainements);
} else if(pInEff && pInEff.entrainements !== undefined && pInEff.entrainements !== null && Number(pInEff.entrainements) > 0){
nbTr = Number(pInEff.entrainements);
} else if(pObj && pObj.entrainements){
nbTr = Number(pObj.entrainements);
}
if(nbTr === 0 && typeof ENTRAINEMENTS === "object" && ENTRAINEMENTS){
Object.keys(ENTRAINEMENTS).forEach(function(sId){
var listS = ENTRAINEMENTS[sId] || [];
if(listS.some(function(j){
var jNom = String(j.nom || "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
return jNom === nSimple;
})){ nbTr++; }
});
}
var bTr = document.getElementById("playerAssiduiteBadge");
if(bTr) bTr.textContent = "⚡ Assiduité : " + nbTr + " séance" + (nbTr > 1 ? "s" : "");
var statutBadge = document.getElementById("matchHubStatutBadge");
var equipeBadge = document.getElementById("matchHubEquipeBadge");
var advEl = document.getElementById("matchHubAdversaire");
var detEl = document.getElementById("matchHubDetails");
var actBox = document.getElementById("matchHubActions");
var eqNomConvoque = ""; var detailsEquipe = null;
function nomDans(liste, n){
if(!liste || !Array.isArray(liste)) return false;
var t = String(n || "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
return liste.some(function(item){
var iClean = String(item || "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
return iClean === t;
});
}
function aVraiMatch(m){
if(!m) return false;
if(m.aMatch === false) return false;
var adv = String(m.adversaire || "").trim();
if(!adv || adv === "-" || /pas de match/i.test(adv) || /exempt/i.test(adv) || /aucun/i.test(adv)) return false;
var dt = String(m.dateMatch || m.date || "").trim();
if(/pas de match/i.test(dt)) return false;
return true;
}
var compoActive = Boolean(DERNIERE_COMPO && DERNIERE_COMPO.estActive !== false);
if(compoActive){
if(nomDans(DERNIERE_COMPO.equipe1B, nom)){
eqNomConvoque = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe1) || "Équipe 1";
if(INFOS_MATCHS) detailsEquipe = INFOS_MATCHS.details1B || INFOS_MATCHS.eq1;
} else if(nomDans(DERNIERE_COMPO.equipe1C, nom)){
eqNomConvoque = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe2) || "Équipe 2";
if(INFOS_MATCHS) detailsEquipe = INFOS_MATCHS.details1C || INFOS_MATCHS.eq2;
} else if(nomDans(DERNIERE_COMPO.equipe1D, nom)){
eqNomConvoque = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe3) || "Équipe 3";
if(INFOS_MATCHS) detailsEquipe = INFOS_MATCHS.details1D || INFOS_MATCHS.eq3;
} else if(nomDans(DERNIERE_COMPO.nonRetenus, nom) || nomDans(DERNIERE_COMPO.repos, nom)){
eqNomConvoque = "REPOS";
}
}
if(detailsEquipe && detailsEquipe.salle && detailsEquipe.salle !== "-"){
CURRENT_MATCH_SALLE = detailsEquipe.salle;
} else {
CURRENT_MATCH_SALLE = "";
}
if(VACANCES_DATA && VACANCES_DATA.enVacancesCetteSemaine){
var infoV = VACANCES_DATA.infoSemaine || {};
if(statutBadge){ statutBadge.textContent = "🏖️ VACANCES"; statutBadge.style.background = "rgba(14,165,233,0.25)"; statutBadge.style.color = "#7dd3fc"; }
if(equipeBadge) equipeBadge.textContent = infoV.nom || "Trêve sportive";
if(advEl) advEl.textContent = "🏖️ Pas de match cette semaine";
var txtVac = "Période de vacances : " + (infoV.nom || "Vacances") + " (du " + (infoV.debutTexte || "") + " au " + (infoV.finTexte || "") + "). Aucun entraînement ni match programmé. Bon repos !";
if(infoV.commentaire) txtVac += " • " + infoV.commentaire;
if(detEl) detEl.textContent = txtVac;
if(actBox) actBox.style.display = "none";
} else if(eqNomConvoque === "REPOS"){
if(statutBadge){ statutBadge.textContent = "🛌 AU REPOS"; statutBadge.style.background = "rgba(239,68,68,0.2)"; statutBadge.style.color = "#fca5a5"; }
if(equipeBadge) equipeBadge.textContent = "Non retenu ce week-end";
if(advEl) advEl.textContent = "Repos ce week-end";
if(detEl) detEl.textContent = "Profitez de votre week-end pour recharger les batteries ! Rendez-vous au prochain entraînement.";
if(actBox) actBox.style.display = "none";
} else if(eqNomConvoque && aVraiMatch(detailsEquipe)){
if(statutBadge){ statutBadge.textContent = "🔥 CONVOQUÉ"; statutBadge.style.background = "rgba(34,197,94,0.25)"; statutBadge.style.color = "#86efac"; }
if(equipeBadge) equipeBadge.textContent = eqNomConvoque;
if(advEl) advEl.textContent = "⚔️ Contre " + detailsEquipe.adversaire;
var detLignes = [];
if(detailsEquipe.dateMatch) detLignes.push("📅 " + detailsEquipe.dateMatch + (detailsEquipe.heureMatch ? (" à " + detailsEquipe.heureMatch) : ""));
if(detailsEquipe.salle && detailsEquipe.salle !== "-") detLignes.push("📍 Salle : " + detailsEquipe.salle);
if(detailsEquipe.heureRdv && detailsEquipe.heureRdv !== "-") detLignes.push("⏱️ Rendez-vous : " + detailsEquipe.heureRdv);
if(detEl) detEl.textContent = detLignes.length ? detLignes.join(" • ") : "Consultez les horaires et le gymnase ci-dessous.";
if(actBox) actBox.style.display = "flex";
} else if(eqNomConvoque && !aVraiMatch(detailsEquipe)){
if(statutBadge){ statutBadge.textContent = "🏖️ PAS DE MATCH"; statutBadge.style.background = "rgba(59,130,246,0.15)"; statutBadge.style.color = "#93c5fd"; }
if(equipeBadge) equipeBadge.textContent = eqNomConvoque + " • Exempt";
if(advEl) advEl.textContent = "🏖️ Pas de match officiel ce week-end";
if(detEl) detEl.textContent = "L'équipe " + eqNomConvoque + " n'a pas de match officiel programmé ce week-end (exempt ou pause de calendrier). Profitez-en pour vous reposer !";
if(actBox) actBox.style.display = "none";
} else {
var eqHab = (pObj.equipe || "").toLowerCase();
var matchAvenir = null;
var nomEqAvenir = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe1) || "Équipe 1";
if(eqHab.includes("3") || eqHab.includes("1d")){
matchAvenir = INFOS_MATCHS ? (INFOS_MATCHS.details1D || INFOS_MATCHS.eq3) : null;
nomEqAvenir = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe3) || "Équipe 3";
} else if(eqHab.includes("2") || eqHab.includes("1c")){
matchAvenir = INFOS_MATCHS ? (INFOS_MATCHS.details1C || INFOS_MATCHS.eq2) : null;
nomEqAvenir = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe2) || "Équipe 2";
} else {
matchAvenir = INFOS_MATCHS ? (INFOS_MATCHS.details1B || INFOS_MATCHS.eq1) : null;
}
if(!aVraiMatch(matchAvenir)){
if(INFOS_MATCHS && aVraiMatch(INFOS_MATCHS.details1B || INFOS_MATCHS.eq1)){
matchAvenir = INFOS_MATCHS ? (INFOS_MATCHS.details1B || INFOS_MATCHS.eq1) : null;
nomEqAvenir = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe1) || "Équipe 1";
} else if(INFOS_MATCHS && aVraiMatch(INFOS_MATCHS.details1C || INFOS_MATCHS.eq2)){
matchAvenir = INFOS_MATCHS ? (INFOS_MATCHS.details1C || INFOS_MATCHS.eq2) : null;
nomEqAvenir = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe2) || "Équipe 2";
} else if(INFOS_MATCHS && aVraiMatch(INFOS_MATCHS.details1D || INFOS_MATCHS.eq3)){
matchAvenir = INFOS_MATCHS ? (INFOS_MATCHS.details1D || INFOS_MATCHS.eq3) : null;
nomEqAvenir = (CLUB_CONFIG && CLUB_CONFIG.nomEquipe3) || "Équipe 3";
}
}
if(aVraiMatch(matchAvenir)){
if(matchAvenir.salle && matchAvenir.salle !== "-") CURRENT_MATCH_SALLE = matchAvenir.salle;
if(statutBadge){ statutBadge.textContent = "⏳ SÉLECTION EN COURS"; statutBadge.style.background = "rgba(234,179,8,0.2)"; statutBadge.style.color = "#facc15"; }
if(equipeBadge) equipeBadge.textContent = nomEqAvenir + " (Match à venir)";
if(advEl) advEl.textContent = "⚔️ Contre " + matchAvenir.adversaire;
var detLignes = [];
if(matchAvenir.dateMatch) detLignes.push("📅 " + matchAvenir.dateMatch + (matchAvenir.heureMatch ? (" à " + matchAvenir.heureMatch) : ""));
if(matchAvenir.salle && matchAvenir.salle !== "-") detLignes.push("📍 " + matchAvenir.salle);
if(matchAvenir.heureRdv && matchAvenir.heureRdv !== "-") detLignes.push("⏱️ Rendez-vous : " + matchAvenir.heureRdv);
if(detEl) detEl.textContent = (detLignes.length ? detLignes.join(" • ") + " • " : "") + "Sélection finale en cours par le coach.";
if(actBox) actBox.style.display = "flex";
} else {
if(statutBadge){ statutBadge.textContent = "🏖️ PAS DE MATCH"; statutBadge.style.background = "rgba(59,130,246,0.15)"; statutBadge.style.color = "#93c5fd"; }
if(equipeBadge) equipeBadge.textContent = nomEqAvenir + " • Pas de match";
if(advEl) advEl.textContent = "🏖️ Pas de match officiel ce week-end";
if(detEl) detEl.textContent = "Aucun match officiel programmé ce week-end pour le club (exempt ou pause de calendrier). Bon repos !";
if(actBox) actBox.style.display = "none";
}
}
var tBadgeMvp = document.getElementById("tileBadgeMvp");
var tSubMvp = document.getElementById("tileSubMvp");
if(VOTES_MVP_DATA && VOTES_MVP_DATA.podiumMvp && VOTES_MVP_DATA.podiumMvp.length > 0){
if(tBadgeMvp) tBadgeMvp.textContent = VOTES_MVP_DATA.totalVotes + " vote(s)";
if(tSubMvp) tSubMvp.textContent = "1er : " + VOTES_MVP_DATA.podiumMvp[0].nom;
} else {
if(tBadgeMvp) tBadgeMvp.textContent = "Vote ouvert";
if(tSubMvp) tSubMvp.textContent = "Élisez le joueur du match";
}
var tBadgeChv = document.getElementById("tileBadgeChevre");
var tSubChv = document.getElementById("tileSubChevre");
if(CHEVRE_DATA && CHEVRE_DATA.actions && CHEVRE_DATA.actions.length > 0){
if(tBadgeChv) tBadgeChv.textContent = CHEVRE_DATA.actions.length + " action(s)";
var topChv = CHEVRE_DATA.actions[0];
if(tSubChv) tSubChv.textContent = (topChv.voix > 0 ? "1er : " + (topChv.joueur ? topChv.joueur + " (" + topChv.voix + "v)" : topChv.voix + " voix") : "Votez pour la meilleure !");
} else {
if(tBadgeChv) tBadgeChv.textContent = "Bêtisier";
if(tSubChv) tSubChv.textContent = "Proposez vos casseroles";
}
var tBadgeCov = document.getElementById("tileBadgeCovoit");
var tSubCov = document.getElementById("tileSubCovoit");
var nbPlacesDispos = 0;
if(COVOITURAGE_DATA && COVOITURAGE_DATA.conducteurs){
COVOITURAGE_DATA.conducteurs.forEach(function(c){ nbPlacesDispos += (c.nbPlaces || 0); });
}
if(tBadgeCov) tBadgeCov.textContent = nbPlacesDispos > 0 ? (nbPlacesDispos + " place(s)") : "Trajets";
if(tSubCov) tSubCov.textContent = (COVOITURAGE_DATA && COVOITURAGE_DATA.conducteurs && COVOITURAGE_DATA.conducteurs.length > 0) ? (COVOITURAGE_DATA.conducteurs.length + " voiture(s) prête(s)") : "Proposer ou trouver 1 place";
var tBadgeAbs = document.getElementById("tileBadgeAbsence");
var tSubAbs = document.getElementById("tileSubAbsence");
var dNowAbs = new Date(); var mNowAbs = (dNowAbs.getMonth() + 1); var jNowAbs = dNowAbs.getDate();
var todayIsoAbs = dNowAbs.getFullYear() + "-" + (mNowAbs < 10 ? "0" + mNowAbs : mNowAbs) + "-" + (jNowAbs < 10 ? "0" + jNowAbs : jNowAbs);
var mesAbs = (MES_ABSENCES || []).filter(function(a){
if(String(a.nom || "").toLowerCase() !== nom.toLowerCase()) return false;
var dFin = String(a.dateFin || a.dateDebut || "").trim();
return !dFin || dFin >= todayIsoAbs;
});
if(tBadgeAbs) tBadgeAbs.textContent = mesAbs.length > 0 ? (mesAbs.length + " déclarée(s)") : "Prévenir";
if(tSubAbs) tSubAbs.textContent = mesAbs.length > 0 ? "Absence enregistrée" : "Indiquer vos indispos";
var tileCaisse = document.getElementById("playerTileCaisse");
var tBadgeCaisse = document.getElementById("tileBadgeCaisse");
var tSubCaisse = document.getElementById("tileSubCaisse");
var cfgCaisse = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) || {};
var stCaisse = cfgCaisse.statut || (cfgCaisse.active === false ? "desactivee" : (cfgCaisse.fermee ? "fermee" : "ouverte"));
var btnHeadC = document.getElementById("btnHeaderCaisseNoire");
if(btnHeadC){
btnHeadC.style.display = (stCaisse === "desactivee" && !EST_COACH && !EST_TRESORIER) ? "none" : "inline-flex";
}
if(stCaisse === "desactivee"){
if(tileCaisse) tileCaisse.style.display = (EST_COACH || EST_TRESORIER) ? "flex" : "none";
if(tBadgeCaisse){
tBadgeCaisse.textContent = "⚪ Désactivée (Jeunes)";
tBadgeCaisse.style.background = "rgba(148,163,184,0.18)";
tBadgeCaisse.style.color = "#cbd5e1";
tBadgeCaisse.style.borderColor = "rgba(148,163,184,0.35)";
}
if(tSubCaisse) tSubCaisse.textContent = "Non mise en place pour cette équipe";
} else if(stCaisse === "fermee"){
if(tileCaisse) tileCaisse.style.display = "flex";
var mesAmendesImpayeesF = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.amendes) ? CAISSE_NOIRE_DATA.amendes.filter(function(a){ return String(a.nomJoueur || "").toLowerCase() === nom.toLowerCase() && a.statut === "impaye"; }) : [];
var monTotalDuF = 0;
mesAmendesImpayeesF.forEach(function(a){ monTotalDuF += (Number(a.montant) || 0); });
if(tBadgeCaisse){
if(monTotalDuF > 0){
tBadgeCaisse.textContent = "🔒 Fermée (Dû : " + monTotalDuF + " €)";
tBadgeCaisse.style.background = "rgba(239,68,68,0.25)";
tBadgeCaisse.style.color = "#fca5a5";
tBadgeCaisse.style.borderColor = "rgba(239,68,68,0.35)";
} else {
tBadgeCaisse.textContent = "🔒 Caisse Fermée";
tBadgeCaisse.style.background = "rgba(245,158,11,0.25)";
tBadgeCaisse.style.color = "#fde68a";
tBadgeCaisse.style.borderColor = "rgba(245,158,11,0.4)";
}
}
if(tSubCaisse){
var soldeCF = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats) ? CAISSE_NOIRE_DATA.stats.soldeCaisse : 0;
tSubCaisse.textContent = "Caisse clôturée par le coach • Solde : " + soldeCF + " €";
}
} else {
if(tileCaisse) tileCaisse.style.display = "flex";
var mesAmendesImpayees = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.amendes) ? CAISSE_NOIRE_DATA.amendes.filter(function(a){ return String(a.nomJoueur || "").toLowerCase() === nom.toLowerCase() && a.statut === "impaye"; }) : [];
var monTotalDu = 0;
mesAmendesImpayees.forEach(function(a){ monTotalDu += (Number(a.montant) || 0); });
if(tBadgeCaisse){
if(monTotalDu > 0){
tBadgeCaisse.textContent = "Dû : " + monTotalDu + " €";
tBadgeCaisse.style.background = "rgba(239,68,68,0.25)";
tBadgeCaisse.style.color = "#fca5a5";
tBadgeCaisse.style.borderColor = "rgba(239,68,68,0.35)";
} else {
tBadgeCaisse.textContent = "À jour 🟢";
tBadgeCaisse.style.background = "rgba(34,197,94,0.2)";
tBadgeCaisse.style.color = "#86efac";
tBadgeCaisse.style.borderColor = "rgba(34,197,94,0.35)";
}
}
if(tSubCaisse){
var soldeC = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats) ? CAISSE_NOIRE_DATA.stats.soldeCaisse : 0;
tSubCaisse.textContent = "Cagnotte : " + soldeC + " € • Barème & Palmarès";
}
}
var badgeCoachCaisse = document.getElementById("badgeCoachCaisseStats");
var descCoachCaisse = document.getElementById("dashDescCaisseNoire");
if(badgeCoachCaisse && CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats){
if(stCaisse === "desactivee"){
badgeCoachCaisse.textContent = "⚪ Non mise en place (Désactivée)";
badgeCoachCaisse.style.background = "rgba(148,163,184,0.18)";
badgeCoachCaisse.style.color = "#cbd5e1";
badgeCoachCaisse.style.borderColor = "rgba(148,163,184,0.35)";
if(descCoachCaisse) descCoachCaisse.textContent = "Désactivée (ex: équipe jeune) • Cliquez sur Administrer pour l'activer";
} else if(stCaisse === "fermee"){
badgeCoachCaisse.textContent = "🔒 Clôturée / Fermée (" + (CAISSE_NOIRE_DATA.stats.soldeCaisse || 0) + " €)";
badgeCoachCaisse.style.background = "rgba(245,158,11,0.25)";
badgeCoachCaisse.style.color = "#fde68a";
badgeCoachCaisse.style.borderColor = "rgba(245,158,11,0.4)";
if(descCoachCaisse) descCoachCaisse.textContent = "Caisse clôturée • Nouveaux signalements suspendus";
} else {
badgeCoachCaisse.textContent = (CAISSE_NOIRE_DATA.stats.soldeCaisse || 0) + " € en caisse • " + (CAISSE_NOIRE_DATA.stats.totalDu || 0) + " € impayés";
badgeCoachCaisse.style.background = "rgba(234,179,8,0.2)";
badgeCoachCaisse.style.color = "#fef08a";
badgeCoachCaisse.style.borderColor = "rgba(234,179,8,0.35)";
if(descCoachCaisse) descCoachCaisse.textContent = "Gérer les amendes, encaissements, dépenses d'équipe et barème";
}
}
}
function ouvrirModalMvp(){
remplirSelectsMvp();
rendrePodiumMvp();
var cBox = document.getElementById("coachMvpResetBox"); if(cBox) cBox.style.display = EST_COACH ? "block" : "none";
document.getElementById("modalMvpBg").style.display = "flex";
}
function fermerModalMvp(){ document.getElementById("modalMvpBg").style.display = "none"; }
function fermerModalMvpSurBg(e){ if(e.target.id === "modalMvpBg") fermerModalMvp(); }
function ouvrirModalMvpChevre(){ ouvrirModalMvp(); }
function fermerModalMvpChevre(){ fermerModalMvp(); fermerModalChevre(); }
function fermerModalMvpChevreSurBg(e){ fermerModalMvpSurBg(e); }
function remplirSelectsMvp(){
var selM = document.getElementById("selVoteMvp");
if(!selM) return;
selM.innerHTML = "<option value=''>-- Choisir le joueur du match --</option>";
var effectifTrie = (EFFECTIF_COMPLET || []).slice().sort(function(a,b){ return String(a.nom||"").localeCompare(String(b.nom||"")); });
effectifTrie.forEach(function(j){
var o = document.createElement("option"); o.value = j.nom; o.textContent = j.nom + " (" + (j.poste || "Joueur") + ")";
if(VOTES_MVP_DATA && VOTES_MVP_DATA.monVoteMvp === j.nom) o.selected = true;
selM.appendChild(o);
});
}
function enregistrerVoteMvp(){
var selM = document.getElementById("selVoteMvp");
var nomMvp = selM ? selM.value : "";
if(!nomMvp){ afficherToast("Veuillez sélectionner un joueur pour le titre de MVP.", "erreur"); return; }
var status = document.getElementById("statusVoteMvp");
var btn = document.getElementById("btnSubmitVoteMvp");
if(status) status.innerHTML = "<span class='spinner-badge'></span>Enregistrement de votre vote...";
if(btn){ btn.disabled = true; btn.innerHTML = "<span class='spinner-inline'></span>Enregistrement..."; }
afficherLoading("Vote MVP...", "Enregistrement de votre vote pour " + nomMvp + "...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(btn){ btn.disabled = false; btn.textContent = "Enregistrer mon vote MVP !"; }
if(status) status.textContent = "Vote pris en compte ! Merci pour votre participation.";
VOTES_MVP_DATA = res.votesMvp || res || VOTES_MVP_DATA;
rendrePodiumMvp();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Vote MVP enregistré avec succès !", "succes");
if(typeof confetti === "function") confetti({ particleCount: 75, spread: 65 });
declencherAnimationMvp(nomMvp);
}).withFailureHandler(function(err){
masquerLoading();
if(btn){ btn.disabled = false; btn.textContent = "Enregistrer mon vote MVP !"; }
if(status) status.textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
}).voterMvp(SESSION_TEL, SESSION_PIN, nomMvp);
}
function rendrePodiumMvp(){
var cont = document.getElementById("mvpPodiumContainer"); if(!cont) return;
var totEl = document.getElementById("mvpTotalVotesCount");
if(totEl) totEl.textContent = (VOTES_MVP_DATA.totalVotes || 0) + " vote(s)";
var podMvp = (VOTES_MVP_DATA && VOTES_MVP_DATA.podiumMvp) || [];
if(podMvp.length === 0){
cont.innerHTML = "<div style='font-size:0.8rem;color:#64748b;text-align:center;padding:18px;background:#090d16;border-radius:12px;border:1px dashed rgba(255,255,255,0.1);'>Aucun vote pour le moment.<br><span style='font-size:0.75rem;color:#94a3b8;'>Soyez le premier à élire le MVP du match !</span></div>";
return;
}
var html = "<div style='display:flex;flex-direction:column;gap:6px;'>";
var maxVoix = (podMvp[0] && (podMvp[0].voix || podMvp[0].votes)) || 1;
podMvp.forEach(function(item, idx){
var medal = idx === 0 ? "🥇" : (idx === 1 ? "🥈" : (idx === 2 ? "🥉" : "•"));
var vCount = (item.votes !== undefined && item.votes !== null) ? item.votes : ((item.voix !== undefined && item.voix !== null) ? item.voix : 0);
var isMonVote = (VOTES_MVP_DATA && VOTES_MVP_DATA.monVoteMvp === item.nom);
var pct = Math.max(8, Math.round((vCount / maxVoix) * 100));
html += "<div style='background:#090d16;border:1px solid " + (isMonVote ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)") + ";border-radius:10px;padding:8px 12px;position:relative;overflow:hidden;'>";
html += "<div style='position:absolute;left:0;top:0;bottom:0;width:" + pct + "%;background:rgba(245,158,11,0.08);pointer-events:none;'></div>";
html += "<div style='display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1;font-size:0.82rem;'>";
html += "<div style='display:flex;align-items:center;gap:8px;'><span>" + medal + "</span><span style='font-weight:700;color:#fff;'>" + item.nom + "</span>" + (isMonVote ? " <span style='font-size:0.68rem;background:rgba(245,158,11,0.2);color:#fbbf24;padding:1px 6px;border-radius:99px;font-weight:700;'>Votre vote</span>" : "") + "</div>";
html += "<span style='color:#fcd34d;font-weight:800;font-size:0.85rem;'>" + vCount + " vote(s)</span>";
html += "</div></div>";
});
html += "</div>";
cont.innerHTML = html;
}
function reinitialiserVotesMvpParCoach(){
if(!confirm("Réinitialiser tous les votes MVP pour le prochain match ?")) return;
afficherLoading("Réinitialisation...", "Remise à zéro des votes MVP...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
VOTES_MVP_DATA = { totalVotes: 0, podiumMvp: [], monVoteMvp: "" };
rendrePodiumMvp();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Votes MVP remis à zéro pour ce match.", "info");
}).withFailureHandler(function(err){
masquerLoading();
afficherToast(err.message, "erreur");
}).reinitialiserVotesMvp(SESSION_TEL, SESSION_PIN);
}
function ouvrirModalChevre(){
remplirSelectsChevre();
rendreActionsChevre();
var cBox = document.getElementById("coachChevreResetBox"); if(cBox) cBox.style.display = EST_COACH ? "block" : "none";
document.getElementById("modalChevreBg").style.display = "flex";
}
function fermerModalChevre(){ document.getElementById("modalChevreBg").style.display = "none"; }
function fermerModalChevreSurBg(e){ if(e.target.id === "modalChevreBg") fermerModalChevre(); }
function remplirSelectsChevre(){
var sel = document.getElementById("selChevreJoueurConcerne");
if(!sel) return;
sel.innerHTML = "<option value=''>-- Joueur concerné (ou laisser vide si collectif) --</option>";
var effectifTrie = (EFFECTIF_COMPLET || []).slice().sort(function(a,b){ return String(a.nom||"").localeCompare(String(b.nom||"")); });
effectifTrie.forEach(function(j){
var o = document.createElement("option"); o.value = j.nom; o.textContent = j.nom + " (" + (j.poste || "Joueur") + ")";
sel.appendChild(o);
});
}
function proposerActionChevreClient(){
var inpDesc = document.getElementById("inpChevreActionDesc");
var selJ = document.getElementById("selChevreJoueurConcerne");
var desc = inpDesc ? inpDesc.value.trim() : "";
var joueur = selJ ? selJ.value : "";
if(!desc){ afficherToast("Veuillez décrire l'action ou la casserole.", "erreur"); return; }
var btn = document.getElementById("btnSubmitActionChevre");
var status = document.getElementById("statusActionChevre");
if(status) status.innerHTML = "<span class='spinner-badge'></span>Publication en cours...";
if(btn){ btn.disabled = true; btn.innerHTML = "<span class='spinner-inline'></span>Publication..."; }
afficherLoading("Trophée Chèvre...", "Publication de la nouvelle casserole...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(btn){ btn.disabled = false; btn.textContent = "Proposer cette action au vote !"; }
if(status) status.textContent = "Action ajoutée avec succès au bêtisier !";
if(inpDesc) inpDesc.value = "";
if(selJ) selJ.value = "";
CHEVRE_DATA = res.chevreData || res || CHEVRE_DATA;
rendreActionsChevre();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Casserole ajoutée au bêtisier !", "succes");
if(joueur) declencherAnimationChevre(joueur);
}).withFailureHandler(function(err){
masquerLoading();
if(btn){ btn.disabled = false; btn.textContent = "Proposer cette action au vote !"; }
if(status) status.textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
  }).proposerActionChevre(SESSION_TEL, SESSION_PIN, desc, joueur);
}
function voterActionChevreClient(idAction){
if(!idAction) return;
afficherLoading("Vote Chèvre...", "Mise à jour de votre vote...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
CHEVRE_DATA = res.chevreData || res || CHEVRE_DATA;
rendreActionsChevre();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
var aVote = (CHEVRE_DATA.monVoteActionId === idAction);
afficherToast(aVote ? "Votre vote pour cette casserole est pris en compte !" : "Vote retiré.", "succes");
if(aVote && typeof confetti === "function") confetti({ particleCount: 50, spread: 55 });
if(aVote){ var act = (CHEVRE_DATA.actions || []).find(function(x){ return x.id === idAction; }); if(act && act.joueur) declencherAnimationChevre(act.joueur); }
}).withFailureHandler(function(err){
masquerLoading();
afficherToast(err.message, "erreur");
  }).voterActionChevre(SESSION_TEL, SESSION_PIN, idAction);
}
function supprimerActionChevreClient(idAction){
if(!idAction) return;
if(!confirm("Voulez-vous vraiment supprimer cette action du bêtisier ?")) return;
afficherLoading("Suppression...", "Suppression de l'action...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
CHEVRE_DATA = res.chevreData || res || CHEVRE_DATA;
rendreActionsChevre();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Action supprimée.", "info");
}).withFailureHandler(function(err){
masquerLoading();
afficherToast(err.message, "erreur");
  }).supprimerActionChevre(SESSION_TEL, SESSION_PIN, idAction);
}
function rendreActionsChevre(){
var cont = document.getElementById("chevreActionsListContainer"); if(!cont) return;
var badge = document.getElementById("chevreTotalCountBadge");
var nbActs = (CHEVRE_DATA && CHEVRE_DATA.actions) ? CHEVRE_DATA.actions.length : 0;
var nbVotes = (CHEVRE_DATA && CHEVRE_DATA.totalVotes) ? CHEVRE_DATA.totalVotes : 0;
if(badge) badge.textContent = nbActs + " action(s) • " + nbVotes + " vote(s)";
var acts = (CHEVRE_DATA && CHEVRE_DATA.actions) || [];
if(acts.length === 0){
cont.innerHTML = "<div style='text-align:center;padding:24px 12px;background:#090d16;border-radius:12px;border:1px dashed rgba(234,88,12,0.25);color:#94a3b8;font-size:0.8rem;line-height:1.5;'>🐐 <b>Aucune action proposée pour le moment.</b><br><span style='font-size:0.75rem;color:#64748b;'>Un tir dans les nuages ? Une passe à l'arbitre ? Remplissez le formulaire ci-dessus pour ouvrir le bal !</span></div>";
return;
}
var html = "<div style='display:flex;flex-direction:column;gap:10px;'>";
acts.forEach(function(act, idx){
var isLeader = (idx === 0 && act.voix > 0);
var isVoted = act.estMonVote || (CHEVRE_DATA.monVoteActionId === act.id);
var canDelete = EST_COACH || (act.auteurTel && normaliserTelClient(act.auteurTel) === normaliserTelClient(SESSION_TEL)) || (act.auteur && act.auteur === SESSION_NOM);
html += "<div class='chevre-action-card" + (isLeader ? " chevre-action-leader" : "") + (isVoted ? " chevre-action-voted" : "") + "'>";
html += "<div class='chevre-action-top'>";
html += "<div style='display:flex;align-items:center;gap:6px;'>";
if(isLeader) html += "<span style='font-size:0.85rem;background:rgba(234,88,12,0.3);color:#fdba74;padding:2px 8px;border-radius:99px;font-weight:900;border:1px solid rgba(234,88,12,0.4);'>👑 #1 Chèvre</span>";
if(act.joueur) html += "<span class='chevre-action-target'>🎯 " + act.joueur + "</span>";
html += "</div>";
if(canDelete) html += "<button type='button' class='btn-reset' style='color:#f87171;font-size:0.72rem;padding:2px 6px;' title='Supprimer cette action' onclick=\"supprimerActionChevreClient('" + act.id + "')\">🗑️</button>";
html += "</div>";
html += "<div class='chevre-action-desc'>« " + act.description + " »</div>";
html += "<div class='chevre-action-bottom'>";
html += "<div class='chevre-action-meta'>Proposé par " + (act.auteur || "un coéquipier") + "</div>";
html += "<button type='button' class='btn-reset " + (isVoted ? "btn-vote-chevre-active" : "btn-vote-chevre") + "' onclick=\"voterActionChevreClient('" + act.id + "')\">" + (isVoted ? "✔️ Voté (" + act.voix + "v)" : "🐐 Voter (" + act.voix + ")") + "</button>";
html += "</div>";
html += "</div>";
});
html += "</div>";
cont.innerHTML = html;
}
function normaliserTelClient(t){ return String(t||"").replace(/[^0-9]/g,""); }
function reinitialiserChevreParCoach(){
if(!confirm("Réinitialiser toutes les propositions et votes du Trophée Chèvre pour le prochain match ?")) return;
afficherLoading("Réinitialisation...", "Remise à zéro du trophée Chèvre...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
CHEVRE_DATA = { totalActions: 0, totalVotes: 0, actions: [], podiumChevre: [], monVoteActionId: "" };
rendreActionsChevre();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Trophée Chèvre remis à zéro pour ce match.", "info");
}).withFailureHandler(function(err){
masquerLoading();
afficherToast(err.message, "erreur");
  }).reinitialiserVotesChevre(SESSION_TEL, SESSION_PIN);
}
function selectionnerStatutCovoit(statut){
STATUT_COVOIT_CHOISI = statut;
var btnCond = document.getElementById("btnCovoitConduis");
var btnCher = document.getElementById("btnCovoitCherche");
var boxPl = document.getElementById("boxCovoitNbPlaces");
if(statut === "conduis"){
if(btnCond){ btnCond.style.background = "rgba(2,132,199,0.3)"; btnCond.style.borderColor = "#0284c7"; btnCond.style.color = "#fff"; }
if(btnCher){ btnCher.style.background = "transparent"; btnCher.style.borderColor = "rgba(255,255,255,0.15)"; btnCher.style.color = "#94a3b8"; }
if(boxPl) boxPl.style.display = "block";
} else {
if(btnCher){ btnCher.style.background = "rgba(2,132,199,0.3)"; btnCher.style.borderColor = "#0284c7"; btnCher.style.color = "#fff"; }
if(btnCond){ btnCond.style.background = "transparent"; btnCond.style.borderColor = "rgba(255,255,255,0.15)"; btnCond.style.color = "#94a3b8"; }
if(boxPl) boxPl.style.display = "none";
}
}
function ouvrirModalCovoiturage(){
selectionnerStatutCovoit("conduis");
rendreCovoiturageList();
var cBox = document.getElementById("coachCovoitResetBox"); if(cBox) cBox.style.display = EST_COACH ? "block" : "none";
document.getElementById("modalCovoiturageBg").style.display = "flex";
}
function fermerModalCovoiturage(){ document.getElementById("modalCovoiturageBg").style.display = "none"; }
function fermerModalCovoiturageSurBg(e){ if(e.target.id === "modalCovoiturageBg") fermerModalCovoiturage(); }
function enregistrerMonCovoiturage(){
var status = document.getElementById("statusCovoit");
var btn = document.getElementById("btnSubmitCovoit");
var nb = parseInt(document.getElementById("selCovoitNbPlaces").value, 10) || 3;
if(status) status.innerHTML = "<span class='spinner-badge'></span>Enregistrement de votre statut...";
if(btn){ btn.disabled = true; btn.innerHTML = "<span class='spinner-inline'></span>Enregistrement..."; }
afficherLoading("Covoiturage...", "Enregistrement de vos places de covoiturage...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(btn){ btn.disabled = false; btn.textContent = "Enregistrer mon statut"; }
if(status) status.textContent = "Statut enregistré !";
COVOITURAGE_DATA = res.covoiturage || COVOITURAGE_DATA;
rendreCovoiturageList();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Covoiturage mis à jour !", "succes");
}).withFailureHandler(function(err){
masquerLoading();
if(btn){ btn.disabled = false; btn.textContent = "Enregistrer mon statut"; }
if(status) status.textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
}).enregistrerCovoiturage(SESSION_TEL, SESSION_PIN, STATUT_COVOIT_CHOISI, nb, "");
}
function annulerMonCovoiturage(){
var status = document.getElementById("statusCovoit");
if(status) status.innerHTML = "<span class='spinner-badge'></span>Suppression de votre statut...";
afficherLoading("Covoiturage...", "Retrait de votre trajet...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(status) status.textContent = "Statut retiré.";
COVOITURAGE_DATA = res.covoiturage || COVOITURAGE_DATA;
rendreCovoiturageList();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Statut de covoiturage retiré.", "info");
}).withFailureHandler(function(err){
masquerLoading();
afficherToast(err.message, "erreur");
}).enregistrerCovoiturage(SESSION_TEL, SESSION_PIN, "aucun", 0, "");
}
function rendreCovoiturageList(){
var cont = document.getElementById("covoitListContainer"); if(!cont) return;
var sum = document.getElementById("covoitStatsSummary");
var conds = (COVOITURAGE_DATA && COVOITURAGE_DATA.conducteurs) || [];
var pass = (COVOITURAGE_DATA && COVOITURAGE_DATA.passagers) || [];
var totPlaces = 0;
conds.forEach(function(c){
var places = (c.nbPlaces !== undefined && c.nbPlaces !== null) ? c.nbPlaces : (c.places || 0);
totPlaces += places;
});
if(sum) sum.textContent = conds.length + " voiture(s) • " + totPlaces + " place(s) dispo";
if(conds.length === 0 && pass.length === 0){
cont.innerHTML = "<div style='font-size:0.75rem;color:#64748b;text-align:center;padding:16px;'>Aucun trajet proposé pour le moment.<br>Soyez le premier à proposer votre voiture !</div>";
return;
}
var html = "";
if(conds.length > 0){
html += "<div style='font-size:0.75rem;font-weight:700;color:#38bdf8;margin-bottom:6px;'>🚙 Conducteurs :</div>";
conds.forEach(function(c){
var pDispo = (c.nbPlaces !== undefined && c.nbPlaces !== null) ? c.nbPlaces : (c.places || 0);
html += "<div class='covoit-card'><div style='display:flex;justify-content:space-between;align-items:center;'><span style='font-weight:800;font-size:0.84rem;color:#f8fafc;'>🚘 " + c.nom + "</span><span style='font-size:0.72rem;background:rgba(2,132,199,0.25);color:#7dd3fc;padding:2px 8px;border-radius:99px;font-weight:700;'>" + pDispo + " place(s) dispo</span></div>";
if(c.passagers && c.passagers.length > 0){
html += "<div style='font-size:0.7rem;color:#94a3b8;margin-top:4px;'>Passagers à bord : " + c.passagers.join(", ") + "</div>";
}
html += "</div>";
});
}
if(pass.length > 0){
html += "<div style='font-size:0.75rem;font-weight:700;color:#fcd34d;margin:10px 0 6px 0;'>🙋 Cherchent une place :</div>";
html += "<div style='display:flex;gap:4px;flex-wrap:wrap;'>";
pass.forEach(function(p){
html += "<span style='font-size:0.72rem;background:#0e1626;border:1px solid rgba(255,255,255,0.1);padding:4px 8px;border-radius:8px;color:#e2e8f0;'>👤 " + p.nom + "</span>";
});
html += "</div>";
}
cont.innerHTML = html;
}
function reinitialiserCovoiturageParCoach(){
if(!confirm("Réinitialiser l'organisation du covoiturage pour ce match ?")) return;
afficherLoading("Réinitialisation...", "Remise à zéro du covoiturage...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
COVOITURAGE_DATA = { conducteurs: [], passagers: [] };
rendreCovoiturageList();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Covoiturage réinitialisé.", "info");
}).withFailureHandler(function(err){
masquerLoading();
afficherToast(err.message, "erreur");
}).reinitialiserCovoiturage(SESSION_TEL, SESSION_PIN);
}
function reinitialiserFormAbsence(){
ID_ABSENCE_EN_COURS = null;
var bSub = document.getElementById("btnSubmitAbsence");
if(bSub){ bSub.textContent = "Transmettre mon absence au coach"; bSub.style.background = "#ef4444"; bSub.disabled = false; }
var bAnn = document.getElementById("btnAnnulerEditAbsence");
if(bAnn) bAnn.style.display = "none";
var st = document.getElementById("statusAbsence"); if(st) st.textContent = "";
}
function ouvrirModalAbsence(){
reinitialiserFormAbsence();
var dDeb = document.getElementById("inpAbsenceDebut");
var dFin = document.getElementById("inpAbsenceFin");
var now = new Date();
var sDate = now.toISOString().split("T")[0];
if(dDeb && !dDeb.value) dDeb.value = sDate;
if(dFin && !dFin.value) dFin.value = sDate;
document.getElementById("statusAbsence").textContent = "";
rendreMesAbsences();
document.getElementById("modalAbsenceBg").style.display = "flex";
}
function fermerModalAbsence(){ document.getElementById("modalAbsenceBg").style.display = "none"; reinitialiserFormAbsence(); }
function fermerModalAbsenceSurBg(e){ if(e.target.id === "modalAbsenceBg") fermerModalAbsence(); }
function editerAbsenceClient(id){
var a = (MES_ABSENCES || []).find(function(x){ return String(x.id) === String(id); });
if(!a) return;
ID_ABSENCE_EN_COURS = a.id;
if(document.getElementById("inpAbsenceDebut")) document.getElementById("inpAbsenceDebut").value = a.dateDebut;
if(document.getElementById("inpAbsenceFin")) document.getElementById("inpAbsenceFin").value = a.dateFin;
if(document.getElementById("selAbsenceMotif")) document.getElementById("selAbsenceMotif").value = a.motif;
var bSub = document.getElementById("btnSubmitAbsence");
if(bSub){ bSub.textContent = "💾 Enregistrer la modification"; bSub.style.background = "#0284c7"; }
var bAnn = document.getElementById("btnAnnulerEditAbsence");
if(bAnn) bAnn.style.display = "inline-block";
afficherToast("Modifiez les dates ou le motif puis enregistrez.", "info", 2000);
}
function supprimerAbsenceClient(id, nom, deb, fin){
var targetId = id || "";
if(!targetId && !deb){ afficherToast("Identifiant d'absence introuvable.", "erreur"); return; }
if(!confirm("Voulez-vous vraiment supprimer cette déclaration d'absence ?")) return;
afficherLoading("Suppression...", "Mise à jour de vos absences...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
MES_ABSENCES = res.absences || MES_ABSENCES;
reinitialiserFormAbsence();
rendreMesAbsences();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Déclaration d'absence supprimée avec succès.", "succes");
}).withFailureHandler(function(err){
masquerLoading();
afficherToast("Erreur suppression : " + err.message, "erreur");
}).supprimerAbsenceJoueur(SESSION_TEL, SESSION_PIN, targetId, decodeURIComponent(nom || ""), deb || "", fin || "");
}
function declarerNouvelleAbsence(){
var deb = document.getElementById("inpAbsenceDebut").value;
var fin = document.getElementById("inpAbsenceFin").value;
var motif = document.getElementById("selAbsenceMotif").value;
if(!deb || !fin){ afficherToast("Veuillez renseigner les dates de début et de fin.", "erreur"); return; }
var status = document.getElementById("statusAbsence");
var bSub = document.getElementById("btnSubmitAbsence");
if(status) status.innerHTML = "<span class='spinner-badge'></span>Enregistrement de votre absence...";
if(bSub){ bSub.disabled = true; bSub.innerHTML = "<span class='spinner-inline'></span>Enregistrement..."; }
afficherLoading("Enregistrement de l'absence...", "Mise à jour de vos disponibilités...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(bSub) bSub.disabled = false;
reinitialiserFormAbsence();
if(status) status.textContent = "Absence enregistrée avec succès !";
MES_ABSENCES = res.absences || MES_ABSENCES;
rendreMesAbsences();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Absence déclarée et enregistrée !", "succes");
}).withFailureHandler(function(err){
masquerLoading();
if(bSub) bSub.disabled = false;
if(status) status.textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
}).declarerAbsenceJoueur(SESSION_TEL, SESSION_PIN, deb, fin, motif, ID_ABSENCE_EN_COURS);
}
function rendreMesAbsences(){
var cont = document.getElementById("mesAbsencesList"); if(!cont) return;
var titre = document.getElementById("titreListeAbsences");
var dNowAbs = new Date(); var mNowAbs = (dNowAbs.getMonth() + 1); var jNowAbs = dNowAbs.getDate();
var todayIsoAbs = dNowAbs.getFullYear() + "-" + (mNowAbs < 10 ? "0" + mNowAbs : mNowAbs) + "-" + (jNowAbs < 10 ? "0" + jNowAbs : jNowAbs);
var absencesValides = (MES_ABSENCES || []).filter(function(a){
var dFin = String(a.dateFin || a.dateDebut || "").trim();
return !dFin || dFin >= todayIsoAbs;
});
var listeAffichee = [];
if(EST_COACH){
if(titre) titre.textContent = "📋 Absences déclarées par les joueurs";
listeAffichee = absencesValides;
} else {
if(titre) titre.textContent = "📋 Mes déclarations en cours";
listeAffichee = absencesValides.filter(function(a){ return String(a.nom || "").toLowerCase() === String(SESSION_NOM || "").toLowerCase(); });
}
if(listeAffichee.length === 0){
cont.innerHTML = "<div style='font-size:0.75rem;color:#64748b;text-align:center;padding:12px;'>Aucune absence enregistrée.</div>";
return;
}
var html = "";
listeAffichee.forEach(function(a){
var dStr = (a.dateDebut === a.dateFin) ? ("Le " + a.dateDebut) : ("Du " + a.dateDebut + " au " + a.dateFin);
var nomTxt = EST_COACH ? ("<b>" + a.nom + "</b> • ") : "";
var estMoi = String(a.nom || "").toLowerCase() === String(SESSION_NOM || "").toLowerCase();
var safeId = a.id || ("abs_" + encodeURIComponent(a.nom || "") + "_" + (a.dateDebut || "") + "_" + (a.dateFin || ""));
a.id = safeId;
var nomEnc = encodeURIComponent(a.nom || "");
var dDebVal = a.dateDebut || "";
var dFinVal = a.dateFin || "";
html += "<div class='absence-chip' style='display:flex;justify-content:space-between;align-items:center;'>";
html += "<div><div>" + nomTxt + dStr + "</div><div style='font-size:0.72rem;color:#fecaca;margin-top:2px;'>Motif : " + a.motif + "</div></div>";
if(estMoi || EST_COACH){
html += "<div style='display:flex;gap:4px;flex-shrink:0;margin-left:8px;'>";
html += "<button type='button' class='btn-reset' style='padding:3px 7px;font-size:0.75rem;color:#38bdf8;border-color:rgba(56,189,248,0.3);' onclick=\"editerAbsenceClient('" + safeId + "')\" title='Modifier'>✏️</button>";
html += "<button type='button' class='btn-reset' style='padding:3px 7px;font-size:0.75rem;color:#f87171;border-color:rgba(239,68,68,0.3);' onclick=\"supprimerAbsenceClient('" + safeId + "', '" + nomEnc + "', '" + dDebVal + "', '" + dFinVal + "')\" title='Supprimer'>🗑️</button>";
html += "</div>";
}
html += "</div>";
});
cont.innerHTML = html;
}
function ouvrirProfilJoueurPublic(nomBrut){
if(!nomBrut) return;
var nom = decodeURIComponent(nomBrut);
var nClean = String(nom).trim();
var nLow = nClean.toLowerCase();
var nSimple = nLow.replace(/\s*\([^)]*\)\s*/g, "").trim();
var jObj = (EFFECTIF_COMPLET || []).find(function(x){
var xL = String(x.nom || "").trim().toLowerCase();
return xL === nLow || xL.replace(/\s*\([^)]*\)\s*/g, "").trim() === nSimple;
}) || (JOUEURS || []).find(function(x){
var xL = String(x.nom || "").trim().toLowerCase();
return xL === nLow || xL.replace(/\s*\([^)]*\)\s*/g, "").trim() === nSimple;
}) || { nom: nClean, poste: "Demi-Centre", photo: "", entrainements: 0 };
var elNom = document.getElementById("profilPublicNom");
var elPoste = document.getElementById("profilPublicPosteBadge");
var elEq = document.getElementById("profilPublicEquipeBadge");
var elAssid = document.getElementById("profilPublicAssiduiteBadge");
var elImg = document.getElementById("profilPublicImg");
var elInit = document.getElementById("profilPublicInitiale");
var elBdrop = document.getElementById("profilPublicBackdrop");
if(elNom) elNom.textContent = jObj.nom;
if(elPoste) elPoste.textContent = "📍 " + (jObj.poste || "Demi-Centre");
if(elEq) elEq.textContent = jObj.equipe ? ("Équipe : " + jObj.equipe) : "";
var nbTr = (jObj.entrainements !== undefined && jObj.entrainements !== null) ? Number(jObj.entrainements) : 0;
if(elAssid) elAssid.textContent = "⚡ " + nbTr + " séance" + (nbTr > 1 ? "s" : "") + " cette semaine";
var jInitial = (jObj.nom || "").trim().charAt(0).toUpperCase() || "?";
if(elInit) elInit.textContent = jInitial;
if(jObj.photo){
if(elImg){ elImg.src = jObj.photo; elImg.style.display = "block"; }
if(elInit) elInit.style.display = "none";
if(elBdrop){ elBdrop.style.backgroundImage = "url('" + jObj.photo + "')"; elBdrop.style.display = "block"; }
} else {
if(elImg) elImg.style.display = "none";
if(elInit) elInit.style.display = "flex";
if(elBdrop) elBdrop.style.display = "none";
}
var cData = CAISSE_NOIRE_DATA || {};
var allAmendes = (cData.amendes || []).filter(function(a){
var aNom = String(a.nomJoueur || "").trim().toLowerCase();
return aNom === nLow || aNom.replace(/\s*\([^)]*\)\s*/g, "").trim() === nSimple;
});
var totalAm = 0, totalDu = 0;
allAmendes.forEach(function(a){
var mnt = Number(a.montant) || 0;
totalAm += mnt;
if(a.statut === "impaye") totalDu += mnt;
});
var elTotAm = document.getElementById("profilPublicTotalAmendes");
var elResteDu = document.getElementById("profilPublicResteDu");
var elSt = document.getElementById("profilPublicCaisseStatut");
var elList = document.getElementById("profilPublicAmendesList");
if(elTotAm) elTotAm.textContent = totalAm + " €";
if(elResteDu) elResteDu.textContent = totalDu + " €";
if(elSt){
if(totalDu === 0){
elSt.textContent = "À jour ✅";
elSt.style.background = "rgba(34,197,94,0.2)";
elSt.style.color = "#86efac";
} else {
elSt.textContent = "Dû : " + totalDu + " € 🚨";
elSt.style.background = "rgba(239,68,68,0.2)";
elSt.style.color = "#fca5a5";
}
}
if(elList){
if(allAmendes.length === 0){
elList.innerHTML = "<div style='color:#64748b;font-style:italic;padding:6px 0;text-align:center;'>Aucune amende enregistrée. Joueur exemplaire !</div>";
} else {
var html = "";
allAmendes.forEach(function(a){
var isPaye = a.statut === "paye";
var isAttente = a.statut === "en_attente";
var bIcon = isPaye ? "✅" : (isAttente ? "⏳" : "🚨");
var cClr = isPaye ? "#86efac" : (isAttente ? "#fde047" : "#fca5a5");
html += "<div style='display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);'>" +
"<span>" + a.motif + " <span style='color:#94a3b8;font-size:0.68rem;'>(" + (a.date || "") + ")</span></span>" +
"<span style='font-weight:700;color:" + cClr + ";'>" + a.montant + " € " + bIcon + "</span>" +
"</div>";
});
elList.innerHTML = html;
}
}
var bg = document.getElementById("modalProfilJoueurPublicBg");
if(bg) bg.style.display = "flex";
}
function fermerProfilJoueurPublic(){
var bg = document.getElementById("modalProfilJoueurPublicBg");
if(bg) bg.style.display = "none";
}
function fermerProfilJoueurPublicSurBg(e){
if(e.target.id === "modalProfilJoueurPublicBg") fermerProfilJoueurPublic();
}
function ouvrirModalCaisseNoire(){
remplirSelectsCaisse();
rendreCaisseNoireVues();
var bAdm = document.getElementById("btnAccesAdminCaisse");
if(bAdm) bAdm.style.display = (EST_COACH || EST_TRESORIER) ? "block" : "none";
document.getElementById("modalCaisseNoireBg").style.display = "flex";
}
function fermerModalCaisseNoire(){ document.getElementById("modalCaisseNoireBg").style.display = "none"; }
function fermerModalCaisseNoireSurBg(e){ if(e.target.id === "modalCaisseNoireBg") fermerModalCaisseNoire(); }
function basculerTabCaisse(tabKey){
var tabs = ["cagnotte", "ardoise", "bareme", "classement"];
tabs.forEach(function(t){
var btn = document.getElementById("tabCaisse" + t.charAt(0).toUpperCase() + t.slice(1));
var v = document.getElementById("vueCaisse" + t.charAt(0).toUpperCase() + t.slice(1));
if(btn) btn.className = (t === tabKey) ? "train-type-pill active" : "train-type-pill";
if(v) v.style.display = (t === tabKey) ? "block" : "none";
});
if(tabKey === "bareme") filtrerBaremeCaisse("");
}
function remplirSelectsCaisse(){
var selBalJ = document.getElementById("selBalanceJoueur");
var selBalB = document.getElementById("selBalanceBareme");
if(selBalJ){
selBalJ.innerHTML = "<option value=''>-- Choisir un coéquipier --</option>";
(EFFECTIF_COMPLET || []).slice().sort(function(a,b){ return String(a.nom||"").localeCompare(String(b.nom||"")); }).forEach(function(j){
var opt = document.createElement("option"); opt.value = j.nom; opt.textContent = j.nom + " (" + (j.poste||"Demi-Centre") + ")"; selBalJ.appendChild(opt);
});
}
if(selBalB){
selBalB.innerHTML = "<option value=''>-- Choisir un motif du barème --</option>";
var bareme = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config && CAISSE_NOIRE_DATA.config.bareme) || [];
bareme.forEach(function(b){
var opt = document.createElement("option"); opt.value = b.titre; opt.setAttribute("data-montant", b.montant); opt.textContent = b.titre + " (" + b.montant + " €)"; selBalB.appendChild(opt);
});
}
}
function rendreCaisseNoireVues(){
var stats = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats) || { soldeCaisse: 0, totalCollecte: 0, totalDu: 0, totalDepenses: 0 };
var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) || { objectifCagnotte: 300, objectifDescription: "", moyenPaiement: "Lydia / Espèces" };
var sM = document.getElementById("caisseSoldeMontant"); if(sM) sM.textContent = stats.soldeCaisse + " €";
var tC = document.getElementById("caisseTotalCollecte"); if(tC) tC.textContent = "Encaissé : " + stats.totalCollecte + " €";
var tI = document.getElementById("caisseTotalImpaye"); if(tI) tI.textContent = "Restant dû : " + stats.totalDu + " €";
var tD = document.getElementById("caisseTotalDepenses"); if(tD) tD.textContent = "Dépenses : " + stats.totalDepenses + " €";
var objC = Number(cfg.objectifCagnotte) || 300;
var ratio = Math.min(100, Math.max(0, Math.round((stats.soldeCaisse / objC) * 100)));
var ratEl = document.getElementById("caisseObjectifRatio"); if(ratEl) ratEl.textContent = stats.soldeCaisse + " / " + objC + " € (" + ratio + "%)";
var barEl = document.getElementById("caisseObjectifBarre"); if(barEl) barEl.style.width = ratio + "%";
var descEl = document.getElementById("caisseObjectifDesc"); if(descEl) descEl.textContent = cfg.objectifDescription || "Objectif cagnotte pour les événements et repas de l'équipe.";
var mpEl = document.getElementById("caisseMoyenPaiement"); if(mpEl) mpEl.textContent = cfg.moyenPaiement || "Lydia / Espèces au vestiaire auprès du trésorier.";
var mesAmendes = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.amendes) ? CAISSE_NOIRE_DATA.amendes.filter(function(a){ return String(a.nomJoueur || "").toLowerCase() === (SESSION_NOM || "").toLowerCase(); }) : [];
var totalDuMoi = 0;
mesAmendes.filter(function(a){ return a.statut === "impaye"; }).forEach(function(a){ totalDuMoi += (Number(a.montant) || 0); });
var monDuEl = document.getElementById("caisseMonMontantDu"); if(monDuEl) monDuEl.textContent = totalDuMoi + " €";
var monMsgEl = document.getElementById("caisseMonMessageArdoise");
if(monMsgEl){
if(totalDuMoi > 0){ monMsgEl.textContent = "Vous avez " + totalDuMoi + " € à régler à la caisse noire. Pensez à payer par Lydia ou en espèces !"; monMsgEl.style.color = "#fca5a5"; }
else { monMsgEl.textContent = "Vous êtes à jour de vos amendes ! Bravo 🟢"; monMsgEl.style.color = "#86efac"; }
}
var mesList = document.getElementById("caisseMesAmendesList");
if(mesList){
if(mesAmendes.length === 0){
mesList.innerHTML = "<div style='text-align:center;color:#64748b;font-size:0.75rem;padding:14px;'>Aucune amende enregistrée à votre nom pour le moment. Félicitations !</div>";
} else {
var htmlA = "";
mesAmendes.forEach(function(a){
var isPaye = a.statut === "paye";
var isAttente = a.statut === "en_attente";
var stBadge = isPaye ? "<span style='font-size:0.68rem;background:rgba(34,197,94,0.2);color:#86efac;padding:2px 7px;border-radius:99px;font-weight:700;'>Payé ✅</span>" : (isAttente ? "<span style='font-size:0.68rem;background:rgba(234,179,8,0.2);color:#fde047;padding:2px 7px;border-radius:99px;font-weight:700;'>En attente ⏳</span>" : "<span style='font-size:0.68rem;background:rgba(239,68,68,0.2);color:#fca5a5;padding:2px 7px;border-radius:99px;font-weight:700;'>À régler 🚨</span>");
htmlA += "<div style='background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;text-align:left;'>";
htmlA += "<div><div style='font-weight:700;font-size:0.8rem;color:#f8fafc;'>" + a.motif + "</div><div style='font-size:0.7rem;color:#94a3b8;'>" + (a.date || "") + (a.commentaire ? (" • " + a.commentaire) : "") + "</div></div>";
htmlA += "<div style='text-align:right;'><div style='font-weight:800;font-size:0.9rem;color:#fde047;'>" + a.montant + " €</div>" + stBadge + "</div>";
htmlA += "</div>";
});
mesList.innerHTML = htmlA;
}
}
var lList = document.getElementById("caisseLeaderboardList");
if(lList){
var lead = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.leaderboard) || [];
if(lead.length === 0){
lList.innerHTML = "<div style='text-align:center;color:#64748b;font-size:0.75rem;padding:16px;'>Aucune amende validée pour le moment. L'équipe est sage !</div>";
} else {
var htmlL = "";
lead.forEach(function(j, idx){
var med = idx === 0 ? "🥇" : (idx === 1 ? "🥈" : (idx === 2 ? "🥉" : ("#" + (idx + 1))));
var isMoi = String(j.nom || "").toLowerCase() === (SESSION_NOM || "").toLowerCase();
htmlL += "<div onclick=\"ouvrirProfilJoueurPublic('" + encodeURIComponent(j.nom).replace(/'/g, "%27") + "')\" title=\"Cliquer pour voir le profil\" style='cursor:pointer;background:" + (isMoi ? "rgba(234,179,8,0.12)" : "#090d16") + ";border:1px solid " + (isMoi ? "#eab308" : "rgba(255,255,255,0.08)") + ";border-radius:12px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;text-align:left;transition:transform 0.15s,border-color 0.15s;' onmouseenter=\"this.style.borderColor='var(--color-primary)';\" onmouseleave=\"this.style.borderColor='" + (isMoi ? "#eab308" : "rgba(255,255,255,0.08)") + "';\">";
htmlL += "<div style='display:flex;align-items:center;gap:8px;'><span style='font-size:1.1rem;'>" + med + "</span><div><div style='font-weight:800;font-size:0.84rem;color:#f8fafc;'>" + j.nom + (isMoi ? " <span style='color:#fde047;font-size:0.7rem;'>[Moi]</span>" : "") + " <span style='font-size:0.7rem;color:var(--color-secondary);opacity:0.85;'>👁️ Profil</span></div><div style='font-size:0.7rem;color:#94a3b8;'>" + j.nbAmendes + " amende(s) • " + (j.totalPaye || 0) + " € réglés</div></div></div>";
htmlL += "<div style='text-align:right;'><div style='font-weight:900;font-size:0.95rem;color:#fde047;'>" + j.totalAmendes + " €</div><div style='font-size:0.68rem;color:" + (j.totalDu > 0 ? "#f87171" : "#86efac") + ";'>" + (j.totalDu > 0 ? ("Dû : " + j.totalDu + " €") : "À jour ✅") + "</div></div>";
htmlL += "</div>";
});
lList.innerHTML = htmlL;
}
}
}
function copierInfosPaiementCaisse(){
var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) || {};
var txt = "💰 Règlement Caisse Noire : " + (cfg.moyenPaiement || "Lydia / Espèces au vestiaire");
if(navigator.clipboard && navigator.clipboard.writeText){
navigator.clipboard.writeText(txt).then(function(){ afficherToast("Coordonnées de paiement copiées !", "succes"); });
} else { afficherToast("Coordonnées : " + txt, "info"); }
}
function filtrerBaremeCaisse(q){
var cont = document.getElementById("caisseBaremeList"); if(!cont) return;
var bareme = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config && CAISSE_NOIRE_DATA.config.bareme) || [];
var qLow = String(q || "").toLowerCase().trim();
var filtres = bareme.filter(function(b){ return !qLow || String(b.titre || "").toLowerCase().includes(qLow) || String(b.categorie || "").toLowerCase().includes(qLow); });
if(filtres.length === 0){
cont.innerHTML = "<div style='text-align:center;color:#64748b;font-size:0.75rem;padding:14px;'>Aucune règle correspondante trouvée.</div>";
return;
}
var html = "";
filtres.forEach(function(b){
html += "<div style='background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;'>";
html += "<div><div style='font-weight:700;font-size:0.82rem;color:#f8fafc;'>" + b.titre + "</div><div style='font-size:0.68rem;color:var(--color-secondary);'>" + (b.categorie || "Amende") + "</div></div>";
html += "<div style='font-weight:900;font-size:0.95rem;color:#fde047;background:rgba(234,179,8,0.15);padding:3px 9px;border-radius:99px;border:1px solid rgba(234,179,8,0.3);'>" + b.montant + " €</div>";
html += "</div>";
});
cont.innerHTML = html;
}
function ouvrirFormulaireBalance(){
var box = document.getElementById("boxFormulaireBalance"); if(box) box.style.display = "block";
var sJ = document.getElementById("selBalanceJoueur"); if(sJ && SESSION_NOM) sJ.value = SESSION_NOM;
ajusterMontantBalance();
}
function fermerFormulaireBalance(){ var box = document.getElementById("boxFormulaireBalance"); if(box) box.style.display = "none"; }
function ajusterMontantBalance(){
var sel = document.getElementById("selBalanceBareme"); var inp = document.getElementById("inpBalanceMontant");
if(!sel || !inp) return;
var opt = sel.options[sel.selectedIndex];
var mnt = opt ? opt.getAttribute("data-montant") : 1;
if(mnt) inp.value = mnt;
}
function soumettreSignalementBalance(){
var j = document.getElementById("selBalanceJoueur").value;
var b = document.getElementById("selBalanceBareme").value;
var m = parseFloat(document.getElementById("inpBalanceMontant").value) || 1;
var c = document.getElementById("inpBalanceCommentaire").value;
if(!j){ afficherToast("Veuillez sélectionner le joueur concerné.", "erreur"); return; }
if(!b){ afficherToast("Veuillez choisir un motif du barème.", "erreur"); return; }
var st = document.getElementById("statusBalance"); if(st) st.innerHTML = "<span class='spinner-badge'></span>Envoi du signalement...";
afficherLoading("Caisse Noire...", "Envoi du signalement au trésorier...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(st) st.textContent = "";
CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;
fermerFormulaireBalance();
rendreCaisseNoireVues();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Amende signalée au trésorier avec succès !", "succes");
}).withFailureHandler(function(err){
masquerLoading();
if(st) st.textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
}).signalerAmendeJoueur(SESSION_TEL, SESSION_PIN, j, b, m, c);
}
function ouvrirModalAdminCaisseNoire(){
if(!EST_COACH && !EST_TRESORIER){
afficherToast("Accès réservé au coach et aux trésoriers désignés.", "erreur");
return;
}
remplirSelectsAdminCaisse();
rendreAdminCaisseVues();
document.getElementById("modalAdminCaisseNoireBg").style.display = "flex";
}
function fermerModalAdminCaisseNoire(){ document.getElementById("modalAdminCaisseNoireBg").style.display = "none"; }
function fermerModalAdminCaisseNoireSurBg(e){ if(e.target.id === "modalAdminCaisseNoireBg") fermerModalAdminCaisseNoire(); }
function basculerTabAdminCaisse(tabKey){
var tabs = ["infliger", "attente", "encaissements", "depenses", "bareme", "whatsapp"];
tabs.forEach(function(t){
var btn = document.getElementById("tabAdm" + t.charAt(0).toUpperCase() + t.slice(1));
var v = document.getElementById("vueAdm" + t.charAt(0).toUpperCase() + t.slice(1));
if(btn) btn.className = (t === tabKey) ? "train-type-pill active" : "train-type-pill";
if(v) v.style.display = (t === tabKey) ? "block" : "none";
});
if(tabKey === "whatsapp") actualiserBilanTexteWhatsApp();
}
function remplirSelectsAdminCaisse(){
var selJ = document.getElementById("selAdmJoueurs");
var selB = document.getElementById("selAdmBareme");
if(selJ){
selJ.innerHTML = "<option value=''>-- Choisir un joueur --</option>";
(EFFECTIF_COMPLET || []).slice().sort(function(a,b){ return String(a.nom||"").localeCompare(String(b.nom||"")); }).forEach(function(j){
var opt = document.createElement("option"); opt.value = j.nom; opt.textContent = j.nom + " (" + (j.poste||"Demi-Centre") + ")"; selJ.appendChild(opt);
});
}
if(selB){
selB.innerHTML = "<option value=''>-- Choisir un motif du barème --</option>";
var bareme = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config && CAISSE_NOIRE_DATA.config.bareme) || [];
bareme.forEach(function(b){
var opt = document.createElement("option"); opt.value = b.titre; opt.setAttribute("data-montant", b.montant); opt.textContent = b.titre + " (" + b.montant + " €)"; selB.appendChild(opt);
});
}
var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) || {};
var inpC = document.getElementById("inpAdmCagnotteCible"); if(inpC) inpC.value = cfg.objectifCagnotte || 300;
var inpD = document.getElementById("inpAdmObjectifDesc"); if(inpD) inpD.value = cfg.objectifDescription || "Resto & Tournée de fin d'année";
var inpM = document.getElementById("inpAdmMoyenPaiement"); if(inpM) inpM.value = cfg.moyenPaiement || "Lydia / Espèces au vestiaire";
}
function ajusterMontantAdmin(){
var sel = document.getElementById("selAdmBareme"); var inp = document.getElementById("inpAdmMontant");
if(!sel || !inp) return;
var opt = sel.options[sel.selectedIndex];
var mnt = opt ? opt.getAttribute("data-montant") : 1;
if(mnt) inp.value = mnt;
}
function basculerModePaiementAdmin(){
var st = document.getElementById("selAdmStatut").value;
var box = document.getElementById("boxAdmModePaiement");
if(box) box.style.display = (st === "paye") ? "block" : "none";
}
function rendreAdminCaisseVues(){
var stats = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats) || { soldeCaisse: 0, totalCollecte: 0, totalDu: 0, totalEnAttente: 0 };
var elS = document.getElementById("admStatEnCaisse"); if(elS) elS.textContent = stats.soldeCaisse + " €";
var elC = document.getElementById("admStatEncaisse"); if(elC) elC.textContent = stats.totalCollecte + " €";
var elI = document.getElementById("admStatImpaye"); if(elI) elI.textContent = stats.totalDu + " €";
var elA = document.getElementById("admStatEnAttente"); if(elA) elA.textContent = stats.totalEnAttente || 0;
var bAtt = document.getElementById("badgeNbEnAttente");
if(bAtt){
if(stats.totalEnAttente > 0){ bAtt.textContent = stats.totalEnAttente; bAtt.style.display = "inline"; }
else { bAtt.style.display = "none"; }
}
var attList = document.getElementById("admListeEnAttente");
if(attList){
var enAtt = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.amendes) ? CAISSE_NOIRE_DATA.amendes.filter(function(a){ return a.statut === "en_attente"; }) : [];
if(enAtt.length === 0){
attList.innerHTML = "<div style='text-align:center;color:#64748b;font-size:0.75rem;padding:16px;'>Aucune amende en attente de validation. Tout est à jour !</div>";
} else {
var htmlAtt = "";
enAtt.forEach(function(a){
htmlAtt += "<div style='background:#090d16;border:1px solid rgba(245,158,11,0.3);border-radius:12px;padding:10px;margin-bottom:8px;'>";
htmlAtt += "<div style='display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;'><div><b style='color:#fde047;font-size:0.88rem;'>" + a.nomJoueur + "</b> <span style='color:#94a3b8;font-size:0.7rem;'>(" + (a.date||"") + ")</span></div><span style='font-weight:900;font-size:1rem;color:#fde047;'>" + a.montant + " €</span></div>";
htmlAtt += "<div style='font-size:0.78rem;color:#e2e8f0;margin-bottom:2px;'>" + a.motif + "</div>";
if(a.commentaire) htmlAtt += "<div style='font-size:0.72rem;color:#cbd5e1;font-style:italic;margin-bottom:4px;'>« " + a.commentaire + " »</div>";
htmlAtt += "<div style='font-size:0.68rem;color:#94a3b8;margin-bottom:8px;'>Signalé par : " + (a.signalePar || "Coéquipier") + "</div>";
htmlAtt += "<div style='display:flex;gap:6px;'><button type='button' class='btn-save' style='flex:1;padding:5px 8px;font-size:0.75rem;background:#15803d;' onclick=\"validerSignalementAdmin('" + a.id + "', 'valider')\">✅ Valider (Ajouter dette)</button><button type='button' class='btn-reset' style='padding:5px 8px;font-size:0.75rem;color:#f87171;' onclick=\"validerSignalementAdmin('" + a.id + "', 'rejeter')\">❌ Rejeter</button></div>";
htmlAtt += "</div>";
});
attList.innerHTML = htmlAtt;
}
}
var debList = document.getElementById("admListeDebiteurs");
if(debList){
var lead = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.leaderboard) ? CAISSE_NOIRE_DATA.leaderboard.filter(function(j){ return j.totalDu > 0; }) : [];
if(lead.length === 0){
debList.innerHTML = "<div style='text-align:center;color:#64748b;font-size:0.75rem;padding:16px;'>Aucun impayé ! Tous les joueurs sont à jour de leur ardoise. 🟢</div>";
} else {
var htmlDeb = "";
lead.forEach(function(j){
htmlDeb += "<div style='background:#090d16;border:1px solid rgba(239,68,68,0.25);border-radius:12px;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;'>";
htmlDeb += "<div><div style='font-weight:800;font-size:0.86rem;color:#f8fafc;'>" + j.nom + "</div><div style='font-size:0.72rem;color:#f87171;'>Dette en cours : <b>" + j.totalDu + " €</b> (" + j.nbAmendes + " amende(s))</div></div>";
htmlDeb += "<button type='button' class='btn-enter' style='margin:0;padding:6px 10px;font-size:0.75rem;background:#16a34a;color:#fff;font-weight:800;' onclick=\"encaisserToutPourJoueur('" + encodeURIComponent(j.nom) + "')\">💵 Encaisser " + j.totalDu + " €</button>";
htmlDeb += "</div>";
});
debList.innerHTML = htmlDeb;
}
}
var depList = document.getElementById("admListeDepenses");
if(depList){
var deps = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.depenses) || [];
if(deps.length === 0){
depList.innerHTML = "<div style='text-align:center;color:#64748b;font-size:0.75rem;padding:12px;'>Aucune dépense enregistrée.</div>";
} else {
var htmlDep = "";
deps.forEach(function(d){
htmlDep += "<div style='background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px 10px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;'>";
htmlDep += "<div><span style='font-weight:700;font-size:0.8rem;color:#f8fafc;'>" + d.motif + "</span> <span style='color:#94a3b8;font-size:0.68rem;'>(" + (d.date||"") + ")</span></div>";
htmlDep += "<span style='font-weight:800;font-size:0.85rem;color:#f87171;'>-" + d.montant + " €</span>";
htmlDep += "</div>";
});
depList.innerHTML = htmlDep;
}
}
var barEditList = document.getElementById("admListeBaremeEditer");
if(barEditList){
var bar = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config && CAISSE_NOIRE_DATA.config.bareme) || [];
var htmlB = "";
bar.forEach(function(b){
htmlB += "<div style='background:#090d16;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:6px 10px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;'>";
htmlB += "<div><span style='font-size:0.78rem;color:#f8fafc;'>" + b.titre + "</span> <span style='color:var(--color-secondary);font-size:0.68rem;'>[" + (b.categorie||"") + "]</span></div>";
htmlB += "<div style='display:flex;align-items:center;gap:8px;'><b style='color:#fde047;font-size:0.82rem;'>" + b.montant + " €</b><button type='button' class='btn-reset' style='padding:2px 6px;font-size:0.7rem;color:#f87171;' onclick=\"supprimerLigneBaremeAdmin('" + b.id + "')\">✕</button></div>";
htmlB += "</div>";
});
barEditList.innerHTML = htmlB;
}
actualiserBilanTexteWhatsApp();
}
function infligerAmendeParAdmin(){
var j = document.getElementById("selAdmJoueurs").value;
var b = document.getElementById("selAdmBareme").value;
var m = parseFloat(document.getElementById("inpAdmMontant").value) || 1;
var st = document.getElementById("selAdmStatut").value;
var mode = document.getElementById("selAdmModePaiement").value;
var c = document.getElementById("inpAdmCommentaire").value;
if(!j){ afficherToast("Veuillez sélectionner un joueur.", "erreur"); return; }
if(!b){ afficherToast("Veuillez choisir ou saisir un motif.", "erreur"); return; }
var stEl = document.getElementById("statusAdmAmende"); if(stEl) stEl.innerHTML = "<span class='spinner-badge'></span>Application de l'amende...";
var bSubAdm = document.getElementById("btnSubmitAdmAmende");
if(bSubAdm){ bSubAdm.disabled = true; bSubAdm.innerHTML = "<span class='spinner-inline'></span>Application..."; }
afficherLoading("Caisse Noire...", "Application de l'amende...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(bSubAdm){ bSubAdm.disabled = false; bSubAdm.textContent = "Appliquer l'amende"; }
if(stEl) stEl.textContent = "";
CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;
document.getElementById("inpAdmCommentaire").value = "";
rendreAdminCaisseVues();
rendreCaisseNoireVues();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Amende appliquée à " + j + " !", "succes");
}).withFailureHandler(function(err){
masquerLoading();
if(bSubAdm){ bSubAdm.disabled = false; bSubAdm.textContent = "Appliquer l'amende"; }
if(stEl) stEl.textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
}).infligerAmendeAdmin(SESSION_TEL, SESSION_PIN, [j], b, m, st === "paye", mode, c);
}
function validerSignalementAdmin(id, action){
afficherLoading("Caisse Noire...", "Validation du signalement...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;
rendreAdminCaisseVues();
rendreCaisseNoireVues();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast(action === "valider" ? "Amende validée et ajoutée aux impayés !" : "Signalement rejeté.", "info");
}).withFailureHandler(function(err){ masquerLoading(); afficherToast(err.message, "erreur"); }).validerAmendeSignalee(SESSION_TEL, SESSION_PIN, id, action);
}
function encaisserToutPourJoueur(nom){
var mode = prompt("Règlement des amendes de " + nom + " :\nChoisissez le mode de paiement (Espèces / Lydia / Virement) :", "Lydia");
if(!mode) return;
var ids = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.amendes) ? CAISSE_NOIRE_DATA.amendes.filter(function(a){ return String(a.nomJoueur || "").toLowerCase() === nom.toLowerCase() && a.statut === "impaye"; }).map(function(a){ return a.id; }) : [];
if(ids.length === 0){ afficherToast("Aucune amende impayée pour ce joueur.", "info"); return; }
afficherLoading("Caisse Noire...", "Enregistrement du règlement...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;
rendreAdminCaisseVues();
rendreCaisseNoireVues();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Paiement enregistré pour " + nom + " !", "succes");
}).withFailureHandler(function(err){ masquerLoading(); afficherToast(err.message, "erreur"); }).encaisserAmendesAdmin(SESSION_TEL, SESSION_PIN, ids, mode);
}
function enregistrerDepenseParAdmin(){
var m = document.getElementById("inpAdmDepenseMotif").value;
var mnt = parseFloat(document.getElementById("inpAdmDepenseMontant").value) || 0;
if(!m || mnt <= 0){ afficherToast("Veuillez indiquer le motif et le montant.", "erreur"); return; }
var st = document.getElementById("statusAdmDepense"); if(st) st.innerHTML = "<span class='spinner-badge'></span>Enregistrement de la dépense...";
afficherLoading("Caisse Noire...", "Enregistrement de la dépense...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(st) st.textContent = "";
document.getElementById("inpAdmDepenseMotif").value = "";
document.getElementById("inpAdmDepenseMontant").value = "";
CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;
rendreAdminCaisseVues();
rendreCaisseNoireVues();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Dépense enregistrée et déduite de la caisse !", "succes");
}).withFailureHandler(function(err){
masquerLoading();
if(st) st.textContent = "Erreur : " + err.message;
afficherToast(err.message, "erreur");
}).enregistrerDepenseCaisse(SESSION_TEL, SESSION_PIN, m, mnt);
}
function sauvegarderConfigCaisse(){
var obj = parseFloat(document.getElementById("inpAdmCagnotteCible").value) || 300;
var desc = document.getElementById("inpAdmObjectifDesc").value;
var mp = document.getElementById("inpAdmMoyenPaiement").value;
var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) ? Object.assign({}, CAISSE_NOIRE_DATA.config) : {};
cfg.objectifCagnotte = obj;
cfg.objectifDescription = desc;
cfg.moyenPaiement = mp;
afficherLoading("Caisse Noire...", "Mise à jour des paramètres...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;
rendreAdminCaisseVues();
rendreCaisseNoireVues();
afficherToast("Paramètres de la caisse mis à jour !", "succes");
}).withFailureHandler(function(err){ masquerLoading(); afficherToast(err.message, "erreur"); }).enregistrerConfigCaisseNoire(SESSION_TEL, SESSION_PIN, cfg);
}
function ajouterLigneBaremeAdmin(){
var tit = document.getElementById("inpAdmNouveauTitreBareme").value;
var mnt = parseFloat(document.getElementById("inpAdmNouveauMontantBareme").value) || 1;
var cat = document.getElementById("selAdmNouvelleCatBareme").value;
if(!tit){ afficherToast("Veuillez saisir un intitulé pour la nouvelle règle.", "erreur"); return; }
var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) ? Object.assign({}, CAISSE_NOIRE_DATA.config) : {};
if(!Array.isArray(cfg.bareme)) cfg.bareme = [];
cfg.bareme.push({ id: "b_" + new Date().getTime(), titre: tit, montant: mnt, categorie: cat });
afficherLoading("Caisse Noire...", "Ajout de la règle au barème...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
document.getElementById("inpAdmNouveauTitreBareme").value = "";
document.getElementById("inpAdmNouveauMontantBareme").value = "";
CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;
remplirSelectsAdminCaisse(); remplirSelectsCaisse();
rendreAdminCaisseVues(); rendreCaisseNoireVues();
afficherToast("Règle ajoutée au barème !", "succes");
}).withFailureHandler(function(err){ masquerLoading(); afficherToast(err.message, "erreur"); }).enregistrerConfigCaisseNoire(SESSION_TEL, SESSION_PIN, cfg);
}
function supprimerLigneBaremeAdmin(id){
var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) ? Object.assign({}, CAISSE_NOIRE_DATA.config) : {};
if(!Array.isArray(cfg.bareme)) return;
cfg.bareme = cfg.bareme.filter(function(b){ return b.id !== id; });
afficherLoading("Caisse Noire...", "Suppression de la règle...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;
remplirSelectsAdminCaisse(); remplirSelectsCaisse();
rendreAdminCaisseVues(); rendreCaisseNoireVues();
afficherToast("Règle supprimée du barème.", "info");
}).withFailureHandler(function(err){ masquerLoading(); afficherToast(err.message, "erreur"); }).enregistrerConfigCaisseNoire(SESSION_TEL, SESSION_PIN, cfg);
}
function actualiserBilanTexteWhatsApp(){
var txtEl = document.getElementById("txtAdmBilanWa"); if(!txtEl) return;
var nomClub = (CLUB_CONFIG && CLUB_CONFIG.nomClub) || "Handball";
var stats = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.stats) || { soldeCaisse: 0, totalCollecte: 0, totalDu: 0 };
var cfg = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.config) || {};
var obj = cfg.objectifCagnotte || 300;
var desc = cfg.objectifDescription || "Fin de saison";
var mp = cfg.moyenPaiement || "Lydia / Espèces";
var lead = (CAISSE_NOIRE_DATA && CAISSE_NOIRE_DATA.leaderboard) || [];
var txt = "💰 *BILAN DE LA CAISSE NOIRE - " + nomClub.toUpperCase() + "* 💰\n\n";
txt += "🏦 *Solde en caisse :* " + stats.soldeCaisse + " €\n";
txt += "🎯 *Objectif :* " + obj + " € (" + desc + ")\n";
txt += "⏳ *Total restant dû (impayés) :* " + stats.totalDu + " €\n\n";
if(lead.length > 0){
txt += "🏆 *Palmarès des contributeurs :*\n";
lead.slice(0, 5).forEach(function(j, idx){
var med = idx === 0 ? "🥇" : (idx === 1 ? "🥈" : (idx === 2 ? "🥉" : "▪️"));
txt += med + " " + j.nom + " : " + j.totalAmendes + " € (dont " + j.totalDu + " € à régler)\n";
});
txt += "\n";
}
txt += "💳 *Règlement de vos ardoises :* " + mp + "\n";
txt += "👉 Retrouvez votre ardoise complète et le barème sur l'application du club ! 🤾‍♂️";
txtEl.value = txt;
}
function ouvrirBilanCaisseSurWhatsApp(){
actualiserBilanTexteWhatsApp();
var txt = document.getElementById("txtAdmBilanWa").value;
window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(txt), "_blank");
}
function copierBilanCaissePressePapier(){
actualiserBilanTexteWhatsApp();
var txt = document.getElementById("txtAdmBilanWa").value;
if(navigator.clipboard && navigator.clipboard.writeText){
navigator.clipboard.writeText(txt).then(function(){ afficherToast("Bilan copié dans le presse-papier !", "succes"); });
} else { afficherToast("Texte prêt à être copié.", "info"); }
}
function reinitialiserCaisseNoireParAdmin(){
if(!confirm("ATTENTION : Voulez-vous vraiment clôturer et remettre la caisse noire à zéro ?\nToutes les amendes et dépenses seront archivées.")) return;
google.script.run.withSuccessHandler(function(res){
CAISSE_NOIRE_DATA = res.data || CAISSE_NOIRE_DATA;
rendreAdminCaisseVues(); rendreCaisseNoireVues();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Caisse noire réinitialisée pour la nouvelle période.", "info");
}).withFailureHandler(function(err){ afficherToast(err.message, "erreur"); }).reinitialiserCaisseNoire(SESSION_TEL, SESSION_PIN);
}
/* --- GESTION DES VACANCES & TRÊVES SCOLAIRES (CLIENT) --- */
function ouvrirModalVacances(){
rendreListePeriodesVacances();
document.getElementById("modalVacancesBg").style.display = "flex";
}
function fermerModalVacances(){
document.getElementById("modalVacancesBg").style.display = "none";
annulerEditionVacanceClient();
}
function fermerModalVacancesSurBg(e){
if(e.target.id === "modalVacancesBg") fermerModalVacances();
}
function annulerEditionVacanceClient(){
var idEl = document.getElementById("inpVacId"); if(idEl) idEl.value = "";
var nEl = document.getElementById("inpVacNom"); if(nEl) nEl.value = "";
var dEl = document.getElementById("inpVacDebut"); if(dEl) dEl.value = "";
var fEl = document.getElementById("inpVacFin"); if(fEl) fEl.value = "";
var cEl = document.getElementById("inpVacCommentaire"); if(cEl) cEl.value = "";
var aEl = document.getElementById("chkVacActif"); if(aEl) aEl.checked = true;
var tEl = document.getElementById("titreFormVacance"); if(tEl) tEl.textContent = "Ajouter une période de vacances :";
var bSub = document.getElementById("btnSubmitVacance"); if(bSub) bSub.textContent = "+ Ajouter cette période";
var bAnn = document.getElementById("btnAnnulerEditVac"); if(bAnn) bAnn.style.display = "none";
var sEl = document.getElementById("statusVacancesModal"); if(sEl) sEl.textContent = "";
}
function editerVacanceClient(id){
var list = (VACANCES_DATA && VACANCES_DATA.periodes) ? VACANCES_DATA.periodes : [];
var v = list.find(function(x){ return x.id === id; });
if(!v) return;
var idEl = document.getElementById("inpVacId"); if(idEl) idEl.value = v.id;
var nEl = document.getElementById("inpVacNom"); if(nEl) nEl.value = v.nom || "";
var dEl = document.getElementById("inpVacDebut"); if(dEl) dEl.value = v.dateDebut || "";
var fEl = document.getElementById("inpVacFin"); if(fEl) fEl.value = v.dateFin || "";
var cEl = document.getElementById("inpVacCommentaire"); if(cEl) cEl.value = v.commentaire || "";
var aEl = document.getElementById("chkVacActif"); if(aEl) aEl.checked = (v.actif !== false);
var tEl = document.getElementById("titreFormVacance"); if(tEl) tEl.textContent = "Modifier la période : " + (v.nom || "");
var bSub = document.getElementById("btnSubmitVacance"); if(bSub) bSub.textContent = "💾 Enregistrer les modifications";
var bAnn = document.getElementById("btnAnnulerEditVac"); if(bAnn) bAnn.style.display = "inline-block";
if(nEl) nEl.focus();
}
function ajouterOuEditerVacanceClient(){
var id = (document.getElementById("inpVacId") ? document.getElementById("inpVacId").value.trim() : "");
var nom = (document.getElementById("inpVacNom") ? document.getElementById("inpVacNom").value.trim() : "");
var deb = (document.getElementById("inpVacDebut") ? document.getElementById("inpVacDebut").value.trim() : "");
var fin = (document.getElementById("inpVacFin") ? document.getElementById("inpVacFin").value.trim() : "");
var com = (document.getElementById("inpVacCommentaire") ? document.getElementById("inpVacCommentaire").value.trim() : "");
var actif = document.getElementById("chkVacActif") ? document.getElementById("chkVacActif").checked : true;
var stEl = document.getElementById("statusVacancesModal");
if(!nom){ if(stEl) stEl.textContent = "Veuillez saisir un nom pour la période."; return; }
if(!deb || !fin){ if(stEl) stEl.textContent = "Veuillez renseigner les dates de début et de fin."; return; }
if(deb > fin){ if(stEl) stEl.textContent = "La date de début ne peut pas être postérieure à la date de fin."; return; }
var list = (VACANCES_DATA && VACANCES_DATA.periodes) ? VACANCES_DATA.periodes.slice() : [];
if(id){
var idx = list.findIndex(function(x){ return x.id === id; });
if(idx !== -1){
list[idx] = { id: id, nom: nom, dateDebut: deb, dateFin: fin, commentaire: com, actif: actif };
}
} else {
var newId = "vac_" + Date.now();
list.push({ id: newId, nom: nom, dateDebut: deb, dateFin: fin, commentaire: com, actif: actif });
}
list.sort(function(a, b){ return String(a.dateDebut||"").localeCompare(String(b.dateDebut||"")); });
sauvegarderVacancesSurServeur(list);
annulerEditionVacanceClient();
}
function supprimerVacanceClient(id){
var list = (VACANCES_DATA && VACANCES_DATA.periodes) ? VACANCES_DATA.periodes.slice() : [];
var v = list.find(function(x){ return x.id === id; });
if(!v) return;
if(!confirm("Supprimer la période \"" + v.nom + "\" ?")) return;
var filtered = list.filter(function(x){ return x.id !== id; });
sauvegarderVacancesSurServeur(filtered);
}
function basculerActifVacanceClient(id){
var list = (VACANCES_DATA && VACANCES_DATA.periodes) ? VACANCES_DATA.periodes.slice() : [];
var v = list.find(function(x){ return x.id === id; });
if(!v) return;
v.actif = !v.actif;
sauvegarderVacancesSurServeur(list);
}
function chargerVacancesDefautSaisonClient(){
if(!confirm("Charger les vacances scolaires standard 2026-2027 ?\n(Toussaint, Noël, Hiver, Printemps, Été)\nCela réinitialisera les périodes.")) return;
afficherLoading("Vacances...", "Chargement du calendrier scolaire 2026-2027...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
VACANCES_DATA = res.data || VACANCES_DATA;
rendreListePeriodesVacances();
majBannieresVacances();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Calendrier des vacances 2026-2027 chargé !", "succes");
}).withFailureHandler(function(err){
masquerLoading();
afficherToast("Erreur : " + err.message, "erreur");
}).reinitialiserVacancesDefaut(SESSION_TEL, SESSION_PIN);
}
function sauvegarderVacancesSurServeur(list){
afficherLoading("Vacances...", "Synchronisation des vacances...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
VACANCES_DATA = res.data || VACANCES_DATA;
rendreListePeriodesVacances();
majBannieresVacances();
if(SESSION_NOM) majEspaceJoueur(SESSION_NOM);
afficherToast("Périodes de vacances enregistrées !", "succes");
}).withFailureHandler(function(err){
masquerLoading();
afficherToast("Erreur enregistrement : " + err.message, "erreur");
}).enregistrerVacancesClub(SESSION_TEL, SESSION_PIN, list);
}
function formaterDateFrClient(isoStr){
if(!isoStr) return "";
var parts = String(isoStr).split("-");
if(parts.length !== 3) return isoStr;
return parts[2] + "/" + parts[1] + "/" + parts[0];
}
function rendreListePeriodesVacances(){
var cont = document.getElementById("listeVacancesContainer");
var badgeNb = document.getElementById("badgeNbVacancesTotal");
if(!cont) return;
cont.innerHTML = "";
var list = (VACANCES_DATA && VACANCES_DATA.periodes) ? VACANCES_DATA.periodes : [];
if(badgeNb) badgeNb.textContent = list.length + " période(s)";
if(list.length === 0){
cont.innerHTML = "<div style='font-size:0.8rem;color:#94a3b8;font-style:italic;padding:12px 0;text-align:center;'>Aucune période configurée. Utilisez le formulaire ci-dessus ou chargez le calendrier standard.</div>";
return;
}
var todayIso = new Date().toISOString().split("T")[0];
list.forEach(function(v){
var isActif = (v.actif !== false);
var deb = v.dateDebut || "";
var fin = v.dateFin || deb;
var debFr = formaterDateFrClient(deb);
var finFr = formaterDateFrClient(fin);
var stBadge = "";
var cardBg = "background:#090d16;";
var cardBorder = "border:1px solid rgba(255,255,255,0.08);";
if(!isActif){
stBadge = "<span style='font-size:0.68rem;padding:2px 7px;border-radius:99px;background:rgba(148,163,184,0.15);color:#94a3b8;font-weight:700;'>⚪ Désactivée</span>";
} else if(deb <= todayIso && fin >= todayIso){
stBadge = "<span style='font-size:0.68rem;padding:2px 7px;border-radius:99px;background:rgba(14,165,233,0.25);color:#38bdf8;border:1px solid #0ea5e9;font-weight:800;'>🏖️ En cours</span>";
cardBg = "background:linear-gradient(135deg,rgba(14,116,144,0.25),rgba(15,23,42,0.95));";
cardBorder = "border:1px solid rgba(14,165,233,0.35);";
} else if(deb > todayIso){
stBadge = "<span style='font-size:0.68rem;padding:2px 7px;border-radius:99px;background:rgba(234,179,8,0.18);color:#facc15;font-weight:700;'>⏳ À venir</span>";
} else {
stBadge = "<span style='font-size:0.68rem;padding:2px 7px;border-radius:99px;background:rgba(148,163,184,0.15);color:#94a3b8;font-weight:700;'>✔️ Passée</span>";
}
var card = document.createElement("div");
card.style.cssText = cardBg + cardBorder + "border-radius:12px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;";
var left = document.createElement("div");
left.style.cssText = "flex:1;min-width:0;";
left.innerHTML = "<div style='display:flex;align-items:center;gap:6px;margin-bottom:2px;'><span style='font-weight:800;font-size:0.85rem;color:" + (isActif ? "#f8fafc" : "#94a3b8") + ";'>" + (v.nom || "Vacances") + "</span>" + stBadge + "</div><div style='font-size:0.75rem;color:#cbd5e1;margin-bottom:2px;'>📅 Du " + debFr + " au " + finFr + "</div>" + (v.commentaire ? "<div style='font-size:0.72rem;color:#94a3b8;font-style:italic;'>" + v.commentaire + "</div>" : "");
var right = document.createElement("div");
right.style.cssText = "display:flex;gap:4px;align-items:center;";
var btnToggle = document.createElement("button");
btnToggle.type = "button"; btnToggle.className = "btn-reset";
btnToggle.style.cssText = "font-size:0.72rem;padding:4px 8px;border-radius:6px;background:" + (isActif ? "rgba(14,165,233,0.18)" : "rgba(148,163,184,0.12)") + ";color:" + (isActif ? "#7dd3fc" : "#94a3b8") + ";";
btnToggle.textContent = isActif ? "Activée" : "Désactivée";
btnToggle.onclick = function(){ basculerActifVacanceClient(v.id); };
var btnEdit = document.createElement("button");
btnEdit.type = "button"; btnEdit.className = "btn-reset";
btnEdit.style.cssText = "font-size:0.75rem;padding:4px 8px;border-radius:6px;";
btnEdit.textContent = "✏️"; btnEdit.title = "Modifier les dates ou l'intitulé";
btnEdit.onclick = function(){ editerVacanceClient(v.id); };
var btnDel = document.createElement("button");
btnDel.type = "button"; btnDel.className = "btn-reset";
btnDel.style.cssText = "font-size:0.75rem;padding:4px 8px;border-radius:6px;color:#f87171;";
btnDel.textContent = "🗑️"; btnDel.title = "Supprimer cette période";
btnDel.onclick = function(){ supprimerVacanceClient(v.id); };
right.appendChild(btnToggle); right.appendChild(btnEdit); right.appendChild(btnDel);
card.appendChild(left); card.appendChild(right);
cont.appendChild(card);
});
}
function majBannieresVacances(){
var bTr = document.getElementById("banniereVacancesTrain");
var bMt = document.getElementById("banniereVacancesMatch");
var bPr = document.getElementById("banniereVacancesPreview");
var bCoach = document.getElementById("badgeCoachVacances");
var enVac = Boolean(VACANCES_DATA && VACANCES_DATA.enVacancesCetteSemaine);
var info = (VACANCES_DATA && VACANCES_DATA.infoSemaine) || {};
var nom = info.nom || "Vacances scolaires";
if(enVac){
if(bTr){ bTr.style.display = "flex"; var txtTr = document.getElementById("txtBanniereVacancesTrain"); if(txtTr) txtTr.textContent = "🏖️ Semaine en période de vacances scolaires (" + nom + ") : entraînements réguliers suspendus."; }
if(bMt){ bMt.style.display = "flex"; var txtMt = document.getElementById("txtBanniereVacancesMatch"); if(txtMt) txtMt.textContent = "🏖️ Semaine en période de vacances scolaires (" + nom + ") : pas de match officiel programmé."; }
if(bPr){ bPr.style.display = "flex"; var txtPr = document.getElementById("txtBanniereVacancesPreview"); if(txtPr) txtPr.textContent = "🏖️ Période de vacances active (" + nom + ") : aucun entraînement ni match cette semaine. L'envoi automatique du sondage est suspendu."; }
if(bCoach){ bCoach.textContent = "🏖️ En cours : " + nom; bCoach.style.background = "rgba(14,165,233,0.3)"; bCoach.style.color = "#7dd3fc"; }
} else {
if(bTr) bTr.style.display = "none";
if(bMt) bMt.style.display = "none";
if(bPr) bPr.style.display = "none";
if(bCoach){
var list = (VACANCES_DATA && VACANCES_DATA.periodes) ? VACANCES_DATA.periodes.filter(function(x){ return x.actif !== false; }) : [];
bCoach.textContent = list.length ? (list.length + " période(s) active(s)") : "0 en cours";
bCoach.style.background = "rgba(148,163,184,0.15)";
bCoach.style.color = "#94a3b8";
}
}
}
function majVueEntrainement(){
if(!TRAIN_CONFIG[SEANCE_COURANTE]){
var curS = (SEANCES_TRAIN || []).find(function(x){ return x.id === SEANCE_COURANTE; });
var curLbl = curS ? (curS.jour + " " + (curS.horaire || "")) : "Séance";
TRAIN_CONFIG[SEANCE_COURANTE] = { label: curLbl, type: "separe", max: 20 };
}
var cfgS = TRAIN_CONFIG[SEANCE_COURANTE];
majPillsTypeSeance(cfgS.type);
var explEl = document.getElementById("trainExplication");
var lblMax = document.getElementById("lblMaxJoueurs");
var inpMax = document.getElementById("inpMaxJoueurs");
if(inpMax) inpMax.value = cfgS.max || 20;
if(lblMax) lblMax.style.display = (cfgS.type === "reduit") ? "inline-flex" : "none";
if(explEl){
if(cfgS.type === "separe") explEl.textContent = "Séance séparée : 2 groupes de travail + repos";
else if(cfgS.type === "reduit") explEl.textContent = "Séance réduite : sélection limitée à " + (cfgS.max || 20) + " joueurs max";
else explEl.textContent = "Séance complète : tout le monde est accepté (ménagés à part)";
}
var zDyn = document.getElementById("trDynamicZones"); if(zDyn) zDyn.innerHTML = "";
if(cfgS.type === "separe"){
zDyn.innerHTML = '<div class="col col-1b"><div class="col-title"><span><span class="team-dot team-dot-1"></span>Groupe 1</span><span id="trCount_g1">0</span></div><div class="col-sub">Travail spécifique 1</div><div class="dropzone" id="trZone_g1"></div></div>' +
'<div class="col col-1c"><div class="col-title"><span><span class="team-dot team-dot-2"></span>Groupe 2</span><span id="trCount_g2">0</span></div><div class="col-sub">Travail spécifique 2</div><div class="dropzone" id="trZone_g2"></div></div>';
} else if(cfgS.type === "reduit"){
zDyn.innerHTML = '<div class="col col-retenu"><div class="col-title"><span>Joueurs Retenus</span><span id="trCount_retenus">0/' + (cfgS.max || 20) + '</span></div><div class="col-sub">Sélection retenue pour la séance</div><div class="dropzone" id="trZone_retenus"></div></div>';
} else {
zDyn.innerHTML = '<div class="col col-1b"><div class="col-title"><span>Plein Entraînement</span><span id="trCount_actifs">0</span></div><div class="col-sub">Séance à 100%</div><div class="dropzone" id="trZone_actifs"></div></div>' +
'<div class="col col-pool"><div class="col-title"><span>Ménagés / Adaptés</span><span id="trCount_menages">0</span></div><div class="col-sub">Blessés légers, reprise en douceur</div><div class="dropzone" id="trZone_menages"></div></div>';
}
var trPool = document.getElementById("trZonePool"); if(trPool) trPool.innerHTML = "";
var listeDispos = ENTRAINEMENTS[SEANCE_COURANTE] || [];
listeDispos.forEach(function(j){ if(trPool) trPool.appendChild(creerCarte(j)); });
TRAIN_SWIPE_HISTORIQUE = [];
majCompteursTrain();
initSortables();
if(TRAIN_MODE_TINDER){ rendreControlesTrainTinder(); afficherCarteTrainTinder(); }
}
function changerSeance(seanceKey){
SEANCE_COURANTE = seanceKey;
if(SEANCES_TRAIN && SEANCES_TRAIN.length){
SEANCES_TRAIN.forEach(function(s){
var btn = document.getElementById("tab_" + s.id);
if(btn){ btn.className = (s.id === seanceKey) ? "tab-btn tab-active" : "tab-btn"; }
});
}
majVueEntrainement();
}
function changerTypeSeance(nouveauType){
if(!TRAIN_CONFIG[SEANCE_COURANTE]) TRAIN_CONFIG[SEANCE_COURANTE] = { label: "Séance", type: nouveauType, max: 20 };
TRAIN_CONFIG[SEANCE_COURANTE].type = nouveauType;
majVueEntrainement();
}
function majPillsTypeSeance(typeActif){
var pSep = document.getElementById("pillSepare"), pRed = document.getElementById("pillReduit"), pComp = document.getElementById("pillComplet");
if(pSep) pSep.className = "train-type-pill" + (typeActif === "separe" ? " active" : "");
if(pRed) pRed.className = "train-type-pill" + (typeActif === "reduit" ? " active" : "");
if(pComp) pComp.className = "train-type-pill" + (typeActif === "complet" ? " active" : "");
}
function majMaxRetenus(val){
var n = parseInt(val, 10); if(isNaN(n) || n < 1) n = 20;
if(TRAIN_CONFIG[SEANCE_COURANTE]) TRAIN_CONFIG[SEANCE_COURANTE].max = n;
majVueEntrainement();
}
function majCompteursTrain(){
var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { type: "separe", max: 20 };
var trPool = document.getElementById("trZonePool");
var nPool = trPool ? trPool.children.length : 0;
var cPool = document.getElementById("trCountPool"); if(cPool) cPool.textContent = nPool;
var scoreBar = document.getElementById("trainTscoreBar");
if(cfgS.type === "separe"){
var zG1 = document.getElementById("trZone_g1"), zG2 = document.getElementById("trZone_g2");
var nG1 = zG1 ? zG1.children.length : 0, nG2 = zG2 ? zG2.children.length : 0;
var cG1 = document.getElementById("trCount_g1"); if(cG1) cG1.textContent = nG1;
var cG2 = document.getElementById("trCount_g2"); if(cG2) cG2.textContent = nG2;
if(scoreBar) scoreBar.innerHTML = '<span><span class="team-dot team-dot-1"></span>Groupe 1 : <b>' + nG1 + '</b></span><span style="color:#cbd5e1;">Restants : <b>' + nPool + '</b></span><span><span class="team-dot team-dot-2"></span>Groupe 2 : <b>' + nG2 + '</b></span>';
} else if(cfgS.type === "reduit"){
var zRet = document.getElementById("trZone_retenus");
var nRet = zRet ? zRet.children.length : 0;
var cRet = document.getElementById("trCount_retenus"); if(cRet) cRet.textContent = nRet + "/" + (cfgS.max || 20);
if(scoreBar) scoreBar.innerHTML = '<span>Retenus : <b>' + nRet + '</b>/' + (cfgS.max || 20) + '</span><span style="color:#cbd5e1;">Restants : <b>' + nPool + '</b></span>';
} else {
var zAct = document.getElementById("trZone_actifs"), zMen = document.getElementById("trZone_menages");
var nAct = zAct ? zAct.children.length : 0, nMen = zMen ? zMen.children.length : 0;
var cAct = document.getElementById("trCount_actifs"); if(cAct) cAct.textContent = nAct;
var cMen = document.getElementById("trCount_menages"); if(cMen) cMen.textContent = nMen;
if(scoreBar) scoreBar.innerHTML = '<span>Plein entraînement : <b>' + nAct + '</b></span><span style="color:#cbd5e1;">Restants : <b>' + nPool + '</b></span><span>Ménagés : <b>' + nMen + '</b></span>';
}
}
function choisirModeTrain(isTinder){
TRAIN_MODE_TINDER = !!isTinder;
document.body.classList.toggle("train-tinder-mode-active", TRAIN_MODE_TINDER);
var classic = document.getElementById("trainBoardClassic");
var tinder = document.getElementById("trainTinderView");
var footer = document.getElementById("trainFooter");
if(classic){ classic.style.display = TRAIN_MODE_TINDER ? "none" : "grid"; if(!TRAIN_MODE_TINDER){ classic.classList.remove("view-animate-in"); void classic.offsetWidth; classic.classList.add("view-animate-in"); } }
if(tinder){ tinder.style.display = TRAIN_MODE_TINDER ? "block" : "none"; if(TRAIN_MODE_TINDER){ tinder.classList.remove("view-animate-in"); void tinder.offsetWidth; tinder.classList.add("view-animate-in"); } }
if(footer) footer.style.display = TRAIN_MODE_TINDER ? "none" : "flex";
var tabC = document.getElementById("tabTrainClassicMode");
var tabT = document.getElementById("tabTrainTinderMode");
if(tabC) tabC.className = "view-mode-tab" + (TRAIN_MODE_TINDER ? "" : " active");
if(tabT) tabT.className = "view-mode-tab" + (TRAIN_MODE_TINDER ? " active" : "");
var btnSwitch = document.getElementById("btnSwitchModeTrain");
if(btnSwitch) btnSwitch.textContent = TRAIN_MODE_TINDER ? "Mode Tactique" : "Mode Tinder";
if(TRAIN_MODE_TINDER){ rendreControlesTrainTinder(); afficherCarteTrainTinder(); }
}
function basculerModeTrain(){ choisirModeTrain(!TRAIN_MODE_TINDER); }
function rendreControlesTrainTinder(){
var c = document.getElementById("trainTControlsContainer"); if(!c) return;
var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { type: "separe" };
var html = '<button type="button" class="tbtn-undo" title="Annuler le dernier choix" onclick="annulerDernierSwipeTrain()">↩</button>';
if(cfgS.type === "separe"){
html += '<button type="button" class="tbtn-circle tbtn-1b" data-choix="G1" onclick="animerVoteBoutonTrain(\'G1\')"><span>←</span>Groupe 1</button>';
html += '<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBoutonTrain(\'OUT\')"><span>↓</span>Repos</button>';
html += '<button type="button" class="tbtn-circle tbtn-1c" data-choix="G2" onclick="animerVoteBoutonTrain(\'G2\')"><span>→</span>Groupe 2</button>';
} else if(cfgS.type === "reduit"){
html += '<button type="button" class="tbtn-circle tbtn-out" data-choix="OUT" onclick="animerVoteBoutonTrain(\'OUT\')"><span>←</span>Repos</button>';
html += '<button type="button" class="tbtn-circle tbtn-1b" data-choix="RETENU" onclick="animerVoteBoutonTrain(\'RETENU\')"><span>→</span>Retenu</button>';
} else {
html += '<button type="button" class="tbtn-circle tbtn-out" data-choix="MENAGE" onclick="animerVoteBoutonTrain(\'MENAGE\')"><span>←</span>Ménagé</button>';
html += '<button type="button" class="tbtn-circle tbtn-1b" data-choix="ACTIF" onclick="animerVoteBoutonTrain(\'ACTIF\')"><span>→</span>Présent</button>';
}
html += '<button type="button" class="tbtn-undo" title="Recommencer la séance" onclick="recommencerTrainSelection()">Réinit</button>';
c.innerHTML = html;
}
function afficherCarteTrainTinder(){
var cont = document.getElementById("trainTinderContainer"); if(!cont) return;
cont.innerHTML = "";
var pool = document.getElementById("trZonePool");
if(!pool || pool.children.length === 0){
cont.innerHTML = "<div style='padding:60px 20px;color:#a3a3a3;font-size:1.1rem;'>Tous les joueurs sont répartis pour cette séance !<br><br><small>Basculez en mode tactique pour affiner ou sauvegarder.</small></div>";
majCompteursTrain(); return;
}
var listeDispos = ENTRAINEMENTS[SEANCE_COURANTE] || [];
var nomTop = pool.children[0].getAttribute("data-nom");
var jTop = listeDispos.find(function(x){ return x.nom === nomTop; }) || { nom: nomTop, poste: "Demi-Centre" };
var topCard = creerCarteTrainTinderHtml(jTop, true);
cont.appendChild(topCard);
if(pool.children.length > 1){
var nomNext = pool.children[1].getAttribute("data-nom");
var jNext = listeDispos.find(function(x){ return x.nom === nomNext; }) || { nom: nomNext, poste: "Demi-Centre" };
var nextCard = creerCarteTrainTinderHtml(jNext, false); nextCard.classList.add("tcard-next");
cont.appendChild(nextCard);
}
attacherGestesTrainTinder(topCard); majCompteursTrain();
}
function creerCarteTrainTinderHtml(j, isTop){
var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { type: "separe" };
var card = document.createElement("div"); card.className = "tcard" + (isTop ? " tcard-top" : "");
card.setAttribute("data-nom", j.nom);
var trInit = (j.nom || "").trim().charAt(0).toUpperCase();
var avTr = document.createElement("div"); avTr.className = "tavatar"; avTr.textContent = trInit; avTr.style.cursor = "pointer"; avTr.title = "Fiche de " + j.nom; avTr.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); };
if(j.photo){ var bg = document.createElement("img"); bg.className = "tbg-photo"; bg.src = j.photo; bg.onerror = function(){ this.remove(); if(avTr) avTr.style.display = "flex"; }; card.appendChild(bg); }
var ov = document.createElement("div"); ov.className = "tbg-overlay"; card.appendChild(ov);
function addStamp(clsPos, clsCol, txt){ var s = document.createElement("div"); s.className = "stamp " + clsPos + " " + clsCol; s.textContent = txt; card.appendChild(s); }
if(cfgS.type === "separe"){
addStamp("stamp-left", "stamp-1b", "GROUPE 1");
addStamp("stamp-right", "stamp-1c", "GROUPE 2");
addStamp("stamp-down", "stamp-out", "REPOS");
} else if(cfgS.type === "reduit"){
addStamp("stamp-left", "stamp-out", "NON RETENU");
addStamp("stamp-right", "stamp-1b", "RETENU");
} else {
addStamp("stamp-left", "stamp-out", "MÉNAGÉ");
addStamp("stamp-right", "stamp-1b", "PRÉSENT");
}
var bEd = document.createElement("button"); bEd.className = "tbtn-edit-card"; bEd.textContent = "Fiche";
bEd.onclick = function(e){ e.stopPropagation(); ouvrirModalJoueur(j.nom); }; card.appendChild(bEd);
var tc = document.createElement("div"); tc.className = "tcontent";
if(!j.photo){ tc.appendChild(avTr); }
else { avTr.style.display = "none"; tc.appendChild(avTr); var sp = document.createElement("div"); sp.style.height = "20px"; tc.appendChild(sp); }
var bot = document.createElement("div"); bot.style.width = "100%"; bot.style.display = "flex"; bot.style.flexDirection = "column"; bot.style.alignItems = "center"; bot.style.gap = "6px";
var nomEl = document.createElement("div"); nomEl.style.fontSize = "1.5rem"; nomEl.style.fontWeight = "900"; nomEl.textContent = j.nom; bot.appendChild(nomEl);
var postEl = document.createElement("div"); postEl.style.fontSize = "0.95rem"; postEl.style.color = "var(--color-secondary)"; postEl.style.fontWeight = "700"; postEl.textContent = (j.poste || "Demi-Centre") + " • " + (j.entrainements || 0) + " tr"; bot.appendChild(postEl);
if(j.note){ var nt = document.createElement("div"); nt.className = "tnote-box"; nt.textContent = "Note : " + j.note; bot.appendChild(nt); }
tc.appendChild(bot); card.appendChild(tc);
return card;
}
function attacherGestesTrainTinder(card){
var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { type: "separe" };
var startX = 0, startY = 0, currentX = 0, currentY = 0, isDragging = false;
var sLeft = card.querySelector(".stamp-left"), sRight = card.querySelector(".stamp-right"), sDown = card.querySelector(".stamp-down");
function resetStamps(){ if(sLeft) sLeft.style.opacity = 0; if(sRight) sRight.style.opacity = 0; if(sDown) sDown.style.opacity = 0; }
function onStart(e){ isDragging = true; startX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX; startY = e.type.includes("mouse") ? e.clientY : e.touches[0].clientY; card.classList.remove("tcard-spring"); }
function onMove(e){
if(!isDragging) return;
var clientX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX;
var clientY = e.type.includes("mouse") ? e.clientY : e.touches[0].clientY;
currentX = clientX - startX; currentY = clientY - startY;
var rot = currentX * 0.08;
card.style.transform = "translate3d(" + currentX + "px," + currentY + "px,0) rotate(" + rot + "deg)";
resetStamps();
if(cfgS.type === "separe"){
if(currentY > 40 && Math.abs(currentY) > Math.abs(currentX)){ if(sDown) sDown.style.opacity = Math.min(1, currentY / 95); }
else if(currentX < -20 && sLeft){ sLeft.style.opacity = Math.min(1, Math.abs(currentX) / 95); }
else if(currentX > 20 && sRight){ sRight.style.opacity = Math.min(1, currentX / 95); }
} else {
if(currentX < -20 && sLeft){ sLeft.style.opacity = Math.min(1, Math.abs(currentX) / 95); }
else if(currentX > 20 && sRight){ sRight.style.opacity = Math.min(1, currentX / 95); }
}
}
function onEnd(){
if(!isDragging) return; isDragging = false;
var dest = null;
if(cfgS.type === "separe"){
if(currentY > 90 && Math.abs(currentY) > Math.abs(currentX)) dest = "OUT";
else if(currentX < -90 && Math.abs(currentX) > Math.abs(currentY)) dest = "G1";
else if(currentX > 90 && Math.abs(currentX) > Math.abs(currentY)) dest = "G2";
} else if(cfgS.type === "reduit"){
if(currentX < -90) dest = "OUT";
else if(currentX > 90) dest = "RETENU";
} else {
if(currentX < -90) dest = "MENAGE";
else if(currentX > 90) dest = "ACTIF";
}
if(dest) ejecterCarteTrain(card, dest);
else { card.classList.add("tcard-spring"); card.style.transform = "translate3d(0px,0px,0) rotate(0deg)"; resetStamps(); }
}
card.addEventListener("mousedown", onStart); window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onEnd);
card.addEventListener("touchstart", onStart, { passive: true }); window.addEventListener("touchmove", onMove, { passive: true }); window.addEventListener("touchend", onEnd);
}
function animerVoteBoutonTrain(choix){ if(TRAIN_MODE_TINDER) swiperTrainVers(choix); }
function swiperTrainVers(choix){
if(TRAIN_ANIM_EN_COURS) return;
var topCard = document.querySelector("#trainTinderContainer .tcard-top");
if(!topCard) return;
var s = null;
if(choix === "G1" || (choix === "OUT" && TRAIN_CONFIG[SEANCE_COURANTE].type === "reduit") || choix === "MENAGE") s = topCard.querySelector(".stamp-left");
else if(choix === "G2" || choix === "RETENU" || choix === "ACTIF") s = topCard.querySelector(".stamp-right");
else if(choix === "OUT") s = topCard.querySelector(".stamp-down");
if(s) s.style.opacity = 1;
ejecterCarteTrain(topCard, choix);
}
function ejecterCarteTrain(card, choix){
TRAIN_ANIM_EN_COURS = true; card.classList.add("tcard-fly");
var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { type: "separe" };
if(cfgS.type === "separe"){
if(choix === "G1") card.style.transform = "translate3d(-460px, 20px, 0) rotate(-28deg)";
else if(choix === "G2") card.style.transform = "translate3d(460px, 20px, 0) rotate(28deg)";
else if(choix === "OUT") card.style.transform = "translate3d(0, 460px, 0) rotate(6deg)";
} else {
if(choix === "OUT" || choix === "MENAGE") card.style.transform = "translate3d(-460px, 20px, 0) rotate(-28deg)";
else card.style.transform = "translate3d(460px, 20px, 0) rotate(28deg)";
}
setTimeout(function(){
var nom = card.getAttribute("data-nom");
var pool = document.getElementById("trZonePool");
var el = Array.from(pool.children).find(function(c){ return c.getAttribute("data-nom") === nom; });
if(el){
TRAIN_SWIPE_HISTORIQUE.push({ element: el, nom: nom, choix: choix });
if(choix === "G1" && document.getElementById("trZone_g1")) document.getElementById("trZone_g1").appendChild(el);
else if(choix === "G2" && document.getElementById("trZone_g2")) document.getElementById("trZone_g2").appendChild(el);
else if(choix === "RETENU" && document.getElementById("trZone_retenus")) document.getElementById("trZone_retenus").appendChild(el);
else if(choix === "ACTIF" && document.getElementById("trZone_actifs")) document.getElementById("trZone_actifs").appendChild(el);
else if(choix === "MENAGE" && document.getElementById("trZone_menages")) document.getElementById("trZone_menages").appendChild(el);
else pool.removeChild(el);
}
TRAIN_ANIM_EN_COURS = false; afficherCarteTrainTinder();
}, 240);
}
function annulerDernierSwipeTrain(){
if(!TRAIN_SWIPE_HISTORIQUE.length) return;
var dernier = TRAIN_SWIPE_HISTORIQUE.pop();
var pool = document.getElementById("trZonePool");
if(pool){ pool.insertBefore(dernier.element, pool.firstChild); majCompteursTrain(); afficherCarteTrainTinder(); }
}
function recommencerTrainSelection(){
var zG1 = document.getElementById("trZone_g1"); if(zG1) zG1.innerHTML = "";
var zG2 = document.getElementById("trZone_g2"); if(zG2) zG2.innerHTML = "";
var zRet = document.getElementById("trZone_retenus"); if(zRet) zRet.innerHTML = "";
var zAct = document.getElementById("trZone_actifs"); if(zAct) zAct.innerHTML = "";
var zMen = document.getElementById("trZone_menages"); if(zMen) zMen.innerHTML = "";
var pool = document.getElementById("trZonePool"); if(pool) pool.innerHTML = "";
var dispos = ENTRAINEMENTS[SEANCE_COURANTE] || [];
dispos.forEach(function(j){ if(pool) pool.appendChild(creerCarte(j)); });
TRAIN_SWIPE_HISTORIQUE = []; majCompteursTrain(); if(TRAIN_MODE_TINDER) afficherCarteTrainTinder();
}
function reinitialiserSeance(){ majVueEntrainement(); }
function preparerDonneesEntrainement(){
var cfgS = TRAIN_CONFIG[SEANCE_COURANTE] || { label: "Séance", type: "separe" };
var groupes = [];
if(cfgS.type === "separe"){
groupes.push({ nom: "Groupe 1", joueurs: extraireListeNoms("trZone_g1") });
groupes.push({ nom: "Groupe 2", joueurs: extraireListeNoms("trZone_g2") });
} else if(cfgS.type === "reduit"){
groupes.push({ nom: "Joueurs Retenus", joueurs: extraireListeNoms("trZone_retenus") });
} else {
groupes.push({ nom: "Plein Entraînement", joueurs: extraireListeNoms("trZone_actifs") });
groupes.push({ nom: "Ménagés / Adaptés", joueurs: extraireListeNoms("trZone_menages") });
}
return { seance: cfgS.label, typeSeance: cfgS.type, groupes: groupes, nonRetenus: extraireListeNoms("trZonePool") };
}
function creerMessageEntrainement(d){
var typeLabel = (d.typeSeance === "separe") ? "2 Groupes" : ((d.typeSeance === "reduit") ? "Effectif Réduit" : "Effectif Complet");
var lignes = ["*ENTRAÎNEMENT " + String(d.seance).toUpperCase() + " (" + typeLabel + ")*", ""];
d.groupes.forEach(function(g){
lignes.push("• *" + g.nom + "* (" + g.joueurs.length + ") :");
lignes.push(g.joueurs.length ? g.joueurs.map(function(n){ return "- " + formaterNomPourMessage(n); }).join("\n") : "Aucun");
lignes.push("");
});
return lignes.join("\n");
}
function sauvegarderEntrainement(publierWa){
var d = preparerDonneesEntrainement();
var msg = creerMessageEntrainement(d);
var stT = document.getElementById("statutTrain");
if(stT) stT.innerHTML = "<span class='spinner-badge'></span>Sauvegarde...";
afficherLoading("Enregistrement de la séance...", publierWa ? "Sauvegarde et publication sur WhatsApp..." : "Sauvegarde sur Google Sheets...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
if(stT) stT.textContent = "Sauvegardé (" + res.date + ")";
afficherToast(publierWa ? "Séance sauvegardée et diffusée sur WhatsApp !" : "Séance sauvegardée avec succès !", "succes");
if(typeof confetti === "function") confetti({ particleCount: 70, spread: 60 });
}).withFailureHandler(function(err){
masquerLoading();
if(stT) stT.textContent = "Erreur sauvegarde";
afficherToast("Erreur sauvegarde entraînement : " + err.message, "erreur");
}).enregistrerEntrainementEtPublier(d.seance, d.typeSeance, d.groupes, d.nonRetenus, publierWa, msg);
}
function ouvrirApercuEntrainement(){
var d = preparerDonneesEntrainement();
CONTEXTE_APERCU = { type: "train", donnees: d };
document.getElementById("previewTitle").textContent = "Aperçu - Entraînement " + d.seance;
var tWrap = document.getElementById("tacticalPreviewWrap"); if(tWrap) tWrap.style.display = "none";
var div = document.getElementById("previewMessages"); div.innerHTML = "";
var txt = document.createElement("textarea"); txt.className = "preview-text"; txt.id = "txtPreviewTrain"; txt.value = creerMessageEntrainement(d); div.appendChild(txt);
basculerVue("previewView");
}
function initSortables(){
  if(typeof Sortable === "undefined") return;
  try {
    ["zonePool","zone1B","zone1C","zone1D","zoneRepos"].forEach(function(id){
      var el = document.getElementById(id);
      if(el) new Sortable(el, { group: "shared", animation: 180, onSort: function(){ majCompteurs(); sauvegarderBrouillonLocal(false); }, onAdd: function(evt){
        if(id === "zone1B" || id === "zone1C" || id === "zone1D"){
          var dNom = evt.item ? evt.item.getAttribute("data-nom") : null;
          if(dNom){ verifierChouchouSelectionne(dNom); if(estJoueurMvp(dNom)) declencherAnimationMvp(dNom); if(estJoueurChevre(dNom)) declencherAnimationChevre(dNom); }
        }
      } });
    });
    var trPool = document.getElementById("trZonePool");
    if(trPool) new Sortable(trPool, { group: "trShared", animation: 180, onSort: majCompteursTrain });
    ["trZone_g1","trZone_g2","trZone_retenus","trZone_actifs","trZone_menages"].forEach(function(id){
      var el = document.getElementById(id);
      if(el) new Sortable(el, { group: "trShared", animation: 180, onSort: majCompteursTrain });
    });
  } catch(e){}
}
function rendreRosterGrid(){
var grid = document.getElementById("rosterGrid"); if(!grid) return; grid.innerHTML = "";
document.getElementById("rosterCount").textContent = EFFECTIF_COMPLET.length + " joueurs";
EFFECTIF_COMPLET.forEach(function(p){
var card = document.createElement("div"); card.className = "rcard"; card.onclick = function(){ ouvrirModalJoueur(p.nom); };
var isChou = estJoueurChouchou(p.nom);
var isMvp = estJoueurMvp(p.nom);
var isChevre = estJoueurChevre(p.nom);
var avCls = "pmini"; if(isChou) avCls += " is-chouchou"; if(isMvp) avCls += " is-mvp"; if(isChevre) avCls += " is-chevre";
var av = document.createElement("div"); av.className = avCls;
var rInit = (p.nom || "").trim().charAt(0).toUpperCase();
if(p.photo){ var img = document.createElement("img"); img.src = p.photo; img.onerror = function(){ this.remove(); av.textContent = rInit; }; av.appendChild(img); }
else { av.textContent = rInit; }
card.appendChild(av);
var inf = document.createElement("div"); inf.style.flex = "1"; inf.style.minWidth = "0";
var nm = document.createElement("div"); nm.style.fontWeight = "700"; nm.textContent = p.nom;
if(isChou){ var cB = document.createElement("span"); cB.className = "chouchou-badge"; cB.textContent = "❤️ Chouchou"; nm.appendChild(cB); }
if(isMvp){ var mB = document.createElement("span"); mB.className = "mvp-badge"; mB.textContent = "🏆 MVP"; nm.appendChild(mB); }
if(isChevre){ var chB = document.createElement("span"); chB.className = "chevre-badge"; chB.textContent = "🐐 Chèvre"; nm.appendChild(chB); }
inf.appendChild(nm);
var pst = document.createElement("div"); pst.style.fontSize = "0.78rem"; pst.style.color = "#d4d4d4"; pst.style.display = "flex"; pst.style.alignItems = "center"; pst.style.gap = "6px"; pst.style.flexWrap = "wrap";
var pstTxt = document.createElement("span"); pstTxt.textContent = p.poste || "Demi-Centre"; pst.appendChild(pstTxt);
if(p.equipe){
  var eqTag = document.createElement("span"); eqTag.style.fontSize = "0.7rem"; eqTag.style.padding = "2px 6px"; eqTag.style.borderRadius = "4px"; eqTag.style.background = "rgba(148,163,184,0.18)"; eqTag.style.color = "var(--color-primary)"; eqTag.style.fontWeight = "700"; eqTag.textContent = p.equipe; pst.appendChild(eqTag);
}
inf.appendChild(pst);
if(p.note){ var nt = document.createElement("div"); nt.className = "rnote"; nt.textContent = "Note : " + p.note; inf.appendChild(nt); }
card.appendChild(inf); grid.appendChild(card);
});
}
function formaterNumeroAffichage(t){
if(!t) return "";
var s = String(t).replace(/[^0-9]/g, "");
if(s.indexOf("33") === 0 && s.length === 11) s = "0" + s.substring(2);
if(s.length === 10) return s.slice(0,2) + " " + s.slice(2,4) + " " + s.slice(4,6) + " " + s.slice(6,8) + " " + s.slice(8,10);
return t;
}
function filtrerRoster(q){
var val = String(q || "").toLowerCase().trim();
Array.from(document.getElementById("rosterGrid").children).forEach(function(c){
c.style.display = c.textContent.toLowerCase().includes(val) ? "flex" : "none";
});
}
function majOptionsEquipesSelects(){
  var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;
  var cEqs = (CLUB_CONFIG && CLUB_CONFIG.equipes) || [];
  var selects = ["modalJoueurEquipe", "selNouvEquipe"];
  selects.forEach(function(selId){
    var sel = document.getElementById(selId);
    if(!sel) return;
    var curVal = sel.value;
    sel.innerHTML = "";
    for(var i = 1; i <= nbEq; i++){
      var eq = cEqs[i - 1] || {};
      var code = eq.code || ("Équipe " + i);
      var label = eq.nomSondage || eq.labelSondage || (CLUB_CONFIG && CLUB_CONFIG["nomEquipe" + i]) || ("Équipe " + i);
      var opt = document.createElement("option");
      opt.value = label;
      opt.setAttribute("data-code", code);
      opt.textContent = (code && code !== label) ? (code + " — " + label) : label;
      sel.appendChild(opt);
    }
    if(curVal) sel.value = curVal;
  });
}
function ouvrirModalJoueur(nom){
  JOUEUR_MODAL_COURANT = nom;
  var p = EFFECTIF_COMPLET.find(function(x){ return x.nom.toLowerCase() === nom.toLowerCase(); }) || { nom: nom, poste: "Demi-Centre", photo: "", note: "", tel: "", equipe: "Équipe 1", estTresorier: false };
  document.getElementById("modalJoueurNom").textContent = p.nom;
  document.getElementById("modalJoueurPoste").value = p.poste || "Demi-Centre";
  document.getElementById("modalJoueurNote").value = p.note || "";
  if(document.getElementById("modalJoueurTel")) document.getElementById("modalJoueurTel").value = formaterNumeroAffichage(p.tel) || "";
  var boxTres = document.getElementById("boxModalJoueurTresorier");
  var chkTres = document.getElementById("modalJoueurTresorier");
  if(boxTres) boxTres.style.display = (EST_COACH || EST_TRESORIER) ? "flex" : "none";
  if(chkTres){ chkTres.checked = !!p.estTresorier; chkTres.disabled = !EST_COACH; }
  majOptionsEquipesSelects();
  var selEq = document.getElementById("modalJoueurEquipe");
  if(selEq){
    var eqCherchee = String(p.equipe || "").trim().toLowerCase();
    var matchOk = false;
    for(var oi = 0; oi < selEq.options.length; oi++){
      var opt = selEq.options[oi];
      var oVal = opt.value.toLowerCase();
      var oCode = (opt.getAttribute("data-code") || "").toLowerCase();
      if(oVal === eqCherchee || oCode === eqCherchee || eqCherchee.indexOf(oVal) !== -1 || eqCherchee.indexOf(oCode) !== -1 || oVal.indexOf(eqCherchee) !== -1){
        selEq.selectedIndex = oi;
        matchOk = true;
        break;
      }
    }
    if(!matchOk && selEq.options.length > 0) selEq.selectedIndex = 0;
  }
  document.getElementById("modalJoueurStatus").textContent = "";
  PHOTO_MODAL_DATA = undefined;
  var inpPhotoUrl = document.getElementById("modalJoueurPhotoUrl");
  if(inpPhotoUrl) inpPhotoUrl.value = (p.photo && p.photo.indexOf("http") === 0) ? p.photo : "";
  var mImg = document.getElementById("modalJoueurImg"), mInit = document.getElementById("modalJoueurInitiale");
  var bdrop = document.getElementById("modalJoueurBackdrop");
  if(bdrop) bdrop.style.opacity = "0";
  var pInit = (p.nom || "").trim().charAt(0).toUpperCase();
  mInit.textContent = pInit;
  if(p.photo){
    mImg.src = p.photo; mImg.style.display = "block"; mInit.style.display = "none";
    if(bdrop){ bdrop.style.backgroundImage = "url('" + p.photo + "')"; setTimeout(function(){ if(bdrop) bdrop.style.opacity = "0.55"; }, 50); }
    mImg.onerror = function(){ mImg.style.display = "none"; mInit.style.display = "flex"; if(bdrop){ bdrop.style.opacity = "0"; bdrop.style.backgroundImage = "none"; } };
  } else {
    mImg.style.display = "none"; mInit.style.display = "flex";
    if(bdrop){ bdrop.style.opacity = "0"; bdrop.style.backgroundImage = "none"; }
  }
  var isChou = estJoueurChouchou(nom);
  majBoutonChouchouModal(isChou);
  var isMvp = estJoueurMvp(nom);
  majBoutonMvpModal(isMvp);
  var isCh = estJoueurChevre(nom);
  majBoutonChevreModal(isCh);
  document.getElementById("modalJoueurBg").style.display = "flex";
}
function fermerModalJoueur(){ var bdrop = document.getElementById("modalJoueurBackdrop"); if(bdrop) bdrop.style.opacity = "0"; document.getElementById("modalJoueurBg").style.display = "none"; }
function fermerModalSurBg(e){ if(e.target.id === "modalJoueurBg") fermerModalJoueur(); }
var DERNIERE_INONDATION_COEURS = 0;
function declencherInondationCoeurs(nomJoueur){
  var now = Date.now();
  if(now - DERNIERE_INONDATION_COEURS < 2200) return;
  DERNIERE_INONDATION_COEURS = now;
  var cont = document.createElement("div"); cont.id = "chouchouHeartRain";
  cont.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999999;overflow:hidden;box-shadow:inset 0 0 100px rgba(244,63,94,0.35);transition:opacity 0.4s ease;";
  var banner = document.createElement("div");
  banner.style.cssText = "position:absolute;top:18%;left:50%;transform:translate(-50%,-50%);background:linear-gradient(135deg,#e11d48,#be123c);color:#fff;padding:12px 24px;border-radius:999px;font-size:1.1rem;font-weight:900;letter-spacing:0.5px;box-shadow:0 8px 30px rgba(225,29,72,0.6);border:2px solid #fda4af;text-shadow:0 2px 4px rgba(0,0,0,0.4);display:flex;align-items:center;gap:10px;animation:chouchouPulse 1.2s infinite ease-in-out;";
  var txtNom = nomJoueur ? (nomJoueur + " — Le Chouchou en jeu !") : "Le Chouchou du coach est en jeu !";
  banner.innerHTML = "<span>💖</span> <span>" + txtNom + "</span> <span>❤️</span>";
  cont.appendChild(banner);
  var emojis = ["❤️", "💖", "💕", "💓", "💗", "💘", "🥰", "😍"];
  for(var i = 0; i < 48; i++){
    var p = document.createElement("div");
    p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    var size = 20 + Math.random() * 32;
    var left = Math.random() * 96;
    var dur = 1.2 + Math.random() * 0.8;
    var del = Math.random() * 0.4;
    p.style.cssText = "position:absolute;bottom:-40px;left:" + left + "%;font-size:" + size + "px;opacity:0;animation:floatHeartUp " + dur + "s ease-out " + del + "s forwards;text-shadow:0 0 10px rgba(244,63,94,0.6);";
    cont.appendChild(p);
  }
  document.body.appendChild(cont);
  if(typeof confetti === "function"){
    try { confetti({ particleCount: 45, spread: 80, origin: { y: 0.65 }, colors: ["#ff1493", "#e11d48", "#fda4af", "#fb7185", "#ffffff"] }); } catch(e){}
  }
  setTimeout(function(){
    cont.style.opacity = "0";
    setTimeout(function(){ if(cont.parentNode) cont.parentNode.removeChild(cont); }, 400);
  }, 2000);
}
function verifierChouchouSelectionne(nomJoueur){
  if(!nomJoueur || !CLUB_CONFIG || !CLUB_CONFIG.chouchou) return;
  if(estJoueurChouchou(nomJoueur)){
    declencherInondationCoeurs(nomJoueur);
  }
}
function majBoutonChouchouModal(isChou){
  var btn = document.getElementById("btnModalChouchou");
  var wrap = document.getElementById("modalJoueurAvatarWrap");
  if(wrap){
    if(isChou) wrap.classList.add("is-chouchou");
    else wrap.classList.remove("is-chouchou");
  }
  if(!btn) return;
  if(isChou){
    btn.innerHTML = "❤️ Mon Chouchou (Actif)";
    btn.style.background = "linear-gradient(135deg, #e11d48, #be123c)";
    btn.style.color = "#ffffff";
    btn.style.borderColor = "#fda4af";
    btn.style.boxShadow = "0 0 12px rgba(225,29,72,0.6)";
  } else {
    btn.innerHTML = "🤍 Choisir comme Chouchou";
    btn.style.background = "rgba(244,63,94,0.12)";
    btn.style.color = "#fda4af";
    btn.style.borderColor = "#f43f5e";
    btn.style.boxShadow = "none";
  }
}
function toggleChouchouCourant(){
  if(!JOUEUR_MODAL_COURANT) return;
  var cibleNom = String(JOUEUR_MODAL_COURANT).trim();
  var liste = (CLUB_CONFIG && CLUB_CONFIG.chouchou) ? String(CLUB_CONFIG.chouchou).split(",").map(function(s){ return s.trim(); }).filter(Boolean) : [];
  var idx = -1;
  for(var i=0; i<liste.length; i++){
    if(liste[i].toLowerCase() === cibleNom.toLowerCase()){ idx = i; break; }
  }
  var devientChouchou = (idx === -1);
  if(devientChouchou){
    liste.push(cibleNom);
  } else {
    liste.splice(idx, 1);
  }
  var nouveauChouchou = liste.join(", ");
  if(!CLUB_CONFIG) CLUB_CONFIG = {};
  CLUB_CONFIG.chouchou = nouveauChouchou;
  majBoutonChouchouModal(devientChouchou);
  rendreRosterGrid();
  initialiserColonnes();
  if(MODE_TINDER) afficherCarteTinder();
  if(typeof afficherApercuTactique === "function" && typeof EQUIPE_TACTIQUE_COURANTE !== "undefined" && EQUIPE_TACTIQUE_COURANTE){ afficherApercuTactique(EQUIPE_TACTIQUE_COURANTE); }
  if(devientChouchou){
    declencherInondationCoeurs(cibleNom);
    afficherToast(cibleNom + " est désormais dans les Chouchoux du coach ! ❤️", "succes");
  } else {
    afficherToast(cibleNom + " retiré des chouchoux.", "info");
  }
  google.script.run.withSuccessHandler(function(res){
    if(res && res.chouchou !== undefined) CLUB_CONFIG.chouchou = res.chouchou;
  }).withFailureHandler(function(err){
    afficherToast("Erreur enregistrement chouchou : " + err.message, "erreur");
  }).enregistrerChouchou(SESSION_TEL, SESSION_PIN, nouveauChouchou);
}
var DERNIERE_ANIM_MVP = 0;
function declencherAnimationMvp(nomJoueur){
  var now = Date.now();
  if(now - DERNIERE_ANIM_MVP < 2200) return;
  DERNIERE_ANIM_MVP = now;
  var cont = document.createElement("div"); cont.id = "mvpCelebrationRain";
  cont.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999999;overflow:hidden;box-shadow:inset 0 0 120px rgba(245,158,11,0.45);transition:opacity 0.4s ease;";
  var banner = document.createElement("div");
  banner.style.cssText = "position:absolute;top:18%;left:50%;transform:translate(-50%,-50%);background:linear-gradient(135deg,#d97706,#b45309);color:#fff;padding:12px 26px;border-radius:999px;font-size:1.15rem;font-weight:900;letter-spacing:0.5px;box-shadow:0 8px 30px rgba(245,158,11,0.7);border:2px solid #fde68a;text-shadow:0 2px 4px rgba(0,0,0,0.45);display:flex;align-items:center;gap:10px;animation:mvpPulse 1.2s infinite ease-in-out;";
  var txtNom = nomJoueur ? (nomJoueur + " — Élu(e) MVP du Match !") : "Élu(e) MVP du Match !";
  banner.innerHTML = "<span>🏆</span> <span>" + txtNom + "</span> <span>⭐</span>";
  cont.appendChild(banner);
  var emojis = ["🏆", "⭐", "🌟", "👑", "✨", "🥇", "🔥", "🎖️"];
  for(var i = 0; i < 48; i++){
    var p = document.createElement("div");
    p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    var size = 22 + Math.random() * 32;
    var left = Math.random() * 96;
    var dur = 1.2 + Math.random() * 0.8;
    var del = Math.random() * 0.4;
    p.style.cssText = "position:absolute;bottom:-40px;left:" + left + "%;font-size:" + size + "px;opacity:0;animation:floatGoldUp " + dur + "s ease-out " + del + "s forwards;text-shadow:0 0 12px rgba(245,158,11,0.7);";
    cont.appendChild(p);
  }
  document.body.appendChild(cont);
  if(typeof confetti === "function"){
    try { confetti({ particleCount: 70, spread: 90, origin: { y: 0.6 }, colors: ["#fbbf24", "#f59e0b", "#d97706", "#fef08a", "#ffffff"] }); } catch(e){}
  }
  setTimeout(function(){
    cont.style.opacity = "0";
    setTimeout(function(){ if(cont.parentNode) cont.parentNode.removeChild(cont); }, 400);
  }, 2100);
}
var DERNIERE_ANIM_CHEVRE = 0;
function declencherAnimationChevre(nomJoueur){
  var now = Date.now();
  if(now - DERNIERE_ANIM_CHEVRE < 2200) return;
  DERNIERE_ANIM_CHEVRE = now;
  var cont = document.createElement("div"); cont.id = "chevreCelebrationRain";
  cont.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999999;overflow:hidden;box-shadow:inset 0 0 120px rgba(234,88,12,0.45);transition:opacity 0.4s ease;";
  var banner = document.createElement("div");
  banner.style.cssText = "position:absolute;top:18%;left:50%;transform:translate(-50%,-50%);background:linear-gradient(135deg,#ea580c,#c2410c);color:#fff;padding:12px 26px;border-radius:999px;font-size:1.15rem;font-weight:900;letter-spacing:0.5px;box-shadow:0 8px 30px rgba(234,88,12,0.7);border:2px solid #fed7aa;text-shadow:0 2px 4px rgba(0,0,0,0.45);display:flex;align-items:center;gap:10px;animation:chevrePulse 1.2s infinite ease-in-out;";
  var txtNom = nomJoueur ? (nomJoueur + " — Trophée de la Chèvre !") : "Trophée de la Chèvre du Match !";
  banner.innerHTML = "<span>🐐</span> <span>" + txtNom + "</span> <span>🥬</span>";
  cont.appendChild(banner);
  var emojis = ["🐐", "🥬", "📯", "🎯", "🤾", "🎪", "🤡", "🧀"];
  for(var i = 0; i < 48; i++){
    var p = document.createElement("div");
    p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    var size = 22 + Math.random() * 32;
    var left = Math.random() * 96;
    var dur = 1.3 + Math.random() * 0.8;
    var del = Math.random() * 0.4;
    p.style.cssText = "position:absolute;top:-40px;left:" + left + "%;font-size:" + size + "px;opacity:0;animation:tumbleGoatDown " + dur + "s ease-out " + del + "s forwards;text-shadow:0 0 12px rgba(234,88,12,0.7);";
    cont.appendChild(p);
  }
  document.body.appendChild(cont);
  if(typeof confetti === "function"){
    try { confetti({ particleCount: 65, spread: 85, origin: { y: 0.35 }, colors: ["#f97316", "#ea580c", "#84cc16", "#fbbf24", "#ffffff"] }); } catch(e){}
  }
  setTimeout(function(){
    cont.style.opacity = "0";
    setTimeout(function(){ if(cont.parentNode) cont.parentNode.removeChild(cont); }, 400);
  }, 2100);
}
function majBoutonMvpModal(isMvp){
  var btn = document.getElementById("btnModalMvp"); if(!btn) return;
  if(isMvp){
    btn.innerHTML = "🏆 MVP du match (Actif)";
    btn.style.background = "linear-gradient(135deg, #d97706, #b45309)";
    btn.style.color = "#ffffff";
    btn.style.borderColor = "#fde68a";
    btn.style.boxShadow = "0 0 12px rgba(245,158,11,0.6)";
  } else {
    btn.innerHTML = "🏆 Désigner MVP";
    btn.style.background = "rgba(245,158,11,0.12)";
    btn.style.color = "#fde68a";
    btn.style.borderColor = "#f59e0b";
    btn.style.boxShadow = "none";
  }
}
function majBoutonChevreModal(isCh){
  var btn = document.getElementById("btnModalChevre"); if(!btn) return;
  if(isCh){
    btn.innerHTML = "🐐 Chèvre du match (Actif)";
    btn.style.background = "linear-gradient(135deg, #ea580c, #c2410c)";
    btn.style.color = "#ffffff";
    btn.style.borderColor = "#fed7aa";
    btn.style.boxShadow = "0 0 12px rgba(234,88,12,0.6)";
  } else {
    btn.innerHTML = "🐐 Désigner Chèvre";
    btn.style.background = "rgba(234,88,12,0.12)";
    btn.style.color = "#fed7aa";
    btn.style.borderColor = "#ea580c";
    btn.style.boxShadow = "none";
  }
}
function toggleMvpCourant(){
  if(!JOUEUR_MODAL_COURANT) return;
  var cibleNom = String(JOUEUR_MODAL_COURANT).trim();
  var etaitMvp = estJoueurMvp(cibleNom);
  var devientMvp = !etaitMvp;
  if(!CLUB_CONFIG) CLUB_CONFIG = {};
  CLUB_CONFIG.mvp = devientMvp ? cibleNom : "";
  majBoutonMvpModal(devientMvp);
  rendreRosterGrid();
  initialiserColonnes();
  if(MODE_TINDER) afficherCarteTinder();
  if(typeof afficherApercuTactique === "function" && typeof EQUIPE_TACTIQUE_COURANTE !== "undefined" && EQUIPE_TACTIQUE_COURANTE){ afficherApercuTactique(EQUIPE_TACTIQUE_COURANTE); }
  var txtM1 = document.getElementById("txtPreviewMatch"); if(txtM1 && CONTEXTE_APERCU && CONTEXTE_APERCU.type === "match" && CONTEXTE_APERCU.compo){ txtM1.value = creerMessageMatch(CONTEXTE_APERCU.compo); }
  if(devientMvp){
    declencherAnimationMvp(cibleNom);
    afficherToast(cibleNom + " est désigné(e) MVP du match ! 🏆", "succes");
  } else {
    afficherToast(cibleNom + " retiré du titre de MVP.", "info");
  }
  google.script.run.withSuccessHandler(function(res){
    if(res && res.mvp !== undefined) CLUB_CONFIG.mvp = res.mvp;
  }).withFailureHandler(function(err){
    afficherToast("Erreur enregistrement MVP : " + err.message, "erreur");
  }).enregistrerMvpDesignation(SESSION_TEL, SESSION_PIN, CLUB_CONFIG.mvp);
}
function toggleChevreCourant(){
  if(!JOUEUR_MODAL_COURANT) return;
  var cibleNom = String(JOUEUR_MODAL_COURANT).trim();
  var etaitChevre = estJoueurChevre(cibleNom);
  var devientChevre = !etaitChevre;
  if(!CLUB_CONFIG) CLUB_CONFIG = {};
  CLUB_CONFIG.chevre = devientChevre ? cibleNom : "";
  majBoutonChevreModal(devientChevre);
  rendreRosterGrid();
  initialiserColonnes();
  if(MODE_TINDER) afficherCarteTinder();
  if(typeof afficherApercuTactique === "function" && typeof EQUIPE_TACTIQUE_COURANTE !== "undefined" && EQUIPE_TACTIQUE_COURANTE){ afficherApercuTactique(EQUIPE_TACTIQUE_COURANTE); }
  var txtM2 = document.getElementById("txtPreviewMatch"); if(txtM2 && CONTEXTE_APERCU && CONTEXTE_APERCU.type === "match" && CONTEXTE_APERCU.compo){ txtM2.value = creerMessageMatch(CONTEXTE_APERCU.compo); }
  if(devientChevre){
    declencherAnimationChevre(cibleNom);
    afficherToast(cibleNom + " est désigné(e) Chèvre du match ! 🐐", "warning");
  } else {
    afficherToast(cibleNom + " retiré du titre de Chèvre.", "info");
  }
  google.script.run.withSuccessHandler(function(res){
    if(res && res.chevre !== undefined) CLUB_CONFIG.chevre = res.chevre;
  }).withFailureHandler(function(err){
    afficherToast("Erreur enregistrement Chèvre : " + err.message, "erreur");
  }).enregistrerChevreDesignation(SESSION_TEL, SESSION_PIN, CLUB_CONFIG.chevre);
}
function chargerPhotoDepuisModal(e){
var f = e.target.files[0]; if(!f) return;
var r = new FileReader();
r.onload = function(evt){
PHOTO_MODAL_DATA = evt.target.result;
var inpUrl = document.getElementById("modalJoueurPhotoUrl");
if(inpUrl) inpUrl.value = "";
var mImg = document.getElementById("modalJoueurImg");
var mInit = document.getElementById("modalJoueurInitiale");
mImg.src = PHOTO_MODAL_DATA;
mImg.style.display = "block";
mInit.style.display = "none";
var bdrop = document.getElementById("modalJoueurBackdrop");
if(bdrop){ bdrop.style.backgroundImage = "url('" + PHOTO_MODAL_DATA + "')"; bdrop.style.opacity = "0.55"; }
document.getElementById("modalJoueurStatus").textContent = "Photo prête à être enregistrée.";
};
r.readAsDataURL(f);
}
function changerUrlPhotoCoach(url){
var u = String(url || "").trim();
var mImg = document.getElementById("modalJoueurImg");
var mInit = document.getElementById("modalJoueurInitiale");
var bdrop = document.getElementById("modalJoueurBackdrop");
if(u){
PHOTO_MODAL_DATA = u;
mImg.src = u;
mImg.style.display = "block";
mInit.style.display = "none";
if(bdrop){ bdrop.style.backgroundImage = "url('" + u + "')"; bdrop.style.opacity = "0.55"; }
mImg.onerror = function(){
mImg.style.display = "none";
mInit.style.display = "flex";
if(bdrop){ bdrop.style.opacity = "0"; bdrop.style.backgroundImage = "none"; }
};
document.getElementById("modalJoueurStatus").textContent = "Lien photo prêt à être enregistré.";
} else {
PHOTO_MODAL_DATA = "__EFFACER__";
mImg.src = "";
mImg.style.display = "none";
mInit.style.display = "flex";
if(bdrop){ bdrop.style.opacity = "0"; bdrop.style.backgroundImage = "none"; }
document.getElementById("modalJoueurStatus").textContent = "Photo retirée.";
}
}
function effacerPhotoModalCoach(){
var inp = document.getElementById("modalJoueurPhotoUrl");
if(inp) inp.value = "";
changerUrlPhotoCoach("");
}
function sauvegarderFicheDepuisModal(){
if(!JOUEUR_MODAL_COURANT) return;
document.getElementById("modalJoueurStatus").innerHTML = "<span class='spinner-badge'></span>Enregistrement...";
afficherLoading("Fiche Joueur...", "Enregistrement des informations de " + JOUEUR_MODAL_COURANT + "...");
var np = document.getElementById("modalJoueurPoste").value, nn = document.getElementById("modalJoueurNote").value;
var nTel = document.getElementById("modalJoueurTel") ? document.getElementById("modalJoueurTel").value.trim() : "";
var nEq = document.getElementById("modalJoueurEquipe") ? document.getElementById("modalJoueurEquipe").value : "Équipe 1";
var chkTres = document.getElementById("modalJoueurTresorier");
var estTres = chkTres ? chkTres.checked : false;
var photoAEnvoyer = undefined;
if(PHOTO_MODAL_DATA === "__EFFACER__"){
photoAEnvoyer = "";
} else if(PHOTO_MODAL_DATA !== undefined){
photoAEnvoyer = PHOTO_MODAL_DATA;
}
var jCible = { nom: JOUEUR_MODAL_COURANT, poste: np, note: nn, tel: nTel, equipe: nEq, estTresorier: estTres };
if(photoAEnvoyer !== undefined){ jCible.photo = photoAEnvoyer; }
google.script.run.withSuccessHandler(function(res){
masquerLoading();
document.getElementById("modalJoueurStatus").textContent = "Enregistré avec succès !";
afficherToast("Fiche de " + res.joueur.nom + " mise à jour !", "succes");
var photoBusted = res.joueur.photo ? ajouterCacheBusterPhoto(res.joueur.photo) : "";
res.joueur.photo = photoBusted;
var idx = EFFECTIF_COMPLET.findIndex(function(x){ return x.nom.toLowerCase() === res.joueur.nom.toLowerCase(); });
if(idx !== -1) EFFECTIF_COMPLET[idx] = res.joueur;
actualiserPhotoDansMemoire(res.joueur.nom, photoBusted);
var jObj = JOUEURS.find(function(x){ return x.nom.toLowerCase() === res.joueur.nom.toLowerCase(); });
if(jObj){ jObj.poste = res.joueur.poste; jObj.photo = photoBusted; jObj.note = res.joueur.note; jObj.equipe = res.joueur.equipe; }
rendreRosterGrid(); initialiserColonnes();
if(SESSION_NOM && SESSION_NOM.toLowerCase() === res.joueur.nom.toLowerCase()){
majEspaceJoueur(SESSION_NOM);
}
setTimeout(function(){ fermerModalJoueur(); }, 800);
}).withFailureHandler(function(err){
masquerLoading();
document.getElementById("modalJoueurStatus").textContent = err.message;
afficherToast(err.message, "erreur");
}).enregistrerFicheJoueurParCoach(SESSION_TEL, SESSION_PIN, jCible);
}
function supprimerJoueurCourant(){
if(!JOUEUR_MODAL_COURANT) return;
if(!confirm("Voulez-vous vraiment supprimer " + JOUEUR_MODAL_COURANT + " de l'effectif du club ?")) return;
document.getElementById("modalJoueurStatus").innerHTML = "<span class='spinner-badge'></span>Suppression en cours...";
afficherLoading("Suppression...", "Mise à jour de l'effectif du club...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
afficherToast("Joueur " + JOUEUR_MODAL_COURANT + " supprimé de l'effectif.", "info");
EFFECTIF_COMPLET = EFFECTIF_COMPLET.filter(function(x){ return x.nom.toLowerCase() !== JOUEUR_MODAL_COURANT.toLowerCase(); });
JOUEURS = JOUEURS.filter(function(x){ return x.nom.toLowerCase() !== JOUEUR_MODAL_COURANT.toLowerCase(); });
rendreRosterGrid(); initialiserColonnes();
fermerModalJoueur();
}).withFailureHandler(function(err){
masquerLoading();
document.getElementById("modalJoueurStatus").textContent = err.message;
afficherToast(err.message, "erreur");
}).supprimerJoueurParCoach(SESSION_TEL, SESSION_PIN, JOUEUR_MODAL_COURANT);
}
function ouvrirModalNouveauJoueur(){
document.getElementById("inpNouvNom").value = "";
document.getElementById("inpNouvTel").value = "";
if(document.getElementById("inpNouvPhoto")) document.getElementById("inpNouvPhoto").value = "";
document.getElementById("inpNouvNote").value = "";
document.getElementById("selNouvPoste").value = "Demi-Centre";
var boxNTres = document.getElementById("boxNouvJoueurTresorier");
var chkNTres = document.getElementById("inpNouvTresorier");
if(boxNTres) boxNTres.style.display = (EST_COACH || EST_TRESORIER) ? "flex" : "none";
if(chkNTres){ chkNTres.checked = false; chkNTres.disabled = !EST_COACH; }
majOptionsEquipesSelects();
if(document.getElementById("selNouvEquipe") && document.getElementById("selNouvEquipe").options.length > 0){
document.getElementById("selNouvEquipe").selectedIndex = 0;
}
document.getElementById("statusNouvJoueur").textContent = "";
document.getElementById("modalNouveauJoueurBg").style.display = "flex";
}
function fermerModalNouveauJoueur(){ document.getElementById("modalNouveauJoueurBg").style.display = "none"; }
function fermerModalNouveauJoueurSurBg(e){ if(e.target.id === "modalNouveauJoueurBg") fermerModalNouveauJoueur(); }
function creerNouveauJoueurClient(){
var nom = document.getElementById("inpNouvNom").value.trim();
if(!nom){ document.getElementById("statusNouvJoueur").textContent = "Le nom est obligatoire."; return; }
var tel = document.getElementById("inpNouvTel").value.trim();
var photo = document.getElementById("inpNouvPhoto") ? document.getElementById("inpNouvPhoto").value.trim() : "";
var poste = document.getElementById("selNouvPoste").value;
var eq = document.getElementById("selNouvEquipe").value;
var note = document.getElementById("inpNouvNote").value.trim();
var chkNTres = document.getElementById("inpNouvTresorier");
var estNTres = (chkNTres && EST_COACH) ? chkNTres.checked : false;
document.getElementById("statusNouvJoueur").innerHTML = "<span class='spinner-badge'></span>Création du joueur...";
afficherLoading("Ajout du joueur...", "Création de la fiche de " + nom + "...");
google.script.run.withSuccessHandler(function(res){
masquerLoading();
afficherToast("Joueur " + res.joueur.nom + " ajouté à l'effectif !", "succes");
EFFECTIF_COMPLET.push(res.joueur);
rendreRosterGrid();
fermerModalNouveauJoueur();
}).withFailureHandler(function(err){
masquerLoading();
document.getElementById("statusNouvJoueur").textContent = err.message;
afficherToast(err.message, "erreur");
}).ajouterJoueurParCoach(SESSION_TEL, SESSION_PIN, { nom: nom, tel: tel, poste: poste, equipe: eq, photo: photo, note: note, estTresorier: estNTres });
}
var MODAL_RENFORT_IS_TRAIN = false;
function ouvrirModalRenfort(estTrain){
MODAL_RENFORT_IS_TRAIN = !!estTrain;
document.getElementById("inpFiltreRenfort").value = "";
if(document.getElementById("inpInviteNom")) document.getElementById("inpInviteNom").value = "";
rendreListeRenforts("");
document.getElementById("modalRenfortBg").style.display = "flex";
}
function fermerModalRenfort(){ document.getElementById("modalRenfortBg").style.display = "none"; }
function fermerModalRenfortSurBg(e){ if(e.target.id === "modalRenfortBg") fermerModalRenfort(); }
function filtrerListeRenforts(filtre){ rendreListeRenforts(filtre); }
function rendreListeRenforts(filtre){
var container = document.getElementById("listeRenfortsDispos"); if(!container) return;
container.innerHTML = "";
var q = String(filtre || "").toLowerCase().trim();
var dejaNoms = [];
if(MODAL_RENFORT_IS_TRAIN){
dejaNoms = (ENTRAINEMENTS[SEANCE_COURANTE] || []).map(function(x){ return x.nom.toLowerCase(); });
} else {
dejaNoms = (JOUEURS || []).map(function(x){ return x.nom.toLowerCase(); });
}
var dispoAjout = EFFECTIF_COMPLET.filter(function(x){
if(dejaNoms.indexOf(x.nom.toLowerCase()) !== -1) return false;
if(q && !x.nom.toLowerCase().includes(q)) return false;
return true;
});
if(dispoAjout.length === 0){
container.innerHTML = "<div style='color:#94a3b8;font-size:0.75rem;padding:8px;text-align:center;'>Aucun autre joueur disponible dans l'effectif.</div>";
return;
}
dispoAjout.forEach(function(j){
var row = document.createElement("div");
row.style.display = "flex"; row.style.alignItems = "center"; row.style.justifyContent = "space-between";
row.style.background = "#090d16"; row.style.padding = "8px 10px"; row.style.borderRadius = "8px"; row.style.border = "1px solid rgba(148,163,184,0.12)";
var info = document.createElement("div");
info.innerHTML = "<div style='font-weight:700;font-size:0.82rem;color:#f8fafc;'>" + j.nom + "</div><div style='font-size:0.7rem;color:#94a3b8;'>" + (j.poste || "Demi-Centre") + (j.equipe ? (" • " + j.equipe) : "") + "</div>";
var btn = document.createElement("button");
btn.className = "btn-enter"; btn.style.padding = "5px 10px"; btn.style.fontSize = "0.75rem"; btn.style.width = "auto"; btn.style.margin = "0";
btn.textContent = "+ Sélectionner";
btn.onclick = function(){ ajouterRenfortClient(j.nom); };
row.appendChild(info); row.appendChild(btn); container.appendChild(row);
});
}
function ajouterRenfortClient(nomJoueur){
var p = EFFECTIF_COMPLET.find(function(x){ return x.nom.toLowerCase() === nomJoueur.toLowerCase(); });
if(!p) return;
var rj = { nom: p.nom, poste: p.poste || "Demi-Centre", photo: p.photo || "", note: p.note || "", entrainements: 0, dispo1B: true, dispo1C: true, dispo1D: true, renfort: true };
if(MODAL_RENFORT_IS_TRAIN){
if(!ENTRAINEMENTS[SEANCE_COURANTE]) ENTRAINEMENTS[SEANCE_COURANTE] = [];
ENTRAINEMENTS[SEANCE_COURANTE].push(rj);
var trPool = document.getElementById("trZonePool");
if(trPool) trPool.appendChild(creerCarte(rj));
majCompteursTrain(); initSortables();
} else {
JOUEURS.push(rj);
var pool = document.getElementById("zonePool");
if(pool) pool.appendChild(creerCarte(rj));
majCompteurs(); initSortables(); sauvegarderBrouillonLocal(false);
if(MODE_TINDER) afficherCarteTinder();
}
afficherToast("Renfort " + p.nom + " ajouté !", "succes");
fermerModalRenfort();
}
function ajouterInviteClient(){
var nom = document.getElementById("inpInviteNom").value.trim();
if(!nom){ afficherToast("Veuillez saisir le nom de l'invité.", "erreur"); return; }
var poste = document.getElementById("selInvitePoste").value;
var rj = { nom: nom, poste: poste, photo: "", note: "Invité extérieur", entrainements: 0, dispo1B: true, dispo1C: true, dispo1D: true, renfort: true };
if(MODAL_RENFORT_IS_TRAIN){
if(!ENTRAINEMENTS[SEANCE_COURANTE]) ENTRAINEMENTS[SEANCE_COURANTE] = [];
ENTRAINEMENTS[SEANCE_COURANTE].push(rj);
var trPool = document.getElementById("trZonePool");
if(trPool) trPool.appendChild(creerCarte(rj));
majCompteursTrain(); initSortables();
} else {
JOUEURS.push(rj);
var pool = document.getElementById("zonePool");
if(pool) pool.appendChild(creerCarte(rj));
majCompteurs(); initSortables(); sauvegarderBrouillonLocal(false);
if(MODE_TINDER) afficherCarteTinder();
}
afficherToast("Invité " + nom + " ajouté !", "succes");
fermerModalRenfort();
}
function getCollectifsSauvegardes(){
try {
var s = localStorage.getItem("hb_multi_collectifs");
if(s) return JSON.parse(s);
} catch(e){}
return [];
}
function sauvegarderCollectifsLocal(liste){
try { localStorage.setItem("hb_multi_collectifs", JSON.stringify(liste)); } catch(e){}
}
function ouvrirModalCollectifs(){
rendreListeCollectifs();
document.getElementById("modalCollectifsBg").style.display = "flex";
}
function fermerModalCollectifs(){ document.getElementById("modalCollectifsBg").style.display = "none"; }
function fermerModalCollectifsSurBg(e){ if(e.target.id === "modalCollectifsBg") fermerModalCollectifs(); }
function rendreListeCollectifs(){
var container = document.getElementById("listeCollectifs"); if(!container) return;
container.innerHTML = "";
var colls = getCollectifsSauvegardes();
var itemCur = document.createElement("div");
itemCur.style.display = "flex"; itemCur.style.alignItems = "center"; itemCur.style.justifyContent = "space-between"; itemCur.style.background = "#0e1626"; itemCur.style.padding = "10px 12px"; itemCur.style.borderRadius = "10px"; itemCur.style.border = "1px solid var(--color-primary)";
itemCur.innerHTML = "<div><div style='font-weight:800;font-size:0.85rem;color:#f8fafc;'>" + (CLUB_CONFIG.nomClub || "Collectif Actuel") + "</div><div style='font-size:0.7rem;color:#94a3b8;'>Collectif en cours d'utilisation</div></div><span style='font-size:0.72rem;background:var(--color-primary);color:#fff;padding:3px 8px;border-radius:12px;font-weight:700;'>Actif</span>";
container.appendChild(itemCur);
colls.forEach(function(c, idx){
var row = document.createElement("div");
row.style.display = "flex"; row.style.alignItems = "center"; row.style.justifyContent = "space-between"; row.style.background = "#090d16"; row.style.padding = "10px 12px"; row.style.borderRadius = "10px"; row.style.border = "1px solid rgba(148,163,184,0.15)";
var info = document.createElement("div");
info.innerHTML = "<div style='font-weight:700;font-size:0.85rem;color:#e2e8f0;'>" + c.nom + "</div><div style='font-size:0.68rem;color:#94a3b8;word-break:break-all;'>" + c.url.substring(0, 40) + "...</div>";
var acts = document.createElement("div"); acts.style.display = "flex"; acts.style.gap = "6px";
var btnGo = document.createElement("button"); btnGo.className = "btn-enter"; btnGo.style.padding = "5px 10px"; btnGo.style.fontSize = "0.75rem"; btnGo.style.width = "auto"; btnGo.style.margin = "0"; btnGo.textContent = "Basculer";
btnGo.onclick = function(){ window.location.href = c.url; };
var btnDel = document.createElement("button"); btnDel.className = "btn-reset"; btnDel.style.padding = "4px 8px"; btnDel.style.fontSize = "0.75rem"; btnDel.textContent = "✕";
btnDel.onclick = function(){ colls.splice(idx, 1); sauvegarderCollectifsLocal(colls); rendreListeCollectifs(); };
acts.appendChild(btnGo); acts.appendChild(btnDel); row.appendChild(info); row.appendChild(acts); container.appendChild(row);
});
}
function ajouterCollectifLie(){
var nom = document.getElementById("inpNouvCollectifNom").value.trim();
var url = document.getElementById("inpNouvCollectifUrl").value.trim();
if(!nom || !url){ afficherToast("Veuillez saisir un nom et une URL valide.", "erreur"); return; }
if(!url.startsWith("http://") && !url.startsWith("https://")){ afficherToast("L'URL doit commencer par https://", "erreur"); return; }
var colls = getCollectifsSauvegardes();
colls.push({ nom: nom, url: url });
sauvegarderCollectifsLocal(colls);
document.getElementById("inpNouvCollectifNom").value = "";
document.getElementById("inpNouvCollectifUrl").value = "";
afficherToast("Collectif " + nom + " lié avec succès !", "succes");
rendreListeCollectifs();
}
var DEFERRED_PWA_PROMPT = null;
window.addEventListener("beforeinstallprompt", function(e){
e.preventDefault();
DEFERRED_PWA_PROMPT = e;
var b = document.getElementById("btnPwaNativeInstall");
if(b) b.style.display = "block";
});
function gererToucheClavier(e){
var k = e.key || ""; var code = e.code || "";
if(k === "Escape"){
if(typeof fermerModalJoueur === "function") fermerModalJoueur();
if(typeof fermerModalRenfort === "function") fermerModalRenfort();
if(typeof fermerModalCollectifs === "function") fermerModalCollectifs();
if(typeof fermerModalConfigEntrainements === "function") fermerModalConfigEntrainements();
if(typeof fermerModalGuideCoach === "function") fermerModalGuideCoach();
if(typeof fermerModalNouveauJoueur === "function") fermerModalNouveauJoueur();
if(typeof fermerModalMvp === "function") fermerModalMvp();
if(typeof fermerModalChevre === "function") fermerModalChevre();
if(typeof fermerModalMvpChevre === "function") fermerModalMvpChevre();
if(typeof fermerModalCovoiturage === "function") fermerModalCovoiturage();
if(typeof fermerModalAbsence === "function") fermerModalAbsence();
if(typeof fermerProfilJoueurPublic === "function") fermerProfilJoueurPublic();
if(typeof fermerModalCaisseNoire === "function") fermerModalCaisseNoire();
if(typeof fermerModalAdminCaisseNoire === "function") fermerModalAdminCaisseNoire();
return;
}
var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : "";
if(tag === "input" || tag === "textarea" || tag === "select" || (document.activeElement && document.activeElement.isContentEditable)) return;
var modales = document.querySelectorAll(".modal-bg");
for(var mi = 0; mi < modales.length; mi++){
var m = modales[mi];
if(m && (m.style.display === "flex" || m.style.display === "block")) return;
}
var ctrl = e.ctrlKey || e.metaKey;
var isLeft = (k === "ArrowLeft" || code === "ArrowLeft" || code === "KeyA" || code === "KeyQ");
var isRight = (k === "ArrowRight" || code === "ArrowRight" || code === "KeyD");
var isDown = (k === "ArrowDown" || code === "ArrowDown" || code === "KeyS");
var isUp = (k === "ArrowUp" || code === "ArrowUp" || code === "KeyW" || code === "KeyZ");
var is1 = (k === "1" || k === "&" || code === "Digit1" || code === "Numpad1");
var is2 = (k === "2" || k === "é" || code === "Digit2" || code === "Numpad2");
var is3 = (k === "3" || k === "\"" || code === "Digit3" || code === "Numpad3");
var is0orSpace = (k === "0" || k === "à" || code === "Digit0" || code === "Numpad0" || k === " " || code === "Space");
var isUndo = (k === "Backspace" || code === "Backspace" || (ctrl && (code === "KeyZ" || k === "z" || k === "Z")) || k === "u" || k === "U");
if(is0orSpace && document.activeElement && document.activeElement.tagName === "BUTTON"){
document.activeElement.blur();
}
var tView = document.getElementById("tinderView");
var isMatchTinder = MODE_TINDER && tView && (tView.style.display === "block" || getComputedStyle(tView).display !== "none");
if(isMatchTinder){
var nbEq = (CLUB_CONFIG && CLUB_CONFIG.nbEquipes) || 2;
if(isUndo){ e.preventDefault(); annulerDernierSwipe(); return; }
if(nbEq === 1){
if(isLeft || isDown || is0orSpace){ e.preventDefault(); animerVoteBouton("OUT"); }
else if(isRight || isUp || is1){ e.preventDefault(); animerVoteBouton("1B"); }
} else if(nbEq === 2){
if(isLeft || is1){ e.preventDefault(); animerVoteBouton("1B"); }
else if(isRight || is2){ e.preventDefault(); animerVoteBouton("1C"); }
else if(isDown || is0orSpace){ e.preventDefault(); animerVoteBouton("OUT"); }
} else {
if(isUp || is1){ e.preventDefault(); animerVoteBouton("1B"); }
else if(isLeft || is2){ e.preventDefault(); animerVoteBouton("1C"); }
else if(isRight || is3){ e.preventDefault(); animerVoteBouton("1D"); }
else if(isDown || is0orSpace){ e.preventDefault(); animerVoteBouton("OUT"); }
}
return;
}
var trView = document.getElementById("trainTinderView");
var isTrainTinder = TRAIN_MODE_TINDER && trView && (trView.style.display === "block" || getComputedStyle(trView).display !== "none");
if(isTrainTinder){
var cfgS = (TRAIN_CONFIG && TRAIN_CONFIG[SEANCE_COURANTE]) ? TRAIN_CONFIG[SEANCE_COURANTE] : { type: "separe" };
if(isUndo){ e.preventDefault(); annulerDernierSwipeTrain(); return; }
if(cfgS.type === "separe"){
if(isLeft || is1){ e.preventDefault(); animerVoteBoutonTrain("G1"); }
else if(isRight || is2){ e.preventDefault(); animerVoteBoutonTrain("G2"); }
else if(isDown || is0orSpace){ e.preventDefault(); animerVoteBoutonTrain("OUT"); }
} else if(cfgS.type === "reduit"){
if(isLeft || isDown || is0orSpace){ e.preventDefault(); animerVoteBoutonTrain("OUT"); }
else if(isRight || isUp || is1){ e.preventDefault(); animerVoteBoutonTrain("RETENU"); }
} else {
if(isLeft || isDown || is0orSpace){ e.preventDefault(); animerVoteBoutonTrain("MENAGE"); }
else if(isRight || isUp || is1){ e.preventDefault(); animerVoteBoutonTrain("ACTIF"); }
}
return;
}
}
window.addEventListener("keydown", gererToucheClavier);
function ouvrirModalPwa(){
var isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
var iosG = document.getElementById("pwaIosGuide"), andG = document.getElementById("pwaAndroidGuide");
if(isIos){
if(iosG) iosG.style.display = "block";
if(andG) andG.style.display = "none";
} else {
if(iosG) iosG.style.display = "none";
if(andG) andG.style.display = "block";
}
document.getElementById("modalPwaInstallBg").style.display = "flex";
}
function fermerModalPwa(){ document.getElementById("modalPwaInstallBg").style.display = "none"; }
function fermerModalPwaSurBg(e){ if(e.target.id === "modalPwaInstallBg") fermerModalPwa(); }
function ouvrirModalGuideCoach(){ document.getElementById("modalGuideCoachBg").style.display = "flex"; }
function fermerModalGuideCoach(){ document.getElementById("modalGuideCoachBg").style.display = "none"; }
function fermerModalGuideCoachSurBg(e){ if(e.target.id === "modalGuideCoachBg") fermerModalGuideCoach(); }
function declencherPwaNative(){
if(DEFERRED_PWA_PROMPT){
DEFERRED_PWA_PROMPT.prompt();
DEFERRED_PWA_PROMPT.userChoice.then(function(choice){
if(choice.outcome === "accepted"){ afficherToast("Application installée avec succès !", "succes"); fermerModalPwa(); }
DEFERRED_PWA_PROMPT = null;
});
} else {
afficherToast("Suivez les indications de votre navigateur pour installer l'icône.", "info");
}
}
function afficherToast(msg, type, duree){
type = type || "info"; duree = duree || 3500;
var c = document.getElementById("toastContainer");
if(!c){
c = document.createElement("div"); c.id = "toastContainer"; document.body.appendChild(c);
}
var item = document.createElement("div");
item.className = "toast-item toast-" + type;
item.textContent = msg;
c.appendChild(item);
setTimeout(function(){
item.style.opacity = "0"; item.style.transform = "translateY(10px)"; item.style.transition = "all 0.3s ease";
setTimeout(function(){ if(item.parentNode) item.parentNode.removeChild(item); }, 300);
}, duree);
}
var APP_DEMARREE = false;
// ============================================================================
// GESTION DES 3 MODES DE FONCTIONNEMENT (FLAVORS)
// FFHB_ONLY (Zéro WhatsApp) | PRESENCES_ONLY (Loisir) | COMPLET (WhatsApp Bot)
// ============================================================================
var MODE_FONCTIONNEMENT = localStorage.getItem("hb_mode") || (typeof CLUB_CONFIG !== "undefined" && CLUB_CONFIG.modeFonctionnement) || "FFHB_ONLY";

function changerModeFonctionnement(mode) {
  if (!['FFHB_ONLY', 'PRESENCES_ONLY', 'COMPLET'].includes(mode)) return;
  MODE_FONCTIONNEMENT = mode;
  try {
    localStorage.setItem("hb_mode", mode);
    if (typeof CLUB_CONFIG !== "undefined") CLUB_CONFIG.modeFonctionnement = mode;
  } catch (e) {}

  appliquerModeFonctionnementVisuel(mode);

  if (window.google && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function() {
      afficherToast("Mode " + getNomMode(mode) + " enregistré !", "succes");
    }).withFailureHandler(function(err) {
      console.warn("Synchronisation mode sheet :", err);
    }).enregistrerModeFonctionnement(mode);
  } else {
    afficherToast("Mode " + getNomMode(mode) + " activé !", "succes");
  }
}

function getNomMode(mode) {
  if (mode === "FFHB_ONLY") return "FFHB Seul (Zéro WhatsApp)";
  if (mode === "PRESENCES_ONLY") return "Loisir / Présences Seules";
  return "Complet Automatique";
}

function appliquerModeFonctionnementVisuel(mode) {
  var m = mode || MODE_FONCTIONNEMENT || "FFHB_ONLY";
  var btnF = document.getElementById("btnModeFFHB");
  var btnL = document.getElementById("btnModeLoisir");
  var btnC = document.getElementById("btnModeComplet");
  var lbl = document.getElementById("lblModeActif");
  var bDesc = document.getElementById("badgeModeDesc");
  var bWhatsApp = document.getElementById("badgeStatusWhatsApp");
  var matchHub = document.getElementById("matchHubBanner");

  [btnF, btnL, btnC].forEach(function(b) {
    if (b) {
      b.style.background = "rgba(15,23,42,0.8)";
      b.style.color = "#94a3b8";
      b.style.borderColor = "rgba(255,255,255,0.1)";
    }
  });

  if (m === "FFHB_ONLY") {
    if (btnF) { btnF.style.background = "#1e3a8a"; btnF.style.color = "#fff"; btnF.style.borderColor = "#3b82f6"; }
    if (lbl) lbl.textContent = "🏆 Mode FFHB Uniquement";
    if (bDesc) { bDesc.textContent = "Scraping FFHB + Convocation manuelle (0 WhatsApp)"; bDesc.style.color = "#60a5fa"; }
    if (bWhatsApp) bWhatsApp.style.display = "none";
    if (matchHub) matchHub.style.display = "block";
    var btnPub = document.getElementById("btnPublishPreview");
    if (btnPub) { btnPub.textContent = "📢 Partager la Convocation"; btnPub.style.background = "#0284c7"; }
  } else if (m === "PRESENCES_ONLY") {
    if (btnL) { btnL.style.background = "#065f46"; btnL.style.color = "#fff"; btnL.style.borderColor = "#10b981"; }
    if (lbl) lbl.textContent = "📋 Mode Loisir / Présences";
    if (bDesc) { bDesc.textContent = "Trombinoscope + Présences entraînements"; bDesc.style.color = "#34d399"; }
    if (bWhatsApp) bWhatsApp.style.display = "none";
    if (matchHub) matchHub.style.display = "none";
  } else {
    if (btnC) { btnC.style.background = "#4338ca"; btnC.style.color = "#fff"; btnC.style.borderColor = "#6366f1"; }
    if (lbl) lbl.textContent = "⚡ Mode Complet Automatique";
    if (bDesc) { bDesc.textContent = "FFHB + Bot WhatsApp + Sondages auto"; bDesc.style.color = "#a5b4fc"; }
    if (bWhatsApp) bWhatsApp.style.display = "inline-flex";
    if (matchHub) matchHub.style.display = "block";
    var btnPub = document.getElementById("btnPublishPreview");
    if (btnPub) { btnPub.textContent = "Publier sur WhatsApp"; btnPub.style.background = "#16a34a"; }
  }
}

// Fonction de partage natif ou copie presse-papier
async function partagerTexteConvocation(texte) {
  if (!texte) return;
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Convocation Match",
        text: texte
      });
      afficherToast("Convocation partagée avec succès !", "succes");
      return;
    } catch (e) {
      if (e.name !== "AbortError") console.warn("Erreur navigator.share :", e);
    }
  }

  // Fallback presse-papier
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(texte);
      afficherToast("📋 Convocation copiée dans le presse-papier !", "succes");
    } else {
      afficherToast("Veuillez copier le texte ci-dessous", "info");
    }
  } catch (err) {
    afficherToast("Veuillez copier le texte manuellement", "info");
  }
}

function demarrerApp(){
  try { appliquerModeFonctionnementVisuel(); } catch(e){}
  if(APP_DEMARREE) return;
  APP_DEMARREE = true;
  try { initSortables(); } catch(e){}
  try { rendreOngletsTrain(); } catch(e){}
  try { majAffichageModesParDefaut(); } catch(e){}
  window.addEventListener("resize", majAffichageModesParDefaut);
  var aChargeDepuisCache = false;
  try {
    var rawCache = localStorage.getItem("hb_cache_data");
    var rawSess = localStorage.getItem("hb_session");
    if(rawSess){
      var sess = JSON.parse(rawSess);
      SESSION_TEL = sess.telephone || ""; SESSION_PIN = sess.pin || ""; SESSION_NOM = sess.nom || ""; EST_COACH = !!sess.estCoach; EST_TRESORIER = !!sess.estTresorier;
      document.body.classList.add("user-logged-in");
      document.getElementById("loginBox").style.display = "none";
      document.getElementById("playerBox").style.display = "flex";
      majEspaceJoueur(SESSION_NOM);
      if(EST_COACH || EST_TRESORIER){
        document.getElementById("coachMenuBox").style.display = "block";
      } else {
        document.getElementById("coachMenuBox").style.display = "none";
      }
      if(EST_COACH){
        var bLogo = document.getElementById("btnEditClubLogoBadge"); if(bLogo) bLogo.style.display = "flex";
      }
    }
    if(rawCache){
      var parsedCache = JSON.parse(rawCache);
      appliquerDonneesRecues(parsedCache, false);
      aChargeDepuisCache = true;
      masquerLoading();
    }
  } catch(eCache){}
  try {
    var t = localStorage.getItem("hb_tel"), p = localStorage.getItem("hb_pin");
    if(t) document.getElementById("inpTel").value = t;
    if(t && p){
      document.getElementById("inpPin").value = p;
      seConnecter(aChargeDepuisCache);
    } else {
      masquerLoading();
    }
  } catch(e){ masquerLoading(); }
  setTimeout(function(){ masquerLoading(); }, 2500);
}
if(document.readyState === "complete" || document.readyState === "interactive"){
  demarrerApp();
} else {
  document.addEventListener("DOMContentLoaded", demarrerApp);
  window.addEventListener("load", demarrerApp);
}
setTimeout(function(){ demarrerApp(); masquerLoading(); }, 4000);
