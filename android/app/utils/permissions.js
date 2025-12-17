import { PermissionsAndroid, Alert, Linking, Platform } from 'react-native';

export const requestcamerapermission = async () => {
  try {
    // Check if already granted
    const alreadyGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.CAMERA
    );
    
    if (alreadyGranted) {
      return true;
    }

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Camera Permission',
        message: 'DevLink wants to access your camera',
        buttonNeutral: 'Ask me later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      }
    );

    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      return true;
    } else if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Alert.alert(
        'Camera Permission Blocked',
        'Camera permission has been blocked. Please enable it in your device settings to use this feature.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Open Settings', 
            onPress: () => Linking.openSettings() 
          }
        ]
      );
      return false;
    } else {
      // User denied but didn't select "never ask again"
      return false;
    }
  } catch (error) {
    return false;
  }
};

export const requestgallerypermission = async () => {
  try {
    // For Android 13+ (API 33+), use READ_MEDIA_IMAGES
    // For older versions, use READ_EXTERNAL_STORAGE
    const permission = Platform.Version >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;

    // Check if already granted
    const alreadyGranted = await PermissionsAndroid.check(permission);
    
    if (alreadyGranted) {
      return true;
    }

    const granted = await PermissionsAndroid.request(
      permission,
      {
        title: 'Photo Library Permission',
        message: 'This app needs access to your photos to select images.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      }
    );

    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      return true;
    } else if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Alert.alert(
        'Photo Library Permission Blocked',
        'Photo library permission has been blocked. Please enable it in your device settings to use this feature.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => Linking.openSettings()
          }
        ]
      );
      return false;
    } else {
      // User denied but didn't select "never ask again"
      return false;
    }
  } catch (error) {
    return false;
  }
};

export const checkcamerapermission = async () => {
  try {
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.CAMERA
    );
    return granted;
  } catch (error) {
    return false;
  }
};

export const checkgallerypermissions = async () => {
  try {
    const permission = Platform.Version >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;

    const granted = await PermissionsAndroid.check(permission);
    return granted;
  } catch (error) {
    return false;
  }
};

export const requestwritestorage = async () => {
  try {
    if (Platform.Version >= 33) {
      return true; // Not needed on Android 13+
    }

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      {
        title: 'Storage Permission',
        message: 'DevLink needs access to save files.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      }
    );

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (error) {
    return false;
  }
};