/**
 * Utility Functions for GitHub File Uploader Extension
 */

class Utils {
  /**
   * Show notification to user
   */
  static showNotification(message, type = 'info', duration = 3000) {
    const container = document.getElementById('notifications');
    if (!container) return;
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.setAttribute('role', 'alert');
    
    container.appendChild(notification);
    
    // Auto remove after duration
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, duration);
    
    return notification;
  }
  
  /**
   * Format date for display
   */
  static formatDate(date) {
    const options = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    return new Date(date).toLocaleDateString('en-US', options);
  }
  
  /**
   * Debounce function calls
   */
  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  
  /**
   * Throttle function calls
   */
  static throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
  
  /**
   * Deep clone object
   */
  static deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => this.deepClone(item));
    if (obj instanceof Object) {
      const clonedObj = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          clonedObj[key] = this.deepClone(obj[key]);
        }
      }
      return clonedObj;
    }
  }
  
  /**
   * Generate unique ID
   */
  static generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Parse repository URL
   */
  static parseRepoUrl(url) {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace('.git', '')
      };
    }
    return null;
  }
  
  /**
   * Validate repository name
   */
  static validateRepoName(name) {
    const pattern = /^[a-zA-Z0-9_-]+$/;
    return pattern.test(name) && name.length > 0 && name.length <= 100;
  }
  
  /**
   * Escape HTML to prevent XSS
   */
  static escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
  
  /**
   * Calculate upload speed
   */
  static calculateSpeed(bytes, milliseconds) {
    if (milliseconds === 0) return '0 B/s';
    const seconds = milliseconds / 1000;
    const bytesPerSecond = bytes / seconds;
    
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const k = 1024;
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
  }
  
  /**
   * Estimate time remaining
   */
  static estimateTimeRemaining(bytesRemaining, bytesPerSecond) {
    if (bytesPerSecond === 0) return 'Unknown';
    
    const seconds = bytesRemaining / bytesPerSecond;
    
    if (seconds < 60) {
      return `${Math.round(seconds)} seconds`;
    } else if (seconds < 3600) {
      return `${Math.round(seconds / 60)} minutes`;
    } else {
      return `${Math.round(seconds / 3600)} hours`;
    }
  }
  
  /**
   * Retry failed operation
   */
  static async retry(operation, maxRetries = 3, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await this.sleep(delay * Math.pow(2, i)); // Exponential backoff
      }
    }
  }
  
  /**
   * Sleep for specified milliseconds
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Check if online
   */
  static isOnline() {
    return navigator.onLine;
  }
  
  /**
   * Get storage usage
   */
  static async getStorageUsage() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage,
        quota: estimate.quota,
        percent: (estimate.usage / estimate.quota) * 100
      };
    }
    return null;
  }
  
  /**
   * Download data as file
   */
  static downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
  
  /**
   * Copy text to clipboard
   */
  static async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        return true;
      } catch (err) {
        return false;
      } finally {
        document.body.removeChild(textarea);
      }
    }
  }
  
  /**
   * Parse file path
   */
  static parsePath(path) {
    const parts = path.split('/');
    const filename = parts.pop();
    const directory = parts.join('/');
    const extension = filename.includes('.') ? '.' + filename.split('.').pop() : '';
    const basename = extension ? filename.slice(0, -extension.length) : filename;
    
    return {
      full: path,
      directory,
      filename,
      basename,
      extension
    };
  }
  
  /**
   * Create error object with details
   */
  static createError(message, code = 'UNKNOWN', details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    error.timestamp = Date.now();
    return error;
  }
  
  /**
   * Log error with context
   */
  static logError(error, context = {}) {
    console.error('Error occurred:', {
      message: error.message,
      code: error.code || 'UNKNOWN',
      stack: error.stack,
      context,
      timestamp: new Date().toISOString()
    });
    
    // Send error to background script for tracking
    chrome.runtime.sendMessage({
      action: 'logError',
      error: {
        message: error.message,
        code: error.code,
        context
      }
    });
  }
  
  /**
   * Sanitize filename
   */
  static sanitizeFilename(filename) {
    // Remove or replace invalid characters
    return filename
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^\.+/, '')
      .substring(0, 255);
  }
  
  /**
   * Check if dark mode is enabled
   */
  static isDarkMode() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  
  /**
   * Toggle element visibility
   */
  static toggleVisibility(elementId, show) {
    const element = document.getElementById(elementId);
    if (element) {
      element.style.display = show ? 'block' : 'none';
    }
  }
  
  /**
   * Update progress bar
   */
  static updateProgressBar(elementId, percent) {
    const element = document.getElementById(elementId);
    if (element) {
      element.style.width = `${Math.min(100, Math.max(0, percent))}%`;
      element.setAttribute('aria-valuenow', percent);
    }
  }
  
  /**
   * Format number with commas
   */
  static formatNumber(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  
  /**
   * Check if element is in viewport
   */
  static isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }
  
  /**
   * Smooth scroll to element
   */
  static scrollToElement(element, offset = 0) {
    const y = element.getBoundingClientRect().top + window.pageYOffset + offset;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
  
  /**
   * Get query parameters from URL
   */
  static getQueryParams(url = window.location.href) {
    const params = {};
    const queryString = url.split('?')[1];
    if (queryString) {
      queryString.split('&').forEach(param => {
        const [key, value] = param.split('=');
        params[decodeURIComponent(key)] = decodeURIComponent(value || '');
      });
    }
    return params;
  }
  
  /**
   * Merge objects deeply
   */
  static mergeDeep(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();
    
    if (this.isObject(target) && this.isObject(source)) {
      for (const key in source) {
        if (this.isObject(source[key])) {
          if (!target[key]) Object.assign(target, { [key]: {} });
          this.mergeDeep(target[key], source[key]);
        } else {
          Object.assign(target, { [key]: source[key] });
        }
      }
    }
    
    return this.mergeDeep(target, ...sources);
  }
  
  /**
   * Check if value is plain object
   */
  static isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
  
  /**
   * Create loading spinner
   */
  static createLoadingSpinner(container) {
    const spinner = document.createElement('div');
    spinner.className = 'loading';
    spinner.setAttribute('aria-label', 'Loading');
    container.appendChild(spinner);
    return spinner;
  }
  
  /**
   * Remove loading spinner
   */
  static removeLoadingSpinner(container) {
    const spinner = container.querySelector('.loading');
    if (spinner) spinner.remove();
  }
}

// Export for use in other modules
window.Utils = Utils;
