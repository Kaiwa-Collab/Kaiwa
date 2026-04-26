import SQLite from 'react-native-sqlite-storage';
 
SQLite.enablePromise(true);
 
// ─── Constants ────────────────────────────────────────────────────────────────
// ─── Ownership contract ───────────────────────────────────────────────────────
// All writes to the messages table must use exactly one of:
//   saveOptimisticMessage   - optimistic insert before network send (is_mine = 1)
//   confirmMessage          - promote optimistic row after ACK (is_mine = 1)
//   upsertOwnServerMessage  - persist confirmed self-message without optimistic row
//   upsertIncomingMessage   - persist message from another user (is_mine = 0)
//   bulkUpsertServerMessages - bulk server history; caller must set isMine per row
//
// Never pass isMine as a parameter to upsertIncomingMessage - ownership is
// structural, not a flag the caller decides at runtime.
// ───────────────────────────────────────────────────────────────────────────────
 
const DB_NAME = 'chat_messages.db';
const DB_VERSION = '1.0';
const DB_DISPLAY_NAME = 'Chat Messages';
const DB_SIZE = 200000;
 
// ─── Singleton DB handle ──────────────────────────────────────────────────────
 
let _db = null;
 
async function getDB() {
  if (_db) return _db;
  _db = await SQLite.openDatabase(DB_NAME, DB_VERSION, DB_DISPLAY_NAME, DB_SIZE);
  await _initSchema(_db);
  return _db;
}
 
// ─── Schema ───────────────────────────────────────────────────────────────────
 
async function _initSchema(db) {
  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS messages (
      id            TEXT PRIMARY KEY,        -- tempId while pending, serverId after ACK
      chat_id       TEXT NOT NULL,
      sender_id     TEXT NOT NULL,
      text          TEXT,
      media_url     TEXT,
      media_type    TEXT,
      status        TEXT NOT NULL DEFAULT 'sending',
                                             -- 'sending' | 'sent' | 'delivered' | 'seen' | 'failed'
      temp_id       TEXT,                   -- always the original tempId (for dedup)
      server_id     TEXT,                   -- set once ACK received
      created_at    INTEGER NOT NULL,        -- ms since epoch (local clock)
      server_ts     INTEGER,                -- ms since epoch (server clock, set on ACK)
      is_mine       INTEGER NOT NULL DEFAULT 1  -- 1 = sent by current user
    );
  `);
 
  // Indexes for fast per-chat queries and dedup lookups
  await db.executeSql(
    `CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chat_id, created_at DESC);`
  );
  await db.executeSql(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_temp ON messages (temp_id) WHERE temp_id IS NOT NULL;`
  );
  await db.executeSql(
    `CREATE INDEX IF NOT EXISTS idx_messages_server ON messages (server_id) WHERE server_id IS NOT NULL;`
  );
}
 
// ─── Public API ───────────────────────────────────────────────────────────────
 
/**
 * STEP 1 — Optimistically insert a message before it is sent over the wire.
 * Returns the row immediately so the UI can display it.
 */
async function saveOptimisticMessage({ chatId, senderId, text, mediaUrl, mediaType, tempId }) {
  const db = await getDB();
  const now = Date.now();
 
  const row = {
    id: tempId,          // primary key = tempId until ACK replaces it
    chat_id: chatId,
    sender_id: senderId,
    text: text || null,
    media_url: mediaUrl || null,
    media_type: mediaType || null,
    status: 'sending',
    temp_id: tempId,
    server_id: null,
    created_at: now,
    server_ts: null,
    is_mine: 1,
  };
 
  await db.executeSql(
    `INSERT OR IGNORE INTO messages
      (id, chat_id, sender_id, text, media_url, media_type, status, temp_id, server_id, created_at, server_ts, is_mine)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.chat_id, row.sender_id, row.text,
      row.media_url, row.media_type, row.status,
      row.temp_id, row.server_id, row.created_at,
      row.server_ts, row.is_mine,
    ]
  );
 
  return row;
}
 
/**
 * STEP 6 — Called when the server ACK arrives (message_confirmed).
 * Updates status → 'sent', stores the real serverId & server timestamp,
 * and renames the PK from tempId to serverId so future queries use canonical ids.
 */
async function confirmMessage({ tempId, serverId, serverTs }) {
  const db = await getDB();
 
  // If a row with the serverId already exists (e.g. arrived via new_message before ACK),
  // just delete the optimistic row and return — no duplicate needed.
  const [existing] = await db.executeSql(
    `SELECT id FROM messages WHERE server_id = ? LIMIT 1`,
    [serverId]
  );
  if (existing.rows.length > 0) {
    await db.executeSql(`DELETE FROM messages WHERE temp_id = ? AND server_id IS NULL`, [tempId]);
    return;
  }
 
  // Promote the optimistic row: swap PK, set status + server fields
  await db.executeSql(
    `UPDATE messages
     SET id        = ?,
         server_id = ?,
         server_ts = ?,
         status    = 'sent'
     WHERE temp_id = ?`,
    [serverId, serverId, serverTs || Date.now(), tempId]
  );
}
 
/**
 * Mark a message as failed (socket timeout / explicit error).
 * The UI can show a retry affordance.
 */
async function markMessageFailed(tempId) {
  const db = await getDB();
  await db.executeSql(
    `UPDATE messages SET status = 'failed' WHERE temp_id = ?`,
    [tempId]
  );
}

/**
 * Mark an existing message as deleted locally so reopen/hydrate is consistent.
 */
async function markMessageDeleted(messageId, deletedText = 'This message was deleted') {
  const db = await getDB();
  await db.executeSql(
    `UPDATE messages
     SET text = ?,
         media_url = NULL,
         media_type = 'deleted',
         status = CASE
           WHEN status = 'seen' THEN 'seen'
           WHEN status = 'delivered' THEN 'delivered'
           WHEN status = 'failed' THEN 'failed'
           ELSE 'sent'
         END
     WHERE id = ? OR server_id = ? OR temp_id = ?`,
    [deletedText, messageId, messageId, messageId]
  );
}

/**
 * Restore a message in local DB if optimistic deletion fails.
 */
async function restoreMessageContent(message) {
  if (!message?.id) return;
  const db = await getDB();
  await db.executeSql(
    `UPDATE messages
     SET text = ?,
         media_url = ?,
         media_type = ?,
         status = ?
     WHERE id = ? OR server_id = ? OR temp_id = ?`,
    [
      message.text || null,
      message.imageUrl || message.videoUrl || message.mediaUrl || null,
      message.messageType || message.mediaType || null,
      message.status || 'sent',
      message.id,
      message.id,
      message.id,
    ]
  );
}
 
/**
 * Update delivery / read status for one or many server message ids.
 * Never downgrades: seen > delivered > sent.
 */
async function updateDeliveryStatus(serverIds, newStatus) {
  if (!serverIds || serverIds.length === 0) return;
 
  const rank = { sent: 1, delivered: 2, seen: 3 };
  const newRank = rank[newStatus] || 0;
  if (!newRank) return;
 
  const db = await getDB();
 
  // Build a placeholder list:  (?, ?, ?)
  const placeholders = serverIds.map(() => '?').join(', ');
 
  await db.executeSql(
    `UPDATE messages
     SET status = ?
     WHERE server_id IN (${placeholders})
       AND (
        (status = 'sent' AND ? >= ${rank.sent})
        OR (status = 'delivered' AND ? >= ${rank.delivered})
        OR (status = 'sending')
       )`,
    [newStatus, ...serverIds, newRank, newRank]
  );
}
 
/**
 * Insert a message that arrived from someone ELSE (via new_message WS event
 * or fetched from the server). Idempotent — safe to call multiple times.
 */
async function upsertIncomingMessage(msg) {
  const db = await getDB();
 
  await db.executeSql(
    `INSERT OR REPLACE INTO messages
  (id, chat_id, sender_id, text, media_url, media_type, status, temp_id, server_id, created_at, server_ts, is_mine)
 VALUES (?, ?, ?, ?, ?, ?, 'sent', NULL, ?, ?, ?, 0)`,
    [
      msg.id,
      msg.chatId,
      msg.senderId,
      msg.text || null,
      msg.mediaUrl || null,
      msg.mediaType || null,
      msg.id,                           // server_id = id for remote messages
      msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now(),
      msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now(),
    ]
  );
}

/**
 * Upsert a message confirmed as sent by the current user.
 * Always sets is_mine = 1.
 */
async function upsertOwnServerMessage(msg) {
  const db = await getDB();
  const serverTs = msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now();
  const tempId = msg.tempId || null;

  if (tempId) {
    const [existing] = await db.executeSql(
      `SELECT id FROM messages WHERE temp_id = ? LIMIT 1`,
      [tempId]
    );

    if (existing.rows.length > 0) {
      await db.executeSql(
        `UPDATE messages
         SET is_mine = 1,
             server_id = ?,
             server_ts = ?,
             status = CASE
               WHEN status = 'seen' THEN 'seen'
               WHEN status = 'delivered' THEN 'delivered'
               WHEN status = 'failed' THEN 'failed'
               ELSE 'sent'
             END
         WHERE temp_id = ?`,
        [msg.id, serverTs, tempId]
      );
      return;
    }
  }

  await db.executeSql(
    `INSERT OR IGNORE INTO messages
      (id, chat_id, sender_id, text, media_url, media_type, status, temp_id, server_id, created_at, server_ts, is_mine)
     VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, 1)`,
    [
      msg.id,
      msg.chatId,
      msg.senderId,
      msg.text || null,
      msg.mediaUrl || null,
      msg.mediaType || null,
      tempId,
      msg.id,
      serverTs,
      serverTs,
    ]
  );
}
 
/**
 * Load the most recent `limit` messages for a chat, ordered oldest→newest.
 * Merges optimistic (sending/failed) rows in at the bottom.
 */
async function getMessages(chatId, limit = 50, beforeTs = null) {
  const db = await getDB();
 
  const args = [chatId];
  let whereClause = 'chat_id = ?';
  if (beforeTs) {
    whereClause += ' AND created_at < ?';
    args.push(beforeTs);
  }
 
  const [results] = await db.executeSql(
    `SELECT * FROM messages
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT ?`,
    [...args, limit]
  );
 
  const rows = [];
  for (let i = 0; i < results.rows.length; i++) {
    rows.push(results.rows.item(i));
  }
 
  // Return in ascending time order for FlatList (inverted=false style)
  return rows.reverse().map(_toMessageShape);
}
 
/**
 * Retrieve all messages that are still 'sending' — useful on app re-launch
 * to retry or mark as failed.
 */
async function getPendingMessages(chatId) {
  const db = await getDB();
  const [results] = await db.executeSql(
    `SELECT * FROM messages WHERE chat_id = ? AND status = 'sending' ORDER BY created_at ASC`,
    [chatId]
  );
  const rows = [];
  for (let i = 0; i < results.rows.length; i++) {
    rows.push(_toMessageShape(results.rows.item(i)));
  }
  return rows;
}
 
/**
 * Bulk-upsert messages fetched from the server (history load).
 * Uses a transaction for speed.
 */
async function bulkUpsertServerMessages(messages) {
  if (!messages || messages.length === 0) return;
  const db = await getDB();
 
  await db.transaction(async (tx) => {
    for (const msg of messages) {
      // Determine is_mine based on server sender vs current user — pass isMine from caller
      tx.executeSql(
        `INSERT OR IGNORE INTO messages
          (id, chat_id, sender_id, text, media_url, media_type, status, temp_id, server_id, created_at, server_ts, is_mine)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [
          msg.id,
          msg.chatId,
          msg.senderId,
          msg.text || null,
          msg.mediaUrl || null,
          msg.mediaType || null,
          msg.status || 'sent',
          msg.id,
          msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now(),
          msg.serverTs   ? new Date(msg.serverTs).getTime()  : null,
          msg.isMine ? 1 : 0,
        ]
      );
    }
  });
}
 
/**
 * Delete all messages for a chat (e.g. on chat deletion).
 */
async function clearChatMessages(chatId) {
  const db = await getDB();
  await db.executeSql(`DELETE FROM messages WHERE chat_id = ?`, [chatId]);
}

async function debugDumpMessages(chatId) {
  const db = await getDB();
  const [results] = await db.executeSql(
    `SELECT id, temp_id, server_id, status, text, created_at FROM messages 
     WHERE chat_id = ? ORDER BY created_at DESC LIMIT 20`,
    [chatId]
  );

  console.log('=== SQLite Messages Dump ===');
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    console.log(
      `[${i}] status=${row.status} | text="${row.text?.slice(0, 20)}" | temp_id=${row.temp_id?.slice(0, 15)} | server_id=${row.server_id?.slice(0, 15) ?? 'null'}`
    );
  }
  console.log('============================');
}
 
// ─── Internal helpers ─────────────────────────────────────────────────────────
 
function _toMessageShape(row) {
  return {
    id:        row.server_id || row.id,   // canonical id for UI key
    tempId:    row.temp_id,
    chatId:    row.chat_id,
    senderId:  row.sender_id,
    text:      row.text,
    mediaUrl:  row.media_url,
    mediaType: row.media_type,
    status:    row.status,                // 'sending' | 'sent' | 'delivered' | 'seen' | 'failed'
    isMine:    row.is_mine === 1,
    createdAt: row.created_at,
    serverTs:  row.server_ts,
    // Convenience booleans consumed by MessageBubble
    isOptimistic: row.status === 'sending' || row.status === 'failed',
  };
}
 
// ─── Exports ──────────────────────────────────────────────────────────────────
 
const chatSQLiteService = {
  saveOptimisticMessage,
  confirmMessage,
  markMessageFailed,
  markMessageDeleted,
  restoreMessageContent,
  updateDeliveryStatus,
  upsertIncomingMessage,
  upsertOwnServerMessage,
  getMessages,
  getPendingMessages,
  bulkUpsertServerMessages,
  clearChatMessages,
  debugDumpMessages
};
 
export default chatSQLiteService;