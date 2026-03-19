// Shared time range utility
// Returns { start, end } as ISO strings for named ranges
// Returns null for standard relative ranges (1h, 24h, 7d etc)
function getAbsoluteRange(range) {
  const now = new Date();

  if (range === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  if (range === 'yesterday') {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (range === 'this_week') {
    const start = new Date(now);
    const day = start.getDay(); // 0=Sun
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  if (range === 'last_week') {
    const start = new Date(now);
    const day = start.getDay();
    start.setDate(start.getDate() - day - 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (range === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  if (range === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (range === 'last_6_months') {
    const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  if (range === 'this_year') {
    const start = new Date(now.getFullYear(), 0, 1);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  if (range === 'last_year') {
    const start = new Date(now.getFullYear() - 1, 0, 1);
    const end = new Date(now.getFullYear(), 0, 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  return null;
}

module.exports = { getAbsoluteRange };
