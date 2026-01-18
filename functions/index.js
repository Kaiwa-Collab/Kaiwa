const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');

// Lazy load heavy dependencies
let axios, admin, crypto;

function initDependencies() {
  if (!axios) axios = require('axios');
  if (!admin) {
    admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp();
    }
  }
  if (!crypto) crypto = require('crypto');
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

// ==================== USERNAME CHECKING ====================
exports.checkUsernameAvailability = onCall(async (request) => {
   initDependencies();
  console.log('🔍 Checking username availability:', request.data?.username);
  
  const { username } = request.data;
  
  if (!username) {
    throw new HttpsError('invalid-argument', 'Username is required');
  }

  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    throw new HttpsError(
      'invalid-argument',
      'Username must be 3-20 characters long and contain only letters, numbers, and underscores'
    );
  }

  try {
    const usernameLower = username.toLowerCase();

    // Check in profile collection for username
    const usernameQuery = await admin.firestore()
      .collection('profile')
      .where('usernameLower', '==', usernameLower)
      .limit(1)
      .get();

    let isAvailable = usernameQuery.empty;

    // If username is taken, check if it belongs to the current authenticated user
    // (This allows a user to "re-save" their existing username)
    if (!isAvailable && request.auth?.uid) {
      const existingDoc = usernameQuery.docs[0];
      
      // Only mark as available if this exact user owns this username
      if (existingDoc.id === request.auth.uid) {
        console.log(`✅ Username "${username}" belongs to current user (${request.auth.uid}) - available for re-use`);
        isAvailable = true;
      }
    }

    console.log(`✅ Username "${username}" is ${isAvailable ? 'available' : 'taken'}`);

    return {
      available: isAvailable,
      username: username,
      message: isAvailable 
        ? `Username "${username}" is available!` 
        : `Username "${username}" is already taken`,
    };
  } catch (error) {
    console.error('❌ Error checking username:', error);
    throw new HttpsError('internal', 'Failed to check username availability');
  }
});

exports.checkMultipleUsernames = onCall(async (request) => {
   initDependencies();
  console.log('🔍 Checking multiple usernames:', request.data?.usernames);
  
  const { usernames } = request.data;
  
  if (!Array.isArray(usernames) || usernames.length === 0) {
    throw new HttpsError('invalid-argument', 'Usernames array is required');
  }

  if (usernames.length > 10) {
    throw new HttpsError('invalid-argument', 'Maximum 10 usernames can be checked at once');
  }

  try {
    const results = await Promise.all(
      usernames.map(async (username) => {
        const usernameLower = username.toLowerCase();
        
        const query = await admin.firestore()
          .collection('profile')
          .where('usernameLower', '==', usernameLower)
          .limit(1)
          .get();

        return {
          username,
          available: query.empty,
        };
      })
    );

    console.log(`✅ Checked ${results.length} usernames`);

    return {
      results,
      availableCount: results.filter(r => r.available).length,
    };
  } catch (error) {
    console.error('❌ Error checking usernames:', error);
    throw new HttpsError('internal', 'Failed to check usernames');
  }
});

exports.suggestUsernames = onCall(async (request) => {
   initDependencies();
  console.log('💡 Generating username suggestions for:', request.data?.baseName);
  
  const { baseName } = request.data;
  
  if (!baseName) {
    throw new HttpsError('invalid-argument', 'Base name is required');
  }

  try {
    const cleanBase = baseName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .substring(0, 15);

    if (cleanBase.length < 3) {
      throw new HttpsError('invalid-argument', 'Base name too short after cleaning');
    }

    const suggestions = [
      cleanBase,
      `${cleanBase}_dev`,
      `${cleanBase}_code`,
      `${cleanBase}${Math.floor(Math.random() * 100)}`,
      `${cleanBase}${Math.floor(Math.random() * 1000)}`,
      `the_${cleanBase}`,
      `${cleanBase}_official`,
      `${cleanBase}${new Date().getFullYear()}`,
    ];

    const results = await Promise.all(
      suggestions.map(async (username) => {
        const query = await admin.firestore()
          .collection('profile')
          .where('usernameLower', '==', username)
          .limit(1)
          .get();

        return {
          username,
          available: query.empty,
        };
      })
    );

    const availableSuggestions = results
      .filter(r => r.available)
      .map(r => r.username)
      .slice(0, 5);

    console.log(`✅ Generated ${availableSuggestions.length} available suggestions`);

    return {
      suggestions: availableSuggestions,
      originalBase: baseName,
    };
  } catch (error) {
    console.error('❌ Error generating suggestions:', error);
    throw new HttpsError('internal', 'Failed to generate username suggestions');
  }
});



// ==================== GITHUB CALLBACK HANDLER ====================
// This handles the redirect from GitHub OAuth
exports.githubCallback = onRequest(async (req, res) => {
   
  console.log('🔗 GitHub callback received');
  
  const code = req.query.code;
  const error = req.query.error;

  if (error) {
    console.error('🔗 GitHub OAuth error:', error);
    res.status(400).send(`
      <html>
        <body>
          <h1>Authorization Failed</h1>
          <p>Error: ${error}</p>
          <script>
            setTimeout(() => {
              window.location.href = 'myapp://github-callback?error=${error}';
            }, 2000);
          </script>
        </body>
      </html>
    `);
    return;
  }

  if (!code) {
    console.error('🔗 No code provided');
    res.status(400).send('No authorization code provided');
    return;
  }

  console.log('🔗 Redirecting to app with code');
  
  // Redirect to your React Native app with the code
  res.send(`
    <html>
      <head>
        <title>GitHub Connected</title>
      </head>
      <body>
        <h1>GitHub Authorization Successful!</h1>
        <p>Redirecting back to app...</p>
        <script>
          // Attempt to redirect to the app
          window.location.href = 'myapp://github-callback?code=${code}';
          
          // Fallback message after 3 seconds
          setTimeout(() => {
            document.body.innerHTML = '<h1>Success!</h1><p>Please return to the app.</p><p>If the app did not open, please open it manually.</p>';
          }, 3000);
        </script>
      </body>
    </html>
  `);
});

// ==================== TOKEN EXCHANGE ====================
// This exchanges the GitHub code for an access token
exports.exchangeGitHubToken = onCall(
  {
    secrets: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
  },
  async (request) => {
    console.log('🔥 Request data:', request.data);

    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const code = request.data?.code;
    if (!code) {
      throw new HttpsError('invalid-argument', 'Authorization code is required');
    }

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new HttpsError(
        'failed-precondition',
        'GitHub credentials not configured'
      );
    }

    try {
      // Exchange code for access token
      const tokenResponse = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: clientId,
          client_secret: clientSecret,
          code,
        },
        { headers: { Accept: 'application/json' } }
      );

      if (!tokenResponse.data.access_token) {
        throw new Error('No access token returned');
      }

      const accessToken = tokenResponse.data.access_token;

      // Fetch GitHub user info
      const userResponse = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const username = userResponse.data.login;

      // Save to Firestore
      await admin.firestore()
        .collection('users')
        .doc(request.auth.uid)
        .set(
          {
            githubAccessToken: accessToken,
            githubUsername: username,
            githubConnectedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      return {
        success: true,
        username: username,
      };
    } catch (err) {
      console.error('🔥 GitHub OAuth error:', err.response?.data || err.message);
      throw new HttpsError('internal', 'GitHub token exchange failed');
    }
  }
);

exports.validateGitHubRepo = onCall(async (request) => {
   initDependencies();
  console.log('🔍 Validating GitHub repo for user:', request.auth?.uid);
  
  // CRITICAL: Accept userId from data as fallback
  const userId = request.auth?.uid || request.data.userId;
  
  if (!userId) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { repoUrl } = request.data;
  
  if (!repoUrl) {
    throw new HttpsError('invalid-argument', 'Repository URL is required');
  }

  try {
    // Get user's GitHub token
    const userDoc = await admin.firestore()
      .collection('users')
      .doc(userId)
      .get();

    const userData = userDoc.data();
    
    if (!userData || !userData.githubAccessToken) {
      throw new HttpsError(
        'failed-precondition',
        'GitHub not connected'
      );
    }

    // Extract owner and repo from URL
    const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      throw new HttpsError(
        'invalid-argument',
        'Invalid GitHub repository URL'
      );
    }

    const owner = repoMatch[1];
    const repo = repoMatch[2].replace('.git', '');

    console.log(`🔍 Checking access for ${owner}/${repo}`);

    // Check if user has admin access to the repo
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${userData.githubAccessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    const hasAdminAccess = response.data.permissions?.admin || false;

    console.log(`✅ Access check result: ${hasAdminAccess ? 'Admin' : 'No admin access'}`);

    return {
      hasAccess: hasAdminAccess,
      repoName: response.data.full_name,
    };
  } catch (err) {
    console.error('❌ Error validating repo:', err.message);
    
    if (err.response?.status === 404) {
      throw new HttpsError(
        'not-found',
        'Repository not found or you do not have access'
      );
    }
    
    if (err instanceof HttpsError) {
      throw err;
    }
    
    throw new HttpsError(
      'internal',
      'Failed to validate repository'
    );
  }
});

// ==================== ADD GITHUB COLLABORATOR ====================
// Adds a user as a collaborator to the GitHub repository
exports.addGitHubCollaborator = onCall(async (request) => {
   initDependencies();
  console.log('👥 Adding GitHub collaborator:', request.data);
  
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { projectId, githubUsername } = request.data;
  
  if (!projectId || !githubUsername) {
    throw new HttpsError(
      'invalid-argument',
      'Missing required parameters'
    );
  }

  try {
    // Get project data
    const projectDoc = await admin.firestore()
      .collection('collaborations')
      .doc(projectId)
      .get();

    if (!projectDoc.exists) {
      throw new HttpsError('not-found', 'Project not found');
    }

    const projectData = projectDoc.data();

    // Check if user is in pending invites
    if (!projectData.pendingInvites.includes(request.auth.uid)) {
      throw new HttpsError(
        'permission-denied',
        'You are not invited to this project'
      );
    }

    // Get creator's GitHub token
    const creatorDoc = await admin.firestore()
      .collection('users')
      .doc(projectData.creatorId)
      .get();

    const creatorData = creatorDoc.data();
    
    if (!creatorData || !creatorData.githubAccessToken) {
      throw new HttpsError(
        'failed-precondition',
        'Project creator has not connected GitHub'
      );
    }

    // Extract repo owner and name from githubRepo URL
    const repoMatch = projectData.githubRepo.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      throw new HttpsError(
        'invalid-argument',
        'Invalid GitHub repository URL'
      );
    }

    const owner = repoMatch[1];
    const repo = repoMatch[2].replace('.git', '');

    console.log(`👥 Adding @${githubUsername} to ${owner}/${repo}`);

    // Add collaborator to GitHub repo using creator's token
    try {
      await axios.put(
        `https://api.github.com/repos/${owner}/${repo}/collaborators/${githubUsername}`,
        { permission: 'push' },
        {
          headers: {
            Authorization: `Bearer ${creatorData.githubAccessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      console.log(`✅ Successfully sent GitHub invitation to @${githubUsername}`);
    } catch (err) {
      // If user is already a collaborator, that's okay
      if (err.response?.status === 422) {
        console.log(`ℹ️ @${githubUsername} is already a collaborator`);
      } else {
        throw err;
      }
    }

    return {
      success: true,
      message: `GitHub invitation sent to @${githubUsername}. Check your email to accept repository access.`,
    };
  } catch (err) {
    console.error('❌ Error adding GitHub collaborator:', err.message);
    
    if (err.response?.status === 404) {
      throw new HttpsError(
        'not-found',
        'GitHub repository not found or you do not have access'
      );
    }
    
    if (err.response?.status === 403) {
      throw new HttpsError(
        'permission-denied',
        'Creator does not have permission to add collaborators to this repository'
      );
    }
    
    if (err instanceof HttpsError) {
      throw err;
    }
    
    throw new HttpsError(
      'internal',
      'Failed to add collaborator: ' + err.message
    );
  }
});

exports.githubWebhook = onRequest(
  {
    secrets: ['GITHUB_WEBHOOK_SECRET'],
  },
  async (req, res) => {
     initDependencies();
    console.log('🔔 GitHub webhook received');

    // Only accept POST requests
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    try {
      // Verify the webhook signature
      const signature = req.headers['x-hub-signature-256'];
      const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

      if (webhookSecret && signature) {
        const hmac = crypto.createHmac('sha256', webhookSecret);
       const digest =
  'sha256=' + hmac.update(req.rawBody).digest('hex');

        if (signature !== digest) {
          console.error('❌ Invalid webhook signature');
          res.status(401).send('Unauthorized');
          return;
        }
      }

      const event = req.headers['x-github-event'];
      const payload = req.body;

      console.log(`📦 GitHub event: ${event}`);

      // Get repository full name (owner/repo)
      const repoFullName = payload.repository?.full_name;
      const repoUrl = payload.repository?.html_url;

      if (!repoFullName) {
        console.error('❌ No repository information in payload');
        res.status(400).send('Bad Request');
        return;
      }

      // Find the project associated with this repository
      const projectsSnapshot = await admin.firestore()
        .collection('collaborations')
        .where('githubRepo', '==', repoUrl)
        .get();

      if (projectsSnapshot.empty) {
        // Also try with .git suffix
        const repoUrlWithGit = repoUrl + '.git';
        const projectsWithGit = await admin.firestore()
          .collection('collaborations')
          .where('githubRepo', '==', repoUrlWithGit)
          .get();

        if (projectsWithGit.empty) {
          console.log(`ℹ️ No project found for repository: ${repoFullName}`);
          res.status(200).send('OK - No matching project');
          return;
        }

        // Process projects with .git suffix
        for (const projectDoc of projectsWithGit.docs) {
          await processWebhookEvent(event, payload, projectDoc.data());
        }
      } else {
        // Process all matching projects
        for (const projectDoc of projectsSnapshot.docs) {
          await processWebhookEvent(event, payload, projectDoc.data());
        }
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      res.status(500).send('Internal Server Error');
    }
  }
);

// Helper function to process different webhook events
async function processWebhookEvent(event, payload, project) {
   initDependencies();
  const chatId = project.chatId;
  
  if (!chatId) {
    console.log('⚠️ Project has no associated chat');
    return;
  }

  let message = '';
  let metadata = {
    event,
    repository: payload.repository?.full_name,
    projectTitle: project.title
  };

  switch (event) {
    case 'push':
      const pusher = payload.pusher?.name || payload.sender?.login || 'Someone';
      const commits = payload.commits || [];
      const branch = payload.ref?.replace('refs/heads/', '') || 'unknown';
      const commitCount = commits.length;

      if (commitCount === 0) {
        return; // No commits, skip notification
      }

      // Create detailed commit message
      const commitMessages = commits.slice(0, 3).map(c => 
        `• ${c.message.split('\n')[0].substring(0, 60)}${c.message.length > 60 ? '...' : ''}`
      ).join('\n');

      message = `🚀 ${pusher} pushed ${commitCount} commit${commitCount > 1 ? 's' : ''} to ${branch}\n${commitMessages}`;
      
      if (commitCount > 3) {
        message += `\n... and ${commitCount - 3} more commit${commitCount - 3 > 1 ? 's' : ''}`;
      }

      metadata.pusher = pusher;
      metadata.commits = commitCount;
      metadata.branch = branch;
      break;

    case 'pull_request':
      const action = payload.action;
      const prAuthor = payload.pull_request?.user?.login || 'Someone';
      const prTitle = payload.pull_request?.title || 'Pull Request';
      const prNumber = payload.pull_request?.number;

      const prActions = {
        opened: '📝 opened a new pull request',
        closed: payload.pull_request?.merged ? '✅ merged pull request' : '❌ closed pull request',
        reopened: '🔄 reopened pull request',
        edited: '✏️ edited pull request',
        review_requested: '👀 requested review for pull request'
      };

      const actionText = prActions[action] || `${action} pull request`;
      message = `${prAuthor} ${actionText} #${prNumber}: ${prTitle}`;
      
      metadata.prAuthor = prAuthor;
      metadata.prNumber = prNumber;
      metadata.prAction = action;
      break;

    case 'issues':
      const issueAction = payload.action;
      const issueAuthor = payload.issue?.user?.login || 'Someone';
      const issueTitle = payload.issue?.title || 'Issue';
      const issueNumber = payload.issue?.number;

      const issueActions = {
        opened: '🐛 opened a new issue',
        closed: '✅ closed issue',
        reopened: '🔄 reopened issue',
        edited: '✏️ edited issue'
      };

      const issueActionText = issueActions[issueAction] || `${issueAction} issue`;
      message = `${issueAuthor} ${issueActionText} #${issueNumber}: ${issueTitle}`;
      
      metadata.issueAuthor = issueAuthor;
      metadata.issueNumber = issueNumber;
      metadata.issueAction = issueAction;
      break;

    case 'release':
      const releaseAction = payload.action;
      const releaseName = payload.release?.name || payload.release?.tag_name || 'Release';
      const releaseAuthor = payload.release?.author?.login || 'Someone';

      if (releaseAction === 'published') {
        message = `🎉 ${releaseAuthor} published release: ${releaseName}`;
        metadata.releaseName = releaseName;
        metadata.releaseAuthor = releaseAuthor;
      }
      break;

    case 'create':
      const refType = payload.ref_type;
      const refName = payload.ref;
      const creator = payload.sender?.login || 'Someone';

      if (refType === 'branch') {
        message = `🌿 ${creator} created a new branch: ${refName}`;
      } else if (refType === 'tag') {
        message = `🏷️ ${creator} created a new tag: ${refName}`;
      }
      
      metadata.refType = refType;
      metadata.refName = refName;
      metadata.creator = creator;
      break;

    case 'delete':
      const deleteRefType = payload.ref_type;
      const deleteRefName = payload.ref;
      const deleter = payload.sender?.login || 'Someone';

      if (deleteRefType === 'branch') {
        message = `🗑️ ${deleter} deleted branch: ${deleteRefName}`;
      } else if (deleteRefType === 'tag') {
        message = `🗑️ ${deleter} deleted tag: ${deleteRefName}`;
      }
      
      metadata.refType = deleteRefType;
      metadata.refName = deleteRefName;
      metadata.deleter = deleter;
      break;

    case 'fork':
      const forker = payload.forkee?.owner?.login || 'Someone';
      message = `🍴 ${forker} forked the repository`;
      metadata.forker = forker;
      break;

    case 'star':
      const starAction = payload.action;
      const starrer = payload.sender?.login || 'Someone';
      
      if (starAction === 'created') {
        message = `⭐ ${starrer} starred the repository`;
        metadata.starrer = starrer;
      }
      break;

    default:
      console.log(`ℹ️ Unhandled event type: ${event}`);
      return;
  }

  if (message) {
    // Send the notification to the chat
    await admin.firestore()
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .add({
        text: message,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        senderId: 'github',
        isSystemMessage: true,
        type: 'github_event',
        metadata
      });

    // Update chat's lastMessage
    await admin.firestore()
      .collection('chats')
      .doc(chatId)
      .update({
        lastMessage: message,
        lastMessageTime: admin.firestore.FieldValue.serverTimestamp()
      });

    console.log(`✅ Sent notification to chat ${chatId}`);
  }
}

// ==================== SETUP GITHUB WEBHOOK ====================
// Helper function to set up webhook for a repository

exports.setupGitHubWebhook = onRequest(async (req, res) => {
   initDependencies();
  console.log('🔧 Setting up GitHub webhook');

  // Verify this is called by an authenticated user
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    const { repoOwner, repoName, githubToken } = req.body;

    if (!repoOwner || !repoName || !githubToken) {
      res.status(400).send('Missing required parameters');
      return;
    }

    // Get your Cloud Function URL
    const webhookUrl = `https://githubwebhook-6w4vuwvwaq-uc.a.run.app`;

    // Create webhook using GitHub API
    const axios = require('axios');
    const response = await axios.post(
      `https://api.github.com/repos/${repoOwner}/${repoName}/hooks`,
      {
        name: 'web',
        active: true,
        events: ['*'
        ],
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret: process.env.GITHUB_WEBHOOK_SECRET,
          insecure_ssl: '0'
        }
      },
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      }
    );

    console.log(`✅ Webhook created for ${repoOwner}/${repoName}`);

    res.status(200).json({
      success: true,
      webhookId: response.data.id,
      message: 'Webhook successfully created'
    });
  } catch (error) {
    console.error('❌ Error setting up webhook:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

// ==================== UPDATE POPULAR POSTS ====================
// Runs every 6 hours to update the aggregated popular posts collection
// This dramatically reduces read costs by creating a single document
// that all users can read instead of each user querying 20+ posts

exports.updatePopularPosts = onSchedule(
  {
    schedule: 'every 3 hours', // Run every 1 hour for more frequent updates
    timeZone: 'America/New_York',
    memory: '512MB',
  },
  async (event) => {
     initDependencies();
    console.log('🔄 Starting popular posts aggregation...');
    
    try {
      // Fetch top 50 posts by like count
      // Try 'likes' first (actual field name), fallback to 'likeCount' if needed
      let postsSnapshot;
      try {
        postsSnapshot = await admin.firestore()
          .collection('posts')
          .orderBy('likes', 'desc')
          .limit(50)
          .get();
      } catch (error) {
        // Fallback to likeCount if likes field doesn't exist
        console.log('⚠️ Trying fallback with likeCount field...');
        postsSnapshot = await admin.firestore()
          .collection('posts')
          .orderBy('likeCount', 'desc')
          .limit(50)
          .get();
      }

      if (postsSnapshot.empty) {
        console.log('⚠️ No posts found in database');
        return;
      }

      // Map posts to a lightweight format (only essential data)
      const popularPosts = postsSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          postId: doc.id,
          userId: data.userId,
          username: data.username,
          imageUrl: data.imageUrl || null,
          avatarUrl: data.avatarUrl || null,
          userAvatar: data.userAvatar || null,
          caption: data.caption || data.content || '',
          likeCount: data.likes || data.likeCount || 0, // Use 'likes' field (actual) or fallback to 'likeCount'
          likes: data.likes || data.likeCount || 0, // Also include 'likes' for compatibility
          likedBy: data.likedBy || [],
          createdAt: data.createdAt,
          // Don't include comments to keep payload small
        };
      });

      // Save to aggregated collection (SINGLE WRITE)
      await admin.firestore()
        .collection('aggregated')
        .doc('popularPosts')
        .set({
          posts: popularPosts,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          totalPosts: popularPosts.length,
        });

      console.log(`✅ Successfully aggregated ${popularPosts.length} popular posts`);
      
      return {
        success: true,
        postsCount: popularPosts.length,
      };
    } catch (error) {
      console.error('❌ Error updating popular posts:', error);
      throw error;
    }
  }
);

// ==================== UPDATE POPULAR USERS ====================
// Optional: Also create an aggregated collection for popular users
// This can be used in the drawer for suggested users

exports.updatePopularUsers = onSchedule(
  {
    schedule: 'every 24 hours', // Run once per day
    timeZone: 'America/New_York',
    memory: '512MB',
  },
  async (event) => {
     initDependencies();
    console.log('🔄 Starting popular users aggregation...');
    
    try {
      // Fetch top 50 users by followers count
      const usersSnapshot = await admin.firestore()
        .collection('profile')
        .where('isActive', '==', true)
        .orderBy('followersCount', 'desc')
        .limit(50)
        .get();

      if (usersSnapshot.empty) {
        console.log('⚠️ No users found in database');
        return;
      }

      // Map users to lightweight format
      const popularUsers = usersSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || data.displayName,
          username: data.username,
          avatar: data.avatar || data.photoURL,
          bio: data.bio || '',
          followersCount: data.followersCount || 0,
          isVerified: data.isVerified || false,
          skills: (data.skills || []).slice(0, 3), // Only top 3 skills
        };
      });

      // Save to aggregated collection
      await admin.firestore()
        .collection('aggregated')
        .doc('popularUsers')
        .set({
          users: popularUsers,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          totalUsers: popularUsers.length,
        });

      console.log(`✅ Successfully aggregated ${popularUsers.length} popular users`);
      
      return {
        success: true,
        usersCount: popularUsers.length,
      };
    } catch (error) {
      console.error('❌ Error updating popular users:', error);
      throw error;
    }
  }
);

// ==================== TRENDING SCORE CALCULATOR ====================
// Optional: More sophisticated trending algorithm considering recency + engagement

exports.updateTrendingPosts = onSchedule(
  {
    schedule: 'every 3 hours',
    timeZone: 'America/New_York',
    memory: '512MB',
  },
  async (event) => {
     initDependencies();
    console.log('🔄 Calculating trending posts...');
    
    try {
      // Get posts from last 7 days (limited to 500 most recent for cost optimization)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const postsSnapshot = await admin.firestore()
        .collection('posts')
        .where('createdAt', '>=', sevenDaysAgo)
        .orderBy('createdAt', 'desc')
        .limit(300) // Limit to 500 most recent posts to control read costs
        .get();

      if (postsSnapshot.empty) {
        console.log('⚠️ No recent posts found');
        return;
      }

      // Calculate trending score for each post
      const postsWithScores = postsSnapshot.docs.map(doc => {
        const data = doc.data();
        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
        const ageInHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
        
        // Trending formula: (likes + comments * 2) / (age in hours + 2)^1.5
        // This gives weight to recent posts with high engagement
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

      // Sort by trending score and take top 30
      const trendingPosts = postsWithScores
        .sort((a, b) => b.trendingScore - a.trendingScore)
        .slice(0, 30);

      // Save to aggregated collection
      await admin.firestore()
        .collection('aggregated')
        .doc('trendingPosts')
        .set({
          posts: trendingPosts,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          totalPosts: trendingPosts.length,
        });

      console.log(`✅ Successfully calculated ${trendingPosts.length} trending posts`);
      
      return {
        success: true,
        postsCount: trendingPosts.length,
      };
    } catch (error) {
      console.error('❌ Error calculating trending posts:', error);
      throw error;
    }
  }
);

// ==================== GITHUB TRENDING (OFFICIAL) ====================
exports.fetchGitHubTrending = onCall(async (request) => {
  initDependencies();
  try {
    const { language = 'javascript', days = 7 } = request.data || {};

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
          // GitHub API works without auth, just with lower rate limits
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
  } catch (error) {
    console.error('❌ GitHub trending error:', error.message);
    throw new HttpsError('internal', 'Failed to fetch GitHub trends');
  }
});
// ==================== HACKER NEWS TRENDING ====================
exports.fetchHackerNewsTrending = onCall(async (request) => {
  initDependencies(); // ✅ ADD THIS
  try {
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
  } catch (error) {
    console.error('❌ HN error:', error.message);
    throw new HttpsError('internal', 'Failed to fetch Hacker News trends');
  }
});

// ==================== DEV.TO TRENDING ====================
exports.fetchDevToTrending = onCall(async (request) => {
  initDependencies(); // ✅ ADD THIS
  try {
    const { tag = 'react', limit = 20 } = request.data || {};

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
  } catch (error) {
    console.error('❌ Dev.to error:', error.message);
    throw new HttpsError('internal', 'Failed to fetch Dev.to trends');
  }
});

// ==================== UNIFIED TREND FEED ====================
exports.fetchTrends = onCall(async (request) => {
  initDependencies(); // ✅ ADD THIS
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
    // ⚠️ THIS IS THE PROBLEM - You can't call .run() on exported functions
    // You need to extract the logic into helper functions
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
        Authorization: process.env.GITHUB_TRENDING_TOKEN
          ? `Bearer ${process.env.GITHUB_TRENDING_TOKEN}`
          : undefined,
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