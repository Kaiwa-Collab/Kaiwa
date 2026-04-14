const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onRequest } = require('firebase-functions/v2/https');

const admin = require('firebase-admin');
const axios = require('axios');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp();
}


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

//   console.log(`🔔 EVENT: ${event} | ACTION: ${payload.action} | REPO: ${payload.repository?.full_name}`);
// if (event === 'member') {
//   console.log('🔔 FULL MEMBER PAYLOAD:', JSON.stringify({
//     action: payload.action,
//     member: payload.member,
//     sender: payload.sender?.login,
//     invitation: payload.invitation,
//   }, null, 2));
// }
   switch (event) {
    case 'member':
      if (payload.action === 'added') {

  //        console.log(`🔔 member action received: "${payload.action}"`);
  // console.log(`🔔 member.login: "${payload.member?.login}"`);
  // console.log(`🔔 sender.login: "${payload.sender?.login}"`);
  
        const acceptedGithubUsername = payload.member?.login;

        if (!acceptedGithubUsername) break;

        const userSnap = await admin.firestore()
          .collection('users')
          .where('githubUsername', '==', acceptedGithubUsername)
          .limit(1)
          .get();

        if (!userSnap.empty) {
          const acceptedUid = userSnap.docs[0].id;

          const projectsSnap = await admin.firestore()
            .collection('collaborations')
            .where('chatId', '==', chatId)
            .limit(1)
            .get();

          if (!projectsSnap.empty) {
            const pendingIds = projectsSnap.docs[0].data().pendingGitHubAcceptance || [];

            if (pendingIds.includes(acceptedUid)) {
              await projectsSnap.docs[0].ref.update({
                pendingGitHubAcceptance: admin.firestore.FieldValue.arrayRemove(acceptedUid),
              });
              console.log(`✅ Removed ${acceptedGithubUsername} from pendingGitHubAcceptance`);
              message = `✅ @${acceptedGithubUsername} accepted the GitHub repository invitation`;
              metadata.acceptedUser = acceptedGithubUsername;
            } else {
              console.log(`ℹ️ ${acceptedGithubUsername} was not in pendingGitHubAcceptance — skipping`);
            }
          }
        } else {
          console.log(`⚠️ No Firestore user found for GitHub username: ${acceptedGithubUsername}`);
        }
      }
      break;

  
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

exports.resendGithubInvite = onCall(async (request) => {
  console.log('🔄 Resending GitHub invite:', request.data);

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId, chatId } = request.data;

  if (!userId || !chatId) {
    throw new HttpsError('invalid-argument', 'userId and chatId are required');
  }

  try {
    // Step 1: Find the collaboration for this chat
    const projectsSnapshot = await admin.firestore()
      .collection('collaborations')
      .where('chatId', '==', chatId)
      .get();

    if (projectsSnapshot.empty) {
      throw new HttpsError('not-found', 'No collaboration found for this chat');
    }

    const projectDoc = projectsSnapshot.docs[0];
    const projectData = projectDoc.data();

    // Step 2: Verify the caller is the creator
    if (projectData.creatorId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the project creator can resend invites');
    }

    // Step 3: Verify the target user is actually in pendingGithubAcceptance
    const pendingIds = projectData.pendingGitHubAcceptance || [];
    if (!pendingIds.includes(userId)) {
      throw new HttpsError(
        'failed-precondition',
        'This user has already accepted or is not pending'
      );
    }

    // Step 4: Get target user's GitHub username from users collection
    const targetUserDoc = await admin.firestore()
      .collection('users')
      .doc(userId)
      .get();

    if (!targetUserDoc.exists) {
      throw new HttpsError('not-found', 'Target user not found');
    }

    const targetUserData = targetUserDoc.data();
    const githubUsername = targetUserData?.githubUsername;

    if (!githubUsername) {
      throw new HttpsError(
        'failed-precondition',
        'Target user has not connected their GitHub account'
      );
    }

    // Step 5: Get creator's GitHub token
    const creatorDoc = await admin.firestore()
      .collection('users')
      .doc(projectData.creatorId)
      .get();

    const creatorData = creatorDoc.data();

    if (!creatorData?.githubAccessToken) {
      throw new HttpsError(
        'failed-precondition',
        'Project creator GitHub token not found'
      );
    }

    // Step 6: Extract owner and repo from githubRepo URL
    const repoMatch = projectData.githubRepo.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      throw new HttpsError('invalid-argument', 'Invalid GitHub repository URL');
    }

    const owner = repoMatch[1];
    const repo = repoMatch[2].replace('.git', '');

    console.log(`🔄 Resending invite to @${githubUsername} for ${owner}/${repo}`);

    // Step 7: First remove existing invite then re-add
    // This forces GitHub to resend the invitation email
    try {
      // Step 7A: Get pending invitations
      const invitesRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/invitations`,
        {
          headers: {
            Authorization: `Bearer ${creatorData.githubAccessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      // Step 7B: Find this user's invite
      const invite = invitesRes.data.find(
        inv => inv.invitee?.login === githubUsername
      );

      // Step 7C: Delete old invite if exists
      if (invite) {
        await axios.delete(
          `https://api.github.com/repos/${owner}/${repo}/invitations/${invite.id}`,
          {
            headers: {
              Authorization: `Bearer ${creatorData.githubAccessToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          }
        );

        console.log(`🗑️ Deleted old invite for @${githubUsername}`);
      }

    } catch (inviteErr) {
      console.warn('⚠️ Invite cleanup failed:', inviteErr.message);
    }

    // Step 8: Send fresh invite
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

    console.log(`✅ New invite sent to @${githubUsername}`);

   await projectDoc.ref.update({
  [`inviteMeta.${userId}.lastSent`]: admin.firestore.FieldValue.serverTimestamp()
});
    // Step 9: Notify chat
    await admin.firestore()
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .add({
        text: `🔄 GitHub invitation resent to @${githubUsername}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        senderId: 'github',
        isSystemMessage: true,
        type: 'github_event',
      });

    return {
      success: true,
      message: `Invite resent to @${githubUsername}`,
    };

  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);

    // 🔥 If already collaborator → clean pending list
    if (err.response?.status === 422) {
      const projectsSnapshot = await admin.firestore()
        .collection('collaborations')
        .where('chatId', '==', chatId)
        .get();

      if (!projectsSnapshot.empty) {
        await projectsSnapshot.docs[0].ref.update({
          pendingGitHubAcceptance: admin.firestore.FieldValue.arrayRemove(userId),
        });
      }

      return {
        success: true,
        message: 'User already collaborator → removed from pending',
      };
    }

    if (err instanceof HttpsError) throw err;

    throw new HttpsError('internal', err.message);
  }
});