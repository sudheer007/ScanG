// Test IDs for the auth feature (login, logout) — consumed via
// React Native's `testID` prop on TouchableOpacity / Pressable / TextInput /
// Button / Switch and friends. Add new keys here as you wire up additional
// auth UI; see ./index.js for the recipe to add a new feature file.
//
// React Native uses `testID` (camelCase, no dash), not `data-testid`:
//   import { LOGIN } from '../constants/testIds';
//   <TouchableOpacity testID={LOGIN.googleSignInButton} onPress={...} />
//
// Directive:
//   - Keys are camelCase, values are kebab-case shaped as `<feature>-<element>`
//     (or `<feature>-<element>-<qualifier>` when an element repeats). Examples:
//     'login-google-sign-in-button', 'logout-button'.
//
// Why kebab-case values: required by qabot's CSS-attribute-style selector
// matcher and the lint rule `emergent(kebab-case-testid-prop)`.

export const LOGIN = {
	googleSignInButton: 'login-google-sign-in-button',
};

export const LOGOUT = {
	button: 'logout-button',
};

export const ONBOARDING = {
	nameInput: 'onboarding-name-input',
	completeButton: 'onboarding-complete-button',
};
