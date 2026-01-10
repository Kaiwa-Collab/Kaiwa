import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, StyleSheet,
  SafeAreaView, Modal, FlatList, Dimensions, StatusBar, Platform, Alert, TextInput
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useUserData } from '../users';
import Firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';

const { width } = Dimensions.get('window');
const getStatusBarHeight = () => {
  return Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;
};

// Debounce utility
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// Input sanitization
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/[<>]/g, '').substring(0, 500);
};

const Qna = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const selectedQuestionIdFromRoute = route.params?.selectedQuestionId;
  
  const [selectedQuestion, setSelectedQuestion] = useState(null);

  const { 
    profile, 
    loading, 
    followingQuestions, 
    currentUser,
    fetchTrendingQuestions,
    cacheImage,
    getCachedImageUri 
  } = useUserData();

  const currentUsername = profile?.username;
  const [trendingQuestions, setTrendingQuestions] = useState([]);
  const [loadingTrendingQuestions, setLoadingTrendingQuestions] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  // Pagination
  const [lastVisible, setLastVisible] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  
  // Search functionality
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActiveTab, setSearchActiveTab] = useState('questions');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [popularTags, setPopularTags] = useState([]);
  const [showSearch, setShowSearch] = useState(false);

  // Refs for cleanup
  const isMounted = useRef(true);
  const searchAbortController = useRef(null);

  // Popular tech tags
  const POPULAR_TECH_TAGS = [
    'react', 'javascript', 'python', 'nodejs', 'typescript', 'java',
    'react-native', 'firebase', 'mongodb', 'aws', 'docker', 'kubernetes',
    'nextjs', 'vue', 'angular', 'flutter', 'swift', 'kotlin', 'go', 'rust',
    'machine-learning', 'ai', 'blockchain', 'web3', 'devops', 'graphql'
  ];

  // Cleanup on unmount
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (searchAbortController.current) {
        searchAbortController.current.abort();
      }
    };
  }, []);

  // Format question helper
  const formatQuestion = useCallback((question) => ({
    id: question.id,
    title: question.title || 'Untitled Question',
    content: question.content || '',
    username: question.username || 'Anonymous',
    userImage: question.userImage || 'https://placehold.co/100',
    timestamp: question.timestamp,
    createdAt: question.createdAt || question.timestamp,
    answers: question.answers || [],
    tags: question.tags || [],
    authorId: question.authorId,
    likes: question.likes || 0,
    likedBy: question.likedBy || [],
    imageUrl: question.imageUrl || null,
    trendingScore: question.trendingScore || 0
  }), []);

  // Fetch trending questions with error handling
  const loadTrendingQuestions = useCallback(async (silent = false) => {
    if (!currentUser) {
      setTrendingQuestions([]);
      return;
    }
    
    if (!silent && trendingQuestions.length === 0) {
      setLoadingTrendingQuestions(true);
    }
    
    try {
      const trending = await fetchTrendingQuestions();
      
      if (!isMounted.current) return;
      
      const formattedTrendingQuestions = trending.map(formatQuestion);
      setTrendingQuestions(formattedTrendingQuestions);
    } catch (error) {
      console.error('Error loading trending questions:', error);
      if (isMounted.current) {
        setTrendingQuestions([]);
      }
    } finally {
      if (isMounted.current) {
        setLoadingTrendingQuestions(false);
      }
    }
  }, [currentUser, fetchTrendingQuestions, formatQuestion, trendingQuestions.length]);

  // Initial load
  useEffect(() => {
    loadTrendingQuestions(false);
  }, [currentUser]);

  // Background refresh with proper interval cleanup
  useEffect(() => {
    if (!currentUser) return;
    
    const interval = setInterval(() => {
      loadTrendingQuestions(true); // Silent refresh
    }, 5 * 60 * 1000); // 5 minutes
    
    return () => clearInterval(interval);
  }, [currentUser, loadTrendingQuestions]);

  // Real-time listener for main feed (following users)
  useEffect(() => {
    if (!currentUser || !profile?.following || profile.following.length === 0) {
      return;
    }

    // Firestore 'in' query limit is 10, so we need to batch if following > 10 users
    const followingIds = profile.following.slice(0, 10);
    
    const unsubscribe = Firestore()
      .collection('questions')
      .where('authorId', 'in', followingIds)
      .orderBy('timestamp', 'desc')
      .limit(50)
      .onSnapshot(
        (snapshot) => {
          if (!isMounted.current) return;
          // Changes are handled by the context, this is just for real-time updates
          console.log('Real-time update received for following questions');
        },
        (error) => {
          console.error('Error in real-time listener:', error);
        }
      );

    return () => unsubscribe();
  }, [currentUser, profile?.following]);

  // Pull to refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadTrendingQuestions(false),
        loadPopularTags()
      ]);
    } catch (error) {
      console.error('Error refreshing:', error);
      Alert.alert('Error', 'Failed to refresh. Please try again.');
    } finally {
      if (isMounted.current) {
        setRefreshing(false);
      }
    }
  }, [loadTrendingQuestions]);

  // Load popular tags with security
  const loadPopularTags = useCallback(async () => {
    try {
      const questionsSnapshot = await Firestore()
        .collection('questions')
        .orderBy('timestamp', 'desc')
        .limit(500)
        .get();

      if (!isMounted.current) return;

      const tagCount = {};
      questionsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const tags = Array.isArray(data.tags) ? data.tags : [];
        tags.forEach(tag => {
          // Sanitize tags
          const sanitizedTag = sanitizeInput(tag).toLowerCase();
          if (sanitizedTag && sanitizedTag.length > 0) {
            tagCount[sanitizedTag] = (tagCount[sanitizedTag] || 0) + 1;
          }
        });
      });

      const sortedTags = Object.entries(tagCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([tag, count]) => ({ tag, count }));

      if (isMounted.current) {
        setPopularTags(sortedTags);
      }
    } catch (error) {
      console.error('Error loading popular tags:', error);
    }
  }, []);

  useEffect(() => {
    loadPopularTags();
  }, [loadPopularTags]);

  // Debounced search with abort controller
  const debouncedSearch = useMemo(
    () => debounce(async (text) => {
      // Cancel previous search
      if (searchAbortController.current) {
        searchAbortController.current.abort();
      }
      
      const sanitizedText = sanitizeInput(text);
      
      if (sanitizedText.length === 0) {
        setSearchResults([]);
        return;
      }
      
      if (sanitizedText.length < 2) {
        setSearchResults([]);
        return;
      }

      searchAbortController.current = new AbortController();
      setSearchLoading(true);
      
      try {
        if (searchActiveTab === 'questions') {
          await searchQuestions(sanitizedText);
        } else if (searchActiveTab === 'tags') {
          await searchByTags(sanitizedText);
        } else if (searchActiveTab === 'tech') {
          await searchByTech(sanitizedText);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Error searching:', error);
          if (isMounted.current) {
            setSearchResults([]);
          }
        }
      } finally {
        if (isMounted.current) {
          setSearchLoading(false);
        }
      }
    }, 300),
    [searchActiveTab]
  );

  const handleSearch = (text) => {
    setSearchQuery(text);
    debouncedSearch(text);
  };

  const searchQuestions = async (text) => {
    try {
      const searchLower = text.toLowerCase();
      const questionsSnapshot = await Firestore()
        .collection('questions')
        .orderBy('timestamp', 'desc')
        .limit(100)
        .get();

      if (!isMounted.current) return;

      const allQuestions = questionsSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title || '',
          content: data.content || '',
          username: data.username || 'Anonymous',
          userImage: data.userImage || 'https://placehold.co/100',
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : data.timestamp,
          answers: Array.isArray(data.answers) ? data.answers : [],
          tags: Array.isArray(data.tags) ? data.tags : [],
          authorId: data.authorId,
          likes: typeof data.likes === 'number' ? data.likes : 0,
          likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
          imageUrl: data.imageUrl || null
        };
      });

      const filtered = allQuestions.filter(question => {
        const title = (question.title || '').toLowerCase();
        const content = (question.content || '').toLowerCase();
        return title.includes(searchLower) || content.includes(searchLower);
      });

      const sorted = filtered
        .sort((a, b) => (b.likes || 0) - (a.likes || 0))
        .slice(0, 20);

      if (isMounted.current) {
        setSearchResults(sorted);
      }
    } catch (error) {
      console.error('Error searching questions:', error);
      if (isMounted.current) {
        setSearchResults([]);
      }
    }
  };

  const searchByTags = async (text) => {
    try {
      const searchLower = text.toLowerCase();
      const questionsSnapshot = await Firestore()
        .collection('questions')
        .orderBy('timestamp', 'desc')
        .limit(200)
        .get();

      if (!isMounted.current) return;

      const allQuestions = questionsSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title || '',
          content: data.content || '',
          username: data.username || 'Anonymous',
          userImage: data.userImage || 'https://placehold.co/100',
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : data.timestamp,
          answers: Array.isArray(data.answers) ? data.answers : [],
          tags: Array.isArray(data.tags) ? data.tags : [],
          authorId: data.authorId,
          likes: typeof data.likes === 'number' ? data.likes : 0,
          likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
          imageUrl: data.imageUrl || null
        };
      });

      const filtered = allQuestions.filter(question => {
        const tags = (question.tags || []).join(' ').toLowerCase();
        return tags.includes(searchLower);
      });

      const sorted = filtered
        .sort((a, b) => (b.likes || 0) - (a.likes || 0))
        .slice(0, 20);

      if (isMounted.current) {
        setSearchResults(sorted);
      }
    } catch (error) {
      console.error('Error searching by tags:', error);
      if (isMounted.current) {
        setSearchResults([]);
      }
    }
  };

  const searchByTech = async (text) => {
    await searchByTags(text);
  };

  const handleTagPress = useCallback((tag) => {
    const sanitizedTag = sanitizeInput(tag);
    setSearchQuery(sanitizedTag);
    setSearchActiveTab('tags');
    searchByTags(sanitizedTag);
    setShowSearch(true);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (route.params?.clearSelection === true) {
        setSelectedQuestion(null);
      }
    }, [route.params?.clearSelection])
  );

  useFocusEffect(
    React.useCallback(() => {
      if (selectedQuestion) {
        const unsubscribe = Firestore()
          .collection('questions')
          .doc(selectedQuestion.id)
          .onSnapshot(
            (doc) => {
              if (doc.exists && isMounted.current) {
                const updated = doc.data();
                setSelectedQuestion(prev => ({
                  ...prev,
                  ...updated,
                  answers: Array.isArray(updated.answers) ? updated.answers : []
                }));
              }
            },
            (error) => {
              console.error('Error in question snapshot:', error);
            }
          );

        return () => unsubscribe();
      }
    }, [selectedQuestion?.id])
  );

  useEffect(() => {
    if (selectedQuestionIdFromRoute && questions.length > 0) {
      const specificQuestion = questions.find(q => q.id === selectedQuestionIdFromRoute);
      if (specificQuestion) {
        setSelectedQuestion(specificQuestion);
      }
    }
  }, [selectedQuestionIdFromRoute, questions]);

  useEffect(() => {
    if (selectedQuestionIdFromRoute && selectedQuestion) {
      navigation.setParams({ selectedQuestionId: undefined });
    }
  }, [selectedQuestionIdFromRoute, selectedQuestion, navigation]);

  const toDate = (timestamp) => {
    if (!timestamp) return new Date();
    if (timestamp instanceof Date) return timestamp;
    if (timestamp.toDate) return timestamp.toDate();
    if (typeof timestamp === 'string') return new Date(timestamp);
    if (typeof timestamp === 'number') return new Date(timestamp);
    return new Date();
  };

  const questions = useMemo(() => {
    if (!followingQuestions || followingQuestions.length === 0) {
      return [];
    }

    return followingQuestions.map(question => ({
      id: question.id,
      title: question.title || question.question || 'Untitled Question',
      content: question.content || question.description || '',
      username: question.username || 'Anonymous',
      userImage: getCachedImageUri(question.userImage || question.avatar || 'https://placehold.co/100'),
      timestamp: toDate(question.createdAt || question.timestamp),
      answers: (Array.isArray(question.answers) ? question.answers : []).map(ans => ({
        ...ans,
        timestamp: toDate(ans.timestamp || ans.createdAt),
        replies: (Array.isArray(ans.replies) ? ans.replies : []).map(reply => ({
          ...reply,
          timestamp: toDate(reply.timestamp)
        }))
      })),
      tags: Array.isArray(question.tags) ? question.tags : [],
      authorId: question.userId || question.authorId,
      imageUrl: question.imageUrl ? getCachedImageUri(question.imageUrl) : null,
      likes: typeof question.likes === 'number' ? question.likes : 0,
      likedBy: Array.isArray(question.likedBy) ? question.likedBy : []
    }));
  }, [followingQuestions, getCachedImageUri]);

  const filteredQuestions = useMemo(() => {
    const formattedTrendingQuestions = trendingQuestions.map(question => ({
      id: question.id,
      title: question.title || question.question || 'Untitled Question',
      content: question.content || question.description || '',
      username: question.username || 'Anonymous',
      userImage: getCachedImageUri(question.userImage || question.avatar || 'https://placehold.co/100'),
      timestamp: toDate(question.createdAt || question.timestamp),
      answers: (Array.isArray(question.answers) ? question.answers : []).map(ans => ({
        ...ans,
        timestamp: toDate(ans.timestamp || ans.createdAt),
        replies: (Array.isArray(ans.replies) ? ans.replies : []).map(reply => ({
          ...reply,
          timestamp: toDate(reply.timestamp)
        }))
      })),
      tags: Array.isArray(question.tags) ? question.tags : [],
      authorId: question.userId || question.authorId,
      imageUrl: question.imageUrl ? getCachedImageUri(question.imageUrl) : null,
      likes: typeof question.likes === 'number' ? question.likes : 0,
      likedBy: Array.isArray(question.likedBy) ? question.likedBy : [],
      trendingScore: question.trendingScore || 0,
      isTrending: true
    }));

    const formattedFollowingQuestions = questions
      .filter(q => q.username !== currentUsername)
      .map(q => ({ ...q, isTrending: false }));

    const allQuestions = [...formattedTrendingQuestions, ...formattedFollowingQuestions];

    const uniqueQuestions = allQuestions.filter((question, index, self) =>
      index === self.findIndex(q => q.id === question.id)
    );

    return uniqueQuestions.sort((a, b) => {
      if (a.isTrending && b.isTrending) {
        return (b.trendingScore || 0) - (a.trendingScore || 0);
      }
      if (a.isTrending && !b.isTrending) {
        return -1;
      }
      if (!a.isTrending && b.isTrending) {
        return 1;
      }
      return b.timestamp - a.timestamp;
    });
  }, [questions, trendingQuestions, currentUsername, getCachedImageUri]);

  const formatDate = (date) => {
    try {
      const validDate = toDate(date);
      return validDate.toLocaleDateString() + ' ' +
        validDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      return 'Unknown date';
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'now';
    
    const now = new Date();
    const itemTime = toDate(timestamp);
    const diffMs = now - itemTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return itemTime.toLocaleDateString();
  };

  // Question Card with security improvements
  const QuestionCard = React.memo(({ question }) => {
    const [isLiked, setIsLiked] = useState(false);
    const [likeCount, setLikeCount] = useState(question.likes || 0);
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
      if (currentUser && Array.isArray(question.likedBy)) {
        setIsLiked(question.likedBy.includes(currentUser.uid));
      }
      setLikeCount(typeof question.likes === 'number' ? question.likes : 0);
    }, [question.likedBy, question.likes, currentUser]);

    const handleLike = async (e) => {
      e.stopPropagation();
      
      if (!currentUser) {
        Alert.alert('Login Required', 'Please log in to like questions.');
        return;
      }

      if (updating) return;
      
      // Validate question ID
      if (!question.id || typeof question.id !== 'string') {
        Alert.alert('Error', 'Invalid question ID');
        return;
      }

      setUpdating(true);

      // Optimistic update
      const newIsLiked = !isLiked;
      const newLikeCount = newIsLiked ? likeCount + 1 : Math.max(0, likeCount - 1);
      setIsLiked(newIsLiked);
      setLikeCount(newLikeCount);

      try {
        const questionRef = Firestore().collection('questions').doc(question.id);
        
        await questionRef.update({
          likes: Firestore.FieldValue.increment(newIsLiked ? 1 : -1),
          likedBy: newIsLiked 
            ? Firestore.FieldValue.arrayUnion(currentUser.uid)
            : Firestore.FieldValue.arrayRemove(currentUser.uid),
          updatedAt: Firestore.FieldValue.serverTimestamp()
        });
      } catch (error) {
        console.error('Error updating like:', error);
        Alert.alert('Error', 'Failed to update like. Please try again.');
        // Revert optimistic update
        setIsLiked(!newIsLiked);
        setLikeCount(newIsLiked ? Math.max(0, newLikeCount - 1) : newLikeCount + 1);
      } finally {
        setUpdating(false);
      }
    };

    return (
      <TouchableOpacity
        style={styles.questionCard}
        onPress={() => {
          setTimeout(() => setSelectedQuestion(question), 150);
        }}
      >
        <View style={styles.questionHeader}>
          <Image source={{ uri: question.userImage }} style={styles.userAvatar} />
          <View style={styles.questionMeta}>
            <Text style={styles.username}>@{question.username}</Text>
            <Text style={styles.timestamp}>{formatDate(question.timestamp)}</Text>
          </View>
        </View>
        <Text style={styles.questionTitle}>{question.title}</Text>
        <Text style={styles.questionContent} numberOfLines={2}>
          {question.content}
        </Text>
        
        {question.imageUrl && (
          <Image source={{ uri: question.imageUrl }} style={styles.questionImage} />
        )}
        
        {Array.isArray(question.tags) && question.tags.length > 0 && (
          <View style={styles.tagsContainer}>
            {question.tags.slice(0, 3).map((tag, index) => (
              <View key={index} style={styles.tagChip}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        )}
        
        <View style={styles.questionFooter}>
          <TouchableOpacity 
            style={styles.likeButton}
            onPress={handleLike}
            disabled={updating}
          >
            <Icon
              name={isLiked ? 'heart' : 'heart-o'}
              size={18}
              color={isLiked ? '#FF6D1F' : '#999'}
              style={{ opacity: updating ? 0.6 : 1 }}
            />
            <Text style={[styles.likeCount, isLiked && styles.likeCountActive]}>
              {likeCount}
            </Text>
          </TouchableOpacity>

          <View style={styles.answerCount}>
            <Icon name="comment-o" size={16} color="#999" />
            <Text style={styles.answerCountText}>
              {question.answers.length} {question.answers.length === 1 ? 'Answer' : 'Answers'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  });

  // Reply Item Component
  const ReplyItem = React.memo(({ reply, parentAnswerId }) => {
    return (
      <View style={styles.replyContainer}>
        <Image 
          source={{ uri: getCachedImageUri(reply.userImage) || reply.userImage || 'https://placehold.co/100' }} 
          style={styles.replyAvatar} 
        />
        <View style={styles.replyContent}>
          <Text style={styles.replyText}>
            <Text style={styles.replyUsername}>{reply.username}</Text> {reply.content}
          </Text>
          
          {reply.code && (
            <View style={styles.replyCodeBlock}>
              <Text style={styles.codeText}>{reply.code}</Text>
            </View>
          )}
          
          {reply.image && (
            <Image 
              source={{ uri: reply.image.uri || reply.image }} 
              style={styles.replyImage} 
            />
          )}
          
          <View style={styles.replyActions}>
            <Text style={styles.replyTimestamp}>
              {formatTimestamp(reply.timestamp)}
            </Text>
          </View>
        </View>
      </View>
    );
  });

  // Answer Component
  const AnswerItem = React.memo(({ answer }) => {
    return (
      <View style={styles.answerItem}>
        <View style={styles.answerHeader}>
          <View style={styles.answerUserInfo}>
            <Image 
              source={{ uri: getCachedImageUri(answer.userImage) || answer.userImage || 'https://placehold.co/100' }} 
              style={styles.answerUserAvatar} 
            />
            <Text style={styles.answerUsername}>@{answer.username}</Text>
          </View>
          <Text style={styles.answerTimestamp}>{formatTimestamp(answer.timestamp)}</Text>
        </View>
        <Text style={styles.answerContent}>{answer.content}</Text>
        {answer.code && (
          <View style={styles.codeBlock}>
            <Text style={styles.codeText}>{answer.code}</Text>
          </View>
        )}
        {answer.image && (
          <Image source={{ uri: answer.image.uri }} style={styles.answerImage} />
        )}

        {Array.isArray(answer.replies) && answer.replies.length > 0 && (
          <View style={styles.repliesContainer}>
            <Text style={styles.repliesTitle}>
              {answer.replies.length} {answer.replies.length === 1 ? 'Reply' : 'Replies'}
            </Text>
            {answer.replies.map((reply) => (
              <ReplyItem key={reply.id} reply={reply} parentAnswerId={answer.id} />
            ))}
          </View>
        )}

        <TouchableOpacity 
          style={styles.replyButton} 
          onPress={() => navigation.navigate('Answer', {
            question: selectedQuestion,
            replytouser: answer,
            isreply: true
          })}
        >
          <Text style={styles.replyButtonText}>Reply</Text>
        </TouchableOpacity>
      </View>
    );
  });

  const formattedSearchResults = useMemo(() => {
    return searchResults.map(question => ({
      id: question.id,
      title: question.title || 'Untitled Question',
      content: question.content || '',
      username: question.username || 'Anonymous',
      userImage: getCachedImageUri(question.userImage || 'https://placehold.co/100'),
      timestamp: toDate(question.timestamp),
      answers: (Array.isArray(question.answers) ? question.answers : []).map(ans => ({
        ...ans,
        timestamp: toDate(ans.timestamp || ans.createdAt),
        replies: (Array.isArray(ans.replies) ? ans.replies : []).map(reply => ({
          ...reply,
          timestamp: toDate(reply.timestamp)
        }))
      })),
      tags: Array.isArray(question.tags) ? question.tags : [],
      authorId: question.authorId,
      imageUrl: question.imageUrl ? getCachedImageUri(question.imageUrl) : null,
      likes: typeof question.likes === 'number' ? question.likes : 0,
      likedBy: Array.isArray(question.likedBy) ? question.likedBy : []
    }));
  }, [searchResults, getCachedImageUri]);

  // Question List View
  const QuestionListView = () => (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1e1e1e" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Developer Q&A</Text>
        <TouchableOpacity
          onPress={() => setShowSearch(!showSearch)}
          style={styles.searchToggleButton}
        >
          <Icon name={showSearch ? "times" : "search"} size={20} color="white" />
        </TouchableOpacity>
      </View>

      {/* Search Section */}
      {showSearch && (
        <View style={styles.searchSection}>
          <View style={styles.searchBar}>
            <Icon name="search" size={18} color="#999" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder={searchActiveTab === 'questions' ? "Search questions..." : searchActiveTab === 'tags' ? "Search by tags..." : "Search by tech..."}
              value={searchQuery}
              onChangeText={handleSearch}
              placeholderTextColor="#999"
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => {
                setSearchQuery('');
                setSearchResults([]);
              }}>
                <Icon name="times" size={16} color="#999" />
              </TouchableOpacity>
            )}
          </View>

          {/* Tabs */}
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={[styles.tab, searchActiveTab === 'questions' && styles.activeTab]}
              onPress={() => {
                setSearchActiveTab('questions');
                if (searchQuery) handleSearch(searchQuery);
              }}
            >
              <Icon name="question-circle" size={16} color={searchActiveTab === 'questions' ? '#FF6D1F' : '#999'} />
              <Text style={[styles.tabText, searchActiveTab === 'questions' && styles.activeTabText]}>Questions</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, searchActiveTab === 'tags' && styles.activeTab]}
              onPress={() => {
                setSearchActiveTab('tags');
                if (searchQuery) handleSearch(searchQuery);
              }}
            >
              <Icon name="tags" size={16} color={searchActiveTab === 'tags' ? '#FF6D1F' : '#999'} />
              <Text style={[styles.tabText, searchActiveTab === 'tags' && styles.activeTabText]}>Tags</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, searchActiveTab === 'tech' && styles.activeTab]}
              onPress={() => {
                setSearchActiveTab('tech');
                if (searchQuery) handleSearch(searchQuery);
              }}
            >
              <Icon name="code" size={16} color={searchActiveTab === 'tech' ? '#FF6D1F' : '#999'} />
              <Text style={[styles.tabText, searchActiveTab === 'tech' && styles.activeTabText]}>Tech</Text>
            </TouchableOpacity>
          </View>

          {/* Popular Tags View (when no search query) */}
          {searchQuery.length === 0 && searchActiveTab === 'tags' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.popularTagsContainer}>
              <Text style={styles.sectionLabel}>Popular Tags:</Text>
              {popularTags.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.popularTagChip}
                  onPress={() => handleTagPress(item.tag)}
                >
                  <Text style={styles.popularTagText}>#{item.tag}</Text>
                  <Text style={styles.popularTagCount}>{item.count}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Tech Tags View (when no search query) */}
          {searchQuery.length === 0 && searchActiveTab === 'tech' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.popularTagsContainer}>
              <Text style={styles.sectionLabel}>Browse Technologies:</Text>
              {POPULAR_TECH_TAGS.map((tag, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.techTagChip}
                  onPress={() => handleTagPress(tag)}
                >
                  <Icon name="code" size={14} color="#FF6D1F" />
                  <Text style={styles.techTagText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* Search Results or Regular Questions */}
      {searchLoading && (
        <View style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ color: '#aaa' }}>Searching...</Text>
        </View>
      )}

      {showSearch && searchQuery.length > 0 && searchResults.length > 0 ? (
        <FlatList
          data={formattedSearchResults}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <QuestionCard question={item} />}
          contentContainerStyle={styles.questionsList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={() => (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Text style={{ color: '#999' }}>No results found</Text>
            </View>
          )}
        />
      ) : showSearch && searchQuery.length > 0 && searchResults.length === 0 && !searchLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 }}>
          <Text style={{ color: '#999', fontSize: 16 }}>No results found</Text>
        </View>
      ) : (loading || loadingTrendingQuestions) ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#aaa', fontSize: 16 }}>Loading questions...</Text>
        </View>
      ) : filteredQuestions.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 }}>
          <Text style={{ color: '#aaa', fontSize: 18, fontWeight: '600' }}>
            {followingQuestions.length === 0 
              ? "Follow some users to see their questions here" 
              : "No questions from followed users yet"
            }
          </Text>
          {followingQuestions.length === 0 && (
            <Text style={{ color: '#999', fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>
              Discover and follow other developers to see their questions and contribute with your answers.
            </Text>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredQuestions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <QuestionCard question={item} />}
          contentContainerStyle={styles.questionsList}
          showsVerticalScrollIndicator={false}
          refreshing={loading}
        />
      )}
    </View>
  );

  // Question Detail View
  const QuestionDetailView = React.memo(() => {
    const sortedAnswers = useMemo(() => {
      if (!selectedQuestion?.answers) return [];
      return [...selectedQuestion.answers].sort((a, b) => 
        toDate(b.timestamp) - toDate(a.timestamp)
      );
    }, [selectedQuestion]);

    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1e1e1e" />
        <View style={styles.statusBarSpacer} />

        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setSelectedQuestion(null)}
          >
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.answerButton}
            onPress={() => navigation.navigate('Answer', { question: selectedQuestion })}
          >
            <Text style={styles.answerButtonText}>Answer</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.questionDetail}>
          {/* Question Section */}
          <View style={styles.questionDetailHeader}>
            <Image source={{ uri: selectedQuestion.userImage }} style={styles.detailUserAvatar} />
            <View style={styles.detailUserInfo}>
              <Text style={styles.detailUsername}>@{selectedQuestion.username}</Text>
              <Text style={styles.detailTimestamp}>{formatDate(selectedQuestion.timestamp)}</Text>
            </View>
          </View>
          <Text style={styles.detailTitle}>{selectedQuestion.title}</Text>
          <Text style={styles.detailContent}>{selectedQuestion.content}</Text>

          {selectedQuestion.imageUrl && (
            <Image source={{ uri: selectedQuestion.imageUrl }} style={styles.questionImage} />
          )}

          {selectedQuestion.tags && selectedQuestion.tags.length > 0 && (
            <View style={styles.detailTagsContainer}>
              {selectedQuestion.tags.map((tag, index) => (
                <View key={index} style={styles.tagChip}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* All Answers Section */}
          <View style={styles.answersSection}>
            <Text style={styles.answersTitle}>
              {sortedAnswers.length === 0
                ? 'No Answers Yet'
                : `${sortedAnswers.length} ${sortedAnswers.length === 1 ? 'Answer' : 'Answers'}`
              }
            </Text>
            {sortedAnswers.map((answer) => (
              <AnswerItem key={answer.id} answer={answer} />
            ))}
          </View>
        </ScrollView>
      </View>
    );
  });

 if (loading && followingQuestions.length === 0) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e1e1e' }}>
      <Text style={{ color: 'white' }}>Loading your data...</Text>
    </View>
  );
}

  return (
    <>
      {selectedQuestion ? <QuestionDetailView /> : <QuestionListView />}
    </>
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
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    height: 70,
    paddingTop: getStatusBarHeight(),
    paddingHorizontal: 16,
    
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    flex:1,
    textAlign: 'center',
  },
  searchToggleButton: {
    padding: 8,
    
  },
  searchSection: {
    backgroundColor: '#1e1e1e',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2c2c32',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: 'white',
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#2c2c32',
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  activeTab: {
    backgroundColor: '#1e1e1e',
  },
  tabText: {
    color: '#999',
    fontSize: 13,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#FF6D1F',
  },
  popularTagsContainer: {
    flexDirection: 'row',
    marginTop: 8,
    marginBottom: 8,
  },
  sectionLabel: {
    color: '#999',
    fontSize: 14,
    marginRight: 12,
    alignSelf: 'center',
  },
  popularTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2c2c32',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#FF6D1F',
    gap: 6,
  },
  popularTagText: {
    color: '#FF6D1F',
    fontSize: 13,
    fontWeight: '600',
  },
  popularTagCount: {
    color: '#999',
    fontSize: 11,
  },
  techTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2c2c32',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    gap: 6,
  },
  techTagText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '500',
  },
  backButton: {
    paddingVertical: 8,
    position: 'absolute',
    left: 16, 
  },
  backButtonText: {
    color: 'white',
    fontSize: 30,
    fontWeight: '6000',
  },
  answerButton: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    position: 'absolute',
    right: 16,
  },
  answerButtonText: {
    color: '#1e1e1e',
    fontWeight: '600',
  },
  questionsList: {
    padding: 16,
  },
  questionCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderBottomColor: '#ff6d1f',
    borderBottomWidth: 1,
    borderBottomRadius: 2,
    shadowColor: '#ff6d1f',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  questionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 8,
  },
  questionContent: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 12,
  },
  questionImage: {
    width: '100%',
    height: 150,
    borderRadius: 8,
    marginBottom: 12,
    resizeMode: 'cover',
  },
  questionMeta: {
    flex: 1,
  },
  username: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  detailTagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  tagChip: {
    backgroundColor: '#FF6D1F',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  questionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  likeCount: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  likeCountActive: {
    color: '#FF6D1F',
  },
  answerCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  answerCountText: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  questionDetail: {
    flex: 1,
    padding: 16,
  },
  questionDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  detailUserAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  detailUserInfo: {
    flex: 1,
  },
  detailUsername: {
    fontSize: 14,
    color: 'white',
    fontWeight: '600',
  },
  detailTimestamp: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  detailTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 12,
  },
  detailContent: {
    fontSize: 16,
    color: '#ccc',
    lineHeight: 24,
    marginBottom: 16,
  },
  answersSection: {
    marginTop: 24,
  },
  answersTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    marginBottom: 16,
  },
  answerItem: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#ff6d1f',
    borderBottomWidth: 1,
    borderBottomRadius: 2,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  answerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  answerUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  answerUserAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  answerUsername: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  answerTimestamp: {
    fontSize: 12,
    color: '#999',
  },
  answerContent: {
    fontSize: 14,
    color: '#ddd',
    lineHeight: 20,
    marginBottom: 8,
  },
  codeBlock: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#00ff00',
  },
  answerImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginTop: 8,
    resizeMode: 'cover',
  },
  repliesContainer: {
    marginTop: 16,
    marginLeft: 12,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#555',
  },
  repliesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#aaa',
    marginBottom: 12,
  },
  replyContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  replyAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 8,
  },
  replyContent: {
    flex: 1,
  },
  replyText: {
    color: '#bbb',
    fontSize: 13,
    lineHeight: 18,
  },
  replyUsername: {
    fontWeight: '600',
    color: '#007AFF',
  },
  replyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  replyTimestamp: {
    color: '#666',
    fontSize: 11,
  },
  replyButton: {
    alignSelf: 'flex-end',
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 8,
  },
  replyButtonText: {
    color: '#1e1e1e',
    fontWeight: '600',
    fontSize: 13,
  },
  replyCodeBlock: {
  backgroundColor: '#1a1a1a',
  borderRadius: 6,
  padding: 8,
  marginTop: 8,
  borderWidth: 1,
  borderColor: '#444',
},
replyImage: {
  width: '100%',
  height: 150,
  borderRadius: 8,
  marginTop: 8,
  resizeMode: 'cover',
},
});
export default Qna;