// 
import React from 'react';
import AuthWrapper from './screen/AuthWrapper';
import { UserProvider } from './users'; // import from your User.js

export default function App() {
  return (
    <UserProvider>
      <AuthWrapper />
    </UserProvider>
  );
}
