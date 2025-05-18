// utils/timeUtils.js

/**
 * Format minutes into a human-readable string
 * 
 * @param {number} minutes - Number of minutes remaining
 * @param {boolean} shortFormat - Whether to use short format (15m vs 15 min)
 * @returns {string} Formatted time string
 */
export const formatTimeRemaining = (minutes, shortFormat = false) => {
    if (minutes <= 0) return shortFormat ? '0m' : '0 min';
    
    if (minutes < 60) {
      return shortFormat ? `${minutes}m` : `${minutes} min`;
    }
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (mins === 0) {
      return shortFormat ? `${hours}h` : `${hours} hr`;
    }
    
    return shortFormat 
      ? `${hours}h ${mins}m` 
      : `${hours} hr ${mins} min`;
  };
  
  /**
   * Get remaining time in minutes from expiration timestamp
   * 
   * @param {number} expiresAt - Timestamp when the mode expires
   * @returns {number} Minutes remaining
   */
  export const getRemainingTime = (expiresAt) => {
    if (!expiresAt) return 0;
    
    const now = Date.now();
    const remaining = Math.max(0, expiresAt - now);
    return Math.ceil(remaining / (60 * 1000)); // Convert ms to minutes
  };