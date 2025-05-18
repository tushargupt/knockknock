import React, { useEffect, useState, useRef } from 'react';
import {
  SafeAreaView,
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Text,
  TextInput,
  Platform,
  AppState,
  PermissionsAndroid,
  Alert,
  Modal,
  Vibration,
  ActivityIndicator,
  ScrollView,
  Easing,
  NativeModules
} from 'react-native';
import { RTCView } from 'react-native-webrtc';
import io from 'socket.io-client';
import { Device } from 'mediasoup-client';
import {
  mediaDevices,
  MediaStream,
  registerGlobals
} from 'react-native-webrtc';
import BackgroundService from 'react-native-background-actions';
import DeviceInfo from 'react-native-device-info';
import messaging from '@react-native-firebase/messaging';
import firebase from '@react-native-firebase/app';
import InCallManager from 'react-native-incall-manager';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from './AuthContext';
import { signOut } from './authService';
import { Share } from 'react-native';
import {
  saveCallState,
  loadCallState,
  clearCallState,
  CallState,
  getActiveCallData,
  clearActiveCallData
} from './callPersistence';
import { initializeUser, addFriend, checkDNDStatus, toggleDNDStatus, updateUserName, getFriends, removeFriend, getPendingFriendRequests, acceptFriendRequest, declineFriendRequest, checkSilenceMode, toggleSilenceMode, setUserBusy, checkAndDisableExpiredModes, getUserName } from './userUtils';
import FriendList from './screens/FriendList';
import database from '@react-native-firebase/database';
import auth from '@react-native-firebase/auth';
import { FriendRequestModal } from './components/FriendRequestModal';
import { View as GestureHandlerView } from 'react-native-gesture-handler';
import { getRemainingTime } from './utils/timeUtils';
import DurationSelectionModal from './components/DurationSelectionModal';
import { callManager } from './backgroundService';
const { MicrophoneServiceModule } = NativeModules;

// Register WebRTC globals
registerGlobals();

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


// Socket configuration
const socketConfig = {
  transports: ['websocket'],
  secure: true,
  withCredentials: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  pingTimeout: 30000,
  pingInterval: 10000,
};

// Background task options
const backgroundOptions = {
  taskName: 'AudioCall',
  taskTitle: 'Audio Call Active',
  taskDesc: 'Maintaining call connection',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#4CAF50',
  parameters: {
    delay: 5000,
  },
  linkingURI: 'yourapp://call', // Add this
  taskAutoStart: true,         // Add this
};

const VIBRATION_PATTERN = [0, 500, 1000]; // Vibrate for 500ms, pause for 1000ms, repeat

// Global socket instance
let globalSocket = null;

const App = () => {
  // State variables
  const { user } = useAuth();

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isInCall, setIsInCall] = useState(false);
  const [isCallInitiator, setIsCallInitiator] = useState(false);
  const [isBackgroundServiceRunning, setIsBackgroundServiceRunning] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [targetDeviceId, setTargetDeviceId] = useState('');
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [isPressing, setIsPressing] = useState(false);
  const [currentRoom, setcurrentRoom] = useState(false);
  const [isRestoringCall, setIsRestoringCall] = useState(false);
  const [isPTTActive, setIsPTTActive] = useState(false); // Track if user is pressing PTT
  const [remotePTTActive, setRemotePTTActive] = useState(false); // Track if remote user is pressing PTT
  const [isAudioEnabled, setIsAudioEnabled] = useState(true); // Track if local audio is enabled
  const [connectionMessage, setConnectionMessage] = useState('');
  const [isUserBlocked, setIsUserBlocked] = useState(false);
  const [isBlockedByFriend, setIsBlockedByFriend] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [friends, setFriends] = useState([]);
  const [selectedFriendForOptions, setSelectedFriendForOptions] = useState(null);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [friendRequests, setFriendRequests] = useState({});
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const [isSilenceModeEnabled, setIsSilenceModeEnabled] = useState(false);
  const [isSilenceModeLoading, setIsSilenceModeLoading] = useState(false);
  const [mutualViewers, setMutualViewers] = useState([]);
  const [showDurationModal, setShowDurationModal] = useState(false);
  const [modalMode, setModalMode] = useState(null); // 'silence' or 'dnd'
  const [silenceRemainingTime, setSilenceRemainingTime] = useState(0);
  const dndStatusCache = useRef({});
  const lastDNDCheckTimes = useRef({});
  const isMicServiceRunning = useRef(false);


  const [userName, setUserName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [showFriendModal, setShowFriendModal] = useState(false);
  const [friendId, setFriendId] = useState('');
  const [userUniqueId, setUserUniqueId] = useState('');
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [currentView, setCurrentView] = useState('call'); // 'call' or 'friends'

  // Add these new state variables
  const [isPTTLocked, setIsPTTLocked] = useState(false); // Remove this

  // Add this new state to track if we're in a press operation
  const [isButtonHeld, setIsButtonHeld] = useState(false);
  const buttonPressTimerRef = useRef(null);

  // Refs for WebRTC
  const deviceRef = useRef(null);
  const producerTransportRef = useRef(null);
  const audioProducerRef = useRef(null);
  const consumerTransportsRef = useRef([]);
  const consumingTransportsRef = useRef([]);
  const vibrationActive = useRef(false);
  const connectionTimeoutRef = useRef(null);
  const vibrationIntervalRef = useRef(null);
  const friendListRef = useRef(null);

  const getSocket = () => {
    if (!globalSocket) {
      globalSocket = io("wss://api.knockknock.social/", socketConfig);
      setupSocketListeners(globalSocket);
    }
    return globalSocket;
  };



  const setupSocketListeners = (socket) => {
    socket.on('connect', async () => {
      console.log('Connected to server:', socket.id);
      setSocketConnected(true);

      // Get device ID and register
      const deviceId = await DeviceInfo.getUniqueId();
      const fcmToken = await messaging().getToken();
      setCurrentDeviceId(deviceId);
      console.log(currentDeviceId)
      socket.emit('registerUser', {
        deviceId,
        fcmToken
      });
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setSocketConnected(false);
    });



    socket.on('call-started', async ({ roomName, callerSocketId, callerDeviceId }) => {
      console.log('Incoming call from:', callerSocketId);
      setCallStatus('Incoming call...');
      if (!isInCall) {
        handleIncomingCall(roomName, callerSocketId, callerDeviceId);
      }
    });

    // In App.js, update the call-ended event handler to ensure full UI reset

    socket.on('call-ended', async ({ roomName, reason }) => {
      console.log('Call ended event received for room:', roomName, 'Reason:', reason);

      // Force complete UI reset if call was ghosted
      if (reason === 'ghosted') {
        // Reset PTT button state
        resetPTTState();

        // Immediately reset call-related states
        setIsInCall(false);
        setIsCallInitiator(false);
        setCallStatus('');


        setIsPTTActive(false);
        setIsButtonHeld(false);

      } else if (reason === 'silence_mode') {
        Alert.alert(
          'Call Failed',
          'User has silence mode turned on and cannot receive calls'
        );
      } else if (reason === 'dnd') {
        Alert.alert(
          'Call Failed',
          'User has Do Not Disturb turned on'
        );
      } else if (reason === 'busy') {
        Alert.alert(
          'User Busy',
          'User is currently on another call'
        );
      }

      // Always perform cleanup to ensure proper state reset
      await cleanup();

      // Make sure to reset busy state
      await setUserBusy(false);
    });

    socket.on('call-rejected', async ({ roomName, reason }) => {
      console.log('Call rejected for room:', roomName, 'Reason:', reason);

      // Show appropriate message based on rejection reason
      if (reason === 'silence_mode') {
        Alert.alert(
          'Call Rejected',
          'User has silence mode turned on and cannot receive calls'
        );
      } else if (reason === 'dnd') {
        Alert.alert(
          'Call Rejected',
          'User has Do Not Disturb turned on'
        );
      } else if (reason === 'busy') {
        Alert.alert(
          'User Busy',
          'User is currently on another call'
        );
      } else {
        Alert.alert(
          'Call Rejected',
          'The user rejected your call'
        );
      }
      // Make sure to clean up
      await cleanup();
    });

    socket.on('call-error', async ({ error, roomName }) => {
      console.error('Call error:', error);
      Alert.alert('Call Failed', error || 'An error occurred while setting up the call');

      // Always make sure to reset busy state and clean up
      await setUserBusy(false);
      if (isInCall) {
        await cleanup();
      }
    });

    socket.on('ptt-state-change', ({ deviceId, isPressed }) => {
      console.log('Received remote PTT state change:', deviceId, isPressed);
      if (deviceId !== currentDeviceId) {
        setRemotePTTActive(isPressed);
      }
    });


    socket.on('new-producer', ({ producerId }) => {
      signalNewConsumerTransport(producerId);
    });

    socket.on('mutual-viewing', ({ friendDeviceId }) => {
      console.log(`Mutual viewing detected with: ${friendDeviceId}`);
      setMutualViewers(prev => {
        if (!prev.includes(friendDeviceId)) {
          return [...prev, friendDeviceId];
        }
        return prev;
      });
    });

    socket.on('mutual-viewing-ended', ({ friendDeviceId }) => {
      console.log(`Mutual viewing ended with: ${friendDeviceId}`);
      setMutualViewers(prev => prev.filter(id => id !== friendDeviceId));
    });

    socket.on('producer-closed', ({ remoteProducerId }) => {
      handleProducerClosed(remoteProducerId);
    });

    // In App.js - Update ghost-call socket event to ensure full UI reset

    socket.on('ghost-call', async () => {
      console.log('Call was ghosted - performing full UI reset');

      // Reset PTT button state first - this cancels any active PTT
      resetPTTState();

      // Force immediate UI reset by setting critical states 
      setIsInCall(false);
      setIsCallInitiator(false);
      setCallStatus('');
      setIsPTTLocked(false);
      setIsPTTActive(false);
      setRemotePTTActive(false);
      setIsButtonHeld(false);


      // Alert the caller that they've been ghosted
      Alert.alert(
        'Call Ended',
        'The person you called has ghosted the call22'
      );

      // Do full cleanup to reset all state
      await cleanup();
    });

  };

  useEffect(() => {
    const loadFriendsList = async () => {
      try {
        const friendsData = await getFriends();
        // Make sure we're converting the data correctly
        const friendsArray = friendsData ? Object.entries(friendsData).map(([id, data]) => ({
          id,
          ...data
        })) : [];
        setFriends(friendsArray);
      } catch (error) {
        console.error('Error loading friends:', error);
        setFriends([]); // Set to empty array on error
      }
    };

    loadFriendsList();
  }, []);

  useEffect(() => {
    // Only set up listeners if we have a valid selected friend
    if (!selectedFriend || !selectedFriend.id) return;

    console.log(`Setting up real-time status listeners for friend: ${selectedFriend.id}`);

    // Create references to the relevant database paths
    const silenceModeRef = database().ref(`users/${selectedFriend.id}/silenceMode/enabled`);
    const busyStatusRef = database().ref(`users/${selectedFriend.id}/callStatus/busy`);

    // For DND, we need to check if current user is in friend's DND list
    const currentUserId = auth().currentUser?.uid;
    const dndRef = database().ref(`users/${selectedFriend.id}/dndList/${currentUserId}/status`);

    // Listen for silence mode changes
    const onSilenceModeChange = (snapshot) => {
      const isSilent = snapshot.val() === true;
      console.log(`Friend ${selectedFriend.email} silence mode changed to: ${isSilent}`);

      // Update the selected friend's silence mode status
      setSelectedFriend(prevFriend => {
        if (prevFriend && prevFriend.id === selectedFriend.id) {
          return {
            ...prevFriend,
            isSilenceModeEnabled: isSilent
          };
        }
        return prevFriend;
      });
    };

    // Listen for DND changes
    const onDNDChange = (snapshot) => {
      const isDND = snapshot.val() === true;
      console.log(`Friend ${selectedFriend.email} DND status changed to: ${isDND}`);

      // Update the selected friend's DND status
      setSelectedFriend(prevFriend => {
        if (prevFriend && prevFriend.id === selectedFriend.id) {
          return {
            ...prevFriend,
            isBlockedByFriend: isDND
          };
        }
        return prevFriend;
      });
    };

    // Listen for busy status changes
    const onBusyStatusChange = (snapshot) => {
      const isBusy = snapshot.val() === true;
      console.log(`Friend ${selectedFriend.email} busy status changed to: ${isBusy}`);

      // Update the selected friend's busy status
      setSelectedFriend(prevFriend => {
        if (prevFriend && prevFriend.id === selectedFriend.id) {
          return {
            ...prevFriend,
            isBusy: isBusy
          };
        }
        return prevFriend;
      });
    };

    // Attach the listeners
    silenceModeRef.on('value', onSilenceModeChange);
    dndRef.on('value', onDNDChange);
    busyStatusRef.on('value', onBusyStatusChange);

    // Clean up listeners when component unmounts or selected friend changes
    return () => {
      console.log(`Removing status listeners for friend: ${selectedFriend.id}`);
      silenceModeRef.off('value', onSilenceModeChange);
      dndRef.off('value', onDNDChange);
      busyStatusRef.off('value', onBusyStatusChange);
    };
  }, [selectedFriend?.id]); // Dependency on friend ID ensures listeners update when friend changes


  // --- FUNCTION TO START THE MICROPHONE SERVICE ---
  const startMicrophoneForegroundService = async () => {
    // Only run on Android and if the module exists
    if (Platform.OS === 'android' && MicrophoneServiceModule && !isMicServiceRunning.current) {
      try {
        console.log('[App.js] Attempting to start MicrophoneService...');
        // Using await here assuming the native method returns a Promise
        const result = await MicrophoneServiceModule.startService();
        console.log('[App.js] MicrophoneService start result:', result);
        isMicServiceRunning.current = true;
      } catch (error) {
        console.error('[App.js] Failed to start MicrophoneService:', error);
        // Alert the user or handle the error appropriately
        Alert.alert('Service Error', `Failed to start microphone service: ${error.message || error}`);
      }
    } else {
      if (Platform.OS !== 'android') {
        console.log('[App.js] Mic service not started (Platform is not Android)');
      } else if (!MicrophoneServiceModule) {
        console.log('[App.js] Mic service not started (Module missing)');
      } else if (isMicServiceRunning.current) {
        console.log('[App.js] Mic service not started (Already running)');
      }
    }
  };

  // --- FUNCTION TO STOP THE MICROPHONE SERVICE ---
  // --- FUNCTION TO STOP THE MICROPHONE SERVICE ---
  const stopMicrophoneForegroundService = async () => {
    // Only run on Android and if the module exists and if we think it's running
    if (Platform.OS === 'android' && MicrophoneServiceModule && isMicServiceRunning.current) {
      try {
        console.log('[App.js] Attempting to stop MicrophoneService...');
        // Using await here assuming the native method returns a Promise
        const result = await MicrophoneServiceModule.stopService();
        console.log('[App.js] MicrophoneService stop result:', result);
        // Always set running to false after attempting to stop
        isMicServiceRunning.current = false;
      } catch (error) {
        console.error('[App.js] Failed to stop MicrophoneService:', error);
        // Optionally alert or handle error, but often unnecessary during cleanup
        // Reset running status even if stop fails
        isMicServiceRunning.current = false;
      }
    } else {
      console.log('[App.js] Mic service not stopped (Platform!=Android or module missing or not running)');
      // Ensure the flag is false if we didn't even try to stop it
      if (Platform.OS === 'android' && MicrophoneServiceModule) {
        isMicServiceRunning.current = false;
      }
    }
  };

  const handleCallConnected = () => {
    console.log('[App.js] Call considered connected.');
    // Update call status for UI if needed (already done in connectRecvTransport)
    // setCallStatus('Connected'); // Or similar state update

    // *** START THE MIC SERVICE ***
    if (AppState == 'active') {
      startMicrophoneForegroundService();
    }


    // *** START THE *OLD* BACKGROUND SERVICE (for Socket.IO) ***
    // Ensure 'startBackgroundService' refers to the one using react-native-background-actions
    startBackgroundService();

  };

  useEffect(() => {
    // If friend just became busy, show a visual indication
    if (selectedFriend?.isBusy) {
      // No longer need animations since buttonAnimatedValue is gone
      // Just vibrate to indicate busy status
      Vibration.vibrate(100);
    }
  }, [selectedFriend?.isBusy]);


  const pttStateRef = useRef({ isPTTActive: false, remotePTTActive: false });
  const callEndTimeoutRef = useRef(null);



  useEffect(() => {
    const handleFCMTokenRefresh = async () => {
      try {
        const token = await messaging().getToken();
        await updateFCMToken(token);
      } catch (error) {
        console.error('Error updating FCM token:', error);
      }
    };

    const unsubscribe = messaging().onTokenRefresh(handleFCMTokenRefresh);
    return () => unsubscribe();
  }, []);


  useEffect(() => {
    const checkFriendDNDStatus = async () => {
      if (selectedFriend) {
        try {
          const isDND = await checkDNDStatus(selectedFriend);
          setIsBlockedByFriend(isDND);
        } catch (error) {
          console.error('Error checking DND status:', error);
        }
      }
    };

    checkFriendDNDStatus();
  }, [selectedFriend]);

  useEffect(() => {
    const checkFriendRequests = async () => {
      try {
        const requests = await getPendingFriendRequests();
        console.log("pending requests", requests)
        setFriendRequests(requests);
        if (Object.keys(requests).length > 0) {
          setShowRequestsModal(true);
        }
      } catch (error) {
        console.error('Error checking friend requests:', error);
      }
    };

    checkFriendRequests();

    // Set up real-time listener for new friend requests
    const userId = auth().currentUser?.uid;
    if (userId) {
      const requestsRef = database().ref(`friendRequests/${userId}`);
      requestsRef.on('value', (snapshot) => {
        const requests = snapshot.val() || {};
        setFriendRequests(requests);
        if (Object.keys(requests).length > 0) {
          setShowRequestsModal(true);
        }
      });

      return () => requestsRef.off();
    }
  }, []);

  useEffect(() => {
    const initializeUserData = async () => {
      try {
        const deviceId = await DeviceInfo.getUniqueId();
        const fcmToken = await messaging().getToken();
        const uniqueId = await initializeUser(user.email, deviceId, fcmToken); // Pass FCM token
        setUserUniqueId(uniqueId);
        setCurrentDeviceId(deviceId);
      } catch (error) {
        console.error('Error initializing user:', error);
      }
    };

    if (user) {
      initializeUserData();
    }
  }, [user]);

  useEffect(() => {
    const checkUserSilenceMode = async () => {
      try {
        const userId = auth().currentUser.uid;
        const isSilent = await checkSilenceMode(userId);
        setIsSilenceModeEnabled(isSilent);
      } catch (error) {
        console.error('Error checking silence mode:', error);
      }
    };

    checkUserSilenceMode();
  }, []);

  const handleSilenceModeToggle = async () => {
    try {
      if (isSilenceModeEnabled) {
        // If already enabled, turn it off immediately
        setIsSilenceModeLoading(true);
        const newStatus = await toggleSilenceMode();
        setIsSilenceModeEnabled(newStatus);
        setSilenceRemainingTime(0);
        setIsSilenceModeLoading(false);
      } else {
        // If turning on, show duration selection modal
        setModalMode('silence');
        setShowDurationModal(true);
      }
    } catch (error) {
      console.error('Error toggling silence mode:', error);
      setIsSilenceModeLoading(false);
    }
  };

  const handleDurationSelected = async (duration) => {
    try {
      setShowDurationModal(false);

      if (modalMode === 'silence') {
        setIsSilenceModeLoading(true);
        const newStatus = await toggleSilenceMode(duration);
        setIsSilenceModeEnabled(newStatus);

        if (duration > 0) {
          setSilenceRemainingTime(duration);
        } else {
          setSilenceRemainingTime(0);
        }

        setIsSilenceModeLoading(false);
      }
    } catch (error) {
      console.error('Error setting mode with duration:', error);
      setIsSilenceModeLoading(false);
    }
  };


  useEffect(() => {
    const checkExpiredModes = async () => {
      await checkAndDisableExpiredModes();

      // Refresh silence mode status
      try {
        const userId = auth().currentUser?.uid;
        if (userId) {
          const snapshot = await database()
            .ref(`users/${userId}/silenceMode`)
            .once('value');

          const silenceMode = snapshot.val();

          setIsSilenceModeEnabled(silenceMode?.enabled || false);

          if (silenceMode?.enabled && silenceMode.expiresAt) {
            const remaining = getRemainingTime(silenceMode.expiresAt);
            setSilenceRemainingTime(remaining);
          } else {
            setSilenceRemainingTime(0);
          }
        }
      } catch (error) {
        console.error('Error refreshing silence mode status:', error);
      }
    };

    // Initial check
    checkExpiredModes();

    // Set interval to check every minute
    const interval = setInterval(checkExpiredModes, 60000);
    return () => clearInterval(interval);
  }, []);



  useEffect(() => {
    if (selectedFriend) {
      setTargetDeviceId(selectedFriend.deviceId);
    }
  }, [selectedFriend]);

  const shareUniqueId = async () => {
    try {
      await Share.share({
        message: `Add me on KnockKnock! My ID is: ${userUniqueId}`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };


  const handleAddFriend = async () => {
    if (!friendId) {
      Alert.alert('Error', 'Please enter a friend ID');
      return;
    }

    try {
      await addFriend(friendId);
      Alert.alert('Success', 'Friend added successfully');
      setFriendId('');
      setShowFriendModal(false);
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  // Add this new function to App.js to reset the PTT state
  const resetPTTState = () => {
    console.log('Resetting PTT state');

    if (isPTTActive) {
      setIsPTTActive(false);
      setIsAudioEnabled(false);
      stopVibration();
    }

    setIsButtonHeld(false);

    if (buttonPressTimerRef.current) {
      clearTimeout(buttonPressTimerRef.current);
      buttonPressTimerRef.current = null;
    }

    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }

    const socket = getSocket();
    socket.emit('ptt-state-change', {
      deviceId: currentDeviceId,
      isPressed: false,
      roomName: currentRoom
    });
  };




  const handleLogout = async () => {
    try {
      // First clean up any active calls
      if (isInCall) {
        await cleanup();
      }

      // Then sign out
      const { error } = await signOut();
      if (error) {
        Alert.alert('Error', error);
      }
    } catch (error) {
      console.error('Error during logout:', error);
      Alert.alert('Error', 'Failed to logout');
    }
  };


  const handleIncomingCall = async (roomName, callerSocketId, callerDeviceId) => { // Accepts both IDs
    try {

      await setUserBusy(true);
      if (!callerDeviceId) {
        console.error(`Incoming call for room ${roomName} received, but callerDeviceId is missing! Cannot identify caller accurately.`);
        return; // Abort if the reliable identifier is missing.
      }
      if (!callerSocketId) {
        console.warn(`Incoming call for room ${roomName} received without callerSocketId.`);
      }

      console.log(`Handling incoming call for room: ${roomName}, from callerSocketId: ${callerSocketId}, callerDeviceId: ${callerDeviceId}`);
      // await setUserBusy(true);
      setcurrentRoom(roomName);

      const stream = await getLocalStream();
      if (!stream) { /* ... handle stream error ... */ return; }

      // --- Friend Lookup using callerDeviceId ---
      let identifiedCallerFriend = null;
      const actualTargetDeviceId = callerDeviceId; // Use the reliable deviceId

      try {
        const friendsData = await getFriends();
        if (friendsData) {
          const friendEntry = Object.entries(friendsData).find(([id, data]) => data.deviceId === callerDeviceId);
          if (friendEntry) {
            identifiedCallerFriend = { id: friendEntry[0], ...friendEntry[1] };
            console.log(`SUCCESS: Identified caller friend: ${identifiedCallerFriend.fullName || identifiedCallerFriend.email}`);
            setSelectedFriend(identifiedCallerFriend);
          } else {
            console.warn(`Incoming call from deviceId ${callerDeviceId}, but they are not in the friends list.`);
            setSelectedFriend(null);
          }
        } else { /* ... handle no friends data ... */ setSelectedFriend(null); }
      } catch (error) { /* ... handle lookup error ... */ setSelectedFriend(null); }
      // --- End Friend Lookup ---

      if (!actualTargetDeviceId) { /* ... handle missing target ID error ... */ return; }

      setIsInCall(true);
      setIsCallInitiator(false);
      setCallStatus('Incoming call...');
      setTargetDeviceId(actualTargetDeviceId); // <-- Use callerDeviceId for FriendList

      await saveCallState({
                state: CallState.IN_CALL,
                roomName,
                targetDeviceId: actualTargetDeviceId,
                isCallInitiator: false
              });
      // await saveCallState({ /* ... save state ... */ targetDeviceId: actualTargetDeviceId });
      joinRoom(stream, roomName);
      startBackgroundService();

    } catch (error) { /* ... handle general error ... */
      console.error('Error handling incoming call:', error);
          setCallStatus('Failed to join call');
          await setUserBusy(false);
     }
  };


  // const handleIncomingCall = async (roomName, callerSocketId, callerDeviceId) => {
  //   try {
  //     console.log('Handling incoming call for room:', roomName, 'from:', callerSocketId);
  //     await setUserBusy(true);

  //     // Store original caller socket ID
  //     let actualTargetDeviceId = callerSocketId;
  //     let identifiedCallerFriend = null;

  //     if (!callerDeviceId) {
  //       console.error(`Incoming call for room ${roomName} received, but callerDeviceId is missing! Cannot identify caller accurately.`);
  //       return; // Abort if the reliable identifier is missing.
  //     }
  //     if (!callerSocketId) {
  //       console.warn(`Incoming call for room ${roomName} received without callerSocketId.`);
  //     }

  //     console.log(`Handling incoming call for room: ${roomName}, from callerSocketId: ${callerSocketId}, callerDeviceId: ${callerDeviceId}`);


  //     setcurrentRoom(roomName);

  //     // Get local media stream
  //     const stream = await getLocalStream();
  //     if (stream) {
  //       setIsInCall(true);
  //       setIsCallInitiator(false); // Explicitly mark as not the initiator
  //       setCallStatus('Incoming call...');

  //       // For incoming calls, start with audio enabled
  //       setIsAudioEnabled(true);
  //       stream.getAudioTracks().forEach(track => {
  //         track.enabled = true;
  //       });

  //       // Find the actual friend who's calling to highlight their card
  //       try {
  //         const friendsData = await getFriends();
  //         if (friendsData) {
  //           // First look for the exact device ID match
  //           let callerFriend = null;
  //           const entries = Object.entries(friendsData);

  //           const friendEntry = Object.entries(friendsData).find(([id, data]) => data.deviceId === callerDeviceId);
  //           if (friendEntry) {
  //             identifiedCallerFriend = { id: friendEntry[0], ...friendEntry[1] };
  //             console.log(`SUCCESS: Identified caller friend: ${identifiedCallerFriend.fullName || identifiedCallerFriend.email}`);
  //             setSelectedFriend(identifiedCallerFriend);
  //           } else {
  //             console.warn(`Incoming call from deviceId ${callerDeviceId}, but they are not in the friends list.`);
  //             setSelectedFriend(null);
  //           }

  //           // Try to match by socket ID/device ID
  //           for (const [id, data] of entries) {
  //             if (data.deviceId === callerSocketId) {
  //               console.log('Found exact device ID match for caller:', data.email || data.fullName);
  //               callerFriend = { id, ...data };
  //               actualTargetDeviceId = data.deviceId;
  //               break;
  //             }
  //           }

  //           // If not found by device ID, try finding by busy status
  //           if (!identifiedCallerFriend) {
  //             for (const [id, data] of friendEntry) {
  //               const busyCheck = await database()
  //                 .ref(`users/${id}/callStatus/busy`)
  //                 .once('value');

  //               if (busyCheck.val() === true) {
  //                 console.log('Found likely caller by busy status:', data.email || data.fullName);
  //                 identifiedCallerFriend = { id, ...data };
  //                 actualTargetDeviceId = data.deviceId;
  //                 break;
  //               }
  //             }
  //           }

  //           // Directly set the selected friend
  //           if (callerFriend) {
  //             console.log('Setting selected friend for incoming call:', callerFriend.email);
  //             setSelectedFriend(callerFriend);
  //           }
  //         }
  //       } catch (error) {
  //         console.error('Error finding caller from friend list:', error);
  //       }

  //       // Set the target device ID once we've determined the best match
  //       setTargetDeviceId(actualTargetDeviceId);

  //       // Save call state with the correct device ID
  //       await saveCallState({
  //         state: CallState.IN_CALL,
  //         roomName,
  //         targetDeviceId: actualTargetDeviceId,
  //         isCallInitiator: false
  //       });

  //       // Join the room and create send transport
  //       joinRoom(stream, roomName);
  //       startBackgroundService();
  //     }
  //   } catch (error) {
  //     console.error('Error handling incoming call:', error);
  //     setCallStatus('Failed to join call');
  //     await setUserBusy(false);
  //   }
  // };


  const getLocalStream = async () => {
    try {
      console.log('Getting local media stream');

      // Request audio permission first
      if (Platform.OS === 'android') {
        console.log('Requesting Android audio permission');
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          console.error('Audio permission denied');
          throw new Error('Audio permission denied');
        }
        console.log('Audio permission granted');
      }

      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 2,
        },
        video: false
      };

      console.log('Requesting media with constraints:', JSON.stringify(constraints));
      const stream = await mediaDevices.getUserMedia(constraints);

      console.log('Got local stream with tracks:', stream.getTracks().length);

      // Enable tracks explicitly
      stream.getAudioTracks().forEach(track => {
        track.enabled = true;
        console.log('Enabled audio track:', track.id);
      });

      stream.onaddtrack = (event) => {
        console.log('Track added to local stream:', event.track.kind);
        if (event.track.kind === 'audio') {
          console.log('Audio track enabled:', event.track.enabled);
          event.track.onended = () => console.log('Audio track ended');
          event.track.onmute = () => console.log('Audio track muted');
          event.track.onunmute = () => console.log('Audio track unmuted');
        }
      };

      setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('Error getting local media:', error);
      Alert.alert('Media Error', 'Failed to access microphone. Please check app permissions.');
      return null;
    }
  };

  // Updates to handleGhostCall function for immediate UI feedback

  const handleGhostCall = async (friend) => {
    try {
      console.log('Handling ghost call for friend:', friend.email || friend.fullName);

      // Immediately update UI states to ensure responsive feedback
      setIsInCall(false);
      setIsCallInitiator(false);
      setIsPTTActive(false);
      setRemotePTTActive(false);

      // Get the current user's name for the notification
      let userName = '';
      try {
        if (user?.uid) {
          const userSnapshot = await database()
            .ref(`users/${user.uid}`)
            .once('value');

          const userData = userSnapshot.val();
          if (userData?.fullName) {
            userName = userData.fullName;
          }
        }

        if (!userName) {
          userName = user?.displayName || user?.email || "User";
        }
      } catch (error) {
        console.error('Error getting user name:', error);
        userName = user?.displayName || user?.email || "User";
      }

      // First send ghost-call to reset PTT
      const socket = getSocket();
      socket.emit('ghost-call', {
        targetDeviceId: friend.deviceId,
        roomName: currentRoom,
        fcmToken: friend.fcmToken
      });

      // Then end the call with ghosted reason
      socket.emit('endCall', {
        targetDeviceId: friend.deviceId,
        roomName: currentRoom,
        fcmToken: friend.fcmToken,
        callerName: userName,
        reason: 'ghosted'
      });

      // Start cleanup immediately instead of delaying
      endCall();
    } catch (error) {
      console.error('Error in ghost call handling:', error);

      // Still try to reset UI and end call even if there was an error
      setIsInCall(false);
      setIsCallInitiator(false);
      setIsPTTActive(false);
      setIsPTTLocked(false);

      try {
        endCall();
      } catch (endCallError) {
        console.error('Error ending call after ghost error:', endCallError);
      }
    }
  };

  const joinRoom = (stream, roomName) => {
    console.log('Joining room:', roomName);
    const socket = getSocket();
    socket.emit('joinRoom', { roomName }, async (data) => {
      if (data.error) {
        console.error('Error joining room:', data.error);
        return;
      }

      try {
        console.log('Got RTP capabilities, creating device...');
        deviceRef.current = new Device();
        await deviceRef.current.load({ routerRtpCapabilities: data.rtpCapabilities });

        // Create send transport first
        console.log('Creating send transport...');
        await createSendTransport(stream);

        // Then handle existing producers if any
        if (data.producersExist) {
          console.log('Existing producers found, getting producers...');
          getProducers();
        }

        setCallStatus('Connected');
      } catch (error) {
        console.error('Error in join room flow:', error);
        setCallStatus('Connection failed');
      }
    });
  };


  const getProducers = () => {
    const socket = getSocket();
    socket.emit('getProducers', producerIds => {
      console.log('Got producers:', producerIds);
      producerIds.forEach(producerId => {
        signalNewConsumerTransport(producerId);
      });
    });
  };

  const createDevice = async (rtpCapabilities, stream, producersExist) => {
    try {
      console.log('Creating device. Producers exist:', producersExist);
      deviceRef.current = new Device();
      await deviceRef.current.load({ routerRtpCapabilities: rtpCapabilities });
      await createSendTransport(stream);

      // Only get producers if they exist
      if (producersExist) {
        console.log('Getting existing producers');
        getProducers();
      }
    } catch (error) {
      console.error('Error creating device:', error);
    }
  };


  const createSendTransport = async (stream) => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('createWebRtcTransport', { consumer: false }, async ({ params }) => {
        if (params.error) {
          console.error('Send transport create error:', params.error);
          reject(params.error);
          return;
        }

        try {
          console.log('Creating send transport with params:', params.id);
          producerTransportRef.current = deviceRef.current.createSendTransport(params);

          // Handle transport connection
          producerTransportRef.current.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
              await socket.emit('transport-connect', {
                transportId: params.id,
                dtlsParameters,
              });
              callback();
            } catch (error) {
              errback(error);
            }
          });

          // Handle transport production
          producerTransportRef.current.on('produce', async (parameters, callback, errback) => {
            try {
              console.log('Producing with parameters:', parameters.kind);
              await socket.emit('transport-produce', {
                transportId: params.id,
                kind: parameters.kind,
                rtpParameters: parameters.rtpParameters,
                appData: parameters.appData,
              }, ({ id, error }) => {
                if (error) {
                  errback(error);
                  return;
                }
                callback({ id });
              });
            } catch (error) {
              errback(error);
            }
          });

          // Connect the transport
          await connectSendTransport(stream);
          console.log('Send transport created and connected successfully');
          resolve();
        } catch (error) {
          console.error('Error in createSendTransport:', error);
          reject(error);
        }
      });
    });
  };

  // In connectSendTransport
  const connectSendTransport = async (stream) => {
    if (!producerTransportRef.current) {
      console.error('No producer transport available');
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      try {
        console.log('Creating audio producer');
        audioProducerRef.current = await producerTransportRef.current.produce({
          track: audioTrack,
          codecOptions: {
            opusStereo: true,
            opusDtx: true,
            opusFec: true,
            opusNack: true,
          }
        });

        console.log('Audio producer created:', audioProducerRef.current.id);

        audioProducerRef.current.on('transportclose', () => {
          console.log('Producer transport closed');
        });

        audioProducerRef.current.on('trackended', () => {
          console.log('Producer track ended');
        });
      } catch (error) {
        console.error('Error creating audio producer:', error);
      }
    } else {
      console.error('No audio track available in stream');
    }
  };

  // In consumer's ontrack handler


  const signalNewConsumerTransport = async (remoteProducerId) => {
    // Initialize the array if it doesn't exist
    if (!consumingTransportsRef.current) {
      consumingTransportsRef.current = [];
    }

    if (consumingTransportsRef.current.includes(remoteProducerId)) {
      console.log('Already consuming this producer:', remoteProducerId);
      return;
    }

    console.log('Signaling new consumer transport for producer:', remoteProducerId);
    consumingTransportsRef.current.push(remoteProducerId);

    const socket = getSocket();
    await socket.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
      if (params.error) {
        console.error('Transport create error:', params.error);
        return;
      }

      let consumerTransport;
      try {
        consumerTransport = deviceRef.current.createRecvTransport(params);
      } catch (error) {
        console.error('Error creating consumer transport:', error);
        return;
      }

      consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await socket.emit('transport-recv-connect', {
            transportId: params.id,
            dtlsParameters,
            serverConsumerTransportId: params.id,
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      connectRecvTransport(consumerTransport, remoteProducerId, params.id);
    });
  };

  const startContinuousVibration = () => {
    vibrationActive.current = true;

    // Stop any existing vibration first to avoid multiple patterns
    Vibration.cancel();

    // Start vibration immediately
    Vibration.vibrate(VIBRATION_PATTERN, true);

    // Set up an interval to check if vibration should still be active
    const vibrationInterval = setInterval(() => {
      if (!vibrationActive.current || remoteStream) {
        // If vibration should no longer be active or remote stream exists
        Vibration.cancel();
        clearInterval(vibrationInterval);
        console.log('Vibration stopped due to condition change');
      }
    }, 1000); // Check every second

    // Store the interval ID for cleanup
    vibrationIntervalRef.current = vibrationInterval;
  };



  const stopVibration = () => {
    console.log('Explicitly stopping vibration');
    vibrationActive.current = false;
    Vibration.cancel();

    // Clear the interval if it exists
    if (vibrationIntervalRef.current) {
      clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
  };


  useEffect(() => {
    if (remoteStream) {
      console.log('Remote stream detected - stopping vibration');
      stopVibration();
      setConnectionMessage('');

      // Clear the timeout if it exists
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
    }
  }, [remoteStream]);


  const setupAudioSession = () => {
    try {
      InCallManager.start({ media: 'audio' });
      InCallManager.stopProximitySensor()
      InCallManager.setSpeakerphoneOn(true);
      InCallManager.setKeepScreenOn(true);
      console.log('Audio session initialized successfully');
    } catch (error) {
      console.error('Error setting up audio session:', error);
    }
  };


  // Update connectRecvTransport for better error handling
  const connectRecvTransport = async (consumerTransport, remoteProducerId, serverConsumerTransportId) => {
    const socket = getSocket();
    try {
      console.log('Connecting receive transport for producer:', remoteProducerId);

      await socket.emit('consume', {
        rtpCapabilities: deviceRef.current.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      }, async ({ params }) => {
        if (params.error) {
          console.error('Cannot consume:', params.error);
          return;
        }

        try {
          console.log('Creating consumer for kind:', params.kind);
          const consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters
          });

        } catch (error) {
          console.error('Error in consumer setup:', error);
          // Handle consumer setup error (e.g., show message, cleanup)
          setCallStatus('Connection failed');
          await cleanup(); // Perform cleanup if consumer setup fails
        }
      });
    } catch (error) {
      console.error('Error in connectRecvTransport (emit consume failed):', error);
      setCallStatus('Connection failed');
      await cleanup(); // Perform cleanup if emitting consume fails
    }
  };

  const handleProducerClosed = (remoteProducerId) => {
    const producerToClose = consumerTransportsRef.current.find(
      transportData => transportData.producerId === remoteProducerId
    );

    if (producerToClose) {
      producerToClose.consumerTransport.close();
      producerToClose.consumer.close();

      consumerTransportsRef.current = consumerTransportsRef.current.filter(
        transportData => transportData.producerId !== remoteProducerId
      );

      setRemoteStream(null);
    }
  };


  const checkAndResetStaleBusyState = async () => {
    try {
      const userId = auth().currentUser?.uid;
      if (!userId) return;

      const busyRef = database().ref(`users/${userId}/callStatus`);
      const busySnapshot = await busyRef.once('value');

      if (busySnapshot.val()?.busy === true) {
        const timestamp = busySnapshot.val()?.updatedAt || 0;
        const now = Date.now();

        // If busy state is older than 1 minute, it's stale
        if (now - timestamp > 60000) {
          console.log('Found stale busy state, resetting');
          await setUserBusy(false);
        }
      }
    } catch (error) {
      console.error('Error checking stale busy state:', error);
    }
  };



  const endCall = async () => {
    console.log('Initiating endCall sequence...'); // Added for clarity

    // Reset busy status early
    try {
      await setUserBusy(false);
      console.log('Reset busy status during endCall');
    } catch (busyError) {
      console.error('Error resetting busy status in endCall:', busyError);
      // Continue cleanup even if this fails
    }

    try {
      // Get the current user's full name from Firebase
      let currentUserName = '';
      try {
        // First try to get from the database
        if (user?.uid) {
          const userSnapshot = await database()
            .ref(`users/${user.uid}`)
            .once('value');

          const userData = userSnapshot.val();
          if (userData?.fullName) {
            currentUserName = userData.fullName;
            console.log(`[endCall] Using full name from database: ${currentUserName}`);
          }
        }

        // If no name found in database, fall back to other sources
        if (!currentUserName) {
          currentUserName = user?.displayName || user?.email || "User";
          console.log(`[endCall] Using fallback name: ${currentUserName}`);
        }
      } catch (error) {
        console.error('[endCall] Error getting user name:', error);
        currentUserName = user?.displayName || user?.email || "User"; // Fallback name
      }

      // *** MODIFICATION START ***
      // Always attempt to send the endCall notification if a friend is selected and has a token.
      // The check for isCallInitiator or !remotePTTActive has been removed.
      console.log(`[endCall] Preparing to send endCall event. Selected Friend: ${selectedFriend?.id}, Token Exists: ${!!selectedFriend?.fcmToken}`);

      if (selectedFriend && selectedFriend.fcmToken) {
        console.log(`[endCall] Sending endCall event to ${selectedFriend.deviceId} (Name: ${selectedFriend})`);
        const socket = getSocket();
        // Ensure socket is connected before emitting
        if (socket && socket.connected) {
          socket.emit('endCall', {
            targetDeviceId: selectedFriend.deviceId,
            roomName: currentRoom,
            fcmToken: selectedFriend.fcmToken,
            callerName: currentUserName
            // Optionally add a reason if needed, e.g., reason: 'user_hangup'
          });
          console.log('[endCall] endCall event emitted.');
        } else {
          console.warn('[endCall] Socket not connected, cannot emit endCall event.');
        }

      } else {
        // Log why notification wasn't sent
        if (!selectedFriend) {
          console.warn('[endCall] Cannot send endCall notification: No selected friend.');
        } else if (!selectedFriend.fcmToken) {
          console.warn(`[endCall] Cannot send endCall notification: Friend ${selectedFriend.deviceId} has no FCM token.`);
        }
      }
      // *** MODIFICATION END ***

    } catch (error) {
      // Log errors specifically related to preparing/sending the notification
      console.error('[endCall] Error during notification preparation/sending block:', error);
    }

    // Perform cleanup regardless of notification success/failure
    // cleanup() also resets busy state, but doing it earlier helps prevent race conditions.
    await cleanup();
     if (callManager) {
      console.log("cleaning up backgriund")
          await callManager.cleanup();
        }
    // Explicitly reset states after cleanup, ensuring UI is reset
    // Note: cleanup() already does this, but this is an extra safeguard
    setIsInCall(false);
    setIsCallInitiator(false);
    setCallStatus('');
    // stopBackgroundService(); // Should be handled by cleanup()
    await clearCallState();
    await clearActiveCallData();

    console.log('[endCall] End call sequence finished.');
  };

  const getUserFullName = async () => {
    try {
      if (!user || !user.uid) return null;

      const userSnapshot = await database()
        .ref(`users/${user.uid}`)
        .once('value');

      const userData = userSnapshot.val();
      return userData?.fullName || null;
    } catch (error) {
      console.error('Error getting user name:', error);
      return null;
    }
  };


  useEffect(() => {
    const restoreCallState = async () => {
      try {
        const savedState = await loadCallState();
        const activeCallData = await getActiveCallData();

        if (savedState && savedState.state === CallState.IN_CALL && activeCallData) {
          console.log('Restoring call state:', savedState);
          console.log('Active call data:', activeCallData);

          setIsRestoringCall(true);
          setTargetDeviceId(savedState.targetDeviceId);
          setIsCallInitiator(savedState.isCallInitiator);
          setIsInCall(true);
          setCallStatus('Reconnecting to call...');
          startMicrophoneForegroundService();
          setIsAudioEnabled(true);
          // Assume remote PTT is active when restoring an existing call
          setRemotePTTActive(true);  // Add this line
          setIsRestoringCall(false);

        }
      } catch (error) {
        console.error('Error restoring call state:', error);
        setIsRestoringCall(false);
      }
    };

    restoreCallState();
  }, []);

  // Update the cleanup function in App.js to be more comprehensive

  // REPLACE the cleanup function with this improved version:
  // REPLACE the cleanup function with this improved version:
  const cleanup = async () => {
    console.log('Starting cleanup...');

    // *** STOP THE MIC SERVICE FIRST ***
    // Ensures the mic foreground notification is removed promptly
    await stopMicrophoneForegroundService();
    await BackgroundService.stop()
    // *** STOP THE *OLD* BACKGROUND SERVICE (Socket.IO) ***
    // Check the state associated with the react-native-background-actions service


    try {
      // Cancel any active vibration first
      stopVibration();

      // Clear any pending timeouts
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      if (buttonPressTimerRef.current) {
        clearTimeout(buttonPressTimerRef.current);
        buttonPressTimerRef.current = null;
      }

      if (callEndTimeoutRef.current) {
        clearTimeout(callEndTimeoutRef.current);
        callEndTimeoutRef.current = null;
      }

      // Clear connection message
      setConnectionMessage('');

      // Stop audio session
      console.log('Stopping InCallManager...');
      InCallManager.stop();
      InCallManager.setKeepScreenOn(false);

      // Stop all active tracks
      if (localStream) {
        console.log('Stopping local tracks');
        localStream.getTracks().forEach(track => {
          track.stop();
        });
        // Don't remove tracks here, just stop them. Setting stream to null handles removal.
      }

      if (remoteStream) {
        console.log('Stopping remote tracks');
        remoteStream.getTracks().forEach(track => {
          track.stop();
        });
        // Don't remove tracks here, just stop them. Setting stream to null handles removal.
      }

      // Clean up WebRTC resources
      if (audioProducerRef.current) {
        console.log('Closing audio producer');
        audioProducerRef.current.close();
        audioProducerRef.current = null; // Clear ref
      }

      if (producerTransportRef.current) {
        console.log('Closing producer transport');
        producerTransportRef.current.close();
        producerTransportRef.current = null; // Clear ref
      }

      // Close consumer transports and consumers
      if (Array.isArray(consumerTransportsRef.current)) {
        console.log(`Closing ${consumerTransportsRef.current.length} consumer transports...`);
        consumerTransportsRef.current.forEach(({ consumerTransport, consumer }) => {
          try {
            if (consumer && !consumer.closed) consumer.close();
          } catch (e) { console.error("Error closing consumer:", e); }
          try {
            if (consumerTransport && !consumerTransport.closed) consumerTransport.close();
          } catch (e) { console.error("Error closing consumer transport:", e); }
        });
        consumerTransportsRef.current = []; // Clear ref array
      }

      // Clear Mediasoup device if needed (though often not necessary to explicitly close)
      // if (deviceRef.current) {
      //     // deviceRef.current.close(); // Mediasoup-client device doesn't have a close method
      //     deviceRef.current = null;
      // }


      if (vibrationIntervalRef.current) {
        clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = null;
      }

      // Clear persisted call state
      await clearCallState();
      await clearActiveCallData();

      // Reset all UI state immediately
      console.log('Resetting UI state...');
      setLocalStream(null);
      setRemoteStream(null);
      // consumerTransportsRef.current = []; // Already cleared above
      // audioProducerRef.current = null; // Already cleared above
      // producerTransportRef.current = null; // Already cleared above
      setIsInCall(false);
      setIsCallInitiator(false);
      setCallStatus('');
      setcurrentRoom(false); // Use false or null consistently
      setIsPTTActive(false);
      setRemotePTTActive(false);
      setIsAudioEnabled(false); // Reset mute state
      setIsRestoringCall(false);
      // setIsPTTLocked(false); // Remove if PTT lock is removed
      setIsButtonHeld(false);
      // setSelectedFriend(null); // Optional: Deselect friend on call end? Decide based on UX.

      // Reset busy status LAST, after all other resources are cleaned up
      // This prevents race conditions where new calls might come in during cleanup
      try {
        await setUserBusy(false);
        console.log('Reset busy status after cleanup completed');
      } catch (busyError) {
        console.error('Error resetting busy status:', busyError);
      }

      console.log('Cleanup completed successfully');

    } catch (error) {
      console.error('Error during main cleanup block:', error);

      // Still reset critical UI states even if cleanup fails
      setIsInCall(false);
      setIsCallInitiator(false);
      setIsPTTActive(false);
      // setIsPTTLocked(false);
      setRemotePTTActive(false);
      setIsButtonHeld(false);
      setcurrentRoom(false);
      setLocalStream(null); // Ensure streams are nulled
      setRemoteStream(null);

      // Even if cleanup fails, make sure to reset busy status as a final failsafe
      try {
        await setUserBusy(false);
        console.warn('Reset busy status after cleanup error.');
      } catch (e) {
        console.error('Final attempt to reset busy status failed after error:', e);
      }
    }
    // Ensure the mic service running flag is false after cleanup attempt
    isMicServiceRunning.current = false;
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
      setSettingsModalVisible(false);
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setSavingName(false);
    }
  };

  const backgroundTask = async () => {
    await new Promise(async () => {
      const checkConnection = () => {
        const socket = getSocket();
        if (socket && !socket.connected) {
          socket.connect();
        }
      };

      setInterval(checkConnection, 5000);
    });
  };

  const startBackgroundService = async () => {
    if (!isBackgroundServiceRunning) {
      try {
        await BackgroundService.start(backgroundTask, backgroundOptions);
        setIsBackgroundServiceRunning(true);
      } catch (error) {
        console.error('Failed to start background service:', error);
      }
    }
  };

  const stopBackgroundService = async () => {
    if (isBackgroundServiceRunning) {
      try {
        await BackgroundService.stop();
        setIsBackgroundServiceRunning(false);
      } catch (error) {
        console.error('Failed to stop background service:', error);
      }
    }
  };

  const handleUnfriend = async (friend) => {
    try {
      Alert.alert(
        'Remove Friend',
        'Are you sure you want to remove this friend?',
        [
          {
            text: 'Cancel',
            style: 'cancel'
          },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                await removeFriend(friend.id);
                // Refresh friends list
                const updatedFriends = friends.filter(f => f.id !== friend.id);
                setFriends(updatedFriends);
              } catch (error) {
                Alert.alert('Error', 'Failed to remove friend');
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error removing friend:', error);
      Alert.alert('Error', 'Failed to remove friend');
    }
  };


  // Initialize app
  useEffect(() => {

    const requestPermissions = async () => {
      try {
        // Request microphone permission for Android
        if (Platform.OS === 'android') {
          const micPermission = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            {
              title: "Microphone Permission",
              message: "App needs access to your microphone for voice calls.",
              buttonNeutral: "Ask Me Later",
              buttonNegative: "Cancel",
              buttonPositive: "OK"
            }
          );

          if (micPermission !== PermissionsAndroid.RESULTS.GRANTED) {
            Alert.alert(
              'Permission Required',
              'Microphone access is required for voice calls. Please enable it in Settings.',
              [
                { text: 'OK', onPress: () => console.log('Microphone permission denied') }
              ]
            );
          }

          // Request Android notification permissions
          const notificationPermission = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
            {
              title: "Notification Permission",
              message: "App needs to send notifications to alert you about incoming calls.",
              buttonNeutral: "Ask Me Later",
              buttonNegative: "Cancel",
              buttonPositive: "OK"
            }
          );

          if (notificationPermission !== PermissionsAndroid.RESULTS.GRANTED) {
            Alert.alert(
              'Permission Required',
              'Notifications are required for receiving calls. Please enable them in Settings.',
              [
                { text: 'OK', onPress: () => console.log('Notification permission denied') }
              ]
            );
          }
        }

        // Request iOS permissions
        if (Platform.OS === 'ios') {
          // Request microphone permission
          const micPermission = await AVAudioSession.requestRecordPermission();
          if (!micPermission) {
            Alert.alert(
              'Permission Required',
              'Microphone access is required for voice calls. Please enable it in Settings.',
              [
                { text: 'OK', onPress: () => console.log('iOS Microphone permission denied') }
              ]
            );
          }

          // Request notification permission
          const authStatus = await messaging().requestPermission({
            alert: true,
            announcement: false,
            badge: true,
            carPlay: false,
            provisional: false,
            sound: true,
          });

          if (authStatus !== messaging.AuthorizationStatus.AUTHORIZED &&
            authStatus !== messaging.AuthorizationStatus.PROVISIONAL) {
            Alert.alert(
              'Permission Required',
              'Notifications are required for receiving calls. Please enable them in Settings.',
              [
                { text: 'OK', onPress: () => console.log('iOS Notification permission denied') }
              ]
            );
          }
        }

        // Setup Firebase messaging
        try {
          // Get the FCM token
          const fcmToken = await messaging().getToken();
          if (fcmToken) {
            console.log('FCM Token:', fcmToken);
            // You might want to send this token to your server
          }


          // Handle token refresh
          messaging().onTokenRefresh(token => {
            console.log('FCM Token refreshed:', token);
            // You might want to send the new token to your server
          });

        } catch (error) {
          console.error('Error setting up Firebase Messaging:', error);
        }

      } catch (error) {
        console.error('Error requesting permissions:', error);
        Alert.alert(
          'Error',
          'Failed to request necessary permissions. Please check your device settings.',
          [
            { text: 'OK', onPress: () => console.log('Permission error alert closed') }
          ]
        );
      }
    };


    const initializeApp = async () => {
      try {

        await requestPermissions();
        await checkAndResetStaleBusyState();

        if (Platform.OS === 'ios') {
          const authStatus = await messaging().requestPermission();
          if (authStatus !== messaging.AuthorizationStatus.AUTHORIZED) {
            console.log('User denied permissions');
            return;
          }
        }

        // Initialize socket connection
        getSocket();

        // Setup message handling

        const unsubscribe = messaging().onMessage(async remoteMessage => {
          console.log(remoteMessage.data.type)
          if (remoteMessage.data.type === 'incoming_call') {
            const { roomName, callerSocketId, callerDeviceId } = remoteMessage.data;
            handleIncomingCall(roomName, callerSocketId, callerDeviceId);
          }
          if (remoteMessage.data.type === 'end_call') {
            console.log('Received end call notification in foreground');
            // Show alert to user
            const callerName = remoteMessage.data.callerName || 'User';
            Alert.alert(
              'Call Ended',
              `Call with ${callerName} has ended`
            );

            // Call the cleanup function to reset all UI state
            await cleanup();

            BackgroundService.stop();
          }
        });

        return () => {
          unsubscribe();
          cleanup();
        };
      } catch (error) {
        console.error('Error initializing app:', error);
      }
    };

    initializeApp();
  }, []);

  const handleAcceptRequest = async (requestId) => {
    try {
      await acceptFriendRequest(requestId);
      // Request will be automatically removed from state due to the real-time listener
    } catch (error) {
      Alert.alert('Error', 'Failed to accept friend request');
    }
  };
  const handleDeclineRequest = async (requestId) => {
    try {
      await declineFriendRequest(requestId);
      // The request will be automatically removed from state due to the real-time listener
    } catch (error) {
      Alert.alert('Error', 'Failed to decline friend request');
    }
  };
  // Handle app state changes
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        if (!socketConnected) {
          getSocket();
        }
        syncMicrophoneState();

      }
      else {
        console.log("changed app state service closed", nextAppState)
        // BackgroundService.stop()
      }
    });

    return () => {
      subscription.remove();
    };
  }, [socketConnected]);

  const isUserUnavailable =
    isBlockedByFriend ||
    (selectedFriend?.isSilenceModeEnabled) ||
    (selectedFriend?.isBusy);


  // Add this function after the panResponder useEffect
  const startCall = async () => {
    if (isUserUnavailable) {
      if (selectedFriend?.isSilenceModeEnabled) {
        Alert.alert('Cannot Call', 'User has silence mode enabled');
      } else if (isBlockedByFriend) {
        Alert.alert('Cannot Call', 'User has DND enabled');
      } else if (selectedFriend?.isBusy) {
        Alert.alert('Cannot Call', 'User is on another call');
      }
      return;
    }

    try {
      // Set busy status
      await setUserBusy(true);

      // Start vibration if not already in a call
      if (!remoteStream) {
        startContinuousVibration();
      }

      // Get local stream for the call
      const stream = await getLocalStream();
      if (stream) {
        setIsInCall(true);
        setIsCallInitiator(true);
        setCallStatus('Calling...');

        const roomName = `room-${Date.now()}`;
        setcurrentRoom(roomName);

        await saveCallState({
          state: CallState.IN_CALL,
          roomName,
          targetDeviceId: selectedFriend.deviceId,
          isCallInitiator: true
        });

        // Get the current user's full name from Firebase
        let currentUserName = '';
        try {
          if (user?.uid) {
            const userSnapshot = await database()
              .ref(`users/${user.uid}`)
              .once('value');

            const userData = userSnapshot.val();
            if (userData?.fullName) {
              currentUserName = userData.fullName;
            }
          }

          if (!currentUserName) {
            currentUserName = user?.displayName || user?.email || "User";
          }
        } catch (error) {
          console.error('Error getting user name:', error);
          currentUserName = user?.displayName || user?.email || "User";
        }

        // Start the call with proper name
        const socket = getSocket();
        socket.emit('startCall', {
          roomName,
          targetDeviceId: selectedFriend.deviceId,
          fcmToken: selectedFriend.fcmToken,
          callerName: currentUserName,
          targetUserId: selectedFriend.id
        });

        joinRoom(stream, roomName);
        startBackgroundService();

        // Start with audio enabled by default for normal calls
        setIsAudioEnabled(true);
        if (localStream) {
          localStream.getAudioTracks().forEach(track => {
            track.enabled = true;
          });
        }
      } else {
        console.error('Failed to get local stream');
        await setUserBusy(false);
      }
    } catch (error) {
      console.error('Error starting call:', error);
      stopVibration();
      await setUserBusy(false);
    }
  };

  // Add toggle mute function
  // In App.js, modify your toggleMute function

  const syncMicrophoneState = () => {
    try {
      // Forcibly set microphone state to match isAudioEnabled
      InCallManager.setMicrophoneMute(!isAudioEnabled);

      // Also update stream tracks to be consistent
      if (localStream) {
        localStream.getAudioTracks().forEach(track => {
          track.enabled = isAudioEnabled;
        });
      }

      console.log(`Microphone synced to ${isAudioEnabled ? 'enabled' : 'muted'} state`);
    } catch (error) {
      console.error('Error syncing microphone state:', error);
    }
  };

  const toggleMute = async () => {
    // Toggle the mute state
    const newAudioState = !isAudioEnabled;

    try {
      // Update UI state first
      setIsAudioEnabled(newAudioState);

      // Use InCallManager to control the microphone at system level
      InCallManager.setMicrophoneMute(!newAudioState);
      console.log(`Microphone ${newAudioState ? 'enabled' : 'muted'} using InCallManager`);

      // Also update stream tracks for completeness
      if (localStream) {
        localStream.getAudioTracks().forEach(track => {
          track.enabled = newAudioState;
        });
      }

      // Notify the server about mute state for UI updates on the other end
      const socket = getSocket();
      if (socket && socket.connected) {
        socket.emit('ptt-state-change', {
          deviceId: currentDeviceId,
          isPressed: newAudioState,
          roomName: currentRoom
        });
      }
    } catch (error) {
      console.error('Error toggling microphone mute:', error);
      // Revert UI state if operation failed
      setIsAudioEnabled(!newAudioState);
    }
  };


  const openSettingsModal = async () => {
    try {
      const currentNameFromDB = await getUserName(); // Fetch name using the existing function
      // Update the userName state with the fetched name.
      // If no name is found in DB (e.g., new user), set it to an empty string.
      setUserName(currentNameFromDB || '');
      setSettingsModalVisible(true); // Now open the modal
    } catch (error) {
      console.error("Error fetching user name for settings:", error);
      // Optionally show an alert or handle the error
      Alert.alert("Error", "Could not load your current name.");
      // Decide if you still want to open the modal, perhaps with an empty field:
      // setUserName('');
      // setSettingsModalVisible(true);
    }
  };


  return (
    <SafeAreaView style={styles.container}>

      <View style={styles.statusContainer}>
        <Text style={[styles.statusText, socketConnected ? styles.connected : styles.disconnected]}>
          {socketConnected ? 'Connected' : 'Disconnected'}
        </Text>
      </View>
      <TouchableOpacity
        style={[
          styles.silenceModeButton,
          isSilenceModeEnabled && styles.silenceModeEnabled
        ]}
        onPress={handleSilenceModeToggle}
        disabled={isSilenceModeLoading}
      >
        {isSilenceModeLoading ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <>
            <Icon
              name={isSilenceModeEnabled ? "volume-off" : "volume-high"}
              size={24}
              color="#FFF"
            />
            <Text style={styles.silenceModeText}>
              {isSilenceModeEnabled
                ? silenceRemainingTime > 0
                  ? `Silence (${silenceRemainingTime}m)`
                  : 'Silence On'
                : 'Silence Off'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {currentView === 'call' ? (

        <View style={styles.mainContainer}>
          {/* Header with selected friend */}

          <View style={styles.header}>
            {selectedFriend && (
              <View style={styles.friendHeader}>
                <View style={styles.onlineIndicator} />
                <Text style={styles.friendEmail}>
                  {selectedFriend.fullName || selectedFriend.email}
                </Text>
              </View>
            )}
          </View>

          {/* Main content area with friend cards */}
          <View style={styles.cardContainer}>
            <FriendList
              onFriendSelect={setSelectedFriend}
              socket={getSocket()}
              currentDeviceId={currentDeviceId}
              mutualViewers={mutualViewers}
              isInCall={isInCall}
              callTargetDeviceId={targetDeviceId}
              isCallInitiator={isCallInitiator}
              onGhostCall={handleGhostCall}
            />

          </View>

          {/* Connection message */}
          {connectionMessage && (
            <Text style={styles.connectionMessage}>{connectionMessage}</Text>
          )}

          {/* Remote user status */}
          {remotePTTActive && (
            <Text style={styles.remoteStatus}>Remote user is talking...</Text>
          )}

          {/* Bottom controls */}
          <View style={styles.bottomControls}>
            <TouchableOpacity
              style={styles.circleButton}
              onPress={() => setCurrentView('friends')}
            >
              <Text style={styles.plusIcon}>+</Text>
            </TouchableOpacity>

            <View style={styles.pttContainer}>
              {/* Different buttons based on call state and role */}
              {isInCall ? (
                // Both initiator and receiver now see the end call button
                <TouchableOpacity
                  style={styles.endCallButton}
                  onPress={endCall}
                  activeOpacity={0.7}
                >
                  <View style={styles.endCallButtonCircle}>
                    <Icon
                      name="phone-off"
                      size={30}
                      color="#FFF"
                    />
                  </View>
                  <Text style={styles.endCallText}>End Call</Text>
                </TouchableOpacity>
              ) : (
                // Not in call - show call button
                <TouchableOpacity
                  style={[
                    styles.callButton,
                    isUserUnavailable && styles.callButtonDisabled
                  ]}
                  onPress={startCall}
                  disabled={isUserUnavailable}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.callButtonCircle,
                    isPTTActive && styles.callActive
                  ]}>
                    <Icon
                      name="phone"
                      size={30}
                      color={isUserUnavailable ? "#666" : "#FFF"}
                    />
                  </View>
                  <Text style={[
                    styles.callText,
                    isUserUnavailable && styles.callTextDisabled
                  ]}>
                    {isBlockedByFriend ? 'User has DND On' :
                      selectedFriend?.isSilenceModeEnabled ? 'User in Silence Mode' :
                        selectedFriend?.isBusy ? 'User is on a call' :
                          'Call'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>


            {/* Right side button - shows mute for initiator, nothing for receiver */}
            {isInCall ? (
              <TouchableOpacity
                style={styles.circleButton}
                onPress={toggleMute}
              >
                <Icon
                  name={isAudioEnabled ? "microphone" : "microphone-off"}
                  size={24}
                  color="#FFF"
                />
              </TouchableOpacity>
            ) : (
              <View style={styles.placeholderButton} />
            )}
          </View>

        </View>
      ) : (
        <View style={styles.friendsContainer}>
          {/* Back button header */}
          <View style={styles.friendsHeader}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setCurrentView('call')}
            >
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.friendsHeaderTitle}>Back</Text>
          </View>

          <View style={styles.friendsContent}>
            <View style={styles.idCard}>
              <Text style={styles.idLabel}>Your ID:</Text>
              <Text style={styles.uniqueId}>{userUniqueId}</Text>
              <TouchableOpacity
                style={styles.shareButton}
                onPress={shareUniqueId}
              >
                <Text style={styles.shareButtonText}>Share ID</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={openSettingsModal} // <-- REPLACE WITH THIS
              >
                <Text style={styles.settingsButtonText}>⚙️ Settings</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.logoutButton}
                onPress={handleLogout}
              >
                <Icon name="logout" size={20} color="#FFF" />
                <Text style={styles.logoutButtonText}>Logout</Text>
              </TouchableOpacity>
            </View>

            {/* Friends List Section */}
            <View style={styles.friendsListSection}>
              <Text style={styles.friendsListTitle}>Friends</Text>
              <ScrollView style={styles.friendsListScroll}>
                <View style={styles.friendsList}>
                  {Array.isArray(friends) && friends.length > 0 ? (
                    friends.map((friend, index) => (
                      <View key={friend?.id || index} style={styles.friendItem}>
                        <View style={styles.friendAvatar}>
                          <Text style={styles.avatarText}>
                            {(friend?.fullName || friend?.email || '?')[0].toUpperCase()}
                          </Text>
                        </View>
                        <Text style={styles.friendName}>
                          {friend?.fullName || friend?.email || 'Unknown'}
                        </Text>
                        <TouchableOpacity
                          style={styles.friendMoreButton}
                          onPress={() => {
                            setSelectedFriendForOptions(friend);
                            setShowOptionsModal(true);
                          }}
                        >
                          <Text style={styles.friendMoreButtonText}>...</Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.noFriendsText}>No friends added yet</Text>
                  )}
                </View>
              </ScrollView>
            </View>

            <TouchableOpacity
              style={styles.addFriendButton}
              onPress={() => setShowFriendModal(true)}
            >
              <Text style={styles.addFriendText}>Add Friend</Text>
            </TouchableOpacity>
            <Modal
              visible={settingsModalVisible}
              animationType="slide"
              transparent={true}
              onRequestClose={() => setSettingsModalVisible(false)}
            >
              <View style={styles.modalContainer}>
                <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>Settings</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your name"
                    placeholderTextColor="#999"
                    value={userName}
                    onChangeText={setUserName}
                    autoCapitalize="words"
                  />
                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.cancelButton]}
                      onPress={() => setSettingsModalVisible(false)}
                    >
                      <Text style={styles.modalButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.addButton]}
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
        </View>

      )}

      {/* Add Friend Modal */}
      <Modal
        visible={showFriendModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowFriendModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Friend</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter Friend's ID"
              placeholderTextColor="#999"
              value={friendId}
              onChangeText={setFriendId}
              autoCapitalize="characters"
              maxLength={7}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowFriendModal(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.addButton]}
                onPress={handleAddFriend}
              >
                <Text style={styles.modalButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* Friend Options Modal */}
      <Modal
        visible={showOptionsModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowOptionsModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowOptionsModal(false)}
        >
          <View style={styles.optionsContainer}>
            <TouchableOpacity
              style={styles.optionButton}
              onPress={() => {
                handleUnfriend(selectedFriendForOptions);
                setShowOptionsModal(false);
              }}
            >
              <Text style={styles.optionTextDanger}>Remove Friend</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionButton}
              onPress={() => setShowOptionsModal(false)}
            >
              <Text style={styles.optionText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <FriendRequestModal
        visible={showRequestsModal}
        requests={friendRequests}
        onAccept={handleAcceptRequest}
        onDecline={handleDeclineRequest}
        onClose={() => setShowRequestsModal(false)}
      />

      <DurationSelectionModal
        visible={showDurationModal}
        onClose={() => setShowDurationModal(false)}
        onSelectDuration={handleDurationSelected}
        title={modalMode === 'silence' ? 'Enable Silence Mode' : 'Enable DND Mode'}
      />


    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  friendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
    marginRight: 8,
  },
  friendEmail: {
    color: '#FFF',
    fontSize: 18,
  },
  mainContent: {
    flex: 1,
  },
  plusIcon: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  pttButton: {
    alignItems: 'center',
  },
  pttActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  pttText: {
    color: '#FFF',
    fontSize: 14,
    marginTop: 8,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#222',
    borderRadius: 10,
    padding: 20,
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
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
  addButton: {
    backgroundColor: '#4CAF50',
  },
  modalButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    backgroundColor: '#4CAF50',
    padding: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  headerButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  selectedFriend: {
    color: '#4CAF50',
    fontSize: 16,
    marginBottom: 20,
  },
  selectPrompt: {
    color: '#999',
    fontSize: 16,
  },
  connectionMessage: {
    color: '#FF4444',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
    position: 'absolute',
    top: '65%',
    alignSelf: 'center',
    width: '100%',
    padding: 10,
  },
  mainContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  cardContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a', // slightly lighter than black for card area
  },
  statusContainer: {
    padding: 10,
    backgroundColor: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  statusText: {
    color: '#fff'
  },
  friendsContainer: {
    flex: 1,
    backgroundColor: '#000',
    padding: 20,
  },
  remoteStatus: {
    color: '#4CAF50',
    fontSize: 16,
    textAlign: 'center',
    position: 'absolute',
    bottom: 100,
    width: '100%',
  },
  bottomControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    backgroundColor: '#000',
  },

  // Update PTT button styles
  pttButtonCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FFF',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  circleButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },

  idCard: {
    backgroundColor: '#222',
    padding: 20,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  idLabel: {
    color: '#999',
    fontSize: 16,
    marginBottom: 8,
  },
  uniqueId: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    letterSpacing: 1,
  },
  shareButton: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  shareButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  addFriendText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
  friendsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  backButton: {
    padding: 8,
    marginRight: 16,
  },
  friendsHeaderTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  friendsContent: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
  },
  settingsButton: {
    backgroundColor: '#333',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsButtonText: {
    color: '#FFF',
    fontSize: 16,
    marginLeft: 8,
  },
  logoutButton: {
    backgroundColor: '#FF4444',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  logoutButtonText: {
    color: '#FFF',
    fontSize: 16,
    marginLeft: 8,
    fontWeight: '600',
  },
  friendsListSection: {
    flex: 1, // This will allow the section to take remaining space
    width: '100%',
    marginTop: 20,
    marginBottom: 20,
  },
  friendsListTitle: {
    color: '#999',
    fontSize: 16,
    marginBottom: 10,
    paddingHorizontal: 10,
  },
  friendsList: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 10,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  friendName: {
    color: '#FFF',
    fontSize: 16,
    flex: 1,
  },
  friendMoreButton: {
    padding: 8,
  },
  friendMoreButtonText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  noFriendsText: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    padding: 20,
  },
  friendsListScroll: {
    flex: 1,
    backgroundColor: '#222',
    borderRadius: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  optionsContainer: {
    backgroundColor: '#333',
    borderRadius: 12,
    padding: 8,
    width: '80%',
    maxWidth: 300,
  },

  optionButton: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 8,
  },

  optionText: {
    color: '#FFF',
    fontSize: 16,
    textAlign: 'center',
  },

  optionTextDanger: {
    color: '#FF4444',
    fontSize: 16,
    textAlign: 'center',
  },
  silenceModeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginLeft: 10,
  },
  silenceModeEnabled: {
    backgroundColor: '#FF4444',
  },
  silenceModeText: {
    color: '#FFF',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  pttContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },

  pttButtonLocked: {
    opacity: 0.9,
  },

  pttLocked: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },

  pttTextLocked: {
    color: '#8B5CF6',
  },

  cancelPttButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    height: 120,
  },

  cancelPttCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
    marginBottom: 8,
  },
  cancelPttText: {
    color: '#FF4444',
    fontSize: 14,
    fontWeight: 'bold',
  },
  pttTouchArea: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pttButtonWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  endCallButton: {
    alignItems: 'center',
  },
  endCallButtonCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FF4444',
    backgroundColor: '#FF4444',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ scale: 1 }],
    opacity: 1,
    transition: 'all 0.3s ease',
  },
  endCallText: {
    color: '#FF4444',
    fontSize: 14,
    marginTop: 8,
  },
  callButton: {
    alignItems: 'center',
  },
  callButtonCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#4CAF50',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ scale: 1 }],
    transition: 'all 0.3s ease',
  },
  callButtonDisabled: {
    opacity: 0.5,
  },
  callActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  callText: {
    color: '#4CAF50',
    fontSize: 14,
    marginTop: 8,
  },
  callTextDisabled: {
    color: '#666',
  },
  muteToggleButton: {
    alignItems: 'center',
  },
  muteToggleCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ scale: 1 }],
    transition: 'all 0.3s ease',
  },
  muteActive: {
    backgroundColor: '#FF4444',
    borderColor: '#FF4444',
  },
  unmuteActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  muteToggleText: {
    fontSize: 14,
    marginTop: 8,
  },
  placeholderButton: {
    width: 56,
    height: 56,
    opacity: 0,
  },
});

export default App;