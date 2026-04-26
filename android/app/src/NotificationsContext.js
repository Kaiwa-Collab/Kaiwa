import React, { createContext, useContext, useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import functions from '@react-native-firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NotificationsContext = createContext(null);

// --- helpers (copied from Profile, keep in sync) ---
const toMs = (value) => {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
  }
  if (typeof value === 'object' && value._seconds != null) {
    return Number(value._seconds) * 1000 + Math.floor((Number(value._nanoseconds) || 0) / 1e6);
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

const getLatestAnswerMs = (question) => {
  const answers = Array.isArray(question?.answers) ? question.answers : [];
  return answers.reduce((maxMs, answer) => {
    const ansMs = Math.max(toMs(answer?.timestamp), toMs(answer?.createdAt), toMs(answer?.updatedAt));
    return ansMs > maxMs ? ansMs : maxMs;
  }, 0);
};

export function NotificationsProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasUnseenQuestions, setHasUnseenQuestions] = useState(false);
  const [unseenQuestionIds, setUnseenQuestionIds] = useState([]);

  const currentUser = auth().currentUser;
  const currentUserUid = currentUser?.uid;
  const seenAnswersStorageKey = currentUserUid ? `question_answers_seen_${currentUserUid}` : null;

  // --- notifications listener ---
  useEffect(() => {
    if (!currentUserUid) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = firestore()
      .collection('notifications')
      .where('recipientUid', '==', currentUserUid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .onSnapshot(snapshot => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setNotifications(list);
        setLoading(false);
      });
    return () => unsubscribe();
  }, [currentUserUid]);

  // --- unseen questions computation on mount ---
  useEffect(() => {
    if (!currentUserUid || !seenAnswersStorageKey) return;
    let cancelled = false;

    const computeUnseen = async () => {
      try {
        const result = await functions().httpsCallable('getUserQuestions')({
          userId: currentUserUid,
          limit: 10,
        });
        const questions = result.data?.questions || [];
        if (cancelled) return;

        const raw = await AsyncStorage.getItem(seenAnswersStorageKey);
        const storedMap = raw ? JSON.parse(raw) : null;
        const nextMap = storedMap && typeof storedMap === 'object' ? { ...storedMap } : {};

        if (!storedMap) {
          questions.forEach((q) => {
            const latestMs = getLatestAnswerMs(q);
            if (latestMs > 0) nextMap[q.id] = latestMs;
          });
          await AsyncStorage.setItem(seenAnswersStorageKey, JSON.stringify(nextMap));
        }

        if (cancelled) return;

        const ids = questions
          .filter((q) => {
            const latestMs = getLatestAnswerMs(q);
            if (latestMs <= 0) return false;
            return latestMs > Number(nextMap[q.id] || 0);
          })
          .map((q) => q.id);

        setUnseenQuestionIds(ids);
        setHasUnseenQuestions(ids.length > 0);
      } catch (_) {
        // silent — dot just won't show
      }
    };

    computeUnseen();
    return () => { cancelled = true; };
  }, [currentUserUid, seenAnswersStorageKey]);

  const hasUnreadNotifications = notifications.some(n => !n.read);

  return (
    <NotificationsContext.Provider value={{
      notifications,
      loading,
      hasUnreadNotifications,
      hasUnseenQuestions,
      setHasUnseenQuestions,
      unseenQuestionIds,
      setUnseenQuestionIds,
    }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}