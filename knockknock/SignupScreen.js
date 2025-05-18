import React, { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { signUp, signInWithGoogle, configureGoogleSignIn } from './authService';
import { initializeUser } from './userUtils';
import DeviceInfo from 'react-native-device-info';
import messaging from '@react-native-firebase/messaging';

const SignupScreen = ({ navigation }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  
  useEffect(() => {
    // Configure Google Sign-In when component mounts
    configureGoogleSignIn();
  }, []);

  const handleSignup = async () => {
    if (!fullName || !email || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      // Get device ID and FCM token before signup
      const deviceId = await DeviceInfo.getUniqueId();
      const fcmToken = await messaging().getToken();

      // Sign up the user
      const { user, error } = await signUp(email, password);
      if (error) {
        Alert.alert('Error', error);
        return;
      }

      // Wait a bit to ensure auth state is ready
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Initialize user with all required data
      await initializeUser(email, deviceId, fcmToken, fullName);

      // Success message and navigation
      Alert.alert(
        'Success',
        'Account created successfully!',
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Login')
          }
        ]
      );
    } catch (error) {
      console.error('Signup error:', error);
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    try {
      setGoogleLoading(true);
      console.log('Starting Google Sign-Up process...');
      const result = await signInWithGoogle();
      console.log('Google Sign-Up result:', result);
      
      if (result.error) {
        Alert.alert('Error', result.error);
        setGoogleLoading(false);
        return;
      }
      
      const { user, additionalUserInfo } = result;
  
      // If this is a new user (first time sign in with Google)
      if (additionalUserInfo?.isNewUser) {
        try {
          // Get device ID and FCM token
          const deviceId = await DeviceInfo.getUniqueId();
          const fcmToken = await messaging().getToken();
  
          // Wait a bit to ensure auth state is ready
          await new Promise(resolve => setTimeout(resolve, 1500));
  
          // Initialize user with data from Google profile
          await initializeUser(
            user.email,
            deviceId,
            fcmToken,
            user.displayName || 'Google User'
          );
          
          // Navigate to the name confirmation page instead of showing an alert
          navigation.navigate('NameConfirmation', { 
            userId: user.uid, 
            initialName: user.displayName || '' 
          });
        } catch (initError) {
          console.error('Error initializing Google user:', initError);
          Alert.alert('Error', 'Failed to initialize user data');
          setGoogleLoading(false);
          return;
        }
      } else {
        // User already exists, just alert them
        Alert.alert(
          'Success',
          'Signed in with Google successfully!',
          [
            {
              text: 'OK',
              onPress: () => navigation.navigate('Login')
            }
          ]
        );
      }
      
      setGoogleLoading(false);
    } catch (error) {
      console.error('Google sign up error:', error);
      Alert.alert('Error', error.message);
      setGoogleLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Full Name"
        placeholderTextColor="#999"
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
      />
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#999"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#999"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm Password"
        placeholderTextColor="#999"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />
      <TouchableOpacity
        style={styles.signupButton}
        onPress={handleSignup}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>Sign Up</Text>
        )}
      </TouchableOpacity>
      
      {/* Divider with "or" text */}
      <View style={styles.dividerContainer}>
        <View style={styles.divider} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.divider} />
      </View>
      
      {/* Google Sign Up Button */}
      <TouchableOpacity
        style={styles.googleButton}
        onPress={handleGoogleSignUp}
        disabled={googleLoading}
      >
        {googleLoading ? (
          <ActivityIndicator color="#4285F4" />
        ) : (
          <View style={styles.googleButtonContent}>
            <Image 
              source={{ uri: 'https://developers.google.com/identity/images/g-logo.png' }} 
              style={styles.googleIcon} 
            />
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </View>
        )}
      </TouchableOpacity>
      
      <TouchableOpacity
        style={styles.loginButton}
        onPress={() => navigation.navigate('Login')}
      >
        <Text style={styles.loginText}>Already have an account? Login</Text>
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
  input: {
    height: 50,
    backgroundColor: '#333',
    borderRadius: 8,
    marginBottom: 15,
    paddingHorizontal: 15,
    color: '#FFF',
    fontSize: 16,
  },
  signupButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: '#555',
  },
  dividerText: {
    color: '#999',
    paddingHorizontal: 10,
    fontSize: 14,
  },
  googleButton: {
    backgroundColor: '#FFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 5,
    borderWidth: 1,
    borderColor: '#DDDDDD',
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIcon: {
    width: 24,
    height: 24,
    marginRight: 10,
  },
  googleButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  loginButton: {
    alignItems: 'center',
    marginTop: 20,
  },
  loginText: {
    color: '#4CAF50',
    fontSize: 14,
  },
});

export default SignupScreen;