// ==================== MASTER INDEX.JS ====================
// This file imports and exports all Cloud Functions from separate modules

// Import all functions from separate files
const githubFunctions = require('./github/fgithubsetup');
const popularFunctions = require('./post/fpostupdates');
const trendingFunctions = require('./trends/ftrends');
const usernameFunctions = require('./auth/fusername');
const conversationsFunctions = require('./fconversations');

// ==================== GITHUB FUNCTIONS ====================
exports.githubCallback = githubFunctions.githubCallback;
exports.exchangeGitHubToken = githubFunctions.exchangeGitHubToken;
exports.validateGitHubRepo = githubFunctions.validateGitHubRepo;
exports.addGitHubCollaborator = githubFunctions.addGitHubCollaborator;
exports.githubWebhook = githubFunctions.githubWebhook;
exports.setupGitHubWebhook = githubFunctions.setupGitHubWebhook;

// ==================== POPULAR POSTS/USERS FUNCTIONS ====================
exports.updatePopularPosts = popularFunctions.updatePopularPosts;
exports.updatePopularUsers = popularFunctions.updatePopularUsers;

exports.triggerPopularPostsUpdate = popularFunctions.triggerPopularPostsUpdate;
exports.triggerPopularUsersUpdate = popularFunctions.triggerPopularUsersUpdate;
exports.checkAggregatedStatus = popularFunctions.checkAggregatedStatus;
exports.getFollowingpost=popularFunctions.getFollowingpost;

// ==================== TRENDING FUNCTIONS ====================
exports.updateTrendingPosts = trendingFunctions.updateTrendingPosts;
exports.fetchGitHubTrending = trendingFunctions.fetchGitHubTrending;
exports.fetchHackerNewsTrending = trendingFunctions.fetchHackerNewsTrending;
exports.fetchDevToTrending = trendingFunctions.fetchDevToTrending;
exports.fetchTrends = trendingFunctions.fetchTrends;
exports.getTrendingQuestions=trendingFunctions.getTrendingQuestions;

// ==================== USERNAME FUNCTIONS ====================
exports.checkUsernameAvailability = usernameFunctions.checkUsernameAvailability;
exports.checkMultipleUsernames = usernameFunctions.checkMultipleUsernames;
exports.suggestUsernames = usernameFunctions.suggestUsernames;
exports.getUserProfile=usernameFunctions.getUserProfile;

// ==================== CONVERSATIONS FUNCTIONS ====================
exports.getUserConversations = conversationsFunctions.getUserConversations;
exports.updateUserConversationsOnChatChange = conversationsFunctions.updateUserConversationsOnChatChange;
exports.searchUsers = conversationsFunctions.searchUsers;
exports.fixChatParticipants = conversationsFunctions.fixChatParticipants;