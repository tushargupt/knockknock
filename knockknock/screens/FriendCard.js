import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const FriendCard = ({ friend, onPress }) => {
  const getInitial = (email) => {
    return email ? email[0].toUpperCase() : '?';
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.avatar}>
        <Text style={styles.initial}>{getInitial(friend.email)}</Text>
      </View>
      <Text style={styles.email}>{friend.email}</Text>
      <Text style={styles.id}>ID: {friend.uniqueId}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#222',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  initial: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  email: {
    color: '#FFF',
    fontSize: 16,
    flex: 1,
  },
  id: {
    color: '#999',
    fontSize: 12,
  },
});

export default FriendCard;