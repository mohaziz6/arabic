/**
 * طبقة «المباراة» — جولاتٌ من ألعابٍ مختلفة في ديوانٍ واحد.
 *
 * **وعاءٌ ثابت لكل لعبة** (قرار مستخدم صريح): فائز اللعبة يأخذ `POT_WIN` نقاط
 * مباراة، والتعادل `POT_TIE` لكلٍّ. ولا تُجمَع نقاط الألعاب الخام أبداً — سلالمها
 * متباعدة (مَعاني حتى ٢٤، سَنَد نحو ١٢، والمزاد بلا سقف)، فالجمع الخام يجعل
 * لعبةً واحدة تبتلع المباراة ويُفقد بقيةَ الجولات معناها.
 *
 * وهذه الوحدة **لا تعرف شيئاً عن الألعاب نفسها**: تأخذ نتيجةً (`winnerId` أو
 * `null` للتعادل) وتُخرج أرصدة. آلاتُ الألعاب الخمس تتّفق على عقدٍ واحد
 * (`status === 'over'` و`winnerId`)، وهو كل ما تحتاجه.
 *
 * المواصفة في docs/match.md
 */

export const POT_WIN = 3;
export const POT_TIE = 1;
export const MAX_GAMES = 5;

/** يبني مباراةً من قائمة ألعاب مرتّبة. القائمة تُنظَّف من التكرار ومن المجهول. */
export function createMatch(gameIds, known, playerIds = []) {
  const games = [];
  for (const id of Array.isArray(gameIds) ? gameIds : []) {
    if (known.includes(id) && !games.includes(id) && games.length < MAX_GAMES) games.push(id);
  }
  const pot = {};
  for (const id of playerIds) pot[id] = 0;
  return { games, idx: 0, pot, results: [] };
}

export const currentGame = (m) => m?.games[m.idx] ?? null;

/** آخر جولة؟ — يُسأل قبل التقدّم، فلا زرّ «اللعبة التالية» بلا لعبةٍ تالية. */
export const isLastRound = (m) => !m || m.idx >= m.games.length - 1;

/** المباراة منتهية حين سُجِّلت نتيجةُ كل جولاتها. */
export const isOver = (m) => Boolean(m) && m.results.length >= m.games.length;

/** يضمن مقعداً في الوعاء للاعبٍ انضمّ بعد إنشاء المباراة. */
export function seat(m, playerId) {
  if (m && !(playerId in m.pot)) m.pot[playerId] = 0;
}

/**
 * يسجّل نتيجة الجولة الجارية ويصرف وعاءها. **مرّة واحدة لا غير**: الاستدعاء
 * الثاني على الجولة نفسها لا يفعل شيئاً، لأن كل بثّ حالةٍ منتهية يمرّ من هنا.
 */
export function recordRound(m, { game, winnerId, scores, playerIds = [] }) {
  if (!m || m.results.length !== m.idx || m.idx >= m.games.length) return null;

  for (const id of playerIds) seat(m, id);
  const gained = {};
  if (winnerId) {
    gained[winnerId] = POT_WIN;
  } else {
    for (const id of Object.keys(m.pot)) gained[id] = POT_TIE;
  }
  for (const [id, n] of Object.entries(gained)) m.pot[id] = (m.pot[id] ?? 0) + n;

  const result = { game, winnerId: winnerId ?? null, gained, scores: { ...scores } };
  m.results.push(result);
  return result;
}

/** يتقدّم إلى اللعبة التالية. يُرجع معرّفها أو `null` إن انتهت المباراة. */
export function advance(m) {
  if (!m || isOver(m)) return null;
  if (m.results.length <= m.idx) return null;     // الجولة الجارية لم تُحسَم بعد
  m.idx += 1;
  return currentGame(m);
}

/** صاحب أعلى وعاء، أو `null` عند التعادل. */
export function leader(m) {
  const ids = Object.keys(m?.pot ?? {});
  if (ids.length < 2) return null;
  const [a, b] = ids;
  if (m.pot[a] === m.pot[b]) return null;
  return m.pot[a] > m.pot[b] ? a : b;
}

/** لقطةٌ للمتصفح — لا سرّ فيها، فهي متماثلة إلا في تمييز «أنا». */
export function viewFor(m, viewerId) {
  if (!m) return null;
  const mine = m.pot[viewerId] ?? 0;
  const oppId = Object.keys(m.pot).find((id) => id !== viewerId);
  return {
    games: m.games,
    idx: m.idx,
    roundNo: Math.min(m.idx + 1, m.games.length),
    total: m.games.length,
    myPot: mine,
    oppPot: oppId ? m.pot[oppId] : 0,
    results: m.results.map((r) => ({
      game: r.game,
      iWon: r.winnerId === viewerId,
      tie: r.winnerId === null,
      mine: r.gained[viewerId] ?? 0,
    })),
    over: isOver(m),
    lastRound: isLastRound(m),
    iLead: leader(m) === viewerId,
    tied: isOver(m) && leader(m) === null,
  };
}
