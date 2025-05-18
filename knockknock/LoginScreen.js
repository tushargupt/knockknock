// LoginScreen.js
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
import { signIn, resetPassword, signInWithGoogle, configureGoogleSignIn } from './authService';
import { initializeUser } from './userUtils';
import DeviceInfo from 'react-native-device-info';
import messaging from '@react-native-firebase/messaging';

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    // Configure Google Sign-In when component mounts
    configureGoogleSignIn();
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    const { user, error } = await signIn(email, password);
    setLoading(false);

    if (error) {
      Alert.alert('Error', error);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setGoogleLoading(true);
      console.log('Starting Google Sign-In process...');
      const result = await signInWithGoogle();
      console.log('Google Sign-In result:', result);
      
      if (result.error) {
        Alert.alert('Error', result.error);
        setGoogleLoading(false);
        return;
      }
      
      const { user, additionalUserInfo } = result;

      // If this is a new user (first time sign in with Google), initialize their data
      if (additionalUserInfo?.isNewUser) {
        try {
          // Get device ID and FCM token
          const deviceId = await DeviceInfo.getUniqueId();
          const fcmToken = await messaging().getToken();

          // Wait a bit to ensure auth state is ready
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Initialize user with data from Google profile
          await initializeUser(
            user.email,
            deviceId,
            fcmToken,
            user.displayName || 'Google User'
          );
        } catch (initError) {
          console.error('Error initializing Google user:', initError);
          Alert.alert('Error', 'Failed to initialize user data');
        }
      }

      setGoogleLoading(false);
    } catch (error) {
      console.error('Google sign in error:', error);
      Alert.alert('Error', error.message);
      setGoogleLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    const { error } = await resetPassword(email);
    if (error) {
      Alert.alert('Error', error);
    } else {
      Alert.alert('Success', 'Password reset email sent');
    }
  };

  return (
    <View style={styles.container}>
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
      <TouchableOpacity
        style={styles.loginButton}
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>Login</Text>
        )}
      </TouchableOpacity>
      
      {/* Divider with "or" text */}
      <View style={styles.dividerContainer}>
        <View style={styles.divider} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.divider} />
      </View>
      
      {/* Google Sign In Button */}
      <TouchableOpacity
        style={styles.googleButton}
        onPress={handleGoogleSignIn}
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
            <Text style={styles.googleButtonText}>Sign in with Google</Text>
          </View>
        )}
      </TouchableOpacity>
      
      <TouchableOpacity
        style={styles.forgotButton}
        onPress={handleForgotPassword}
      >
        <Text style={styles.forgotText}>Forgot Password?</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.signupButton}
        onPress={() => navigation.navigate('Signup')}
      >
        <Text style={styles.signupText}>Don't have an account? Sign Up</Text>
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
  loginButton: {
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
  forgotButton: {
    alignItems: 'center',
    marginTop: 15,
  },
  forgotText: {
    color: '#4CAF50',
    fontSize: 14,
  },
  signupButton: {
    alignItems: 'center',
    marginTop: 20,
  },
  signupText: {
    color: '#4CAF50',
    fontSize: 14,
  },
});

export default LoginScreen;