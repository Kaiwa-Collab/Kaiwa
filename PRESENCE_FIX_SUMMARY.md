# Presence Service Fix - Users Showing as Online When Offline

## Problem
Users were being shown as "Online" even when they were actually offline. This was happening because:

1. **Stale `isOnline` Flag**: The `getStatusText()` method was checking the `isOnline` flag first and trusting it completely, even if the `lastSeen` timestamp was old or missing.

2. **App Crashes/Force Close**: When the app crashes or is force-closed, the cleanup might not run, leaving the `isOnline` flag stuck as `true`.

3. **No Validation**: The system wasn't validating that `isOnline: true` was consistent with recent `lastSeen` timestamps.

## Root Cause

In `getStatusText()` method:
```javascript
// OLD CODE (BUGGY)
if (userProfile.isOnline === true) {
  return 'Online'; // ❌ Returns online even if lastSeen is days old!
}
```

This meant that if `isOnline` was `true` but `lastSeen` was hours/days old, the user would still show as "Online".

## Fixes Applied

### 1. **Fixed Status Detection Logic** ✅
**File:** `android/app/src/screen/presenceService.js`

Changed `getStatusText()` to **always use `lastSeen` as the source of truth**:

```javascript
// NEW CODE (FIXED)
// Always check lastSeen timestamp first (most reliable indicator)
const lastSeen = userProfile.lastSeen;
if (!lastSeen) {
  return userProfile.isOnline === true ? 'Online' : 'Offline';
}

const diffMs = now - lastSeenDate;

// CRITICAL FIX: Always use lastSeen as source of truth
// Even if isOnline flag is true, if lastSeen is old, user is offline
if (diffMs < this.ONLINE_THRESHOLD) {
  return 'Online';
} else if (diffMs < this.RECENTLY_ACTIVE_THRESHOLD) {
  return 'Recently active';
} else {
  return 'Offline'; // ✅ Ignores stale isOnline flag
}
```

**Result:** Users are now correctly marked as offline if `lastSeen` is older than 10 minutes, regardless of the `isOnline` flag.

---

### 2. **Added Stale Status Detection & Auto-Fix** ✅
**File:** `android/app/src/screen/presenceService.js`

Added `checkAndFixStaleOnlineStatus()` method that:
- Checks if `isOnline: true` but `lastSeen` is older than 5 minutes
- Automatically clears the `isOnline` flag if it's stale
- Runs when subscribing to user status
- Runs periodically (every 5 minutes) while monitoring a user

```javascript
async checkAndFixStaleOnlineStatus(userId) {
  // If isOnline is true but lastSeen is older than 5 minutes, clear the flag
  if (isOnline === true && diffMs > 300000) { // 5 minutes
    await profileRef.set({ isOnline: false }, { merge: true });
  }
}
```

**Result:** Automatically fixes stale `isOnline` flags in the database.

---

### 3. **Initialization Cleanup** ✅
**File:** `android/app/src/screen/presenceService.js`

Added cleanup check when initializing presence service:
- Clears any stale online status before setting user as online
- Prevents inheriting stale flags from previous sessions

**Result:** Ensures clean state when app starts.

---

## Status Detection Logic (After Fix)

| Condition | Status Returned |
|-----------|----------------|
| `lastSeen` < 2 minutes ago | **Online** |
| `lastSeen` 2-10 minutes ago | **Recently active** |
| `lastSeen` > 10 minutes ago | **Offline** (ignores `isOnline` flag) |
| No `lastSeen` data | Uses `isOnline` flag as fallback |

## How It Works Now

1. **Real-time Status**: Uses `lastSeen` timestamp as primary indicator
2. **Stale Flag Detection**: Automatically clears `isOnline` if `lastSeen` is > 5 minutes old
3. **Periodic Cleanup**: Checks and fixes stale flags every 5 minutes
4. **Initialization Safety**: Clears stale flags when app starts

## Testing

To verify the fix works:

1. **Test Stale Flag Detection:**
   - Manually set a user's `isOnline: true` in Firestore
   - Set their `lastSeen` to 1 hour ago
   - Check their status - should show "Offline"
   - Wait 5 minutes - `isOnline` should be automatically cleared

2. **Test App Crash Scenario:**
   - Force close the app while user is online
   - Wait 10+ minutes
   - Check user status - should show "Offline" (not "Online")

3. **Test Normal Operation:**
   - User opens app → Shows "Online"
   - User closes app → After 10 minutes, shows "Offline"
   - User reopens app → Shows "Online" again

## Expected Behavior

- ✅ Users show as "Offline" if `lastSeen` is > 10 minutes old
- ✅ Stale `isOnline` flags are automatically cleared
- ✅ Status is always based on actual activity (`lastSeen`), not just a flag
- ✅ No more "ghost online" users

## Files Modified

- `android/app/src/screen/presenceService.js`
  - Fixed `getStatusText()` method
  - Added `checkAndFixStaleOnlineStatus()` method
  - Updated `subscribeToUserStatus()` to include stale checks
  - Updated `initialize()` to clear stale flags on startup





