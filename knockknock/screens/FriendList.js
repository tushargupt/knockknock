import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import {
  GestureHandlerRootView,
  FlatList,
} from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  getFriends,
  toggleDNDStatus,
  getDNDListForFriends,
  checkDNDStatus,
  checkSilenceMode,
  checkAndDisableExpiredModes
} from '../userUtils';
import database from '@react-native-firebase/database';
import DurationSelectionModal from '../components/DurationSelectionModal';
import { formatTimeRemaining, getRemainingTime } from '../utils/timeUtils';
import { useAuth } from '../AuthContext';

const { width, height } = Dimensions.get('window');
const CARD_WIDTH = width * 0.7;
const SPACING = 20;
const SIDE_CARD_SCALE = 0.9;
const SIDE_CARD_OPACITY = 0.6;

const DEFAULT_KNOCK_EMOJI = '👋'; // Example: Waving hand
const CLICKED_KNOCK_EMOJI = '💥'; // Example: Collision/Bang


const FriendList = ({ onFriendSelect,
  socket,
  currentDeviceId,
  mutualViewers,
  isInCall,
  callTargetDeviceId,
  isCallInitiator,
  onGhostCall,
  onCallFriendSelect }, ref) => {
  const [friends, setFriends] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingDND, setLoadingDND] = useState({});
  const prevSelectedFriendId = useRef(null);
  const prevCallTargetId = useRef(null); // Store the previous call target device ID
  const hasScrolledToTargetAfterCall = useRef(false); // Track if we've already scrolled after a call
  const filterOperationsCache = useRef({});

  // New state variables for duration selection
  const [showDurationModal, setShowDurationModal] = useState(false);
  const [selectedFriendForDND, setSelectedFriendForDND] = useState(null);
  const [friendDNDTimers, setFriendDNDTimers] = useState({});
  const dndStatusCache = useRef({});
  const lastDNDCheckTimes = useRef({});

  const flatListRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const isFilteringRef = useRef(false);
  const lastFilterTimeRef = useRef(0);
  const lastFilterTargetRef = useRef(null);
  const [currentUser, setcurrentUser] = useState({});

  const { user } = useAuth();
  const [knockStatus, setKnockStatus] = useState({}); // Tracks emoji state: { friendId: 'default' | 'clicked' }
  const isKnockingRef = useRef({}); // Debounce flag: { friendId: true | false }


  useImperativeHandle(ref, () => ({
    forceSelectFriend: (friend) => {
      console.log('Force selecting friend:', friend.email || friend.fullName);

      // Find the index of this friend in our current list
      const friendIndex = friends.findIndex(f => f.id === friend.id || f.deviceId === friend.deviceId);

      if (friendIndex !== -1) {
        // Set current index to highlight this friend
        setCurrentIndex(friendIndex);

        // Scroll to the friend card
        setTimeout(() => {
          if (flatListRef.current) {
            flatListRef.current.scrollToIndex({
              index: friendIndex,
              animated: true,
              viewPosition: 0.5
            });
          }
        }, 200);
      } else {
        // If the friend isn't in our current list, we need to filter to show them
        console.log('Friend not found in current list, filtering to show them');
        filterForCallFriend(friend.deviceId);
      }
    }
  }));

  const sendKnockNotification = async (friend) => {
    if (!socket || !socket.connected) {
      console.warn("Socket not connected, cannot send knock.");
      // Alert.alert("Error", "Cannot send knock, not connected to server.");
      return;
    }
    if (!friend || !friend.deviceId || !friend.id) {
      console.error("Cannot send knock, invalid friend data:", friend);
      return;
    }

    // Get sender info (replace with actual logic if needed)
    const senderDeviceId = currentDeviceId; // Assuming currentDeviceId is correct
    // You might want to fetch/pass the sender's name too
    const senderName = friend.fullName// Replace with actual sender name logic later


    console.log(`Sending knock to ${friend.fullName} (Device ID: ${friend.deviceId})`);
    socket.emit('send-knock', {
      targetDeviceId: friend.deviceId,
      targetUserId: friend.id,       // Useful for backend logic/lookup
      fcmToken: friend.fcmToken,     // Needed for push notification
      senderDeviceId: senderDeviceId,
      senderName: currentUser,
      // Add any other necessary info
    });
  };

  const handleKnockPressIn = (friend) => {
    // 1. Check debounce flag
    if (isKnockingRef.current[friend.id]) {
      console.log("Knock debounced for:", friend.id);
      return; // Already knocking this friend recently
    }

    // 2. Set debounce flag
    isKnockingRef.current[friend.id] = true;

    // 3. Update visual state (show clicked emoji)
    setKnockStatus(prev => ({ ...prev, [friend.id]: 'clicked' }));

    // 4. Send the *single* notification for this interaction (press/hold)
    sendKnockNotification(friend);

    // 5. (Placeholder for Hold Animation Start)
    // StartPopOutAnimation(friend.id); // You would call your animation logic here
    console.log("Holding knock button for", friend.id); // Placeholder log

    // 6. Set a timer to revert the visual state even if onPressOut doesn't fire quickly
    // (Ensures emoji doesn't stay 'clicked' forever if something goes wrong)
    setTimeout(() => {
      setKnockStatus(prev => {
        // Only revert if it's still in the 'clicked' state
        if (prev[friend.id] === 'clicked') {
          return { ...prev, [friend.id]: 'default' };
        }
        return prev; // Otherwise, keep the current state (might have been reset by onPressOut already)
      });
    }, 600); // Revert after 600ms if still 'clicked'

  };

  const handleKnockPressOut = (friend) => {
    // 1. Reset visual state
    setKnockStatus(prev => ({ ...prev, [friend.id]: 'default' }));

    // 2. (Placeholder for Hold Animation Stop)
    // StopPopOutAnimation(friend.id); // You would call your animation stop logic here
    console.log("Released knock button for", friend.id); // Placeholder log

    // 3. Clear the debounce flag after a delay (e.g., 1 second)
    // This prevents rapid-fire knocks but allows another knock after a short pause.
    setTimeout(() => {
      isKnockingRef.current[friend.id] = false;
      console.log("Debounce flag reset for:", friend.id);
    }, 1000); // 1 second debounce period
  };

  const getcurrentuser = async () => {
    let currentUserName = '';
    try {
      if (user?.uid) {
        const userSnapshot = await database()
          .ref(`users/${user.uid}`)
          .once('value');

        const userData = userSnapshot.val();
        if (userData?.fullName) {
          currentUserName = userData.fullName;
          setcurrentUser(currentUserName)
        }
      }

      if (!currentUserName) {
        currentUserName = user?.displayName || user?.email || "User";
        setcurrentUser(currentUserName)

      }
    } catch (error) {
      console.error('Error getting user name:', error);

      currentUserName = user?.displayName || user?.email || "User";
      setcurrentUser(currentUserName)

    }
  };



  // Initial load of friends list
  useEffect(() => {
    loadFriends();
    getcurrentuser();
    // Set up interval to check for expired modes
    const checkInterval = setInterval(() => {
      checkExpirations();
    }, 60000); // Check every minute

    return () => clearInterval(checkInterval);
  }, []);

  // Handle call state changes in a separate effect
  // In FriendList.js - don't use forwardRef, instead enhance the useEffect

  // FriendList.js

  // ... other code ...

  useEffect(() => {
    if (isInCall && callTargetDeviceId) {
      console.log(`Call state change detected - in call: ${isInCall} with target: ${callTargetDeviceId}`);

      // --- START REVISED CHECK ---
      // Determine if we should skip filtering. ONLY skip if the list *already*
      // contains exactly one friend and it's the correct target device ID.
      const shouldSkipFiltering = (friends.length === 1 && friends[0].deviceId === callTargetDeviceId);

      if (shouldSkipFiltering) {
        console.log('Already showing only the single call friend, skipping filter.');
        // Ensure scroll is disabled even if we skip filtering (belt-and-suspenders)
        if (flatListRef.current && friends.length === 1) {
          // You might not strictly need this scrollToIndex if length is 1,
          // but ensures it's centered if anything went slightly awry.
          try {
            flatListRef.current.scrollToIndex({ index: 0, animated: false, viewPosition: 0.5 });
          } catch (e) { console.error("Error scrolling to index 0", e) }
        }
        return; // Safe to return now
      }
      // --- END REVISED CHECK ---

      // If we didn't skip, proceed with filtering logic, including anti-race condition checks:
      console.log('Condition met to filter friend list for the call.'); // Add this log

      const now = Date.now();
      if (isFilteringRef.current) {
        console.log('Filtering skipped: Already in the middle of a filtering operation.');
        return;
      }
      // Optional: Keep the recent filter check if needed, but the primary issue was the isAlreadyShowing logic
      // if (lastFilterTargetRef.current === callTargetDeviceId &&
      //     now - lastFilterTimeRef.current < 2000) {
      //   console.log('Filtering skipped: Recently filtered this target.');
      //   return;
      // }

      // Set filtering lock
      console.log('Setting filtering lock and scheduling filterForCallFriend...'); // Add this log
      isFilteringRef.current = true;
      lastFilterTimeRef.current = now;
      lastFilterTargetRef.current = callTargetDeviceId;

      // Filter with timeout to release lock
      // Use a very short timeout or even run immediately if race conditions aren't severe
      setTimeout(() => {
        console.log('Executing filterForCallFriend for', callTargetDeviceId); // Add this log
        filterForCallFriend(callTargetDeviceId); // This will now run correctly
        hasScrolledToTargetAfterCall.current = false; // Reset flag

        // Release filtering lock after a delay
        setTimeout(() => {
          console.log('Releasing filtering lock.'); // Add this log
          isFilteringRef.current = false;
        }, 500); // Adjust delay if needed
      }, 50); // Short delay (e.g., 50ms)

    } else if (!isInCall && prevCallTargetId.current && !hasScrolledToTargetAfterCall.current) { // Post-call logic
      console.log('Call ended, loading all friends and keeping target selected.');
      loadFriendsAndKeepTarget(prevCallTargetId.current, mutualViewers);
      // Consider clearing prevCallTargetId after the load function finishes if it's appropriate
      // prevCallTargetId.current = null;
      hasScrolledToTargetAfterCall.current = true; // Mark scroll attempt as done
    }

    // Note: You might want to review the dependencies array. If `friends` or `currentIndex`
    // cause too many re-runs, consider refining dependencies or using functional updates in setState.
  }, [isInCall, callTargetDeviceId, mutualViewers]); // Dependencies might need review based on exact behavior

  // Function to check expired modes and update UI
  const checkExpirations = async () => {
    try {
      // Call the utility function to check and disable expired modes
      await checkAndDisableExpiredModes();

      // Update local state to reflect changes
      const now = Date.now();
      let needsRefresh = false;

      // Check each timer in our local state
      const updatedTimers = { ...friendDNDTimers };
      for (const [friendId, timerInfo] of Object.entries(friendDNDTimers)) {
        if (timerInfo.expiresAt && now >= timerInfo.expiresAt) {
          // This timer has expired
          delete updatedTimers[friendId];
          needsRefresh = true;
        }
      }

      if (needsRefresh) {
        setFriendDNDTimers(updatedTimers);
        await loadFriends(); // Reload friends to get updated DND statuses
      } else {
        // Just force a re-render to update remaining time displays
        setFriendDNDTimers({ ...updatedTimers });
      }
    } catch (error) {
      console.error('Error checking expirations:', error);
    }
  };

  useEffect(() => {
    if (friends.length > 0 && currentIndex >= 0 && currentIndex < friends.length) {
      const selectedFriend = friends[currentIndex];

      // If we're selecting a different friend than before
      if (selectedFriend.deviceId !== prevSelectedFriendId.current) {
        // If we were viewing someone before, tell the server we stopped
        if (prevSelectedFriendId.current) {
          socket.emit('stop-viewing-friend-card', {
            viewerDeviceId: currentDeviceId,
            friendDeviceId: prevSelectedFriendId.current
          });
        }

        console.log("emitting device id", selectedFriend.deviceId)

        // Tell the server we're now viewing this friend
        socket.emit('viewing-friend-card', {
          viewerDeviceId: currentDeviceId,
          friendDeviceId: selectedFriend.deviceId
        });

        // Update our ref to the currently selected friend
        prevSelectedFriendId.current = selectedFriend.deviceId;
      }

      onFriendSelect(selectedFriend);
    }
  }, [currentIndex, friends, currentDeviceId, socket]);

  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      if (prevSelectedFriendId.current) {
        socket.emit('stop-viewing-friend-card', {
          viewerDeviceId: currentDeviceId,
          friendDeviceId: prevSelectedFriendId.current
        });
      }
    };
  }, [socket, currentDeviceId]);

  // Update friends when mutualViewers changes
  useEffect(() => {
    if (friends.length > 0) {
      // Don't trigger a loading state for this simple update
      const updatedFriends = friends.map(friend => ({
        ...friend,
        isMutuallyViewing: mutualViewers && mutualViewers.includes(friend.deviceId)
      }));

      setFriends(updatedFriends);
    }
  }, [mutualViewers]);

  const checkIfBlockedByFriend = async (friend) => {
    return await getDNDStatusWithCache(friend);
  };


  const getDNDStatusWithCache = async (friend) => {
    const cacheKey = friend.id;
    const now = Date.now();
    const cacheTime = 30000; // Cache DND status for 30 seconds

    // Check if we have a recent cached value
    if (
      dndStatusCache.current[cacheKey] !== undefined &&
      lastDNDCheckTimes.current[cacheKey] &&
      now - lastDNDCheckTimes.current[cacheKey] < cacheTime
    ) {
      // Use cached value if it's recent
      return dndStatusCache.current[cacheKey];
    }

    // Otherwise make a fresh check
    try {
      const isBlocked = await checkDNDStatus(friend);

      // Update cache
      dndStatusCache.current[cacheKey] = isBlocked;
      lastDNDCheckTimes.current[cacheKey] = now;

      return isBlocked;
    } catch (error) {
      console.error('Error checking DND status:', error);
      return false;
    }
  };

  const loadFriends = async () => {
    try {
      console.log('Starting to load friends and DND status');
      // Don't set loading state to true immediately to avoid UI flashing

      const [friendsData, dndList] = await Promise.all([
        getFriends(),
        getDNDListForFriends()
      ]);

      // Update DND timers from database
      const newDNDTimers = {};
      for (const [friendId, dndData] of Object.entries(dndList)) {
        if (dndData.status && dndData.expiresAt) {
          const remaining = getRemainingTime(dndData.expiresAt);
          if (remaining > 0) {
            newDNDTimers[friendId] = {
              expiresAt: dndData.expiresAt,
              duration: dndData.duration || 0
            };
          }
        }
      }

      // Update timer state
      setFriendDNDTimers(newDNDTimers);

      // Process each friend and check statuses
      let friendsWithStatus = await Promise.all(
        Object.entries(friendsData).map(async ([id, data]) => {
          // Check DND status
          const isDNDEnabled = dndList[id]?.status || false;
          const isBlockedByFriend = await checkDNDStatus(data);

          // Check silence mode
          const isSilenceModeEnabled = await checkSilenceMode(id);

          // Check busy status
          const busySnapshot = await database()
            .ref(`users/${id}/callStatus/busy`)
            .once('value');
          const isBusy = busySnapshot.val() === true;

          // Get DND expiration data if available
          const dndExpiresAt = dndList[id]?.expiresAt;
          const dndRemaining = dndExpiresAt ? getRemainingTime(dndExpiresAt) : 0;

          console.log(`Friend ${data.email} statuses - DND: ${isDNDEnabled}, blocks us: ${isBlockedByFriend}, silence: ${isSilenceModeEnabled}, busy: ${isBusy}`);

          return {
            id,
            ...data,
            isDNDEnabled,
            isBlockedByFriend,
            isSilenceModeEnabled,
            isBusy,
            dndExpiresAt,
            dndRemaining,
            isMutuallyViewing: mutualViewers && mutualViewers.includes(data.deviceId)
          };
        })
      );

      // Filter friends if in a call to only show the friend in the call
      if (isInCall && callTargetDeviceId) {
        console.log('In call with device ID:', callTargetDeviceId, 'filtering friend list');

        // Find the friend in the call
        const callFriend = friendsWithStatus.find(friend => friend.deviceId === callTargetDeviceId);

        // If we found the friend, only show them
        if (callFriend) {
          friendsWithStatus = [callFriend];
          // Set current index to 0 since there's only one friend in the list
          setCurrentIndex(0);
        }
      }

      console.log('Processed friends list:', friendsWithStatus);
      setFriends(friendsWithStatus);
      setLoading(false);
    } catch (error) {
      console.error('Error loading friends:', error);
      setLoading(false);
      // Use the failsafe method as a backup
      loadFriendsWithoutError();
    }
  };


  const filterForCallFriend = async (targetDeviceId) => {
    try {
      // Skip if we're already showing only this friend
      if (friends.length === 1 && friends[0].deviceId === targetDeviceId) {
        console.log('Already showing only the call friend, skipping filter');
        return;
      }

      console.log('Filtering for call friend with device ID:', targetDeviceId);

      // Store the target device ID
      prevCallTargetId.current = targetDeviceId;

      // Create a simple cache key for this operation to prevent duplicate filter operations
      const cacheKey = `filter_${targetDeviceId}`;

      // Check if we filtered this friend recently (within 3 seconds)
      const now = Date.now();
      if (filterOperationsCache.current[cacheKey] &&
        now - filterOperationsCache.current[cacheKey] < 3000) {
        console.log('Recent filter operation for this target detected, skipping');
        return;
      }
      filterOperationsCache.current[cacheKey] = now;

      // Get fresh data
      const friendsData = await getFriends();
      const dndList = await getDNDListForFriends();

      if (friendsData) {
        // Create a map for quick friend lookup by device ID
        const friendsByDeviceId = {};

        // Process all friends
        const allFriends = await Promise.all(
          Object.entries(friendsData).map(async ([id, data]) => {
            // Process status with caching
            const isDNDEnabled = dndList[id]?.status || false;

            // Use cached value if available
            let isBlockedByFriend;
            if (dndStatusCache.current[id] !== undefined &&
              lastDNDCheckTimes.current[id] &&
              Date.now() - lastDNDCheckTimes.current[id] < 30000) {
              isBlockedByFriend = dndStatusCache.current[id];
            } else {
              isBlockedByFriend = await checkDNDStatus(data);
              dndStatusCache.current[id] = isBlockedByFriend;
              lastDNDCheckTimes.current[id] = Date.now();
            }

            const isSilenceModeEnabled = await checkSilenceMode(id);

            const busySnapshot = await database()
              .ref(`users/${id}/callStatus/busy`)
              .once('value');
            const isBusy = busySnapshot.val() === true;

            const dndExpiresAt = dndList[id]?.expiresAt;
            const dndRemaining = dndExpiresAt ? getRemainingTime(dndExpiresAt) : 0;

            const friend = {
              id,
              ...data,
              isDNDEnabled,
              isBlockedByFriend,
              isSilenceModeEnabled,
              isBusy,
              dndExpiresAt,
              dndRemaining,
              isMutuallyViewing: mutualViewers && mutualViewers.includes(data.deviceId)
            };

            // Add to device ID lookup map
            if (data.deviceId) {
              friendsByDeviceId[data.deviceId] = friend;
            }

            return friend;
          })
        );

        // Try to find friend by device ID first
        let callFriend = friendsByDeviceId[targetDeviceId];

        // If not found by device ID, identify by busy status
        if (!callFriend) {
          console.log('Exact device ID match not found, looking for busy friends');
          callFriend = allFriends.find(friend => friend.isBusy === true);
        }

        if (callFriend) {
          console.log('Found call friend:', callFriend.fullName || callFriend.email);

          // Update the list to show only this friend
          setFriends([callFriend]);
          setCurrentIndex(0);
          onFriendSelect(callFriend);

          // Scroll to make sure it's visible
          setTimeout(() => {
            if (flatListRef.current) {
              try {
                flatListRef.current.scrollToIndex({
                  index: 0,
                  animated: false,
                  viewPosition: 0.5
                });
              } catch (error) {
                console.error('Error scrolling to index:', error);
              }
            }
          }, 100);
        }
      }

    } catch (error) {
      console.error('Error filtering for call friend:', error);
      isFilteringRef.current = false;

    }
  };


  const handleGhostCall = (friend) => {
    try {
      console.log('Ghosting call from:', friend.email || friend.fullName);

      // Send ghost notification to the server
      socket.emit('ghost-call', {
        roomName: prevCallTargetId.current,
        targetDeviceId: friend.deviceId,
        fcmToken: friend.fcmToken
      });

      // End the call on our side (same as hanging up normally)
      if (onGhostCall) {
        onGhostCall(friend);
      }
    } catch (error) {
      console.error('Error ghosting call:', error);
    }
  };


  // New function to load all friends but keep the last call target selected
  const loadFriendsAndKeepTarget = async (lastCallTargetId, currentMutualViewers) => {
    try {
      console.log('Loading all friends but keeping target selected:', lastCallTargetId);

      // Ensure we have a valid array for mutual viewers
      const viewersList = currentMutualViewers || [];

      // Fetch fresh friend data
      const [friendsData, dndList] = await Promise.all([
        getFriends(),
        getDNDListForFriends()
      ]);

      // Update DND timers from database
      const newDNDTimers = {};
      for (const [friendId, dndData] of Object.entries(dndList)) {
        if (dndData.status && dndData.expiresAt) {
          const remaining = getRemainingTime(dndData.expiresAt);
          if (remaining > 0) {
            newDNDTimers[friendId] = {
              expiresAt: dndData.expiresAt,
              duration: dndData.duration || 0
            };
          }
        }
      }

      // Update timer state
      setFriendDNDTimers(newDNDTimers);

      // Process all friends with their statuses
      const friendsWithStatus = await Promise.all(
        Object.entries(friendsData).map(async ([id, data]) => {
          const isDNDEnabled = dndList[id]?.status || false;
          const isBlockedByFriend = await checkDNDStatus(data);
          const isSilenceModeEnabled = await checkSilenceMode(id);

          const busySnapshot = await database()
            .ref(`users/${id}/callStatus/busy`)
            .once('value');
          const isBusy = busySnapshot.val() === true;

          // Get DND expiration data if available
          const dndExpiresAt = dndList[id]?.expiresAt;
          const dndRemaining = dndExpiresAt ? getRemainingTime(dndExpiresAt) : 0;

          // Use the explicitly passed mutual viewers list
          return {
            id,
            ...data,
            isDNDEnabled,
            isBlockedByFriend,
            isSilenceModeEnabled,
            isBusy,
            dndExpiresAt,
            dndRemaining,
            isMutuallyViewing: viewersList.includes(data.deviceId)
          };
        })
      );

      // Find the index of the friend we were just on a call with
      const targetIndex = friendsWithStatus.findIndex(
        friend => friend.deviceId === lastCallTargetId
      );

      console.log('Target friend index:', targetIndex);

      // Update the friends list with all friends
      setFriends(friendsWithStatus);

      if (targetIndex !== -1) {
        // Set the current index to the target friend's position
        setCurrentIndex(targetIndex);

        // Make sure to select this friend
        onFriendSelect(friendsWithStatus[targetIndex]);

        // Update the previous selected friend ref
        prevSelectedFriendId.current = lastCallTargetId;

        // Scroll to the target friend's position only once
        setTimeout(() => {
          if (flatListRef.current) {
            try {
              flatListRef.current.scrollToIndex({
                index: targetIndex,
                animated: true,
                viewPosition: 0.5
              });

              // We've now scrolled to the target, so mark it as done
              hasScrolledToTargetAfterCall.current = true;
            } catch (error) {
              console.error('Error scrolling to index:', error);
            }
          }
        }, 200);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading friends and keeping target:', error);
      // Use the failsafe method as a backup
      loadFriendsWithoutError();
    }
  };

  // Add a fail-safe method to load friends if the other methods fail
  const loadFriendsWithoutError = async () => {
    try {
      console.log('Loading friends with failsafe method');
      const friendsData = await getFriends();

      if (friendsData) {
        // Simple approach without detailed status checks to minimize error chances
        const basicFriendsList = Object.entries(friendsData).map(([id, data]) => ({
          id,
          ...data,
          isDNDEnabled: false,
          isBlockedByFriend: false,
          isSilenceModeEnabled: false,
          isBusy: false,
          dndExpiresAt: null,
          dndRemaining: 0,
          isMutuallyViewing: false
        }));

        setFriends(basicFriendsList);

        if (basicFriendsList.length > 0) {
          setCurrentIndex(0);
          onFriendSelect(basicFriendsList[0]);
        }
      }

      setLoading(false);
    } catch (error) {
      console.error('Error in failsafe friend loading:', error);
      setLoading(false);
      setFriends([]);
    }
  };

  // Handle DND toggle - show duration modal or toggle off
  const handleDNDToggle = async (friend) => {
    try {
      console.log('Starting DND toggle for friend:', friend);

      if (friend.isDNDEnabled) {
        // If already on, turn it off immediately
        setLoadingDND(prev => ({ ...prev, [friend.id]: true }));
        await toggleDNDStatus(friend);

        // Remove from timers
        setFriendDNDTimers(prev => {
          const newTimers = { ...prev };
          delete newTimers[friend.id];
          return newTimers;
        });

        await loadFriends();
        setLoadingDND(prev => ({ ...prev, [friend.id]: false }));
      } else {
        // If turning on, show duration modal
        setSelectedFriendForDND(friend);
        setShowDurationModal(true);
      }
    } catch (error) {
      console.error('Error in handleDNDToggle:', error);
      setLoadingDND(prev => ({ ...prev, [friend.id]: false }));
    }
  };

  // Handle duration selection from modal
  const handleDurationSelected = async (duration) => {
    try {
      setShowDurationModal(false);

      if (!selectedFriendForDND) return;

      const friend = selectedFriendForDND;
      setLoadingDND(prev => ({ ...prev, [friend.id]: true }));

      // Toggle DND with selected duration
      await toggleDNDStatus(friend, duration);

      // Update local timer state
      if (duration > 0) {
        const expiresAt = Date.now() + (duration * 60 * 1000);
        setFriendDNDTimers(prev => ({
          ...prev,
          [friend.id]: {
            expiresAt,
            duration
          }
        }));
      }

      await loadFriends();
    } catch (error) {
      console.error('Error setting DND with duration:', error);
    } finally {
      setLoadingDND(prev => ({ ...prev, [selectedFriendForDND?.id]: false }));
      setSelectedFriendForDND(null);
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      const newIndex = viewableItems[0].index;
      const newFriend = friends[newIndex]; // Get the friend object at the new index

      // Check if we have a previous call target stored and if the user
      // has scrolled to a *different* friend *after* the post-call centering happened.
      if (prevCallTargetId.current &&
        hasScrolledToTargetAfterCall.current && // Ensures this only happens after post-call centering
        newFriend && newFriend.deviceId !== prevCallTargetId.current) {
        console.log('User manually scrolled away from previous call target. Clearing prevCallTargetId.');
        prevCallTargetId.current = null; // Clear the previous target ID
        // Optional: If you set hasScrolledToTargetAfterCall back to false, uncomment below
        // hasScrolledToTargetAfterCall.current = false; // Reset flag if needed for subsequent calls ending
      }

      // Always update the current index
      setCurrentIndex(newIndex);
    }
  }).current;

  // Get DND button text based on timer
  const getDNDButtonText = (friend) => {
    if (!friend.isDNDEnabled) return 'DND Off';

    const timer = friendDNDTimers[friend.id];
    if (!timer || !timer.expiresAt) return 'DND On';

    const remaining = getRemainingTime(timer.expiresAt);
    if (remaining <= 0) return 'DND On';

    return `DND (${formatTimeRemaining(remaining, true)})`;
  };

  const getInitial = (email) => {
    return email && typeof email === 'string' ? email[0].toUpperCase() : '?';
  };

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 100,
  }).current;

  const renderCard = ({ item: friend, index }) => {

    let scale = 1;
    let opacity = 1;


    if (!isInCall && friends.length > 1) {
      const inputRange = [
        (index - 1) * (CARD_WIDTH + SPACING),
        index * (CARD_WIDTH + SPACING),
        (index + 1) * (CARD_WIDTH + SPACING),
      ];

      scale = scrollX.interpolate({
        inputRange,
        outputRange: [SIDE_CARD_SCALE, 1, SIDE_CARD_SCALE],
        extrapolate: 'clamp',
      });

      opacity = scrollX.interpolate({
        inputRange,
        outputRange: [SIDE_CARD_OPACITY, 1, SIDE_CARD_OPACITY],
        extrapolate: 'clamp',
      });

    }
    const isIncomingCaller = isInCall &&
      !isCallInitiator &&
      friend.deviceId === callTargetDeviceId;

    const currentKnockEmoji = knockStatus[friend.id] === 'clicked'
      ? CLICKED_KNOCK_EMOJI
      : DEFAULT_KNOCK_EMOJI;



    return (
      <Animated.View
        style={[
          styles.card,
          {
            // Apply scale and opacity conditionally
            transform: [{ scale }],
            opacity,
            borderWidth: isIncomingCaller ? 3 : 0,
            borderColor: isIncomingCaller ? '#4CAF50' : 'transparent',
            // Ensure margin is applied correctly even for single item
            marginHorizontal: SPACING / 2,
          },
        ]}
      >
        {isIncomingCaller && (
          <View style={styles.incomingCallBadge}>
            <Icon name="phone-incoming" size={16} color="#FFF" />
            <Text style={styles.incomingCallText}>Incoming Call</Text>
          </View>
        )}

        <View style={styles.cardContent}>
          <View style={styles.avatar}>
            <Text style={styles.initial}>
              {friend.fullName ? friend.fullName[0].toUpperCase() : getInitial(friend.email)}
            </Text>
          </View>
          <Text style={styles.name}>
            {friend.fullName || ''}
          </Text>
          <Text style={styles.email}>{friend.email}</Text>

          {friend.isSilenceModeEnabled && (
            <View style={styles.silenceModeBanner}>
              <Icon name="volume-off" size={20} color="#FFF" />
              <Text style={styles.silenceModeText}>Silence Mode</Text>
            </View>
          )}

          {/* Show "User is here" indicator if mutually viewing */}
          {friend.isMutuallyViewing && (
            <View style={styles.userHereBanner}>
              <Icon name="eye" size={20} color="#FFF" />
              <Text style={styles.userHereText}>User is here</Text>
            </View>
          )}

          {/* Show "In Call" indicator when this is the active call friend */}
          {isInCall && friend.deviceId === callTargetDeviceId && (
            <View style={styles.inCallBanner}>
              <Icon name="phone" size={20} color="#FFF" />
              <Text style={styles.inCallText}>In Call</Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.dndButton,
              friend.isDNDEnabled && styles.dndButtonEnabled
            ]}
            onPress={() => handleDNDToggle(friend)}
            disabled={loadingDND[friend.id]}
          >
            {loadingDND[friend.id] ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <>
                <Icon
                  name={friend.isDNDEnabled ? "bell-off" : "bell"}
                  size={24}
                  color="#FFF"
                />
                <Text style={styles.dndButtonText}>
                  {getDNDButtonText(friend)}
                </Text>

                {/* Show timer icon if there's a timer */}
                {friend.isDNDEnabled && friendDNDTimers[friend.id]?.expiresAt && (
                  <View style={styles.timerChip}>
                    <Icon name="timer-outline" size={16} color="#FFF" />
                  </View>
                )}
              </>
            )}
          </TouchableOpacity>

          {/* Show expiration info if DND has a timer */}
          {friend.isDNDEnabled && friendDNDTimers[friend.id]?.expiresAt && (
            <View style={styles.dndTimeContainer}>
              <Text style={styles.dndTimeText}>
                Off in {formatTimeRemaining(getRemainingTime(friendDNDTimers[friend.id].expiresAt))}
              </Text>
            </View>
          )}


          <TouchableOpacity
            style={styles.knockButtonContainer}
            onPressIn={() => handleKnockPressIn(friend)}
            onPressOut={() => handleKnockPressOut(friend)}
            activeOpacity={0.7} // Feedback on press
          >
            <Text style={styles.knockEmoji}>{currentKnockEmoji}</Text>
            <Text style={styles.knockText}>Knock</Text>
          </TouchableOpacity>



          {friend.isBlockedByFriend && (
            <View style={styles.blockedBanner}>
              <Icon name="block-helper" size={20} color="#FFF" />
              <Text style={styles.blockedText}>You are on DND</Text>
            </View>
          )}

          {isInCall && !isCallInitiator && friend.deviceId === callTargetDeviceId && (
            <TouchableOpacity
              style={styles.ghostButton}
              onPress={() => handleGhostCall(friend)}
            >
              <Icon name="ghost" size={24} color="#FFF" />
              <Text style={styles.ghostButtonText}>Ghost Call</Text>
            </TouchableOpacity>
          )}

        </View>
      </Animated.View>
    );
  };

  // Instead of showing a loading indicator, we'll continue with the current friends list
  // until the new data is ready. This provides a smoother transition for the user.

  // Show no friends message if the list is empty
  if (friends.length === 0 && !loading) {
    return (
      <View style={styles.container}>
        <View style={styles.noFriendsCard}>
          {isInCall ? (
            <Text style={styles.noFriendsText}>Connecting to call...</Text>
          ) : (
            <>
              <Text style={styles.noFriendsText}>No friends added yet</Text>
              <Text style={styles.noFriendsSubtext}>
                Go to the Friends tab to add friends
              </Text>
            </>
          )}
        </View>
      </View>
    );
  }

  if (loading && friends.length === 0) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#FFF" />
      </View>
    );
  }


  return (
    <GestureHandlerRootView style={styles.container}>
      {isInCall && (
        <View style={styles.callIndicatorBar}>
          <Icon name="phone" size={16} color="#FFF" />
          <Text style={styles.callIndicatorText}>In Call</Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={friends} // This should contain only 1 friend when isInCall is true
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        // Use snapToInterval only when scrolling is needed
        snapToInterval={friends.length > 1 ? CARD_WIDTH + SPACING : null}
        decelerationRate="fast"
        bounces={friends.length > 1} // Prevent bouncing for single item
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false } // useNativeDriver is false, which is needed for scrollX interpolation on non-transform styles like opacity
        )}
        // Conditional contentContainerStyle
        contentContainerStyle={
          friends.length > 1
            ? styles.flatListContent // Original style with padding for centering in carousel
            : styles.flatListContentSingle // New style for single centered item
        }
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        snapToAlignment="center"
        scrollEnabled={friends.length > 1} // Disable scrolling if only one friend
        // Ensure FlatList itself takes up the necessary space
        style={styles.flatList}
      />
      {/* Duration Selection Modal */}
      <DurationSelectionModal
        visible={showDurationModal}
        onClose={() => {
          setShowDurationModal(false);
          setSelectedFriendForDND(null);
        }}
        onSelectDuration={handleDurationSelected}
        title="Enable DND Mode"
      />
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flatList: {
    flexGrow: 0, // Prevent FlatList from taking more space than needed
    height: height * 0.65, // Explicit height for the list area
  },
  flatListContent: {
    // Original style for carousel centering (multiple items)
    paddingHorizontal: (width - CARD_WIDTH) / 2,
    alignItems: 'center', // Center items vertically if needed
  },
  flatListContentSingle: {
    // New style for single item centering
    flexGrow: 1, // Allow content to grow to fill container
    justifyContent: 'center', // Center card vertically within the FlatList height
    alignItems: 'center', // Center card horizontally
    // No horizontal padding needed here
  },
  card: {
    width: CARD_WIDTH,
    height: height * 0.6, // Keep card height consistent
    backgroundColor: '#8B5CF6',
    borderRadius: 24,
    // marginHorizontal: SPACING / 2, // Applied in renderCard conditionally
    overflow: 'hidden',
  },
  // ... Keep the rest of your styles ...
  cardContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callIndicatorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    position: 'absolute',
    top: 10,
    zIndex: 10,
  },
  callIndicatorText: {
    color: '#FFF',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  avatar: {
    width: CARD_WIDTH * 0.5,
    height: CARD_WIDTH * 0.5,
    borderRadius: CARD_WIDTH * 0.25,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  initial: {
    color: '#FFF',
    fontSize: CARD_WIDTH * 0.25,
    fontWeight: 'bold',
  },
  dndButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 10,
  },
  dndButtonEnabled: {
    backgroundColor: '#FF4444',
  },
  dndButtonText: {
    color: '#FFF',
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '500',
  },
  noFriendsCard: {
    width: CARD_WIDTH,
    height: height * 0.25,
    backgroundColor: '#8B5CF6',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noFriendsText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  noFriendsSubtext: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 16,
    textAlign: 'center',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24, // Match the width of normal button content
    paddingVertical: 4,
  },
  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 12,
  },
  blockedText: {
    color: '#FFF',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  userHereBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 12,
    marginBottom: 10,
  },
  userHereText: {
    color: '#FFF',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  inCallBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2196F3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 12,
    marginBottom: 10,
  },
  inCallText: {
    color: '#FFF',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  name: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
  },
  email: {
    color: 'rgba(255, 255, 255, 0.8)', // Make email slightly transparent
    fontSize: 16,
    marginTop: 8,
    marginBottom: 20,
    textAlign: 'center',
  },
  busyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF9800', // Orange color for busy status
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 12,
    marginBottom: 10,
  },
  busyText: {
    color: '#FFF',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  silenceModeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF4081', // Pink color for silence mode
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 6,
    marginBottom: 6,
  },
  silenceModeText: {
    color: '#FFF',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  dndTimeContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  dndTimeText: {
    color: '#FFF',
    fontSize: 12,
  },
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 5,
  },
  ghostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#FFF',
  },
  ghostButtonText: {
    color: '#FFF',
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '500',
  },

  incomingCallBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#4CAF50',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    zIndex: 10,
  },
  incomingCallText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 12,
    marginLeft: 5,
  },
  knockButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50', // Green color for knock
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 15, // Space above knock button
    minWidth: 120, // Minimum width
  },
  knockEmoji: {
    fontSize: 20,
    marginRight: 8,
  },
  knockText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default FriendList;