import { StyleSheet, Text, View, Modal, SafeAreaView, TouchableOpacity, TextInput, Image, ScrollView, Alert } from 'react-native';
import React, { useState, useEffect } from 'react';
import { useUserData } from '../users';
import { launchImageLibrary } from 'react-native-image-picker';
import firestore from '@react-native-firebase/firestore';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Platform, StatusBar } from 'react-native';
import {requestcamerapermission,requestgallerypermission} from '../../utils/permissions';

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0: 0;

const Answer = () => {
  const navigation = useNavigation();
  const route = useRoute();
  
  const question = route.params?.question;
  const isReply = route.params?.isreply || false;
  const answerToReply = route.params?.replytouser || null;
  
  const { 
    profile, 
    currentUser,
    cacheImage,
    getCachedImageUri 
  } = useUserData();

  const [answerContent, setAnswerContent] = useState('');
  const [answerCode, setAnswerCode] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);

  const resetForm = () => {
    setAnswerContent('');
    setAnswerCode('');
    setSelectedImage(null);
  };

  useFocusEffect(
    React.useCallback(() => {
      resetForm();
      return () => {};
    }, [])
  );

  // In Answer.js - Remove image caching for uploaded images

const handleSubmitAnswer = async () => {
  if (isReply) {
    await submitReplyToAnswer();
    return;
  }

  if (!answerContent.trim()) {
    Alert.alert('Error', 'Please provide an answer');
    return;
  }

  if (!profile || !currentUser) {
    Alert.alert('Error', 'User profile not loaded yet');
    return;
  }

  if (!question) {
    Alert.alert('Error', 'No question selected');
    return;
  }

  try {
    const newAnswer = {
      id: Date.now().toString(),
      content: answerContent,
      code: answerCode,
      username: profile.username || 'Anonymous',
      userImage: getCachedImageUri(profile.avatar || 'https://placehold.co/100'),
      timestamp: new Date(),
      image: selectedImage || null,
      authorId: currentUser.uid,
      replies: [],
      repliesCount: 0,
    };

    const questionRef = firestore().collection('questions').doc(question.id);
    const questionDoc = await questionRef.get();
    
    if (questionDoc.exists) {
      const currentData = questionDoc.data();
      const updatedAnswers = [...(currentData.answers || []), newAnswer];
      
      await questionRef.update({
        answers: updatedAnswers,
        answersCount: updatedAnswers.length
      });

      try {
        await firestore().collection('profile').doc(currentUser.uid).update({
          answersCount: firestore.FieldValue.increment(1),
          updatedAt: firestore.FieldValue.serverTimestamp()
        });
      } catch (profileError) {
        console.log('Profile update error (non-critical):', profileError);
      }

      // REMOVED: Image caching for uploaded images
      // if (selectedImage?.uri) {
      //   cacheImage(selectedImage.uri);
      // }

      Alert.alert('Success', 'Answer posted successfully!');
      resetForm();
      navigation.goBack();
    } else {
      Alert.alert('Error', 'Question not found');
    }
  } catch (error) {
    Alert.alert('Error', 'Failed to post answer. Please try again.');
  }
};

const submitReplyToAnswer = async () => {
  if (!answerContent.trim()) {
    Alert.alert('Error', 'Please provide a reply');
    return;
  }
  
  if (!profile || !currentUser) {
    Alert.alert('Error', 'User profile not loaded yet');
    return;
  }
  
  if (!question || !answerToReply) {
    Alert.alert('Error', 'No question or answer selected');
    return;
  }

  try {
    const newReply = {
      id: `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      content: answerContent,
      code: answerCode,
      username: profile.username || 'Anonymous',
      userImage: getCachedImageUri(profile.avatar || 'https://placehold.co/100'),
      timestamp: new Date(),
      image: selectedImage || null,
      authorId: currentUser.uid,
    };

    const questionRef = firestore().collection('questions').doc(question.id);
    const questionDoc = await questionRef.get();

    if (questionDoc.exists) {
      const currentData = questionDoc.data();
      const updatedAnswers = (currentData.answers || []).map((ans) => {
        if (ans.id === answerToReply.id) {
          const updatedReplies = [...(ans.replies || []), newReply];
          return {
            ...ans,
            replies: updatedReplies,
            repliesCount: updatedReplies.length
          };
        }
        return ans;
      });

      await questionRef.update({
        answers: updatedAnswers,
      });

      // REMOVED: Image caching for uploaded images
      // if (selectedImage?.uri) {
      //   cacheImage(selectedImage.uri);
      // }

      Alert.alert('Success', 'Reply posted successfully!');
      resetForm();
      navigation.goBack();
    } else {
      Alert.alert('Error', 'Question not found');
    }
  } catch (error) {
    Alert.alert('Error', 'Failed to post reply. Please try again.');
  }
};

  const selectImage = async () => {
   const haspermission= await requestgallerypermission();
   if(!haspermission){
  return;
}
   

    const options = {
      mediaType: 'photo',
      includeBase64: false,
      maxHeight: 2000,
      maxWidth: 2000,
    };
    launchImageLibrary(options, (response) => {
      if (response.didCancel || response.error) return;
      if (response.assets && response.assets[0]) {
        setSelectedImage(response.assets[0]);
      }
    });
  };

  const handleCancel = () => {
    resetForm();
    navigation.goBack();
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.statusBarSpacer} />
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={handleCancel}>
            <Text style={styles.cancelButton}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{isReply ? 'Write Reply' : 'Write Answer'}</Text>
          <TouchableOpacity onPress={handleSubmitAnswer}>
            <Text style={styles.submitButton}>Post</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.formContainer}>
          {isReply && answerToReply ? (
            <View style={styles.questionPreview}>
              <Text style={styles.questionPreviewLabel}>Replying to Answer:</Text>
              <Text style={styles.questionPreviewTitle} numberOfLines={4}>
                {answerToReply.content}
              </Text>
            </View>
          ) : question && (
            <View style={styles.questionPreview}>
              <Text style={styles.questionPreviewLabel}>Answering:</Text>
              <Text style={styles.questionPreviewTitle} numberOfLines={2}>
                {question.title}
              </Text>
            </View>
          )}

          <TextInput
            style={styles.contentInput}
            placeholder={isReply ? "Write your reply..." : "Write your answer..."}
            placeholderTextColor="#999"
            value={answerContent}
            onChangeText={setAnswerContent}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.sectionLabel}>Code Snippet (Optional)</Text>
          <TextInput
            style={styles.codeInput}
            placeholder="// Your code here"
            placeholderTextColor="#999"
            value={answerCode}
            onChangeText={setAnswerCode}
            multiline
            textAlignVertical="top"
          />

          <View style={styles.attachmentSection}>
            <TouchableOpacity style={styles.imageButton} onPress={selectImage}>
              <Text style={styles.imageButtonText}>📷 Attach Image</Text>
            </TouchableOpacity>
            {selectedImage && (
              <View>
                <Image source={{ uri: selectedImage.uri }} style={styles.selectedImage} />
                <TouchableOpacity 
                  style={styles.removeImageButton}
                  onPress={() => setSelectedImage(null)}
                >
                  <Text style={styles.removeImageText}>✕ Remove Image</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

export default Answer;

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  statusBarSpacer: { 
    height: getStatusBarHeight(), 
    backgroundColor: '#1e1e1e' 
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  cancelButton: {
    color: '#999',
    fontSize: 16,
  },
  submitButton: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  formContainer: {
    flex: 1,
    padding: 16,
  },
  questionPreview: {
    backgroundColor: '#f8f8f8',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  questionPreviewLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  questionPreviewTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  contentInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    marginBottom: 16,
    minHeight: 120,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 8,
  },
  codeInput: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 16,
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 16,
    minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  attachmentSection: {
    marginTop: 16,
  },
  imageButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
  },
  imageButtonText: {
    color: '#666',
    fontSize: 14,
  },
  selectedImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginTop: 12,
    resizeMode: 'cover',
  },
  removeImageButton: {
    backgroundColor: '#ff3b30',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  removeImageText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
});