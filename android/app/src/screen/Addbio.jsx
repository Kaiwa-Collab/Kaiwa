import { StyleSheet, Text, FlatList, View, TextInput, StatusBar, Alert, ActivityIndicator } from 'react-native'
import { useState } from 'react'
import React from 'react'
import { TouchableOpacity } from 'react-native';
import Firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Platform } from 'react-native';
import { useEffect } from 'react';

const currentUser = auth().currentUser;

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;
const Addbio = () => {
  const currentUser = auth().currentUser;

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

  const handlesubmit = async () => {
    try {
      if (bio.trim().length === 0 && tech.trim().length === 0) {
        Alert.alert('Empty Fields', 'Both bio and tech are empty. Please add at least one.');
        return;
      }

      // Validate bio
      // Validate bio
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

// Validate tech
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
        <View style={styles.container2}>
          <TextInput
            style={styles.text1}
            placeholder="Add Bio (max 200 chars, 2 lines)"
            placeholderTextColor="#aaa"
            value={bio}
            multiline={true}
            numberOfLines={2}
            onChangeText={setbio}
          />
          <Text style={styles.charCount}>{bio.length}/200 words | {bio.split('\n').length}/2 lines</Text>
        </View>
      ),
    },
    {
      key: 'tech',
      render: () => (
        <View style={styles.container3}>
          <TextInput
            style={styles.text2}
            placeholder="Add tech (max 200 chars, 3 lines)"
            placeholderTextColor="#aaa"
            value={tech}
            onChangeText={settech}
            autoCapitalize="none"
            autoCorrect={false}
            multiline={true}
            numberOfLines={3}
          />
          <Text style={styles.charCount}>{tech.length}/200 words | {tech.split('\n').length}/3 lines</Text>
        </View>
      ),
    },
  ];

  if (loading) {
    return (
      <View style={[styles.maincontainer, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#3b5998" />
        <Text style={{ color: 'white', marginTop: 10 }}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.maincontainer}>
      <View style={styles.Tiltecontainer}>
        <View style={styles.statusBarSpacer} />
        <Text style={styles.titletext}>Bio</Text>
      </View>
      <FlatList
        data={sections}
        renderItem={({ item }) => item.render()}
        keyExtractor={item => item.key}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
      <View style={styles.floatingButtonContainer} >
        <TouchableOpacity style={styles.Touchopc} onPress={handlesubmit}>
          <Text style={{ color: 'white', fontSize: 20 }}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default Addbio

const styles = StyleSheet.create({
  maincontainer: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    padding: 10,
  },
  statusBarSpacer: {
    height: getStatusBarHeight(),
    backgroundColor: '#1e1e1e'
  },
  Tiltecontainer: {
    height: 70,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'white',
  },
  titletext: {
    color: 'white',
    fontSize: 25,
  },
  container2: {
    minHeight: 80,
    width: '100%',
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 10,
    marginTop: 20,
    padding: 10,
  },
  container3: {
    minHeight: 100,
    width: '100%',
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 10,
    marginTop: 20,
    padding: 10,
  },
  text1: {
    color: 'white',
    fontSize: 20,
    textAlignVertical: 'top',
    minHeight: 40,
  },
  text2: {
    color: 'white',
    fontSize: 20,
    textAlignVertical: 'top',
    minHeight: 60,
  },
  charCount: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 5,
    textAlign: 'right',
  },
  Touchopc: {
    width: "100%",
    height: 50,
    backgroundColor: '#3b5998',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    bottom: 0,
  },
  floatingButtonContainer: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
})