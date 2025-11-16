let offscreenCreated = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'uploadCapture') {
    handleUploadCapture(request.capture, request.blob, request.driveFolder)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'listDriveFolders') {
    listDriveFolders()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'createDriveFolder') {
    createDriveFolder(request.folderName)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'startRecordingOffscreen') {
    console.log('🎬 Background: startRecordingOffscreen received for tab:', request.tabId);
    startTabCapture(request.tabId)
      .then(() => {
        console.log('✅ Background: startTabCapture completed successfully');
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('❌ Background: Tab capture error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  
  if (request.action === 'stopRecordingOffscreen') {
    console.log('Background: Stopping recording');
    isRecording = false;
    chrome.runtime.sendMessage({ action: 'stopRecording' })
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'startRecordingInBackground') {
    console.log('Background: Starting recording...');
    startBackgroundRecording()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'stopRecordingInBackground') {
    console.log('Background: Stopping recording...');
    stopBackgroundRecording()
      .then(videoData => sendResponse({ success: true, videoData }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function setupOffscreenDocument() {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  
  if (existingContexts.length > 0) {
    console.log('Offscreen document already exists');
    return;
  }
  
  try {
    console.log('Creating offscreen document...');
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Recording screen for bug capture'
    });
    console.log('Offscreen document created');
    offscreenCreated = true;
    
    // Wait a bit for the document to load
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    console.error('Error creating offscreen document:', error);
    // Document might already exist
    if (!error.message.includes('Only a single offscreen')) {
      throw error;
    }
  }
}

let isRecording = false;
let backgroundMediaRecorder = null;
let backgroundRecordedChunks = [];
let backgroundStream = null;

async function startTabCapture(tabId) {
  try {
    console.log('Background: Starting tab capture for tab:', tabId);
    
    // Check if already recording
    if (isRecording) {
      throw new Error('Already recording. Please stop the current recording first.');
    }
    
    // Get stream ID for the tab
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });
    
    console.log('Background: Got streamId:', streamId);
    
    isRecording = true;
    
    // Setup offscreen document to use the stream
    await setupOffscreenDocument();
    
    // Send streamId to offscreen document
    await chrome.runtime.sendMessage({ 
      action: 'startRecordingWithStreamId',
      streamId: streamId
    });
    
    // Success message will be sent by offscreen document
    
  } catch (error) {
    console.error('❌ Background: Tab capture failed:', error);
    isRecording = false;
    await chrome.storage.local.set({ 
      recordingState: 'error',
      recordingError: error.message
    });
    throw error;
  }
}

async function handleUploadCapture(capture, base64Data, driveFolder) {
  try {
    // Get OAuth token
    const token = await getAuthToken();
    
    if (!token) {
      throw new Error('Failed to authenticate with Google');
    }
    
    // Convert base64 to blob
    const blob = await base64ToBlob(base64Data);
    
    // Upload to Google Drive
    const driveLink = await uploadToDrive(token, blob, capture, driveFolder);
    
    return { success: true, driveLink };
    
  } catch (error) {
    console.error('Upload error:', error);
    return { success: false, error: error.message };
  }
}

async function uploadToDrive(token, blob, capture, folderId) {
  try {
    // Create metadata
    const metadata = {
      name: capture.filename,
      mimeType: capture.type === 'screenshot' ? 'image/png' : 'video/webm',
      parents: folderId ? [folderId] : []
    };
    
    // Create multipart upload
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";
    
    const metadataBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
    
    const multipartRequestBody = 
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      await metadataBlob.text() +
      delimiter +
      `Content-Type: ${metadata.mimeType}\r\n\r\n`;
    
    const multipartBlob = new Blob([
      multipartRequestBody,
      blob,
      close_delim
    ]);
    
    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBlob
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Drive upload failed: ${error}`);
    }
    
    const result = await response.json();
    
    // Make file publicly accessible
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${result.id}/permissions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone'
        })
      }
    );
    
    return result.webViewLink;
    
  } catch (error) {
    console.error('Drive upload error:', error);
    throw error;
  }
}



async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

async function base64ToBlob(base64Data) {
  const response = await fetch(base64Data);
  return await response.blob();
}


async function listDriveFolders() {
  try {
    const token = await getAuthToken();
    
    if (!token) {
      throw new Error('Failed to authenticate');
    }
    
    // Get list of folders from Drive
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=50`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch folders');
    }
    
    const data = await response.json();
    const folders = data.files || [];
    
    return {
      success: true,
      folders: folders
    };
    
  } catch (error) {
    console.error('Error listing folders:', error);
    return { success: false, error: error.message };
  }
}

async function createDriveFolder(folderName) {
  try {
    const token = await getAuthToken();
    
    if (!token) {
      throw new Error('Failed to authenticate');
    }
    
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder'
        })
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to create folder');
    }
    
    const folder = await response.json();
    
    return {
      success: true,
      folderId: folder.id,
      folderName: folder.name
    };
    
  } catch (error) {
    console.error('Error creating folder:', error);
    return { success: false, error: error.message };
  }
}

// Background recording functions
let recordingResolve = null;

async function startBackgroundRecording() {
  try {
    console.log('Starting tab capture...');
    
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Get stream ID for tab capture (no dialog!)
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });
    
    console.log('Got streamId:', streamId);
    
    // Setup offscreen and send streamId
    await setupOffscreenDocument();
    await chrome.runtime.sendMessage({ 
      action: 'startRecordingWithStreamId',
      streamId: streamId
    });
    
  } catch (error) {
    console.error('Tab capture error:', error);
    throw error;
  }
}

async function stopBackgroundRecording() {
  return new Promise((resolve, reject) => {
    recordingResolve = resolve;
    chrome.runtime.sendMessage({ action: 'stopRecordingInOffscreen' })
      .catch(reject);
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (recordingResolve) {
        reject(new Error('Timeout waiting for video'));
        recordingResolve = null;
      }
    }, 10000);
  });
}

// Listen for recording complete from offscreen
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'recordingCompleteFromOffscreen' && recordingResolve) {
    recordingResolve(request.videoData);
    recordingResolve = null;
  }
  
  if (request.action === 'recordingError' && recordingResolve) {
    recordingResolve = null;
  }
});
