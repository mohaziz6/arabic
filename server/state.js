/**
 * الوكيل الكبير — آلة حالات تملك الجلسة من فتحها إلى فوز أحدهم.
 *
 * دوال خالصة بلا شبكة ولا نموذج لغوي: تأخذ حالة وحدثاً وتُرجع حالة جديدة.
 * كل قرار "مين دوره الآن" و"مين فاز" يُحسم هنا — لا يُسأل عنه النموذج،
 * لأنه حساب حتمي والنموذج يخطئ فيه ويكلّف بلا داعٍ.
 */

import { ROLES, PHASES, CARDS, CARD_BY_ID, WINS_NEEDED, MAX_TRIALS } from './rules.js';

/** ينشئ جلسة جديدة بلاعب واحد (المُنشئ) بانتظار الخصم. */
export function createSession(code, hostId, hostName) {
  return {
    code,
    status: 'lobby',              // lobby | trial | session-over
    players: {
      [hostId]: newPlayer(hostId, hostName, ROLES.PROSECUTOR),
    },
    hostId,
    judgeId: null,               // يُنتقى بالقرعة قبل المحاكمة الأولى ويظل للجلسة
    trialNo: 0,
    wins: { [hostId]: 0 },
    trial: null,
    winnerId: null,
  };
}

function newPlayer(id, name, role) {
  return {
    id,
    name,
    role,
    connected: true,
    // البطاقات تدوم الجلسة كلها؛ محتوى المولَّد منها يُملأ عند بدء كل محاكمة
    hand: CARDS.map((c) => ({ id: c.id, spent: false, content: null })),
  };
}

export function addPlayer(s, id, name) {
  const ids = Object.keys(s.players);
  if (ids.length >= 2) return { ok: false, error: 'الديوان ممتلئ' };
  if (s.players[id]) return { ok: true, state: s };

  // الخصم يأخذ الدور المقابل لدور المُنشئ
  const takenRole = s.players[ids[0]].role;
  const role = takenRole === ROLES.PROSECUTOR ? ROLES.DEFENDER : ROLES.PROSECUTOR;
  s.players[id] = newPlayer(id, name, role);
  s.wins[id] = 0;
  return { ok: true, state: s };
}

export const bothPresent = (s) => Object.keys(s.players).length === 2;
export const opponentOf = (s, id) => Object.keys(s.players).find((p) => p !== id) ?? null;
export const playerByRole = (s, role) =>
  Object.values(s.players).find((p) => p.role === role) ?? null;

/** يبدأ محاكمة جديدة بقضية وُلّدت مسبقاً، ويبدّل الأدوار من الثانية فصاعداً. */
export function startTrial(s, kase) {
  if (!bothPresent(s)) return { ok: false, error: 'ينقص لاعب' };
  if (s.status === 'session-over') return { ok: false, error: 'انتهت الجلسة' };

  s.trialNo += 1;
  if (s.trialNo > 1) {
    for (const p of Object.values(s.players)) {
      p.role = p.role === ROLES.PROSECUTOR ? ROLES.DEFENDER : ROLES.PROSECUTOR;
    }
  }

  // محتوى البطاقات المولَّدة يتجدد كل محاكمة (مثل جديد وبيت جديد)
  for (const p of Object.values(s.players)) {
    for (const card of p.hand) {
      if (CARD_BY_ID[card.id].generated) {
        card.content = kase.cardContent?.[card.id] ?? null;
      }
    }
  }

  s.status = 'trial';
  s.trial = {
    no: s.trialNo,
    case: kase,
    phaseIndex: 0,
    speeches: [],                 // { role, phase, transcript, cardId, judgement }
    scores: Object.fromEntries(Object.keys(s.players).map((id) => [id, 0])),
    playedThisPhase: null,        // بطاقة لُعبت في المرحلة الحالية
    pendingObjection: null,
    verdict: null,
  };
  return { ok: true, state: s };
}

export const currentPhase = (s) => (s.trial ? PHASES[s.trial.phaseIndex] : null);

/**
 * يتقدّم من مرحلة لا متحدّث فيها (عرض القضية) إلى ما بعدها.
 * مراحل المرافعة لا تتقدّم بهذه — بل بـ submitSpeech، وإلا تخطّى لاعبٌ دورَه.
 */
export function advancePhase(s) {
  const phase = currentPhase(s);
  if (!phase) return { ok: false, error: 'لا توجد محاكمة جارية', state: s };
  if (phase.speaker) return { ok: false, error: 'المرحلة تنتظر مرافعة', state: s };
  if (s.trial.phaseIndex >= PHASES.length - 1) return { ok: false, error: 'انتهت المراحل', state: s };
  s.trial.phaseIndex += 1;
  return { ok: true, state: s };
}

export function currentSpeaker(s) {
  const phase = currentPhase(s);
  return phase?.speaker ? playerByRole(s, phase.speaker) : null;
}

/** هل يجوز لهذا اللاعب أن يلعب هذه البطاقة الآن؟ */
export function canPlayCard(s, playerId, cardId) {
  if (s.status !== 'trial') return { ok: false, error: 'لا توجد محاكمة جارية' };
  const player = s.players[playerId];
  const card = player?.hand.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: 'بطاقة غير معروفة' };
  if (card.spent) return { ok: false, error: 'البطاقة مستهلكة' };

  const phase = currentPhase(s);
  if (!phase?.speaker) return { ok: false, error: 'ليست مرحلة مرافعة' };

  const speaking = currentSpeaker(s)?.id === playerId;
  if (CARD_BY_ID[cardId].interrupt) {
    // الاعتراض يُلعب في دور الخصم لا في دورك
    if (speaking) return { ok: false, error: 'الاعتراض يُلعب أثناء مرافعة خصمك' };
    if (s.trial.pendingObjection) return { ok: false, error: 'يوجد اعتراض قيد النظر' };
  } else {
    if (!speaking) return { ok: false, error: 'ليس دورك' };
    if (s.trial.playedThisPhase) return { ok: false, error: 'لُعبت بطاقة في هذه المرافعة' };
  }
  return { ok: true };
}

export function playCard(s, playerId, cardId) {
  const check = canPlayCard(s, playerId, cardId);
  if (!check.ok) return { ...check, state: s };

  const card = s.players[playerId].hand.find((c) => c.id === cardId);
  card.spent = true;

  if (CARD_BY_ID[cardId].interrupt) {
    // يوقف مؤقّت الخصم حتى يفصل القاضي — وإلا صار الاعتراض سرقة وقت لا حجة
    s.trial.pendingObjection = { by: playerId, cardId };
  } else {
    s.trial.playedThisPhase = { by: playerId, cardId, content: card.content };
  }
  return { ok: true, state: s };
}

/** يسجّل مرافعة مُقيَّمة ويتقدّم للمرحلة التالية. */
export function submitSpeech(s, playerId, transcript, judgement) {
  if (s.status !== 'trial') return { ok: false, error: 'لا توجد محاكمة جارية', state: s };
  if (currentSpeaker(s)?.id !== playerId) return { ok: false, error: 'ليس دورك', state: s };

  const phase = currentPhase(s);
  const played = s.trial.playedThisPhase;

  s.trial.speeches.push({
    role: s.players[playerId].role,
    playerId,
    phase: phase.id,
    transcript,
    cardId: played?.cardId ?? null,
    judgement,
  });

  s.trial.scores[playerId] += judgement.score + (judgement.cardDelta ?? 0);
  s.trial.playedThisPhase = null;
  s.trial.phaseIndex += 1;
  return { ok: true, state: s };
}

/** يفصل في اعتراض معلّق: يمنح أو يخصم، ويستأنف المؤقّت. */
export function resolveObjection(s, sustained) {
  const pending = s.trial?.pendingObjection;
  if (!pending) return { ok: false, error: 'لا يوجد اعتراض', state: s };

  const card = CARD_BY_ID[pending.cardId];
  s.trial.scores[pending.by] += sustained ? card.bonus : card.penalty;
  s.trial.pendingObjection = null;
  return { ok: true, state: s, sustained };
}

export const isTrialOver = (s) =>
  Boolean(s.trial) && s.trial.phaseIndex >= PHASES.length - 1;

/**
 * يسجّل حكم القاضي، ويحسم الجلسة إن بلغ أحدهم عدد الأحكام المطلوب
 * أو إن نفدت المحاكمات (فيفوز صاحب أعلى رصيد، وإلا فتعادل).
 */
export function recordVerdict(s, winnerId, verdict) {
  if (!s.trial) return { ok: false, error: 'لا توجد محاكمة جارية', state: s };

  s.trial.verdict = verdict;
  s.trial.phaseIndex = PHASES.length - 1;
  if (winnerId) s.wins[winnerId] += 1;

  const reached = Object.entries(s.wins).find(([, w]) => w >= WINS_NEEDED);
  if (reached) {
    s.status = 'session-over';
    s.winnerId = reached[0];
  } else if (s.trialNo >= MAX_TRIALS) {
    s.status = 'session-over';
    const [a, b] = Object.keys(s.players);
    s.winnerId = s.wins[a] === s.wins[b] ? null : (s.wins[a] > s.wins[b] ? a : b);
  }
  return { ok: true, state: s };
}

/**
 * لقطة الحالة لعين لاعب بعينه.
 * البطاقات والدرجات تعيش في الخادم؛ ولا يُرسل للاعب إلا ما يخصّه —
 * محتوى بطاقات الخصم لا يغادر الخادم أبداً.
 */
export function viewFor(s, viewerId) {
  const me = s.players[viewerId];
  const oppId = opponentOf(s, viewerId);
  const opp = oppId ? s.players[oppId] : null;
  const phase = currentPhase(s);

  return {
    code: s.code,
    status: s.status,
    judgeId: s.judgeId,
    trialNo: s.trialNo,
    wins: s.wins,
    winnerId: s.winnerId,
    me: me && {
      id: me.id, name: me.name, role: me.role,
      hand: me.hand.map((c) => ({ ...c, ...CARD_BY_ID[c.id] })),
    },
    opponent: opp && {
      id: opp.id, name: opp.name, role: opp.role, connected: opp.connected,
      // العدد فقط — لا هوية البطاقات ولا محتواها
      cardsLeft: opp.hand.filter((c) => !c.spent).length,
    },
    trial: s.trial && {
      no: s.trial.no,
      case: s.trial.case,
      phase: phase?.id ?? null,
      seconds: phase?.seconds ?? 0,
      speakerId: currentSpeaker(s)?.id ?? null,
      isMyTurn: currentSpeaker(s)?.id === viewerId,
      scores: s.trial.scores,
      speeches: s.trial.speeches,
      playedThisPhase:
        s.trial.playedThisPhase?.by === viewerId ? s.trial.playedThisPhase : null,
      pendingObjection: s.trial.pendingObjection,
      verdict: s.trial.verdict,
    },
  };
}
