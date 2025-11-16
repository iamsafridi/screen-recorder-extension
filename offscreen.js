let mediaRecorder;
let recordedChunks = [];

console.log('Offscreen document loaded');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Offscreen received message:', message);
  
  if (message.action === 'startRecording' || message.action === 'startRecordingInOffscreen') {
    handleStartRecording();
    sendResponse({ received: true });
  } else if (message.action === 'startRecordingWithStreamId') {
    handleStartRecordingWithStreamId(message.streamId);
    sendResponse({ received: true });
  } else if (message.action === 'stopRecording' || message.action === 'stopRecordingInOffscreen') {
    handleStopRecording();
    sendResponse({ received: true });
  }
  
  return true;
});

async function handleStartRecordingWithStreamId(streamId) {
  try {
    console.log('Getting stream from streamId:', streamId);
    
    // Get the media stream using the streamId
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });
    
    console.log('Got stream from streamId');
    startRecordingWithStream(stream);
    
  } catch (error) {
    console.error('Recording error:', error);
    chrome.runtime.sendMessage({
      action: 'updateRecordingState',
      state: 'error',
      error: error.message
    });
  }
}

async function handleStartRecording() {
  try {
    console.log('Starting tab capture (no dialog)...');
    // This will be handled by background script using tabCapture
    // Just wait for the stream
  } catch (error) {
    console.error('Recording error:', error);
    chrome.runtime.sendMessage({
      action: 'recordingError',
      error: error.message
    });
  }
}

// Function to handle stream once we get it
function startRecordingWithStream(stream) {
  try {
    console.log('Got stream:', stream);
    console.log('Stream tracks:', stream.getTracks());
    
    // Listen for when user stops sharing
    stream.getTracks()[0].addEventListener('ended', () => {
      console.log('Tab capture ended');
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    });
    
    recordedChunks = [];
    
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }
    
    console.log('Using mimeType:', mimeType);
    
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      videoBitsPerSecond: 2500000
    });
    
    console.log('MediaRecorder created, state:', mediaRecorder.state);
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log('Data chunk received:', event.data.size, 'bytes');
      }
    };
    
    mediaRecorder.onstart = () => {
      console.log('MediaRecorder started event fired');
    };
    
    mediaRecorder.onstop = () => {
      console.log('Recording stopped, processing...');
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      console.log('Blob size:', blob.size, 'bytes');
      
      const reader = new FileReader();
      reader.onloadend = () => {
        console.log('Sending video data to background');
        chrome.runtime.sendMessage({
          action: 'recordingComplete',
          videoData: reader.result
        });
      };
      reader.readAsDataURL(blob);
      
      stream.getTracks().forEach(track => track.stop());
    };
    
    mediaRecorder.start(1000);
    console.log('MediaRecorder.start() called, state:', mediaRecorder.state);
    
    // Tell background to update state
    console.log('Notifying background that recording started');
    chrome.runtime.sendMessage({
      action: 'updateRecordingState',
      state: 'recording'
    });
    
  } catch (error) {
    console.error('Recording error:', error);
    chrome.runtime.sendMessage({
      action: 'recordingStarted',
      success: false,
      error: error.message
    }).catch(err => {
      console.error('Failed to send error message:', err);
    });
  }
}

function handleStopRecording() {
  console.log('Stopping recording...');
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = () => {
      console.log('Recording stopped, processing...');
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      console.log('Blob size:', blob.size, 'bytes');
      
      const reader = new FileReader();
      reader.onloadend = () => {
        console.log('Sending video data to background');
        chrome.runtime.sendMessage({
          action: 'recordingCompleteFromOffscreen',
          videoData: reader.result
        });
      };
      reader.readAsDataURL(blob);
    };
    
    mediaRecorder.stop();
  } else {
    console.log('No active recorder to stop');
    chrome.runtime.sendMessage({
      action: 'recordingError',
      error: 'No active recording'
    });
  }
}
