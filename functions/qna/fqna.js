// functions/search/searchFunctions.js
// Firebase Cloud Functions for Q&A search and tags (v2 callables for correct auth context)

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Load Popular Tags
 * Cloud Function to get most popular tags from recent questions
 * Reduces client-side Firestore reads significantly
 */
exports.getPopularTags = onCall(async (request) => {
  try {
    // Verify user is authenticated (v2: use request.auth)
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'User must be authenticated to fetch popular tags'
      );
    }

    const data = request.data || {};
    const limit = data.limit || 500;
    const topTagsCount = data.topCount || 20;

    // Fetch recent questions
    const questionsSnapshot = await db
      .collection('questions')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    // Count tags
    const tagCount = {};
    
    questionsSnapshot.docs.forEach(doc => {
      const questionData = doc.data();
      const tags = Array.isArray(questionData.tags) ? questionData.tags : [];
      
      tags.forEach(tag => {
        // Sanitize and validate tag
        if (typeof tag === 'string') {
          const sanitizedTag = tag
            .trim()
            .toLowerCase()
            .replace(/[<>]/g, '')
            .substring(0, 50);
          
          if (sanitizedTag.length > 0) {
            tagCount[sanitizedTag] = (tagCount[sanitizedTag] || 0) + 1;
          }
        }
      });
    });

    // Sort and get top tags
    const sortedTags = Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topTagsCount)
      .map(([tag, count]) => ({ tag, count }));

    return {
      success: true,
      tags: sortedTags,
      totalQuestions: questionsSnapshot.size,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

  } catch (error) {
    console.error('Error in getPopularTags:', error);
    throw new HttpsError(
      'internal',
      'Failed to fetch popular tags',
      error.message
    );
  }
});

/**
 * Search Questions
 * Cloud Function to search questions by title/content
 * Returns ranked results
 */
exports.searchQuestions = onCall(async (request) => {
  try {
    // Verify authentication (v2: use request.auth)
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'User must be authenticated to search questions'
      );
    }

    const data = request.data || {};
    const { query, limit = 20 } = data;

    // Validate input
    if (!query || typeof query !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'Search query must be a non-empty string'
      );
    }

    // Sanitize query
    const sanitizedQuery = query
      .trim()
      .toLowerCase()
      .replace(/[<>]/g, '')
      .substring(0, 100);

    if (sanitizedQuery.length < 2) {
      return {
        success: true,
        results: [],
        query: sanitizedQuery
      };
    }

    // Fetch recent questions (client-side filtering will be minimal)
    const questionsSnapshot = await db
      .collection('questions')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    // Filter and rank results
    const results = [];
    
    questionsSnapshot.docs.forEach(doc => {
      const questionData = doc.data();
      const title = (questionData.title || '').toLowerCase();
      const content = (questionData.content || '').toLowerCase();
      
      // Check if query matches
      if (title.includes(sanitizedQuery) || content.includes(sanitizedQuery)) {
        // Calculate relevance score
        let score = 0;
        
        // Title match is more relevant
        if (title.includes(sanitizedQuery)) {
          score += 10;
          if (title.startsWith(sanitizedQuery)) {
            score += 5; // Exact start match
          }
        }
        
        // Content match
        if (content.includes(sanitizedQuery)) {
          score += 5;
        }
        
        // Boost by likes
        score += (questionData.likes || 0) * 0.1;
        
        // Recent questions get slight boost
        const daysSinceCreation = (Date.now() - questionData.timestamp?.toMillis()) / (1000 * 60 * 60 * 24);
        if (daysSinceCreation < 7) {
          score += 2;
        }

        results.push({
          id: doc.id,
          title: questionData.title || '',
          content: questionData.content || '',
          username: questionData.username || 'Anonymous',
          userImage: questionData.userImage || 'https://placehold.co/100',
          timestamp: questionData.timestamp?.toMillis() || Date.now(),
          answers: Array.isArray(questionData.answers) ? questionData.answers : [],
          tags: Array.isArray(questionData.tags) ? questionData.tags : [],
          authorId: questionData.authorId,
          likes: questionData.likes || 0,
          likedBy: Array.isArray(questionData.likedBy) ? questionData.likedBy : [],
          imageUrl: questionData.imageUrl || null,
          relevanceScore: score
        });
      }
    });

    // Sort by relevance score and limit results
    const rankedResults = results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit)
      .map(result => {
        // Remove score from final result
        const { relevanceScore, ...rest } = result;
        return rest;
      });

    return {
      success: true,
      results: rankedResults,
      query: sanitizedQuery,
      totalMatches: results.length
    };

  } catch (error) {
    console.error('Error in searchQuestions:', error);
    throw new HttpsError(
      'internal',
      'Failed to search questions',
      error.message
    );
  }
});

/**
 * Search by Tags
 * Cloud Function to search questions by tags
 */
exports.searchByTags = onCall(async (request) => {
  try {
    // Verify authentication (v2: use request.auth)
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'User must be authenticated to search by tags'
      );
    }

    const data = request.data || {};
    const { tag, limit = 20 } = data;

    // Validate input
    if (!tag || typeof tag !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'Tag must be a non-empty string'
      );
    }

    // Sanitize tag
    const sanitizedTag = tag
      .trim()
      .toLowerCase()
      .replace(/[<>]/g, '')
      .substring(0, 50);

    if (sanitizedTag.length === 0) {
      return {
        success: true,
        results: [],
        tag: sanitizedTag
      };
    }

    // Fetch questions with the tag
    // Note: For better performance, consider adding a composite index on tags + timestamp
    const questionsSnapshot = await db
      .collection('questions')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    // Filter by tag
    const results = [];
    
    questionsSnapshot.docs.forEach(doc => {
      const questionData = doc.data();
      const tags = Array.isArray(questionData.tags) 
        ? questionData.tags.map(t => t.toLowerCase()) 
        : [];
      
      // Check if tag matches
      if (tags.includes(sanitizedTag) || tags.some(t => t.includes(sanitizedTag))) {
        results.push({
          id: doc.id,
          title: questionData.title || '',
          content: questionData.content || '',
          username: questionData.username || 'Anonymous',
          userImage: questionData.userImage || 'https://placehold.co/100',
          timestamp: questionData.timestamp?.toMillis() || Date.now(),
          answers: Array.isArray(questionData.answers) ? questionData.answers : [],
          tags: Array.isArray(questionData.tags) ? questionData.tags : [],
          authorId: questionData.authorId,
          likes: questionData.likes || 0,
          likedBy: Array.isArray(questionData.likedBy) ? questionData.likedBy : [],
          imageUrl: questionData.imageUrl || null
        });
      }
    });

    // Sort by likes and limit
    const sortedResults = results
      .sort((a, b) => b.likes - a.likes)
      .slice(0, limit);

    return {
      success: true,
      results: sortedResults,
      tag: sanitizedTag,
      totalMatches: results.length
    };

  } catch (error) {
    const detailMessage = error?.message || String(error);
    console.error('Error in searchByTags:', detailMessage, error);
    throw new HttpsError(
      'internal',
      'Failed to search by tags',
      detailMessage
    );
  }
});

/**
 * Advanced Search (combines multiple filters)
 * Search by query, tags, and other filters
 */
exports.advancedSearch = onCall(async (request) => {
  try {
    // Verify authentication (v2: use request.auth)
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'User must be authenticated to perform advanced search'
      );
    }

    const data = request.data || {};
    const { 
      query, 
      tags = [], 
      sortBy = 'relevance', // 'relevance', 'recent', 'popular'
      limit = 20 
    } = data;

    let questionsSnapshot;

    // Build query based on sortBy
    if (sortBy === 'recent') {
      questionsSnapshot = await db
        .collection('questions')
        .orderBy('timestamp', 'desc')
        .limit(200)
        .get();
    } else if (sortBy === 'popular') {
      questionsSnapshot = await db
        .collection('questions')
        .orderBy('likes', 'desc')
        .limit(200)
        .get();
    } else {
      questionsSnapshot = await db
        .collection('questions')
        .orderBy('timestamp', 'desc')
        .limit(200)
        .get();
    }

    const results = [];
    const sanitizedQuery = query ? query.trim().toLowerCase() : '';
    const sanitizedTags = Array.isArray(tags) 
      ? tags.map(t => t.trim().toLowerCase()).filter(Boolean)
      : [];

    questionsSnapshot.docs.forEach(doc => {
      const questionData = doc.data();
      const title = (questionData.title || '').toLowerCase();
      const content = (questionData.content || '').toLowerCase();
      const questionTags = Array.isArray(questionData.tags) 
        ? questionData.tags.map(t => t.toLowerCase()) 
        : [];

      let matches = true;
      let score = 0;

      // Filter by query
      if (sanitizedQuery) {
        const queryMatches = title.includes(sanitizedQuery) || content.includes(sanitizedQuery);
        if (!queryMatches) {
          matches = false;
        } else {
          if (title.includes(sanitizedQuery)) score += 10;
          if (content.includes(sanitizedQuery)) score += 5;
        }
      }

      // Filter by tags
      if (sanitizedTags.length > 0) {
        const hasMatchingTag = sanitizedTags.some(tag => questionTags.includes(tag));
        if (!hasMatchingTag) {
          matches = false;
        } else {
          score += 5;
        }
      }

      if (matches) {
        score += (questionData.likes || 0) * 0.1;
        
        results.push({
          id: doc.id,
          title: questionData.title || '',
          content: questionData.content || '',
          username: questionData.username || 'Anonymous',
          userImage: questionData.userImage || 'https://placehold.co/100',
          timestamp: questionData.timestamp?.toMillis() || Date.now(),
          answers: Array.isArray(questionData.answers) ? questionData.answers : [],
          tags: Array.isArray(questionData.tags) ? questionData.tags : [],
          authorId: questionData.authorId,
          likes: questionData.likes || 0,
          likedBy: Array.isArray(questionData.likedBy) ? questionData.likedBy : [],
          imageUrl: questionData.imageUrl || null,
          relevanceScore: score
        });
      }
    });

    // Sort based on criteria
    let sortedResults;
    if (sortBy === 'relevance') {
      sortedResults = results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    } else if (sortBy === 'recent') {
      sortedResults = results.sort((a, b) => b.timestamp - a.timestamp);
    } else if (sortBy === 'popular') {
      sortedResults = results.sort((a, b) => b.likes - a.likes);
    } else {
      sortedResults = results;
    }

    const finalResults = sortedResults
      .slice(0, limit)
      .map(result => {
        const { relevanceScore, ...rest } = result;
        return rest;
      });

    return {
      success: true,
      results: finalResults,
      query: sanitizedQuery,
      tags: sanitizedTags,
      sortBy,
      totalMatches: results.length
    };

  } catch (error) {
    console.error('Error in advancedSearch:', error);
    throw new HttpsError(
      'internal',
      'Failed to perform advanced search',
      error.message
    );
  }
});

/**
 * Get Trending Tags (based on recent activity)
 * More sophisticated than popular tags
 */
exports.getTrendingTags = onCall(async (request) => {
  try {
    // Verify authentication (v2: use request.auth)
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'User must be authenticated'
      );
    }

    const data = request.data || {};
    const daysBack = data.daysBack || 7;
    const topCount = data.topCount || 20;

    // Calculate timestamp for N days ago
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Fetch recent questions
    const questionsSnapshot = await db
      .collection('questions')
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(cutoffDate))
      .orderBy('timestamp', 'desc')
      .limit(500)
      .get();

    // Count tags with scoring
    const tagStats = {};
    
    questionsSnapshot.docs.forEach(doc => {
      const questionData = doc.data();
      const tags = Array.isArray(questionData.tags) ? questionData.tags : [];
      const likes = questionData.likes || 0;
      const answersCount = Array.isArray(questionData.answers) ? questionData.answers.length : 0;
      
      tags.forEach(tag => {
        const sanitizedTag = tag.trim().toLowerCase();
        
        if (sanitizedTag.length > 0) {
          if (!tagStats[sanitizedTag]) {
            tagStats[sanitizedTag] = {
              count: 0,
              totalLikes: 0,
              totalAnswers: 0,
              trendingScore: 0
            };
          }
          
          tagStats[sanitizedTag].count += 1;
          tagStats[sanitizedTag].totalLikes += likes;
          tagStats[sanitizedTag].totalAnswers += answersCount;
          
          // Calculate trending score
          tagStats[sanitizedTag].trendingScore = 
            (tagStats[sanitizedTag].count * 2) + 
            (tagStats[sanitizedTag].totalLikes * 0.5) + 
            (tagStats[sanitizedTag].totalAnswers * 1);
        }
      });
    });

    // Sort by trending score
    const trendingTags = Object.entries(tagStats)
      .map(([tag, stats]) => ({
        tag,
        count: stats.count,
        totalLikes: stats.totalLikes,
        totalAnswers: stats.totalAnswers,
        trendingScore: stats.trendingScore
      }))
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, topCount);

    return {
      success: true,
      tags: trendingTags,
      period: `${daysBack} days`,
      totalQuestions: questionsSnapshot.size
    };

  } catch (error) {
    console.error('Error in getTrendingTags:', error);
    throw new HttpsError(
      'internal',
      'Failed to fetch trending tags',
      error.message
    );
  }
});