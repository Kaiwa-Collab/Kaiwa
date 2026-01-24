# Firestore Read Count Analysis for Scheduled Functions

## 1. updatePopularPosts
**Schedule:** Every 1 hour  
**Reads per execution:**
- Primary query: `.collection('posts').orderBy('likes', 'desc').limit(50).get()` = **50 reads**
- Fallback query (if primary fails): `.collection('posts').orderBy('likeCount', 'desc').limit(50).get()` = **50 reads**
- **Total per execution: 50 reads** (worst case: 100 if fallback is needed)
- **Writes:** 1 write to `aggregated/popularPosts`

**Daily reads:** 50 reads × 24 executions = **1,200 reads/day**

---

## 2. updatePopularUsers
**Schedule:** Every 24 hours (once per day)  
**Reads per execution:**
- Query: `.collection('profile').where('isActive', '==', true).orderBy('followersCount', 'desc').limit(50).get()` = **50 reads**
- **Total per execution: 50 reads**
- **Writes:** 1 write to `aggregated/popularUsers`

**Daily reads:** 50 reads × 1 execution = **50 reads/day**

---

## 3. updateTrendingPosts ⚠️ **HIGH READ COUNT**
**Schedule:** Every 3 hours  
**Reads per execution:**
- Query: `.collection('posts').where('createdAt', '>=', sevenDaysAgo).get()` = **ALL posts from last 7 days**
- **⚠️ NO LIMIT - This reads ALL matching documents!**
- If you have 1,000 posts in the last 7 days = **1,000 reads**
- If you have 10,000 posts in the last 7 days = **10,000 reads**
- **Total per execution: UNBOUNDED (depends on post volume)**
- **Writes:** 1 write to `aggregated/trendingPosts`

**Daily reads:** Unbounded × 8 executions = **VERY HIGH (could be thousands per day)**

---

## Total Daily Read Count Summary

| Function | Reads/Execution | Executions/Day | Total Reads/Day |
|----------|----------------|----------------|-----------------|
| updatePopularPosts | 50 | 24 | **1,200** |
| updatePopularUsers | 50 | 1 | **50** |
| updateTrendingPosts | **Unbounded** | 8 | **VERY HIGH** ⚠️ |

**Total (excluding updateTrendingPosts): ~1,250 reads/day**

**⚠️ CRITICAL ISSUE:** `updateTrendingPosts` has no limit and could read thousands of documents per execution!

---

## Recommendations

### 1. Fix updateTrendingPosts (URGENT)
Add a limit to prevent reading all posts:

```javascript
const postsSnapshot = await admin.firestore()
  .collection('posts')
  .where('createdAt', '>=', sevenDaysAgo)
  .orderBy('createdAt', 'desc')  // Add orderBy for the where clause
  .limit(500)  // Limit to 500 most recent posts
  .get();
```

**With limit of 500:**
- Reads per execution: **500 reads**
- Daily reads: 500 × 8 = **4,000 reads/day**

### 2. Optimize updatePopularPosts
The fallback query is rarely needed. Consider removing it or making it conditional.

### 3. Total Optimized Daily Reads
- updatePopularPosts: 1,200 reads/day
- updatePopularUsers: 50 reads/day  
- updateTrendingPosts (with 500 limit): 4,000 reads/day
- **Total: ~5,250 reads/day**

---

## Cost Estimation (Firestore Pricing)
- Free tier: 50,000 reads/day
- Paid tier: $0.06 per 100,000 reads

**Current (without fix):** Could exceed free tier if trending posts query is unbounded  
**With fix (500 limit):** ~5,250 reads/day = well within free tier




