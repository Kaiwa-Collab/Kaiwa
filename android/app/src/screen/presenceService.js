// presenceService.js - User online/offline from WebSocket connection only
// No Firestore reads/writes: if the user is connected to the socket, they're online.
// Server sends online list on auth and broadcasts user_status_changed; we keep state in memory.
import wsChatService from '../../service/wsChatService';

const ONLINE_THRESHOLD_MS = 120000;   // 2 min - still "Online" if lastSeen within this
const RECENTLY_ACTIVE_THRESHOLD_MS = 60 * 60 * 1000; // 60 min - "Recently active" below this, "Last seen X" above

function parseLastSeen(lastSeen) {
  if (!lastSeen) return null;
  if (typeof lastSeen === 'string') return new Date(lastSeen);
  if (lastSeen.toDate) return lastSeen.toDate();
  return new Date(lastSeen);
}

class PresenceService {
  constructor() {
    this.isInitialized = false;
    this.currentUserId = null;
  }

  initialize(userId) {
    if (this.isInitialized && this.currentUserId === userId) return;
    this.cleanup();
    this.currentUserId = userId;
    this.isInitialized = true;
  }

  startHeartbeat() {}
  stopHeartbeat() {}
  setupAppStateListener() {}

  cleanup() {
    this.isInitialized = false;
    this.currentUserId = null;
  }

  /**
   * Status text from socket-backed presence { online, lastSeen? }.
   * lastSeen can be ISO string (from server) or Firestore-like.
   */
  getStatusText(presenceData) {
    if (!presenceData) return 'Offline';
    if (presenceData.online === true) return 'Online';

    const lastSeen = parseLastSeen(presenceData.lastSeen);
    if (!lastSeen) return 'Offline';

    const diffMs = Date.now() - lastSeen.getTime();
    if (diffMs < ONLINE_THRESHOLD_MS) return 'Online';
    if (diffMs < RECENTLY_ACTIVE_THRESHOLD_MS) return 'Recently active';
    return 'Offline';
  }

  /**
   * Last-seen display: < 60 min use status "Recently active" (return '' here).
   * >= 60 min return "Last seen X ago" (e.g. "Last seen 2 hours ago").
   */
  getLastSeenText(presenceData) {
    const lastSeen = presenceData?.lastSeen ? parseLastSeen(presenceData.lastSeen) : null;
    if (!lastSeen) return '';
    const diffMs = Date.now() - lastSeen.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Under 60 min: caller shows "Recently active" from status; no "Last seen" here
    if (diffMs < RECENTLY_ACTIVE_THRESHOLD_MS) return '';

    const prefix = 'Last seen ';
    if (diffMins < 60) return `${prefix}${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    if (diffHours < 24) return `${prefix}${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    if (diffDays < 7) return `${prefix}${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    return prefix + lastSeen.toLocaleDateString();
  }

  /**
   * Subscribe to a user's online status from WebSocket only (no Firestore).
   * When socket is connected: use in-memory presence from server events.
   * When socket is disconnected: show Offline.
   * If socket is not connected yet, waits for connection then pushes status (so ChatScreen updates when ready).
   */
  subscribeToUserStatus(userId, callback) {
    if (!userId) return () => {};

    const pushStatus = () => {
      const presence = wsChatService.getUserPresence(userId);
      const statusText = this.getStatusText(presence);
      const lastSeenText = this.getLastSeenText(presence);
      callback(statusText, lastSeenText, presence);
    };

    const onStatusChanged = (data) => {
      if (data.userId === userId) pushStatus();
    };
    const onPresenceSnapshot = () => pushStatus();

    const addRealListeners = () => {
      wsChatService.addListener('user_status_changed', onStatusChanged);
      wsChatService.addListener('presence_snapshot', onPresenceSnapshot);
    };
    const removeRealListeners = () => {
      wsChatService.removeListener('user_status_changed', onStatusChanged);
      wsChatService.removeListener('presence_snapshot', onPresenceSnapshot);
    };

    if (!wsChatService.isConnected) {
      callback('Offline', '', null);
      // Wait for socket to connect, then push status and listen for updates
      const onConnect = () => {
        pushStatus();
        addRealListeners();
        wsChatService.removeListener('presence_snapshot', onConnect);
        clearInterval(pollInterval);
      };
      wsChatService.addListener('presence_snapshot', onConnect);
      const pollInterval = setInterval(() => {
        if (wsChatService.isConnected) onConnect();
      }, 400);
      return () => {
        clearInterval(pollInterval);
        wsChatService.removeListener('presence_snapshot', onConnect);
        removeRealListeners();
      };
    }

    pushStatus();
    addRealListeners();
    return () => removeRealListeners();
  }

  /**
   * Is the current user online? = WebSocket connected.
   */
  isCurrentUserOnline() {
    return wsChatService.isConnected;
  }
}

const presenceService = new PresenceService();
export default presenceService;
