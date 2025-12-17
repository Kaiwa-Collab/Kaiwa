import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  StatusBar,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import Firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;

const AskQuestion = () => {
  const navigation = useNavigation();
  const currentUser = auth().currentUser;
  
  const [questionTitle, setQuestionTitle] = useState('');
  const [questionDescription, setQuestionDescription] = useState('');
  const [tags, setTags] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateInput = () => {
    if (!questionTitle.trim()) {
      Alert.alert('Error', 'Please enter a question title.');
      return false;
    }
    if (questionTitle.trim().length < 10) {
      Alert.alert('Error', 'Question title should be at least 10 characters long.');
      return false;
    }
    if (!questionDescription.trim()) {
      Alert.alert('Error', 'Please provide a description for your question.');
      return false;
    }
    if (questionDescription.trim().length < 20) {
      Alert.alert('Error', 'Question description should be at least 20 characters long.');
      return false;
    }
    return true;
  };

  const submitQuestion = async () => {
    if (!currentUser) {
      Alert.alert('Error', 'You must be logged in to ask a question.');
      return;
    }

   

    if (!validateInput()) return;

    setIsSubmitting(true);
    
    try {
      // Get user data for username
      const userDoc = await Firestore().collection('users').doc(currentUser.uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const username = userData.username || 'Anonymous User';

    
      // Get user profile for avatar
      const profileDoc = await Firestore().collection('profile').doc(currentUser.uid).get();
      const profileData = profileDoc.exists ? profileDoc.data() : {};
      const userAvatar = profileData.avatar || 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg';

      // Process tags
      const tagArray = tags
        .split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0)
        .slice(0, 5); // Limit to 5 tags

      // Create question document - SINGLE CORRECT FORMAT
      const questionData = {
        title: questionTitle.trim(),
        content: questionDescription.trim(),
        tags: tagArray,
        username: username,
        userImage: userAvatar,
        timestamp: Firestore.FieldValue.serverTimestamp(),
        answers: [], // Empty array to store answers
        authorId: currentUser.uid,
      };

      // Final debug log
     

      // Add question to Firestore
      const questionRef = await Firestore().collection('questions').add(questionData);
     

      // Properly handle profile document update
      const profileRef = Firestore().collection('profile').doc(currentUser.uid);
      const profileSnapshot = await profileRef.get();

      if (!profileSnapshot.exists) {
        // Create profile document if it doesn't exist
        await profileRef.set({
          questionsCount: 0,
          answersCount: 0,
          postsCount: 0,
          followersCount: 0,
          followingCount: 0,
          avatar: userAvatar,
          bio: '',
          location: '',
          website: '',
          joinedDate: new Date().toLocaleDateString(),
          createdAt: Firestore.FieldValue.serverTimestamp(),
          updatedAt: Firestore.FieldValue.serverTimestamp()
        });
      } else {
        // Update existing profile document
        await profileRef.update({
          questionsCount: Firestore.FieldValue.increment(1),
          updatedAt: Firestore.FieldValue.serverTimestamp()
        });
      }

      Alert.alert(
        'Success!', 
        'Your question has been posted successfully.',
        [
          {
            text: 'OK',
            onPress: () => {
              navigation.goBack();
            }
          }
        ]
      );

      // Clear form
      setQuestionTitle('');
      setQuestionDescription('');
      setTags('');

    } catch (error) {
      Alert.alert('Error', 'Failed to submit your question. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1e1e1e" />
      <View style={styles.statusBarSpacer} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ask Question</Text>
        <TouchableOpacity 
          onPress={submitQuestion} 
          disabled={isSubmitting}
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        >
          <Text style={[styles.submitButtonText, isSubmitting && styles.submitButtonTextDisabled]}>
            {isSubmitting ? 'Posting...' : 'Post'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Question Title */}
        <View style={styles.inputSection}>
          <Text style={styles.label}>Question Title *</Text>
          <TextInput
            style={styles.titleInput}
            placeholder="What's your question? Be specific and clear..."
            placeholderTextColor="#666"
            value={questionTitle}
            onChangeText={setQuestionTitle}
            maxLength={200}
            multiline
          />
          <Text style={styles.charCount}>{questionTitle.length}/200</Text>
        </View>

        {/* Question Description */}
        <View style={styles.inputSection}>
          <Text style={styles.label}>Description *</Text>
          <Text style={styles.sublabel}>
            Provide more details about your question. Include what you've tried, expected results, etc.
          </Text>
          <TextInput
            style={styles.descriptionInput}
            placeholder="Describe your question in detail..."
            placeholderTextColor="#666"
            value={questionDescription}
            onChangeText={setQuestionDescription}
            maxLength={1000}
            multiline
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{questionDescription.length}/1000</Text>
        </View>

        {/* Tags */}
        <View style={styles.inputSection}>
          <Text style={styles.label}>Tags (Optional)</Text>
          <Text style={styles.sublabel}>
            Add up to 5 tags separated by commas (e.g. react, javascript, firebase)
          </Text>
          <TextInput
            style={styles.tagsInput}
            placeholder="react, javascript, mobile-development"
            placeholderTextColor="#666"
            value={tags}
            onChangeText={setTags}
            maxLength={100}
          />
          <Text style={styles.charCount}>{tags.length}/100</Text>
        </View>

        {/* Guidelines */}
        <View style={styles.guidelinesSection}>
          <Text style={styles.guidelinesTitle}>📝 Question Guidelines</Text>
          <Text style={styles.guidelineText}>• Be specific and clear in your question title</Text>
          <Text style={styles.guidelineText}>• Include relevant details and context</Text>
          <Text style={styles.guidelineText}>• Mention what you've already tried</Text>
          <Text style={styles.guidelineText}>• Use appropriate tags to help others find your question</Text>
          <Text style={styles.guidelineText}>• Be respectful and follow community guidelines</Text>
        </View>

        {/* Loading indicator */}
        {isSubmitting && (
          <View style={styles.loadingSection}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Posting your question...</Text>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  statusBarSpacer: {
    height: getStatusBarHeight(),
    backgroundColor: '#1e1e1e',
  },
  header: {
    height: 56,
    backgroundColor: '#1e1e1e',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    textAlign: 'center',
    marginRight: 60,
  },
  submitButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  submitButtonDisabled: {
    backgroundColor: '#333',
  },
  submitButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  submitButtonTextDisabled: {
    color: '#666',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  inputSection: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 4,
  },
  sublabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
    lineHeight: 16,
  },
  titleInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: 'white',
    fontSize: 16,
    minHeight: 60,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#444',
  },
  descriptionInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: 'white',
    fontSize: 16,
    minHeight: 120,
    maxHeight: 200,
    borderWidth: 1,
    borderColor: '#444',
  },
  tagsInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: 'white',
    fontSize: 16,
    height: 48,
    borderWidth: 1,
    borderColor: '#444',
  },
  charCount: {
    fontSize: 12,
    color: '#666',
    textAlign: 'right',
    marginTop: 4,
  },
  guidelinesSection: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  guidelinesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 12,
  },
  guidelineText: {
    fontSize: 14,
    color: '#ccc',
    marginBottom: 6,
    lineHeight: 18,
  },
  loadingSection: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadingText: {
    color: '#666',
    fontSize: 14,
    marginTop: 8,
  },
  bottomSpacer: {
    height: 20,
  },
});

export default AskQuestion;