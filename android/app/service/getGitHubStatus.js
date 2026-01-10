import Firestore from '@react-native-firebase/firestore';


export const getGitHubStatus = async (uid) => {
  const doc = await Firestore()
    .collection('users')
    .doc(uid)
    .get();

  if (!doc.exists) {
    return { connected: false };
  }

  const data = doc.data();

  if (data.githubAccessToken && data.githubUsername) {
    return {
      connected: true,
      username: data.githubUsername,
    };
  }

  return { connected: false };
};
