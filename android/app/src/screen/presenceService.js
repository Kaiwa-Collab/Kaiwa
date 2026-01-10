// presenceService.js - Service for tracking user online/offline status
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { AppState } from 'react-native';

class PresenceService {
  constructor() {
    this.db = firestore();
    this.heartbeatInterval = null;
    this.appStateSubscription = null;
    this.isInitialized = false;
    this.currentUserId = null;
    
    // Configuration - Optimized to reduce writes
    this.HEARTBEAT_INTERVAL = 60000; // 60 seconds (increased from 30s to reduce writes by 50%)
    this.ONLINE_THRESHOLD = 120000; // 2 minutes - user is online if lastSeen within 2 min
    this.RECENTLY_ACTIVE_THRESHOLD = 600000; // 10 minutes - recently active if within 10 min
    this.lastWriteTime = 0; // Track last write to prevent excessive writes
    this.MIN_WRITE_INTERVAL = 30000; // Minimum 30 seconds between writes
  }

  /**
   * Initialize presence tracking for the current user
   */
  initialize(userId) {
    if (this.isInitialized && this.currentUserId === userId) {
      return; // Already initialized for this user
    }

    this.cleanup(); // Clean up any existing tracking
    this.currentUserId = userId;
    this.isInitialized = true;

    // Clear any stale online status before initializing
    // This fixes cases where app crashed and isOnline flag is stuck
    this.checkAndFixStaleOnlineStatus(userId).then(() => {
      // Set initial online status after clearing stale data
      this.setOnlineStatus(true);

      // Start heartbeat
      this.startHeartbeat();

      // Listen to app state changes
      this.setupAppStateListener();
    });
  }

  /**
   * Start sending periodic heartbeat updates
   */
  startHeartbeat() {
    // Send initial heartbeat
    this.updateLastSeen();

    // Set up interval for periodic heartbeats
    this.heartbeatInterval = setInterval(() => {
      if (this.currentUserId && AppState.currentState === 'active') {
        this.updateLastSeen();
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Update lastSeen timestamp in user's profile
   * Optimized to prevent excessive writes
   */
  async updateLastSeen() {
    if (!this.currentUserId) return;

    // Throttle writes to prevent excessive Firestore operations
    const now = Date.now();
    if (this.lastWriteTime && (now - this.lastWriteTime) < this.MIN_WRITE_INTERVAL) {
      return; // Skip if last write was too recent
    }

    try {
      const profileRef = this.db.collection('profile').doc(this.currentUserId);
      await profileRef.set(
        {
          lastSeen: firestore.FieldValue.serverTimestamp(),
          isOnline: true,
        },
        { merge: true }
      );
      this.lastWriteTime = now; // Update last write time
    } catch (error) {
      console.error('[PresenceService] Error updating lastSeen:', error);
    }
  }

  /**
   * Check and fix stale online status
   * This is a safety mechanism to clear isOnline flag if lastSeen is too old
   */
  async checkAndFixStaleOnlineStatus(userId) {
    if (!userId) return;

    try {
      const profileRef = this.db.collection('profile').doc(userId);
      const profileDoc = await profileRef.get();
      
      if (!profileDoc.exists) return;
      
      const profileData = profileDoc.data();
      const lastSeen = profileData?.lastSeen;
      const isOnline = profileData?.isOnline;
      
      // If isOnline is true but lastSeen is missing or too old, clear the flag
      if (isOnline === true && lastSeen) {
        const lastSeenDate = lastSeen.toDate ? lastSeen.toDate() : new Date(lastSeen);
        const now = new Date();
        const diffMs = now - lastSeenDate;
        
        // If lastSeen is older than 5 minutes, clear isOnline flag
        if (diffMs > 300000) { // 5 minutes
          await profileRef.set(
            { isOnline: false },
            { merge: true }
          );
          console.log(`[PresenceService] Cleared stale isOnline flag for user ${userId}`);
        }
      } else if (isOnline === true && !lastSeen) {
        // If isOnline is true but no lastSeen, clear it
        await profileRef.set(
          { isOnline: false },
          { merge: true }
        );
        console.log(`[PresenceService] Cleared isOnline flag (no lastSeen) for user ${userId}`);
      }
    } catch (error) {
      console.error('[PresenceService] Error checking stale online status:', error);
    }
  }

  /**
   * Set online status explicitly
   * Optimized to prevent excessive writes
   */
  async setOnlineStatus(isOnline) {
    if (!this.currentUserId) return;

    // Throttle writes to prevent excessive Firestore operations
    const now = Date.now();
    if (this.lastWriteTime && (now - this.lastWriteTime) < this.MIN_WRITE_INTERVAL) {
      // If going offline, allow immediate write
      if (isOnline) {
        return; // Skip if last write was too recent and we're setting online
      }
    }

    try {
      const profileRef = this.db.collection('profile').doc(this.currentUserId);
      const updateData = {
        isOnline: isOnline,
      };

      if (isOnline) {
        updateData.lastSeen = firestore.FieldValue.serverTimestamp();
      }

      await profileRef.set(updateData, { merge: true });
      this.lastWriteTime = now; // Update last write time
    } catch (error) {
      console.error('[PresenceService] Error setting online status:', error);
    }
  }

  /**
   * Setup listener for app state changes (foreground/background)
   */
  setupAppStateListener() {
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        // App came to foreground
        this.setOnlineStatus(true);
        this.startHeartbeat();
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App went to background
        this.setOnlineStatus(false);
        this.stopHeartbeat();
      }
    });
  }

  /**
   * Stop heartbeat interval
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Cleanup all listeners and intervals
   */
  cleanup() {
    this.stopHeartbeat();

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    // Set offline status when cleaning up
    if (this.currentUserId) {
      this.setOnlineStatus(false).catch(() => {
        // Ignore errors during cleanup
      });
    }

    this.isInitialized = false;
    this.currentUserId = null;
  }

  /**
   * Get online status text based on lastSeen timestamp
   * @param {Object} userProfile - User profile document data
   * @returns {string} - Status text: "Online", "Recently active", or "Offline"
   */
  getStatusText(userProfile) {
    if (!userProfile) return 'Offline';

    // Always check lastSeen timestamp first (most reliable indicator)
    const lastSeen = userProfile.lastSeen;
    if (!lastSeen) {
      // No lastSeen data - check isOnline flag as fallback
      return userProfile.isOnline === true ? 'Online' : 'Offline';
    }

    // Convert Firestore timestamp to Date
    const lastSeenDate = lastSeen.toDate ? lastSeen.toDate() : new Date(lastSeen);
    const now = new Date();
    const diffMs = now - lastSeenDate;

    // CRITICAL FIX: Always use lastSeen as source of truth
    // Even if isOnline flag is true, if lastSeen is old, user is offline
    if (diffMs < this.ONLINE_THRESHOLD) {
      // lastSeen is recent (within 2 minutes) - user is online
      return 'Online';
    } else if (diffMs < this.RECENTLY_ACTIVE_THRESHOLD) {
      // lastSeen is within 10 minutes - user was recently active
      return 'Recently active';
    } else {
      // lastSeen is older than 10 minutes - user is offline
      // Ignore isOnline flag if lastSeen is stale (prevents showing offline users as online)
      return 'Offline';
    }
  }

  /**
   * Format "last seen" time for display
   * @param {Object} userProfile - User profile document data
   * @returns {string} - Formatted time string
   */
  getLastSeenText(userProfile) {
    if (!userProfile || !userProfile.lastSeen) return '';

    const lastSeen = userProfile.lastSeen.toDate 
      ? userProfile.lastSeen.toDate() 
      : new Date(userProfile.lastSeen);
    
    const now = new Date();
    const diffMs = now - lastSeen;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    } else {
      return lastSeen.toLocaleDateString();
    }
  }

  /**
   * Subscribe to a user's online status changes
   * @param {string} userId - User ID to monitor
   * @param {Function} callback - Callback function(statusText, lastSeenText)
   * @returns {Function} - Unsubscribe function
   */
  subscribeToUserStatus(userId, callback) {
    if (!userId) {
      return () => {};
    }

    try {
      const profileRef = this.db.collection('profile').doc(userId);
      
      // Check and fix stale online status when subscribing
      this.checkAndFixStaleOnlineStatus(userId);
      
      // Set up periodic check for stale status (every 5 minutes)
      const staleCheckInterval = setInterval(() => {
        this.checkAndFixStaleOnlineStatus(userId);
      }, 300000); // 5 minutes
      
      const unsubscribe = profileRef.onSnapshot(
        (doc) => {
          if (doc.exists) {
            const profileData = doc.data();
            const statusText = this.getStatusText(profileData);
            const lastSeenText = this.getLastSeenText(profileData);
            callback(statusText, lastSeenText, profileData);
          } else {
            callback('Offline', '', null);
          }
        },
        (error) => {
          console.error('[PresenceService] Error subscribing to user status:', error);
          callback('Offline', '', null);
        }
      );

      // Return cleanup function that clears both the snapshot listener and interval
      return () => {
        unsubscribe();
        clearInterval(staleCheckInterval);
      };
    } catch (error) {
      console.error('[PresenceService] Error setting up status subscription:', error);
      return () => {};
    }
  }
}

// Export singleton instance
const presenceService = new PresenceService();
export default presenceService;


