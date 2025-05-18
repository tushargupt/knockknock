/**
 * @format
 */
import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import BackgroundService from 'react-native-background-actions';
import messaging from '@react-native-firebase/messaging';
import { backgroundCallHandler, callManager } from './backgroundService';
import firebase from '@react-native-firebase/app';
import { clearActiveCallData, clearCallState, getActiveCallData } from './callPersistence';
import { AuthProvider } from './AuthContext';
import Navigation from './Navigation';
import React from 'react';
import { setUserBusy } from './userUtils';
import DeviceInfo from 'react-native-device-info';

// Firebase configuration
const firebaseConfig = {

};

// Initialize Firebase if it hasn't been initialized yet
if (!firebase.apps.length) {
  try {
    firebase.initializeApp(firebaseConfig);
    console.log('Firebase initialized successfully');
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
}

// Check for stale call state on app start
const checkAndClearStaleCallState = async () => {
  try {
    const activeCallData = await getActiveCallData();
    if (activeCallData) {
      const timestamp = activeCallData.timestamp || 0;
      const now = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;
      
      // If call state is older than 5 minutes, it's stale
      if (now - timestamp > fiveMinutesInMs) {
        console.log('Found stale call state. Cleaning up...');
        await clearCallState();
        await clearActiveCallData();
        await setUserBusy(false);
        
        if (BackgroundService.isRunning()) {
          await BackgroundService.stop();
        }
      }
    }
  } catch (error) {
    console.error('Error checking stale call state:', error);
  }
};

// Run the check at startup
checkAndClearStaleCallState();

// Enhanced background message handler with better error handling and logging
messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('Received background message:', remoteMessage);
  
  try {
    // Handle incoming call

  } catch (error) {
    console.error('Error in background message handler:', error);
    // Try to clean up regardless of error
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error('Error in emergency cleanup:', cleanupError);
    }
  }

  return Promise.resolve();
});

// Centralized cleanup function to ensure consistent state reset
async function cleanup() {
  console.log('Performing background cleanup');
  try {
    // Reset call state in persistence
    await clearCallState();
    await clearActiveCallData();
    
    // Reset busy status
    await setUserBusy(false);
    
    // Stop background service
    if (BackgroundService.isRunning()) {
      await BackgroundService.stop();
    }
    
    // Call the manager's cleanup if available
    if (callManager) {
      await callManager.cleanup();
    }
    
    console.log('Background cleanup completed successfully');
  } catch (error) {
    console.error('Error in cleanup:', error);
    throw error; // Rethrow for handlers
  }
}

// Wrap the app with AuthProvider
const AppWrapper = () => (
  <AuthProvider>
    <Navigation />
  </AuthProvider>
);

AppRegistry.registerComponent(appName, () => AppWrapper);