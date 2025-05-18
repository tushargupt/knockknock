// callPersistence.js
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CallState = {
  IDLE: 'IDLE',
  IN_CALL: 'IN_CALL',
  BACKGROUND_CALL: 'BACKGROUND_CALL'
};

export const saveCallState = async ({
  state = CallState.IDLE,
  roomName = null,
  targetDeviceId = null,
  isCallInitiator = false,
  timestamp = Date.now()
}) => {
  try {
    const callData = {
      state,
      roomName,
      targetDeviceId,
      isCallInitiator,
      timestamp
    };
    await AsyncStorage.setItem('@call_state', JSON.stringify(callData));
    console.log('Call state saved:', callData);
  } catch (error) {
    console.error('Error saving call state:', error);
  }
};

export const loadCallState = async () => {
  try {
    const storedState = await AsyncStorage.getItem('@call_state');
    if (storedState) {
      const callData = JSON.parse(storedState);
      // Check if the call is too old (e.g., more than 4 hours)
      const isExpired = Date.now() - callData.timestamp > 4 * 60 * 60 * 1000;
      
      if (isExpired) {
        await clearCallState();
        return null;
      }
      return callData;
    }
    return null;
  } catch (error) {
    console.error('Error loading call state:', error);
    return null;
  }
};

export const clearCallState = async () => {
  try {
    await AsyncStorage.removeItem('@call_state');
    console.log('Call state cleared');
  } catch (error) {
    console.error('Error clearing call state:', error);
  }
};

export const saveActiveCallData = async (callData) => {
  try {
    const activeCallData = {
      roomName: callData.roomName,
      producerId: callData.producerId,
      consumerIds: callData.consumerIds,
      transportIds: callData.transportIds
    };
    await AsyncStorage.setItem('@active_call_data', JSON.stringify(activeCallData));
    console.log('Saved active call data:', activeCallData);
  } catch (error) {
    console.error('Error saving active call data:', error);
  }
};

export const getActiveCallData = async () => {
  try {
    const data = await AsyncStorage.getItem('@active_call_data');
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Error getting active call data:', error);
    return null;
  }
};

export const clearActiveCallData = async () => {
  try {
    await AsyncStorage.removeItem('@active_call_data');
  } catch (error) {
    console.error('Error clearing active call data:', error);
  }
};