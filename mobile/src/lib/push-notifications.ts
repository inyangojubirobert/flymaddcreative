import Constants, { ExecutionEnvironment } from 'expo-constants';

type PushNotifications = typeof import('expo-notifications');

/** Expo Go dropped Android remote push in SDK 53. Only load the module in a real build. */
export function isPushSupportedInThisClient() {
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
    && Constants.appOwnership !== 'expo';
}

export function loadPushNotifications(): PushNotifications | null {
  if (!isPushSupportedInThisClient()) return null;
  try {
    return require('expo-notifications') as PushNotifications;
  } catch {
    return null;
  }
}
