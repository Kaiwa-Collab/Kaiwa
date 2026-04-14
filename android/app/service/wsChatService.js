// wsChatService.js - FIXED: Auth timeout & race condition resolved

import io from 'socket.io-client';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import functions from '@react-native-firebase/functions';
import axios from 'axios';
import { WS_SERVER_URL } from '../src/config/server_url';
import { API_BASE_URL } from '../src/config/server_url';
import chatSQLiteService from './chatSQLiteService';

// ============================================================================
// LRU CACHE
// ============================================================================

class SimpleLRUCache {
  constructor(options = {}) {
    this.max = options.max || 100;
    this.maxAge = options.maxAge || Infinity;
    this.cache = new Map();
    this.accessOrder = [];
    
  }


  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
      const index = this.accessOrder.indexOf(key);
      if (index > -1) this.accessOrder.splice(index, 1);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
    this.accessOrder.push(key);
    if (this.cache.size > this.max) {
      const oldestKey = this.accessOrder.shift();
      this.cache.delete(oldestKey);
    }
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (this.maxAge !== Infinity && Date.now() - item.timestamp > this.maxAge) {
      this.cache.delete(key);
      const index = this.accessOrder.indexOf(key);
      if (index > -1) this.accessOrder.splice(index, 1);
      return undefined;
    }
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
      this.accessOrder.push(key);
    }
    return item.value;
  }

  has(key) { return this.get(key) !== undefined; }

  delete(key) {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) this.accessOrder.splice(index, 1);
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
    this.accessOrder = [];
  }
}

// ============================================================================
// WEBSOCKET CHAT SERVICE
// ============================================================================

class WebSocketChatService {
  constructor() {
    this.socket = null;
    this.db = firestore();
    this.isConnected = false;

    this.messageCache = new SimpleLRUCache({
      max: 100,
      maxAge: 30 * 60 * 1000,
    });
    this.messageCacheTimestamps = new Map();
    this.listeners = new Map();
    this.presenceMap = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;

    this.isAuthenticated = false;
    this.authenticationPromise = null;

    this.pendingOperations = [];
    this.connectionState = 'disconnected';
    this.lastConnectionError = null;

    this.heartbeatInterval = null;
    this.lastPongTime = null;
    this.lastActivityTime = null;
    this.reconnectTimeout = null;
    this.handlersBound = false;
    this.socketAnyListener = null;
    this.lastReceivedMessageIds = new Map(); 
  }

  // ============================================================================
  // FIX #1: Separate Firebase token wait from WebSocket auth wait
  // fetchMessageHistory is plain HTTP — it only needs a valid Firebase token,
  // NOT a connected WebSocket. Never block HTTP calls on socket auth state.
  // ============================================================================

  /**
   * Waits for a valid Firebase user token.
   * Used by: fetchMessageHistory (HTTP endpoint)
   * Does NOT depend on WebSocket state at all.
   */
  async waitForFirebaseUser(timeoutMs = 15000) {
    const user = auth().currentUser;
    if (user) return user;

    console.log('⏳ Waiting for Firebase user...');

    return new Promise((resolve, reject) => {
      const start = Date.now();
      // Use onAuthStateChanged instead of polling — more reliable
      const unsubscribe = auth().onAuthStateChanged((firebaseUser) => {
        if (firebaseUser) {
          unsubscribe();
          resolve(firebaseUser);
        } else if (Date.now() - start > timeoutMs) {
          unsubscribe();
          reject(new Error('Firebase user not available - user may not be logged in'));
        }
      });

      // Also set a hard timeout
      setTimeout(() => {
        unsubscribe();
        const currentUser = auth().currentUser;
        if (currentUser) {
          resolve(currentUser);
        } else {
          reject(new Error('Authentication timed out - please log in again'));
        }
      }, timeoutMs);
    });
  }

  /**
   * Waits for WebSocket to be connected AND authenticated.
   * Used by: sendMessage, joinChat (requires live socket)
   */
  async waitForSocketAuth(timeoutMs = 15000) {
    if (this.isAuthenticated && this.isConnected) {
      return true;
    }

    if (this.authenticationPromise) {
      try {
        await this.authenticationPromise;
        return this.isAuthenticated;
      } catch (error) {
        console.warn('⚠️ Auth promise rejected:', error.message);
        return false;
      }
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (this.isAuthenticated && this.isConnected) {
          clearInterval(checkInterval);
          resolve(true);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          console.warn('⚠️ Socket auth timeout - proceeding without socket');
          resolve(false);
        }
      }, 200);
    });
  }

  // Keep old name as alias for backward compat with sendMessage etc.
  async waitForAuth(timeoutMs = 15000) {
    return this.waitForSocketAuth(timeoutMs);
  }

  // ============================================================================
  // CONNECT
  // ============================================================================

  async connect() {
    if (this.connectionState === 'connecting') {
      console.log('⏳ Connection already in progress...');
      return this.authenticationPromise;
    }

    if (this.isConnected && this.isAuthenticated) {
      console.log('✅ Already connected and authenticated');
      return Promise.resolve(auth().currentUser?.uid);
    }

    this.connectionState = 'connecting';

    try {
      console.log('🔌 STARTING WEBSOCKET CONNECTION');
      console.log('📍 Server URL:', WS_SERVER_URL);

      // FIX #2: Use onAuthStateChanged-based wait, not polling
      let currentUser;
      try {
        currentUser = await this.waitForFirebaseUser(10000);
      } catch (e) {
        throw new Error('User must be authenticated to connect');
      }

      // Get fresh token
      let token;
      try {
        console.log('🔑 Getting auth token...');
        token = await currentUser.getIdToken(true);
        console.log('✅ Auth token obtained');
      } catch (tokenError) {
        console.warn('⚠️ First token attempt failed, retrying...');
        await new Promise(r => setTimeout(r, 1000));
        token = await currentUser.getIdToken(true);
        console.log('✅ Auth token obtained on retry');
      }

      if (this.socket) {
        console.log('🔌 Disconnecting existing socket...');
        this.cleanupSocket();
      }

      this.socket = io(WS_SERVER_URL, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: { token },
        timeout: 30000,
        forceNew: true,
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      this.authenticationPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error('❌ CONNECTION TIMEOUT (30s)');
          this.connectionState = 'error';
          this.lastConnectionError = 'Connection timeout';
          reject(new Error('Connection timeout'));
        }, 30000);

        this.socket.on('connect', () => {
          console.log('✅ SOCKET CONNECTED, ID:', this.socket.id);
          this.isConnected = true;
          this.connectionState = 'connected';
          this.reconnectAttempts = 0;
          this.lastConnectionError = null;
          this.lastPongTime = Date.now();
          this.lastActivityTime = Date.now();
        });

        this.socket.on('authenticated', (data) => {
          console.log('✅ AUTHENTICATED, User:', data.userId);
          clearTimeout(timeout);

          this.isAuthenticated = true;
          this.connectionState = 'connected';

          if (data.onlineUserIds && Array.isArray(data.onlineUserIds)) {
            data.onlineUserIds.forEach((uid) => {
              this.presenceMap.set(uid, { online: true });
            });
            this.notifyListeners('presence_snapshot', { onlineUserIds: data.onlineUserIds });
          }

          this.setupEventHandlers();
          this.startHeartbeatMonitoring();
          this.processPendingOperations();
          resolve(data.userId);
        });

        this.socket.on('auth_error', (error) => {
          console.error('❌ AUTH ERROR:', error);
          clearTimeout(timeout);
          this.isAuthenticated = false;
          this.connectionState = 'error';
          this.lastConnectionError = error.message || 'Authentication failed';
          reject(new Error(error.message || 'Authentication failed'));
        });

        this.socket.on('disconnect', (reason) => {
          console.log('⚠️ SOCKET DISCONNECTED:', reason);
          this.isConnected = false;
          this.isAuthenticated = false;
          this.connectionState = 'disconnected';
          this.presenceMap.clear();
          this.notifyListeners('connection_status', { connected: false, reason });

          if (reason === 'transport error' || reason === 'transport close') {
            console.log('🔄 Scheduling reconnection...');
            this.scheduleReconnect();
          }
        });

        this.socket.on('connect_error', (error) => {
          console.error('❌ CONNECT_ERROR:', error?.message);
          this.reconnectAttempts++;
          this.connectionState = 'error';
          this.lastConnectionError = error.message;

          this.notifyListeners('connection_error', {
            error: error.message,
            attempt: this.reconnectAttempts,
          });

          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            clearTimeout(timeout);
            this.connectionState = 'error';
            reject(new Error(`Failed to connect after ${this.maxReconnectAttempts} attempts`));
          }
        });

        this.socket.on('error', (error) => {
          console.error('❌ Socket error:', error?.message);
          this.lastConnectionError = error.message || 'Socket error';
        });

        this.socket.on('reconnect', (attemptNumber) => {
          console.log('✅ RECONNECTED (attempt', attemptNumber, ')');
          this.reconnectAttempts = 0;
          this.connectionState = 'connected';
          this.isConnected = true;        // ← add this
  this.isAuthenticated = true; 
          this.notifyListeners('reconnected', { attemptNumber, connected: true });
        });

        this.socket.on('pong', () => {
          this.lastPongTime = Date.now();
          this.lastActivityTime = Date.now();
        });
      });

      return this.authenticationPromise;
    } catch (error) {
      console.error('❌ CONNECTION SETUP ERROR:', error.message);
      this.isAuthenticated = false;
      this.connectionState = 'error';
      this.lastConnectionError = error.message;
      throw error;
    }
  }

  // ============================================================================
  // FIX #3: fetchMessageHistory uses Firebase token directly, NOT socket auth
  // ============================================================================

  async fetchMessageHistory(chatId, limit = 50, before = null) {
    // This is an HTTP call. We only need a Firebase user, not a socket connection.
    let user;
    try {
      user = await this.waitForFirebaseUser(10000);
    } catch (e) {
      throw new Error('User must be authenticated to fetch messages');
    }

    return this._fetchWithRetry(user, chatId, limit, before);
  }

  async _fetchWithRetry(user, chatId, limit, before, retryCount = 0) {
    const params = { limit };
    if (before) params.before = before;

    try {
      const forceRefresh = retryCount > 0;
      const token = await user.getIdToken(forceRefresh);

      const response = await axios.get(
        `${API_BASE_URL}/api/messages/${chatId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params,
          timeout: 20000,
        }
      );

      const data = response.data;

      if (data.messages && Array.isArray(data.messages)) {
        this.messageCache.set(chatId, data.messages);
        this.messageCacheTimestamps.set(chatId, Date.now());
      }

      return data;
    } catch (error) {
      const status = error.response?.status;

      if ((status === 401 || error.code === 'ECONNABORTED') && retryCount < 3) {
        const delay = (retryCount + 1) * 1500;
        console.warn(`⚠️ Fetch retry ${retryCount + 1} in ${delay}ms (status: ${status})`);
        await new Promise(r => setTimeout(r, delay));
        return this._fetchWithRetry(user, chatId, limit, before, retryCount + 1);
      }

      // Log helpful network diagnosis
      if (error.code === 'ECONNREFUSED') {
        console.error(`❌ Server refused connection at ${API_BASE_URL} — is the EC2 server running?`);
      } else if (error.code === 'ECONNABORTED') {
        console.error('❌ Request timed out — check EC2 security group inbound rules for port 3000');
      } else if (error.code === 'ENETUNREACH') {
        console.error('❌ Network unreachable — check device internet / EC2 IP');
      }

      throw error;
    }
  }

  // ============================================================================
  // RECONNECT / HEARTBEAT
  // ============================================================================

  scheduleReconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      if (!this.isConnected && this.socket) {
        console.log('🔄 Attempting manual reconnection...');
        this.socket.connect();
      }
    }, 2000);
  }

  startHeartbeatMonitoring() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.socket) {
        const now = Date.now();
        const timeSinceLastPong = this.lastPongTime ? now - this.lastPongTime : null;
        const timeSinceLastActivity = this.lastActivityTime ? now - this.lastActivityTime : null;

        // Avoid aggressively self-disconnecting healthy sockets.
        // Socket.IO already has built-in heartbeat/reconnect handling.
        if (
          timeSinceLastPong &&
          timeSinceLastPong > 180000 &&
          (!timeSinceLastActivity || timeSinceLastActivity > 180000)
        ) {
          console.warn('⚠️ CONNECTION APPEARS STALE - requesting reconnect');
          if (this.socket.connected) {
            this.socket.connect();
          }
        }
      }
    }, 30000);
  }

  getConnectionState() {
    return {
      state: this.connectionState,
      isConnected: this.isConnected,
      isAuthenticated: this.isAuthenticated,
      lastError: this.lastConnectionError,
      reconnectAttempts: this.reconnectAttempts,
      transport: this.socket?.io?.engine?.transport?.name || 'none',
      lastPong: this.lastPongTime ? new Date(this.lastPongTime).toISOString() : null,
    };
  }

  processPendingOperations() {
    console.log(`📤 Processing ${this.pendingOperations.length} pending operations`);
    const operations = [...this.pendingOperations];
    this.pendingOperations = [];
    operations.forEach(op => {
      try { op(); } catch (error) { console.error('Error processing pending operation:', error); }
    });
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  setupEventHandlers() {
    console.log('✅ Setting up event handlers');
    if (!this.socket) return;

    if (this.handlersBound) {
      this.socket.off('new_message');
      this.socket.off('message_confirmed');
      this.socket.off('message_error');
      this.socket.off('messages_delivered');
      this.socket.off('messages_read');
      this.socket.off('user_typing');
      this.socket.off('user_status_changed');
      this.socket.off('chat_updated');
      this.socket.off('user_joined_chat');
      this.socket.off('user_left_chat');
      this.socket.off('message_updated');
      if (this.socketAnyListener) {
        this.socket.offAny(this.socketAnyListener);
      }
    }

     this.socket.on('new_message', (message) => {
      if (message.id && message.chatId) {
        this.lastReceivedMessageIds.set(message.chatId, message.id);
         // ✅ Add to in-memory cache immediately (synchronously)
    this.addMessageToCache(message.chatId, message);
        chatSQLiteService.upsertIncomingMessage({
          id: message.id,
          chatId: message.chatId,
          senderId: message.senderId,
          text: message.text || null,
          mediaUrl: message.imageUrl || message.videoUrl || null,
          mediaType: message.messageType || 'text',  // ← guard added
          createdAt: message.createdAt,
        }).catch(e => console.warn('Background message save failed:', e?.message));
      }
      this.notifyListeners('new_message', message);
    });
    
    this.socket.on('message_confirmed', (data) => this.notifyListeners('message_confirmed', data));
    this.socket.on('message_error', (data) => this.notifyListeners('message_error', data));
    this.socket.on('messages_delivered', (data) => this.notifyListeners('messages_delivered', data));
    this.socket.on('messages_read', (data) => this.notifyListeners('messages_read', data));
    this.socket.on('user_typing', (data) => this.notifyListeners('user_typing', data));
    this.socket.on('user_status_changed', (data) => {
      if (data.userId) {
        this.presenceMap.set(data.userId, { online: data.status === 'online', lastSeen: data.lastSeen });
      }
      this.notifyListeners('user_status_changed', data);
    });
    this.socket.on('chat_updated', (data) => this.notifyListeners('chat_updated', data));
    this.socket.on('user_joined_chat', (data) => this.notifyListeners('user_joined_chat', data));
    this.socket.on('user_left_chat', (data) => this.notifyListeners('user_left_chat', data));
    this.socket.on('message_updated', (data) => this.notifyListeners('message_updated', data));
    this.socketAnyListener = () => {
      this.lastActivityTime = Date.now();
    };
    this.socket.onAny(this.socketAnyListener);
    this.handlersBound = true;
  }

  // ============================================================================
  // SOCKET ACTIONS
  // ============================================================================

  cleanupSocket() {
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
    if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
    if (this.socket) {
      if (this.socketAnyListener) {
        this.socket.offAny(this.socketAnyListener);
      }
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.handlersBound = false;
    this.socketAnyListener = null;
  }

  disconnect() {
    console.log('🔌 Disconnecting WebSocket...');
    this.cleanupSocket();
    this.isConnected = false;
    this.isAuthenticated = false;
    this.connectionState = 'disconnected';
    this.presenceMap.clear();
  }

  getUserPresence(userId) {
    if (!userId) return undefined;
    return this.presenceMap.get(userId);
  }

  joinChat(chatId) {
    // Important: the server may require authentication before it honors `join_chat`.
    // Queue joins until we are both connected AND authenticated, otherwise joins can be "lost"
    // (join emitted too early) and the receiver won't get `new_message` events until reopen.
    if (!this.socket || !this.isConnected || !this.isAuthenticated) {
      console.warn('⚠️ Socket not ready (connected/auth), queueing join_chat');
      this.pendingOperations.push(() => this.joinChat(chatId));
      return;
    }
    this.socket.emit('join_chat', { chatId });
  }

  leaveChat(chatId) {
    if (!this.socket || !this.isConnected || !this.isAuthenticated) return;
    this.socket.emit('leave_chat', { chatId });
  }

  async sendMessage(chatId, senderId, text, mediaUrl = null, mediaType = null) {
  const tempId = `temp_${Date.now()}_${Math.random()}`;

  // ── Step 1: SQLite write first, always, before any network check ──
  await chatSQLiteService.saveOptimisticMessage({
    chatId, senderId, text, mediaUrl, mediaType, tempId,
  });

  const resolvedMessageType = mediaUrl && mediaType ? mediaType : 'text';
  const optimisticMessage = {
    id: tempId,
    senderId,
    text: resolvedMessageType === 'text' ? text : null,
    messageType: resolvedMessageType,
    imageUrl: resolvedMessageType === 'image' ? mediaUrl : null,
    videoUrl: resolvedMessageType === 'video' ? mediaUrl : null,
    createdAt: new Date().toISOString(),
    readBy: { [senderId]: new Date().toISOString() },
    deliveredTo: {},
    edited: false,
    status: 'sending',
    tempId,
  };

  // ── Step 2: attempt send — queue if offline ──
  const ackPromise = this._sendOrQueue({ chatId, text, mediaUrl, mediaType, tempId });

  return { tempId, optimisticMessage, ackPromise };
}

// Decides immediately: send now or queue for later
_sendOrQueue({ chatId, text, mediaUrl, mediaType, tempId }) {
  // Check synchronously — no await, no delay
  if (this.isAuthenticated && this.isConnected && this.socket) {
    // Online right now — emit immediately
    return this._emitAndAwaitAck({ chatId, text, mediaUrl, mediaType, tempId });
  }

  // Offline — queue and return a promise that resolves when sent later
  console.log('📦 Offline — queuing:', tempId);
  return new Promise((resolve, reject) => {
    this.pendingOperations.push(() => {
      this._emitAndAwaitAck({ chatId, text, mediaUrl, mediaType, tempId })
        .then(resolve)
        .catch(reject);
    });
  });
}

_emitAndAwaitAck({ chatId, text, mediaUrl, mediaType, tempId }) {
  return new Promise((resolve, reject) => {

    const confirmListener = (data) => {
      if (data?.tempId !== tempId) return;
      cleanup();

      const serverId = data?.message?.id || data?.serverId;
      const createdAtVal = data?.message?.createdAt ?? data?.serverTs;
      let serverTsMs = Date.now();
      if (typeof createdAtVal === 'number') {
        serverTsMs = createdAtVal;
      } else if (typeof createdAtVal === 'string') {
        const parsed = new Date(createdAtVal).getTime();
        if (!Number.isNaN(parsed)) serverTsMs = parsed;
      } else if (createdAtVal?.toDate) {
        serverTsMs = createdAtVal.toDate().getTime();
      }

      if (serverId) {
        chatSQLiteService
          .confirmMessage({ tempId, serverId, serverTs: serverTsMs })
          .catch(e => console.error('SQLite confirmMessage failed:', e?.message));
      }

      resolve({ tempId, message: data.message });
    };

    const errorListener = (data) => {
      if (data?.tempId !== tempId) return;
      cleanup();
      // Server explicitly rejected — mark failed so UI shows retry button
      chatSQLiteService.markMessageFailed(tempId).catch(() => {});
      reject(new Error(data.error || 'Failed to send message'));
    };

    const timeout = setTimeout(() => {
      cleanup();
      // Timeout — do NOT mark failed, keep as sending for reconnect retry
      console.warn('⏱ ACK timeout for', tempId, '— keeping as pending');
      reject(new Error('timeout'));
    }, 30000);

    const cleanup = () => {
      clearTimeout(timeout);
      this.removeListener('message_confirmed', confirmListener);
      this.removeListener('message_error', errorListener);
    };

    this.addListener('message_confirmed', confirmListener);
    this.addListener('message_error', errorListener);

    this.socket.emit('send_message', { chatId, text, mediaUrl, mediaType, tempId });
  });
}
  // ============================================================================
  // CACHE METHODS
  // ============================================================================

  getCachedMessages(chatId) {
    if (!chatId) return null;
    return this.messageCache.get(chatId) || null;
  }

  getCacheAge(chatId) {
  const ts = this.messageCacheTimestamps.get(chatId);
  if (!ts) return Infinity;
  return Date.now() - ts;
}


getLastReceivedMessageId(chatId) {
  return this.lastReceivedMessageIds.get(chatId) || null;
}

 addMessageToCache(chatId, message) {
  if (!chatId || !message?.id) return;
  const MAX_MESSAGES = 100;
  const cached = this.messageCache.get(chatId) || [];
  const exists = cached.some(m => m.id === message.id);
  const updated = exists
    ? cached.map(m => m.id === message.id ? message : m)
    : [message, ...cached];

  // ✅ Write directly to the internal map to avoid resetting the cache timestamp.
  // getCacheAge() tracks when a full history fetch last ran — not individual messages.
  // Resetting the timestamp here would cause shouldSkipFetch to wrongly skip
  // the background network sync on the next screen open.
  const existing = this.messageCache.cache.get(chatId);
  if (existing) {
    existing.value = updated.slice(0, MAX_MESSAGES);
  } else {
    this.messageCache.set(chatId, updated.slice(0, MAX_MESSAGES));
  }
}

  updateMessageInCache(chatId, message) {
    if (!chatId || !message?.id) return;
    const cached = this.messageCache.get(chatId);
    if (cached) this.messageCache.set(chatId, cached.map(m => m.id === message.id ? message : m));
  }

  
appendOlderMessagesToCache(chatId, olderMessages) {
  if (!chatId || !olderMessages?.length) return;
  const cached = this.messageCache.get(chatId) || [];
  const existingIds = new Set(cached.map(m => m.id));
  const newOnes = olderMessages.filter(m => !existingIds.has(m.id));
  this.messageCache.set(chatId, [...cached, ...newOnes]);
}

  removeMessageFromCache(chatId, messageId) {
    if (!chatId || !messageId) return;
    const cached = this.messageCache.get(chatId);
    if (cached) this.messageCache.set(chatId, cached.filter(m => m.id !== messageId));
  }

  notifyMessageUpdated(chatId, message) {
    if (this.socket && this.isConnected && chatId && message) {
      this.socket.emit('message_updated', { chatId, message });
    }
  }

  // ============================================================================
  // STATUS UPDATES
  // ============================================================================

  markMessagesAsDelivered(chatId, messageIds) {
    if (!this.socket || !this.isConnected || messageIds.length === 0) return;
    this.socket.emit('mark_delivered', { chatId, messageIds });
  }

  markMessagesAsRead(chatId, messageIds) {
    if (!this.socket || !this.isConnected || messageIds.length === 0) return;
    this.socket.emit('mark_read', { chatId, messageIds });
  }

  startTyping(chatId) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('typing_start', { chatId });
  }

  stopTyping(chatId) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('typing_stop', { chatId });
  }

  // ============================================================================
  // LISTENER MANAGEMENT
  // ============================================================================

  addListener(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
  }

  removeListener(event, callback) {
    if (this.listeners.has(event)) this.listeners.get(event).delete(callback);
  }

  notifyListeners(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try { callback(data); } catch (error) { console.error(`Error in listener for ${event}:`, error); }
      });
    }
  }

  // ============================================================================
  // FIREBASE METHODS
  // ============================================================================

  async acceptMessageRequest(requestId, recipientId) {
    try {
      const result = await functions().httpsCallable('acceptMessageRequest')({ requestId, recipientId });
      return result.data;
    } catch (error) {
      console.error('Error accepting request:', error);
      throw new Error(error.message || 'Failed to accept message request');
    }
  }

  async rejectMessageRequest(requestId, recipientId) {
    try {
      const requestRef = this.db.collection('messageRequests').doc(requestId);
      const requestDoc = await requestRef.get();
      if (!requestDoc.exists) throw new Error('Message request not found');
      const requestData = requestDoc.data();
      if (requestData.recipientId !== recipientId) throw new Error('Unauthorized to reject this request');
      await requestRef.update({
        status: 'rejected',
        rejectedAt: firestore.FieldValue.serverTimestamp()
      });
      return true;
    } catch (error) {
      throw error;
    }
  }

  generateDirectChatId(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
  }

  generateGroupChatId() {
    return `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  onConnectionChange(callback) {
  this.addListener('connection_status', callback);
  this.addListener('reconnected', callback);
  return () => {
    this.removeListener('connection_status', callback);
    this.removeListener('reconnected', callback);
  };
}
}

const wsChatService = new WebSocketChatService();
export default wsChatService;