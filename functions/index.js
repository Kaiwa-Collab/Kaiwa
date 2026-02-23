// ==================== MASTER INDEX.JS ====================
// This file imports and exports all Cloud Functions from separate modules

// Import all functions from separate files
const githubFunctions = require('./github/fgithubsetup');
const popularFunctions = require('./post/fpostupdates');
const trendingFunctions = require('./trends/ftrends');
const usernameFunctions = require('./auth/fusername');
const conversationsFunctions = require('./fconversations');
const chatFunctions = require('./chatsystem/fchat');

const searchFunctions = require('./qna/fqna');
const profileFunctions = require('./profile/fprofile');
const searchPageFunctions = require('./search/fsearch');

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

// ==================== CHAT FUNCTIONS ====================
exports.createDirectChat = chatFunctions.createDirectChat;
exports.acceptMessageRequest = chatFunctions.acceptMessageRequest;
exports.markMessagesAsRead = chatFunctions.markMessagesAsRead;
exports.createGroupChat = chatFunctions.createGroupChat;
exports.deleteChatPermanently = chatFunctions.deleteChatPermanently;
exports.onMessageCreated= chatFunctions.onMessageCreated;

exports.getPopularTags = searchFunctions.getPopularTags;
exports.searchQuestions = searchFunctions.searchQuestions;
exports.searchByTags = searchFunctions.searchByTags;
exports.advancedSearch = searchFunctions.advancedSearch;
exports.getTrendingTags = searchFunctions.getTrendingTags;

// ==================== PROFILE FUNCTIONS ====================
exports.sendFollowRequest = profileFunctions.sendFollowRequest;
exports.unfollow = profileFunctions.unfollow;
exports.createCollaboration = profileFunctions.createCollaboration;
exports.updateCollaboration = profileFunctions.updateCollaboration;
exports.deleteCollaboration = profileFunctions.deleteCollaboration;
exports.deleteQuestion = profileFunctions.deleteQuestion;
exports.createNotification = profileFunctions.createNotification;
exports.getProfileData = profileFunctions.getProfileData;
exports.getUserQuestions = profileFunctions.getUserQuestions;
exports.getUserCollaborationProjects = profileFunctions.getUserCollaborationProjects;
exports.getFollowingUsers = profileFunctions.getFollowingUsers;
exports.getProjectParticipants = profileFunctions.getProjectParticipants;
exports.ensureProfileExists = profileFunctions.ensureProfileExists;
exports.createPost = profileFunctions.createPost;
exports.updateAvatar = profileFunctions.updateAvatar;
exports.isFollowing = profileFunctions.isFollowing;
exports.onProfileAvatarUpdate = profileFunctions.onProfileAvatarUpdate;

// ==================== SEARCH PAGE FUNCTIONS ====================
exports.searchPageUsers = searchPageFunctions.searchPageUsers;
exports.searchProjects = searchPageFunctions.searchProjects;
exports.getFollowRequestsCount = searchPageFunctions.getFollowRequestsCount;
exports.getSearchSuggestions = searchPageFunctions.getSearchSuggestions;
exports.getProjectSuggestions = searchPageFunctions.getProjectSuggestions;
exports.saveSearchSuggestion = searchPageFunctions.saveSearchSuggestion;
exports.saveProjectSuggestion = searchPageFunctions.saveProjectSuggestion;
exports.removeSearchSuggestion = searchPageFunctions.removeSearchSuggestion;
exports.removeProjectSuggestion = searchPageFunctions.removeProjectSuggestion;