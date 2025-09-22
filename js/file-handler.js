/**
 * File Handler Module for GitHub File Uploader Extension
 * Handles file reading, chunking, compression, and validation
 */

class FileHandler {
  constructor() {
    this.CHUNK_SIZE = 1024 * 1024; // 1MB chunks
    this.MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB max file size
    this.ALLOWED_FILE_TYPES = new Set([
      // Code files
      '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.scss', '.sass', '.less',
      '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.go',
      '.rs', '.swift', '.kt', '.scala', '.r', '.m', '.mm', '.dart',
      // Data files
      '.json', '.xml', '.yaml', '.yml', '.toml', '.csv', '.sql',
      // Documentation
      '.md', '.txt', '.rst', '.tex', '.doc', '.docx', '.pdf',
      // Images
      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp',
      // Config files
      '.env', '.gitignore', '.editorconfig', '.prettierrc', '.eslintrc',
      '.babelrc', '.dockerignore', 'Dockerfile', 'Makefile',
      // Other
      '.zip', '.tar', '.gz', '.rar', '.7z'
    ]);
    
    this.fileQueue = [];
    this.processedFiles = new Map();
    this.uploadProgress = new Map();
  }
  
  /**
   * Read file as base64 encoded string
   */
  async readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  
  /**
   * Read file as text
   */
  async readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
  
  /**
   * Read file as ArrayBuffer
   */
  async readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  
  /**
   * Validate file type
   */
  validateFileType(fileName, strict = true) {
    if (!strict) return true;
    
    const extension = this.getFileExtension(fileName).toLowerCase();
    const baseName = fileName.toLowerCase();
    
    // Special cases for files without extensions
    const specialFiles = ['dockerfile', 'makefile', 'readme', 'license', 'changelog'];
    if (specialFiles.includes(baseName)) return true;
    
    // Check if extension is in allowed list
    return this.ALLOWED_FILE_TYPES.has(extension) || 
           this.ALLOWED_FILE_TYPES.has('.' + extension);
  }
  
  /**
   * Get file extension
   */
  getFileExtension(fileName) {
    const parts = fileName.split('.');
    return parts.length > 1 ? '.' + parts.pop() : '';
  }
  
  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
  }
  
  /**
   * Chunk large file for upload
   */
  async chunkFile(file) {
    const chunks = [];
    const chunkCount = Math.ceil(file.size / this.CHUNK_SIZE);
    
    for (let i = 0; i < chunkCount; i++) {
      const start = i * this.CHUNK_SIZE;
      const end = Math.min(start + this.CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      
      chunks.push({
        index: i,
        start,
        end,
        blob: chunk,
        size: end - start
      });
    }
    
    return chunks;
  }
  
  /**
   * Compress file using CompressionStream API (if available)
   */
  async compressFile(file) {
    try {
      // Check if CompressionStream is available
      if (typeof CompressionStream === 'undefined') {
        console.warn('CompressionStream not available, returning original file');
        return file;
      }
      
      const stream = file.stream();
      const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
      const compressedBlob = await new Response(compressedStream).blob();
      
      // Create new file with .gz extension
      const compressedFile = new File(
        [compressedBlob],
        file.name + '.gz',
        { type: 'application/gzip' }
      );
      
      console.log(`Compressed ${file.name}: ${this.formatFileSize(file.size)} → ${this.formatFileSize(compressedFile.size)}`);
      return compressedFile;
    } catch (error) {
      console.error('Compression failed:', error);
      return file; // Return original file if compression fails
    }
  }
  
  /**
   * Process files for upload
   */
  async processFiles(files, options = {}) {
    const {
      compress = false,
      validate = true,
      preservePath = true
    } = options;
    
    const processedFiles = [];
    const errors = [];
    
    for (const file of files) {
      try {
        // Validate file type
        if (validate && !this.validateFileType(file.name)) {
          errors.push({
            file: file.name,
            error: 'File type not allowed'
          });
          continue;
        }
        
        // Check file size
        if (file.size > this.MAX_FILE_SIZE) {
          errors.push({
            file: file.name,
            error: `File too large (max ${this.formatFileSize(this.MAX_FILE_SIZE)})`
          });
          continue;
        }
        
        // Compress if requested
        let processedFile = file;
        if (compress && this.shouldCompress(file)) {
          processedFile = await this.compressFile(file);
        }
        
        // Read file content
        const content = await this.readFileAsBase64(processedFile);
        
        // Determine file path
        const filePath = preservePath && file.webkitRelativePath 
          ? file.webkitRelativePath 
          : processedFile.name;
        
        processedFiles.push({
          name: processedFile.name,
          path: filePath,
          size: processedFile.size,
          type: processedFile.type,
          content: content,
          originalFile: file,
          compressed: compress && processedFile !== file
        });
      } catch (error) {
        errors.push({
          file: file.name,
          error: error.message
        });
      }
    }
    
    return { files: processedFiles, errors };
  }
  
  /**
   * Check if file should be compressed
   */
  shouldCompress(file) {
    // Don't compress already compressed files
    const compressedExtensions = ['.zip', '.gz', '.rar', '.7z', '.tar', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const extension = this.getFileExtension(file.name).toLowerCase();
    
    return !compressedExtensions.includes(extension);
  }
  
  /**
   * Create directory structure from files
   */
  createDirectoryStructure(files) {
    const structure = {};
    
    for (const file of files) {
      const pathParts = file.webkitRelativePath 
        ? file.webkitRelativePath.split('/') 
        : [file.name];
      
      let current = structure;
      
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part];
      }
      
      // Add file to structure
      const fileName = pathParts[pathParts.length - 1];
      current[fileName] = {
        type: 'file',
        size: file.size,
        file: file
      };
    }
    
    return structure;
  }
  
  /**
   * Calculate total size of files
   */
  calculateTotalSize(files) {
    return files.reduce((total, file) => total + file.size, 0);
  }
  
  /**
   * Track upload progress
   */
  updateProgress(fileId, progress) {
    this.uploadProgress.set(fileId, progress);
    
    // Calculate overall progress
    const totalProgress = Array.from(this.uploadProgress.values());
    const overallProgress = totalProgress.length > 0
      ? totalProgress.reduce((sum, p) => sum + p, 0) / totalProgress.length
      : 0;
    
    return {
      file: progress,
      overall: overallProgress
    };
  }
  
  /**
   * Reset progress tracking
   */
  resetProgress() {
    this.uploadProgress.clear();
  }
  
  /**
   * Create blob from base64 string
   */
  base64ToBlob(base64, mimeType = '') {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }
  
  /**
   * Handle drag and drop data transfer
   */
  async handleDataTransfer(dataTransfer) {
    const files = [];
    const items = dataTransfer.items || dataTransfer.files;
    
    if (dataTransfer.items) {
      // Use DataTransferItemList interface
      const promises = [];
      
      for (const item of items) {
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : item.getAsEntry();
          if (entry) {
            promises.push(this.traverseFileTree(entry));
          } else {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
      }
      
      const results = await Promise.all(promises);
      results.forEach(result => files.push(...result));
    } else {
      // Use DataTransfer.files
      for (const file of items) {
        files.push(file);
      }
    }
    
    return files;
  }
  
  /**
   * Traverse file tree for directory uploads
   */
  async traverseFileTree(entry, path = '') {
    const files = [];
    
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => {
        entry.file(resolve, reject);
      });
      
      // Add webkitRelativePath for proper path handling
      Object.defineProperty(file, 'webkitRelativePath', {
        value: path + file.name,
        writable: false
      });
      
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      
      for (const childEntry of entries) {
        const childFiles = await this.traverseFileTree(
          childEntry,
          path + entry.name + '/'
        );
        files.push(...childFiles);
      }
    }
    
    return files;
  }
  
  /**
   * Create file from text content
   */
  createFileFromText(content, fileName, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    return new File([blob], fileName, { type: mimeType });
  }
  
  /**
   * Detect file encoding
   */
  async detectEncoding(file) {
    const buffer = await this.readFileAsArrayBuffer(file.slice(0, 4));
    const bytes = new Uint8Array(buffer);
    
    // Check for BOM (Byte Order Mark)
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return 'utf-8';
    } else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return 'utf-16be';
    } else if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return 'utf-16le';
    }
    
    // Default to UTF-8
    return 'utf-8';
  }
  
  /**
   * Calculate file hash (SHA-256)
   */
  async calculateFileHash(file) {
    const buffer = await this.readFileAsArrayBuffer(file);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }
  
  /**
   * Check for duplicate files
   */
  async findDuplicates(files) {
    const hashes = new Map();
    const duplicates = [];
    
    for (const file of files) {
      const hash = await this.calculateFileHash(file);
      
      if (hashes.has(hash)) {
        duplicates.push({
          original: hashes.get(hash),
          duplicate: file,
          hash
        });
      } else {
        hashes.set(hash, file);
      }
    }
    
    return duplicates;
  }
}

// Export for use in other modules
window.FileHandler = FileHandler;
