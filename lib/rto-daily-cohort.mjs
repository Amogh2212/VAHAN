export const RTO_DAILY_LOAD_TEST_COHORT_SIZE = 100;

function text(value) {
  return String(value ?? "").trim();
}

export function validateRtoDailyLoadTestCohort(payload) {
  const members = Array.isArray(payload) ? payload : payload?.members;
  if (!Array.isArray(members)) throw new Error("RTO cohort seed must contain a members array.");
  if (members.length !== RTO_DAILY_LOAD_TEST_COHORT_SIZE) {
    throw new Error(`RTO cohort seed must contain exactly ${RTO_DAILY_LOAD_TEST_COHORT_SIZE} members; found ${members.length}.`);
  }

  const normalized = members.map((member) => ({
    rank: Number(member?.rank),
    state: text(member?.state),
    rto: text(member?.rto),
  }));
  const identities = new Set();
  const ranks = new Set();
  for (const member of normalized) {
    if (!Number.isInteger(member.rank) || member.rank < 1 || member.rank > RTO_DAILY_LOAD_TEST_COHORT_SIZE) {
      throw new Error(`RTO cohort member has invalid rank: ${member.rank}.`);
    }
    if (!member.state || !member.rto) throw new Error(`RTO cohort member #${member.rank} needs both state and RTO.`);
    if (/^All Vahan4 Running Office/i.test(member.rto)) {
      throw new Error(`RTO cohort member #${member.rank} cannot be an aggregate office.`);
    }
    const identity = `${member.state.toLowerCase()}\u0000${member.rto.toLowerCase()}`;
    if (identities.has(identity)) throw new Error(`RTO cohort contains duplicate member: ${member.state} / ${member.rto}.`);
    if (ranks.has(member.rank)) throw new Error(`RTO cohort contains duplicate rank: ${member.rank}.`);
    identities.add(identity);
    ranks.add(member.rank);
  }
  for (let rank = 1; rank <= RTO_DAILY_LOAD_TEST_COHORT_SIZE; rank += 1) {
    if (!ranks.has(rank)) throw new Error(`RTO cohort is missing rank ${rank}.`);
  }
  return normalized.sort((left, right) => left.rank - right.rank);
}
