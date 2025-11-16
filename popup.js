let mediaRecorder;
let recordedChunks = [];
let recordingStartTime;
let timerInterval;
let recordingStream;

// Event listeners
document.getElementById('screenshot').addEventListener('click', takeScreenshot);
document.getElementById('startRecord').addEventListener('click', startRecording);
document.getElementById('stopRecord').addEventListener('click', stopRecording);
document.getElementById('selectDriveFolder').addEventListener('click', selectDriveFolder);
document.getElementById('createNewFolder').addEventListener('click', createNewDriveFolder);
document.getElementById('openDrive').addEventListener('click', openDriveFolder);

// Initialize
loadCaptureList();
updateDriveFolderDisplay();
checkRecordingStatus();

async function takeScreenshot() {
  try {
    showLoading('Taking screenshot...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 100 });
    
    hideLoading();
    
    // Open editor for annotation
    const editorUrl = chrome.runtime.getURL('editor.html') + '?image=' + encodeURIComponent(screenshot);
    const editorWindow = await chrome.windows.create({
      url: editorUrl,
      type: 'popup',
      width: 1200,
      height: 800
    });
    
    // Wait for editor to close and check for annotated image
    const checkInterval = setInterval(async () => {
      try {
        const window = await chrome.windows.get(editorWindow.id);
      } catch (e) {
        // Window closed
        clearInterval(checkInterval);
        
        // Check if user saved annotated image
        const { annotatedImage } = await chrome.storage.local.get('annotatedImage');
        
        if (annotatedImage) {
          // Clear the temporary storage
          await chrome.storage.local.remove('annotatedImage');
          
          // Convert to blob
          const response = await fetch(annotatedImage);
          const blob = await response.blob();
          
          // Ask user for filename
          const customName = await showNameDialog('screenshot', tab.title);
          
          if (customName === null) {
            return;
          }
          
          const capture = {
            type: 'screenshot',
            url: tab.url,
            title: tab.title,
            timestamp: new Date().toISOString(),
            blob: blob,
            filename: customName || `screenshot-${Date.now()}.png`,
            customName: customName
          };
          
          await processCapture(capture);
        }
      }
    }, 500);
    
  } catch (error) {
    showNotification('Error: ' + error.message, true);
    console.error(error);
  }
}

async function startRecording() {
  try {
    console.log('Starting recording...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Store tab info
    await chrome.storage.local.set({
      recordingTab: {
        url: tab.url,
        title: tab.title
      },
      isRecording: true,
      recordingStartTime: Date.now()
    });
    
    // Send message to background to start recording
    const response = await chrome.runtime.sendMessage({ 
      action: 'startRecordingInBackground'
    });
    
    if (response && response.success) {
      recordingStartTime = Date.now();
      document.getElementById('startRecord').style.display = 'none';
      document.getElementById('stopRecord').style.display = 'inline-block';
      document.getElementById('recordingTimer').style.display = 'block';
      timerInterval = setInterval(updateTimer, 1000);
      showNotification('Recording started! You can close this popup.');
    } else {
      await chrome.storage.local.remove(['isRecording', 'recordingStartTime']);
      showNotification('Failed to start: ' + (response?.error || 'Unknown'), true);
    }
    
  } catch (error) {
    await chrome.storage.local.remove(['isRecording', 'recordingStartTime']);
    showNotification('Recording cancelled or failed: ' + error.message, true);
    console.error('Recording error:', error);
  }
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');
  document.getElementById('timer').textContent = `${minutes}:${seconds}`;
}

async function checkRecordingStatus() {
  const { isRecording, recordingStartTime: startTime } = await chrome.storage.local.get(['isRecording', 'recordingStartTime']);
  
  if (isRecording && startTime) {
    console.log('Recording is active, showing UI...');
    recordingStartTime = startTime;
    document.getElementById('startRecord').style.display = 'none';
    document.getElementById('stopRecord').style.display = 'inline-block';
    document.getElementById('recordingTimer').style.display = 'block';
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer(); // Update immediately
  }
}

async function stopRecording() {
  try {
    clearInterval(timerInterval);
    document.getElementById('startRecord').style.display = 'inline-block';
    document.getElementById('stopRecord').style.display = 'none';
    document.getElementById('recordingTimer').style.display = 'none';
    
    showLoading('Stopping recording...');
    
    // Tell background to stop
    const response = await chrome.runtime.sendMessage({ 
      action: 'stopRecordingInBackground'
    });
    
    if (response && response.success && response.videoData) {
      await chrome.storage.local.remove(['isRecording', 'recordingStartTime']);
      await handleRecordingComplete(response.videoData);
    } else {
      hideLoading();
      showNotification('Failed to stop: ' + (response?.error || 'Unknown'), true);
    }
    
  } catch (error) {
    hideLoading();
    showNotification('Error stopping recording: ' + error.message, true);
    console.error(error);
  }
}

async function handleRecordingComplete(videoData) {
  try {
    const { recordingTab } = await chrome.storage.local.get('recordingTab');
    
    // Convert to blob
    const response = await fetch(videoData);
    const blob = await response.blob();
    
    hideLoading();
    
    // Ask user for filename
    const customName = await showNameDialog('video', recordingTab.title);
    
    if (customName === null) {
      await chrome.storage.local.remove('recordingTab');
      return;
    }
    
    const capture = {
      type: 'video',
      url: recordingTab.url,
      title: recordingTab.title,
      timestamp: new Date().toISOString(),
      blob: blob,
      filename: customName || `recording-${Date.now()}.webm`,
      customName: customName
    };
    
    await chrome.storage.local.remove('recordingTab');
    await processCapture(capture);
  } catch (error) {
    hideLoading();
    showNotification('Error processing recording: ' + error.message, true);
    console.error(error);
  }
}

async function processCapture(capture) {
  try {
    // Save locally first
    await saveLocalCapture(capture);
    
    // Get Drive folder configuration
    const { driveFolder } = await chrome.storage.local.get('driveFolder');
    
    // Upload to Drive
    showLoading('Uploading to Google Drive...');
    
    const result = await chrome.runtime.sendMessage({
      action: 'uploadCapture',
      capture: {
        type: capture.type,
        url: capture.url,
        title: capture.title,
        timestamp: capture.timestamp,
        filename: capture.filename
      },
      blob: await blobToBase64(capture.blob),
      driveFolder: driveFolder
    });
    
    if (result.success) {
      // Show link in notification
      showNotification(`✓ Uploaded to Drive!`);
      
      // Update local capture with drive link
      const { captures = [] } = await chrome.storage.local.get('captures');
      const localCapture = captures.find(c => c.timestamp === capture.timestamp);
      if (localCapture) {
        localCapture.driveLink = result.driveLink;
        localCapture.uploaded = true;
        await chrome.storage.local.set({ captures });
      }
      
      // Auto-copy link to clipboard
      try {
        await navigator.clipboard.writeText(result.driveLink);
        showNotification('✓ Link copied to clipboard!');
      } catch (e) {
        // Clipboard failed, that's ok
      }
    } else {
      showNotification('Saved locally. Upload failed: ' + result.error, true);
    }
    
    loadCaptureList();
    
  } catch (error) {
    showNotification('Error processing capture: ' + error.message, true);
    console.error(error);
  }
}

async function saveLocalCapture(capture) {
  const { captures = [] } = await chrome.storage.local.get('captures');
  
  // Convert blob to base64 for storage
  const base64 = await blobToBase64(capture.blob);
  
  captures.unshift({
    type: capture.type,
    url: capture.url,
    title: capture.title,
    timestamp: capture.timestamp,
    filename: capture.filename,
    customName: capture.customName,
    data: base64,
    uploaded: false
  });
  
  // Keep only last 10 captures
  if (captures.length > 10) {
    captures.length = 10;
  }
  
  await chrome.storage.local.set({ captures });
}

async function loadCaptureList() {
  const { captures = [] } = await chrome.storage.local.get('captures');
  const listEl = document.getElementById('captureList');
  
  if (captures.length === 0) {
    listEl.innerHTML = '<p style="color: #999; font-size: 12px; text-align: center;">No captures yet</p>';
    return;
  }
  
  listEl.innerHTML = captures.map((capture, index) => `
    <div class="capture-item">
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span>${capture.type === 'screenshot' ? '📸' : '🎥'}</span>
          <span style="font-size: 11px;" title="${capture.customName || capture.filename}">${(capture.customName || capture.filename).substring(0, 25)}...</span>
          ${capture.uploaded ? '<span style="color: #34a853; font-size: 10px;">✓</span>' : ''}
        </div>
        <div style="color: #999; font-size: 9px;">${new Date(capture.timestamp).toLocaleString()}</div>
      </div>
      <div style="display: flex; gap: 4px;">
        <button class="btn-icon" data-action="download" data-index="${index}" title="Download locally">⬇️</button>
        ${!capture.uploaded ? `<button class="btn-icon" data-action="upload" data-index="${index}" title="Upload to Drive">📤</button>` : ''}
        ${capture.driveLink ? `<button class="btn-icon" data-action="copylink" data-link="${capture.driveLink}" data-index="${index}" title="Copy Drive link">🔗</button>` : ''}
        ${capture.driveLink ? `<button class="btn-icon" data-action="open" data-link="${capture.driveLink}" title="Open in Drive">📂</button>` : ''}
        <button class="btn-icon" data-action="delete" data-index="${index}" title="Delete from list">🗑️</button>
      </div>
    </div>
  `).join('');
  
  // Attach event listeners to all buttons
  listEl.querySelectorAll('.btn-icon').forEach(button => {
    button.addEventListener('click', handleCaptureAction);
  });
}

async function handleCaptureAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  const index = parseInt(button.dataset.index);
  const link = button.dataset.link;
  
  switch(action) {
    case 'download':
      await downloadCapture(index);
      break;
    case 'upload':
      await uploadCapture(index);
      break;
    case 'copylink':
      await copyDriveLink(link, index);
      break;
    case 'open':
      openLink(link);
      break;
    case 'delete':
      await deleteCapture(index);
      break;
  }
}

async function downloadCapture(index) {
  const { captures } = await chrome.storage.local.get('captures');
  const capture = captures[index];
  
  const link = document.createElement('a');
  link.href = capture.data;
  link.download = capture.filename;
  link.click();
  
  showNotification('Downloaded!');
}

async function uploadCapture(index) {
  const { captures } = await chrome.storage.local.get('captures');
  const capture = captures[index];
  
  const { driveFolder } = await chrome.storage.local.get('driveFolder');
  
  showLoading('Uploading to Drive...');
  
  try {
    const result = await chrome.runtime.sendMessage({
      action: 'uploadCapture',
      capture: {
        type: capture.type,
        url: capture.url,
        title: capture.title,
        timestamp: capture.timestamp,
        filename: capture.filename
      },
      blob: capture.data,
      driveFolder: driveFolder
    });
    
    if (result.success) {
      capture.driveLink = result.driveLink;
      capture.uploaded = true;
      await chrome.storage.local.set({ captures });
      showNotification('✓ Uploaded to Drive!');
      loadCaptureList();
    } else {
      showNotification('Upload failed: ' + result.error, true);
    }
  } catch (error) {
    showNotification('Error: ' + error.message, true);
  }
}

async function deleteCapture(index) {
  if (!confirm('Delete this capture?')) return;
  
  const { captures } = await chrome.storage.local.get('captures');
  captures.splice(index, 1);
  await chrome.storage.local.set({ captures });
  loadCaptureList();
  showNotification('Deleted');
}

function openLink(url) {
  chrome.tabs.create({ url });
}

async function copyDriveLink(link, index) {
  try {
    await navigator.clipboard.writeText(link);
    showNotification('✓ Link copied to clipboard!');
    
    // Visual feedback - briefly highlight the button
    const buttons = document.querySelectorAll(`[data-action="copylink"][data-index="${index}"]`);
    buttons.forEach(btn => {
      const originalText = btn.textContent;
      btn.textContent = '✓';
      btn.style.background = '#34a853';
      btn.style.color = 'white';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
        btn.style.color = '';
      }, 1000);
    });
  } catch (error) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = link;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showNotification('✓ Link copied!');
  }
}

function showNameDialog(type, pageTitle) {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.id = 'nameDialog';
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    const suggestedName = `${pageTitle.substring(0, 30).replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`;
    const extension = type === 'screenshot' ? '.png' : '.webm';
    
    dialog.innerHTML = `
      <div style="background: white; border-radius: 12px; padding: 24px; max-width: 350px; width: 90%;">
        <h3 style="margin: 0 0 16px 0; font-size: 16px; color: #333;">Name your ${type}</h3>
        <input type="text" id="captureNameInput" 
          value="${suggestedName}" 
          placeholder="Enter filename"
          style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 6px; font-size: 14px; margin-bottom: 4px;">
        <div style="font-size: 11px; color: #666; margin-bottom: 16px;">Extension: ${extension}</div>
        <div style="display: flex; gap: 8px;">
          <button id="cancelName" class="btn" style="flex: 1; background: #ccc; color: #333; margin: 0;">Cancel</button>
          <button id="saveName" class="btn btn-primary" style="flex: 1; margin: 0;">Save</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    const input = dialog.querySelector('#captureNameInput');
    const saveBtn = dialog.querySelector('#saveName');
    const cancelBtn = dialog.querySelector('#cancelName');
    
    // Focus and select text
    input.focus();
    input.select();
    
    // Handle save
    const handleSave = () => {
      let name = input.value.trim();
      if (name) {
        // Add extension if not present
        if (!name.endsWith(extension)) {
          name += extension;
        }
        dialog.remove();
        resolve(name);
      } else {
        input.style.borderColor = '#ea4335';
        setTimeout(() => {
          input.style.borderColor = '#e0e0e0';
        }, 500);
      }
    };
    
    // Handle cancel
    const handleCancel = () => {
      dialog.remove();
      resolve(null);
    };
    
    saveBtn.addEventListener('click', handleSave);
    cancelBtn.addEventListener('click', handleCancel);
    
    // Enter to save, Escape to cancel
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    });
  });
}




async function selectDriveFolder() {
  showLoading('Loading your Drive folders...');
  
  try {
    const result = await chrome.runtime.sendMessage({
      action: 'listDriveFolders'
    });
    
    if (result.success && result.folders) {
      hideLoading();
      showFolderPicker(result.folders);
    } else {
      showNotification('Failed to load folders: ' + result.error, true);
    }
  } catch (error) {
    showNotification('Error: ' + error.message, true);
  }
}

function showFolderPicker(folders) {
  const picker = document.createElement('div');
  picker.id = 'folderPicker';
  picker.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 20px;
    max-width: 320px;
    max-height: 400px;
    overflow-y: auto;
  `;
  
  content.innerHTML = `
    <h3 style="margin: 0 0 16px 0; font-size: 16px;">Select Drive Folder</h3>
    <div id="folderList"></div>
    <button id="cancelPicker" class="btn" style="margin-top: 12px; background: #ccc; color: #333;">Cancel</button>
  `;
  
  picker.appendChild(content);
  document.body.appendChild(picker);
  
  const folderList = content.querySelector('#folderList');
  folderList.innerHTML = folders.map(folder => `
    <div class="folder-item" data-id="${folder.id}" data-name="${folder.name}" style="
      padding: 12px;
      margin-bottom: 8px;
      background: #f5f5f5;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    ">
      <div style="font-size: 14px; font-weight: 500;">📁 ${folder.name}</div>
    </div>
  `).join('');
  
  // Add hover effect
  folderList.querySelectorAll('.folder-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      item.style.background = '#e0e0e0';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = '#f5f5f5';
    });
    item.addEventListener('click', async () => {
      const folderId = item.dataset.id;
      const folderName = item.dataset.name;
      await chrome.storage.local.set({ driveFolder: folderId, driveFolderName: folderName });
      picker.remove();
      showNotification('✓ Folder selected: ' + folderName);
      updateDriveFolderDisplay();
    });
  });
  
  content.querySelector('#cancelPicker').addEventListener('click', () => {
    picker.remove();
  });
}

async function createNewDriveFolder() {
  const folderName = prompt('Enter folder name:', 'Bug Captures');
  
  if (!folderName) return;
  
  showLoading('Creating folder...');
  
  try {
    const result = await chrome.runtime.sendMessage({
      action: 'createDriveFolder',
      folderName: folderName
    });
    
    if (result.success) {
      await chrome.storage.local.set({ 
        driveFolder: result.folderId, 
        driveFolderName: result.folderName 
      });
      showNotification('✓ Folder created: ' + result.folderName);
      updateDriveFolderDisplay();
    } else {
      showNotification('Failed to create folder: ' + result.error, true);
    }
  } catch (error) {
    showNotification('Error: ' + error.message, true);
  }
}

async function updateDriveFolderDisplay() {
  const { driveFolder, driveFolderName } = await chrome.storage.local.get(['driveFolder', 'driveFolderName']);
  const display = document.getElementById('driveFolderDisplay');
  
  if (driveFolder && driveFolderName) {
    display.innerHTML = `
      <div style="background: #e8f5e9; padding: 10px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 12px; font-weight: 600; color: #2e7d32;">📁 ${driveFolderName}</div>
          <div style="font-size: 10px; color: #666; margin-top: 2px;">All captures will be saved here</div>
        </div>
        <button id="clearFolder" style="background: none; border: none; cursor: pointer; font-size: 16px;" title="Clear">✕</button>
      </div>
    `;
    
    display.querySelector('#clearFolder').addEventListener('click', async () => {
      if (confirm('Clear Drive folder selection?')) {
        await chrome.storage.local.remove(['driveFolder', 'driveFolderName']);
        updateDriveFolderDisplay();
        showNotification('Folder cleared');
      }
    });
  } else {
    display.innerHTML = `
      <div style="background: #fff3cd; padding: 10px; border-radius: 6px; font-size: 11px; color: #856404;">
        ⚠️ No folder selected - files will be saved to Drive root
      </div>
    `;
  }
}



async function openDriveFolder() {
  const { driveFolder } = await chrome.storage.local.get('driveFolder');
  
  if (driveFolder) {
    chrome.tabs.create({ url: `https://drive.google.com/drive/folders/${driveFolder}` });
  } else {
    chrome.tabs.create({ url: 'https://drive.google.com/drive/my-drive' });
  }
}



function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function showNotification(message, isError = false) {
  hideLoading();
  
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 20px;
    background: ${isError ? '#ea4335' : '#34a853'};
    color: white;
    border-radius: 6px;
    font-size: 12px;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

function showLoading(message) {
  hideLoading();
  
  const loading = document.createElement('div');
  loading.id = 'loadingOverlay';
  loading.innerHTML = `
    <div style="background: rgba(0,0,0,0.8); color: white; padding: 16px 24px; border-radius: 8px; text-align: center;">
      <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
      <div style="font-size: 12px;">${message}</div>
    </div>
  `;
  loading.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  `;
  
  document.body.appendChild(loading);
}

function hideLoading() {
  const loading = document.getElementById('loadingOverlay');
  if (loading) loading.remove();
}
