// userUtils.js
import database from '@react-native-firebase/database';
import auth from '@react-native-firebase/auth';

// Generate a random 7-letter alphanumeric ID
export const generateUniqueId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 7; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Initialize user in database with deviceId and generated ID
// userUtils.js
export const initializeUser = async (email, deviceId, fcmToken, fullName) => {
  try {
    // Wait for currentUser to be available
    const user = auth().currentUser;
    if (!user) {
      throw new Error('No authenticated user found');
    }

    const userId = user.uid;
    const userRef = database().ref(`users/${userId}`);

    // Check if user already exists
    const snapshot = await userRef.once('value');
    if (!snapshot.exists()) {
      const uniqueId = generateUniqueId();
      const userData = {
        email,
        deviceId,
        uniqueId,
        fcmToken,
        fullName,
        friends: {},
        dndList: {},
        silenceMode: {
          enabled: false,
          updatedAt: database.ServerValue.TIMESTAMP
        },
        createdAt: database.ServerValue.TIMESTAMP
      };

      // Use transaction to ensure atomic write
      await userRef.transaction((currentData) => {
        if (currentData === null) {
          return userData;
        }
        // If data exists, don't overwrite
        return currentData;
      });

      // Verify the data was written
      const verifySnapshot = await userRef.once('value');
      if (!verifySnapshot.exists()) {
        throw new Error('Failed to initialize user data');
      }

      return uniqueId;
    } else {
      // Update existing user data without overwriting friends or dndList
      const updates = {
        fcmToken,
        fullName,
        deviceId,
        email,
        lastUpdated: database.ServerValue.TIMESTAMP,
        silenceMode: snapshot.val().silenceMode || {
          enabled: false,
          updatedAt: database.ServerValue.TIMESTAMP
        }
      };

      await userRef.update(updates);
      return snapshot.val().uniqueId;
    }
  } catch (error) {
    console.error('Error in initializeUser:', error);
    throw error;
  }
};


export const toggleSilenceMode = async (duration = 0) => {
  try {
    const userId = auth().currentUser.uid;
    const userRef = database().ref(`users/${userId}`);

    // Get current silence mode status
    const snapshot = await userRef.child('silenceMode').once('value');
    const currentStatus = snapshot.val()?.enabled || false;

    // If turning off, simply disable
    if (currentStatus) {
      await userRef.child('silenceMode').set({
        enabled: false,
        updatedAt: database.ServerValue.TIMESTAMP
      });
      return false;
    }
    
    // If turning on, set expiration if duration is provided
    let expiresAt = null;
    if (duration > 0) {
      expiresAt = Date.now() + (duration * 60 * 1000); // Convert minutes to milliseconds
    }

    // Toggle status with expiration time
    await userRef.child('silenceMode').set({
      enabled: true,
      updatedAt: database.ServerValue.TIMESTAMP,
      expiresAt: expiresAt,
      duration: duration // Store original duration for UI reference
    });

    console.log('Silence mode enabled with expiration:', expiresAt);
    return true;
  } catch (error) {
    console.error('Error toggling silence mode:', error);
    throw error;
  }
};

export const checkAndDisableExpiredModes = async () => {
  try {
    const userId = auth().currentUser?.uid;
    if (!userId) return;
    
    const now = Date.now();
    
    // Check silence mode
    const silenceModeRef = database().ref(`users/${userId}/silenceMode`);
    const silenceModeSnapshot = await silenceModeRef.once('value');
    const silenceMode = silenceModeSnapshot.val();
    
    if (silenceMode?.enabled && silenceMode.expiresAt && now > silenceMode.expiresAt) {
      console.log('Auto-disabling expired silence mode');
      await silenceModeRef.set({
        enabled: false,
        updatedAt: database.ServerValue.TIMESTAMP,
        autoDisabled: true
      });
    }
    
    // Check DND statuses
    const dndListRef = database().ref(`users/${userId}/dndList`);
    const dndSnapshot = await dndListRef.once('value');
    const dndList = dndSnapshot.val() || {};
    
    // Check each friend's DND status
    for (const [friendId, dndData] of Object.entries(dndList)) {
      if (dndData.status && dndData.expiresAt && now > dndData.expiresAt) {
        console.log(`Auto-disabling expired DND for friend ${friendId}`);
        await dndListRef.child(friendId).set({
          status: false,
          updatedAt: database.ServerValue.TIMESTAMP,
          autoDisabled: true
        });
      }
    }
  } catch (error) {
    console.error('Error checking expired modes:', error);
  }
};


export const checkSilenceMode = async (userId) => {
  try {
    const snapshot = await database()
      .ref(`users/${userId}/silenceMode`)
      .once('value');

    return snapshot.val()?.enabled || false;
  } catch (error) {
    console.error('Error checking silence mode:', error);
    return false;
  }
};


export const updateFCMToken = async (fcmToken) => {
  try {
    const userId = auth().currentUser.uid;
    await database().ref(`users/${userId}/fcmToken`).set(fcmToken);
    console.log('FCM token updated in database');
  } catch (error) {
    console.error('Error updating FCM token:', error);
    throw error;
  }
};

// Add friend using their unique ID
export const addFriend = async (friendUniqueId) => {
  try {
    const userId = auth().currentUser.uid;

    // Find user with the given unique ID
    const usersRef = database().ref('users');
    const snapshot = await usersRef
      .orderByChild('uniqueId')
      .equalTo(friendUniqueId)
      .once('value');

    if (!snapshot.exists()) {
      throw new Error('User not found');
    }

    const friendData = Object.values(snapshot.val())[0];
    const friendId = Object.keys(snapshot.val())[0];

    if (friendId === userId) {
      throw new Error('Cannot add yourself as a friend');
    }

    // Check if there's an existing request
    const pendingRequestRef = database().ref(`friendRequests/${friendId}/${userId}`);
    const existingRequest = await pendingRequestRef.once('value');

    if (existingRequest.exists()) {
      const request = existingRequest.val();
      if (request.status === 'declined') {
        // Allow sending a new request if the previous one was declined
        await pendingRequestRef.remove();
      } else {
        throw new Error('Friend request already sent');
      }
    }

    // Get current user data
    const currentUserData = (await database().ref(`users/${userId}`).once('value')).val();

    // Create friend request
    await pendingRequestRef.set({
      senderEmail: currentUserData.email,
      senderName: currentUserData.fullName,
      senderId: userId,
      senderUniqueId: currentUserData.uniqueId,
      status: 'pending',
      timestamp: database.ServerValue.TIMESTAMP
    });

    return { success: true, message: 'Friend request sent successfully' };
  } catch (error) {
    console.error('Error in addFriend:', error);
    throw error;
  }
};

// Add new function to handle friend request acceptance
export const acceptFriendRequest = async (requestId) => {
  try {
    const userId = auth().currentUser.uid;
    const requestRef = database().ref(`friendRequests/${userId}/${requestId}`);

    // Get request data
    const requestSnapshot = await requestRef.once('value');
    const request = requestSnapshot.val();

    if (!request) {
      throw new Error('Friend request not found');
    }

    // Get both users' data
    const [currentUserData, senderData] = await Promise.all([
      database().ref(`users/${userId}`).once('value'),
      database().ref(`users/${request.senderId}`).once('value')
    ]);

    // Add each user to the other's friends list
    const updates = {
      [`users/${userId}/friends/${request.senderId}`]: {
        email: request.senderEmail,
        fullName: request.senderName,
        uniqueId: request.senderUniqueId,
        addedAt: database.ServerValue.TIMESTAMP,
        deviceId: senderData.val().deviceId,
      },
      [`users/${request.senderId}/friends/${userId}`]: {
        email: currentUserData.val().email,
        fullName: currentUserData.val().fullName,
        uniqueId: currentUserData.val().uniqueId,
        addedAt: database.ServerValue.TIMESTAMP,
        deviceId: currentUserData.val().deviceId,
      },
      // Remove the request
      [`friendRequests/${userId}/${requestId}`]: null
    };

    await database().ref().update(updates);
    return true;
  } catch (error) {
    console.error('Error accepting friend request:', error);
    throw error;
  }
};

export const setUserBusy = async (isOnCall = true) => {
  try {
    const userId = auth().currentUser.uid;
    await database().ref(`users/${userId}/callStatus`).set({
      busy: isOnCall,
      updatedAt: database.ServerValue.TIMESTAMP
    });
    console.log(`User status set to ${isOnCall ? 'busy' : 'available'}`);
    return true;
  } catch (error) {
    console.error('Error setting user call status:', error);
    return false;
  }
};

// Check if a user is busy
export const checkUserBusyStatus = async (userId) => {
  try {
    const snapshot = await database()
      .ref(`users/${userId}/callStatus`)
      .once('value');
    
    return snapshot.val()?.busy || false;
  } catch (error) {
    console.error('Error checking user busy status:', error);
    return false;
  }
};



export const declineFriendRequest = async (requestId) => {
  try {
    const userId = auth().currentUser.uid;
    // Remove the request from the friendRequests node
    await database().ref(`friendRequests/${userId}/${requestId}`).remove();
    return true;
  } catch (error) {
    console.error('Error declining friend request:', error);
    throw error;
  }
};

// Add function to get pending friend requests
export const getPendingFriendRequests = async () => {
  try {
    const userId = auth().currentUser.uid;
    const requestsRef = database().ref(`friendRequests/${userId}`);
    const snapshot = await requestsRef.once('value');
    return snapshot.val() || {};
  } catch (error) {
    console.error('Error getting friend requests:', error);
    throw error;
  }
};

export const updateUserName = async (fullName) => {
  try {
    const userId = auth().currentUser.uid;
    await database().ref(`users/${userId}/fullName`).set(fullName);
  } catch (error) {
    console.error('Error updating user name:', error);
    throw new Error('Failed to update name');
  }
};

export const getUserName = async () => {
  try {
    const userId = auth().currentUser.uid;
    const snapshot = await database().ref(`users/${userId}/fullName`).once('value');
    return snapshot.val();
  } catch (error) {
    console.error('Error getting user name:', error);
    return null;
  }
};
// Get user's friends
export const getFriends = async () => {
  try {
    const userId = auth().currentUser.uid;
    const friendsRef = database().ref(`users/${userId}/friends`);
    const friendsSnapshot = await friendsRef.once('value');
    const friendsData = friendsSnapshot.val() || {};

    // Get all friend data promises
    const friendPromises = Object.entries(friendsData).map(async ([friendId, friend]) => {
      // Fetch the latest friend data including name and call status
      const friendRef = database().ref(`users/${friendId}`);
      const friendSnapshot = await friendRef.once('value');
      const latestFriendData = friendSnapshot.val();

      return {
        ...friend,
        fullName: latestFriendData?.fullName || '',
        fcmToken: latestFriendData?.fcmToken || friend.fcmToken,
        deviceId: latestFriendData?.deviceId || friend.deviceId,
        isBusy: latestFriendData?.callStatus?.busy || false
      };
    });

    // Wait for all friend data to be fetched
    const resolvedFriends = await Promise.all(friendPromises);

    // Convert to object with friend IDs as keys
    return resolvedFriends.reduce((acc, friend, index) => {
      const friendId = Object.keys(friendsData)[index];
      acc[friendId] = friend;
      return acc;
    }, {});

  } catch (error) {
    console.error('Error in getFriends:', error);
    throw error;
  }
};

export const getFriendFCMToken = async (friendUniqueId) => {
  try {
    const usersRef = database().ref('users');
    const snapshot = await usersRef
      .orderByChild('uniqueId')
      .equalTo(friendUniqueId)
      .once('value');

    if (!snapshot.exists()) {
      throw new Error('Friend not found');
    }

    const friendData = Object.values(snapshot.val())[0];
    return friendData.fcmToken;
  } catch (error) {
    console.error('Error getting friend FCM token:', error);
    throw error;
  }
};

// Get user's unique ID
export const getUserUniqueId = async () => {
  try {
    const userId = auth().currentUser.uid;
    const userRef = database().ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    return snapshot.val()?.uniqueId;
  } catch (error) {
    console.error('Error in getUserUniqueId:', error);
    throw error;
  }
};


// In userUtils.js

export const toggleDNDStatus = async (friend, duration = 0) => {
  try {
    console.log('Starting DND toggle for friend:', friend);
    const userId = auth().currentUser.uid;
    console.log('Current user ID:', userId);

    // Use friend.id directly
    const dndRef = database().ref(`users/${userId}/dndList/${friend.id}`);

    // Get current status
    const dndSnapshot = await dndRef.once('value');
    const currentStatus = dndSnapshot.val()?.status || false;
    console.log('Current DND status:', currentStatus);

    // If turning off, simply disable
    if (currentStatus) {
      await dndRef.set({
        status: false,
        updatedAt: database.ServerValue.TIMESTAMP
      });
      return false;
    }

    // If turning on, set expiration if duration is provided
    let expiresAt = null;
    if (duration > 0) {
      expiresAt = Date.now() + (duration * 60 * 1000); // Convert minutes to milliseconds
    }
    
    // Toggle status with expiration time
    await dndRef.set({
      status: true,
      updatedAt: database.ServerValue.TIMESTAMP,
      expiresAt: expiresAt,
      duration: duration // Store original duration for UI reference
    });

    console.log('DND status enabled with expiration:', expiresAt);
    return true;
  } catch (error) {
    console.error('Error in toggleDNDStatus:', error);
    throw error;
  }
};



export const checkDNDStatus = async (friend) => {
  try {
    console.log('Checking DND status for friend:', friend);
    const currentUserId = auth().currentUser.uid;

    // Check if current user is in friend's DND list using friend.id directly
    const dndSnapshot = await database()
      .ref(`users/${friend.id}/dndList/${currentUserId}`)
      .once('value');

    const dndStatus = dndSnapshot.val()?.status || false;
    console.log('DND status found:', dndStatus);
    return dndStatus;
  } catch (error) {
    console.error('Error in checkDNDStatus:', error);
    return false;
  }
};

export const getDNDListForFriends = async () => {
  try {
    console.log('Getting DND list for all friends');
    const userId = auth().currentUser.uid;
    console.log('Current user ID:', userId);

    const dndSnapshot = await database()
      .ref(`users/${userId}/dndList`)
      .once('value');

    const dndList = dndSnapshot.val() || {};
    console.log('Retrieved DND list:', dndList);
    return dndList;
  } catch (error) {
    console.error('Error in getDNDListForFriends:', error);
    return {};
  }
};

export const removeFriend = async (friendId) => {
  try {
    const userId = auth().currentUser.uid;

    // Remove friend from user's friend list
    await database().ref(`users/${userId}/friends/${friendId}`).remove();

    // Remove user from friend's friend list
    await database().ref(`users/${friendId}/friends/${userId}`).remove();

  } catch (error) {
    console.error('Error removing friend:', error);
    throw error;
  }
};