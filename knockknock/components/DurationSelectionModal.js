// components/DurationSelectionModal.js
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const DurationSelectionModal = ({ 
  visible,
  onClose,
  onSelectDuration,
  title,
}) => {
  // Duration options in minutes
  const durationOptions = [
    { label: '15 minutes', value: 15 },
    { label: '1 hour', value: 60 },
    { label: '4 hours', value: 240 },
    { label: '8 hours', value: 480 },
    { label: 'Until I turn it off', value: 0 } // 0 means indefinite
  ];

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity 
              style={styles.closeButton} 
              onPress={onClose}
            >
              <Icon name="close" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>
          
          <Text style={styles.modalSubtitle}>How long?</Text>
          
          {durationOptions.map((option, index) => (
            <TouchableOpacity
              key={index}
              style={styles.durationOption}
              onPress={() => onSelectDuration(option.value)}
            >
              <Text style={styles.durationText}>{option.label}</Text>
              {option.value > 0 && (
                <Icon name="timer-outline" size={20} color="#FFF" />
              )}
              {option.value === 0 && (
                <Icon name="infinity" size={20} color="#FFF" />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#222',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 5,
  },
  modalSubtitle: {
    color: '#AAA',
    fontSize: 16,
    marginBottom: 20,
  },
  durationOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#333',
    marginBottom: 12,
  },
  durationText: {
    color: '#FFF',
    fontSize: 16,
  }
});

export default DurationSelectionModal;