// Enhanced version of backgroundService.js with more robust call handling

import { mediaDevices, MediaStream, registerGlobals } from 'react-native-webrtc';
import BackgroundService from 'react-native-background-actions';
import io from 'socket.io-client';
import { Device } from 'mediasoup-client';
import InCallManager from 'react-native-incall-manager';
import { NativeModules, Platform } from 'react-native';
import {
  saveCallState,
  CallState,
  saveActiveCallData,
  clearActiveCallData,
  getActiveCallData
} from './callPersistence';
import auth from '@react-native-firebase/auth';
import database from '@react-native-firebase/database';
import { setUserBusy } from './userUtils';
import DeviceInfo from 'react-native-device-info';
const { MicrophoneServiceModule } = NativeModules;

registerGlobals();

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

// Connection timeout (10 seconds)
const CONNECTION_TIMEOUT = 10000;

// Maximum number of connection attempts
const MAX_CONNECTION_ATTEMPTS = 3;

let globalSocket = null;

class CallManager {
  constructor() {
    if (CallManager.instance) {
      return CallManager.instance;
    }
    this.deviceRef = null;
    this.producerTransportRef = null;
    this.audioProducerRef = null;
    this.consumerTransportsRef = [];
    this.consumingTransportsRef = [];
    this.localStream = null;
    this.remoteStream = null;
    this.isConnecting = false;
    this.connectionAttempts = 0;
    this.connectionTimer = null;
    this.heartbeatInterval = null;
    this.callEstablished = false;
    this.isAudioEnabled = true;
    CallManager.instance = this;
  }

  setupAudioSession() {
    try {
      InCallManager.start({ media: 'audio' });
      InCallManager.stopProximitySensor()
      InCallManager.setSpeakerphoneOn(true);
      InCallManager.setKeepScreenOn(true);
      console.log('[Background] Audio session initialized successfully');
      return true;
    } catch (error) {
      console.error('[Background] Error setting up audio session:', error);
      return false;
    }
  }

  async getLocalStream() {
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 2,
        },
        video: false
      });

      stream.getAudioTracks().forEach(track => {
        track.enabled = this.isAudioEnabled;
      });

      console.log('[Background] Got local stream with tracks:', stream.getTracks().length);
      return stream;
    } catch (error) {
      console.error('[Background] Error getting local media:', error);
      return null;
    }
  }

  async handleIncomingCall(roomName, callerSocketId, fcmToken) {
    try {
      console.log('[Background] Handling background incoming call for room:', roomName);
      this.callEstablished = false;
      this.isConnecting = true;
      this.connectionAttempts = 0;
      
      // Set busy first
      try {
        await setUserBusy(true);
        console.log('[Background] Set recipient user status to busy');
      } catch (busyError) {
        console.error('[Background] Error setting busy status:', busyError);
        // Continue anyway - we'll retry
      }

      // Setup audio session early
      const audioSessionSetup = this.setupAudioSession();
      if (!audioSessionSetup) {
        console.warn('[Background] Audio session setup failed, but continuing');
      }

      // Store call data
      this.activeFcmToken = fcmToken;
      this.activeRoomName = roomName;
      this.callerSocketId = callerSocketId;

      // Get local stream
      const stream = await this.getLocalStream();
      if (!stream) {
        console.error('[Background] Failed to get local stream. Aborting call handling.');
        await this.retrySetUserBusy(false); // Reset busy state
        return;
      }
      this.localStream = stream;

      // Connect to socket with retry mechanism
      await this.connectToSocketWithRetry();

      // Save call state for persistence
      await saveCallState({
        state: CallState.IN_CALL,
        roomName,
        targetDeviceId: callerSocketId,
        isCallInitiator: false,
        timestamp: Date.now() // Add timestamp for staleness check
      });

      // Initialize active call data
      await saveActiveCallData({
        roomName,
        producerId: null,
        consumerIds: [],
        transportIds: [],
        timestamp: Date.now()
      });

      // Start background service
      await BackgroundService.start(this.backgroundTask, {
        taskName: 'AudioCall',
        taskTitle: 'Audio Call Active',
        taskDesc: 'Call in progress',
        taskIcon: {
          name: 'ic_launcher',
          type: 'mipmap',
        },
        color: '#4CAF50',
        linkingURI: 'yourapp://call',
        parameters: {
          delay: 1000,
        },
      });

      // Start a connection timeout
      this.startConnectionTimeout();
      
      // Start heartbeat to check connection status
      this.startHeartbeat();
    } catch (error) {
      await this.retrySetUserBusy(false);
      console.error('[Background] Error in handleIncomingCall:', error);
      this.cleanup();
    }
  }

  async connectToSocketWithRetry() {
    return new Promise(async (resolve, reject) => {
      if (this.connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
        console.error('[Background] Max connection attempts reached. Giving up.');
        reject(new Error('Max connection attempts reached'));
        return;
      }

      this.connectionAttempts++;
      console.log(`[Background] Socket connection attempt ${this.connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}`);

      try {
        // Close existing socket if any
        if (globalSocket && globalSocket.connected) {
          globalSocket.disconnect();
        }

        // Create new socket
        globalSocket = io("wss://api.knockknock.social/", socketConfig);

        // Register socket event handlers
        globalSocket.on('connect', async () => {
          console.log('[Background] Socket connected successfully');
          clearTimeout(this.connectionTimer);
          
          // Register device
          try {
            const deviceId = await DeviceInfo.getUniqueId();
            console.log('[Background] Registering device:', deviceId);
            globalSocket.emit('registerUser', { deviceId });
          } catch (error) {
            console.error('[Background] Error registering device:', error);
          }
          
          // Join room
          this.joinRoom(this.localStream, this.activeRoomName);
          resolve();
        });

        globalSocket.on('connect_error', (error) => {
          console.error('[Background] Socket connection error:', error);
          this.retryConnection(resolve, reject);
        });

        globalSocket.on('connect_timeout', () => {
          console.error('[Background] Socket connection timeout');
          this.retryConnection(resolve, reject);
        });

        globalSocket.on('error', (error) => {
          console.error('[Background] Socket error:', error);
        });

        globalSocket.on('disconnect', (reason) => {
          console.log('[Background] Socket disconnected:', reason);
          if (reason === 'io server disconnect' || reason === 'transport close') {
            // Server disconnect, try to reconnect
            this.retryConnection(resolve, reject);
          }
        });

        // Add handlers for call related events
        this.setupSocketEventHandlers();
      } catch (error) {
        console.error('[Background] Error creating socket:', error);
        this.retryConnection(resolve, reject);
      }
    });
  }

  retryConnection(resolve, reject) {
    setTimeout(() => {
      if (this.connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
        this.connectToSocketWithRetry().then(resolve).catch(reject);
      } else {
        reject(new Error('Max connection attempts reached'));
        this.cleanup();
      }
    }, 1000); // Wait 1 second before retry
  }

  setupSocketEventHandlers() {
    if (!globalSocket) return;

    globalSocket.on('new-producer', async ({ producerId }) => {
      console.log('[Background] New producer received:', producerId);
      this.callEstablished = true; // Mark call as established when we receive a producer
      const activeCallData = await getActiveCallData();
      await saveActiveCallData({
        ...activeCallData,
        producerId,
        timestamp: Date.now()
      });
      this.signalNewConsumerTransport(producerId);
    });

    globalSocket.on('transport-created', async ({ transportId }) => {
      const transportIds = this.transportIds || [];
      transportIds.push(transportId);
      this.transportIds = transportIds;

      const activeCallData = await getActiveCallData();
      await saveActiveCallData({
        ...activeCallData,
        transportIds,
        timestamp: Date.now()
      });
    });

    globalSocket.on('producer-closed', ({ remoteProducerId }) => {
      console.log('[Background] Producer closed:', remoteProducerId);
      this.handleProducerClosed(remoteProducerId);
    });

    globalSocket.on('call-ended', async ({ roomName, reason }) => {
      console.log('[Background] Call ended event received:', reason);
      this.cleanup();
    });
  }

  startConnectionTimeout() {
    clearTimeout(this.connectionTimer);
    this.connectionTimer = setTimeout(() => {
      if (!this.callEstablished) {
        console.log('[Background] Call connection timed out without establishing');
        this.cleanup();
      }
    }, CONNECTION_TIMEOUT);
  }

  startHeartbeat() {
    // Clear any existing heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Check connection status every 5 seconds
    this.heartbeatInterval = setInterval(async () => {
      try {
        // Check if socket is still connected
        if (!globalSocket || !globalSocket.connected) {
          console.log('[Background] Heartbeat: Socket disconnected, attempting to reconnect');
          await this.connectToSocketWithRetry();
          return;
        }

        // Check if call is still active by pinging server
        globalSocket.emit('ping', {}, (response) => {
          if (!response || response.error) {
            console.log('[Background] Heartbeat: Server ping failed, call might be dead');
            // Don't clean up immediately, give it a chance to recover
          }
        });

        // Update persistance timestamp to prevent stale state
        const activeCallData = await getActiveCallData();
        if (activeCallData) {
          await saveActiveCallData({
            ...activeCallData,
            timestamp: Date.now()
          });
        }

        // Make sure the busy status is still set
        await this.retrySetUserBusy(true);

      } catch (error) {
        console.error('[Background] Error in heartbeat check:', error);
      }
    }, 5000);
  }

  async retrySetUserBusy(busyState, maxRetries = 3) {
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        await setUserBusy(busyState);
        console.log(`[Background] User busy state set to ${busyState}`);
        return true;
      } catch (error) {
        console.error(`[Background] Failed to set busy state (attempt ${retries + 1}):`, error);
        retries++;
        
        if (retries >= maxRetries) {
          console.error('[Background] Max retries reached for setting busy state');
          return false;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return false;
  }

  joinRoom(stream, roomName) {
    console.log('[Background] Joining room:', roomName);
    if (!globalSocket || !globalSocket.connected) {
      console.error('[Background] Socket not connected. Cannot join room.');
      return;
    }

    globalSocket.emit('joinRoom', { roomName }, async (data) => {
      if (data.error) {
        console.error('[Background] Error joining room:', data.error);
        return;
      }

      try {
        console.log('[Background] Got RTP capabilities, creating device...');
        this.deviceRef = new Device();
        await this.deviceRef.load({ routerRtpCapabilities: data.rtpCapabilities });

        console.log('[Background] Creating send transport...');
        await this.createSendTransport(stream);

        if (data.producersExist) {
          console.log('[Background] Existing producers found, getting producers...');
          this.getProducers();
        }
        
        // Confirm call is established if we've gotten this far
        this.callEstablished = true;
      } catch (error) {
        console.error('[Background] Error in join room flow:', error);
      }
    });
  }

  async createSendTransport(stream) {
    if (!globalSocket || !globalSocket.connected) {
      console.error('[Background] Socket not connected. Cannot create send transport.');
      return Promise.reject(new Error('Socket not connected'));
    }

    return new Promise((resolve, reject) => {
      globalSocket.emit('createWebRtcTransport', { consumer: false }, async ({ params }) => {
        if (params.error) {
          console.error('[Background] Send transport create error:', params.error);
          reject(params.error);
          return;
        }

        try {
          console.log('[Background] Creating send transport with ID:', params.id);
          this.producerTransportRef = this.deviceRef.createSendTransport(params);

          this.producerTransportRef.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
              await globalSocket.emit('transport-connect', {
                transportId: params.id,
                dtlsParameters,
              });
              callback();
            } catch (error) {
              errback(error);
            }
          });

          this.producerTransportRef.on('produce', async (parameters, callback, errback) => {
            try {
              console.log('[Background] Producing with parameters:', parameters.kind);
              await globalSocket.emit('transport-produce', {
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

          await this.connectSendTransport(stream);
          console.log('[Background] Send transport created and connected successfully');
          resolve();
        } catch (error) {
          console.error('[Background] Error in createSendTransport:', error);
          reject(error);
        }
      });
    });
  }

  async connectSendTransport(stream) {
    if (!this.producerTransportRef) {
      console.error('[Background] No producer transport available');
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      try {
        console.log('[Background] Creating audio producer');
        this.audioProducerRef = await this.producerTransportRef.produce({
          track: audioTrack,
          codecOptions: {
            opusStereo: true,
            opusDtx: true,
            opusFec: true,
            opusNack: true,
          }
        });

        console.log('[Background] Audio producer created:', this.audioProducerRef.id);
        
        // Listen for transport closure
        this.audioProducerRef.on('transportclose', () => {
          console.log('[Background] Producer transport closed');
        });

        this.audioProducerRef.on('trackended', () => {
          console.log('[Background] Producer track ended');
        });
      } catch (error) {
        console.error('[Background] Error creating audio producer:', error);
      }
    } else {
      console.error('[Background] No audio track available in stream');
    }
  }

  getProducers() {
    if (!globalSocket || !globalSocket.connected) {
      console.error('[Background] Socket not connected. Cannot get producers.');
      return;
    }

    globalSocket.emit('getProducers', producerIds => {
      console.log('[Background] Got producers:', producerIds);
      producerIds.forEach(producerId => {
        this.signalNewConsumerTransport(producerId);
      });
    });
  }

  async signalNewConsumerTransport(remoteProducerId) {
    if (!this.consumingTransportsRef) {
      this.consumingTransportsRef = [];
    }

    if (this.consumingTransportsRef.includes(remoteProducerId)) {
      console.log('[Background] Already consuming this producer:', remoteProducerId);
      return;
    }

    if (!globalSocket || !globalSocket.connected) {
      console.error('[Background] Socket not connected. Cannot signal consumer transport.');
      return;
    }

    console.log('[Background] Signaling new consumer transport for producer:', remoteProducerId);
    this.consumingTransportsRef.push(remoteProducerId);

    await globalSocket.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
      if (params.error) {
        console.error('[Background] Transport create error:', params.error);
        return;
      }

      let consumerTransport;
      try {
        consumerTransport = this.deviceRef.createRecvTransport(params);
      } catch (error) {
        console.error('[Background] Error creating consumer transport:', error);
        return;
      }

      consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await globalSocket.emit('transport-recv-connect', {
            transportId: params.id,
            dtlsParameters,
            serverConsumerTransportId: params.id,
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      this.connectRecvTransport(consumerTransport, remoteProducerId, params.id);
    });
  }

  async connectRecvTransport(consumerTransport, remoteProducerId, serverConsumerTransportId) {
    if (!globalSocket || !globalSocket.connected) {
      console.error('[Background] Socket not connected. Cannot connect recv transport.');
      return;
    }

    try {
      console.log('[Background] Connecting receive transport for producer:', remoteProducerId);

      await globalSocket.emit('consume', {
        rtpCapabilities: this.deviceRef.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      }, async ({ params }) => {
        if (params.error) {
          console.error('[Background] Cannot consume:', params.error);
          return;
        }

        try {
          console.log('[Background] Creating consumer for kind:', params.kind);
          const consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters
          });

          const stream = new MediaStream([consumer.track]);

          stream.getAudioTracks().forEach(track => {
            track.enabled = true;
          });

          this.remoteStream = stream;
          console.log('[Background] Remote stream established');
          this.callEstablished = true; // Confirm call is established

          this.consumerTransportsRef.push({
            consumerTransport,
            serverConsumerTransportId: params.id,
            producerId: remoteProducerId,
            consumer,
          });

          await globalSocket.emit('consumer-resume', {
            serverConsumerId: params.serverConsumerId
          });

          console.log('[Background] Consumer setup completed successfully');
        } catch (error) {
          console.error('[Background] Error in consumer setup:', error);
        }
      });
    } catch (error) {
      console.error('[Background] Error in connectRecvTransport:', error);
    }
  }

  handleProducerClosed(remoteProducerId) {
    const producerToClose = this.consumerTransportsRef.find(
      transportData => transportData.producerId === remoteProducerId
    );

    if (producerToClose) {
      producerToClose.consumerTransport.close();
      producerToClose.consumer.close();

      this.consumerTransportsRef = this.consumerTransportsRef.filter(
        transportData => transportData.producerId !== remoteProducerId
      );
      this.remoteStream = null;
    }
  }

  backgroundTask = async () => {
    await new Promise(() => {
      // Keep the task running
      console.log('[Background] Background task started');
      
      // Additional connection check already handled by heartbeat
    });
  };

  async toggleMute() {
    this.isAudioEnabled = !this.isAudioEnabled;
    
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = this.isAudioEnabled;
      });
    }
    
    if (globalSocket && globalSocket.connected) {
      globalSocket.emit('ptt-state-change', {
        deviceId: await DeviceInfo.getUniqueId(),
        isPressed: this.isAudioEnabled,
        roomName: this.activeRoomName
      });
    }
    
    return this.isAudioEnabled;
  }

  async cleanup() {
    console.log('[Background] Starting cleanup process');
    
    // Clear any timers and intervals
    clearTimeout(this.connectionTimer);
    clearInterval(this.heartbeatInterval);
    
    // Clean up stored call data
    try {
      await clearActiveCallData();
    } catch (error) {
      console.error('[Background] Error clearing active call data:', error);
    }

    // Stop InCallManager
    try {
      InCallManager.stop();
      InCallManager.setKeepScreenOn(false);
    } catch (error) {
      console.error('[Background] Error stopping InCallManager:', error);
    }

    // Stop media tracks
    try {
      if (this.localStream) {
        console.log('[Background] Stopping local tracks');
        this.localStream.getTracks().forEach(track => track.stop());
      }

      if (this.remoteStream) {
        console.log('[Background] Stopping remote tracks');
        this.remoteStream.getTracks().forEach(track => track.stop());
      }
    } catch (error) {
      console.error('[Background] Error stopping media tracks:', error);
    }

    // Close WebRTC resources
    try {
      if (this.audioProducerRef) {
        console.log('[Background] Closing audio producer');
        this.audioProducerRef.close();
      }

      if (this.producerTransportRef) {
        console.log('[Background] Closing producer transport');
        this.producerTransportRef.close();
      }

      this.consumerTransportsRef.forEach(({ consumerTransport, consumer }) => {
        if (consumer) consumer.close();
        if (consumerTransport) consumerTransport.close();
      });
    } catch (error) {
      console.error('[Background] Error closing WebRTC resources:', error);
    }

    // Get user name for the notification before disconnecting
    try {
      const userName = await getUserName();
      
      if (globalSocket && globalSocket.connected) {
        // Send end call with proper name before disconnecting
        if (this.activeFcmToken && this.activeRoomName) {
          globalSocket.emit('endCall', {
            roomName: this.activeRoomName,
            fcmToken: this.activeFcmToken,
            callerName: userName
          });
          
          // Give some time for the endCall message to be sent
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        globalSocket.disconnect();
      }
    } catch (error) {
      console.error('[Background] Error in name lookup during cleanup:', error);
      if (globalSocket) {
        globalSocket.disconnect();
      }
    }

    // Reset instance variables
    this.localStream = null;
    this.remoteStream = null;
    this.consumerTransportsRef = [];
    this.consumingTransportsRef = [];
    this.audioProducerRef = null;
    this.producerTransportRef = null;
    this.isConnecting = false;
    this.connectionAttempts = 0;
    this.callEstablished = false;
    
    // Reset busy status
    try {
      await this.retrySetUserBusy(false);
    } catch (error) {
      console.error('[Background] Error resetting busy status:', error);
    }

    // Stop the background service
    try {
      await BackgroundService.stop();
      await MicrophoneServiceModule.stopService();
    } catch (error) {
      console.error('[Background] Error stopping background service:', error);
    }
    
    console.log('[Background] Cleanup completed');
  }
}

async function getUserName() {
  try {
    // Try to get user info from Firebase Auth
    const currentUser = auth().currentUser;
    if (!currentUser) return "User";

    // Try to get full name from database
    const userSnapshot = await database()
      .ref(`users/${currentUser.uid}`)
      .once('value');

    const userData = userSnapshot.val();
    if (userData?.fullName) {
      return userData.fullName;
    }

    // Fall back to email or UID
    return currentUser.email || currentUser.uid.substring(0, 6) || "User";
  } catch (error) {
    console.error('[Background] Error getting user name:', error);
    return "User"; // Default fallback
  }
}

export const callManager = new CallManager();

export const backgroundCallHandler = async (roomName, callerSocketId, fcmToken) => {
  console.log('[Background] Received call notification for room:', roomName);
  
  // Check if we're already handling a call
  if (callManager.isConnecting) {
    console.log('[Background] Already handling a call, ignoring new call request');
    return;
  }
  
  // Handle the call
  await callManager.handleIncomingCall(roomName, callerSocketId, fcmToken);
};