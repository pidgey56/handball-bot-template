// ============================================================================
// HANDBALL BOT 2.0 - API CLIENT & BRIDGE (STALE-WHILE-REVALIDATE)
// Connecteur universel WebApp (GitHub Pages) <-> Google Apps Script API
// ============================================================================

const OFFICIAL_DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbzhTdgiYwejEfF9hXvcBSdg-SOpwtniR2NcUmAPAWRRQoh7l3KsBBG5NZvlIo87baKH/exec";

function assainirUrlApi(url) {
  if (!url) return '';
  var u = String(url).trim().replace(/\\/g, '/');
  // Corriger la coquille courante 'S0pwtnir' -> 'SOpwtniR'
  if (u.includes("S0pwtnir")) {
    u = u.replace("S0pwtnir", "SOpwtniR");
  }
  // Corriger backslash ou slash erroné
  if (u.includes("2NcUmAP/WRRQ")) {
    u = u.replace("2NcUmAP/WRRQ", "2NcUmAPAWRRQ");
  }
  // S'assurer qu'elle se termine par /exec
  if (u.includes("script.google.com/macros/s/") && !u.endsWith("/exec")) {
    u = u.replace(/\/+$/, '') + "/exec";
  }
  return u;
}

const ApiClient = {
  // URL de l'API Google Apps Script (stockée dans localStorage ou passée en ?api=...)
  baseUrl: (function() {
    var host = (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
    // Si on est directement sur Google Apps Script, baseUrl reste vide pour privilégier l'exécution native
    if (host.includes('google.com') || host.includes('googleusercontent.com')) {
      return '';
    }
    const params = (typeof window !== 'undefined' && window.location) ? new URLSearchParams(window.location.search) : null;
    const queryApi = params ? params.get('api') : null;
    if (queryApi) {
      var cleanedQ = assainirUrlApi(queryApi);
      try { localStorage.setItem('hb_api_url', cleanedQ); } catch(e){}
      return cleanedQ;
    }
    try {
      var stored = localStorage.getItem('hb_api_url');
      if (stored) {
        var cleanedS = assainirUrlApi(stored);
        if (cleanedS !== stored) {
          localStorage.setItem('hb_api_url', cleanedS);
        }
        return cleanedS;
      }
    } catch(e){}
    // Par défaut sur GitHub Pages / PWA : URL officielle
    return OFFICIAL_DEFAULT_API_URL;
  })(),

  // Statut de connexion : 'idle' | 'syncing' | 'online' | 'offline'
  status: 'idle',

  // Enregistrer une nouvelle URL de Google Sheet API
  setBaseUrl: function(url) {
    if (!url) return;
    this.baseUrl = assainirUrlApi(url);
    try { localStorage.setItem('hb_api_url', this.baseUrl); } catch(e){}
    this.majBadgeStatut();
  },

  // Mise à jour visuelle du badge de statut dans le header
  majBadgeStatut: function(statut, message) {
    const badge = document.getElementById('apiStatusBadge');
    const badgeText = document.getElementById('apiStatusText');
    const badgeDot = document.getElementById('apiStatusDot');
    if (!badge) return;

    badge.style.display = 'inline-flex';
    if (statut === 'syncing') {
      if (badgeDot) badgeDot.style.background = '#38bdf8';
      if (badgeText) badgeText.textContent = message || 'Synchronisation...';
    } else if (statut === 'online') {
      if (badgeDot) badgeDot.style.background = '#22c55e';
      if (badgeText) badgeText.textContent = message || 'Google Sheet Connecté';
    } else if (statut === 'offline') {
      if (badgeDot) badgeDot.style.background = '#f59e0b';
      if (badgeText) badgeText.textContent = message || 'Mode Hors-Ligne (Cache)';
    } else {
      if (!this.baseUrl) {
        if (badgeDot) badgeDot.style.background = '#ec4899';
        if (badgeText) badgeText.textContent = 'Configurer le Sheet';
      } else {
        if (badgeDot) badgeDot.style.background = '#22c55e';
        if (badgeText) badgeText.textContent = 'Google Sheet Connecté';
      }
    }
  },

  // Appel générique vers l'API Google Sheets avec timeout & Stale-While-Revalidate
  call: async function(action, args = []) {
    // Cas 1 : Exécution native dans l'environnement Google Apps Script
    var isGoogleHost = (typeof window !== 'undefined' && window.location && window.location.hostname && (window.location.hostname.includes('google.com') || window.location.hostname.includes('googleusercontent.com')));
    var nativeRunner = (typeof window !== 'undefined' && window.google && window.google.script && (window.google.script.runNative || window.google.script.run));
    if (nativeRunner && (isGoogleHost || !this.baseUrl)) {
      if (typeof nativeRunner[action] === 'function') {
        return new Promise((resolve, reject) => {
          nativeRunner
            .withSuccessHandler(resolve)
            .withFailureHandler(reject)
            [action](...args);
        });
      }
    }

    // Cas 2 : Exécution PWA sans URL configurée
    if (!this.baseUrl) {
      // Données de démonstration pour que l'app soit testable immédiatement
      if (action === 'getDonneesCoach') {
        const demo = this.getDemoData();
        return demo;
      }
      this.ouvrirModalConfig();
      throw new Error("Veuillez renseigner l'URL WebApp de votre Google Sheet pour enregistrer les données.");
    }

    const payload = {
      action: action,
      args: args
    };

    this.majBadgeStatut('syncing', 'Envoi...');

    // Timeout de 45 secondes adapté aux temps de réponse de Google Apps Script (cold start)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      var targetUrl = assainirUrlApi(this.baseUrl) || OFFICIAL_DEFAULT_API_URL;
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const res = await response.json();

      this.majBadgeStatut('online');

      if (res.status === 'error') {
        if (action === 'recupererStatsSpaktaClub') {
          return (typeof window !== 'undefined' && window.SPAKTA_INITIAL_DATA) || { ok: true, joueurs: [] };
        }
        throw new Error(res.message || "Erreur serveur Google Sheets");
      }

      // Mise en cache des données lues
      if (action === 'getDonneesCoach' || action === 'authentifierUtilisateur') {
        try {
          const donneesAStocker = (res.data && res.data.donnees) ? res.data.donnees : res.data;
          localStorage.setItem('hb_cache_data', JSON.stringify(donneesAStocker));
          localStorage.setItem('hb_cache_timestamp', Date.now().toString());
        } catch (e) {}
      }

      return res.data;
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('abort'));
      const errorMsg = isTimeout
        ? "Le serveur Google Sheets met trop de temps à répondre (délai dépassé). Veuillez réessayer."
        : (err.message || "Erreur réseau inconnue");

      const isNetworkFailure = isTimeout || !navigator.onLine || err.name === 'TypeError' || (err.message && err.message.includes('fetch'));
      if (action !== 'recupererStatsSpaktaClub') {
        if (isNetworkFailure) {
          console.warn("[ApiClient] Appel réseau non disponible (" + errorMsg + ").");
          this.majBadgeStatut('offline');
        } else {
          console.warn("[ApiClient] Erreur Google Sheets reçue (" + errorMsg + ").");
          this.majBadgeStatut('online');
        }
      }

      // Fallback Spakta silencieux si le backend n'a pas encore redéployé l'action
      if (action === 'recupererStatsSpaktaClub') {
        const cached = localStorage.getItem('hb_spakta_stats');
        if (cached) {
          try { return JSON.parse(cached); } catch(e) {}
        }
        return (typeof window !== 'undefined' && window.SPAKTA_INITIAL_DATA) || { ok: true, joueurs: [] };
      }

      // Fallback cache local en cas de coupure réseau
      if (action === 'getDonneesCoach') {
        const cached = localStorage.getItem('hb_cache_data');
        if (cached) {
          try {
            return JSON.parse(cached);
          } catch(e) {}
        }
        return this.getDemoData();
      }

      throw new Error(errorMsg);
    }
  },

  // Données de démonstration complètes si aucun Sheet n'est encore lié
  getDemoData: function() {
    return {
      nomClub: "Mon Club Handball (Démo)",
      equipes: [{ nom: "Équipe 1", code: "EQ1" }, { nom: "Équipe 2", code: "EQ2" }],
      effectif: [
        { nom: "Alexandre D", poste: "Gardien", equipe: "Équipe 1", photo: "images/logo.png" },
        { nom: "Thomas M", poste: "Arrière Gauche", equipe: "Équipe 1", photo: "" },
        { nom: "Julien B", poste: "Demi-Centre", equipe: "Équipe 1", photo: "" },
        { nom: "Lucas P", poste: "Pivot", equipe: "Équipe 1", photo: "" },
        { nom: "Maxime R", poste: "Ailier Gauche", equipe: "Équipe 2", photo: "" },
        { nom: "Romain T", poste: "Ailier Droit", equipe: "Équipe 2", photo: "" },
        { nom: "Nicolas L", poste: "Arrière Droit", equipe: "Équipe 2", photo: "" }
      ],
      matchs: [
        { equipe: "Équipe 1", adversaire: "HBC Ennemi", date: "Samedi 20h30", salle: "Gymnase Central", domicile: true, rdv: "19h15" },
        { equipe: "Équipe 2", adversaire: "US Handball", date: "Dimanche 16h00", salle: "Palais des Sports", domicile: false, rdv: "14h30" }
      ],
      votes: [],
      absences: [],
      caisse: { solde: 120, totalImpayes: 25, amendes: [] }
    };
  },

  // Modal de configuration de l'API
  ouvrirModalConfig: function() {
    const modal = document.getElementById('modalConfigApi');
    const inp = document.getElementById('inpApiUrl');
    if (modal) {
      if (inp) inp.value = this.baseUrl;
      modal.style.display = 'flex';
    }
  },

  fermerModalConfig: function() {
    const modal = document.getElementById('modalConfigApi');
    if (modal) modal.style.display = 'none';
  }
};

// Fonctions globales
window.ouvrirModalApi = function() { ApiClient.ouvrirModalConfig(); };
window.fermerModalApi = function() { ApiClient.fermerModalConfig(); };

window.sauvegarderApiUrl = function() {
  const inp = document.getElementById('inpApiUrl');
  if (inp && inp.value) {
    ApiClient.setBaseUrl(inp.value);
    ApiClient.fermerModalConfig();
    if (typeof afficherToast === 'function') {
      afficherToast("Google Sheet relié avec succès ! Rechargement...", "succes");
    }
    setTimeout(function() { window.location.reload(); }, 600);
  }
};

// Initialisation au chargement
window.addEventListener('DOMContentLoaded', function() {
  ApiClient.majBadgeStatut();
});

// ============================================================================
// POLYFILL TRANSPARENT POUR `google.script.run`
// ============================================================================
(function() {
  if (typeof window.google === 'undefined') window.google = {};
  if (window.google.script && window.google.script.run) {
    window.google.script.runNative = window.google.script.run;
  }
  window.google.script = window.google.script || {};

  window.google.script.run = new Proxy({}, {
    get: function(target, prop) {
      let successCb = null;
      let failureCb = null;

      const runner = new Proxy({}, {
        get: function(t, method) {
          if (method === 'withSuccessHandler') {
            return function(fn) { successCb = fn; return runner; };
          }
          if (method === 'withFailureHandler') {
            return function(fn) { failureCb = fn; return runner; };
          }

          return function(...args) {
            ApiClient.call(method, args)
              .then(data => {
                if (typeof successCb === 'function') successCb(data);
              })
              .catch(err => {
                if (typeof failureCb === 'function') {
                  failureCb(err);
                } else if (typeof afficherToast === 'function') {
                  afficherToast(err.message, "erreur");
                } else {
                  console.error(err);
                }
              });
          };
        }
      });

      if (prop === 'withSuccessHandler') {
        return function(fn) { successCb = fn; return runner; };
      }
      if (prop === 'withFailureHandler') {
        return function(fn) { failureCb = fn; return runner; };
      }

      return function(...args) {
        ApiClient.call(prop, args).catch(err => console.error(err));
      };
    }
  });
})();
