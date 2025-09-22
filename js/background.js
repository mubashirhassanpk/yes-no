/**
 * Background Service Worker for GitHub File Uploader Extension
 * Handles OAuth authentication, token management, and API requests
 */

// Configuration
const CONFIG = {
  CLIENT_ID: 'YOUR_GITHUB_OAUTH_CLIENT_ID', // Replace with your OAuth App Client ID
  CLIENT_SECRET: 'YOUR_GITHUB_OAUTH_CLIENT_SECRET', // Replace with your OAuth App Client Secret
  REDIRECT_URI: chrome.identity.getRedirectURL(),
  OAUTH_URL: 'https://github.com/login/oauth/authorize',
  TOKEN_URL: 'https://github.com/login/oauth/access_token',
  API_BASE_URL: 'https://api.github.com',
  CHUNK_SIZE: 1024 * 1024, // 1MB chunks for large files
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000
};

// State management
let authToken = null;
let uploadQueue = [];
let activeUploads = new Map();

/**
 * Initialize extension on install/update
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('GitHub File Uploader Extension installed/updated');
  loadStoredToken();
  
  // Set up context menus
  chrome.contextMenus.create({
    id: 'upload-to-github',
    title: 'Upload to GitHub',
    contexts: ['all']
  });
});

/**
 * Load stored authentication token
 */
async function loadStoredToken() {
  try {
    const result = await chrome.storage.local.get(['github_token']);
    if (result.github_token) {
      authToken = result.github_token;
      console.log('Token loaded from storage');
    }
  } catch (error) {
    console.error('Error loading token:', error);
  }
}

/**
 * OAuth Authentication Flow
 */
async function authenticate() {
  return new Promise((resolve, reject) => {
    const authUrl = `${CONFIG.OAUTH_URL}?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}&scope=repo,user`;
    
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        
        try {
          const url = new URL(redirectUrl);
          const code = url.searchParams.get('code');
          
          if (code) {
            const token = await exchangeCodeForToken(code);
            authToken = token;
            await chrome.storage.local.set({ github_token: token });
            resolve(token);
          } else {
            reject(new Error('No authorization code received'));
          }
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code) {
  const response = await fetch(CONFIG.TOKEN_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: CONFIG.CLIENT_ID,
      client_secret: CONFIG.CLIENT_SECRET,
      code: code
    })
  });
  
  if (!response.ok) {
    throw new Error('Failed to exchange code for token');
  }
  
  const data = await response.json();
  return data.access_token;
}

/**
 * Make authenticated API request with retry logic
 */
async function apiRequest(endpoint, options = {}, retries = 0) {
  if (!authToken) {
    throw new Error('Not authenticated');
  }
  
  const url = endpoint.startsWith('http') ? endpoint : `${CONFIG.API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Accept': 'application/vnd.github.v3+json',
        ...options.headers
      }
    });
    
    if (response.status === 401) {
      // Token expired or invalid, re-authenticate
      authToken = null;
      await chrome.storage.local.remove('github_token');
      throw new Error('Authentication required');
    }
    
    if (response.status === 404) {
      throw new Error('Resource not found');
    }
    
    if (response.status === 409) {
      throw new Error('Conflict - file may already exist');
    }
    
    if (!response.ok && retries < CONFIG.MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (retries + 1)));
      return apiRequest(endpoint, options, retries + 1);
    }
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  } catch (error) {
    if (retries < CONFIG.MAX_RETRIES && !error.message.includes('Authentication')) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (retries + 1)));
      return apiRequest(endpoint, options, retries + 1);
    }
    throw error;
  }
}

/**
 * Get user repositories
 */
async function getUserRepos(page = 1, perPage = 100) {
  return apiRequest(`/user/repos?page=${page}&per_page=${perPage}&sort=updated`);
}

/**
 * Get repository branches
 */
async function getRepoBranches(owner, repo) {
  return apiRequest(`/repos/${owner}/${repo}/branches`);
}

/**
 * Get repository contents
 */
async function getRepositoryContents(owner, repo, branch, path = '') {
  try {
    if (!authToken) {
      throw new Error('Not authenticated');
    }
    
    // Build the API URL
    const apiUrl = path 
      ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`
      : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${branch}`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to fetch contents: ${response.status}`);
    }
    
    const contents = await response.json();
    
    // Ensure it's an array (single file returns an object)
    const contentArray = Array.isArray(contents) ? contents : [contents];
    
    // Process the contents to include only needed fields
    const processedContents = contentArray.map(item => ({
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.size || 0,
      html_url: item.html_url,
      download_url: item.download_url
    }));
    
    return { 
      success: true, 
      contents: processedContents 
    };
  } catch (error) {
    console.error('Error fetching repository contents:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Create a new repository
 */
async function createRepository(name, description, isPrivate) {
  return apiRequest('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      private: isPrivate,
      auto_init: true
    })
  });
}

/**
 * Get file content from repository
 */
async function getFileContent(owner, repo, path, branch = 'main') {
  try {
    return await apiRequest(`/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);
  } catch (error) {
    if (error.message.includes('404')) {
      return null; // File doesn't exist
    }
    throw error;
  }
}

/**
 * Upload file to repository with chunking for large files
 */
async function uploadFile(owner, repo, path, content, message, branch = 'main', sha = null) {
  const uploadId = `${owner}/${repo}/${path}`;
  
  try {
    // Track upload progress
    activeUploads.set(uploadId, {
      total: content.length,
      uploaded: 0,
      status: 'uploading'
    });
    
    // Check if file is large and needs chunking
    if (content.length > CONFIG.CHUNK_SIZE * 10) { // Files larger than 10MB
      return await uploadLargeFile(owner, repo, path, content, message, branch, sha);
    }
    
    // Regular upload for smaller files
    const body = {
      message,
      content: content,
      branch
    };
    
    if (sha) {
      body.sha = sha; // Required for updating existing files
    }
    
    const result = await apiRequest(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    
    // Update progress
    activeUploads.set(uploadId, {
      total: content.length,
      uploaded: content.length,
      status: 'completed'
    });
    
    return result;
  } catch (error) {
    activeUploads.set(uploadId, {
      total: content.length,
      uploaded: 0,
      status: 'failed',
      error: error.message
    });
    throw error;
  } finally {
    // Clean up after a delay
    setTimeout(() => activeUploads.delete(uploadId), 5000);
  }
}

/**
 * Upload large file using Git LFS or chunking strategy
 */
async function uploadLargeFile(owner, repo, path, content, message, branch, sha) {
  // For very large files, we'll use the Git Data API to create blobs and trees
  // This is a simplified version - in production, you might want to use Git LFS
  
  const chunks = [];
  const chunkCount = Math.ceil(content.length / CONFIG.CHUNK_SIZE);
  
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CONFIG.CHUNK_SIZE;
    const end = Math.min(start + CONFIG.CHUNK_SIZE, content.length);
    chunks.push(content.slice(start, end));
  }
  
  // Create blob for the file content
  const blob = await apiRequest(`/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({
      content: content,
      encoding: 'base64'
    })
  });
  
  // Get the latest commit
  const ref = await apiRequest(`/repos/${owner}/${repo}/git/refs/heads/${branch}`);
  const latestCommit = await apiRequest(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`);
  
  // Create new tree
  const tree = await apiRequest(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: latestCommit.tree.sha,
      tree: [{
        path: path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      }]
    })
  });
  
  // Create new commit
  const commit = await apiRequest(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: message,
      tree: tree.sha,
      parents: [latestCommit.sha]
    })
  });
  
  // Update reference
  await apiRequest(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: commit.sha
    })
  });
  
  return commit;
}

/**
 * Delete file from repository
 */
async function deleteFile(owner, repo, path, message, branch = 'main') {
  const fileData = await getFileContent(owner, repo, path, branch);
  
  if (!fileData) {
    throw new Error('File not found');
  }
  
  return apiRequest(`/repos/${owner}/${repo}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message,
      sha: fileData.sha,
      branch
    })
  });
}

/**
 * Batch upload multiple files
 */
async function batchUpload(owner, repo, files, message, branch = 'main') {
  const results = [];
  const errors = [];
  
  for (const file of files) {
    try {
      const existingFile = await getFileContent(owner, repo, file.path, branch);
      const result = await uploadFile(
        owner,
        repo,
        file.path,
        file.content,
        message || `Upload ${file.path}`,
        branch,
        existingFile?.sha
      );
      results.push({ file: file.path, status: 'success', result });
    } catch (error) {
      errors.push({ file: file.path, status: 'error', error: error.message });
    }
  }
  
  return { results, errors };
}

/**
 * Message handler for popup and content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handleAsync = async () => {
    try {
      switch (request.action) {
        case 'authenticate':
          const token = await authenticate();
          return { success: true, token: token ? 'authenticated' : null };
        
        case 'checkAuth':
          return { success: true, authenticated: !!authToken };
        
        case 'logout':
          authToken = null;
          await chrome.storage.local.remove('github_token');
          return { success: true };
        
        case 'getRepos':
          const repos = await getUserRepos(request.page, request.perPage);
          return { success: true, repos };
        
        case 'getBranches':
          const branches = await getRepoBranches(request.owner, request.repo);
          return { success: true, branches };
        
      case 'createRepo':
        const newRepo = await createRepository(request.name, request.description, request.private);
        return { success: true, repo: newRepo };
        
      case 'getRepoContents':
        return await getRepositoryContents(request.owner, request.repo, request.branch, request.path);
        
        case 'uploadFile':
          const uploadResult = await uploadFile(
            request.owner,
            request.repo,
            request.path,
            request.content,
            request.message,
            request.branch,
            request.sha
          );
          return { success: true, result: uploadResult };
        
        case 'batchUpload':
          const batchResult = await batchUpload(
            request.owner,
            request.repo,
            request.files,
            request.message,
            request.branch
          );
          return { success: true, ...batchResult };
        
        case 'deleteFile':
          const deleteResult = await deleteFile(
            request.owner,
            request.repo,
            request.path,
            request.message,
            request.branch
          );
          return { success: true, result: deleteResult };
        
        case 'getUploadProgress':
          const progress = activeUploads.get(request.uploadId);
          return { success: true, progress };
        
        case 'getFileContent':
          const content = await getFileContent(
            request.owner,
            request.repo,
            request.path,
            request.branch
          );
          return { success: true, content };
        
        default:
          throw new Error(`Unknown action: ${request.action}`);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      return { success: false, error: error.message };
    }
  };
  
  handleAsync().then(sendResponse);
  return true; // Keep message channel open for async response
});

/**
 * Handle context menu clicks
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'upload-to-github') {
    chrome.action.openPopup();
  }
});

/**
 * Handle extension icon click
 */
chrome.action.onClicked.addListener((tab) => {
  chrome.action.openPopup();
});

console.log('Background service worker initialized');
