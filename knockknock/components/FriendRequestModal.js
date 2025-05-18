import React, { useState } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  Modal,
  StyleSheet,
  ScrollView,
} from 'react-native';
export const FriendRequestModal = ({ visible, requests, onAccept, onDecline, onClose }) => {
    return (
      <Modal
        visible={visible}
        transparent={true}
        animationType="slide"
        onRequestClose={onClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.requestModalContent}>
            <Text style={styles.requestModalTitle}>Friend Requests</Text>
            
            {Object.entries(requests).map(([requestId, request]) => (
              <View key={requestId} style={styles.requestItem}>
                <View style={styles.requestAvatarSection}>
                  <View style={styles.requestAvatar}>
                    <Text style={styles.requestAvatarText}>
                      {(request.senderName || request.senderEmail || '')[0].toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.requestInfo}>
                    <Text style={styles.requestName}>
                      {request.senderName || request.senderEmail}
                    </Text>
                    <View style={styles.requestButtons}>
                      <TouchableOpacity
                        style={[styles.requestButton, styles.declineButton]}
                        onPress={() => onDecline(requestId)}
                      >
                        <Text style={styles.declineButtonText}>Decline</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.requestButton, styles.acceptButton]}
                        onPress={() => onAccept(requestId)}
                      >
                        <Text style={styles.acceptButtonText}>Accept</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            ))}
  
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
      },
      requestModalContent: {
        backgroundColor: '#222',
        borderRadius: 12,
        padding: 20,
        width: '100%',
        maxWidth: 400,
      },
      requestModalTitle: {
        color: '#FFF',
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
      },
      requestItem: {
        marginBottom: 20,
      },
      requestAvatarSection: {
        backgroundColor: '#8B5CF6',
        borderRadius: 12,
        padding: 20,
      },
      requestAvatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#4CAF50',
        justifyContent: 'center',
        alignItems: 'center',
        alignSelf: 'center',
        marginBottom: 15,
      },
      requestAvatarText: {
        color: '#FFF',
        fontSize: 36,
        fontWeight: 'bold',
      },
      requestInfo: {
        alignItems: 'center',
      },
      requestName: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '500',
        marginBottom: 15,
        textAlign: 'center',
      },
      acceptButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingHorizontal: 30,
        paddingVertical: 10,
        borderRadius: 20,
      },
      acceptButtonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
      },
      closeButton: {
        marginTop: 20,
        paddingVertical: 12,
        alignItems: 'center',
      },
      closeButtonText: {
        color: '#999',
        fontSize: 16,
      },
      requestButtons: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 10,
        marginTop: 10,
      },
      requestButton: {
        paddingHorizontal: 20,
        paddingVertical: 8,
        borderRadius: 20,
      },
      acceptButton: {
        backgroundColor: '#8B5CF6',
      },
      declineButton: {
        backgroundColor: '#333',
      },
      acceptButtonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
      },
      declineButtonText: {
        color: '#FF4444',
        fontSize: 16,
        fontWeight: '600',
      },
  });