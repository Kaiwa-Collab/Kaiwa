// QnAIntegration.js
// Helper functions to sync questions between Firestore and your existing QnA system

import Firestore from '@react-native-firebase/firestore';

export class QnAIntegration {
  
  // Fetch questions from Firestore and format them for your existing QnA component
  static async fetchQuestionsForQnA() {
    try {
      const questionsSnapshot = await Firestore()
        .collection('questions')
        .orderBy('timestamp', 'desc')
        .get();

      const questions = questionsSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title,
          content: data.content,
          username: data.username,
          userImage: data.userImage,
          timestamp: data.timestamp instanceof Date ? data.timestamp : data.timestamp?.toDate() || new Date(),
          answers: data.answers || [],
          tags: data.tags || [],
          authorId: data.authorId
        };
      });

      return questions;
    } catch (error) {
      console.error('Error fetching questions for QnA:', error);
      return [];
    }
  }

  // Update question with new answer
  static async addAnswerToQuestion(questionId, answerData) {
    try {
      const questionRef = Firestore().collection('questions').doc(questionId);
      const questionDoc = await questionRef.get();
      
      if (questionDoc.exists) {
        const currentData = questionDoc.data();
        const updatedAnswers = [...(currentData.answers || []), answerData];
        
        await questionRef.update({
          answers: updatedAnswers,
          answersCount: updatedAnswers.length
        });
        
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error adding answer to question:', error);
      return false;
    }
  }

  // Get specific question by ID
  static async getQuestionById(questionId) {
    try {
      const questionDoc = await Firestore().collection('questions').doc(questionId).get();
      
      if (questionDoc.exists) {
        const data = questionDoc.data();
        return {
          id: questionDoc.id,
          title: data.title,
          content: data.content,
          username: data.username,
          userImage: data.userImage,
          timestamp: data.timestamp instanceof Date ? data.timestamp : data.timestamp?.toDate() || new Date(),
          answers: data.answers || [],
          tags: data.tags || [],
          authorId: data.authorId
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting question by ID:', error);
      return null;
    }
  }

  // Get questions by user ID
  static async getQuestionsByUserId(userId) {
    try {
      const questionsSnapshot = await Firestore()
        .collection('questions')
        .where('authorId', '==', userId)
        .orderBy('timestamp', 'desc')
        .get();

      const questions = questionsSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title,
          content: data.content,
          username: data.username,
          userImage: data.userImage,
          timestamp: data.timestamp instanceof Date ? data.timestamp : data.timestamp?.toDate() || new Date(),
          answers: data.answers || [],
          tags: data.tags || [],
          authorId: data.authorId
        };
      });

      return questions;
    } catch (error) {
      console.error('Error getting questions by user ID:', error);
      return [];
    }
  }

  // Update your existing QnA component to use Firestore
  static async syncQnAWithFirestore() {
    try {
      // Get all questions from Firestore
      const firestoreQuestions = await this.fetchQuestionsForQnA();
      
      // You can update your QnaData export or return this data
      // to be used in your QnA component
      return firestoreQuestions;
    } catch (error) {
      console.error('Error syncing QnA with Firestore:', error);
      return [];
    }
  }
}