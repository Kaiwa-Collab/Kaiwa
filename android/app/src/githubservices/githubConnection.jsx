import { StyleSheet, Text, View, Alert, Linking } from 'react-native'
import React, { useEffect, useState } from 'react'
import Icon from 'react-native-vector-icons/Ionicons';
import Firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';
import auth from '@react-native-firebase/auth';
import { Github_Config } from '../config/githubconfig';
import { TouchableOpacity } from 'react-native';
import { getGitHubStatus } from '../../service/getGitHubStatus';


// configuration




const githubConnection = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState('');
  const [loading, setLoading] = useState(true);

  const currentUser = auth().currentUser;

  // -------------------- CHECK STATUS --------------------
  useEffect(() => {
    checkGitHubStatus();
  }, []);

  // -------------------- DEEP LINK HANDLER --------------------
  // -------------------- DEEP LINK HANDLER --------------------
useEffect(() => {
  const handleDeepLink = async ({ url }) => {
    console.log('🔗 Deep link received:', url);

    if (!url) return;

    // Check if it's a GitHub callback deep link
    if (!url.startsWith('myapp://github-callback')) {
      console.log('❌ Not a GitHub callback, ignoring');
      return;
    }

    const match = url.match(/[?&]code=([^&]+)/);
    if (!match) {
      console.log('❌ No authorization code in URL');
      return;
    }

    const code = decodeURIComponent(match[1]);
    console.log('✅ GitHub code extracted:', code);

    await exchangeCodeForToken(code);
  };

  const subscription = Linking.addEventListener('url', handleDeepLink);

  // Handle cold start
  Linking.getInitialURL().then((url) => {
    if (url && url.startsWith('myapp://github-callback')) {
      handleDeepLink({ url });
    }
  });

  return () => subscription.remove();
}, []);

  // -------------------- CHECK FIRESTORE --------------------
 const checkGitHubStatus = async () => {
  try {
    if (!currentUser) return;

    const status = await getGitHubStatus(currentUser.uid);

    if (status.connected) {
      setIsConnected(true);
      setGithubUsername(status.username);
    }
  } catch (e) {
    console.error('GitHub status check error:', e);
  } finally {
    setLoading(false);
  }
};

  // -------------------- START OAUTH --------------------
  // -------------------- START OAUTH --------------------
const connectGithub = async () => {
  Alert.alert(
    '⚠️ Important: GitHub Account',
    'This device may have a cached GitHub login. Please ensure you\'re connecting the correct account.\n\nIf you need to switch accounts:\n1. Cancel this dialog\n2. Open github.com in your browser\n3. Logout from GitHub\n4. Try connecting again',
    [
      {
        text: 'Open GitHub to Logout',
        onPress: () => {
          Linking.openURL('https://github.com/logout');
        },
      },
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Continue Anyway',
        onPress: async () => {
          const params = new URLSearchParams({
            client_id: Github_Config.CLIENT_ID,
            redirect_uri: Github_Config.REDIRECT_URL,
            scope: Github_Config.SCOPE,
          });

          const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
          await Linking.openURL(authUrl);
        },
      },
    ]
  );
};

  // -------------------- TOKEN EXCHANGE --------------------
  // -------------------- TOKEN EXCHANGE --------------------
const exchangeCodeForToken = async (code) => {
  if (!code) {
    console.log('❌ exchangeCodeForToken called without code');
    return;
  }

  try {
    const exchangeToken = functions().httpsCallable('exchangeGitHubToken');
    const result = await exchangeToken({ code });

    if (!result.data?.success) {
      throw new Error('Token exchange failed');
    }

    setIsConnected(true);
    setGithubUsername(result.data.username);

    Alert.alert(
      'GitHub Connected 🎉',
      `Connected as @${result.data.username}`
    );
  } catch (error) {
    console.error('Error exchanging GitHub code:', error);
    
    if (error.code === 'functions/already-exists') {
      Alert.alert(
        '❌ Account Already Connected',
        error.message + '\n\nPlease:\n1. Logout from GitHub in your browser\n2. Connect with a different GitHub account\n\nOr contact the other user to disconnect first.',
        [
          {
            text: 'Logout from GitHub',
            onPress: () => {
              Linking.openURL('https://github.com/logout');
            },
          },
          {
            text: 'OK',
            style: 'cancel',
          },
        ]
      );
    } else {
      Alert.alert('Error', 'GitHub connection failed. Please try again.');
    }
  }
};

  // -------------------- DISCONNECT --------------------
  const disconnectGitHub = async () => {
    await Firestore()
      .collection('users')
      .doc(currentUser.uid)
      .update({
        githubAccessToken: Firestore.FieldValue.delete(),
        githubUsername: Firestore.FieldValue.delete(),
      });

    setIsConnected(false);
    setGithubUsername('');
  };

  // -------------------- UI --------------------
  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }
       
return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Icon name="logo-github" size={24} color="white" />
        <Text style={styles.title}>GitHub Integration</Text>
      </View>

      {isConnected ? (
        // CONNECTED STATE
        <View style={styles.connectedContainer}>
          <View style={styles.statusRow}>
            <View style={styles.statusLeft}>
              <Icon name="checkmark-circle" size={20} color="#10B981" />
              <Text style={styles.connectedText}>Connected</Text>
            </View>
            <Text style={styles.username}>@{githubUsername}</Text>
          </View>

          <View style={styles.features}>
            <View style={styles.featureItem}>
              <Icon name="git-branch-outline" size={16} color="#10B981" />
              <Text style={styles.featureText}>Auto-join repositories</Text>
            </View>
            <View style={styles.featureItem}>
              <Icon name="notifications-outline" size={16} color="#10B981" />
              <Text style={styles.featureText}>Get commit notifications</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.disconnectButton}
            onPress={disconnectGitHub}
          >
            <Text style={styles.disconnectText}>Disconnect GitHub</Text>
          </TouchableOpacity>
        </View>
      ) : (
        // NOT CONNECTED STATE
        <View style={styles.notConnectedContainer}>
          <Text style={styles.description}>
            Connect your GitHub account to collaborate on projects and receive
            commit notifications in chat.
          </Text>

          <TouchableOpacity
            style={styles.connectButton}
            onPress={connectGithub}
          >
            <Icon name="logo-github" size={20} color="white" />
            <Text style={styles.connectText}>Connect GitHub Account</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ============================================================================
// STEP 8: STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    marginLeft: 10,
  },
  loadingText: {
    color: '#999',
    textAlign: 'center',
  },
  connectedContainer: {
    paddingTop: 8,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectedText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10B981',
    marginLeft: 8,
  },
  username: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  features: {
    marginBottom: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  featureText: {
    fontSize: 13,
    color: '#ccc',
    marginLeft: 8,
  },
  disconnectButton: {
    backgroundColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  disconnectText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  notConnectedContainer: {
    paddingTop: 8,
  },
  description: {
    fontSize: 14,
    color: '#999',
    lineHeight: 20,
    marginBottom: 16,
  },
  connectButton: {
    backgroundColor: '#24292e',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  connectText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 10,
  },
});

export default githubConnection;