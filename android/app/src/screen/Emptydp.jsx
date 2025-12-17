import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function EmptydP({ size = 50, initials = '' }) {
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initials, { fontSize: size / 2.5 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 2,
    borderColor: '#ccc',
    backgroundColor: '#000', // or any background fallback
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
