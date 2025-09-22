/**
 * Main Popup Script for GitHub File Uploader Extension
 * Handles UI interactions and coordinates uploads
 */

class GitHubUploader {
  constructor() {
    this.fileHandler = new FileHandler();
    this.selectedFiles = [];
    this.currentRepo = null;
    this.currentBranch = 'main';
    this.isAuthenticated = false;
    this.uploadInProgress = false;
    this.uploadPaused = false;
    this.uploadStartTime = null;
    this.bytesUploaded = 0;
    
    this.init();
  }
  
  async init() {
    await this.checkAuthentication();
    this.attachEventListeners();
    this.setupDragAndDrop();
    
    if (this.isAuthenticated) {
      await this.loadRepositories();
    }
  }
  
  /**
   * Check authentication status
   */
  async checkAuthentication() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'checkAuth' });
      this.isAuthenticated = response.authenticated;
      this.updateAuthUI();
    } catch (error) {
      Utils.logError(error, { context: 'checkAuthentication' });
    }
  }
  
  /**
   * Update authentication UI
   */
  updateAuthUI() {
    const authStatus = document.getElementById('authStatus');
    const authButton = document.getElementById('authButton');
    const repoSection = document.getElementById('repoSection');
    
    if (this.isAuthenticated) {
      authStatus.textContent = 'Connected to GitHub';
      authStatus.className = 'status-text authenticated';
      authButton.textContent = 'Logout';
      Utils.toggleVisibility('repoSection', true);
    } else {
      authStatus.textContent = 'Not authenticated';
      authStatus.className = 'status-text';
      authButton.textContent = 'Login with GitHub';
      Utils.toggleVisibility('repoSection', false);
      Utils.toggleVisibility('uploadSection', false);
    }
  }
  
  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Authentication
    document.getElementById('authButton').addEventListener('click', () => this.handleAuth());
    
    // Repository management
    document.getElementById('refreshRepos').addEventListener('click', () => this.loadRepositories());
    document.getElementById('repoSearch').addEventListener('input', (e) => this.filterRepositories(e.target.value));
    document.getElementById('repoSelect').addEventListener('change', (e) => this.selectRepository(e.target.value));
    document.getElementById('createRepoBtn').addEventListener('click', () => this.showCreateRepoModal());
    
    // Branch management
    document.getElementById('branchSelect').addEventListener('change', (e) => this.selectBranch(e.target.value));
    
    // File selection
    document.getElementById('browseBtn').addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileSelect(e.target.files));
    document.getElementById('clearFilesBtn').addEventListener('click', () => this.clearFiles());
    
    // Upload controls
    document.getElementById('uploadBtn').addEventListener('click', () => this.startUpload());
    document.getElementById('cancelBtn').addEventListener('click', () => this.cancelUpload());
    document.getElementById('pauseBtn').addEventListener('click', () => this.pauseUpload());
    document.getElementById('resumeBtn').addEventListener('click', () => this.resumeUpload());
    document.getElementById('stopBtn').addEventListener('click', () => this.stopUpload());
    
    // Results actions
    document.getElementById('viewRepoBtn').addEventListener('click', () => this.viewRepository());
    document.getElementById('uploadMoreBtn').addEventListener('click', () => this.resetForNewUpload());
    
    // Modal controls
    document.getElementById('closeModalBtn').addEventListener('click', () => this.hideCreateRepoModal());
    document.getElementById('createRepoConfirmBtn').addEventListener('click', () => this.createRepository());
    document.getElementById('createRepoCancelBtn').addEventListener('click', () => this.hideCreateRepoModal());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideCreateRepoModal();
      }
    });
  }
  
  /**
   * Setup drag and drop
   */
  setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    
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
      
      const files = await this.fileHandler.handleDataTransfer(e.dataTransfer);
      this.handleFileSelect(files);
    });
    
    // Click to browse
    dropZone.addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });
    
    // Keyboard accessibility
    dropZone.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        document.getElementById('fileInput').click();
      }
    });
  }
  
  /**
   * Handle authentication
   */
  async handleAuth() {
    if (this.isAuthenticated) {
      // Logout
      try {
        await chrome.runtime.sendMessage({ action: 'logout' });
        this.isAuthenticated = false;
        this.updateAuthUI();
        Utils.showNotification('Logged out successfully', 'success');
      } catch (error) {
        Utils.logError(error, { context: 'logout' });
        Utils.showNotification('Failed to logout', 'error');
      }
    } else {
      // Login
      try {
        const response = await chrome.runtime.sendMessage({ action: 'authenticate' });
        if (response.success && response.token) {
          this.isAuthenticated = true;
          this.updateAuthUI();
          await this.loadRepositories();
          Utils.showNotification('Authentication successful!', 'success');
        }
      } catch (error) {
        Utils.logError(error, { context: 'authenticate' });
        Utils.showNotification('Authentication failed', 'error');
      }
    }
  }
  
  /**
   * Load user repositories
   */
  async loadRepositories() {
    const repoSelect = document.getElementById('repoSelect');
    repoSelect.innerHTML = '<option value="">Loading repositories...</option>';
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getRepos' });
      if (response.success && response.repos) {
        this.displayRepositories(response.repos);
      }
    } catch (error) {
      Utils.logError(error, { context: 'loadRepositories' });
      Utils.showNotification('Failed to load repositories', 'error');
      repoSelect.innerHTML = '<option value="">Failed to load repositories</option>';
    }
  }
  
  /**
   * Display repositories in select element
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
      if (option.value === '') return; // Skip placeholder
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
      Utils.toggleVisibility('branchSection', false);
      Utils.toggleVisibility('uploadSection', false);
      return;
    }
    
    try {
      this.currentRepo = JSON.parse(value);
      await this.loadBranches();
      Utils.toggleVisibility('branchSection', true);
      Utils.toggleVisibility('uploadSection', true);
    } catch (error) {
      Utils.logError(error, { context: 'selectRepository' });
    }
  }
  
  /**
   * Load repository branches
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
      Utils.logError(error, { context: 'loadBranches' });
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
    
    // Add processed files to selection
    this.selectedFiles = [...this.selectedFiles, ...result.files];
    this.displaySelectedFiles();
    
    // Show upload options
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
   * Remove file from selection
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
    
    if (!Utils.isOnline()) {
      Utils.showNotification('No internet connection', 'error');
      return;
    }
    
    this.uploadInProgress = true;
    this.uploadPaused = false;
    this.uploadStartTime = Date.now();
    this.bytesUploaded = 0;
    
    // Switch to progress view
    Utils.toggleVisibility('uploadSection', false);
    Utils.toggleVisibility('progressSection', true);
    
    const commitMessage = document.getElementById('commitMessage').value || 
                         `Upload ${this.selectedFiles.length} files via GitHub Uploader`;
    
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
      Utils.logError(error, { context: 'startUpload' });
      Utils.showNotification('Upload failed: ' + error.message, 'error');
      this.handleUploadError(error);
    }
  }
  
  /**
   * Update upload progress
   */
  updateProgress(current, total) {
    const percent = (current / total) * 100;
    const elapsedTime = Date.now() - this.uploadStartTime;
    const speed = Utils.calculateSpeed(current, elapsedTime);
    const remaining = Utils.estimateTimeRemaining(total - current, current / (elapsedTime / 1000));
    
    document.getElementById('progressPercent').textContent = `${Math.round(percent)}%`;
    Utils.updateProgressBar('progressFill', percent);
    document.getElementById('uploadSpeed').textContent = speed;
    document.getElementById('progressText').textContent = `Uploading... (${remaining} remaining)`;
  }
  
  /**
   * Add log entry
   */
  addLogEntry(message, type = 'info') {
    const logList = document.getElementById('logList');
    const li = document.createElement('li');
    li.className = `log-${type}`;
    li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logList.appendChild(li);
    logList.scrollTop = logList.scrollHeight;
  }
  
  /**
   * Handle upload complete
   */
  handleUploadComplete(results, errors) {
    this.uploadInProgress = false;
    
    // Switch to results view
    Utils.toggleVisibility('progressSection', false);
    Utils.toggleVisibility('resultsSection', true);
    
    // Update counts
    document.getElementById('successCount').textContent = results.length;
    document.getElementById('errorCount').textContent = errors.length;
    
    // Display details
    const resultsDetails = document.getElementById('resultsDetails');
    resultsDetails.innerHTML = '';
    
    if (results.length > 0) {
      const successList = document.createElement('div');
      successList.innerHTML = '<h4>Successfully uploaded:</h4>';
      const ul = document.createElement('ul');
      results.forEach(result => {
        const li = document.createElement('li');
        li.textContent = result.file;
        ul.appendChild(li);
      });
      successList.appendChild(ul);
      resultsDetails.appendChild(successList);
    }
    
    if (errors.length > 0) {
      const errorList = document.createElement('div');
      errorList.innerHTML = '<h4>Failed uploads:</h4>';
      const ul = document.createElement('ul');
      errors.forEach(error => {
        const li = document.createElement('li');
        li.textContent = `${error.file}: ${error.error}`;
        li.style.color = 'var(--danger-color)';
        ul.appendChild(li);
      });
      errorList.appendChild(ul);
      resultsDetails.appendChild(errorList);
    }
    
    Utils.showNotification('Upload complete!', results.length > 0 ? 'success' : 'error');
  }
  
  /**
   * Handle upload error
   */
  handleUploadError(error) {
    this.uploadInProgress = false;
    Utils.toggleVisibility('progressSection', false);
    Utils.toggleVisibility('uploadSection', true);
    this.addLogEntry(`Error: ${error.message}`, 'error');
  }
  
  /**
   * Pause upload
   */
  pauseUpload() {
    this.uploadPaused = true;
    document.getElementById('pauseBtn').style.display = 'none';
    document.getElementById('resumeBtn').style.display = 'inline-flex';
    this.addLogEntry('Upload paused', 'warning');
  }
  
  /**
   * Resume upload
   */
  resumeUpload() {
    this.uploadPaused = false;
    document.getElementById('pauseBtn').style.display = 'inline-flex';
    document.getElementById('resumeBtn').style.display = 'none';
    this.addLogEntry('Upload resumed', 'info');
  }
  
  /**
   * Stop upload
   */
  stopUpload() {
    this.uploadInProgress = false;
    this.uploadPaused = false;
    Utils.toggleVisibility('progressSection', false);
    Utils.toggleVisibility('uploadSection', true);
    this.addLogEntry('Upload stopped by user', 'error');
    Utils.showNotification('Upload cancelled', 'warning');
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
      const url = `https://github.com/${this.currentRepo.owner}/${this.currentRepo.name}`;
      chrome.tabs.create({ url });
    }
  }
  
  /**
   * Reset for new upload
   */
  resetForNewUpload() {
    this.clearFiles();
    Utils.toggleVisibility('resultsSection', false);
    Utils.toggleVisibility('uploadSection', true);
    document.getElementById('logList').innerHTML = '';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
  }
  
  /**
   * Show create repository modal
   */
  showCreateRepoModal() {
    document.getElementById('createRepoModal').style.display = 'flex';
    document.getElementById('newRepoName').focus();
  }
  
  /**
   * Hide create repository modal
   */
  hideCreateRepoModal() {
    document.getElementById('createRepoModal').style.display = 'none';
    document.getElementById('newRepoName').value = '';
    document.getElementById('newRepoDesc').value = '';
    document.getElementById('newRepoPrivate').checked = false;
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
      Utils.showNotification('Invalid repository name', 'error');
      return;
    }
    
    try {
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
      }
    } catch (error) {
      Utils.logError(error, { context: 'createRepository' });
      Utils.showNotification('Failed to create repository', 'error');
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new GitHubUploader();
});
