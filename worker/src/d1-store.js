// D1 (SQLite) implementation of the handler's Store. All SQL is prepared and bound; nothing is concatenated.

/** @param {any} db a D1Database @returns {import('./handler.js').Store} */
export function createD1Store(db) {
  return {
    async getPlayer(id) {
      const r = await db.prepare('SELECT v, save, rev FROM players WHERE id = ?1').bind(id).first();
      return r ? { v: r.v, save: r.save, rev: r.rev } : null;
    },

    async createPlayer(id, save) {
      // OR IGNORE + changes: a concurrent create of the same id loses instead of overwriting.
      const r = await db.prepare('INSERT OR IGNORE INTO players (id, v, save, rev) VALUES (?1, 1, ?2, 1)').bind(id, save).run();
      return r.meta.changes === 1 ? 1 : null;
    },

    async updatePlayer(id, save, rev) {
      // Optimistic concurrency: only the writer that saw the latest rev wins. v never changes after creation.
      const r = await db.prepare('UPDATE players SET save = ?2, rev = rev + 1 WHERE id = ?1 AND rev = ?3').bind(id, save, rev).run();
      return r.meta.changes === 1 ? rev + 1 : null;
    },

    async putBoard(bid, row) {
      await db
        .prepare(
          'INSERT INTO board (bid, name, total, blood, solved, bestRun, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ' +
            'ON CONFLICT(bid) DO UPDATE SET name = ?2, total = ?3, blood = ?4, solved = ?5, bestRun = ?6, updatedAt = ?7',
        )
        .bind(bid, row.name, row.total, row.blood, row.solved, row.bestRun, row.updatedAt)
        .run();
    },

    async listBoard(orderBy, limit) {
      // orderBy is one of two literals chosen by the handler, never user text, so the identifier is safe to inline.
      const col = orderBy === 'bestRun' ? 'bestRun' : 'total';
      const { results } = await db
        .prepare(`SELECT bid, name, total, blood, solved, bestRun, updatedAt FROM board ORDER BY ${col} DESC, bid ASC LIMIT ?1`)
        .bind(limit)
        .all();
      return results;
    },
  };
}
