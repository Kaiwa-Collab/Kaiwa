const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onRequest } = require('firebase-functions/v2/https');
const axios = require('axios');
const admin = require('firebase-admin');

// Initialize admin SDK
admin.initializeApp();

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





