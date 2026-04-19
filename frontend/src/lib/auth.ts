import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

const POOL_DATA = {
  UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "",
  ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "",
};

function getUserPool(): CognitoUserPool {
  return new CognitoUserPool(POOL_DATA);
}

// ─── Sign Up ──────────────────────────────────────────────────────────────────

export function signUp(
  email: string,
  password: string,
  name: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();

    const attributes: CognitoUserAttribute[] = [
      new CognitoUserAttribute({ Name: "email", Value: email }),
      new CognitoUserAttribute({ Name: "name", Value: name }),
    ];

    pool.signUp(email, password, attributes, [], (err, _result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// ─── Confirm Sign Up ─────────────────────────────────────────────────────────

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    const cognitoUser = new CognitoUser({ Username: email, Pool: pool });

    cognitoUser.confirmRegistration(code, true, (err, _result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// ─── Resend Confirmation Code ─────────────────────────────────────────────────

export function resendConfirmationCode(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    const cognitoUser = new CognitoUser({ Username: email, Pool: pool });

    cognitoUser.resendConfirmationCode((err, _result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// ─── Sign In ──────────────────────────────────────────────────────────────────

export function signIn(email: string, password: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess(session: CognitoUserSession) {
        // Store the id token for API requests
        const idToken = session.getIdToken().getJwtToken();
        localStorage.setItem("id_token", idToken);
        resolve(session);
      },
      onFailure(err: Error) {
        reject(err);
      },
    });
  });
}

// ─── Sign Out ─────────────────────────────────────────────────────────────────

export function signOut(): void {
  const pool = getUserPool();
  const user = pool.getCurrentUser();
  if (user) {
    user.signOut();
  }
  localStorage.removeItem("id_token");
}

// ─── Get Current User ─────────────────────────────────────────────────────────

export function getCurrentUser(): CognitoUser | null {
  const pool = getUserPool();
  return pool.getCurrentUser();
}

// ─── Get Token ────────────────────────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("id_token");
}

// ─── Get User Email ───────────────────────────────────────────────────────────

export function getUserEmail(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    // JWT payload is the second segment, base64url-encoded
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.email ?? null;
  } catch {
    return null;
  }
}

// ─── Is Authenticated ────────────────────────────────────────────────────────

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  try {
    // Check if token is expired
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload.exp as number;
    return Date.now() < exp * 1000;
  } catch {
    return false;
  }
}

// ─── Refresh Session ──────────────────────────────────────────────────────────

export function refreshSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    const pool = getUserPool();
    const user = pool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) {
        resolve(null);
        return;
      }
      // Update stored token
      const idToken = session.getIdToken().getJwtToken();
      localStorage.setItem("id_token", idToken);
      resolve(session);
    });
  });
}

// ─── Forgot Password ─────────────────────────────────────────────────────────

export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    const cognitoUser = new CognitoUser({ Username: email, Pool: pool });

    cognitoUser.forgotPassword({
      onSuccess() {
        resolve();
      },
      onFailure(err: Error) {
        reject(err);
      },
    });
  });
}

// ─── Confirm New Password ────────────────────────────────────────────────────

export function confirmNewPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    const cognitoUser = new CognitoUser({ Username: email, Pool: pool });

    cognitoUser.confirmPassword(code, newPassword, {
      onSuccess() {
        resolve();
      },
      onFailure(err: Error) {
        reject(err);
      },
    });
  });
}

// ─── Parse Cognito Error ──────────────────────────────────────────────────────

export function parseCognitoError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const cognitoErr = err as { code: string; message: string };
    switch (cognitoErr.code) {
      case "UserNotFoundException":
        return "No account found with this email address.";
      case "NotAuthorizedException":
        return "Incorrect email or password.";
      case "UserNotConfirmedException":
        return "EMAIL_NOT_CONFIRMED";
      case "UsernameExistsException":
        return "An account with this email already exists.";
      case "InvalidPasswordException":
        return "Password does not meet requirements. It must be at least 8 characters with uppercase, lowercase, numbers, and special characters.";
      case "CodeMismatchException":
        return "Invalid verification code. Please try again.";
      case "ExpiredCodeException":
        return "Verification code has expired. Please request a new one.";
      case "LimitExceededException":
        return "Too many attempts. Please try again later.";
      case "InvalidParameterException":
        return cognitoErr.message;
      default:
        return cognitoErr.message || "An unexpected error occurred.";
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "An unexpected error occurred.";
}
