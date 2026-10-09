import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  delay,
  Browsers,
  getAggregateVotesInPollMessage,
  updateMessageWithPollUpdate,
  jidNormalizedUser,
  decryptPollVote
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';

const MODE = process.env.MODE || 'poll';
const PHONE_NUMBER = (process.env.PHONE_NUMBER || '').replace(/[^0-9]/g, '');
const GROUP_ID = (process.env.GROUP_ID || '').trim();
const POLL_TITLE = (process.env.POLL_TITLE || '').trim();
const TEXT_MESSAGE = process.env.TEXT_MESSAGE || '';
const WEBAPP_URL = (process.env.WEBAPP_URL || '').trim();

let POLL_OPTIONS = [];
try {
  const rawOpts = process.env.POLL_OPTIONS;
  if (rawOpts && rawOpts !== 'null') {
    const parsed = JSON.parse(rawOpts);
    POLL_OPTIONS = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  }
} catch (e) {
  console.log('Erreur lecture POLL_OPTIONS : ' + e.message);
}

console.log('Démarrage du bot WhatsApp en mode : ' + MODE);

const retryMap = new Map();
const msgRetryCounterCache = {
  get: (k) => retryMap.get(k),
  set: (k, v) => retryMap.set(k, v),
  del: (k) => retryMap.delete(k),
  flushAll: () => retryMap.clear()
};

let signalErrorsCount = 0;
const origError = console.error;
console.error = function(...args) {
  const msg = args.map(a => String(a)).join(' ');
  if (
    msg.includes('Failed to decrypt') ||
    msg.includes('Session error:') ||
    msg.includes('Bad MAC') ||
    msg.includes('MessageCounterError') ||
    msg.includes('No session found')
  ) {
    signalErrorsCount++;
    return;
  }
  origError.apply(console, args);
};

function restaurerBuffer(val) {
  if (!val) return null;
  if (Buffer.isBuffer(val)) return val;
  if (val instanceof Uint8Array) return Buffer.from(val);
  if (typeof val === 'string') return Buffer.from(val, 'base64');
  if (Array.isArray(val)) return Buffer.from(val);
  if (typeof val === 'object') {
    if (val.type === 'Buffer' && Array.isArray(val.data)) {
      return Buffer.from(val.data);
    }
    const keys = Object.keys(val).filter(k => !isNaN(Number(k))).sort((a, b) => Number(a) - Number(b));
    if (keys.length > 0) {
      return Buffer.from(keys.map(k => val[k]));
    }
  }
  return null;
}

function normaliserSavedPoll(pollObj) {
  if (!pollObj || !pollObj.message) return pollObj;
  if (!pollObj.pollUpdates) pollObj.pollUpdates = [];

  const ctx = pollObj.message.messageContextInfo;
  if (ctx && ctx.messageSecret) {
    ctx.messageSecret = restaurerBuffer(ctx.messageSecret);
  }
  const pCreation = pollObj.message.pollCreationMessage || pollObj.message.pollCreationMessageV2 || pollObj.message.pollCreationMessageV3;
  if (pCreation && pCreation.encKey) {
    pCreation.encKey = restaurerBuffer(pCreation.encKey);
  }

  for (const pu of pollObj.pollUpdates) {
    if (pu.vote && Array.isArray(pu.vote.selectedOptions)) {
      pu.vote.selectedOptions = pu.vote.selectedOptions.map(opt => restaurerBuffer(opt));
    }
  }
  return pollObj;
}

let savedPoll = null;
if (fs.existsSync('./last_poll.json')) {
  try {
    const rawPoll = JSON.parse(fs.readFileSync('./last_poll.json', 'utf8'));
    savedPoll = normaliserSavedPoll(rawPoll);
    console.log('Fichier last_poll.json chargé (ID : ' + (savedPoll?.key?.id || 'inconnu') + ' | Groupe : ' + (savedPoll?.key?.remoteJid || 'inconnu') + ')');
  } catch (e) {
    console.log('Erreur lecture last_poll.json : ' + e.message);
  }
} else {
  console.log('Aucun fichier last_poll.json trouvé dans le dépôt.');
}

const LISTEN_MS = (Number(process.env.LISTEN_SECONDS) || 120) * 1000;
let upsertCount = 0;
let stubCount = 0;

const pushNames = {};
const lidToPhoneJid = {};
let actionDejaLancee = false;
let isConnecting = false;

if (MODE === 'sync_votes' && savedPoll) {
  sauvegarderFichierVotesLocal(null, null, false);
}

function extrairePollUpdate(obj, profondeur = 0) {
  if (!obj || typeof obj !== 'object' || profondeur > 5) return null;
  if (obj.pollUpdateMessage) return obj.pollUpdateMessage;
  for (const k of Object.keys(obj)) {
    if (k === 'key' || k === 'messageContextInfo') continue;
    const found = extrairePollUpdate(obj[k], profondeur + 1);
    if (found) return found;
  }
  return null;
}

function dechiffrerVoteMultiJid(pollUpdate, m, sock, targetPoll) {
  const votePayload = {
    encPayload: restaurerBuffer(pollUpdate.vote?.encPayload),
    encIv: restaurerBuffer(pollUpdate.vote?.encIv)
  };

  if (!votePayload.encPayload || !votePayload.encIv) return null;

  const secrets = [
    restaurerBuffer(targetPoll.message?.messageContextInfo?.messageSecret),
    restaurerBuffer(targetPoll.message?.pollCreationMessage?.encKey),
    restaurerBuffer(targetPoll.message?.pollCreationMessageV2?.encKey),
    restaurerBuffer(targetPoll.message?.pollCreationMessageV3?.encKey),
    restaurerBuffer(targetPoll.messageContextInfo?.messageSecret)
  ].filter(b => b && b.length === 32);

  const creationKey = pollUpdate.pollCreationMessageKey || {};

  const candidatsCreateur = [...new Set([
    sock.user?.id ? jidNormalizedUser(sock.user.id) : null,
    sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null,
    sock.authState?.creds?.me?.id ? jidNormalizedUser(sock.authState.creds.me.id) : null,
    sock.authState?.creds?.me?.lid ? jidNormalizedUser(sock.authState.creds.me.lid) : null,
    targetPoll.key?.participant ? jidNormalizedUser(targetPoll.key.participant) : null,
    creationKey.participant ? jidNormalizedUser(creationKey.participant) : null,
    targetPoll.key?.remoteJid
  ].filter(Boolean))];

  const candidatsVotant = [...new Set([
    m.key?.participant ? jidNormalizedUser(m.key.participant) : null,
    m.key?.participantAlt ? jidNormalizedUser(m.key.participantAlt) : null,
    m.participant ? jidNormalizedUser(m.participant) : null,
    m.key?.participant,
    sock.user?.id ? jidNormalizedUser(sock.user.id) : null,
    sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null,
    sock.authState?.creds?.me?.id ? jidNormalizedUser(sock.authState.creds.me.id) : null,
    sock.authState?.creds?.me?.lid ? jidNormalizedUser(sock.authState.creds.me.lid) : null,
    ...Object.keys(lidToPhoneJid),
    ...Object.values(lidToPhoneJid)
  ].filter(Boolean))];

  for (const secretBuf of secrets) {
    for (const cJid of candidatsCreateur) {
      for (const vJid of candidatsVotant) {
        try {
          const decoded = decryptPollVote(votePayload, {
            pollEncKey: secretBuf,
            pollCreatorJid: cJid,
            pollMsgId: targetPoll.key.id,
            voterJid: vJid
          });
          if (decoded && Array.isArray(decoded.selectedOptions)) {
            return { voteMsg: decoded, voterJid: vJid, creatorJid: cJid };
          }
        } catch (e) {}
      }
    }
  }
  return null;
}

function traiterMessageVote(m, sock) {
  const isTargetGroup = m.key?.remoteJid === GROUP_ID || (savedPoll && m.key?.remoteJid === savedPoll.key?.remoteJid);
  const rawSender = m.key?.participant || m.key?.remoteJid;
  const altSender = m.key?.participantAlt;

  if (rawSender && altSender) {
    lidToPhoneJid[jidNormalizedUser(rawSender)] = jidNormalizedUser(altSender);
  }
  if (m.pushName && rawSender) {
    pushNames[jidNormalizedUser(rawSender)] = m.pushName;
    if (altSender) pushNames[jidNormalizedUser(altSender)] = m.pushName;
  }

  if (isTargetGroup) {
    const msgKeys = m.message ? Object.keys(m.message).join(',') : ('SANS_CONTENU(stub=' + m.messageStubType + ')');
    console.log('[Événement Groupe] De: ' + (m.pushName || rawSender) + ' | Type: ' + msgKeys);
  }

  const pollUpdate = extrairePollUpdate(m.message);
  if (pollUpdate) {
    const creationKey = pollUpdate.pollCreationMessageKey;
    const targetId = creationKey ? creationKey.id : 'inconnu';
    console.log('--> Détection pollUpdateMessage (cible ID: ' + targetId + ') de ' + (m.pushName || rawSender));

    if (savedPoll && targetId === savedPoll.key.id) {
      const res = dechiffrerVoteMultiJid(pollUpdate, m, sock, savedPoll);
      if (res) {
        const voterPhoneJid = lidToPhoneJid[res.voterJid] || (m.key.participantAlt ? jidNormalizedUser(m.key.participantAlt) : res.voterJid);
        if (m.pushName) pushNames[voterPhoneJid] = m.pushName;

        const cleanKey = {
          ...m.key,
          participant: voterPhoneJid,
          pushName: m.pushName || pushNames[voterPhoneJid] || ''
        };

        updateMessageWithPollUpdate(savedPoll, {
          pollUpdateMessageKey: cleanKey,
          vote: res.voteMsg,
          senderTimestampMs: Number(m.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000
        });

        fs.writeFileSync('./last_poll.json', JSON.stringify(savedPoll, null, 2));
        sauvegarderFichierVotesLocal(sock.user?.id, sock.user?.lid, false);
        console.log('--> SUCCÈS : Vote déchiffré pour ' + (m.pushName || voterPhoneJid) + ' (' + res.voteMsg.selectedOptions.length + ' option(s) cochée(s))');
      } else {
        console.log('--> ÉCHEC déchiffrement AES-GCM pour ' + (m.pushName || rawSender));
      }
    } else {
      console.log('--> Vote ignoré car ID sondage différent (' + targetId + ' != ' + (savedPoll?.key?.id || 'aucun') + ')');
    }
  }
}

async function startBot() {
  if (isConnecting) return;
  isConnecting = true;

  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    msgRetryCounterCache: msgRetryCounterCache,
    maxMsgRetryCount: 5,
    retryRequestDelayMs: 300,
    getMessage: async (key) => {
      if (savedPoll && savedPoll.key && key.id === savedPoll.key.id) {
        return savedPoll.message;
      }
      return undefined;
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const m of messages) {
      upsertCount++;
      if (!m.message) stubCount++;
      traiterMessageVote(m, sock);
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    for (const { key, update } of updates) {
      if (update.pollUpdates && savedPoll && key.id === savedPoll.key.id) {
        for (const pollUpdate of update.pollUpdates) {
          updateMessageWithPollUpdate(savedPoll, pollUpdate);
          console.log('--> SUCCÈS (via messages.update) : Vote enregistré !');
        }
        fs.writeFileSync('./last_poll.json', JSON.stringify(savedPoll, null, 2));
        sauvegarderFichierVotesLocal(sock.user?.id, sock.user?.lid, false);
      }
    }
  });

  sock.ev.on('messaging-history.set', ({ messages, syncType }) => {
    for (const msg of (messages || [])) {
      if (!savedPoll || msg.key?.id !== savedPoll.key.id) continue;
      const nb = (msg.pollUpdates || []).length;
      console.log('--> Historique reçu (syncType ' + syncType + ') : sondage trouvé avec ' + nb + ' vote(s)');
      if (nb > 0) {
        savedPoll.pollUpdates = msg.pollUpdates;
        fs.writeFileSync('./last_poll.json', JSON.stringify(savedPoll, null, 2));
        sauvegarderFichierVotesLocal(sock.user?.id, sock.user?.lid, false);
      }
    }
  });

  if (!sock.authState.creds.registered) {
    if (!PHONE_NUMBER) {
      origError('Erreur : Numéro de téléphone manquant pour la configuration.');
      process.exit(1);
    }
    await delay(4000);
    const code = await sock.requestPairingCode(PHONE_NUMBER);
    console.log('====================================================');
    console.log('CODE DE CONNEXION WHATSAPP : ' + code);
    console.log('Saisissez ce code dans WhatsApp > Appareils connectés > Associer avec numéro');
    console.log('====================================================');
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open' && !actionDejaLancee) {
      actionDejaLancee = true;
      isConnecting = false;
      console.log('Connecté à WhatsApp avec succès ! Mode : ' + MODE);

      const targetGroup = GROUP_ID || savedPoll?.key?.remoteJid;
      if (targetGroup) {
        try {
          const meta = await sock.groupMetadata(targetGroup);
          if (meta && Array.isArray(meta.participants)) {
            for (const p of meta.participants) {
              if (p.lid && p.id) {
                lidToPhoneJid[jidNormalizedUser(p.lid)] = jidNormalizedUser(p.id);
              }
            }
            console.log('Groupe "' + meta.subject + '" chargé (' + meta.participants.length + ' membres).');
          }
        } catch (e) {}
      }

      await delay(2000);

      try {
        if (MODE === 'setup') {
          const groups = await sock.groupFetchAllParticipating();
          console.log('====================================================');
          console.log('LISTE DES GROUPES WHATSAPP DISPONIBLES :');
          console.log('Copiez l\'ID de votre groupe dans votre Google Sheet (Configuration > C18) :');
          console.log('----------------------------------------------------');
          for (const [id, info] of Object.entries(groups)) {
            console.log('Groupe : "' + info.subject + '"  --->  ID : ' + id);
          }
          console.log('====================================================');
        } else if (MODE === 'poll') {
          console.log('Envoi du sondage "' + POLL_TITLE + '" vers ' + GROUP_ID + '...');
          const sentMsg = await sock.sendMessage(GROUP_ID, {
            poll: {
              name: POLL_TITLE,
              values: POLL_OPTIONS,
              selectableCount: 0
            }
          });
          sentMsg.pollUpdates = [];
          fs.writeFileSync('./last_poll.json', JSON.stringify(sentMsg, null, 2));
          fs.writeFileSync('./votes_semaine.json', JSON.stringify([], null, 2));
          console.log('Attente de 15 secondes après envoi pour initialiser les sessions du groupe...');
          await delay(15000);
          console.log('SUCCÈS : Sondage publié (ID: ' + sentMsg.key.id + ') et sauvegardé dans last_poll.json !');
        } else if (MODE === 'send_text') {
          console.log('Envoi du message vers : ' + GROUP_ID);
          await sock.sendMessage(GROUP_ID, { text: TEXT_MESSAGE });
          console.log('SUCCÈS : Message publié dans le groupe !');
        } else if (MODE === 'sync_votes') {
          if (!savedPoll) {
            console.log('ERREUR : Aucun fichier last_poll.json trouvé.');
          } else {
            console.log('Demande de l\'historique au téléphone pour récupérer les votes existants...');
            try {
              const ts = Number(savedPoll.messageTimestamp || 0) + 1;
              await sock.fetchMessageHistory(50, savedPoll.key, ts);
            } catch (eHist) {
              console.log('Demande d\'historique impossible : ' + eHist.message);
            }
            console.log('Écoute active des votes pendant ' + (LISTEN_MS / 1000) + ' secondes...');
            await delay(LISTEN_MS);
            console.log('Messages reçus pendant ce run : ' + upsertCount + ' (déchiffrement KO : ' + stubCount + ')');
            console.log('Erreurs Signal ignorées pendant ce run : ' + signalErrorsCount);
            sauvegarderFichierVotesLocal(sock.user?.id, sock.user?.lid, true);
          }
        }
      } catch (errAction) {
        console.log('ERREUR lors de l\'action WhatsApp : ' + errAction.message);
      }

      await delay(2000);
      process.exit(0);
    }

    if (connection === 'close') {
      isConnecting = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log('Connexion fermée (code: ' + statusCode + ')');
      if (statusCode !== DisconnectReason.loggedOut && !actionDejaLancee) {
        await delay(5000);
        startBot();
      }
    }
  });
}

function sauvegarderFichierVotesLocal(botJid, botLid, afficherBilan) {
  if (!savedPoll || !savedPoll.message) return;
  normaliserSavedPoll(savedPoll);

  for (const pu of (savedPoll.pollUpdates || [])) {
    const k = pu.pollUpdateMessageKey;
    if (k && k.participant && k.pushName) {
      pushNames[jidNormalizedUser(k.participant)] = k.pushName;
    }
  }

  const votesAgg = getAggregateVotesInPollMessage({
    message: savedPoll.message,
    pollUpdates: savedPoll.pollUpdates || []
  });

  if (afficherBilan) {
    console.log('--- BILAN CUMULÉ DU SONDAGE ---');
  }

  const DAYS = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE'];
  const matchOptionsDetected = [];

  for (const opt of votesAgg) {
    const optUp = opt.name.toUpperCase();
    if (optUp.includes('MATCH') || optUp.includes('DISPO MATCH')) {
      matchOptionsDetected.push(opt.name);
    }
  }

  const joueursMap = {};

  for (const option of votesAgg) {
    if (afficherBilan) {
      console.log('Option : "' + option.name + '" -> ' + option.voters.length + ' vote(s)');
    }
    const optName = option.name;
    const optNameUp = optName.toUpperCase();
    const isTraining = optNameUp.includes('ENTRAÎNEMENT') || optNameUp.includes('ENTRAINEMENT') || optNameUp.includes('TRAINING');

    for (const rawVoter of option.voters) {
      let cleanJid = (rawVoter === 'me' && botJid) ? jidNormalizedUser(botJid) : jidNormalizedUser(rawVoter);
      if (lidToPhoneJid[cleanJid]) {
        cleanJid = lidToPhoneJid[cleanJid];
      } else if (botLid && botJid && cleanJid === jidNormalizedUser(botLid)) {
        cleanJid = jidNormalizedUser(botJid);
      }

      const phone = cleanJid.split('@')[0];

      if (!joueursMap[phone]) {
        joueursMap[phone] = {
          phone: phone,
          pushName: pushNames[cleanJid] || pushNames[rawVoter] || phone,
          nbTrainings: 0,
          selectedOptions: [],
          dispoEquipe1: false,
          dispoEquipe2: false,
          dispo1B: false,
          dispo1C: false,
          dispoLundi: false,
          dispoMardi: false,
          dispoMercredi: false,
          dispoJeudi: false,
          dispoVendredi: false,
          dispoSamedi: false,
          dispoDimanche: false
        };
      }

      if (!joueursMap[phone].selectedOptions.includes(optName)) {
        joueursMap[phone].selectedOptions.push(optName);
      }

      if (isTraining) {
        joueursMap[phone].nbTrainings += 1;
        for (const day of DAYS) {
          if (optNameUp.includes(day)) {
            const prop = 'dispo' + day.charAt(0) + day.slice(1).toLowerCase();
            joueursMap[phone][prop] = true;
          }
        }
      }

      if (matchOptionsDetected.length > 0) {
        if (optName === matchOptionsDetected[0]) {
          joueursMap[phone].dispoEquipe1 = true;
          joueursMap[phone].dispo1B = true;
        } else if (matchOptionsDetected.length > 1 && optName === matchOptionsDetected[1]) {
          joueursMap[phone].dispoEquipe2 = true;
          joueursMap[phone].dispo1C = true;
        }
      }

      if (optNameUp.includes('ÉQUIPE 1') || optNameUp.includes('EQUIPE 1') || optNameUp.includes('1B') || optNameUp.includes('SG1') || optNameUp.includes('SF1')) {
        joueursMap[phone].dispoEquipe1 = true;
        joueursMap[phone].dispo1B = true;
      }
      if (optNameUp.includes('ÉQUIPE 2') || optNameUp.includes('EQUIPE 2') || optNameUp.includes('1C') || optNameUp.includes('SG2') || optNameUp.includes('SF2')) {
        joueursMap[phone].dispoEquipe2 = true;
        joueursMap[phone].dispo1C = true;
      }
    }
  }

  const listeVotes = Object.values(joueursMap);
  fs.writeFileSync('./votes_semaine.json', JSON.stringify(listeVotes, null, 2));

  if (afficherBilan) {
    console.log('Total joueurs ayant voté cette semaine : ' + listeVotes.length);
    console.log('SUCCÈS : Fichier votes_semaine.json enregistré dans le dépôt GitHub !');
  }
}

startBot();

setTimeout(() => {
  if (MODE === 'sync_votes' && savedPoll) {
    sauvegarderFichierVotesLocal(null, null, true);
  }
  console.log('Fin du temps imparti, fermeture propre du script.');
  process.exit(0);
}, LISTEN_MS + 60000);
