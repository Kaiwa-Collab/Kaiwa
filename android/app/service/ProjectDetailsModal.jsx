import React, { useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, StyleSheet, Alert
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import functions from '@react-native-firebase/functions';
import auth from '@react-native-firebase/auth';

const ProjectDetailsModal = ({ visible, project, onClose, isInviteMode, onAcceptInvite, onRejectInvite, acceptingInvite, rejectingInvite }) => {
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  const currentUser = auth().currentUser;

  // Fetch participants when modal opens
  React.useEffect(() => {
    if (visible && project?.id) {
      fetchParticipants();
      setApplied(false); // reset on each open
    }
  }, [visible, project?.id]);

  const fetchParticipants = async () => {
    setLoadingParticipants(true);
    try {
      const result = await functions()
        .httpsCallable('getProjectParticipants')({ projectId: project.id });
      setParticipants(result.data?.participants || []);
    } catch {
      setParticipants([]);
    } finally {
      setLoadingParticipants(false);
    }
  };

  const handleApply = async () => {
    if (!currentUser || !project?.id) return;
    setApplying(true);
    try {
      await functions()
        .httpsCallable('sendProjectJoinRequest')({ projectId: project.id });
      setApplied(true);
      Alert.alert('Request Sent!', 'The project creator has been notified of your interest.');
    } catch (error) {
      const msg = error?.message || '';
      if (msg.includes('already-requested')) {
        setApplied(true);
        Alert.alert('Already Applied', 'You have already sent a join request for this project.');
      } else if (msg.includes('already-collaborator')) {
        Alert.alert('Already a Member', 'You are already a collaborator on this project.');
      } else if (msg.includes('creator')) {
        Alert.alert('Not Allowed', 'You cannot apply to your own project.');
      }else if (msg.includes('github-not-connected')) {
      Alert.alert('GitHub Required', 'You need to connect your GitHub account before joining a project. Go to Settings → Connect GitHub.')
      } else {
        Alert.alert('Error', 'Could not send join request. Please try again.');
      }
    } finally {
      setApplying(false);
    }
  };

  if (!project) return null;

  const isCreator = project.creatorId === currentUser?.uid;
  const isCollaborator = project.collaborators?.includes(currentUser?.uid);
  const isAlreadyMember = isCreator || isCollaborator;

  const statusStyle = project.status === 'completed'
    ? styles.statusCompleted
    : project.status === 'pending'
    ? styles.statusPending
    : styles.statusOngoing;

  const statusLabel = project.status === 'completed'
    ? 'Completed'
    : project.status === 'pending'
    ? 'Pending'
    : 'Ongoing';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Project Details</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={24} color="white" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Title */}
            <View style={styles.row}>
              <Text style={styles.label}>Project Title</Text>
              <Text style={styles.value}>{project.title || 'N/A'}</Text>
            </View>

            {/* About */}
            <View style={styles.row}>
              <Text style={styles.label}>About</Text>
              <Text style={styles.value}>{project.about || 'N/A'}</Text>
            </View>

            {/* Tech */}
            <View style={styles.row}>
              <Text style={styles.label}>Technologies</Text>
              <Text style={[styles.value, project.tech && styles.techText]}>
                {project.tech || 'N/A'}
              </Text>
            </View>

            {/* GitHub */}
            <View style={styles.row}>
              <Text style={styles.label}>GitHub Repository</Text>
              <Text style={[styles.value, project.githubRepo && styles.linkText]} numberOfLines={1}>
                {project.githubRepo || 'N/A'}
              </Text>
            </View>

            {/* Status */}
            <View style={styles.row}>
              <Text style={styles.label}>Status</Text>
              <View style={[styles.statusTag, statusStyle]}>
                <Text style={styles.statusText}>{statusLabel}</Text>
              </View>
            </View>

            {/* Creator */}
            <View style={styles.row}>
              <Text style={styles.label}>Created By</Text>
              <Text style={styles.value}>{project.creatorUsername || 'Unknown'}</Text>
            </View>

            {/* Created At */}
            {project.createdAt && (
              <View style={styles.row}>
                <Text style={styles.label}>Created At</Text>
                <Text style={styles.value}>
                  {project.createdAt.toDate
                    ? new Date(project.createdAt.toDate()).toLocaleDateString()
                    : 'N/A'}
                </Text>
              </View>
            )}

            {/* Participants */}
            <View style={styles.participantsSection}>
              <Text style={styles.participantsTitle}>Active Participants</Text>
              {loadingParticipants ? (
                <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 16 }} />
              ) : participants.length === 0 ? (
                <Text style={styles.noParticipants}>No participants yet</Text>
              ) : (
                participants.map((p) => (
                  <View key={p.id} style={styles.participantItem}>
                    <Image source={{ uri: p.avatar }} style={styles.avatar} />
                    <View style={styles.participantInfo}>
                      <View style={styles.participantNameRow}>
                        <Text style={styles.participantName}>{p.username}</Text>
                        {p.isCreator && (
                          <View style={styles.creatorBadge}>
                            <Icon name="star" size={12} color="#FFD700" />
                            <Text style={styles.creatorBadgeText}>Creator</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.participantEmail}>{p.email}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Spacer so content isn't hidden behind the button */}
            <View style={{ height: 100 }} />
          </ScrollView>

          {/* Invite mode: Accept / Reject */}
          {isInviteMode && onAcceptInvite && onRejectInvite && (
            <View style={styles.applyContainer}>
              <View style={styles.inviteButtonRow}>
                <TouchableOpacity
                  style={[styles.inviteAcceptButton, acceptingInvite && styles.applyButtonDisabled]}
                  onPress={onAcceptInvite}
                  disabled={acceptingInvite}
                >
                  {acceptingInvite ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Icon name="checkmark-circle" size={20} color="white" />
                      <Text style={styles.applyButtonText}>Accept</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.inviteRejectButton, rejectingInvite && styles.applyButtonDisabled]}
                  onPress={onRejectInvite}
                  disabled={rejectingInvite}
                >
                  {rejectingInvite ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Icon name="close-circle" size={20} color="white" />
                      <Text style={styles.applyButtonText}>Decline</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Apply Button — fixed at bottom (non-invite mode) */}
          {!isAlreadyMember && !isInviteMode && (
            <View style={styles.applyContainer}>
              <TouchableOpacity
                style={[
                  styles.applyButton,
                  (applied || applying) && styles.applyButtonDisabled,
                ]}
                onPress={handleApply}
                disabled={applied || applying}
              >
                {applying ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <Icon
                      name={applied ? 'checkmark-circle' : 'people-circle-outline'}
                      size={20}
                      color="white"
                    />
                    <Text style={styles.applyButtonText}>
                      {applied ? 'Request Sent' : 'Apply to Join'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {isAlreadyMember && !isInviteMode && (
            <View style={styles.applyContainer}>
              <View style={styles.memberBadge}>
                <Icon name="checkmark-circle" size={20} color="#10B981" />
                <Text style={styles.memberBadgeText}>
                  {isCreator ? 'You created this project' : 'You are a collaborator'}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    height: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  row: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  label: {
    color: '#999',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  value: {
    color: 'white',
    fontSize: 16,
    lineHeight: 24,
  },
  techText: {
    color: '#007AFF',
  },
  linkText: {
    color: '#007AFF',
  },
  statusTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
  },
  statusCompleted: { backgroundColor: '#10B981' },
  statusOngoing: { backgroundColor: '#007AFF' },
  statusPending: { backgroundColor: '#F59E0B' },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  participantsSection: {
    borderTopWidth: 2,
    borderTopColor: '#333',
    paddingTop: 20,
  },
  participantsTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  noParticipants: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  participantInfo: { flex: 1 },
  participantNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  participantName: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
    marginRight: 8,
  },
  creatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFD700',
  },
  creatorBadgeText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 2,
  },
  participantEmail: {
    color: '#999',
    fontSize: 12,
  },
  applyContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: '#1e1e1e',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  applyButton: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  applyButtonDisabled: {
    backgroundColor: '#333',
    borderWidth: 1,
    borderColor: '#555',
  },
  applyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  inviteButtonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inviteAcceptButton: {
    flex: 1,
    backgroundColor: '#10B981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  inviteRejectButton: {
    flex: 1,
    backgroundColor: '#e74c3c',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  memberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
    gap: 8,
  },
  memberBadgeText: {
    color: '#10B981',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default ProjectDetailsModal;