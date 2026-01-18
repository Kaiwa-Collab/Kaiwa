import { StyleSheet, Text, FlatList, View, TextInput, StatusBar, Alert, ActivityIndicator } from 'react-native'
import { useState } from 'react'
import React from 'react'
import { TouchableOpacity } from 'react-native';
import Firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Platform } from 'react-native';
import { useEffect } from 'react';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';

const currentUser = auth().currentUser;

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;

const Addbio = () => {
  const currentUser = auth().currentUser;
  const navigation = useNavigation();

  const [bio, setbio] = useState('');
  const [tech, settech] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const doc = await Firestore().collection('profile').doc(currentUser.uid).get();
        if (doc.exists) {
          const data = doc.data();
          setbio(data.bio || '');
          settech(data.website || '');
        }
      } catch (error) {
        Alert.alert('Error', 'Could not load existing data');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handlegoback = () => {
    navigation.goBack();
  };

  const handlesubmit = async () => {
    try {
      if (bio.trim().length === 0 && tech.trim().length === 0) {
        Alert.alert('Empty Fields', 'Both bio and tech are empty. Please add at least one.');
        return;
      }

      if (bio.trim().length > 0) {
        const bioLines = bio.split('\n').length;
        if (bio.length > 200) {
          Alert.alert('Bio Error', 'Bio cannot be more than 200 characters');
          return;
        }
        if (bioLines > 2) {
          Alert.alert('Bio Error', 'Bio cannot be more than 2 lines');
          return;
        }
      }

      if (tech.trim().length > 0) {
        const techLines = tech.split('\n').length;
        if (tech.length > 200) {
          Alert.alert('Tech Error', 'Tech cannot be more than 200 characters');
          return;
        }
        if (techLines > 3) {
          Alert.alert('Tech Error', 'Tech cannot be more than 3 lines');
          return;
        }
      }

      const doc = await Firestore().collection('profile').doc(currentUser.uid).update({
        bio: bio,
        website: tech
      });
      Alert.alert('Success', 'Bio and Tech updated successfully');
    } catch (error) {
      Alert.alert('Error', 'Error updating bio and tech');
    }
  };

  const sections = [
    {
      key: 'bio',
      render: () => (
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Icon name="person-outline" size={24} color="#007AFF" />
            <Text style={styles.sectionTitle}>About You</Text>
          </View>
          <Text style={styles.sectionDescription}>
            Tell others about yourself in a few words
          </Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder="Add your bio here..."
              placeholderTextColor="#666"
              value={bio}
              multiline={true}
              numberOfLines={2}
              onChangeText={setbio}
            />
            <View style={styles.charCountContainer}>
              <Text style={[
                styles.charCount,
                bio.length > 200 && styles.charCountError
              ]}>
                {bio.length}/200 characters
              </Text>
              <Text style={[
                styles.charCount,
                bio.split('\n').length > 2 && styles.charCountError
              ]}>
                {bio.split('\n').length}/2 lines
              </Text>
            </View>
          </View>
        </View>
      ),
    },
    {
      key: 'tech',
      render: () => (
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Icon name="code-slash-outline" size={24} color="#007AFF" />
            <Text style={styles.sectionTitle}>Tech Stack</Text>
          </View>
          <Text style={styles.sectionDescription}>
            Share your favorite technologies and tools
          </Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.textInput, styles.techInput]}
              placeholder="e.g., React Native, Firebase, Node.js..."
              placeholderTextColor="#666"
              value={tech}
              onChangeText={settech}
              autoCapitalize="none"
              autoCorrect={false}
              multiline={true}
              numberOfLines={3}
            />
            <View style={styles.charCountContainer}>
              <Text style={[
                styles.charCount,
                tech.length > 200 && styles.charCountError
              ]}>
                {tech.length}/200 characters
              </Text>
              <Text style={[
                styles.charCount,
                tech.split('\n').length > 3 && styles.charCountError
              ]}>
                {tech.split('\n').length}/3 lines
              </Text>
            </View>
          </View>
        </View>
      ),
    },
  ];

  if (loading) {
    return (
      <View style={[styles.maincontainer, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading your profile...</Text>
      </View>
    );
  }

  return (
    <View style={styles.maincontainer}>
      <StatusBar barStyle="light-content" backgroundColor="#1e1e1e" />
      <View style={styles.Tiltecontainer}>
        <View style={styles.statusBarSpacer} />
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => handlegoback()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Icon name="create-outline" size={28} color="#007AFF" />
          <Text style={styles.titletext}>Edit Profile</Text>
        </View>
        
      </View>
      <FlatList
        data={sections}
        renderItem={({ item }) => item.render()}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
      <View style={styles.floatingButtonContainer}>
        <TouchableOpacity 
          style={styles.saveButton} 
          onPress={handlesubmit}
          activeOpacity={0.8}
        >
          <Icon name="checkmark-circle-outline" size={24} color="white" />
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default Addbio

const styles = StyleSheet.create({
  backButton: {
    paddingVertical: 25,
    position: 'absolute',
    left: 20,
    zIndex: 10,
    flex:'row',
  },
  backButtonText: {
    color: 'white',
    fontSize: 35,
  },
  maincontainer: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  statusBarSpacer: {
    height: getStatusBarHeight(),
    backgroundColor: '#1e1e1e'
  },
  Tiltecontainer: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    backgroundColor: '#1e1e1e',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 5,
  },
  titletext: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 12,
  },
  subtitle: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
  },
  listContent: {
    padding: 20,
    paddingBottom: 100,
  },
  sectionContainer: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: '600',
    marginLeft: 12,
  },
  sectionDescription: {
    color: '#999',
    fontSize: 14,
    marginBottom: 16,
    marginLeft: 36,
    lineHeight: 20,
  },
  inputContainer: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#444',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  textInput: {
    color: 'white',
    fontSize: 16,
    textAlignVertical: 'top',
    minHeight: 60,
    lineHeight: 22,
  },
  techInput: {
    minHeight: 80,
  },
  charCountContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#444',
  },
  charCount: {
    color: '#666',
    fontSize: 12,
    fontWeight: '500',
  },
  charCountError: {
    color: '#ff4444',
  },
  floatingButtonContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  saveButton: {
    flexDirection: 'row',
    width: "100%",
    height: 56,
    backgroundColor: '#007AFF',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  loadingText: {
    color: '#999',
    marginTop: 12,
    fontSize: 16,
  },
})