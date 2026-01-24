const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const axios = require('axios');

if (!admin.apps.length) {
  admin.initializeApp();
}

const trendCache = new Map();
const TREND_CACHE_TTL = 5 * 60 * 1000;

// ==================== HELPER FUNCTIONS ====================
function getCachedTrend(key) {
  const cached = trendCache.get(key);
  if (!cached) return null;

  if (Date.now() > cached.expiry) {
    trendCache.delete(key);
    return null;
  }

  console.log(`⚡ Trend cache HIT: ${key}`);
  return cached.data;
}

function setCachedTrend(key, data) {
  trendCache.set(key, {
    data,
    expiry: Date.now() + TREND_CACHE_TTL,
  });
  console.log(`💾 Trend cache SET: ${key}`);
}

// ==================== HELPER FUNCTIONS (NOT EXPORTED) ====================
async function fetchGitHubTrendingHelper(params) {
  const { language = 'javascript', days = 7 } = params || {};

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const dateStr = sinceDate.toISOString().split('T')[0];

  const query = `created:>${dateStr} language:${language}`;

  const response = await axios.get(
    'https://api.github.com/search/repositories',
    {
      params: {
        q: query,
        sort: 'stars',
        order: 'desc',
        per_page: 20,
      },
      headers: {
        Accept: 'application/vnd.github.v3+json',
        ...(process.env.GITHUB_TRENDING_TOKEN && {
          Authorization: `Bearer ${process.env.GITHUB_TRENDING_TOKEN}`
        }),
      },
    }
  );

  const repos = response.data.items || [];

  return repos.map(repo => ({
    id: `github_${repo.id}`,
    source: 'GitHub',
    type: 'repository',
    title: repo.full_name,
    description: repo.description || '',
    url: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    language: repo.language,
    timestamp: new Date(),
  }));
}

async function fetchHackerNewsTrendingHelper() {
  const topStories = await axios.get(
    'https://hacker-news.firebaseio.com/v0/topstories.json'
  );

  const ids = topStories.data.slice(0, 20);

  const stories = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await axios.get(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`
        );
        return res.data;
      } catch {
        return null;
      }
    })
  );

  return stories
    .filter(Boolean)
    .map(story => ({
      id: `hn_${story.id}`,
      source: 'Hacker News',
      type: 'story',
      title: story.title,
      url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
      score: story.score,
      comments: story.descendants || 0,
      author: story.by,
      timestamp: new Date(story.time * 1000),
    }));
}

async function fetchDevToTrendingHelper(params) {
  const { tag = 'react', limit = 20 } = params || {};

  const response = await axios.get(
    'https://dev.to/api/articles',
    {
      params: {
        tag,
        per_page: limit,
        top: 7,
      },
    }
  );

  return response.data.map(article => ({
    id: `devto_${article.id}`,
    source: 'Dev.to',
    type: 'article',
    title: article.title,
    description: article.description,
    url: article.url,
    author: article.user?.name,
    reactions: article.public_reactions_count,
    comments: article.comments_count,
    timestamp: new Date(article.published_at),
  }));
}

// ==================== TRENDING SCORE CALCULATOR ====================
exports.updateTrendingPosts = onSchedule(
  {
    schedule: 'every 3 hours',
    timeZone: 'America/New_York',
    memory: '512MB',
  },
  async (event) => {
    console.log('🔄 Calculating trending posts...');
    
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const postsSnapshot = await admin.firestore()
        .collection('posts')
        .where('createdAt', '>=', sevenDaysAgo)
        .orderBy('createdAt', 'desc')
        .limit(300)
        .get();

      if (postsSnapshot.empty) {
        console.log('⚠️ No recent posts found');
        return null;
      }

      const postsWithScores = postsSnapshot.docs.map(doc => {
        const data = doc.data();
        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
        const ageInHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
        
        const likes = data.likeCount || 0;
        const comments = data.commentsCount || 0;
        const engagement = likes + (comments * 2);
        const trendingScore = engagement / Math.pow(ageInHours + 2, 1.5);

        return {
          id: doc.id,
          postId: doc.id,
          userId: data.userId,
          username: data.username,
          imageUrl: data.imageUrl || null,
          userAvatar: data.userAvatar || null,
          caption: data.caption || data.content || '',
          likeCount: likes,
          likedBy: data.likedBy || [],
          createdAt: data.createdAt,
          trendingScore,
          ageInHours: Math.round(ageInHours),
        };
      });

      const trendingPosts = postsWithScores
        .sort((a, b) => b.trendingScore - a.trendingScore)
        .slice(0, 30);

      await admin.firestore()
        .collection('aggregated')
        .doc('trendingPosts')
        .set({
          posts: trendingPosts,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          totalPosts: trendingPosts.length,
        });

      console.log(`✅ Successfully calculated ${trendingPosts.length} trending posts`);
      
      return null;
    } catch (error) {
      console.error('❌ Error calculating trending posts:', error);
      throw error;
    }
  }
);

// ==================== GITHUB TRENDING (OFFICIAL) ====================
exports.fetchGitHubTrending = onCall(async (request) => {
  try {
    const { language = 'javascript', days = 7 } = request.data || {};
    const repos = await fetchGitHubTrendingHelper({ language, days });
    return repos;
  } catch (error) {
    console.error('❌ GitHub trending error:', error.message);
    throw new HttpsError('internal', 'Failed to fetch GitHub trends');
  }
});

// ==================== HACKER NEWS TRENDING ====================
exports.fetchHackerNewsTrending = onCall(async (request) => {
  try {
    const stories = await fetchHackerNewsTrendingHelper();
    return stories;
  } catch (error) {
    console.error('❌ HN error:', error.message);
    throw new HttpsError('internal', 'Failed to fetch Hacker News trends');
  }
});

// ==================== DEV.TO TRENDING ====================
exports.fetchDevToTrending = onCall(async (request) => {
  try {
    const { tag = 'react', limit = 20 } = request.data || {};
    const articles = await fetchDevToTrendingHelper({ tag, limit });
    return articles;
  } catch (error) {
    console.error('❌ Dev.to error:', error.message);
    throw new HttpsError('internal', 'Failed to fetch Dev.to trends');
  }
});

// ==================== UNIFIED TREND FEED ====================
exports.fetchTrends = onCall(async (request) => {
  const { language = 'javascript', tag = 'react' } = request.data || {};

  const cacheKey = `trends_${language}_${tag}`;

  const cached = getCachedTrend(cacheKey);
  if (cached) {
    return {
      ...cached,
      cached: true,
    };
  }

  console.log('🌐 Fetching fresh trends...');

  try {
    const [github, hn, devto] = await Promise.allSettled([
      fetchGitHubTrendingHelper({ language }),
      fetchHackerNewsTrendingHelper(),
      fetchDevToTrendingHelper({ tag }),
    ]);

    const result = {
      github: github.status === 'fulfilled' ? github.value : [],
      hackerNews: hn.status === 'fulfilled' ? hn.value : [],
      devto: devto.status === 'fulfilled' ? devto.value : [],
      generatedAt: new Date().toISOString(),
    };

    setCachedTrend(cacheKey, result);

    return {
      ...result,
      cached: false,
    };
  } catch (error) {
    console.error('❌ fetchTrends error:', error.message);
    throw new HttpsError('internal', 'Failed to fetch trends');
  }
});

exports.getTrendingQuestions = onCall(async (request) => {
  try {
    const db = admin.firestore();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const questionsSnapshot = await db
      .collection('questions')
      .where('timestamp', '>=', thirtyDaysAgo)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    const questions = questionsSnapshot.docs.map(doc => {
      const data = doc.data();
      const timestamp = data.timestamp?.toDate?.() || new Date();
      const ageInDays = (Date.now() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
      const decayFactor = 1 / (1 + ageInDays / 7);
      const trendingScore = (data.likes || 0) * decayFactor;

      return {
        id: doc.id,
        title: data.title,
        content: data.content,
        username: data.username,
        userImage: data.userImage,
        timestamp: timestamp.toISOString(),
        authorId: data.authorId,
        likes: data.likes || 0,
        imageUrl: data.imageUrl || null,
        trendingScore,
        tags: data.tags || [],
        answers: data.answers || [],
        likedBy: data.likedBy || [],
      };
    });

    return questions
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, 10);

  } catch (error) {
    console.error('❌ Error fetching trending questions:', error);
    throw new HttpsError('internal', 'Error fetching trending questions');
  }
});
