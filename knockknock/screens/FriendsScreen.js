import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Share,
  Modal,
} from 'react-native';
import { addFriend, getUserUniqueId, updateUserName, getUserName } from './userUtils';
import { useAuth } from './AuthContext';

const FriendsScreen = () => {
  const [friendId, setFriendId] = useState('');
  const [userUniqueId, setUserUniqueId] = useState('');
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [userName, setUserName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const [id, name] = await Promise.all([
        getUserUniqueId(),
        getUserName()
      ]);
      setUserUniqueId(id);
      setUserName(name || '');
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const handleAddFriend = async () => {
    if (!friendId) {
      Alert.alert('Error', 'Please enter a friend ID');
      return;
    }

    setLoading(true);
    try {
      await addFriend(friendId);
      Alert.alert('Success', 'Friend added successfully');
      setFriendId('');
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const shareUniqueId = async () => {
    try {
      await Share.share({
        message: `Add me on KnockKnock! My ID is: ${userUniqueId}`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const handleSaveName = async () => {
    if (!userName.trim()) {
      Alert.alert('Error', 'Please enter a valid name');
      return;
    }

    setSavingName(true);
    try {
      await updateUserName(userName.trim());
      Alert.alert('Success', 'Name updated successfully');
      setModalVisible(false);
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.idCard}>
          <Text style={styles.idLabel}>Your ID:</Text>
          <Text style={styles.uniqueId}>{userUniqueId}</Text>
          <TouchableOpacity style={styles.shareButton} onPress={shareUniqueId}>
            <Text style={styles.shareButtonText}>Share ID</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity 
          style={styles.settingsButton} 
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.settingsButtonText}>⚙️ Settings</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.addFriendSection}>
        <TextInput
          style={styles.input}
          placeholder="Enter Friend's ID"
          placeholderTextColor="#999"
          value={friendId}
          onChangeText={setFriendId}
          autoCapitalize="characters"
          maxLength={7}
        />
        <TouchableOpacity
          style={[styles.addButton, loading && styles.disabledButton]}
          onPress={handleAddFriend}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.buttonText}>Add Friend</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>User Settings</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter your name"
              placeholderTextColor="#999"
              value={userName}
              onChangeText={setUserName}
              autoCapitalize="words"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleSaveName}
                disabled={savingName}
              >
                {savingName ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.modalButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 30,
  },
  idCard: {
    flex: 1,
    backgroundColor: '#222',
    padding: 20,
    borderRadius: 10,
    marginRight: 10,
    alignItems: 'center',
  },
  settingsButton: {
    backgroundColor: '#333',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  settingsButtonText: {
    color: '#FFF',
    fontSize: 16,
  },
  idLabel: {
    color: '#999',
    fontSize: 14,
    marginBottom: 5,
  },
  uniqueId: {
    color: '#4CAF50',
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 15,
  },
  shareButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
  },
  shareButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  addFriendSection: {
    marginTop: 20,
  },
  input: {
    height: 50,
    backgroundColor: '#333',
    borderRadius: 8,
    marginBottom: 15,
    paddingHorizontal: 15,
    color: '#FFF',
    fontSize: 16,
  },
  addButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#222',
    padding: 20,
    borderRadius: 10,
    width: '80%',
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalInput: {
    height: 50,
    backgroundColor: '#333',
    borderRadius: 8,
    marginBottom: 20,
    paddingHorizontal: 15,
    color: '#FFF',
    fontSize: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  cancelButton: {
    backgroundColor: '#666',
  },
  saveButton: {
    backgroundColor: '#4CAF50',
  },
  modalButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default FriendsScreen;