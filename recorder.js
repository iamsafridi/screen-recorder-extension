// Simple recorder that runs in the page context
let mediaRecorder = null;
let recordedChunks = [];

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Recorder received:', request.action);
  
  if (request.action === 'startRecording') {
    startRecording()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'stopRecording') {
    stopRecording()
      .then(videoData => sendResponse({ success: true, videoData }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function startRecording() {
  try {
    console.log('Starting screen capture...');
    
    // Request screen capture - user will see dialog
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { mediaSource: 'screen' },
      audio: false
    });
    
    console.log('Got stream, starting recorder...');
    recordedChunks = [];
    
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9'
    });
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    mediaRecorder.start(1000);
    console.log('Recording started!');
    
    // Notify that recording started
    chrome.runtime.sendMessage({ action: 'recordingStarted' });
    
  } catch (error) {
    console.error('Recording failed:', error);
    throw error;
  }
}

async function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      reject(new Error('No active recording'));
      return;
    }
    
    mediaRecorder.onstop = () => {
      console.log('Recording stopped, processing...');
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
      
      // Clean up
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      mediaRecorder = null;
      recordedChunks = [];
    };
    
    mediaRecorder.stop();
  });
}

console.log('Recorder script loaded');
