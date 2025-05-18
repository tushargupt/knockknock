import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { updateUserName } from './userUtils';

const NameConfirmationScreen = ({ route, navigation }) => {
  // Get the initial name from navigation params
  const { initialName, userId } = route.params || {};
  const [name, setName] = useState(initialName || '');
  const [loading, setLoading] = useState(false);

  const handleSaveName = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter your name');
      return;
    }

    setLoading(true);
    try {
      // Update the user's name using the function from userUtils
      await updateUserName(name.trim());
      
      // Navigate to the Friends screen after successful name update
      navigation.navigate('Friends');
    } catch (error) {
      console.error('Error saving name:', error);
      Alert.alert('Error', error.message || 'Failed to save your name. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Confirm Your Name</Text>
      <Text style={styles.subtitle}>
        Please confirm or update your name so your friends can recognize you.
      </Text>
      
      <TextInput
        style={styles.input}
        placeholder="Your Name"
        placeholderTextColor="#999"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoFocus
      />
      
      <TouchableOpacity
        style={styles.saveButton}
        onPress={handleSaveName}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#000',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#AAA',
    textAlign: 'center',
    marginBottom: 30,
  },
  input: {
    height: 50,
    backgroundColor: '#333',
    borderRadius: 8,
    marginBottom: 20,
    paddingHorizontal: 15,
    color: '#FFF',
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default NameConfirmationScreen;