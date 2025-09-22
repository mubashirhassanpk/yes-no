/**
 * Improved Popup Script for GitHub File Uploader Extension
 * Supports Personal Access Token authentication
 */

class GitHubUploader {
  constructor() {
    this.fileHandler = new FileHandler();
    this.selectedFiles = [];
    this.currentRepo = null;
    this.currentBranch = 'main';
    this.isAuthenticated = false;
    this.currentUser = null;
    this.uploadInProgress = false;
    this.ignoreDropZoneClick = false; // Flag to prevent dropzone click when button is clicked
    
    this.init();
  }
  
  async init() {
    console.log('Initializing GitHub Uploader...');
    
    // Check if we have a stored token first
    const stored = await chrome.storage.local.get(['github_token', 'auth_method']);
    
    if (stored.github_token) {
      // Show loading state while checking stored token
      const authStatus = document.getElementById('authStatus');
      const authButton = document.getElementById('authButton');
      
      if (authStatus) {
        authStatus.textContent = 'Restoring session...';
        authStatus.className = 'status-text';
      }
      if (authButton) {
        authButton.style.display = 'none';
      }
    }
    
    await this.checkAuthentication();
    this.attachEventListeners();
    this.setupDragAndDrop();
    this.setupProgressListener();
    await this.restoreUploadIfActive();
    
    if (this.isAuthenticated) {
      await this.loadRepositories();
    }
  }
  
  /**
   * Check authentication status
   */
  async checkAuthentication() {
    try {
      // Let the background script handle checking storage and validating token
      const response = await chrome.runtime.sendMessage({ action: 'checkAuth' });
      console.log('Auth check response:', response);
      
      if (response.success && response.authenticated) {
        this.isAuthenticated = true;
        this.currentUser = response.user;
        this.updateAuthUI(true);
        console.log('Authentication restored successfully');
      } else {
        // No valid token found
        console.log('No valid authentication found');
        this.isAuthenticated = false;
        this.updateAuthUI(false);
      }
    } catch (error) {
      console.error('Error checking authentication:', error);
      this.isAuthenticated = false;
      this.updateAuthUI(false);
    }
  }
  
  /**
   * Update authentication UI
   */
  updateAuthUI(authenticated) {
    const authStatus = document.getElementById('authStatus');
    const authButton = document.getElementById('authButton');
    const userInfo = document.getElementById('userInfo');
    const repoSection = document.getElementById('repoSection');
    
    if (authenticated && this.currentUser) {
      authStatus.textContent = 'Connected';
      authStatus.className = 'status-text authenticated';
      authButton.style.display = 'none';
      
      // Show user info
      if (userInfo) {
        userInfo.style.display = 'flex';
        document.getElementById('userName').textContent = this.currentUser.name || this.currentUser.login;
        document.getElementById('userLogin').textContent = '@' + this.currentUser.login;
        if (this.currentUser.avatar_url) {
          document.getElementById('userAvatar').src = this.currentUser.avatar_url;
        }
      }
      
      Utils.toggleVisibility('repoSection', true);
    } else {
      authStatus.textContent = 'Not authenticated';
      authStatus.className = 'status-text';
      authButton.style.display = 'block';
      authButton.textContent = 'Login with GitHub';
      
      if (userInfo) {
        userInfo.style.display = 'none';
      }
      
      Utils.toggleVisibility('repoSection', false);
      Utils.toggleVisibility('uploadSection', false);
    }
  }
  
  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Authentication
    document.getElementById('authButton')?.addEventListener('click', () => this.showAuthModal());
    document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
    document.getElementById('authenticatePATBtn')?.addEventListener('click', () => this.authenticateWithPAT());
    document.getElementById('cancelAuthBtn')?.addEventListener('click', () => this.hideAuthModal());
    
    // PAT input - enter key
    document.getElementById('patInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.authenticateWithPAT();
      }
    });
    
    // Repository management
    document.getElementById('refreshRepos')?.addEventListener('click', () => this.loadRepositories());
    document.getElementById('repoSearch')?.addEventListener('input', (e) => this.filterRepositories(e.target.value));
    document.getElementById('repoSelect')?.addEventListener('change', (e) => this.selectRepository(e.target.value));
    document.getElementById('createRepoBtn')?.addEventListener('click', () => this.showCreateRepoModal());
    
    // Create repository modal
    document.getElementById('closeModalBtn')?.addEventListener('click', () => this.hideCreateRepoModal());
    document.getElementById('createRepoConfirmBtn')?.addEventListener('click', () => this.createRepository());
    document.getElementById('createRepoCancelBtn')?.addEventListener('click', () => this.hideCreateRepoModal());
    
    // Branch management
    document.getElementById('branchSelect')?.addEventListener('change', (e) => this.selectBranch(e.target.value));
    
    // Repository browser
    document.getElementById('refreshRepoContents')?.addEventListener('click', () => this.loadRepoContents());
    
    // File selection - Use capturing phase to handle before dropZone
    const browseBtn = document.getElementById('browseBtn');
    const browseFolderBtn = document.getElementById('browseFolderBtn');
    
    if (browseBtn) {
      browseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.ignoreDropZoneClick = true;
        setTimeout(() => { this.ignoreDropZoneClick = false; }, 100);
        document.getElementById('fileInput').click();
      }, true); // Use capture phase
    }
    
    if (browseFolderBtn) {
      browseFolderBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.ignoreDropZoneClick = true;
        setTimeout(() => { this.ignoreDropZoneClick = false; }, 100);
        document.getElementById('folderInput').click();
      }, true); // Use capture phase
    }
    
    document.getElementById('fileInput')?.addEventListener('change', (e) => this.handleFileSelect(e.target.files));
    document.getElementById('folderInput')?.addEventListener('change', (e) => this.handleFolderSelect(e.target.files));
    document.getElementById('clearFilesBtn')?.addEventListener('click', () => this.clearFiles());
    
    // Upload controls
    document.getElementById('uploadBtn')?.addEventListener('click', () => this.startUpload());
    document.getElementById('cancelBtn')?.addEventListener('click', () => this.cancelUpload());
    
    // Results actions
    document.getElementById('viewRepoBtn')?.addEventListener('click', () => this.viewRepository());
    document.getElementById('uploadMoreBtn')?.addEventListener('click', () => this.resetForNewUpload());
  }
  
  /**
   * Setup drag and drop
   */
  setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return;
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      
      // Check if we're dealing with folders or files
      const items = e.dataTransfer.items;
      const files = [];
      let hasFolder = false;
      
      if (items) {
        // Use DataTransferItemList interface when available
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (entry) {
              if (entry.isDirectory) {
                hasFolder = true;
                // Process folder
                await this.processDirectoryEntry(entry, files);
              } else {
                // Regular file
                files.push(item.getAsFile());
              }
            } else {
              // Fallback to regular file
              files.push(item.getAsFile());
            }
          }
        }
      } else {
        // Fallback to FileList
        files.push(...Array.from(e.dataTransfer.files));
      }
      
      // Process the collected files
      if (hasFolder) {
        // Convert files to format expected by handleFolderSelect
        this.handleDroppedFolder(files);
      } else {
        this.handleFileSelect(files);
      }
    });
    
    dropZone.addEventListener('click', (e) => {
      // Check the flag first
      if (this.ignoreDropZoneClick) {
        return;
      }
      
      // Check if click is on a button or its children
      const browseBtn = document.getElementById('browseBtn');
      const browseFolderBtn = document.getElementById('browseFolderBtn');
      
      // Don't open file picker if clicking on buttons
      if (browseBtn && (e.target === browseBtn || browseBtn.contains(e.target))) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (browseFolderBtn && (e.target === browseFolderBtn || browseFolderBtn.contains(e.target))) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      // Only open file picker if clicking on drop zone itself
      document.getElementById('fileInput').click();
    }, false); // Explicitly use bubble phase
  }
  
  /**
   * Show authentication modal
   */
  showAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
      modal.classList.add('active');
      document.getElementById('patInput').focus();
    }
  }
  
  /**
   * Hide authentication modal
   */
  hideAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
      modal.classList.remove('active');
      document.getElementById('patInput').value = '';
    }
  }
  
  /**
   * Authenticate with Personal Access Token
   */
  async authenticateWithPAT() {
    const patInput = document.getElementById('patInput');
    const token = patInput.value.trim();
    
    if (!token) {
      Utils.showNotification('Please enter a Personal Access Token', 'error');
      return;
    }
    
    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
      Utils.showNotification('Invalid token format. GitHub tokens start with "ghp_" or "github_pat_"', 'error');
      return;
    }
    
    try {
      // Show loading state
      const btn = document.getElementById('authenticatePATBtn');
      const originalText = btn.textContent;
      btn.textContent = 'Authenticating...';
      btn.disabled = true;
      
      const response = await chrome.runtime.sendMessage({
        action: 'authenticatePAT',
        token: token
      });
      
      console.log('PAT authentication response:', response);
      
      if (response.success) {
        this.isAuthenticated = true;
        this.currentUser = response.user;
        this.hideAuthModal();
        this.updateAuthUI(true);
        await this.loadRepositories();
        Utils.showNotification('Authentication successful!', 'success');
      } else {
        throw new Error(response.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Authentication error:', error);
      Utils.showNotification('Authentication failed: ' + error.message, 'error');
    } finally {
      const btn = document.getElementById('authenticatePATBtn');
      btn.textContent = 'Authenticate with Token';
      btn.disabled = false;
    }
  }
  
  /**
   * Logout
   */
  async logout() {
    try {
      await chrome.runtime.sendMessage({ action: 'logout' });
      this.isAuthenticated = false;
      this.currentUser = null;
      this.updateAuthUI(false);
      this.clearFiles();
      Utils.showNotification('Logged out successfully', 'success');
    } catch (error) {
      console.error('Logout error:', error);
      Utils.showNotification('Error logging out', 'error');
    }
  }
  
  /**
   * Load user repositories
   */
  async loadRepositories() {
    const repoSelect = document.getElementById('repoSelect');
    if (!repoSelect) return;
    
    repoSelect.innerHTML = '<option value="">Loading repositories...</option>';
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getRepos' });
      
      if (response.success && response.repos) {
        this.displayRepositories(response.repos);
      } else {
        throw new Error(response.error || 'Failed to load repositories');
      }
    } catch (error) {
      console.error('Error loading repositories:', error);
      Utils.showNotification('Failed to load repositories: ' + error.message, 'error');
      repoSelect.innerHTML = '<option value="">Failed to load repositories</option>';
    }
  }
  
  /**
   * Display repositories
   */
  displayRepositories(repos) {
    const repoSelect = document.getElementById('repoSelect');
    
    if (repos.length === 0) {
      repoSelect.innerHTML = '<option value="">No repositories found</option>';
      return;
    }
    
    repoSelect.innerHTML = '<option value="">Select a repository</option>';
    
    repos.forEach(repo => {
      const option = document.createElement('option');
      option.value = JSON.stringify({
        owner: repo.owner.login,
        name: repo.name,
        full_name: repo.full_name,
        default_branch: repo.default_branch || 'main'
      });
      option.textContent = `${repo.full_name} ${repo.private ? '🔒' : ''}`;
      repoSelect.appendChild(option);
    });
  }
  
  /**
   * Filter repositories
   */
  filterRepositories(searchTerm) {
    const options = document.querySelectorAll('#repoSelect option');
    const term = searchTerm.toLowerCase();
    
    options.forEach(option => {
      if (option.value === '') return;
      const text = option.textContent.toLowerCase();
      option.style.display = text.includes(term) ? '' : 'none';
    });
  }
  
  /**
   * Select repository
   */
  async selectRepository(value) {
    if (!value) {
      this.currentRepo = null;
      Utils.toggleVisibility('selectedRepoDisplay', false);
      Utils.toggleVisibility('branchSection', false);
      Utils.toggleVisibility('uploadSection', false);
      return;
    }
    
    try {
      this.currentRepo = JSON.parse(value);
      
      // Display selected repository
      const repoNameElement = document.getElementById('selectedRepoName');
      if (repoNameElement) {
        repoNameElement.textContent = this.currentRepo.full_name;
      }
      Utils.toggleVisibility('selectedRepoDisplay', true);
      
      await this.loadBranches();
      Utils.toggleVisibility('branchSection', true);
      Utils.toggleVisibility('repoBrowser', true);
      Utils.toggleVisibility('uploadSection', true);
      
      // Load repository contents
      await this.loadRepoContents();
    } catch (error) {
      console.error('Error selecting repository:', error);
    }
  }
  
  /**
   * Load branches
   */
  async loadBranches() {
    if (!this.currentRepo) return;
    
    const branchSelect = document.getElementById('branchSelect');
    branchSelect.innerHTML = '<option value="">Loading branches...</option>';
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getBranches',
        owner: this.currentRepo.owner,
        repo: this.currentRepo.name
      });
      
      if (response.success && response.branches) {
        this.displayBranches(response.branches);
      }
    } catch (error) {
      console.error('Error loading branches:', error);
      branchSelect.innerHTML = `<option value="${this.currentRepo.default_branch}">${this.currentRepo.default_branch}</option>`;
    }
  }
  
  /**
   * Display branches
   */
  displayBranches(branches) {
    const branchSelect = document.getElementById('branchSelect');
    branchSelect.innerHTML = '';
    
    branches.forEach(branch => {
      const option = document.createElement('option');
      option.value = branch.name;
      option.textContent = branch.name;
      if (branch.name === this.currentRepo.default_branch) {
        option.selected = true;
      }
      branchSelect.appendChild(option);
    });
    
    this.currentBranch = branchSelect.value;
  }
  
  /**
   * Select branch
   */
  selectBranch(branch) {
    this.currentBranch = branch;
    // Reload repository contents when branch changes
    if (this.currentRepo) {
      this.loadRepoContents();
    }
  }
  
  /**
   * Handle file selection
   */
  async handleFileSelect(files) {
    if (!files || files.length === 0) return;
    
    const fileArray = Array.from(files);
    
    // Process files
    const options = {
      compress: document.getElementById('compressFiles')?.checked || false,
      validate: document.getElementById('validateTypes')?.checked || true
    };
    
    const result = await this.fileHandler.processFiles(fileArray, options);
    
    // Show errors if any
    if (result.errors.length > 0) {
      result.errors.forEach(error => {
        Utils.showNotification(`${error.file}: ${error.error}`, 'warning');
      });
    }
    
    // Add processed files
    this.selectedFiles = [...this.selectedFiles, ...result.files];
    this.displaySelectedFiles();
    
    if (this.selectedFiles.length > 0) {
      Utils.toggleVisibility('fileList', true);
      Utils.toggleVisibility('uploadOptions', true);
    }
  }
  
  /**
   * Process a directory entry recursively (for drag-and-drop)
   */
  async processDirectoryEntry(dirEntry, fileList, basePath = '', isRoot = true) {
    const reader = dirEntry.createReader();
    const entries = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    
    for (const entry of entries) {
      const path = basePath ? `${basePath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory) {
        // For subdirectories, don't include root folder name
        await this.processDirectoryEntry(entry, fileList, path, false);
      } else {
        const file = await new Promise((resolve, reject) => {
          entry.file(resolve, reject);
        });
        // Don't include the root folder name in the path
        // Just use the internal path structure
        file.relativePath = path;
        fileList.push(file);
      }
    }
  }
  
  /**
   * Handle dropped folder from drag-and-drop
   */
  async handleDroppedFolder(files) {
    if (!files || files.length === 0) return;
    
    console.log(`Processing dropped folder with ${files.length} files`);
    
    const processedFiles = [];
    const errors = [];
    const options = {
      compress: document.getElementById('compressFiles')?.checked || false,
      validate: document.getElementById('validateTypes')?.checked || true
    };
    
    // Process each file
    for (const file of files) {
      try {
        // Skip system files and hidden files
        const fileName = file.name;
        if (fileName.startsWith('.') || fileName === 'Thumbs.db' || fileName === 'desktop.ini') {
          continue;
        }
        
        // Use the relativePath we added or fallback to name
        let relativePath = file.relativePath || file.name;
        
        // Strip the root folder name if present (for drag-and-drop)
        if (relativePath.includes('/')) {
          const parts = relativePath.split('/');
          // Remove the first part (folder name) to get contents only
          relativePath = parts.slice(1).join('/');
        }
        
        // Validate file if needed
        if (options.validate && !this.fileHandler.validateFileType(fileName, true)) {
          errors.push({
            file: relativePath,
            error: 'File type not allowed'
          });
          continue;
        }
        
        // Check file size
        if (file.size > this.fileHandler.MAX_FILE_SIZE) {
          errors.push({
            file: relativePath,
            error: `File too large (max ${this.fileHandler.formatFileSize(this.fileHandler.MAX_FILE_SIZE)})`
          });
          continue;
        }
        
        // Read file content
        const content = await this.fileHandler.readFileAsBase64(file);
        
        processedFiles.push({
          path: relativePath,
          content: content,
          size: file.size,
          type: file.type || 'application/octet-stream',
          lastModified: file.lastModified
        });
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        errors.push({
          file: file.relativePath || file.name,
          error: error.message
        });
      }
    }
    
    // Show summary notification
    if (processedFiles.length > 0) {
      Utils.showNotification(`Added ${processedFiles.length} files from dropped folder`, 'success');
    }
    
    // Show errors if any
    if (errors.length > 0) {
      errors.forEach(error => {
        Utils.showNotification(`${error.file}: ${error.error}`, 'warning');
      });
    }
    
    // Add processed files
    this.selectedFiles = [...this.selectedFiles, ...processedFiles];
    this.displaySelectedFiles();
    
    if (this.selectedFiles.length > 0) {
      Utils.toggleVisibility('fileList', true);
      Utils.toggleVisibility('uploadOptions', true);
    }
  }
  
  /**
   * Handle folder selection
   */
  async handleFolderSelect(files) {
    if (!files || files.length === 0) return;
    
    const fileArray = Array.from(files);
    console.log(`Processing folder with ${fileArray.length} files`);
    
    // Extract folder structure and prepare files with paths
    const processedFiles = [];
    const errors = [];
    const options = {
      compress: document.getElementById('compressFiles')?.checked || false,
      validate: document.getElementById('validateTypes')?.checked || true
    };
    
    // Get the common folder path to strip it from file paths
    let folderPath = '';
    if (fileArray.length > 0 && fileArray[0].webkitRelativePath) {
      const pathParts = fileArray[0].webkitRelativePath.split('/');
      folderPath = pathParts[0];
    }
    
    // Process each file in the folder
    for (const file of fileArray) {
      try {
        // Skip system files and hidden files
        const fileName = file.name;
        if (fileName.startsWith('.') || fileName === 'Thumbs.db' || fileName === 'desktop.ini') {
          continue;
        }
        
        // Get relative path and remove the root folder name
        let relativePath = file.webkitRelativePath || file.name;
        // Strip the root folder name to upload contents directly
        if (relativePath.startsWith(folderPath + '/')) {
          relativePath = relativePath.substring(folderPath.length + 1);
        }
        
        // Validate file if needed
        if (options.validate && !this.fileHandler.validateFileType(fileName, true)) {
          errors.push({
            file: relativePath,
            error: 'File type not allowed'
          });
          continue;
        }
        
        // Check file size
        if (file.size > this.fileHandler.MAX_FILE_SIZE) {
          errors.push({
            file: relativePath,
            error: `File too large (max ${this.fileHandler.formatFileSize(this.fileHandler.MAX_FILE_SIZE)})`
          });
          continue;
        }
        
        // Read file content
        const content = await this.fileHandler.readFileAsBase64(file);
        
        processedFiles.push({
          path: relativePath,
          content: content,
          size: file.size,
          type: file.type || 'application/octet-stream',
          lastModified: file.lastModified
        });
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        errors.push({
          file: file.webkitRelativePath || file.name,
          error: error.message
        });
      }
    }
    
    // Show summary notification
    if (processedFiles.length > 0) {
      Utils.showNotification(`Added ${processedFiles.length} files from folder "${folderPath}"`, 'success');
    }
    
    // Show errors if any
    if (errors.length > 0) {
      errors.forEach(error => {
        Utils.showNotification(`${error.file}: ${error.error}`, 'warning');
      });
    }
    
    // Add processed files
    this.selectedFiles = [...this.selectedFiles, ...processedFiles];
    this.displaySelectedFiles();
    
    if (this.selectedFiles.length > 0) {
      Utils.toggleVisibility('fileList', true);
      Utils.toggleVisibility('uploadOptions', true);
    }
  }
  
  /**
   * Display selected files
   */
  displaySelectedFiles() {
    const fileListItems = document.getElementById('fileListItems');
    const fileCount = document.getElementById('fileCount');
    
    fileListItems.innerHTML = '';
    fileCount.textContent = `${this.selectedFiles.length} file${this.selectedFiles.length !== 1 ? 's' : ''} selected`;
    
    this.selectedFiles.forEach((file, index) => {
      const li = document.createElement('li');
      
      const fileName = document.createElement('span');
      fileName.className = 'file-name';
      fileName.textContent = file.path;
      fileName.title = file.path;
      
      const fileSize = document.createElement('span');
      fileSize.className = 'file-size';
      fileSize.textContent = this.fileHandler.formatFileSize(file.size);
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'file-remove';
      removeBtn.innerHTML = '×';
      removeBtn.title = 'Remove file';
      removeBtn.onclick = () => this.removeFile(index);
      
      li.appendChild(fileName);
      li.appendChild(fileSize);
      li.appendChild(removeBtn);
      fileListItems.appendChild(li);
    });
  }
  
  /**
   * Remove file
   */
  removeFile(index) {
    this.selectedFiles.splice(index, 1);
    this.displaySelectedFiles();
    
    if (this.selectedFiles.length === 0) {
      Utils.toggleVisibility('fileList', false);
      Utils.toggleVisibility('uploadOptions', false);
    }
  }
  
  /**
   * Clear all files
   */
  clearFiles() {
    this.selectedFiles = [];
    Utils.toggleVisibility('fileList', false);
    Utils.toggleVisibility('uploadOptions', false);
  }
  
  /**
   * Start upload
   */
  async startUpload() {
    if (!this.currentRepo || this.selectedFiles.length === 0) {
      Utils.showNotification('Please select a repository and files', 'warning');
      return;
    }
    
    this.uploadInProgress = true;
    Utils.toggleVisibility('uploadSection', false);
    Utils.toggleVisibility('progressSection', true);
    
    // Initialize progress UI
    this.updateProgressUI(0, this.selectedFiles.length, 'Starting upload...');
    
    const commitMessage = document.getElementById('commitMessage').value || 
                         `Upload ${this.selectedFiles.length} files via GitHub Uploader by Mubashir Hassan`;
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'batchUpload',
        owner: this.currentRepo.owner,
        repo: this.currentRepo.name,
        branch: this.currentBranch,
        files: this.selectedFiles,
        message: commitMessage
      });
      
      if (response.success) {
        this.handleUploadComplete(response.results, response.errors);
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      Utils.showNotification('Upload failed: ' + error.message, 'error');
      Utils.toggleVisibility('progressSection', false);
      Utils.toggleVisibility('uploadSection', true);
      this.uploadInProgress = false;
    }
  }
  
  /**
   * Handle upload complete
   */
  handleUploadComplete(results, errors) {
    this.uploadInProgress = false;
    
    Utils.toggleVisibility('progressSection', false);
    Utils.toggleVisibility('resultsSection', true);
    
    document.getElementById('successCount').textContent = results.length;
    document.getElementById('errorCount').textContent = errors.length;
    
    const resultsDetails = document.getElementById('resultsDetails');
    resultsDetails.innerHTML = '';
    
    // Add repository info and quick links
    if (this.currentRepo && results.length > 0) {
      const repoInfoDiv = document.createElement('div');
      repoInfoDiv.className = 'repo-preview';
      repoInfoDiv.innerHTML = `
        <div class="repo-preview-header">
          <h3>📁 Repository: ${this.currentRepo.full_name}</h3>
          <p>Branch: <code>${this.currentBranch}</code></p>
        </div>
        <div class="quick-links">
          <a href="https://github.com/${this.currentRepo.owner}/${this.currentRepo.name}/tree/${this.currentBranch}" 
             target="_blank" class="btn btn-primary btn-sm">
            <span>🔗 View Repository</span>
          </a>
          <a href="https://github.com/${this.currentRepo.owner}/${this.currentRepo.name}/commits/${this.currentBranch}" 
             target="_blank" class="btn btn-secondary btn-sm">
            <span>📜 View Commits</span>
          </a>
        </div>
      `;
      resultsDetails.appendChild(repoInfoDiv);
    }
    
    if (results.length > 0) {
      const successDiv = document.createElement('div');
      successDiv.className = 'upload-results-section';
      successDiv.innerHTML = '<h4>✅ Successfully uploaded files:</h4>';
      const ul = document.createElement('ul');
      ul.className = 'file-preview-list';
      
      // Group files by directory
      const fileTree = {};
      results.forEach(result => {
        const parts = result.file.split('/');
        if (parts.length > 1) {
          const dir = parts.slice(0, -1).join('/');
          if (!fileTree[dir]) fileTree[dir] = [];
          fileTree[dir].push(parts[parts.length - 1]);
        } else {
          if (!fileTree['root']) fileTree['root'] = [];
          fileTree['root'].push(result.file);
        }
      });
      
      // Display grouped files
      Object.keys(fileTree).sort().forEach(dir => {
        if (dir !== 'root') {
          const dirLi = document.createElement('li');
          dirLi.className = 'directory-item';
          dirLi.innerHTML = `📂 <strong>${dir}/</strong>`;
          ul.appendChild(dirLi);
        }
        
        fileTree[dir].sort().forEach(fileName => {
          const li = document.createElement('li');
          li.className = dir !== 'root' ? 'file-item indented' : 'file-item';
          const fullPath = dir === 'root' ? fileName : `${dir}/${fileName}`;
          const fileUrl = `https://github.com/${this.currentRepo.owner}/${this.currentRepo.name}/blob/${this.currentBranch}/${fullPath}`;
          li.innerHTML = `📄 <a href="${fileUrl}" target="_blank" class="file-link">${fileName}</a>`;
          ul.appendChild(li);
        });
      });
      
      successDiv.appendChild(ul);
      resultsDetails.appendChild(successDiv);
    }
    
    if (errors.length > 0) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'upload-results-section error-section';
      errorDiv.innerHTML = '<h4>❌ Failed uploads:</h4>';
      const ul = document.createElement('ul');
      errors.forEach(error => {
        const li = document.createElement('li');
        li.className = 'error-item';
        li.innerHTML = `<span class="error-file">${error.file}</span>: <span class="error-message">${error.error}</span>`;
        ul.appendChild(li);
      });
      errorDiv.appendChild(ul);
      resultsDetails.appendChild(errorDiv);
    }
    
    // Show success message with confetti effect if all succeeded
    if (errors.length === 0 && results.length > 0) {
      Utils.showNotification(
        `🎉 Perfect! All ${results.length} file${results.length > 1 ? 's' : ''} uploaded successfully!`,
        'success'
      );
      this.showSuccessAnimation();
    } else {
      Utils.showNotification(
        `Upload complete! ${results.length} succeeded, ${errors.length} failed`,
        results.length > 0 ? 'success' : 'error'
      );
    }
  }
  
  /**
   * Cancel upload
   */
  cancelUpload() {
    this.clearFiles();
    Utils.toggleVisibility('uploadSection', false);
  }
  
  /**
   * View repository
   */
  viewRepository() {
    if (this.currentRepo) {
      const url = `https://github.com/${this.currentRepo.owner}/${this.currentRepo.name}/tree/${this.currentBranch || 'main'}`;
      chrome.tabs.create({ url });
    }
  }
  
  /**
   * Show success animation
   */
  showSuccessAnimation() {
    // Create a temporary success overlay
    const overlay = document.createElement('div');
    overlay.className = 'success-overlay';
    overlay.innerHTML = `
      <div class="success-content">
        <div class="success-icon">🎉</div>
        <h2>Upload Successful!</h2>
        <p>All files have been uploaded to GitHub</p>
      </div>
    `;
    document.body.appendChild(overlay);
    
    // Fade in
    setTimeout(() => overlay.classList.add('show'), 10);
    
    // Remove after animation
    setTimeout(() => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 300);
    }, 2000);
  }
  
  /**
   * Reset for new upload
   */
  resetForNewUpload() {
    this.clearFiles();
    Utils.toggleVisibility('resultsSection', false);
    Utils.toggleVisibility('uploadSection', true);
  }
  
  /**
   * Setup progress listener for upload updates
   */
  setupProgressListener() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'uploadProgress' && this.uploadInProgress) {
        console.log('Progress update:', message);
        this.updateProgressUI(message.current || 0, message.total || this.selectedFiles.length, message.file || '');
        
        // Add to log
        const logList = document.getElementById('logList');
        if (logList && message.file) {
          const li = document.createElement('li');
          li.className = message.status === 'success' ? 'log-success' : 'log-error';
          if (message.status === 'success') {
            li.textContent = `✓ ${message.file}`;
          } else {
            li.textContent = `✗ ${message.file}: ${message.error || 'Failed'}`;
          }
          logList.appendChild(li);
          logList.scrollTop = logList.scrollHeight;
        }
      }
    });
  }
  
  /**
   * Restore upload state if a background upload is active
   */
  async restoreUploadIfActive() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getUploadStatus' });
      if (resp?.success && resp.state?.active) {
        // Show progress section and update UI
        this.uploadInProgress = true;
        Utils.toggleVisibility('uploadSection', false);
        Utils.toggleVisibility('progressSection', true);
        
        const state = resp.state;
        this.updateProgressUI(state.current || 0, state.total || 0, state.file || '');
        
        // Hydrate log with previous results/errors
        const logList = document.getElementById('logList');
        if (logList) {
          logList.innerHTML = '';
          const addItem = (text, cls) => {
            const li = document.createElement('li');
            li.textContent = text;
            li.className = cls;
            logList.appendChild(li);
          };
          (state.results || []).forEach(r => addItem(`✓ ${r.file}`, 'log-success'));
          (state.errors || []).forEach(e => addItem(`✗ ${e.file}: ${e.error}`, 'log-error'));
          logList.scrollTop = logList.scrollHeight;
        }
      }
    } catch (e) {
      // ignore
    }
  }
  
  /**
   * Update progress UI
   */
  updateProgressUI(current, total, currentFile = '') {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    
    // Update progress bar
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
      progressFill.style.width = `${percent}%`;
    }
    
    // Update progress text
    const progressText = document.getElementById('progressText');
    if (progressText) {
      progressText.textContent = `Uploading ${current} of ${total} files`;
    }
    
    // Update progress percentage
    const progressPercent = document.getElementById('progressPercent');
    if (progressPercent) {
      progressPercent.textContent = `${percent}%`;
    }
    
    // Update current file
    const currentFileElement = document.getElementById('currentFile');
    if (currentFileElement && currentFile) {
      currentFileElement.textContent = `Current: ${currentFile}`;
    }
    
    // Update progress bar aria attributes
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
      progressBar.setAttribute('aria-valuenow', percent.toString());
    }
  }
  
  /**
   * Load repository contents
   */
  async loadRepoContents() {
    if (!this.currentRepo || !this.currentBranch) return;
    
    const browserContent = document.getElementById('browserContent');
    if (!browserContent) return;
    
    // Show loading state
    browserContent.innerHTML = '<div class="loading-spinner">Loading repository contents...</div>';
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getRepoContents',
        owner: this.currentRepo.owner,
        repo: this.currentRepo.name,
        branch: this.currentBranch,
        path: ''
      });
      
      if (response.success && response.contents) {
        this.displayRepoContents(response.contents);
      } else {
        throw new Error(response.error || 'Failed to load repository contents');
      }
    } catch (error) {
      console.error('Error loading repository contents:', error);
      browserContent.innerHTML = `
        <div class="browser-empty">
          <p>⚠️ Failed to load repository contents</p>
          <small>${error.message}</small>
        </div>
      `;
    }
  }
  
  /**
   * Display repository contents
   */
  displayRepoContents(contents) {
    const browserContent = document.getElementById('browserContent');
    if (!browserContent) return;
    
    if (!contents || contents.length === 0) {
      browserContent.innerHTML = `
        <div class="browser-empty">
          <p>📭 This repository is empty</p>
          <small>Start by uploading some files!</small>
        </div>
      `;
      return;
    }
    
    // Sort contents: directories first, then files
    const sortedContents = contents.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });
    
    // Create file tree HTML
    const html = `
      <div class="file-tree">
        <ul class="tree-list">
          ${sortedContents.map(item => this.createTreeItem(item)).join('')}
        </ul>
      </div>
      <div class="browser-stats">
        <span>${contents.filter(c => c.type === 'dir').length} folders</span>
        <span>${contents.filter(c => c.type === 'file').length} files</span>
      </div>
    `;
    
    browserContent.innerHTML = html;
  }
  
  /**
   * Create tree item HTML
   */
  createTreeItem(item) {
    const icon = item.type === 'dir' ? '📁' : this.getFileIcon(item.name);
    const size = item.size ? `<span class="item-size">${this.formatFileSize(item.size)}</span>` : '';
    const url = item.html_url || `https://github.com/${this.currentRepo.owner}/${this.currentRepo.name}/blob/${this.currentBranch}/${item.path}`;
    
    return `
      <li class="tree-item ${item.type}">
        <a href="${url}" target="_blank" class="tree-link" title="View on GitHub">
          <span class="item-icon">${icon}</span>
          <span class="item-name">${item.name}</span>
          ${size}
        </a>
      </li>
    `;
  }
  
  /**
   * Get file icon based on extension
   */
  getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
      'js': '📜',
      'ts': '📘',
      'jsx': '⚛️',
      'tsx': '⚛️',
      'html': '🌐',
      'css': '🎨',
      'scss': '🎨',
      'json': '📋',
      'md': '📝',
      'txt': '📄',
      'png': '🖼️',
      'jpg': '🖼️',
      'jpeg': '🖼️',
      'gif': '🖼️',
      'svg': '🖼️',
      'pdf': '📕',
      'zip': '📦',
      'git': '🔧',
      'yml': '⚙️',
      'yaml': '⚙️',
      'xml': '📰',
      'py': '🐍',
      'java': '☕',
      'cpp': '🔷',
      'c': '🔷',
      'h': '🔷',
      'go': '🐹',
      'rs': '🦀',
      'php': '🐘',
      'rb': '💎',
      'sh': '🐚',
      'bat': '🖥️',
      'exe': '⚡',
      'dll': '🔌'
    };
    
    return iconMap[ext] || '📄';
  }
  
  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
  
  /**
   * Show create repository modal
   */
  showCreateRepoModal() {
    const modal = document.getElementById('createRepoModal');
    if (modal) {
      modal.style.display = 'flex';
      document.getElementById('newRepoName').focus();
    }
  }
  
  /**
   * Hide create repository modal
   */
  hideCreateRepoModal() {
    const modal = document.getElementById('createRepoModal');
    if (modal) {
      modal.style.display = 'none';
      document.getElementById('newRepoName').value = '';
      document.getElementById('newRepoDesc').value = '';
      document.getElementById('newRepoPrivate').checked = false;
    }
  }
  
  /**
   * Create new repository
   */
  async createRepository() {
    const name = document.getElementById('newRepoName').value.trim();
    const description = document.getElementById('newRepoDesc').value.trim();
    const isPrivate = document.getElementById('newRepoPrivate').checked;
    
    if (!name) {
      Utils.showNotification('Repository name is required', 'error');
      return;
    }
    
    if (!Utils.validateRepoName(name)) {
      Utils.showNotification('Invalid repository name. Use only letters, numbers, hyphens, and underscores.', 'error');
      return;
    }
    
    try {
      // Show loading state
      const btn = document.getElementById('createRepoConfirmBtn');
      const originalText = btn.textContent;
      btn.textContent = 'Creating...';
      btn.disabled = true;
      
      const response = await chrome.runtime.sendMessage({
        action: 'createRepo',
        name,
        description,
        private: isPrivate
      });
      
      if (response.success) {
        Utils.showNotification(`Repository "${name}" created successfully!`, 'success');
        this.hideCreateRepoModal();
        await this.loadRepositories();
        
        // Auto-select the new repository
        const repoSelect = document.getElementById('repoSelect');
        const newRepoValue = JSON.stringify({
          owner: response.repo.owner.login,
          name: response.repo.name,
          full_name: response.repo.full_name,
          default_branch: response.repo.default_branch || 'main'
        });
        repoSelect.value = newRepoValue;
        await this.selectRepository(newRepoValue);
      } else {
        throw new Error(response.error || 'Failed to create repository');
      }
    } catch (error) {
      console.error('Create repository error:', error);
      Utils.showNotification('Failed to create repository: ' + error.message, 'error');
    } finally {
      const btn = document.getElementById('createRepoConfirmBtn');
      btn.textContent = 'Create Repository';
      btn.disabled = false;
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing uploader...');
  new GitHubUploader();
});
