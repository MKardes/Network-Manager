const USER_KEY = 'nm.user';

/**
 * The signed-in operator's name, shown in the shell footer. The session itself
 * is an HttpOnly cookie the SPA cannot read, and there is no /me endpoint, so
 * we keep the name the login response returned.
 */
export function rememberUser(username: string): void {
  try {
    localStorage.setItem(USER_KEY, username);
  } catch {
    /* ignore storage failures */
  }
}

export function currentUser(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

export function forgetUser(): void {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore storage failures */
  }
}
