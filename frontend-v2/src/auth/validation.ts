export function mapFirebaseAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code)
      : '';

  switch (code) {
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'SIGN_IN_CANCELLED':
      return 'Sign-in was cancelled';
    case 'IN_PROGRESS':
      return 'Sign-in is already in progress';
    case 'PLAY_SERVICES_NOT_AVAILABLE':
      return 'Google Play Services is required for Google sign-in on this device';
    default:
      if (error instanceof Error && error.message) {
        return error.message;
      }
      return 'Something went wrong. Please try again.';
  }
}
