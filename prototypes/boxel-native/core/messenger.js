// Stand-in for matrix-sdk-rust's SQLite timeline store (Element X), not
// matrix-js-sdk. The host keeps JS; the NativeScript app should bind the
// UniFFI MatrixRustSDK and keep this schema only until that FFI is wired.
export class Messenger {
  constructor(db) {
    this.db = db;
  }

  listRooms() {
    return this.db
      .all(
        `SELECT r.id, r.title, r.subtitle, r.updated_at,
                (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) AS message_count,
                (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id AND m.sync_state != 'synced') AS unsynced_count
         FROM rooms r
         ORDER BY r.updated_at DESC`,
      )
      .map((row) => ({
        ...row,
        message_count: Number(row.message_count),
        unsynced_count: Number(row.unsynced_count),
      }));
  }

  getRoom(id) {
    return this.db.get(`SELECT * FROM rooms WHERE id = ?`, [id]);
  }

  listMessages(roomId) {
    return this.db.all(
      `SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC`,
      [roomId],
    );
  }

  send({ roomId, sender, body, cardUrl = null, syncState = 'queued' }) {
    const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = Date.now();
    this.db.run(
      `INSERT INTO messages (id, room_id, sender, body, card_url, created_at, sync_state)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, roomId, sender, body, cardUrl, createdAt, syncState],
    );
    this.db.run(`UPDATE rooms SET updated_at = ?, subtitle = ? WHERE id = ?`, [
      createdAt,
      body.slice(0, 80),
      roomId,
    ]);
    return this.db.get(`SELECT * FROM messages WHERE id = ?`, [id]);
  }

  markSynced(messageId) {
    this.db.run(`UPDATE messages SET sync_state = 'synced' WHERE id = ?`, [
      messageId,
    ]);
  }

  queuedMessages() {
    return this.db.all(
      `SELECT * FROM messages WHERE sync_state = 'queued' ORDER BY created_at ASC`,
    );
  }

  createRoom({ id, title, subtitle = '' }) {
    this.db.run(
      `INSERT INTO rooms (id, title, subtitle, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title`,
      [id, title, subtitle, Date.now()],
    );
    return this.getRoom(id);
  }
}
