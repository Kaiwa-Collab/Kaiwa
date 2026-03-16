/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './android/app/src/App';
import { name as appName } from './app.json';


if (process.env.NODE_ENV === "production") {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}

// console.log("This should NOT appear if suppression works");

AppRegistry.registerComponent(appName, () => App);
