// Shared CompanyProfile read/write layer.
// Single source of truth for localStorage access so pages don't each carry
// their own try/catch parsing logic (docs/strategy/technical_debt/01_duplicate_code.md D4).

const PROFILE_STORAGE_KEY = "changescout_profile";

function getProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY));
  } catch (e) {
    return null;
  }
}

function saveProfile(profile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}
