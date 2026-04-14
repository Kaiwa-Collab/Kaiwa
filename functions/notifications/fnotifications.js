/**
 * Notifications cleanup (scheduled).
 *
 * Deletes notifications which are already acted upon (read/handled) and older than 14 days.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const DAYS_14_MS = 14 * 24 * 60 * 60 * 1000;

async function deleteByQuery(query, label) {
  let deleted = 0;
  let lastDoc = null;

  while (true) {
    let q = query.orderBy('createdAt', 'asc').limit(450);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    deleted += snap.size;
    lastDoc = snap.docs[snap.docs.length - 1];

    // Yield a tiny bit to avoid long tight loops.
    await new Promise((r) => setTimeout(r, 25));
  }

  console.log(`[cleanupOldNotifications] ${label} deleted:`, deleted);
  return deleted;
}

// ==================== CLEANUP OLD NOTIFICATIONS (SCHEDULED) ====================
exports.cleanupOldNotifications = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'UTC',
    memory: '256MiB',
  },
  async () => {
    const cutoffDate = new Date(Date.now() - DAYS_14_MS);
    console.log('[cleanupOldNotifications] Starting cleanup. Cutoff:', cutoffDate.toISOString());

    // "Seen" in the app is stored as `read: true`.
    const readQuery = db
      .collection('notifications')
      .where('read', '==', true)
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(cutoffDate));

    // Some notifications may be marked as handled in the future.
    // If the field doesn't exist in your schema, this query will simply delete none.
    const handledQuery = db
      .collection('notifications')
      .where('handled', '==', true)
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(cutoffDate));

    const [readDeleted, handledDeleted] = await Promise.all([
      deleteByQuery(readQuery, 'read'),
      deleteByQuery(handledQuery, 'handled'),
    ]);

    // NOTE: If a notification has both read=true and handled=true, it may be targeted twice,
    // but the second delete will no-op because the doc is already gone (batch commit will still succeed).
    return { readDeleted, handledDeleted, cutoff: cutoffDate.toISOString() };
  }
);

