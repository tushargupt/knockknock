import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// Configure Google Sign In
// Replace with your own web client ID from Google Cloud Console
export const configureGoogleSignIn = () => {
  console.log('Configuring Google Sign-In...');
  try {
    GoogleSignin.configure({
      webClientId: '194725952-8rnfnqc83jdn04jt05fkb5uo3mmghbsk.apps.googleusercontent.com', // Get this from Google Cloud Console
      offlineAccess: true,
    });
    console.log('Google Sign-In configured successfully');
  } catch (error) {
    console.error('Error configuring Google Sign-In:', error);
  }
};

export const signUp = async (email, password) => {
  try {
    const userCredential = await auth().createUserWithEmailAndPassword(email, password);
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { user: userCredential.user, error: null };
  } catch (error) {
    let errorMessage = 'An error occurred during sign up';
    switch (error.code) {
      case 'auth/email-already-in-use':
        errorMessage = 'Email address is already in use';
        break;
      case 'auth/invalid-email':
        errorMessage = 'Invalid email address';
        break;
      case 'auth/weak-password':
        errorMessage = 'Password is too weak';
        break;
      default:
        errorMessage = error.message;
    }
    return { user: null, error: errorMessage };
  }
};

export const signIn = async (email, password) => {
  try {
    const userCredential = await auth().signInWithEmailAndPassword(email, password);
    return { user: userCredential.user, error: null };
  } catch (error) {
    let errorMessage = 'An error occurred during sign in';
    switch (error.code) {
      case 'auth/invalid-email':
        errorMessage = 'Invalid email address';
        break;
      case 'auth/user-disabled':
        errorMessage = 'User account has been disabled';
        break;
      case 'auth/user-not-found':
        errorMessage = 'User not found';
        break;
      case 'auth/wrong-password':
        errorMessage = 'Invalid password';
        break;
      default:
        errorMessage = error.message;
    }
    return { user: null, error: errorMessage };
  }
};

// New Google authentication function
export const signInWithGoogle = async () => {
  try {
    console.log('Step 1: Checking if device supports Google Play Services');
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      console.log('Google Play Services are available');
    } catch (playServicesError) {
      console.error('Google Play Services error:', playServicesError);
      throw playServicesError;
    }
    
    console.log('Step 2: Attempting to get ID token from Google Sign In');
    let idToken;
    try {
      const signInResult = await GoogleSignin.signIn();
      console.log('Google Sign In successful', signInResult);
      // Fix: correctly access the idToken inside the data object
      idToken = signInResult.idToken || (signInResult.data && signInResult.data.idToken);
      if (!idToken) {
        console.error('ID token structure:', JSON.stringify(signInResult));
        throw new Error('Could not find ID token in Google Sign In response');
      }
      console.log('Successfully retrieved ID token');
    } catch (signInError) {
      console.error('Google Sign In error:', signInError);
      throw signInError;
    }
    
    console.log('Step 3: Creating Google credential with token');
    const googleCredential = auth.GoogleAuthProvider.credential(idToken);
    
    console.log('Step 4: Signing in with Firebase using credential');
    try {
      const userCredential = await auth().signInWithCredential(googleCredential);
      console.log('Firebase sign in successful');
      
      return { 
        user: userCredential.user, 
        error: null,
        additionalUserInfo: userCredential.additionalUserInfo
      };
    } catch (firebaseError) {
      console.error('Firebase sign in error:', firebaseError);
      throw firebaseError;
    }
  } catch (error) {
    console.error('Google Sign-In error details:', error);
    let errorMessage = 'An error occurred during Google sign in';
    
    // Check if error object exists and has a code property
    if (error && error.code) {
      switch (error.code) {
        case 'auth/account-exists-with-different-credential':
          errorMessage = 'An account already exists with the same email address but different sign-in credentials';
          break;
        case 'auth/invalid-credential':
          errorMessage = 'The credential is malformed or has expired';
          break;
        case 'auth/operation-not-allowed':
          errorMessage = 'Google accounts are not enabled for this app';
          break;
        case 'auth/user-disabled':
          errorMessage = 'User account has been disabled';
          break;
        case 'cancelled':
          errorMessage = 'Google sign-in was cancelled';
          break;
        default:
          // Only use error.message if it exists
          errorMessage = error.message || 'Failed to sign in with Google';
      }
    } else if (error && typeof error === 'object') {
      // Try to get any useful information from the error object
      if (error.message) {
        errorMessage = error.message;
      }
    }
    
    return { user: null, error: errorMessage };
  }
};

export const signOut = async () => {
  try {
    // First sign out from Firebase
    await auth().signOut();
    console.log('Firebase sign out successful');
    
    // Then check if there was a previous Google sign-in and handle it
    try {
      // Use the correct method: hasPreviousSignIn() instead of isSignedIn()
      const hasPreviousGoogleSignIn = GoogleSignin.hasPreviousSignIn();
      
      if (hasPreviousGoogleSignIn) {
        // Use try/catch for Google operations specifically
        try {
          await GoogleSignin.revokeAccess();
          await GoogleSignin.signOut();
          console.log('Google sign out successful');
        } catch (googleError) {
          console.error('Google sign out error:', googleError);
          // Non-critical error, still consider overall sign-out successful
        }
      }
    } catch (googleCheckError) {
      console.error('Error checking Google sign-in status:', googleCheckError);
      // Non-critical error, still consider overall sign-out successful
    }
    
    return { error: null };
  } catch (error) {
    console.error('Sign out error:', error);
    return { error: 'An error occurred during sign out' };
  }
};

export const resetPassword = async (email) => {
  try {
    await auth().sendPasswordResetEmail(email);
    return { error: null };
  } catch (error) {
    return { error: 'Failed to send password reset email' };
  }
};